// V3.1 — the running scratchpad (`pp-scratch`).
// Storage/serialisation only: everything here is provable without a browser and therefore belongs in
// `npm test`. The editor actually mounting in Focus and surviving a reload is the e2e layer's job
// (tests/e2e/scratchpad.spec.js) because the mock DOM has no contentEditable and no reload.
//
// `sanitizeHtml` is a no-op under Node (it guards on DOMParser), so these tests assert the storage
// contract around it, not the sanitizer — that is exercised in-app, exactly like richtext.test.js says.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent } = require('./_load.js');

/** The raw localStorage store behind the sandbox the component was built in. */
function rawStore() {
  // _load's sandbox exposes the same localStorage object the component writes through.
  return loadComponent.lastSandbox.localStorage;
}

test('V3.1 pp-scratch round-trips a document through lsSet/lsGet', () => {
  const c = make();
  assert.deepEqual(c.state.scratch, { html: '', updatedAt: 0 }, 'a fresh workspace starts empty');

  const saved = c.saveScratchHtml('<p>buy milk</p>');
  assert.equal(saved.html, '<p>buy milk</p>');
  assert.ok(saved.updatedAt > 0, 'a real write stamps updatedAt');
  assert.equal(c.state.scratch.html, '<p>buy milk</p>', 'state carries the new document');

  // A second component reading the same store must see the same document — that is the whole point
  // of persisting it, and it is what "survives a reload" reduces to below the DOM.
  const reloaded = c.loadScratch();
  assert.deepEqual(reloaded, saved, 'loadScratch reproduces exactly what saveScratchHtml wrote');
});

test('V3.1 the scratchpad is ONE continuous doc — appending never partitions by day', () => {
  const c = make();
  c.saveScratchHtml('<p>day one</p>');
  c.saveScratchHtml('<p>day one</p><p>day two</p>');
  const stored = JSON.parse(c.lsGet('pp-scratch'));
  assert.equal(stored.html, '<p>day one</p><p>day two</p>');
  // Nothing keyed by ymd: a per-day store would show up here as an object of days, like pp-journal.
  assert.deepEqual(Object.keys(stored).sort(), ['html', 'updatedAt']);
});

test('V3.1 saving an unchanged document is a no-op (no updatedAt churn)', () => {
  const c = make();
  const first = c.saveScratchHtml('<p>same</p>');
  const again = c.saveScratchHtml('<p>same</p>');
  assert.equal(again.updatedAt, first.updatedAt, 'identical content must not re-stamp the clock');
  assert.equal(again, c.state.scratch, 'and must not swap the state record for an equal copy');
});

test('V3.1 clearing the field stores the empty string, not empty markup', () => {
  const c = make();
  c.saveScratchHtml('<p>something</p>');
  c.saveScratchHtml('<br>');
  assert.equal(c.state.scratch.html, '', 'hasDesc-empty markup normalises to ""');
  assert.equal(JSON.parse(c.lsGet('pp-scratch')).html, '');
  assert.equal(c.scratchHtml(), '');
});

test('V3.1 normalizeScratch tolerates junk and the bare-string legacy shape', () => {
  const c = make();
  assert.deepEqual(c.normalizeScratch(null), { html: '', updatedAt: 0 });
  assert.deepEqual(c.normalizeScratch(undefined), { html: '', updatedAt: 0 });
  assert.deepEqual(c.normalizeScratch(42), { html: '', updatedAt: 0 });
  assert.deepEqual(c.normalizeScratch([]), { html: '', updatedAt: 0 });
  // A bare string is honoured as the document itself — losing notes to a shape mismatch is not a
  // recoverable failure, so this degrades toward keeping the text.
  assert.deepEqual(c.normalizeScratch('<p>legacy</p>'), { html: '<p>legacy</p>', updatedAt: 0 });
  // A non-string html field is dropped rather than rendered.
  assert.deepEqual(c.normalizeScratch({ html: { evil: 1 }, updatedAt: 7 }), { html: '', updatedAt: 7 });
});

test('V3.1 a corrupt pp-scratch value loads as an empty doc instead of throwing', () => {
  const c = make();
  rawStore().setItem('pp-scratch', '{not json');
  assert.deepEqual(c.loadScratch(), { html: '', updatedAt: 0 });
  rawStore().removeItem('pp-scratch');
});

test('V3.1 pp-scratch is workspace-scoped through wsKey, like every other pp-* store', () => {
  const c = make();
  c._workspace = 'uid-abc';
  assert.equal(c.wsKey('pp-scratch'), 'pp-scratch::uid-abc', 'not a WS_GLOBAL_KEY');
  c.saveScratchHtml('<p>account A</p>');
  assert.equal(rawStore().getItem('pp-scratch::uid-abc'), JSON.stringify(c.state.scratch));
  assert.equal(rawStore().getItem('pp-scratch'), null, 'the anon key is untouched by a signed-in write');

  // Switching workspace must show the other account's document, not this one's.
  c._workspace = 'uid-zzz';
  assert.deepEqual(c.loadScratch(), { html: '', updatedAt: 0 });
  c._workspace = 'uid-abc';
  assert.equal(c.loadScratch().html, '<p>account A</p>');
  c._workspace = null;
  rawStore().removeItem('pp-scratch::uid-abc');
});

test('V3.1 pp-scratch is in BACKUP_KEYS and survives collect/apply', () => {
  const c = make();
  assert.equal(c.BACKUP_KEYS().includes('pp-scratch'), true,
    'local-only store: backup is its ONLY portability, so omitting it would silently drop the doc');

  c.saveScratchHtml('<p>notes worth keeping</p>');
  const backup = c.collectBackup();
  assert.deepEqual(backup.data['pp-scratch'], { html: '<p>notes worth keeping</p>', updatedAt: c.state.scratch.updatedAt });

  // Wipe, then restore from the backup object — the round-trip the export/import buttons wrap.
  c.lsRemove('pp-scratch');
  assert.deepEqual(c.loadScratch(), { html: '', updatedAt: 0 });
  c.applyBackup(backup);
  assert.equal(c.loadScratch().html, '<p>notes worth keeping</p>');
});

test('V3.1 the scratchpad does NOT enter the sync funnel (local-only, like pp-sections)', () => {
  const c = make();
  // KV_TABLES names real Supabase tables; a `scratch` table does not exist, so the store must not
  // claim to sync. This assertion is the tripwire if someone later adds the table but forgets the
  // handoff note that says the pad is local-only.
  assert.equal(c.KV_TABLES().includes('scratch'), false);
  c.state.settings.syncEnabled = true;
  c.saveScratchHtml('<p>should not enqueue</p>');
  assert.deepEqual(c.loadKvQueue(), [], 'saving the scratchpad enqueues nothing');
});

test('V3.1 renderScratchpad reuses richField (one editor, one fieldKey on every surface)', () => {
  const c = make();
  c.saveScratchHtml('<p>shared doc</p>');
  const el = c.renderScratchpad();
  // richField returns wrap(toolbar, editor); the editor's key encodes the fieldKey it seeds from.
  const editor = el.children[1];
  assert.equal(editor.props.key, 'rfscratch', 'the same fieldKey everywhere — Focus and Journal cannot diverge');
  assert.equal(editor.props.id, 'pp-scratch-editor', 'stable id so the "n" hotkey can focus it');
  assert.equal(editor.props.contentEditable, true);

  // The commit handler is the store writer, not a per-surface closure.
  editor.props.onBlur({ currentTarget: { innerHTML: '<p>typed here</p>' } });
  assert.equal(c.state.scratch.html, '<p>typed here</p>');
});
