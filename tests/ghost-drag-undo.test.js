// ACCEPTANCE → AUTOMATION, with a correction attached.
//
// Owner report (2026-08-15): *"Dragging a ghost bar, control z undos the unghosting, not the drag, which
// is not the intuitive behaviour."*
//
// Measured, the premise does not hold: a ghost-bar drag creates exactly ONE undo entry and one Ctrl+Z
// restores the exact pre-drag task. `startBarDrag` snapshots once at mousedown, `onMouseMove` writes
// through to state without snapshotting, and `onMouseUp` reuses that same snapshot — so "one gesture,
// one undo" is already the rule, which is what the report asks for.
//
// What the owner is seeing is a consequence of the data model rather than a bug in the history. Dragging
// a ghost does two things AT ONCE and cannot do fewer: it commits real dates (the bar stops being a
// ghost) and it positions them. There is no earlier state in which the bar was real-but-elsewhere, so
// undo has nowhere to land except back at `start:null`/`end:null` — and a re-derived ghost is drawn from
// TODAY, near where it was drawn before. The dominant visible change is therefore the colour going grey
// again, which reads exactly as "it undid the unghosting". Both halves went back; only one of them
// looked like it moved.
//
// These tests exist to keep that true. The failure they guard against is a second `commit()` sneaking
// into the drag path (a de-ghost step, a "materialise" helper), which WOULD produce the two-press undo
// the report describes.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

const B0 = Date.UTC(2026, 6, 1);

function ganttReady() {
  const c = make();
  c._tl = { start: B0, days: 60 };
  c.state.dayW = 42;
  c._cpm = { critical: {} };
  c._showCP = false;
  c._accent = '#3b82f6';
  c.state.settings.usageTracking = false;
  return c;
}

/** Seed one task plus the `_occById` entry a real Gantt render would have published for it. */
function seed(c, over) {
  const t = c.normalizeTask(Object.assign({
    id: 'g', name: 'G', type: 'Proportional', priority: 4, deps: [], pct: 0, planned: 60,
    start: B0, end: B0 + 2 * DAY,
  }, over || {}));
  c.state.tasks = [t];
  const ghost = t.start == null || t.end == null;
  c._occById = { g: [{
    idx: 0,
    start: t.start != null ? t.start : B0,
    end: t.end != null ? t.end : B0 + DAY,
    ghost,
    ghostStart: t.start == null,
    ghostEnd: t.end == null,
  }] };
  return t;
}

/** Run a complete move-drag of `days` days, the way trusted pointer input would. */
function dragBy(c, days) {
  const x0 = 100;
  c.startBarDrag({ button: 0, clientX: x0, preventDefault() {}, stopPropagation() {} }, c.state.tasks[0], 0, 'move');
  c.onMouseMove({ clientX: x0 + days * c.state.dayW, clientY: 0, preventDefault() {} });
  c.onMouseUp({ clientX: x0 + days * c.state.dayW, clientY: 0, preventDefault() {} });
}

const dates = t => ({ start: t.start, end: t.end });

// The three shapes a bar can have when the gesture begins. All three must behave identically here —
// that is the whole point: ghostness is not a special case for history.
const SHAPES = [
  ['a double ghost (neither date set)', { start: null, end: null }],
  ['a start-ghost (due date only)', { start: null, end: B0 + 5 * DAY }],
  ['an end-ghost (start date only)', { start: B0, end: null }],
  ['a fully committed bar', { start: B0, end: B0 + 2 * DAY }],
];

for (const [label, over] of SHAPES) {
  test('dragging ' + label + ' creates exactly one undo entry', () => {
    const c = ganttReady();
    seed(c, over);
    const before = c.history.length;
    dragBy(c, 3);
    assert.strictEqual(c.history.length - before, 1,
      'one gesture must cost one undo entry, not two — got ' + (c.history.length - before));
  });

  test('one Ctrl+Z after dragging ' + label + ' restores the pre-drag dates exactly', () => {
    const c = ganttReady();
    seed(c, over);
    const before = dates(c.state.tasks[0]);
    dragBy(c, 3);
    assert.notDeepStrictEqual(dates(c.state.tasks[0]), before, 'the drag actually changed something');
    c.undo();
    assert.deepStrictEqual(dates(c.state.tasks[0]), before,
      'a single undo returns the task to exactly where the gesture found it');
  });
}

// The specific consequence the report is really about, stated as an assertion so nobody "fixes" it into
// a second undo entry later: undoing a first-ever ghost drag necessarily restores the NULLs, because a
// ghost has no earlier real date to fall back to.
test('undoing a ghost drag restores null dates — the bar is a ghost again, by construction', () => {
  const c = ganttReady();
  seed(c, { start: null, end: null });
  dragBy(c, 3);
  const t = c.state.tasks[0];
  assert.ok(t.start != null && t.end != null, 'the drag committed real dates');
  c.undo();
  assert.strictEqual(c.state.tasks[0].start, null, 'undo puts the start back to unset');
  assert.strictEqual(c.state.tasks[0].end, null, 'undo puts the due date back to unset');
  // There was never a "real bar at the old position" state, so this is the only thing undo could do.
});

// A drag that never crossed the threshold is a click (it opens details / the date picker) and must leave
// the history exactly as it found it — otherwise every stray press would cost the user an undo step.
test('a click on a bar (no drag) leaves no undo entry behind', () => {
  const c = ganttReady();
  seed(c);
  const before = c.history.length;
  const x0 = 100;
  c.startBarDrag({ button: 0, clientX: x0, preventDefault() {}, stopPropagation() {} }, c.state.tasks[0], 0, 'move');
  c.onMouseUp({ clientX: x0, clientY: 0, preventDefault() {} });
  assert.strictEqual(c.history.length, before, 'the drag-start snapshot is popped back off on a click');
});

// Redo has to be able to put the commit back, or "undo the unghosting" would be a one-way door.
test('redo re-commits the dates an undone ghost drag gave up', () => {
  const c = ganttReady();
  seed(c, { start: null, end: null });
  dragBy(c, 3);
  const committed = dates(c.state.tasks[0]);
  c.undo();
  c.redo();
  assert.deepStrictEqual(dates(c.state.tasks[0]), committed, 'redo restores the committed dates');
});
