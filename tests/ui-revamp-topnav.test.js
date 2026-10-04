// UI revamp block 1 — one top navigation: Plan · Focus · Review · Journal.
// The left icon rail is gone; Archive is reached from Review (and its own page links back to Plan);
// the Journal day-nav and the archive count live in their own pages, so the top bar is the same everywhere.
// Internal state names (`mainView`, `dashMode`) are unchanged — only the presentation moved.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const textOf = (n) => n == null ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const tabs = (c) => find(c.renderTopNav(), (p) => p.role === 'tab');

test('the top nav is one tab group: Plan · Focus · Review · Journal', () => {
  const c = make();
  const t = tabs(c);
  assert.deepEqual(t.map((x) => textOf(x)), ['Plan', 'Focus', 'Review', 'Journal']);
  for (const x of t) {
    assert.equal(x.props.tabIndex, 0, 'every tab is keyboard-reachable');
    assert.ok(parseInt(x.props.style.height, 10) >= c.HIT_MIN_PX, 'every tab is at least a HIT_MIN_PX target');
  }
});

test('the top bar is the same on every page — the context slot always holds the nav', () => {
  const c = make();
  for (const v of ['dashboard', 'journal', 'archive', 'gantt']) {
    c.state.mainView = v;
    assert.deepEqual(find(c.renderTopContext(), (p) => p.role === 'tab').map((x) => textOf(x)),
      ['Plan', 'Focus', 'Review', 'Journal'], 'on ' + v);
  }
});

test('which tab is current: Overview reads as Plan, and Archive lives under Plan', () => {
  const c = make();
  assert.equal(c.topNavKey('dashboard', 'overview'), 'plan');
  assert.equal(c.topNavKey('dashboard', 'focus'), 'focus');
  assert.equal(c.topNavKey('dashboard', 'review'), 'review');
  assert.equal(c.topNavKey('journal', 'focus'), 'journal');
  assert.equal(c.topNavKey('archive', 'review'), 'plan');
  assert.equal(c.topNavKey('gantt', 'overview'), 'plan');
});

test('exactly one tab is aria-selected', () => {
  const c = make();
  c.state.mainView = 'journal';
  const sel = tabs(c).filter((x) => x.props['aria-selected']);
  assert.deepEqual(sel.map((x) => textOf(x)), ['Journal']);
});

test('tabs map onto the unchanged state names, from any page', () => {
  const c = make();
  const seen = [];
  c.trackAction = (name, p) => seen.push([name, p]);
  c.state.mainView = 'journal'; c.state.dashMode = 'overview';
  c.goTopNav('review');
  assert.equal(c.state.mainView, 'dashboard');
  assert.equal(c.state.dashMode, 'review');
  assert.ok(seen.some(([n, p]) => n === 'view.switch' && p.to === 'dashboard'), 'the page switch is tracked');
  assert.ok(seen.some(([n, p]) => n === 'tab.switch' && p.from === 'overview' && p.to === 'review'), 'tab.switch kept');

  c.goTopNav('plan');
  assert.equal(c.state.dashMode, 'overview', 'Plan is dashMode overview');

  c.goTopNav('journal');
  assert.equal(c.state.mainView, 'journal');
  assert.ok(seen.some(([n, p]) => n === 'view.switch' && p.to === 'journal'), 'the Journal switch is tracked');
});

test('Enter and Space on a tab navigate', () => {
  const c = make();
  c.state.mainView = 'dashboard'; c.state.dashMode = 'overview';
  const focusTab = tabs(c)[1];
  let prevented = 0;
  focusTab.props.onKeyDown({ key: 'Enter', preventDefault: () => prevented++ });
  assert.equal(c.state.dashMode, 'focus');
  tabs(c)[3].props.onKeyDown({ key: ' ', preventDefault: () => prevented++ });
  assert.equal(c.state.mainView, 'journal');
  assert.equal(prevented, 2);
});

test('the left rail is retired: the board mounts no page-switch buttons', () => {
  const c = make();
  c.renderVals();
  const board = c.renderBoard([]);
  const rail = find(board, (p) => p.role === 'button' && (p.title === 'Dash' || p.title === 'Archive'));
  assert.equal(rail.length, 0);
});

test('Review links to the archive, with the archived count', () => {
  const c = make();
  c.state.tasks = [{ id: 'a', name: 'old', archivedAt: 1 }, { id: 'b', name: 'old2', archivedAt: 2 }];
  const link = find(c.renderDashReview(), (p) => p['data-archive-link'] === 'review');
  assert.equal(link.length, 1);
  assert.equal(textOf(link[0]), 'Archived tasks (2)');
  link[0].props.onClick();
  assert.equal(c.state.mainView, 'archive');
});

test('the archive page carries its own count and a way back to Plan', () => {
  const c = make();
  for (const tasks of [[], [{ id: 'a', name: 'old', archivedAt: 1 }]]) {
    c.state.tasks = tasks; c.state.mainView = 'archive'; c.state.dashMode = 'review';
    const page = c.renderArchiveView();
    assert.equal(find(page, (p) => p['data-archive-count'] === String(tasks.length)).length, 1);
    const back = find(page, (p) => p['data-archive-back']);
    assert.equal(textOf(back[0]), '← Back to Plan');
    back[0].props.onClick();
    assert.equal(c.state.mainView, 'dashboard');
    assert.equal(c.state.dashMode, 'overview');
  }
});

test('the Journal day-nav sits in the Journal page header', () => {
  const c = make();
  c.state.mainView = 'journal';
  const head = find(c.renderJournalView(), (p) => p['data-journal-head']);
  assert.equal(head.length, 1);
  assert.match(textOf(head[0]), /‹.*›/);
});
