// Independent, spec-derived tests for the daily-timeline packer (buildDayTimeline)
// and the dependency-driven scheduler (autoSchedule) + date-based slack (computeSlack).
// Expectations are derived by hand from the spec, not copied from the implementation.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY, withNow } = require('./_load.js');

const MIN = 60000; // ms per minute
const H = 3600000; // ms per hour

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

test('V2.1: pressed is today inclusion; unpressing removes it regardless of date window', () => {
  const c=make(); cleanDay(c,'02:00');
  const B=c.startOfToday();
  const outside=activeTask(c,{start:B+4*DAY,end:B+5*DAY,included:true,planned:60});
  let map=c.computeAllotted([outside]);
  assert.strictEqual(map[outside.id].active,true,'pressed out-of-window task joins by discretion');
  outside.included=null;
  map=c.computeAllotted([outside]);
  assert.strictEqual(map[outside.id].active,false,'unpressed task leaves today');
});

test('V2.1: new and zero-planned tasks receive pressed/default-time defaults', () => {
  const c=make(); cleanDay(c,'02:00');
  // 2026-08-16: a NEW task is `planned:null` ("no time given"), and that is what draws the default
  // slice. A typed `planned:0` is now a decision to ask for nothing — giving it the default anyway
  // was the owner's report, so that half is asserted the other way round.
  const t=c.normalizeTask({id:'new',name:'new',start:null,end:null});
  assert.strictEqual(t.included,true,'new task defaults pressed');
  assert.strictEqual(t.planned,null,'and carries no estimate rather than a zero one');
  const map=c.computeAllotted([t]);
  assert.strictEqual(map[t.id].allotted,c.DEFAULT_TASK_MINUTES);
  const z=c.normalizeTask({id:'zero',name:'zero',start:null,end:null,planned:0});
  assert.strictEqual(c.computeAllotted([z])[z.id].allotted,0,'a deliberate zero is allotted zero');
});

test('V2.1: latest running task is stronger pressed and pulled to now', () => {
  const c=make(); cleanDay(c,'23:00');
  const B=c.startOfToday(), now=B+10*H;
  c.state.nowTick=now;
  const t=activeTask(c,{id:'run',included:null,start:B+2*DAY,end:B+3*DAY,planned:60}); // V2.11: unpressed (future window never inherits)
  c.state.running={run:{startedAt:now-5*MIN,beat:now}};
  const {chunks}=pack(c,[t]);
  const block=chunks.find(x=>x.type==='scheduled'&&x.id==='run');
  assert.ok(block&&block.start>=now,'active task is included and starts no earlier than now');
  assert.strictEqual(c.inclState(t),'active');
});

/* ============================ PART A — PACKER ============================ */

// 1. Meals appear as 'meal' chunks; scheduled chunks stay in-window and never overlap a meal.
// V5 (F4): clock pinned at 12:00 — `packFromNow` now defaults true, so the DEFAULT 07:00–23:00 window
// is empty when the suite runs after 23:00. This test is about meals, not about the run hour.
// 2026-08-19: meals are TASKS now, so they are seeded here and arrive as `fixed` chunks rather than as
// settings-derived `meal` chunks. The property under test is the same one: nothing packs over a meal.
test('packer: meals present as meal chunks; scheduled within window & clear of meals', () => withNow(() => {
  const c = make();
  c.state.nowTick = Date.now();
  c.state.settings.freeTime = 0; // keep the default 07:00-23:00 window
  const B = c.startOfToday();
  const meal = (id, name, sh, eh) => c.normalizeTask({ id, name, type:'Proportional', included:true,
    start:B + sh*3600000, end:B + eh*3600000, startClock:true, endClock:true, uncompressable:true,
    priority:4, deps:[], pct:0, planned:null, spent:0 });
  const t = activeTask(c, { predictManual: true, predicted: 120, planned: 120 });
  const { chunks, dayStart, dayEnd } = pack(c, [t, meal('lunch','Lunch',12.5,13), meal('dinner','Dinner',17.5,18)]);

  const meals = chunks.filter(x => x.type === 'fixed' && (x.id === 'lunch' || x.id === 'dinner'));
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
}));

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

/* --- 04 (Reading C): the drag unit is the CHUNK, not the task ------------------------------------
   A task interrupted by a fixed appointment legitimately renders as several chunks. Dragging one of
   them pins THAT chunk's minutes; the task's remaining minutes stay in the flexible pool and repack
   around all fixed work, including the new pin. A pin record without `partial` keeps the pre-04
   whole-task meaning (the task becomes fixed work for the day), which is what tests 12/14/15 cover. */

// Fixture: window 00:00-10:00, an appointment at 04:00-05:00, one flexible task -> two chunks.
function splitDay(c){
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;                       // pack from the window edge — no part-minute at the seam
  cleanDay(c, '10:00');
  const ev = activeTask(c, { id:'ev', name:'Appt', eventId:'g1', allDay:false,
    start: B + 4 * H, end: B + 5 * H, planned: 60 });
  // 2026-08-16: `planned` is now a CAP as well as a weight, so the fixture must ASK for the pool it
  // is meant to hold. 540 = the 600-minute window minus the appointment's hour, i.e. exactly the
  // whole flexible pool these tests were always written against; at the old 120 the task no longer
  // reached past 04:00 and the appointment stopped splitting it.
  const x = activeTask(c, { id:'x', name:'Split', planned: 540 });
  return { B, ev, x };
}

// 18. Pinning ONE chunk of a split task leaves the rest flexible and preserves the daily total.
test('drag-pin (04): pinning one chunk of a split task keeps the task\'s daily minutes', () => {
  const c = make();
  const { B, ev, x } = splitDay(c);

  const before = pack(c, [ev, x]);
  const mine = before.chunks.filter(k => k.start && k.id === 'x').sort((a, b) => a.start - b.start);
  assert.ok(mine.length > 1, 'fixture: the appointment splits the task into more than one chunk');
  const total = c._allot['x'].allotted;
  assert.strictEqual(schedMin(before.chunks, 'x'), total, 'baseline: blocks sum to the allotment');

  // drag the FIRST chunk to the end of the window — its own span only, so the pin is partial
  const dur = Math.round((mine[0].end - mine[0].start) / MIN);
  const drop = B + 10 * H - dur * MIN;
  x.pin = [{ day: B, start: drop, dur, partial: true }];
  const after = pack(c, [ev, x]);

  assert.strictEqual(c._allot['x'].allotted, total, 'the task\'s daily total is unchanged by the drag');
  assert.strictEqual(c._allot['x'].pinnedMin, dur, 'the dragged chunk is recorded as fixed minutes');
  assert.ok(!c._allot['x'].fixed, 'a partly-pinned task is NOT wholly fixed');

  const pinned = after.chunks.filter(k => k.type === 'fixed' && k.id === 'x');
  assert.strictEqual(pinned.length, 1, 'the dragged chunk renders as one fixed block');
  assert.strictEqual(pinned[0].start, drop, 'at the dropped time');
  assert.ok(pinned[0].dragPin, 'flagged as a drag-pin (draggable + unpin)');

  const flex = schedMin(after.chunks, 'x');
  assert.ok(flex > 0, 'the task\'s other minutes are still scheduled — it did not become fixed work');
  assert.strictEqual(flex + dur, total, 'pinned + repacked = the same daily minutes');
  for (const s of after.chunks.filter(k => k.type === 'scheduled' && k.id === 'x'))
    assert.ok(!overlaps(s, pinned[0]), 'the repacked remainder never overlaps the new pin');
});

// 19. Every block keeps a positive span and the day's rendered minutes still equal the allotments.
test('drag-pin (04): a partial pin leaves no zero-length block and no lost minutes', () => {
  const c = make();
  const { B, ev, x } = splitDay(c);
  pack(c, [ev, x]);
  const dur = 60;
  x.pin = [{ day: B, start: B + 7 * H, dur, partial: true }];
  const { chunks } = pack(c, [ev, x]);

  for (const k of chunks) if (k.start) assert.ok(k.end > k.start, 'no zero/negative-length block');
  const drawn = chunks.filter(k => k.start && k.id === 'x')
    .reduce((s, k) => s + (k.end - k.start) / MIN, 0);
  assert.strictEqual(drawn, c._allot['x'].allotted, 'Σ drawn minutes = the task\'s allotment');
  assert.strictEqual(chunks.filter(k => k.type === 'unscheduled' && k.id === 'x').length, 0,
    'nothing spilled to Unscheduled');
});

// 20. Two partial pins coexist; each is its own block, keyed by (day, start), not by chunk index.
test('drag-pin (04): a task can hold several partial pins, one per dragged chunk', () => {
  const c = make();
  const { B, ev, x } = splitDay(c);
  x.pin = [{ day: B, start: B + 6 * H, dur: 60, partial: true },
           { day: B, start: B + 8 * H, dur: 60, partial: true }];
  const { chunks } = pack(c, [ev, x]);
  const pinned = chunks.filter(k => k.type === 'fixed' && k.id === 'x').sort((a, b) => a.start - b.start);
  assert.strictEqual(pinned.length, 2, 'both pinned chunks render');
  assert.strictEqual(pinned[0].start, B + 6 * H);
  assert.strictEqual(pinned[1].start, B + 8 * H);
  assert.strictEqual(c._allot['x'].pinnedMin, 120, 'both spans count as fixed minutes');
  assert.ok(!overlaps(pinned[0], pinned[1]), 'the two pins do not overlap');
  assert.strictEqual(schedMin(chunks, 'x') + 120, c._allot['x'].allotted,
    'the unpinned remainder still packs');
});

// 21. A pin record with no `partial` flag keeps the pre-04 whole-task meaning (legacy rows included).
test('drag-pin (04): a whole-task pin still removes the task from the flexible pool', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B + 30000;
  cleanDay(c, '10:00');
  const whole = activeTask(c, { id: 'w', name: 'W', planned: 120 });
  whole.pin = [{ day: B, start: B + 5 * H, dur: 120 }];      // list shape, no `partial`
  const legacy = activeTask(c, { id: 'l', name: 'L', planned: 120 });
  legacy.pin = { day: B, start: B + 2 * H, dur: 60 };         // legacy object shape
  pack(c, [whole, legacy]);
  assert.ok(c._allot['w'].fixed, 'list-shaped whole pin is fixed work');
  assert.strictEqual(c._allot['w'].allotted, 120);
  assert.ok(c._allot['l'].fixed, 'legacy object pin reads as a whole pin');
  assert.strictEqual(c._allot['l'].allotted, 60);
  assert.strictEqual(c.hasFullDragPinToday(whole, B), true);
  assert.strictEqual(c.hasFullDragPinToday(legacy, B), true);
  whole.pin = [{ day: B, start: B + 5 * H, dur: 120, partial: true }];
  assert.strictEqual(c.hasFullDragPinToday(whole, B), false, 'a partial pin is not a whole pin');
  assert.strictEqual(c.hasDragPinToday(whole, B), true, 'but it is still a pin');
});

// 22. migrateDragPinList normalizes the legacy object into a one-element list, idempotently.
test('drag-pin (04): migrateDragPinList converts the legacy object shape once', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = { id: 't', pin: { day: B, start: B + 3 * H, dur: 45 } };
  const already = { id: 'a', pin: [{ day: B, start: B + H, dur: 30, partial: true }] };
  const none = { id: 'n', pin: null };
  assert.strictEqual(c.migrateDragPinList([t, already, none]), 1, 'only the legacy row changes');
  assert.ok(Array.isArray(t.pin) && t.pin.length === 1, 'legacy object became a one-element list');
  assert.strictEqual(t.pin[0].dur, 45);
  assert.strictEqual(t.pin[0].partial, undefined, 'a converted legacy pin is a WHOLE pin');
  assert.strictEqual(c.migrateDragPinList([t, already, none]), 0, 'idempotent');
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
  // spent is now a per-day ledger (spentByDay); today's 45 min must come from today's key, not the lifetime total.
  const t = activeTask(c, { id: 't', name: 'T', planned: 120, spent: 45, spentByDay: { [c.ymdOf(B)]: 45 }, start: B - DAY, end: B + 5 * DAY });
  c.state.tasks = [t];
  const today = c.computeAllotted([t], B);
  const future = c.computeAllotted([t], B + 2 * DAY);
  // 2026-08-16: the sole active task's share is the whole 600-minute pool, capped at its own 120-minute
  // ask minus what it has already spent TODAY: 120-45 = 75. The future day has no spend, so it is 120.
  // What this test is about — future days ignore `spent` — is unchanged.
  assert.strictEqual(today['t'].allotted, 120 - 45, 'today subtracts spent');
  assert.strictEqual(future['t'].allotted, 120, 'future day ignores spent (spent = today only)');
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
  const t = activeTask(c, { id: 't', name: 'T', included:null, planned: 60, start: B + 2 * DAY, end: B + 2 * DAY });
  assert.ok(!c.isActiveOn(t, B), 'not active today (window starts in 2 days)');
  assert.ok(c.isActiveOn(t, B + 2 * DAY), 'active on its own day');
});

/* ====================== PART F — keep-clear Points ====================== */

test('isPointOn / keepClearToday: a clocked no-duration start is a keep-clear Point', () => {
  const c = make();
  const B = c.startOfToday();
  const point    = activeTask(c, { id: 'p',  start: B + 14 * H, end: null, planned: 0 });
  const notBefore = activeTask(c, { id: 'nb', start: B + 14 * H, end: null, planned: 120 });
  const mile     = activeTask(c, { id: 'm',  type: 'Milestone', start: B + 14 * H });
  const dateless = activeTask(c, { id: 'd',  start: null, end: null, planned: 0 });
  assert.equal(c.isPointOn(point, B), true);
  assert.equal(c.isPointOn(notBefore, B), false, 'planned>0 NOT-before task is not a Point');
  assert.equal(c.isPointOn(mile, B), false);
  assert.equal(c.isPointOn(dateless, B), false);
  assert.deepEqual(c.keepClearToday(B, [point, notBefore, mile, dateless]), [B + 14 * H]);
});

test('dayIntervals: a keep-clear instant splits free without changing total minutes', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const base  = c.dayIntervals(B, null, [], []);
  const split = c.dayIntervals(B, null, [], [B + 14 * H]);
  const mins = ivs => ivs.reduce((a, iv) => a + (iv.end - iv.start), 0);
  assert.equal(mins(split.free), mins(base.free), 'zero-width split preserves total free');
  assert.equal(split.free.length, base.free.length + 1, 'one interval became two');
  assert.ok(split.free.some(iv => iv.end === B + 14 * H) && split.free.some(iv => iv.start === B + 14 * H),
    'the two new intervals touch at the instant');
});

test('dayIntervals: an instant outside a free interval is a no-op', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const win  = c.dayIntervals(B, null, [], []);
  const noop = c.dayIntervals(B, null, [], [win.winEnd + H]);
  assert.equal(noop.free.length, win.free.length);
});

test('buildDayTimeline: a Point splits an over-spanning block so no work crosses its clock', () => {
  // The definitive keep-clear test: ONE task whose allotment (the whole 180min pool) would, without
  // the clamp, render as a single block 13:00-16:00 straddling the 14:00 Point. The clamp must split
  // free at 14:00 AND keep the merge step from re-joining across it, so the task renders as two blocks
  // (13:00-14:00, 14:00-16:00) with the Point's instant clear. Removing either the dayIntervals wiring
  // or the merge guard regresses this to one spanning block.
  const c = make();
  cleanDay(c, '23:59');
  c.state.settings.dayStart = '13:00'; c.state.settings.dayEnd = '16:00'; // 3h window, one 180min task fills it
  const B = c.startOfToday();
  const X = B + 14 * H; // the Point's clock (2pm)
  const point = activeTask(c, { id: 'pt', start: X, end: null, planned: 0 });
  const a = activeTask(c, { id: 'a', start: B - DAY, end: B + DAY, priority: 1, planned: 120 });
  c.state.tasks = [point, a];
  c._allot = c.computeAllotted(c.state.tasks);
  const { chunks } = c.buildDayTimeline();
  const scheduled = chunks.filter(x => x.type === 'scheduled');
  assert.ok(scheduled.every(s => !(s.start < X && s.end > X)), 'no scheduled block spans the Point');
  assert.ok(scheduled.some(s => s.end <= X), 'work packed before the Point');
  assert.ok(scheduled.some(s => s.start >= X), 'work packed after the Point');
  assert.ok(!chunks.some(x => x.id === 'pt'), 'the Point reserves no block');
});

test('buildDayTimeline: two different tasks pack on either side of a Point, neither crossing it', () => {
  // Equal weights (60:60 → 90min each of the 180min pool). Without the clamp, task a (90min, packed
  // first) renders 13:00-14:30, spanning the Point. With it, a is split at 14:00 and b takes the rest.
  const c = make();
  cleanDay(c, '23:59');
  c.state.settings.dayStart = '13:00'; c.state.settings.dayEnd = '16:00';
  const B = c.startOfToday();
  const X = B + 14 * H;
  const point = activeTask(c, { id: 'pt', start: X, end: null, planned: 0 });
  const a = activeTask(c, { id: 'a', start: B - DAY, end: B + DAY, priority: 1, planned: 60 });
  const b = activeTask(c, { id: 'b', start: B - DAY, end: B + DAY, priority: 2, planned: 60 });
  c.state.tasks = [point, a, b];
  c._allot = c.computeAllotted(c.state.tasks);
  const { chunks } = c.buildDayTimeline();
  const scheduled = chunks.filter(x => x.type === 'scheduled');
  assert.ok(scheduled.every(s => !(s.start < X && s.end > X)), 'no scheduled block spans the Point');
  assert.ok(scheduled.some(s => s.id === 'b' && s.start >= X), 'the second task packs after the Point');
  assert.ok(!chunks.some(x => x.id === 'pt'), 'the Point reserves no block');
});

test('computeAllotted: adding a Point does not change the pool total', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const a = activeTask(c, { id: 'a', planned: 120 });
  const without = c.computeAllotted([a]);
  const point = activeTask(c, { id: 'pt', start: B + 14 * H, end: null, planned: 0 });
  const withPt = c.computeAllotted([a, point]);
  assert.equal(withPt['a'].allotted, without['a'].allotted);
});

/* ================ PART G — Group 2 render-shape emitters (points + top-hover) ================ */

test('pointsToday: a clocked no-duration start surfaces as a render Point {id,ms,title}', () => {
  const c = make();
  const B = c.startOfToday();
  const point = activeTask(c, { id:'p', name:'Meeting', start:B + 14*H, end:null, planned:0 });
  const block = activeTask(c, { id:'b', name:'Work',    start:B + 14*H, end:null, planned:120 });
  c.state.tasks = [point, block]; c._allot = c.computeAllotted(c.state.tasks);
  assert.deepEqual(c.buildDayTimeline(B).points, [{ id:'p', ms:B + 14*H, title:'Meeting' }]);
});

test('topHover: a dated-but-untimed planned-0 task surfaces; timed/blocked/dateless/milestone excluded', () => {
  const c = make();
  const B = c.startOfToday();
  const hover    = activeTask(c, { id:'h',  name:'Report',  start:B, end:null, planned:0 });
  const hoverDue = activeTask(c, { id:'hd', name:'Essay',   start:null, end:B, planned:0 });
  const point    = activeTask(c, { id:'p',  name:'Call',    start:B + 9*H, end:null, planned:0 });
  const block    = activeTask(c, { id:'b',  name:'Study',   start:B, end:null, planned:120 });
  const dateless = activeTask(c, { id:'d',  name:'Someday', start:null, end:null, planned:0 });
  const mile     = activeTask(c, { id:'m',  name:'MS', type:'Milestone', start:B, end:null });
  c.state.tasks = [hover, hoverDue, point, block, dateless, mile];
  c._allot = c.computeAllotted(c.state.tasks);
  assert.deepEqual(c.buildDayTimeline(B).topHover.map(x => x.id).sort(), ['h','hd']);
});

test('topHover: an excluded (unpressed) dated-untimed task does not hover', () => {
  const c = make();
  const B = c.startOfToday();
  const off = activeTask(c, { id:'o', name:'Out', start:B, end:null, planned:0, included:null });
  c.state.tasks = [off]; c._allot = c.computeAllotted(c.state.tasks);
  assert.deepEqual(c.buildDayTimeline(B).topHover, []);
});

test('topHover vs Point guard: a clocked start with no end is a Point, never a hover line', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'pt', name:'Standup', start:B + 10*H, end:null, planned:0 });
  c.state.tasks = [t]; c._allot = c.computeAllotted(c.state.tasks);
  const data = c.buildDayTimeline(B);
  assert.deepEqual(data.points, [{ id:'pt', ms:B + 10*H, title:'Standup' }], 'renders as a Point');
  assert.deepEqual(data.topHover, [], 'excluded from top-hover by the isPointOn guard');
});

test('topHover: a bare-day midnight anchor is a hover line, not a Point', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'rf', name:'Report', start:B, end:null, planned:0 });
  const data = pack(c, [t]);
  assert.deepEqual(data.topHover.map(x=>x.id), ['rf'], 'surfaces as a top-hover chip');
  assert.deepEqual(data.points, [], 'midnight without an explicit clock is not drawn as a Point');
});
test('Point guard: a real user-typed clock (startClock:true) stays a Point, not a hover line', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'m5', name:'Meeting', start:B + 17*H, end:null,
    planned:0, startClock:true });
  const data = pack(c, [t]);
  assert.deepEqual(data.points, [{ id:'m5', ms:B + 17*H, title:'Meeting' }], 'stays a clocked Point');
  assert.deepEqual(data.topHover, [], 'a real clock is never a hover line');
});

/* --- 04b: drag-recovery arithmetic + regroup -----------------------------------------------------
   Dropping a pin ACROSS an appointment is permitted (owner, 2026-08-04). What was not intended is
   that it used to hand the task the overlapping minutes as extra time: `pinBack` added the pin's
   whole span back into the pool, but the shared minutes were never free, so the day grew. The pin's
   drawn span (pinnedMin) and the free time it consumed (pinBack) are two different measures. */

// 23. netBusyClaim: every busy minute is attributed once, and never to the later-arriving pin.
test('04b: netBusyClaim credits a pin only for the free time it actually consumed', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const at = (h0, h1) => ({ start: B + h0 * H, end: B + h1 * H });
  const appt = Object.assign(at(4, 5), { note: 'Appt' });
  const pin = Object.assign(at(3.5, 7.5), { taskId: 'x' });   // 240 min, 60 of them under the appt

  const claim = c.netBusyClaim([appt, pin], b => b.taskId === 'x', B, B + 10 * H);
  assert.strictEqual(claim.total, 180, 'the 60 minutes shared with the appointment are not free time');
  assert.strictEqual(claim.byTask['x'], 180, 'and they are attributed per task the same way');

  // A pin that overlaps nothing claims its whole span; two overlapping pins claim the union once.
  assert.strictEqual(c.netBusyClaim([Object.assign(at(6, 7), { taskId: 'y' })],
    b => b.taskId === 'y', B, B + 10 * H).total, 60, 'a clear pin claims all of its own span');
  assert.strictEqual(c.netBusyClaim([Object.assign(at(6, 8), { taskId: 'z' }),
    Object.assign(at(7, 9), { taskId: 'z' })], b => b.taskId === 'z', B, B + 10 * H).total, 180,
    'two overlapping pins of one task claim the union, not the sum');
});

// 24. The e2e defect this fixes: an overlapping drop must not grow the day.
test('04b: a partial pin dropped across an appointment does not grant the task extra minutes', () => {
  const c = make();
  const { B, ev, x } = splitDay(c);           // window 00:00-10:00, appointment 04:00-05:00
  pack(c, [ev, x]);
  const total = c._allot['x'].allotted;
  assert.strictEqual(total, 540, 'baseline: the single flexible task holds the whole pool');

  // drop a 240-minute chunk at 03:30 — 03:30-07:30, overlapping the appointment by a full hour
  x.pin = [{ day: B, start: B + 3.5 * H, dur: 240, partial: true }];
  const after = pack(c, [ev, x]);

  assert.strictEqual(c._allot['x'].allotted, total, 'the overlapping drop is a MOVE, not a grant');
  assert.strictEqual(c._allot['x'].pinnedMin, 240,
    'the pin still holds its whole drawn span, so the flexible remainder shrinks by all of it');
  const drawn = after.chunks.filter(k => k.start && k.id === 'x')
    .reduce((s, k) => s + (k.end - k.start) / MIN, 0);
  assert.strictEqual(drawn, total, 'Σ drawn minutes still equals the allotment');
  assert.strictEqual(after.chunks.filter(k => k.type === 'unscheduled' && k.id === 'x').length, 0,
    'and nothing spilled to Unscheduled');
});

// Fixture: window 00:00-10:00, an appointment at 01:00-02:00 that splits a 100-minute task in two,
// plus a filler that soaks up the rest of the pool so a contiguous slot for the 100 exists.
function regroupDay(c){
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;
  cleanDay(c, '10:00');
  const ev = activeTask(c, { id:'ev', name:'Appt', eventId:'g1', allDay:false,
    start: B + 1 * H, end: B + 2 * H, planned: 60 });
  const a = activeTask(c, { id:'a', name:'Split me', planned: 100, priority: 1 });
  const b = activeTask(c, { id:'b', name:'Filler', planned: 440, priority: 2 });
  return { B, ev, a, b };
}

// 25. regroupSpan picks the earliest slot at or after where the task already starts, or nothing.
test('04b: regroupSpan finds a contiguous slot, and reports null when there is none', () => {
  const c = make();
  const { B, ev, a, b } = regroupDay(c);
  const data = pack(c, [ev, a, b]);
  assert.ok(data.chunks.filter(k => k.start && k.id === 'a').length > 1,
    'fixture: the appointment splits the task');

  const span = c.regroupSpan(B, 'a', data);
  assert.strictEqual(span.start, B + 2 * H, 'the 60-minute gap before the appointment cannot hold 100 minutes');
  assert.strictEqual((span.end - span.start) / MIN, 100, 'the span is the task\'s whole drawn day');

  // The filler is drawn across the whole day and has no gap big enough for its own 440 minutes.
  assert.strictEqual(c.regroupSpan(B, 'b', data), null, 'no contiguous room ⇒ no regroup offered');
  // A task the day did not split has nothing to re-join.
  const solo = pack(c, [a]);
  assert.strictEqual(c.regroupSpan(B, 'a', solo), null, 'one chunk ⇒ nothing to regroup');
});

// 26. regroupTask joins the chunks and leaves every other task's minutes alone.
test('04b: regroupTask re-joins a split task into one block without changing the day\'s minutes', () => {
  const c = make();
  const { B, ev, a, b } = regroupDay(c);
  const before = pack(c, [ev, a, b]);
  const wasA = schedMin(before.chunks, 'a'), wasB = schedMin(before.chunks, 'b');

  assert.strictEqual(c.regroupTask('a', B), true, 'regroup applied');
  const after = pack(c, c.state.tasks);

  const mine = after.chunks.filter(k => k.start && k.id === 'a');
  assert.strictEqual(mine.length, 1, 'one contiguous block');
  assert.strictEqual((mine[0].end - mine[0].start) / MIN, wasA, 'holding the same minutes as before');
  assert.ok(mine[0].dragPin, 'as a pin — the only way to hold a slot against the packer');
  assert.strictEqual(schedMin(after.chunks, 'b') + (after.chunks
    .filter(k => k.type === 'fixed' && k.id === 'b')
    .reduce((s, k) => s + (k.end - k.start) / MIN, 0)), wasB, 'the other task neither gained nor lost');
  assert.strictEqual(after.chunks.filter(k => k.type === 'unscheduled').length, 0, 'nothing spilled');
});

// ── V4.2: edge-drag = a sticky manual `allotted` override ────────────────────────────────────────
// The gesture itself (a real pointer on a real edge handle) is e2e-only by the AGENTS.md split; what
// belongs here is the arithmetic underneath it: what an edge-drag writes, what it does to everybody
// else's minutes, and whether it survives the next pack.

// 27. The pure delta→minutes step, including its floor.
test('V4.2: edgeAllotFor moves the day total by the dragged minutes and never falls below the floor', () => {
  const c = make();
  assert.strictEqual(c.edgeAllotFor(120, 45), 165, 'dragging the edge DOWN grows the allotment');
  assert.strictEqual(c.edgeAllotFor(120, -45), 75, 'dragging it UP shrinks the allotment');
  assert.strictEqual(c.edgeAllotFor(120, 0.4), 120, 'sub-minute drags round, they do not accumulate');
  assert.strictEqual(c.edgeAllotFor(120, -600), c.EDGE_MIN_ALLOT,
    'a drag past the top of the block floors at EDGE_MIN_ALLOT — a 0-minute block would vanish under the pointer');
  assert.strictEqual(c.edgeAllotFor(0, 30), 30, 'a task with no time yet can be given some');
});

// 28. Which blocks offer the handle at all. Every `false` here is a case where writing `predicted`
//     would be overwritten on the next pack, or would describe minutes the task does not own.
test('V4.2: only a block whose own allotment the seam decides is edge-resizable', () => {
  const c = make();
  const parent = c.normalizeTask({ id: 'p', name: 'Parent', planned: 60 });
  const kid = c.normalizeTask({ id: 'k', name: 'Kid', planned: 30, parentId: 'p' });
  const solo = c.normalizeTask({ id: 's', name: 'Solo', planned: 60 });
  const kb = c.buildKids([parent, kid, solo]);
  const ch = (id, extra) => Object.assign({ id, start: 1, end: 2, type: 'scheduled' }, extra || {});

  assert.strictEqual(c.blockResizable(ch('s'), kb), true, 'a flexible top-level leaf');
  assert.strictEqual(c.blockResizable(ch('p'), kb), false, 'a family block is subdivided among its children');
  assert.strictEqual(c.blockResizable(ch('k'), kb), false, 'a subtask is handed its share by distribute()');
  assert.strictEqual(c.blockResizable(ch('s', { type: 'fixed' }), kb), false, 'an appointment / drag-pin holds a fixed span');
  assert.strictEqual(c.blockResizable(ch(null, { type: 'meal' }), kb), false, 'a meal is not a task');
  assert.strictEqual(c.blockResizable(ch('s', { start: null }), kb), false, 'an unscheduled chunk has no edge');
});

// 29. The behaviour the V4.2 milestone actually names: it sticks, and the others re-compress.
test('V4.2: an edge-drag sets a sticky allotment; the other tasks re-compress and it survives a re-pack', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;
  cleanDay(c, '10:00');                                   // a 600-minute pool
  const a = activeTask(c, { id: 'a', name: 'Resized', planned: 60, priority: 1 });
  const b = activeTask(c, { id: 'b', name: 'Other', planned: 540, priority: 2 });

  pack(c, [a, b]);
  const wasA = c._allot['a'].allotted, wasB = c._allot['b'].allotted;
  assert.strictEqual(wasA + wasB, 600, 'baseline: the two share the whole pool');
  assert.strictEqual(wasA, 60, 'baseline: proportional-by-planned');

  // The drop: the user drags A's bottom edge down by 120 minutes' worth of pixels.
  c.setAllottedManual('a', c.edgeAllotFor(wasA, 120));

  const after = pack(c, c.state.tasks);
  assert.strictEqual(c.state.tasks.find(t => t.id === 'a').predictManual, true,
    'the override is written through the EXISTING predicted/predictManual seam, not a new field');
  assert.strictEqual(c._allot['a'].allotted, 180, 'the resized task holds exactly what the drag asked for');
  assert.strictEqual(c._allot['b'].allotted, 600 - 180, 'the other task re-compressed to fill the rest of the day');
  assert.strictEqual(schedMin(after.chunks, 'a'), 180, 'and the timeline draws the new allotment');
  assert.strictEqual(after.chunks.filter(k => k.type === 'unscheduled').length, 0, 'nothing spilled');

  // Sticky: re-packing (here, after an unrelated change to the OTHER task) must not recompute it away.
  // (mutate through `c.state.tasks` — `commit()` replaced the array, so the fixture objects are stale)
  c.state.tasks.find(t => t.id === 'b').planned = 60;
  pack(c, c.state.tasks);
  assert.strictEqual(c._allot['a'].allotted, 180,
    'a re-compression triggered by another task leaves the manual allotment alone');
  // 2026-08-16: b's share is the whole 420-minute remainder, capped at the 60 minutes it now asks
  // for. "Absorbs the whole rest of the pool" was the inflation this release removed.
  assert.strictEqual(c._allot['b'].allotted, 60, 'the other task takes exactly its own new estimate');

  // …until it is reset, which is the existing ∿/✎ toggle — no second reset mechanism was invented.
  c._allot = c.computeAllotted(c.state.tasks, B);
  c.togglePredictManual('a');
  pack(c, c.state.tasks);
  assert.strictEqual(c.state.tasks.find(t => t.id === 'a').predictManual, false, 'reset clears the override');
  // 2026-08-16: both tasks now ask for 60 of a 600-minute day, so they get 60 each and 480 minutes
  // stay free. The point stands — the reset put `a` back on the same footing as everyone else.
  assert.strictEqual(c._allot['a'].allotted, c._allot['b'].allotted, 'and the pool is shared again');
  assert.strictEqual(c._allot['a'].allotted, 60, 'back to auto: each gets exactly its 60-minute ask');
});

// ── V4.3: snapping — priority snap-to-original, Alt-disable, Reset ───────────────────────────────
// The rule under test is a PRECEDENCE, not an arithmetic: the original is tried before the grid and
// before the neighbour magnet, with a wider window than either, so a value close to the original can
// never be pulled off it by a grid line that happens to be closer.

// 30. The allotment axis: the computed value beats the grid, and Alt turns every snap off.
test('V4.3: an edge-drag snaps to the ORIGINAL allotment in preference to the grid, unless Alt is held', () => {
  const c = make();
  const orig = 100;

  // A raw value 3 minutes off the original: the grid line at 105 is only 2 minutes away and would win
  // a nearest-wins contest. The priority snap must take it anyway.
  const near = c.edgeAllotFor(orig, 3, { orig });
  assert.strictEqual(near, orig, 'inside the magnet the ORIGINAL wins, even when a grid line is nearer');
  assert.notStrictEqual(near, 105, 'the grid did not get to decide');

  // Outside the magnet the grid is back in charge.
  assert.strictEqual(c.edgeAllotFor(orig, 22, { orig }), 120, 'past the magnet it snaps to the ALLOT_SNAP grid');
  assert.ok(c.ALLOT_ORIG_MAGNET > c.ALLOT_SNAP,
    'the priority window is wider than a whole grid step — otherwise "priority" would be a coin toss');

  // Alt: neither snap applies, and the value is free to the minute.
  assert.strictEqual(c.edgeAllotFor(orig, 3, { orig, free: true }), 103, 'Alt ignores the priority snap');
  assert.strictEqual(c.edgeAllotFor(orig, 22, { orig, free: true }), 122, 'Alt ignores the grid too');

  // The floor still governs every mode — a snap must never hand back a vanishing block.
  assert.strictEqual(c.edgeAllotFor(orig, -600, { orig, free: true }), c.EDGE_MIN_ALLOT, 'Alt does not defeat the floor');
  assert.strictEqual(c.edgeOrigAllot(2), c.EDGE_MIN_ALLOT, 'nor does the original itself, if it is below the floor');
  // Omitting opts entirely is the pre-V4.3 call: grid only, no original.
  assert.strictEqual(c.edgeAllotFor(orig, 3), 105, 'with no original supplied the grid decides');
});

// 31. The position axis: same precedence, against BOTH of snapPinStart's existing snaps.
test('V4.3: a body-drag snaps to the ORIGINAL start ahead of the neighbour magnet and the grid, unless Alt is held', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;
  cleanDay(c, '10:00');                                   // window 00:00-10:00
  const orig = B + 2 * H;                                 // the block's undragged start
  const neighbour = orig + 6 * MIN;                       // a neighbour edge 6 minutes away…
  const targets = [neighbour];
  const dur = 60;

  // …and a raw start 8 minutes off the original. The neighbour magnet (10 min) would take it, and the
  // 15-minute grid would take it somewhere else again. The original outranks both.
  const raw = orig + 8 * MIN;
  assert.strictEqual(c.snapPinStart(raw, dur, B, targets, { orig }), orig,
    'inside PIN_ORIG_MAGNET the original wins over a nearer neighbour edge');
  assert.strictEqual(c.snapPinStart(raw, dur, B, targets), neighbour,
    'without an original supplied, the pre-V4.3 neighbour magnet is unchanged');
  assert.ok(c.PIN_ORIG_MAGNET > c.PIN_MAGNET && c.PIN_ORIG_MAGNET > c.PIN_SNAP / 2,
    'the priority window outranges both older snaps by construction');

  // Past the window, the older behaviour is untouched.
  const far = orig + 40 * MIN;
  assert.strictEqual(c.snapPinStart(far, dur, B, targets, { orig }), c.snapPinStart(far, dur, B, targets),
    'outside the magnet an original changes nothing at all');

  // Alt: no magnet, no grid — the raw minute survives.
  const odd = orig + 7 * MIN + 20000;
  assert.strictEqual(c.snapPinStart(odd, dur, B, targets, { orig, free: true }), orig + 7 * MIN,
    'Alt places freely, to the minute, ignoring both the original and the neighbour');
  // …but free placement is still placement INSIDE the day.
  assert.strictEqual(c.snapPinStart(B - 3 * H, dur, B, targets, { free: true }), B,
    'Alt does not license dropping a block outside its own window');
});

// 32. Reset, and undo. The milestone's promise is that the objective schedule is always recoverable.
test('V4.3: Reset restores the computed allotment and position in one commit, and undo recovers', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;
  cleanDay(c, '10:00');                                   // a 600-minute pool
  const a = activeTask(c, { id: 'a', name: 'Seized', planned: 60, priority: 1 });
  const b = activeTask(c, { id: 'b', name: 'Other', planned: 540, priority: 2 });
  pack(c, [a, b]);
  const computedA = c._allot['a'].allotted;
  assert.strictEqual(computedA, 60, 'baseline: proportional-by-planned');

  // Seize the block on both axes: a manual allotment AND a hand-placed pin for today.
  c.setAllottedManual('a', c.edgeAllotFor(computedA, 120));
  c.pinBlockAt('a', B + 5 * H, 180, [], B);
  pack(c, c.state.tasks);
  const seized = c.state.tasks.find(t => t.id === 'a');
  assert.strictEqual(seized.predictManual, true, 'precondition: the allotment is manual');
  assert.strictEqual(c.pinsOf(seized).filter(p => p.day === B).length, 1, 'precondition: the position is pinned');
  assert.strictEqual(c.blockOverridden(seized, B), true, 'and the block reads as overridden');

  // One Reset. One commit(). Both halves of the override go.
  const before = c.history.length;
  c.resetBlock('a', B);
  assert.strictEqual(c.history.length, before + 1, 'Reset is ONE undo entry, not one per axis');
  const reset = c.state.tasks.find(t => t.id === 'a');
  assert.strictEqual(reset.predictManual, false, 'the manual allotment is released');
  assert.strictEqual(c.pinsOf(reset).filter(p => p.day === B).length, 0, 'and so is the day pin');
  pack(c, c.state.tasks);
  assert.strictEqual(c._allot['a'].allotted, computedA, 'the task is back on its COMPUTED allotment');
  assert.strictEqual(c._allot['a'].allotted + c._allot['b'].allotted, 600, 'and the pool is shared again');

  // Undo puts the seized schedule back — the same history stack every other mutation uses.
  c.undo();
  const undone = c.state.tasks.find(t => t.id === 'a');
  assert.strictEqual(undone.predictManual, true, 'undo restores the manual allotment');
  assert.strictEqual(undone.predicted, 180, 'with the minutes the user chose');
  assert.strictEqual(c.pinsOf(undone).filter(p => p.day === B).length, 1, 'and restores the pin');

  // Resetting a block that is already auto writes nothing at all — no empty undo entry to step over.
  c.resetBlock('b', B);
  const quiet = c.history.length;
  c.resetBlock('b', B);
  assert.strictEqual(c.history.length, quiet, 'an already-auto block is not a mutation');
  assert.strictEqual(c.blockOverridden(c.state.tasks.find(t => t.id === 'b'), B), false, 'and it still reads as auto');
});

// 33. The snap-back RELEASE path: landing on the original restores auto formatting, it does not
//     rewrite the same number as a manual override. (This is the half a pure-arithmetic test misses.)
test('V4.3: releasing an edge-drag on the original clears the override rather than re-writing it', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.nowTick = B;
  cleanDay(c, '10:00');
  const a = activeTask(c, { id: 'a', name: 'Seized', planned: 60, priority: 1 });
  const b = activeTask(c, { id: 'b', name: 'Other', planned: 540, priority: 2 });
  pack(c, [a, b]);
  const computed = c._allot['a'].computed;

  c.setAllottedManual('a', 180);
  pack(c, c.state.tasks);
  assert.strictEqual(c._allot['a'].allotted, 180, 'precondition: overridden');

  // Drag back to within the magnet of the computed value: the snap lands exactly on it…
  const landed = c.edgeAllotFor(180, (computed + 2) - 180, { orig: computed });
  assert.strictEqual(landed, c.edgeOrigAllot(computed), 'the drag lands on the computed value');
  // …and the release clears the flag instead of writing `predicted = computed`.
  c.clearAllottedManual('a');
  assert.strictEqual(c.state.tasks.find(t => t.id === 'a').predictManual, false,
    'the task is AUTO again — not manually pinned to the same number, which would freeze it out of the next re-compression');
  c.state.tasks.find(t => t.id === 'b').planned = 60;
  pack(c, c.state.tasks);
  // 2026-08-16: with both rows asking 60 of a 600-minute day, auto means 60 — not half the pool.
  // What is being proved is that `a` moved when `b` changed, i.e. it really is auto again.
  assert.strictEqual(c._allot['a'].allotted, 60,
    'and it re-compresses with everyone else again (auto = its own 60-minute ask)');
});
