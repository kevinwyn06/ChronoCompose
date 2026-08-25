// @ts-check
/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP): *"Today/Schedule: clicking a scheduled block opens details while
 * dragging still pins."*
 *
 * The DRAG half is already covered (`tests/e2e/timeline-drag.spec.js`, `edge-drag.spec.js`). The click
 * half was not covered anywhere, on either surface — and it is the half with no handler of its own.
 * A draggable block deliberately has `onClick:null` (index.html: "draggable ones go through the
 * no-move branch in the block mouseup instead, so they don't open twice"), so "click opens details" is
 * a claim about `onMouseUp`'s `else if` after `bd.moved` proved false. Nothing about that branch is
 * reachable without a real press-and-release, and a dispatched `click` would take the other path
 * entirely — the one that is null on exactly these blocks.
 *
 * Both surfaces are asserted because they are two different renderers (`renderDayColumn` and
 * `renderScheduleView`) sharing one `blockPointerDown`, and only one of them declares its own onClick
 * fallback. A regression that broke the shared mouseup would show on both; a regression that broke one
 * renderer's wiring would show on one, and that is a distinction worth being able to make.
 *
 * ── Fixture ────────────────────────────────────────────────────────────────────────────────────
 * `cleanDaySettings` for the reason the other timeline specs use it: one pool, no meals, no reserve,
 * `packFromNow:false`, so the wall clock cannot move where a block lands mid-test. Two flexible tasks
 * split the window in proportion to `planned`, so neither is ever split into pieces and "the block"
 * is unambiguous.
 */
const { test, expect } = require('@playwright/test');
const { bootToday, bootSurface, cleanDaySettings, timelineBlocks, settleTimeline, task } = require('./_seed');

const fixture = () => ({
  settings: cleanDaySettings('10:00'),
  tasks: [
    task('blk', 'Block under test', { start: '0d', end: '+2d', planned: 120, priority: 1 }),
    task('fill', 'Filler', { start: '0d', end: '+2d', planned: 480, priority: 2 }),
  ],
});

const detail = (page) => page.getByRole('button', { name: 'Previous task' });
/** Which task the open detail panel is showing, when it says. */
const detailId = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-detail-task-id]');
  return el ? el.getAttribute('data-detail-task-id') : null;
});

/** Press and release inside a box without travelling past any drag threshold. */
async function clickIn(page, box) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 4; /* upper quarter — never the bottom edge handle */
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y + 1); /* a real hand is never perfectly still */
  await page.mouse.up();
}

test.describe('Today timeline: a click on a scheduled block opens its details', () => {
  test('a no-move press on the block body opens the detail panel for THAT task', async ({ page }) => {
    await bootToday(page, fixture());
    const before = await timelineBlocks(page);
    const mine = before.filter((b) => b.title === 'Block under test');
    expect(mine, 'fixture: the task is drawn as exactly one block').toHaveLength(1);
    expect(mine[0].kind, 'and it is an auto-scheduled block, so it is draggable').toBe('auto');
    await expect(detail(page), 'nothing is open yet').toHaveCount(0);

    await clickIn(page, { x: mine[0].x, y: mine[0].y, width: mine[0].w, height: mine[0].h });

    await expect(detail(page), 'the click opened details').toBeVisible();
    const id = await detailId(page);
    if (id !== null) expect(id, 'and it is the block that was pressed, not its neighbour').toBe('blk');

    /* The other half of the same branch: a click is not a pin. Without this, a press that both opened
       details and quietly pinned the block would pass. */
    await settleTimeline(page);
    expect((await timelineBlocks(page)).filter((b) => b.pinned), 'a click pins nothing').toHaveLength(0);
  });

  test('a real drag on the same block still pins it and does NOT open details', async ({ page }) => {
    await bootToday(page, fixture());
    const mine = (await timelineBlocks(page)).filter((b) => b.title === 'Block under test')[0];

    const x = mine.x + mine.w / 2;
    const y = mine.y + mine.h / 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 140, { steps: 12 });
    await page.mouse.up();
    await settleTimeline(page);

    const after = await timelineBlocks(page);
    const pins = after.filter((b) => b.pinned);
    expect(pins, 'the drag pinned exactly one block').toHaveLength(1);
    expect(pins[0].taskId, 'and it is the one that was grabbed').toBe('blk');
    await expect(detail(page), 'a completed drag is not a click').toHaveCount(0);
  });

  test('and a click on the block once it is PINNED still opens details', async ({ page }) => {
    /* A pinned block takes a different `canDrag`/formatting path and loses its allotment handle, so
       "details on click" has to be re-asserted there rather than assumed to carry over. */
    await bootToday(page, fixture());
    const mine = (await timelineBlocks(page)).filter((b) => b.title === 'Block under test')[0];
    const x = mine.x + mine.w / 2;
    const y = mine.y + mine.h / 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 140, { steps: 12 });
    await page.mouse.up();
    await settleTimeline(page);

    const pinned = (await timelineBlocks(page)).filter((b) => b.pinned)[0];
    expect(pinned, 'precondition: it is pinned').toBeTruthy();
    await clickIn(page, { x: pinned.x, y: pinned.y, width: pinned.w, height: pinned.h });
    await expect(detail(page), 'a pinned block is still clickable for details').toBeVisible();
  });
});

test.describe('Schedule agenda: the same rule on the other renderer', () => {
  /* The agenda draws SEVERAL days one under another, so a task whose window spans three days has a
     chip in each — `renderScheduleView` writes no per-day hook to scope by. The fixture is therefore
     narrowed to a window of exactly today, which makes "the chip" unambiguous without inventing a
     selector for a day container that does not exist. */
  const todayOnly = () => {
    const f = fixture();
    f.tasks = f.tasks.map((t) => Object.assign({}, t, { end: '0d' }));
    return f;
  };
  const chip = (page) => page.locator('[data-sched-block][data-sched-task="blk"]');

  async function bootSchedule(page) {
    await bootSurface(page, { view: 'schedule' }, todayOnly());
    await chip(page).first().waitFor({ state: 'visible', timeout: 15000 });
  }

  test('a no-move press on an agenda chip opens the detail panel for that task', async ({ page }) => {
    await bootSchedule(page);
    await expect(chip(page), 'the task has one chip in the agenda').toHaveCount(1);
    await expect(chip(page), 'which is a draggable one, so the click runs through the mouseup branch')
      .toHaveAttribute('data-sched-kind', 'drag');
    await expect(detail(page)).toHaveCount(0);

    const box = await chip(page).boundingBox();
    if (!box) throw new Error('the agenda chip had no box');
    await clickIn(page, box);

    await expect(detail(page), 'the agenda chip opened details').toBeVisible();
    const id = await detailId(page);
    if (id !== null) expect(id, 'for the task the chip belongs to').toBe('blk');
  });

  test('a real drag on the agenda chip pins instead of opening details', async ({ page }) => {
    await bootSchedule(page);
    const box = await chip(page).boundingBox();
    if (!box) throw new Error('the agenda chip had no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 90, { steps: 12 });
    await page.mouse.up();

    await expect(detail(page), 'a completed drag is not a click').toHaveCount(0);
    /* The pin is read from the app's own store rather than from the chip's styling: `pin` is what
       `pinBlockAt` writes, and it is the same fact the timeline renders as `data-tl-kind="pinned"`. */
    await expect
      .poll(() => page.evaluate(() => {
        try {
          const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === 'blk');
          return t && Array.isArray(t.pin) ? t.pin.length : 0;
        } catch (e) { return -1; }
      }), { message: 'the drag wrote a pin' })
      .toBeGreaterThan(0);
  });
});
