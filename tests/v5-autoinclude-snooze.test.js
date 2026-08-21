// Chain 4 / block 20 — undecided work is not a refusal, and snooze survives being missed (F19, F20).
//
// Owner, card 03, verbatim: "What? Of course it should be auto included."
// Owner, snooze, verbatim:  "It should be autoincluded after its snooze ends. It shows up in the new
//                            column on that day, and then joins the existing column afterwards."
//
// F19 — doing nothing read as saying no. A task whose occurrence window OPENS today but which the user
// had never pressed (`included:null` — the legacy/backlog/unpressed state) was absent from today
// entirely: `isActiveOn`'s today branch demanded `included===true || isInheritedToday`, and neither
// holds on a window's FIRST day. No allotment, no block, no top-hover chip (`isTopHoverOn` bails on
// `isOptedOut`), and it sat under a band header reading EXCLUDED. It resurfaced one day late as
// Overdue. That is the app converting "I have not looked at this yet" into "I decided against this",
// which is the exact failure `isUndecided` exists to prevent.
//
// F20 — snooze return expired by calendar rather than acknowledgement. `snoozeEndedToday` is true only
// on the EXACT expiry day, and `originOf` checked `isInheritedToday` BEFORE it, so an expiring snooze
// on a multi-day window reported `existing` on the very day it came back — the one day the user needed
// to be told. And a window that OPENS on the expiry day was not brought back at all.
//
// The fix is one new pure predicate, `autoIncludedToday`, plus a reorder in `originOf`. No new state:
// `snoozeUntil` is never cleared on expiry, so the field itself records the ending.
//
// DELIBERATELY NOT FIXED, and asserted below as a boundary: a DATELESS someday pick is not auto-
// included. `ghostSpan` anchors a dateless task at today, so every dateless task would trivially
// qualify and the day would fill with work the calendar never surfaced — the same reason `startsToday`
// excludes them. They stay in Extra, where a discretionary pick belongs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, DAY } = require('./_load.js');

// One 00:00–23:59 day, no meals, no reserve, pack-from-now off: the pool is a function of the fixture.
function ctx(){
  const c = make();
  cleanDay(c, '23:59');
  return { c, T: c.startOfToday() };
}

// `included:null` is the UNTOUCHED state — the whole subject of F19. `normalizeTask` defaults new tasks
// to `included:true`, so every fixture here says null explicitly or it would prove nothing.
function untouched(c, over){
  return c.normalizeTask(Object.assign({
    id: 't', name: 'Draft the grant application', type: 'Proportional', priority: 3,
    deps: [], pct: 0, planned: 90, spent: 0, start: null, end: null, included: null,
  }, over || {}));
}

const allotOf = (c, t, B) => (c.computeAllotted(c.state.tasks, B)[t.id] || {}).allotted || 0;

// --- 20a: F19, a window that opens today brings the task in -----------------------------------------

test('a task whose window opens today is active today, even untouched', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  assert.equal(c.isActiveOn(t, T), true, 'untouched is not a refusal');
  assert.ok(allotOf(c, t, T) > 0, 'and it must actually receive allotment, not merely be "active"');
});

test('a task whose window opens today reports origin `new`', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  c.sweepOnListSince(c.state.tasks, T, Date.now());
  assert.equal(c.originOf(t), 'new', 'today brought it in, and the New bucket is where you cheaply say no');
});

test('a task whose window opens today is NOT filed under the EXCLUDED band header', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  assert.equal(c.isOptedOut(t), false, 'opted out is a decision the user never made');
  assert.equal(c.inclBand(t), 'included');
  assert.equal(c.isUndecided(t), false);
  c.sweepOnListSince(c.state.tasks, T, Date.now());
  const proj = c.selectionProjection(c.state.tasks);
  assert.equal(proj.cells.new.length, 1, 'it is in New');
  assert.equal(proj.colCount.upcoming, 0, 'and not parked in the Upcoming fallback');
});

test('auto-inclusion reaches the top-hover chip too', () => {
  const { c, T } = ctx();
  // A top-hover chip is a dated-but-untimed, zero-planned task, and it belongs to the day its due
  // instant falls on — so this one both opens AND ends today.
  const t = untouched(c, { start: T, end: T, planned: 0 });
  c.state.tasks = [t];
  assert.equal(c.isTopHoverOn(t, T), true, 'isTopHoverOn bailed on isOptedOut — that bail must stop firing');
});

// --- 20b: F20, an expiring snooze brings the task back, and says so ----------------------------------

test('a snooze expiring today auto-includes and reports origin `new`, not `existing`', () => {
  const { c, T } = ctx();
  // Multi-day window, so `isInheritedToday` is true and used to win the `originOf` race.
  const t = untouched(c, { start: T - 2 * DAY, end: T + 3 * DAY, snoozeUntil: T });
  c.state.tasks = [t];
  assert.equal(c.snoozeEndedToday(t), true, 'fixture sanity: the snooze runs out today');
  assert.equal(c.isActiveOn(t, T), true);
  assert.ok(allotOf(c, t, T) > 0);
  c.sweepOnListSince(c.state.tasks, T, Date.now());
  assert.equal(c.originOf(t), 'new', 'the day it comes back is the day you need to be told');
});

test('a snooze expiring on the day the window opens still brings the task back', () => {
  const { c, T } = ctx();
  // Nothing inherits here: the window has no yesterday. Pre-fix this task was stranded outright.
  const t = untouched(c, { start: T, end: T + 3 * DAY, snoozeUntil: T });
  c.state.tasks = [t];
  assert.equal(c.isInheritedToday(t), false, 'fixture sanity: inheritance cannot rescue this one');
  assert.equal(c.isActiveOn(t, T), true);
  c.sweepOnListSince(c.state.tasks, T, Date.now());
  assert.equal(c.originOf(t), 'new');
});

test('a snooze that expired three days ago and was never seen still brings the task back', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T - 5 * DAY, end: T + 3 * DAY, snoozeUntil: T - 3 * DAY });
  c.state.tasks = [t];
  assert.equal(c.snoozeEndedToday(t), false, 'the expiry day is long gone');
  assert.equal(c.isActiveOn(t, T), true, 'a missed expiry must not strand the task');
  c.sweepOnListSince(c.state.tasks, T, Date.now());
  /* PP-EXT (owner 2026-08-20): `onListSince` is OBSERVED, and this workspace has no observation of the
     days the app was shut. The first sweep that sees the task on the list therefore stamps TODAY, so it
     reads `new` rather than `continued`. That is inherent to an observed field rather than a defect —
     and it is exactly why Task 3 ships a one-time backfill for workspaces that predate it. What matters
     for THIS test is unchanged: the task came back and is not parked in the someday fallback. */
  assert.equal(c.originOf(t), 'new');
  assert.notEqual(c.originOf(t), 'upcoming', 'and it is not a someday pick');
});

// --- boundaries: what auto-inclusion must NOT swallow -------------------------------------------------

test('an ACTIVE snooze is still a decision — it stays out of today', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T - 2 * DAY, end: T + 3 * DAY, snoozeUntil: T + 2 * DAY });
  c.state.tasks = [t];
  assert.equal(c.isActiveOn(t, T), false);
  assert.equal(c.isOptedOut(t), true);
  assert.equal(c.inclState(t), 'snoozed');
  assert.equal(allotOf(c, t, T), 0);
});

test('a dateless someday pick is NOT auto-included, snoozed or not', () => {
  const { c, T } = ctx();
  const plain = untouched(c, { id: 'plain' });
  const oldSnooze = untouched(c, { id: 'oldSnooze', snoozeUntil: T - 3 * DAY });
  c.state.tasks = [plain, oldSnooze];
  for(const t of c.state.tasks){
    assert.equal(c.isScheduled(t), false, 'fixture sanity: dateless');
    assert.equal(c.isActiveOn(t, T), false, t.id + ': the someday pile must not pour into today');
    c.sweepOnListSince([t], T, Date.now());
    assert.equal(c.originOf(t), 'upcoming');
  }
});

test('a completed task whose window opens today is not dragged back in', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY, pct: 100 });
  c.state.tasks = [t];
  assert.equal(c.isActiveOn(t, T), false);
});

test('auto-inclusion is a TODAY rule — it does not change any other day', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  // Other days were, and remain, decided by the window alone.
  assert.equal(c.isActiveOn(t, T + DAY), true);
  assert.equal(c.isActiveOn(t, T - DAY), false, 'before the window');
  assert.equal(c.isActiveOn(t, T + 9 * DAY), false, 'after it');
});

// --- saying no must stay one gesture (block 24 makes it cheap; it must WORK today) --------------------

/* PP-EXT (owner 2026-08-20): the REMOVAL these two guard is real and still required — an opt-out that
   auto-inclusion immediately undoes is not an opt-out. What changed is which verb performs it. It used to
   be a hidden snooze tail inside `setIncludedOff`; that tail made "Snooze today" and "Take out of today"
   write identical state, which is the defect the owner reported. Snooze is now the only verb that
   removes, and it is what the UI offers, so these assert through it. */

test('snoozing an auto-included task actually removes it from today', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  assert.equal(c.isActiveOn(t, T), true, 'in first');
  c.snoozeToday(t.id);
  const after = c.state.tasks.find(x => x.id === t.id);
  assert.equal(c.isActiveOn(after, T), false, 'an opt-out that auto-inclusion immediately undoes is not an opt-out');
  assert.equal(c.isOptedOut(after), true);
  assert.equal(allotOf(c, after, T), 0);
});

test('snoozing a snooze-returned task actually removes it from today', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T - 2 * DAY, end: T + 3 * DAY, snoozeUntil: T });
  c.state.tasks = [t];
  c.snoozeToday(t.id);
  const after = c.state.tasks.find(x => x.id === t.id);
  assert.equal(c.isActiveOn(after, T), false);
});

test('unpressing alone only un-chooses — it does not pretend to remove', () => {
  const { c, T } = ctx();
  const t = untouched(c, { start: T, end: T + 3 * DAY });
  c.state.tasks = [t];
  c.setIncludedOff(t.id);
  const after = c.state.tasks.find(x => x.id === t.id);
  assert.equal(after.included, null, 'un-chosen');
  assert.equal(after.snoozeUntil, null, 'and no hidden snooze written on the way out');
  assert.equal(c.isActiveOn(after, T), true,
    'auto-inclusion legitimately brings it back: the window IS open, and hiding that was the old lie');
});

// --- the invariant the block must not break -----------------------------------------------------------

test('pool agreement holds with auto-included work in the day', () => {
  const { c, T } = ctx();
  // A realistic mixed day: pressed work, an auto-included window opening, and a snooze running out.
  const pressed = c.normalizeTask({ id: 'p', name: 'Report', type: 'Proportional', priority: 2,
    deps: [], pct: 0, planned: 240, spent: 0, start: T - DAY, end: T + 2 * DAY, included: true });
  const opening = untouched(c, { id: 'o', name: 'Grant', start: T, end: T + 3 * DAY, planned: 120 });
  const returning = untouched(c, { id: 'r', name: 'Reply', start: T - 2 * DAY, end: T + 3 * DAY,
    planned: 60, snoozeUntil: T });
  c.state.tasks = [pressed, opening, returning];
  const map = c.computeAllotted(c.state.tasks, T);
  const active = c.state.tasks.filter(x => c.isActiveOn(x, T));
  assert.equal(active.length, 3, 'all three compete today');
  const sum = active.reduce((a, x) => a + ((map[x.id] || {}).allotted || 0), 0);
  const pool = c.dayPoolMinutes ? c.dayPoolMinutes(T) : null;
  // Every active task must be present in the map, and the day must not hand out more than it has.
  active.forEach(x => assert.ok(map[x.id] != null, x.id + ' is active but absent from the allotment map'));
  assert.ok(sum > 0);
  if(pool != null) assert.ok(sum <= pool + 1, 'allotment sum ' + sum + ' exceeds the pool ' + pool);
});

test('auto-inclusion adds demand rather than redistributing it away from pressed work', () => {
  const { c, T } = ctx();
  const pressed = c.normalizeTask({ id: 'p', name: 'Report', type: 'Proportional', priority: 2,
    deps: [], pct: 0, planned: 240, spent: 0, start: T - DAY, end: T + 2 * DAY, included: true });
  c.state.tasks = [pressed];
  const alone = allotOf(c, pressed, T);
  const opening = untouched(c, { id: 'o', name: 'Grant', start: T, end: T + 3 * DAY, planned: 120 });
  c.state.tasks = [pressed, opening];
  assert.ok(allotOf(c, opening, T) > 0, 'the newly-arrived task is really in the pool');
  // The day gets fuller. That is the owner's deliberate over-subscription signal, not a bug to cap.
  assert.ok(allotOf(c, pressed, T) <= alone, 'a fuller day compresses; nothing is trimmed to hide it');
});
