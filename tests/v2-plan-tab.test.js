// V2.10 — the Overview/Plan split. Selection + Matrix were promoted out of Overview's scheduling view
// toggle into a Dashboard tab of their own, which renamed the old "Plan" tab to "Overview". Two persisted
// strings changed meaning in the same release, so both migrations are pinned here: getting either wrong
// drops a returning user on a surface they never chose, silently.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load.js');

test('the Dashboard tab order is Overview · Plan · Focus · Review', () => {
  const c = make();
  assert.deepEqual(c.DASH_MODES(), ['overview', 'plan', 'focus', 'review']);
});

test('the scheduling view toggle no longer offers Selection or Matrix', () => {
  const c = make();
  const seg = c.renderViewToggle('gantt', () => {});
  const keys = seg.children[0].map(v => v.props.key);
  assert.deepEqual(keys, ['gantt', 'day4', 'week', 'month', 'schedule', 'today']);
});

test('the Plan tab offers exactly Selection and Matrix', () => {
  const c = make();
  assert.deepEqual(c.PLAN_TABS().map(v => v[0]), ['select', 'matrix']);
});

// --- dashMode migration: 'plan' means two different tabs on either side of the rename ---

test('legacy dashMode "plan" (the old scheduling board) migrates to Overview', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'plan' }), 'overview');
});

test('legacy dashMode focus/review are unaffected by the rename', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'focus' }), 'focus');
  assert.equal(c.migrateDashMode({ dashMode: 'review' }), 'review');
});

test('a V2-stamped dashMode of "plan" means the NEW Plan tab and is trusted', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'plan', dashModeV: 2 }), 'plan');
});

test('absent or unrecognised dashMode falls back to Overview', () => {
  const c = make();
  assert.equal(c.migrateDashMode({}), 'overview');
  assert.equal(c.migrateDashMode({ dashMode: 'nonsense', dashModeV: 2 }), 'overview');
});

test('choosing a tab stamps dashModeV so the next boot does not remap it', () => {
  const Cls = loadComponent();
  const props = { accent: '#3b82f6', showCriticalPath: true };
  const first = new Cls(props);
  first.setState = function (o) { Object.assign(this.state, o); };
  first.renderDashModeTabs().children[0][1].props.onClick(); // the Plan tab
  const second = new Cls(props);
  assert.equal(second.state.dashMode, 'plan', 'the new Plan tab survives a reboot as itself');
});

// --- planView migration: select/matrix are no longer scheduling views ---

test('a planView left holding select/matrix falls back to the V0.1 schedule default', () => {
  const c = make();
  assert.equal(c.migratePlanView({ planView: 'select' }), 'schedule');
  assert.equal(c.migratePlanView({ planView: 'matrix' }), 'schedule');
});

test('a real saved planView is still respected', () => {
  const c = make();
  assert.equal(c.migratePlanView({ planView: 'gantt' }), 'gantt');
  assert.equal(c.migratePlanView({}), 'schedule');
});

// --- routing ---

test('the Plan tab renders Selection or Matrix, never the sheet+Gantt split', () => {
  const c = make();
  c.state.planTab = 'select';
  assert.ok(JSON.stringify(c.renderDashPlan([])).includes('data-dropzone'), 'Selection drop zones present');
  c.state.planTab = 'matrix';
  assert.ok(JSON.stringify(c.renderDashPlan([])).includes('data-quad'), 'Matrix quadrants present');
});
