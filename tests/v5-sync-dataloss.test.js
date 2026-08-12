// V5 review, block 16 — four silent data-loss defects in the sync/backup subsystem (F6-F9).
// Each of these fails *invisibly* in the app: no error, no toast, no undo entry. Every test here was
// demonstrated RED against the pre-fix line before the fix landed (see .orchestration/16-sync-dataloss.handoff.md).
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const DAY = 86400000;
const B = 1_700_000_000_000;

function task(c, over){
  return c.normalizeTask(Object.assign({
    id:'t1', name:'Task', type:'Proportional', start:B-DAY, end:B+DAY,
    priority:4, deps:[], pct:0, planned:60,
  }, over||{}));
}
// The Postgres row shape a pull returns (quoted camelCase columns + snake updated_at + owner_id).
function remoteRow(c, over){
  const r = c.syncRowOf(task(c, over));
  r.owner_id = '00000000-0000-0000-0000-00000000000a';
  r.updated_at = (over && 'updated_at' in over) ? over.updated_at : new Date(B).toISOString();
  delete r.updatedAt;
  return Object.assign(r, over||{});
}

// =======================================================================
// F6 — remote-wins pulls must not erase local-only fields
// =======================================================================
test('F6: a remote-wins pull keeps sectionId (a local-only field) on the surviving task', () => {
  const c = make();
  const local = [task(c, { sectionId:'sec-work', updatedAt: 1000 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'FromRemote', updated_at: 5000 })], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'FromRemote', 'remote wins on the mirrored columns');
  assert.equal(out[0].sectionId, 'sec-work', 'sectionId is local-only and must survive the replace');
});

test('F6: every non-mirrored local field survives a remote-wins pull', () => {
  const c = make();
  const local = [task(c, { sectionId:'sec-x', demo:true, updatedAt: 1 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { planned: 999, updated_at: 9000 })], {});
  assert.equal(out[0].planned, 999);
  assert.equal(out[0].sectionId, 'sec-x');
  assert.equal(out[0].demo, true, '`demo` is deliberately out of SYNC_FIELDS and must not be reset');
});

test('F6: a local task that WINS the race is untouched', () => {
  const c = make();
  const local = [task(c, { sectionId:'sec-y', name:'Local', updatedAt: 9000 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { name:'Remote', updated_at: 10 })], {});
  assert.equal(out[0].name, 'Local');
  assert.equal(out[0].sectionId, 'sec-y');
});

// =======================================================================
// F7 — last-write-wins must compare one clock, not two
// =======================================================================
test('F7: an edit made before sign-in still carries a comparable timestamp', () => {
  const c = make();
  c.state.settings.syncEnabled = false;          // the pre-sign-in window
  c.state.tasks = [task(c, { updatedAt: null })];
  c.commit(tasks => { tasks[0].name = 'Edited offline'; });
  assert.equal(typeof c.state.tasks[0].updatedAt, 'number',
    'an unstamped edit loses every LWW race it ever enters');
  assert.deepEqual(c.loadSyncQueue(), [], 'stamping must NOT start queueing while sync is off');
});

test('F7: a pre-sign-in edit beats an older remote row once sync turns on', () => {
  const c = make();
  c.state.settings.syncEnabled = false;
  c.state.tasks = [task(c, { name:'Original', updatedAt: null })];
  c.commit(tasks => { tasks[0].name = 'Edited offline'; });
  const out = c.applyRemoteSnapshot(c.state.tasks, [remoteRow(c, { name:'Stale server copy', updated_at: B })], {});
  assert.equal(out[0].name, 'Edited offline');
});

test('F7: push sends the same clock the pull compares (edit time, not flush time)', () => {
  const c = make();
  const row = c.syncRowOf(task(c, { updatedAt: 1_700_000_123_456 }));
  const w = c.syncRowForWrite(row);
  assert.equal('updatedAt' in w, false, 'the camelCase local name is never a column');
  assert.equal(typeof w.updated_at, 'string', 'the edit clock must ride along on the write');
  assert.equal(Date.parse(w.updated_at), 1_700_000_123_456);
  assert.equal('owner_id' in w, false);
});

test('F7: an unstamped row still writes cleanly (no bogus epoch-0 clock)', () => {
  const c = make();
  const w = c.syncRowForWrite(c.syncRowOf(task(c, { updatedAt: null })));
  assert.equal('updated_at' in w, false, 'no clock is better than a 1970 clock the server would honour');
});

// =======================================================================
// F8 — migrations must reach rows that arrive from sync, not just the local seed
// =======================================================================
test('F8: a legacy included:false row arriving from sync is folded into unpressed', () => {
  const c = make();
  const out = c.applyRemoteSnapshot([], [remoteRow(c, { included:false, updated_at: 5000 })], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].included, null,
    'included:false is a retired state no predicate reads and no UI can clear');
});

test('F8: a legacy included:false row overwriting a local row is migrated too', () => {
  const c = make();
  const local = [task(c, { included:null, updatedAt: 10 })];
  const out = c.applyRemoteSnapshot(local, [remoteRow(c, { included:false, updated_at: 5000 })], {});
  assert.equal(out[0].included, null);
});

test('F8: a legacy single-object drag pin arriving from sync is normalized to a list', () => {
  const c = make();
  const out = c.applyRemoteSnapshot([], [remoteRow(c, { pin:{day:B, start:540, dur:60}, updated_at: 5000 })], {});
  assert.ok(Array.isArray(out[0].pin), 'pinsOf tolerates both shapes, but the store must not drift');
  assert.equal(out[0].pin.length, 1);
});

test('F8: incoming migration does NOT re-zero planned on an all-day task', () => {
  const c = make();
  // migrateAllDayPlanned is a genuinely one-shot cleanup; running it on every pull would silently
  // wipe a planned value the user set after the migration ran. It is deliberately excluded.
  const out = c.applyRemoteSnapshot([], [remoteRow(c, { allDay:true, planned: 45, updated_at: 5000 })], {});
  assert.equal(out[0].planned, 45);
});

// =======================================================================
// F9 — a backup must say which namespace it will overwrite
// =======================================================================
test('F9: a backup records the workspace it was taken from', () => {
  const c = make();
  c._workspace = 'uid-alice';
  c.lsSet('pp-tasks', JSON.stringify([{ id:'a' }]));
  const bak = c.collectBackup();
  assert.equal(bak.workspace, 'uid-alice');
  const anon = make();
  anon._workspace = 'anon';
  anon.lsSet('pp-tasks', '[]');
  assert.equal(anon.collectBackup().workspace, 'anon');
});

test('F9: the import prompt names the namespace it will overwrite', () => {
  const c = make();
  c._workspace = 'anon';
  const msg = c.backupImportPrompt({ app:'ChronoCompose', version:1, workspace:'uid-alice', data:{} });
  assert.match(msg, /anon/i, 'the prompt must name the namespace being overwritten');
  assert.match(msg, /uid-alice/, 'and the namespace the backup came from');
  assert.match(msg, /different|not the same|mismatch/i, 'and flag the mismatch in words');
});

test('F9: a same-namespace import prompt does not cry wolf', () => {
  const c = make();
  c._workspace = 'anon';
  const msg = c.backupImportPrompt({ app:'ChronoCompose', version:1, workspace:'anon', data:{} });
  assert.match(msg, /anon/i);
  assert.doesNotMatch(msg, /different namespace/i);
});

test('F9: a legacy backup with no workspace stamp is handled without claiming a mismatch', () => {
  const c = make();
  c._workspace = 'uid-bob';
  const msg = c.backupImportPrompt({ app:'ChronoCompose', version:1, data:{} });
  assert.match(msg, /uid-bob/, 'still names the target');
  assert.doesNotMatch(msg, /different namespace/i);
});
