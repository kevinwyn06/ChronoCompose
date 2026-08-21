/* Block 13, deliverable (b) — VISUAL EVIDENCE.
 *
 * Nobody has ever looked at this app running. Seventy-odd assertions say the DOM is right; none of
 * them can say the pixels are. Four things in particular are structurally invisible to the suite,
 * and all four are captured here on purpose:
 *
 *   · the ⧉ regroup control — asserted only by its `title`, so a tofu box passes every test there is;
 *   · overlapping blocks in the Week grid, where block 12's 10% step is about four pixels wide;
 *   · the weekend tint in DARK theme — the tint has only ever been reviewed in light;
 *   · a populated Selection view, which every existing spec sees with three or four cards.
 *
 * These are written to `.orchestration/shots/` (git-ignored — they are evidence for a human review,
 * not artefacts to commit) and the orchestrator opens them. So the fixtures below are deliberately
 * FULLER than a test fixture would be: an empty grid proves nothing about a grid.
 *
 * `settleTimeline` before every capture is not optional. `renderDayColumn` paints once at the
 * fallback scale and again once the ResizeObserver reports the pane height; a screenshot taken
 * between the two shows the day at the wrong size and looks like a layout bug that isn't there.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  bootToday, bootDays, bootPlan, task, settleTimeline, timelineBlocks, dayColumns,
} = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `${name}.png`);

const THEMES = ['light', 'dark'];

/* A day with something in every band: a morning appointment, an overlapping pair, lunch, an
   afternoon Point, multi-day flexible work that reaches the weekend, and a subtask family.
   `-7d`/`+7d` spans are what put work in EVERY column of the Week grid, weekends included — the
   weekend tint is only reviewable against columns that have content in them. */
function fullWeek() {
  return {
    settings: {
      /* 2026-08-19: meals are tasks; the free-time reserve is the remaining structural clock window. */
      allotMode: 'today', packFromNow: false, freeTime: 60,
      dayStart: '08:00', dayEnd: '19:00',
      minChunk: 30, breakMin: 0,
    },
    tasks: [
      /* The overlap pair — the owner's ~90/10 shape from the Google Calendar screenshot. */
      task('v-work', 'Workshop: Q3 planning', { start: '0d+9h', end: '0d+17h', startClock: true, endClock: true, planned: 480 }),
      task('v-sync', 'Sync w/ Priya', { start: '0d+11h', end: '0d+11h30m', startClock: true, endClock: true, planned: 30 }),
      /* A second, tighter overlap so the shot shows the 50/50 shape as well as the sliver. */
      task('v-call', 'Client call', { start: '0d+14h', end: '0d+15h', startClock: true, endClock: true, planned: 60 }),
      task('v-1on1', '1:1 with Sam', { start: '0d+14h', end: '0d+15h', startClock: true, endClock: true, planned: 60 }),
      /* Weekday appointments on the neighbouring days, so 4-Day is not one busy column and three empty.
         `included:false` is load-bearing: `isActiveOn(t, today)` short-circuits on `included===true`,
         so an included appointment whose clock is on ANOTHER day is charged time today that today
         cannot place, and lands in the Unscheduled list. Leaving the window to decide is what keeps
         these on their own day. (Same trap `multiday-grid.spec.js` documents.) */
      task('v-standup', 'Standup', { start: '+1d+9h', end: '+1d+9h30m', startClock: true, endClock: true, planned: 30, included: false }),
      task('v-review', 'Design review', { start: '+2d+15h', end: '+2d+16h30m', startClock: true, endClock: true, planned: 90, included: false }),
      /* Flexible work that reaches every column, weekends included. */
      task('v-report', 'Write the quarterly report', { start: '-7d', end: '+7d', planned: 240, priority: 2 }),
      task('v-inbox', 'Clear the inbox', { start: '-7d', end: '+7d', planned: 90, priority: 3 }),
      /* A subtask family, so the grid shows the 'Parent › Child' sub-blocks. */
      task('v-move', 'Move flat', { start: '-7d', end: '+7d', planned: 120, priority: 3 }),
      task('v-move-a', 'Pack the kitchen', { start: '-7d', end: '+7d', planned: 80, priority: 3, parentId: 'v-move' }),
      task('v-move-b', 'Book a van', { start: '-7d', end: '+7d', planned: 40, priority: 3, parentId: 'v-move' }),
      /* A keep-clear Point: a clock with no duration, drawn as a caret rather than a block. */
      task('v-pickup', 'Pick up the kids', { start: '0d+16h', end: null, planned: 0 }),
    ],
  };
}

test.describe('visual evidence', () => {
  /* A real desktop. Narrower than this and the Week grid's columns stop being representative of what
     the owner actually looks at; `deviceScaleFactor:2` so text in the shots is legible when the
     reviewer zooms rather than resampled mush. */
  test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  for (const theme of THEMES) {
    test(`Today drawer — ${theme}`, async ({ page }) => {
      await bootToday(page, Object.assign(fullWeek(), { theme }));
      await settleTimeline(page);
      const blocks = await timelineBlocks(page);
      expect(blocks.length, 'the day has enough in it to be worth looking at').toBeGreaterThan(5);
      await page.screenshot({ path: shot(`today-${theme}`), fullPage: false });
    });

    test(`4-Day grid — ${theme}`, async ({ page }) => {
      await bootDays(page, 'day4', Object.assign(fullWeek(), { theme }));
      await settleTimeline(page);
      expect((await dayColumns(page)).length, 'four columns').toBe(4);
      await page.screenshot({ path: shot(`day4-${theme}`), fullPage: false });
    });

    test(`Week grid — ${theme}`, async ({ page }) => {
      await bootDays(page, 'week', Object.assign(fullWeek(), { theme }));
      await settleTimeline(page);
      const cols = await dayColumns(page);
      expect(cols.length, 'seven columns').toBe(7);
      /* Every column has something drawn in it. A weekend tint is only judgeable against a weekend
         column that is not blank — an empty column reads as "tinted" whatever its background is. */
      const blocks = await timelineBlocks(page);
      cols.forEach((c) => {
        expect(blocks.some((b) => b.day === c.day), `column ${new Date(c.day).toDateString()} has content`).toBe(true);
      });
      await page.screenshot({ path: shot(`week-${theme}`), fullPage: false });

      /* WEEKEND TINT, close up. Sat+Sun plus the Friday beside them, so the reviewer is comparing a
         tinted column against an untinted neighbour rather than judging a colour in isolation —
         which is the only way "is the tint visible in dark?" can actually be answered by eye. */
      const sat = cols[6], fri = cols[5];
      const left = Math.max(0, fri.x - 8);
      await page.screenshot({
        path: shot(`week-weekend-tint-${theme}`),
        clip: { x: left, y: 0, width: Math.min(1600 - left, sat.x + sat.w - left + 8), height: 640 },
      });

      /* THE OVERLAP SLIVER, close up. In a Week column the 10% step is ~4px, which is exactly the
         thing a `data-tl-ov` assertion cannot judge: the number can be right and the result still
         unreadable. Cropped tight around today's column so the sliver is not four pixels in a
         1600px-wide picture. */
      const today = cols.find((c) => c.isToday);
      const mine = blocks.filter((b) => b.day === today.day && b.ov > 0);
      expect(mine.length, 'today\'s column really does contain an overlapped block').toBeGreaterThan(0);
      const top = Math.max(0, Math.min(...mine.map((b) => b.y)) - 60);
      await page.screenshot({
        path: shot(`week-overlap-${theme}`),
        clip: {
          x: Math.max(0, today.x - 30), y: top,
          width: Math.min(1600 - Math.max(0, today.x - 30), today.w + 60),
          height: Math.min(1000 - top, 420),
        },
      });
    });

    test(`Selection view — ${theme}`, async ({ page }) => {
      await bootPlan(page, 'select', {
        theme,
        settings: fullWeek().settings,
        tasks: [
          /* One of every column the Selection view can show, on both sides of the divider, because
             an empty column collapses and a shot of three cards proves nothing about the layout. */
          task('s-late', 'Renew the passport', { start: '-9d', end: '-2d', planned: 60, priority: 1, included: true }),
          task('s-late2', 'Reply to the landlord', { start: '-5d', end: '-1d', planned: 30, priority: 1, included: null }),
          task('s-carry', 'Write the quarterly report', { start: '-1d', end: '+3d', planned: 240, priority: 2, included: null }),
          task('s-carry2', 'Pack the kitchen', { start: '-1d', end: '+6d', planned: 90, priority: 3, included: null }),
          task('s-new', 'Standup notes', { start: '0d', end: '0d', planned: 20, priority: 2, included: true }),
          task('s-new2', 'Book the van', { start: '0d', end: '+2d', planned: 30, priority: 3, included: true }),
          task('s-new3', 'Groceries', { start: '0d', end: '+1d', planned: 45, priority: 4, included: null }),
          task('s-extra', 'Learn Portuguese', { start: '+2d', end: '+30d', planned: 60, priority: 4, included: true }),
          task('s-extra2', 'Plan the trip', { start: '+3d', end: '+20d', planned: 120, priority: 3, included: null }),
          task('s-extra3', 'Fix the bike', { start: '+4d', end: '+14d', planned: 45, priority: 4, included: null }),
          /* V5 block 20 (F19): `s-new3`'s window OPENS today, so it is auto-included now — undecided
             work is no longer filed as refused, and the Excluded band lost a card to the fix. A live
             SNOOZE restores the third excluded card, and it is the more honest one to show: since
             auto-inclusion, an explicit snooze is what "excluded and in-window" actually looks like. */
          task('s-snoozed', 'Renew the gym membership', { start: '-1d', end: '+5d', planned: 30, priority: 3, included: null, snoozeUntil: '+2d' }),
        ],
      });
      await expect(page.locator('[data-card-id]')).toHaveCount(11);
      /* Several buckets populated — a Selection shot where every card sits in one column hides the
         partition, which is the whole design. (This replaces the old Included/Excluded band check:
         task 8 removed that dimension, so "both bands full" no longer describes anything.) */
      const filled = await page.locator('[data-selbucket]').evaluateAll(
        (els) => els.filter((e) => e.querySelector('[data-card-id]')).length);
      expect(filled, 'the shot shows a real partition, not one full column').toBeGreaterThan(2);
      await page.screenshot({ path: shot(`selection-${theme}`), fullPage: false });
    });
  }
});

/* ── FIXED in V5 block 23 (F10): the app fills the window ──────────────────────────────────────
   Was: the app shell is `<div style="…height:100vh;overflow:hidden;zoom:0.8">`. `zoom` scales the
   USED height as well as the contents, so `100vh` of layout was painted into 80vh of screen and the
   bottom fifth of every window was bare background — clearest in `selection-*.png`, where the card
   grid stopped dead with a quarter of the window still to go. Not only cosmetic: the day drawer
   sizes itself to the pane it is given, so the timeline was permanently 20% shorter than the window
   could hold, which is what pushed short chunks into the 13px height floor.

   Now: the shell height divides by the same zoom factor (`calc(100vh / var(--pp-shell-zoom))`), so
   used height lands back on the real viewport. The zoom itself is deliberately untouched.

   This asserts at THREE viewport sizes on purpose. The whole failure mode of a height fix is a
   hard-coded number that satisfies one window and is wrong at every other, so a single-viewport
   assertion would not be evidence. Short, tall and wide all have to land. */
test.describe('the app fills the window', () => {
  for (const vp of [{ width: 1600, height: 1000 }, { width: 1280, height: 720 }, { width: 1920, height: 1200 }]) {
    test(`the shell reaches the bottom of a ${vp.width}x${vp.height} viewport`, async ({ page }) => {
      await page.setViewportSize(vp);
      await bootToday(page, Object.assign(fullWeek(), { theme: 'dark' }));
      await settleTimeline(page);
      const m = await page.evaluate(() => {
        const root = document.getElementById('dc-root') || document.body.firstElementChild;
        const r = root.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, inner: window.innerHeight };
      });
      console.log(`[window fill ${vp.width}x${vp.height}] shell ${m.top}→${m.bottom} of ${m.inner}px viewport`
        + ` — ${(m.inner - m.bottom).toFixed(0)}px of dead space`);
      if (vp.width === 1600) await page.screenshot({ path: shot('window-fill-dark'), fullPage: false });
      /* Overshoot matters as much as undershoot: a shell taller than the window would push the
         bottom chrome off-screen inside an `overflow:hidden` wrapper, where nothing can scroll to it. */
      expect(m.bottom - m.inner, 'shell overflowing the viewport').toBeLessThan(4);
      expect(m.inner - m.bottom, 'dead space below the app').toBeLessThan(4);
    });
  }
});

/* ── FIXED in V5 block 22 (F12): the weekend tint now survives the dark theme ──────────────────
   Was: `renderMultiDayView` hard-coded `background: weekend ? 'rgba(0,0,0,0.05)' : 'transparent'`,
   i.e. it DARKENS — on the dark theme's near-black pane that is no change at all (Δluminance 0.0008
   against light's 0.107, measured here). It now paints `var(--tl-weekend)`, which lightens on dark and
   darkens on light, so the two themes get comparable separation rather than one of them getting none.

   The `test.fail(theme === 'dark', …)` marker that pinned the defect was cleared in the commit that
   fixed it, per the chain rule. Both themes must pass on their own merits from here.

   Measured rather than eyeballed, and without decoding pixels: the tint is a known alpha over a known
   pane colour, so the composite is arithmetic. */
test.describe('visual evidence: weekend tint', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  for (const theme of THEMES) {
    test(`a weekend column is distinguishable from a weekday column — ${theme}`, async ({ page }) => {
      await bootDays(page, 'week', Object.assign(fullWeek(), { theme }));
      await settleTimeline(page);

      const delta = await page.evaluate(() => {
        const rgba = (c) => {
          const d = document.createElement('div');
          d.style.color = c; document.body.appendChild(d);
          const v = getComputedStyle(d).color; d.remove();
          const n = /rgba?\(([^)]+)\)/.exec(v)[1].split(',').map(Number);
          return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
        };
        const lin = (u) => { const s = u / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
        const pane = rgba(getComputedStyle(document.documentElement).getPropertyValue('--gantt-bg').trim());
        const cols = [...document.querySelectorAll('[data-tl-col]')]
          .filter((el) => el.getAttribute('data-tl-today') !== '1')
          .map((el) => ({ dow: new Date(Number(el.getAttribute('data-tl-col'))).getDay(),
            bg: rgba(el.style.background || 'transparent') }));
        const we = cols.find((c) => c.dow === 0 || c.dow === 6);
        const wd = cols.find((c) => c.dow !== 0 && c.dow !== 6);
        return { d: Math.abs(L(over(we.bg, pane)) - L(over(wd.bg, pane))), we: we.bg, wd: wd.bg };
      });

      /* Printed as well as asserted: `test.fail` swallows the message, and the NUMBER is the evidence
         a reviewer needs next to the two screenshots. */
      console.log(`[weekend tint] ${theme}: Δluminance = ${delta.d.toFixed(5)}`
        + ` (weekend bg ${JSON.stringify(delta.we)}, weekday bg ${JSON.stringify(delta.wd)})`);
      /* 0.008 in relative luminance is about where a large flat wash stops being a wash and starts
         being "did something render wrong?". Light measures ~0.107; dark now measures ~0.023 (it
         measured ~0.0008 before the fix — the same order of magnitude as nothing at all). */
      expect(delta.d, `weekend tint Δluminance (weekend ${JSON.stringify(delta.we)} vs weekday ${JSON.stringify(delta.wd)})`)
        .toBeGreaterThan(0.008);
    });
  }
});

/* ── The ⧉ regroup control, close enough to read ───────────────────────────────────────────────
   `timeline-drag.spec.js` asserts this control by `[title^="Regroup"]`, which a blank box, a tofu
   glyph, or a control drawn off its own block would all satisfy. Captured at deviceScaleFactor 4 and
   cropped to the block, because "is that ⧉ or is that a missing-glyph rectangle?" is a question only
   a picture can settle. Both themes: the control sits on a translucent white pill, which is a
   different problem against a dark block than against a light one. */
test.describe('visual evidence: the ⧉ regroup control', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 4 });

  const regroupDay = (theme) => ({
    theme,
    settings: {
      allotMode: 'today', packFromNow: false, freeTime: 0,
      dayStart: '08:00', dayEnd: '18:00',
      lunchStart: '00:00', lunchEnd: '00:00', dinnerStart: '00:00', dinnerEnd: '00:00',
      minChunk: 30, breakMin: 0,
    },
    tasks: [
      task('r-appt', 'Standup', { start: '0d+9h', end: '0d+10h', startClock: true, endClock: true, planned: 60 }),
      /* Split by the appointment into 08:00–09:00 + 10:00–…, with a contiguous slot left over, which
         is the precondition `regroupSpan` requires before the affordance is offered at all. */
      task('r-split', 'Write the quarterly report', { start: '0d', end: '+2d', planned: 100, priority: 1 }),
      task('r-filler', 'Clear the inbox', { start: '0d', end: '+2d', planned: 440, priority: 2 }),
    ],
  });

  for (const theme of THEMES) {
    test(`the ⧉ is drawn as a glyph, not a tofu box — ${theme}`, async ({ page }) => {
      await bootToday(page, regroupDay(theme));
      await settleTimeline(page);
      const rg = page.locator('[title^="Regroup"]');
      await expect(rg, 'the day split the task, so regroup is offered').toHaveCount(1);

      /* The glyph must be inside the block it acts on, so crop to the BLOCK — a control floating
         somewhere else would be just as `title`-correct and just as useless. */
      const blocks = await timelineBlocks(page);
      const host = blocks.find((b) => b.taskId === 'r-split');
      expect(host, 'and it belongs to a block that is actually drawn').toBeTruthy();
      await page.screenshot({
        path: shot(`regroup-control-${theme}`),
        clip: {
          x: Math.max(0, host.x - 6), y: Math.max(0, host.y - 6),
          width: Math.min(420, host.w + 12), height: Math.min(160, host.h + 12),
        },
      });

      /* And the whole drawer, so the control can be judged at the size it is really used at rather
         than only under a magnifying glass. */
      await page.screenshot({ path: shot(`regroup-in-context-${theme}`), fullPage: false });
    });
  }
});
