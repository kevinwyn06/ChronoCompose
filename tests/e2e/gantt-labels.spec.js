/* V5 block 27b — A GANTT BAR CARRIES ITS TASK'S NAME.
 *
 * Owner, verbatim: *"Things like gantt will no longer sync by row and should be given tasks labels."*
 * Ruling for this block: build (A) — bars carry their task's NAME. (B), grouping rows by `@tag`, is a
 * different change and is not built here.
 *
 * The defect: on a triage surface a Gantt bar was ANONYMOUS. Its only identification was a `title`
 * tooltip, so you had to hover a bar — or trust that its row still lined up with the sheet row beside
 * it — to know which task it was.
 *
 * So the assertions here are deliberately narrow about what counts as evidence:
 *   • the name must be READ FROM RENDERED TEXT (`innerText` of a `[data-ganttname]` node). A check
 *     that reads `title` would pass against today's code and would prove nothing;
 *   • no hover anywhere in this file. The mouse is parked in a corner before every read, and the
 *     labels are asserted VISIBLE and non-transparent at rest;
 *   • identification must not come from row position: the assertion is that the name found INSIDE the
 *     bar's own box is the right one, which is exactly what a bar/row mismatch would break.
 *
 * Narrow bars are the honest half. A short task makes a short bar, and a name that silently vanishes
 * there is the same defect wearing a different hat. Zoomed out to `GANTT_DAYW_MIN` every dated bar
 * floors at `BAR_MIN_PX` (24px), far under the inside-label threshold — this file asserts the names
 * are all still on screen at that zoom, positioned to the RIGHT of their bars rather than dropped.
 * That zoom is reached by the real Ctrl+scroll gesture, not by seeding a pref: `dayW` lives in
 * component state and is not restored from `pp-prefs`.
 *
 * Screenshots land in `.orchestration/shots/` for both themes.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `${name}.png`);

/* A long bar (wide enough to letter inside), a one-day bar (narrow), a milestone (never wide enough),
   and a dateless task (a double ghost, whose fill fades out). One of each labelling path. */
const NAMES = {
  long: 'Ship the release',
  short: 'Renew passport',
  ms: 'Launch day',
  ghost: 'Someday reading',
};
const fixture = (theme) => ({
  theme,
  tasks: [
    task('g-long', NAMES.long, { start: '-2d', end: '+6d', priority: 1, planned: 300 }),
    task('g-short', NAMES.short, { start: '+1d', end: '+1d', priority: 3, planned: 45 }),
    task('g-ms', NAMES.ms, { start: '+3d', end: '+3d', type: 'Milestone', planned: 0 }),
    task('g-ghost', NAMES.ghost, { priority: 4, planned: 60 }),
  ],
});

/** Park the pointer far from every bar, so nothing under test is hover-gated open. */
async function unhover(page) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(60);
}

/** Every rendered name label in the Gantt: its text, its box, and whether it is actually painted. */
async function labels(page) {
  return page.$$eval('[data-ganttname]', (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      id: el.getAttribute('data-ganttname'),
      text: (el.innerText || el.textContent || '').trim(),
      x: r.x, y: r.y, w: r.width, h: r.height,
      opacity: parseFloat(cs.opacity),
      visibility: cs.visibility,
      display: cs.display,
      color: cs.color,
      overflow: cs.textOverflow,
      /* scrollWidth > clientWidth means the text is ellipsised rather than fully shown — that is a
         legitimate outcome for a narrow bar, but "clipped to nothing" is not. */
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    };
  }));
}

/** The bar boxes, keyed by task id, so a label can be located relative to its own bar. */
async function bars(page) {
  return page.$$eval('[data-ganttname]', (els) => els.map((el) => {
    /* Walk up to the positioned bar wrapper that owns this label. */
    let n = el.parentElement, box = null;
    while (n && !box) {
      if (n.style && n.style.position === 'absolute' && n.style.width && n.style.height) box = n;
      n = n.parentElement;
    }
    const r = (box || el).getBoundingClientRect();
    return { id: el.getAttribute('data-ganttname'), x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}

/* Gantt zoom is `state.dayW`, and it is NOT restored from `pp-prefs` — seeding `prefs.dayW` is silently
   a no-op (that is exactly what an earlier draft of this file did, which left "month zoom" running at the
   default 42px/day). The only way in is the real gesture the app ships: Ctrl+scroll over the chart
   (`onWheelZoom`, which bails unless ctrlKey/metaKey). So zoom out with `page.mouse.wheel` under a real
   held Control — a dispatched WheelEvent would not be evidence. Each notch is capped at
   GANTT_ZOOM_STEP_CAP (~20%), and dayW clamps at GANTT_DAYW_MIN = 3px/day, so this many notches lands on
   the floor from any starting zoom. */
const ZOOM_OUT_NOTCHES = 24;
async function zoomOutToMonth(page) {
  const box = await page.locator('[data-gantt-task-id]').first().boundingBox();
  await page.mouse.move(box.x + 40, box.y + Math.min(8, box.height / 2));
  await page.keyboard.down('Control');
  for (let i = 0; i < ZOOM_OUT_NOTCHES; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(20);
  }
  await page.keyboard.up('Control');
  /* onWheelZoom coalesces into one rAF setState + scroll pin per frame; let the last one land. */
  await page.waitForTimeout(200);
}

async function bootGantt(page, theme, zoom) {
  await bootSurface(page, { view: 'gantt' }, fixture(theme));
  await page.locator('[data-ganttname]').first().waitFor({ state: 'attached', timeout: 15000 });
  if (zoom === 'month') await zoomOutToMonth(page);
  await unhover(page);
}

test.describe('V5.27b — Gantt bars are identifiable without a hover', () => {
  test('every bar renders its task name as visible text, no hover involved', async ({ page }) => {
    await bootGantt(page, 'dark');
    const ls = await labels(page);
    const byName = Object.fromEntries(ls.map((l) => [l.text, l]));

    for (const want of Object.values(NAMES)) {
      const l = byName[want];
      expect(l, `"${want}" is rendered as text on the Gantt, not only in a tooltip`).toBeTruthy();
      expect(l.visibility, `"${want}" is painted`).toBe('visible');
      expect(l.opacity, `"${want}" is not transparent at rest`).toBeGreaterThan(0.9);
      expect(l.w, `"${want}" has real width on screen`).toBeGreaterThan(8);
      expect(l.h, `"${want}" has real height on screen`).toBeGreaterThan(6);
    }

    /* The tooltip must NOT be the thing carrying the identity. Prove the text survives with the
       pointer nowhere near — this is the whole point of the block. */
    await unhover(page);
    const again = await labels(page);
    expect(again.map((l) => l.text).sort()).toEqual(ls.map((l) => l.text).sort());
  });

  test('the name is inside the bar it belongs to — identification does not come from the row', async ({ page }) => {
    await bootGantt(page, 'dark');
    const ls = await labels(page);
    const bs = await bars(page);
    const long = ls.find((l) => l.text === NAMES.long);
    const longBar = bs.find((b) => b.id === long.id);

    /* A wide, solid bar letters INSIDE itself: the label box sits within the bar's own box. If bars
       and names ever desynchronised, this is what would break — the name would be over some other
       bar's pixels, or outside every bar. */
    expect(longBar.w, 'the long task draws a wide bar at this zoom').toBeGreaterThan(200);
    expect(long.x).toBeGreaterThanOrEqual(longBar.x - 1);
    expect(long.x + long.w).toBeLessThanOrEqual(longBar.x + longBar.w + 1);
    expect(long.y).toBeGreaterThanOrEqual(longBar.y - 1);
    expect(long.y + long.h).toBeLessThanOrEqual(longBar.y + longBar.h + 1);

    /* Each name belongs to exactly one bar: no two labels claim the same task, and every label's task
       is one of the seeded ones. */
    const ids = ls.map((l) => l.id);
    expect(new Set(ids).size, 'no task is labelled twice').toBe(ids.length);
    /* And the mapping is right, not merely one-to-one: the label on the long task's bar says the long
       task's name. */
    expect(long.id).toBe('g-long');
    expect(ls.find((l) => l.id === 'g-short').text).toBe(NAMES.short);
    expect(ls.find((l) => l.id === 'g-ms').text).toBe(NAMES.ms);
  });

  test('at month zoom every bar is a sliver and NOT ONE name disappears', async ({ page }) => {
    /* Ctrl+scroll all the way out to GANTT_DAYW_MIN (3px/day). Every DATED bar there floors at
       BAR_MIN_PX (24px) and the milestone is barH (20px) wide — far below GANTT_LABEL_MIN_PX (56px),
       so none of them can letter inside. The honest answer for a narrow bar is "the name moves beside
       it", and this asserts that rather than accepting silence. */
    await bootGantt(page, 'dark', 'month');
    const ls = await labels(page);
    const bs = await bars(page);
    expect(ls.length, 'all four tasks are still named at month zoom').toBe(4);

    /* Premise check, so this test cannot quietly pass by never having zoomed: the three dated bars
       really are slivers here. The dateless GHOST is deliberately not in this list — ghostDrawSpan
       floors its DRAWING at GHOST_VIEW_FRAC of the visible chart, which is a constant pixel width at
       every zoom, so a ghost is never a sliver. It still takes the outside label, for a different and
       stated reason: its fill dissolves, so --on-accent text on it would not be legible. Both paths
       are asserted below; only the width premise is narrowed. */
    for (const id of ['g-long', 'g-short', 'g-ms']) {
      const b = bs.find((x) => x.id === id);
      expect(b.w, `${id} is a sliver at month zoom, so it cannot letter inside`).toBeLessThan(56);
    }

    for (const l of ls) {
      const b = bs.find((x) => x.id === l.id);
      expect(l.visibility, `${l.text} still painted`).toBe('visible');
      expect(l.opacity, `${l.text} still opaque`).toBeGreaterThan(0.9);
      expect(l.w, `${l.text} still has width`).toBeGreaterThan(8);
      /* It moved OUTSIDE: the label starts at or past the bar's right edge. */
      expect(l.x, `${l.text} labels beside its narrow bar, not on top of it`)
        .toBeGreaterThanOrEqual(b.x + b.w - 1);
      /* Truncation, if any, is an ellipsis — never a clip to nothing. */
      expect(l.overflow).toBe('ellipsis');
    }
    /* Full names, not stubs: at this zoom there is room to the right, so nothing is even ellipsised. */
    const texts = ls.map((l) => l.text).sort();
    expect(texts).toEqual(Object.values(NAMES).sort());
  });

  test('the names are legible in both themes, and the screenshots say so', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await bootGantt(page, theme);
      const ls = await labels(page);
      expect(ls.length, `${theme}: all four names present`).toBe(4);
      for (const l of ls) {
        const a = parseFloat((l.color.match(/[\d.]+/g) || [])[3] ?? '1');
        expect(a, `${theme}: "${l.text}" is not drawn fully transparent`).toBeGreaterThan(0.5);
      }
      await page.screenshot({ path: shot(`27b-gantt-labels-${theme}`), fullPage: false });
    }
  });
});
