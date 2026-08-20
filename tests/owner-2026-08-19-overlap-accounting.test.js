// Owner, 2026-08-19: "the computation of time that is free does not account for the fact that if there
// is overlap between two fixed tasks there is double or multicounted time. As a result, the flexible
// tasks are underpacked and there is time that is not filled."
//
// This file is the DIAGNOSIS. `dayIntervals` unions overlapping busy correctly (its sweep does
// `cur = Math.max(cur, b.end)`), so the pool is not the defect site — the second test below pins that,
// and it must keep passing. The first test is the reproduction.
//
// FINDING (2026-08-19, measured on this fixture: two appointments 10:00-11:00 and 10:30-11:30,
// 24h window, breakMin 0):
//
//   dayIntervals union busy = 90 min   (correct)
//   cap.pool                = 1350 min (correct: 1440 - 90)
//   Sigma allotted(fixed)   = 120 min  (WRONG: 60 + 60, the sum of spans)
//   identity total          = 1470 min against a 1440-minute day: 30 min of phantom time,
//                             exactly the overlap.
//
// CONFIRMED SITE: candidate 1 only -- index.html:4331, where
// `map[b.taskId]={allotted:tot, computed:tot, active:true, fixed:true}` stamps each fixed block's
// whole span as that task's allotment with no overlap attribution. The pool is derived from the
// union and is not implicated.
//
// Candidates 2 and 3 were tested and are NOT live on this defect:
//   - candidate 2 (`brkFams`, index.html:4364-4372): the identity gap is 30 min at breakMin 0 and
//     30 min at breakMin 3 -- breaks do not move it.
//   - candidate 3 (`minChunk`, index.html:757): under saturated flexible demand the packer fills the
//     pool exactly (flexAllotted == flexPacked) both on the overlap fixture and on a deliberately
//     fragmented day of 20-minute gaps, at minChunk default and at minChunk 1. The shortfall is 0.
//     The owner's "time that is not filled" symptom is therefore NOT reproduced by minChunk here;
//     if it persists after Task 2, it needs its own reproduction from the owner's real data.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, DAY } = require('./_load.js');

const H = 3600000;

// A fixed appointment on day B: clocked start, end within the day, `uncompressable` decided true so
// isFixedOn's gate passes. Bare `hasStartTime && hasEndTime` is NOT enough — see architecture/scheduling.md.
function appt(c, B, id, startH, endH) {
  return c.normalizeTask({
    id, name: id, type: 'Proportional', included: true,
    start: B + startH * H, end: B + endH * H,
    startClock: true, endClock: true, uncompressable: true,
    priority: 4, deps: [], pct: 0, planned: null, spent: 0,
  });
}

test('overlap accounting: dayIntervals subtracts the UNION, not the sum', () => {
  const c = make();
  cleanDay(c, '24:00');                       // pool = the whole window, no meals, no breaks
  const B = c.startOfDay(Date.now());
  const tasks = [appt(c, B, 'a', 10, 11), appt(c, B, 'b', 10.5, 11.5)];

  const fixed = c.fixedBlocksToday(B, tasks);
  const di = c.dayIntervals(B, null, fixed, []);
  const freeMin = di.free.reduce((a, iv) => a + (iv.end - iv.start) / 60000, 0);

  // 10:00-11:30 is busy: 90 minutes, not 120.
  assert.equal(1440 - freeMin, 90, 'dayIntervals must union overlapping busy; if this fails the defect moved');
});

test('overlap accounting: the day identity holds when two fixed blocks overlap', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [appt(c, B, 'a', 10, 11), appt(c, B, 'b', 10.5, 11.5)];
  c.state.tasks = tasks;

  const cap = {};
  const map = c.computeAllotted(tasks, B, { capacity: cap });
  const allottedToFixed = Object.keys(map).reduce((a, id) => a + (map[id].fixed ? map[id].allotted : 0), 0);

  // The day is 1440 minutes. The two appointments really consume 90 of them. Anything the fixed set
  // claims beyond 90 is time the day does not have.
  assert.equal(allottedToFixed + cap.pool, 1440,
    `fixed claimed ${allottedToFixed} min against a ${cap.pool} min pool; the day is 1440`);
});

test('overlap accounting: non-overlapping fixed blocks are unchanged', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [appt(c, B, 'a', 10, 11), appt(c, B, 'b', 14, 15)];
  c.state.tasks = tasks;

  const map = c.computeAllotted(tasks, B);
  assert.equal(map.a.allotted, 60, 'a disjoint appointment still claims its whole span');
  assert.equal(map.b.allotted, 60);
});

test('overlap accounting: three overlapping blocks are each charged once', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  // 10:00-11:00, 10:30-11:30, 11:00-12:00  ->  union 10:00-12:00 = 120 minutes
  const tasks = [appt(c, B, 'a', 10, 11), appt(c, B, 'b', 10.5, 11.5), appt(c, B, 'x', 11, 12)];
  c.state.tasks = tasks;

  const map = c.computeAllotted(tasks, B);
  const total = map.a.allotted + map.b.allotted + map.x.allotted;
  assert.equal(total, 120, 'the union is 120 minutes; the sum of spans would be 180');
  assert.equal(map.a.allotted, 60, 'earliest start is charged first, in full');
});
