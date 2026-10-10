// Raised 2026-08-20 — deletions never crossed origins.
//
// Both sync funnels treated "absent from the server" as "this device has not pushed it yet", never as
// "another device deleted it". `applyRemoteSnapshot` kept local-only rows and `syncInitialSync` then
// emitted an `insert` for each; the sections path stripped deletes outright. A device that was CLOSED
// when another origin deleted a row therefore re-created it for everyone on its next load. Tombstones
// cannot help: they live in the deleting origin's localStorage, so the other origin never sees them.
//
// Measured on the owner's account 2026-08-20: localhost held 28 tasks against the server's 11, and five
// sections where two pairs were same-name/different-id duplicates that had each survived a delete.
//
// Fix (option B — no migration): a scoped `pp-sync-acked` id set records what the backend has confirmed,
// either by returning it in a pull or by accepting our push. That splits the ambiguous case in two:
//
//     local row absent from the server AND acked      -> the server deleted it   -> delete locally
//     local row absent from the server AND NOT acked  -> we never pushed it      -> insert (as before)
//
// The never-delete rule was protecting a real case — a genuine first sync must not delete a workspace
// that simply has not been uploaded yet, and for sections a wrong delete would orphan every task filed
// under it. That case is exactly the un-acked branch, so it stays safe.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const DAY = 86400000;
const B = 1_700_000_000_000;

function task(c, over){
  return c.normalizeTask(Object.assign({
    id:'t1', name:'Task', type:'Proportional', start:B-DAY, end:B+DAY,
    priority:4, deps:[], pct:0, planned:60, updatedAt:B,
  }, over||{}));
}
function remoteRow(c, over){
  const r = c.syncRowOf(task(c, over));
  r.owner_id = '00000000-0000-0000-0000-00000000000a';
  r.updated_at = new Date(B).toISOString();
  delete r.updatedAt;
  return Object.assign(r, over||{});
}
const ids = a => Array.from(a).map(t=>t.id).join(',');

// =======================================================================
// the pure decision
// =======================================================================

test('syncAbsentDecision: acked + absent remotely = the server deleted it', () => {
  const c = make();
  assert.strictEqual(c.syncAbsentDecision('t2', {t2:1}, {}), 'delete');
});

test('syncAbsentDecision: never acked = we have not pushed it yet, keep it', () => {
  const c = make();
  // This is the case the original never-delete rule existed to protect: a first sync from a device
  // whose workspace has never been uploaded must not wipe itself against an empty backend.
  assert.strictEqual(c.syncAbsentDecision('t2', {}, {}), 'keep');
});

test('syncAbsentDecision: a pending local write outranks the ack', () => {
  const c = make();
  // We acked it, the server no longer has it, BUT this device has an unflushed write for it. That write
  // is a newer local intent than our knowledge of the delete, so the row is re-created rather than lost.
  assert.strictEqual(c.syncAbsentDecision('t2', {t2:1}, {t2:1}), 'keep');
});

// =======================================================================
// tasks — applyRemoteSnapshot
// =======================================================================

test('a task deleted on another origin is REMOVED locally, not resurrected', () => {
  const c = make();
  const local = [task(c,{id:'t1',name:'Keep'}), task(c,{id:'t2',name:'Deleted on the other origin'})];
  const server = [remoteRow(c,{id:'t1',name:'Keep'})];
  // this device pulled both rows in an earlier session, so both are acked; it has no tombstone for t2
  // because it was not the device that deleted it.
  const merged = c.applyRemoteSnapshot(local, server, {}, { acked:{t1:1, t2:1} });
  assert.strictEqual(ids(merged), 't1');
});

test('and the removal does not re-enter the outbound diff', () => {
  const c = make();
  const local = [task(c,{id:'t1'}), task(c,{id:'t2'})];
  const server = [remoteRow(c,{id:'t1'})];
  const merged = c.applyRemoteSnapshot(local, server, {}, { acked:{t1:1,t2:1} });
  const ops = c.computeSyncOps(server.map(r=>c.rowToTask(r)), merged);
  assert.strictEqual(ops.length, 0, 'no insert, and no redundant delete for a row the server already lost');
});

test('a never-pushed local task is still kept and inserted (the protected case)', () => {
  const c = make();
  const local = [task(c,{id:'t1'}), task(c,{id:'offline',name:'Made on a plane'})];
  const server = [remoteRow(c,{id:'t1'})];
  const merged = c.applyRemoteSnapshot(local, server, {}, { acked:{t1:1} });
  assert.strictEqual(ids(merged), 't1,offline');
  const ops = c.computeSyncOps(server.map(r=>c.rowToTask(r)), merged);
  assert.strictEqual(ids(ops.filter(o=>o.op==='insert')), 'offline');
});

test('a FIRST sync against an empty backend deletes nothing', () => {
  const c = make();
  // the regression the never-delete rule guarded: nothing acked, server empty, whole workspace local
  const local = [task(c,{id:'a'}), task(c,{id:'b'}), task(c,{id:'c'})];
  const merged = c.applyRemoteSnapshot(local, [], {}, { acked:{} });
  assert.strictEqual(ids(merged), 'a,b,c');
});

test('an unflushed local edit survives a server-side delete', () => {
  const c = make();
  const local = [task(c,{id:'t1'}), task(c,{id:'t2',name:'Edited offline'})];
  const server = [remoteRow(c,{id:'t1'})];
  const merged = c.applyRemoteSnapshot(local, server, {}, { acked:{t1:1,t2:1}, pending:{t2:1} });
  assert.strictEqual(ids(merged), 't1,t2');
});

test('omitting the new options preserves the OLD never-delete behaviour', () => {
  const c = make();
  // backwards compatibility: every existing caller and test passes three arguments.
  const local = [task(c,{id:'t1'}), task(c,{id:'t2'})];
  const merged = c.applyRemoteSnapshot(local, [remoteRow(c,{id:'t1'})], {});
  assert.strictEqual(ids(merged), 't1,t2');
});

test('a tombstoned row is still not resurrected (existing contract intact)', () => {
  const c = make();
  const local = [task(c,{id:'t1'})];
  const server = [remoteRow(c,{id:'t1'}), remoteRow(c,{id:'t2'})];
  const merged = c.applyRemoteSnapshot(local, server, {t2:B+1000}, { acked:{t1:1} });
  assert.strictEqual(ids(merged), 't1');
});

test('remote-wins LWW still applies to rows that survive', () => {
  const c = make();
  const local = [task(c,{id:'t1',name:'Local name',updatedAt:B-1000})];
  const server = [remoteRow(c,{id:'t1',name:'Remote name',updated_at:new Date(B).toISOString()})];
  const merged = c.applyRemoteSnapshot(local, server, {}, { acked:{t1:1} });
  assert.strictEqual(Array.from(merged)[0].name, 'Remote name');
});

// =======================================================================
// the ack ledger itself
// =======================================================================

test('a pull acks every row the server returned', () => {
  const c = make();
  const next = c.syncAckIds({}, ['t1','t2']);
  assert.strictEqual(Object.keys(next).sort().join(','), 't1,t2');
});

test('a local delete un-acks the row', () => {
  const c = make();
  const next = c.syncUnackIds({t1:1, t2:1}, ['t2']);
  assert.strictEqual(Object.keys(next).sort().join(','), 't1');
});

test('the ack ledger round-trips through storage per workspace', () => {
  const c = make();
  c.saveSyncAcked({ tasks:{t1:1}, sections:{s1:1} });
  const back = c.loadSyncAcked();
  assert.strictEqual(back.tasks.t1, 1);
  assert.strictEqual(back.sections.s1, 1);
  assert.ok(back.habits && back.journal, 'every table gets a bucket, even when never written');
});

test('a corrupt ack ledger degrades to "nothing acked", never to a mass delete', () => {
  const c = make();
  c.lsSet('pp-sync-acked', '{not json');
  const back = c.loadSyncAcked();
  assert.deepStrictEqual(Object.keys(back.tasks).length, 0);
  // and with nothing acked, absent rows are KEPT — the safe direction
  assert.strictEqual(c.syncAbsentDecision('anything', back.tasks, {}), 'keep');
});

// =======================================================================
// sections / kv funnel — the same rule, the owner's second symptom
// =======================================================================

const sec = (c, id, name, order) => c.normalizeSection({id, name, order});

test('a section deleted on another origin is removed, not re-pushed', () => {
  const c = make();
  const localMap = {};
  ['Work','Home','Old','Errands'].forEach((n,i)=>{ localMap['s'+i] = sec(c,'s'+i,n,i); });
  const remoteMap = { s0:localMap.s0, s1:localMap.s1, s3:localMap.s3 };
  const merged = c.syncKvMergeMap(localMap, remoteMap, {}, { acked:{s0:1,s1:1,s2:1,s3:1} });
  assert.strictEqual(Object.keys(merged).sort().join(','), 's0,s1,s3');
  const ops = c.computeKvOps(remoteMap, merged);
  assert.strictEqual(ops.length, 0, 'nothing to push: the local map now matches the server');
});

test('a never-pushed section is still kept (a wrong delete would orphan its tasks)', () => {
  const c = make();
  const localMap = { s0:sec(c,'s0','Work',0), sNew:sec(c,'sNew','Just made',1) };
  const remoteMap = { s0:localMap.s0 };
  const merged = c.syncKvMergeMap(localMap, remoteMap, {}, { acked:{s0:1} });
  assert.strictEqual(Object.keys(merged).sort().join(','), 's0,sNew');
});

test('the owner\'s duplicate-section pairs collapse once the deletes stick', () => {
  const c = make();
  // measured state: chronocompose x2 and Routines x2, same names, different ids
  const localMap = {
    sec_qshet6: sec(c,'sec_qshet6','chronocompose',0),
    sec_vocoj3: sec(c,'sec_vocoj3','chronocompose',0),
    sec_cqr96w: sec(c,'sec_cqr96w','work',1),
    sec_8ahl51: sec(c,'sec_8ahl51','Routines',2),
    sec_r3wi89: sec(c,'sec_r3wi89','Routines',2),
  };
  // the other origin deleted one of each duplicate pair
  const remoteMap = { sec_qshet6:localMap.sec_qshet6, sec_cqr96w:localMap.sec_cqr96w, sec_8ahl51:localMap.sec_8ahl51 };
  const acked = {}; Object.keys(localMap).forEach(k=>acked[k]=1);
  const merged = c.syncKvMergeMap(localMap, remoteMap, {}, { acked });
  const names = c.sectionsFromMap(merged).map(s=>s.name).join(',');
  assert.strictEqual(names, 'chronocompose,work,Routines', 'one of each, in order');
});

test('kv merge without options keeps the old never-delete behaviour', () => {
  const c = make();
  const localMap = { a:sec(c,'a','A',0), b:sec(c,'b','B',1) };
  const merged = c.syncKvMergeMap(localMap, { a:localMap.a }, {});
  assert.strictEqual(Object.keys(merged).sort().join(','), 'a,b');
});

test('kv merge still takes a newer remote value for a surviving row', () => {
  const c = make();
  const local = { a: Object.assign(sec(c,'a','Old name',0), {updatedAt:B-1000}) };
  const remote = { a: Object.assign(sec(c,'a','New name',0), {updatedAt:B}) };
  const merged = c.syncKvMergeMap(local, remote, {}, { acked:{a:1} });
  assert.strictEqual(merged.a.name, 'New name');
});

// =======================================================================
// wiring guards — the pure layer above is useless if the call sites skip it
// =======================================================================

test('the ack ledger is workspace-scoped, so two accounts cannot confuse each other', () => {
  const c = make();
  assert.ok(c.WS_SCOPED_KEYS().includes('pp-sync-acked'),
    'pp-sync-acked must travel with the namespace like every other pp-* store');
});

test('the ledger covers tasks AND every kv table', () => {
  const c = make();
  const t = c.SYNC_ACK_TABLES();
  ['tasks','habits','journal','sections'].forEach(x =>
    assert.ok(t.includes(x), `${x} needs an ack bucket or its deletes never propagate`));
});

test('pending task ids come from unflushed WRITES, never from queued deletes', () => {
  const c = make();
  c.saveSyncQueue([
    { op:'insert', id:'a', row:{id:'a'} },
    { op:'update', id:'b', row:{id:'b'} },
    { op:'delete', id:'c' },
  ]);
  const p = c.syncPendingTaskIds();
  assert.strictEqual(Object.keys(p).sort().join(','), 'a,b');
  // a queued DELETE must not protect the row from removal — that would be self-defeating
  assert.ok(!p.c);
});

test('pending kv ids are per table', () => {
  const c = make();
  c.saveKvQueue([
    { op:'insert', table:'sections', id:'s1', data:{} },
    { op:'insert', table:'habits',   id:'h1', data:{} },
    { op:'delete', table:'sections', id:'s2' },
  ]);
  assert.strictEqual(Object.keys(c.syncPendingKvIds('sections')).join(','), 's1');
  assert.strictEqual(Object.keys(c.syncPendingKvIds('habits')).join(','), 'h1');
});

test('an ack survives a round-trip through a table-scoped update', () => {
  const c = make();
  c.syncAckTable('tasks', ['t1','t2']);
  c.syncAckTable('sections', ['s1']);
  c.syncUnackTable('tasks', ['t1']);
  const a = c.loadSyncAcked();
  assert.strictEqual(Object.keys(a.tasks).join(','), 't2', 'un-acking one table must not clear it wholesale');
  assert.strictEqual(Object.keys(a.sections).join(','), 's1', 'or disturb another table');
});
