const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The inclusion popover.

   Track B's central decision was that inclusion is NOT a checkbox: pressed / unpressed / snoozed are
   independently meaningful, so the glyph opens a menu instead of flipping a boolean. That decision is
   only observable end-to-end — the unit layer can prove `inclActionRows` returns the right labels for
   a given state, but not that a real click on the glyph reaches it, that the menu paints above the
   grid, or that a click on the backdrop dismisses it without writing anything.

   So this file asserts the *user-facing contract of the menu*: which actions each state offers, that
   choosing one both commits and closes, and that dismissing commits nothing. It deliberately does not
   assert popover geometry — the `uiPt`/zoom placement maths is unit-tested (`scaleFixedPt`), and
   pinning pixel positions here would break on any layout change without describing a real regression. */

const glyph = (page, id) => page.locator(`[data-card-id="${id}"] span[title$="click to change"], ` +
  `[data-card-id="${id}"] span[title$="click to include"]`);
const menuItem = (page, label) => page.getByText(label, { exact: true });
const cardIn = (page, cellSel, name) =>
  page.locator(`${cellSel} [data-card-id]`).filter({ hasText: name });

/* A window that has NOT OPENED yet, force-included: the task is pressed, but nothing would pull it
   back into today on its own. That matters, because `setIncludedOff` snoozes rather than unpresses
   whenever something WOULD pull the task back — V2.2 inheritance, and since V5 block 20 (F19) also
   auto-inclusion on the day a window opens. A fixture that drifted into either would silently change
   which branch these tests exercise: the take-out would land on `snoozed` instead of `unpressed`. */
const pressed = [task('inc-1', 'Popover task', { start: '+2d', end: '+4d', included: true })];

test.describe('inclusion popover', () => {
  test('the glyph opens a menu; a pressed task is offered snooze and take-out', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await expect(menuItem(page, 'Take out of today')).toHaveCount(0);
    await glyph(page, 'inc-1').click();

    await expect(menuItem(page, 'Snooze today')).toBeVisible();
    await expect(menuItem(page, 'Take out of today')).toBeVisible();
    /* Owner rule (2026-08-04): this popover is STRICTLY inclusion. "Make active now" lived here in
       V2.4 and was deliberately removed — activation is double-click. Pinned so it cannot creep back. */
    await expect(menuItem(page, 'Make active now')).toHaveCount(0);
  });

  test('"Take out of today" moves the card to Excluded and closes the popover', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Popover task')).toHaveCount(1);

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Take out of today').click();

    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);
    await expect(menuItem(page, 'Take out of today')).toHaveCount(0);
  });

  test('the menu re-reads state: an unpressed task is offered the way back IN', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Take out of today').click();
    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);

    /* The standing tenet: the laziest path must never silently drop work. Whatever the excluded state
       is called, the popover has to offer a route back — that is what is being pinned here. */
    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Press into today')).toBeVisible();
    await menuItem(page, 'Press into today').click();

    await expect(cardIn(page, '[data-selcell$="-included"]', 'Popover task')).toHaveCount(1);
  });

  test('clicking the backdrop dismisses without changing anything', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Take out of today')).toBeVisible();

    /* The backdrop is a full-screen fixed layer under the card; the top-left corner is always it and
       never the menu (the menu is anchored under a glyph that is never at the origin). */
    await page.mouse.click(4, 4);

    await expect(menuItem(page, 'Take out of today')).toHaveCount(0);
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Popover task')).toHaveCount(1);
  });

  test('"Snooze today" excludes the task for today', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Snooze today').click();

    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);
    /* A snoozed task reports a DIFFERENT state than an unpressed one, and its menu says so —
       "Turn on", not "Press into today". Two excluded states that read alike is the exact failure
       `isUndecided` exists to prevent. */
    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Turn on')).toBeVisible();
    await expect(menuItem(page, 'Press into today')).toHaveCount(0);
  });
});
