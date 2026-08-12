const { test, expect } = require('@playwright/test');
const { bootPlan, dragBetween, task } = require('./_seed');

/* Card drag on Overview's left pane — Selection. (Matrix was covered here too until block 32 retired it.)
   The grids share ONE drag implementation (cardPointerDown → beginCardDrag → onMouseUp) and differ
   only in what the drop writes.

   Why this belongs in the e2e layer and nowhere else: the gesture is defined by a 4px promotion
   threshold and by `elementFromPoint` hit-testing against the zone the cursor is actually over. A
   dispatched MouseEvent has neither. The unit layer already owns the pure projections
   (`selectionProjection`, `eisenhowerProjection`) and the pure mutators; this file deliberately does
   not re-test those.

   These assertions are written against what a USER sees — which band/quadrant the card ends up in —
   not against `state.cardDrag` or any zone string, because the implementation underneath is about to
   be rewritten (blocks 04–06) and a test that pins internals would have to be rewritten with it. */

const cardIn = (page, cellSel, name) =>
  page.locator(`${cellSel} [data-card-id]`).filter({ hasText: name });

/* Press on the card's NAME. Nearly every other child of a card stops mousedown propagation
   (done circle, description toggle, tags, timer, inclusion glyph …), so pressing one of those would
   never start a drag at all — and a "drag" test that silently never dragged is worse than no test. */
const grip = (page, id, name) => page.locator(`[data-card-id="${id}"]`).getByText(name, { exact: true });

test.describe('Selection: dragging a card across the Included/Excluded divider', () => {
  const tasks = [task('sel-1', 'Draggable task', { start: '0d', end: '+2d', included: true })];

  test('a card dragged DOWN into Excluded lands there', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    /* Precondition, asserted rather than assumed: `included:true` puts it in the Included band. */
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Draggable task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Draggable task')).toHaveCount(0);

    await dragBetween(page, grip(page, 'sel-1', 'Draggable task'),
      page.locator('[data-selcell$="-excluded"]').first());

    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Draggable task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Draggable task')).toHaveCount(0);
  });

  test('and dragging it back UP re-includes it', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    const g = () => grip(page, 'sel-1', 'Draggable task');
    await dragBetween(page, g(), page.locator('[data-selcell$="-excluded"]').first());
    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Draggable task')).toHaveCount(1);

    /* Re-locate: the card was re-rendered into a different cell, so the old box is stale. */
    await dragBetween(page, g(), page.locator('[data-selcell$="-included"]').first());
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Draggable task')).toHaveCount(1);
  });

  test('a press that never crosses the 4px threshold is a click, not a drop', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });
    const box = await grip(page, 'sel-1', 'Draggable task').boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2); /* under threshold on both axes */
    await page.mouse.up();

    /* The task did not move bands... */
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Draggable task')).toHaveCount(1);
    /* ...and the click was NOT suppressed: the detail panel opened. */
    await expect(page.getByRole('button', { name: 'Previous task' })).toBeVisible();
  });

  test('a completed drag does not also open the detail panel', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await bootPlan(page, 'select', { tasks });

    await dragBetween(page, grip(page, 'sel-1', 'Draggable task'),
      page.locator('[data-selcell$="-excluded"]').first());

    await expect(page.getByRole('button', { name: 'Previous task' })).toHaveCount(0);
    expect(errors, 'page errors during card drag').toEqual([]);
  });
});

/* V5 block 32: the `Matrix: dragging a card between the importance rows` describe block is DELETED,
   not skipped. The Eisenhower matrix is retired — unreachable from the UI — so `bootPlan(page,'matrix')`
   can no longer reach it, and a test asserting a retired surface renders is not evidence of anything.
   The drag machinery it shared is still covered above by the Selection block, which is the point:
   ONE drag implementation, and the surviving surface exercises it. The pure matrix functions
   (`eisenhowerProjection`, `setQuadrantImportance`, `quadrantOf`) remain unit-tested. */
