/* OWNER REPORT → AUTOMATION.
 *
 * *"the chip that follows the pointer while dragging a task is not consistently close to the mouse
 * pointer."*
 *
 * This is the repo's known `zoom:0.8` conversion-site failure, and it is a PROPORTIONAL error, not a
 * constant one: `renderRowDragGhost` paints a `position:fixed` node that lives INSIDE the zoomed
 * subtree, so its `left`/`top` are local CSS px, while `onMouseMove` fed it raw `clientX/clientY`
 * (viewport px). The chip therefore lands at 0.8× the cursor's distance from the viewport origin —
 * accurate near the top-left corner, far off at the bottom-right. That is exactly what "not
 * consistently close" describes.
 *
 * Two things follow for this spec:
 *   1. It MUST sample several pointer positions, including both extremes. A single mid-screen sample
 *      passes with the bug present at some scale factor and proves nothing.
 *   2. It MUST use real `page.mouse`. A dispatched MouseEvent skips hit-testing and pointer capture,
 *      so it cannot promote the 4px threshold that arms the drag in the first place.
 *
 * Measurement note: the chip's offset constants (ROW_GHOST_DX/DY) are written in LOCAL px, so the
 * rendered gap between pointer and chip is `constant × uiScale`. We assert the pointer-to-chip vector
 * is the SAME at every sample (zero drift) rather than pinning a rendered magnitude, which is the
 * property the owner actually reported missing.
 */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

const GHOST = '[data-row-drag-ghost]';

/** Pointer→chip vector in VIEWPORT px, alongside the measured zoom scale. */
async function chipVector(page, mx, my) {
  return page.evaluate(([x, y, sel]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    /* uiScale is measured, never hardcoded: rendered width / layout width of the zoomed subtree. */
    const root = document.querySelector('[data-ui-root]') || document.body;
    const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    return { dx: r.left - x, dy: r.top - y, scale };
  }, [mx, my, GHOST]);
}

test.describe('row drag chip tracks the pointer', () => {
  test('the pointer→chip offset is constant across the whole viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await boot(page);

    const row = page.locator('[data-task-id]:not([data-card-id])').first();
    /* Anchored on the NAME cell rather than the row's geometric centre: every other data column in
       the sheet is an interactive control (the Planned input, the %-done drag track, the Time-needed
       chip), so a row's midpoint is whichever column the current widths happen to put there — adding
       one column moved it onto the Planned input and turned this into a false failure. The name cell
       is the row's neutral surface, and where a user actually presses to open or drag a task. */
    const box = await row.locator('[data-task-name]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    /* Past the 4px promotion threshold, and far enough vertically that the drop index changes —
       the chip only renders once `rowDragMoved` is true. */
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 70, { steps: 8 });
    await expect(page.locator(GHOST)).toBeVisible();

    /* Both extremes plus the middle. With the 0.8× bug the offset grows by ~0.2× the travel, so the
       near-origin and far-corner samples disagree by well over 100px. */
    const samples = [[240, 320], [700, 500], [1150, 700]];
    const measured = [];
    for (const [x, y] of samples) {
      await page.mouse.move(x, y, { steps: 6 });
      const v = await chipVector(page, x, y);
      expect(v, 'the chip is still mounted at ' + x + ',' + y).not.toBeNull();
      measured.push(Object.assign({ x, y }, v));
    }
    await page.mouse.up();

    const scale = measured[0].scale;
    expect(scale, 'the board really is inside a zoom wrapper (precondition)').toBeLessThan(1);

    const dxs = measured.map((m) => m.dx), dys = measured.map((m) => m.dy);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const detail = JSON.stringify(measured);

    /* THE assertion: a constant offset, not a proportional drift. */
    expect(spread(dxs), 'horizontal pointer→chip offset does not drift across the viewport: ' + detail)
      .toBeLessThanOrEqual(2);
    expect(spread(dys), 'vertical pointer→chip offset does not drift across the viewport: ' + detail)
      .toBeLessThanOrEqual(2);

    /* …and the constant is the deliberate small down-right nudge, not an accident that happens to be
       stable. Rendered px = local constant × scale, so allow a few px of rounding either way. */
    for (const m of measured) {
      expect(Math.abs(m.dx), 'chip stays beside the pointer at ' + m.x + ',' + m.y + ': ' + detail)
        .toBeLessThanOrEqual(24);
      expect(Math.abs(m.dy), 'chip stays beside the pointer at ' + m.x + ',' + m.y + ': ' + detail)
        .toBeLessThanOrEqual(24);
      expect(m.dx, 'the nudge is down-RIGHT of the pointer').toBeGreaterThan(0);
      expect(m.dy, 'the nudge is DOWN from the pointer').toBeGreaterThan(0);
    }
  });
});
