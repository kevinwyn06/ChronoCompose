// Targets pass 2 — everything except the Plan sheet and Gantt (tests/plan-targets.test.js has those).
// 1. In the timeline views, Focus, Review/Habits, Journal, Archive, Settings, the filter popover and the
//    detail dialog, anything with a click handler is a native control or carries a role AND a tabIndex.
// 2. Where a list has no row selection (Focus's task list, the archive, the habit strip, the Journal's
//    lists) its primary control is a Tab stop; a timeline block is the stop for its own small controls.
// 3. Section headers on the Plan sheet join the arrow-key walk, and their actions are reachable by keys.
// Rendered hit boxes are measured in tests/e2e/app-targets.spec.js.
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

// Surfaces that take a click without being a control, each for a stated reason.
const SURFACE = [
  // A Focus task row: a click on its own surface opens the task, as a convenience; the row's name is the
  // button that does the same from the keyboard.
  (p) => p['data-focus-row'] != null,
  // Overlay scrims and menu cards: they only stop or close on an outside press.
  (p) => p.style && p.style.position === 'fixed' && (p.style.inset === 0 || p.style.inset === '0'),
  (p) => p.role === 'menu' || p.role === 'dialog',
  // A rich-text editor is a text field (contentEditable), focusable on its own.
  (p) => p.contentEditable === true || p.contentEditable === 'true',
];
const isSurface = (p) => SURFACE.some((f) => f(p));
function bareClickables(tree) {
  return find(tree, (p, n) => typeof n.type === 'string' && typeof p.onClick === 'function' && !NATIVE.test(n.type)
    && !(ROLES.test(p.role || '') && p.tabIndex != null) && !isSurface(p))
    .map((n) => n.type + (n.props.role ? '[' + n.props.role + ']' : '') + ' "' + textOf(n.children).slice(0, 24) + '" title=' + n.props.title);
}

const OCT6 = new Date(2026, 9, 6).getTime();
function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.savePrefs = () => {};
  c.state.sections = [{ id: 'sStudy', name: 'Study', order: 0 }, { id: 'sWork', name: 'Work', order: 1 }, { id: 'sEmpty', name: 'Empty', order: 2 }];
  const a = activeTask(c, { id: 'a', name: 'Alpha', sectionId: 'sStudy', planned: 120 });
  const b = activeTask(c, { id: 'b', name: 'Beta', sectionId: 'sStudy', planned: 60 });
  const w = activeTask(c, { id: 'w', name: 'Wrap up', sectionId: 'sWork', planned: 45 });
  const z = activeTask(c, { id: 'z', name: 'Old chore', sectionId: 'sWork', archivedAt: FIXED_NOW - 2 * DAY, completion: FIXED_NOW - 3 * DAY, pct: 100 });
  c.state.tasks = [a, b, w, z];
  c.state.habits = [c.normalizeHabit({ id: 'h1', name: 'Stretch', createdAt: FIXED_NOW - 20 * DAY }),
    c.normalizeHabit({ id: 'h2', name: 'Run', schedule: { kind: 'weekdays', days: [1, 3, 5] }, taskIds: ['a'], createdAt: FIXED_NOW - 20 * DAY })];
  c.renderVals();
  return c;
}

test('every surface outside the Plan sheet: nothing clickable is a bare div or span', () => withNow(FIXED_NOW, () => {
  const c = setup();
  const B = c.startOfToday();
  const trees = {
    dayColumn: c.renderDayColumn(B, { showLabels: true }),
    agenda: c.renderScheduleView(),
    month: c.renderMonthView(),
    focus: c.renderDashFocus(c.state.tasks),
    habits: c.renderHabitsView(),
    journal: c.renderJournalView(),
    archive: c.renderArchiveView(),
    topNav: c.renderTopNav(),
  };
  for (const tab of ['general', 'scheduling', 'notifications', 'integrations', 'data']) {
    c.state.settingsTab = tab; trees['settings:' + tab] = c.renderSettings();
  }
  c.state.settingsTab = 'general';
  c.state.filterPop = true; trees.filterPopover = c.renderFilterPopover(); c.state.filterPop = false;
  for (const [name, tree] of Object.entries(trees)) assert.deepEqual(bareClickables(tree), [], name);
  // The scan has teeth.
  const btns = find(trees.focus, (p, n) => n.type === 'button');
  for (const t of ['Mark complete', 'Start timer']) assert.ok(btns.some((b) => b.props.title === t), 'Focus: a <button> titled ' + t);
  assert.ok(find(trees.dayColumn, (p) => p['data-tl-block'] && p.role === 'button').length > 0, 'the day column has blocks to check');
}));

test('Tab stops: a list with no row selection makes its primary control a Tab stop; a block owns its small controls', () => withNow(FIXED_NOW, () => {
  const c = setup();
  const B = c.startOfToday();
  // Focus: circle, name and ▶ are buttons and Tab stops.
  const focus = c.renderDashFocus(c.state.tasks);
  const row = find(focus, (p) => p['data-focus-row'] === 'a')[0];
  assert.ok(row, 'Alpha is on the Focus list');
  for (const sel of ['data-focus-done', 'data-focus-open', 'data-focus-timer']) {
    const b = find(row, (p) => p[sel] != null)[0];
    assert.ok(b && b.type === 'button', sel + ' is a button');
    assert.ok(b.props.tabIndex == null || b.props.tabIndex >= 0, sel + ' is a Tab stop');
  }
  // Timeline: a task block is a roving stop (tlRovingFix names the one per view in the DOM), so it renders
  // at -1 with its day and start for the arrow walk; Enter opens it; its ▶ is a button that is never a stop.
  const col = c.renderDayColumn(B, { showLabels: true });
  const blk = find(col, (p) => p['data-tl-block'] && p.role === 'button')[0];
  assert.equal(blk.props.tabIndex, -1);
  assert.equal(blk.props['data-tl-nav-day'], String(B));
  assert.ok(Number(blk.props['data-tl-nav']) >= B, 'carries its start');
  let opened = null; c.openDetail = (id) => { opened = id; };
  blk.props.onKeyDown({ key: 'Enter', target: 1, currentTarget: 1, preventDefault() {}, stopPropagation() {} });
  assert.equal(opened, blk.props['data-tl-task'], 'Enter on a block opens its task');
  for (const b of find(blk, (p, n) => n.type === 'button')) {
    assert.equal(b.props.tabIndex, -1, 'a block control is not a Tab stop: ' + b.props.title);
    assert.match(String(b.props.className), /\bpp-hb\b/, 'and carries the hit box');
  }
  // Habits: the strip is ONE Tab stop (the latest scheduled day); the rest are -1.
  const hv = c.renderHabitsView();
  const cells = find(hv, (p) => p['data-habit-day'] != null && p['data-habit-cell'] != null);
  assert.ok(cells.length >= 14, 'scheduled days are buttons');
  const h1 = cells.slice(0, 14);
  assert.equal(h1.filter((b) => b.props.tabIndex === 0).length, 1, 'one Tab stop per strip');
  assert.equal(h1.find((b) => b.props.tabIndex === 0).props['data-habit-day'], '0', 'today, when today is scheduled');
  // Archive: the task name is a button and a Tab stop.
  const arch = find(c.renderArchiveView(), (p) => p['data-archive-open'] === 'z')[0];
  assert.ok(arch && arch.type === 'button' && arch.props.tabIndex == null);
}));

test('HIT_BOX_PX: the local size that renders at HIT_MIN_PX under the shell zoom', () => {
  const c = make();
  assert.ok(c.HIT_BOX_PX * c.SHELL_ZOOM >= c.HIT_MIN_PX);
  assert.ok((c.HIT_BOX_PX - 1) * c.SHELL_ZOOM < c.HIT_MIN_PX, 'and no larger than it needs to be');
});

// ---- section headers in the sheet's keyboard model ----
const ev = (o) => Object.assign({ preventDefault() {}, stopPropagation() {}, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, o);
const rowT = (id) => ({ hasAttribute: (a) => a === 'data-pp-row', getAttribute: () => id, tagName: 'DIV', matches: () => true, isContentEditable: false, closest: () => null });
const secT = (key) => ({ hasAttribute: (a) => a === 'data-pp-sechead', getAttribute: () => key, tagName: 'DIV', matches: () => true, isContentEditable: false, closest: () => null });
const keyOn = (target, k, over) => ev(Object.assign({ key: k, target }, over || {}));

test('sheetNavNext walks headers and rows in screen order and stops at the ends', () => {
  const c = make();
  const st = [{ k: 'sec', key: 's1' }, { k: 'row', id: 'a' }, { k: 'sec', key: 's2' }, { k: 'row', id: 'b' }];
  assert.deepEqual(c.sheetNavNext(st, { k: 'row', id: 'a' }, 'ArrowUp'), { k: 'sec', key: 's1' });
  assert.deepEqual(c.sheetNavNext(st, { k: 'row', id: 'a' }, 'ArrowDown'), { k: 'sec', key: 's2' });
  assert.deepEqual(c.sheetNavNext(st, { k: 'sec', key: 's2' }, 'ArrowDown'), { k: 'row', id: 'b' });
  assert.equal(c.sheetNavNext(st, { k: 'sec', key: 's1' }, 'ArrowUp'), null, 'the top is the top');
  assert.deepEqual(c.sheetNavNext(st, { k: 'sec', key: 's2' }, 'Home'), { k: 'sec', key: 's1' });
});

test('section headers: ↑ from a first row lands on its header; Enter collapses, F2 renames, Alt+↓ moves, Delete deletes, Shift+F10 opens its menu', () => withNow(FIXED_NOW, () => {
  const c = setup();
  c.renderSheet(c._visTasks);
  // The header is a row in the walk, with a name and its state.
  const head = find(c.renderSheet(c._visTasks), (p) => p['data-pp-sechead'] === 'sStudy')[0];
  assert.equal(head.props.role, 'row');
  assert.equal(head.props.tabIndex, -1, 'not a Tab stop until the cursor is on it');
  assert.match(head.props['aria-label'], /^Study section, 2 tasks/);
  assert.equal(head.props['aria-expanded'], 'true');
  // ↑ from the section's first row.
  const first = c._visSections.find((s) => s.id === 'sStudy').tasks[0].id;
  c.setState({ selectedIds: [first] });
  c.onKey(keyOn(rowT(first), 'ArrowUp'));
  assert.equal(c._secFocusKey, 'sStudy', 'the cursor is on the Study header');
  assert.deepEqual(c.state.selectedIds, [], 'and the row selection is cleared, so Delete can only mean the section');
  c.renderSheet(c._visTasks);
  const head2 = find(c.renderSheet(c._visTasks), (p) => p['data-pp-sechead'] === 'sStudy')[0];
  assert.equal(head2.props.tabIndex, 0, 'it is now the sheet\'s one Tab stop');
  assert.equal(find(c.renderSheet(c._visTasks), (p) => p['data-pp-row'] === '1' && p.tabIndex === 0).length, 0, 'no row competes for it');
  // ↓ goes back into the section.
  c.onKey(keyOn(secT('sStudy'), 'ArrowDown'));
  assert.deepEqual(c.state.selectedIds, [first]);
  // Enter collapses and expands.
  c.onKey(keyOn(secT('sStudy'), 'Enter'));
  assert.equal(c.isSectionCollapsed('sStudy'), true);
  c.renderVals(); c.renderSheet(c._visTasks);
  c.onKey(keyOn(secT('sStudy'), 'ArrowRight'));
  assert.equal(c.isSectionCollapsed('sStudy'), false, '→ expands');
  c.renderVals(); c.renderSheet(c._visTasks);
  // F2 renames.
  c.onKey(keyOn(secT('sWork'), 'F2'));
  assert.equal(c.state.secEdit, 'sWork');
  c.cancelSectionEdit();
  // Alt+↓ / Alt+↑ move it.
  c.onKey(keyOn(secT('sStudy'), 'ArrowDown', { altKey: true }));
  assert.deepEqual(c.sectionsInOrder().map((s) => s.id), ['sWork', 'sStudy', 'sEmpty']);
  c.renderVals(); c.renderSheet(c._visTasks);
  c.onKey(keyOn(secT('sStudy'), 'ArrowUp', { altKey: true }));
  assert.deepEqual(c.sectionsInOrder().map((s) => s.id), ['sStudy', 'sWork', 'sEmpty']);
  c.renderVals(); c.renderSheet(c._visTasks);
  // Shift+F10 opens the section menu, which carries every action.
  c.onKey(keyOn(secT('sWork'), 'F10', { shiftKey: true }));
  assert.equal(c.state.menu && c.state.menu.sec, 'sWork');
  const menu = c.renderMenu();
  const items = find(menu, (p) => p.role === 'menuitem').map((n) => textOf(n.children));
  for (const want of ['Collapse section', 'Rename', 'Move up', 'Move down', 'Delete section']) {
    assert.ok(items.some((t) => t.includes(want)), 'the section menu offers ' + want + ' — got ' + items.join(' | '));
  }
  c.closeMenu();
  // Delete removes the section — the ✕'s own undoable delete, so its tasks move to No section.
  c.onKey(keyOn(secT('sWork'), 'Delete'));
  assert.ok(!c.state.sections.some((s) => s.id === 'sWork'), 'deleted');
  assert.equal(c.state.tasks.find((t) => t.id === 'w').sectionId, null, 'its task is kept, in No section');
  assert.match(String(c.state.toast && (c.state.toast.msg || c.state.toast.text || c.state.toast)), /Work/, 'with the Undo toast');
}));

test('Shift and Ctrl arrows still walk rows only (they build a row selection)', () => withNow(FIXED_NOW, () => {
  const c = setup();
  c.renderSheet(c._visTasks);
  const first = c._visSections.find((s) => s.id === 'sWork').tasks[0].id;
  c.setState({ selectedIds: [first] });
  c.onKey(keyOn(rowT(first), 'ArrowUp', { shiftKey: true }));
  assert.equal(c._secFocusKey, null);
  assert.ok(c.state.selectedIds.length === 2, 'Shift+↑ extended across the header into the row above');
}));

test('timeline roving: ↑/↓ walk a day in time, ←/→ jump to the nearest-in-time block of the adjacent day, Home/End', () => {
  const c = make();
  const H = 3600000, D0 = 0, D1 = DAY, D3 = 3 * DAY;
  const items = [
    { day: D0, start: D0 + 9 * H }, { day: D0, start: D0 + 14 * H }, { day: D0, start: D0 + 11 * H },
    { day: D1, start: D1 + 10 * H }, { day: D1, start: D1 + 15 * H },
    { day: D3, start: D3 + 13 * H },
  ];
  assert.equal(c.tlNavNext(items, 0, 'ArrowDown'), 2, '9:00 → 11:00 (time order, not DOM order)');
  assert.equal(c.tlNavNext(items, 2, 'ArrowDown'), 1);
  assert.equal(c.tlNavNext(items, 1, 'ArrowDown'), null, 'the day ends');
  assert.equal(c.tlNavNext(items, 1, 'ArrowUp'), 2);
  assert.equal(c.tlNavNext(items, 2, 'Home'), 0);
  assert.equal(c.tlNavNext(items, 0, 'End'), 1);
  assert.equal(c.tlNavNext(items, 1, 'ArrowRight'), 4, '14:00 → 15:00 on the next day, the nearest in time');
  assert.equal(c.tlNavNext(items, 0, 'ArrowRight'), 3, '9:00 → 10:00');
  assert.equal(c.tlNavNext(items, 4, 'ArrowRight'), 5, 'an empty day is skipped');
  assert.equal(c.tlNavNext(items, 5, 'ArrowRight'), null);
  assert.equal(c.tlNavNext(items, 3, 'ArrowLeft'), 0);
  // The one Tab stop: remembered, else the first at/after now, else the last.
  assert.equal(c.tlRovingPick(items, D1 + '|' + (D1 + 10 * H), 0), 3);
  assert.equal(c.tlRovingPick(items, null, D0 + 12 * H), 1, 'the first block at or after now');
  assert.equal(c.tlRovingPick(items, 'gone', D3 + 20 * H), 5, 'all past: the last');
});
