// Phase 3 — archive vs delete: sweep rule, view filtering, allotment exclusion,
// prune exemption, and gcal interaction (archive = no-op remotely; delete = DELETE + tombstone).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

test('sweepAutoArchive (immediate, days=0) archives completed tasks; spares open, recurring, milestones', () => {
  const c = make();
  const now = Date.now();
  const done = activeTask(c, { id: 'done', pct: 100, completion: now - 2 * DAY });
  const open = activeTask(c, { id: 'open', pct: 40 });
  const rec = activeTask(c, { id: 'rec', pct: 100, completion: now - 30 * DAY,
    recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  const mile = activeTask(c, { id: 'mile', type: 'Milestone', pct: 100, completion: now - 2 * DAY });
  const tasks = [done, open, rec, mile];
  const n = c.sweepAutoArchive(tasks, now, 0);
  assert.equal(n, 1);
  assert.ok(tasks.find(t => t.id === 'done').archivedAt, 'completed task archives immediately');
  assert.ok(!tasks.find(t => t.id === 'open').archivedAt);
  assert.ok(!tasks.find(t => t.id === 'rec').archivedAt, 'recurring series never auto-archived');
  assert.ok(!tasks.find(t => t.id === 'mile').archivedAt, 'milestones stay as markers');
});

test('sweepAutoArchive with a grace period (days>0) keeps recent completions on the page', () => {
  const c = make();
  const now = Date.now();
  const old = activeTask(c, { id: 'old', pct: 100, completion: now - 10 * DAY });
  const recent = activeTask(c, { id: 'recent', pct: 100, completion: now - 2 * DAY });
  const tasks = [old, recent];
  const n = c.sweepAutoArchive(tasks, now, 7);
  assert.equal(n, 1);
  assert.ok(tasks.find(t => t.id === 'old').archivedAt, 'past the grace window → archived');
  assert.ok(!tasks.find(t => t.id === 'recent').archivedAt, 'within the grace window → still visible');
});

test('archiveDone archives a completing task and its subtree; ignores open/recurring/milestone', () => {
  const c = make();
  const now = Date.now();
  const parent = activeTask(c, { id: 'p', pct: 100, completion: now });
  const child = activeTask(c, { id: 'ch', parentId: 'p', pct: 40 }); // incomplete child still travels with the parent
  const other = activeTask(c, { id: 'o', pct: 100, completion: now });
  const rec = activeTask(c, { id: 'r', pct: 100, completion: now, recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  c.state.tasks = [parent, child, other, rec];
  c.archiveDone(c.state.tasks, 'p', now);
  assert.ok(parent.archivedAt, 'completed parent archives');
  assert.ok(child.archivedAt, 'its subtree archives too (no orphan rows)');
  assert.ok(!other.archivedAt, 'unrelated task untouched');
  c.archiveDone(c.state.tasks, 'r', now);
  assert.ok(!rec.archivedAt, 'recurring series never auto-archived on complete');
});

test('archived tasks are excluded from allotment and the day timeline', () => {
  const c = make();
  cleanDay(c, '10:00');
  const a = activeTask(c, { id: 'arch', planned: 120, archivedAt: Date.now() });
  const b = activeTask(c, { id: 'live', planned: 120 });
  c.state.tasks = [a, b];
  c._allot = c.computeAllotted(c.state.tasks);
  assert.equal(c._allot['arch'].active, false);
  assert.equal(c._allot['arch'].allotted, 0);
  // 2026-08-16: the live task's share is the whole 600-minute pool, capped at its own 120-minute ask.
  // What this test proves is unchanged: the archived row contributes no demand, so `live` gets 100%
  // of what it asked for rather than splitting the day with a task that is gone.
  assert.equal(c._allot['live'].allotted, 120, 'archived task does not compete for the pool');
  const ids = c.buildDayTimeline().chunks.filter(x => x.type === 'scheduled').map(x => x.id);
  assert.ok(!ids.includes('arch'));
});

test('visibleTasks always hides archived (identity-stable when nothing is archived)', () => {
  const c = make();
  const plain = [activeTask(c, { id: 'a' }), activeTask(c, { id: 'b' })];
  c.state.tasks = plain;
  assert.equal(c.visibleTasks(), plain, 'same array identity when nothing is archived');
  plain[1].archivedAt = Date.now();
  assert.equal(c.visibleTasks().length, 1, 'archived tasks leave the task page (they live on the Archive page)');
});

test('pruneDeletedEvents keeps archived tasks even when their event is gone', () => {
  const c = make();
  const gone = activeTask(c, { id: 'g', eventId: 'evg', calendarId: 'c1', archivedAt: Date.now() });
  const alsoGone = activeTask(c, { id: 'g2', eventId: 'evg2', calendarId: 'c1' });
  const tasks = [gone, alsoGone];
  const removed = c.pruneDeletedEvents(tasks, [{ cid: 'c1', items: [] }], ['c1'], new Set(['c1|evg','c1|evg2']));
  assert.equal(removed, 1, 'only the unarchived task is pruned');
  assert.ok(tasks.find(t => t.id === 'g'), 'archived task survives for stats');
});

test('archiving never touches gcal; deleting a linked task queues DELETE + tombstone', () => {
  const c = make();
  c.state.settings.gcalTwoWay = true;
  const t = activeTask(c, { id: 'lk', eventId: 'ev9', calendarId: 'c1' });
  c.state.tasks = [t];
  c.archiveMulti(['lk']);
  assert.equal(c.loadQueue().length, 0, 'archive produces no outbound ops');
  c.unarchiveMulti(['lk']);
  assert.equal(c.loadQueue().length, 0, 'unarchive too');
  c.deleteMulti(['lk']);
  const q = c.loadQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].op, 'delete');
  assert.equal(q[0].eventId, 'ev9');
  assert.ok(c.loadTombstones()['ev9'], 'tombstone blocks re-import until the DELETE lands');
});
