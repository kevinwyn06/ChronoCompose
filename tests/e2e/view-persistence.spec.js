/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V2.10 owner user-check"): *"Then reload and confirm the tab you left
 * on is the tab you return to."*
 *
 * The rest of that item is obsolete — the Plan tab was retired by V5 block 27a and its two surfaces
 * moved into Overview's left pane (`overview-rehome.spec.js`). The reload half survived the rehoming
 * intact, and nothing covered it: `tests/v2-plan-tab.test.js` pins the pref MIGRATION, which is what
 * happens to a value already on disk, not whether a real view switch writes one.
 *
 * Note the fixture must be `seedOnce`, or `_seed.js` rewrites `pp-prefs` on the reload and the test
 * would assert the fixture back to itself.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface } = require('./_seed');

const tab = (page, label) => page.locator(`[role="tab"][title="${label}"]`);

test.describe('the view you left on is the view you come back to', () => {
  test('a real tab click survives a reload', async ({ page }) => {
    await bootSurface(page, { view: 'gantt' }, { seedOnce: true });
    await expect(tab(page, 'Gantt'), 'fixture: booted on the Gantt')
      .toHaveAttribute('aria-selected', 'true');

    await tab(page, 'Today').click();
    await expect(tab(page, 'Today')).toHaveAttribute('aria-selected', 'true');

    await page.reload();
    /* THE assertion: the pref was written by the click, not by the fixture (which still says Gantt). */
    await expect(tab(page, 'Today'), 'the reload came back to Today')
      .toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Gantt'), 'and not to the seeded view')
      .toHaveAttribute('aria-selected', 'false');
  });
});
