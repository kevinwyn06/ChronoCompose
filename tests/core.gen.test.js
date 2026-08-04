// Independent, spec-derived unit tests for the core pure logic of the Component class.
// Behavior is derived from CLAUDE.md + architecture.md; assertions target the SPEC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

// ---------------------------------------------------------------------------
// Duration parse / format  (H:MM, unit = minutes)
// ---------------------------------------------------------------------------
test('fmtDur formats minutes as H:MM', () => {
  const c = make();
  assert.equal(c.fmtDur(0), '0:00');
  assert.equal(c.fmtDur(60), '1:00');
  assert.equal(c.fmtDur(90), '1:30');
  assert.equal(c.fmtDur(125), '2:05');
  assert.equal(c.fmtDur(5), '0:05');
  assert.equal(c.fmtDur(6000), '100:00'); // large value
});

test('fmtDur renders null as em-dash placeholder', () => {
  const c = make();
  assert.equal(c.fmtDur(null), '—');
});

test('parseDur reads H:MM into minutes', () => {
  const c = make();
  assert.equal(c.parseDur('1:30'), 90);
  assert.equal(c.parseDur('0:00'), 0);
  assert.equal(c.parseDur('2:05'), 125);
  assert.equal(c.parseDur('100:00'), 6000);
});

test('parseDur treats a bare number as decimal hours', () => {
  const c = make();
  assert.equal(c.parseDur('2'), 120);
  assert.equal(c.parseDur('1.5'), 90);
});

test('parseDur handles empty / malformed input as 0 and clamps negative', () => {
  const c = make();
  assert.equal(c.parseDur(''), 0);
  assert.equal(c.parseDur('   '), 0);
  assert.equal(c.parseDur('abc'), 0);
  assert.equal(c.parseDur(' 1:05 '), 65); // trims surrounding whitespace
  assert.ok(c.parseDur('-3:00') >= 0);    // never negative
});

test('fmtDur/parseDur round-trips through H:MM', () => {
  const c = make();
  for (const s of ['0:00', '1:30', '2:05', '10:45', '100:00']) {
    assert.equal(c.fmtDur(c.parseDur(s)), s);
  }
});

// ---------------------------------------------------------------------------
// normalizeTask  (field defaulting + idempotence)
// ---------------------------------------------------------------------------
test('normalizeTask defaults the added/repurposed fields', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'a', name: 'x' });
  assert.equal(t.spent, 0);
  assert.equal(t.goal, '');
  assert.equal(t.predictManual, false);
  assert.equal(t.calendarId, null);
  assert.equal(t.eventId, null);
  assert.ok(Array.isArray(t.labels) && t.labels.length === 0);
  assert.ok(Array.isArray(t.deps) && t.deps.length === 0);
  assert.equal(t.recur, null);
  assert.equal(t.description, '');
  assert.equal(t.pct, 0);
  assert.equal(t.priority, 4);
});

test('normalizeTask preserves supplied values', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'a', name: 'x', spent: 50, priority: 2, goal: 'ship', type: 'Exact' });
  assert.equal(t.spent, 50);
  assert.equal(t.priority, 2);
  assert.equal(t.goal, 'ship');
  assert.equal(t.type, 'Exact');
});

test('normalizeTask is idempotent', () => {
  const c = make();
  const once = c.normalizeTask({ id: 'a', name: 'x', type: 'Proportional' });
  const twice = c.normalizeTask(once);
  assert.deepEqual(twice, once);
});

test('normalizeTask guarantees a scheduling-mode (type) exists [SPEC]', () => {
  // architecture.md lists `type` among the repurposed fields normalizeTask "guarantees exist".
  const c = make();
  const t = c.normalizeTask({ id: 'a', name: 'x' });
  assert.notEqual(typeof t.type, 'undefined', 'normalizeTask should default type/scheduling mode');
});

// ---------------------------------------------------------------------------
// Predicted / allotted computation  (computeAllotted, 'today' mode)
// ---------------------------------------------------------------------------
// (Scheduling modes were removed: every task is Proportional; a fixed slice is expressed with a
//  manual Predict override — see the predictManual tests below. There is no 'Exact' type anymore.)

test('Proportional split: leftover pool weighted by planned', () => {
  const c = make();
  cleanDay(c, '03:00'); // pool = 180, equals sum of planned -> each gets its planned share
  const a = activeTask(c, { type: 'Proportional', planned: 60 });
  const b = activeTask(c, { type: 'Proportional', planned: 120 });
  const m = c.computeAllotted([a, b]);
  assert.equal(m[a.id].allotted, 60);
  assert.equal(m[b.id].allotted, 120);
});

test('Proportional split subtracts spent from the share', () => {
  const c = make();
  cleanDay(c, '03:00'); // pool 180
  const a = activeTask(c, { type: 'Proportional', planned: 60, spent: 0 });
  // spent is a per-day ledger now; 30 min done TODAY subtracts from today's share.
  const b = activeTask(c, { type: 'Proportional', planned: 120, spent: 30, spentByDay: { [c.ymdOf(c.startOfToday())]: 30 } });
  const m = c.computeAllotted([a, b]);
  assert.equal(m[a.id].allotted, 60);   // 120/180*180 unaffected... a's share
  assert.equal(m[b.id].allotted, 90);   // 120/180*180 - 30
});

test('predictManual override is respected verbatim', () => {
  const c = make();
  cleanDay(c, '03:00');
  const t = activeTask(c, { type: 'Proportional', planned: 120, predictManual: true, predicted: 45 });
  const m = c.computeAllotted([t]);
  assert.equal(m[t.id].allotted, 45);
});

test('a manual override moves to the fixed bucket and the rest redistribute', () => {
  const c = make();
  cleanDay(c, '03:00'); // pool 180
  const a = activeTask(c, { type: 'Proportional', planned: 60, predictManual: true, predicted: 30 });
  const b = activeTask(c, { type: 'Proportional', planned: 120 });
  const m = c.computeAllotted([a, b]);
  assert.equal(m[a.id].allotted, 30);   // fixed
  assert.equal(m[b.id].allotted, 150);  // 120/120 * (180 - 30)
});

// ---------------------------------------------------------------------------
// Allotment gating: active only when today in [start,end]
// ---------------------------------------------------------------------------
test('task straddling today is active and gets allotment', () => {
  const c = make();
  cleanDay(c, '03:00');
  const t = activeTask(c); // start = today-1d, end = today+1d
  const m = c.computeAllotted([t]);
  assert.equal(m[t.id].active, true);
  assert.ok(m[t.id].allotted > 0);
});

test('task entirely in the past is inactive with 0 allotment', () => {
  const c = make();
  cleanDay(c, '03:00');
  const B = Date.now();
  const t = activeTask(c, { included:null, start: B - 3 * DAY, end: B - 2 * DAY });
  const m = c.computeAllotted([t]);
  assert.equal(m[t.id].active, false);
  assert.equal(m[t.id].allotted, 0);
});

test('task entirely in the future is inactive with 0 allotment', () => {
  const c = make();
  cleanDay(c, '03:00');
  const B = Date.now();
  const t = activeTask(c, { included:null, start: B + 2 * DAY, end: B + 3 * DAY });
  const m = c.computeAllotted([t]);
  assert.equal(m[t.id].active, false);
  assert.equal(m[t.id].allotted, 0);
});

test('Milestone and excluded (included:false) tasks never get allotment even if today is in range', () => {
  const c = make();
  cleanDay(c, '03:00');
  const mile = activeTask(c, { type: 'Milestone' });
  const excl = activeTask(c, { included: false });
  const m = c.computeAllotted([mile, excl]);
  assert.equal(m[mile.id].active, false);
  assert.equal(m[excl.id].active, false);
});

// ---------------------------------------------------------------------------
// Timer accounting  (one running task at a time; spent accumulates)
// ---------------------------------------------------------------------------
test('getSpent = stored spent + elapsed of the running timer', () => {
  const c = make();
  const t = activeTask(c, { spent: 20 });
  // no timer -> just stored
  assert.equal(c.getSpent(t), 20);
  // running this task, started 10 min ago
  c.state.nowTick = Date.now();
  c.state.running = { [t.id]: { startedAt: c.state.nowTick - 10 * 60000 } };
  assert.ok(Math.abs(c.getSpent(t) - 30) < 0.01);
});

test('startTimer sets the running task; toggleTimer stops it', () => {
  const c = make();
  const t = activeTask(c);
  c.state.tasks.push(t);
  c.startTimer(t.id);
  assert.ok(c.isRunning(t.id));
  c.toggleTimer(t.id); // same id -> stop
  assert.ok(!c.isRunning(t.id));
});

test('stopTimer accumulates elapsed minutes into spent', () => {
  const c = make();
  const t = activeTask(c, { spent: 5 });
  c.state.tasks.push(t);
  // simulate a timer that started 15 minutes ago
  c.state.running = { [t.id]: { startedAt: Date.now() - 15 * 60000 } };
  c.stopTimer(t.id);
  const after = c.state.tasks.find(x => x.id === t.id);
  assert.ok(!c.isRunning(t.id));
  assert.ok(Math.abs(after.spent - 20) < 0.05, `expected ~20, got ${after.spent}`);
});

test('timers are multitasking: starting a second does NOT stop the first', () => {
  const c = make();
  c.state.settings.multitask = true; // V2.4: concurrency is opt-in; strict single timer is the default
  const a = activeTask(c, { spent: 0 });
  const b = activeTask(c);
  c.state.tasks.push(a, b);
  // A has been running for 10 min
  c.state.running = { [a.id]: { startedAt: Date.now() - 10 * 60000 } };
  c.startTimer(b.id); // B starts; A keeps running
  assert.ok(c.isRunning(a.id) && c.isRunning(b.id), 'both run concurrently');
  const aAfter = c.state.tasks.find(x => x.id === a.id);
  assert.equal(aAfter.spent, 0, 'A is still running, so nothing credited yet');
  // stopping A now credits its ~10 min
  c.stopTimer(a.id);
  assert.ok(!c.isRunning(a.id) && c.isRunning(b.id), 'A stopped, B still running');
  assert.ok(Math.abs(c.state.tasks.find(x=>x.id===a.id).spent - 10) < 0.05);
});

// ---------------------------------------------------------------------------
// % Done stepping (−/+ buttons) — stepPct nudges pct by ±PCT_STEP, clamped, snapped
// ---------------------------------------------------------------------------
test('stepPct increments/decrements pct by PCT_STEP and clamps at 0..100', () => {
  const c = make();
  const t = activeTask(c, { pct: 20 });
  c.state.tasks = [t];
  c.stepPct(t.id, 1);
  assert.equal(c.state.tasks.find(x => x.id === t.id).pct, 20 + c.PCT_STEP, 'one + step up');
  c.stepPct(t.id, -1); c.stepPct(t.id, -1);
  assert.equal(c.state.tasks.find(x => x.id === t.id).pct, 20 - c.PCT_STEP, 'net one step down');
  // clamp at 0
  const lo = activeTask(c, { pct: 0 }); c.state.tasks = [lo];
  c.stepPct(lo.id, -1);
  assert.equal(c.state.tasks.find(x => x.id === lo.id).pct, 0, 'does not go below 0');
  // clamp at 100 + marks completion
  const hi = activeTask(c, { pct: 100 - c.PCT_STEP, completion: null }); c.state.tasks = [hi];
  c.stepPct(hi.id, 1);
  const done = c.state.tasks.find(x => x.id === hi.id);
  assert.equal(done.pct, 100, 'reaches exactly 100');
  assert.ok(done.completion, 'hitting 100 stamps a completion date');
});
