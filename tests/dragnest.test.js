// Drag-to-nest (row drag re-parents by horizontal offset): the pure drop projection
// projectRowDrop() and the dropRows() mutation. See index.html PP-EXT "drag-to-nest".
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask } = require('./_load.js');

// Build vis/depth/byId inputs for projectRowDrop from a flat [{id,parentId}] list.
// The list IS the visible order; depth is derived from the parent chain.
function ctx(rows) {
  const byId = {};
  rows.forEach(r => { byId[r.id] = { id: r.id, parentId: r.parentId == null ? null : r.parentId }; });
  const depthOf = {};
  const dep = id => { let d = 0, p = byId[id].parentId; while (p != null) { d++; p = byId[p] ? byId[p].parentId : null; } return d; };
  rows.forEach(r => { depthOf[r.id] = dep(r.id); });
  const vis = rows.map(r => byId[r.id]);
  return { vis, depthOf, byId };
}
const moveOf = (...ids) => { const m = {}; ids.forEach(id => m[id] = 1); return m; };

test('projectRowDrop: plain vertical drop stays a sibling of the row above (steps 0)', () => {
  const c = make();
  const { vis, depthOf, byId } = ctx([{ id: 'a' }, { id: 'b' }, { id: 'z' }]);
  // drop z into the gap between a and b (overIndex 1), no horizontal intent
  const r = c.projectRowDrop(vis, depthOf, byId, 1, moveOf('z'), 0);
  assert.equal(r.index, 1); assert.equal(r.depth, 0); assert.equal(r.parentId, null);
});

test('projectRowDrop: one step right nests under the row above', () => {
  const c = make();
  const { vis, depthOf, byId } = ctx([{ id: 'a' }, { id: 'b' }, { id: 'z' }]);
  const r = c.projectRowDrop(vis, depthOf, byId, 1, moveOf('z'), 1);
  assert.equal(r.depth, 1);
  assert.equal(r.parentId, 'a');
});

test('projectRowDrop: dropping among a subtree defaults to sibling of the child above', () => {
  const c = make();
  // p > c1 ; then root b. Drop b into the gap after c1 (overIndex 2).
  const { vis, depthOf, byId } = ctx([{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'b' }]);
  const r0 = c.projectRowDrop(vis, depthOf, byId, 2, moveOf('b'), 0);
  assert.equal(r0.depth, 1, 'matches the neighbour depth');
  assert.equal(r0.parentId, 'p', 'becomes a sibling of c1 under p');
  // one step left → outdent to root
  const rL = c.projectRowDrop(vis, depthOf, byId, 2, moveOf('b'), -1);
  assert.equal(rL.depth, 0); assert.equal(rL.parentId, null);
  // one step right → nest under c1
  const rR = c.projectRowDrop(vis, depthOf, byId, 2, moveOf('b'), 1);
  assert.equal(rR.depth, 2);
  assert.equal(rR.parentId, 'c1');
});

test('projectRowDrop: cannot go shallower than the row below (clamped to next depth)', () => {
  const c = make();
  // p > c1, c2 ; drop x into the gap between c1 and c2 (overIndex 2). next=c2 (depth 1).
  const { vis, depthOf, byId } = ctx([{ id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' }, { id: 'x' }]);
  const r = c.projectRowDrop(vis, depthOf, byId, 2, moveOf('x'), -5);
  assert.equal(r.depth, 1, 'clamped up to c2 depth so it would not swallow c2');
  assert.equal(r.parentId, 'p');
});

test('projectRowDrop: deepest allowed is one below the row above (clamped)', () => {
  const c = make();
  const { vis, depthOf, byId } = ctx([{ id: 'a' }, { id: 'z' }]);
  const r = c.projectRowDrop(vis, depthOf, byId, 1, moveOf('z'), 9);
  assert.equal(r.depth, 1, 'cannot be deeper than a child of a');
  assert.equal(r.parentId, 'a');
});

test('projectRowDrop: moving subtree is skipped for neighbour detection (no cycle)', () => {
  const c = make();
  // a ; p > c1 > g1 ; b. Drag p (whole subtree moving) into a gap inside itself (overIndex 3).
  const { vis, depthOf, byId } = ctx([
    { id: 'a' }, { id: 'p' }, { id: 'c1', parentId: 'p' }, { id: 'g1', parentId: 'c1' }, { id: 'b' }]);
  const r = c.projectRowDrop(vis, depthOf, byId, 3, moveOf('p', 'c1', 'g1'), 0);
  // prev walks back past the moving rows to `a`; parent is never inside the moving subtree
  assert.equal(r.parentId, null);
  assert.notEqual(r.parentId, 'c1');
});

test('dropRows re-parents the moving root and re-gathers its subtree contiguously', () => {
  const c = make();
  const a = activeTask(c, { id: 'a', name: 'A' });
  const b = activeTask(c, { id: 'b', name: 'B' });
  const z = activeTask(c, { id: 'z', name: 'Z' });
  c.state.tasks = [a, b, z];
  c._visTasks = c.state.tasks;
  c.reorderRows(['z'], 1, 'a'); // drop z under a, at the gap before b
  const byId = {}; c.state.tasks.forEach(t => byId[t.id] = t);
  assert.equal(byId['z'].parentId, 'a');
  assert.equal(c.state.tasks.map(t => t.id).join(','), 'a,z,b', 'z sits inside a, before b');
});

test('dropRows to top level (parentId null) outdents a child', () => {
  const c = make();
  const p = activeTask(c, { id: 'p', name: 'P' });
  const c1 = activeTask(c, { id: 'c1', name: 'C1', parentId: 'p' });
  const q = activeTask(c, { id: 'q', name: 'Q' });
  c.state.tasks = [p, c1, q];
  c._visTasks = c.state.tasks;
  c.reorderRows(['c1'], 2, null); // drop c1 at the gap before q, as a root
  const byId = {}; c.state.tasks.forEach(t => byId[t.id] = t);
  assert.equal(byId['c1'].parentId, null);
});

test('reorderRows without a parentId arg keeps the current parent (plain reorder)', () => {
  const c = make();
  const p = activeTask(c, { id: 'p', name: 'P' });
  const c1 = activeTask(c, { id: 'c1', name: 'C1', parentId: 'p' });
  const c2 = activeTask(c, { id: 'c2', name: 'C2', parentId: 'p' });
  c.state.tasks = [p, c1, c2];
  c._visTasks = c.state.tasks;
  c.reorderRows(['c2'], 1); // no parentId → parent untouched
  const byId = {}; c.state.tasks.forEach(t => byId[t.id] = t);
  assert.equal(byId['c2'].parentId, 'p', 'still a child of p');
});

// ---------------------------------------------------------------------------
// rowIndexAt — which row a LOCAL-space Y lands on (dependency-drag drop target).
// Pure; the DOM-facing rowAtY only converts rendered px → local px before calling it.
// ---------------------------------------------------------------------------
test('rowIndexAt: flat rows resolve to the row containing the point', () => {
  const c = make();
  const yTop = [0, 40, 80, 120];
  assert.equal(c.rowIndexAt(0, yTop, 40, 4), 0);
  assert.equal(c.rowIndexAt(39, yTop, 40, 4), 0);
  assert.equal(c.rowIndexAt(40, yTop, 40, 4), 1, 'a row top belongs to that row');
  assert.equal(c.rowIndexAt(125, yTop, 40, 4), 3);
});

test('rowIndexAt: an expanded row above the pointer does not shift the answer', () => {
  const c = make();
  // row 1 has an inline description panel open → 140px tall, not 40
  const yTop = [0, 40, 180, 220];
  assert.equal(c.rowIndexAt(100, yTop, 40, 4), 1, 'still inside the tall row');
  assert.equal(c.rowIndexAt(185, yTop, 40, 4), 2, 'the row below starts where yTop says');
  // the old flat-divide answer would have been Math.floor(185/40) = 4 → out of range
});

test('rowIndexAt: out-of-range and missing yTop', () => {
  const c = make();
  assert.equal(c.rowIndexAt(-5, [0, 40], 40, 2), null, 'above the first row');
  assert.equal(c.rowIndexAt(10, null, 40, 0), null, 'no rows');
  assert.equal(c.rowIndexAt(45, null, 40, 3), 1, 'falls back to the flat divide');
  assert.equal(c.rowIndexAt(500, null, 40, 3), null, 'past the last row');
});
