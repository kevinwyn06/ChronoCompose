const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

test('Google Calendar Settings exposes one two-way contract and explicit backfill', async ({ page }) => {
  await boot(page, { settings:{ gcalTwoWay:false } }); // retired persisted value must not restore the old mode
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name:'Integrations' }).click();

  const drawer = page.getByText('Google Calendar', { exact:true }).locator('..').locator('..');
  await expect(page.getByText('Two-way sync (beta)', { exact:true })).toHaveCount(0);
  await expect(page.getByText(/one-way/i)).toHaveCount(0);
  await expect(page.getByText(/local changes.*push to Google/i)).toBeVisible();
  await expect(page.getByRole('button', { name:/Backfill to Google/ })).toBeVisible();
  await expect(page.getByRole('button', { name:/Backfill to Google/ })).toBeDisabled();
  await expect(drawer).toBeVisible();
});
