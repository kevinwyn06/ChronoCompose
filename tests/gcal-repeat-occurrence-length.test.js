/* Owner report, 2026-09-09: *"what the heck is going on in my google calendar"* — a screenshot of the
   week view buried under a dozen stacked week-long green bars.
   Cause: `eventBodyOf` handed Google `t.start`/`t.end`, which for a repeat is the SERIES WINDOW, together
   with the RRULE. Google reads DTEND-DTSTART as the length of EVERY occurrence, so a daily all-day task
   with a seven-week window produced forty-nine seven-week bands. One event, not duplicates — which is why
   the task list looked fine. */
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

const day = (y, m, d, h, mi) => new Date(y, m, d, h || 0, mi || 0, 0, 0).getTime();
const DAY = 86400000;

// A daily all-day repeat whose window runs Sep 1 -> Oct 20. One occurrence is one day.
const exercise = c => c.normalizeTask({ id: 'ex', name: 'Exercise', allDay: true,
  start: day(2026, 8, 1), end: day(2026, 9, 20), calendarId: 'primary', eventId: 'e1',
  recur: { kind: 'day', n: 1, label: 'Daily', durMs: DAY, shifts: [], overrides: {} } });

// A daily 7:00-7:30am repeat over the same window.
const wakeup = c => c.normalizeTask({ id: 'wu', name: 'Wakeup routine', startClock: true, endClock: true,
  start: day(2026, 8, 9, 7, 0), end: day(2026, 9, 20), calendarId: 'primary', eventId: 'e2',
  recur: { kind: 'day', n: 1, label: 'Daily', durMs: 30 * 60000, shifts: [], overrides: {} } });

test('a repeat pushes ONE OCCURRENCE, not the series window', () => {
  const c = make();
  const ex = c.eventBodyOf(exercise(c), true);
  assert.deepEqual(ex.start, { date: '2026-09-01' });
  assert.deepEqual(ex.end, { date: '2026-09-02' },
    'an all-day occurrence is one day: Google\'s end date is the exclusive next day, not the window close');

  const wu = c.eventBodyOf(wakeup(c), true);
  assert.match(wu.start.dateTime, /^2026-09-09T07:00:00/);
  assert.match(wu.end.dateTime, /^2026-09-09T07:30:00/,
    'the occurrence ends at 7:30 the same morning — it used to end when the whole series did');
});

test('the series end still ships, as the RRULE\'s UNTIL', () => {
  const c = make();
  const body = c.eventBodyOf(exercise(c), true);
  assert.match(body.recurrence[0], /^RRULE:FREQ=DAILY;UNTIL=20261020T/,
    'the window close is a property of the RULE, which is the only place it belongs');
});

test('a plain task is untouched: its end IS its end', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'p', name: 'One off', start: day(2026, 8, 11, 9, 0), end: day(2026, 8, 11, 10, 30),
    startClock: true, endClock: true });
  const b = c.eventBodyOf(t, true);
  assert.match(b.start.dateTime, /^2026-09-11T09:00:00/);
  assert.match(b.end.dateTime, /^2026-09-11T10:30:00/);
});

test('a dateless repeat does not push an arithmetic NaN', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'g', name: 'Ghost', start: null, end: null,
    recur: { kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {} } });
  assert.doesNotThrow(() => c.eventBodyOf(t, true));
});

test('a re-import of a repeat keeps the SERIES end, not the occurrence end', () => {
  const c = make();
  const t = wakeup(c);
  c.state.tasks = [t];
  const master = { id: 'e2', summary: 'Wakeup routine',
    start: { dateTime: '2026-09-09T07:00:00-07:00' }, end: { dateTime: '2026-09-09T07:30:00-07:00' },
    recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261020T070000Z'] };
  const inst = Object.assign({}, master, { id: 'e2_20260910T140000Z', recurringEventId: 'e2' });
  delete inst.recurrence;

  const r = c.mergeCalendarEvents([t], [{ cid: 'primary', items: [inst] }],
    { 'primary|e2': master }, { primary: { id: 'primary', summary: 'Personal' } }, {}, []);
  assert.equal(r.updated, 1);
  assert.equal(t.recur.durMs, 30 * 60000, 'the occurrence length comes from the master\'s own span');
  assert.equal(t.recur.until, null, 'the rule no longer carries the series end — the task does');
  assert.equal(t.end, Date.UTC(2026, 9, 20, 7, 0, 0),
    'the series end is the RRULE\'s UNTIL; writing the occurrence\'s 7:30am here ended the series on day one');
});

test('the repair sweep re-pushes exactly the linked repeats, with the corrected body', () => {
  const c = make();
  const plain = c.normalizeTask({ id: 'p', name: 'One off', start: day(2026, 8, 11, 9, 0),
    end: day(2026, 8, 11, 10, 0), startClock: true, endClock: true, calendarId: 'primary', eventId: 'e3' });
  const unlinked = c.normalizeTask({ id: 'u', name: 'Local only', start: day(2026, 8, 11), end: day(2026, 9, 1),
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: DAY, shifts: [], overrides: {} } });

  const ops = c.gcalRepairRepeatOps([exercise(c), wakeup(c), plain, unlinked]);
  assert.deepEqual(ops.map(o => o.taskId), ['ex', 'wu'],
    'only repeats that already have an event to fix — nothing is created');
  assert.ok(ops.every(o => o.op === 'patch' && o.eventId));
  assert.deepEqual(ops[0].body.end, { date: '2026-09-02' }, 'and the patch carries the corrected occurrence');
});
