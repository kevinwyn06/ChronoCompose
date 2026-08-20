// Serial chain block 10 — blocking vs background busy intervals.
//
// Block 10 adds the FIELD, its default, its gcal transparency mapping, its migration/sync, and one UI
// toggle. It must produce NO behaviour change: block 11 is what consumes the flag. These tests are
// therefore written in two halves — what the field must now do, and what must still be exactly as it
// was — because "the flag exists and changes nothing yet" is the whole acceptance criterion.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const H = 3600000;

function results(cid, items){ return [{ cid, items }]; }
function calById(cid, summary){ const o={}; o[cid]={ id:cid, summary }; return o; }
function timedEvent(over){
  return Object.assign({
    id:'ev1', status:'confirmed', summary:'Work',
    start:{ dateTime:'2026-07-02T09:00:00Z' },
    end:{ dateTime:'2026-07-02T10:00:00Z' },
    description:'',
  }, over||{});
}

// =======================================================================
// the field + its tri-state default
// =======================================================================
test('normalizeTask defaults blocking to null, and null resolves to BLOCKING_DEFAULT', () => {
  const c = make();
  const t = c.normalizeTask({ id:'b1' });
  assert.equal(t.blocking, null, 'null = inherit, never a stamped opinion');
  assert.equal(c.BLOCKING_DEFAULT, true, 'the default is blocking (owner 2026-08-06)');
  assert.equal(c.isBlockingTask(t), true);
});

test('isBlockingTask honours an explicit value and never reads the raw field elsewhere', () => {
  const c = make();
  assert.equal(c.isBlockingTask(c.normalizeTask({ id:'a', blocking:true })), true);
  assert.equal(c.isBlockingTask(c.normalizeTask({ id:'b', blocking:false })), false);
  assert.equal(c.isBlockingTask(c.normalizeTask({ id:'c', blocking:null })), true);
  assert.equal(c.isBlockingTask(undefined), true, 'a missing task must not throw');
});

test('normalizeTask preserves an existing blocking value (upgrade is a no-op on real data)', () => {
  const c = make();
  assert.equal(c.normalizeTask({ id:'d', blocking:false }).blocking, false);
});

test('setBlocking routes through commit() and cycles true -> false -> null', () => {
  const c = make();
  const t = activeTask(c, { id:'sb' });
  c.state.tasks = [t];
  c.setBlocking('sb', false);
  assert.equal(c.state.tasks.find(x=>x.id==='sb').blocking, false);
  c.setBlocking('sb', true);
  assert.equal(c.state.tasks.find(x=>x.id==='sb').blocking, true);
  c.setBlocking('sb', null);
  assert.equal(c.state.tasks.find(x=>x.id==='sb').blocking, null, 'Auto is reachable again');
  assert.ok(c.history.length >= 3, 'every toggle is undoable (it went through commit)');
  c.undo();
  assert.equal(c.state.tasks.find(x=>x.id==='sb').blocking, true, 'undo restores the previous value');
});

// =======================================================================
// Google Calendar transparency mapping
// =======================================================================
test('blockingFromEvent: transparent = background, opaque/absent = inherit (null)', () => {
  const c = make();
  assert.equal(c.blockingFromEvent({ transparency:'transparent' }), false);
  assert.equal(c.blockingFromEvent({ transparency:'opaque' }), null);
  assert.equal(c.blockingFromEvent({}), null, 'Google omits the field for Busy');
  assert.equal(c.blockingFromEvent(null), null);
});

test('mergeCalendarEvents: a transparent event imports as background', () => {
  const c = make();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent({ transparency:'transparent' })]), {}, calById('cal1','Work'));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].blocking, false);
  assert.equal(c.isBlockingTask(tasks[0]), false);
});

test('mergeCalendarEvents: a busy (opaque/absent) event imports as inherit-blocking', () => {
  const c = make();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  assert.equal(tasks[0].blocking, null, 'no opinion stamped');
  assert.equal(c.isBlockingTask(tasks[0]), true);
});

test('mergeCalendarEvents: re-import never overwrites a local blocking choice', () => {
  const c = make();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  tasks[0].blocking = false;                       // the user toggled it in the detail panel
  const r = c.mergeCalendarEvents(tasks, results('cal1', [timedEvent({ summary:'Work (renamed)' })]), {}, calById('cal1','Work'));
  assert.equal(r.updated, 1);
  assert.equal(tasks[0].name, 'Work (renamed)', 'the update path did run');
  assert.equal(tasks[0].blocking, false, 'local authority, like planned/goal/description');
});

// =======================================================================
// migration + sync — both directions
// =======================================================================
test('SYNC_FIELDS gains blocking and snoozeUntil as ONE batch', () => {
  const c = make();
  const f = c.SYNC_FIELDS();
  assert.ok(f.includes('blocking'));
  assert.ok(f.includes('snoozeUntil'));
});

// This test used to assert the OPPOSITE — that `sectionId` stays out, because "the pp-sections STORE is
// unsynced, so a mirrored sectionId would dangle". That reasoning was right, and it was retired by
// removing its premise rather than by overriding it: migration 0012 gives the store a table and
// `saveSections` feeds the kv funnel, so the referent now travels with the reference. The dangling-id
// rule itself still holds and is what the second assertion here pins.
test('sectionId joins SYNC_FIELDS only because the sections STORE is synced too (owner 2026-08-15)', () => {
  const c = make();
  assert.ok(c.SYNC_FIELDS().includes('sectionId'), 'the reference is mirrored');
  assert.ok(c.KV_TABLES().includes('sections'),
    'and the referent is too — mirroring one without the other is the trap 0008 refused to walk into');
});

test('UPGRADE: a legacy row with no blocking column normalizes to inherit-blocking', () => {
  const c = make();
  // exactly what a pre-0008 Postgres row looks like coming back through rowToTask
  const legacy = c.rowToTask({ id:'old1', name:'Legacy', priority:4, pct:0, planned:60,
    spent:0, predicted:0, owner_id:'u1', updated_at:'2026-07-01T00:00:00Z' });
  assert.equal(legacy.blocking, null);
  assert.equal(c.isBlockingTask(legacy), true, 'existing tasks migrate to blocking, i.e. unchanged behaviour');
  assert.equal(legacy.snoozeUntil, null);
});

test('DOWNGRADE: an explicit false survives the row round-trip verbatim', () => {
  const c = make();
  const t = c.normalizeTask({ id:'rt', name:'Work', blocking:false, snoozeUntil:1234567890000 });
  const row = c.syncRowOf(t);
  assert.equal(row.blocking, false, 'the mirrored row carries the field name VERBATIM (the pin rename trap)');
  assert.equal(row.snoozeUntil, 1234567890000);
  const back = c.rowToTask(Object.assign({ owner_id:'u1' }, row));
  assert.equal(back.blocking, false);
  assert.equal(back.snoozeUntil, 1234567890000);
});

test('syncRowForWrite keeps blocking/snoozeUntil untouched (no unit conversion)', () => {
  const c = make();
  const r = c.syncRowForWrite(c.syncRowOf(c.normalizeTask({ id:'w', blocking:true, snoozeUntil:99 })));
  assert.equal(r.blocking, true);
  assert.equal(r.snoozeUntil, 99);
  assert.equal('updatedAt' in r, false);
});

test('a blocking change is a real edit: the sync fingerprint moves', () => {
  const c = make();
  const a = c.normalizeTask({ id:'fp' });
  const b = c.normalizeTask({ id:'fp', blocking:false });
  assert.notEqual(c.syncRowFp(a), c.syncRowFp(b));
  const ops = c.computeSyncOps([a], [b]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'update');
  assert.equal(ops[0].row.blocking, false);
});

test('blocking round-trips through the JSON backup', () => {
  const c = make();
  c.saveTasks([c.normalizeTask({ id:'bk', name:'Work', blocking:false })]);
  const dump = JSON.parse(JSON.stringify(c.collectBackup()));
  c.saveTasks([]);
  c.applyBackup(dump);
  const back = JSON.parse(c.lsGet('pp-tasks'));
  assert.equal(back[0].blocking, false);
});

// =======================================================================
// busy-interval annotation — the shape block 11 reads
// =======================================================================
// 2026-08-19: the lunch/dinner half of this test is retired with the hardcoded meals — they are tasks
// now, and a task's blocking flag is its own (covered by the fixedBlocksToday test below). The free-time
// reserve is the ONE busy interval dayIntervals still synthesises without a task behind it, which is
// exactly why its default has to be stated here.
test('dayIntervals: the free-time reserve is BLOCKING', () => {
  const c = make();
  cleanDay(c, '23:59');
  Object.assign(c.state.settings, { freeTime:60 });
  const B = c.startOfToday();
  const di = c.dayIntervals(B, null, [], []);
  const byNote = {}; di.busy.forEach(b => { byNote[b.note] = b; });
  assert.equal(byNote['Free time'].blocking, true, 'the reserve carries no task, so the default is stated here');
});

test('fixedBlocksToday: a fixed appointment inherits its task flag; a drag pin is background', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const appt = activeTask(c, { id:'ap', start:B + 9*H, end:B + 10*H, startClock:true, endClock:true, planned:60 });
  const bg   = activeTask(c, { id:'bg', start:B + 14*H, end:B + 15*H, startClock:true, endClock:true, planned:60, blocking:false });
  const pinned = activeTask(c, { id:'pn', start:B - DAY, end:B + DAY, planned:60,
    pin:[{ day:B, start:B + 20*H, dur:60, partial:true }] });
  const blocks = c.fixedBlocksToday(B, [appt, bg, pinned]);
  const byId = {}; blocks.forEach(b => { byId[b.taskId] = b; });
  assert.equal(byId['ap'].blocking, true, 'inherit-null appointment is blocking');
  assert.equal(byId['bg'].blocking, false, 'an explicit background appointment');
  assert.equal(byId['pn'].blocking, false, 'two hand-placed blocks may still overlap each other');
  assert.equal(byId['pn'].dragPin, true, 'the existing pin shape is unchanged');
});

test('extraBusy carries its own flag through dayIntervals unchanged', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const di = c.dayIntervals(B, null, [
    { start:B + 9*H, end:B + 10*H, note:'A', taskId:'a', blocking:false },
    { start:B + 11*H, end:B + 12*H, note:'B', taskId:'b', blocking:true },
    { start:B + 13*H, end:B + 14*H, note:'C', taskId:'c' },
  ], []);
  const byNote = {}; di.busy.forEach(b => { byNote[b.note] = b; });
  assert.equal(byNote['A'].blocking, false);
  assert.equal(byNote['B'].blocking, true);
  assert.equal(byNote['C'].blocking, true, 'an unannotated interval falls back to BLOCKING_DEFAULT');
});

// =======================================================================
// NO BEHAVIOUR CHANGE — the acceptance criterion of this block
// =======================================================================
test('block 10 changes nothing about the pool: a background appointment still consumes its time', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const mk = flag => [
    activeTask(c, { id:'ap', start:B + 9*H, end:B + 11*H, startClock:true, endClock:true, planned:120, blocking:flag }),
    activeTask(c, { id:'fx', start:B - DAY, end:B + DAY, planned:600 }),
  ];
  const blocking   = c.computeAllotted(mk(true));
  const background = c.computeAllotted(mk(false));
  assert.equal(background['fx'].allotted, blocking['fx'].allotted,
    'the flag is inert in block 10 — block 11 is what consumes it');
});

test('block 10 changes nothing about the free intervals a background appointment leaves', () => {
  const c = make();
  cleanDay(c, '23:59');
  const B = c.startOfToday();
  const appt = f => activeTask(c, { id:'ap', start:B + 9*H, end:B + 11*H, startClock:true, endClock:true, planned:120, blocking:f });
  const free = f => c.dayIntervals(B, null, c.fixedBlocksToday(B, [appt(f)]), []).free.map(iv => iv.start + '-' + iv.end);
  assert.deepEqual(free(false), free(true), 'still carved out identically');
});
