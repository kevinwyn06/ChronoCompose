/* ACCEPTANCE → AUTOMATION.
 *
 * Owner report: *"percent-complete cannot be set from the Gantt bar — the app reads the gesture as a
 * bar drag."*
 *
 * The %-done control lives UNDER the bar (PR #83 moved it out of the fill), as an upward caret inside a
 * transparent hit box. This file pins the disambiguation that report is about, in both directions:
 *
 *   - a horizontal drag ON the caret sets `pct` and must NOT re-date the task;
 *   - a horizontal drag on the BAR BODY re-dates the task and must NOT touch `pct`.
 *
 * Real pointer input throughout. A dispatched MouseEvent skips hit-testing and pointer capture, which
 * is precisely the mechanism that was failing here, so it would prove nothing.
 *
 * `pct` and the dates are read back out of `pp-tasks` — the persisted store, not a render — so a fix
 * that only paints a preview cannot pass.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  tasks: [
    task('g-long', 'Ship the release', { start: '-2d', end: '+6d', priority: 1, planned: 300, pct: 0 }),
    task('g-other', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
  ],
});

/* `ganttBlock` titles the bar body `"<name> · <n>d · click for details"`; the %-done hit box carries
   its own `% done:` title. Both are the only per-node identity the DOM offers here (PR #102 removed
   the bar label), which `gantt-gestures.spec.js` documents at length. */
const BAR = '[title^="Ship the release ·"]';
/* Both %-done targets carry this title — the on-bar band and the caret below the bar both start the same
   `startPctDrag`. `GRAB` picks out the band specifically. */
const PCT = '[title^="% done:"]';
const GRAB = '[data-pct-grab]';

async function bootGantt(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR).first().waitFor({ state: 'visible', timeout: 15000 });
}

/** The stored task, straight out of `pp-tasks`. */
async function stored(page, id) {
  return page.evaluate((tid) => {
    const raw = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
    return raw.find((t) => t.id === tid) || null;
  }, id);
}

/** Viewport-space box of the bar body. */
async function barBox(page) {
  const b = await page.locator(BAR).first().boundingBox();
  if (!b) throw new Error('bar has no box');
  return b;
}

/**
 * Reveal the hover-gated %-done control and return its centre.
 * The caret is `pointerEvents:none` at rest, by design — it must never steal a bar drag from a resting
 * pointer — so the hover that reveals it is part of the gesture under test, not a workaround.
 */
async function pctCentre(page) {
  const b = await barBox(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const box = await page.locator(PCT).first().boundingBox();
  if (!box) throw new Error('the %-done control has no box while the bar is hovered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test.describe('Gantt %-done control vs bar drag', () => {
  test('the %-done hit box is a real target, not a sliver', async ({ page }) => {
    await bootGantt(page);
    await pctCentre(page);
    /* The board sits in a `zoom:0.8` wrapper, so `boundingBox()` is 0.8× the app's own px. Compare
       LOCAL px against the local constant: read offsetWidth/offsetHeight. */
    const local = await page.locator(PCT).first().evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
    expect(local.w, 'HIT_MIN_PX wide').toBeGreaterThanOrEqual(24);
    expect(local.h, 'and at least half that tall — glyph is not the hit box').toBeGreaterThanOrEqual(12);
  });

  test('dragging the %-done control sets pct and leaves the dates alone', async ({ page }) => {
    await bootGantt(page);
    const before = await stored(page, 'g-long');
    const b = await barBox(page);
    const p = await pctCentre(page);

    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    /* Well past the 4px promotion threshold, stepped so every intermediate move is exercised. */
    await page.mouse.move(b.x + b.width * 0.6, p.y, { steps: 12 });
    await page.mouse.up();

    const after = await stored(page, 'g-long');
    expect(after.pct, 'the drag set a percentage').toBeGreaterThan(0);
    expect(after.pct).toBeLessThanOrEqual(100);
    expect(after.start, 'a %-done drag must not re-date the task').toBe(before.start);
    expect(after.end, 'a %-done drag must not re-date the task').toBe(before.end);
  });

  /* The fix moved the popover from a competing `onClick` on the caret into the shared `onMouseUp`, so
     that press and release are resolved by ONE rule. The under-threshold press therefore has to be
     pinned here, or the drag gesture could silently cost the control its type-a-number path. */
  test('a click (no drag) on the %-done control still opens the type-a-number popover', async ({ page }) => {
    await bootGantt(page);
    const p = await pctCentre(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 2, p.y + 1); /* under the 4px threshold on both axes */
    await page.mouse.up();
    await expect(page.getByText('% DONE', { exact: true }), 'the popover is still reachable by clicking').toBeVisible();
  });

  /* ------------------------------------------------------------------------------------------------
   * Owner, 2026-08-15. The caret tests above PASS and always have — the gesture worked. The owner still
   * could not use it: *"I'm still unable to drag the %-done caret. I would actually prefer to click and
   * click drag directly on the bar, but I realize the latter conflicts with date dragging."*
   * A 24×16 box that is invisible until hover, hanging in the 10px gap below the bar, is not findable.
   * The primary target is now a band ON the bar, centred on the fill edge, shifted clear of both resize
   * grips. These tests are the ones that speak to the report; the caret keeps its coverage as a fallback.
   * ------------------------------------------------------------------------------------------------ */

  test('the %-done band is on the bar and needs no hover to be hit-testable', async ({ page }) => {
    await bootGantt(page);
    const bar = await barBox(page);
    /* Park the pointer far away: the band must exist and take pointer events at REST, which is the whole
       difference from the caret. */
    await page.mouse.move(2, 2);
    const band = await page.locator(GRAB).first().boundingBox();
    if (!band) throw new Error('the %-done band has no box while the pointer is elsewhere');
    /* Vertically inside the bar, not below it. */
    expect(band.y).toBeGreaterThanOrEqual(bar.y - 1);
    expect(band.y + band.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    const pe = await page.locator(GRAB).first().evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pe, 'always hit-testable, unlike the hover-gated caret').toBe('auto');
  });

  test('dragging the band on the bar sets pct and leaves the dates alone', async ({ page }) => {
    await bootGantt(page);
    const before = await stored(page, 'g-long');
    const bar = await barBox(page);
    const band = await page.locator(GRAB).first().boundingBox();
    if (!band) throw new Error('no band');

    await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.6, band.y + band.height / 2, { steps: 12 });
    await page.mouse.up();

    const after = await stored(page, 'g-long');
    expect(after.pct, 'the on-bar drag set a percentage').toBeGreaterThan(0);
    expect(after.start, 'and must not re-date the task').toBe(before.start);
    expect(after.end, 'and must not re-date the task').toBe(before.end);
  });

  /* The owner's one hard constraint: "make sure 0% and 100% have no drag range overlap with the edges of
     the bar for date dragging." At 0% the fill edge sits on the left grip, so an unclamped band would
     swallow it and make the bar unresizable at the most common percentage there is. */
  test('at 0% the band clears the left resize grip, so the edge still re-dates', async ({ page }) => {
    await bootGantt(page);
    const before = await stored(page, 'g-long');
    expect(before.pct || 0, 'fixture starts at 0%').toBe(0);

    const bar = await barBox(page);
    const band = await page.locator(GRAB).first().boundingBox();
    if (!band) throw new Error('no band');
    expect(band.x, 'the band starts clear of the left grip').toBeGreaterThan(bar.x);

    /* Grab the extreme left edge — the grip — and drag. That must move the START date, not the pct. */
    await page.mouse.move(bar.x + 2, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 2 + 90, bar.y + bar.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await stored(page, 'g-long');
    expect(after.start, 'the left grip still resizes at 0%').not.toBe(before.start);
    expect(after.pct || 0, 'and the band did not steal the gesture').toBe(0);
  });

  test('the in-bar readout reports the percentage and sits inside the bar', async ({ page }) => {
    await bootGantt(page);
    const bar = await barBox(page);
    const band = await page.locator(GRAB).first().boundingBox();
    if (!band) throw new Error('no band');

    await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.5, band.y + band.height / 2, { steps: 10 });
    await page.mouse.up();

    const lbl = page.locator('[data-pct-label]').first();
    await expect(lbl, 'the readout renders once a percentage exists').toBeVisible();
    const box = await lbl.boundingBox();
    if (!box) throw new Error('readout has no box');
    expect(box.x, 'inside the bar, not beside it').toBeGreaterThanOrEqual(bar.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
    const stored2 = await stored(page, 'g-long');
    await expect(lbl).toHaveText(stored2.pct + '%');
  });

  test('dragging the bar body re-dates the task and leaves pct alone', async ({ page }) => {
    await bootGantt(page);
    const before = await stored(page, 'g-long');
    const b = await barBox(page);

    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();

    const after = await stored(page, 'g-long');
    expect(after.start, 'a body drag re-dates').not.toBe(before.start);
    expect(after.end, 'a body drag re-dates').not.toBe(before.end);
    expect(after.pct, 'a body drag must not touch the percentage').toBe(before.pct || 0);
  });
});
