/* V5 block 22 (F11) — THE TODAY TIMELINE HAS TO OBEY THE THEME, WITHOUT LOSING WHAT ITS COLOURS MEAN.
 *
 * The timeline was a full-pane pastel slab painted from hex literals inside `TL_TYP()` and
 * `renderDayColumn`, so the app's landing view stayed light-themed on black chrome. Block 22 moved it
 * onto `--tl-*` theme tokens. That is easy to do badly, and the bad version passes a naive test:
 * darken every block toward grey and any "is dark different from light?" assertion goes green while the
 * product gets worse, because a block's HUE is what says which work it is.
 *
 * So this file asserts three things, and the middle one is the point:
 *
 *   1. the two themes really do paint different surfaces (the token pass happened at all);
 *   2. every block keeps its HUE across themes, and keeps real chroma — a dark palette that flattened
 *      the blocks toward grey FAILS here even though it would satisfy (1);
 *   3. block text stays legible on its own block in both themes (WCAG AA for bold small text, 3:1).
 *
 * V5 block 25c narrowed what (2) is measuring, and the narrowing matters: hue used to be a property of
 * the block's KIND (four families defined in `TL_TYP`) and is now a property of the TASK
 * (`PCOL[priority]`, the calendar's own map), mixed into a NEUTRAL per-theme base. So (2) now doubles
 * as the proof that the theme contributes tone only — a tinted base would rotate the hue between the
 * themes and fail right here. `block-colour.spec.js` owns the cross-surface half of that claim.
 *
 * Colours are read from `getComputedStyle`, so this measures what the browser resolved the tokens to,
 * not what the source says. Both themes are booted in their own page — the theme is seeded, and
 * re-navigating one page would stack `addInitScript` handlers.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { bootToday, bootDays, task, settleTimeline, dayColumns } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `${name}.png`);

/* One of every block KIND in a single day, since the hue assertion is per family:
   `fixed` (clock-pinned), `scheduled`→`auto` (flexible work the packer placed), and `meal` (the lunch
   window). `unscheduled` is the overflow family and is exercised by its token, not by a block. */
function everyKindOfDay(theme) {
  return {
    theme,
    settings: {
      allotMode: 'today', packFromNow: false, freeTime: 0,
      dayStart: '08:00', dayEnd: '19:00',
      lunchStart: '12:00', lunchEnd: '13:00', dinnerStart: '00:00', dinnerEnd: '00:00',
      minChunk: 30, breakMin: 0,
    },
    tasks: [
      /* V5 block 25c: `priority` is now what colours a block, so the appointment carries one too.
         Without it the fixed family draws in `--pri-default` slate — correctly, since that is also
         what the month calendar gives an unprioritised task — and the "not flattened to grey"
         assertion below would have nothing chromatic to measure. */
      task('t-appt', 'Standup', { start: '0d+9h', end: '0d+10h', startClock: true, endClock: true, planned: 60, priority: 2 }),
      task('t-flex', 'Write the quarterly report', { start: '-2d', end: '+3d', planned: 180, priority: 1 }),
      task('t-flex2', 'Clear the inbox', { start: '-2d', end: '+3d', planned: 90, priority: 3 }),
    ],
  };
}

/* sRGB → HSL hue (degrees) and HSL saturation, plus relative luminance. Hue is undefined for a
   neutral, which is exactly the case we want to catch, so `sat` is reported alongside and asserted. */
const COLOUR_MATHS = `
  /* Chromium serialises a resolved color-mix() as color(srgb r g b) with 0..1 components, and a plain
     colour as rgb()/rgba() with 0..255. Block 25c's block fills are the former, so both forms have to
     parse here — otherwise every measurement below quietly reads NaN and every assertion passes. */
  const num = (s) => {
    const cm = /color\\(srgb ([^)/]+)/.exec(s);
    if (cm) return cm[1].trim().split(/\\s+/).map((v) => Number(v) * 255);
    return (/rgba?\\(([^)]+)\\)/.exec(s) || [0, ''])[1].split(',').map(Number);
  };
  const hsl = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let hh = 0;
    if (d > 1e-9) {
      if (mx === r) hh = 60 * (((g - b) / d) % 6);
      else if (mx === g) hh = 60 * ((b - r) / d + 2);
      else hh = 60 * ((r - g) / d + 4);
    }
    if (hh < 0) hh += 360;
    return { h: hh, s: d < 1e-9 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
  };
  const lum = (c) => {
    const f = (u) => { const s = u / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
`;

/** Read every block's resolved gradient stops + text colour, keyed by `data-tl-kind`. */
async function harvest(page) {
  return page.evaluate(`(() => {
    ${COLOUR_MATHS}
    const out = {};
    document.querySelectorAll('[data-tl-block]').forEach((el) => {
      const kind = el.getAttribute('data-tl-kind');
      if (out[kind]) return;
      const cs = getComputedStyle(el);
      /* backgroundImage is the resolved gradient; every colour function in it is a stop. (Block 25a
         deleted the auto hatch that used to prepend a second gradient, so the last two stops and the
         only two stops are now the same thing — slice(-2) is kept so the reading stays correct if a
         decorative overlay is ever added back.) A fixed WINDOW has no gradient at all by design, so it
         yields zero stops and is measured separately below. */
      const stops = (cs.backgroundImage.match(/color\\(srgb [^)]+\\)|rgba?\\([^)]+\\)/g) || []).map(num)
        .filter((c) => c.length < 4 || c[3] > 0.5);
      const fg = num(cs.color);
      out[kind] = {
        bgColor: num(cs.backgroundColor),
        stops: stops.slice(-2),
        hues: stops.slice(-2).map((c) => hsl(c).h),
        sats: stops.slice(-2).map((c) => hsl(c).s),
        fg,
        /* Contrast of the label against the DARKER of its own two stops, i.e. the worst case. */
        contrast: Math.min(...stops.slice(-2).map((c) => ratio(fg, c))),
      };
    });
    return out;
  })()`);
}

test.describe('theme tokens: the Today timeline follows the theme', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('the timeline paints different surfaces per theme, keeps every block hue, and stays legible', async ({ browser }) => {
    const read = async (theme) => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await bootToday(page, everyKindOfDay(theme));
      await settleTimeline(page);
      const pal = await harvest(page);
      await page.close();
      return pal;
    };

    const light = await read('light');
    const dark = await read('dark');

    /* The day really did draw the families this test is about. */
    const kinds = Object.keys(light).filter((k) => dark[k]);
    expect(kinds.sort(), 'the fixture drew an auto-scheduled block, a clock-fixed one and a meal')
      .toEqual(['auto', 'fixed', 'meal']);

    /* V5 block 25c re-homed what "hue" means here. It used to be per-KIND: auto warm, meal purple,
       fixed green. It is now per-TASK — a block is filled with the task's own `PCOL[priority]`, the
       same map the month calendar uses — and a `meal` is not a task at all but a `dayIntervals` clock
       window, which by design takes NO hue and is measured on its own terms below. So the loop runs
       over the TASK kinds, and the block's fixture gives its two flexible tasks priorities 1 and 3
       precisely so the "not flattened to grey" assertion still has real chroma to check. */
    const taskKinds = kinds.filter((k) => k !== 'meal');
    expect(taskKinds.sort(), 'the fixture drew a task block of each placement kind').toEqual(['auto', 'fixed']);

    for (const kind of taskKinds) {
      const L = light[kind], D = dark[kind];

      /* 1 — the token pass happened: dark is not simply light. */
      expect(JSON.stringify(D.stops), `${kind}: dark surface differs from light`).not.toBe(JSON.stringify(L.stops));

      /* 2 — THE ONE THAT MATTERS. Hue carries meaning, so it must survive the re-tone, and the dark
         stops must still be colours rather than greys. A "make it legible by flattening to grey"
         change satisfies assertion 1 and dies here. (Post-25c this is also what proves the theme
         contributes TONE only: the fill is the task colour mixed into a NEUTRAL base, and a tinted
         base would show up right here as hue drift between the themes.) */
      D.hues.forEach((h, i) => {
        /* Shortest arc between the two hues, so 359° and 1° read as 2° apart and not 358°. */
        const drift = Math.abs(((h - L.hues[i] + 540) % 360) - 180);
        expect(drift, `${kind} stop ${i}: hue drift dark ${h.toFixed(1)}° vs light ${L.hues[i].toFixed(1)}°`)
          .toBeLessThan(12);
      });
      D.sats.forEach((s, i) => {
        expect(s, `${kind} stop ${i}: dark saturation ${s.toFixed(3)} — the fill must not be flattened to grey`)
          .toBeGreaterThan(0.15);
      });

      /* 3 — the label is still readable on its own block in both themes. 3:1 is WCAG AA for the
         bold 11px text these blocks carry. */
      expect(L.contrast, `${kind}: light label contrast`).toBeGreaterThan(3);
      expect(D.contrast, `${kind}: dark label contrast`).toBeGreaterThan(3);

      /* And the dark blocks really are dark — the F11 complaint was a pastel slab on black chrome, so a
         "different hue, still pastel" answer would be the same defect wearing new colours. */
      D.stops.map((c) => (c[0] + c[1] + c[2]) / 3).forEach((m, i) => {
        expect(m, `${kind} stop ${i}: dark block is a dark surface, not a pastel one`).toBeLessThan(128);
      });
    }

    /* The clock window (25c). It is a SETTING, not work, so it carries no fill hue in either theme —
       but it still has to obey the theme and still has to be readable, which is what block 22 was
       about. A window that quietly regained a task-style gradient fails the first assertion. */
    for (const [name, pal] of [['light', light], ['dark', dark]]) {
      const M = pal.meal;
      expect(M.stops, `${name}: a clock window takes no hue — it is drawn as structure, not as a task`).toEqual([]);
      expect(M.bgColor[3] === undefined || M.bgColor[3] > 0, `${name}: the window still paints its wash`).toBe(true);
    }
    expect(JSON.stringify(dark.meal.bgColor), 'the window wash is theme-aware, not one colour for both')
      .not.toBe(JSON.stringify(light.meal.bgColor));
  });
});

/* ── The pictures the owner actually judges this by ────────────────────────────────────────────
 * Stably named `22-*` so they are not overwritten by the generic `today-*`/`week-*` captures that
 * every later visual block re-runs.
 *
 * The weekend pair uses a DELIBERATELY SPARSE day. `visual-evidence.spec.js` fills every column so the
 * grid is worth reviewing, but a column packed edge to edge with blocks hides the very thing this
 * block changed — the column's own background. Here the flexible work is short enough that most of
 * each column is bare pane, which is the only condition under which "is Saturday tinted?" can be
 * answered by eye rather than by arithmetic.
 */
test.describe('theme tokens: screenshots', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  const sparseWeek = (theme) => ({
    theme,
    settings: {
      allotMode: 'today', packFromNow: false, freeTime: 0,
      dayStart: '08:00', dayEnd: '19:00',
      lunchStart: '12:00', lunchEnd: '13:00', dinnerStart: '00:00', dinnerEnd: '00:00',
      minChunk: 30, breakMin: 0,
    },
    /* Clock-fixed appointments ONLY. A flexible task is the wrong thing here however small its
       `planned` is: the packer spreads it over the whole free pool, so every column comes back
       covered and the background this block changed is the one thing not on screen. The lunch band
       still draws from `settings`, which keeps a sense of scale in each column. */
    tasks: [
      task('w-mon', 'Standup', { start: '+1d+9h', end: '+1d+9h30m', startClock: true, endClock: true, planned: 30, included: false }),
      task('w-wed', 'Design review', { start: '+3d+15h', end: '+3d+16h30m', startClock: true, endClock: true, planned: 90, included: false }),
      task('w-sat', 'Long run', { start: '+6d+10h', end: '+6d+11h30m', startClock: true, endClock: true, planned: 90, included: false }),
    ],
  });

  for (const theme of ['light', 'dark']) {
    test(`Today timeline — ${theme}`, async ({ page }) => {
      await bootToday(page, everyKindOfDay(theme));
      await settleTimeline(page);
      await page.screenshot({ path: shot(`22-today-${theme}`), fullPage: false });
    });

    test(`weekend beside weekday — ${theme}`, async ({ page }) => {
      await bootDays(page, 'week', sparseWeek(theme));
      await settleTimeline(page);
      const cols = await dayColumns(page);
      expect(cols.length, 'seven columns').toBe(7);
      /* Thu/Fri/Sat/Sun where they exist in the anchored week — the tint is only judgeable against an
         untinted neighbour, so the crop always spans a weekday boundary. Taken from the column
         geometry rather than fixed pixels so it survives any future column-width change. */
      const sat = cols.find((c) => new Date(c.day).getDay() === 6);
      const sun = cols.find((c) => new Date(c.day).getDay() === 0);
      expect(sat && sun, 'the anchored week contains both weekend days').toBeTruthy();
      const lo = Math.min(sat.x, sun.x), hi = Math.max(sat.x + sat.w, sun.x + sun.w);
      const left = Math.max(0, lo - 2.2 * sat.w);
      await page.screenshot({
        path: shot(`22-weekend-pair-${theme}`),
        clip: { x: left, y: 0, width: Math.min(1600 - left, hi - left + 8), height: 620 },
      });
    });
  }
});
