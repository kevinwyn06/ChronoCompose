const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// Task 2 (Chain G) — the Google Calendar double import.
//
// Diagnosed mechanism ("M1"):
// `stampEventId` closes the insert loop by writing `eventId`/`calendarId` — both of which are in
// SYNC_FIELDS — with a bare setState+saveTasks. It never stamps `updatedAt` and never feeds the
// Supabase outbound funnel. So the link is invisible to the server, and the very next echo of the
// row the server DOES hold (whose `touch_updated_at` trigger makes it strictly newer) wins LWW and
// `mergeRemoteOverLocal` assigns `eventId = null` straight back over it. The following commit sees
// `!t.eventId` at the outbound-insert guard and queues a SECOND insert — a second real Google event.
//
// This is not a race. The server clock is newer than the client's by construction, so it reproduces
// every time. Both duplicate pairs in the owner's workspace carry two distinct eventIds on the same
// calendar, which is that signature exactly.

function seedLinkedTask(c, over){
  const t = c.normalizeTask(Object.assign({
    id:'t1', name:'Lunch', type:'Proportional',
    start: 1787254200000, end: 1787257800000,
    priority:4, deps:[], pct:0, planned:60, spent:0,
    calendarId:null, eventId:null, updatedAt: 1000,
  }, over||{}));
  c.state.tasks = [t];
  return t;
}

// Capture what the Supabase funnel is handed, without any network.
function captureSync(c){
  const ops = [];
  c.state.settings.syncEnabled = true;
  c.syncEnqueue = list => { list.forEach(o => ops.push(o)); };
  return ops;
}

test('gcal dedupe: stampEventId records the link as a synced, clocked change', () => {
  const c = make();
  const t = seedLinkedTask(c);
  const ops = captureSync(c);

  c.stampEventId('t1', 'evt-first', 'cc-cal');

  const after = c.state.tasks.find(x => x.id === 't1');
  assert.strictEqual(after.eventId, 'evt-first', 'the link must land on the task');
  assert.strictEqual(after.calendarId, 'cc-cal');

  // Without a fresh clock the stamp loses every LWW race it ever enters.
  assert.ok(after.updatedAt > t.updatedAt,
    'stampEventId must bump updatedAt — eventId is a SYNC_FIELD, so an unstamped write is invisible to LWW');

  // Without a push the server never learns the link, so every echo carries eventId:null forever.
  const pushed = ops.filter(o => o.id === 't1' && o.row && o.row.eventId === 'evt-first');
  assert.strictEqual(pushed.length, 1,
    'stampEventId must feed the Supabase outbound funnel so the server learns the eventId');
});

test('gcal dedupe: a server echo cannot wipe a just-stamped link and cause a second insert', () => {
  const c = make();
  seedLinkedTask(c);
  captureSync(c);

  c.stampEventId('t1', 'evt-first', 'cc-cal');
  const stamped = c.state.tasks.find(x => x.id === 't1');

  // The echo of the CREATE write. The server's touch_updated_at trigger stamped it after the client's
  // create clock (1000) but before the insert POST came back, so it is newer than the create and older
  // than the stamp. It has never heard of the eventId.
  const echo = Object.assign({}, c.syncRowOf(stamped), {
    eventId: null, calendarId: null, updatedAt: 1500,
  });

  const merged = c.applyRemoteSnapshot(c.state.tasks, [echo], {});
  const after = merged.find(x => x.id === 't1');

  assert.strictEqual(after.eventId, 'evt-first',
    'a stale echo that predates the stamp must not un-make the Google link');

  // And therefore the outbound builder queues no second insert for an already-linked task.
  const ops = c.computeOutboundOps(c.state.tasks, merged);
  const inserts = ops.filter(o => o.op === 'insert' && o.taskId === 't1');
  // strictEqual on the length, not deepStrictEqual on the array: `ops` is built inside the VM sandbox,
  // so its Array prototype is not this realm's and a deep-equal of two empty arrays fails on identity.
  assert.strictEqual(inserts.length, 0,
    'a task that already carries an eventId must never be queued for a second Google insert');
});
