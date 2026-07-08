// Phase 11 (ROADMAP.md) — composable dashboard: the pure layout model (normalize + shelf-pack + vertical
// compaction/de-overlap) and the toggle/resize/preset/place mutators over pp-prefs.dash. Rendering + the
// pointer-drag wiring are verified headless separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

function assertValid(layout) {
  const on = layout.filter(m => m.on);
  for (const m of on) {
    assert.ok(m.x >= 0 && m.x + m.w <= 12, `${m.k} fits in 12 cols (x=${m.x} w=${m.w})`);
    assert.ok(m.y >= 0 && m.hr >= 2, `${m.k} has a valid row origin/height`);
  }
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const a = on[i], b = on[j];
    const xo = a.x < b.x + b.w && b.x < a.x + a.w;
    const yo = a.y < b.y + b.hr && b.y < a.y + a.hr;
    assert.ok(!(xo && yo), `${a.k} overlaps ${b.k}`);
  }
}

test('dashModules registry + keys are stable (7 modules)', () => {
  const c = make();
  assert.equal(c.dashModuleKeys().join(','), 'sheet,gantt,today,month,stats,habits,pomodoro');
});

test('dashNormalizeLayout: expands a preset, migrates px h→hr, clamps, drops unknown, appends missing off', () => {
  const c = make();
  const norm = c.dashNormalizeLayout({ mods: [
    { k: 'gantt', w: 6, h: 480 },      // legacy px height → hr = 480/80 = 6
    { k: 'bogus', w: 6, hr: 4 },        // unknown → dropped
    { k: 'today', w: 99, hr: 99 },      // w→12, hr→DASH_HRMAX
  ]});
  assert.equal(norm.length, 7, 'all 7 modules present exactly once');
  const byK = {}; norm.forEach(m => byK[m.k] = m);
  assert.ok(!('bogus' in byK), 'unknown dropped');
  assert.equal(byK.gantt.hr, 6, 'px h migrated to hr');
  assert.equal(byK.today.w, 12, 'width clamped to 12');
  assert.equal(byK.today.hr, c.DASH_HRMAX, 'hr clamped to max');
  assert.equal(byK.month.on, false, 'a module absent from the stored layout is appended off');
  assertValid(norm); // positions were seeded + de-overlapped
});

test('dashNormalizeLayout(null) falls back to Plan and seeds a valid, non-overlapping layout', () => {
  const c = make();
  const norm = c.dashNormalizeLayout(null);
  const on = norm.filter(m => m.on).map(m => m.k);
  assert.equal(on.join(','), 'sheet,gantt,today,pomodoro', 'Plan preset modules are on');
  norm.filter(m => m.on).forEach(m => { assert.ok(m.x != null && m.y != null, `${m.k} has a seeded position`); });
  assertValid(norm);
});

test('dashResolve compacts overlapping tiles upward and removes overlap', () => {
  const c = make();
  // three full-width tiles all declared at (0,0) → must stack without overlap
  const mods = [
    { k: 'sheet', on: true, x: 0, y: 0, w: 12, hr: 3 },
    { k: 'gantt', on: true, x: 0, y: 0, w: 12, hr: 3 },
    { k: 'stats', on: true, x: 0, y: 0, w: 12, hr: 3 },
  ];
  const r = c.dashResolve(mods);
  assertValid(r);
  const ys = r.map(m => m.y).sort((a, b) => a - b);
  assert.deepEqual(ys, [0, 3, 6], 'stacked at rows 0/3/6 (no gaps, no overlap)');
});

test('dragKey honours the dropped row so a dragged tile can land above another', () => {
  const c = make();
  const mods = [
    { k: 'sheet', on: true, x: 0, y: 0, w: 12, hr: 3 },
    { k: 'gantt', on: true, x: 0, y: 3, w: 12, hr: 3 },
  ];
  // drag gantt up to row 1; as the dragged tile it keeps that row and sheet flows below it
  const dragged = mods.map(m => m.k === 'gantt' ? Object.assign({}, m, { y: 1 }) : m);
  const r = c.dashResolve(dragged, 'gantt');
  const byK = {}; r.forEach(m => byK[m.k] = m);
  assert.equal(byK.gantt.y, 1, 'dragged gantt stays at its dropped row');
  assert.ok(byK.sheet.y >= 4, 'sheet is pushed below the dragged gantt');
  assertValid(r);
  // without a dragKey, everything compacts to the top (no gap)
  const compact = c.dashResolve(dragged);
  assert.deepEqual(compact.map(m => m.y).sort((a, b) => a - b), [0, 3], 'structural resolve compacts to 0/3');
});

test('dashApplyPreset stores the name; any mutation clears it and stays valid', () => {
  const c = make();
  c.dashApplyPreset('review');
  assert.equal(c.state.dash.preset, 'review');
  assert.equal(c.dashLayout().filter(m => m.on).map(m => m.k).join(','), 'stats,habits,month');
  assertValid(c.dashLayout());
  c.dashToggle('gantt');
  assert.equal(c.state.dash.preset, null, 'manual toggle clears the preset label');
  assert.equal(c.dashLayout().find(m => m.k === 'gantt').on, true);
  assertValid(c.dashLayout());
});

test('dashCycleW cycles 4→6→12→4; dashBumpHr clamps; both keep the layout valid', () => {
  const c = make();
  c.dashApplyPreset('plan');
  assert.equal(c.dashLayout().find(m => m.k === 'today').w, 6);
  c.dashCycleW('today');
  assert.equal(c.dashLayout().find(m => m.k === 'today').w, 12, '6 → 12');
  c.dashCycleW('today');
  assert.equal(c.dashLayout().find(m => m.k === 'today').w, 4, '12 → 4');
  assertValid(c.dashLayout());
  c.dashBumpHr('today', -100);
  assert.equal(c.dashLayout().find(m => m.k === 'today').hr, c.DASH_HRMIN);
  c.dashBumpHr('today', 100);
  assert.equal(c.dashLayout().find(m => m.k === 'today').hr, c.DASH_HRMAX);
});

test('dashPlace (drag/resize commit) applies position+size then compacts to a valid layout', () => {
  const c = make();
  c.dashApplyPreset('plan'); // sheet(0,0) gantt(6,0) today(0,6) pomodoro(6,6)
  c.dashPlace('pomodoro', 0, 0, 12, 3); // widen pomodoro to full width + drop it at the very top
  const p = c.dashLayout().find(m => m.k === 'pomodoro');
  assert.equal(p.w, 12, 'resize applied');
  assert.equal(p.hr, 3, 'height applied');
  // as the dragged tile it honours row 0; the others reflow below it
  assert.equal(p.y, 0);
  assertValid(c.dashLayout());
});

test('dashToggle off then on re-adds the module at the bottom without overlap', () => {
  const c = make();
  c.dashApplyPreset('plan');
  c.dashToggle('sheet'); // off
  assert.equal(c.dashLayout().find(m => m.k === 'sheet').on, false);
  assertValid(c.dashLayout());
  c.dashToggle('sheet'); // back on
  assert.equal(c.dashLayout().find(m => m.k === 'sheet').on, true);
  assertValid(c.dashLayout());
});
