const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// B3b — gcal events.watch push. gcalWatchNeedsSync is the one pure decision on the client side:
// everything else in the path is network IO (Edge Functions) or Realtime plumbing.
test('gcalWatchNeedsSync re-asserts watch channels only when it needs to', () => {
  const c = make();
  const RESYNC = 6 * 3600000;
  const now = 1_000_000_000;

  // Nothing selected -> nothing to watch, regardless of how stale we are.
  assert.strictEqual(c.gcalWatchNeedsSync(null, [], 0, now, RESYNC), false);
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], [], 1, now, RESYNC), false);

  // Never synced -> must sync.
  assert.strictEqual(c.gcalWatchNeedsSync(null, ['a'], 0, now, RESYNC), true);

  // Same selection, freshly synced -> no-op (this is the poll-tick case, fires every 15s).
  assert.strictEqual(c.gcalWatchNeedsSync(['a', 'b'], ['a', 'b'], now - 1000, now, RESYNC), false);

  // Selection is a SET, not a list: order must not trigger a needless re-register.
  assert.strictEqual(c.gcalWatchNeedsSync(['b', 'a'], ['a', 'b'], now - 1000, now, RESYNC), false);

  // Real selection changes -> sync.
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], ['a', 'b'], now - 1000, now, RESYNC), true);
  assert.strictEqual(c.gcalWatchNeedsSync(['a', 'b'], ['a'], now - 1000, now, RESYNC), true);
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], ['b'], now - 1000, now, RESYNC), true);

  // Periodic re-assert: due exactly at the interval, and after it.
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], ['a'], now - RESYNC, now, RESYNC), true);
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], ['a'], now - RESYNC - 1, now, RESYNC), true);
  assert.strictEqual(c.gcalWatchNeedsSync(['a'], ['a'], now - RESYNC + 1, now, RESYNC), false);
});

test('gcalOnPing is inert unless Calendar is actually connected', () => {
  const c = make();
  let imports = 0;
  c.gcalImport = () => { imports++; };
  c.loadQueue = () => [];

  c.state.gcal = { connected: false };
  c._token = 'tok';
  c.gcalOnPing();
  assert.strictEqual(imports, 0, 'a ping for a disconnected calendar must not import');

  c.state.gcal = { connected: true };
  c._token = null;
  c.gcalOnPing();
  assert.strictEqual(imports, 0, 'no access token -> nothing to import with');
});
