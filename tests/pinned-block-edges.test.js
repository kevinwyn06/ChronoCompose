// PP-EXT (owner 2026-09-10): the red inside-facing rule on a pinned block edge.
//
// Owner, verbatim: *"Give tasks with pins and times a inside facing red border on the side(s) with the
// pin in the timelines."* A timeline block runs top = start → bottom = end, so the SIDE is the edge whose
// instant the user actually fixed. Three shapes, and they are genuinely different:
//
//   · a DRAG PIN carries its own duration (`pin.dur`, captured at drop), so both of its edges are fixed
//   · a CLOCK-FIXED appointment always fixes its top (`isFixedOn` requires a written start clock) and
//     fixes its bottom only when an end time was actually written
//   · an edge CLIPPED by the day window was never placed by anyone, so it is not fixed whatever the
//     record says — which is why the flags are decided against the UNCLIPPED instants at build time
//
// The paint itself is two inset box-shadow layers in `renderDayColumn`; what is pinned here is the
// derivation those layers read, plus the fact that it survives the trip through `buildDayTimeline`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const H = 3600000;

test('a whole drag pin fixes BOTH edges — it carries its own duration', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const t = activeTask(c, { id:'pn', start:B - DAY, end:B + DAY, planned:60,
    pin:[{ day:B, start:B + 10*H, dur:60 }] });

  const [blk] = c.dragBlocksOn(t, B);
  assert.equal(blk.fixTop, true, 'the drop placed the start');
  assert.equal(blk.fixBot, true, 'and the captured duration placed the end');
});

test('a pin clipped by midnight does not claim the clipped edge', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  /* Dropped at 23:00 with a three-hour length: the bottom the user sees is midnight, which nobody
     placed. The top is still theirs. */
  const late = activeTask(c, { id:'late', start:B - DAY, end:B + DAY, planned:180,
    pin:[{ day:B, start:B + 23*H, dur:180 }] });
  const [lateBlk] = c.dragBlocksOn(late, B);
  assert.equal(lateBlk.fixTop, true);
  assert.equal(lateBlk.fixBot, false, 'the day cut this edge, so it is not a pinned edge');

  /* And the mirror: a pin whose record starts before the day begins. */
  const early = activeTask(c, { id:'early', start:B - DAY, end:B + DAY, planned:120,
    pin:[{ day:B, start:B - 1*H, dur:120 }] });
  const [earlyBlk] = c.dragBlocksOn(early, B);
  assert.equal(earlyBlk.fixTop, false, 'the day cut the top');
  assert.equal(earlyBlk.fixBot, true, 'the end still lands where the duration put it');
});

test('a clock-fixed appointment fixes its top always, and its bottom only when an end time was written', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const both = activeTask(c, { id:'both', start:B + 9*H, end:B + 10*H,
    startClock:true, endClock:true, planned:60 });
  /* `endClock:false` is the record of a bare date on the end edge — the task states when it BEGINS and
     the app decides when it stops, so only the top is nailed down. `uncompressable:true` is what keeps
     it a FIXED block at all: the clock derivation would otherwise let it compress, which is `isFixedOn`'s
     own gate and not this rule's business. */
  const openEnd = activeTask(c, { id:'open', start:B + 14*H, end:B + 15*H,
    startClock:true, endClock:false, uncompressable:true, planned:60 });

  const byId = {};
  c.fixedBlocksToday(B, [both, openEnd]).forEach(b => { byId[b.taskId] = b; });
  assert.equal(byId['both'].fixTop, true);
  assert.equal(byId['both'].fixBot, true);
  assert.equal(byId['open'].fixTop, true, 'a fixed appointment always states its start');
  assert.equal(byId['open'].fixBot, false, 'nothing states this end, so nothing is pinned there');
});

test('an auto-scheduled block claims no fixed edge at all', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const flex = activeTask(c, { id:'flex', start:B, end:B + DAY, planned:60 });
  c.state.tasks = [flex];

  const mine = c.buildDayTimeline(B).chunks.filter(x => x.id === 'flex');
  assert.ok(mine.length, 'the task did get packed');
  mine.forEach(ch => {
    assert.notEqual(ch.type, 'fixed', 'it is the packer that placed this');
    assert.ok(!ch.fixTop && !ch.fixBot, 'so neither edge carries the red rule');
  });
});

test('the flags survive buildDayTimeline, which is what renderDayColumn reads', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const appt = activeTask(c, { id:'ap', start:B + 9*H, end:B + 10*H,
    startClock:true, endClock:true, planned:60 });
  const pinned = activeTask(c, { id:'pn', start:B - DAY, end:B + DAY, planned:60,
    pin:[{ day:B, start:B + 20*H, dur:60 }] });
  c.state.tasks = [appt, pinned];

  const byId = {};
  c.buildDayTimeline(B).chunks.forEach(ch => { if (ch.id) byId[ch.id] = ch; });
  assert.equal(byId['ap'].fixTop, true);
  assert.equal(byId['ap'].fixBot, true);
  assert.equal(byId['pn'].dragPin, true, 'still the pinned block it was');
  assert.equal(byId['pn'].fixTop, true);
  assert.equal(byId['pn'].fixBot, true);
});
