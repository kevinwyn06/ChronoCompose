/* V5 block 25 (card 11) — ONE COLOUR SOURCE, NO HATCHING, AND A VISIBLE MARK ON THE RARE CASE.
 *
 * Owner, verbatim: *"No hatching at all."* and *"Use a dark border or thick border around locked
 * blocks. By the way, colors should be the same as the calendar colors, and the hardcoded blocks
 * should be represented some other way."*
 *
 * Three things changed in `renderDayColumn`, and each is easy to "fix" back by accident, so each gets
 * an assertion written to FAIL on the regression rather than one that merely passes today:
 *
 *   25a — the auto-scheduled hatch is DELETED. Asserted as: no block anywhere carries a repeating
 *         gradient, AND `--tl-hatch` no longer resolves to anything. Checking only the first would
 *         let a dead token linger and invite the texture back; checking only the second would let an
 *         inline literal hatch survive the token's removal.
 *   25b — a LOCKED block (clock-fixed, or hand-pinned to this day) carries a heavy border. Asserted
 *         on the WIDTH channel (a strict inequality against the auto blocks in the same day, so a
 *         change that made everything 3px fails), on the CONTRAST of the border against the block's
 *         own fill in BOTH themes (so a border that exists but cannot be seen fails), and separately
 *         in each theme (so a mark that only works on dark fails).
 *   25c — SUPERSEDED 2026-08-19 by an explicit owner decision: *"Assign different colors to different
 *         sections for the timeline blocks"* / *"Get rid of the priority coloring."* This block used to
 *         assert that the timeline and the month calendar shared ONE source, `PCOL[priority]`, precisely
 *         so that a timeline-only palette could not appear. A timeline-only palette is now the
 *         requirement, so that guard is retired ON PURPOSE rather than quietly weakened — and it is
 *         replaced, not deleted, by the two properties that now carry the meaning:
 *           · same section, different priority  -> ONE hue (priority no longer speaks here)
 *           · different section                 -> visibly different hues
 *         The month calendar is asserted to still read `PCOL`, so "get rid of priority colouring" cannot
 *         silently spread past the timeline it was scoped to.
 *         The `dayIntervals` clock windows (Lunch/Dinner/Free time) are NOT tasks and take no hue at
 *         all: they are asserted to be structurally different from task blocks, not merely a
 *         different shade of one.
 *
 * Everything is read with `getComputedStyle` after `settleTimeline`, because `renderDayColumn` paints
 * twice and a first-pass read is not evidence of anything.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { bootToday, bootDays, task, settleTimeline, timelineBlocks, switchView } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `${name}.png`);

/* Two flexible tasks on DIFFERENT priorities (so "one hue for everything" is detectable), one
 * clock-fixed appointment (the locked case), and the lunch window (the structural case). */
const SETTINGS = {
  allotMode: 'today', packFromNow: false, freeTime: 0,
  dayStart: '08:00', dayEnd: '19:00',
  lunchStart: '12:00', lunchEnd: '13:00', dinnerStart: '00:00', dinnerEnd: '00:00',
  minChunk: 30, breakMin: 0,
};
const fixture = (theme) => {
  /* Keep the locked block deliberately away from the wall clock. A fixed 09:00 appointment becomes
     the current block during that hour, when the intentional current-task red paint replaces the
     normal priority fill and turns this into a test of red-vs-border contrast. Either slot remains
     inside the configured day, while selecting the far side of noon guarantees it is non-current. */
  const appointmentHour = new Date().getHours() < 13 ? 17 : 9;
  return {
    theme,
    settings: SETTINGS,
    tasks: [
      task('t-appt', 'Standup', {
        start: `0d+${appointmentHour}h`, end: `0d+${appointmentHour + 1}h`,
        startClock: true, endClock: true, planned: 60,
      }),
      task('t-p1', 'Ship the release', { start: '-1d', end: '+2d', planned: 150, priority: 1, sectionId: 'sec-work' }),
      task('t-p3', 'Clear the inbox', { start: '-1d', end: '+2d', planned: 90, priority: 3, sectionId: 'sec-admin' }),
      /* Same SECTION as t-p1 but a different priority: the pair that proves priority no longer speaks
         on the timeline. Without it, "coloured by section" and "coloured by priority" are
         indistinguishable in this fixture, because section and priority would move together. */
      task('t-p4', 'Water the plants', { start: '-1d', end: '+2d', planned: 60, priority: 4, sectionId: 'sec-work' }),
    ],
    sections: [
      { id: 'sec-work', name: 'Work', order: 0 },
      { id: 'sec-admin', name: 'Admin', order: 1 },
    ],
  };
};

/* sRGB helpers. Chromium serialises a resolved color-mix() as `color(srgb r g b)` on 0..1 and plain
   colours as `rgb()`/`rgba()` on 0..255 — both appear here, so both must parse or the measurements
   silently become NaN and every assertion below turns into a no-op. */
const MATHS = `
  const num = (s) => {
    const cm = /color\\(srgb ([^)/]+)/.exec(String(s));
    if (cm) return cm[1].trim().split(/\\s+/).map((v) => Number(v) * 255);
    const m = /rgba?\\(([^)]+)\\)/.exec(String(s));
    return m ? m[1].split(',').map(Number) : [0, 0, 0, 0];
  };
  const hue = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-9) return null;
    let hh = mx === r ? 60 * (((g - b) / d) % 6) : (mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4));
    return hh < 0 ? hh + 360 : hh;
  };
  const sat = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    return d < 1e-9 ? 0 : d / (1 - Math.abs(2 * l - 1));
  };
  const lum = (c) => {
    const f = (u) => { const s = u / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
`;

/** Shortest arc between two hues, so 359° and 1° read as 2° apart. */
const drift = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Per-block: the first gradient stop's hue, the border, and border-vs-fill contrast. */
async function blockColours(page) {
  return page.evaluate(`(() => {
    ${MATHS}
    return Array.from(document.querySelectorAll('[data-tl-block]')).map((el) => {
      const cs = getComputedStyle(el);
      const stops = (cs.backgroundImage.match(/color\\(srgb [^)]+\\)|rgba?\\([^)]+\\)/g) || []).map(num);
      const fill = stops.length ? stops[0] : num(cs.backgroundColor);
      const bc = num(cs.borderTopColor);
      return {
        title: (el.textContent || '').replace(/[📍📌✕▶■⧉↺]/g, '').trim(),
        kind: el.getAttribute('data-tl-kind') || '',
        taskId: el.getAttribute('data-tl-task') || '',
        bgImage: cs.backgroundImage,
        nStops: stops.length,
        fillHue: hue(fill), fillSat: sat(fill),
        borderW: parseFloat(cs.borderTopWidth) || 0,
        borderStyle: cs.borderTopStyle,
        /* The border has to be visible against the thing it is drawn on — its own block. */
        borderContrast: ratio(bc, fill),
      };
    });
  })()`);
}

/** The month view's chip dot for a task, by the task's name — the CALENDAR's colour for that work. */
async function monthChipHue(page, name) {
  return page.evaluate(`(() => {
    ${MATHS}
    const label = Array.from(document.querySelectorAll('span'))
      .find((s) => (s.textContent || '').trim() === ${JSON.stringify(name)} && !s.querySelector('span'));
    if (!label) return { found: false };
    /* The chip is <div><span dot/><span name/>…</div>; the dot is the first span of the chip row. */
    const dot = label.parentElement && label.parentElement.querySelector('span');
    if (!dot) return { found: false };
    const c = num(getComputedStyle(dot).backgroundColor);
    return { found: true, hue: hue(c), sat: sat(c) };
  })()`);
}

test.describe('block colour: hatching is gone', () => {
  for (const theme of ['light', 'dark']) {
    test(`no block on the Today timeline is hatched — ${theme}`, async ({ page }) => {
      await bootToday(page, fixture(theme));
      await settleTimeline(page);
      const blocks = await blockColours(page);
      expect(blocks.length, 'the fixture drew blocks at all').toBeGreaterThan(2);
      blocks.forEach((b) => {
        expect(b.bgImage, `${b.title}: no repeating gradient survives`).not.toContain('repeating-linear-gradient');
      });
      /* And the token itself is gone, so nothing can quietly reach for it again. `getPropertyValue`
         on an undefined custom property returns the empty string. */
      const tok = await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--tl-hatch').trim()`);
      expect(tok, '--tl-hatch is deleted, not merely unused').toBe('');
    });
  }

  test('no block in the Week grid is hatched either', async ({ page }) => {
    await bootDays(page, 'week', fixture('dark'));
    const blocks = await blockColours(page);
    expect(blocks.length, 'the week drew blocks').toBeGreaterThan(2);
    blocks.forEach((b) => {
      expect(b.bgImage, `${b.title}: no repeating gradient survives`).not.toContain('repeating-linear-gradient');
    });
  });
});

test.describe('block colour: a locked block is marked', () => {
  for (const theme of ['light', 'dark']) {
    test(`the lock border is heavier than the auto border and visible against its own fill — ${theme}`, async ({ page }) => {
      await bootToday(page, fixture(theme));
      await settleTimeline(page);
      const blocks = await blockColours(page);

      const locked = blocks.filter((b) => b.kind === 'fixed' || b.kind === 'pinned');
      const auto = blocks.filter((b) => b.kind === 'auto');
      expect(locked.length, 'the fixture drew a locked block').toBeGreaterThan(0);
      expect(auto.length, 'and auto-scheduled ones to compare it against').toBeGreaterThan(0);

      const thinnestLock = Math.min(...locked.map((b) => b.borderW));
      const thickestAuto = Math.max(...auto.map((b) => b.borderW));
      /* A strict inequality, not "locked >= 3": a change that made EVERY block 3px would satisfy a
         threshold and destroy the signal, which is the whole point of the mark. */
      expect(thinnestLock, `${theme}: the locked border (${thinnestLock}px) is heavier than the auto one (${thickestAuto}px)`)
        .toBeGreaterThan(thickestAuto);
      /* Expressed as a RATIO, never as an absolute pixel count. Everything is drawn inside the
         `zoom:0.8` wrapper (and block 23 made every pane ~25% taller in CSS px), so the 3px source
         border measures 2.5px here — an absolute threshold would be asserting the zoom factor, not
         the design. The ratio is what the eye actually reads. */
      expect(thinnestLock / thickestAuto, `${theme}: the lock border is at least twice the auto border`)
        .toBeGreaterThanOrEqual(2);

      locked.forEach((b) => {
        expect(b.borderContrast, `${theme}: ${b.title}'s lock border stands out from its own fill`)
          .toBeGreaterThan(3);
      });
    });
  }
});

test.describe('block colour: the timeline reads sections, the calendar still reads priority', () => {
  test('a block hue is its SECTION, and priority no longer speaks on the timeline', async ({ page }) => {
    await bootToday(page, fixture('dark'));
    await settleTimeline(page);
    const blocks = await blockColours(page);

    const byTask = {};
    blocks.forEach((b) => { if (b.taskId && byTask[b.taskId] == null) byTask[b.taskId] = b; });
    const work1 = byTask['t-p1'], admin = byTask['t-p3'], work4 = byTask['t-p4'];
    expect(work1 && admin && work4, 'all three flexible tasks drew a block').toBeTruthy();

    /* Two SECTIONS must look different. This is what a "tone everything the same" change breaks, and it
       would otherwise sail through every per-block assertion in this file. */
    expect(drift(work1.fillHue, admin.fillHue), 'two sections are two visibly different hues')
      .toBeGreaterThan(40);
    [work1, admin, work4].forEach((b) => {
      expect(b.fillSat, `${b.title}: the fill is a colour, not a grey`).toBeGreaterThan(0.15);
    });

    /* P1 and P4 in the SAME section: one hue. This is the half that fails if priority creeps back in. */
    expect(drift(work1.fillHue, work4.fillHue),
      `same section, priorities 1 and 4: ${work1.fillHue.toFixed(1)} vs ${work4.fillHue.toFixed(1)} - priority must not tint a block`)
      .toBeLessThan(12);

    /* The scope check. The owner scoped "get rid of the priority coloring" to the TIMELINE; the month
       calendar still reads PCOL. So the calendar is required to still separate two priorities that the
       timeline now paints identically. */
    await switchView(page, 'Month');
    await page.waitForTimeout(150);
    const chip1 = await monthChipHue(page, 'Ship the release');
    const chip4 = await monthChipHue(page, 'Water the plants');
    expect(chip1.found && chip4.found, 'both found on the month calendar').toBe(true);
    expect(chip1.sat, 'the calendar keeps a chromatic colour of its own').toBeGreaterThan(0.15);
    expect(drift(chip1.hue, chip4.hue),
      'the month calendar still separates P1 from P4 - PCOL survives everywhere except the timeline')
      .toBeGreaterThan(40);
  });

  for (const theme of ['light', 'dark']) {
    test(`a fixed clock window is drawn as structure, not as a task — ${theme}`, async ({ page }) => {
      await bootToday(page, fixture(theme));
      await settleTimeline(page);
      const blocks = await blockColours(page);

      const win = blocks.filter((b) => b.kind === 'meal');
      const tasks = blocks.filter((b) => b.kind !== 'meal');
      expect(win.length, 'the lunch window drew').toBeGreaterThan(0);
      expect(tasks.length, 'and task blocks drew beside it').toBeGreaterThan(0);

      win.forEach((b) => {
        /* Structural, and asserted on three channels so borrowing a task treatment back fails here:
           no gradient fill at all, a dashed outline, and no task carries that outline style. */
        expect(b.nStops, `${b.title}: a window takes no task fill`).toBe(0);
        expect(b.borderStyle, `${b.title}: a window is outlined, not filled`).toBe('dashed');
        expect(b.taskId, `${b.title}: and it is not a task`).toBe('');
      });
      tasks.filter((b) => b.kind === 'auto').forEach((b) => {
        expect(b.nStops, `${b.title}: an auto task block IS filled`).toBeGreaterThan(0);
        expect(b.borderStyle, `${b.title}: and is not outlined like a window`).toBe('solid');
      });
    });
  }
});

/* ── The pictures the owner judges this by ────────────────────────────────────────────────────
 * Today AND the Week grid, in both themes. Named `25-*` so the generic captures other blocks re-run
 * cannot overwrite them.
 */
test.describe('block colour: screenshots', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  for (const theme of ['light', 'dark']) {
    test(`Today timeline — ${theme}`, async ({ page }) => {
      await bootToday(page, fixture(theme));
      await settleTimeline(page);
      await page.screenshot({ path: shot(`25-today-${theme}`), fullPage: false });
    });

    test(`Week grid — ${theme}`, async ({ page }) => {
      await bootDays(page, 'week', fixture(theme));
      await settleTimeline(page);
      await page.screenshot({ path: shot(`25-week-${theme}`), fullPage: false });
    });
  }
});
