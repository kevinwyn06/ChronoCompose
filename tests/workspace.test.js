// Per-account localStorage namespacing (clean-switch isolation). Covers the pure routing layer —
// wsKey / lsGet / lsSet / anonHasData / importAnonInto — that keeps one account's local data from
// leaking into another's (the RLS id-collision bug that prompted this work). The network switch
// (syncBeginWorkspaceSwitch → location.reload) stays manual, like the other sync/gcal network paths.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

test('wsKey: anon → bare key; a uid → suffixed key; global keys never get suffixed', () => {
  const c = make();
  c._workspace = 'anon';
  assert.equal(c.wsKey('pp-tasks'), 'pp-tasks');
  c._workspace = 'uid123';
  assert.equal(c.wsKey('pp-tasks'), 'pp-tasks::uid123');
  assert.equal(c.wsKey('pp-settings'), 'pp-settings::uid123');
  // device/bookkeeping/session keys share one slot regardless of the active workspace
  ['pp-theme', 'pp-sync', 'pp-workspace', 'pp-accounts', 'pp-auth'].forEach(k => {
    assert.equal(c.wsKey(k), k, k + ' must stay global');
  });
});

test('lsGet/lsSet: two accounts are fully isolated and round-trip independently', () => {
  const c = make();
  c._workspace = 'uidA'; c.lsSet('pp-tasks', 'AAA');
  c._workspace = 'uidB'; assert.equal(c.lsGet('pp-tasks'), null); // B cannot see A's data
  c.lsSet('pp-tasks', 'BBB');
  c._workspace = 'uidA'; assert.equal(c.lsGet('pp-tasks'), 'AAA'); // A intact after B wrote
  c._workspace = 'uidB'; assert.equal(c.lsGet('pp-tasks'), 'BBB');
  // anon is its own namespace, distinct from every uid
  c._workspace = 'anon'; c.lsSet('pp-tasks', 'ANON');
  c._workspace = 'uidA'; assert.equal(c.lsGet('pp-tasks'), 'AAA');
  c._workspace = 'anon'; assert.equal(c.lsGet('pp-tasks'), 'ANON');
});

test('a global key resolves to the same slot across workspaces', () => {
  const c = make();
  c._workspace = 'uidA'; c.lsSet('pp-theme', 'dark');
  c._workspace = 'uidB'; assert.equal(c.lsGet('pp-theme'), 'dark');
  c._workspace = 'anon'; assert.equal(c.lsGet('pp-theme'), 'dark');
});

test('lsRemove respects the active workspace', () => {
  const c = make();
  c._workspace = 'uidA'; c.lsSet('pp-pomo', 'X');
  c._workspace = 'uidB'; c.lsSet('pp-pomo', 'Y');
  c._workspace = 'uidA'; c.lsRemove('pp-pomo');
  assert.equal(c.lsGet('pp-pomo'), null);           // A cleared
  c._workspace = 'uidB'; assert.equal(c.lsGet('pp-pomo'), 'Y'); // B untouched
});

test('anonHasData: true only when the anon pp-tasks holds a non-empty array', () => {
  const c = make();
  c._workspace = 'anon';
  c.lsSet('pp-tasks', '[]');
  assert.equal(c.anonHasData(), false);
  c.lsSet('pp-tasks', JSON.stringify([{ id: 't1' }]));
  assert.equal(c.anonHasData(), true);
});

test('V0.2: a fresh anon workspace boots EMPTY — no silent demo seed', () => {
  const c = make(); // constructs under the default 'anon' workspace with an empty store
  assert.equal(c._workspace, 'anon');
  assert.ok(Array.isArray(c.state.tasks) && c.state.tasks.length === 0,
    'no workspace auto-seeds anymore — the empty state + first-run teach, they do not seed');
});

test('WS_IMPORT_KEYS excludes the transient outbound queues/tombstones', () => {
  const c = make();
  const imp = c.WS_IMPORT_KEYS();
  ['pp-sync-queue', 'pp-sync-tombstones', 'pp-sync-kv-queue', 'pp-sync-kv-tombstones',
    'pp-gcal-queue', 'pp-gcal-tombstones'].forEach(k => {
    assert.ok(!imp.includes(k), k + ' must NOT be importable');
  });
  // real data keys ARE importable
  ['pp-tasks', 'pp-settings', 'pp-habits', 'pp-journal'].forEach(k => {
    assert.ok(imp.includes(k), k + ' should be importable');
  });
});

test('importAnonInto: copies anon DATA keys but never the sync queue nor existing account data', () => {
  const c = make();
  c._workspace = 'anon';
  c.lsSet('pp-tasks', 'ANON_TASKS');
  c.lsSet('pp-settings', 'ANON_SETTINGS');
  c.lsSet('pp-sync-queue', '[{"op":"insert","id":"t1"}]'); // poisoned queue must NOT ride along
  // the account already has its own settings — import must leave those alone
  c._workspace = 'uidX'; c.lsSet('pp-settings', 'UID_SETTINGS');
  c._workspace = 'anon';                  // import reads the bare (anon) keys
  c.importAnonInto('uidX');
  c._workspace = 'uidX';
  assert.equal(c.lsGet('pp-tasks'), 'ANON_TASKS');      // copied (account had none)
  assert.equal(c.lsGet('pp-settings'), 'UID_SETTINGS'); // preserved (not overwritten)
  assert.equal(c.lsGet('pp-sync-queue'), null);         // queue NOT imported (the 2026-07-15 bug)
  // and the anon originals are still intact
  c._workspace = 'anon';
  assert.equal(c.lsGet('pp-tasks'), 'ANON_TASKS');
});
