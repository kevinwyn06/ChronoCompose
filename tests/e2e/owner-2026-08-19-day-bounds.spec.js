const { test, expect } = require('@playwright/test');
const {
  bootToday, cleanDaySettings, allottedByTask, settleTimeline, task,
} = require('./_seed');

/* Owner, 2026-08-19: "Instead of having the day start and day end be a setting, have them the dragable
   objects in the timeline views." Plus the follow-up decision: "Global setting, dragged."

   Why e2e and not unit: the clamp, the mutator and the undo record are all pinned in
   `tests/owner-2026-08-19-freeze-past.test.js`. What only a real browser can show is that the handle is
   a genuine hit target under a TRUSTED pointer, that the drag crosses the 4px promotion threshold the
   way every other timeline gesture does, and that Escape aborts it. By the testing rules, dispatched
   MouseEvents skip hit-testing and pointer capture and would prove none of that — so `page.mouse` only.

   ── Reading the window off the screen ─────────────────────────────────────────────────────────────
   There is no test-only global on `window`, and this spec does not add one. The window's length is read
   back through the ALLOTMENT instead: with `cleanDaySettings` (no meals, no free-time reserve,
   packFromNow off) two flexible tasks planned 100:500 saturate the pool, so the two allotments sum to
   the window's minutes and any change to the window shows up as a change in that sum.
   `cleanDaySettings` does NOT zero `breakMin` (it defaults to 3, one per packable family), so the sum
   is the window minus 6 rather than the window exactly — hence the relative assertions below. */

const SETTINGS = cleanDaySettings('10:00');          // 00:00–10:00, a 600-minute window
const fixture = () => ({
  settings: SETTINGS,
  tasks: [
    task('a', 'Alpha', { start: '0d', end: '+4d', planned: 100, priority: 1 }),
    task('b', 'Bravo', { start: '0d', end: '+4d', planned: 500, priority: 2 }),
  ],
});

async function dragHandle(page, which, dyPx, opts) {
  const handle = page.locator('.pp-daybound').nth(which === 'start' ? 0 : 1);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dyPx, { steps: 10 });
  if (opts && opts.escape) await page.keyboard.press('Escape');
  await page.mouse.up();
  await settleTimeline(page);
}

test('the day-start handle is a real hit target and shrinks the window', async ({ page }) => {
  await bootToday(page, fixture());
  const before = await allottedByTask(page);
  expect(before.a + before.b).toBeGreaterThan(500);  // a 600-minute window, less the break reserve

  await dragHandle(page, 'start', 120);              // drag the top edge downwards

  const after = await allottedByTask(page);
  expect(after.a + after.b).toBeLessThan(before.a + before.b);
  expect(after.a + after.b).toBeGreaterThan(0);
});

test('one Ctrl+Z restores both bounds and the packing that followed', async ({ page }) => {
  await bootToday(page, fixture());
  const before = await allottedByTask(page);

  await dragHandle(page, 'start', 120);
  const moved = await allottedByTask(page);
  expect(moved.a + moved.b).not.toBe(before.a + before.b);

  await page.keyboard.press('Control+z');
  await settleTimeline(page);

  const restored = await allottedByTask(page);
  expect(restored.a).toBe(before.a);
  expect(restored.b).toBe(before.b);
});

test('Escape during the drag cancels it and writes nothing', async ({ page }) => {
  await bootToday(page, fixture());
  const before = await allottedByTask(page);

  await dragHandle(page, 'start', 120, { escape: true });

  const after = await allottedByTask(page);
  expect(after.a).toBe(before.a);
  expect(after.b).toBe(before.b);
});

test('the day window no longer appears in Settings', async ({ page }) => {
  await bootToday(page, fixture());
  await expect(page.getByText('Day window', { exact: false })).toHaveCount(0);
});
