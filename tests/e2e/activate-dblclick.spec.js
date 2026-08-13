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

/* FIXED, 2026-08-12 — this file's FINDING note is now the fix's regression test.
 *
 * The defect: a trusted double-click on a sheet row never reached `rowDblClick`, so nothing was ever
 * written to `pp-run`. Root cause, established with trusted `page.mouse` input and a document-level
 * event log: the FIRST click opens the detail modal, a `position:fixed; inset:0` scrim with a large
 * centred card. By the time the second press lands, that overlay — not the row — is the element under
 * the cursor, so the click sequence changes target mid-flight, Chromium resets its click count
 * (`detail` stayed 1 on the second press) and NEVER synthesises `dblclick` on the row. Not the drag
 * threshold, not `_suppressCardClick`, and not a re-render: the row node was verified identical and
 * unmoved across the two clicks.
 *
 * That is precisely the class of defect a dispatched MouseEvent hides — it calls the handler directly,
 * so `tests/core.test.js` and `tests/v2-card-parity.test.js` stayed green throughout. The fix makes the
 * modal recognise the second press itself (`detailDblFollowUp`, index.html), so no test.fail() marker
 * is needed here and a red run in this file is a real regression.
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

  test('a trusted double-click on a row activates the task', async ({ page }) => {
    await boot(page);
    /* Real pointer input, not a dispatched `dblclick`: the whole defect lived in which element the
       browser saw under the cursor for the SECOND press, which a synthetic event never asks. */
    await rows(page).nth(0).dblclick();
    await expect
      .poll(() => running(page), { message: 'double-click starts the task\'s timer' })
      .toEqual(['e2e-1']);
  });

  test('double-clicking another row switches which task is active', async ({ page }) => {
    await boot(page);
    await rows(page).nth(0).dblclick();
    await expect.poll(() => running(page)).toEqual(['e2e-1']);
    await rows(page).nth(1).dblclick();
    /* V2.4's single-timer default: activating the second task stops the prior active one, so `pp-run`
       holds exactly one id — the switch, not an accumulation. */
    await expect
      .poll(() => running(page), { message: 'the prior active task stops' })
      .toEqual(['e2e-2']);
  });
});
