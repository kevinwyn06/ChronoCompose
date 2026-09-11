const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The inclusion checkbox and the snooze window.
 *
 * REWRITTEN 2026-09-11 (owner report). What this file asserts is unchanged in KIND — the user-facing
 * contract of the inclusion control — but the division of labour behind it has moved:
 *
 *   Owner, verbatim: *"When ticking the checkbox of an included task, immediately make it excluded and
 *   unticked until it's triggered. Have a seperate button for a scheduled snooze."*
 *
 * The 2026-08-20 asymmetry (ticking acts, unticking asks) held that unticking could not act because
 * "not today", "not until Thursday" and "not until it matters" are three different answers. That is true
 * of the ANSWERS and not of the box: a tick box has two positions, and the owner has named the state the
 * off position writes — off until the work itself asks again. So BOTH directions are now one click and no
 * menu, and the three durations live on a control of their own (`[data-snooze-btn]`), where choosing
 * between them is the entire point of the click.
 *
 * Only a real browser can show that a click on the glyph reaches the handler, that the window paints
 * above the grid, and that dismissing it commits nothing.
 *
 * Geometry is still deliberately not asserted — the `uiPt`/zoom placement maths is unit-tested
 * (`scaleFixedPt`), and pinning pixel positions here would break on any layout change without
 * describing a real regression.
 */

/* The inclusion checkbox specifically. A card carries the scheduled-snooze button beside it, so matching
   on the glyph or the title would resolve two elements and click whichever came first. */
const glyph = (page, id) => page.locator(`[data-incl-glyph="${id}"]`);
const snoozeBtn = (page, id) => page.locator(`[data-snooze-btn="${id}"]`);
const menuItem = (page, label) => page.getByText(label, { exact: true });
const cardIn = (page, bucket, name) =>
  page.locator(`[data-selbucket="${bucket}"] [data-card-id]`).filter({ hasText: name });

/* A task genuinely ON today's list since two days ago, which is what puts it in Continued.
   Both halves of that fixture are load-bearing now. The window must COVER today, or the maintenance
   sweep clears `onListSince` on load and the card is Upcoming; and the key must be EARLIER than today,
   or the bucket is New. */
const pressed = [task('inc-1', 'Popover task', { start: '-2d', end: '+4d', included: true, onListSince: '-2d' })];

test.describe('inclusion checkbox and the snooze window', () => {
  test('unticking takes the task off today in ONE click, with no menu', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);

    await glyph(page, 'inc-1').click();

    /* The card leaves today on the click itself — the owner's "immediately". */
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(0);
    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
  });

  test('the unticked box reads as unticked, and says what will bring it back', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });
    await glyph(page, 'inc-1').click();

    /* 💤 is the badge of a SCHEDULED snooze and stays with that button; the state the checkbox writes has
       no day to print, so the box is simply empty and the tooltip names the triggers instead. */
    await expect(glyph(page, 'inc-1')).toHaveText('☐');
    await expect(glyph(page, 'inc-1')).toHaveAttribute('title', /falls due/);
  });

  test('the separate button is what offers the three snooze durations', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    await snoozeBtn(page, 'inc-1').click();

    await expect(menuItem(page, 'Snooze · today')).toBeVisible();
    await expect(menuItem(page, "Snooze · until it's relevant")).toBeVisible();
    await expect(page.getByPlaceholder('Snooze · until…', { exact: false })).toBeVisible();

    /* One verb. The two names the owner called interchangeable are gone from the surface entirely. */
    await expect(menuItem(page, 'Take out of today')).toHaveCount(0);
    await expect(menuItem(page, 'Snooze indefinitely')).toHaveCount(0);
    await expect(menuItem(page, 'Not today')).toHaveCount(0);
    /* Owner rule (2026-08-04): this window is STRICTLY inclusion. "Make active now" lived here in
       V2.4 and was deliberately removed — activation is double-click. Pinned so it cannot creep back. */
    await expect(menuItem(page, 'Make active now')).toHaveCount(0);
  });

  test('opening that button is not itself a decision', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);

    await snoozeBtn(page, 'inc-1').click();
    await expect(menuItem(page, 'Snooze · today')).toBeVisible();

    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(0);
  });

  test('"Snooze · today" moves the card to Snoozed and closes the window', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await snoozeBtn(page, 'inc-1').click();
    await menuItem(page, 'Snooze · today').click();

    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);
    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    /* A snooze with a day keeps 💤 on the box — which is how the two off-states stay distinguishable. */
    await expect(glyph(page, 'inc-1')).toHaveText('💤');
  });

  test('a snoozed task goes back on today with one click, and no menu appears', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await snoozeBtn(page, 'inc-1').click();
    await menuItem(page, 'Snooze · today').click();
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);

    /* The standing tenet: the laziest path must never silently drop work, so a removed task MUST offer a
       route back — and from here the box has exactly one move left, so it performs it. */
    await glyph(page, 'inc-1').click();
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(0);
    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
  });

  test('the menu still offers the way back for a snoozed task', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await snoozeBtn(page, 'inc-1').click();
    await menuItem(page, 'Snooze · today').click();

    await snoozeBtn(page, 'inc-1').click();
    await menuItem(page, 'Turn on').click();
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(0);
  });

  test('clicking the backdrop dismisses without changing anything', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await snoozeBtn(page, 'inc-1').click();
    await expect(menuItem(page, 'Snooze · today')).toBeVisible();

    /* The backdrop is a full-screen fixed layer under the card; the top-left corner is always it and
       never the menu (the menu is anchored under a control that is never at the origin). */
    await page.mouse.click(4, 4);

    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);
  });

  test("\"Snooze · until it's relevant\" removes it and names its wake triggers", async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await snoozeBtn(page, 'inc-1').click();
    /* The explanation is on the menu BEFORE you commit — an open-ended snooze that does not say what
       ends it reads as a black hole, and the moment to say so is while the user is deciding. */
    await expect(page.getByText('wakes when it starts, falls due', { exact: false })).toBeVisible();
    await menuItem(page, "Snooze · until it's relevant").click();

    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);

    /* A dateless snooze has no day to print, so the window names the EVENTS that end it instead. */
    await snoozeBtn(page, 'inc-1').click();
    await expect(page.getByText('until it starts, falls due', { exact: false })).toBeVisible();
    await expect(menuItem(page, 'Turn on')).toBeVisible();
  });

  test('ticking an Upcoming task adds it to today in ONE click, with no menu', async ({ page }) => {
    /* The other half of the asymmetry, and the 2026-08-12 rule: a click with one possible outcome
       performs it rather than opening a one-item menu. An undated task is the case that proves the
       `onListSince` stamp is what moves it — it has no window for the sweep to observe. */
    await bootPlan(page, 'select', { tasks: [task('up-1', 'Someday thing', { included: null })] });
    await expect(cardIn(page, 'upcoming', 'Someday thing')).toHaveCount(1);

    await glyph(page, 'up-1').click();

    await expect(cardIn(page, 'new', 'Someday thing')).toHaveCount(1);
    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    await expect(menuItem(page, 'Press into today')).toHaveCount(0);
  });
});
