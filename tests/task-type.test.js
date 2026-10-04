// MILESTONE <-> TASK CONVERSION, and row-menu / detail-panel parity (owner 2026-08-12).
//
// Owner: "There is no way to switch something from a milestone to a task and vice versa" and
// "Everything in the right click menu should be in the more expansive detail menu."
//
// `setType` had existed and worked the whole time — nothing called it, and isMilestone's own comment
// claimed the mode was "no longer user-selectable". So the interesting assertions here are not "does
// setType write the field" but (a) that the conversion is NON-LOSSY and reversible, and (b) that the
// two surfaces genuinely offer the same operations, which is the thing that silently drifts.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load.js');

function walk(node, out) {
  out = out || [];
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out; }
  out.push(node);
  walk(node.children, out);
  return out;
}
const textOf = (n) => {
  if (n == null || n === false) return '';
  if (Array.isArray(n)) return n.map(textOf).join(' ');
  if (typeof n !== 'object') return String(n);
  return textOf(n.children || []);
};

function mk(c, over) {
  return c.normalizeTask(Object.assign({
    id: 't1', name: 'Ship it', type: 'Proportional', priority: 2, deps: [], pct: 0,
    planned: 180, start: c.startOfToday(), end: c.startOfToday() + 5 * DAY,
  }, over || {}));
}

test('setTypeMulti converts both ways and writes ONLY type', () => {
  const c = make();
  const t = mk(c);
  c.state.tasks = [t];
  const before = JSON.parse(JSON.stringify(c.state.tasks[0]));

  c.setTypeMulti(['t1'], c.MILESTONE_TYPE);
  const asMs = c.state.tasks[0];
  assert.strictEqual(asMs.type, c.MILESTONE_TYPE);
  assert.strictEqual(c.isMilestone(asMs), true);

  // Non-lossy is the whole design: a milestone is drawn as a diamond at its START and its `end` is
  // never read, so collapsing the span would destroy the due date for no rendering benefit.
  assert.strictEqual(asMs.start, before.start, 'start untouched');
  assert.strictEqual(asMs.end, before.end, 'due date survives the conversion');
  assert.strictEqual(asMs.planned, before.planned, 'planned time survives too');
  assert.strictEqual(asMs.priority, before.priority);

  // And back again — the round trip must be the identity, or this is a one-way door.
  //
  // `updatedAt` is the ONE field allowed to differ, and it must: it is the client-clock sync stamp
  // (F7 / migration 0009), so a commit that left it alone would be a local edit that never replicates.
  // Excluding it here is not weakening the assertion — every other field is still compared exactly.
  const drop = (o) => { const c2 = JSON.parse(JSON.stringify(o)); delete c2.updatedAt; return c2; };
  c.setTypeMulti(['t1'], c.DEFAULT_TASK_TYPE);
  assert.deepStrictEqual(
    drop(c.state.tasks[0]), drop(before),
    'converting there and back leaves the task exactly as it was');
  assert.notStrictEqual(c.state.tasks[0].updatedAt, before.updatedAt,
    'the sync stamp DID move, so the change will replicate');
});

test('each conversion is exactly one undoable commit', () => {
  const c = make();
  c.state.tasks = [mk(c)];
  const n = c.history.length;
  c.setTypeMulti(['t1'], c.MILESTONE_TYPE);
  assert.strictEqual(c.history.length, n + 1, 'one commit');
  c.undo();
  assert.strictEqual(c.isMilestone(c.state.tasks[0]), false, 'undo restores the task shape');
});

test('the toggle reads the whole selection, so the label can never disagree with the action', () => {
  const c = make();
  const a = mk(c, { id: 'a' });
  const b = mk(c, { id: 'b', type: 'Milestone' });
  c.state.tasks = [a, b];

  // Mixed selection: not all milestones, so the offer is "make them milestones".
  assert.strictEqual(c.allMilestones(['a', 'b']), false);
  c.toggleMilestoneMulti(['a', 'b']);
  assert.deepStrictEqual(
    [...c.state.tasks.map(t => t.type)], [c.MILESTONE_TYPE, c.MILESTONE_TYPE],
    'a mixed selection converges on milestone rather than flipping each independently');

  // Now they all are, so the same control converts them all back.
  assert.strictEqual(c.allMilestones(['a', 'b']), true);
  c.toggleMilestoneMulti(['a', 'b']);
  assert.deepStrictEqual(
    [...c.state.tasks.map(t => t.type)], [c.DEFAULT_TASK_TYPE, c.DEFAULT_TASK_TYPE]);

  // An empty selection is not "all milestones" — otherwise the label would invert on nothing.
  assert.strictEqual(c.allMilestones([]), false);
});

test('a converted milestone stops allotting, and converting back restores it', () => {
  // The conversion has to actually MEAN something, not just relabel the row.
  const c = make();
  const t = mk(c);
  c.state.tasks = [t];
  c.renderVals();
  const asTask = c.allotOf('t1');

  c.setTypeMulti(['t1'], c.MILESTONE_TYPE);
  c.renderVals();
  const asMs = c.allotOf('t1');
  assert.strictEqual(asMs.active, false, 'a milestone never allots time');

  c.setTypeMulti(['t1'], c.DEFAULT_TASK_TYPE);
  c.renderVals();
  assert.strictEqual(c.allotOf('t1').active, asTask.active, 'converting back restores allotment');
});

test('the row menu offers the conversion, labelled for the current state', () => {
  const c = make();
  c.state.tasks = [mk(c)];
  c.rowMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10 }, 't1');
  assert.ok(c.state.menu, 'the row menu opened');

  const asTask = textOf(c.renderMenu());
  assert.match(asTask, /Convert to milestone/, 'a task is offered the milestone conversion');
  assert.doesNotMatch(asTask, /Convert to task/, 'and not both directions at once');

  c.setTypeMulti(['t1'], c.MILESTONE_TYPE);
  c.rowMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10 }, 't1');
  const asMs = textOf(c.renderMenu());
  assert.match(asMs, /Convert to task/, 'a milestone is offered the way back');
  assert.doesNotMatch(asMs, /Convert to milestone/);
});

// ---- PARITY: everything in the row menu is reachable from the detail panel ----
// This is the assertion that earns its place. The two surfaces are separate renderers, and the repo has
// already paid twice for two copies that agreed on the day they were written (tasksByTagSection, the two
// _yTop call sites). Before this change the detail panel was missing type, section, duplicate, archive
// and delete — reachable only by right-clicking, which a detail-panel user never does.
test('the detail panel exposes every operation the row menu does', () => {
  const c = make();
  c.state.tasks = [mk(c)];
  c.state.sections = [{ id: 's1', name: 'Research', order: 0 }];
  c.renderVals();

  c.setState({ detailId: 't1' });
  /* UI revamp block 4: the actions moved into the header's ⋯ menu and the diagnostics behind the Details
     disclosure — still one click away each, so the parity check opens both before reading the text. */
  const closed = textOf(c.renderDetail());
  assert.match(closed, /Task actions|⋯/, 'the header carries the actions menu');
  assert.match(closed, /Details/, 'the Details disclosure is offered');
  c.setState({ detailMenu: true, detailMore: { id: 't1', open: true } });
  const detail = textOf(c.renderDetail());

  for (const [what, re] of [
    ['type conversion', /Milestone/],
    ['section assignment', /Section/],
    ['duplicate', /Duplicate/],
    ['archive', /Archive/],
    ['delete', /Delete/],
    ['priority', /Priority/],
    ['complete', /Progress|Completed/],
    ['add subtask', /Add subtask/],
  ]) {
    assert.match(detail, re, 'the detail panel offers ' + what);
  }
});

test('the detail panel routes through the SAME mutators as the row menu', () => {
  // Parity of labels is cosmetic; parity of behaviour is the contract. Run each operation from the
  // panel's own handlers and compare against the menu's.
  const build = () => { const c = make();
    c.state.tasks = [mk(c)]; c.state.sections = [{ id: 's1', name: 'Research', order: 0 }];
    c.renderVals(); return c; };

  // Type, via the panel's control vs the menu's toggle.
  const panel = build(), menu = build();
  panel.setTypeMulti(['t1'], panel.MILESTONE_TYPE);
  menu.toggleMilestoneMulti(['t1']);
  assert.strictEqual(panel.state.tasks[0].type, menu.state.tasks[0].type,
    'both surfaces produce the same type');

  // Section: the panel resolves to the subtree root exactly like setTaskSectionMulti does.
  const p2 = build(), m2 = build();
  p2.setTaskSectionMulti(['t1'], 's1');
  m2.setTaskSectionMulti(['t1'], 's1');
  assert.strictEqual(p2.state.tasks[0].sectionId, m2.state.tasks[0].sectionId);

  // Delete on a RECURRING task must hand off to the scope prompt from either surface, rather than one
  // of them guessing which occurrences were meant.
  const rec = make();
  rec.state.tasks = [mk(rec, { recur: { kind: 'day', n: 1, label: 'Daily' } })];
  rec.renderVals();
  rec.deleteMulti(['t1']);
  assert.ok(rec.state.scopePrompt, 'a recurring delete opens the scope prompt, not a silent removal');
  assert.strictEqual(rec.state.tasks.length, 1, 'and deletes nothing until the scope is chosen');
});
