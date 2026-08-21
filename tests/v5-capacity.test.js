/* DELETED 2026-08-20 (Task 28): the tests removed here rendered `renderCapacityBar`, and the owner
 * deleted that readout — both the Today header figure and the per-day strip under the Week/4-Day
 * columns. The ARITHMETIC they were built on is not gone and is still asserted in this file:
 * `dayCapacity` answers the same two numbers, and it is the pool-agreement invariant that matters, not
 * the bar that drew it. (Task 29 then removes the out-param behind `dayCapacity` itself, separately.) */

// Chain 4 / block 21 — the capacity indicator, and past-day journal figures.
//
// The indicator answers the one question nothing on screen answers: "how much have I said yes to,
// against how much time exists". Selection answers WHICH work is in the day and never HOW MUCH.
//
// It REPORTS. The owner deliberately over-subscribes and finds it valuable, so there is no cap, no
// warning, no auto-trim, and nothing here asserts that demand ought to be under the pool. What is
// asserted is that both numbers are TRUE and that they use PER-DAY semantics — a task in a multi-day
// window contributes its whole day figure, never a fraction. The retired `scheduledLoadOn` used the
// fraction shape and disagreed with the drawn grid by up to 7x; that is the failure mode these tests
// exist to make impossible to reintroduce.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

// A day whose pool is exactly `mins` minutes of free time, with no meals and no break reserve.
function poolDay(c, mins){
  cleanDay(c, '23:59');
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  Object.assign(c.state.settings, { dayStart: '00:00', dayEnd: hh + ':' + mm, breakMin: 0 });
}

test('requestedMinutes is what one task asks for, before any compression', () => {
  const c = make();
  assert.equal(c.requestedMinutes(activeTask(c, { planned: 90 })), 90, 'Planned is the ask');
  // Changed 2026-08-16 (allotment fix): reversed. `planned:0` used to draw DEFAULT_TASK_MINUTES because
  // 0 was also the default for "never estimated". Now `null` carries that meaning and a typed 0 is a
  // decision to ask the day for nothing — which is the defect the owner reported.
  assert.equal(c.requestedMinutes(activeTask(c, { planned: 0 })), 0,
    'a deliberate 0 asks for nothing; only an UNSET (null) planned draws the default slice');
  // No clocks on either edge, so the ladder falls past the appointment-span branch to the default.
  assert.equal(c.requestedMinutes(activeTask(c, { planned: null, start: null, end: null })),
    c.DEFAULT_TASK_MINUTES,
    'an unestimated, unclocked task asks for the default slice — the figure the seam grants it');
  assert.equal(c.requestedMinutes(activeTask(c, { planned: 90, predictManual: true, predicted: 25 })), 25,
    'a manual Predict overrides Planned');
  assert.equal(c.requestedMinutes(null), 0);
});

test('demand is the sum of active tasks’ requested minutes and pool is the day’s free minutes', () => {
  const c = make();
  poolDay(c, 540); // a 9-hour day
  c.state.tasks = [
    activeTask(c, { id: 'a', planned: 120 }),
    activeTask(c, { id: 'b', planned: 45 }),
    activeTask(c, { id: 'c', planned: 60 }),
  ];
  const cap = c.dayCapacity(c.startOfToday());
  assert.equal(cap.pool, 540, 'the pool is the day’s real free minutes');
  assert.equal(cap.demand, 225, '120 + 45 + 60 — every task’s whole ask');
  assert.equal(cap.over, false);
  assert.ok(Math.abs(cap.ratio - 225 / 540) < 1e-9);
});

test('an OVER-subscribed day reports the true overshoot and is never trimmed to fit', () => {
  const c = make();
  poolDay(c, 540);
  // Ten 3-hour tasks in a 9-hour day — the exact scenario from the block spec.
  c.state.tasks = [];
  for(let i = 0; i < 10; i++) c.state.tasks.push(activeTask(c, { id: 't' + i, planned: 180 }));
  const cap = c.dayCapacity(c.startOfToday());
  assert.equal(cap.pool, 540);
  assert.equal(cap.demand, 1800, 'the ask is reported at full size, not clamped to the pool');
  assert.equal(cap.over, true);
  assert.ok(cap.ratio > 3, 'and the ratio shows how hard the day is compressed');
  // The compressor still does its job, and nothing was dropped.
  const map = c.computeAllotted(c.state.tasks, c.startOfToday());
  c.state.tasks.forEach(t => assert.ok(map[t.id].active, 'every task is still in the day'));
});

test('an UNDER-subscribed day reports honestly too, and is not flagged over', () => {
  const c = make();
  poolDay(c, 540);
  c.state.tasks = [activeTask(c, { id: 'a', planned: 60 })];
  const cap = c.dayCapacity(c.startOfToday());
  assert.deepEqual({ demand: cap.demand, pool: cap.pool, over: cap.over },
    { demand: 60, pool: 540, over: false });
});

test('an empty day is 0 of the pool — not over, not an error', () => {
  const c = make();
  poolDay(c, 540);
  c.state.tasks = [];
  const cap = c.dayCapacity(c.startOfToday());
  assert.deepEqual({ demand: cap.demand, pool: cap.pool, over: cap.over, ratio: cap.ratio },
    { demand: 0, pool: 540, over: false, ratio: 0 });
});

test('PER-DAY semantics: a task in a multi-day window contributes its FULL day figure', () => {
  const c = make();
  poolDay(c, 540);
  const today = c.startOfToday();
  // One 4-hour task spanning seven days. Spread-across-the-window semantics would report ~34 minutes
  // on any one day; per-day semantics — the model the app keeps — report the whole 240.
  c.state.tasks = [activeTask(c, { id: 'wide', planned: 240, start: today, end: today + 6 * DAY })];
  for(let i = 0; i < 5; i++){
    const cap = c.dayCapacity(today + i * DAY);
    assert.equal(cap.demand, 240, 'day +' + i + ' claims the whole per-day figure');
  }
});

test('the indicator agrees with the grid: pool equals what computeAllotted actually divides', () => {
  const c = make();
  poolDay(c, 720); // 00:00-12:00, so the appointment really falls inside the window
  const today = c.startOfToday();
  // Two flexible tasks plus a real 09:00–10:00 appointment, which leaves the flexible pool entirely.
  const appt = c.normalizeTask({ id: 'appt', name: 'appt', type: 'Proportional', priority: 4, deps: [],
    pct: 0, planned: 60, spent: 0, start: today + 9 * HOUR, end: today + 10 * HOUR,
    startClock: true, endClock: true });
  c.state.tasks = [activeTask(c, { id: 'a', planned: 200 }), activeTask(c, { id: 'b', planned: 100 }), appt];
  const cap = c.dayCapacity(today);
  assert.equal(cap.demand, 300, 'the appointment is not flexible demand — it is already placed');
  assert.equal(cap.pool, 660, 'the pool shrank by exactly the appointment’s span');
  // And the seam divided exactly that pool — the indicator's `pool` is the same number the grid
  // shares out, which is the agreement the retired `scheduledLoadOn` never had.
  // 2026-08-16: the seam divides that pool but no longer hands all of it out — each row is capped at
  // its own ask, so a 660-minute pool facing 300 minutes of demand charges exactly 300 and leaves 360
  // free. The agreement the retired `scheduledLoadOn` never had is still asserted, in its true form:
  // what the grid charges is what the indicator's own two numbers imply, and never more than `pool`.
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.a.allotted + map.b.allotted, cap.demand,
    'a loose day gives every task exactly what it asked for');
  assert.ok(map.a.allotted + map.b.allotted <= cap.pool,
    'and never charges more minutes than the pool the indicator reports');
});

test('the indicator agrees with the grid on a SATURATED day: Σallotted equals pool exactly', () => {
  const c = make();
  // The loose-day case above can only assert `≤ pool`, because the cap deliberately leaves surplus
  // unallocated. The equality that stops the indicator drifting from the drawn grid — the failure the
  // retired `scheduledLoadOn` had by up to 7× — only shows up when the pool is BELOW Σdemand, so it is
  // pinned here separately.
  poolDay(c, 240);
  const today = c.startOfToday();
  // No logged time anywhere, deliberately: `cap.demand` is the raw ask and ignores `spent`, while the
  // grid's cap is `demand − spent`, so a fixture with a ledger would make these two numbers incomparable.
  c.state.tasks = [activeTask(c, { id: 'a', planned: 200, spent: 0 }),
                   activeTask(c, { id: 'b', planned: 100, spent: 0 })];
  const cap = c.dayCapacity(today);
  assert.equal(cap.demand, 300, '200 + 100 — the whole ask, reported unclamped');
  assert.equal(cap.pool, 240, 'and 240 minutes of real free time to divide between them');
  // By hand: share(a) = 200/300 × 240 = 160, share(b) = 100/300 × 240 = 80. Neither is above its own
  // ask (200, 100), so the cap does not bite and Σ = 240. Both are already whole, so largest-remainder
  // apportionment moves nothing.
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.a.allotted, 160, '200/300 of a 240-minute pool');
  assert.equal(map.b.allotted, 80, '100/300 of a 240-minute pool');
  assert.equal(map.a.allotted + map.b.allotted, cap.pool,
    'a saturated day hands out the WHOLE pool — the indicator and the grid cannot drift apart');
});

// --- reserved minutes count toward the over-full signal (owner ruling 2026-08-16) ----------------
//
// This branch added `uncompressable` ("allot exactly the planned figure, never compress it"). A
// reserved row — `predictManual` OR `uncompressable` — is taken off the top of the day before anything
// else competes, so enough of them drive the FLEXIBLE pool to zero and starve every remaining flexible
// task. The owner ruled that the over-full signal must count those minutes, not only flexible demand.
//
// It already does, and these tests exist to keep it that way. `cap.demand` is summed over `acts` — the
// same set the seam receives, reserved rows included — so a reserved ask is on the demand side exactly
// once. A CLOCKED uncompressable row is different: it is `isFixedOn`, so it is stamped into the map as a
// fixed block before the seam runs, never reaches `acts`, and is paid for on the POOL side instead. One
// side or the other, never both. The invariant that makes the signal sound is
// `reserveOf(f) <= demandOf(f)` for both reserve reasons (predictManual reserves `d`; uncompressable
// reserves `d − spent`), which means Σreserve can never exhaust the pool without `demand` already
// exceeding it. Still REPORTING only: nothing below caps, warns or trims.

test('reserved rows exhausting the pool report OVER — the flexible pool is gone and the bar says so', () => {
  const c = make();
  poolDay(c, 240);
  const today = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'u1', planned: 120, uncompressable: true }),
    activeTask(c, { id: 'u2', planned: 120, uncompressable: true }),
    activeTask(c, { id: 'f1', planned: 60 }),
  ];
  const cap = c.dayCapacity(today);
  // By hand: demand = 120 + 120 + 60 = 300, all three asks, reserved ones included. pool = 240.
  assert.equal(cap.demand, 300, 'a reserved ask is still something the user said yes to');
  assert.equal(cap.pool, 240);
  assert.equal(cap.over, true, '300 > 240 — the day is over-full even though the excess is all reserved');
  // By hand: Σreserve = (120 − 0) + (120 − 0) = 240, so the flexible pool is max(0, 240 − 240) = 0 and
  // f1's share is 60/60 × 0 = 0. The indicator's two numbers describe exactly that division.
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.u1.allotted, 120, 'a reserve is never squeezed');
  assert.equal(map.u2.allotted, 120);
  assert.equal(map.f1.allotted, 0, 'and the flexible row is starved — which is what `over` is reporting');
  assert.equal(map.u1.allotted + map.u2.allotted + map.f1.allotted, cap.pool,
    'Σallotted is the pool the indicator reports — no drift from the grid');
});

test('a predictManual reserve counts toward the signal on the same footing', () => {
  const c = make();
  poolDay(c, 240);
  const today = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'p1', planned: 60, predictManual: true, predicted: 240 }),
    activeTask(c, { id: 'f1', planned: 60 }),
  ];
  const cap = c.dayCapacity(today);
  // By hand: requestedMinutes takes branch 1 for p1, so its ask is the typed 240, not planned 60.
  // demand = 240 + 60 = 300 against a 240-minute pool.
  assert.equal(cap.demand, 300, 'the typed figure is the ask — a manual Predict overrides Planned');
  assert.equal(cap.over, true, '300 > 240');
  // By hand: predictManual reserves the typed figure verbatim (no `spent` subtraction), so Σreserve is
  // 240, the flexible pool is 0, and f1 gets 60/60 × 0 = 0.
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.p1.allotted, 240);
  assert.equal(map.f1.allotted, 0);
});

test('reserves BEYOND the pool are still reported at full size, and still honoured in full', () => {
  const c = make();
  poolDay(c, 240);
  const today = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'u1', planned: 200, uncompressable: true }),
    activeTask(c, { id: 'u2', planned: 200, uncompressable: true }),
  ];
  const cap = c.dayCapacity(today);
  // By hand: demand = 200 + 200 = 400, pool = 240, ratio = 400/240 = 5/3.
  assert.equal(cap.demand, 400, 'reported unclamped — the readout never trims an over-subscribed day');
  assert.equal(cap.pool, 240);
  assert.equal(cap.over, true);
  assert.ok(Math.abs(cap.ratio - 400 / 240) < 1e-9);
  // A reserve is honoured in full even on a day too small to hold it — the documented seam invariant,
  // exactly as `predictManual` always behaved. The excess surfaces in Unscheduled, not by shrinking a
  // reserve, and `over` is precisely the signal that this is happening.
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.u1.allotted, 200);
  assert.equal(map.u2.allotted, 200);
});

test('a CLOCKED uncompressable row is counted on the POOL side only — never twice', () => {
  const c = make();
  poolDay(c, 720); // 00:00–12:00, so a 09:00–10:00 appointment really falls inside the window
  const today = c.startOfToday();
  const appt = c.normalizeTask({ id: 'appt', name: 'appt', type: 'Proportional', priority: 4, deps: [],
    pct: 0, planned: 60, spent: 0, start: today + 9 * HOUR, end: today + 10 * HOUR,
    startClock: true, endClock: true });
  assert.equal(c.isUncompressable(appt), true, 'the tick derives from a same-day clocked span');
  assert.equal(c.isFixedOn(appt, today), true, 'so it is a fixed block, stamped before the seam runs');
  c.state.tasks = [appt, activeTask(c, { id: 'a', planned: 200 })];
  const cap = c.dayCapacity(today);
  // By hand: the appointment never reaches `acts`, so demand = 200 — the flexible ask alone. Its 60
  // minutes are paid for on the other side instead: pool = 720 − 60 = 660. Counting it in `demand` as
  // well would charge the day 60 minutes twice for one appointment.
  assert.equal(cap.demand, 200, 'the placed appointment is not demand — it has already taken its time');
  assert.equal(cap.pool, 660, 'the pool shrank by exactly its span, which is where those 60 minutes are');
});

test('reserves exactly equal to the pool are exactly full, not over — the boundary is deliberate', () => {
  const c = make();
  poolDay(c, 240);
  const today = c.startOfToday();
  c.state.tasks = [activeTask(c, { id: 'u1', planned: 240, uncompressable: true })];
  const cap = c.dayCapacity(today);
  // By hand: demand = 240, pool = 240. `over` is `demand > pool`, so equality is not over — and nothing
  // is starved here, because Σreserve = 240 leaves a flexible pool of 0 with no flexible row to divide
  // it between. Widening to `>=` would make an empty day (0 > 0 → 0 >= 0) report over-full, which the
  // empty-day test above forbids.
  assert.deepEqual({ demand: cap.demand, pool: cap.pool, over: cap.over },
    { demand: 240, pool: 240, over: false });
  assert.equal(c.computeAllotted(c.state.tasks, today).u1.allotted, 240, 'and the grid agrees');
});

test('a day already past has no capacity to report — null, not a zero ratio', () => {
  const c = make();
  poolDay(c, 540);
  const today = c.startOfToday();
  c.state.tasks = [activeTask(c, { id: 'a', planned: 120, start: today - 3 * DAY, end: today + DAY })];
  assert.equal(c.dayCapacity(today - DAY), null, 'yesterday');
  assert.ok(c.dayCapacity(today), 'today still reports');
  assert.ok(c.dayCapacity(today + DAY), 'and tomorrow');
});

// --- 21b: past-day journal figures ---------------------------------------------------------------

function journalFixture(){
  const c = make();
  poolDay(c, 540);
  const today = c.startOfToday();
  const past = today - 2 * DAY;
  const t = activeTask(c, { id: 'flex', name: 'flex', planned: 120, start: past, end: today + DAY });
  t.spentByDay = { [c.ymdOf(past)]: 75, [c.ymdOf(today)]: 30 };
  c.state.tasks = [t];
  return { c, today, past, t };
}

test('journalActuals on a past day OMITS the allotted figure rather than printing zero', () => {
  const { c, past } = journalFixture();
  const j = c.journalActuals(past);
  assert.equal(j.allottedKnown, false, 'the day’s plan is not knowable after the fact');
  assert.equal(j.totalAllot, null, 'omitted, not 0 — a bare 0 next to real logged time reads as a bug');
  const row = j.rows.find(r => r.id === 'flex');
  assert.ok(row, 'the worked task is still reported');
  assert.equal(row.allotted, null);
});

test('…while still reporting the spent figures, which are real', () => {
  const { c, past } = journalFixture();
  const j = c.journalActuals(past);
  assert.equal(j.totalSpent, 75);
  assert.equal(j.rows.find(r => r.id === 'flex').spent, 75);
});

test('today and future days still report allotted normally', () => {
  const { c, today } = journalFixture();
  const j = c.journalActuals(today);
  assert.equal(j.allottedKnown, true);
  assert.ok(j.totalAllot > 0, 'today has a real plan and still prints it');
  assert.equal(j.rows.find(r => r.id === 'flex').spent, 30);
});
