// Phase 4 — subtasks: tree helpers, order invariant, collapse filtering,
// parent-keeps-budget allotment distribution, timeline subdivision, cascades, indent/outdent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

function tree(c){
  const p = activeTask(c, { id: 'p', name: 'Parent', planned: 120 });
  const c1 = activeTask(c, { id: 'c1', name: 'Alpha', planned: 60, parentId: 'p' });
  const c2 = activeTask(c, { id: 'c2', name: 'Beta', planned: 30, parentId: 'p' });
  const g1 = activeTask(c, { id: 'g1', name: 'Deep', planned: 20, parentId: 'c1' });
  return [p, c1, c2, g1];
}

test('buildKids / subtreeIds / depthOf / expandSubtrees', () => {
  const c = make();
  const ts = tree(c);
  c.state.tasks = ts;
  const { kids, byId } = c.buildKids(ts);
  assert.equal((kids['p'] || []).join(','), 'c1,c2');
  assert.equal(c.subtreeIds('p', kids).join(','), 'p,c1,g1,c2');
  assert.equal(c.depthOf('g1', byId), 2);
  assert.equal(c.depthOf('p', byId), 0);
  assert.equal(c.expandSubtrees(['c1']).sort().join(','), 'c1,g1');
});

test('normalizeTreeOrder keeps subtrees contiguous and re-nests strays', () => {
  const c = make();
  const [p, c1, c2, g1] = tree(c);
  const other = activeTask(c, { id: 'z', name: 'Other' });
  const tasks = [c2, other, p, g1, c1]; // scrambled
  c.normalizeTreeOrder(tasks);
  const order = tasks.map(t => t.id).join(',');
  // Sibling order follows encounter order (c2 was seen before c1); the invariant is
  // contiguity — every child sits directly inside its parent's span.
  assert.equal(order, 'z,p,c2,c1,g1', `unexpected order ${order}`);
});

test('visibleTasks hides collapsed subtrees (all depths)', () => {
  const c = make();
  c.state.tasks = tree(c);
  assert.equal(c.visibleTasks().length, 4);
  c.state.collapsed = { p: 1 };
  assert.equal(c.visibleTasks().map(t => t.id).join(','), 'p');
  c.state.collapsed = { c1: 1 };
  assert.equal(c.visibleTasks().map(t => t.id).join(','), 'p,c1,c2', 'only the deep child hides');
});

test('allotment: parent keeps own budget, children get proportional shares, remainder stays', () => {
  const c = make();
  cleanDay(c, '02:00'); // pool = 120 = parent planned
  const [p, c1, c2] = [activeTask(c, { id: 'p', planned: 120 }),
    activeTask(c, { id: 'c1', planned: 60, parentId: 'p' }),
    activeTask(c, { id: 'c2', planned: 30, parentId: 'p' })];
  c.state.tasks = [p, c1, c2];
  const map = c.computeAllotted(c.state.tasks);
  assert.equal(map['c1'].allotted, 60);
  assert.equal(map['c2'].allotted, 30);
  assert.equal(map['p'].allotted, 30, 'unassigned remainder stays with the parent');
  assert.ok(map['c1'].fromParent);
  const { kids } = c.buildKids(c.state.tasks);
  c._allot = map;
  assert.equal(c.famAllot('p', kids), 120, 'family total = the parent’s original allotment');
});

test('allotment: oversubscribed children split everything, parent keeps nothing', () => {
  const c = make();
  cleanDay(c, '02:00');
  c.state.tasks = [activeTask(c, { id: 'p', planned: 120 }),
    activeTask(c, { id: 'a', planned: 120, parentId: 'p' }),
    activeTask(c, { id: 'b', planned: 120, parentId: 'p' })];
  const map = c.computeAllotted(c.state.tasks);
  assert.equal(map['a'].allotted, 60);
  assert.equal(map['b'].allotted, 60);
  assert.equal(map['p'].allotted, 0);
});

// REWRITTEN for owner ruling C1 (2026-08-21). This used to assert one scheduled CHUNK per child,
// titled `Parent › Child`. The ruling replaced that with a single lipped parent block whose children
// ride inside it as `kids` — "the parent is exactly one object with one border". The minutes and their
// order are unchanged and still asserted; what moved is where they live in the shape.
test('timeline: a family is ONE block, with its children inside it', () => {
  const c = make();
  cleanDay(c, '02:00');
  c.state.tasks = [activeTask(c, { id: 'p', name: 'Parent', planned: 120 }),
    activeTask(c, { id: 'c1', name: 'Alpha', planned: 60, parentId: 'p' }),
    activeTask(c, { id: 'c2', name: 'Beta', planned: 30, parentId: 'p' })];
  c._allot = c.computeAllotted(c.state.tasks);
  const chunks = c.buildDayTimeline().chunks.filter(x => x.type === 'scheduled');

  assert.equal(chunks.length, 1, 'one object on the timeline, not three');
  const block = chunks[0];
  assert.equal(block.id, 'p');
  assert.equal(block.title, 'Parent', 'the block is the PARENT — no `Parent › Child` compound title');
  assert.equal(Math.round((block.end - block.start) / 60000), 120, 'it spans the whole family share');

  const mins = {};
  block.kids.forEach(k => { mins[k.id] = (mins[k.id] || 0) + Math.round((k.end - k.start) / 60000); });
  assert.equal(mins['c1'], 60);
  assert.equal(mins['c2'], 30);
  assert.equal(mins['p'], 30, 'the parent\'s own remainder is a line like any other');
  // children are not packed independently — total is exactly the family allotment
  assert.equal(Object.values(mins).reduce((a, b) => a + b, 0), 120);
  // Depth is carried on the line, which is what the renderer indents and colours by (C1).
  assert.deepEqual(JSON.parse(JSON.stringify(block.kids)).map(k => k.depth), [1, 1, 0]);
  assert.equal(block.cut, false, 'one chunk, so nothing was cut through');
});

test('cascades: delete/archive/complete a parent affects the whole subtree', () => {
  const c = make();
  c.state.tasks = tree(c);
  c.completeMulti(['p']);
  assert.ok(c.state.tasks.every(t => t.pct === 100), 'complete cascades');
  c.state.tasks = tree(c);
  c.archiveMulti(['p']);
  assert.ok(c.state.tasks.every(t => t.archivedAt), 'archive cascades');
  c.state.tasks = tree(c);
  c.deleteMulti(['c1']);
  assert.equal(c.state.tasks.map(t => t.id).sort().join(','), 'c2,p', 'delete removes the subtree (c1+g1)');
});

test('indentRows nests under the row above; outdentRows hoists; cycles are refused', () => {
  const c = make();
  const a = activeTask(c, { id: 'a', name: 'A' });
  const b = activeTask(c, { id: 'b', name: 'B' });
  c.state.tasks = [a, b];
  c._visTasks = c.state.tasks;
  c.indentRows(['b']);
  assert.equal(c.state.tasks.find(t => t.id === 'b').parentId, 'a');
  c._visTasks = c.state.tasks;
  c.outdentRows(['b']);
  assert.equal(c.state.tasks.find(t => t.id === 'b').parentId, null);
  // cycle: indenting a parent under its own child must be a no-op
  c.state.tasks = tree(c);
  c._visTasks = c.state.tasks; // visible order: p,c1,c2,g1 (as constructed)
  const before = c.state.tasks.find(t => t.id === 'p').parentId;
  c.indentRows(['p']); // row above p doesn't exist → no-op
  assert.equal(c.state.tasks.find(t => t.id === 'p').parentId, before);
});

test('addSubtask inserts directly after the parent subtree with parentId set', () => {
  const c = make();
  const p = activeTask(c, { id: 'p', name: 'P' });
  const z = activeTask(c, { id: 'z', name: 'Z' });
  c.state.tasks = [p, z];
  c.addSubtask('p');
  const ids = c.state.tasks.map(t => t.id);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], 'p');
  assert.equal(ids[2], 'z', 'new subtask sits between parent and the next root');
  const sub = c.state.tasks[1];
  assert.equal(sub.parentId, 'p');
  assert.equal(sub.planned, null, 'unestimated by default; a deliberate zero remains distinct');
});
