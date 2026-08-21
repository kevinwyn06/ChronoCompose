/* PP-EXT (owner 2026-08-20) Chain A, Task 10 — Exact → Flexible unpins the END only.
 *
 * The owner's rule: "unticked events preserve their start time but their end times may change." Half of
 * it was already true. `isFixedOn` gates on `isUncompressable`, so unticking drops the task out of
 * `fixedBlocksToday` and into the compressible set, while `notBeforeMsOf` is deliberately untouched and
 * still returns the occurrence start — the packer cannot place the task earlier than its clock.
 *
 * The half that was NOT true is what one task ASKS the day for. `requestedMinutes` rung 3 reads
 * `clockSpanMinutes`, which applies only `isFixedOn`'s day-fit test and never looked at the Exact/Flexible
 * decision. So a task the user had explicitly marked Flexible went on demanding its full clock span —
 * "this may be squeezed" and "this needs exactly 90 minutes" at the same time. Unpinning the end has to
 * mean the clocks stop carrying the duration, or the toggle only half-works.
 *
 * The gate lives in `requestedMinutes`, NOT in `clockSpanMinutes`: `isUncompressable` derives its own
 * answer from `clockSpanMinutes(t) != null`, so gating there would be infinite recursion. It reads the RAW
 * field rather than `isUncompressable`, because only an explicit `false` is a user decision — a null
 * (never decided) clocked task is still Exact by derivation and must keep its span.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

// A 10:30–12:00 appointment with no typed estimate: the shape where rung 3 is the only thing answering.
function appt(c, over) {
  const day = c.startOfToday();
  return c.normalizeTask(Object.assign({
    id: 'ap', name: 'Standup', planned: null,
    start: day + 10.5 * HOUR, end: day + 12 * HOUR,
    startClock: true, endClock: true, included: true,
  }, over || {}));
}

test('flexible unpins the end only: the start survives as a not-before anchor', () => {
  const c = make();
  const day = c.startOfToday();
  const t = appt(c);
  c.state.tasks = [t];

  assert.equal(c.isUncompressable(t, day), true,
    'precondition: a clocked task with no stored decision derives as Exact');
  assert.equal(c.isFixedOn(t, day), true, 'precondition: and it is a fixed block');

  c.setUncompressable('ap', false);
  const got = c.state.tasks.find(x => x.id === 'ap');

  assert.equal(got.uncompressable, false, 'the decision is stored explicitly, not left to derivation');
  assert.equal(c.isFixedOn(got, day), false,
    'the END is released — the task leaves fixedBlocksToday for the compressible set');
  assert.equal(c.notBeforeMsOf(got, day), day + 10.5 * HOUR,
    'the START holds: the packer still cannot place it before its clock');
});

test('flexible unpins the end only: rung 3 stops applying, so the clocks stop carrying the duration', () => {
  const c = make();
  const day = c.startOfToday();
  const t = appt(c);
  c.state.tasks = [t];

  assert.equal(c.requestedMinutes(t, day), 90,
    'precondition: while Exact, the appointment asks for its clock span');

  c.setUncompressable('ap', false);
  const got = c.state.tasks.find(x => x.id === 'ap');

  assert.equal(c.clockSpanMinutes(got, day), 90,
    'the span is still READABLE — the toggle changes what the ladder uses, not what the clocks say');
  assert.equal(c.requestedMinutes(got, day), c.DEFAULT_TASK_MINUTES,
    'but the ask falls through rung 3 to the 5-minute default, because an unpinned end means the ' +
    'clocks no longer state a duration');
});

test('flexible unpins the end only: `planned` keeps its three values', () => {
  const c = make();
  const day = c.startOfToday();

  // Rung 2 outranks rung 3, so an explicit estimate is unaffected by the toggle in EITHER position.
  for (const uncompressable of [true, false]) {
    const label = uncompressable ? 'Exact' : 'Flexible';
    assert.equal(c.requestedMinutes(appt(c, { planned: 45, uncompressable }), day), 45,
      `${label}: > 0 is an estimate and is honoured`);
    assert.equal(c.requestedMinutes(appt(c, { planned: 0, uncompressable }), day), 0,
      `${label}: a deliberate 0 asks for nothing — never confused with "no estimate"`);
  }
  // null is the only value that reaches rung 3, and it is the only one the toggle moves.
  assert.equal(c.requestedMinutes(appt(c, { planned: null, uncompressable: true }), day), 90,
    'null + Exact: the clocks answer');
  assert.equal(c.requestedMinutes(appt(c, { planned: null, uncompressable: false }), day),
    c.DEFAULT_TASK_MINUTES, 'null + Flexible: the default answers');
});

test('flexible unpins the end only: a NEVER-DECIDED clocked task keeps its span', () => {
  const c = make();
  const day = c.startOfToday();
  // The whole point of the tri-state: `null` is not `false`. Only an explicit Flexible releases the end,
  // so a task that merely gained clock times still behaves as the appointment it looks like.
  const t = appt(c, { uncompressable: null });
  assert.equal(t.uncompressable, null, 'normalizeTask stores nothing — the field stays undecided');
  assert.equal(c.requestedMinutes(t, day), 90,
    'undecided derives as Exact, so the clocks still carry the duration');
});

test('flexible unpins the end only: the day\'s demand moves with it', () => {
  const c = make();
  const day = c.startOfToday();
  cleanDay(c, day);
  const t = appt(c);
  c.state.tasks = [t];

  const exact = c.computeAllotted(c.state.tasks, day);
  c.setUncompressable('ap', false);
  const flexible = c.computeAllotted(c.state.tasks, day);

  // This is why the ladder change is pinned rather than left to inspection: it is a change to what the
  // day is asked for, and the seam divides the day by those asks.
  assert.equal(exact['ap'].allotted, 90,
    'Exact: reserved off the top at its full clock span');
  assert.equal(flexible['ap'].allotted, c.DEFAULT_TASK_MINUTES,
    'Flexible: it competes for the pool at the default ask instead');
});

/* PP-EXT (owner 2026-08-20) Chain A, Task 11 — no start and no end means TODAY ONLY.
 *
 * `ghostSpan` derives a window for a task that has no dates, so the app has something finite to schedule
 * against. For the fully dateless case it returned `{start: today, end: today + DAY}` — and every window
 * test in the app is inclusive of the END DAY (`startOfDay(win.start) <= B && B <= startOfDay(win.end)`).
 * `startOfDay(today + DAY)` is TOMORROW, so an undated task was active on two days, and showed up in
 * tomorrow's column of the 4-Day and Week timelines as well as today's.
 *
 * The span is now closed at the last instant of today, so `startOfDay(end)` is today and the derived
 * window is genuinely one day. Geometry is unaffected in any way a person can see (the bar loses one
 * millisecond of a 24-hour span) while the day-membership arithmetic changes, which is the point.
 *
 * The two SINGLE-clock branches are deliberately untouched. `start` with no end still runs to
 * `max(start, today) + DAY` — an open-ended task genuinely does continue past today, and shortening it
 * would be a different decision about a different shape. Task 11's rule is about tasks with NEITHER clock.
 */
test('undated single day: a task with neither clock occupies today and no other day', () => {
  const c = make();
  const B = c.startOfToday();
  const t = c.normalizeTask({ id: 'un', name: 'Someday thing', start: null, end: null, included: true });
  c.state.tasks = [t];

  const g = c.ghostSpan(t, B);
  assert.equal(c.startOfDay(g.start), B, 'the derived window opens today');
  assert.equal(c.startOfDay(g.end), B, 'and CLOSES today — not tomorrow');

  // A four-day window, the shape the acceptance criterion names.
  assert.equal(c.isActiveOn(t, B), true, 'today: present');
  for (let d = 1; d <= 3; d++) {
    assert.equal(c.isActiveOn(t, B + d * DAY), false,
      `today +${d}d: an undated task must not occupy a day nothing put it on`);
  }
});

test('undated single day: tasks with one clock are unaffected', () => {
  const c = make();
  const B = c.startOfToday();

  // start, no end: genuinely open-ended, so it still runs past today.
  const openEnd = c.normalizeTask({ id: 'oe', name: 'Open ended', start: B, end: null });
  const ge = c.ghostSpan(openEnd, B);
  assert.equal(ge.start, B, 'the real start is kept');
  assert.equal(ge.end, B + DAY, 'and the ghost end still reaches past today, as before');
  assert.equal(ge.ghostEnd, true);

  // end, no start: the ghost start still reaches back a day.
  const openStart = c.normalizeTask({ id: 'os', name: 'Due only', start: null, end: B + 2 * DAY });
  const gs = c.ghostSpan(openStart, B);
  assert.equal(gs.end, B + 2 * DAY, 'the real end is kept');
  assert.equal(gs.start, B, 'and the ghost start is min(today, end − DAY), untouched');
  assert.equal(gs.ghostStart, true);
});
