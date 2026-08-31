const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// Owner report 2026-08-30: "the birthday calendar is missing, and I think some other ones are too."
// Two independent causes, both confirmed live against the QA account before these tests were written:
//   1. calendarList never returns the Birthdays calendar (not even with showHidden=true), yet
//      `calendars.get` on its id answers 200 — so the picker, built purely from calendarList, could
//      never offer it.
//   2. gcalListCalendars sent no parameters, so it took Google's 100-entry default and never followed
//      nextPageToken.
// The network itself stays manual (as with the rest of gcal IO), so these drive the real methods with
// gcalFetch stubbed — the paging/merge decisions are what regressed, and they are IO-free.

const BIRTHDAYS = 'addressbook#contacts@group.v.calendar.google.com';

// Arrays that cross the VM boundary carry the sandbox realm's Array.prototype, which deepStrictEqual
// rejects on identity alone. Compare id lists as strings — the assertion is about order and contents.
const ids = list => list.map(x=>x.id).join(',');

// Stub gcalFetch with a url->response map, recording every url requested.
function stub(c, routes){
  const seen = [];
  c.gcalFetch = (url)=>{ seen.push(url);
    for(const [frag, res] of routes){ if(url.indexOf(frag) !== -1){
      return (res instanceof Error) ? Promise.reject(res) : Promise.resolve(res); } }
    return Promise.reject(new Error('unrouted ' + url));
  };
  return seen;
}

const cal = (id, summary)=>({ id, summary, backgroundColor:'#123456' });

test('gcalListCalendarPages: follows nextPageToken across every page', async () => {
  const c = make();
  const seen = stub(c, [
    ['pageToken=p2', { items:[cal('c','C')] }],
    ['pageToken=p1', { items:[cal('b','B')], nextPageToken:'p2' }],
    ['calendarList',  { items:[cal('a','A')], nextPageToken:'p1' }],
  ]);
  const items = await c.gcalListCalendarPages();
  assert.strictEqual(ids(items), ['a','b','c'].join(','));
  assert.strictEqual(seen.length, 3);
  // The first request must already ask for the full page size, or page 1 silently truncates at 100.
  assert.ok(seen[0].indexOf('maxResults=250') !== -1, seen[0]);
});

test('gcalListCalendarPages: a single page stops after one request', async () => {
  const c = make();
  const seen = stub(c, [['calendarList', { items:[cal('a','A')] }]]);
  const items = await c.gcalListCalendarPages();
  assert.strictEqual(ids(items), ['a'].join(','));
  assert.strictEqual(seen.length, 1);
});

test('gcalAppendUnlisted: appends Birthdays, which calendarList never returns', async () => {
  const c = make();
  stub(c, [['/calendars/', { id:BIRTHDAYS, summary:'Birthdays' }]]);
  const out = await c.gcalAppendUnlisted([{ id:'me@x.com', summary:'me@x.com', color:'#1' }]);
  assert.strictEqual(ids(out), ['me@x.com', BIRTHDAYS].join(','));
  assert.strictEqual(out[1].summary, 'Birthdays');
});

test('gcalAppendUnlisted: no duplicate row if Google ever does list it', async () => {
  const c = make();
  const seen = stub(c, [['/calendars/', { id:BIRTHDAYS, summary:'Birthdays' }]]);
  const out = await c.gcalAppendUnlisted([{ id:BIRTHDAYS, summary:'Birthdays', color:'#1' }]);
  assert.strictEqual(ids(out), [BIRTHDAYS].join(','));
  assert.strictEqual(seen.length, 0, 'an already-listed id must not be probed at all');
});

test('gcalAppendUnlisted: a failed probe degrades to "not offered", never to a failed list', async () => {
  const c = make();
  stub(c, [['/calendars/', Object.assign(new Error('404 not found'), { status:404 })]]);
  const out = await c.gcalAppendUnlisted([{ id:'me@x.com', summary:'me@x.com', color:'#1' }]);
  assert.strictEqual(ids(out), ['me@x.com'].join(','));
});

test('gcalListCalendars: Birthdays reaches gcal.calendars end to end', async () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars:[], selected:{} });
  c.state.tasks = [];
  stub(c, [
    ['/calendars/',  { id:BIRTHDAYS, summary:'Birthdays' }],
    ['calendarList', { items:[cal('me@x.com','me@x.com')] }],
  ]);
  c.gcalListCalendars();
  await new Promise(r=>setImmediate(r));
  await new Promise(r=>setImmediate(r));
  assert.strictEqual(ids(c.state.gcal.calendars), ['me@x.com', BIRTHDAYS].join(','));
  assert.strictEqual(c.state.gcal.msg, '2 calendars loaded');
});

// ---------------------------------------------------------------------------------------------
// Follow-up review 2026-08-31. Appending an unlisted calendar gave `gcal.calendars` a member whose
// presence depends on a probe that catches EVERY error — while `gcalReconcileLinks` still treated
// that same list as authoritative. The two together silently destroyed links.

test('gcalReconcileLinks: an unlisted calendar is never "gone", even absent from the list', async () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars:[], selected:{} });
  c.state.tasks = [{ id:'t1', title:"test's birthday", calendarId:BIRTHDAYS, eventId:'E1', labels:[] }];
  // calendarList answers normally; the Birthdays probe fails transiently (503, not 404).
  stub(c, [
    ['/calendars/',  Object.assign(new Error('backendError'), { status:503 })],
    ['calendarList', { items:[cal('me@x.com','me@x.com')] }],
  ]);
  c.gcalListCalendars();
  for(let i=0;i<6;i++) await new Promise(r=>setImmediate(r));
  assert.strictEqual(ids(c.state.gcal.calendars), ['me@x.com'].join(','), 'a failed probe still drops the row');
  assert.strictEqual(c.state.tasks[0].calendarId, BIRTHDAYS, 'but the task link must survive');
  assert.strictEqual(c.state.tasks[0].eventId, 'E1');
});

test('gcalReconcileLinks: a genuinely removed calendar is still unlinked', async () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars:[], selected:{} });
  c.state.tasks = [{ id:'t1', title:'old', calendarId:'gone@x.com', eventId:'E1', labels:[] }];
  stub(c, [
    ['/calendars/',  { id:BIRTHDAYS, summary:'Birthdays' }],
    ['calendarList', { items:[cal('me@x.com','me@x.com')] }],
  ]);
  c.gcalListCalendars();
  for(let i=0;i<6;i++) await new Promise(r=>setImmediate(r));
  assert.strictEqual(c.state.tasks[0].calendarId, null, 'the exemption must not blanket-disable reconcile');
  assert.strictEqual(c.state.tasks[0].eventId, null);
});

test('gcalListCalendarPages: a repeated nextPageToken terminates instead of looping forever', async () => {
  const c = make();
  const seen = [];
  // Every page hands back the SAME token — the shape that would otherwise never terminate.
  c.gcalFetch = (url)=>{ seen.push(url); return Promise.resolve({ items:[cal('a'+seen.length,'A')], nextPageToken:'same' }); };
  const items = await c.gcalListCalendarPages();
  assert.strictEqual(seen.length, 2, 'first page, then the token once — never again');
  assert.strictEqual(ids(items), ['a1','a2'].join(','));
});

// Offering Birthdays in the picker means an imported task can be edited locally, and Birthdays events
// are READ-ONLY in Google. The handoff for #168 left that path untested. It must not jam the queue.
test('a read-only calendar rejecting a PATCH drops the op instead of jamming the queue', async () => {
  const c = make();
  let q = [{ op:'patch', taskId:'t1', eventId:'E1', calendarId:BIRTHDAYS,
             body:{ summary:'renamed' }, queueVersion:c.GCAL_QUEUE_VERSION }];
  c.loadQueue = () => q; c.saveQueue = (x) => { q = x; };
  c.saveTasks = () => {};
  c._token = 'tok';
  let calls = 0;
  c.gcalFetch = () => { calls++; return Promise.reject(Object.assign(new Error('forbiddenForNonOrganizer'), { status:403 })); };
  c.gcalFlushQueue();
  for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r));
  assert.strictEqual(calls, 1, 'a permanent 403 is not retried');
  assert.strictEqual(q.length, 0, 'the op is dropped, so it cannot block every later write');
  assert.strictEqual(c._gcalFlushing, false, 'and the flush lock is released');
});
