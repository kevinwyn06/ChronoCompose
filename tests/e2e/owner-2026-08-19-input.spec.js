const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner, 2026-08-19: "esc should be able to get the user out of fields like the planned duration."
   Rung 0 of the Escape ladder must REVERT before it blurs: a bare blur would save, making Escape the one
   key in the ladder that commits.

   The subject moved on 2026-08-21. The Planned box is gone — the When line replaced Start, Due and
   Duration, and owner ruling 8 says Planned is not repeated outside that block. The When input is the
   better subject anyway, and not only because it is what is there: it is the field where a cancel is
   most load-bearing, because the thing being cancelled is a re-parse of the task's whole date state.
   It is an uncontrolled `input.pp-num` whose onBlur writes through `applyWhenText`, which is exactly the
   shape rung 0 was written for — and `applyWhenText` treats a re-commit of the unchanged sentence as a
   real no-op, so the revert-then-blur leaves no undo entry behind. */

const fixture = () => ({ seedOnce: true, tasks: [task('a', 'Write', { start: '0d', end: '+1d', planned: 60 })] });

async function openSheet(page) {
  await page.locator('[data-task-id="a"] [data-task-name]').click();
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();
}

/* The sheet's When input. Addressed by its own `data-qa` hook, not by input order: the task sheet ROW
   behind the overlay also renders an `input.pp-num`, and `.first()` matched that one. Opening it is a
   click on the When line, which is a display until you ask to edit it. */
const whenBox = (page) => page.locator('[data-qa="when-input"]');
async function openWhen(page) {
  await page.locator('[data-qa="when-line"]').click();
  await expect(whenBox(page)).toBeFocused({ timeout: 5000 });
  return whenBox(page);
}

test('Escape reverts a field and leaves it, without closing the sheet', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const dur = await openWhen(page);
  const before = await dur.inputValue();
  expect(before).not.toBe('');

  await dur.fill('nonsense that parses to nothing');
  await page.keyboard.press('Escape');

  /* The When line is click-to-edit, so leaving the field returns it to its display form. The revert is
     what that display proves: it reads back the ORIGINAL sentence, not the nonsense that was typed. */
  await expect(whenBox(page)).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('[data-qa="when-text"]')).toHaveText(before);
  // one press = one layer: the sheet the field lives in is still open
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();
});

test('Escape in a field records no undo entry — the value is unchanged after a reload', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  const dur = await openWhen(page);
  const before = await dur.inputValue();
  await dur.fill('nonsense that parses to nothing');
  await page.keyboard.press('Escape');

  // A commit would have written the task and shown up here; a revert-then-blur writes nothing.
  await page.reload();
  await page.locator('[data-task-id="a"]').first().waitFor({ state: 'attached', timeout: 15000 });
  await openSheet(page);
  await expect(await openWhen(page)).toHaveValue(before);
});

test('a second Escape still closes the sheet — the field rung takes exactly one press', async ({ page }) => {
  await boot(page, fixture());
  await openSheet(page);

  await openWhen(page);
  await page.keyboard.press('Escape');           // rung 0: leaves the field
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');           // the ladder continues as before
  await expect(page.getByText('DESCRIPTION', { exact: true })).toHaveCount(0);
});

/* Owner, 2026-08-19: "enter doesn't have, one needs to press enter then done."
   The TIME box's blur only updated the picker's DRAFT; `dpApply` — on the Done button — is what wrote
   the task. Enter now does both, so setting a time costs one key rather than a key and a click. */

const clockedFixture = () => ({
  seedOnce: true,
  tasks: [task('a', 'Write', { start: '0d', end: '+1d', startClock: true, endClock: true })],
});

const timeBox = (page) => page.locator('.pp-num[placeholder="—"]');

test('Enter in the TIME field applies and closes the picker', async ({ page }) => {
  await boot(page, clockedFixture());

  await page.locator('[data-task-id="a"] [data-cellk="start"]').click();
  await expect(page.getByText('START', { exact: true })).toBeVisible();

  await timeBox(page).fill('15:00');
  await page.keyboard.press('Enter');

  await expect(timeBox(page)).toHaveCount(0);                    // the card closed
  await expect(page.locator('[data-task-id="a"] [data-cellk="start"]')).toContainText('3:00');
});

test('Enter in the TIME field is ONE undo entry', async ({ page }) => {
  await boot(page, clockedFixture());
  const cell = page.locator('[data-task-id="a"] [data-cellk="start"]');

  await cell.click();
  await timeBox(page).fill('15:00');
  await page.keyboard.press('Enter');
  await expect(cell).toContainText('3:00');

  await page.keyboard.press('Control+z');                        // a single press must undo the whole edit
  await expect(cell).not.toContainText('3:00');
});

test('blur still commits to the draft without closing, so Tab still works', async ({ page }) => {
  await boot(page, clockedFixture());

  await page.locator('[data-task-id="a"] [data-cellk="start"]').click();
  await timeBox(page).fill('15:00');
  await page.keyboard.press('Tab');

  // the card is still open — this is the only way to set a time and then adjust the date
  await expect(page.getByText('START', { exact: true })).toBeVisible();
});

/* Owner, 2026-08-19: "I'll think 'okay this task is 10pm, I want it to be 9pm instead' and type 9 only
   for it to end up as 9am." The whole round trip, through a real picker. */
test('a task at 10pm, typing 9, becomes 9pm', async ({ page }) => {
  await boot(page, { seedOnce: true, tasks: [
    // '0d+22h' is the seed's day-offset-plus-clock form: today at 22:00.
    task('a', 'Write', { start: '0d+22h', end: '+1d', startClock: true, endClock: true }),
  ] });

  const cell = page.locator('[data-task-id="a"] [data-cellk="start"]');
  await cell.click();
  await expect(page.getByText('START', { exact: true })).toBeVisible();

  await timeBox(page).fill('9');
  await page.keyboard.press('Enter');

  /* Task 13 (2026-08-20): the cell renders through the one clock formatter now, so "9:00pm" rather than
     the browser locale's "9:00 PM". The behaviour under test — which NINE you get — is unchanged. */
  await expect(cell).toContainText('9:00pm');
});
