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
test('drag-pin: snapPinStart snaps to 5 min and clamps within the window', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  cleanDay(c, '10:00'); // window 00:00–10:00
  assert.strictEqual(c.snapPinStart(B + (2 * 60 + 3) * 60000, 60, B),
    B + (2 * 60 + 5) * 60000, '02:03 snaps up to 02:05');
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
