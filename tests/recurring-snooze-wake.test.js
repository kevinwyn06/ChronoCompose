// Owner report 2026-10-10: a daily task snoozed for 7 days, or snoozed indefinitely, came straight back
// the next day. Owner: *"I think in general this shouldn't be the behaviour for recurring tasks."*
//
// The wake rungs in `snoozeWakeReason` asked about the OCCURRENCE: the window opening today, the start
// clock arriving, the due time passing. For a one-off task each of those is new information. For a
// repeat they happen on every occurrence — that is what a repeat is — so every snooze lasted one day.
// For a repeat the date that can arrive is the SERIES opening; occurrence edges never wake a snooze.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

const HOUR = 3600000;

function daily(c, over) {
  const B = c.startOfToday();
  return c.normalizeTask(Object.assign({
    id: 'r', name: 'daily', type: 'Proportional',
    start: B - 5 * DAY + 9 * HOUR, end: null,
    recur: { kind: 'day', n: 1, durMs: HOUR },
    priority: 4, deps: [], pct: 0, planned: 30,
  }, over || {}));
}

test('a 7-day snooze on a daily repeat survives the next occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = daily(c, { snoozeUntil: B + 6 * DAY, snoozedAt: B - DAY + 10 * HOUR });
    c.state.tasks = [t];
    assert.ok(c.occOnDay(t, B), 'the repeat has an occurrence today');
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), null);
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), true);
    assert.strictEqual(c.inclState(t), 'snoozed');
    assert.strictEqual(c.isActiveOn(t, B), false, 'and the scheduler leaves it out of today');
  });
});

test('an indefinite snooze on a timed daily repeat ignores start and due of each occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Noon: today's 09:00–10:00 occurrence has both started and fallen due.
    const t = daily(c, { snoozeIndef: true, snoozedAt: B - DAY + 10 * HOUR });
    c.state.tasks = [t];
    assert.strictEqual(c.hasStartTime(t), true);
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), null);
    assert.strictEqual(c.inclState(t), 'snoozed');
  });
});

test('an all-day daily repeat stays snoozed too', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = daily(c, { start: B - 5 * DAY, allDay: true, recur: { kind: 'day', n: 1, durMs: DAY },
      snoozeIndef: true, snoozedAt: B - 3 * DAY });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), null);
    assert.strictEqual(c.inclState(t), 'snoozed');
  });
});

test('the SERIES opening on a later day still wakes the snooze', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = daily(c, { start: B + 9 * HOUR, snoozeIndef: true, snoozedAt: B - 2 * DAY });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), 'date');
  });
});

test('dependencies and the dated expiry still end a snooze on a repeat', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const pre = c.normalizeTask({ id: 'p', name: 'pre', start: null, end: null, deps: [], pct: 100 });
    const t = daily(c, { snoozeIndef: true, snoozedAt: B - DAY, deps: ['p'] });
    c.state.tasks = [pre, t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), 'deps');
    const u = daily(c, { snoozeUntil: B, snoozedAt: B - 7 * DAY });
    c.state.tasks = [u];
    assert.strictEqual(c.snoozeActive(u, B, Date.now()), false, 'a 7-day snooze ends on day 7');
  });
});

test('one-off tasks keep the occurrence rungs', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id: 'o', name: 'one-off', type: 'Proportional',
      start: B + 9 * HOUR, end: B + 10 * HOUR, deps: [], pct: 0, planned: 30,
      snoozeIndef: true, snoozedAt: B - DAY });
    c.state.tasks = [t];
    assert.ok(c.snoozeWakeReason(t, B, Date.now()), 'its own day arriving still wakes it');
  });
});
