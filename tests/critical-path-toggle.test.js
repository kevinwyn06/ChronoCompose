// Critical-path highlighting is a USER TOGGLE, DEFAULT OFF (2026-08-13b).
//
// Owner: "I don't think critical paths are going to be helpful to the average user." The Gantt bar
// already stacks five paint channels; this makes one of them opt-in.
//
// The paint is gated on TWO sources and needs BOTH:
//   1. settings.criticalPath  — owned DEFAULT_SETTINGS key, default false (the user toggle)
//   2. props.showCriticalPath — the Design prop, default true (the Design-side kill switch)
//
// The two-flag shape is deliberate and these tests exist to stop a later agent "simplifying" it back
// into one: the owner's default cannot live in the Design props JSON, because that JSON is Design-owned
// and the next Direction B pull would restore default:true. See architecture/ui-runtime.md.
//
// NOTE for future test authors: `_load.js`'s `make()` passes showCriticalPath:true, which used to be
// enough to paint. It no longer is. Any test that wants critical-path paint must OPT IN explicitly with
// `c.state.settings.criticalPath = true` (see `cpOn()` below) — do not weaken the gate to suit a test.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load');

// The explicit opt-in helper. This is the supported way for a test to ask for CP paint.
function cpOn(c){ c.state.settings.criticalPath = true; return c; }

test('the shipped default is OFF', () => {
  const c = make();
  assert.strictEqual(c.DEFAULT_SETTINGS().criticalPath, false,
    'critical-path highlighting must ship off — owner decision 2026-08-13b');
});

test('a fresh boot does not paint the critical path, even with the Design prop on', () => {
  const c = make(); // _load's make() passes showCriticalPath:true
  assert.strictEqual(c.props.showCriticalPath, true, 'precondition: the Design prop is on');
  assert.strictEqual(c.state.settings.criticalPath, false, 'precondition: the user setting is off');
  assert.strictEqual(c.cpDisplayOn(), false,
    'the Design prop alone must NOT be enough — the user setting is the second required source');
});

test('turning the user setting on restores the paint', () => {
  const c = cpOn(make());
  assert.strictEqual(c.cpDisplayOn(), true);
});

test('the Design prop stays a kill switch: prop off beats the user setting on', () => {
  const Cls = loadComponent();
  const c = new Cls({ accent: '#3b82f6', showCriticalPath: false });
  c.state.settings.criticalPath = true;
  assert.strictEqual(c.cpDisplayOn(), false,
    'an explicitly disabled Design prop must veto the user setting');
});

test('an ABSENT Design prop is treated as not-disabled, so the user setting decides', () => {
  const Cls = loadComponent();
  const off = new Cls({ accent: '#3b82f6' });
  assert.strictEqual(off.cpDisplayOn(), false, 'no prop + setting off = off');
  const on = new Cls({ accent: '#3b82f6' });
  on.state.settings.criticalPath = true;
  assert.strictEqual(on.cpDisplayOn(), true, 'no prop + setting on = on');
});

test('the full truth table of the two-source gate', () => {
  const Cls = loadComponent();
  const cases = [
    [true,  true,  true ],
    [true,  false, false],
    [false, true,  false],
    [false, false, false],
  ];
  for(const [prop, setting, want] of cases){
    const c = new Cls({ accent: '#3b82f6', showCriticalPath: prop });
    c.state.settings.criticalPath = setting;
    assert.strictEqual(c.cpDisplayOn(), want,
      `prop=${prop} setting=${setting} should be ${want}`);
  }
});

test('a persisted user opt-in survives a reload', () => {
  const c = make();
  c.saveSettings({ criticalPath: true });
  assert.strictEqual(c.loadSettings().criticalPath, true, 'the opt-in round-trips through pp-settings');
  assert.strictEqual(c.cpDisplayOn(), true);
});

test('the toggle changes only what is DRAWN — computeCPM still runs either way', () => {
  const c = make();
  const B = Date.now(), DAY = 86400000;
  const mk = (id, deps) => c.normalizeTask({ id, name: id, type: 'Proportional',
    start: B, end: B + 2 * DAY, priority: 4, deps: deps || [], pct: 0, planned: 60 });
  const A = mk('A'), Bt = mk('B', ['A']);
  const tasks = [A, Bt];

  const offRes = c.computeCPM(tasks);
  cpOn(c);
  const onRes = c.computeCPM(tasks);

  assert.deepStrictEqual(onRes.critical, offRes.critical,
    'the CP network is identical with the toggle off and on — scheduling must not depend on a display flag');
  assert.strictEqual(offRes.critical[A.id], true, 'and it really did compute a critical path while off');
});

test('Settings › General exposes the toggle and flipping it writes settings.criticalPath', () => {
  const c = make();
  c.state.settingsTab = 'general';
  const tree = c.renderSettings();
  // Collect every string in the tree and every switch, then assert the label + wiring.
  const strings = [];
  const switches = [];
  (function walk(n){
    if(n == null) return;
    if(typeof n === 'string'){ strings.push(n); return; }
    if(Array.isArray(n)){ n.forEach(walk); return; }
    if(typeof n !== 'object') return;
    if(n.props && n.props.role === 'switch') switches.push(n);
    // The mock React puts variadic children on `.children`; JSX-style ones on `props.children`.
    if(n.children !== undefined) walk(n.children);
    if(n.props && n.props.children !== undefined) walk(n.props.children);
  })(tree);

  assert.ok(strings.includes('Highlight critical path'),
    'the setting must be discoverable in Settings › General, not code-only');

  const off = switches.filter(s => s.props['aria-checked'] === false);
  assert.ok(off.length > 0, 'the toggle renders in its off state by default');

  // Find the switch whose click flips criticalPath.
  let flipped = false;
  for(const sw of switches){
    const before = c.state.settings.criticalPath;
    try{ sw.props.onClick(); }catch(e){ continue; }
    if(c.state.settings.criticalPath !== before){ flipped = true; break; }
  }
  assert.ok(flipped, 'one of the General switches writes settings.criticalPath');
  assert.strictEqual(c.state.settings.criticalPath, true, 'and it turns it ON');
  assert.strictEqual(c.cpDisplayOn(), true, 'which immediately opens the two-source gate');
});
