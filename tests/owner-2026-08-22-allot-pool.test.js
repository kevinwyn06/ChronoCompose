/* Task 29 (2026-08-22) — the pool-agreement invariant, made STRUCTURAL.
 *
 * Task 28 deleted the capacity UI. Task 29's premise was that `computeAllotted`'s `opts.capacity`
 * out-param could then simply be deleted too, and it was deferred because that premise was only half
 * true: nothing RENDERED the out-param, but the allotment suite read it through `dayCapacity` to assert
 * that the seam divides the same `avail` between the same `acts` the readout reports. Deleting it would
 * have cost either that coverage or a second computation of the pool outside `computeAllotted` — which
 * is the exact drift the out-param existed to prevent. (The retired `scheduledLoadOn` disagreed with the
 * drawn grid by up to 7x. That is the failure mode.)
 *
 * The resolution was to LIFT the pool rather than delete it: `allotPool` computes it once, and both
 * `computeAllotted` and `dayCapacity` call it. The invariant is now structural — there is one
 * computation, so the two callers cannot disagree about it.
 *
 * These tests pin the properties that make that claim true, so a future refactor that quietly
 * reintroduces a second pool computation fails here rather than in production arithmetic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, DAY } = require('./_load.js');

const H = 3600000;

// Same fixture shapes the neighbouring allotment suites use, rather than `activeTask` — these tests
// need edges they control exactly, and `activeTask` deliberately straddles today.
function flex(c, B, name, planned){
  return c.normalizeTask({ id: name, name, type: 'Proportional', included: true,
    start: B, end: B + DAY, priority: 4, deps: [], pct: 0, planned, spent: 0 });
}
function appt(c, B, name, from, to){
  return c.normalizeTask({ id: name, name, type: 'Proportional', included: true,
    start: B + from * H, end: B + to * H, startClock: true, endClock: true, uncompressable: true,
    priority: 4, deps: [], pct: 0, planned: null, spent: 0 });
}

test('allotPool: dayCapacity and computeAllotted read ONE pool, not two', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [appt(c, B, 'mtg', 10, 11), flex(c, B, 'work', 240), flex(c, B, 'admin', 90)];
  c.state.tasks = tasks;

  const pool = c.allotPool(tasks, B).avail;
  const cap = c.dayCapacity(B, tasks);

  assert.equal(cap.pool, Math.max(0, Math.round(pool)),
    'the readout reports the pool the helper computed, not one of its own');

  // And the seam really divided THAT pool: flexible allotments cannot exceed it.
  const map = c.computeAllotted(tasks, B);
  const flexAllot = Object.keys(map)
    .reduce((a, id) => a + (map[id].fixed ? 0 : (+map[id].allotted || 0)), 0);
  assert.ok(flexAllot <= Math.round(pool) + 1,
    `flexible allotment ${flexAllot} must fit the ${Math.round(pool)} minute pool it was divided from`);
});

test('allotPool: the competing set is the one the readout counts', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [flex(c, B, 'a', 60), flex(c, B, 'b', 120)];
  c.state.tasks = tasks;

  const ctx = c.allotPool(tasks, B);
  const cap = c.dayCapacity(B, tasks);

  assert.deepEqual(ctx.acts.map(t => t.id).sort(), ['a', 'b'],
    'both flexible tasks compete');
  assert.equal(cap.remaining, 180,
    'remaining is the raw ask of exactly that competing set');
  // `demand` adds only SPENT minutes of finished tasks; nothing is finished here, so they agree.
  assert.equal(cap.demand, cap.remaining, 'with nothing completed the two demand figures coincide');
});

test('allotPool: a past day has no pool, and dayCapacity declines to answer', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now()) - DAY;
  const tasks = [flex(c, B, 'gone', 120)];
  c.state.tasks = tasks;

  assert.equal(Math.round(c.allotPool(tasks, B).avail), 0,
    'a past day gets no flexible pool (block 18)');
  assert.equal(c.dayCapacity(B, tasks), null,
    'and the readout returns null rather than reporting a hypothetical one');
});

test('allotPool: calling it twice on the same day is stable', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [appt(c, B, 'mtg', 9, 10), flex(c, B, 'work', 300)];
  c.state.tasks = tasks;

  const a = c.allotPool(tasks, B), b = c.allotPool(tasks, B);
  assert.equal(a.avail, b.avail, 'the pool is a function of its inputs, not of call order');
  assert.deepEqual(a.acts.map(t => t.id), b.acts.map(t => t.id));
  // It must not mutate the tasks it was handed — `computeAllotted` calls it on every render.
  assert.equal(tasks[1].planned, 300, 'inputs are untouched');
});

test('allotPool: the out-param is gone — passing one changes nothing', () => {
  const c = make();
  cleanDay(c, '24:00');
  const B = c.startOfDay(Date.now());
  const tasks = [flex(c, B, 'work', 120)];
  c.state.tasks = tasks;

  // The old shape. It must be inert now, not silently half-filled: a caller still passing it would
  // otherwise read zeros and believe them.
  const cap = {};
  c.computeAllotted(tasks, B, { capacity: cap });
  assert.deepEqual(cap, {}, 'no out-param is written; dayCapacity is the way to these figures');
});
