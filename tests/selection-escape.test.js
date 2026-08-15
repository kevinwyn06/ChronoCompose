// #109 — "nothing selected" is the default, is a state the app can HOLD, and Escape is how you get
// back to it. Owner: *"the default should be nothing is highlighted, and clear selection with Esc."*
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask } = require('./_load.js');

// The usage tracker's key funnel runs first in onKey and reads `e.target` through the DOM; a bare
// fixture event has no real node, so every test here boots with tracking off (as e2e does too).
function comp(n) {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.tasks = [];
  for (let i = 0; i < (n || 3); i++) c.state.tasks.push(activeTask(c, { id: 't' + i, name: 'T' + i }));
  return c;
}
function esc(target) {
  return { key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    target: target || null, preventDefault() {} };
}
// The component runs in a VM context, so its arrays have a different Array.prototype than this
// file's literals; deepStrictEqual compares prototypes. Copy into a host array before asserting.
function sel(c) { return Array.from(c.state.selectedIds); }
const INPUT = { tagName: 'INPUT', isContentEditable: false, matches: () => true };
const EDITABLE = { tagName: 'DIV', isContentEditable: true, matches: () => false };

test('the default is nothing selected', () => {
  const c = comp();
  assert.deepStrictEqual(sel(c), [], 'fresh state selects nothing');
  assert.strictEqual(c.state.detailId, null);
  assert.strictEqual(c.state.selCursor, null);
  assert.ok(c.state.tasks.every((t) => !c.isSel(t.id)), 'no task reads as selected');
});

// The rule this file exists for: empty must be HOLDABLE. Nothing may quietly fall back to the first
// task — not a re-render, not a mutation through commit(), not a repeated Escape.
test('empty selection is holdable — nothing re-seeds it', () => {
  const c = comp();
  c.setState({ selectedIds: ['t1'] });
  c.clearSelection();
  assert.deepStrictEqual(sel(c), []);

  c.forceUpdate();
  assert.deepStrictEqual(sel(c), [], 'a re-render does not select anything');

  c.commit((tasks) => { tasks[0].pct = 10; });
  assert.deepStrictEqual(sel(c), [], 'a task mutation does not select anything');

  c.onKey(esc());
  c.onKey(esc());
  assert.deepStrictEqual(sel(c), [], 'repeated Escape stays empty (idempotent)');
  assert.ok(c.state.tasks.every((t) => !c.isSel(t.id)));
});

test('clearSelection empties rows, columns and the Selection cursor together', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0', 't1'], selCols: ['name'], selCursor: 't1', menu: { id: 't0' } });
  c.clearSelection();
  assert.deepStrictEqual(sel(c), []);
  assert.deepStrictEqual(Array.from(c.state.selCols), []);
  assert.strictEqual(c.state.selCursor, null, 'the j/k cursor would otherwise repaint the highlight');
  assert.strictEqual(c.state.menu, null);
});

test('Escape clears the selection when nothing is in flight and nothing is open', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0', 't2'], selCursor: 't2' });
  c.onKey(esc());
  assert.deepStrictEqual(sel(c), []);
  assert.strictEqual(c.state.selCursor, null);
});

// ---- the ladder: exactly one rung per press, most transient first -------------------------------
test('rung 1 — an in-flight drag outranks the selection', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0'] });
  c._blockDrag = { taskId: 't0' };
  c.onKey(esc());
  assert.strictEqual(c._blockDrag, null, 'the drag is cancelled');
  assert.deepStrictEqual(sel(c), ['t0'], 'and the selection survives that press');

  c._edgeDrag = { taskId: 't0' };
  c.onKey(esc());
  assert.strictEqual(c._edgeDrag, null);
  assert.deepStrictEqual(sel(c), ['t0']);

  c.onKey(esc()); // nothing left in flight — now the selection goes
  assert.deepStrictEqual(sel(c), []);
});

test('rung 2 — an open overlay outranks the selection', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0'], settingsOpen: true });
  c.onKey(esc());
  assert.strictEqual(c.state.settingsOpen, false, 'the overlay closes');
  assert.deepStrictEqual(sel(c), ['t0'], 'the selection is untouched by that press');
  c.onKey(esc());
  assert.deepStrictEqual(sel(c), [], 'the next press clears it');
});

test('rung 3 — the detail sheet closes before the selection clears', () => {
  const c = comp();
  c.openDetail('t1');
  assert.strictEqual(c.state.detailId, 't1');
  c.onKey(esc());
  assert.strictEqual(c.state.detailId, null, 'detail closes first');
  assert.deepStrictEqual(sel(c), ['t1'], 'the row it opened from stays selected');
  c.onKey(esc());
  assert.deepStrictEqual(sel(c), [], 'a second press clears the row');
});

test('Escape while typing never clears the selection', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0'] });
  c.onKey(esc(INPUT));
  assert.deepStrictEqual(sel(c), ['t0'], 'inline title editor / quick-add input');
  c.onKey(esc(EDITABLE));
  assert.deepStrictEqual(sel(c), ['t0'], 'contenteditable description / journal prose');
  c.onKey(esc(null));
  assert.deepStrictEqual(sel(c), [], 'but a press outside any field does clear it');
});
