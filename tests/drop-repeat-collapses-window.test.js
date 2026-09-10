// Owner report, 2026-09-09 (third session): *"The same issues exist for stuff like email follow-ups, check-in
// research. It's very weird on gcal, and I'm unable to change it in chronocompose from a recurring task
// to a non recurring task."*
//
// Both halves are one defect. Under the series-window model a repeat's start/end are the WINDOW it
// repeats over, not an occurrence. `setRecur(id,'none')` nulled the rule and stopped, so the window
// survived it as a plain span — a weekly one-hour task with a term-long window became a single 86-day
// block. The sheet showed a bar that still crossed the whole term, and the push wrote that span to
// Google as one enormous event. Nothing about the drop LOOKED like it had worked.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

const MIN = 60000, DAY = 86400000;
const day = (y, m, d, h, mi) => new Date(y, m, d, h || 0, mi || 0, 0, 0).getTime();

// A component whose commit() applies in place, so a setter's effect is readable straight off state.
function rig(task) {
  const c = make();
  const t = c.normalizeTask(task);
  c.state.tasks = [t]; c.state.sections = [];
  c.commit = fn => { fn(c.state.tasks); };
  return { c, t: () => c.state.tasks[0] };
}

// The owner's "Advisor research": a weekly one-hour slot whose window runs Sep 8 → Dec 3.
const windowed = extra => Object.assign({
  id: 'ar', name: 'Advisor research', planned: 60,
  start: day(2026, 8, 8, 14, 0), end: day(2026, 11, 3, 23, 59), startClock: true,
  calendarId: 'primary', eventId: 'e1',
  recur: { kind: 'week', n: 1, label: 'Weekly', durMs: 60 * MIN, shifts: [], overrides: {} },
}, extra || {});

test('dropping the repeat collapses the series window to the occurrence', () => {
  const { c, t } = rig(windowed());
  assert.ok(t().end - t().start > 80 * DAY, 'precondition: the stored span is the whole window');

  c.setRecur('ar', 'none');

  assert.equal(t().recur, null, 'the rule is gone');
  assert.equal(t().start, day(2026, 8, 8, 14, 0),
    'the anchor is untouched — dropping a rule must not silently redate the task');
  assert.equal(t().end - t().start, 60 * MIN,
    'and the span is now the occurrence the rule carried, not the range it repeated over');
});

test('the dropped task pushes ONE hour to Google, not the whole term', () => {
  const { c, t } = rig(windowed());
  c.setRecur('ar', 'none');
  const body = c.eventBodyOf(t(), true);

  assert.match(body.start.dateTime, /^2026-09-08T14:00:00/);
  assert.match(body.end.dateTime, /^2026-09-08T15:00:00/,
    'this is the line the owner saw fail: the event used to close on Dec 3');
  assert.deepEqual(body.recurrence, [], 'and the series is explicitly retired');
});

test('a repeat whose occurrence length is zero falls back to the plan', () => {
  // The four tasks (Lunch, Dinner, journal, Team Meeting) the window migration left at durMs 0.
  const { c, t } = rig(windowed({ planned: 30, recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } }));
  c.setRecur('ar', 'none');
  assert.equal(t().end - t().start, 30 * MIN,
    'a zero-length occurrence is not a usable end, so Planned answers instead of leaving the window');
});

test('with neither an occurrence length nor a plan, the task collapses to its anchor day', () => {
  const { c, t } = rig(windowed({ planned: 0, startClock: false, start: day(2026, 8, 8),
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } }));
  c.setRecur('ar', 'none');
  assert.equal(t().end, day(2026, 8, 9), 'one whole day, and never the term');
});

test('dropping a repeat that had no window at all still just drops the rule', () => {
  const { c, t } = rig({ id: 'ar', name: 'R', start: day(2026, 8, 8, 9, 0), end: null, startClock: true, planned: 60,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 45 * MIN, shifts: [], overrides: {} } });
  c.setRecur('ar', 'none');
  assert.equal(t().recur, null);
  assert.equal(t().end - t().start, 45 * MIN,
    'an unbounded series still has an occurrence, and that is what the single task becomes');
});

test('a task with no rule is unchanged by picking "Does not repeat"', () => {
  const { c, t } = rig({ id: 'ar', name: 'P', start: day(2026, 8, 8, 9, 0), end: day(2026, 8, 10), startClock: true });
  c.setRecur('ar', 'none');
  assert.equal(t().recur, null);
  assert.equal(t().end, day(2026, 8, 10), 'a plain multi-day task keeps its span — it was never a window');
});

test('a dateless repeat is not given invented dates by the drop', () => {
  const { c, t } = rig({ id: 'ar', name: 'G', start: null, end: null,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 60 * MIN, shifts: [], overrides: {} } });
  c.setRecur('ar', 'none');
  assert.equal(t().recur, null);
  assert.equal(t().start, null);
  assert.equal(t().end, null);
});

test('the drop is a real outbound change, and it re-times the event as well as retiring the rule', () => {
  const c = make();
  const before = c.normalizeTask(windowed());
  const { c: c2, t } = rig(windowed());
  c2.setRecur('ar', 'none');
  const ops = c.computeOutboundOps([before], [t()]);
  const patch = ops.find(o => o.op === 'patch');
  assert.ok(patch, 'the change reaches the queue');
  assert.match(patch.body.end.dateTime, /^2026-09-08T15:00:00/);
  assert.deepEqual(patch.body.recurrence, []);
});
