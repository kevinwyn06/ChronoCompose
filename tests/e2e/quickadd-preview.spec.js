// @ts-check
/* UI revamp block 5 — the quick-add preview says what the commit saves, on a live mount.
 *
 * The unit layer (tests/ui-revamp-quickadd.test.js) proves preview == saved for a table of phrasings by
 * running `quickChips` on both the shaped preview and the committed task. What only a live mount shows is
 * that the chips a user actually SEES in the popup — typed through real keystrokes — carry those labels
 * and values, that Enter writes the same fields to storage, and that the card closes behind a
 * confirmation toast.
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

const card = (page) => page.locator('[data-pp-dialog="quick"]');
const storedByName = (page, name) => page.evaluate((n) =>
  (JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((t) => t.name === n) || null), name);
const chips = (page) => page.locator('[data-qa="quick-chip"]').evaluateAll((els) =>
  els.map((e) => ({ kind: e.getAttribute('data-kind'), text: e.textContent })));

async function typeQuick(page, text) {
  await page.keyboard.press('q');
  await expect(card(page)).toBeVisible();
  await page.keyboard.type(text);
  await expect(page.locator('[data-qa="quick-chip"]').first()).toBeVisible();
  return chips(page);
}

const fixture = () => ({ tasks: [task('anchor', 'Anchor task', { start: '+1d', end: '+2d', planned: 30 })] });

test('a bare duration next to a clock: the chips say Starts/Ends/Takes and storage agrees', async ({ page }) => {
  await boot(page, fixture());
  const pv = await typeQuick(page, 'Email advisor Friday 2pm 30m');
  const byKind = Object.fromEntries(pv.map((c) => [c.kind, c.text]));
  expect(byKind.start).toMatch(/^StartsFri \w{3} \d{2}, 2:00pm$/);
  expect(byKind.end).toBe('Ends2:30pm');
  expect(byKind.takes).toBe('Takes30m');

  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('[data-pp-toast]')).toContainText('Added “Email advisor”');
  await expect(page.locator('[data-pp-toast-undo]')).toBeVisible();
  const t = await storedByName(page, 'Email advisor');
  expect(t, 'saved with a clean title').not.toBeNull();
  const s = new Date(t.start), e = new Date(t.end);
  expect([s.getDay(), s.getHours(), s.getMinutes()]).toEqual([5, 14, 0]);
  expect([e.getHours(), e.getMinutes()]).toEqual([14, 30]);
  expect(t.planned).toBe(30);
});

test('a deadline plus a duration previews the start it saves', async ({ page }) => {
  await boot(page, fixture());
  const pv = await typeQuick(page, 'Report by Oct 20 at 5pm for 3h');
  const byKind = Object.fromEntries(pv.map((c) => [c.kind, c.text]));
  expect(byKind.start).toMatch(/2:00pm$/);
  expect(byKind.end).toBe('Ends5:00pm');
  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveCount(0);
  const t = await storedByName(page, 'Report');
  expect(new Date(t.start).getHours()).toBe(14);
  expect(new Date(t.end).getHours()).toBe(17);
});

test('a day range previews and saves the day it names as the end', async ({ page }) => {
  await boot(page, fixture());
  const pv = await typeQuick(page, 'Trip from Oct 10 to Oct 12');
  const byKind = Object.fromEntries(pv.map((c) => [c.kind, c.text]));
  expect(byKind.end).toMatch(/^Ends\w{3} Oct 12$/);
  await page.keyboard.press('Enter');
  const t = await storedByName(page, 'Trip');
  const e = new Date(t.end);
  expect([e.getMonth(), e.getDate(), e.getHours()]).toEqual([9, 12, 0]);
});
