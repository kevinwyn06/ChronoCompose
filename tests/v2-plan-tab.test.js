// V2.10 — the Overview/Plan split. Selection + Matrix were promoted out of Overview's scheduling view
// toggle into a Dashboard tab of their own, which renamed the old "Plan" tab to "Overview". Two persisted
// strings changed meaning in the same release, so both migrations are pinned here: getting either wrong
// drops a returning user on a surface they never chose, silently.
//
// V5 block 27a — the Plan TAB is retired. Selection and the Eisenhower matrix are surfaces of Overview's
// LEFT pane now (owner: "merged into the overview tab ... the left one"). That makes 'plan' a dead
// dashMode with TWO historical meanings, and adds a third persisted string (`leftSurface`). The migration
// tests below are re-pointed rather than deleted: the failure mode they guard — a returning user landing
// somewhere they never chose — is unchanged, only the destination moved.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load.js');

test('the Dashboard tab order is Overview · Focus · Review — Plan is gone', () => {
  const c = make();
  assert.deepEqual(c.DASH_MODES(), ['overview', 'focus', 'review']);
});

test('the scheduling view toggle no longer offers Selection or Matrix', () => {
  const c = make();
  const seg = c.renderViewToggle('gantt', () => {});
  const keys = seg.children[0].map(v => v.props.key);
  assert.deepEqual(keys, ['gantt', 'day4', 'week', 'month', 'schedule', 'today']);
});

// V5 block 32 — the Eisenhower matrix is RETIRED (owner: the quadrants never touch inclusion or
// scheduling, so the surface was a priority editor wearing a planning-tool costume). Its pure functions
// stay tested below; what is pinned here is that it is UNREACHABLE and that nobody boots into a blank pane.
test("Overview's left pane offers List and Selection only — Matrix is retired", () => {
  const c = make();
  assert.deepEqual(c.LEFT_SURFACES().map(v => v[0]), ['list', 'select']);
  assert.deepEqual(c.LEFT_SURFACE_KEYS(), ['list', 'select']);
  assert.ok(c.LEFT_SURFACE_KEYS().indexOf('matrix') < 0, 'no code path can select the matrix surface');
});

test('an owner parked ON the retired matrix lands on Selection, not on a blank pane', () => {
  const c = make();
  assert.equal(c.migrateLeftSurface({ leftSurface: 'matrix' }), 'select');
});

// --- dashMode migration: 'plan' meant two different tabs, and now means neither ---

test('legacy dashMode "plan" (the old scheduling board) migrates to Overview', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'plan' }), 'overview');
});

test('legacy dashMode focus/review are unaffected by the rename', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'focus' }), 'focus');
  assert.equal(c.migrateDashMode({ dashMode: 'review' }), 'review');
});

test('a V2-stamped dashMode of "plan" now lands on Overview too, not on a tab that no longer exists', () => {
  const c = make();
  assert.equal(c.migrateDashMode({ dashMode: 'plan', dashModeV: 2 }), 'overview');
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
  first.renderDashModeTabs().children[0][1].props.onClick(); // Focus, now the second tab
  const second = new Cls(props);
  assert.equal(second.state.dashMode, 'focus', 'the chosen tab survives a reboot as itself');
});

// --- leftSurface migration (V5 block 27a): where a Plan-tab regular lands after the rehoming ---

test('a user parked on the Plan tab reopens on the same grid, now in Overview left pane', () => {
  const c = make();
  assert.equal(c.migrateLeftSurface({ dashMode: 'plan', dashModeV: 2, planTab: 'select' }), 'select');
  // V5 block 32: the old Matrix half of that split now lands on Selection, the surviving triage grid.
  assert.equal(c.migrateLeftSurface({ dashMode: 'plan', dashModeV: 2, planTab: 'matrix' }), 'select');
});

test('everyone else opens on the task list, which is what the left pane always held', () => {
  const c = make();
  assert.equal(c.migrateLeftSurface({}), 'list');
  assert.equal(c.migrateLeftSurface({ dashMode: 'focus' }), 'list');
  // A LEGACY 'plan' meant the scheduling board — the sheet+Gantt split — not a grid.
  assert.equal(c.migrateLeftSurface({ dashMode: 'plan', planTab: 'matrix' }), 'list');
});

test('an explicit leftSurface wins over any inference, and nonsense falls back to list', () => {
  const c = make();
  assert.equal(c.migrateLeftSurface({ leftSurface: 'select', dashMode: 'plan', dashModeV: 2, planTab: 'list' }), 'select');
  assert.equal(c.migrateLeftSurface({ leftSurface: 'nonsense' }), 'list');
});

test('the migrated surface reaches state on boot', () => {
  const Cls = loadComponent();
  const c = new Cls({ accent: '#3b82f6', showCriticalPath: true });
  assert.equal(c.state.leftSurface, 'list');
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

// --- routing: the surfaces still render, now from Overview's left pane ---

test("Overview's left pane renders Selection, and keeps the right pane", () => {
  const c = make();
  c.state.leftSurface = 'select';
  const sel = JSON.stringify(c.renderDashOverview([]));
  assert.ok(sel.includes('data-dropzone'), 'Selection drop zones present');
  assert.ok(sel.includes('data-left-surface'), 'left pane stamped with its surface');
});

// V5 block 32: the renderer is KEPT, just unreachable. Calling it directly must still work, so that
// re-adding 'matrix' to the two surface lists is genuinely the whole job.
test('the retired matrix renderer still builds its quadrants when called directly', () => {
  const c = make();
  assert.ok(JSON.stringify(c.renderMatrixView([])).includes('data-quad'), 'Matrix quadrants still build');
});

// --- the left pane's width floor, re-derived (block 26 gave it one; 27a must not drop it) ---

test('the list surface no longer forces block 26 sheet floor after the draggable divider redesign', () => {
  const c = make();
  assert.equal(c.leftPaneMinWidth('list', 0), '0px');
  assert.equal(c.leftPaneMaxWidth('list'), c.sheetMinWidthPx() + 'px',
    'the sheet may compress but cannot grow into blank space past its last visible column');
});

test('a triage surface gets a floor of its own, per rendered column', () => {
  const c = make();
  const three = c.leftPaneMinWidth('select', 3);
  const four = c.leftPaneMinWidth('select', 4);
  assert.equal(three, 'min(' + (3 * c.TRIAGE_COL_MIN_PX + c.SHEET_COL_PAD_PX) + 'px, 55%)');
  // A column added must widen the floor, or the extra column is simply crushed.
  assert.ok(c.triageMinWidthPx(4) > c.triageMinWidthPx(3));
  assert.ok(four !== three);
  // Never zero: the floor is what block 26 said must not be deleted.
  assert.ok(c.triageMinWidthPx(0) >= c.TRIAGE_COL_MIN_PX);
});

test('the matrix is always two columns wide, whatever is passed', () => {
  const c = make();
  assert.equal(c.leftPaneMinWidth('matrix', 4), c.leftPaneMinWidth('matrix', 1));
  assert.equal(c.leftPaneMinWidth('matrix', 0), 'min(' + c.triageMinWidthPx(2) + 'px, 55%)');
});

test('the width floor and the renderer agree on which columns exist', () => {
  const c = make();
  // selectionCols is the ONE rule; a second copy in the floor is the drift being prevented.
  const p = c.selectionProjection([]);
  assert.deepEqual(c.selectionCols(p), ['existing', 'new']);
  const sel = c.renderSelectionView([]);
  const grid = sel.children.find(x => x && x.props && x.props.key === 'grid');
  assert.equal(grid.children[0].length, c.selectionCols(p).length);
});

// --- split width: a triage grid and a four-column sheet want different amounts of the board ---

test('switching to a triage surface swaps to the triage split key, and back again', () => {
  const c = make();
  c.state.mainView = 'dashboard'; c.state.dashMode = 'overview';
  c.state.leftSurface = 'list'; c.state.planView = 'gantt';
  assert.equal(c.leftSplitKey(), 'cal');
  c.state.leftSurface = 'select';
  assert.equal(c.leftSplitKey(), 'triage');
  c.state.leftSurface = 'list';
  assert.equal(c.leftSplitKey(), 'cal');
});

test('the triage default sits inside the splitter clamp the user could drag to', () => {
  const c = make();
  const d = c.splitDefault('triage');
  assert.ok(d >= 28 && d <= 78, 'within the 28–78 clamp in onMouseMove');
  assert.ok(d <= c.splitDefault('cal'), 'the sheet now opens to its content edge; its px cap prevents whitespace');
});

test('setLeftSurface banks the width it leaves and restores the one it enters', () => {
  const c = make();
  const saved = [];
  c.savePrefs = (o) => saved.push(o);
  c.setState = function (o) { Object.assign(this.state, o); };
  c.state.mainView = 'dashboard'; c.state.dashMode = 'overview'; c.state.planView = 'gantt';
  c.state.leftSurface = 'list';
  c.state.splitPct = 41;
  c.state.viewSplit = { triage: 70 };

  c.setLeftSurface('select');
  assert.equal(c.state.splitPct, 70, 'the triage width is restored');
  assert.equal(c.state.viewSplit.cal, 41, 'and the sheet width was banked, not lost');

  c.state.splitPct = 66; // as if the user dragged the splitter while on the grid
  c.setLeftSurface('list');
  assert.equal(c.state.splitPct, 41, 'the sheet comes back to exactly where it was');
  assert.equal(c.state.viewSplit.triage, 66, 'and the grid kept the width it was dragged to');
  assert.ok(saved.some(o => o.viewSplit), 'the banked widths persist');
});

// V5 block 32: the "switching between the two triage surfaces keeps the width" test is DELETED, not
// skipped — with Matrix retired there is only one triage surface, so the round trip it guarded (banking
// and restoring across `list` ↔ `select`) is already covered by the setLeftSurface test above.

test('the left pane still renders the task sheet on the list surface', () => {
  const c = make();
  c.state.leftSurface = 'list';
  const out = JSON.stringify(c.renderDashOverview([]));
  assert.ok(!out.includes('data-dropzone'), 'no triage drop zones on the list surface');
  assert.ok(!out.includes('data-quad'), 'no matrix quadrants on the list surface');
});
