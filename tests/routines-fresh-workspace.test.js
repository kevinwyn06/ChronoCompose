// A brand-new workspace seeded only Lunch and Dinner instead of all five routines.
//
// Cause: `initRoutines` (componentDidMount) decided "new workspace" by whether the `pp-tasks` KEY existed,
// but the constructor's `recur-series-window` migration saves tasks unconditionally — so on a first boot
// the key already held `[]` and the fresh workspace took the existing-workspace migration (Lunch + Dinner
// only). "New" now means what `loadTasks` means: no stored task rows.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const ALL = ['Breakfast', 'Dinner', 'Lunch', 'Shut down', 'Wake up'];
const names = c => [...c.state.tasks.map(t => t.name).sort()];

test('routines: a fresh boot (constructor migrations already ran) seeds all five routines', () => {
  const c = make();                       // empty storage → constructor runs every once-migration
  c.initRoutines();
  assert.deepEqual(names(c), ALL);
});

test('routines: a second boot does not duplicate them', () => {
  const c = make();
  c.initRoutines();
  c.initRoutines();
  assert.deepEqual(names(c), ALL);
});

test('routines: a deleted routine stays deleted after the fresh seed', () => {
  const c = make();
  c.initRoutines();
  c.state.tasks = c.state.tasks.filter(t => t.name !== 'Breakfast');
  c.initRoutines();
  assert.equal(c.state.tasks.filter(t => t.name === 'Breakfast').length, 0);
});

test('routines: a workspace with stored tasks still gets only the Lunch/Dinner migration', () => {
  const c = make();
  c.lsSet('pp-tasks', JSON.stringify([{ id: 'u1', name: 'mine', type: 'Proportional' }]));
  c.initRoutines();
  const n = c.state.tasks.map(t => t.name);
  assert.equal(n.indexOf('Breakfast'), -1);
  assert.ok(n.indexOf('Lunch') >= 0 && n.indexOf('Dinner') >= 0);
});
