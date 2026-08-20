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
