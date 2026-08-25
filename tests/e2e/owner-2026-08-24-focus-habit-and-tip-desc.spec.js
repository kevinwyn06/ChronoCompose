const { test, expect } = require('@playwright/test');
const { bootSurface, bootToday, task } = require('./_seed');

/* Owner asks 2026-08-24 — starting a habit from Focus, and the description on the hover card.
 *
 * The unit layer owns everything provable without a browser: `addHabit(name)`, `descSnippet`, and the
 * `desc` field on `blockTooltipModel` (tests/owner-2026-08-24-desc-and-focus-habit.test.js). Only two
 * things are here, and both are here because the mock DOM structurally cannot reach them:
 *
 *   1. The habit draft field's FOCUS LIFECYCLE. Enter commits, Escape abandons — and Escape has to
 *      blur the field to dismiss it, while blur is also what commits. That race is real focus
 *      behaviour; a dispatched KeyboardEvent would prove nothing about it, and getting it wrong saves
 *      the very text the user just said to discard.
 *   2. The hover card itself, which mounts on a real `mouseenter` over a real block. It is suppressed
 *      during a gesture, so a dispatched event is not evidence it appeared for the right reason.
 */

const ADD = '[data-qa="focus-add-habit"]';
const DRAFT = '[data-qa="focus-habit-draft"]';

const storedHabits = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pp-habits') || '[]'));

test.describe('Focus mode can start a habit', () => {
  test('names it inline and it appears in the list it was added from', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootSurface(page, { dashMode: 'focus' });
    await expect(page.locator(ADD)).toBeVisible();
    // The empty state the button is there to resolve.
    await expect(page.getByText('No habits scheduled today.')).toBeVisible();

    await page.locator(ADD).click();
    const draft = page.locator(DRAFT);
    /* autoFocus, on a real mount: the button and the field it opens are one gesture, so needing a
       second click to type would make the control feel broken. */
    await expect(draft).toBeFocused();

    await page.keyboard.type('Stretch');
    await page.keyboard.press('Enter');

    await expect(page.locator(DRAFT)).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('Stretch')).toBeVisible();
    await expect(page.getByText('No habits scheduled today.')).toHaveCount(0);

    expect((await storedHabits(page)).map((x) => x.name)).toEqual(['Stretch']);
    expect(errors).toEqual([]);
  });

  /* THE LOAD-BEARING NEGATIVE. Escape dismisses by blurring, and blur is the commit path — so the
     naive implementation saves the abandoned text. Nothing about that is visible to the mock DOM. */
  test('Escape abandons the draft instead of saving it on the way out', async ({ page }) => {
    await bootSurface(page, { dashMode: 'focus' });
    await page.locator(ADD).click();
    await expect(page.locator(DRAFT)).toBeFocused();

    await page.keyboard.type('Something I changed my mind about');
    await page.keyboard.press('Escape');

    await expect(page.locator(DRAFT)).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(ADD)).toBeVisible();
    expect(await storedHabits(page)).toEqual([]);
  });

  test('an empty name is a no-op, not a habit called nothing', async ({ page }) => {
    await bootSurface(page, { dashMode: 'focus' });
    await page.locator(ADD).click();
    await expect(page.locator(DRAFT)).toBeFocused();

    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');

    await expect(page.locator(DRAFT)).toHaveCount(0, { timeout: 5000 });
    expect(await storedHabits(page)).toEqual([]);
  });
});

test.describe('the timeline hover card carries the description', () => {
  test('hovering a block shows what the task is about, not only when it is', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootToday(page, {
      tasks: [
        task('call', 'Call Sam', {
          start: '+0d', end: '+0d', planned: 60,
          description: '<div>re the Q3 quote</div><div>he wants the revised numbers</div>',
        }),
      ],
    });

    const block = page.locator('[data-tl-block][data-tl-task="call"]').first();
    await block.waitFor({ state: 'visible', timeout: 15000 });

    /* A real pointer move. The card mounts on `mouseenter` and is deliberately suppressed while a
       gesture is in flight, so hit-testing is the whole point of using the mouse here. */
    const box = await block.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const desc = page.locator('[data-tl-tip-desc]');
    await expect(desc).toBeVisible({ timeout: 5000 });
    /* One line of plain text: the block boundary between the two divs became a space rather than
       running the sentences together. */
    await expect(desc).toHaveText('re the Q3 quote he wants the revised numbers');

    // The card still leads with its countdown — the description is an addition, not a replacement.
    await expect(page.locator('[data-tl-tip-title]')).toHaveText('Call Sam');
    expect(errors).toEqual([]);
  });

  test('a task with no description gets no empty line on the card', async ({ page }) => {
    await bootToday(page, {
      tasks: [task('bare', 'Bare task', { start: '+0d', end: '+0d', planned: 60 })],
    });

    const block = page.locator('[data-tl-block][data-tl-task="bare"]').first();
    await block.waitFor({ state: 'visible', timeout: 15000 });
    const box = await block.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator('[data-tl-tip-title]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-tl-tip-desc]')).toHaveCount(0);
  });
});
