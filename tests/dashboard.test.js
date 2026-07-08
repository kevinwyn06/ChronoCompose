// Phase 11 PR1 (ROADMAP.md) — composable dashboard: the pure layout normalization + the toggle/move/resize/
// preset mutators over pp-prefs.dash. Rendering is verified headless separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

test('dashModules registry + keys are stable (7 modules)', () => {
  const c = make();
  assert.equal(c.dashModuleKeys().join(','), 'sheet,gantt,today,month,stats,habits,pomodoro');
});

test('dashNormalizeLayout: expands a preset, clamps w/h, drops unknown, appends missing as off', () => {
  const c = make();
  const norm = c.dashNormalizeLayout({ mods: [
    { k: 'gantt', w: 6, h: 400 },
    { k: 'bogus', w: 6, h: 400 },      // unknown → dropped
    { k: 'today', w: 99, h: 5 },        // w over-max → 12, h under-min → DASH_HMIN
  ]});
  // known-in-order first, then every missing module appended off
  assert.equal(norm.length, 7, 'all 7 modules present exactly once');
  const byK = {}; norm.forEach(m => byK[m.k] = m);
  assert.ok(!('bogus' in byK), 'unknown module dropped');
  assert.equal(byK.gantt.on, true);
  assert.equal(byK.today.w, 12, 'width clamped to 12');
  assert.equal(byK.today.h, c.DASH_HMIN, 'height clamped to the minimum');
  assert.equal(byK.month.on, false, 'a module absent from the stored layout is appended off');
  // first two keep their stored order
  assert.equal(norm[0].k, 'gantt');
  assert.equal(norm[1].k, 'today');
});

test('dashNormalizeLayout(null) falls back to the Plan preset (its modules on, rest off)', () => {
  const c = make();
  const norm = c.dashNormalizeLayout(null);
  const on = norm.filter(m => m.on).map(m => m.k);
  assert.equal(on.join(','), 'sheet,gantt,today,pomodoro', 'Plan preset modules are on');
});

test('dashApplyPreset stores the preset name + its layout; mutating clears the preset', () => {
  const c = make();
  c.dashApplyPreset('review');
  assert.equal(c.state.dash.preset, 'review');
  const on = c.dashLayout().filter(m => m.on).map(m => m.k);
  assert.equal(on.join(','), 'stats,habits,month');
  c.dashToggle('gantt'); // any manual edit → custom
  assert.equal(c.state.dash.preset, null, 'manual toggle clears the preset label');
  assert.equal(c.dashLayout().find(m => m.k === 'gantt').on, true, 'gantt turned on');
});

test('dashMove reorders; dashCycleW cycles 4→6→12→4; dashBumpH clamps', () => {
  const c = make();
  c.dashApplyPreset('plan'); // sheet,gantt,today,pomodoro on
  c.dashMove('gantt', -1);
  assert.equal(c.dashLayout().map(m => m.k).slice(0, 2).join(','), 'gantt,sheet', 'gantt moved before sheet');
  // width cycle
  const w0 = c.dashLayout().find(m => m.k === 'today').w; // 6 in plan
  c.dashCycleW('today');
  assert.equal(c.dashLayout().find(m => m.k === 'today').w, 12, '6 → 12');
  c.dashCycleW('today');
  assert.equal(c.dashLayout().find(m => m.k === 'today').w, 4, '12 → 4');
  // height clamp at the floor
  c.dashBumpH('today', -100000);
  assert.equal(c.dashLayout().find(m => m.k === 'today').h, c.DASH_HMIN);
  c.dashBumpH('today', 100000);
  assert.equal(c.dashLayout().find(m => m.k === 'today').h, c.DASH_HMAX);
});
