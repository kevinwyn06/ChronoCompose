const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner rulings 2026-08-21 — the When line and the title strip — proved end to end.
 *
 * The unit layer owns the six shapes, the failure state and the strip rule
 * (tests/owner-2026-08-21-when-line.test.js). This file exists for what only a live mount can show:
 *
 *   1. That Start, Due and Duration are actually GONE from the panel. A ruling that says "replaces"
 *      is not satisfied by adding a line beside the fields it was meant to retire — option B in the
 *      mockup, explicitly drawn as the migration step and not the destination.
 *   2. That a bad parse leaves the task alone AND leaves the typed text in the box to fix. That is the
 *      case the whole text-editor approach has to earn, and it is a DOM fact: the value stays.
 *   3. That the two rulings work as one — a date typed into the title disappears from the title and
 *      reappears, editable, on the When line, in the same commit.
 */

const fixture = () => ({
  seedOnce: true,
  tasks: [task('a', 'Write the report', { start: '+1d', end: null, planned: 45 })],
});

async function openSheet(page) {
  await page.locator('[data-task-id="a"] [data-task-name]').click();
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible({ timeout: 15000 });
}

const stored = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(t => t.id === 'a'));

test('the When line REPLACES Start, Due and Duration rather than joining them', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  await expect(page.locator('[data-qa="when-line"]')).toBeVisible();
  /* The load-bearing negatives. Option B — sentence plus a read-only echo of the fields — is two
     sources of truth on one screen, and the ruling said the sentence *replaces* them. */
  /* Scoped to the sidebar the When line lives in: the sheet's COLUMN HEADERS behind the overlay are
     also called Start and Planned, and matching those would make this assertion unfalsifiable. */
  const sidebar = page.locator('[data-qa="detail-sidebar"]');
  await expect(sidebar.getByText('Start', { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText('Due', { exact: true })).toHaveCount(0);
  /* Ruling 8: Planned is not repeated outside the When block; the sub-line carries it. */
  await expect(sidebar.getByText('Planned', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-qa="when-sub"]')).toContainText('45m planned');
  await expect(page.locator('[data-qa="when-chip"]')).toHaveText('all day');
});

test('an unreadable sentence keeps the typed text and never destroys the stored date', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);
  const before = await stored(page);

  await page.locator('[data-qa="when-line"]').click();
  const input = page.locator('[data-qa="when-input"]');
  await input.fill('sometime after the thing probably');
  await input.press('Enter');

  /* The refusal is visible, the bad text is still there to fix, and the task is untouched. A form
     could not have produced this state; a text editor can, which is why it has to handle it well. */
  await expect(page.locator('[data-qa="when-error"]')).toBeVisible({ timeout: 5000 });
  await expect(input).toHaveValue('sometime after the thing probably');
  const after = await stored(page);
  expect(after.start).toBe(before.start);
  expect(after.end).toBe(before.end);
  expect(after.planned).toBe(before.planned);
});

test('"N times" is refused by name, because the model stores an end date and not a count', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  await page.locator('[data-qa="when-line"]').click();
  const input = page.locator('[data-qa="when-input"]');
  await input.fill('every monday, 5 times');
  await input.press('Enter');

  const err = page.locator('[data-qa="when-error"]');
  await expect(err).toBeVisible({ timeout: 5000 });
  /* An honest refusal that also says what CAN be written. Silently converting it to "until 22 Sep"
     would rewrite what the user typed, and that date goes wrong the moment the interval is edited. */
  await expect(err).toContainText('until');
  expect((await stored(page)).recur).toBeFalsy();
});

test('editing the line re-parses it, and the line reads back what was applied', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  await page.locator('[data-qa="when-line"]').click();
  const input = page.locator('[data-qa="when-input"]');
  await input.fill('tomorrow 3-4pm');
  await input.press('Enter');

  await expect.poll(async () => (await stored(page)).end != null, { timeout: 5000 }).toBe(true);
  const t = await stored(page);
  expect(await page.evaluate(ms => new Date(ms).getHours(), t.start)).toBe(15);
  expect(await page.evaluate(ms => new Date(ms).getHours(), t.end)).toBe(16);

  /* The display IS the editor, so what it reads back has to be what was stored. */
  await expect(page.locator('[data-qa="when-chip"]')).toHaveText('1h');
  await expect(page.locator('[data-qa="when-text"]')).toContainText('3:00pm');
});

test('a date typed into the title leaves the title and lands on the When line, in one commit', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const title = page.locator('[data-qa="title-editor"]');
  await title.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Write the report next tuesday 3pm', { delay: 5 });
  await page.keyboard.press('Enter');

  /* This is the pair of rulings working as one. The strip is only safe because the line exists: take
     the word out of the title before there is somewhere to show it and the date is applied, deleted
     and invisible — worse than either ruling's status quo. */
  await expect.poll(async () => (await stored(page)).name, { timeout: 10000 }).toBe('Write the report');
  await expect(page.locator('[data-qa="when-text"]')).toContainText('3:00pm');

  /* And it is one commit: a single undo restores the title AND the date together. The name is the same
     either side here, so the DATE is what proves it — back to the seeded bare day, chip and all. */
  const clocked = (await stored(page)).start;
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await stored(page)).start, { timeout: 5000 }).not.toBe(clocked);
  await expect(page.locator('[data-qa="when-chip"]')).toHaveText('all day', { timeout: 5000 });
  expect((await stored(page)).name).toBe('Write the report');
});

test('rewording a title that still contains its own date word leaves the word alone', async ({ page }) => {
  await boot(page, { seedOnce: true, tasks: [task('a', 'Move the deploy', { start: null, end: null })] });
  await openSheet(page);

  const title = page.locator('[data-qa="title-editor"]');
  const retitle = async (text) => {
    await title.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press('Enter');
  };

  await retitle('Move the friday deploy');
  await expect.poll(async () => (await stored(page)).name, { timeout: 10000 }).toBe('Move the deploy');
  const dated = (await stored(page)).start;
  expect(dated).not.toBeNull();

  /* Now the word is back in the title as ordinary prose, and re-committing must NOT re-consume it: the
     parse yields the date the task already holds, which is not new information. Without this rule the
     strip would silently reschedule work every time its wording was edited. */
  await retitle('Move the friday deploy to staging');
  await expect.poll(async () => (await stored(page)).name, { timeout: 10000 })
    .toBe('Move the friday deploy to staging');
  expect((await stored(page)).start).toBe(dated);
});
