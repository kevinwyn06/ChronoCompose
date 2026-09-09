/* Owner report, 2026-09-09 (the Google Calendar sweep, second half). Fixing the PUSH exposed that
   `recur.durMs` was itself wrong for seven of the owner's fourteen linked repeats: `migrateRecurWindow`
   derives it as `t.end - t.start`, which is right for a legacy repeat (where `t.end` was the anchor
   occurrence's end) and wrong for one whose `t.end` was already a series end. `MATH_V 322-101` claimed
   each 90-minute class lasted 86.5 days — exactly Dec 3 minus Sep 8. */
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

const DAY = 86400000;
const MIN = 60000;
const day = (y, m, d, h, mi) => new Date(y, m, d, h || 0, mi || 0, 0, 0).getTime();

test('the period invariant: an occurrence may equal its period, never exceed it', () => {
  const c = make();
  assert.equal(c.recurPeriodMs({ kind: 'day', n: 1 }), DAY);
  assert.equal(c.recurPeriodMs({ kind: 'day', n: 3 }), 3 * DAY);
  assert.equal(c.recurPeriodMs({ kind: 'weekdays', days: ['mon', 'wed'] }), 7 * DAY,
    'every selected weekday falls inside one week');
  assert.equal(c.recurPeriodMs({ kind: 'week', n: 2 }), 14 * DAY);
  assert.equal(c.recurPeriodMs(null), null);
  assert.equal(c.recurPeriodMs({ kind: 'nonsense' }), null, 'a rule with no period we model is left alone');
});

// The owner's stored shape, verbatim: `durMs` holds the whole term and `t.end` still holds the term end.
// Both were derived from the same pair, so the span is exactly `end - start`.
const mathClass = c => c.normalizeTask({ id: 'm', name: 'MATH_V 322-101', planned: 90,
  start: day(2026, 8, 8, 14, 0), end: day(2026, 11, 3, 23, 59), startClock: true,
  calendarId: 'primary', eventId: 'e1',
  recur: { kind: 'weekdays', days: ['tue', 'thu'], label: 'Weekly: tue, thu',
    durMs: day(2026, 11, 3, 23, 59) - day(2026, 8, 8, 14, 0), shifts: [], overrides: {} } });

test('a term-long "class" is repaired to its planned length', () => {
  const c = make();
  const t = mathClass(c);
  assert.ok(t.recur.durMs > 80 * DAY, 'precondition: one 90-minute class claims to last most of a term');

  assert.equal(c.migrateRecurOccLength([t]), 1);
  assert.equal(t.recur.durMs, 90 * MIN);
  assert.equal(t.end, day(2026, 11, 3, 23, 59), 'the series end is untouched — it was never wrong');
});

test('Todoist\'s stated duration outranks the task\'s planned minutes', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'x', name: 'Exercise', planned: 90,
    description: '//planned-duration: 00:30 1\n\nhttps://app.todoist.com/app/task/6fVcmQ2xVCprmhrj',
    start: day(2025, 11, 13, 19, 30), end: null, startClock: true, calendarId: 'primary', eventId: 'e2',
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 269 * DAY, shifts: [], overrides: {} } });
  assert.equal(c.migrateRecurOccLength([t]), 1);
  assert.equal(t.recur.durMs, 30 * MIN,
    'the event ChronoCompose is mirroring states its own length; that beats a local estimate');
});

test('with neither source, the length is clamped to the period rather than invented', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'u', name: 'Unknown', planned: null, start: day(2026, 8, 1), end: null,
    calendarId: 'primary', eventId: 'e3',
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 40 * DAY, shifts: [], overrides: {} } });
  assert.equal(c.migrateRecurOccLength([t]), 1);
  assert.equal(t.recur.durMs, DAY);
});

test('a legitimate length is left alone, and the pass is idempotent', () => {
  const c = make();
  const allDayDaily = c.normalizeTask({ id: 'a', name: 'Sort files', allDay: true,
    start: day(2026, 8, 1), end: null,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: DAY, shifts: [], overrides: {} } });
  const zero = c.normalizeTask({ id: 'z', name: 'Lunch', start: day(2026, 8, 1, 12, 0), end: null, startClock: true,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } });
  const half = c.normalizeTask({ id: 'h', name: 'Shutdown routine', start: day(2026, 8, 1, 23, 0), end: null,
    startClock: true, recur: { kind: 'day', n: 1, label: 'Daily', durMs: 30 * MIN, shifts: [], overrides: {} } });

  assert.equal(c.migrateRecurOccLength([allDayDaily, zero, half]), 0,
    'a day-long daily occurrence sits exactly ON the period and is real; so is a zero-length one');
  const fixed = c.normalizeTask({ id: 'f', name: 'Bad', planned: 60, start: day(2026, 8, 1, 9, 0), end: null,
    startClock: true, recur: { kind: 'day', n: 1, label: 'Daily', durMs: 50 * DAY, shifts: [], overrides: {} } });
  assert.equal(c.migrateRecurOccLength([fixed]), 1);
  assert.equal(c.migrateRecurOccLength([fixed]), 0, 'second run finds nothing');
});

test('a Supabase pull cannot re-import the bad length over the repair', () => {
  const c = make();
  const row = { id: 'm', name: 'MATH_V 320-101', planned: 60, start: day(2026, 8, 9, 12, 0),
    end: day(2026, 11, 7, 23, 59), startClock: true, calendarId: 'primary', eventId: 'e4',
    recur: { kind: 'weekdays', days: ['mon', 'wed', 'fri'], label: 'Weekly',
      durMs: day(2026, 11, 7, 23, 59) - day(2026, 8, 9, 12, 0), shifts: [], overrides: {} } };
  const t = c.migrateIncomingRow(c.normalizeTask(row));
  assert.equal(t.recur.durMs, 60 * MIN, 'the pull path repairs it too, or it would undo the local fix');
});

test('the repaired task pushes a 90-minute class, not a term-long band', () => {
  const c = make();
  const t = mathClass(c);
  c.migrateRecurOccLength([t]);
  const body = c.eventBodyOf(t, true);
  assert.match(body.start.dateTime, /^2026-09-08T14:00:00/);
  assert.match(body.end.dateTime, /^2026-09-08T15:30:00/);
  assert.match(body.recurrence[0], /UNTIL=20261204T/, 'and the term end still rides on the rule');
});
