const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// Pure expiry check behind the durable-gcal token cache (gcalEnsureToken uses it to decide whether to
// re-mint an access token via the Edge Function). The network paths themselves stay manual (like the
// rest of gcal/Supabase IO), but this decision is IO-free and must be exact around the skew window.
test('gcalTokenExpired: missing expiry is always expired', () => {
  const c = make();
  assert.strictEqual(c.gcalTokenExpired(0, 1000), true);
  assert.strictEqual(c.gcalTokenExpired(null, 1000), true);
  assert.strictEqual(c.gcalTokenExpired(undefined, 1000), true);
});

test('gcalTokenExpired: default 60s skew treats near-expiry as expired', () => {
  const c = make();
  const now = 1_000_000;
  assert.strictEqual(c.gcalTokenExpired(now + 120000, now), false); // 2 min out — fresh
  assert.strictEqual(c.gcalTokenExpired(now + 60000,  now), true);  // exactly at skew — refresh
  assert.strictEqual(c.gcalTokenExpired(now + 30000,  now), true);  // inside skew — refresh
  assert.strictEqual(c.gcalTokenExpired(now - 1,      now), true);  // already past — refresh
});

test('gcalTokenExpired: custom skew window', () => {
  const c = make();
  const now = 1_000_000;
  assert.strictEqual(c.gcalTokenExpired(now + 5000, now, 1000), false); // 5s out, 1s skew — fresh
  assert.strictEqual(c.gcalTokenExpired(now + 500,  now, 1000), true);  // inside 1s skew — refresh
});
