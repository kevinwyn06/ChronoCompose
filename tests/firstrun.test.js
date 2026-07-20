// V0.2 — empty state + one-time 3-step first-run + opt-in labeled demo.
// A fresh workspace boots empty (no silent seed); the "first-run seen" flag persists per workspace and
// suppresses re-showing; the demo is an explicit, labeled, clearable opt-in with fresh (non-stable) ids.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load.js');

test('fresh workspace boots empty and reports the first-run step 0 (add a task)', () => {
  const c = make();
  assert.equal(c.state.tasks.length, 0, 'no silent seed');
  assert.equal(c.activeTaskCount(), 0);
  assert.equal(c.firstRunStep(), 0, 'step 0 = add your first task');
  assert.equal(c.state.firstRunSeen, false, 'first-run not yet seen');
});

test('adding a task advances the first-run step to 1', () => {
  const c = make();
  c.setState({ quickText: 'Finish the report by Friday 2pm' });
  c.runQuickAdd('bottom');
  assert.equal(c.activeTaskCount(), 1);
  assert.equal(c.firstRunStep(), 1, 'a task now exists → drag-to-adjust becomes the live step');
});

test('markFirstRunSeen persists to pp-prefs and survives a re-boot (suppresses re-showing)', () => {
  const Cls = loadComponent();
  const props = { accent: '#3b82f6', showCriticalPath: true };
  const first = new Cls(props);
  assert.equal(first.state.firstRunSeen, false);
  first.markFirstRunSeen();
  assert.equal(first.state.firstRunSeen, true, 'reflected in state immediately');
  assert.equal(first.loadPrefs().firstRunSeen, true, 'persisted to pp-prefs');
  const second = new Cls(props); // re-boot reads the persisted flag
  assert.equal(second.state.firstRunSeen, true, 'coach stays dismissed across reload');
});

test('loadDemo adds LABELED demo tasks with fresh (non-stable) ids; clearDemo removes only them', () => {
  const c = make();
  // a real user task the demo must never touch
  c.setState({ quickText: 'My own task' });
  c.runQuickAdd('bottom');
  const mineId = c.state.tasks[0].id;

  c.loadDemo();
  assert.ok(c.hasDemoTasks(), 'demo tasks present + flagged');
  const demo = c.state.tasks.filter(t => t.demo);
  assert.ok(demo.length > 0, 'demo seed loaded');
  demo.forEach(t => assert.ok(!/^t\d+$/.test(t.id), 'demo ids are regenerated, not the stable t1..t7 (no cross-account collision)'));
  assert.equal(c.state.firstRunSeen, true, 'loading the demo also dismisses the first-run coach');

  c.clearDemo();
  assert.equal(c.hasDemoTasks(), false, 'demo cleared');
  assert.ok(c.state.tasks.some(t => t.id === mineId), 'the real user task is untouched by Clear demo');
  assert.equal(c.state.tasks.length, 1, 'only the user task remains');
});

test('normalizeTask defaults demo:false (not accidentally truthy)', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'x' });
  assert.equal(t.demo, false);
});
