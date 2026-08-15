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
const PCT = '[title^="% done:"]';

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
    await expect(page.getByText('% DONE'), 'the popover is still reachable by clicking').toBeVisible();
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
