// Targets pass 1 (Plan page) — every click target on the sheet, its toolbar and column headers, the plan
// pane header and the Gantt bars is a real control, and keeps the keyboard rules.
// 1. Anything with a click handler is a native control (button, input, …) or carries a role AND a
//    tabIndex — never a bare clickable div/span. The few surfaces whose click means "empty space" or that
//    only stop propagation for a drag handle are named below, with the reason.
// 2. Decision 31: a ROW's controls are real buttons with names but are not Tab stops (tabIndex -1); the
//    row menu carries them. Toolbar, view switch and sortable column headers ARE Tab stops.
// 3. Row buttons reset their look and carry the hit-box class; the Gantt's targets are GANTT_HIT_PX tall.
// The rendered hit boxes themselves are measured in tests/e2e/plan-targets.spec.js.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const NATIVE = /^(button|a|input|select|textarea|label|summary)$/;
const ROLES = /^(button|tab|switch|checkbox|menuitem|menuitemcheckbox|menuitemradio|option|radio|link|slider|row|columnheader|gridcell)$/;

// Surfaces that take a click without being a control. Each one is here for a stated reason; anything else
// with an onClick must be a control.
const SURFACE = [
  // A section band: a plain click on its own surface is "empty space" and clears the selection; its
  // controls (caret, name, ▲ ▼ ✕) are buttons and stop propagation.
  (p) => p['data-section-id'] != null && !p.role,
  // The row's drag dot: a pointer-only drag handle (the whole row drags too). Its onClick only stops the
  // click reaching the row, so a drag never opens the detail.
  (p) => p['data-pp-drag'] === 'row',
  // The sheet body and its grid: a click on their own background clears the selection.
  (p) => p['data-pp-sheetbody'] != null || p['data-pp-sheet'] != null,
];
const isSurface = (p) => SURFACE.some((f) => f(p));

function bareClickables(tree) {
  return find(tree, (p, n) => typeof n.type === 'string' && typeof p.onClick === 'function' && !NATIVE.test(n.type)
    && !(ROLES.test(p.role || '') && p.tabIndex != null) && !isSurface(p))
    .map((n) => n.type + (n.props.role ? '[' + n.props.role + ']' : '') + ' "' + textOf(n.children).slice(0, 20) + '" title=' + n.props.title);
}

const OCT6 = new Date(2026, 9, 6).getTime();
function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.savePrefs = () => {};
  c.state.sections = [{ id: 'sStudy', name: 'Study', order: 0 }, { id: 'sWork', name: 'Work', order: 1 }, { id: 'sEmpty', name: 'Empty', order: 2 }];
  const p = activeTask(c, { id: 'p', name: 'Parent', sectionId: 'sStudy', labels: ['study'], links: [{ url: 'https://example.com', label: 'ex' }] });
  const k = activeTask(c, { id: 'k', name: 'Kid', sectionId: 'sStudy', parentId: 'p', deps: ['m'] });
  const m = activeTask(c, { id: 'm', name: 'Ship', sectionId: 'sWork', type: 'Milestone' });
  const r = activeTask(c, { id: 'r', name: 'Read', sectionId: 'sWork' });
  c.state.tasks = [p, k, m, r];
  c.renderVals();
  return c;
}

test('Plan render paths: nothing clickable is a bare div or span — it is a button, a field, or role + tabIndex', () => withNow(FIXED_NOW, () => {
  const c = setup();
  const trees = {
    sheet: c.renderSheet(c._visTasks),
    toolbar: c.renderFilterBar(c.renderLeftSurfaceToggle()),
    paneHeader: c.renderPlanPaneHeader('gantt', () => {}),
  };
  for (const [name, tree] of Object.entries(trees)) assert.deepEqual(bareClickables(tree), [], name);
  // The scan has teeth: the sheet really does contain the controls it is meant to be checking.
  const btns = find(trees.sheet, (p, n) => n.type === 'button');
  for (const t of ['Click to complete', 'Show / edit description', 'Start timer', 'Snooze', 'Edit start date', 'Collapse 1 subtask',
    'Move section up', 'Delete section', 'Click to rename', 'Collapse section', 'Remove @study', 'Predecessor']) {
    assert.ok(btns.some((b) => String(b.props.title || '').startsWith(t)), 'a <button> titled "' + t + '…"');
  }
  // …and it would catch a regression.
  assert.equal(bareClickables({ type: 'span', props: { onClick() {}, title: 'x' }, children: [] }).length, 1);
}));

test('a Gantt bar and a milestone: drag surfaces, no bare clickables, every target GANTT_HIT_PX tall', () => withNow(FIXED_NOW, () => {
  const c = setup();
  c._cpm = { critical: {} }; c._showCP = false;
  c._tl = { start: OCT6 - 10 * DAY, days: 60 }; c._vwin = { d0: 0, d1: 60 }; c.state.dayW = 42;
  const t = c.normalizeTask(Object.assign({}, c.state.tasks[3], { start: OCT6, end: OCT6 + 4 * DAY, pct: 40 }));
  const bar = c.ganttBlock(t, 0, { idx: 0, start: t.start, end: t.end });
  assert.deepEqual(bareClickables(bar), []);
  const tall = (n) => {
    const s = n.props.style;
    if (s.height != null) return parseFloat(s.height);
    return c.barH - parseFloat(s.top) - parseFloat(s.bottom);
  };
  const hit = find(bar, (p) => p['data-gantt-bar-hit'] != null)[0];
  assert.ok(hit, 'the body has a hit strip');
  assert.equal(typeof hit.props.onMouseDown, 'function', 'the strip moves the bar, as the body does');
  for (const n of [hit, ...find(bar, (p) => p['data-gantt-edge'] != null), ...find(bar, (p) => p['data-pct-grab'] != null)]) {
    assert.ok(tall(n) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'renders ≥ HIT_MIN_PX tall: ' + JSON.stringify(n.props.style));
  }
  const band = find(bar, (p) => p['data-pct-grab'] != null)[0];
  assert.ok(parseFloat(band.props.style.width) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'the %-done band renders ≥ HIT_MIN_PX wide');
  const ms = c.normalizeTask(Object.assign({}, c.state.tasks[2], { start: OCT6, end: OCT6 }));
  const dia = c.ganttBlock(ms, 0, { idx: 0, start: ms.start, end: ms.end });
  assert.deepEqual(bareClickables(dia), []);
  assert.match(String(dia.props.className), /\bpp-hba\b/, 'the diamond gets a 30px hit box');
}));

test('decision 31: row controls are buttons that are NOT Tab stops; the toolbar, view switch and sortable headers ARE', () => withNow(FIXED_NOW, () => {
  const c = setup();
  const sheet = c.renderSheet(c._visTasks);
  const rows = find(sheet, (p) => p.role === 'row' && p['data-pp-row']);
  assert.ok(rows.length >= 3);
  for (const r of rows) {
    const inner = find(r.children, (p, n) => n.type === 'button');
    assert.ok(inner.length >= 3, 'a row has its controls as buttons');
    for (const b of inner) {
      assert.equal(b.props.tabIndex, -1, 'row button is not a Tab stop: ' + b.props.title);
      assert.equal(b.props.type, 'button', 'never a submit button');
      assert.match(String(b.props.className), /\bpp-hb\b/, 'reset look + hit box: ' + b.props.title);
      assert.ok(b.props.title || b.props['aria-label'], 'named');
    }
  }
  // Section headers belong to the sheet's keyboard model too.
  for (const b of find(sheet, (p, n) => n.type === 'button' && p['data-section-caret'] != null)) assert.equal(b.props.tabIndex, -1);
  // Sortable column headers are Tab stops, and Enter sorts.
  const heads = find(sheet, (p) => p.role === 'columnheader');
  const sortable = heads.filter((h) => typeof h.props.onKeyDown === 'function');
  assert.ok(sortable.length >= 5, 'sortable headers take keys');
  for (const h of sortable) assert.equal(h.props.tabIndex, 0);
  const pri = heads.find((h) => h.props['data-colk'] === 'check');
  let prevented = false;
  pri.props.onKeyDown({ key: 'Enter', target: 1, currentTarget: 1, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented);
  assert.deepEqual(c.state.sort && c.state.sort.key, 'priority', 'Enter on the ! header sorts by priority');
  // Toolbar and view switch: every control is a Tab stop.
  for (const [name, tree] of [['toolbar', c.renderFilterBar(c.renderLeftSurfaceToggle())], ['paneHeader', c.renderPlanPaneHeader('gantt', () => {})]]) {
    const ctl = find(tree, (p, n) => typeof p.onClick === 'function' && (n.type === 'button' || ROLES.test(p.role || '')));
    assert.ok(ctl.length >= 3, name + ' has controls');
    for (const n of ctl) assert.ok(n.props.tabIndex == null || n.props.tabIndex >= 0, name + ': ' + (n.props.title || textOf(n.children)) + ' is a Tab stop');
  }
}));

test('rowBtnProps: a button that is not a Tab stop, keeps its handler, and hands focus back to its host', () => {
  const c = make();
  let clicked = 0;
  const p = c.rowBtnProps({ onClick: () => { clicked++; }, title: 'x', className: 'extra', style: { color: 'red' } });
  assert.equal(p.type, 'button');
  assert.equal(p.tabIndex, -1);
  assert.equal(p.className, 'pp-hb extra');
  assert.equal(p.style.color, 'red');
  p.onClick({ currentTarget: null });
  assert.equal(clicked, 1, 'the original handler runs');
});
