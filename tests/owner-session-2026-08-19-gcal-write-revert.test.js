// Owner report, 2026-08-19: "Changing the start and end times also did not update my gcal task as
// intended."
//
// The outbound half is healthy: a clock edit produces a `patch` op carrying the NEW times (pinned below,
// so a regression there is caught here rather than blamed on the network). The hole is on the way back.
//
// `gcalFlushQueue.finish()` fires a verification `gcalImport` immediately after a write drains. Two
// guards are supposed to keep a just-written task's local fields authoritative through a pull:
//   1. the op is still in the queue  (`pending` in mergeCalendarEvents), and
//   2. the task's fingerprint changed while the request was in flight (`importFp`, 2026-08-18).
// Neither covers THIS window. By the time `finish()` runs, the op has already been shifted off the queue,
// and `importFp` is captured from the post-edit state, so nothing looks changed. If Google answers that
// pull with a not-yet-updated copy of the event — most likely for a recurring series, which has to
// re-expand its instances — the merge writes the OLD times straight back over the edit.
//
// `preserveEventIds` does not help: it protects a moved event from being read as DELETED, which the code
// says in as many words. It has never protected content.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();

function linked(c, over){
  const day = c.startOfToday();
  return c.normalizeTask(Object.assign({
    id: 'a', name: 'Standup', planned: 60,
    start: day + 9 * HOUR, end: day + 10 * HOUR, startClock: true, endClock: true,
    eventId: 'evt1', calendarId: 'cal1',
  }, over));
}

// The event as Google still has it, BEFORE the patch it has just accepted is reflected in a list read.
function staleEvent(c){
  const day = c.startOfToday();
  return { id: 'evt1', status: 'confirmed', summary: 'Standup',
    start: { dateTime: iso(day + 9 * HOUR) }, end: { dateTime: iso(day + 10 * HOUR) } };
}

test('a clock edit still queues a patch carrying the NEW times', () => {
  const c = make(); const day = c.startOfToday();
  let q = [];
  c.loadQueue = () => q; c.saveQueue = (x) => { q = x; };
  c.loadTombstones = () => ({}); c.saveTombstones = () => {};
  c.gcalFlushSoon = () => {}; c.saveTasks = () => {};
  c.state.tasks = [linked(c)];

  c.setDate('a', 'end', day + 11.5 * HOUR, true);
  assert.equal(q.length, 1, 'one outbound op');
  assert.equal(q[0].op, 'patch');
  assert.equal(new Date(q[0].body.end.dateTime).getHours(), 11, 'the body carries the edited end');
  assert.equal(new Date(q[0].body.end.dateTime).getMinutes(), 30);
});

test('the post-write verification pull must not revert the write it just made', () => {
  const c = make(); const day = c.startOfToday();
  c.saveTasks = () => {};
  c.state.tasks = [linked(c)];
  c.setDate('a', 'end', day + 11.5 * HOUR, true);
  const edited = c.state.tasks[0].end;

  /* Reproduce the exact state finish() pulls in: the op has DRAINED (empty queue), and importFp was
     captured from the post-edit state, so guard 2 sees nothing changed either. Only guard 3 is left. */
  c.loadQueue = () => [];
  const fp = {}; c.state.tasks.forEach(x => { fp[x.id] = c.syncFp(x); });
  assert.equal(c.gcalPendingFor(fp, []).length, 0, 'precondition: guards 1 and 2 are both blind here');
  const pending = c.gcalPendingFor(fp, ['a']);
  const clone = c.state.tasks.map(t => ({ ...t, deps: [...(t.deps || [])] }));
  c.mergeCalendarEvents(clone, [{ cid: 'cal1', items: [staleEvent(c)] }], {}, { cal1: { summary: 'Personal' } }, {}, pending);

  assert.equal(clone[0].end, edited,
    'a stale read of an event we just patched must not overwrite the local times');
  assert.equal(new Date(clone[0].end).getHours(), 11);
});

test('an UNRELATED task in the same pull still takes Google as the truth', () => {
  const c = make(); const day = c.startOfToday();
  c.saveTasks = () => {};
  const other = linked(c, { id: 'b', eventId: 'evt2', name: 'Other' });
  c.state.tasks = [linked(c), other];
  c.setDate('a', 'end', day + 11.5 * HOUR, true);

  /* A REALISTIC importFp: it holds every linked task as it looked when the request began. An EMPTY one
     would mean "no record of this task", which guard 2 conservatively treats as changed — and would then
     protect 'b' too, hiding the very thing this test is here to check. */
  const fp = {}; c.state.tasks.forEach(x => { fp[x.id] = c.syncFp(x); });
  c.loadQueue = () => [];
  const pending = c.gcalPendingFor(fp, ['a']);
  const moved = { id: 'evt2', status: 'confirmed', summary: 'Other',
    start: { dateTime: iso(day + 14 * HOUR) }, end: { dateTime: iso(day + 15 * HOUR) } };
  const clone = c.state.tasks.map(t => ({ ...t, deps: [...(t.deps || [])] }));
  c.mergeCalendarEvents(clone, [{ cid: 'cal1', items: [staleEvent(c), moved] }], {}, { cal1: { summary: 'P' } }, {}, pending);

  assert.equal(new Date(clone[0].end).getHours(), 11, 'the just-written task is protected');
  assert.equal(new Date(clone[1].start).getHours(), 14,
    'the protection is per task — an ordinary inbound change still lands');
});

test('gcalPendingFor keeps the two existing guards as well as the new one', () => {
  const c = make(); const day = c.startOfToday();
  c.saveTasks = () => {};
  c.state.tasks = [linked(c)];
  const fpAtRequestStart = { a: c.syncFp(c.state.tasks[0]) };
  let q = [];
  c.loadQueue = () => q; c.saveQueue = (x) => { q = x; };
  c.loadTombstones = () => ({}); c.saveTombstones = () => {}; c.gcalFlushSoon = () => {};

  assert.equal(c.gcalPendingFor(fpAtRequestStart, []).length, 0,
    'nothing changed and nothing was just written — Google wins, as before');

  c.setDate('a', 'end', day + 11.5 * HOUR, true);
  assert.equal(q.length, 1, 'the edit queued its patch');
  assert.equal(c.gcalPendingFor(fpAtRequestStart, []).length, 2,
    'guard 1 (the queued op) and guard 2 (the changed fingerprint) both still fire');
  q = [];
  assert.equal(c.gcalPendingFor(fpAtRequestStart, []).length, 1,
    'guard 2 survives on its own once the op drains');
  const fpNow = {}; c.state.tasks.forEach(x => { fpNow[x.id] = c.syncFp(x); });
  assert.equal(c.gcalPendingFor(fpNow, []).length, 0, 'and goes quiet once the pull is up to date');
  assert.equal(c.gcalPendingFor(fpNow, ['a']).length, 1,
    'guard 3: a task written by the flush that triggered this pull is authoritative');
  assert.equal(c.gcalPendingFor(fpNow, ['zz']).length, 0,
    'and only that task — an id we did not write protects nothing');
});
