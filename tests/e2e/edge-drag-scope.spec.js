/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V3/V4 owner user-check"): *"Resize a block by its edge in a FUTURE
 * column. Confirm you accept that this changes that task's allotment on EVERY day, not just that
 * one."*
 *
 * The owner's half of that is a decision and stays a decision (it is listed under Open concerns in
 * the status notes). What was never automated is the FACT the decision is about — that `predicted` is a
 * field on the task, so an edge-drag in tomorrow's column reaches back into today. `edge-drag.spec.js`
 * asserts only that the block in THAT column grew; it says nothing about the neighbouring days, so a
 * change that quietly made the override per-day would leave that file green and this decision moot
 * without anyone noticing.
 *
 * Pinning it makes the consequence a tripwire: if it is ever made per-day on purpose, this spec is
 * the thing that has to be rewritten deliberately.
 */
const { test, expect } = require('@playwright/test');
const { bootDays, cleanDaySettings, timelineBlocks, settleTimeline, dayColumns, task } = require('./_seed');

const WINDOW_MIN = 600;
const fixture = () => ({
  settings: cleanDaySettings('10:00'),
  tasks: [
    task('rz', 'Resize me', { start: '0d', end: '+4d', planned: 100, priority: 1 }),
    task('fl', 'Filler', { start: '0d', end: '+4d', planned: 500, priority: 2 }),
  ],
});

const inCol = (blocks, day, name) => blocks.filter((b) => b.day === day && b.title === name);
const pxPerMin = (blocks) => blocks.reduce((s, b) => s + b.h + 2, 0) / WINDOW_MIN;
const mins = (blocks, px) => blocks.reduce((s, b) => s + (b.h + 2) / px, 0);

async function dragEdge(page, box, dy) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 12 });
  await page.mouse.up();
  await settleTimeline(page);
}

test.describe('V4.2 — an edge-drag is per TASK, not per day', () => {
  test('resizing in tomorrow\'s column changes today\'s allotment too', async ({ page }) => {
    await bootDays(page, 'day4', fixture());
    const cols = await dayColumns(page);
    const today = cols[0].day, tomorrow = cols[1].day;

    const before = await timelineBlocks(page);
    const pxT = pxPerMin(before.filter((b) => b.day === today));
    const pxN = pxPerMin(before.filter((b) => b.day === tomorrow));
    const wasToday = mins(inCol(before, today, 'Resize me'), pxT);
    const wasTomorrow = mins(inCol(before, tomorrow, 'Resize me'), pxN);
    expect(inCol(before, today, 'Resize me'), 'fixture: one block per task per column').toHaveLength(1);
    expect(Math.abs(wasToday - wasTomorrow), 'fixture: both days start at the same allotment')
      .toBeLessThan(5);

    const handle = page.locator(`[data-tl-col="${tomorrow}"] [data-tl-edge-task="rz"]`);
    await expect(handle, 'the handle under test is the one in TOMORROW\'s column').toHaveCount(1);
    await dragEdge(page, await handle.boundingBox(), 120);

    const after = await timelineBlocks(page);
    const nowTomorrow = mins(inCol(after, tomorrow, 'Resize me'), pxN);
    const nowToday = mins(inCol(after, today, 'Resize me'), pxT);

    expect(nowTomorrow, 'precondition: the drag did something in the column it happened in')
      .toBeGreaterThan(wasTomorrow + 20);
    /* THE assertion, and the whole point of the owner's decision: the day that was never touched
       moved by the same amount. */
    expect(nowToday, "today's allotment followed the future column's resize")
      .toBeGreaterThan(wasToday + 20);
    expect(Math.abs(nowToday - nowTomorrow), 'both days hold the one per-task override')
      .toBeLessThan(5);
    expect(after.filter((b) => b.pinned), 'and an edge-drag still pins nothing').toHaveLength(0);
  });
});
