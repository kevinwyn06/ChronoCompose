/* PP-EXT (block 33): the Supabase upload sink for the alpha usage tracker.
   Block 31's redaction gate is the security boundary and is tested in v5-usage-tracker.test.js. This
   file tests the sink that was added ON TOP of it, and — most importantly — that adding a network path
   did not create a route by which raw typed content can reach the network. */
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load');

/* A signed-in, Supabase-configured tracker with a recording fetch. Returns the component plus the log
   of requests the upload path made. */
function upl(over){
  const c = make();
  const sb = loadComponent.lastSandbox;
  c.state.settings.usageTracking = true;
  c._trackBuf = []; c._trackSent = 0; c._trackUpQ = [];
  c.trackPost = ()=>{};                       // silence the local disk sink
  sb.window.PP_CONFIG = { supabaseUrl:'https://proj.supabase.co/', supabaseAnonKey:'anon-key-123' };
  c._session = { access_token:'jwt-abc', user:{ id:'uid-1', email:'a@b.c' } };
  const calls = [];
  const ctl = Object.assign({ ok:true, calls }, over||{});
  sb.fetch = (url, opts)=>{
    calls.push({ url, opts, rows:JSON.parse(opts.body) });
    return ctl.ok ? Promise.resolve({ ok:true }) : Promise.resolve({ ok:false, status:401 });
  };
  return { c, ctl, calls, sb };
}
const settle = ()=> new Promise(r=>setImmediate(r));

test('block 33 — a flush uploads the buffered events as ONE batch, not one request per event', async () => {
  const { c, calls } = upl();
  for(let i=0;i<5;i++) c.track('key', { k:'k'+i });
  c.trackFlush();
  await settle();

  assert.strictEqual(calls.length, 1, 'events are batched on the flush point');
  assert.match(calls[0].url, /\/rest\/v1\/usage_events$/);
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(calls[0].opts.keepalive, true, 'a teardown flush must be able to outlive the document');
  assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer jwt-abc');
  assert.strictEqual(calls[0].opts.headers.apikey, 'anon-key-123');
  assert.strictEqual(calls[0].rows.length, 5);
  assert.deepStrictEqual(Object.keys(calls[0].rows[0]).sort(), ['payload','session','ts']);
  assert.strictEqual(calls[0].rows[0].session, c.trackSession());
  assert.ok(!('owner_id' in calls[0].rows[0]), 'owner_id is left to auth.uid(), never sent by the client');
});

test('block 33 — the batch is capped, and the remainder goes in a following request', async () => {
  const { c, calls } = upl();
  c.TRACK_UP_BATCH = 3;
  for(let i=0;i<7;i++) c.track('key', { k:'k'+i });
  c.trackFlush();
  await settle(); await settle(); await settle(); await settle();
  assert.deepStrictEqual(calls.map(x=>x.rows.length), [3,3,1]);
  assert.strictEqual((c._trackUpQ||[]).length, 0, 'the whole queue drains');
});

test('block 33 — a SIGNED-OUT session skips the upload silently and keeps buffering locally', async () => {
  const { c, calls } = upl();
  c._session = null;                       // anonymous / local workspace
  c.track('key', { k:'a' });
  c.trackFlush();
  await settle();
  assert.strictEqual(calls.length, 0, 'anon has no grant on usage_events — do not even try');
  assert.strictEqual(c._trackUpQ.length, 1, 'the event is kept, not dropped');
  assert.strictEqual(c._trackBuf.length, 1, 'the local ring buffer is unaffected');
  assert.strictEqual(c.trackUploadReady(), null);

  /* Signing in later drains what was buffered while signed out. */
  c._session = { access_token:'jwt-abc', user:{ id:'uid-1' } };
  c.trackFlush();
  await settle();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].rows.length, 1);
});

test('block 33 — an unconfigured Supabase skips the upload, and a failed upload never throws', async () => {
  const { c, sb, calls } = upl();
  sb.window.PP_CONFIG = { googleClientId:'' };
  c.track('key', { k:'a' });
  assert.doesNotThrow(()=>c.trackFlush());
  await settle();
  assert.strictEqual(calls.length, 0);
});

test('block 33 — a FAILED upload loses nothing: the events stay queued and the next flush retries', async () => {
  const { c, ctl, calls } = upl();
  ctl.ok = false;
  c.track('key', { k:'a' }); c.track('key', { k:'b' });
  c.trackFlush();
  await settle();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(c._trackUpQ.length, 2, 'a rejected batch is not dropped');
  assert.strictEqual(c._trackBuf.length, 2, 'and the local buffer still has them too');

  ctl.ok = true;
  c.track('key', { k:'c' });
  c.trackFlush();
  await settle();
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].rows.map(r=>r.payload.k), ['a','b','c'], 'the retry carries the earlier events');
  assert.strictEqual(c._trackUpQ.length, 0);
});

test('block 33 — events appended DURING an in-flight upload survive its completion', async () => {
  const { c, calls } = upl();
  c.track('key', { k:'a' });
  c.trackFlush();              // batch = [a], request in flight
  c.track('key', { k:'b' });   // arrives before the response is handled
  await settle(); await settle();
  assert.strictEqual(c._trackUpQ.length, 0, 'b was uploaded by the follow-on request, not stranded');
  const sent = calls.reduce((a,x)=>a.concat(x.rows.map(r=>r.payload.k)), []);
  assert.deepStrictEqual(sent, ['a','b']);
});

test('block 33 — the upload queue is capped oldest-first, exactly like the local buffer', () => {
  const { c } = upl();
  c._session = null;                 // never drains, so the cap is what bounds it
  c.TRACK_CAP = 10;
  for(let i=0;i<40;i++) c.track('key', { k:'k'+i });
  assert.strictEqual(c._trackUpQ.length, 10);
  assert.strictEqual(c._trackUpQ[0].k, 'k30', 'the OLDEST queued events are the ones dropped');
});

test('block 33 — tracking OFF means no buffering and no upload', async () => {
  const { c, calls } = upl();
  c.state.settings.usageTracking = false;
  c.trackKey({ key:'Escape', target:null });
  c.trackAction('view.switch', { to:'gantt' });
  c.trackFlush();
  await settle();
  assert.deepStrictEqual(c._trackBuf, []);
  assert.deepStrictEqual(c._trackUpQ, []);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(c.trackUploadReady(), null);
});

/* ---- THE SECURITY ASSERTION -----------------------------------------------------------------
   The upload path must be a pure transport. What it hands to the network has to be byte-identical to
   what the redaction gate emitted; if the two ever diverge, the upload path has become a second, un-
   audited place where content could be assembled. */
test('block 33 — what the uploader sends is BYTE-IDENTICAL to what the redaction gate emitted', async () => {
  const { c, calls } = upl();
  const gate = [];
  const realTrack = c.track.bind(c);
  c.track = (t, d)=>{ const ev = realTrack(t, d); if(ev) gate.push(JSON.stringify(ev)); return ev; };

  /* Drive real, content-bearing input through the gate: a password, prose, a task title, shortcuts. */
  const el = (o,p)=>Object.assign({ tagName:'INPUT', type:'text', id:'', name:'', autocomplete:'',
    isContentEditable:false, dataset:{}, parentElement:p||null }, o||{});
  const k = (key, target, mods)=>Object.assign({ key, target, ctrlKey:false, metaKey:false,
    altKey:false, shiftKey:false }, mods||{});
  const pw = el({ type:'password', id:'pp-signin-password' });
  const pad = el({ tagName:'DIV', type:'', id:'pp-scratch-editor', isContentEditable:true });
  const title = el({ tagName:'INPUT', type:'text', id:'task-name' });
  const SECRETS = ['hunter2-Tr0ub4dor', 'today felt heavy and I cannot say why', 'Call Dr Nakamura'];
  for(const ch of SECRETS[0]) c.trackKey(k(ch, pw));
  for(const ch of SECRETS[1]) c.trackKey(k(ch, pad));
  c.trackTypingFlush();
  for(const ch of SECRETS[2]) c.trackKey(k(ch, title));
  c.trackKey(k('Escape', null));
  c.trackCommit([{ id:'a', name:'Secret merger due diligence', pct:0 }],
                [{ id:'a', name:'Secret merger due diligence', pct:100 }]);

  c.trackFlush(true);
  await settle();

  const uploaded = calls.reduce((a,x)=>a.concat(x.rows.map(r=>JSON.stringify(r.payload))), []);
  assert.ok(uploaded.length > 0, 'something was actually uploaded');
  assert.deepStrictEqual(uploaded, gate,
    'the upload payloads must be exactly the events the gate produced, in order, unmodified');

  /* And stated independently of that equality: no fragment of any secret is on the wire at all. */
  const wire = JSON.stringify(calls.map(x=>x.rows));
  for(const s of SECRETS){
    for(let i=0;i<s.length-3;i++){
      assert.ok(!wire.includes(s.slice(i,i+4)),
        'a fragment of typed content reached the network: '+JSON.stringify(s.slice(i,i+4)));
    }
  }
});

test('block 33 — usage_events is NOT part of the sync path (no SYNC_FIELDS, KV_TABLES or BACKUP_KEYS)', () => {
  const c = make();
  assert.ok(!c.SYNC_FIELDS().some(f=>/usage|track/i.test(f)));
  assert.ok(!c.BACKUP_KEYS().includes(c.TRACK_KEY));
  assert.strictEqual(c.TRACK_UP_TABLE, 'usage_events');
  if(typeof c.KV_TABLES === 'function'){
    assert.ok(!Object.keys(c.KV_TABLES()).some(k=>/usage/i.test(k)));
  }
});
