// Gantt ergonomics (workstream C): sub-day zoom clamp, bar-draw width floor, and the
// dependency-driven scheduling invariant (finish-to-start, forward-only) that the docs describe.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

// ---- C2: sub-day zoom bounds ----
test('clampDayW keeps the zoom within [GANTT_DAYW_MIN, GANTT_DAYW_MAX]', () => {
  const c = make();
  assert.strictEqual(c.clampDayW(1), c.GANTT_DAYW_MIN);      // below floor
  assert.strictEqual(c.clampDayW(99999), c.GANTT_DAYW_MAX);  // above cap
  assert.strictEqual(c.clampDayW(300), 300);                 // in range — past the old 120 cap
  assert.ok(c.GANTT_DAYW_MAX > 120, 'cap raised beyond the old one-day-ish 120 so hours are reachable');
});

// ---- C1: bar-draw width (a zero/negative span must never render as a zero-length point) ----
test('effBarEnd: a zero/negative span draws one full day; a real span draws itself', () => {
  const c = make();
  const st = Date.now();
  assert.strictEqual(c.effBarEnd(st, st), st + DAY);          // zero span → one day wide
  assert.strictEqual(c.effBarEnd(st, st - 1000), st + DAY);   // inverted → one day wide
  assert.strictEqual(c.effBarEnd(st, st + 3 * DAY), st + 3 * DAY); // real forward span unchanged
});

// ---- C4: dependency-driven scheduling (verify the documented behaviour) ----
test('autoSchedule drives dependents finish-to-start, forward-only', () => {
  const c = make();
  const B = Date.now();
  const mk = (id, s, e, deps) => c.normalizeTask({ id, name: id, type: 'Proportional',
    start: s, end: e, priority: 4, deps: deps || [], pct: 0, planned: 60 });

  // B depends on A; A ends AFTER B starts → B is pushed so it starts no earlier than A.end (duration kept).
  const tasks = [mk('A', B, B + 2 * DAY), mk('B', B, B + DAY, ['A'])];
  c.autoSchedule(tasks);
  assert.strictEqual(tasks[1].start, B + 2 * DAY, 'successor starts at predecessor end');
  assert.strictEqual(tasks[1].end, B + 3 * DAY, 'successor duration preserved');

  // A predecessor moved EARLIER must NOT drag a later successor back — banked slack survives (forward-only).
  const t2 = [mk('A', B - 5 * DAY, B - 3 * DAY), mk('B', B + 10 * DAY, B + 11 * DAY, ['A'])];
  c.autoSchedule(t2);
  assert.strictEqual(t2[1].start, B + 10 * DAY, 'earlier predecessor never pulls the successor back');
});
