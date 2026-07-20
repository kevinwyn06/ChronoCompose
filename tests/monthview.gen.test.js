// Phase 6 (ROADMAP.md) — month calendar view. Independent, spec-derived tests for the occurrence-aware
// day↔task maps that drive the hover glow: tasksOnDay / daysOfTask / monthGrid.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

const H = 3600000;

// A multi-day task occupies every day it spans, with a HALF-OPEN end (the end day is excluded).
test('month: multi-day task spans each day, exclusive end day excluded', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'm', start: B, end: B + 3 * DAY }); // covers B, B+1, B+2
  c.state.tasks = [t];
  assert.ok(c.tasksOnDay(B).includes('m'), 'day 0');
  assert.ok(c.tasksOnDay(B + DAY).includes('m'), 'day 1');
  assert.ok(c.tasksOnDay(B + 2 * DAY).includes('m'), 'day 2');
  assert.ok(!c.tasksOnDay(B + 3 * DAY).includes('m'), 'exclusive end: not on the end day');
});

// An all-day event whose exclusive end is a day's midnight does not leak onto that day.
test('month: all-day exclusive end does not appear on the end day', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'a', allDay: true, start: B, end: B + DAY }); // just day 0
  c.state.tasks = [t];
  assert.ok(c.tasksOnDay(B).includes('a'), 'appears on its single day');
  assert.ok(!c.tasksOnDay(B + DAY).includes('a'), 'not on the exclusive-end next day');
});

// A recurring task's deleted override removes only that occurrence's day.
test('month: recurring task with a deleted override skips just that day', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'r', start: B + 9 * H, end: B + 10 * H,
    recur: { kind: 'day', n: 1, overrides: { 2: { deleted: true } }, shifts: [] } });
  c.state.tasks = [t];
  assert.ok(c.tasksOnDay(B).includes('r'), 'occurrence 0 present');
  assert.ok(c.tasksOnDay(B + DAY).includes('r'), 'occurrence 1 present');
  assert.ok(!c.tasksOnDay(B + 2 * DAY).includes('r'), 'deleted occurrence 2 absent');
  assert.ok(c.tasksOnDay(B + 3 * DAY).includes('r'), 'occurrence 3 present');
});

// Archived tasks never appear.
test('month: archived tasks are excluded', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'z', start: B, end: B + DAY, archivedAt: Date.now() });
  c.state.tasks = [t];
  assert.ok(!c.tasksOnDay(B).includes('z'), 'archived task hidden from the month grid');
});

// The two hover maps are exact inverses across a range (this is what keeps the day↔task glow symmetric).
test('month: tasksOnDay and daysOfTask are symmetric over a range', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [
    activeTask(c, { id: 'p', start: B + DAY, end: B + 4 * DAY }),
    activeTask(c, { id: 'q', start: B + 9 * H, end: B + 10 * H, recur: { kind: 'day', n: 1, overrides: { 1: { deleted: true } }, shifts: [] } }),
    activeTask(c, { id: 'm', allDay: true, start: B + 2 * DAY, end: B + 3 * DAY }),
  ];
  const from = B, to = B + 7 * DAY;
  for (const t of c.state.tasks) {
    const days = c.daysOfTask(t.id, from, to);
    for (let d = from; d < to; d += DAY) {
      const onDay = c.tasksOnDay(d).includes(t.id);
      const inDays = days.includes(d);
      assert.strictEqual(onDay, inDays, `symmetry for ${t.id} at day ${(d - B) / DAY}`);
    }
  }
});

// Phase 7: an active filter thins the calendar chips. tasksOnDay defaults to the pre-filtered
// _calTasks list (set in renderVals) so the month/day/schedule views honor the filter like the sheet.
test('month: tasksOnDay defaults to the filtered _calTasks set when a filter is active', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const keep = activeTask(c, { id: 'keep', start: B, end: B + DAY, priority: 1 });
  const drop = activeTask(c, { id: 'drop', start: B, end: B + DAY, priority: 4 });
  c.state.tasks = [keep, drop];
  // No cache set → default falls through to state.tasks (both appear).
  assert.deepEqual(c.tasksOnDay(B).sort(), ['drop', 'keep']);
  // Simulate renderVals' pre-filtered list (P1 only) → only the kept task shows on the calendar.
  c._calTasks = [keep];
  assert.deepEqual(c.tasksOnDay(B), ['keep'], 'filtered calendar excludes the P4 task');
  // An explicit tasks arg still wins over the cache (used by the sheet-glow path).
  assert.deepEqual(c.tasksOnDay(B, c.state.tasks).sort(), ['drop', 'keep']);
});

// Perf (V0.3): tasksByDayMap buckets occurrences into a set of day-starts with ONE expandTask per
// task — vs tasksOnDay, which re-expands every task for every cell (O(cells×tasks) in the month grid).
// The bucketed result must be byte-identical to calling tasksOnDay per day (same ids, same order).
test('month: tasksByDayMap equals per-day tasksOnDay and expands each task once', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [
    activeTask(c, { id: 'p', start: B + DAY, end: B + 4 * DAY }),
    activeTask(c, { id: 'q', start: B + 9 * H, end: B + 10 * H, recur: { kind: 'day', n: 1, overrides: { 2: { deleted: true } }, shifts: [] } }),
    activeTask(c, { id: 'm', allDay: true, start: B + 2 * DAY, end: B + 3 * DAY }),
    activeTask(c, { id: 'r', start: B + 8 * H, end: B + 9 * H, recur: { kind: 'day', n: 1, shifts: [] } }),
    activeTask(c, { id: 'z', start: B, end: B + DAY, archivedAt: Date.now() }), // excluded everywhere
  ];
  const days = []; for (let i = 0; i < 42; i++) days.push(B + i * DAY);

  // Count expandTask calls made by the bucketed helper.
  const realExpand = c.expandTask.bind(c);
  let calls = 0; c.expandTask = (t, hz) => { calls++; return realExpand(t, hz); };
  const map = c.tasksByDayMap(days);
  c.expandTask = realExpand;

  // One expansion per non-excluded task (4), not one per (task × cell).
  assert.ok(calls <= c.state.tasks.length, `expanded once per task, got ${calls} calls for ${c.state.tasks.length} tasks`);

  // Equivalence: identical id arrays (order included) to per-day tasksOnDay.
  for (const d of days) {
    assert.deepEqual(map[d], c.tasksOnDay(d), `day ${(d - B) / DAY}`);
  }
});

// monthGrid: 42 cells, starts on the Sunday on/before the 1st, flags in-month days.
test('month: monthGrid is a 7×6 grid starting on Sunday with correct in-month flags', () => {
  const c = make();
  const anchor = new Date(2026, 6, 15).getTime(); // July 2026
  const { cells, monthIdx } = c.monthGrid(anchor);
  assert.strictEqual(cells.length, 42, '6 weeks × 7 days');
  assert.strictEqual(monthIdx, 6, 'July');
  assert.strictEqual(new Date(cells[0].dayStart).getDay(), 0, 'first cell is a Sunday');
  // July 1 2026 is a Wednesday → the first in-month cell is index 3 (Sun,Mon,Tue,Wed)
  const firstInMonth = cells.findIndex(x => x.inMonth);
  assert.strictEqual(new Date(cells[firstInMonth].dayStart).getDate(), 1, 'first in-month cell is the 1st');
  assert.ok(cells.filter(x => x.inMonth).length === 31, 'July has 31 in-month days');
});
