/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V2.4 owner user-check"): *"start one task's timer, then start a
 * second: confirm the first stops … Double-click a sheet row and confirm the task takes the active
 * depth … that double-clicking another row switches active."*
 *
 * The unit layer covers `activateTask` as a FUNCTION (`tests/core.test.js`, "V2.4: activateTask
 * switches active and stops only the prior active") and `tests/v2-card-parity.test.js` covers that a
 * card WIRES `onDoubleClick`. Neither covers the gesture: that a real double-click on a real sheet row
 * reaches `rowDblClick` at all. That matters because double-click on this row is layered over a single
 * click that selects and opens the detail panel — a handler ordering slip would leave both of the
 * cited tests green while the gesture did nothing, which is exactly the class of wrong claim the
 * 2026-08-04 handoff already made once about this gesture.
 *
 * The observable is `pp-run`, the app's own record of which timers are live — read after the gesture,
 * never seeded, so the assertion is about what the click did.
 */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

/* FINDING, 2026-08-12 — the gesture half of this item does NOT currently work, and no test in the
 * repo could have said so. A TRUSTED double-click on a sheet row never reaches `rowDblClick`: nothing
 * is written to `pp-run`. The handler IS wired — dispatching a synthetic `dblclick` at the same row
 * starts the timer immediately — which is exactly the gap AGENTS.md warns about: a synthetic
 * MouseEvent is not evidence for a gesture. The unit layer's coverage (`tests/core.test.js`,
 * "V2.4: activateTask switches active and stops only the prior active") tests the FUNCTION and is
 * green either way.
 *
 * The fix lives in `index.html`, which this lane may not edit, so the failing assertion is NOT
 * committed red — the e2e suite's "no test.fail() markers" invariant means a red run must always be a
 * regression. What ships here is the CONTROL half, which is genuinely provable today, plus this note.
 * The gesture assertion belongs in this file the moment the defect is fixed; the reference
 * implementation is in the PR body.
 */
const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');

/** Which task ids currently have a running timer, per the app's own `pp-run`. */
const running = (page) => page.evaluate(() => {
  try { return Object.keys(JSON.parse(localStorage.getItem('pp-run') || '{}')); } catch (e) { return ['UNPARSEABLE']; }
});

test.describe('V2.4 — activation is a gesture on the row, not on a click', () => {
  test('a plain single click selects and opens details without starting anything', async ({ page }) => {
    /* Load-bearing rather than vacuous: this is the assertion that would go red if activation were
       ever moved onto the single click (the shape an earlier handoff wrongly claimed shipped), and it
       is the control the gesture assertion above needs before it can mean anything. */
    await boot(page);
    await rows(page).nth(0).click();
    await expect(page.getByRole('button', { name: 'Previous task' })).toBeVisible();
    expect(await running(page), 'a single click is not an activation').toEqual([]);
  });
});
