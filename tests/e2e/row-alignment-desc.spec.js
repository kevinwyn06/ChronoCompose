// @ts-check
/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP): *"Sheet/Gantt rows stay aligned with an expanded description."*
 *
 * This is the one that had been measured BY HAND every verification pass, and written into `CURRENT.md`
 * as a number ("row tops agreed within 0.016px"). A measurement a human repeats every pass, to three
 * decimal places, from a browser's dev tools, is the definition of a check that should not be manual.
 *
 * ── Why the invariant is fragile enough to be worth pinning ────────────────────────────────────
 * The two panes do NOT share a layout. The sheet's description panel is an in-flow block that pushes
 * the rows below it down by whatever height its content happens to take. The Gantt has no such block —
 * it draws absolutely-positioned rows and re-derives every row's `top` from `yOfRow`, which adds
 * `descExtra(t)`, which reads a height MEASURED off the sheet's panel by a ResizeObserver
 * (`observeDescPanel` → `this._descH` → a `descTick` re-render).
 *
 * So alignment survives only if a measurement in one pane completes a round trip into the other pane's
 * arithmetic. That is not something a unit test can assert: the mock DOM has no layout, `offsetHeight`
 * is not real, and ResizeObserver does not exist. It needs a live mount, which is exactly why it had
 * stayed a manual check.
 *
 * ── How alignment is measured ──────────────────────────────────────────────────────────────────
 * Never as "the two boxes have the same y". The panes have different chrome above them, so a constant
 * offset between them is expected and is not a defect. What must hold is that the offset is the SAME
 * for every row — i.e. each pane's rows sit at identical positions RELATIVE to its own first row. That
 * is what a user means by "the bar is next to its row", and it is invariant under any pane-level shift.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* Long enough that the panel is unambiguously taller than the 34px minimum, so the assertion is about
   a real measured height and not about a floor that both panes could hard-code. */
const PROSE = 'A description with enough prose in it that the panel is comfortably taller than its '
  + 'minimum height, so the Gantt has a non-trivial number to offset by rather than a constant it '
  + 'could have guessed. It wraps over several lines at the sheet\'s width.';

const fixture = () => ({
  tasks: [
    task('ra-1', 'First row', { start: '0d', end: '+2d', priority: 1 }),
    task('ra-2', 'Second row', { start: '0d', end: '+3d', priority: 2, description: PROSE }),
    task('ra-3', 'Third row', { start: '+1d', end: '+3d', priority: 3 }),
    task('ra-4', 'Fourth row', { start: '+1d', end: '+4d', priority: 4 }),
  ],
});

const IDS = ['ra-1', 'ra-2', 'ra-3', 'ra-4'];

/**
 * Each pane's row tops, measured relative to its OWN first row — the form in which "aligned" is a
 * claim about the two panes agreeing rather than about where either one starts on screen.
 */
async function relativeTops(page) {
  return page.evaluate((ids) => {
    const topOf = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top : null;
    };
    const sheet = ids.map((id) => topOf(`[data-task-id="${id}"]:not([data-card-id])`));
    const gantt = ids.map((id) => topOf(`[data-gantt-task-id="${id}"]`));
    if (sheet.some((v) => v === null) || gantt.some((v) => v === null)) return null;
    return {
      sheet: sheet.map((v) => v - sheet[0]),
      gantt: gantt.map((v) => v - gantt[0]),
      sheetAbs: sheet,
    };
  }, IDS);
}

/** The biggest disagreement between the two panes, in px. */
const worstGap = (m) => Math.max(...m.sheet.map((v, i) => Math.abs(v - m.gantt[i])));

/* The hand-measured figure recorded in CURRENT.md was 0.016px and 0.03px on different passes — sub-
   pixel residue from Chromium's 1/64px layout snapping, not drift. Half a pixel is therefore a
   generous ceiling that still fails loudly on a real misalignment: one dropped `descExtra` would put a
   row a whole panel-height out, tens of px, not fractions of one. */
const TOL = 0.5;

async function bootBoard(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await expect.poll(() => relativeTops(page).then((m) => (m ? m.sheet.length : 0)),
    { message: 'both panes rendered all four rows' }).toBe(4);
}

/** Wait until two consecutive reads of the geometry agree — the panel's ResizeObserver lands a frame
 *  after the toggle, and reading before it does would measure the pre-offset Gantt. */
async function settleRows(page) {
  let prev = '';
  for (let i = 0; i < 25; i++) {
    const m = await relativeTops(page);
    const now = JSON.stringify(m && m.sheet.concat(m.gantt).map((v) => Math.round(v * 100)));
    if (now === prev && m) return m;
    prev = now;
    await page.waitForTimeout(80);
  }
  return relativeTops(page);
}

/* `taskDescToggle` writes its own state into the title — 'Show / edit description' when closed,
   'Hide description' when open — so the selector has to accept both or the collapse half of the
   round trip is unreachable. */
const descToggle = (page, id) => page.locator(
  `[data-task-id="${id}"]:not([data-card-id]) [title="Show / edit description"], `
  + `[data-task-id="${id}"]:not([data-card-id]) [title="Hide description"]`);

test.describe('sheet ⇄ Gantt row alignment', () => {
  test('the two panes agree row for row before anything is expanded', async ({ page }) => {
    await bootBoard(page);
    const m = await settleRows(page);
    /* The control. Without it, the expanded case below could pass while both panes were equally wrong
       from the start, and the test would be measuring nothing. */
    expect(worstGap(m), 'closed rows line up').toBeLessThan(TOL);
  });

  test('expanding a description pushes both panes\' later rows down by the same amount', async ({ page }) => {
    await bootBoard(page);
    const before = await settleRows(page);

    await descToggle(page, 'ra-2').click();
    const after = await settleRows(page);

    /* The panel really opened, and really has a height worth offsetting by — asserted before the
       alignment claim, because an alignment test over a zero-height panel is vacuous. */
    const grew = after.sheet[2] - before.sheet[2];
    expect(grew, 'the rows below the expanded one moved down by a real panel height')
      .toBeGreaterThan(34);
    /* And the row ABOVE did not move: a panel belongs to its own row, so it must push only downward. */
    expect(Math.abs(after.sheet[1] - before.sheet[1]), 'rows above the panel stay put')
      .toBeLessThan(TOL);

    expect(worstGap(after), 'and the Gantt followed the sheet, row for row').toBeLessThan(TOL);
    /* Specifically: the two panes moved the SAME rows by the SAME distance. Stated separately from the
       gap because it is the claim about `descExtra` completing its round trip, and a pane that had
       simply shifted wholesale could satisfy a gap check alone. */
    expect(Math.abs((after.gantt[2] - before.gantt[2]) - grew),
      'the Gantt offset equals the measured panel height').toBeLessThan(TOL);
  });

  test('collapsing it again restores the original geometry in both panes', async ({ page }) => {
    await bootBoard(page);
    const before = await settleRows(page);

    await descToggle(page, 'ra-2').click();
    const open = await settleRows(page);
    expect(open.sheet[3] - before.sheet[3], 'precondition: it opened').toBeGreaterThan(34);

    await descToggle(page, 'ra-2').click();
    const closed = await settleRows(page);
    expect(Math.max(...closed.sheet.map((v, i) => Math.abs(v - before.sheet[i]))),
      'the sheet is back where it started').toBeLessThan(TOL);
    expect(worstGap(closed), 'and the two panes agree again').toBeLessThan(TOL);
  });

  test('an expanded description that is ALREADY open at boot is offset too', async ({ page }) => {
    /* `descOpen` is persisted in `pp-prefs`, so a task can be expanded before the Gantt has ever
       rendered a closed row for it. That is a different code path from the toggle above — the offset
       has to be right on the FIRST paint, not merely applied as a correction afterwards. */
    const d = fixture();
    d.prefs = { descOpen: { 'ra-2': true } };
    await bootSurface(page, { view: 'gantt' }, d);
    await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
    const m = await settleRows(page);

    expect(m.sheet[2] - m.sheet[1], 'the expanded row is taller than a plain one')
      .toBeGreaterThan(m.sheet[1] - m.sheet[0] + 34);
    expect(worstGap(m), 'and the Gantt was laid out with the offset from the first paint')
      .toBeLessThan(TOL);
  });
});
