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
  assert.equal(c.requestedMinutes(activeTask(c, { planned: 0 })), c.DEFAULT_TASK_MINUTES,
    'a zero-planned task asks for the default slice — the same figure the seam grants it');
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
  const map = c.computeAllotted(c.state.tasks, today);
  assert.equal(map.a.allotted + map.b.allotted, cap.pool);
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

test('the indicator renders both figures, with over-subscription marked in the DOM', () => {
  const c = make();
  poolDay(c, 540);
  const today = c.startOfToday();
  c.state.tasks = [activeTask(c, { id: 'a', planned: 120 })];
  const under = c.renderCapacityBar(today);
  assert.equal(under.props['data-cap-demand'], '120');
  assert.equal(under.props['data-cap-pool'], '540');
  assert.equal(under.props['data-cap-over'], '0', 'an under-subscribed day carries no alarm state');

  c.state.tasks.push(activeTask(c, { id: 'b', planned: 600 }));
  const over = c.renderCapacityBar(today);
  assert.equal(over.props['data-cap-demand'], '720');
  assert.equal(over.props['data-cap-over'], '1');
  assert.match(over.props.title, /Nothing has been dropped/,
    'the tooltip reports compression — it must never read as a warning to obey');

  assert.equal(c.renderCapacityBar(today - DAY), null, 'nothing is drawn on a past day');
  assert.ok(c.renderCapacityBar(today, true), 'the Week-grid variant renders');
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
