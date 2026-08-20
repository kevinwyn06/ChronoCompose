const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The inclusion popover.

   Track B's central decision was that inclusion is NOT a checkbox: pressed / unpressed / snoozed are
   independently meaningful, so the glyph opens a menu instead of flipping a boolean. That decision is
   only observable end-to-end — the unit layer can prove `inclActionRows` returns the right labels for
   a given state, but not that a real click on the glyph reaches it, that the menu paints above the
   grid, or that a click on the backdrop dismisses it without writing anything.

   AMENDED 2026-08-12 (owner: "ticking a task from unincluded to included should not bring up a
   confirmation popup"). The menu stays for every state that offers a CHOICE — pressed and snoozed both
   do — but the unpressed state offered exactly one action, "Press into today", so it was a menu with
   nothing to choose from: a confirmation dialog bolted to a checkbox. Clicking an unpressed glyph now
   performs that single action directly. Track B's decision is intact; the degenerate case is not a
   counter-example to it.

   So this file asserts the *user-facing contract*: which actions each state offers, that choosing one
   both commits and closes, that dismissing commits nothing, and that the one-outcome state acts
   immediately. It deliberately does not assert popover geometry — the `uiPt`/zoom placement maths is
   unit-tested (`scaleFixedPt`), and pinning pixel positions here would break on any layout change
   without describing a real regression. */

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

    /* Owner (2026-08-19): "Snooze today and take out of today are practically the exact same thing and
       is therefore useless." Three distinct actions now — "Snooze today" was renamed "Not today" and an
       open-ended snooze sits between it and the unpress. */
    await expect(menuItem(page, 'Not today')).toBeVisible();
    await expect(menuItem(page, 'Snooze indefinitely')).toBeVisible();
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

  test('an unpressed task goes back IN with one click, and no menu appears', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Take out of today').click();
    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);

    /* The standing tenet is unchanged and still what is pinned here: the laziest path must never
       silently drop work, so the excluded state MUST offer a route back. Since 2026-08-12 that route is
       the click itself rather than a one-item menu — strictly fewer steps, same destination. */
    await glyph(page, 'inc-1').click();
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Popover task')).toHaveCount(1);

    /* And it really was direct: no menu was opened on the way, so nothing is left hanging over the
       grid and no second click was required. */
    await expect(menuItem(page, 'Press into today')).toHaveCount(0);
    await expect(menuItem(page, 'Take out of today')).toHaveCount(0);
  });

  test('the round trip is repeatable: out, in, out again', async ({ page }) => {
    /* Guards the asymmetry introduced above — one direction is a click, the other a menu. If the glyph
       ever lost track of which state it is in, the second lap is where it would show. */
    await bootPlan(page, 'select', { tasks: pressed });
    const included = () => cardIn(page, '[data-selcell$="-included"]', 'Popover task');
    const excluded = () => cardIn(page, '[data-selcell$="-excluded"]', 'Popover task');

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Take out of today').click();
    await expect(excluded()).toHaveCount(1);

    await glyph(page, 'inc-1').click();
    await expect(included()).toHaveCount(1);

    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Take out of today')).toBeVisible();
    await menuItem(page, 'Take out of today').click();
    await expect(excluded()).toHaveCount(1);
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

  test('"Not today" excludes the task for today', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Not today').click();

    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);
    /* A snoozed task reports a DIFFERENT state than an unpressed one, and its menu says so —
       "Turn on", not "Press into today". Two excluded states that read alike is the exact failure
       `isUndecided` exists to prevent. */
    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Turn on')).toBeVisible();
    await expect(menuItem(page, 'Press into today')).toHaveCount(0);
  });

  test('"Snooze indefinitely" excludes the task and names its wake triggers', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Snooze indefinitely').click();

    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Popover task')).toHaveCount(1);

    /* A dateless snooze has no day to print, so the popover names the EVENTS that end it instead. */
    await glyph(page, 'inc-1').click();
    await expect(page.getByText('until it starts, falls due', { exact: false })).toBeVisible();
    await expect(menuItem(page, 'Turn on')).toBeVisible();
  });
});
