// Bulk snooze — the inclusion popover's three snooze durations, applied to a multi-selection from the row
// menu (Shift+F10 / right-click) and from the bulk-action bar. One commit, one undo step; each kind writes
// exactly what its single-task verb writes; done, archived and milestone rows are skipped.
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

function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  const T = (id, name, extra) => c.normalizeTask(Object.assign({ id, name, type: 'Proportional',
    start: null, end: null, priority: 4, deps: [], pct: 0, planned: 60, labels: [] }, extra || {}));
  c.state.tasks = [T('a', 'Answer emails'), T('b', 'Read chapter'), T('c', 'Call the bank'),
    T('done', 'Finished thing', { pct: 100, completion: Date.now() })];
  c.savePrefs = () => {};
  c.renderVals();
  return c;
}
const byId = (c, id) => c.state.tasks.find((t) => t.id === id);
const menuItem = (c, re) => find(c.renderMenu(), (p) => p.role === 'menuitem').find((n) => re.test(textOf(n)));

test('the multi-select row menu offers the three snooze durations', () => {
  const c = setup();
  c.setState({ menu: { x: 10, y: 10, ids: ['a', 'b'] } });
  const all = textOf(c.renderMenu());
  assert.match(all, /Snooze/);
  assert.ok(menuItem(c, /Today$/), 'Today');
  assert.ok(menuItem(c, /Until it's relevant$/), "Until it's relevant");
  assert.ok(find(c.renderMenu(), (p) => p['data-pp-snooze-until'] === '1').length, 'the typed "until…" input');
});

test('row menu: Today snoozes every selected task until tomorrow in one undo step', () => {
  const c = setup();
  c.setState({ menu: { x: 10, y: 10, ids: ['a', 'b'] } });
  menuItem(c, /Today$/).props.onClick();
  const tomorrow = c.startOfToday() + c.DAY;
  for (const id of ['a', 'b']) {
    assert.equal(byId(c, id).snoozeUntil, tomorrow, id);
    assert.ok(byId(c, id).snoozedAt != null, id + ' stamps snoozedAt');
    assert.equal(c.inclState(byId(c, id)), 'snoozed');
  }
  assert.equal(byId(c, 'c').snoozeUntil, null, 'unselected rows are untouched');
  assert.equal(c.state.menu, null, 'the menu closes');
  assert.match(c.state.toast.msg, /2 tasks snoozed for today/);
  assert.equal(c.state.toast.undo, true);
  c.undoAndConfirm();
  assert.ok(['a', 'b'].every((id) => byId(c, id).snoozeUntil == null), 'one undo restores both');
});

test("row menu: Until it's relevant writes the open-ended snooze, like snoozeIndefinitely", () => {
  const c = setup();
  c.setState({ menu: { x: 10, y: 10, ids: ['a', 'c'] } });
  menuItem(c, /Until it's relevant$/).props.onClick();
  for (const id of ['a', 'c']) {
    assert.equal(byId(c, id).snoozeIndef, true);
    assert.equal(byId(c, id).snoozeUntil, null);
    assert.ok(c.snoozeIsOpenEnded(byId(c, id)));
  }
  assert.match(c.state.toast.msg, /until it's relevant/);
});

test('row menu: the typed input snoozes until the parsed day; a typo commits nothing and keeps the menu', () => {
  const c = setup();
  c.setState({ menu: { x: 10, y: 10, ids: ['a', 'b'] } });
  const inp = () => find(c.renderMenu(), (p) => p['data-pp-snooze-until'] === '1')[0];
  let stopped = false;
  const key = (k, value) => ({ key: k, target: { value }, preventDefault() {}, stopPropagation() { stopped = true; } });
  inp().props.onKeyDown(key(' ', 'blorp '));
  assert.ok(stopped, 'the input keeps Space from the menu key handler');
  inp().props.onKeyDown(key('Enter', 'blorp'));
  assert.ok(['a', 'b'].every((id) => byId(c, id).snoozeUntil == null), 'unparseable: no commit');
  assert.ok(c.state.menu, 'unparseable: the menu stays open');
  inp().props.onKeyDown(key('Enter', '3 days'));
  const want = c.parseSnoozeText('3 days', c.state.nowTick || Date.now());
  assert.ok(want > c.startOfToday());
  assert.ok(['a', 'b'].every((id) => byId(c, id).snoozeUntil === want));
  assert.match(c.state.toast.msg, /2 tasks snoozed until /);
});

test('done, archived and milestone tasks are skipped and the toast says so', () => {
  const c = setup();
  c.snoozeMulti(['a', 'done'], 'today');
  assert.ok(byId(c, 'a').snoozeUntil != null);
  assert.equal(byId(c, 'done').snoozeUntil, null);
  assert.match(c.state.toast.msg, /Snoozed “Answer emails” for today · 1 skipped/);
  c.setState({ menu: { x: 10, y: 10, ids: ['done'] } });
  assert.ok(!/Snooze/.test(textOf(c.renderMenu())), 'no Snooze block when nothing selected can be snoozed');
});

test('the bulk bar has a Snooze picker that runs the same verb', () => {
  const c = setup();
  c.setState({ selectedIds: ['a', 'b'] });
  const ctl = () => find(c.renderFilterBar(null), (p) => p['data-pp-bulk'] === 'snooze')[0];
  assert.ok(ctl(), 'Snooze picker present');
  ctl().props.onChange({ target: { value: 'relevant' } });
  assert.ok(['a', 'b'].every((id) => byId(c, id).snoozeIndef === true));
  c.undoAndConfirm();
  ctl().props.onChange({ target: { value: 'until:1 week' } });
  const want = c.parseSnoozeText('1 week', c.state.nowTick || Date.now());
  assert.ok(want != null && ['a', 'b'].every((id) => byId(c, id).snoozeUntil === want));
});
