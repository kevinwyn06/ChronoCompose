// @ts-check
/* UI revamp block 4 — the shared Dialog primitive, under real keyboard and pointer input.
 *
 * The unit layer (tests/ui-revamp-dialog.test.js) pins the dialog attributes, the close-saves paths,
 * the When-line partial-parse refusal, the end formatter and the subtask flow. What only a live mount can
 * show is FOCUS: that it moves into the dialog on open, that real Tab / Shift+Tab presses cycle inside it
 * rather than walking the sheet behind the backdrop, that Escape leaves a field before it closes the
 * dialog, that focus comes back to the row afterwards — and that a real backdrop click (which removes the
 * focused title editor before any blur could fire) no longer throws the title edit away.
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');
const dialog = (page) => page.locator('[data-pp-dialog="detail"]');
const stored = (page, id) => page.evaluate((tid) =>
  (JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((t) => t.id === tid) || {}), id);
const focusInDialog = (page) => page.evaluate(() => {
  const d = document.querySelector('[data-pp-dialog="detail"]');
  return !!d && d.contains(document.activeElement);
});

const fixture = () => ({
  tasks: [
    task('a', 'Alpha task', { start: '+1d', end: '+3d', planned: 60 }),
    task('b', 'Beta task', { start: '+1d', end: '+2d', planned: 30 }),
  ],
});

async function openRow(page, name) {
  const box = await rows(page).filter({ hasText: name }).locator('[data-task-name]').boundingBox();
  if (!box) throw new Error('no row box for ' + name);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialog(page)).toBeVisible();
}

test('detail: focus moves in, Tab cycles inside, Esc leaves the field then closes, focus returns to the row', async ({ page }) => {
  await boot(page, fixture());
  await openRow(page, 'Alpha task');
  await expect(dialog(page)).toHaveAttribute('role', 'dialog');
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  expect(await focusInDialog(page), 'focus is inside the dialog on open').toBe(true);

  /* Forty Tabs used to walk the sheet behind the backdrop without ever entering the dialog. Now every
     stop — forward and back, including the wrap at both ends — stays inside it. */
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await focusInDialog(page), 'Tab #' + (i + 1) + ' stays inside').toBe(true);
    seen.add(await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80)));
  }
  expect(seen.size, 'Tab actually moves between controls').toBeGreaterThan(5);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInDialog(page), 'Shift+Tab #' + (i + 1) + ' stays inside').toBe(true);
  }

  /* Into a field: the Links box. The first Escape leaves the field and keeps focus in the dialog; the
     second closes it. Stray letters in between must not fire global shortcuts (`n` used to jump to Focus). */
  await page.locator('[data-pp-dialog="detail"] input[placeholder^="https://"]').focus();
  await page.keyboard.press('Escape');
  await expect(dialog(page), 'the first Escape does not close').toBeVisible();
  expect(await focusInDialog(page)).toBe(true);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('placeholder')),
    'but it has left the field').toBe(null);
  await page.keyboard.press('n');
  await expect(dialog(page), 'a bare letter does nothing while the dialog is open').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => {
    const a = document.activeElement; return a && a.getAttribute('data-task-id');
  }), { message: 'focus returns to the task row' }).toBe('a');
});

test('a title edit survives closing the detail by clicking the backdrop', async ({ page }) => {
  await boot(page, fixture());
  await openRow(page, 'Beta task');
  const title = page.locator('[data-pp-dialog="detail"] [data-qa="title-editor"]');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and gamma');
  /* The backdrop is the scrim around the card: click its top-left corner, well clear of the card. */
  await page.mouse.click(8, 300);
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page, 'b')).name).toBe('Beta task and gamma');
  await expect(rows(page).filter({ hasText: 'Beta task and gamma' })).toHaveCount(1);
});

test('quick add: focus starts in the input, Tab stays in the card, one Escape closes', async ({ page }) => {
  await boot(page, fixture());
  await page.keyboard.press('q');
  const card = page.locator('[data-pp-dialog="quick"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.type('Call the bank');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('[data-pp-dialog="quick"]').contains(document.activeElement)),
      'Tab #' + (i + 1) + ' stays in quick add').toBe(true);
  }
  await page.locator('[data-pp-dialog="quick"] input').focus();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('the When line refuses a partial parse until it is explicitly applied', async ({ page }) => {
  await boot(page, fixture());
  await openRow(page, 'Alpha task');
  const before = await stored(page, 'a');
  await page.locator('[data-qa="when-line"]').click();
  const input = page.locator('[data-qa="when-input"]');
  await input.fill('next tuesday-ish probably');
  await expect(page.locator('[data-qa="when-live-warn"]')).toContainText('probably');
  await input.press('Enter');
  await expect(page.locator('[data-qa="when-partial"]')).toBeVisible();
  const mid = await stored(page, 'a');
  expect([mid.start, mid.end], 'Enter did not apply the partial parse').toEqual([before.start, before.end]);
  await page.locator('[data-qa="when-apply-anyway"]').click();
  await expect(page.locator('[data-qa="when-line"]')).toBeVisible();
  await expect.poll(async () => (await stored(page, 'a')).start).not.toBe(before.start);
});

test('date picker: arrow keys move the day and Tab reaches Done before Clear', async ({ page }) => {
  await boot(page, fixture());
  /* The sheet's Start cell opens the shared picker. */
  const row = rows(page).filter({ hasText: 'Beta task' });
  await row.locator('[data-date-cell="start"]').first().click();
  await expect(page.locator('[data-qa="dp-head"]')).toHaveText(/^Start/);
  const day = page.locator('[role="gridcell"][tabindex="0"]');
  await expect(day).toHaveCount(1);
  const d0 = Number(await day.getAttribute('data-dp-day'));
  await day.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await page.locator('[role="gridcell"][tabindex="0"]').getAttribute('data-dp-day'))).not.toBe(d0);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role')),
    'focus follows the moved day').toBe('gridcell');
  const order = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
    .filter((s) => s === 'Done' || s === 'Clear'));
  expect(order.indexOf('Done')).toBeLessThan(order.indexOf('Clear'));
});
