// UI revamp block 6 — the sheet and selection model.
// 1. Shift-click ranges follow SCREEN order (sections/sort/collapse), Ctrl+Shift adds a range, Ctrl toggles.
// 2. A click on empty sheet space (or a section header's own surface) deselects; the Gantt's empty lane
//    selects its row but never opens the detail modal.
// 3. Two or more selected rows turn the sheet toolbar into a bulk-action bar whose actions run through the
//    existing *Multi methods and confirm through the toast layer.
// 4. An empty section collapses to a thin header that is still a drop target and still offers "+ add".
// 5. Rows are a roving tab stop with row keys; the row and bar menus are role=menu with real items and the
//    mislabelled entries fixed; the `?` sheet lists bindings that the key handlers really honour.
// 6. Search marks matched words in titles; a search that matches nothing says so, with Clear search.
// 7. Double-click on a title edits it inline; the first-run coach never shows on a populated workspace.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};

// Storage order a, b, c, d — but sections put b and d (Study) ABOVE a and c (Work), so the screen reads
// b, d, a, c. An empty "Later" section sits between them.
function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.state.sections = [{ id: 'sStudy', name: 'Study' }, { id: 'sLater', name: 'Later' }, { id: 'sWork', name: 'Work' }];
  const T = (id, name, sectionId, extra) => c.normalizeTask(Object.assign({ id, name, type: 'Proportional',
    sectionId, start: null, end: null, priority: 4, deps: [], pct: 0, planned: 60, labels: [] }, extra || {}));
  c.state.tasks = [T('a', 'Answer emails', 'sWork'), T('b', 'Read chapter', 'sStudy'),
    T('c', 'Call the bank', 'sWork'), T('d', 'Draft the report', 'sStudy')];
  c.savePrefs = () => {};
  c.saveSections = (list) => { c.state.sections = list; };
  c.renderVals();
  return c;
}
const ev = (over) => Object.assign({ preventDefault() {}, stopPropagation() {}, shiftKey: false, ctrlKey: false,
  metaKey: false, altKey: false, clientX: 0, clientY: 0, button: 0, target: { closest: () => null } }, over || {});
const visIds = (c) => c._visTasks.map((t) => t.id);

// ---------------------------------------------------------------------------
// 1. Selection model
// ---------------------------------------------------------------------------

test('the fixture renders in screen order, which is not storage order', () => {
  const c = setup();
  assert.deepEqual(visIds(c), ['b', 'd', 'a', 'c']);
  assert.deepEqual(c.state.tasks.map((t) => t.id), ['a', 'b', 'c', 'd']);
});

test('shift-click selects the rows BETWEEN the two clicks as shown, across a section boundary', () => {
  const c = setup();
  c.rowClick(ev(), 'd');                       // anchor (opens detail, as a single click always has)
  c.rowClick(ev({ shiftKey: true }), 'c');
  assert.deepEqual(c.state.selectedIds, ['d', 'a', 'c'], 'screen order d → a → c, across Study → Work');
  assert.equal(c.state.detailId, null, 'a range closes the detail');
  // Storage order would have been a..d minus nothing = c, d? — the old bug. Prove it differs.
  const ts = c.state.tasks.map((t) => t.id);
  assert.notDeepEqual(ts.slice(ts.indexOf('c'), ts.indexOf('d') + 1), c.state.selectedIds);
});

test('ctrl+shift-click ADDS a range; ctrl-click toggles one row', () => {
  const c = setup();
  c.rowClick(ev(), 'b');
  c.rowClick(ev({ ctrlKey: true }), 'c');
  assert.deepEqual(c.state.selectedIds.slice().sort(), ['b', 'c']);
  c.rowClick(ev({ ctrlKey: true }), 'c');
  assert.deepEqual(c.state.selectedIds, ['b'], 'a second ctrl-click removes it');
  c.rowClick(ev({ ctrlKey: true }), 'a');      // anchor moves to a
  c.rowClick(ev({ ctrlKey: true, shiftKey: true }), 'c');
  assert.deepEqual(c.state.selectedIds.slice().sort(), ['a', 'b', 'c'], 'b kept, a..c added');
});

test('selRangeIds is pure over the rendered rows and refuses an off-screen anchor', () => {
  const c = setup();
  const rows = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  assert.deepEqual(c.selRangeIds('z', 'x', rows), ['x', 'y', 'z']);
  assert.equal(c.selRangeIds('gone', 'x', rows), null);
});

test('a click on empty sheet space, or on a section header, clears the selection', () => {
  const c = setup();
  c.setState({ selectedIds: ['a', 'b'] });
  const root = c.renderSheet(c._visTasks);
  const self = {};
  root.props.onClick({ target: self, currentTarget: self });
  assert.deepEqual(c.state.selectedIds, []);
  c.setState({ selectedIds: ['a'] });
  const head = find(root, (p) => p['data-section-id'] === 'sStudy' && p.onClick)[0];
  head.props.onClick(ev());
  assert.deepEqual(c.state.selectedIds, [], 'the header surface is empty space too');
});

test('the Gantt empty lane selects its row, never opens the detail, and has no double-click', () => {
  const c = setup();
  c.state.tasks.forEach((t) => { t.start = c.startOfToday(); t.end = c.startOfToday() + 86400000; });
  c.renderVals();
  const g = c.renderGantt(c._visTasks);
  const lane = find(g, (p) => p['data-gantt-task-id'] === 'a')[0];
  assert.ok(lane, 'the lane stripe renders');
  assert.equal(lane.props.onDoubleClick, undefined, 'no double-click on blank timeline');
  lane.props.onClick(ev());
  assert.deepEqual(c.state.selectedIds, ['a']);
  assert.equal(c.state.detailId == null, true, 'the detail modal stays shut');
});

// ---------------------------------------------------------------------------
// 2. Bulk-action bar
// ---------------------------------------------------------------------------

function bulk(c) { return c.renderFilterBar(null); }
const bulkCtl = (bar, key) => find(bar, (p) => p['data-pp-bulk'] === key)[0];

test('two or more selected rows turn the toolbar into the bulk bar, at the same strip height', () => {
  const c = setup();
  c.setState({ selectedIds: ['a'] });
  assert.ok(find(bulk(c), (p) => p['data-pp-filterbar'] === '1').length, 'one row: the ordinary toolbar');
  c.setState({ selectedIds: ['a', 'c'] });
  const bar = bulk(c);
  assert.equal(bar.props['data-pp-bulkbar'], '2');
  assert.equal(bar.props.role, 'toolbar');
  assert.equal(bar.props.style.height, c.PLAN_STRIP_H + 'px', 'rows stay level with the Gantt');
  assert.match(textOf(bar), /2 selected/);
  for (const k of ['complete', 'section', 'priority', 'archive', 'delete', 'clear']) assert.ok(bulkCtl(bar, k), k);
  bulkCtl(bar, 'clear').props.onClick(ev());
  assert.deepEqual(c.state.selectedIds, []);
});

test('bulk Priority and Move to run the multi methods and toast with Undo', () => {
  const c = setup();
  c.setState({ selectedIds: ['a', 'c'] });
  bulkCtl(bulk(c), 'priority').props.onChange({ target: { value: '1' } });
  assert.deepEqual(c.state.tasks.filter((t) => t.priority === 1).map((t) => t.id).sort(), ['a', 'c']);
  assert.match(c.state.toast.msg, /2 tasks set to P1/);
  assert.equal(c.state.toast.undo, true);
  bulkCtl(bulk(c), 'section').props.onChange({ target: { value: 's:sLater' } });
  assert.deepEqual(c.state.tasks.filter((t) => t.sectionId === 'sLater').map((t) => t.id).sort(), ['a', 'c']);
  assert.match(c.state.toast.msg, /2 tasks moved to “Later”/);
  c.undoAndConfirm();
  assert.deepEqual(c.state.tasks.filter((t) => t.sectionId === 'sWork').map((t) => t.id).sort(), ['a', 'c'], 'one undo restores the move');
});

test('bulk Archive, Complete and Delete each confirm through the toast and clear the selection', () => {
  const c = setup();
  c.setState({ selectedIds: ['a', 'c'] });
  bulkCtl(bulk(c), 'archive').props.onClick(ev());
  assert.ok(c.state.tasks.find((t) => t.id === 'a').archivedAt && c.state.tasks.find((t) => t.id === 'c').archivedAt);
  assert.match(c.state.toast.msg, /2 tasks archived/);
  assert.deepEqual(c.state.selectedIds, []);
  c.setState({ selectedIds: ['b', 'd'] });
  bulkCtl(bulk(c), 'complete').props.onClick(ev());
  assert.ok(c.state.tasks.filter((t) => ['b', 'd'].includes(t.id)).every((t) => t.pct >= 100));
  assert.match(c.state.toast.msg, /2 tasks completed/);
  assert.deepEqual(c.state.selectedIds, []);
  c.setState({ selectedIds: ['b', 'd'] });
  bulkCtl(bulk(c), 'delete').props.onClick(ev());
  assert.deepEqual(c.state.tasks.map((t) => t.id).sort(), ['a', 'c']);
  assert.match(c.state.toast.msg, /2 tasks deleted/);
});

// ---------------------------------------------------------------------------
// 3. Empty sections
// ---------------------------------------------------------------------------

test('an empty section renders as a thin header with "+ add", which opens quick add filed into it', () => {
  const c = setup();
  const root = c.renderSheet(c._visTasks);
  const later = find(root, (p) => p['data-section-id'] === 'sLater')[0];
  assert.equal(later.props['data-section-empty'], '1');
  assert.equal(later.props.style.height, c.SECTION_EMPTY_H + 'px');
  const study = find(root, (p) => p['data-section-id'] === 'sStudy')[0];
  assert.equal(study.props.style.height, c.TAG_SECTION_H + 'px', 'a populated header keeps its height');
  const add = find(later, (p) => p['data-section-add'] === 'sLater')[0];
  assert.ok(add, '+ add is on the thin line');
  assert.equal(textOf(add), '+ add');
  add.props.onClick(ev());
  assert.equal(c.state.quickOpen, true);
  assert.equal(c.state.quickText, '/Later ');
  assert.equal(c._secPick, 'sLater', 'the section is pinned, not guessed');
});

// ---------------------------------------------------------------------------
// 4. Keyboard model, menus, shortcut sheet
// ---------------------------------------------------------------------------

test('sheet rows are a roving tab stop: one row has tabIndex 0, every row is a selectable grid row', () => {
  const c = setup();
  const root = c.renderSheet(c._visTasks);
  const rows = find(root, (p) => p['data-pp-row'] === '1');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.props.role), ['row', 'row', 'row', 'row']);
  assert.equal(rows.filter((r) => r.props.tabIndex === 0).length, 1, 'exactly one tab stop');
  assert.equal(rows.find((r) => r.props.tabIndex === 0).props['data-task-id'], 'b', 'the first row on screen by default');
  c.setState({ selectedIds: ['a'] }); c._rowFocusId = null;
  const again = find(c.renderSheet(c._visTasks), (p) => p['data-pp-row'] === '1');
  assert.equal(again.find((r) => r.props.tabIndex === 0).props['data-task-id'], 'a', 'then the selected row');
  assert.equal(again.find((r) => r.props['data-task-id'] === 'a').props['aria-selected'], 'true');
});

const rowTarget = (id) => ({ hasAttribute: (a) => a === 'data-pp-row', getAttribute: () => id, tagName: 'DIV',
  matches: () => true, isContentEditable: false, closest: () => null });
const key = (k, id, over) => ev(Object.assign({ key: k, target: id ? rowTarget(id) : { tagName: 'BODY', matches: () => false, hasAttribute: () => false, closest: () => null } }, over || {}));

test('row keys: ↓/↑ move and select in screen order, Ctrl+↓ moves focus only, Shift extends, Space toggles', () => {
  const c = setup();
  c.onKey(key('ArrowDown', 'b'));
  assert.deepEqual(c.state.selectedIds, ['d'], '↓ from b lands on d — the next row on screen, not c');
  c.onKey(key('ArrowDown', 'd', { ctrlKey: true }));
  assert.deepEqual(c.state.selectedIds, ['d'], 'Ctrl+↓ leaves the selection alone');
  assert.equal(c._rowFocusId, 'a', '...and moves the tab stop');
  c.onKey(key('ArrowDown', 'a', { shiftKey: true }));
  assert.deepEqual(c.state.selectedIds, ['d', 'a', 'c'], 'Shift+↓ extends from the anchor');
  c.onKey(key(' ', 'b'));
  assert.ok(c.state.selectedIds.includes('b'), 'Space adds the focused row');
  c.onKey(key(' ', 'b'));
  assert.ok(!c.state.selectedIds.includes('b'), '...and removes it again');
  c.onKey(key('End', 'b'));
  assert.deepEqual(c.state.selectedIds, ['c']);
  c.onKey(key('Home', 'c'));
  assert.deepEqual(c.state.selectedIds, ['b']);
});

test('row keys: Enter opens details, F2 edits in place, Shift+F10 and the Menu key open the row menu', () => {
  const c = setup();
  c.onKey(key('Enter', 'a'));
  assert.equal(c.state.detailId, 'a');
  c.closeDetail();
  c.onKey(key('F2', 'c'));
  assert.deepEqual(c.state.inlineEdit, { id: 'c' });
  c.cancelInlineEdit('c');
  c.onKey(key('F10', 'd', { shiftKey: true }));
  assert.deepEqual(c.state.menu.ids, ['d']);
  assert.equal(c.state.menu.kbd, true);
  c.closeMenu();
  c.onKey(key('ContextMenu', 'b'));
  assert.deepEqual(c.state.menu.ids, ['b']);
  // The browser's own contextmenu that follows the key is ignored, not re-anchored.
  const before = c.state.menu;
  c.rowMenu(ev({ clientX: 0, clientY: 0 }), 'b');
  assert.equal(c.state.menu, before);
});

test('the row menu is role=menu with real items; Edit/Ctrl E is merged into Open details; no wrong Tab hint', () => {
  const c = setup();
  c.setState({ menu: { x: 10, y: 10, ids: ['a'] } });
  const m = c.renderMenu();
  const menu = find(m, (p) => p.role === 'menu')[0];
  assert.ok(menu, 'role=menu');
  assert.equal(menu.props['data-pp-menu'], 'row');
  assert.equal(typeof menu.props.onKeyDown, 'function', 'arrow keys are handled');
  const items = find(menu, (p) => p.role === 'menuitem' || p.role === 'menuitemradio');
  assert.ok(items.length >= 12, 'every action is an item');
  assert.ok(items.every((i) => i.props.tabIndex === -1), 'items are focus targets for the arrows');
  const labels = items.map(textOf);
  assert.ok(labels.some((l) => /^.Open details\s*Enter$/.test(l)), 'Open details · Enter');
  assert.ok(labels.some((l) => /Rename\s*F2/.test(l)), 'Rename · F2');
  assert.ok(labels.some((l) => /Start timer/.test(l)), 'the timer is reachable from the menu');
  const all = textOf(menu);
  assert.ok(!/Ctrl E/.test(all), 'the dead Ctrl E hint is gone');
  assert.ok(!/Open in details/.test(all), 'one Open entry, not two');
  assert.ok(labels.some((l) => /Add subtask$/.test(l)), 'Add subtask carries no Tab hint');
  const pri = items.filter((i) => /^Priority P/.test(i.props['aria-label'] || ''));
  assert.equal(pri.length, 4, 'priority squares are labelled radio items');
});

test('the bar menu is role=menu, opens with Open details, and says "Clear start date" not "→ ghost"', () => {
  const c = setup();
  const t = c.state.tasks[0]; t.start = c.startOfToday(); t.end = c.startOfToday() + 2 * 86400000;
  c.setState({ barMenu: { id: t.id, x: 10, y: 10, cx: 10, cy: 10, occIdx: 0 } });
  const m = c.renderBarMenu();
  const menu = find(m, (p) => p.role === 'menu')[0];
  assert.equal(menu.props['data-pp-menu'], 'bar');
  const items = find(menu, (p) => p.role === 'menuitem' || p.role === 'menuitemradio');
  assert.match(textOf(items[0]), /Open details/, 'the first item, so the scroll cap cannot hide it');
  const all = textOf(menu);
  assert.match(all, /Clear start date/);
  assert.match(all, /Clear end date/);
  assert.ok(!/ghost/.test(all), 'no jargon');
});

test('menuKeyDown moves focus with the arrows and activates with Enter', () => {
  const c = setup();
  const moved = [];
  const mk = (n) => ({ n, getAttribute: () => null, click() {}, focus() { moved.push(n); } });
  const items = [mk(0), mk(1), mk(2)];
  const box = { querySelectorAll: () => items };
  // The mock DOM has no activeElement, so "nothing focused yet" is the starting state.
  const e = (k) => ({ key: k, currentTarget: box, preventDefault() {}, stopPropagation() {}, nativeEvent: {} });
  c.menuKeyDown(e('ArrowDown'));
  c.menuKeyDown(e('End'));
  c.menuKeyDown(e('Home'));
  c.menuKeyDown(e('ArrowUp'));
  assert.deepEqual(moved, [0, 2, 0, 2], '↓ from nothing → first; End/Home jump; ↑ from nothing → last');
  const unhandled = { key: 'x', currentTarget: box, preventDefault() { throw new Error('should not claim'); }, stopPropagation() {} };
  c.menuKeyDown(unhandled);
});

// The ? sheet: every GLOBAL binding it lists is driven through onKey and must do what it says.
test('the ? sheet lists real bindings: each global shortcut, pressed, does what its row says', () => {
  const c = setup();
  const listed = c.SHORTCUTS().flatMap((g) => g.items.flatMap((i) => i.keys));
  const spy = (name) => { const calls = []; c[name] = (...a) => { calls.push(a); }; return calls; };
  const press = (k, over) => c.onKey(key(k, null, over));

  press('?');
  assert.equal(c.state.keysOpen, true, '? opens the sheet');
  assert.equal(c.topDialog(), 'keys', 'as the topmost dialog');
  press('Escape');
  assert.equal(c.state.keysOpen, false, 'Esc closes it');

  press('q'); assert.equal(c.state.quickOpen, true, 'Q'); c.setState({ quickOpen: false });
  press('s'); assert.equal(c.state.searchOpen, true, 'S'); c.setState({ searchOpen: false });
  press('/'); assert.equal(c.state.searchOpen, true, '/'); c.setState({ searchOpen: false });
  const nBefore = c.state.tasks.length;
  press('a'); assert.equal(c.state.tasks.length, nBefore + 1, 'A adds'); c.closeDetail();
  press('A'); assert.equal(c.state.tasks[0].name, 'New task', 'Shift+A adds at the top'); c.closeDetail();
  const undo = spy('undoAndConfirm'); const redo = spy('redoAndConfirm');
  press('u'); press('z', { ctrlKey: true });
  assert.equal(undo.length, 2, 'U and Ctrl+Z undo');
  press('y', { ctrlKey: true }); press('z', { ctrlKey: true, shiftKey: true });
  assert.equal(redo.length, 2, 'Ctrl+Y and Ctrl+Shift+Z redo');
  const scratch = spy('gotoScratchpad'); press('n'); assert.equal(scratch.length, 1, 'N');
  c.setState({ toast: { id: 1, msg: 'x', undo: true, seq: 0, ms: 1 } });
  const ft = []; c.focusToast = () => { ft.push(1); return true; };
  press('F6'); assert.equal(ft.length, 1, 'F6 goes to the toast');

  for (const k of ['Q', 'S', '/', 'A', 'Shift+A', 'U', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'N', 'F6', '?', 'Esc',
    '↑', '↓', 'Shift+↑', 'Ctrl+↓', 'Home', 'End', 'Space', 'Enter', 'F2', 'Shift+F10', 'Menu', 'Tab', 'Delete', 'J', 'K']) {
    assert.ok(listed.includes(k), 'the sheet lists ' + k);
  }
  assert.ok(!listed.includes('Ctrl+E'), 'no binding that does not exist');
});

test('the ? sheet is a Dialog: role, label, and a close button that is focused first', () => {
  const c = setup();
  c.setState({ keysOpen: true });
  const node = c.renderKeysSheet();
  const card = find(node, (p) => p.role === 'dialog')[0];
  assert.equal(card.props['aria-modal'], 'true');
  assert.equal(card.props['aria-labelledby'], 'pp-keys-title');
  assert.match(textOf(card), /Keyboard shortcuts/);
  assert.ok(find(card, (p) => p['data-qa'] === 'keys-close').length);
  const groups = find(card, (p) => p['data-pp-keys-group']).map((g) => g.props['data-pp-keys-group']);
  assert.deepEqual(groups, ['Anywhere', 'Task rows', 'Mouse', 'Menus', 'Selection view']);
});

// ---------------------------------------------------------------------------
// 5. Search highlight and the no-match state
// ---------------------------------------------------------------------------

test('only positive free-text words are highlighted — tags, sections, priorities and negations are not', () => {
  const c = setup();
  assert.deepEqual(c.searchHighlightTerms('report @work /study p1 -draft "big plan"'), ['big plan', 'report']);
  assert.deepEqual(c.searchHighlightTerms('-(email OR call) bank'), ['bank']);
  assert.deepEqual(c.highlightSegments('Draft the Report', ['report']),
    [{ text: 'Draft the ', hit: false }, { text: 'Report', hit: true }]);
  assert.deepEqual(c.highlightSegments('abc', []), [{ text: 'abc', hit: false }]);
});

test('while searching, matched words are marked in the sheet titles', () => {
  const c = setup();
  c.setState({ searchQuery: 'report', searchText: 'report' });
  c.renderVals();
  const root = c.renderSheet(c._visTasks);
  const marks = find(root, (p) => p['data-pp-hit'] === '1');
  assert.deepEqual(marks.map(textOf), ['report']);
  assert.equal(marks[0].type, 'mark');
});

test('a search that matches nothing says so in the sheet, with a Clear search button', () => {
  const c = setup();
  c.setState({ searchQuery: 'zzzz', searchText: 'zzzz' });
  c.renderVals();
  const root = c.renderSheet(c._visTasks);
  const nm = find(root, (p) => p['data-pp-nomatch'])[0];
  assert.ok(nm, 'the empty state renders');
  assert.match(textOf(nm), /No tasks match “zzzz”/);
  const btn = find(nm, (p) => p['data-pp-nomatch-clear'])[0];
  assert.equal(textOf(btn), 'Clear search');
  btn.props.onClick(ev());
  assert.equal(c.state.searchQuery, null);
});

test('filters (not search) that match nothing offer Clear filters', () => {
  const c = setup();
  c.setState({ chips: ['unplanned'] });
  c.renderVals();
  const nm = find(c.renderSheet(c._visTasks), (p) => p['data-pp-nomatch'])[0];
  assert.equal(nm.props['data-pp-nomatch'], 'filters');
  assert.match(textOf(nm), /Clear filters/);
});

// ---------------------------------------------------------------------------
// 6. Inline title edit, quiet actions, the coach
// ---------------------------------------------------------------------------

test('inline edit: Enter saves once through rename, Escape and an empty title cancel', () => {
  const c = setup();
  c.startInlineEdit('a');
  const root = c.renderSheet(c._visTasks);
  const input = find(root, (p) => p['data-pp-inline-title'] === 'a')[0];
  assert.ok(input, 'the row shows the editor');
  assert.equal(input.props.defaultValue, 'Answer emails');
  const depth = c._undoDepth();
  input.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {}, target: { value: 'Answer all emails' } });
  input.props.onBlur({ target: { value: 'Answer all emails' } });   // the blur that follows must not commit twice
  assert.equal(c.state.tasks.find((t) => t.id === 'a').name, 'Answer all emails');
  assert.equal(c._undoDepth(), depth + 1, 'one undo step');
  assert.equal(c.state.inlineEdit, null);
  c.startInlineEdit('a');
  c.cancelInlineEdit('a');
  c.commitInlineEdit('a', 'should not land');
  assert.equal(c.state.tasks.find((t) => t.id === 'a').name, 'Answer all emails', 'Escape abandons');
  c.startInlineEdit('a');
  c.commitInlineEdit('a', '   ');
  assert.equal(c.state.tasks.find((t) => t.id === 'a').name, 'Answer all emails', 'an empty title is a cancel');
});

test('inline edit re-parses dates through the rename path', () => {
  const c = setup();
  c.startInlineEdit('a');
  c.commitInlineEdit('a', 'Answer emails tomorrow');
  const t = c.state.tasks.find((x) => x.id === 'a');
  assert.ok(t.start != null || t.end != null, 'the parser read "tomorrow"');
});

test('a double-click on the title (modal path) edits inline and starts no timer', () => {
  const c = setup();
  const onTitle = { closest: (s) => (s === '[data-pp-title]' ? {} : null) };
  c.rowClick(ev({ target: onTitle, clientX: 50, clientY: 50 }), 'a');
  assert.equal(c.state.detailId, 'a', 'single click still opens details');
  const consumed = c.detailDblFollowUp({ button: 0, clientX: 51, clientY: 50, preventDefault() {} });
  assert.equal(consumed, true);
  assert.equal(c.state.detailId, null, 'the detail closes');
  assert.deepEqual(c.state.inlineEdit, { id: 'a' }, 'and the title is edited in place');
  assert.equal(c.activeTaskId(), null, 'no timer');
  c.cancelInlineEdit('a');
  // Off the title: the second press is consumed and the detail stays open.
  c.rowClick(ev({ clientX: 50, clientY: 50 }), 'b');
  c._suppressRowClickUntil = 0;
  c.rowClick(ev({ clientX: 50, clientY: 50 }), 'b');
  assert.equal(c.detailDblFollowUp({ button: 0, clientX: 50, clientY: 50, preventDefault() {} }), true);
  assert.equal(c.state.detailId, 'b');
  assert.equal(c.state.inlineEdit, null);
  assert.equal(c.activeTaskId(), null);
});

test('row actions are quiet until hover/selection/focus — except a running timer', () => {
  const c = setup();
  c.startTimer('a');
  c.renderVals();
  const root = c.renderSheet(c._visTasks);
  const rowOf = (id) => find(root, (p) => p['data-pp-row'] === '1' && p['data-task-id'] === id)[0];
  const actions = (id) => find(rowOf(id), (p) => p['data-cellk'] === 'actions')[0];
  assert.ok(find(actions('b'), (p) => p.className === 'pp-quiet').length >= 2, 'play and spent are quiet on an idle row');
  const runningQuiet = find(actions('a'), (p) => p.className === 'pp-quiet').map(textOf);
  assert.ok(!runningQuiet.some((t) => /■/.test(t)), 'a running timer stays lit');
  assert.equal(rowOf('a').props.className, 'pp-row', 'the CSS hook that reveals them on hover/focus/selection');
});

test('titles carry the full name as a tooltip; the Task column takes extra width', () => {
  const c = setup();
  const root = c.renderSheet(c._visTasks);
  const title = find(root, (p) => p['data-pp-title'] === '1' && p.onMouseEnter)
    .find((n) => /Draft the report/.test(textOf(n)));
  assert.ok(title, 'the title line has a hover handler');
  const attrs = {};
  const el = (sw, cw) => ({ scrollWidth: sw, clientWidth: cw, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } });
  title.props.onMouseEnter({ currentTarget: el(300, 120) });
  assert.equal(attrs.title, 'Draft the report', 'a truncated title shows the full name on hover');
  title.props.onMouseEnter({ currentTarget: el(100, 120) });
  assert.equal(attrs.title, undefined, 'a title that fits carries no tooltip');
  const nameHead = find(root, (p) => p['data-colk'] === 'name')[0];
  assert.match(nameHead.props.style.flex, /^1 0 /);
});

test('the Getting started coach never shows on a populated workspace', () => {
  const c = setup();
  c.state.firstRunSeen = false;
  assert.equal(c.renderFirstRun(), null, 'tasks exist, so no coach');
  c.state.tasks = [];
  const empty = c.renderFirstRun();
  assert.ok(find(empty, (p) => p['data-qa'] === 'firstrun-card').length, 'the empty workspace keeps its welcome');
  assert.ok(!/Getting started/.test(textOf(empty)));
});
