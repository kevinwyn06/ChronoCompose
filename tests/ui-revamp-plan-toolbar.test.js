// UI revamp block 2 — the Plan toolbar split.
// The plan-view switch lives in the RIGHT pane's header strip (labels Day/Agenda, keys unchanged); the
// sheet keeps a compact toolbar (search · Filter ▾ · List|Selection · + Section); Horizon, the chips and
// the archive link live in the Filter popover, whose button counts the active filters; below 1440px the
// plan pane opens with at least 55% of the board.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props)) out.push(n);
  find(n.children, pred, out);
  return out;
};

test('the plan views read Gantt · Day · 4-Day · Week · Month · Agenda over unchanged keys', () => {
  const c = make();
  assert.deepEqual(c.PLAN_VIEWS(), [['gantt', 'Gantt'], ['today', 'Day'], ['day4', '4-Day'],
    ['week', 'Week'], ['month', 'Month'], ['schedule', 'Agenda']]);
  const tabs = find(c.renderViewToggle('schedule', () => {}), (p) => p.role === 'tab');
  assert.deepEqual(tabs.map((t) => textOf(t)), ['Gantt', 'Day', '4-Day', 'Week', 'Month', 'Agenda']);
  assert.deepEqual(tabs.filter((t) => t.props['aria-selected']).map((t) => t.props['data-view-key']), ['schedule']);
  for (const t of tabs) assert.equal(t.props.tabIndex, 0, 'every view tab is keyboard-reachable');
});

test('the top-bar slot no longer renders the view switch — it lives in the pane header', () => {
  const c = make();
  for (const v of ['gantt', 'today', 'dashboard']) { c.state.mainView = v; assert.equal(c.renderViewToggle(), null, v); }
});

test('switching from the pane header keeps the view.switch telemetry', () => {
  const c = make();
  const seen = [];
  c.trackAction = (name, data) => seen.push([name, data]);
  c.setState = function (o) { Object.assign(this.state, typeof o === 'function' ? o(this.state) : o); };
  c.savePrefs = () => {};
  c.state.planView = 'gantt';
  const head = c.renderPlanPaneHeader('gantt', (v) => c.setPlanView(v));
  const day = find(head, (p) => p['data-view-key'] === 'today')[0];
  day.props.onClick();
  assert.equal(c.state.planView, 'today');
  assert.deepEqual(seen.find((x) => x[0] === 'view.switch'), ['view.switch', { from: 'gantt', to: 'today', pane: 'overview' }]);
});

test('every plan view gets the same header; steppers and zoom only where the view supports them', () => {
  const c = make();
  const has = (view, attr) => find(c.renderPlanPaneHeader(view, () => {}), (p) => p[attr] != null).length > 0;
  for (const v of ['gantt', 'today', 'day4', 'week', 'month', 'schedule']) {
    const head = c.renderPlanPaneHeader(v, () => {});
    assert.equal(head.props['data-pp-planhead'], v);
    assert.equal(head.props.style.height, c.PLAN_STRIP_H + 'px', 'one height for every view');
    assert.ok(has(v, 'data-pp-today'), v + ' has a Today button');
    assert.ok(has(v, 'data-pp-viewswitch'), v + ' carries the view switch');
  }
  for (const v of ['gantt', 'week', 'month']) assert.ok(has(v, 'data-pp-step'), v + ' has ‹ ›');
  for (const v of ['today', 'day4', 'schedule']) assert.ok(!has(v, 'data-pp-step'), v + ' has no steppers');
  assert.ok(has('gantt', 'data-pp-zoom'), 'the Gantt has − / +');
  for (const v of ['today', 'week', 'month']) assert.ok(!has(v, 'data-pp-zoom'), v + ' has no zoom');
  for (const v of ['today', 'day4', 'week']) assert.ok(has(v, 'data-pp-pack'), v + ' keeps its pack toggle');
});

test('the period label and the Today state follow the anchors', () => {
  const c = make();
  c.state.weekAnchor = null; c.state.monthAnchor = null;
  assert.equal(c.planPaneMeta('week').atToday, true);
  assert.match(c.planPaneMeta('week').label, /^[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+$/);
  c.setState = function (o) { Object.assign(this.state, o); };
  c.planPaneStep('week', 1);
  assert.equal(c.planPaneMeta('week').atToday, false, 'stepping away enables Today');
  c.planPaneToday('week');
  assert.equal(c.state.weekAnchor, null, 'Today returns the week to now');
  c.planPaneStep('month', -1);
  assert.notEqual(c.state.monthAnchor, null);
  c.planPaneToday('month');
  assert.equal(c.state.monthAnchor, null);
});

test('Gantt − / + reuse zoomStep and stay inside the zoom bounds', () => {
  const c = make();
  c.setState = function (o) { Object.assign(this.state, o); };
  c.state.dayW = 42;
  c.ganttZoomBy(1);
  assert.ok(c.state.dayW > 42, 'zoom in widens a day');
  let w = 42; for (let i = 0; i < c.GANTT_ZOOM_BTN_STEPS; i++) w = c.zoomStep(w, -1000);
  assert.equal(c.state.dayW, w, 'the button is exactly GANTT_ZOOM_BTN_STEPS wheel steps');
  c.state.dayW = c.GANTT_DAYW_MIN;
  c.ganttZoomBy(-1);
  assert.equal(c.state.dayW, c.GANTT_DAYW_MIN, 'clamped at the minimum');
});

test('activeFilterCount counts each hidden filter once, and never sort or search', () => {
  const c = make();
  assert.equal(c.activeFilterCount({}), 0);
  assert.equal(c.activeFilterCount({ horizon: '1w' }), 1);
  assert.equal(c.activeFilterCount({ inclOnly: true }), 1);
  assert.equal(c.activeFilterCount({ chips: ['unplanned'] }), 1);
  assert.equal(c.activeFilterCount({ colFilters: { priority: { set: [1] }, name: { contains: 'x' }, start: {} } }), 2,
    'an empty column spec is not a filter');
  assert.equal(c.activeFilterCount({ horizon: '3m', inclOnly: true, chips: ['unplanned'], colFilters: { priority: { set: [1] } } }), 4);
  assert.equal(c.activeFilterCount({ sort: { key: 'name', dir: 'asc' }, searchQuery: 'x' }), 0);
});

test('the sheet toolbar keeps search, Filter, List|Selection and + Section; the chips moved to the popover', () => {
  const c = make();
  const bar = c.renderFilterBar(c.renderLeftSurfaceToggle());
  assert.equal(bar.props['data-pp-filterbar'], '1');
  assert.ok(find(bar, (p) => p['data-pp-search']).length === 1);
  assert.ok(find(bar, (p) => p['data-pp-filterbtn']).length === 1);
  assert.ok(find(bar, (p) => p['data-surface-btn']).length === 2);
  assert.ok(find(bar, (p) => p['data-pp-chip'] === 'addsec').length === 1);
  assert.equal(find(bar, (p) => p['data-pp-seg'] === 'horizon').length, 0, 'Horizon is not in the bar');
  assert.equal(find(bar, (p) => p['data-pp-chip'] === 'incl').length, 0, 'Included is not in the bar');
  assert.equal(find(bar, (p) => p['data-view-key']).length, 0, 'the view switch left the bar');
  assert.equal(c.renderFilterPopover(), null, 'closed by default');

  c.state.filterPop = true;
  const pop = c.renderFilterPopover();
  assert.equal(find(pop, (p) => p['data-pp-seg'] === 'horizon').length, 1);
  assert.equal(find(pop, (p) => p['data-seg-key']).length, 6);
  assert.equal(find(pop, (p) => p['data-pp-chip'] === 'sc-unplanned').length, 1);
  assert.equal(find(pop, (p) => p['data-pp-chip'] === 'incl').length, 1);
  assert.equal(find(pop, (p) => p['data-pp-archived-link']).length, 1);
});

test('the Filter badge shows the active count, and is absent when nothing filters', () => {
  const c = make();
  const badge = () => find(c.renderFilterBar(), (p) => p['data-pp-filtercount'] != null)[0];
  assert.equal(badge(), undefined);
  c.state.horizon = '1w'; c.state.inclOnly = true;
  assert.equal(badge().props['data-pp-filtercount'], '2');
});

test('the archive link opens the archive through setView', () => {
  const c = make();
  c.setState = function (o) { Object.assign(this.state, o); };
  c.savePrefs = () => {};
  c.state.filterPop = true;
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'Old', archivedAt: 1 }), c.normalizeTask({ id: 'b', name: 'Live' })];
  const link = find(c.renderFilterPopover(), (p) => p['data-pp-archived-link'])[0];
  assert.equal(textOf(link), 'Archived tasks (1)');
  link.props.onClick();
  assert.equal(c.state.mainView, 'archive');
  assert.equal(c.state.filterPop, false, 'the popover closes on the way out');
});

test('live search writes only the query, never trims the draft, and ends on empty text', () => {
  const c = make();
  c.setState = function (o) { Object.assign(this.state, o); };
  c.state.searchText = 'report ';
  c.applyLiveSearch('report ');
  assert.equal(c.state.searchQuery, 'report');
  assert.equal(c.state.searchText, 'report ', 'the trailing space the user is typing survives');
  c.applyLiveSearch('   ');
  assert.equal(c.state.searchQuery, null);
});

test('below 1440px the plan pane defaults to at least 55%; wide and unknown viewports keep the old default', () => {
  const c = make();
  assert.equal(c.splitDefault('cal', 1280), c.NARROW_SHEET_PCT);
  assert.ok(100 - c.splitDefault('agenda', 1024) >= 55);
  assert.equal(c.splitDefault('cal', 1600), c.PANE_MAX_FRAC);
  assert.equal(c.splitDefault('cal'), c.PANE_MAX_FRAC, 'no window → wide');
  assert.equal(c.splitDefault('triage', 1024), 62, 'triage keeps its own default');
});

test('a saved width always wins over the narrow default, and double-click reset forgets it', () => {
  const c = make();
  c.setState = function (o) { Object.assign(this.state, o); };
  const saved = [];
  c.savePrefs = (o) => saved.push(o);
  c.state.viewSplit = { cal: 61 };
  c.splitDefault = (key) => (key === 'triage' ? 62 : c.NARROW_SHEET_PCT); // as if the window were narrow
  c.setView('gantt');
  assert.equal(c.state.splitPct, 61, 'the dragged width is restored, not the narrow default');
  c.resetSplit();
  assert.equal(c.state.splitPct, c.NARROW_SHEET_PCT);
  assert.equal(c.state.viewSplit.cal, undefined);
  assert.ok(saved.some((o) => o.viewSplit && o.viewSplit.cal === undefined), 'the reset persists');
});

test('the divider is one shared control with a reset gesture and a limit cue', () => {
  const c = make();
  const d = c.renderPaneDivider('sheet');
  assert.equal(d.props['data-pane-divider'], 'sheet');
  assert.equal(d.props.className, 'pp-divider');
  assert.equal(typeof d.props.onDoubleClick, 'function');
  assert.equal(d.props['data-at-limit'], null);
  c.state.splitAtLimit = true;
  assert.equal(c.renderPaneDivider('sheet').props['data-at-limit'], '1');
});
