// Chain 4 / block 30b — three honest phrases for a zero pool.
//
// Block 28b made EVERY zero pool read "no room" and its own handoff flagged that as wrong: an empty
// day window, or `packFromNow` with the day already over, is not a booked day. Owner ruling, verbatim:
// *"split out the phrases into three."*
//
//   • genuinely booked out (appointments/keep-clear fill the day)  → "no room"
//   • nothing scheduled at all (empty window)                      → "nothing scheduled"
//   • all the day's work is finished                               → "all done"
//
// The wording above is the owner's and is asserted literally — these tests exist partly so a later
// block cannot quietly "improve" it.
//
// PRESENTATION ONLY. `computeAllotted`, per-day `planned` semantics and the two numbers (`demand`,
// `pool`) are untouched by this block; what changes is what the same numbers are made to SAY. The
// first test below pins exactly that, so a future edit that reaches into the arithmetic fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

/* A 09:00–17:00 window filled end to end by three appointments. Placed work, not flexible demand, so
   demand and pool are both zero — but the day is unmistakably committed. (Same fixture shape as 28b's.) */
function bookedSolid(){
  const c = make();
  cleanDay(c, '23:59');
  Object.assign(c.state.settings, { dayStart: '09:00', dayEnd: '17:00', breakMin: 0 });
  const today = c.startOfToday();
  const appt = (id, h0, h1) => c.normalizeTask({ id, name: id, type: 'Proportional', priority: 4,
    deps: [], pct: 0, planned: (h1 - h0) * 60, spent: 0,
    start: today + h0 * HOUR, end: today + h1 * HOUR, startClock: true, endClock: true });
  c.state.tasks = [appt('m1', 9, 12), appt('m2', 12, 14), appt('m3', 14, 17)];
  return { c, today };
}

/* A day with NO WINDOW AT ALL: dayStart === dayEnd, no meals, no free-time reserve. The pool is zero
   for the opposite reason — not because the time is taken, but because there is no time. This is also
   the shape `packFromNow` produces once the day is over, which is the case 28b's handoff called out. */
function emptyWindow(){
  const c = make();
  cleanDay(c, '23:59');
  Object.assign(c.state.settings, { dayStart: '09:00', dayEnd: '09:00', breakMin: 0 });
  c.state.tasks = [];
  return { c, today: c.startOfToday() };
}

/* The same windowless day, but work was actually finished on it — completed today and therefore
   ARCHIVED today, which is what the app really does (`autoArchiveDays: 0`, owner choice: a completed
   non-recurring task archives at once). Archived work carries no demand, which is why this day's two
   numbers are both zero while its finished count is one. */
function allFinished(){
  const { c, today } = emptyWindow();
  c.state.tasks = [c.normalizeTask({ id: 'fin', name: 'Shipped it', type: 'Proportional', priority: 4,
    deps: [], pct: 100, planned: 60, spent: 60, start: today, end: today,
    completion: today + 10 * HOUR, archivedAt: today + 10 * HOUR })];
  return { c, today };
}

/* The full variant's two word labels, in render order: "<n> asked" then the free-time phrase. */
const labelsOf = node => node.children
  .filter(x => x && x.children && typeof x.children[0] === 'string')
  .map(x => x.children[0]);
const miniToken = node => node.children[node.children.length - 1].children[0];

// --- the three states are actually distinguished -------------------------------------------------

test('30b: the same two numbers, three different reasons — and the numbers do not move', () => {
  const b = bookedSolid(), e = emptyWindow(), d = allFinished();
  const cb = b.c.dayCapacity(b.today), ce = e.c.dayCapacity(e.today), cd = d.c.dayCapacity(d.today);

  // Every one of them is the zero pool 28b lumped together under one word.
  [cb, ce, cd].forEach(cap => {
    assert.equal(cap.pool, 0);
    assert.equal(cap.demand, 0);
    assert.equal(cap.booked, true, '`booked` keeps its old meaning (pool <= 0) — DOM hooks read it');
  });
  // What is new is WHY.
  assert.equal(cb.state, 'booked');
  assert.equal(ce.state, 'empty');
  assert.equal(cd.state, 'done');
});

test('30b: a day that still has free time is untouched — `open`, and a real percentage', () => {
  const c = make();
  cleanDay(c, '09:00');
  c.state.tasks = [activeTask(c, { id: 'a', planned: 120 })];
  const cap = c.dayCapacity(c.startOfToday());
  assert.equal(cap.state, 'open');
  assert.equal(cap.booked, false);
  assert.equal(miniToken(c.renderCapacityBar(c.startOfToday(), true)), '22%');
});

// --- the owner's exact words ----------------------------------------------------------------------

test('30b: a booked-out day reads "no room"', () => {
  const { c, today } = bookedSolid();
  const full = c.renderCapacityBar(today);
  assert.equal(full.props['data-cap-state'], 'booked');
  assert.ok(labelsOf(full).includes('no room'), labelsOf(full).join(' | '));
  assert.match(full.props.title, /the day is fully committed/);
});

test('30b: a day with no window at all reads "nothing scheduled", NOT "no room"', () => {
  const { c, today } = emptyWindow();
  const full = c.renderCapacityBar(today);
  assert.equal(full.props['data-cap-state'], 'empty');
  const l = labelsOf(full);
  assert.ok(l.includes('nothing scheduled'), l.join(' | '));
  assert.ok(!l.includes('no room'), '28b called this day booked; it never was: ' + l.join(' | '));
});

test('30b: a day whose work is all finished reads "all done"', () => {
  const { c, today } = allFinished();
  const full = c.renderCapacityBar(today);
  assert.equal(full.props['data-cap-state'], 'done');
  const l = labelsOf(full);
  assert.ok(l.includes('all done'), l.join(' | '));
  assert.ok(!l.includes('no room'), l.join(' | '));
});

test('30b: booked beats done — a committed day says so even if its work is also finished', () => {
  const { c, today } = bookedSolid();
  c.state.tasks.push(c.normalizeTask({ id: 'fin', name: 'Shipped it', type: 'Proportional',
    priority: 4, deps: [], pct: 100, planned: 60, spent: 60, start: today, end: today,
    completion: today + 10 * HOUR }));
  assert.equal(c.dayCapacity(today).state, 'booked',
    '"no room" is the more informative of the two when both are true');
});

// --- the drawing, which is where a wrong phrase does real damage ----------------------------------

test('30b: only a BOOKED day is painted full — an empty day must not look busy', () => {
  const booked = bookedSolid();
  const bTrack = booked.c.renderCapacityBar(booked.today).children[1];
  assert.equal(bTrack.children[0].props.style.width, '100%',
    '28b: a committed day drawn empty reads as "nothing on" on the busiest day of the week');

  const empty = emptyWindow();
  const eTrack = empty.c.renderCapacityBar(empty.today).children[1];
  assert.equal(eTrack.children[0].props.style.width, '0%',
    'and the converse: a day with nothing on it must not be painted as if it were full');
});

test('30b: the Week strip carries a per-state token, since it has no room for the phrase', () => {
  const b = bookedSolid();
  assert.equal(miniToken(b.c.renderCapacityBar(b.today, true)), 'full');
  const e = emptyWindow(), d = allFinished();
  assert.equal(miniToken(e.c.renderCapacityBar(e.today, true)), '—');
  assert.equal(miniToken(d.c.renderCapacityBar(d.today, true)), '✓');
});

test('30b: demand against a zero pool still reads "—", whatever the reason the pool is empty', () => {
  const { c, today } = emptyWindow();
  c.state.tasks = [activeTask(c, { id: 'flex', planned: 60 })];
  const cap = c.dayCapacity(today);
  assert.equal(cap.over, true, '60 minutes asked of a day with none really is over');
  assert.equal(miniToken(c.renderCapacityBar(today, true)), '—',
    'a ratio against zero is not a number — 28b established this and 30b does not disturb it');
});

test('30b: a past day still draws nothing at all', () => {
  const { c, today } = bookedSolid();
  assert.equal(c.renderCapacityBar(today - DAY), null);
});

// --- the "finished" rule is shared, not duplicated -------------------------------------------------

test('30b: isCompletedOn is the SAME rule the journal auto-log uses', () => {
  const { c, today } = allFinished();
  assert.equal(c.isCompletedOn(c.state.tasks[0], today), true);
  assert.equal(c.isCompletedOn(c.state.tasks[0], today - DAY), false, 'and it is day-scoped');
  const log = c.journalAutoLog(today);
  assert.equal(log.completed.map(x => x.id).join(','), 'fin',
    'two copies of "finished on day B" would drift; there is one');
});
