// Independent, spec-derived unit tests for the B1 offline-first Supabase sync layer.
// Derived from plans/backend-migration-roadmap.md (sub-phase B1) + the pure Component methods:
//   computeSyncOps, applyRemoteSnapshot, syncRowOf/rowToTask, syncEnqueue coalescing, stampUpdated,
//   and the commit() funnel. All IO-free — called directly on plain task arrays, mirroring
//   tests/calendar.gen.test.js. No network exists at B1.

const { test } = require('node:test');
// non-strict assert: values returned from the vm sandbox carry that realm's Array/Object
// prototypes, so deepStrictEqual's prototype check spuriously fails on structurally-equal data.
const assert = require('node:assert');
const { make } = require('./_load.js');

const DAY = 86400000;

// A normalized task with sane dated defaults.
function task(c, over){
  const B = 1_700_000_000_000; // fixed epoch so tests are deterministic
  return c.normalizeTask(Object.assign({
    id:'t1', name:'Task', type:'Proportional', start:B-DAY, end:B+DAY,
    priority:4, deps:[], pct:0, planned:60,
  }, over||{}));
}
// The Postgres row shape a pull returns (quoted camelCase columns + snake updated_at + owner_id).
function remoteRow(c, over){
  const r = c.syncRowOf(task(c, over));
  r.owner_id = '00000000-0000-0000-0000-00000000000a';
  r.updated_at = over && 'updated_at' in over ? over.updated_at : new Date(1_700_000_000_000).toISOString();
  delete r.updatedAt;
  return Object.assign(r, over||{});
}

// =======================================================================
// computeSyncOps — insert / update / delete / no-op
// =======================================================================
test('computeSyncOps: a new task -> one insert op carrying the full row', () => {
  const c = make();
  const ops = c.computeSyncOps([], [task(c)]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'insert');
  assert.equal(ops[0].id, 't1');
  assert.equal(ops[0].row.name, 'Task');
  assert.equal(ops[0].row.planned, 60);
});

test('computeSyncOps: identical arrays (only updatedAt differs) -> no ops (idempotent)', () => {
  const c = make();
  const before = task(c, { updatedAt: 111 });
  const after  = task(c, { updatedAt: 999 }); // clock moved, nothing else
  assert.deepEqual(c.computeSyncOps([before], [after]), []);
});

test('computeSyncOps: every mirrored field change -> exactly one update op', () => {
  const c = make();
  const mutations = {
    name:'Renamed', start: 1, end: 2, priority: 1, deps:['t9'], pct: 50, planned: 120,
    predicted: 30, predictManual: true, spent: 15, spentByDay:{'2026-07-11':10}, completion: 5,
    recur:{kind:'day',n:1}, labels:['@x'], description:'d', goal:'g', wbs:'1.1',
    type:'Milestone', allDay:true, calendarId:'c', eventId:'e', pinStart:true, pinEnd:true,
    included:false, archivedAt: 7, parentId:'p', pin:{day:1,start:2,dur:3},
  };
  for(const [field, val] of Object.entries(mutations)){
    const before = task(c);
    const after  = task(c, { [field]: val });
    const ops = c.computeSyncOps([before], [after]);
    assert.equal(ops.length, 1, `${field} should produce 1 op`);
    assert.equal(ops[0].op, 'update', `${field} -> update`);
    assert.deepEqual(ops[0].row[field], val, `${field} carried in row`);
  }
});

test('computeSyncOps: a removed task -> one delete op (id only)', () => {
  const c = make();
  const ops = c.computeSyncOps([task(c)], []);
  assert.deepEqual(ops, [{ op:'delete', id:'t1' }]);
});

test('computeSyncOps: subtasks and milestones DO sync (unlike gcal outbound)', () => {
  const c = make();
  const sub  = task(c, { id:'s1', parentId:'t1' });
  const mile = task(c, { id:'m1', type:'Milestone' });
  const ops = c.computeSyncOps([], [sub, mile]);
  assert.deepEqual(ops.map(o=>o.op), ['insert','insert']);
  assert.deepEqual(ops.map(o=>o.id).sort(), ['m1','s1']);
});

test('computeSyncOps: archive is an update (archived rows stay in the backend)', () => {
  const c = make();
  const ops = c.computeSyncOps([task(c)], [task(c, { archivedAt: 12345 })]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'update');
  assert.equal(ops[0].row.archivedAt, 12345);
});

test('computeSyncOps: mixed create+edit+delete in one diff', () => {
  const c = make();
  const before = [task(c,{id:'a'}), task(c,{id:'b',name:'B'})];
  const after  = [task(c,{id:'b',name:'B2'}), task(c,{id:'c'})]; // a deleted, b edited, c new
  const ops = c.computeSyncOps(before, after);
  const byId = {}; ops.forEach(o=>byId[o.id]=o.op);
  assert.equal(byId.a, 'delete');
  assert.equal(byId.b, 'update');
  assert.equal(byId.c, 'insert');
  assert.equal(ops.length, 3);
});

// =======================================================================
// rowToTask / syncRowOf round-trip
// =======================================================================
test('rowToTask: drops owner_id, maps updated_at -> updatedAt, normalizes shape', () => {
  const c = make();
  const row = remoteRow(c, { updated_at: '2023-11-14T22:13:20.000Z' });
  const t = c.rowToTask(row);
  assert.equal(t.owner_id, undefined);
  assert.equal(t.updated_at, undefined);
  assert.equal(t.updatedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(t.name, 'Task');
  assert.equal(t.type, 'Proportional'); // normalizeTask default present
});

test('syncRowOf: only mirrored fields + updatedAt (no owner_id, no stray keys)', () => {
  const c = make();
  const r = c.syncRowOf(task(c, { updatedAt: 42 }));
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, [...c.SYNC_FIELDS(), 'updatedAt'].sort());
  assert.equal(r.updatedAt, 42);
});

// =======================================================================
// applyRemoteSnapshot — row-level last-write-wins
// =======================================================================
test('applyRemoteSnapshot: newer remote wins, older remote is ignored', () => {
  const c = make();
  const local = [task(c, { name:'local', updatedAt: 1000 })];
  const newer = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'remote', updated_at: 2000 })], {});
  assert.equal(newer[0].name, 'remote');
  const older = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'remote', updated_at: 500 })], {});
  assert.equal(older[0].name, 'local');
});

test('applyRemoteSnapshot: a tie keeps local (no churn/echo)', () => {
  const c = make();
  const local = [task(c, { name:'local', updatedAt: 1000 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'remote', updated_at: 1000 })], {});
  assert.equal(out[0].name, 'local');
});

test('applyRemoteSnapshot: remote-only row is added; local-only row is kept', () => {
  const c = make();
  const local = [task(c, { id:'local1' })];
  const remote = [remoteRow(c, { id:'remote1' })];
  const out = c.applyRemoteSnapshot(local, remote, {});
  assert.deepEqual(out.map(t=>t.id).sort(), ['local1','remote1']);
});

test('applyRemoteSnapshot: ISO-string and numeric clocks compare correctly', () => {
  const c = make();
  const local = [task(c, { name:'local', updatedAt: Date.parse('2023-11-14T22:13:20Z') - 1 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'remote', updated_at:'2023-11-14T22:13:20Z' })], {});
  assert.equal(out[0].name, 'remote'); // ISO remote is 1ms newer than the numeric local
});

// =======================================================================
// applyRemoteSnapshot — tombstones (delete must not resurrect)
// =======================================================================
test('applyRemoteSnapshot: a fresh local tombstone blocks resurrection of the deleted row', () => {
  const c = make();
  const remote = [remoteRow(c, { id:'t1', updated_at: 1000 })];
  const tombstones = { t1: 2000 }; // we deleted it AFTER the remote row's clock
  const out = c.applyRemoteSnapshot([], remote, tombstones);
  assert.deepEqual(out, []);
});

test('applyRemoteSnapshot: a remote re-create newer than the tombstone comes back', () => {
  const c = make();
  const remote = [remoteRow(c, { id:'t1', updated_at: 5000 })]; // recreated on another device later
  const tombstones = { t1: 2000 };
  const out = c.applyRemoteSnapshot([], remote, tombstones);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 't1');
});

// =======================================================================
// syncEnqueue — coalescing + tombstoning (mirrors gcalEnqueue)
// =======================================================================
test('syncEnqueue: repeated updates for one id coalesce to the latest', () => {
  const c = make();
  c.syncEnqueue([{ op:'insert', id:'t1', row:{ id:'t1', name:'v1' } }]);
  c.syncEnqueue([{ op:'update', id:'t1', row:{ id:'t1', name:'v2' } }]);
  c.syncEnqueue([{ op:'update', id:'t1', row:{ id:'t1', name:'v3' } }]);
  const q = c.loadSyncQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].row.name, 'v3');
});

test('syncEnqueue: a delete supersedes pending writes and drops a tombstone', () => {
  const c = make();
  c.syncEnqueue([{ op:'insert', id:'t1', row:{ id:'t1' } }]);
  c.syncEnqueue([{ op:'delete', id:'t1' }]);
  const q = c.loadSyncQueue();
  assert.deepEqual(q, [{ op:'delete', id:'t1' }]);
  assert.ok(c.loadSyncTombstones().t1 != null);
});

test('syncEnqueue: re-inserting a tombstoned id clears its tombstone', () => {
  const c = make();
  c.syncEnqueue([{ op:'delete', id:'t1' }]);
  assert.ok(c.loadSyncTombstones().t1 != null);
  c.syncEnqueue([{ op:'insert', id:'t1', row:{ id:'t1' } }]);
  assert.equal(c.loadSyncTombstones().t1, undefined);
});

test('loadSyncTombstones: entries past the TTL are pruned on read', () => {
  const c = make();
  const old = Date.now() - c.SYNC_TOMBSTONE_TTL_MS - 1000;
  c.saveSyncTombstones({ stale: old, fresh: Date.now() });
  const t = c.loadSyncTombstones();
  assert.equal(t.stale, undefined);
  assert.ok(t.fresh != null);
});

// =======================================================================
// commit() funnel + stampUpdated (integration through the public mutation path)
// =======================================================================
test('commit funnel: inert while sync is disabled (no queue, no clock stamp)', () => {
  const c = make();
  c.state.settings.syncEnabled = false;
  c.state.tasks = [task(c, { updatedAt: null })];
  c.commit(tasks => { tasks[0].name = 'Edited'; });
  assert.deepEqual(c.loadSyncQueue(), []);
  assert.equal(c.state.tasks[0].updatedAt, null); // stampUpdated gated off
});

test('commit funnel: with sync on, a mutation enqueues an update and stamps updatedAt', () => {
  const c = make();
  c.state.settings.syncEnabled = true;
  c.state.tasks = [task(c, { updatedAt: null })];
  c.commit(tasks => { tasks[0].name = 'Edited'; });
  const q = c.loadSyncQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].op, 'update');
  assert.equal(q[0].row.name, 'Edited');
  assert.equal(typeof c.state.tasks[0].updatedAt, 'number'); // clock stamped
});

test('commit funnel: _syncApplying suppresses echo (a pulled snapshot does not re-queue)', () => {
  const c = make();
  c.state.settings.syncEnabled = true;
  c.state.tasks = [task(c)];
  c._syncApplying = true;
  c.commit(tasks => { tasks[0].name = 'FromRemote'; });
  assert.deepEqual(c.loadSyncQueue(), []);
  c._syncApplying = false;
});
