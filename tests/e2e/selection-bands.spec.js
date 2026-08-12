/* Chain 4 / block 24a — the Selection view's per-column band sizing (F16).
 *
 * Why this belongs in the e2e layer and not the unit layer: the band balance is resolved by the
 * FLEXBOX ENGINE. `selectionSplitHeights` predicts it, but the browser is the authority — if the flex
 * triple in `selectionHalfFlex` were mis-emitted the unit tests would still pass and the surface would
 * still be lopsided. So this measures real scroll in a real Chromium.
 *
 * Block 30a removed the quick-swap control this file used to also cover, at the owner's direction, and
 * the file was renamed from `selection-swap.spec.js` to match what is left.
 */
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { bootPlan, task } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
const shot = (name) => path.join(SHOTS, name);

/* --- band sizing, measured in the engine that actually resolves it ------------------------------ */

/* Seven included and three excluded IN THE SAME COLUMN. All ten share one window that has not opened
   yet, so origin is `extra` for every one of them and the split under test is a single column's. */
function lopsided() {
  const tasks = [];
  for (let i = 0; i < 7; i++) tasks.push(task('in-' + i, 'Included item ' + (i + 1),
    { start: '+2d', end: '+4d', included: true, planned: 60 }));
  for (let i = 0; i < 3; i++) tasks.push(task('ex-' + i, 'Excluded item ' + (i + 1),
    { start: '+2d', end: '+4d', included: null, planned: 60 }));
  return tasks;
}

/* Max scroll of a half's scrolling cell: how far the user must scroll to see its last card. */
const maxScroll = (page, sel) =>
  page.locator(sel).evaluate(el => Math.max(0, el.scrollHeight - el.clientHeight));

test.describe('Selection: per-column band sizing', () => {
  test('an unbalanced column gives its two halves comparable max scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 620 });
    await bootPlan(page, 'select', { tasks: lopsided() });

    /* Derive the column from where the fixture actually landed rather than assuming `extra`: origin is
       a derivation, and a later block that changes it must not silently make this spec measure an
       empty column instead of failing. */
    const col = await page.locator('[data-card-id="in-0"]').evaluate(
      el => el.closest('[data-selcell]').getAttribute('data-selcell').replace('-included', ''));

    const si = await maxScroll(page, `[data-selcell="${col}-included"]`);
    const se = await maxScroll(page, `[data-selcell="${col}-excluded"]`);

    /* The point of the block. Before, both halves were flex:1 whatever they held: Included needed a
       long scroll and Excluded showed whitespace. Now the deficit is shared.
       "Roughly" is the owner's word, so this asserts an ORDER, not a ratio: neither half may need more
       than ~2.5x the other's scroll, and Included must no longer be the only one scrolling. */
    expect(si).toBeGreaterThan(0);
    const bigger = Math.max(si, se), smaller = Math.min(si, se);
    expect(bigger).toBeLessThanOrEqual(smaller * 2.5 + 40);
  });

  test('the divider is PER COLUMN, and Excluded is never collapsed away', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 620 });
    /* One busy column and one quiet one: `overdue` (past-due) against `extra` (a future window). */
    await bootPlan(page, 'select', {
      tasks: [
        ...[0, 1, 2, 3, 4].map(i => task('od-' + i, 'Overdue item ' + (i + 1),
          { start: '-4d', end: '-2d', included: true, planned: 60 })),
        task('xt-0', 'Extra item', { start: '+2d', end: '+4d', included: true, planned: 60 }),
      ],
    });

    const halves = page.locator('[data-selhalf$="-included"]');
    await expect(halves).toHaveCount(await halves.count()); // settle
    const boxes = await halves.evaluateAll(els => els.map(el => ({
      k: el.getAttribute('data-selhalf'), h: el.getBoundingClientRect().height,
    })));
    expect(boxes.length).toBeGreaterThan(1);
    /* If one divider ran straight across the surface, every column's Included half would be the same
       height. A per-column divider means a busy column keeps more of its own space. */
    const heights = boxes.map(b => Math.round(b.h));
    expect(new Set(heights).size).toBeGreaterThan(1);

    /* And the owner's override: Excluded is never collapsed, even when it holds nothing. */
    const exBoxes = await page.locator('[data-selhalf$="-excluded"]')
      .evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    exBoxes.forEach(h => expect(h).toBeGreaterThan(40));
  });
});

/* --- shots: the owner judges this surface by looking ------------------------------------------- */

for (const theme of ['light', 'dark']) {
  test(`SHOT: Selection with an unbalanced split (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await bootPlan(page, 'select', { theme, tasks: lopsided() });
    await expect(page.locator('[data-selhalf$="-excluded"]').first()).toBeVisible();
    await page.screenshot({ path: shot(`24-selection-${theme}.png`) });
  });
}
