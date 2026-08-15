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

// Owner, 2026-08-15: the Escape deselect looked missing because it cost TWO presses. A row click is one
// gesture that sets `selectedIds` AND `detailId` in the same setState, so the ladder charged for each
// half separately: press one closed the sheet, the row stayed lit, and the feature read as absent.
// Rungs 3 and 4 therefore COLLAPSE when the open sheet is the sole selected row — one gesture, one press.
test('rung 3 — one Escape undoes a row click entirely (sheet + selection)', () => {
  const c = comp();
  c.openDetail('t1');
  assert.strictEqual(c.state.detailId, 't1');
  assert.deepStrictEqual(sel(c), ['t1'], 'opening details selects the row');
  c.onKey(esc());
  assert.strictEqual(c.state.detailId, null, 'the sheet closes');
  assert.deepStrictEqual(sel(c), [], 'and the row it opened from is deselected by the SAME press');
});

// The collapse is conditional, not a shortcut bolted on top. When the sheet and the selection have
// drifted apart they are genuinely two contexts, and the ladder still charges one press for each.
test('rung 3 stays a separate rung when the sheet is NOT the selection', () => {
  const c = comp();
  c.setState({ selectedIds: ['t0', 't2'] });
  c.openDetail('t1');
  c.setState({ selectedIds: ['t0', 't2'] }); // a range selected, a different row's sheet open
  c.onKey(esc());
  assert.strictEqual(c.state.detailId, null, 'the sheet closes first');
  assert.deepStrictEqual(sel(c), ['t0', 't2'], 'the unrelated range survives that press');
  c.onKey(esc());
  assert.deepStrictEqual(sel(c), [], 'the next press clears it');
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

// ---------------------------------------------------------------------------------------------------
// Owner, 2026-08-15: *"I'm unable to use arrow keys or enter on that sticky highlighted task. Not
// something I want to begin with. That's why I think it's too sticky."* The complaint is not really the
// stickiness — it is that a persistent selection cost something and returned nothing. These pin the
// keyboard model that makes it earn its keep: ↑/↓ move, Shift+↑/↓ extend, Enter opens.
// ---------------------------------------------------------------------------------------------------
function key(k, opts) {
  return Object.assign({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    target: null, preventDefault() {} }, opts || {});
}
// Navigation walks the VISIBLE list. `_visTasks` is what the renderer publishes and what onMouseUp
// already resolves dependency drops against; tests set it directly rather than driving a full render.
function navComp(n) {
  const c = comp(n);
  c._visTasks = c.state.tasks;
  return c;
}

test('↓ and ↑ move the selection one visible row at a time', () => {
  const c = navComp(4);
  c.setState({ selectedIds: ['t1'] });
  c._selAnchor = 't1';
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t2'], 'down moves to the next row');
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t3']);
  c.onKey(key('ArrowUp'));
  assert.deepStrictEqual(sel(c), ['t2'], 'up moves back');
});

test('arrow navigation stops at both ends instead of wrapping', () => {
  const c = navComp(3);
  c.setState({ selectedIds: ['t0'] });
  c._selAnchor = 't0';
  c.onKey(key('ArrowUp'));
  assert.deepStrictEqual(sel(c), ['t0'], 'up at the top is a no-op, not a wrap to the bottom');
  c.setState({ selectedIds: ['t2'] });
  c._selAnchor = 't2';
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t2'], 'down at the bottom is a no-op');
});

// The owner's addition to the brief: "also add stuff like shift + up/down."
test('Shift+↓ extends the range from the anchor, and Shift+↑ shrinks it back', () => {
  const c = navComp(5);
  c.setState({ selectedIds: ['t1'] });
  c._selAnchor = 't1';
  c.onKey(key('ArrowDown', { shiftKey: true }));
  assert.deepStrictEqual(sel(c), ['t1', 't2'], 'the first extend grows a two-row range');
  c.onKey(key('ArrowDown', { shiftKey: true }));
  assert.deepStrictEqual(sel(c), ['t1', 't2', 't3']);
  c.onKey(key('ArrowUp', { shiftKey: true }));
  assert.deepStrictEqual(sel(c), ['t1', 't2'], 'the anchor holds and the far end comes back');
});

test('a plain arrow after a Shift range collapses to a single row', () => {
  const c = navComp(5);
  c.setState({ selectedIds: ['t1'] });
  c._selAnchor = 't1';
  c.onKey(key('ArrowDown', { shiftKey: true }));
  c.onKey(key('ArrowDown', { shiftKey: true }));
  assert.strictEqual(sel(c).length, 3);
  c.onKey(key('ArrowDown'));
  assert.strictEqual(sel(c).length, 1, 'a plain arrow is a move, not an extend');
});

// A move must NOT open the sheet even though a row CLICK does: ↓↓↓ would be unusable, and each sheet
// would land under the next Escape — the exact two-press problem fixed above.
test('arrow navigation never opens the detail sheet; Enter is the explicit open', () => {
  const c = navComp(3);
  c.setState({ selectedIds: ['t0'] });
  c._selAnchor = 't0';
  c.onKey(key('ArrowDown'));
  assert.strictEqual(c.state.detailId, null, 'moving does not open anything');
  c.onKey(key('Enter'));
  assert.strictEqual(c.state.detailId, 't1', 'Enter opens the row the cursor is on');
});

test('Enter does nothing on a multi-row range — there is no single row to open', () => {
  const c = navComp(4);
  c.setState({ selectedIds: ['t0', 't1'] });
  c.onKey(key('Enter'));
  assert.strictEqual(c.state.detailId, null, 'Enter declines to guess which row was meant');
});

// The guard that keeps a sticky selection from being a tax on everything else: with nothing selected the
// arrows are not claimed at all, so they still scroll the pane.
test('with nothing selected the arrow keys are not claimed', () => {
  const c = navComp(3);
  let prevented = false;
  c.onKey(key('ArrowDown', { preventDefault() { prevented = true; } }));
  assert.strictEqual(prevented, false, 'the app does not swallow the key');
  assert.deepStrictEqual(sel(c), [], 'and selects nothing');
});

test('arrow keys stay out of the way while typing and inside an open overlay', () => {
  const c = navComp(3);
  c.setState({ selectedIds: ['t0'] });
  c._selAnchor = 't0';
  c.onKey(key('ArrowDown', { target: INPUT }));
  assert.deepStrictEqual(sel(c), ['t0'], 'the caret moves in the field, the selection does not');
  c.setState({ settingsOpen: true });
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t0'], 'an open overlay owns its own arrows');
  c.setState({ settingsOpen: false });
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t1'], 'and navigation resumes once it closes');
});

// The Selection grid already owns j/k/space for the same "current row" idea; two cursors in one view
// would be worse than one.
test('the Selection grid keeps its own cursor — arrows are not claimed there', () => {
  const c = navComp(3);
  c.setState({ selectedIds: ['t0'], mainView: 'dashboard', dashMode: 'overview', leftSurface: 'select' });
  c._selAnchor = 't0';
  c.onKey(key('ArrowDown'));
  assert.deepStrictEqual(sel(c), ['t0'], 'the grid view is excluded');
});
