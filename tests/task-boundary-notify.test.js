// Owner, 2026-08-16: deadlineRisk is "just a nuisance alarm", and the start/end pair becomes ONE
// notification firing at the day's first task start and at the end of every block. No lead time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const at = (day, h, m) => day + (h * 60 + (m || 0)) * 60000;

function seed(c) {
  const day = c.startOfToday();
  c.state.tasks = [
    c.normalizeTask({ id: 'work', name: 'Work', included: true,
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'gym', name: 'Exercise', included: true,
      start: at(day, 10), end: at(day, 11), startClock: true, endClock: true }),
  ];
  return day;
}

test('the day\'s first task start fires its own boundary', () => {
  const c = make();
  const day = seed(c);
  const plan = c.notifyPlan(at(day, 9), {});
  assert.equal(plan.length, 1, 'exactly one spec at the first start instant');
  assert.equal(plan[0].type, 'taskBoundary', 'the single merged type replaces startPin/blockEnd');
  assert.equal(plan[0].body, 'Work will start',
    'no end precedes the first start of the day, so only the start half renders');
});

test('a block end and the next start pair into one notification', () => {
  const c = make();
  const day = seed(c);
  const plan = c.notifyPlan(at(day, 10), {});
  assert.equal(plan.length, 1, 'ONE notification per instant, not two');
  assert.equal(plan[0].body, 'Work has ended · Exercise will start',
    'both halves render from the single builder, in end-then-start order');
});

test('a block end with nothing following renders only its half', () => {
  const c = make();
  const day = seed(c);
  const plan = c.notifyPlan(at(day, 11), {});
  assert.equal(plan.length, 1, 'the last block end still announces itself');
  assert.equal(plan[0].body, 'Exercise has ended', 'no start half exists at this instant');
});

// Owner, on review of PR #126: "Exact instant only, but if there is a gap the next task should have a
// start notification. I.e. no info loss compared to having both task end and task start notifs, but
// less nuisance." So EVERY clocked start is a trigger, not just the day's first — the reduction comes
// from merging coincident halves and from the retired lead time, never from dropping a start.
test('a non-first start separated by a gap fires on its own', () => {
  const c = make();
  const day = c.startOfToday();
  c.state.tasks = [
    c.normalizeTask({ id: 'a', name: 'Morning', included: true,
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'b', name: 'Afternoon', included: true,
      start: at(day, 14), end: at(day, 15), startClock: true, endClock: true }),
  ];
  const gapEnd = c.notifyPlan(at(day, 10), {});
  assert.equal(gapEnd.length, 1, 'the block end still announces itself');
  assert.equal(gapEnd[0].body, 'Morning has ended',
    'nothing starts at 10:00, so there is no start half to merge');
  const gapStart = c.notifyPlan(at(day, 14), {});
  assert.equal(gapStart.length, 1, 'the later start is announced too — no info loss across the gap');
  assert.equal(gapStart[0].body, 'Afternoon will start',
    'a start with no coincident end renders the start half alone');
});

test('two tasks starting at the same instant share one notification', () => {
  const c = make();
  const day = c.startOfToday();
  c.state.tasks = [
    c.normalizeTask({ id: 'a', name: 'Standup', included: true,
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'b', name: 'Notes', included: true,
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
  ];
  const plan = c.notifyPlan(at(day, 9), {});
  assert.equal(plan.length, 1, 'the instant is the key, so multiplicity cannot split into two specs');
  assert.equal(plan[0].body, 'Standup, Notes will start', 'both names in the one start half');
});

test('one end coinciding with two starts renders both halves once', () => {
  const c = make();
  const day = c.startOfToday();
  c.state.tasks = [
    c.normalizeTask({ id: 'w', name: 'Work', included: true,
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'g', name: 'Exercise', included: true,
      start: at(day, 10), end: at(day, 11), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'l', name: 'Lunch', included: true,
      start: at(day, 10), end: at(day, 11), startClock: true, endClock: true }),
  ];
  const plan = c.notifyPlan(at(day, 10), {});
  assert.equal(plan.length, 1, 'still one notification for the instant');
  assert.equal(plan[0].body, 'Work has ended · Exercise, Lunch will start',
    'the end half stays singular while the start half carries both names');
});

test('an already-fired boundary is not re-emitted', () => {
  const c = make();
  const day = seed(c);
  const first = c.notifyPlan(at(day, 10), {});
  const fired = {}; fired[first[0].key] = 1;
  assert.equal(c.notifyPlan(at(day, 10), fired).length, 0,
    'the fired ledger keys on the instant, so the tick loop cannot repeat it');
});

test('nothing fires outside the grace window', () => {
  const c = make();
  const day = seed(c);
  assert.equal(c.notifyPlan(at(day, 10) + c.NOTIFY_GRACE_MS + 1, {}).length, 0,
    'past the grace window the boundary is stale');
  assert.equal(c.notifyPlan(at(day, 10) - 1, {}).length, 0,
    'and there is no lead time at all — it fires AT the boundary');
});

test('boundaryBody renders each shape from one builder', () => {
  const c = make();
  assert.equal(c.boundaryBody(['A'], ['B']), 'A has ended · B will start', 'both halves');
  assert.equal(c.boundaryBody(['A'], []), 'A has ended', 'end half alone');
  assert.equal(c.boundaryBody([], ['B']), 'B will start', 'start half alone');
  assert.equal(c.boundaryBody(['A', 'B'], []), 'A, B have ended', 'plural agreement on a shared instant');
  assert.equal(c.boundaryBody([], []), '', 'neither half → no notification');
});

test('an instant with neither half emits no spec at all', () => {
  const c = make();
  const day = c.startOfToday();
  // Untimed task: no clocked start, so it is neither a start trigger nor a fixed block.
  c.state.tasks = [ c.normalizeTask({ id: 'u', name: 'Untimed', included: true,
    start: at(day, 9), end: at(day, 10), startClock: false, endClock: false }) ];
  assert.equal(c.notifyPlan(at(day, 9), {}).length, 0, 'no halves ⇒ no spec');
  assert.equal(c.notifyPlan(at(day, 10), {}).length, 0, 'and no block end either');
});

test('milestones and archived tasks are never boundaries', () => {
  const c = make();
  const day = c.startOfToday();
  c.state.tasks = [
    c.normalizeTask({ id: 'm', name: 'Ship', type: 'Milestone', included: true,
      start: at(day, 9), end: at(day, 9), startClock: true, endClock: true }),
    c.normalizeTask({ id: 'x', name: 'Gone', included: true, archivedAt: Date.now(),
      start: at(day, 9), end: at(day, 10), startClock: true, endClock: true }),
  ];
  assert.equal(c.notifyPlan(at(day, 9), {}).length, 0, 'neither shape is eligible');
});

test('deadlineRisk and the lead time are gone', () => {
  const c = make();
  assert.equal(c.DEFAULT_SETTINGS().notify.deadlineRisk, undefined, 'owner: "its just a nuisance alarm"');
  assert.equal(c.DEFAULT_SETTINGS().notify.startPin, undefined, 'merged into taskBoundary');
  assert.equal(c.DEFAULT_SETTINGS().notify.blockEnd, undefined, 'merged into taskBoundary');
  assert.equal(c.DEFAULT_SETTINGS().notify.taskBoundary, true, 'the one replacement toggle, default on');
  assert.equal(c.NOTIFY_LEAD_MS, undefined, 'NOTIFY_LEAD_MS retires with startPin');
  assert.ok(c.NOTIFY_GRACE_MS > 0, 'NOTIFY_GRACE_MS stays — it keeps a missed tick from dropping one');
});

test('a persisted blob holding only the legacy keys still leaves taskBoundary on', () => {
  const c = make();
  // notifyOn returns n[key]!==false, so an absent key defaults ON — which is exactly why the
  // rename needs no settings migration.
  c.state.settings.notify = { startPin: false, deadlineRisk: false, blockEnd: false };
  assert.equal(c.notifyOn('taskBoundary'), true, 'absent key ⇒ ON, so no migration is required');
});
