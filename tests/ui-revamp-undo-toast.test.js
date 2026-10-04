// UI revamp block 3 — the undo snackbar.
// Delete, complete, archive, Del, the section ✕, the dependency auto-push, the When line and Gantt drags
// used to act silently. Each now raises ONE toast that names the action and object, with an Undo button
// that runs the same `undo()` as Ctrl+Z. A new toast replaces the old one; Undo confirms with "Undone".
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load.js');

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props)) out.push(n);
  find(n.children, pred, out);
  return out;
};

function setup(tasks, sections) {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = (tasks || [
    { id: 'a', name: 'Groceries', start: B + DAY, end: B + 2 * DAY },
    { id: 'b', name: 'Laundry', start: B + DAY, end: B + 3 * DAY },
    { id: 'c', name: 'Taxes', start: B + 2 * DAY, end: B + 4 * DAY },
  ]).map((t) => c.normalizeTask(Object.assign({ type: 'Proportional', priority: 4, deps: [], pct: 0, planned: 60, labels: [] }, t)));
  if (sections) c.state.sections = sections;
  return { c, B };
}
const msg = (c) => c.state.toast && c.state.toast.msg;
const ids = (c) => c.state.tasks.map((t) => t.id);

test('deleting one task names it and Undo brings it back', () => {
  const { c } = setup();
  c.deleteTask('a');
  assert.equal(msg(c), 'Deleted “Groceries”');
  assert.equal(c.state.toast.undo, true);
  assert.deepEqual(ids(c), ['b', 'c']);
  c.undoFromToast();
  assert.deepEqual(ids(c), ['a', 'b', 'c']);
  assert.equal(msg(c), 'Undone', 'undo confirms');
  assert.equal(c.state.toast.undo, false, 'the confirmation offers no second Undo');
});

test('Del on a multi-selection counts the tasks', () => {
  const { c } = setup();
  c.deleteMulti(['a', 'b', 'c']);
  assert.equal(msg(c), '3 tasks deleted');
  c.undoFromToast();
  assert.equal(c.state.tasks.length, 3);
});

test('completing archives and says so; uncompleting names it too', () => {
  const { c } = setup();
  c.toggleDone('b');
  assert.equal(msg(c), 'Completed “Laundry” · moved to archive');
  assert.ok(c.state.tasks.find((t) => t.id === 'b').archivedAt);
  c.undoFromToast();
  const b = c.state.tasks.find((t) => t.id === 'b');
  assert.ok(!b.archivedAt && b.pct < 100, 'undo restores the open, unarchived task');
  c.completeMulti(['a', 'c']);
  assert.equal(msg(c), '2 tasks completed');
});

test('archive and restore toast', () => {
  const { c } = setup();
  c.archiveMulti(['c']);
  assert.equal(msg(c), 'Archived “Taxes”');
  c.unarchiveMulti(['c']);
  assert.equal(msg(c), 'Restored “Taxes”');
});

test('the section ✕ is announced and one Undo restores the section and its tasks', () => {
  const { c } = setup(null, [{ id: 's1', name: 'Work', order: 0 }, { id: 's2', name: 'Home', order: 1 }]);
  c.state.tasks = c.state.tasks.map((t) => Object.assign({}, t, { sectionId: t.id === 'c' ? 's1' : null }));
  c.deleteSection('s1');
  assert.equal(msg(c), 'Section “Work” deleted');
  assert.deepEqual(c.state.sections.map((s) => s.id), ['s2']);
  assert.equal(c.state.tasks.find((t) => t.id === 'c').sectionId, null);
  c.undoFromToast();
  assert.deepEqual(c.state.sections.map((s) => s.id).sort(), ['s1', 's2']);
  assert.equal(c.state.tasks.find((t) => t.id === 'c').sectionId, 's1', 'the paired task half comes back too');
});

test('a dependency push is announced, and folded into the action that caused it', () => {
  const { c, B } = setup();
  c.state.tasks = c.state.tasks.map((t) => t.id === 'c' ? Object.assign({}, t, { deps: ['b'], start: B + 2 * DAY, end: B + 4 * DAY }) : t);
  // Moving the predecessor later pushes its successor — a typed edit, so only the push is toasted.
  c.commit((ts) => { const b = ts.find((t) => t.id === 'b'); b.start = B + 5 * DAY; b.end = B + 6 * DAY; });
  assert.equal(msg(c), 'Moved 1 dependent task');
  assert.ok(c.state.tasks.find((t) => t.id === 'c').start >= B + 6 * DAY);
  c.undoFromToast();
  assert.equal(c.state.tasks.find((t) => t.id === 'c').start, B + 2 * DAY, 'undo takes the push back with the edit');
});

test('the push phrase joins an action toast raised in the same step, and never a later one', () => {
  const { c } = setup();
  c.noteDepPush(2);
  assert.equal(msg(c), 'Moved 2 dependent tasks');
  c.toast('Deleted “X”');
  assert.equal(msg(c), 'Deleted “X” · moved 2 dependent tasks');
  c.toast('Archived “Y”');
  assert.equal(msg(c), 'Archived “Y”', 'the note is consumed once');
  c.noteDepPush(1); c._actSeq++;
  c.toast('Deleted “Z”');
  assert.equal(msg(c), 'Deleted “Z”', 'a note from an earlier action does not leak');
});

test('the When line save is announced and undoable', () => {
  const { c } = setup();
  const before = c.state.tasks.find((t) => t.id === 'a').start;
  const r = c.applyWhenText('a', 'next friday');
  assert.equal(r.ok, true);
  assert.match(msg(c), /^Dates updated for “Groceries”/);
  c.undoFromToast();
  assert.equal(c.state.tasks.find((t) => t.id === 'a').start, before);
  c.applyWhenText('a', '');
  assert.equal(msg(c), 'Dates cleared for “Groceries”');
});

test('Gantt drag messages name the task and the new dates', () => {
  const { c } = setup();
  const t = c.state.tasks[0];
  // The date text is the locale's own short form, so only the shape is asserted.
  assert.match(c.dragToastMsg(t.name, 'move', null, t), /^Moved “Groceries” to .+ – .+$/);
  assert.match(c.dragToastMsg(t.name, 'start', null, t), /^Start of “Groceries” moved to /);
  assert.match(c.dragToastMsg(t.name, 'end', null, t), /^End of “Groceries” moved to /);
  assert.equal(c.dragToastMsg('Standup', 'move', 'this occurrence'), 'Moved “Standup” (this occurrence)');
});

test('a new toast replaces the previous one', () => {
  const { c } = setup();
  c.deleteTask('a');
  const first = c.state.toast.id;
  c.archiveMulti(['b']);
  assert.notEqual(c.state.toast.id, first);
  assert.equal(msg(c), 'Archived “Laundry”');
  const region = c.renderToast();
  assert.equal(find(region, (p) => p['data-pp-toast'] === '1').length, 1, 'one toast at a time');
});

test('a stale Undo refuses instead of undoing a newer step', () => {
  const { c } = setup();
  c.deleteTask('a');
  c.commit((ts) => { ts[0].name = 'Typed edit'; }); // a later, untoasted step
  assert.equal(c.toastUndoLive(c.state.toast), false);
  c.undoFromToast();
  assert.equal(c.state.tasks[0].name, 'Typed edit', 'nothing was undone');
  assert.match(msg(c), /^Nothing to undo/);
});

test('Ctrl+Z still undoes, and now confirms', () => {
  const { c } = setup();
  c.deleteTask('a');
  c.onKey({ key: 'z', ctrlKey: true, shiftKey: false, target: { tagName: 'DIV' }, preventDefault() {} });
  assert.equal(c.state.tasks.length, 3);
  assert.equal(msg(c), 'Undone');
});

test('the region is an always-mounted polite live region; Undo is a reachable, generous button', () => {
  const { c } = setup();
  const empty = c.renderToast();
  assert.equal(empty.props.role, 'status');
  assert.equal(empty.props['aria-live'], 'polite');
  c.deleteTask('a');
  const r = c.renderToast();
  const undo = find(r, (p) => p['data-pp-toast-undo'] === '1')[0];
  assert.ok(undo, 'Undo is shown');
  assert.equal(undo.type, 'button', 'a real button: Tab reaches it, Enter/Space press it');
  assert.equal(textOf(undo), 'Undo');
  assert.ok(parseFloat(undo.props.style.minHeight) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'renders ≥ HIT_MIN_PX inside the zoom');
  assert.equal(textOf(find(r, (p) => p.className === 'pp-toast-msg')[0]), 'Deleted “Groceries”');
});

test('hover/focus holds the toast; leaving re-arms it', () => {
  const { c } = setup();
  let armed = 0;
  const realArm = c._armToast.bind(c);
  c._armToast = (t) => { armed++; realArm(t); };
  c.deleteTask('a');
  assert.equal(armed, 1);
  c.holdToast();
  assert.equal(c._toastT, null, 'held: no timer');
  c.releaseToast();
  assert.equal(armed, 2);
  c.dismissToast();
  assert.equal(c.state.toast, null);
});

test('long names are clipped', () => {
  const { c } = setup();
  const s = c.toastName('x'.repeat(80));
  assert.ok(s.length <= c.TOAST_NAME_MAX + 2);
  assert.ok(s.endsWith('…”'));
});

test('bare `a` adds a task and opens it with the title marked for focus', () => {
  const { c } = setup();
  c.onKey({ key: 'a', ctrlKey: false, metaKey: false, target: { tagName: 'BODY' }, preventDefault() {} });
  const nt = c.state.tasks[c.state.tasks.length - 1];
  assert.equal(nt.name, 'New task');
  assert.equal(c.state.detailId, nt.id, 'the new row is open for naming');
  assert.equal(c._focusTitleId, nt.id, 'the title editor will take focus on mount');
});
