// Owner, 2026-08-19: "Suppose I finished a task early. Great, the schedule should move. But it should
// not reschedule as if that task never existed. Same thing with a meeting."
//
// The decision: freeze the elapsed span, free the remainder FROM THE COMPLETION MOMENT.
//
//   task A packed 13:30-14:30, marked done at 14:10
//     13:30 |####  history, frozen
//     14:10 |      free from here
//
// `completion` is already a full Date.now() instant on the task (index.html:4769) and per-occurrence
// for recurring series (:4833), so nothing new is stored.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, DAY } = require('./_load.js');

const H = 3600000, M = 60000;

function appt(c, B, id, startH, endH, over) {
  return c.normalizeTask(Object.assign({
    id, name: id, type: 'Proportional', included: true,
    start: B + startH * H, end: B + endH * H,
    startClock: true, endClock: true, uncompressable: true,
    priority: 4, deps: [], pct: 0, planned: null, spent: 0,
  }, over || {}));
}

function flex(c, B, id, plannedMin, over) {
  return c.normalizeTask(Object.assign({
    id, name: id, type: 'Proportional', included: true,
    start: B, end: B + DAY, priority: 4, deps: [], pct: 0,
    planned: plannedMin, spent: 0,
  }, over || {}));
}

test('freeze the past: history blocks — a completed appointment keeps the hours it consumed', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const m = appt(c, B, 'mtg', 13, 14, { pct: 100, completion: B + 14 * H });

  const hist = c.completedHistoryBlocks(B, [m], B + 15 * H);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].start, B + 13 * H);
  assert.equal(hist[0].end, B + 14 * H, 'the freeze boundary is the completion instant');
  assert.equal(hist[0].blocking, true);
  assert.equal(hist[0].history, true);
});

test('freeze the past: history blocks — a task finished early freezes only the elapsed part', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  // pinned so its start is data, not a re-pack: pinned 13:30 for 60 minutes, completed at 14:10
  const t = flex(c, B, 'a', 60, {
    pct: 100, completion: B + 14 * H + 10 * M,
    pin: [{ day: B, start: B + 13 * H + 30 * M, dur: 60 }],
  });

  const hist = c.completedHistoryBlocks(B, [t], B + 15 * H);
  assert.equal(hist[0].start, B + 13 * H + 30 * M);
  assert.equal(hist[0].end, B + 14 * H + 10 * M, '40 elapsed minutes frozen, 20 returned');
});

test('freeze the past: history blocks — a completed task with no derivable start yields nothing', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  // dateless, unincluded, never packed: it occupied no hours, so there are no hours to freeze
  const t = c.normalizeTask({ id: 'ghost', name: 'ghost', type: 'Proportional', included: false,
    start: null, end: null, priority: 4, deps: [], pct: 100, completion: B + 10 * H, planned: 30, spent: 0 });

  // spread across the VM-sandbox realm boundary before comparing, as calendar.gen.test.js does:
  // deepStrictEqual compares prototypes, and the component's Array is not this realm's Array.
  assert.deepEqual([...c.completedHistoryBlocks(B, [t], B + 15 * H)], []);
});

test('freeze the past: history blocks — pure, and `now` is an argument', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const m = appt(c, B, 'mtg', 13, 14, { pct: 100, completion: B + 14 * H });

  const a = c.completedHistoryBlocks(B, [m], B + 15 * H);
  const b = c.completedHistoryBlocks(B, [m], B + 15 * H);
  assert.deepEqual(a, b, 'same inputs, same output');
});

// buildDayTimeline's output key is `chunks` (each carries `id`, `start`, `end`, `type`), and it exposes
// no `free` array — the plan's snippets said `blocks`/`free`. The free intervals are read back from
// `dayIntervals` with the same busy set the packer uses, which is exactly the pool-agreement invariant.
const packedOf = (tl, id) => (tl.chunks || []).filter(b => b.id === id && b.type === 'scheduled');

test('freeze the past: a completed meeting still blocks the hours it consumed', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const m = appt(c, B, 'mtg', 13, 14, { pct: 100, completion: B + 14 * H });
  const work = flex(c, B, 'work', 600);
  c.state.tasks = [m, work];
  c.state.nowTick = B + 15 * H;

  const tl = c.buildDayTimeline(B, [m, work]);
  const overlapsMeeting = packedOf(tl, 'work').some(bl =>
    bl.start < B + 14 * H && bl.end > B + 13 * H);
  assert.equal(overlapsMeeting, false, 'nothing may be packed into a completed meeting\'s hours');
});

test('freeze the past: the floor is the latest completion, not the wall clock', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const done = flex(c, B, 'a', 60, { pct: 100, completion: B + 14 * H + 10 * M,
    pin: [{ day: B, start: B + 13 * H + 30 * M, dur: 60 }] });
  const work = flex(c, B, 'b', 120);
  c.state.tasks = [done, work];
  c.state.nowTick = B + 14 * H + 10 * M;

  const tl = c.buildDayTimeline(B, [done, work]);
  const b = packedOf(tl, 'b')[0];
  assert.ok(b, 'b must be packed somewhere');
  assert.ok(b.start >= B + 14 * H + 10 * M, 'b starts at the completion instant, pulled up by 20 minutes');
});

test('freeze the past: past days are untouched', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now()) - DAY;
  const m = appt(c, B, 'mtg', 13, 14, { pct: 100, completion: B + 14 * H });
  c.state.tasks = [m];

  const cap = {};
  c.computeAllotted([m], B, { capacity: cap });
  assert.equal(cap.pool, 0, 'a past day already gets no flexible pool; history changes nothing there');
});

test('freeze the past: the pool agreement invariant holds with history present', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const m = appt(c, B, 'mtg', 13, 14, { pct: 100, completion: B + 14 * H });
  const work = flex(c, B, 'work', 600);
  c.state.tasks = [m, work];
  c.state.nowTick = B + 15 * H;

  const cap = {};
  c.computeAllotted([m, work], B, { capacity: cap });

  // read the busy set through the same single point of use the pool and the packer share, so the
  // invariant is checked against what ships rather than against a re-implementation of it here
  const busy = c.fixedBlocksToday(B, [m, work]).concat(c.historyBusyToday(B, [m, work]));
  const di = c.dayIntervals(B, c.packStart(B), busy, c.keepClearToday(B, [m, work]));
  const freeMin = di.free.reduce((a, iv) => a + (iv.end - iv.start) / 60000, 0);
  assert.equal(cap.pool, Math.round(freeMin), 'allotment and packing must divide the same minutes');
});

// Owner, verbatim: "remember to add a break after the task is marked done."
test('freeze the past: break — a completed task is followed by breakMin', () => {
  const c = make();
  cleanDay(c, '24:00');
  c.state.settings.breakMin = 3;
  const B = c.startOfDay(Date.now());
  const done = flex(c, B, 'a', 60, { pct: 100, completion: B + 14 * H,
    pin: [{ day: B, start: B + 13 * H, dur: 60 }] });
  const next = flex(c, B, 'b', 120);
  c.state.tasks = [done, next];
  c.state.nowTick = B + 14 * H;

  const tl = c.buildDayTimeline(B, [done, next]);
  const b = packedOf(tl, 'b')[0];
  assert.ok(b, 'b must be packed somewhere');
  assert.ok(b.start >= B + 14 * H + 3 * M, `b started at ${new Date(b.start)}, expected >= 14:03`);
});

test('freeze the past: break — breakMin 0 changes nothing', () => {
  const c = make();
  cleanDay(c, '24:00');                     // cleanDay sets breakMin:0
  const B = c.startOfDay(Date.now());
  const done = flex(c, B, 'a', 60, { pct: 100, completion: B + 14 * H,
    pin: [{ day: B, start: B + 13 * H, dur: 60 }] });
  const next = flex(c, B, 'b', 120);
  c.state.tasks = [done, next];
  c.state.nowTick = B + 14 * H;

  const tl = c.buildDayTimeline(B, [done, next]);
  assert.equal(packedOf(tl, 'b')[0].start, B + 14 * H);
});
