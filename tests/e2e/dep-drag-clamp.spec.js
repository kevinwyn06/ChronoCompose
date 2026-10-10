/* Gap 1: a successor bar is CLAMPED at its predecessor's end during the drag.
 *
 * Before this, nothing stopped the gesture: `autoSchedule` ran inside the drop and snapped the bar
 * forward on release, so the end state was correct but the interaction was an unexplained jump with no
 * feedback at the moment the constraint bit.
 *
 * This has to be a browser test and cannot be a unit test. The clamp is a property of a live pointer
 * gesture — `startBarDrag` captures the floor on a real mousedown, `onMouseMove` applies it per move, and
 * the barrier is only in the DOM WHILE the button is held. A dispatched MouseEvent skips hit-testing and
 * pointer capture, so it is not evidence here; everything below uses `page.mouse`.
 *
 * The unit layer separately proves the clamp computes the same floor `autoSchedule` enforces
 * (`tests/dep-scheduling.test.js`), which is the invariant that keeps the affordance from becoming a
 * second source of truth. This spec proves the gesture actually stops.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* B depends on A and starts six days after A ends, so there is plenty of room to drag it backwards
   and the clamp is the only thing that can stop it. */
const fixture = () => ({
  tasks: [
    task('dep-a', 'Draft the spec', { start: '+0d', end: '+2d', priority: 1, planned: 240 }),
    task('dep-b', 'Build the thing', { start: '+8d', end: '+10d', priority: 1, planned: 240, deps: ['dep-a'] }),
  ],
});

/* `ganttBlock` tags the bar body data-gantt-tip="<name> · <start> → <end> · <planned>". */
const BAR_A = '[data-gantt-tip^="Draft the spec ·"]';
const BAR_B = '[data-gantt-tip^="Build the thing ·"]';
const BARRIER = '[data-dep-barrier="dep-b"]';

/* The B bar is drawn ~10 days out, which at the default day width puts its CENTRE at x≈1282 — three
   pixels past the right edge of Playwright's default 1280px viewport. `page.mouse.move` clamps to the
   viewport, so the press landed on the board instead of the bar and the gesture never started: the
   barrier assertion failed and, worse, the forward-drag test below still PASSED because its assertion
   (`B.start > A.end`) was already true of the untouched fixture. A widened viewport is the honest fix —
   the spec needs the bar reachable by a real pointer, and nothing here is about narrow layouts.
   Diagnosed 2026-08-22: at 1600px the barrier renders and B clamps back exactly 6 days onto A's end. */
async function bootGantt(page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR_B).first().waitFor({ state: 'visible', timeout: 15000 });
}

const box = (page, sel) => page.locator(sel).first().boundingBox();

/** Task dates straight out of the persisted workspace, so the assertion is about DATA, not paint. */
async function dates(page, id) {
  return page.evaluate((tid) => {
    const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === tid);
    return t ? { start: t.start, end: t.end } : null;
  }, id);
}

test.describe('dependency drag clamp', () => {
  test('B cannot be dragged into A, and the barrier appears while it is held there', async ({ page }) => {
    await bootGantt(page);
    const a = await box(page, BAR_A);
    const b0 = await box(page, BAR_B);
    const aRight = a.x + a.width;

    await expect(page.locator(BARRIER), 'no barrier before the drag').toHaveCount(0);

    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    /* Drag far enough LEFT that, unclamped, B would land well before A even starts. */
    await page.mouse.move(b0.x + b0.width / 2 - (b0.x - a.x) - 200, b0.y + b0.height / 2, { steps: 20 });

    /* (1) The constraint is legible at the moment it bites — while the button is still down. */
    await expect(page.locator(BARRIER), 'the barrier is drawn while the drag pushes into the floor')
      .toBeVisible();

    /* (2) The bar itself actually stopped, rather than being corrected afterwards. */
    const held = await box(page, BAR_B);
    /* 2026-09-09: A.end names A's INCLUSIVE last day — a day A still occupies — so the floor is the
       midnight after it and B stops in the NEXT column, at A's right edge. (It used to stop one column
       earlier, sharing A's final date, which is the overlap this fix removed.) */
    expect(held.x, 'B stops the day after A\'s inclusive last day, mid-drag')
      .toBeGreaterThan(aRight - 3);

    await page.mouse.up();

    /* (3) The barrier is transient — it belongs to the gesture, not to the bar. */
    await expect(page.locator(BARRIER), 'the barrier goes away on release').toHaveCount(0);

    /* (4) And the authority agrees with the affordance: autoSchedule has nothing left to correct, so
           there is no post-release jump. B sits exactly at A's end. */
    const A = await dates(page, 'dep-a');
    const B = await dates(page, 'dep-b');
    /* No DST inside this fixture's ten-day window, so the day step is a flat 24h here. */
    expect(B.start, 'B starts the day after A\'s last day — no rubber-band on release')
      .toBe(A.end + 86400000);
    expect(B.end - B.start, 'and keeps its 2-day duration').toBe(A.end - A.start);
  });

  test('dragging B LATER is not clamped, and never moves A', async ({ page }) => {
    await bootGantt(page);
    const before = await dates(page, 'dep-a');
    const b0Start = await dates(page, 'dep-b');
    const b0 = await box(page, BAR_B);

    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 150, b0.y + b0.height / 2, { steps: 15 });
    await expect(page.locator(BARRIER), 'a forward drag is unconstrained').toHaveCount(0);
    await page.mouse.up();

    /* Measured against B's OWN start before the drag, not against A's end. The old assertion compared
       B.start to A.end, which the fixture already satisfies by six days — so it held even when the
       gesture did nothing at all, and hid exactly the failure the sibling test was reporting.
       Polled rather than read once: the drop persists through `saveTasks` after the mouseup handler
       returns, so a single immediate read races the write. */
    await expect.poll(async () => (await dates(page, 'dep-b')).start,
      { message: 'B really moved later' }).toBeGreaterThan(b0Start.start);
    const after = await dates(page, 'dep-a');
    expect(after.start, 'dragging B never moves A').toBe(before.start);
    expect(after.end).toBe(before.end);
  });
});
