const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

/* UI revamp block 11b: signed out, the Calendar section cannot work (gcalConnect needs the account session),
   so it offers nothing that would fail — no connect, Backfill or Import — only the reason and Sign in. The
   signed-in contract (two-way copy, explicit Backfill) needs a live session the e2e layer cannot fake; it is
   pinned in tests/owner-session-gcal-two-way.test.js and tests/ui-revamp-truth.test.js. */
test('Google Calendar Settings, signed out: no dead controls, a reason and a Sign in that lands on the email field', async ({ page }) => {
  await boot(page, { settings:{ gcalTwoWay:false } }); // retired persisted value must not restore the old mode
  await page.getByRole('button', { name:'Settings', exact:true }).click();
  await page.getByRole('tab', { name:'Integrations' }).click();

  await expect(page.getByText('Two-way sync (beta)', { exact:true })).toHaveCount(0);
  await expect(page.getByText(/one-way/i)).toHaveCount(0);
  await expect(page.getByText('Sign in to your account to connect Google Calendar.')).toBeVisible();
  await expect(page.getByRole('button', { name:/Sign in with Google/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name:/Backfill to Google/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name:/Import now/ })).toHaveCount(0);
  await expect(page.getByText(/already on Google/)).toHaveCount(0);
  await expect(page.getByText(/config\.js|static-server|\.telemetry/)).toHaveCount(0);

  await page.locator('[data-settings-signin]').click();
  await expect(page.locator('[data-settings-email]')).toBeFocused();
});

test('Settings tabs answer the arrow keys and name their panel', async ({ page }) => {
  await boot(page, {});
  await page.getByRole('button', { name:'Settings', exact:true }).click();
  const general = page.getByRole('tab', { name:'General' });
  await expect(general).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name:'Scheduling' })).toBeFocused();
  await expect(page.getByRole('tab', { name:'Scheduling' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'pp-settings-tab-scheduling');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name:'Data' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(general).toBeFocused();
});
