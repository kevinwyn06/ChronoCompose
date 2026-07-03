// Independent, spec-derived tests for the daily-timeline packer (buildDayTimeline)
// and the dependency-driven scheduler (autoSchedule) + date-based slack (computeSlack).
// Expectations are derived by hand from the spec, not copied from the implementation.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const MIN = 60000; // ms per minute

// Build the allotment map + timeline for the given tasks (order the packer relies on).
function pack(c, tasks){
  c.state.tasks = tasks;
  c._allot = c.computeAllotted(tasks);
  return c.buildDayTimeline();
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const schedMin = (chunks, id) =>
  chunks.filter(x => x.type === 'scheduled' && x.id === id)
        .reduce((s, x) => s + (x.end - x.start) / MIN, 0);

/* ============================ PART A — PACKER ============================ */

// 1. Meals appear as 'meal' chunks; scheduled chunks stay in-window and never overlap a meal.
test('packer: meals present as meal chunks; scheduled within window & clear of meals', () => {
  const c = make();
  c.state.nowTick = Date.now();
  c.state.settings.freeTime = 0; // keep default 07:00-23:00 window + default lunch/dinner
  const t = activeTask(c, { predictManual: true, predicted: 120, planned: 120 });
  const { chunks, dayStart, dayEnd } = pack(c, [t]);

  const meals = chunks.filter(x => x.type === 'meal');
  const mealTitles = meals.map(x => x.title);
  assert.ok(mealTitles.includes('Lunch'), 'Lunch meal chunk present');
  assert.ok(mealTitles.includes('Dinner'), 'Dinner meal chunk present');

  const sched = chunks.filter(x => x.type === 'scheduled');
  assert.ok(sched.length > 0, 'task got scheduled');
  for (const s of sched) {
    assert.ok(s.start >= dayStart && s.end <= dayEnd, 'scheduled chunk within [dayStart,dayEnd]');
    for (const m of meals) assert.ok(!overlaps(s, m), 'scheduled chunk must not overlap a meal');
  }
  // scheduled chunks non-overlapping each other
  const ss = sched.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < ss.length; i++) assert.ok(ss[i].start >= ss[i - 1].end, 'no self-overlap');
});

// 2. Priority ordering: a P1 task packs before a P4 task (earlier start) when both fit.
test('packer: priority 1 scheduled before priority 4', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '08:00'); // 480-min pool, no meals
  const p1 = activeTask(c, { predictManual: true, predicted: 60, planned: 60, priority: 1 });
  const p4 = activeTask(c, { predictManual: true, predicted: 60, planned: 60, priority: 4 });
  const { chunks } = pack(c, [p4, p1]); // deliberately give input in reverse of priority

  const start1 = Math.min(...chunks.filter(x => x.type === 'scheduled' && x.id === p1.id).map(x => x.start));
  const start4 = Math.min(...chunks.filter(x => x.type === 'scheduled' && x.id === p4.id).map(x => x.start));
  assert.ok(isFinite(start1) && isFinite(start4), 'both tasks scheduled');
  assert.ok(start1 < start4, `P1 (${start1}) must start before P4 (${start4})`);
});

// 3. Overflow: a task whose (manually-overridden) allotment exceeds the window leaves an 'unscheduled' remainder.
test('packer: overflow produces unscheduled remainder', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '02:00'); // 120-min pool, no meals
  const t = activeTask(c, { predictManual: true, predicted: 180, planned: 180 }); // a manual override is NOT pool-capped -> 180
  const { chunks } = pack(c, [t]);

  const un = chunks.filter(x => x.type === 'unscheduled' && x.id === t.id);
  assert.strictEqual(un.length, 1, 'one unscheduled remainder chunk');
  assert.strictEqual(un[0].start, null, 'unscheduled has start:null');
  assert.strictEqual(un[0].durationMin, 60, '180 planned - 120 window = 60 min unscheduled');
  assert.strictEqual(Math.round(schedMin(chunks, t.id)), 120, '120 min got scheduled into the window');
});

// 4. Fragmentation fix: gaps all < minChunk but total >= need -> relaxed pass fully schedules the task.
test('packer: sub-minChunk fragments still fully scheduled when total fits', () => {
  const c = make();
  c.state.nowTick = Date.now();
  // Window 00:00-01:40 with lunch 00:25-00:50 and dinner 01:15-01:40:
  // free gaps = [00:00-00:25]=25min and [00:50-01:15]=25min. Both < minChunk(30); total = 50.
  Object.assign(c.state.settings, {
    allotMode: 'today', packFromNow: false, freeTime: 0, minChunk: 30,
    dayStart: '00:00', dayEnd: '01:40',
    lunchStart: '00:25', lunchEnd: '00:50', dinnerStart: '01:15', dinnerEnd: '01:40',
  });
  const t = activeTask(c, { predictManual: true, predicted: 50, planned: 50 });
  const { chunks } = pack(c, [t]);

  const un = chunks.filter(x => x.type === 'unscheduled');
  assert.strictEqual(un.length, 0, 'no unscheduled remainder after relaxed fragment pass');
  assert.strictEqual(Math.round(schedMin(chunks, t.id)), 50, 'all 50 min scheduled across small gaps');
});

// 5. packFromNow: no scheduled chunk starts before ~now.
test('packer: packFromNow clamps scheduled start to now', () => {
  const c = make();
  const now = c.startOfDay(Date.now()) + 10 * 3600000; // 10:00 today
  c.state.nowTick = now;
  Object.assign(c.state.settings, {
    allotMode: 'today', packFromNow: true, freeTime: 0,
    dayStart: '00:00', dayEnd: '23:00',
    lunchStart: '00:00', lunchEnd: '00:00', dinnerStart: '00:00', dinnerEnd: '00:00',
  });
  const t = activeTask(c, { predictManual: true, predicted: 120, planned: 120 });
  const { chunks } = pack(c, [t]);
  const sched = chunks.filter(x => x.type === 'scheduled');
  assert.ok(sched.length > 0, 'task scheduled');
  for (const s of sched) assert.ok(s.start >= now, `scheduled start ${s.start} must be >= now ${now}`);
});

/* ========================== PART B — SCHEDULER ========================== */

function mk(c, over){
  return c.normalizeTask(Object.assign(
    { id: 'z' + Math.random().toString(36).slice(2, 8), name: 't', deps: [], recur: null }, over));
}

// 6. Basic snap forward.
test('scheduler: successor snaps to predecessor end, duration preserved', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const B = mk(c, { start: T, end: T + DAY, deps: [A.id] });
  const arr = [A, B];
  c.autoSchedule(arr);
  assert.strictEqual(A.start, T, 'A unchanged (no preds)');
  assert.strictEqual(A.end, T + 2 * DAY);
  assert.strictEqual(B.start, A.end, 'B snaps to A.end');
  assert.strictEqual(B.end, A.end + DAY, 'B duration (1 day) preserved');
});

// 7. Slack preserved: a successor already later than the lower bound is untouched.
test('scheduler: slack preserved when successor already later', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const B = mk(c, { start: T + 10 * DAY, end: T + 11 * DAY, deps: [A.id] });
  c.autoSchedule([A, B]);
  assert.strictEqual(B.start, T + 10 * DAY, 'B keeps its later start');
  assert.strictEqual(B.end, T + 11 * DAY);
});

// 8. Cascade through a chain.
test('scheduler: A->B->C cascade, each starts at prior end', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const B = mk(c, { start: T, end: T + DAY, deps: [A.id] });
  const C = mk(c, { start: T, end: T + DAY, deps: [B.id] });
  c.autoSchedule([A, B, C]);
  assert.strictEqual(B.start, T + 2 * DAY, 'B at A.end');
  assert.strictEqual(B.end, T + 3 * DAY);
  assert.strictEqual(C.start, T + 3 * DAY, 'C at B.end');
  assert.strictEqual(C.end, T + 4 * DAY);
});

// 9. Never pulls earlier: even after moving a predecessor earlier, a slack successor stays put.
test('scheduler: never pulls a successor earlier', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T + 3 * DAY, end: T + 4 * DAY });
  const B = mk(c, { start: T + 5 * DAY, end: T + 6 * DAY, deps: [A.id] });
  c.autoSchedule([A, B]);
  assert.strictEqual(B.start, T + 5 * DAY, 'B has 1-day slack, stays');
  // Move A much earlier, reschedule: B must not be dragged back.
  A.start = T; A.end = T + DAY;
  c.autoSchedule([A, B]);
  assert.strictEqual(B.start, T + 5 * DAY, 'B never pulled earlier');
  assert.strictEqual(B.end, T + 6 * DAY);
});

// 10. Cycle: no crash, warning flag set.
test('scheduler: cycle detected, no throw, _schedWarn=true', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T, end: T + DAY });
  const B = mk(c, { start: T, end: T + DAY });
  A.deps = [B.id]; B.deps = [A.id];
  assert.doesNotThrow(() => c.autoSchedule([A, B]));
  assert.strictEqual(c._schedWarn, true, 'cycle flagged');
});

/* ============================ PART C — SLACK ============================ */

// 11. Chain tasks slack ~0; a parallel short task off the critical path has slack > 0.
test('slack: critical chain ~0, parallel task > 0', () => {
  const c = make();
  const T = c.startOfDay(Date.now());
  const A = mk(c, { start: T, end: T + 2 * DAY });                    // chain
  const B = mk(c, { start: T + 2 * DAY, end: T + 5 * DAY, deps: [A.id] }); // chain, ends the project
  const P = mk(c, { start: T, end: T + DAY });                        // parallel, short, no deps
  const tasks = [A, B, P];

  const slack = c.computeSlack(tasks);
  assert.ok(Math.abs(slack[A.id]) < 0.01, `A on critical chain, slack~0 (got ${slack[A.id]})`);
  assert.ok(Math.abs(slack[B.id]) < 0.01, `B on critical chain, slack~0 (got ${slack[B.id]})`);
  assert.ok(slack[P.id] > 0.5, `P off critical path, slack>0 (got ${slack[P.id]})`);
  assert.strictEqual(Math.round(slack[P.id]), 4, 'P float = projEnd(5d) - P.dur(1d) - P.start(0) = 4 days');

  const { critical } = c.computeCPM(tasks);
  assert.strictEqual(critical[A.id], true, 'A critical');
  assert.strictEqual(critical[B.id], true, 'B critical');
  assert.strictEqual(critical[P.id], false, 'P not critical');
});

/* ===================== PART D — DRAG-PIN (Phase 5) ===================== */

// 12. dragBlock: a pin for today spans [start, start+dur]; a stale pin (other day) is ignored.
test('drag-pin: dragBlock spans the pinned window today, ignored on a stale day', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 9 * 3600000;
  const t = activeTask(c, {});
  t.pin = { day: B, start: B + 14 * 3600000, dur: 60 };
  const blk = c.dragBlock(t, B);
  assert.ok(blk, 'today pin yields a block');
  assert.strictEqual(blk.start, B + 14 * 3600000, 'block starts at the pinned clock time');
  assert.strictEqual(blk.end, B + 15 * 3600000, 'block ends dur minutes later');
  t.pin = { day: B - DAY, start: B + 14 * 3600000, dur: 60 }; // yesterday
  assert.strictEqual(c.dragBlock(t, B), null, 'stale pin ignored');
  t.pin = null;
  assert.strictEqual(c.dragBlock(t, B), null, 'no pin → null');
});

// 13. snapPinStart: snaps to 5-min grid and clamps so the whole block stays inside the window.
test('drag-pin: snapPinStart snaps to 15 min and clamps within the window', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  cleanDay(c, '10:00'); // window 00:00–10:00
  assert.strictEqual(c.snapPinStart(B + (2 * 60 + 3) * 60000, 60, B),
    B + (2 * 60) * 60000, '02:03 snaps to 02:00 (15-min grid)');
  assert.strictEqual(c.snapPinStart(B - 3600000, 60, B), B, 'before day start → clamped to window start');
  assert.strictEqual(c.snapPinStart(B + 12 * 3600000, 60, B), B + 9 * 3600000,
    'a 60-min block can start no later than 09:00 (ends at 10:00)');
});

// 14. A pinned block occupies its slot as a fixed drag-pin; other tasks repack around it, no overlap.
test('drag-pin: pinned block is fixed & draggable; other tasks pack around it', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00'); // 600-min pool, no meals
  const pinned = activeTask(c, { name: 'P', planned: 120 });
  pinned.pin = { day: B, start: B + 5 * 3600000, dur: 120 }; // 05:00–07:00
  const other = activeTask(c, { name: 'O', planned: 120 });
  const { chunks } = pack(c, [pinned, other]);

  // pinned task's allotment equals its pinned span, flagged fixed (removed from the flexible pool)
  assert.strictEqual(c._allot[pinned.id].allotted, 120, 'pinned allotment = its span');
  assert.ok(c._allot[pinned.id].fixed, 'pinned task marked fixed in the allotment map');

  const fx = chunks.filter(x => x.type === 'fixed' && x.id === pinned.id);
  assert.strictEqual(fx.length, 1, 'one fixed block for the pinned task');
  assert.strictEqual(fx[0].start, B + 5 * 3600000, 'fixed block at the pinned start');
  assert.strictEqual(fx[0].end, B + 7 * 3600000, 'fixed block spans dur minutes');
  assert.ok(fx[0].dragPin, 'flagged as a drag-pin (so the UI makes it draggable)');
  assert.strictEqual(chunks.filter(x => x.type === 'scheduled' && x.id === pinned.id).length, 0,
    'pinned task is not also packed as a flexible block');

  const os = chunks.filter(x => x.type === 'scheduled' && x.id === other.id);
  assert.ok(os.length > 0, 'other task still scheduled');
  for (const s of os) assert.ok(!overlaps(s, fx[0]), 'other task never overlaps the pinned block');
});

// 15. A drag-pinned SUBTASK leaves its parent's family and becomes its own fixed block; the parent
//     family block shrinks by that child's pinned span and its other children still pack inside it.
test('drag-pin: a pinned subtask becomes a standalone fixed block, out of the family', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00'); // 600-min pool, no meals
  const p = activeTask(c, { id: 'p', name: 'Parent', planned: 120 });
  const c1 = activeTask(c, { id: 'c1', name: 'Alpha', planned: 60, parentId: 'p' });
  const c2 = activeTask(c, { id: 'c2', name: 'Beta', planned: 60, parentId: 'p' });
  c1.pin = { day: B, start: B + 8 * 3600000, dur: 120 }; // 08:00–10:00
  const { chunks } = pack(c, [p, c1, c2]);

  // pinned child holds its captured span as a fixed drag-pin, not a proportional child share
  assert.strictEqual(c._allot['c1'].allotted, 120, 'pinned child allotment = its pinned span');
  assert.ok(c._allot['c1'].fixed, 'pinned child flagged fixed');
  assert.ok(!c._allot['c1'].fromParent, 'pinned child is no longer a family share');

  const fx = chunks.filter(x => x.type === 'fixed' && x.id === 'c1');
  assert.strictEqual(fx.length, 1, 'one fixed block for the pinned subtask');
  assert.ok(fx[0].dragPin, 'flagged as a drag-pin (draggable + unpin)');
  assert.strictEqual(fx[0].title, 'Parent › Alpha', 'pinned subtask keeps its Parent › Child label');
  assert.strictEqual(chunks.filter(x => x.type === 'scheduled' && x.id === 'c1').length, 0,
    'pinned subtask is not also packed inside the family');

  // sibling c2 and the parent remainder still pack, and never overlap the pinned child
  assert.ok(schedMin(chunks, 'c2') > 0, 'sibling still scheduled inside the family');
  const fam = chunks.filter(x => x.type === 'scheduled' && (x.id === 'c2' || x.id === 'p'));
  for (const s of fam) assert.ok(!overlaps(s, fx[0]), 'family blocks never overlap the pinned child');
});

// 16. snapPinStart magnet: a proposed start (or end) within PIN_MAGNET of a neighbour edge snaps to abut it;
//     otherwise it falls back to the PIN_SNAP grid.
test('drag-pin: snapPinStart magnetically snaps to a neighbour block edge', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  cleanDay(c, '10:00');
  const edge = B + 3 * 3600000; // a neighbour block edge at 03:00
  // start edge lands 3 min before 03:00 → snaps the start to 03:00
  assert.strictEqual(c.snapPinStart(B + (2 * 60 + 57) * 60000, 60, B, [edge]), edge,
    'start within magnet snaps to the neighbour edge');
  // end edge lands 2 min before 03:00 → snaps so the block ends at 03:00 (starts at 02:00)
  assert.strictEqual(c.snapPinStart(B + (1 * 60 + 58) * 60000, 60, B, [edge]), B + 2 * 3600000,
    'end within magnet snaps the block to abut the neighbour edge');
  // no target within magnet → 15-min grid snap (02:03 → 02:00)
  assert.strictEqual(c.snapPinStart(B + (2 * 60 + 3) * 60000, 60, B, [B + 9 * 3600000]),
    B + (2 * 60) * 60000, 'far targets leave the grid snap in charge');
});

// 17. Break-between-tasks reserves settings.breakMin after each packed task and shrinks the pool to match.
test('break: breakMin shrinks the pool and spaces packed tasks apart', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '04:00'); // 240-min pool, no meals
  c.state.settings.breakMin = 30;
  const a = activeTask(c, { id: 'a', name: 'A', planned: 120 });
  const b = activeTask(c, { id: 'b', name: 'B', planned: 120 });
  const { chunks } = pack(c, [a, b]);

  // pool shrank by one break per packable family (2 × 30 = 60): 240 → 180, split evenly
  assert.strictEqual(c._allot['a'].allotted, 90, 'allotment reflects the break-reduced pool');
  assert.strictEqual(c._allot['b'].allotted, 90);

  const aEnd = Math.max(...chunks.filter(x => x.id === 'a' && x.start).map(x => x.end));
  const bStart = Math.min(...chunks.filter(x => x.id === 'b' && x.start).map(x => x.start));
  const [first, second] = aEnd <= bStart ? [aEnd, bStart] : [
    Math.max(...chunks.filter(x => x.id === 'b' && x.start).map(x => x.end)),
    Math.min(...chunks.filter(x => x.id === 'a' && x.start).map(x => x.start))];
  assert.ok((second - first) / MIN >= 30, 'at least a 30-min break separates the two tasks');
});

/* ==================== PART E — MULTI-DAY (per-day scheduling + pins) ==================== */

// E1. Future-day allotment ignores `spent` (spent = time worked TODAY only). Same task, same pool:
//     today's column subtracts spent; a future day schedules the full planned share.
test('multi-day: future-day computeAllotted uses spent = 0', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00'); // 600-min pool, no meals
  const t = activeTask(c, { id: 't', name: 'T', planned: 120, spent: 45, start: B - DAY, end: B + 5 * DAY });
  c.state.tasks = [t];
  const today = c.computeAllotted([t], B);
  const future = c.computeAllotted([t], B + 2 * DAY);
  // sole active task → gets the whole pool minus spent today; future day ignores spent.
  assert.strictEqual(today['t'].allotted, 600 - 45, 'today subtracts spent');
  assert.strictEqual(future['t'].allotted, 600, 'future day ignores spent (spent = today only)');
});

// E2. A block dragged onto a FUTURE day pins for THAT day: buildDayTimeline(B_future) renders it as a
//     fixed drag-pin, and the same pin is invisible on today's column (pin.day must match the column).
test('multi-day: a per-day pin shows on its own day, not on others', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00');
  const future = B + 2 * DAY;
  const t = activeTask(c, { id: 't', name: 'T', planned: 120, start: B - DAY, end: B + 5 * DAY });
  t.pin = { day: future, start: future + 5 * 3600000, dur: 120 }; // 05:00–07:00 on B+2
  c.state.tasks = [t];

  const fx = c.buildDayTimeline(future).chunks.filter(x => x.type === 'fixed' && x.id === 't');
  assert.strictEqual(fx.length, 1, 'pinned block renders on its own (future) day');
  assert.ok(fx[0].dragPin, 'flagged as a drag-pin');
  assert.strictEqual(fx[0].start, future + 5 * 3600000, 'at the pinned start on that day');

  const todayFixed = c.buildDayTimeline(B).chunks.filter(x => x.type === 'fixed' && x.id === 't');
  assert.strictEqual(todayFixed.length, 0, "a future-day pin is not applied to today's column");
});

// E3. A stale pin (pin.day in the PAST) is ignored on every rendered day.
test('multi-day: a past-day pin is ignored', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00');
  const t = activeTask(c, { id: 't', name: 'T', planned: 120, start: B - 5 * DAY, end: B + 5 * DAY });
  t.pin = { day: B - 2 * DAY, start: B - 2 * DAY + 5 * 3600000, dur: 120 }; // pinned to a past day
  c.state.tasks = [t];
  for (const day of [B, B + DAY, B + 2 * DAY]) {
    const fx = c.buildDayTimeline(day).chunks.filter(x => x.type === 'fixed' && x.id === 't');
    assert.strictEqual(fx.length, 0, 'no fixed block from a stale (past) pin');
  }
});

// E4. isActiveOn windows by date for the given day: a task active only on a later day doesn't allot today.
test('multi-day: isActiveOn windows tasks to the right day', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 't', name: 'T', planned: 60, start: B + 2 * DAY, end: B + 2 * DAY });
  assert.ok(!c.isActiveOn(t, B), 'not active today (window starts in 2 days)');
  assert.ok(c.isActiveOn(t, B + 2 * DAY), 'active on its own day');
});
