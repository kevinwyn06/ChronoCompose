// Independent, spec-derived test suite for the allotted-time engine.
// Expected numbers are computed by hand from the SPEC, not read from the implementation.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

function fresh(endHHMM){
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, endHHMM);
  return c;
}

// ---- 1. 'today' mode: proportional split of the pool by planned ----
test("today: proportional split of the pool by planned", () => {
  const c = fresh('10:00'); // pool = 600 min
  const p0 = activeTask(c, { planned:120 });
  const p1 = activeTask(c, { planned:120 });
  const p2 = activeTask(c, { planned:240 });
  const m = c.computeAllotted([p0, p1, p2]);
  // pool 600 split 120:120:240 -> 150:150:300
  assert.strictEqual(m[p0.id].allotted, 150);
  assert.strictEqual(m[p1.id].allotted, 150);
  assert.strictEqual(m[p2.id].allotted, 300);
  assert.strictEqual(m[p0.id].active, true);
});

test("today: a manual override fixes its slice; proportional siblings split the remainder", () => {
  const c = fresh('10:00'); // pool = 600 min
  const ex = activeTask(c, { predictManual:true, predicted:120, planned:120 });
  const p1 = activeTask(c, { planned:120 });
  const p2 = activeTask(c, { planned:240 });
  const m = c.computeAllotted([ex, p1, p2]);
  // override = 120. poolRem = 600-120 = 480. split 120:240 -> 160:320.
  assert.strictEqual(m[ex.id].allotted, 120);
  assert.strictEqual(m[p1.id].allotted, 160);
  assert.strictEqual(m[p2.id].allotted, 320);
  assert.strictEqual(m[ex.id].active, true);
});

// ---- 2. 'today' manual override redistribution ----
test("today: two proportional split, then manual override redistributes", () => {
  const c = fresh('10:00'); // pool 600
  let p1 = activeTask(c, { type:'Proportional', planned:120 });
  let p2 = activeTask(c, { type:'Proportional', planned:240 });
  // Baseline: 600 split 120:240 -> 200:400
  let m = c.computeAllotted([p1, p2]);
  assert.strictEqual(m[p1.id].allotted, 200);
  assert.strictEqual(m[p2.id].allotted, 400);
  // Make p1 a manual override at 60. It becomes fixed=60; poolRem=600-60=540 all to p2.
  p1.predictManual = true; p1.predicted = 60;
  m = c.computeAllotted([p1, p2]);
  assert.strictEqual(m[p1.id].allotted, 60);
  assert.strictEqual(m[p2.id].allotted, 540);
  // computed on p1 = its auto value ignoring override. Auto: poolRem when p1 is proportional
  // would again be 600 split 120:240 -> p1 auto = 200.
  assert.strictEqual(m[p1.id].computed, 200);
});

// ---- 3. Inactive tasks: excluded / Milestone / future / past ----
// V2.11: `included:false` ("Off") is retired, so "the user took this out of today" is now a snooze.
// Unpressed alone would NOT do here: activeTask's window straddles yesterday, so V2.2 inheritance
// would carry it straight back in -- which is exactly why setIncludedOff snoozes inherited work.
test("inactive tasks are active:false with allotted 0", () => {
  const c = fresh('10:00');
  const excluded = activeTask(c, { included:null, snoozeUntil: c.startOfToday()+DAY, planned:120 });
  const milestone = activeTask(c, { type:'Milestone', planned:0 });
  const now = Date.now();
  const future = activeTask(c, { included:null, planned:120, start: now+2*DAY, end: now+3*DAY });
  const past = activeTask(c, { included:null, planned:120, start: now-3*DAY, end: now-2*DAY });
  const m = c.computeAllotted([excluded, milestone, future, past]);
  for (const t of [excluded, milestone, future, past]) {
    assert.strictEqual(m[t.id].active, false, t.id + ' should be inactive');
    assert.strictEqual(m[t.id].allotted, 0);
  }
});

// ---- 4. Oversubscription in 'today': a manual override is not pool-capped, siblings starved ----
test("today: a manual override is NOT pool-capped; proportional siblings get 0", () => {
  const c = fresh('10:00'); // pool 600
  const ex = activeTask(c, { predictManual:true, predicted:900, planned:900 });
  const p1 = activeTask(c, { planned:120 });
  const m = c.computeAllotted([ex, p1]);
  // override = 900 (uncapped). poolRem = max(0, 600-900) = 0 -> proportional share 0.
  assert.strictEqual(m[ex.id].allotted, 900);
  assert.strictEqual(m[p1.id].allotted, 0);
});

// ---- 5-7. Spread allot mode REMOVED (owner request 2026-07): scheduling is always whole-day. The former
//          spread-mode tests are gone with it; per-day future scheduling is covered in scheduling.gen.test.js. ----
