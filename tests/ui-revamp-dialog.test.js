// UI revamp block 4 — the shared Dialog primitive and the detail modal.
// Detail, quick add, settings and the first-run welcome become real dialogs (role, aria-modal, a label,
// focus in / trap / restore, one surface). Every way the detail closes saves the pending edit. The When
// line refuses a partial parse. One end-date formatter is shared by every surface, and fixes the
// "Oct 4 → Oct 4 reads Sat Oct 03" day slip. Subtasks are named inline. The date picker's days are
// keyboard-reachable and Done precedes Clear in the tab order.
// Focus movement itself needs a real DOM and lives in tests/e2e/dialog-focus.spec.js.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join(' ') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const byQa = (tree, qa) => find(tree, (p) => p['data-qa'] === qa);

function setup(extra) {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  const B = c.startOfDay(Date.now());
  c.state.tasks = [
    { id: 'a', name: 'Groceries', start: B + DAY, end: B + 3 * DAY },
    { id: 'b', name: 'Laundry', start: B + DAY, end: B + 2 * DAY },
    { id: 'c', name: 'Taxes', start: B + 2 * DAY, end: B + 4 * DAY },
  ].concat(extra || []).map((t) => c.normalizeTask(Object.assign({ type: 'Proportional', priority: 4, deps: [], pct: 0, planned: 60, labels: [] }, t)));
  c.state.sections = [];
  c.renderVals();
  return { c, B };
}
const task = (c, id) => c.state.tasks.find((t) => t.id === id);
const key = (k, target, extra) => Object.assign({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  target: target || null, preventDefault() {}, stopPropagation() {} }, extra || {});

function assertDialog(tree, what) {
  const cards = find(tree, (p) => p.role === 'dialog');
  assert.equal(cards.length, 1, what + ': exactly one role=dialog');
  const p = cards[0].props;
  assert.equal(p['aria-modal'], 'true', what + ': aria-modal');
  assert.ok(p['aria-labelledby'], what + ': aria-labelledby');
  assert.equal(find(tree, (q) => q.id === p['aria-labelledby']).length, 1, what + ': the label exists in the dialog');
  assert.match(p.className, /\bpp-dialog\b/, what + ': the shared surface');
  assert.equal(p.tabIndex, -1, what + ': the card can take focus when no field should');
  assert.equal(typeof p.onKeyDown, 'function', what + ': Tab is trapped');
  assert.equal(find(tree, (q) => /\bpp-scrim\b/.test(q.className || '')).length, 1, what + ': the shared 0.5 backdrop');
  return p;
}

// ---------------------------------------------------------------------------
// The primitive on all four modals
// ---------------------------------------------------------------------------

test('detail, quick add, settings and the first-run welcome are all real dialogs', () => {
  const { c } = setup();
  c.setState({ detailId: 'a' });
  const d = assertDialog(c.renderDetail(), 'detail');
  assert.equal(d['data-pp-dialog'], 'detail');

  c.setState({ detailId: null, quickOpen: true, quickText: '' });
  assertDialog(c.renderQuickAddPopup(), 'quick add');

  c.setState({ quickOpen: false, settingsOpen: true });
  const st = c.renderSettings();
  assertDialog(st, 'settings');
  assert.equal(byQa(st, 'settings-card').length, 1);
  assert.ok(find(st, (p) => p['aria-label'] === 'Close settings').length, 'settings gained a real close button');

  const f = make();
  f.state.tasks = [];
  f.state.firstRunSeen = false;
  assertDialog(f.renderFirstRun(), 'first-run welcome');
  assert.equal(f.topDialog(), 'firstrun');
  // Dismissed, the empty state is NOT modal: it is a hint, not a dialog.
  f.markFirstRunSeen();
  assert.equal(find(f.renderFirstRun(), (p) => p.role === 'dialog').length, 0);
});

test('the topmost dialog is known, so Escape and Tab act on the right one', () => {
  const { c } = setup();
  assert.equal(c.topDialog(), null);
  c.setState({ detailId: 'a' });
  assert.equal(c.topDialog(), 'detail');
  c.setState({ settingsOpen: true });
  assert.equal(c.topDialog(), 'settings');
  c.setState({ quickOpen: true });
  assert.equal(c.topDialog(), 'quick');
});

test('global shortcuts do not fire while a dialog is open', () => {
  const { c } = setup();
  c.setState({ settingsOpen: true, selectedIds: ['b'] });
  const n = c.state.tasks.length;
  c.onKey(key('a'));
  assert.equal(c.state.tasks.length, n, '`a` adds nothing behind settings');
  c.onKey(key('Delete'));
  assert.ok(task(c, 'b'), 'Delete removes nothing behind settings');
  c.onKey(key('q'));
  assert.equal(!!c.state.quickOpen, false, '`q` does not open quick add over settings');

  // The first-run welcome lets `q` through — it is what the welcome tells you to press.
  const f = make();
  f.state.settings.usageTracking = false;
  f.state.tasks = []; f.state.firstRunSeen = false;
  f.onKey(key('a'));
  assert.equal(f.state.tasks.length, 0, '`a` is blocked by the welcome');
  f.onKey(key('q'));
  assert.equal(f.state.quickOpen, true, '`q` opens quick add from the welcome');
});

test('Escape dismisses the first-run welcome to the plain empty state', () => {
  const f = make();
  f.state.settings.usageTracking = false;
  f.state.tasks = []; f.state.firstRunSeen = false;
  f.onKey(key('Escape'));
  assert.equal(f.state.firstRunSeen, true);
  assert.equal(f.topDialog(), null);
});

// ---------------------------------------------------------------------------
// Every close path saves
// ---------------------------------------------------------------------------

const closePaths = {
  'backdrop click': (c) => { const scrim = c.renderDetail(); const ev = { button: 0, target: scrim, currentTarget: scrim };
    scrim.props.onMouseDown(ev); },
  '✕ button': (c) => byQa(c.renderDetail(), 'detail-close')[0].props.onClick(),
  'Escape': (c) => c.onKey(key('Escape')),
  'next task (⌄)': (c) => byQa(c.renderDetail(), 'detail-next')[0].props.onClick(),
  'opening another task from inside it': (c) => c.openDetail('c'),
};
for (const [name, close] of Object.entries(closePaths)) {
  test('a title edit survives closing the detail by ' + name, () => {
    const { c } = setup();
    c.setState({ detailId: 'a', selectedIds: ['a'], titleDraft: { id: 'a', text: 'Groceries and milk' } });
    close(c);
    assert.equal(task(c, 'a').name, 'Groceries and milk');
    assert.equal(c.state.titleDraft, null, 'the draft is consumed, not left to apply twice');
  });
}

test('an UNCHANGED title is not re-committed on blur (no re-parse, no undo entry)', () => {
  const { c } = setup();
  c.setState({ detailId: 'a' });
  let commits = 0; const orig = c.commit.bind(c); c.commit = (...a) => { commits++; return orig(...a); };
  const ed = byQa(c.renderDetail(), 'title-editor')[0];
  ed.props.onBlur({ target: { textContent: 'Groceries' } });
  assert.equal(commits, 0);
  ed.props.onBlur({ target: { textContent: 'Groceries run' } });
  assert.equal(commits, 1);
  assert.equal(task(c, 'a').name, 'Groceries run');
});

test('Escape in a field inside the dialog leaves the field; a second Escape closes', () => {
  const { c } = setup();
  c.setState({ detailId: 'a', selectedIds: ['a'] });
  let blurred = 0, refocused = 0;
  const dlg = { focus() { refocused++; } };
  const field = { tagName: 'DIV', isContentEditable: true, matches: () => false, closest: () => dlg, blur() { blurred++; } };
  c.onKey(key('Escape', field));
  assert.equal(c.state.detailId, 'a', 'the first Escape does not close the dialog');
  assert.equal(blurred, 1, 'it leaves the field (whose blur commits it)');
  assert.equal(refocused, 1, 'focus stays inside the dialog');
  c.onKey(key('Escape'));
  assert.equal(c.state.detailId, null, 'the second Escape closes');
});

test('Escape in quick add closes it in one press', () => {
  const { c } = setup();
  c.setState({ quickOpen: true, quickText: 'call mom' });
  const input = { tagName: 'INPUT', isContentEditable: false, value: 'call mom', matches: () => true, closest: () => ({ focus() {} }), blur() {} };
  c.quickEl = input; c._fieldDraft = { el: input, value: '' };
  c.onKey(key('Escape', input));
  assert.equal(c.state.quickOpen, false);
});

// ---------------------------------------------------------------------------
// The detail layout: Schedule, Organize, then a Details disclosure; actions in a header menu
// ---------------------------------------------------------------------------

test('the detail reads Schedule → Organize → Details, with actions in the header menu', () => {
  const { c } = setup();
  c.setState({ detailId: 'a' });
  const tree = c.renderDetail();
  const txt = textOf(tree);
  const order = ['Schedule', 'When', 'Repeat', 'Flexible / Exact', 'Organize', 'Section', 'Priority', 'Tags', 'Links', 'Depends on', 'Details'];
  let at = -1;
  for (const w of order) { const i = txt.indexOf(w, at + 1); assert.ok(i > at, w + ' comes after the previous field'); at = i; }
  assert.equal(find(tree, (p) => p['data-field'] === 'planned').length, 0, 'owner ruling 8: Planned rides the When sub-line, no separate box');
  assert.equal(byQa(tree, 'detail-actions-menu').length, 0, 'the actions menu starts closed');
  byQa(tree, 'detail-actions')[0].props.onClick();
  const open = c.renderDetail();
  const items = find(open, (p) => p.role === 'menuitem').map((n) => textOf(n));
  assert.ok(items.some((s) => /Mark complete/.test(s)) && items.some((s) => /Duplicate/.test(s))
    && items.some((s) => /Archive/.test(s)) && items.some((s) => /Delete task/.test(s)), items.join(' | '));
  byQa(open, 'detail-action-duplicate')[0].props.onClick();
  assert.equal(c.state.tasks.length, 4, 'the menu runs the same duplicateMulti');
  assert.equal(c.state.detailMenu, false, 'and closes');
});

test('the Details disclosure holds description, subtasks and the diagnostics, collapsed until used', () => {
  const { c } = setup();
  c.setState({ detailId: 'a' });
  assert.equal(byQa(c.renderDetail(), 'detail-more-body').length, 0, 'collapsed for a task with nothing in it');
  byQa(c.renderDetail(), 'detail-more')[0].props.onClick();
  const t = textOf(c.renderDetail());
  for (const w of ['Description', 'Subtasks', 'Include today', 'Progress', 'Spent', 'Allotted today', 'Span', 'Type', 'Completed'])
    assert.match(t, new RegExp(w), w + ' is inside Details');
  // A task that HAS a description opens with Details showing it.
  c.commit((ts) => { ts.find((x) => x.id === 'b').description = '<p>Detergent</p>'; });
  c.setState({ detailId: 'b', detailMore: null });
  assert.equal(byQa(c.renderDetail(), 'detail-more-body').length, 1);
});

// ---------------------------------------------------------------------------
// The When line: a partial parse is previewed, never silently applied
// ---------------------------------------------------------------------------

test('a partial When parse is refused with a preview and the leftover words', () => {
  withNow(FIXED_NOW, () => {
    const { c } = setup();
    const before = JSON.stringify(task(c, 'a'));
    const r = c.applyWhenText('a', 'next tuesday-ish probably');
    assert.equal(r.ok, false);
    assert.equal(r.partial, true);
    assert.equal(r.leftover, 'probably');
    assert.ok(r.preview, 'it says what WOULD be saved');
    assert.equal(JSON.stringify(task(c, 'a')), before, 'nothing was written');
    // The explicit confirm.
    assert.equal(c.applyWhenText('a', 'next tuesday-ish probably', { force: true }).ok, true);
    assert.notEqual(JSON.stringify(task(c, 'a')), before);
  });
});

test('Enter in the When editor applies only a clean parse; Apply anyway is the explicit confirm', () => {
  withNow(FIXED_NOW, () => {
    const { c } = setup();
    c.setState({ detailId: 'a', whenEdit: { id: 'a', text: '', text0: '', live: '', error: null } });
    const before = JSON.stringify(task(c, 'a'));
    const input = byQa(c.renderDetail(), 'when-input')[0];
    input.props.onKeyDown({ key: 'Enter', preventDefault() {}, target: { value: 'friday maybe' } });
    assert.equal(JSON.stringify(task(c, 'a')), before, 'Enter did not apply a partial parse');
    assert.equal(c.state.whenEdit.partial, true);
    const tree = c.renderDetail();
    assert.match(textOf(byQa(tree, 'when-error')), /maybe/, 'the leftover word is named');
    assert.match(textOf(byQa(tree, 'when-preview')), /It would save/);
    byQa(tree, 'when-apply-anyway')[0].props.onClick();
    assert.notEqual(JSON.stringify(task(c, 'a')), before, 'Apply anyway saves the preview');
    assert.equal(c.state.whenEdit, null);

    c.setState({ whenEdit: { id: 'a', text: '', text0: '', live: '', error: null } });
    byQa(c.renderDetail(), 'when-input')[0].props.onKeyDown({ key: 'Enter', preventDefault() {}, target: { value: 'tomorrow 3-4pm' } });
    assert.equal(c.state.whenEdit, null, 'a clean parse applies on Enter');
    assert.equal(new Date(task(c, 'a').start).getHours(), 15);
  });
});

test('the live preview names leftovers while typing', () => {
  withNow(FIXED_NOW, () => {
    const { c } = setup();
    c.setState({ detailId: 'a', whenEdit: { id: 'a', text: 'x', text0: 'x', live: 'friday probably', error: null } });
    assert.match(textOf(byQa(c.renderDetail(), 'when-live-warn')), /probably/);
    c.setState({ whenEdit: { id: 'a', text: 'x', text0: 'x', live: 'friday', error: null } });
    assert.match(textOf(byQa(c.renderDetail(), 'when-preview')), /Saves as/);
  });
});

test('closing the detail with a half-understood When draft keeps the stored dates and says so', () => {
  withNow(FIXED_NOW, () => {
    const { c } = setup();
    const before = JSON.stringify(task(c, 'a'));
    c.setState({ detailId: 'a', whenEdit: { id: 'a', text: 'friday maybe', error: 'Didn’t understand “maybe”', partial: true } });
    c.closeDetail();
    assert.equal(JSON.stringify(task(c, 'a')), before);
    assert.match(c.state.toast.msg, /Dates not changed/);
    assert.equal(c.state.whenEdit, null);
  });
});

// ---------------------------------------------------------------------------
// One end-date formatter
// ---------------------------------------------------------------------------

test('a midnight end on a non-all-day task names its own day (the Oct 4 → Oct 3 slip)', () => {
  const { c, B } = setup([{ id: 'g', name: 'Groceries', start: null, end: null }]);
  c.commit((ts) => { const g = ts.find((x) => x.id === 'g'); g.start = B; g.end = B; });
  const g = task(c, 'g');
  assert.equal(c.fmtEnd(g), c.fmtDT(B, true));
  const w = c.whenSentence(g);
  assert.equal(w.text, c.fmtDT(B, true), 'one day, not "→ the day before"');
  assert.doesNotMatch(w.text, /→| to /);
  assert.equal(c.sheetDateParts(g, 'end').date, c.fmtEnd(g, { style: 'short' }), 'the sheet and the sentence agree');
});

test('a deadline at a bare midnight reads as that day; all-day exclusive ends read the day before', () => {
  const { c, B } = setup([
    { id: 'd', name: 'Report', start: null, end: null },
    { id: 'ad', name: 'Trip', start: null, end: null },
  ]);
  c.commit((ts) => {
    const d = ts.find((x) => x.id === 'd'); d.end = B + 3 * DAY;
    const ad = ts.find((x) => x.id === 'ad'); ad.allDay = true; ad.start = B; ad.end = B + 3 * DAY;
  });
  assert.equal(c.whenSentence(task(c, 'd')).text, 'by ' + c.fmtDT(B + 3 * DAY, true));
  assert.equal(c.fmtEnd(task(c, 'ad')), c.fmtDT(B + 2 * DAY, true), 'all-day: the exclusive end minus one day');
  assert.equal(c.whenSentence(task(c, 'ad')).text, c.fmtDT(B, true) + ' to ' + c.fmtDT(B + 2 * DAY, true));
  assert.equal(c.sheetDateParts(task(c, 'ad'), 'end').date, c.fmtEnd(task(c, 'ad'), { style: 'short' }));
});

test('a same-day timed end carries its clock; a date-only end never shows 12:00am', () => {
  const { c, B } = setup();
  c.commit((ts) => { const a = ts.find((x) => x.id === 'a'); a.start = B + 9 * 3600000; a.end = B + 10 * 3600000; a.startClock = true; a.endClock = true; });
  assert.equal(c.fmtEnd(task(c, 'a')), c.fmtDT(B, true) + ', 10:00am');
  assert.equal(c.fmtEnd(task(c, 'b')), c.fmtDT(task(c, 'b').end, true), 'no clock on a bare date');
  assert.doesNotMatch(c.fmtEnd(task(c, 'b')), /12:00am/);
});

test('the multi-day When sentence round-trips through the parser without drifting a day', () => {
  withNow(FIXED_NOW, () => {
    const { c } = setup();
    const before = task(c, 'a');
    const s = c.whenSentence(before).text;
    assert.match(s, / to /);
    const pv = c.whenPreview('a', s);
    assert.equal(pv.leftover, '', 'the sentence parses completely');
    assert.equal(pv.text, s, 'and reads back as itself');
  });
});

test('the bar menu names the end edge "End" and formats it through the shared formatter', () => {
  const { c } = setup();
  c.setState({ barMenu: { id: 'b', occIdx: null, x: 0, y: 0, cx: 0, cy: 0 } });
  const txt = textOf(c.renderBarMenu());
  assert.match(txt, /End…/);
  assert.doesNotMatch(txt, /Due…/);
  assert.ok(txt.includes(c.fmtEnd(task(c, 'b'))));
});

// ---------------------------------------------------------------------------
// Subtasks named inline
// ---------------------------------------------------------------------------

test('adding a subtask opens a focused inline name field; Enter adds a sibling; an empty one is removed', () => {
  const { c } = setup();
  c.setState({ detailId: 'a', selectedIds: ['a'] });
  const n = c.state.tasks.length;
  const add = byQa(c.renderDetail(), 'detail-more')[0];
  add.props.onClick();
  byQa(c.renderDetail(), 'add-subtask')[0].props.onClick();
  const id1 = c.state.subEdit.id;
  assert.equal(c.state.tasks.length, n + 1);
  assert.equal(task(c, id1).parentId, 'a');
  assert.equal(c._subFocus, id1, 'the new field takes focus on mount');
  assert.deepEqual(Array.from(c.state.selectedIds), ['a'], 'the selection stays on the open task');
  c.renderVals();
  const input = byQa(c.renderDetail(), 'subtask-name')[0];
  assert.ok(input, 'an inline name field is rendered for it');
  input.props.onKeyDown({ key: 'Enter', preventDefault() {}, target: { value: 'Buy milk' } });
  assert.equal(task(c, id1).name, 'Buy milk');
  const id2 = c.state.subEdit.id;
  assert.notEqual(id2, id1, 'Enter added a sibling and moved the field to it');
  assert.equal(task(c, id2).parentId, 'a');
  c.renderVals();
  const native = {};
  byQa(c.renderDetail(), 'subtask-name')[0].props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {},
    nativeEvent: native, target: { value: '' } });
  assert.equal(task(c, id2), undefined, 'Escape on an empty subtask removes it');
  assert.equal(c.state.subEdit, null);
  c.onKey(Object.assign(native, key('Escape')));
  assert.equal(c.state.detailId, 'a', 'that Escape is not also taken by the ladder (the dialog stays open)');
});

// ---------------------------------------------------------------------------
// Date picker keyboard reach
// ---------------------------------------------------------------------------

test('date picker: one roving tab stop on the draft day, arrows move it, Done precedes Clear', () => {
  const { c, B } = setup();
  const ms = B + 9 * 3600000;
  c.setState({ datePick: { id: 'a', key: 'start', x: 0, y: 0, ms, view: ms, text: '' } });
  const tree = c.renderDatePick();
  const days = find(tree, (p) => p.role === 'gridcell');
  assert.ok(days.length >= 28);
  const stops = days.filter((d) => d.props.tabIndex === 0);
  assert.equal(stops.length, 1, 'exactly one day is a tab stop');
  assert.equal(stops[0].props['aria-selected'], 'true', 'and it is the draft day');
  stops[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
  assert.equal(c.startOfDay(c.state.datePick.ms), c.startOfDay(ms + DAY), 'ArrowRight moves a day');
  const btns = find(c.renderDatePick(), (p, n) => n.type === 'button').map((n) => textOf(n).trim());
  assert.ok(btns.indexOf('Done') >= 0 && btns.indexOf('Done') < btns.indexOf('Clear'), btns.join(','));
  assert.match(textOf(byQa(c.renderDatePick(), 'dp-head')), /^Start/, 'sentence-case header');
});
