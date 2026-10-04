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

test.describe('V2.4 → UI revamp block 6 — the timer lives on the play button, not on a click or a double-click', () => {
  test('a plain single click selects and opens details without starting anything', async ({ page }) => {
    /* Load-bearing rather than vacuous: this is the assertion that would go red if activation were
       ever moved onto the single click (the shape an earlier handoff wrongly claimed shipped), and it
       is the control the gesture assertion above needs before it can mean anything. */
    await boot(page);
    await rows(page).nth(0).locator('[data-task-name]').click();
    await expect(page.getByRole('button', { name: 'Previous task' })).toBeVisible();
    expect(await running(page), 'a single click is not an activation').toEqual([]);
  });

  /* UI revamp block 6 (decision 11) SUPERSEDES the V2.4 gesture: a double-click no longer starts a timer —
     on the title it edits the name in place (tests/e2e/sheet-keyboard.spec.js), anywhere else on the row
     it does nothing extra. The timer stays on the row's play button. These two cases keep the file's
     original guarantee — the observable is still `pp-run`, read after real pointer input — pointed at the
     new contract. */
  test('a trusted double-click on a row starts no timer', async ({ page }) => {
    await boot(page);
    await rows(page).nth(0).dblclick();
    await page.waitForTimeout(300);
    expect(await running(page), 'off the title: nothing starts').toEqual([]);
    /* Off the title the second press is consumed, so the detail the first click opened may still be up. */
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pp-dialog="detail"]')).toHaveCount(0);
    await rows(page).nth(1).locator('[data-task-name]').dblclick();
    await expect(page.locator('[data-pp-inline-title]'), 'on the title it edits in place').toBeVisible();
    expect(await running(page), 'double-click is not an activation any more').toEqual([]);
  });

  test('the play button is where a timer starts, and starting another switches which task is active', async ({ page }) => {
    await boot(page);
    const play = (i) => rows(page).nth(i).locator('[data-cellk="actions"] button[title="Start timer"]');
    await rows(page).nth(0).hover();
    await play(0).click();
    await expect.poll(() => running(page), { message: 'the play button starts the task' }).toEqual(['e2e-1']);
    await rows(page).nth(1).hover();
    await play(1).click();
    /* V2.4's single-timer default survives: starting the second task stops the prior one. */
    await expect.poll(() => running(page), { message: 'the prior active task stops' }).toEqual(['e2e-2']);
  });
});
