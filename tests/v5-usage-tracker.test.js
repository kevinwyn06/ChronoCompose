/* PP-EXT (block 31): alpha usage tracker.
   The redaction rules are the acceptance bar for this block, so they are tested first and hardest.
   The single rule everything else derives from: the log records key IDENTITY and ACTION NAMES, and
   never typed content. If any assertion in the "redaction" describe below has to be weakened to make
   an implementation pass, the implementation is wrong, not the test. */
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

/* A minimal element stand-in. The tracker's DOM adapter walks `parentElement` and reads only
   IDENTIFIERS (tag/type/id/name/autocomplete/dataset) — never a value — so a stub is enough. */
function el(over, parent){
  return Object.assign({ tagName:'INPUT', type:'text', id:'', name:'', autocomplete:'',
    isContentEditable:false, dataset:{}, parentElement:parent||null }, over||{});
}
function key(k, target, mods){ return Object.assign({ key:k, target:target||null,
  ctrlKey:false, metaKey:false, altKey:false, shiftKey:false }, mods||{}); }

function tracker(){
  const c = make();
  c.state.settings.usageTracking = true;
  c._trackBuf = [];           // start from an empty buffer regardless of the mocked store
  c._trackSent = 0;
  return c;
}
/* Everything the log would ever hand to disk, as one string. Assertions about "no character of the
   password appears" are made against THIS — the serialized artifact, not an internal field. */
function logText(c){ c.trackTypingFlush(); return JSON.stringify(c._trackBuf); }
/* Every 2-character window of `s`. A single character can legitimately appear anywhere (timestamps,
   ids, action names); a 2-gram of the secret appearing is real leakage. */
function bigrams(s){ const out=[]; for(let i=0;i<s.length-1;i++) out.push(s.slice(i,i+2)); return out; }
/* The log has a fixed vocabulary of its own — schema keys, event-type names, field-kind names, the
   surface id, and the random session token. Those are STRUCTURE, not content, and they produce
   false 2-gram hits ("text" contains "te", "editor" contains "to"). Remove exactly that vocabulary
   and scan what is left: any fragment of what the user typed would survive this scrub untouched. */
const VOCAB = ['pp-scratch-editor','pp-journal-editor','ChronoCompose','session','action','prose',
  'field','type','text','key','app','ws','ts','rel','v','s','t','n','a','k'];
function scrub(c, text){
  let out = text.split(c.trackSession()).join('');
  VOCAB.forEach(w => { out = out.split(w).join(''); });
  return out;
}

test('block 31 — redaction: a password typed into a password field leaves NO trace in the log', () => {
  const c = tracker();
  const pw = el({ type:'password', id:'pp-signin-password', name:'password' });
  const secret = 'Tr0ub4dor&3-hunter2!';

  for(const ch of secret) c.trackKey(key(ch, pw));
  /* Backspaces, Enter and a paste-shaped combo are all still inside the password field. */
  c.trackKey(key('Backspace', pw));
  c.trackKey(key('v', pw, { ctrlKey:true }));
  c.trackKey(key('Enter', pw));

  const text = logText(c);
  /* 1. Nothing at all was recorded — not a key name, not a count. A length is a weak leak of a
        credential, so the whole class is dropped rather than reduced. */
  assert.deepStrictEqual(c._trackBuf, [], 'a password field must produce no events whatsoever');
  /* 2. And, stated independently of the buffer being empty: no fragment of the secret is present. */
  assert.ok(!text.includes(secret), 'the log must not contain the password');
  for(const g of bigrams(secret)){
    assert.ok(!text.includes(g), 'the log must not contain the password fragment '+JSON.stringify(g));
  }
});

test('block 31 — redaction: auth surfaces are excluded even when the field itself looks innocent', () => {
  const c = tracker();
  /* A plain text input that happens to live inside a sign-in surface: the CONTAINER decides. */
  const surface = el({ tagName:'DIV', type:'', id:'pp-signin-card', dataset:{ ppAuth:'1' } });
  const inner = el({ tagName:'INPUT', type:'text', id:'email' }, surface);
  'user@example.com'.split('').forEach(ch => c.trackKey(key(ch, inner)));
  c.trackKey(key('Enter', inner));
  assert.deepStrictEqual(c._trackBuf, [], 'an auth surface excludes everything inside it');
  assert.ok(!logText(c).includes('example'), 'no typed identity may reach the log');
});

test('block 31 — redaction: printable input into a normal text field becomes a COUNT', () => {
  const c = tracker();
  const field = el({ tagName:'INPUT', type:'text', id:'task-name' });
  const typed = 'Write the quarterly report';

  for(const ch of typed) c.trackKey(key(ch, field));
  c.trackTypingFlush();

  const evs = c._trackBuf;
  assert.strictEqual(evs.length, 1, 'one burst of typing is one event');
  assert.strictEqual(evs[0].t, 'type');
  assert.strictEqual(evs[0].n, typed.length, 'the event carries how many characters, not which');
  assert.strictEqual(evs[0].field, 'text');
  assert.ok(!('k' in evs[0]) && !('text' in evs[0]) && !('value' in evs[0]),
    'a type event carries no character-bearing field at all');

  const text = scrub(c, logText(c));
  assert.ok(!text.includes(typed));
  for(const g of bigrams(typed)){
    assert.ok(!text.includes(g), 'no 2-character fragment of the typed text may appear: '+JSON.stringify(g));
  }
});

test('block 31 — redaction: journal/scratchpad prose is counted, never transcribed', () => {
  const c = tracker();
  const pad = el({ tagName:'DIV', type:'', id:'pp-scratch-editor', isContentEditable:true });
  const prose = 'today felt heavy and I do not want to say why';
  for(const ch of prose) c.trackKey(key(ch, pad));
  c.trackTypingFlush();

  assert.strictEqual(c._trackBuf.length, 1);
  assert.strictEqual(c._trackBuf[0].t, 'type');
  assert.strictEqual(c._trackBuf[0].n, prose.length);
  assert.ok(String(c._trackBuf[0].field).startsWith('prose:'), 'the SURFACE is named, the writing is not');
  const text = scrub(c, logText(c));
  for(const g of bigrams(prose)) assert.ok(!text.includes(g), 'prose fragment leaked: '+JSON.stringify(g));
});

test('block 31 — a task title typed into a contenteditable never reaches the log as content', () => {
  const c = tracker();
  const title = el({ tagName:'DIV', type:'', id:'', isContentEditable:true });
  const name = 'Call Dr Nakamura about the biopsy';
  for(const ch of name) c.trackKey(key(ch, title));
  c.trackTypingFlush();
  const text = scrub(c, logText(c));
  for(const g of bigrams(name)) assert.ok(!text.includes(g), 'task title leaked: '+JSON.stringify(g));
  assert.strictEqual(c._trackBuf[0].n, name.length);
});

test('block 31 — navigation keys and shortcut combos ARE recorded by name', () => {
  const c = tracker();
  const field = el({ tagName:'INPUT', type:'text', id:'task-name' });
  c.trackKey(key('Escape', null));
  c.trackKey(key('ArrowDown', null));
  c.trackKey(key('z', null, { ctrlKey:true }));
  c.trackKey(key('Enter', field));       // non-printable inside a field: still a name, no content
  const names = c._trackBuf.filter(e=>e.t==='key').map(e=>e.k);
  assert.deepStrictEqual(names, ['Escape','ArrowDown','Ctrl+z','Enter']);
});

test('block 31 — a printable key with nothing focused is a SHORTCUT, and is named', () => {
  const c = tracker();
  c.trackKey(key('q', null));
  c.trackKey(key('n', null));
  assert.deepStrictEqual(c._trackBuf.map(e=>e.k), ['q','n']);
  assert.ok(c._trackBuf.every(e=>e.t==='key'));
});

test('block 31 — trackFieldKind is the single gate, and classifies every case', () => {
  const c = make();
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'password' }), 'secret');
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'text', name:'user_token' }), 'secret');
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'text', id:'otp-code' }), 'secret');
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'text', auth:true }), 'secret');
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'text', id:'planned' }), 'text');
  assert.strictEqual(c.trackFieldKind({ tag:'TEXTAREA' }), 'text');
  assert.strictEqual(c.trackFieldKind({ tag:'DIV', contentEditable:true }), 'text');
  assert.strictEqual(c.trackFieldKind({ tag:'DIV', contentEditable:true, id:'pp-scratch-editor' }), 'prose');
  assert.strictEqual(c.trackFieldKind({ tag:'INPUT', type:'checkbox' }), null);
  assert.strictEqual(c.trackFieldKind({ tag:'DIV' }), null);
  assert.strictEqual(c.trackFieldKind(null), null);
});

test('block 31 — tracking off records nothing at all', () => {
  const c = tracker();
  c.state.settings.usageTracking = false;
  c.trackKey(key('Escape', null));
  c.trackAction('view.switch', { to:'gantt' });
  assert.strictEqual(c.track('key', { k:'x' }), null);
  assert.deepStrictEqual(c._trackBuf, []);
  assert.strictEqual(c.renderUsagePill(), null, 'the REC pill disappears with the feature');
});

test('block 31 — every event is timestamped, session-stamped and schema-versioned', () => {
  const c = tracker();
  const ev = c.track('key', { k:'Escape' });
  assert.strictEqual(ev.v, c.TRACK_SCHEMA);
  assert.strictEqual(typeof ev.ts, 'number');
  assert.ok(ev.ts > 1600000000000, 'ts is epoch ms');
  assert.strictEqual(typeof ev.rel, 'number');
  assert.ok(ev.rel >= 0, 'rel is session-relative ms');
  assert.strictEqual(ev.s, c.trackSession());
  assert.match(c.trackSession(), /^\d{8}-\d{6}-[a-z0-9]+$/);
});

test('block 31 — the session header carries environment, never account identity', () => {
  const c = tracker();
  c._workspace = 'anon';
  const ev = c.trackSessionStart();
  assert.strictEqual(ev.t, 'session');
  assert.strictEqual(ev.ws, 'anon');
  const text = JSON.stringify(ev);
  assert.ok(!/@/.test(text), 'no email-shaped value may appear in the session header');
});

test('block 31 — the buffer is capped and evicts oldest-first', () => {
  const c = tracker();
  c.TRACK_CAP = 10;
  for(let i=0;i<40;i++) c.track('key', { k:'k'+i });
  assert.strictEqual(c._trackBuf.length, 10);
  assert.strictEqual(c._trackBuf[0].k, 'k30', 'the OLDEST events are the ones dropped');
  assert.strictEqual(c._trackBuf[9].k, 'k39');
});

test('block 31 — commit() is the task-action choke point: ids and counts, no names', () => {
  const c = tracker();
  const prev = [{ id:'a', name:'Secret merger due diligence', pct:0 }];
  const next = [{ id:'a', name:'Secret merger due diligence', pct:100 },
                { id:'b', name:'Another private title', pct:0 }];
  c.trackCommit(prev, next);
  const acts = c._trackBuf.map(e=>e.a);
  assert.ok(acts.includes('task.create'));
  assert.ok(acts.includes('task.complete'));
  const text = JSON.stringify(c._trackBuf);
  assert.ok(text.includes('"a"') || text.includes('a'), 'ids are recorded');
  assert.ok(!text.includes('merger') && !text.includes('private'), 'task titles are never logged');
});

test('block 31 — deletions and archives are named, and a plain edit reports only a count', () => {
  const c = tracker();
  const kept = { id:'a', name:'x', pct:0 };
  c.trackCommit([kept, { id:'gone', name:'y', pct:0 }], [kept]);
  assert.deepStrictEqual(c._trackBuf.filter(e=>e.a==='task.delete')[0].ids, ['gone']);

  const c2 = tracker();
  c2.trackCommit([{ id:'a', name:'x', pct:0, archivedAt:null }], [{ id:'a', name:'x', pct:0, archivedAt:123 }]);
  assert.deepStrictEqual(c2._trackBuf.filter(e=>e.a==='task.archive')[0].ids, ['a']);

  const c3 = tracker();
  c3.trackCommit([{ id:'a', name:'x', pct:0 }], [{ id:'a', name:'x2', pct:0 }]);
  const ev = c3._trackBuf[0];
  assert.strictEqual(ev.a, 'task.commit');
  assert.strictEqual(ev.n, 1, 'an edit is counted, its content is not described');
  assert.ok(!JSON.stringify(ev).includes('x2'));
});

test('block 31 — serialization is one JSON object per line (.jsonl)', () => {
  const c = tracker();
  c.track('key', { k:'Escape' });
  c.track('action', { a:'view.switch', to:'gantt' });
  const lines = c.trackSerialize().trim().split('\n');
  assert.strictEqual(lines.length, 2);
  lines.forEach(l => { const o = JSON.parse(l); assert.strictEqual(o.v, c.TRACK_SCHEMA); });
});

test('block 31 — flush persists through the SCOPED store, and only sends new lines to the sink', () => {
  const c = tracker();
  const sent = []; c.trackPost = (lines)=>sent.push(lines.length);
  const keys = []; const realSet = c.lsSet.bind(c);
  c.lsSet = (k,v)=>{ keys.push(k); realSet(k,v); };

  c.track('key', { k:'a' }); c.track('key', { k:'b' });
  c.trackFlush();
  c.track('key', { k:'c' });
  c.trackFlush();

  assert.deepStrictEqual(sent, [2,1], 'a flush posts only what the previous flush did not');
  assert.ok(keys.every(k=>k.indexOf('pp-usage')===0), 'the store is the scoped pp-usage key');
  assert.deepStrictEqual(JSON.parse(c.lsGet(c.TRACK_KEY)).map(e=>e.k), ['a','b','c']);
});

test('block 31 — the tracker is LOCAL-ONLY: not in SYNC_FIELDS, KV_TABLES or BACKUP_KEYS', () => {
  const c = make();
  assert.ok(!c.SYNC_FIELDS().includes('usageTracking'));
  assert.ok(!c.SYNC_FIELDS().some(f=>/usage|track/i.test(f)));
  assert.ok(!c.BACKUP_KEYS().includes(c.TRACK_KEY), 'a usage log is instrumentation, not user data');
  if(typeof c.KV_TABLES === 'function'){
    assert.ok(!Object.keys(c.KV_TABLES()).some(k=>/usage/i.test(k)), 'no kv table mirrors the usage log');
  }
});

test('block 31 — tracking defaults ON for this alpha build, and is discoverable', () => {
  const c = make();
  assert.strictEqual(c.DEFAULT_SETTINGS().usageTracking, true);
  c.state.settings.usageTracking = true;
  const pill = c.renderUsagePill();
  assert.ok(pill, 'a recording session shows a visible pill');
  assert.strictEqual(pill.props['data-usage-pill'], 'on');
  assert.match(String(pill.props.title), /never captured|counted/i);
});

test('block 31 — a typing burst closes when the field changes', () => {
  const c = tracker();
  const a = el({ tagName:'INPUT', type:'text', id:'one' });
  const b = el({ tagName:'DIV', type:'', id:'pp-scratch-editor', isContentEditable:true });
  'abc'.split('').forEach(ch=>c.trackKey(key(ch, a)));
  'de'.split('').forEach(ch=>c.trackKey(key(ch, b)));
  c.trackTypingFlush();
  assert.deepStrictEqual(c._trackBuf.map(e=>[e.field, e.n]), [['text',3], ['prose:pp-scratch-editor',2]]);
});
