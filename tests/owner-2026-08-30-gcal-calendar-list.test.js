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
