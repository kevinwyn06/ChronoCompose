const { test } = require('node:test');
const assert = require('node:assert');
const { make, activeTask } = require('./_load');

test('V2.3 pure tag mutators normalize @tags, dedupe, remove, and preserve inputs', () => {
  const c = make();
  const labels = ['Work', 'deep'];
  const added = c.addTaskTag(labels, '@WORK');
  const next = c.addTaskTag(added, 'qa_2');
  const removed = c.removeTaskTag(next, '@deep');

  assert.deepEqual(labels, ['Work', 'deep'], 'source labels are not mutated');
  assert.deepEqual(added, ['Work', 'deep'], 'normalized duplicate is not added');
  assert.deepEqual(next, ['Work', 'deep', 'qa_2']);
  assert.deepEqual(removed, ['Work', 'qa_2']);
  assert.equal(c.normalizeTag('two words'), null, 'invalid multi-word tag is rejected');
});

/* V2.6 retired `tasksByTagSection`: sections became a first-class entity rather than a projection of
   the primary @tag, so this test's contract no longer exists. Grouping is now covered by
   tests/v2-sections.test.js; the pure tag mutators keep their coverage in the test above. */

// Task 26 (2026-08-20): `addSpentTime` and the `+15` button are gone — the control SETS today's figure
// now, because an adder cannot correct an overcount. The rule this test was written for is unchanged and
// still asserted: manual time is real tracked work, credited to BOTH the lifetime total and today's
// ledger, through one commit. The full per-day semantics live in owner-2026-08-20-time-worked.test.js.
test('V2.3 manual time credits lifetime and today through the commit funnel', () => {
  const c = make();
  const task = activeTask(c, { id:'focus', spent:5, spentByDay:{} });
  c.state.tasks = [task];
  const day = c.ymdOf(c.startOfToday());

  assert.equal(c.setSpentToday('focus', 15), true);
  assert.equal(c.state.tasks[0].spent, 20, 'the lifetime total moved by the delta');
  assert.equal(c.state.tasks[0].spentByDay[day], 15);
  assert.equal(c.history.length, 1, 'one undoable commit');
});

test('V2.3 section and action dimensions honor shared alignment and hit-target constants', () => {
  const c = make();
  assert.ok(c.TAG_SECTION_H > 0);
  // Task 27 (2026-08-20): two columns, not one cell with an arrow in it — each independently sizable
  // and hideable, which is what one cell could never be.
  assert.equal(c.colDefs().find(x => x.k === 'planned').l, 'Planned');
  assert.equal(c.colDefs().find(x => x.k === 'allot').l, 'Allotted');
  assert.ok(c.colDefs().some(x => x.k === 'actions'));
  assert.ok(c.HIT_MIN_PX >= 24);
});
