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
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom');
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
