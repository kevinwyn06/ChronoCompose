/* G2b (raised 2026-08-20, confirmed live 2026-08-21, built 2026-08-25) — two task rows sharing one
 * `calendarId|eventId`.
 *
 * `mergeCalendarEvents` builds its event index ONCE from the array it is handed, so two imports racing
 * on the same pre-state each see no existing task and each push one. Once formed, the collision is
 * permanent: the index is last-write-wins, so exactly one of the pair is ever updated again, and the
 * prune path only removes tasks whose event is MISSING from the live calendar — which this one is not.
 * The duplicate is therefore invisible to both halves of sync and survives forever.
 *
 * Owner ruling 2026-08-21: the collapse is a SILENT MERGE, not a visible deletion — a stray row is a
 * sync artifact the owner never created. It keeps the newest `updatedAt` and rides the shipped local
 * delete path, so it needs no `deleted_at` migration.
 *
 * The other half of the fix is identity: `byEid` used to key on the bare `eventId` while `handled` and
 * the prune/verify paths keyed on `calendarId|eventId`. Three call sites disagreeing about what a task
 * IS is exactly what would make a silent merge unsafe, so these tests pin the pair as the key.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

function linked(c, id, eid, cid, updatedAt, extra){
  return c.normalizeTask(Object.assign({ id, name: id, type: 'Proportional',
    start: 0, end: 3600000, priority: 4, deps: [], pct: 0, planned: 60, spent: 0,
    eventId: eid, calendarId: cid, updatedAt }, extra || {}));
}

test('collapse keeps the newest row of a calendarId|eventId collision and drops the rest', () => {
  const c = make();
  const tasks = [ linked(c, 'told', 'e1', 'cal-a', 1000), linked(c, 'tnew', 'e1', 'cal-a', 5000) ];
  const n = c.collapseEventDuplicates(tasks);
  assert.equal(n, 1);
  assert.deepEqual(tasks.map(t => t.id), ['tnew']);
});

test('a tie keeps the earliest row in array order, so the result does not depend on iteration luck', () => {
  const c = make();
  const tasks = [ linked(c, 'tA', 'e1', 'cal-a', 4242), linked(c, 'tB', 'e1', 'cal-a', 4242) ];
  assert.equal(c.collapseEventDuplicates(tasks), 1);
  assert.deepEqual(tasks.map(t => t.id), ['tA']);
});

test('the SAME event id on DIFFERENT calendars is not a collision', () => {
  const c = make();
  const tasks = [ linked(c, 'tA', 'e1', 'cal-a', 1000), linked(c, 'tB', 'e1', 'cal-b', 2000) ];
  assert.equal(c.collapseEventDuplicates(tasks), 0);
  assert.deepEqual(tasks.map(t => t.id), ['tA', 'tB']);
});

test('rows without a link, and archived rows, are never collapsed', () => {
  const c = make();
  const tasks = [
    c.normalizeTask({ id: 'm1', name: 'm1', type: 'Proportional', start: 0, end: 1,
      priority: 4, deps: [], pct: 0, planned: 10, spent: 0 }),
    c.normalizeTask({ id: 'm2', name: 'm2', type: 'Proportional', start: 0, end: 1,
      priority: 4, deps: [], pct: 0, planned: 10, spent: 0 }),
    linked(c, 'tarch', 'e1', 'cal-a', 9000, { archivedAt: 1234 }),
    linked(c, 'tlive', 'e1', 'cal-a', 1000) ];
  assert.equal(c.collapseEventDuplicates(tasks), 0);
  assert.equal(tasks.length, 4);
});

/* A merge preserves the graph. Deleting the edge instead would silently unblock a successor — the
 * failure would surface as a task scheduling early, with nothing pointing back at the collapse. */
test('a dependency on the dropped row is RE-POINTED at the survivor, not deleted', () => {
  const c = make();
  const succ = c.normalizeTask({ id: 'succ', name: 'succ', type: 'Proportional', start: 0, end: 1,
    priority: 4, deps: ['told'], pct: 0, planned: 10, spent: 0 });
  const tasks = [ linked(c, 'told', 'e1', 'cal-a', 1000), linked(c, 'tnew', 'e1', 'cal-a', 5000), succ ];
  c.collapseEventDuplicates(tasks);
  assert.deepEqual(Array.from(tasks.find(t => t.id === 'succ').deps, d => c.depId(d)), ['tnew']);
});

test('an object dep keeps its occurrence when it is re-pointed', () => {
  const c = make();
  const succ = c.normalizeTask({ id: 'succ', name: 'succ', type: 'Proportional', start: 0, end: 1,
    priority: 4, deps: [{ id: 'told', occ: 3 }], pct: 0, planned: 10, spent: 0 });
  const tasks = [ linked(c, 'told', 'e1', 'cal-a', 1000), linked(c, 'tnew', 'e1', 'cal-a', 5000), succ ];
  c.collapseEventDuplicates(tasks);
  const d = tasks.find(t => t.id === 'succ').deps[0];
  assert.equal(c.depId(d), 'tnew');
  assert.equal(c.depOcc(d), 3);
});

/* Two edges that were distinct before the merge can name the same predecessor after it. */
test('re-pointing does not leave a duplicate edge or a self-dependency', () => {
  const c = make();
  const succ = c.normalizeTask({ id: 'succ', name: 'succ', type: 'Proportional', start: 0, end: 1,
    priority: 4, deps: ['told', 'tnew'], pct: 0, planned: 10, spent: 0 });
  const survivorDependsOnLoser = linked(c, 'tnew', 'e1', 'cal-a', 5000, { deps: ['told'] });
  const tasks = [ linked(c, 'told', 'e1', 'cal-a', 1000), survivorDependsOnLoser, succ ];
  c.collapseEventDuplicates(tasks);
  assert.deepEqual(Array.from(tasks.find(t => t.id === 'succ').deps, d => c.depId(d)), ['tnew']);
  assert.deepEqual(Array.from(tasks.find(t => t.id === 'tnew').deps), []);
});

test('a clean workspace is left completely alone', () => {
  const c = make();
  const tasks = [ linked(c, 'tA', 'e1', 'cal-a', 1000), linked(c, 'tB', 'e2', 'cal-a', 2000) ];
  assert.equal(c.collapseEventDuplicates(tasks), 0);
  assert.deepEqual(tasks.map(t => t.id), ['tA', 'tB']);
});

/* ---- the identity half: the merge must key on the pair, and must not re-import over a legacy row ---- */

function ev(id, summary, from, to){
  return { id, summary, start: { dateTime: new Date(from).toISOString() },
    end: { dateTime: new Date(to).toISOString() } };
}
const T0 = Date.UTC(2026, 7, 25, 9, 0, 0);

test('merge matches on the full calendarId|eventId pair, so one event updates exactly one row', () => {
  const c = make();
  const tasks = [ linked(c, 'tA', 'e1', 'cal-a', 1000), linked(c, 'tB', 'e1', 'cal-b', 2000) ];
  const r = c.mergeCalendarEvents(tasks,
    [{ cid: 'cal-a', items: [ev('e1', 'A renamed', T0, T0 + 3600000)] }], {}, {}, null, []);
  assert.equal(r.added, 0);
  assert.equal(r.updated, 1);
  assert.equal(tasks.find(t => t.id === 'tA').name, 'A renamed');
  assert.equal(tasks.find(t => t.id === 'tB').name, 'tB');
});

/* Without the loose fallback this row has no pair to match, the merge reads it as absent, and imports a
 * second copy — creating the very duplicate this change exists to end. */
test('a legacy row linked before calendarId was stored is adopted, not re-imported', () => {
  const c = make();
  const tasks = [ linked(c, 'tlegacy', 'e1', null, 1000) ];
  const r = c.mergeCalendarEvents(tasks,
    [{ cid: 'cal-a', items: [ev('e1', 'adopted', T0, T0 + 3600000)] }], {}, {}, null, []);
  assert.equal(r.added, 0);
  assert.equal(r.updated, 1);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].calendarId, 'cal-a');
  assert.equal(tasks[0].name, 'adopted');
});

test('merge collapses a pre-existing collision before indexing, and reports the count', () => {
  const c = make();
  const tasks = [ linked(c, 'told', 'e1', 'cal-a', 1000), linked(c, 'tnew', 'e1', 'cal-a', 5000) ];
  const r = c.mergeCalendarEvents(tasks,
    [{ cid: 'cal-a', items: [ev('e1', 'once', T0, T0 + 3600000)] }], {}, {}, null, []);
  assert.equal(r.collapsed, 1);
  assert.equal(r.added, 0);
  assert.equal(r.updated, 1);
  assert.deepEqual(tasks.map(t => t.id), ['tnew']);
});

test('an unlinked event still imports normally after the collapse pass', () => {
  const c = make();
  const tasks = [];
  const r = c.mergeCalendarEvents(tasks,
    [{ cid: 'cal-a', items: [ev('e9', 'brand new', T0, T0 + 1800000)] }], {}, {}, null, []);
  assert.equal(r.added, 1);
  assert.equal(r.collapsed, 0);
  assert.equal(tasks[0].eventId, 'e9');
  assert.equal(tasks[0].calendarId, 'cal-a');
});
