/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V2.9 owner user-check"): *"dragging a task row … no longer highlights
 * text, while click-to-rename and caret placement still work, and Journal prose is still selectable."*
 *
 * V2.9 §1 is two mechanisms, not one, and only a real browser can tell them apart: `user-select:none`
 * stops a selection GROWING, while `getSelection().removeAllRanges()` clears what the browser already
 * highlighted in the first few pixels before the 4px threshold promoted the drag — the visible half.
 * A dispatched MouseEvent never produces a native selection at all, so the unit layer structurally
 * cannot see either one.
 *
 * The scoping half matters as much as the suppression: the class goes on the board root, never on
 * `document.body`, so Journal prose stays copyable. Both are asserted here.
 */
const { test, expect } = require('@playwright/test');
const { boot, bootSurface } = require('./_seed');

const firstRow = (page) => page.locator('[data-task-id]:not([data-card-id])').first();

/** Put a real, non-empty native selection across a row's own text. */
async function selectRowText(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-task-id]:not([data-card-id])');
    const r = document.createRange();
    r.selectNodeContents(row);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    return s.toString().trim().length;
  });
}

test.describe('V2.9 §1 — a drag does not drag a highlight along with it', () => {
  test('an existing selection is cleared at drag begin and the board stops selecting', async ({ page }) => {
    await boot(page);
    const row = firstRow(page);
    const box = await row.locator('[data-task-name]').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;

    const had = await selectRowText(page);
    expect(had, 'precondition: there really is a highlight to clear').toBeGreaterThan(0);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60, { steps: 10 }); /* past the 4px promotion threshold */

    const mid = await page.evaluate(() => ({
      sel: (window.getSelection() || { toString: () => '' }).toString().length,
      dragging: document.querySelectorAll('.pp-dragging').length,
      body: getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect,
    }));
    expect(mid.sel, 'the highlight that existed before the press is gone mid-drag').toBe(0);
    expect(mid.dragging, 'and suppression is armed on the board').toBeGreaterThan(0);
    expect(mid.body, 'scoped to the board — body itself is never made unselectable').not.toBe('none');

    await page.mouse.up();
    /* Released in exactly one place. A per-drag release that returned early would strand the whole
       board unselectable, which is worse than the bug it fixes — so assert the release, not just the
       arming. */
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.pp-dragging').length),
      { message: 'suppression is released on mouseup' }).toBe(0);
  });

  test('Journal prose is still selectable', async ({ page }) => {
    await bootSurface(page, { view: 'journal' });
    const pad = page.locator('#pp-scratch-editor');
    await expect(pad).toBeVisible();
    const us = await pad.evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.userSelect || cs.webkitUserSelect;
    });
    expect(us, 'prose is not caught by the board-scoped suppression').not.toBe('none');
  });
});
