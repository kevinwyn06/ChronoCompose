/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "Gesture pass owner user-check"): *"On the Gantt, confirm a single click
 * on a bar opens details, that this does not fire after a real drag … and that right-click still opens
 * the bar menu."*
 *
 * `gestures.spec.js` proves the click-vs-drag threshold on a SHEET ROW. The Gantt bar is a different
 * mousedown path entirely — `startBarDrag`, which owns the date-editing drags — so nothing in the
 * suite covered the same disambiguation there.
 *
 * Bars are addressed by their `data-gantt-tip` prefix — the drawn tooltip's machine-readable twin, which
 * starts with the task name. UI revamp block 7 retired the bar's native `title` (it doubled the drawn
 * tooltip) and brought name labels back (`[data-gantt-label]`); `gantt-labels.spec.js` pins that contract.
 *
 * Real pointer input throughout: the threshold under test is a property of hit-testing and pointer
 * capture, and a dispatched MouseEvent would skip both.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  tasks: [
    task('g-long', 'Ship the release', { start: '-2d', end: '+6d', priority: 1, planned: 300 }),
    task('g-other', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
  ],
});

const detail = (page) => page.getByRole('button', { name: 'Previous task' });

async function bootGantt(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR).first().waitFor({ state: 'visible', timeout: 15000 });
}

/* `ganttBlock` tags the bar body `data-gantt-tip="<name> · <start> → <end> · <planned>"`. */
const BAR = '[data-gantt-tip^="Ship the release ·"]';

/** The centre of the bar body — away from its edge handles, which own a different drag mode. */
async function barCentre(page) {
  const box = await page.locator(BAR).first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Gantt bar: click vs drag vs right-click', () => {
  test('a click on a bar opens details', async ({ page }) => {
    await bootGantt(page);
    const p = await barCentre(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 2, p.y + 1); /* under the threshold on both axes */
    await page.mouse.up();
    await expect(detail(page), 'a bar is clickable for details, not only draggable').toBeVisible();
  });

  test('a real drag along the bar does NOT also open details', async ({ page }) => {
    await bootGantt(page);
    const p = await barCentre(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    /* Sideways, which is what a move-drag on a Gantt bar is: it re-dates the task. */
    await page.mouse.move(p.x + 120, p.y, { steps: 12 });
    await page.mouse.up();
    await expect(detail(page), 'a completed drag is not a click').toHaveCount(0);
  });

  /* FIXED, 2026-08-12 — this file's FINDING note is now the fix's regression test. `startBarDrag`
   * (index.html) was bound to `onMouseDown` with no `e.button` guard, so a right press began a bar drag
   * and the zero-distance release was read as a click, opening the DETAIL PANEL and losing
   * `openBarMenu`'s state. It now returns on any non-primary button — which also stops it swallowing
   * the press through `preventDefault`, the reason the context menu never arrived. */
  test('a right-click on a bar opens the bar menu, not the detail panel', async ({ page }) => {
    await bootGantt(page);
    const p = await barCentre(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    /* 'Clear start date' is unique to the BAR menu — the row menu and the detail panel have no such
       entry — so it separates the two outcomes rather than merely proving something opened.
       (UI revamp block 6 renamed it from the jargon 'Clear start → ghost'; the bar menu is role=menu.) */
    await expect(page.locator('[data-pp-menu="bar"]').getByText('Clear start date')).toBeVisible();
    await expect(detail(page), 'a right-press is not a click on the bar').toHaveCount(0);
  });
});
