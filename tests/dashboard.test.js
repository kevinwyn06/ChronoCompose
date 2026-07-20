// V0.1 — first-run landing view. A workspace with no saved pp-prefs.mainView must land on the
// Dashboard (Dash) with its Plan tab leading on the Schedule timeline (the auto-scheduling moat),
// NOT raw Gantt. A returning user's saved choice must still win.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load.js');

test('first-run (no pp-prefs) lands on Dashboard, Plan tab leads with Schedule', () => {
  const c = make(); // fresh sandbox → empty pp-prefs
  assert.equal(c.state.mainView, 'dashboard', 'first-run main view is the Dash, not raw gantt');
  assert.equal(c.state.planView, 'schedule', 'first-run Plan sub-view leads with the schedule timeline');
});

test("a returning user's saved mainView/planView wins over the first-run default", () => {
  const Cls = loadComponent();
  const props = { accent: '#3b82f6', showCriticalPath: true };
  const first = new Cls(props);        // both instances share this sandbox's localStorage
  first.savePrefs({ mainView: 'week', planView: 'gantt' });
  const second = new Cls(props);       // re-boot reads the persisted prefs
  assert.equal(second.state.mainView, 'week', 'saved mainView is respected');
  assert.equal(second.state.planView, 'gantt', 'saved planView is respected');
});
