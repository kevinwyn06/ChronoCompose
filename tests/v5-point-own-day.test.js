// Chain 4 / block 19b — a Point exists only on its own day (V5 finding F3, card 02).
//
// A Point is "a clocked instant with no end and no duration": a start clock, `end == null`, planned 0.
// It reserves NOTHING — its clock is a divider the packer will not cross, nothing more.
//
// `isPointOn` already recognised that shape on the day the clock falls on. But on every OTHER day the
// task was just an ordinary zero-planned ACTIVE task, because `isActiveOn` derives a window for a
// dateless-ended task through `ghostSpan`, which runs `start → max(start, today) + DAY`. That window
// covers the NEXT day too, so `compressionSeam` handed the marker `DEFAULT_TASK_MINUTES` (30) out of
// the pool — with inverted salience: a hairline caret on the day it matters, a solid half-hour block
// on a day it was never about, taken off everything else. The sheet printed "—" correctly; the
// timeline did not. Two renderers, two answers.
//
// Owner decision, verbatim: "A Point exists only on its own day."
//
// The fix is a veto in `isActiveOn`, not a change to `isPointOn`: the Point shape is decided
// day-independently (`isPointTask`), then a Point is simply ABSENT on any day that is not its own —
// not present-with-zero-minutes, which is what let 30 minutes leak.
//
// NOT IN SCOPE, and asserted against below: deliberate over-subscription. Only the Point's
// illegitimate 30 minutes may leave the day; every other task keeps exactly what it had.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

// One 00:00–23:59 day, no meals, no reserve, so a day's contents are a function of the fixture alone.
// `flex` spans yesterday → +3d, so it is active on every day the tests query.
// `point` is a Point at 15:00 TODAY: start clock, no end, planned 0.
function fixture(){
  const c = make();
  cleanDay(c, '23:59');
  const today = c.startOfToday();
  const flex = activeTask(c, { id: 'flex', name: 'Write the quarterly report',
    start: today - DAY, end: today + 3 * DAY, planned: 240, priority: 2 });
  const point = c.normalizeTask({ id: 'point', name: 'Pick up the kids', type: 'Proportional',
    priority: 1, deps: [], pct: 0, planned: 0, spent: 0,
    start: today + 15 * HOUR, startClock: true, end: null, included: true });
  c.state.tasks = [flex, point];
  return { c, today, flex, point };
}

test('fixture sanity: it really is a Point, and it is a Point on today', () => {
  const { c, today, point } = fixture();
  assert.equal(c.isPointOn(point, today), true, 'today is the Point\'s own day');
  assert.equal(c.hasStartTime(point), true);
  assert.equal(point.end, null);
});

// --- the defect itself ---------------------------------------------------------------------------

test('a Point contributes nothing to the pool on a day that is not its own', () => {
  const { c, today, point } = fixture();
  for (const d of [1, 2, 3]) {
    const B = today + d * DAY;
    const map = c.computeAllotted(c.state.tasks, B);
    const got = (map[point.id] || {}).allotted || 0;
    assert.equal(got, 0, `+${d}d: the Point took ${got} minutes out of a day it is not on`);
  }
});

test('a Point is absent, not present-with-zero, on a day that is not its own', () => {
  const { c, today, point } = fixture();
  assert.equal(c.isActiveOn(point, today + DAY), false,
    'tomorrow must not treat the marker as work at all');
  assert.equal(c.isPointOn(point, today + DAY), false, 'and it is not a Point there either');
});

// --- what must NOT change ------------------------------------------------------------------------

test('a Point still works on its own day: active, a Point, and drawn as a keep-clear divider', () => {
  const { c, today, point } = fixture();
  assert.equal(c.isActiveOn(point, today), true);
  assert.equal(c.keepClearToday(today, c.state.tasks).length, 1, 'the divider is still there');
  assert.equal(c.pointsToday(today, c.state.tasks).map(p => p.id).join(), 'point');
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal((map[point.id] || {}).allotted || 0, 0, 'and it still reserves nothing, by definition');
});

test('a Point on a FUTURE day is a Point on that day and nowhere else', () => {
  const { c, today } = fixture();
  const later = c.normalizeTask({ id: 'later', name: 'Dentist', type: 'Proportional', priority: 1,
    deps: [], pct: 0, planned: 0, spent: 0, start: today + 2 * DAY + 11 * HOUR, startClock: true, end: null });
  c.state.tasks.push(later);
  assert.equal(c.isPointOn(later, today + 2 * DAY), true, 'on its own day');
  assert.equal(c.isActiveOn(later, today + 3 * DAY), false, 'not the day after');
  assert.equal(c.isActiveOn(later, today), false, 'and not today');
});

test('a non-Point UNESTIMATED task is unaffected — it still takes its default slice', () => {
  const { c, today } = fixture();
  // Same missing estimate, but a real end: an ordinary unestimated flexible task, NOT a Point.
  // 2026-08-16: the carrier of "no time given" is now `planned:null`, not `planned:0`. A typed 0 is a
  // decision to ask the day for nothing — giving it the default slice anyway was the owner's report
  // ("0 minute tasks are getting 30 minutes"), so that half of the old assertion is REVERSED below.
  const unset = activeTask(c, { id: 'unset', name: 'Tidy up', start: today - DAY, end: today + 3 * DAY,
    planned: null, priority: 3 });
  c.state.tasks.push(unset);
  const map = c.computeAllotted(c.state.tasks, today + DAY);
  assert.equal(((map[unset.id] || {}).allotted || 0), c.DEFAULT_TASK_MINUTES,
    'the DEFAULT_TASK_MINUTES slice belongs to work with no estimate, and stays');
  const zero = activeTask(c, { id: 'zero', name: 'Nothing', start: today - DAY, end: today + 3 * DAY,
    planned: 0, priority: 3 });
  c.state.tasks.push(zero);
  const map2 = c.computeAllotted(c.state.tasks, today + DAY);
  assert.equal(((map2[zero.id] || {}).allotted || 0), 0,
    'a deliberate 0 competes normally and is allotted nothing');
});

test('a task with a start clock but a real end is a fixed appointment, not a Point', () => {
  const { c, today } = fixture();
  const appt = c.normalizeTask({ id: 'appt', name: 'Standup', type: 'Proportional', priority: 1,
    deps: [], pct: 0, planned: 30, spent: 0,
    start: today + DAY + 9 * HOUR, end: today + DAY + 9.5 * HOUR, startClock: true, endClock: true });
  c.state.tasks.push(appt);
  assert.equal(c.isFixedOn(appt, today + DAY), true, 'the veto must not reach appointments');
  assert.equal(c.computeAllotted(c.state.tasks, today + DAY)[appt.id].allotted, 30);
});

// --- the whole point of the block: only the Point's minutes leave the day -------------------------

test('removing the Point returns its minutes to the rest of the day, and nothing else moves', () => {
  const { c, today, flex, point } = fixture();
  const B = today + DAY;
  const withPoint = c.computeAllotted(c.state.tasks, B);
  // The control: the same day computed from a task list that never contained the Point at all.
  const c2 = make();
  cleanDay(c2, '23:59');
  c2.state.tasks = [c2.normalizeTask(Object.assign({}, flex))];
  const without = c2.computeAllotted(c2.state.tasks, B);
  assert.equal((withPoint[point.id] || {}).allotted || 0, 0);
  assert.equal(withPoint[flex.id].allotted, without[flex.id].allotted,
    'the day is identical to one the marker was never in — the schedule got no emptier, only correct');
});
