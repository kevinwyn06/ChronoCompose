const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, loadComponent } = require('./_load.js');

const event = (id, summary, start, end) => ({
  id, status: 'confirmed', summary,
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(end).toISOString() },
});

function textOf(node){
  if(node == null || node === false) return '';
  if(typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textOf).join(' ');
}

test('Calendar is two-way without a setting gate, while import echo suppression remains', () => {
  const c = make();
  const before = activeTask(c, { id:'linked', name:'old', eventId:'ev1', calendarId:'cal1' });
  const after = Object.assign({}, before, { name:'local edit' });

  assert.equal(Object.hasOwn(c.DEFAULT_SETTINGS(), 'gcalTwoWay'), false);
  c.gcalSyncOut([before], [after]);
  assert.equal(c.loadQueue().length, 1, 'a linked edit always queues');
  assert.equal(c.loadQueue()[0].body.summary, 'local edit');
  assert.equal(c.loadQueue()[0].queueVersion, c.GCAL_QUEUE_VERSION, 'new writes carry the current queue generation');

  c.saveQueue([]);
  c._gcalApplying = true;
  c.gcalSyncOut([before], [after]);
  assert.equal(c.loadQueue().length, 0, 'a pulled import never echoes back out');
});

test('a pending current patch protects local title/dates from a background re-import', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const local = activeTask(c, { id:'linked', name:'local edit', start:B+4*3600000, end:B+5*3600000,
    eventId:'ev1', calendarId:'cal1', planned:77, goal:'mine', description:'<p>mine</p>' });
  const pending = [{ op:'patch', taskId:'linked', eventId:'ev1', calendarId:'cal1', queueVersion:c.GCAL_QUEUE_VERSION }];
  c.mergeCalendarEvents([local], [{ cid:'cal1', items:[event('ev1', 'stale remote', B+3600000, B+2*3600000)] }],
    {}, { cal1:{ id:'cal1', summary:'Work' } }, {}, pending);

  assert.equal(local.name, 'local edit');
  assert.equal(local.start, B+4*3600000);
  assert.equal(local.end, B+5*3600000);
  assert.equal(local.planned, 77, 'existing protected local fields remain protected');
  assert.equal(local.goal, 'mine');
  assert.equal(local.description, '<p>mine</p>');
});

test('legacy non-delete queue entries cannot flush after the always-two-way upgrade', async () => {
  const c = make();
  c._token = 'token'; c._tokenExp=Date.now()+3600000;
  c.saveQueue([{ op:'patch', taskId:'linked', eventId:'ev1', calendarId:'cal1', body:{ summary:'stale' } }]);
  const calls=[];
  c.gcalFetch = (...args) => { calls.push(args); return Promise.resolve({}); };
  c.gcalImport = () => {};
  c.gcalFlushQueue();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 0, 'an unversioned edit from the old opt-in mode is discarded, not sent');
  assert.equal(c.loadQueue().length, 0);
});

test('a newer queued edit is not lost when an older in-flight patch finishes', async () => {
  const c = make();
  c._token = 'token';
  const before = activeTask(c, { id:'linked', name:'before', eventId:'ev1', calendarId:'cal1' });
  const first = Object.assign({}, before, { name:'first' });
  const second = Object.assign({}, before, { name:'second' });
  c.gcalSyncOut([before], [first]);
  let releaseFirst;
  const sent=[];
  c.gcalFetch = (_url, opts) => {
    sent.push(JSON.parse(opts.body).summary);
    if(sent.length === 1) return new Promise(resolve => { releaseFirst = resolve; });
    return Promise.resolve({});
  };
  c.gcalImport = () => {};
  c.gcalFlushQueue();
  c.gcalSyncOut([first], [second]);
  releaseFirst({});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(sent, ['first', 'second'], 'the replacement op drains after the in-flight op');
  assert.equal(c.loadQueue().length, 0);
});

test('legacy deletes still flush and retain the tombstone until Google accepts them', async () => {
  const c = make();
  c._token = 'token';
  c.saveQueue([{ op:'delete', taskId:'gone', eventId:'ev1', calendarId:'cal1' }]);
  c.saveTombstones({ ev1:Date.now() });
  const calls=[];
  c.gcalFetch = (...args) => { calls.push(args); return Promise.resolve({}); };
  c.gcalImport = () => {};
  c.gcalFlushQueue();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, 'DELETE');
  assert.equal(c.loadQueue().length, 0);
  assert.equal(c.loadTombstones().ev1, undefined, 'accepted remote delete clears its anti-resurrection tombstone');
});

test('Settings describes always-two-way sync and keeps backfill explicit', () => {
  const c = make();
  c.state.settingsTab = 'integrations';
  // UI revamp block 11b: the calendar controls exist only when signed in (signed out they cannot connect).
  c.state.sync = Object.assign({}, c.state.sync, { connected: true });
  const text = textOf(c.renderSettings());
  assert.doesNotMatch(text, /Two-way sync \(beta\)|one-way/i);
  assert.match(text, /local changes.*push to Google/i);
  assert.match(text, /Backfill to Google/i);
  assert.equal(c.loadQueue().length, 0, 'rendering or upgrading does not broadly backfill existing tasks');
});

test('a just-patched event moved outside the import window is not pruned', () => {
  const c = make();
  const linked = activeTask(c, { id:'linked', eventId:'ev1', calendarId:'cal1' });
  const tasks = [linked];
  const removed = c.pruneDeletedEvents(tasks, [{ cid:'cal1', items:[] }], ['cal1'], new Set(), new Set(['cal1|ev1']));
  assert.equal(removed, 0, 'absence from the bounded pull is not deletion evidence for the event just moved');
  assert.equal(tasks[0], linked);
});

test('a successful PATCH carries its event into the bounded verification pull exemption', async () => {
  const c = make();
  c._token = 'token';
  c.saveQueue([{op:'patch',taskId:'linked',eventId:'ev1',calendarId:'cal1',body:{summary:'moved'},
    queueVersion:c.GCAL_QUEUE_VERSION,queueId:'q1'}]);
  c.gcalFetch = () => Promise.resolve({});
  let importOpts;
  c.gcalImport = opts => { importOpts=opts; };
  c.gcalFlushQueue();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(importOpts.preserveEventIds.has('cal1|ev1'));
});

test('a live event moved outside the window survives the next normal bounded poll too', async () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [activeTask(c, { id:'linked', eventId:'ev1', calendarId:'cal1' })];
  Object.assign(c.state.gcal, { selected:{cal1:true}, calendars:[{id:'cal1',summary:'Work'}], window:30 });
  c._token = 'token';
  c.gcalFetch = url => Promise.resolve(url.includes('?singleEvents=')
    ? {items:[]}
    : event('ev1', 'still live outside the window', B-2*86400000, B-86400000));

  c.gcalImport({silent:true,preserveEventIds:new Set(['cal1|ev1'])});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.tasks.length, 1, 'immediate verification keeps the just-moved task');

  c.gcalImport({silent:true});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.tasks.length, 1, 'a later bounded-list miss is verified directly, not treated as deletion');
});

test('an authoritative by-id 404 still removes a remotely deleted linked task', async () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id:'linked', eventId:'ev1', calendarId:'cal1' })];
  Object.assign(c.state.gcal, { selected:{cal1:true}, calendars:[{id:'cal1',summary:'Work'}], window:30 });
  c._token = 'token';
  c.gcalFetch = url => {
    if(url.includes('?singleEvents=')) return Promise.resolve({items:[]});
    const e=new Error('gone'); e.status=404; return Promise.reject(e);
  };
  c.gcalImport({silent:true});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.tasks.length, 0);
});

test('an import begun before a local patch cannot overwrite that edit after the queue drains', async () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [activeTask(c, { id:'linked', name:'before', start:B+3600000, end:B+2*3600000,
    eventId:'ev1', calendarId:'cal1' })];
  Object.assign(c.state.gcal, { selected:{cal1:true}, calendars:[{id:'cal1',summary:'Work'}], window:30 });
  c._token = 'token';
  let releaseFetch;
  c.gcalFetch = () => new Promise(resolve => { releaseFetch = resolve; });

  c.gcalImport({silent:true});
  const before = c.state.tasks.map(t=>Object.assign({}, t));
  const edited = c.state.tasks.map(t=>Object.assign({}, t, {name:'local edit',start:B+4*3600000,end:B+5*3600000}));
  c.state.tasks = edited;
  c.gcalSyncOut(before, edited);
  assert.equal(c.loadQueue().length, 1, 'the local edit became a PATCH');
  c.saveQueue([]); // the PATCH completes while the older pull is still in flight
  releaseFetch({items:[event('ev1', 'stale remote', B+3600000, B+2*3600000)]});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(c.state.tasks[0].name, 'local edit');
  assert.equal(c.state.tasks[0].start, B+4*3600000);
  assert.equal(c.state.tasks[0].end, B+5*3600000);
});

test('sign-in waits for the initial Supabase task pull before restoring Calendar', async () => {
  const c = make();
  c._workspace = 'uid1';
  let releasePull;
  c._sb = { from:()=>({ select:()=>new Promise(resolve=>{ releasePull=resolve; }) }) };
  c.syncSubscribeRealtime = () => {};
  c.syncFlushSoon = () => {};
  c.syncKvFlushSoon = () => {};
  c.syncInitialSyncKv = () => {};
  let restores = 0;
  c.gcalRestore = () => { restores++; };

  c.syncOnAuth('SIGNED_IN', {user:{id:'uid1',email:'owner@example.test'}});
  assert.equal(restores, 0, 'Calendar cannot import against the pre-pull in-memory task list');
  releasePull({data:[], error:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(restores, 1, 'Calendar restoration resumes after task reconciliation completes');
});

test('a failed initial task pull is retryable and Calendar stays gated until retry succeeds', async () => {
  const c = make();
  let retry;
  loadComponent.lastSandbox.setTimeout = (fn, ms) => { if(ms===c.SYNC_INITIAL_RETRY_MS) retry=fn; return 1; };
  c._session = {user:{id:'uid1'}};
  let selects = 0, releaseRetry;
  c._sb = { from:()=>({ select:()=>{
    selects++;
    if(selects===1) return Promise.resolve({data:null,error:new Error('transient pull failure')});
    return new Promise(resolve=>{ releaseRetry=resolve; });
  } }) };
  c.syncInitialSyncKv = () => {};
  assert.equal(await c.syncInitialSync(), false);

  c._token = 'token'; c._tokenExp=Date.now()+3600000;
  Object.assign(c.state.gcal, { selected:{cal1:true}, calendars:[{id:'cal1',summary:'Work'}], window:30 });
  let calendarFetches = 0;
  c.gcalFetch = () => { calendarFetches++; return Promise.resolve({items:[]}); };
  assert.equal(typeof retry, 'function', 'a transient failure schedules another reconciliation');
  retry();
  assert.equal(selects, 2, 'the next Calendar attempt starts a fresh task reconciliation');
  assert.equal(calendarFetches, 0, 'Calendar remains blocked while the retry is unresolved');

  releaseRetry({data:[],error:null});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calendarFetches>0, 'Calendar starts only after the retry reconciles tasks successfully');
});
