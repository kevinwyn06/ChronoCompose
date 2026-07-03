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

// ---- 3. Inactive tasks: excluded (included:false) / Milestone / future / past ----
test("inactive tasks are active:false with allotted 0", () => {
  const c = fresh('10:00');
  const excluded = activeTask(c, { included:false, planned:120 });
  const milestone = activeTask(c, { type:'Milestone', planned:0 });
  const now = Date.now();
  const future = activeTask(c, { planned:120, start: now+2*DAY, end: now+3*DAY });
  const past = activeTask(c, { planned:120, start: now-3*DAY, end: now-2*DAY });
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

// ---- 5. Spread scaling headline: 48h over 12 days = 4h/day regardless of big pool ----
test("spread: single task 2880min over 12 days -> 240/day, not the whole pool", () => {
  const c = fresh('20:00'); // pool = 1200 min (large)
  c.state.settings.allotMode = 'spread';
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { type:'Proportional', planned:2880, spent:0, start: B, end: B + 11*DAY });
  // sanity: activeDaysLeft should be 12 (today..today+11 inclusive)
  assert.strictEqual(c.activeDaysLeft(t), 12, 'activeDaysLeft off — expected 12');
  const m = c.computeAllotted([t]);
  // auto = 2880/12 = 240. autoSum(240) <= room(1200) -> no scaling.
  assert.strictEqual(m[t.id].allotted, 240);
  assert.strictEqual(m[t.id].computed, 240);
});

// ---- 6a. Spread, two tasks under pool -> each its own demand (no scaling) ----
test("spread: demands under pool -> each gets its per-day share unscaled", () => {
  const c = fresh('20:00'); // pool 1200
  c.state.settings.allotMode = 'spread';
  const B = c.startOfDay(Date.now());
  const a = activeTask(c, { type:'Proportional', planned:2880, spent:0, start: B, end: B + 11*DAY }); // 240/day
  const b = activeTask(c, { type:'Proportional', planned:1200, spent:0, start: B, end: B + 11*DAY }); // 100/day
  assert.strictEqual(c.activeDaysLeft(a), 12);
  const m = c.computeAllotted([a, b]);
  // autoSum = 340 <= 1200 -> unscaled
  assert.strictEqual(m[a.id].allotted, 240);
  assert.strictEqual(m[b.id].allotted, 100);
});

// ---- 6b. Spread, demands over pool -> scale by room/autoSum ----
test("spread: demands over pool -> both scaled by room/autoSum", () => {
  const c = fresh('05:00'); // pool = 300 min (small)
  c.state.settings.allotMode = 'spread';
  const B = c.startOfDay(Date.now());
  const a = activeTask(c, { type:'Proportional', planned:2880, spent:0, start: B, end: B + 11*DAY }); // 240/day
  const b = activeTask(c, { type:'Proportional', planned:1200, spent:0, start: B, end: B + 11*DAY }); // 100/day
  const m = c.computeAllotted([a, b]);
  // autoSum = 340 > room 300 -> scale = 300/340.
  // a: 240*300/340 = 211.7647 -> round 212. b: 100*300/340 = 88.235 -> round 88.
  assert.strictEqual(m[a.id].allotted, 212);
  assert.strictEqual(m[b.id].allotted, 88);
  // computed = unscaled
  assert.strictEqual(m[a.id].computed, 240);
  assert.strictEqual(m[b.id].computed, 100);
});

// ---- 7. Spread respects spent ----
test("spread: (planned - spent) / days", () => {
  const c = fresh('20:00'); // pool 1200
  c.state.settings.allotMode = 'spread';
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { type:'Proportional', planned:2880, spent:240, start: B, end: B + 11*DAY });
  assert.strictEqual(c.activeDaysLeft(t), 12);
  const m = c.computeAllotted([t]);
  // (2880-240)/12 = 2640/12 = 220
  assert.strictEqual(m[t.id].allotted, 220);
  assert.strictEqual(m[t.id].computed, 220);
});
