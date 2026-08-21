const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The inclusion checkbox and the snooze window.
 *
 * REWRITTEN 2026-08-20 (Chain A, tasks 5/7/8). What this file asserts is unchanged in KIND — the
 * user-facing contract of the inclusion control — but three things it used to pin are gone:
 *
 *   • The Included/Excluded halves. The five-bucket partition replaced the vertical dimension, so
 *     `data-selcell$="-included"` no longer exists; a card's home is a BUCKET (`data-selbucket`).
 *   • "Take out of today". Removing work from today needs a duration, and asking for one is snooze's
 *     job, so snooze is the only verb that removes. The old unpress secretly snoozed anyway, which is
 *     exactly why the owner reported the two as "practically the exact same thing".
 *   • "Snooze indefinitely", renamed to "Snooze · until it's relevant" — it was never indefinite, it
 *     is event-bound, and the row now says which events.
 *
 * The asymmetry is still the thing worth pinning end-to-end, and it is now sharper: ticking has ONE
 * outcome so it happens on the click, and unticking has THREE so it opens the window and writes
 * nothing until one is chosen. Only a real browser can show that a click on the glyph reaches the
 * handler, that the window paints above the grid, and that dismissing it commits nothing.
 *
 * Geometry is still deliberately not asserted — the `uiPt`/zoom placement maths is unit-tested
 * (`scaleFixedPt`), and pinning pixel positions here would break on any layout change without
 * describing a real regression.
 */

/* The inclusion checkbox specifically. A card also carries a 💤 snooze shortcut on line 3, so matching
   on the glyph or the title would resolve two elements and click whichever came first. */
const glyph = (page, id) => page.locator(`[data-incl-glyph="${id}"]`);
const menuItem = (page, label) => page.getByText(label, { exact: true });
const cardIn = (page, bucket, name) =>
  page.locator(`[data-selbucket="${bucket}"] [data-card-id]`).filter({ hasText: name });

/* A task genuinely ON today's list since two days ago, which is what puts it in Continued.
   Both halves of that fixture are load-bearing now. The window must COVER today, or the maintenance
   sweep clears `onListSince` on load and the card is Upcoming; and the key must be EARLIER than today,
   or the bucket is New. The old fixture used a window that had not opened yet — correct for the era
   when `setIncludedOff` branched on inheritance, meaningless now that snooze is the only removal verb. */
const pressed = [task('inc-1', 'Popover task', { start: '-2d', end: '+4d', included: true, onListSince: '-2d' })];

test.describe('inclusion checkbox and the snooze window', () => {
  test('unticking opens a window offering exactly the three snooze durations', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    await glyph(page, 'inc-1').click();

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

  test('unticking alone writes NOTHING — the card does not move until a duration is chosen', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);

    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Snooze · today')).toBeVisible();

    /* This is the behaviour the asymmetry buys: opening the window is not itself a decision. */
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(0);
  });

  test('"Snooze · today" moves the card to Snoozed and closes the window', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Snooze · today').click();

    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);
    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
  });

  test('a snoozed task goes back on today with one click, and no menu appears', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Snooze · today').click();
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);

    /* The standing tenet: the laziest path must never silently drop work, so a removed task MUST offer
       a route back. A snoozed glyph opens the window because there it genuinely offers a choice
       (re-snooze, or turn it back on), and "Turn on" is that route. */
    await glyph(page, 'inc-1').click();
    await menuItem(page, 'Turn on').click();
    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(0);
  });

  test('clicking the backdrop dismisses without changing anything', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    await expect(menuItem(page, 'Snooze · today')).toBeVisible();

    /* The backdrop is a full-screen fixed layer under the card; the top-left corner is always it and
       never the menu (the menu is anchored under a glyph that is never at the origin). */
    await page.mouse.click(4, 4);

    await expect(menuItem(page, 'Snooze · today')).toHaveCount(0);
    await expect(cardIn(page, 'continued', 'Popover task')).toHaveCount(1);
  });

  test("\"Snooze · until it's relevant\" removes it and names its wake triggers", async ({ page }) => {
    await bootPlan(page, 'select', { tasks: pressed });

    await glyph(page, 'inc-1').click();
    /* The explanation is on the menu BEFORE you commit — an open-ended snooze that does not say what
       ends it reads as a black hole, and the moment to say so is while the user is deciding. */
    await expect(page.getByText('wakes when it starts, falls due', { exact: false })).toBeVisible();
    await menuItem(page, "Snooze · until it's relevant").click();

    await expect(cardIn(page, 'snoozed', 'Popover task')).toHaveCount(1);

    /* A dateless snooze has no day to print, so the window names the EVENTS that end it instead. */
    await glyph(page, 'inc-1').click();
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
