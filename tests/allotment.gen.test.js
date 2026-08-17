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
  // 2026-08-16 (reserve→share→cap): a task is never given MORE time than it asked for. Σdemand =
  // 120+120+240 = 480 against a 600 pool, so every share (1.25× demand) is capped at the row's own
  // figure: 120, 120, 240. The 120 surplus minutes are deliberately left unallocated — a loose day
  // shows real free time instead of inflating every estimate. The old 150:150:300 was the second
  // face of the owner's defect: `planned` used as a weight but never as a target.
  assert.strictEqual(m[p0.id].allotted, 120);
  assert.strictEqual(m[p1.id].allotted, 120);
  assert.strictEqual(m[p2.id].allotted, 240);
  assert.strictEqual(m[p0.id].active, true);
});

test("today: a manual override fixes its slice; proportional siblings split the remainder", () => {
  const c = fresh('10:00'); // pool = 600 min
  const ex = activeTask(c, { predictManual:true, predicted:120, planned:120 });
  const p1 = activeTask(c, { planned:120 });
  const p2 = activeTask(c, { planned:240 });
  const m = c.computeAllotted([ex, p1, p2]);
  // Reserve: the manual override still takes exactly 120 off the top. pool = 600-120 = 480, and the
  // compressible demand is 120+240 = 360, so the shares would be 160:320 — but the cap (2026-08-16)
  // holds each row at its own figure: 120 and 240.
  assert.strictEqual(m[ex.id].allotted, 120);
  assert.strictEqual(m[p1.id].allotted, 120);
  assert.strictEqual(m[p2.id].allotted, 240);
  assert.strictEqual(m[ex.id].active, true);
});

// ---- 2. 'today' manual override redistribution ----
test("today: two proportional split, then manual override redistributes", () => {
  const c = fresh('10:00'); // pool 600
  let p1 = activeTask(c, { type:'Proportional', planned:120 });
  let p2 = activeTask(c, { type:'Proportional', planned:240 });
  // Baseline (2026-08-16): Σdemand = 360 against a 600 pool, so both shares are capped at their own
  // figures — 120 and 240 — and 240 minutes stay free. Was 200:400 before the cap existed.
  let m = c.computeAllotted([p1, p2]);
  assert.strictEqual(m[p1.id].allotted, 120);
  assert.strictEqual(m[p2.id].allotted, 240);
  // Make p1 a manual override at 60. It is reserved at 60; pool = 600-60 = 540, and p2's whole-pool
  // share is capped at its own 240. (Was 540 — the same inflation.)
  p1.predictManual = true; p1.predicted = 60;
  m = c.computeAllotted([p1, p2]);
  assert.strictEqual(m[p1.id].allotted, 60);
  assert.strictEqual(m[p2.id].allotted, 240);
  // `computed` on a RESERVED row is the COUNTERFACTUAL auto share — what the row would be allotted with
  // the override off — never a copy of `allotted`. (The 2026-08-16 rewrite briefly made them equal on the
  // reasoning that only togglePredictManual read it; the V4.3 edge-drag `orig` snap-back reads it too,
  // and equal values make "dragged back to auto" undetectable.)
  // BY HAND: weight is p1's AUTO ask, 120 — not the 60 it typed. Its demand goes back into the sum
  // (240 + 120 = 360) and its reserve back into the pool (600 − 0 other reserves = 600), so the share is
  // 120/360 × 600 = 200, capped at p1's own 120 → 120. Which is exactly the baseline above: untick the
  // override and p1 really is allotted 120.
  assert.strictEqual(m[p1.id].computed, 120);
  assert.strictEqual(m[p1.id].computed, c.computeAllotted([{...p1, predictManual:false}, p2])[p1.id].allotted,
    'the auto value `computed` reports is the one the row gets when the override comes off');
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
