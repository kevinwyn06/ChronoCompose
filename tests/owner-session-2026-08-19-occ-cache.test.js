// Owner report, 2026-08-19: "I changed the start and end times of an exact task. The planned time did
// not update accordingly."
//
// `setDate` and `dpApply` both end with "a clock edit always makes the booked intra-day span the plan"
// (owner 2026-08-17), and that rule reads the span through `clockSpanMinutes` → `occOnDay`. For a
// RECURRING task those accessors read the memoized `_occById` expansion, which is rebuilt during render
// and therefore still describes the PRE-edit dates while the mutator is running inside `commit()`. The
// span written back was the old occurrence's, or none at all when the new day owned no old occurrence.
//
// Non-recurring tasks were never affected — `occOf` reads `t.start`/`t.end` off the draft — which is
// also why the whole unit suite stayed green: it never populates `_occById`, so every recurring case
// silently took the fresh `expandTask` fallback that production does not take.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

const HOUR = 3600000;

// A rendered app has the occurrence cache populated. Seeding it is what makes these tests describe
// production rather than the harness.
function rendered(c, task){
  c.state.tasks = [task];
  c._horizon = c.startOfToday() + 120 * DAY;
  c._occById = { [task.id]: c.expandTask(task, c._horizon) };
  return c;
}

function appt(c, over){
  const day = c.startOfToday();
  return c.normalizeTask(Object.assign({
    id: 'a', name: 'Standup', planned: null,
    start: day + 9 * HOUR, end: day + 10 * HOUR,
    startClock: true, endClock: true,
  }, over));
}

test('a recurring Exact task re-plans from its NEW end clock, not the cached occurrence', () => {
  const c = make(); const day = c.startOfToday();
  rendered(c, appt(c, { recur: { kind: 'day', n: 1 } }));
  c.setDate('a', 'end', day + 11.5 * HOUR, true);
  const t = c.state.tasks[0];
  assert.equal(c.isUncompressable(t), true, 'still an Exact appointment');
  assert.equal(t.planned, 150,
    'the booked span is 09:00–11:30; the stale cache used to write back the old 60');
});

test('a recurring Exact task re-plans from its NEW start clock', () => {
  const c = make(); const day = c.startOfToday();
  rendered(c, appt(c, { recur: { kind: 'day', n: 1 } }));
  c.setDate('a', 'start', day + 7 * HOUR, true);
  assert.equal(c.state.tasks[0].planned, 180, '07:00–10:00 is 180 minutes');
});

test('a weekly recurring Exact task re-plans even when the edit lands off the old rule', () => {
  const c = make(); const day = c.startOfToday();
  const weekly = { recur: { kind: 'week', n: 1, days: [new Date(day).getDay()] } };
  rendered(c, appt(c, weekly));
  c.setDate('a', 'end', day + 12 * HOUR, true);
  assert.equal(c.state.tasks[0].planned, 180,
    'the weekly rule expands around the edited edge instead of the cached one');
});

test('the non-recurring path keeps behaving, cache or no cache', () => {
  const c = make(); const day = c.startOfToday();
  rendered(c, appt(c, {}));
  c.setDate('a', 'end', day + 11.5 * HOUR, true);
  assert.equal(c.state.tasks[0].planned, 150, 'unchanged by the fix');
});

test('anchorSpanMinutes reads the draft, and keeps both clockSpanMinutes guards', () => {
  const c = make(); const day = c.startOfToday();
  const t = appt(c, { recur: { kind: 'day', n: 1 } });
  rendered(c, t);
  assert.equal(c.anchorSpanMinutes(t), 60, 'the anchor span, with no memo involved');
  assert.equal(c.anchorSpanMinutes({ ...t, end: t.start }), null,
    'a zero-length window is null, not 0 — the same distinction clockSpanMinutes draws');
  assert.equal(c.anchorSpanMinutes({ ...t, end: t.start + 2 * DAY }), null,
    'a window that cannot fit in one day is not an appointment (the day-fit guard)');
  assert.equal(c.anchorSpanMinutes({ ...t, endClock: false }), null,
    'both edges must carry a real clock');
  assert.equal(c.anchorSpanMinutes(null), null, 'no task, no span');
  assert.deepEqual(c._occById.a, c.expandTask(t, c._horizon),
    'the render memo is left alone — rebuilding it mid-commit would answer from a different horizon');
});

test('the memo, left in place, still serves the render path it belongs to', () => {
  const c = make(); const day = c.startOfToday();
  rendered(c, appt(c, { recur: { kind: 'day', n: 1 } }));
  const cached = c._occById.a;
  c.setDate('a', 'end', day + 11 * HOUR, true);
  assert.equal(c._occById.a, cached, 'setDate does not touch _occById');
  assert.equal(c.state.tasks[0].planned, 120, '...and still re-plans correctly from the draft');
});
