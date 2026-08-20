const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner, 2026-08-19: "esc should be able to get the user out of fields like the planned duration."
   The detail sheet's Planned box is `durInput('planned')` (index.html:13694) — an uncontrolled
   `input.pp-num` whose onBlur writes through `setPlanned`. That is exactly why Escape must REVERT before
   it blurs: a bare blur would save, making Escape the one key in the ladder that commits. */

const fixture = () => ({ seedOnce: true, tasks: [task('a', 'Write', { start: '0d', end: '+1d', planned: 60 })] });

async function openSheet(page) {
  await page.locator('[data-task-id="a"] [data-task-name]').click();
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();
}

/* The sheet's Planned box. Addressed by its own `data-field` hook, not by input order: the task
   sheet ROW behind the overlay also renders an `input.pp-num`, and `.first()` matched that one. */
const plannedBox = (page) => page.locator('[data-field="planned"]');

test('Escape reverts a field and leaves it, without closing the sheet', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const dur = plannedBox(page);
  await dur.click();
  const before = await dur.inputValue();
  expect(before).not.toBe('');

  await dur.fill('9:99');
  await page.keyboard.press('Escape');

  await expect(dur).toHaveValue(before, { timeout: 3000 });
  await expect(dur).not.toBeFocused();
  // one press = one layer: the sheet the field lives in is still open
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();
});

test('Escape in a field records no undo entry — the value is unchanged after a reload', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const dur = plannedBox(page);
  await dur.click();
  const before = await dur.inputValue();
  await dur.fill('9:99');
  await page.keyboard.press('Escape');

  // A commit would have written the task and shown up here; a revert-then-blur writes nothing.
  await page.reload();
  await page.locator('[data-task-id="a"]').first().waitFor({ state: 'attached', timeout: 15000 });
  await openSheet(page);
  await expect(plannedBox(page)).toHaveValue(before);
});

test('a second Escape still closes the sheet — the field rung takes exactly one press', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const dur = plannedBox(page);
  await dur.click();
  await page.keyboard.press('Escape');           // rung 0: leaves the field
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');           // the ladder continues as before
  await expect(page.getByText('DESCRIPTION', { exact: true })).toHaveCount(0);
});
