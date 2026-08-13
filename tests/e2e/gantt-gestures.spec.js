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
 * Bars are addressed by their `title` prefix. That is deliberate and not laziness: PR #102 REMOVED the
 * `[data-ganttname]` label node (bars no longer letter their task's name), so the tooltip is once again
 * the only per-bar identity the DOM carries. `gantt-labels.spec.js` on `dev` asserts exactly that
 * absence, so a future re-introduction of an in-bar label would be a deliberate change made in both
 * files rather than a silent drift.
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

/* `ganttBlock` titles the bar body `"<name> · <n>d · click for details"`. */
const BAR = '[title^="Ship the release ·"]';

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

  /* FINDING, 2026-08-12 — the third gesture in this owner item, *"right-click still opens the bar
   * menu"*, does NOT hold under a trusted right-click. A real right-press on a bar opens the DETAIL
   * PANEL instead: `startBarDrag` (index.html ~4180) is bound to `onMouseDown` with no `e.button`
   * guard, so the right press begins a bar drag and the release is taken as a click, while
   * `openBarMenu`'s state is lost. The bar-menu assertion is therefore not committed red — the e2e
   * suite's "no test.fail() markers" invariant means a red run must always be a regression. The fix
   * is a one-line button guard in `index.html`, which this lane may not edit; it is reported instead.
   */
});
