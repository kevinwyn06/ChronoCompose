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

test('V2.3 add-time credits lifetime and today through the commit funnel', () => {
  const c = make();
  const task = activeTask(c, { id:'focus', spent:5, spentByDay:{} });
  c.state.tasks = [task];
  const day = c.ymdOf(c.startOfToday());

  assert.equal(c.addSpentTime('focus', 15), true);
  assert.equal(c.state.tasks[0].spent, 20);
  assert.equal(c.state.tasks[0].spentByDay[day], 15);
  assert.equal(c.history.length, 1, 'one undoable commit');
});

test('V2.3 section and action dimensions honor shared alignment and hit-target constants', () => {
  const c = make();
  assert.ok(c.TAG_SECTION_H > 0);
  assert.equal(c.colDefs().find(x => x.k === 'planned').l, 'Planned → Allotted');
  assert.ok(c.colDefs().some(x => x.k === 'actions'));
  assert.ok(c.HIT_MIN_PX >= 24);
});
