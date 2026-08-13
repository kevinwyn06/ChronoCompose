/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V3/V4 owner user-check"): *"confirm … that deleting EVERY journal
 * prompt is honoured rather than silently reseeded."*
 *
 * `journal-prompts.spec.js` deletes ONE prompt and then presses Restore defaults. That is not the
 * same claim: the design note says only an *unconfigured* key seeds the defaults, so the interesting
 * state is the CONFIGURED EMPTY one — and the only way it can fail is across a reload, when the boot
 * path re-reads the key and has to tell "empty on purpose" from "never set". A one-prompt delete
 * cannot distinguish those, so this is a genuine gap rather than a restatement.
 *
 * It is here and not in `tests/journal.test.js` because the failure needs a real reload of a real
 * mount: the unit layer pins the store contract, not the boot-time seeding decision.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface } = require('./_seed');

const PANEL = '[data-journal-prompts]';

async function enterEditMode(page) {
  await page.locator('[data-prompts-edit]').click();
  await expect(page.locator('[data-prompt-new]')).toBeVisible();
}

test.describe('V3.2 — an empty prompt set is a state the app can hold', () => {
  test('deleting every prompt sticks across a reload and is not silently reseeded', async ({ page }) => {
    /* Seed once, so the reload below re-reads what the deletions wrote instead of the fixture. */
    await bootSurface(page, { view: 'journal' }, { seedOnce: true });
    await expect(page.locator(PANEL)).toBeVisible();
    await enterEditMode(page);

    const rows = page.locator('[data-prompt-id]');
    const n = await rows.count();
    expect(n, 'fixture: the default set is on screen to be deleted').toBeGreaterThan(0);

    /* Delete them one real click at a time, always the first remaining row — the list re-renders
       after each removal, so a cached handle would go stale. */
    for (let i = 0; i < n; i++) {
      await rows.first().locator('button[title="Delete this prompt"]').click();
      await expect(rows).toHaveCount(n - i - 1);
    }
    await expect(rows, 'every prompt is gone').toHaveCount(0);

    await page.reload();
    await expect(page.locator(PANEL)).toBeVisible();
    /* THE assertion. If boot treated "empty" as "unconfigured" it would seed six defaults back and
       this reads 6 — which is precisely the silent undo the owner asked to be shown. */
    await expect(page.locator('[data-prompt-id]'),
      'an empty set is honoured, not reseeded from the defaults').toHaveCount(0);
    await expect(page.locator(PANEL)).not.toContainText('What did I avoid today?');
  });
});
