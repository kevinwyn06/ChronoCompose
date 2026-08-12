// V5 block 17 / F5 — anon workspace stranding.
//
// `importAnonInto` and `anonHasData` existed but were never called, so everything a user entered
// while signed out stayed in the bare (anon) namespace and, from their side, looked deleted the
// moment they signed in. These tests pin the promotion path: it is OFFERED (never silent), it is
// non-destructive to BOTH namespaces, and it is idempotent across repeated sign-ins.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// --- helpers ---------------------------------------------------------------
function seedAnon(c, over) {
  c._workspace = 'anon';
  const d = Object.assign({
    tasks: [{ id: 't_anon1', name: 'Anon task', planned: 60 }],
    sections: [{ id: 'sec_a', name: 'Personal' }],
    habits: [{ id: 'h_a', name: 'Stretch' }],
    journal: { '2026-06-15': { text: 'anon day', updatedAt: 1 } },
    scratch: { html: '<p>anon pad</p>', updatedAt: 1 },
    prompts: { items: [{ id: 'p_a', kind: 'text', text: 'Anon prompt' }], updatedAt: 1 },
  }, over || {});
  c.lsSet('pp-tasks', JSON.stringify(d.tasks));
  c.lsSet('pp-sections', JSON.stringify(d.sections));
  c.lsSet('pp-habits', JSON.stringify(d.habits));
  c.lsSet('pp-journal', JSON.stringify(d.journal));
  c.lsSet('pp-scratch', JSON.stringify(d.scratch));
  c.lsSet('pp-journal-prompts', JSON.stringify(d.prompts));
  return d;
}
function readAcct(c, uid, base) {
  const prev = c._workspace; c._workspace = uid;
  const v = c.lsGet(base); c._workspace = prev;
  try { return v == null ? null : JSON.parse(v); } catch (e) { return v; }
}
// Stand in for the sign-in callback without any network: syncBeginWorkspaceSwitch is what
// syncOnAuth calls when the session's account differs from the active workspace.
function signInAs(c, uid, answer) {
  c.anonPromoteAsk = () => answer;
  c._told = [];
  c.anonPromoteTell = m => c._told.push(m);
  c._wsSwitching = false;
  c.syncBeginWorkspaceSwitch({ user: { id: uid, email: uid + '@example.test' } });
}

// --- the defect ------------------------------------------------------------
test('RED baseline: a bare workspace switch strands anon data outside the account namespace', () => {
  const c = make();
  seedAnon(c);
  c._workspace = 'uidA';
  // Nothing the signed-in app reads can see it — this is the user-visible "my data was deleted".
  assert.equal(c.lsGet('pp-tasks'), null);
  assert.equal(c.lsGet('pp-scratch'), null);
  // ...while the anon copy is still sitting there untouched.
  c._workspace = 'anon';
  assert.equal(JSON.parse(c.lsGet('pp-tasks'))[0].name, 'Anon task');
});

test('sign-in OFFERS promotion and, on accept, the account namespace reaches the anon data', () => {
  const c = make();
  seedAnon(c);
  let asked = 0;
  c.anonPromoteAsk = () => { asked++; return true; };
  c.anonPromoteTell = () => {};
  c.syncBeginWorkspaceSwitch({ user: { id: 'uidA', email: 'a@example.test' } });
  assert.equal(asked, 1, 'the user must be asked, never silently merged');
  const tasks = readAcct(c, 'uidA', 'pp-tasks');
  assert.ok(Array.isArray(tasks) && tasks.length === 1, 'anon task must reach the account namespace');
  assert.equal(tasks[0].name, 'Anon task');
  assert.equal(readAcct(c, 'uidA', 'pp-scratch').html, '<p>anon pad</p>');
  assert.equal(readAcct(c, 'uidA', 'pp-habits')[0].name, 'Stretch');
  assert.equal(readAcct(c, 'uidA', 'pp-journal')['2026-06-15'].text, 'anon day');
  assert.equal(readAcct(c, 'uidA', 'pp-sections')[0].name, 'Personal');
  assert.equal(readAcct(c, 'uidA', 'pp-journal-prompts').items[0].text, 'Anon prompt');
});

// --- non-destructive on both sides ----------------------------------------
test('promotion never deletes the anon namespace — a wrong answer stays recoverable', () => {
  const c = make();
  seedAnon(c);
  signInAs(c, 'uidA', true);
  c._workspace = 'anon';
  assert.equal(JSON.parse(c.lsGet('pp-tasks'))[0].id, 't_anon1');
  assert.equal(JSON.parse(c.lsGet('pp-scratch')).html, '<p>anon pad</p>');
});

test('promotion into a NON-empty account destroys nothing that account already had', () => {
  const c = make();
  seedAnon(c);
  c._workspace = 'uidA';
  c.lsSet('pp-tasks', JSON.stringify([{ id: 't_acct', name: 'Account task', planned: 30 }]));
  c.lsSet('pp-scratch', JSON.stringify({ html: '<p>account pad</p>', updatedAt: 5 }));
  c.lsSet('pp-journal', JSON.stringify({ '2026-06-15': { text: 'account day', updatedAt: 5 } }));
  signInAs(c, 'uidA', true);
  const tasks = readAcct(c, 'uidA', 'pp-tasks');
  assert.equal(tasks.length, 2, 'both rows survive');
  assert.ok(tasks.some(t => t.name === 'Account task'));
  assert.ok(tasks.some(t => t.name === 'Anon task'));
  const pad = readAcct(c, 'uidA', 'pp-scratch').html;
  assert.ok(pad.indexOf('account pad') >= 0 && pad.indexOf('anon pad') >= 0,
    'the pad is concatenated, never replaced');
  const day = readAcct(c, 'uidA', 'pp-journal')['2026-06-15'].text;
  assert.ok(day.indexOf('account day') >= 0 && day.indexOf('anon day') >= 0,
    'a same-day journal entry keeps both texts');
});

test('promoted task ids are regenerated so they cannot collide with the account cloud rows', () => {
  const c = make();
  seedAnon(c, { tasks: [
    { id: 't_p', name: 'Parent' },
    { id: 't_k', name: 'Kid', parentId: 't_p', deps: ['t_p'], sectionId: 'sec_a' },
  ] });
  signInAs(c, 'uidA', true);
  const tasks = readAcct(c, 'uidA', 'pp-tasks');
  const parent = tasks.find(t => t.name === 'Parent'), kid = tasks.find(t => t.name === 'Kid');
  assert.notEqual(parent.id, 't_p');
  assert.notEqual(kid.id, 't_k');
  assert.equal(kid.parentId, parent.id, 'parent link is remapped, not broken');
  assert.deepEqual(kid.deps, [parent.id], 'deps are remapped');
  const secs = readAcct(c, 'uidA', 'pp-sections');
  assert.equal(kid.sectionId, secs.find(s => s.name === 'Personal').id, 'sectionId is remapped');
});

// --- decline ---------------------------------------------------------------
test('declining leaves BOTH namespaces intact and says the data is still reachable', () => {
  const c = make();
  seedAnon(c);
  signInAs(c, 'uidA', false);
  assert.equal(readAcct(c, 'uidA', 'pp-tasks'), null, 'nothing crosses over');
  c._workspace = 'anon';
  assert.equal(JSON.parse(c.lsGet('pp-tasks'))[0].name, 'Anon task', 'anon untouched');
  const said = (c._told || []).join(' ');
  assert.ok(/sign(ing)? out/i.test(said),
    'the message must say the data is reachable again by signing out');
  assert.ok(/not\b[^.]*\bdeleted/i.test(said),
    'the message must say plainly that nothing was deleted');
});

// --- idempotence -----------------------------------------------------------
test('a second sign-in does not re-ask and does not duplicate the promoted rows', () => {
  const c = make();
  seedAnon(c);
  let asked = 0;
  const ask = () => { asked++; return true; };
  c.anonPromoteAsk = ask; c.anonPromoteTell = () => {};
  c._wsSwitching = false;
  c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  c._wsSwitching = false;
  c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  assert.equal(asked, 1, 'the decision is remembered');
  assert.equal(readAcct(c, 'uidA', 'pp-tasks').length, 1, 'no duplicate rows');
});

test('a declined decision is remembered too — the user is not nagged on every sign-in', () => {
  const c = make();
  seedAnon(c);
  let asked = 0;
  c.anonPromoteAsk = () => { asked++; return false; };
  c.anonPromoteTell = () => {};
  c._wsSwitching = false; c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  c._wsSwitching = false; c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  assert.equal(asked, 1);
});

test('the decision ledger is per-account: a second account is still offered the import', () => {
  const c = make();
  seedAnon(c);
  let asked = 0;
  c.anonPromoteAsk = () => { asked++; return false; };
  c.anonPromoteTell = () => {};
  c._wsSwitching = false; c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  c._wsSwitching = false; c.syncBeginWorkspaceSwitch({ user: { id: 'uidB' } });
  assert.equal(asked, 2);
});

// --- the offer gate --------------------------------------------------------
test('an empty anon workspace is never offered — no dialog on a first-ever sign-in', () => {
  const c = make();
  c._workspace = 'anon';
  c.lsSet('pp-tasks', '[]');
  let asked = 0;
  c.anonPromoteAsk = () => { asked++; return true; };
  c._wsSwitching = false;
  c.syncBeginWorkspaceSwitch({ user: { id: 'uidA' } });
  assert.equal(asked, 0);
});

test('anonHasData covers the non-syncing local-only stores, not just tasks', () => {
  const c = make();
  c._workspace = 'anon';
  c.lsSet('pp-tasks', '[]');
  assert.equal(c.anonHasData(), false);
  c.lsSet('pp-scratch', JSON.stringify({ html: '<p>notes</p>', updatedAt: 1 }));
  assert.equal(c.anonHasData(), true, 'a scratchpad alone is data worth rescuing');
  c.lsSet('pp-scratch', JSON.stringify({ html: '', updatedAt: 1 }));
  assert.equal(c.anonHasData(), false);
  c.lsSet('pp-sections', JSON.stringify([{ id: 's1', name: 'Work' }]));
  assert.equal(c.anonHasData(), true);
});

test('pp-anon-promote is a GLOBAL key — the ledger must not live inside a namespace it gates', () => {
  const c = make();
  c._workspace = 'uidA';
  assert.equal(c.wsKey('pp-anon-promote'), 'pp-anon-promote');
});
