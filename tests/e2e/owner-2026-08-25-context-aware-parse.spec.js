// Owner ask 2026-08-25 — the title bar reads the task, not only the text.
//
// The rules themselves are unit-tested (tests/owner-2026-08-25-context-aware-parse.test.js). What needs
// a browser is the round trip the owner actually described: real keystrokes into the live
// contenteditable title, committed with Enter, landing in real storage, and read back out on the When
// line one row below. The mock DOM cannot reach the contenteditable or the line that renders the result,
// so a green unit suite is not evidence that a person typing this sees it work.
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

const fixture = {
  tasks: [{
    id: 'ctx-parse', name: 'Deep work', type: 'Proportional', included: true, planned: null,
    start: '0d+20h30m', end: null, startClock: true, endClock: null,
  }],
};

const stored = (page) => page.evaluate(() => {
  const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return tasks.find(t => t.id === 'ctx-parse');
});
const hhmm = (ms) => { const d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

test('a deadline typed into the title keeps the start the task already had', async ({ page }) => {
  await boot(page, fixture);
  await page.locator('[data-task-id="ctx-parse"] [data-task-name]').click();

  const title = page.locator('[data-qa="title-editor"]');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' by 9:00pm');
  await title.press('Enter');

  await expect.poll(async () => (await stored(page)).end).not.toBeNull();
  const t = await stored(page);
  /* The whole point of the ask: 8:30pm was never mentioned in what was typed, and absence is not an
     instruction to delete. Before this change the start came back NULL. */
  expect(hhmm(t.start)).toBe('20:30');
  expect(hhmm(t.end)).toBe('21:00');
  expect(t.startClock).toBe(true);
  expect(t.endClock).toBe(true);

  /* And the words moved rather than vanished — the When line is where they now live. */
  await expect(page.locator('[data-qa="when-text"]')).toContainText(/8:30/, { timeout: 5000 });
  await expect(page.locator('[data-qa="when-text"]')).toContainText(/9:00/);
  expect((await stored(page)).name).toBe('Deep work');
});

test('a duration typed into the title generates the second endpoint', async ({ page }) => {
  await boot(page, fixture);
  await page.locator('[data-task-id="ctx-parse"] [data-task-name]').click();

  const title = page.locator('[data-qa="title-editor"]');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 45m');
  await title.press('Enter');

  await expect.poll(async () => (await stored(page)).end).not.toBeNull();
  const t = await stored(page);
  expect(hhmm(t.start)).toBe('20:30');
  expect(hhmm(t.end)).toBe('21:15');
  expect(t.planned).toBe(45);

  /* Undo restores the pre-edit task in ONE step — the title and the parsed fields share a commit. */
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await stored(page)).end).toBeNull();
  expect(hhmm((await stored(page)).start)).toBe('20:30');
});
