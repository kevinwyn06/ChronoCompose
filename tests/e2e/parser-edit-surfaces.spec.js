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
  /* REVERSED by the owner ruling of 2026-08-21, which ships with the When line. Task 16 kept the word
     because the highlight was the only proof the date had been taken — true while the title was the
     only place a parsed date was visible, and untrue once the detail panel gained an editable When
     line. The word is not deleted; it moved one line down, and the assertion below checks it is there. */
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom');
  await expect(page.locator('[data-qa="when-text"]')).toContainText(/Fri/, { timeout: 5000 });
  let task = await stored(page);
  expect(new Date(task.start).getDay()).toBe(5);
  expect(task.end).toBeNull();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom');
  task = await stored(page);
  expect(new Date(task.start).getHours()).toBe(9);
  expect(new Date(task.end).getHours()).toBe(10);

  /* The Start field is gone — the When line replaced Start, Due and Duration (owner ruling 2026-08-21).
     The date picker it opened is still reachable from the Gantt bar and the sheet's date cells, and the
     shared parser shape it consumes is now exercised through the When line itself, which runs the very
     same `parseDateText` -> `shapeParsedTask` binding. */
  await page.locator('[data-qa="when-line"]').click();
  const natural = page.locator('[data-qa="when-input"]');
  await natural.fill('today 5-6pm');
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
  /* Committed: the span is consumed and now lives on the When line (2026-08-21 reversal). The mirror
     above is unaffected — it is the live feedback DURING the edit, and that is still its job. */
  await expect.poll(async () => (await stored(page)).name).toBe('Call mom');
  const task = await stored(page);
  const d = new Date(task.start);
  const now = new Date();
  expect([d.getFullYear(), d.getMonth(), d.getDate()])
    .toEqual([now.getFullYear(), now.getMonth(), now.getDate()]);
});
