/* Chain 4 / block 21 — the capacity indicator renders and reads correctly.
 *
 * The indicator answers "how much have I said yes to, against how much time exists". Selection answers
 * WHICH work is in the day and never HOW MUCH: include ten 3-hour tasks in a 9-hour day and Selection
 * looks perfectly healthy while the compressor quietly gives each one 54 minutes.
 *
 * IT REPORTS, IT DOES NOT POLICE. The owner deliberately over-subscribes and finds it valuable, so
 * nothing here asserts that a day ought to fit. What is asserted is that the two numbers are true, that
 * the over-subscribed state is legible, and — the assertion that matters most — that the ask is printed
 * at FULL SIZE rather than clamped to the pool. A bar that pegs at 100% and stops telling you anything
 * is exactly the readout that would be useless to someone who says yes to 30 hours in a 9-hour day.
 *
 * The clock is NOT pinned here. This spec reads a static readout on today's surface and on the Week
 * grid; nothing depends on the weekday, on the now-line moving, or on a timer accruing. `bootDays` +
 * relative day offsets keep it wall-clock independent on their own.
 */
const { test, expect } = require('@playwright/test');
const { bootToday, bootDays, task, cleanDaySettings } = require('./_seed');

/** The indicator's own numbers, straight off its DOM hooks, for a given day column (or the only one). */
async function readCapacity(page, nth) {
  const el = page.locator('[data-capacity]').nth(nth || 0);
  await el.waitFor({ state: 'attached', timeout: 15000 });
  return el.evaluate((n) => ({
    demand: Number(n.getAttribute('data-cap-demand')),
    pool: Number(n.getAttribute('data-cap-pool')),
    over: n.getAttribute('data-cap-over') === '1',
    text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
    title: n.getAttribute('title') || '',
  }));
}

/* A 9-hour day (00:00–09:00), no meals, no free-time reserve, pack-from-now off — so the pool is 540
 * minutes by construction and does not move with the wall clock.
 *   over  — six 3-hour tasks: 1080 minutes of ask against 540 of room. Deliberately, and on purpose.
 *   under — one 90-minute task.
 */
function overFixture() {
  const tasks = [];
  for (let i = 0; i < 6; i++) {
    tasks.push(task('cap-o' + i, 'Big ' + i, { start: '-1d', end: '+3d', planned: 180, priority: 2 }));
  }
  return { settings: cleanDaySettings('09:00'), tasks };
}
function underFixture() {
  return {
    settings: cleanDaySettings('09:00'),
    tasks: [task('cap-u', 'Small', { start: '-1d', end: '+3d', planned: 90, priority: 2 })],
  };
}

test.describe('capacity indicator', () => {
  test('an over-subscribed day reports the FULL ask against the pool, not a clamped one', async ({ page }) => {
    await bootToday(page, overFixture());
    const cap = await readCapacity(page);
    /* 2026-08-16: `settings.breakMin` defaults 3 (was 0), and `computeAllotted` shrinks the pool by one
       break per packable family so allotment stays inside timeline capacity. Six families → 540 − 6×3
       = 522 minutes = 8h 42m. Recomputed from the rule; the 540 below is the raw window, unchanged. */
    expect(cap.pool, 'a 00:00–09:00 window is 540 raw minutes, less six 3-minute breaks').toBe(522);
    expect(cap.demand, 'six 3-hour tasks = 1080 minutes asked for').toBe(1080);
    expect(cap.over).toBe(true);
    expect(cap.text, 'both figures are printed in words, with units').toContain('18h asked');
    expect(cap.text).toContain('8h 42m free');
    expect(cap.text, 'never bare h:mm — it would read as a clock time next to the date').not.toContain('18:00');
  });

  test('nothing is trimmed, capped or hidden because the day is over-subscribed', async ({ page }) => {
    await bootToday(page, overFixture());
    // All six tasks are still drawn in the day. Over-subscription is the mechanism, not an error state.
    const blocks = page.locator('[data-tl-block]');
    expect(await blocks.count(), 'every task is still in the day').toBeGreaterThanOrEqual(6);
    const cap = await readCapacity(page);
    expect(cap.title, 'the tooltip explains compression rather than scolding').toContain('Nothing has been dropped');
    expect(cap.title.toLowerCase()).not.toContain('too much');
  });

  test('an under-subscribed day reads correctly and carries no alarm state', async ({ page }) => {
    await bootToday(page, underFixture());
    const cap = await readCapacity(page);
    /* One packable family → 540 − 1×3 = 537. Same breakMin default as above. */
    expect(cap.pool).toBe(537);
    expect(cap.demand).toBe(90);
    expect(cap.over, 'under the pool, so nothing is marked').toBe(false);
    expect(cap.text).toContain('1h 30m asked');
  });

  test('the Week grid carries a per-day figure, and past columns carry none', async ({ page }) => {
    await bootDays(page, 'week', overFixture());
    const cols = await page.locator('[data-tl-col]').evaluateAll((ns) => ns.map((n) => ({
      day: Number(n.getAttribute('data-tl-col')),
      today: n.getAttribute('data-tl-today') === '1',
      cap: (() => { const c = n.querySelector('[data-capacity]');
        return c ? { demand: Number(c.getAttribute('data-cap-demand')), pool: Number(c.getAttribute('data-cap-pool')) } : null; })(),
    })));
    expect(cols.length, 'a full week').toBe(7);
    const B = cols.find((c) => c.today).day;
    cols.forEach((c) => {
      if (c.day < B) expect(c.cap, 'a past day has no pool by design, so it reports nothing').toBeNull();
      else expect(c.cap, 'today and every future day report').not.toBeNull();
    });
    // The fixture's window is -1d..+3d, so today itself carries the full 1080-minute ask.
    /* Same 540 − 6×3 = 522 pool as the Today readout: one indicator, one rule. */
    expect(cols.find((c) => c.today).cap).toEqual({ demand: 1080, pool: 522 });
  });
});
