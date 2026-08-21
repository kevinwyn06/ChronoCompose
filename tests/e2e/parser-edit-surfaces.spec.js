const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

const fixture = {
  tasks: [{
    id: 'parse-edit', name: 'Call mom', type: 'Proportional', included: true, planned: 60,
    start: '0d+9h', end: '0d+10h', startClock: true, endClock: true,
  }],
};

const stored = (page) => page.evaluate(() => {
  const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return tasks.find(t => t.id === 'parse-edit');
});

test('detail title and date picker both consume the shared parser shape', async ({ page }) => {
  await boot(page, fixture);
  await page.locator('[data-task-id="parse-edit"] [data-task-name]').click();

  const title = page.locator('.pp-edit[contenteditable="true"]');
  await title.fill('Call mom Friday');
  await title.press('Enter');
  /* Task 16 (2026-08-20): the recognised word STAYS in the title. It used to be eaten, which read as
     the app deleting text you had just typed; the highlight is what reports that the date was taken. */
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom Friday');
  let task = await stored(page);
  expect(new Date(task.start).getDay()).toBe(5);
  expect(task.end).toBeNull();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom');
  task = await stored(page);
  expect(new Date(task.start).getHours()).toBe(9);
  expect(new Date(task.end).getHours()).toBe(10);

  const startField = page.getByText('Start', { exact: true }).locator('..').getByTitle('Click to edit');
  await startField.click();
  const natural = page.locator('input[placeholder="tomorrow 5pm"]');
  await natural.fill('5-6pm');
  await natural.press('Enter');

  await expect.poll(async () => (await stored(page)).startClock).toBe(true);
  task = await stored(page);
  expect(new Date(task.start).getHours()).toBe(17);
  expect(new Date(task.end).getHours()).toBe(18);
  expect(task.endClock).toBe(true);
  expect(task.planned).toBe(60);
});

/* Task 16 — the highlight itself. This needs a browser: the mirror is a second layer painted behind an
   uncontrolled contenteditable, and "the spans line up with the words" is a resolved-layout fact. */
test('editing a title highlights the temporal span it took, live', async ({ page }) => {
  await boot(page, fixture);
  await page.locator('[data-task-id="parse-edit"] [data-task-name]').click();

  const title = page.locator('[data-qa="title-editor"]');
  const marks = page.locator('[data-qa="title-highlight"]');
  await expect(marks).toHaveCount(0, 'nothing temporal in "Call mom"');

  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' today');
  /* MID-EDIT, before any commit: the highlight is feedback while you type, exactly as in quick-add. */
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveText(/today/);

  /* And it lines up with the word it claims: the mark sits inside the editor's own box. */
  const mark = await marks.first().boundingBox();
  const box = await title.boundingBox();
  expect(mark.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(mark.x + mark.width).toBeLessThanOrEqual(box.x + box.width + 1);

  await title.press('Enter');
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom today');
  const task = await stored(page);
  const d = new Date(task.start);
  const now = new Date();
  expect([d.getFullYear(), d.getMonth(), d.getDate()])
    .toEqual([now.getFullYear(), now.getMonth(), now.getDate()]);
});
