/* Chain 4 / block 21 — visual evidence for the owner, who decides how this looks by SEEING it.
 * Four findings in the V5 review were only ever caught by looking at a picture, and the capacity
 * indicator is a brand-new visible surface. These specs assert almost nothing; their product is the
 * PNGs in `.orchestration/shots/`. Kept in their own file so the assertion specs stay assertions.
 */
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { boot, bootToday, bootDays, task, cleanDaySettings } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
const shot = (name) => path.join(SHOTS, name);

function fixture(n, planned) {
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push(task('cs' + i, ['Write the deck', 'Client call prep', 'Refactor sync', 'Reading',
      'Inbox', 'Design review'][i % 6] + (i > 5 ? ' ' + i : ''),
      { start: '-1d', end: '+3d', planned, priority: 2 }));
  }
  return { settings: cleanDaySettings('09:00'), tasks };
}

test('SHOT: today, deliberately over-subscribed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await bootToday(page, fixture(6, 180)); // 18:00 asked against 9:00 free
  await expect(page.locator('[data-capacity]').first()).toBeVisible();
  await page.screenshot({ path: shot('21-today-oversubscribed.png') });
  await page.locator('[data-capacity]').first().screenshot({ path: shot('21-indicator-over-closeup.png') });
});

test('SHOT: today, under-subscribed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await bootToday(page, fixture(2, 90)); // 3:00 asked against 9:00 free
  await expect(page.locator('[data-capacity]').first()).toBeVisible();
  await page.screenshot({ path: shot('21-today-undersubscribed.png') });
  await page.locator('[data-capacity]').first().screenshot({ path: shot('21-indicator-under-closeup.png') });
});

test('SHOT: the Week grid strip, past columns blank', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await bootDays(page, 'week', fixture(6, 180));
  await page.screenshot({ path: shot('21-week-strip.png') });
});

/* Chain 4 / block 28b — the appointment-only day.
 * A 09:00–17:00 window booked solid by three meetings leaves a pool of exactly zero. The indicator
 * used to print a calm "0m asked · 0m free" and "0%" over an EMPTY track, which reads as "nothing
 * on" on the busiest day of the week. It now reads "no room" / "full" over a FULL track. Both
 * themes, because the owner decides how this looks by seeing it and half the V5 findings were
 * dark-theme only. */
function bookedSolid(theme) {
  return {
    theme,
    settings: Object.assign(cleanDaySettings('17:00'), { dayStart: '09:00' }),
    tasks: [
      task('bs1', 'Quarterly planning', { start: '0d+9h', end: '0d+12h', startClock: true, endClock: true, planned: 180 }),
      task('bs2', 'Lunch with the team', { start: '0d+12h', end: '0d+14h', startClock: true, endClock: true, planned: 120 }),
      task('bs3', 'Vendor review', { start: '0d+14h', end: '0d+17h', startClock: true, endClock: true, planned: 180 }),
    ],
  };
}

for (const theme of ['light', 'dark']) {
  test('SHOT: a day that is entirely appointments reads "no room" (' + theme + ')', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await bootToday(page, bookedSolid(theme));
    const cap = page.locator('[data-capacity]').first();
    await expect(cap).toBeVisible();
    await expect(cap).toHaveAttribute('data-cap-booked', '1');
    await expect(cap).toHaveAttribute('data-cap-pool', '0');
    await expect(cap).toContainText('no room');
    await page.screenshot({ path: shot('28b-booked-solid-' + theme + '.png') });
    await cap.screenshot({ path: shot('28b-booked-closeup-' + theme + '.png') });
  });
}

/* Chain 4 / block 30b — the OTHER two reasons a pool is zero.
 * 28b said "no room" for every zero pool, and its own handoff flagged that as wrong: a day nothing was
 * ever put on, and a day whose work is finished, are not booked days. The owner ruled the phrase splits
 * three ways. `data-cap-state` is the hook that tells them apart; the words are the owner's, verbatim,
 * and are asserted literally so a later block cannot quietly improve them. Both themes, because the
 * owner decides how this looks by seeing it. The booked shot above is the third of the three. */
/* Next week's work. Present so the board has a row to mount against (`boot` waits for one), and
   `included: null` so it contributes nothing to today's demand — which is the point: both of these
   states are statements about TODAY, not about the backlog. NOTE the null is load-bearing: under the
   per-day inclusion model `included: true` (the `task()` default) makes a task active TODAY whatever
   its window says, so a future-dated backlog item would otherwise print "2h asked" on an empty day. */
const backlog = () => task('later', 'Next sprint kickoff',
  { start: '+5d', end: '+7d', planned: 120, included: null });

/* NOT `bootToday`: that helper waits for a timeline BLOCK, and a day with no window draws none —
   which is precisely the state under test. `boot` + `mainView:'today'` mounts the same view without
   demanding that the day have something on it. */
const bootEmptyToday = (page, data) => boot(page, Object.assign({ prefs: { mainView: 'today' } }, data));

const zeroPoolDay = (theme, tasks) => ({
  theme,
  /* dayStart === dayEnd: no window at all, so the pool is zero for want of time rather than want of room. */
  settings: Object.assign(cleanDaySettings('09:00'), { dayStart: '09:00' }),
  tasks: [backlog()].concat(tasks),
});

for (const theme of ['light', 'dark']) {
  test('SHOT: a day with nothing on it reads "nothing scheduled" (' + theme + ')', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await bootEmptyToday(page, zeroPoolDay(theme, []));
    const cap = page.locator('[data-capacity]').first();
    await expect(cap).toBeVisible();
    await expect(cap).toHaveAttribute('data-cap-state', 'empty');
    await expect(cap).toContainText('nothing scheduled');
    await expect(cap).not.toContainText('no room');
    await page.screenshot({ path: shot('30b-nothing-scheduled-' + theme + '.png') });
    await cap.screenshot({ path: shot('30b-nothing-scheduled-closeup-' + theme + '.png') });
  });

  test('SHOT: a day whose work is finished reads "all done" (' + theme + ')', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    /* Completed today and therefore archived today — `autoArchiveDays: 0` is the owner's setting, so
       that is what a finished task really looks like an hour later. Archived work carries no demand,
       which is why this day reads as finished rather than as an ask with nowhere to go. */
    await bootEmptyToday(page, zeroPoolDay(theme, [
      task('fin1', 'Ship the release', { start: '0d', end: '0d', pct: 100, spent: 90,
        completion: '0d+10h', archivedAt: '0d+10h' }),
      task('fin2', 'Write the retro', { start: '0d', end: '0d', pct: 100, spent: 45,
        completion: '0d+11h', archivedAt: '0d+11h' }),
    ]));
    const cap = page.locator('[data-capacity]').first();
    await expect(cap).toBeVisible();
    await expect(cap).toHaveAttribute('data-cap-state', 'done');
    await expect(cap).toContainText('all done');
    await expect(cap).not.toContainText('no room');
    await page.screenshot({ path: shot('30b-all-done-' + theme + '.png') });
    await cap.screenshot({ path: shot('30b-all-done-closeup-' + theme + '.png') });
  });
}
