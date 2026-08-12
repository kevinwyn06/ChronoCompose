/* Chain 4 / block 18, scope B — a day that has already PASSED draws no flexible allotment.
 *
 * Nothing will ever be scheduled into a day that is gone, so packing a would-be plan into it is noise,
 * and it is a large part of why a week reads as far busier than it actually was. Past columns keep what
 * really happened — clock-fixed appointments — and drop the packed flexible blocks.
 *
 * TODAY IS THE CONTROL, and it is not a formality: the app deliberately over-subscribes today, and that
 * is a feature the owner uses. A change that emptied every column would pass a past-only assertion, so
 * today's column is asserted to STILL carry packed flexible work in the same run.
 *
 * WHY THE CLOCK IS PINNED. The Week view is Sunday-first and anchored on the week containing today, so
 * on a Sunday that week has no past column at all. A first draft guarded that case with `test.skip`,
 * which is the same wall-clock fragility `AGENTS.md` forbids in fixtures, only worse: instead of going
 * red it degrades to NO COVERAGE one day in seven, silently. (It did exactly that on the run that was
 * first reported.) `page.clock.install` pins "today" to a known WEDNESDAY before the first navigation,
 * so the anchored week always contains three past columns, today, and three future ones — and the `-3d`
 * appointment is inside the rendered range by construction rather than by inspection.
 *
 * The pin must be installed BEFORE `bootDays` navigates: `_seed.js` resolves every relative day offset
 * against `new Date()` at page-eval time, so the fixture and the app read the same pinned midnight.
 */
const { test, expect } = require('@playwright/test');
const { bootDays, task, cleanDaySettings, dayColumns, blocksInColumn } = require('./_seed');

const DAY = 86400000;

/* Wednesday 12 August 2026, 09:00 local. Any fixed Wednesday would do; what matters is the weekday. */
const PINNED_NOW = new Date(2026, 7, 12, 9, 0, 0);

/** Midnight "today" under the pinned clock, in the browser's zone — the columns are keyed by this. */
async function midnight(page) {
  return page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });
}

/* One 00:00–10:00 window every day, no meals, no free-time reserve, so a column's contents are a
 * function of the fixture alone.
 *   · `Every day`  — flexible, spanning the whole visible week → would be packed into every column.
 *   · `Retro`      — a 02:00–03:00 clock appointment three days BACK → the past-day survivor.
 */
function weekFixture() {
  return {
    settings: cleanDaySettings('10:00'),
    tasks: [
      task('pd-span', 'Every day', { start: '-7d', end: '+7d', planned: 120, priority: 2, included: false }),
      task('pd-appt', 'Retro', { start: '-3d+2h', end: '-3d+3h', priority: 1, included: false }),
    ],
  };
}

test.describe('Week grid: past columns stop drawing flexible work', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: PINNED_NOW });
    await bootDays(page, 'week', weekFixture());
  });

  test('the pinned week really does straddle today — three past columns, today, three ahead', async ({ page }) => {
    const B = await midnight(page);
    const cols = await dayColumns(page);
    expect(cols, 'seven columns').toHaveLength(7);
    expect(new Date(B).getDay(), 'the clock pin put us on a Wednesday').toBe(3);
    expect(cols.filter((c) => c.day < B), 'three columns are in the past').toHaveLength(3);
    expect(cols.filter((c) => c.isToday), 'exactly one column is today').toHaveLength(1);
    expect(cols.filter((c) => c.day > B), 'three columns are ahead').toHaveLength(3);
    /* The appointment's day is inside the rendered range BY CONSTRUCTION, not by inspection. */
    expect(cols.map((c) => c.day), 'the -3d appointment falls in this week').toContain(B - 3 * DAY);
  });

  test('a past column has no packed flexible blocks while today\'s column still does', async ({ page }) => {
    const B = await midnight(page);
    const cols = await dayColumns(page);

    const past = cols.filter((c) => c.day < B);
    expect(past.length, 'there are past columns to assert on').toBe(3);

    for (const c of past) {
      const blocks = await blocksInColumn(page, c.day);
      expect(blocks.filter((b) => b.kind === 'auto').map((b) => b.title),
        `the past column ${new Date(c.day).toDateString()} packs no flexible work`).toEqual([]);
    }

    /* The control. Today still over-subscribes — that is the feature, not a defect. */
    const todayBlocks = await blocksInColumn(page, B);
    expect(todayBlocks.filter((b) => b.kind === 'auto').length,
      'today\'s column still packs flexible work').toBeGreaterThan(0);

    /* And so do the days ahead, so a change that emptied everything from today onward fails here too. */
    const ahead = await blocksInColumn(page, B + DAY);
    expect(ahead.filter((b) => b.kind === 'auto').length,
      'tomorrow\'s column still packs flexible work').toBeGreaterThan(0);
  });

  test('a past column keeps a clock-fixed appointment', async ({ page }) => {
    const B = await midnight(page);
    const blocks = await blocksInColumn(page, B - 3 * DAY);
    const appt = blocks.filter((b) => b.title.includes('Retro'));
    expect(appt, 'the appointment is still drawn on its past day').toHaveLength(1);
    expect(appt[0].kind, 'and still as a locked block').toBe('fixed');
    /* It is the ONLY thing left on that day: the flexible work around it is gone. */
    expect(blocks.filter((b) => b.kind === 'auto'), 'nothing flexible packed around it').toEqual([]);
  });
});
