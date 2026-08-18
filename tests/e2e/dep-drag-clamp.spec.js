/* Gap 1: a successor bar is CLAMPED at its predecessor's end during the drag.
 *
 * Before this, nothing stopped the gesture: `autoSchedule` ran inside the drop and snapped the bar
 * forward on release, so the end state was correct but the interaction was an unexplained jump with no
 * feedback at the moment the constraint bit.
 *
 * This has to be a browser test and cannot be a unit test. The clamp is a property of a live pointer
 * gesture — `startBarDrag` captures the floor on a real mousedown, `onMouseMove` applies it per move, and
 * the barrier is only in the DOM WHILE the button is held. A dispatched MouseEvent skips hit-testing and
 * pointer capture, so it is not evidence here (AGENTS.md); everything below uses `page.mouse`.
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

/* `ganttBlock` titles the bar body "<name> · <n>d · click for details". */
const BAR_A = '[title^="Draft the spec ·"]';
const BAR_B = '[title^="Build the thing ·"]';
const BARRIER = '[data-dep-barrier="dep-b"]';

async function bootGantt(page) {
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
    /* Chain 6 block 43 makes a due day inclusive in paint. A.end is the START of A's final
       painted day, so B correctly shares that date column while still respecting the exact
       finish-to-start instant. A spans three painted days in this fixture. */
    const aEndDayLeft = aRight - a.width / 3;
    expect(held.x, 'B stops at A.end (the left edge of A\'s inclusive due day) mid-drag')
      .toBeGreaterThan(aEndDayLeft - 3);

    await page.mouse.up();

    /* (3) The barrier is transient — it belongs to the gesture, not to the bar. */
    await expect(page.locator(BARRIER), 'the barrier goes away on release').toHaveCount(0);

    /* (4) And the authority agrees with the affordance: autoSchedule has nothing left to correct, so
           there is no post-release jump. B sits exactly at A's end. */
    const A = await dates(page, 'dep-a');
    const B = await dates(page, 'dep-b');
    expect(B.start, 'B starts exactly at A.end — no rubber-band on release').toBe(A.end);
    expect(B.end - B.start, 'and keeps its 2-day duration').toBe(A.end - A.start);
  });

  test('dragging B LATER is not clamped, and never moves A', async ({ page }) => {
    await bootGantt(page);
    const before = await dates(page, 'dep-a');
    const b0 = await box(page, BAR_B);

    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 150, b0.y + b0.height / 2, { steps: 15 });
    await expect(page.locator(BARRIER), 'a forward drag is unconstrained').toHaveCount(0);
    await page.mouse.up();

    const B = await dates(page, 'dep-b');
    expect(B.start, 'B really moved later').toBeGreaterThan(before.end);
    const after = await dates(page, 'dep-a');
    expect(after.start, 'dragging B never moves A').toBe(before.start);
    expect(after.end).toBe(before.end);
  });
});
