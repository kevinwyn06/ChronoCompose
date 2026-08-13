/* Owner report, 2026-08-13: *"In the Overview page, there are instances where say I'll have 12 included
 * tasks in a column. I won't be able to even see the excluded tasks at all. I should always be able to see
 * both included and excluded, and they should be given about the same amount of scroll."*
 *
 * WHY THIS SPEC EXISTS, given `tests/v5-selection-ux.test.js` already covers band sizing: because that
 * file was green through the entire life of the bug. It asserts `selectionSplitHeights`, a pure function
 * that resolves the split arithmetic in JS — and that function applied its floor correctly the whole time.
 * But it is only a MIRROR of the layout. What renders is flexbox, and the `half` renderer carried
 * `minHeight:0`, which both omitted the floor and disabled flexbox's own automatic min-content floor. The
 * mirror said 72px; the browser drew 0.
 *
 * That is this repo's most expensive recurring failure shape (`tasksByTagSection`, the two `_yTop` call
 * sites): a pure function asserted in isolation proves nothing about the surface unless something asserts
 * the surface consumes it. And the layer mattered — putting the floor in exposed a SECOND defect that no
 * amount of JS mirroring could have surfaced, because it lives in the flex algorithm itself: freezing the
 * Excluded half on its min-height left Included as the only unfrozen item, and its flex-shrink was below
 * 1, so CSS §9.7's "sum less than one" clamp let it shrink by 8% of the deficit and overflow its column by
 * 400px. Both halves' shrink factors are now normalised above 1. See `selectionHalfFlex`.
 */
const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The owner's fixture: a column heavily lopsided toward Included. Every task shares one start/end so they
   all land in the same origin column, which is what produces the 12-vs-1 split being complained about —
   spreading them across columns would quietly make the bug unreproducible. */
const lopsided = () => {
  const t = [];
  for (let i = 0; i < 12; i++) t.push(task('in-' + i, 'Included ' + i, { start: '0d', end: '+2d', included: true }));
  t.push(task('out-1', 'Excluded one', { start: '0d', end: '+2d', included: null, snoozeUntil: '+1d' }));
  return t;
};

/* Address the half by its COLUMN, never with `.first()`. These tasks all start today, so they land in the
   `new` origin column — and the empty `existing` column renders first, so `.first()` measures a column
   with nothing in it and reports a perfectly healthy 50/50 split. That is the same mistake as the bug
   under test: measuring something adjacent to what you care about and believing the number. */
const COL = 'new';

/* offsetHeight, NOT boundingBox(). The board renders inside a `zoom:0.8` wrapper, so a client rect is
   0.8× the CSS pixels the constants are written in — the trap the V1.3 `uiPt` pass was created for.
   Comparing a rect against SEL_HALF_MIN_PX would be comparing two different units. */
const geom = page => page.evaluate(col => {
  const q = s => document.querySelector(s);
  const inc = q(`[data-selhalf="${col}-included"]`), exc = q(`[data-selhalf="${col}-excluded"]`);
  if (!inc || !exc) return null;
  const column = inc.parentElement;
  return { inc: inc.offsetHeight, exc: exc.offsetHeight, col: column.offsetHeight,
    colScroll: column.scrollHeight,
    excScroll: exc.querySelector('[data-selcell]') ? exc.querySelector('[data-selcell]').scrollHeight : 0 };
}, COL);

const CARD = 94;   // SEL_CARD_EST_PX
const FLOOR = 112; // SEL_HALF_MIN_PX = card + band label

test.describe('Selection: the Excluded half is always visible', () => {
  test('12 included against 1 excluded — Excluded keeps a whole card of height', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: lopsided() });
    const g = await geom(page);
    expect(g, 'the column renders').not.toBeNull();

    /* THE assertion the owner's report reduces to. Before the fix this measured 0. */
    expect(g.exc, 'the Excluded half must not collapse to nothing').toBeGreaterThan(0);
    expect(g.exc, 'and a whole card must fit, or "you can see it" is a technicality')
      .toBeGreaterThanOrEqual(FLOOR);

    /* Included must not have been starved to pay for it — the fix is a floor, not a swap. */
    expect(g.inc, 'Included still owns the majority of a 12-vs-1 column').toBeGreaterThan(g.exc);
  });

  test('and the column does not overflow — the floor must not disable the shrink', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: lopsided() });
    const g = await geom(page);
    /* The second defect, and the one only a real layout engine could show: with a sub-1 flex-shrink the
       Included half ignored the deficit and ran 400px past the column. */
    expect(g.colScroll, 'the column\'s content fits the column it is drawn in')
      .toBeLessThanOrEqual(g.col + 1);
    expect(g.inc + g.exc, 'both halves together fit inside the column, header included')
      .toBeLessThanOrEqual(g.col);
  });

  test('the excluded card is really drawn in that space, not just a sized empty box', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: lopsided() });
    const card = page.locator(`[data-selcell="${COL}-excluded"] [data-card-id]`).filter({ hasText: 'Excluded one' });
    await expect(card, 'the excluded task is in the excluded cell').toHaveCount(1);
    await expect(card, 'and is actually visible to the user').toBeVisible();

    /* A card inside a zero-height scroll container is still "in the DOM" and still passes a count check —
       which is exactly how this bug hid. Assert it is within the band's visible box. */
    /* Compare two client rects rather than offsetTop (which is relative to the offset PARENT, not the
       cell). Rects are both scaled by the same `zoom`, so a containment comparison between them is
       unit-safe even though their absolute numbers are not CSS pixels. */
    const within = await card.evaluate((el, col) => {
      const cell = document.querySelector(`[data-selcell="${col}-excluded"]`);
      const c = el.getBoundingClientRect(), z = cell.getBoundingClientRect();
      return { cardTop: c.top, cardH: c.height, bandTop: z.top, bandBottom: z.bottom };
    }, COL);
    expect(within.cardH, 'the card has real height').toBeGreaterThan(0);
    expect(within.cardTop, 'the card starts at or below the top of the visible band')
      .toBeGreaterThanOrEqual(within.bandTop - 1);
    expect(within.cardTop, 'and starts above the bottom of it — not scrolled out of a collapsed box')
      .toBeLessThan(within.bandBottom);
  });

  test('a balanced column still splits by content, so the floor did not replace the balance', async ({ page }) => {
    /* 6 included, 5 excluded: the floor should not bite at all here, and the halves should come out
       close in height. This is the guard against "fixing" the collapse by pinning a fixed split. */
    const t = [];
    for (let i = 0; i < 6; i++) t.push(task('bi-' + i, 'In ' + i, { start: '0d', end: '+2d', included: true }));
    for (let i = 0; i < 5; i++) t.push(task('bo-' + i, 'Out ' + i, { start: '0d', end: '+2d', included: null, snoozeUntil: '+1d' }));
    await bootPlan(page, 'select', { tasks: t });

    const g = await geom(page);
    const ratio = g.inc / g.exc;
    expect(ratio, `a near-even split stays near-even (${g.inc} vs ${g.exc})`).toBeLessThan(2);
    expect(ratio).toBeGreaterThan(0.5);
    expect(g.inc + g.exc).toBeLessThanOrEqual(g.col);
  });

  test('the split tracks the viewport instead of freezing at its first layout', async ({ page }) => {
    /* The sub-1-shrink defect also showed up as near-total unresponsiveness to resize: a 100px taller
       column moved the Included half by 9px. It should move by ~100. */
    await page.setViewportSize({ width: 1280, height: 700 });
    await bootPlan(page, 'select', { tasks: lopsided() });
    const before = await geom(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    const after = await geom(page);

    expect(after.col - before.col, 'fixture: the column really did get taller').toBeGreaterThan(50);
    expect(after.inc - before.inc, 'Included absorbs essentially all of the new space')
      .toBeGreaterThanOrEqual((after.col - before.col) - 2);
    expect(after.exc, 'and Excluded holds its floor rather than growing away from it')
      .toBeGreaterThanOrEqual(FLOOR);
    expect(after.inc + after.exc).toBeLessThanOrEqual(after.col);
  });
});
