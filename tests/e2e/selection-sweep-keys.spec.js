// @ts-check
/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP): *"`j`/`k`/`space` sweep on Selection and stay inert elsewhere."*
 *
 * What already existed was only the negative half: `tests/e2e/journal-prompts.spec.js` proves these
 * letters do not fire while the caret is inside a text field. Nothing asserted that they fire at all,
 * and nothing asserted the SCOPE — which is the whole design of the feature. `j`, `k` and `space` are
 * bare, unmodified letters, deliberately claimed on one surface so they stay free everywhere else
 * (index.html: "these letters stay free everywhere the grid is not on screen"). A slip in either
 * direction is silent: claimed too widely, space stops scrolling the app; claimed too narrowly, the
 * morning sweep quietly does nothing.
 *
 * Why the e2e layer: `selectionKey` is reachable as a function, but the guard under test is the one in
 * `onKey` — a THREE-part state test (`mainView`, `dashMode`, `leftSurface`) evaluated against a real
 * keydown delivered by the browser to whatever actually holds focus. The mock DOM has no focus model,
 * so "the key reached the app on this surface and not on that one" is not expressible there.
 *
 * ── Observables ────────────────────────────────────────────────────────────────────────────────
 * The cursor itself (`state.selCursor`) is UI-only and paints nothing on a card, so it is never read
 * directly — reading component state through a back door would only prove the back door works. It is
 * observed through what `space` TICKS, which is the cursor's only user-visible consequence, recorded
 * in the app's own `pp-tasks`.
 *
 * The order is not hard-coded either. `selectionFlat` walks `selectionLayout` — column by column, then
 * the cells within it — and `renderSelectionView` paints from the same walk, so the DOM order of
 * `[data-card-id]` IS the cursor's order. Asserting against the painted order is therefore the real
 * claim ("j moves to the next card the eye sees") rather than a restatement of the bucket enum.
 */
const { test, expect } = require('@playwright/test');
const { bootPlan, boot, bootSurface, task } = require('./_seed');

/* Three tasks nobody has decided about yet: `included:null` is V2.11's "undecided", the state the
   sweep exists to clear. They must be undecided for `space` to have anything to do — a task that is
   already ticked would make every assertion here vacuously true. */
const fixture = () => ({
  tasks: [
    task('sw-a', 'Sweep alpha', { start: '0d', end: '+2d', priority: 1, included: null }),
    task('sw-b', 'Sweep bravo', { start: '0d', end: '+2d', priority: 2, included: null }),
    task('sw-c', 'Sweep charlie', { start: '0d', end: '+2d', priority: 3, included: null }),
  ],
});

/** The cards the grid paints, in painted order — which is `selectionFlat`'s order. */
const cardIds = (page) => page.$$eval('[data-card-id]', (els) =>
  els.map((el) => el.getAttribute('data-card-id')));

/** Which tasks carry an explicit "yes, today", per the app's own store. `tickOnToday` writes both
 *  `included:true` and `includedExplicit:true`; reading the explicit flag is what separates a press
 *  from inheritance, so a task that merely became eligible cannot be mistaken for a ticked one. */
const ticked = (page) => page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('pp-tasks') || '[]')
      .filter((t) => t.includedExplicit === true).map((t) => t.id).sort();
  } catch (e) { return ['UNPARSEABLE']; }
});

/** Boot the grid and confirm the fixture actually reached it before any key is pressed. */
async function bootSweep(page) {
  await bootPlan(page, 'select', fixture());
  await expect.poll(() => cardIds(page), { message: 'all three undecided tasks are on the grid' })
    .toHaveLength(3);
  expect(await ticked(page), 'and none of them starts out ticked').toEqual([]);
}

test.describe('the j/k/space sweep, on the Selection grid', () => {
  test('j moves the cursor down the painted order and space ticks the card it is on', async ({ page }) => {
    await bootSweep(page);
    const order = await cardIds(page);

    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect.poll(() => ticked(page), { message: 'the first press lands on the first card' })
      .toEqual([order[0]]);

    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect.poll(() => ticked(page), { message: 'and j advances to the next one' })
      .toEqual([order[0], order[1]].sort());
  });

  test('k walks the cursor back up, and space on an already-ticked card adds nothing new', async ({ page }) => {
    await bootSweep(page);
    const order = await cardIds(page);

    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect.poll(() => ticked(page)).toEqual([order[1]]);

    await page.keyboard.press('k');
    await page.keyboard.press(' ');
    await expect.poll(() => ticked(page), { message: 'k stepped back onto the first card' })
      .toEqual([order[0], order[1]].sort());

    /* Space TICKS and deliberately does not untick (index.html: "a keyboard sweep that opened a menu on
       every other press would not be a sweep"). Pressing it twice on the same card is therefore a
       no-op, not a toggle — the assertion that would go red if space were ever made symmetric. */
    await page.keyboard.press(' ');
    await expect.poll(() => ticked(page), { message: 'a second space on the same card does not untick it' })
      .toEqual([order[0], order[1]].sort());
  });

  test('space before the cursor has moved anywhere ticks nothing', async ({ page }) => {
    await bootSweep(page);
    /* `selectionKey` returns early while `selCursor` is null. Without this, "space ticks the card the
       cursor is on" could be satisfied by a space that simply ticked the first card unconditionally,
       and the two tests above would not tell the difference. */
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await ticked(page), 'there is no card under the cursor yet').toEqual([]);
  });
});

test.describe('and they stay inert everywhere else', () => {
  test('on Overview\'s task-list surface, one pane away, the same keys do nothing', async ({ page }) => {
    /* The tightest negative available: same view, same dashboard mode, ONE differing piece of state
       (`leftSurface`). A guard that had dropped its surface clause would still pass a test that
       switched views wholesale, and would fail here. */
    await bootPlan(page, 'select', fixture());
    await expect.poll(() => cardIds(page)).toHaveLength(3);
    await page.locator('[data-surface-btn="list"]').click();
    await expect(page.locator('[data-sheet-pane]'), 'the left pane is the sheet now').toHaveCount(1);

    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await ticked(page), 'the sweep keys are not claimed on the list surface').toEqual([]);
  });

  test('on the task sheet the same keys do nothing', async ({ page }) => {
    await boot(page, fixture());
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await ticked(page), 'nothing was swept from the sheet').toEqual([]);
  });

  test('on Today the same keys do nothing', async ({ page }) => {
    await bootSurface(page, { view: 'today' }, fixture());
    await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await ticked(page), 'nothing was swept from Today').toEqual([]);
  });
});
