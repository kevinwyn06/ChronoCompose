/* ACCEPTANCE → AUTOMATION (owner 2026-08-31): the display-only calendar tier.
 *
 * The unit layer proves the classifier, the store, and the prune. What it structurally cannot reach is
 * the property the whole design rests on: a display-only event must appear in the CALENDAR views while
 * being absent from every surface that treats a row as work. That is a claim about a live mount of
 * `index.html` — `_calTasks` versus `state.tasks`, two lists the mocked DOM never renders — so it
 * belongs here and nowhere else.
 *
 * Owner case being pinned: birthdays should show up, should not become tasks, and should not inflate
 * the day's task count.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface } = require('./_seed');

/* One birthday today, one task today, so every assertion below is a contrast rather than an absence. */
const FIXTURE = {
  tasks: [{ id: 'real', name: 'Write the report', type: 'Proportional', included: true, planned: 60,
    start: '0d+9h', end: '0d+10h' }],
  calEvents: [{ cid: 'addressbook#contacts@group.v.calendar.google.com', eid: '2026_BIRTHDAY_x',
    name: "Jordan Lee's birthday", start: '0d', end: '+1d', allDay: true }],
};

test.describe('a display-only calendar event is visible but is not a task', () => {
  test('it renders in the month view alongside the day’s real tasks', async ({ page }) => {
    await bootSurface(page, { view: 'month' }, FIXTURE);
    await expect(page.getByText("Jordan Lee's birthday").first(),
      'the birthday reaches the month grid').toBeVisible();
    await expect(page.getByText('Write the report').first(),
      'fixture: the real task is there too').toBeVisible();
  });

  test('it never enters the task store, so nothing can schedule, sync or delete it', async ({ page }) => {
    await bootSurface(page, { view: 'month' }, FIXTURE);
    /* THE assertion. `pp-tasks` is what reaches the auto-scheduler, Supabase, and gcalEnqueue — and a
       row in gcalEnqueue's path is a row that can issue a real remote DELETE against the owner's
       Google Calendar. The birthday must not be in it. */
    const names = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks') || '[]').map(t => t.name));
    expect(names).toContain('Write the report');
    expect(names.join('|')).not.toContain('birthday');
  });

  test('it does not appear in the Gantt sheet, which lists work owed', async ({ page }) => {
    await bootSurface(page, { view: 'gantt' }, FIXTURE);
    await expect(page.getByText('Write the report').first(), 'fixture: the sheet rendered').toBeVisible();
    await expect(page.getByText("Jordan Lee's birthday"),
      'a birthday is not a row of work').toHaveCount(0);
  });

  test('it shows in the day-grid header band, where the scheduler’s output cannot carry it', async ({ page }) => {
    await bootSurface(page, { view: 'week' }, FIXTURE);
    /* The column body is buildDayTimeline's output and display events are deliberately never scheduled,
       so the header band is the only place this view can show one. */
    await expect(page.locator('[data-pp-calinfo]').first(),
      'the band exists for the day the birthday falls on').toBeVisible();
    await expect(page.locator('[data-pp-calinfo]').getByText("Jordan Lee's birthday").first()).toBeVisible();
  });
});
