const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* UI revamp block 10b — Review is a weekly review. The window maths, the section grouping and the routine
   exclusions are unit-tested (tests/ui-revamp-review.test.js). What only a live mount shows: the week arrows
   take a real click and the figures change with the week, and "Where did the time go?" paints the seeded
   sections in their own colours. */

/* Fixture days are offsets from today; the week starts on Sunday, so "Monday of last week" depends on
   today's weekday. Node and the browser share the machine's zone. */
const dow = new Date().getDay();
const lastWeekMon = `${-(dow + 7) + 1}d`;
const twoWeeksTue = `${-(dow + 14) + 2}d`;

const sections = [
  { id: 'sec_study', name: 'Study', order: 0, color: '#3b82f6' },
  { id: 'sec_work', name: 'Work', order: 1, color: '#10b981' },
];
const tasks = [
  task('st', 'Problem set', { sectionId: 'sec_study', start: '-20d', end: '+5d', planned: 600, spent: 150,
    spentByDay: { '0d': 30, [lastWeekMon]: 120 } }),
  task('wk', 'Lab report', { sectionId: 'sec_work', start: '-20d', end: '+5d', planned: 300, spent: 60,
    spentByDay: { [twoWeeksTue]: 60 } }),
];

test.describe('Review: a week at a time', () => {
  test('the week arrows change the numbers, and time is grouped by section in its colour', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await bootSurface(page, { dashMode: 'review' }, { tasks, sections });

    const answer = page.locator('[data-review-answer="tracked"]');
    await expect(page.locator('[data-review-week-name]')).toHaveText('This week');
    await expect(answer).toHaveText('30m');
    await expect(page.locator('[data-review-section]')).toHaveCount(1);
    await expect(page.locator('[data-review-section="Study"]')).toBeVisible();

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.locator('[data-review-week-name]')).toHaveText('Last week');
    await expect(answer).toHaveText('2h');

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(answer).toHaveText('1h');
    await expect(page.locator('[data-review-section="Work"]')).toBeVisible();
    await expect(page.locator('[data-review-section="Study"]')).toHaveCount(0);
    const bar = page.locator('[data-review-section-bar="Work"]');
    await expect(bar).toHaveCSS('background-color', 'rgb(16, 185, 129)');

    /* Back to this week, and › is disabled there. */
    await page.locator('[data-review-week-today]').click();
    await expect(answer).toHaveText('30m');
    await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled();

    /* The arrows render at HIT_MIN_PX (24px) after the shell zoom. */
    const box = await page.getByRole('button', { name: 'Previous week' }).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(23.5);
    expect(box.height).toBeGreaterThanOrEqual(23.5);
    expect(errors, 'page errors on Review').toEqual([]);
  });
});
