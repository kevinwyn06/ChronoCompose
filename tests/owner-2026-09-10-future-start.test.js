/* Owner report, 2026-09-10, verbatim:
     "If a task starts on sept 16, I have no idea why it would be auto included in today. If its sept 16
      9am it doesn't have the same problem. It makes no sense. Today's the 10th. Also, frequently I can't
      delete the time from a date."

   TWO DEFECTS, and the second half of the first sentence is the diagnostic that names them both.

   (1) `isActiveOn`'s today branch honoured `included===true` with NO window test, so a task whose start
       day has not arrived sat on today's list anyway. The 9am variant escaped only by ACCIDENT: a clocked
       start with no end and no planned time is a Point, and a Point is vetoed off every day but its own —
       give that same 9am task a planned duration and it came back onto today. So the clock was never the
       difference; the missing window test was.

       Inclusion is derived from the dates on every read (owner ruling 2026-09-09), and `included===true`
       without `includedExplicit` is not a decision — it is the creation default for a DATELESS task. Once
       such a task is given a future start, honouring the leftover flag pins it to today forever.

   (2) `setDate`'s "start moves end" duration rule fired on a DE-TIMING edit, so clearing the 9am off a
       9–10am appointment slid the end back nine hours to 1:00am. The clock did not go away, it moved —
       which is what "I can't delete the time" looks like from the outside. Owner ruling 2026-09-10:
       clearing one edge's time changes ONLY that edge.
*/
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load.js');

const mk = (c, over) => {
  const t = c.normalizeTask(Object.assign({
    id: 'x' + Math.random().toString(36).slice(2, 7), name: 't', type: 'Proportional',
    priority: 4, deps: [], pct: 0, spent: 0,
  }, over || {}));
  c.state.tasks = [t];
  return t;
};

test('a future start keeps a DEFAULT included:true off today', () => {
  const c = make();
  const B = c.startOfToday(), S = B + 6 * DAY;
  const t = mk(c, { start: S, included: true });
  assert.equal(c.isActiveToday(t), false, 'Sep 16 work is not today’s business');
});

test('the same is true with a clock, and with a planned duration', () => {
  const c = make();
  const B = c.startOfToday(), S = B + 6 * DAY + 9 * 3600000;
  /* Zero-planned + a clock is a Point, which was already vetoed. A planned duration is not, and that is
     the shape that proved the Point veto was standing in for the missing window test. */
  assert.equal(c.isActiveToday(mk(c, { start: S, included: true, planned: 60 })), false);
  assert.equal(c.isActiveToday(mk(c, { start: S, included: true })), false);
});

test('an EXPLICIT press still survives a future start (owner ruling 2026-09-09)', () => {
  const c = make();
  const S = c.startOfToday() + 6 * DAY;
  const t = mk(c, { start: S, included: true, includedExplicit: true });
  assert.equal(c.isActiveToday(t), true, 'a press the user made by hand is a decision, not a default');
});

test('the veto is FUTURE-only: overdue and mid-window work stays on today', () => {
  const c = make();
  const B = c.startOfToday();
  /* An overdue task is the case the veto must never touch — the laziest path must not silently drop a
     missed deadline off the list. */
  assert.equal(c.isActiveToday(mk(c, { start: B - 9 * DAY, end: B - 4 * DAY, included: true })), true);
  assert.equal(c.isActiveToday(mk(c, { start: B - 2 * DAY, end: B + 2 * DAY, included: true })), true);
  assert.equal(c.isActiveToday(mk(c, { start: B, end: B, included: true })), true, 'starts today');
});

test('a dateless task and a deadline-only task keep their press', () => {
  const c = make();
  const B = c.startOfToday();
  assert.equal(c.isActiveToday(mk(c, { included: true })), true, 'no start to be in the future');
  assert.equal(c.isActiveToday(mk(c, { end: B + 6 * DAY, included: true })), true, 'a due date is not a start');
});

test('a mid-series repeat is judged on its ANCHOR, not on its next occurrence', () => {
  const c = make();
  const B = c.startOfToday();
  const t = mk(c, { start: B - 14 * DAY, end: null, included: true, planned: 30,
    recur: { kind: 'week', n: 1, durMs: 30 * 60000 } });
  assert.equal(c.isActiveToday(t), true, 'a running series is not "starts in the future"');
  const later = mk(c, { start: B + 6 * DAY, end: null, included: true, planned: 30,
    recur: { kind: 'week', n: 1, durMs: 30 * 60000 } });
  assert.equal(c.isActiveToday(later), false, 'a series that has not begun is');
});

test('the row agrees with the scheduler: a vetoed task does not read as pressed', () => {
  const c = make();
  const t = mk(c, { start: c.startOfToday() + 6 * DAY, included: true });
  assert.equal(c.inclState(t), 'unpressed');
  assert.equal(c.isOptedOut(t), true);
});

/* ---- (2) de-timing an edge changes ONLY that edge ---------------------------------------------- */

test('clearing the START time leaves the end where it was', () => {
  const c = make();
  const S = c.startOfToday() + 6 * DAY;
  mk(c, { id: 'a', start: S + 9 * 3600000, end: S + 10 * 3600000, planned: 60 });
  c.setDate('a', 'start', S + 9 * 3600000, false);
  const t = c.state.tasks[0];
  assert.equal(t.start, S, 'the start is a bare date now');
  assert.equal(t.end, S + 10 * 3600000, 'and the end did NOT slide back nine hours');
  assert.equal(c.hasStartTime(t), false);
  assert.equal(t.planned, 60, 'an un-booked span does not rewrite the estimate');
});

test('clearing the END time leaves the start where it was', () => {
  const c = make();
  const S = c.startOfToday() + 6 * DAY;
  mk(c, { id: 'a', start: S + 9 * 3600000, end: S + 10 * 3600000, planned: 60 });
  c.setDate('a', 'end', S + 10 * 3600000, false);
  const t = c.state.tasks[0];
  assert.equal(t.start, S + 9 * 3600000, 'the 9am start survives clearing the other edge');
  assert.equal(t.end, S, 'the end is a bare date on the same day');
  assert.equal(c.hasEndTime(t), false);
  assert.equal(t.planned, 60);
  /* The pair is day-ordered, which is what every window test in the app reads. There is no clock span
     left to read, so nothing downstream treats it as an appointment. */
  assert.equal(c.startOfDay(t.start) <= c.startOfDay(t.end), true);
  assert.equal(c.clockSpanMinutes(t), null);
  assert.equal(c.isFixedOn(t, c.startOfDay(t.start)), false);
});

test('a de-timing across DIFFERENT days still refuses to invert the window', () => {
  const c = make();
  const S = c.startOfToday() + 6 * DAY;
  mk(c, { id: 'a', start: S + 9 * 3600000, end: S + 2 * DAY, planned: 60 });
  /* Pulling the END back onto an earlier day is a real re-date, not a de-timing of one edge, so the
     existing clamp still carries the start with it. */
  c.setDate('a', 'end', S - 2 * DAY, false);
  const t = c.state.tasks[0];
  assert.equal(t.end, S - 2 * DAY);
  assert.equal(t.start <= t.end, true, 'the window never inverts across days');
});

test('a timed edit still preserves an appointment’s duration', () => {
  const c = make();
  const S = c.startOfToday() + 6 * DAY;
  mk(c, { id: 'a', start: S + 9 * 3600000, end: S + 10 * 3600000, planned: 60 });
  c.setDate('a', 'start', S + 14 * 3600000, true);
  const t = c.state.tasks[0];
  assert.equal(t.end, S + 15 * 3600000, 'moving a clocked start still carries the end (2026-08-19)');
});
