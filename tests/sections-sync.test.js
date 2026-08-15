// ACCEPTANCE → AUTOMATION.
//
// Owner report (2026-08-15): *"My section grouping is different on vercel (main) and local host (dev).
// That seems to suggest it's not synced - it should be."*
//
// It was not synced, and not by accident: `pp-sections` had no Supabase table, and `tasks."sectionId"`
// was deliberately held out of SYNC_FIELDS by migration 0008 on the grounds that mirroring a reference
// whose referent does not sync would file a fresh device's tasks under sections that exist nowhere.
// Migration 0012 adds the table; `saveSections` now feeds the kv blob funnel; `sectionId` joins
// SYNC_FIELDS. These tests pin the parts that are pure — the map/list round trip, the choke point, and
// the reference/referent pairing that is the whole justification for the change.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

function comp() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.settings.syncEnabled = true;
  return c;
}
const sec = (id, name, order) => ({ id, name, order });
// The component runs in a VM context, so the arrays/objects it builds have a different prototype than
// this file's literals and deepStrictEqual compares prototypes. Compare through JSON instead.
const plain = v => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------------
// the pairing rule — the actual argument for this change
// ---------------------------------------------------------------------------------------------------
test('the sections STORE and the sectionId REFERENCE sync together, or not at all', () => {
  const c = make();
  const refSynced = c.SYNC_FIELDS().includes('sectionId');
  const storeSynced = c.KV_TABLES().includes('sections');
  assert.strictEqual(refSynced, storeSynced,
    'shipping one without the other is the dangling-id trap migration 0008 refused to walk into');
  assert.ok(refSynced, 'and as of 2026-08-15 both are on');
});

// ---------------------------------------------------------------------------------------------------
// the pure map <-> list round trip
// ---------------------------------------------------------------------------------------------------
test('sectionsToMap/sectionsFromMap round-trip a list without losing or reordering anything', () => {
  const c = make();
  const list = [sec('a', 'Work', 0), sec('b', 'Home', 1), sec('c', 'Errands', 2)];
  const back = c.sectionsFromMap(c.sectionsToMap(list));
  assert.deepStrictEqual(back.map(s => s.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(back.map(s => s.name), ['Work', 'Home', 'Errands']);
});

// The re-sort is the part that is not optional. Rows arrive from Postgres in whatever order the pull
// returns them; two devices agreeing on the ROWS while disagreeing on the ORDER is the owner's original
// symptom wearing a different hat.
test('sectionsFromMap sorts by order, so pull order cannot change the grouping', () => {
  const c = make();
  const shuffled = { c: sec('c', 'Third', 2), a: sec('a', 'First', 0), b: sec('b', 'Second', 1) };
  assert.deepStrictEqual(c.sectionsFromMap(shuffled).map(s => s.id), ['a', 'b', 'c']);
});

test('sectionsFromMap breaks order ties by id, so the result is deterministic across devices', () => {
  const c = make();
  const tied = { zz: sec('zz', 'Z', 5), aa: sec('aa', 'A', 5), mm: sec('mm', 'M', 5) };
  assert.deepStrictEqual(c.sectionsFromMap(tied).map(s => s.id), ['aa', 'mm', 'zz'],
    'a tie must not resolve to whatever order the object keys happened to come back in');
});

test('sectionsFromMap normalizes what it builds, so a malformed remote row cannot poison the list', () => {
  const c = make();
  const out = c.sectionsFromMap({ x: { name: null, order: 'not-a-number' } });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'x', 'the map key is authoritative for the id');
  assert.strictEqual(out[0].name, 'New section', 'a missing name degrades to the default, not to null');
  assert.strictEqual(out[0].order, 0, 'a non-numeric order degrades to 0 rather than corrupting the sort');
});

test('sectionsToMap skips entries with no id — an unkeyed row has nowhere to go', () => {
  const c = make();
  const m = c.sectionsToMap([sec('a', 'Work', 0), { name: 'orphan' }, null]);
  assert.deepStrictEqual(Object.keys(m), ['a']);
});

// ---------------------------------------------------------------------------------------------------
// the choke point
// ---------------------------------------------------------------------------------------------------
// Every section mutation already routes through saveSections (add / rename / reorder / delete), which is
// why one line covers the whole entity — the same property that made saveHabits sufficient for habits.
test('saveSections enqueues the diff — it is the sections sync choke point', () => {
  const c = comp();
  const seen = [];
  c.syncKvOut = (table, before, after) => seen.push({ table, before, after });

  c.saveSections([sec('a', 'Work', 0)]);
  assert.strictEqual(seen.length, 1, 'saving sections funnels outbound');
  assert.strictEqual(seen[0].table, 'sections', 'to the sections table, not habits or journal');
  assert.deepStrictEqual(Object.keys(seen[0].before), [], 'diffed against what was there before');
  assert.deepStrictEqual(Object.keys(seen[0].after), ['a'], 'and against what is there now');
});

test('saveSections still writes localStorage and state — sync is added, not substituted', () => {
  const c = comp();
  c.syncKvOut = () => {};
  c.saveSections([sec('a', 'Work', 0), sec('b', 'Home', 1)]);
  assert.deepStrictEqual((c.state.sections || []).map(s => s.id), ['a', 'b'], 'state updated');
  assert.deepStrictEqual(JSON.parse(c.lsGet('pp-sections')).map(s => s.id), ['a', 'b'], 'store written');
});

test('a rename shows up as an update op, not an insert plus a delete', () => {
  const c = comp();
  const before = c.sectionsToMap([sec('a', 'Work', 0)]);
  const after = c.sectionsToMap([sec('a', 'Deep work', 0)]);
  const ops = c.computeKvOps(before, after);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].op, 'update');
  assert.strictEqual(ops[0].id, 'a');
});

test('a reorder is an update on every section whose order actually moved', () => {
  const c = comp();
  const before = c.sectionsToMap([sec('a', 'Work', 0), sec('b', 'Home', 1)]);
  const after = c.sectionsToMap([sec('a', 'Work', 1), sec('b', 'Home', 0)]);
  const ops = c.computeKvOps(before, after);
  assert.deepStrictEqual(plain(ops.map(o => o.op)).sort(), ['update', 'update']);
});

test('deleting a section produces a delete op', () => {
  const c = comp();
  const ops = c.computeKvOps(c.sectionsToMap([sec('a', 'Work', 0), sec('b', 'Home', 1)]),
                             c.sectionsToMap([sec('a', 'Work', 0)]));
  assert.deepStrictEqual(plain(ops), [{ op: 'delete', id: 'b' }]);
});

// Re-saving an identical list must be silent, or every render that touches the store would push.
test('saving an unchanged list enqueues nothing', () => {
  const c = comp();
  const same = c.sectionsToMap([sec('a', 'Work', 0)]);
  assert.deepStrictEqual(plain(c.computeKvOps(same, c.sectionsToMap([sec('a', 'Work', 0)]))), []);
});

// ---------------------------------------------------------------------------------------------------
// inbound merge
// ---------------------------------------------------------------------------------------------------
test('a remote section merges in and lands in its sorted position, not appended', () => {
  const c = comp();
  c.syncKvOut = () => {};
  c.saveSections([sec('a', 'First', 0), sec('c', 'Third', 2)]);
  c.syncApplyKvRemote('sections', 'b', sec('b', 'Second', 1));
  assert.deepStrictEqual((c.state.sections || []).map(s => s.id), ['a', 'b', 'c'],
    'the pulled section sorts into place — appending it would reproduce the reported bug');
});

test('a remote delete removes the section locally', () => {
  const c = comp();
  c.syncKvOut = () => {};
  c.saveSections([sec('a', 'Work', 0), sec('b', 'Home', 1)]);
  c.syncApplyKvRemote('sections', 'b', null);
  assert.deepStrictEqual((c.state.sections || []).map(s => s.id), ['a']);
});

// Applying a pulled row calls saveSections, which is the outbound choke point — so without the
// `_syncApplying` guard every inbound merge would immediately push itself back. The real `syncKvOut` is
// left in place here on purpose: the guard lives inside it, so stubbing it would test nothing.
test('an inbound merge does not echo back out — _syncApplying gates the funnel', () => {
  const c = comp();
  let enqueued = 0;
  c.syncKvEnqueue = () => { enqueued++; };

  c.saveSections([sec('a', 'Work', 0)]);
  assert.ok(enqueued > 0, 'a LOCAL save does enqueue — otherwise this test proves nothing');

  enqueued = 0;
  c.syncApplyKvRemote('sections', 'b', sec('b', 'Home', 1));
  assert.strictEqual(enqueued, 0, 'applying a pulled row must not re-enqueue it');
  assert.deepStrictEqual(plain((c.state.sections || []).map(s => s.id)), ['a', 'b'],
    'and the merge still happened — suppressed echo, not a suppressed write');
});

// A stale remote row must lose, or a device that has been offline would drag everyone backwards on
// reconnect. This is the shared kv LWW rule; the test states it in sections' own terms.
test('a stale remote section loses to a newer local one', () => {
  const c = comp();
  const local = Object.assign(sec('a', 'Local name', 0), { updatedAt: 9000 });
  const remote = Object.assign(sec('a', 'Stale name', 0), { updatedAt: 10 });
  assert.strictEqual(c.kvMergeDecision(local, remote, null), 'none');
  assert.strictEqual(c.kvMergeDecision(local, Object.assign({}, remote, { updatedAt: 99999 }), null), 'set');
});
