// Phase 3 (ROADMAP.md) — archive vs delete: sweep rule, view filtering, allotment exclusion,
// prune exemption, and gcal interaction (archive = no-op remotely; delete = DELETE + tombstone).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

test('sweepAutoArchive archives long-completed tasks, spares recent/live-recurring ones', () => {
  const c = make();
  const now = Date.now();
  const old = activeTask(c, { id: 'old', pct: 100, completion: now - 10 * DAY });
  const recent = activeTask(c, { id: 'recent', pct: 100, completion: now - 2 * DAY });
  const open = activeTask(c, { id: 'open', pct: 40 });
  const liveRec = activeTask(c, { id: 'liverec', pct: 100, completion: now - 30 * DAY,
    recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } }); // no until → still live
  const deadRec = activeTask(c, { id: 'deadrec', pct: 100, completion: now - 30 * DAY,
    recur: { kind: 'day', n: 1, until: now - 20 * DAY, overrides: {}, shifts: [] } });
  const tasks = [old, recent, open, liveRec, deadRec];
  const n = c.sweepAutoArchive(tasks, now, 7);
  assert.equal(n, 2);
  assert.ok(tasks.find(t => t.id === 'old').archivedAt, 'old completed task archived');
  assert.ok(tasks.find(t => t.id === 'deadrec').archivedAt, 'ended recurring series archived');
  assert.ok(!tasks.find(t => t.id === 'recent').archivedAt);
  assert.ok(!tasks.find(t => t.id === 'open').archivedAt);
  assert.ok(!tasks.find(t => t.id === 'liverec').archivedAt, 'live recurring series never auto-archived');
  assert.equal(c.sweepAutoArchive([activeTask(c, { pct: 100, completion: now - 90 * DAY })], now, 0), 0, 'days=0 disables');
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
  assert.equal(c._allot['live'].allotted, 600, 'archived task does not compete for the pool');
  const ids = c.buildDayTimeline().chunks.filter(x => x.type === 'scheduled').map(x => x.id);
  assert.ok(!ids.includes('arch'));
});

test('visibleTasks hides archived (identity-stable when nothing is archived)', () => {
  const c = make();
  const plain = [activeTask(c, { id: 'a' }), activeTask(c, { id: 'b' })];
  c.state.tasks = plain;
  assert.equal(c.visibleTasks(), plain, 'same array identity when nothing is archived');
  plain[1].archivedAt = Date.now();
  assert.equal(c.visibleTasks().length, 1);
  c.state.showArchived = true;
  assert.equal(c.visibleTasks().length, 2, 'showArchived reveals them');
});

test('pruneDeletedEvents keeps archived tasks even when their event is gone', () => {
  const c = make();
  const gone = activeTask(c, { id: 'g', eventId: 'evg', calendarId: 'c1', archivedAt: Date.now() });
  const alsoGone = activeTask(c, { id: 'g2', eventId: 'evg2', calendarId: 'c1' });
  const tasks = [gone, alsoGone];
  const removed = c.pruneDeletedEvents(tasks, [{ cid: 'c1', items: [] }], ['c1']);
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
