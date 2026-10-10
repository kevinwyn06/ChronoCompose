// Owner report 2026-08-20: "the tasks I have are not the same on my localhost and vercel deployments.
// Same browser user, same account."
//
// Diagnosed live against the throwaway account (uid 00000000…): Vercel held 11 tasks, localhost 28, and
// localhost carried 24 queued sync ops that could never drain. One task ("test ghost") had a FRACTIONAL
// `end` — 1785437897142.8572 — and `start`/`end` are `bigint` columns (0001_init.sql:24-25). The flush
// sends the whole queue as ONE bulk upsert, so Postgres rejected every row:
//
//     22P02  invalid input syntax for type bigint: "1785437897142.8572"
//
// and `syncFlushQueue` keeps the queue on failure. One malformed task therefore wedged every write that
// origin would ever attempt, silently — no toast, no console error. Isolated with a two-row probe:
// the good row alone upserted OK; the same row batched with the ghost died with 22P02.
//
// Three layers of fix, three groups of tests:
//   1. normalizeTask must not admit a fractional epoch-ms in the first place.
//   2. syncRowForWrite must round every integer-typed column, not just spent/predicted.
//   3. syncFlushQueue must not let one rejected row wedge the queue, and must surface the failure.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const FRACTIONAL_END = 1785437897142.8572; // the exact value from the owner's data
const B = 1_700_000_000_000;

function task(c, over){
  return c.normalizeTask(Object.assign({
    id:'t1', name:'test ghost', type:'Proportional', start:B, end:B+86400000,
    priority:4, deps:[], pct:0, planned:60,
  }, over||{}));
}

// =======================================================================
// 1 — normalizeTask is the central guarantee: epoch-ms fields are integers
// =======================================================================

test('normalizeTask coerces a fractional end to an integer', () => {
  const c = make();
  const t = task(c, { end: FRACTIONAL_END });
  assert.ok(Number.isInteger(t.end), `end must be an integer, got ${t.end}`);
  assert.strictEqual(t.end, Math.round(FRACTIONAL_END));
});

test('normalizeTask coerces a fractional start too', () => {
  const c = make();
  const t = task(c, { start: B + 0.5 });
  assert.ok(Number.isInteger(t.start));
});

test('every epoch-ms field backed by a bigint column is integral after normalize', () => {
  const c = make();
  const t = task(c, {
    start: B + 0.1, end: B + 86400000.9,
    completion: B + 0.25, archivedAt: B + 0.75, snoozeUntil: B + 0.5,
  });
  ['start','end','completion','archivedAt','snoozeUntil'].forEach(k => {
    assert.ok(Number.isInteger(t[k]), `${k} must be an integer, got ${t[k]}`);
  });
});

test('normalizeTask leaves null date fields null (coercion must not invent 0)', () => {
  const c = make();
  const t = task(c, { start:null, end:null, completion:null, archivedAt:null, snoozeUntil:null });
  ['start','end','completion','archivedAt','snoozeUntil'].forEach(k => {
    assert.strictEqual(t[k], null, `${k} must stay null, got ${t[k]}`);
  });
});

test('normalizeTask does NOT round `spent` — it is fractional minutes by design', () => {
  const c = make();
  // syncRowForWrite converts spent to integer SECONDS on the way out; the in-memory value stays
  // fractional so the timer does not lose sub-minute accumulation. Guard against an over-eager fix.
  const t = task(c, { spent: 49169.919583333336 });
  assert.strictEqual(t.spent, 49169.919583333336);
});

// =======================================================================
// 2 — syncRowForWrite must round every integer-typed column
// =======================================================================

test('syncRowForWrite rounds a fractional end (the row that wedged the queue)', () => {
  const c = make();
  // Build the row by hand: this layer must be safe even for a task that bypassed normalizeTask
  // (a legacy row already persisted in localStorage, which is exactly the owner's situation).
  const row = c.syncRowOf(task(c));
  row.end = FRACTIONAL_END;
  const out = c.syncRowForWrite(row);
  assert.ok(Number.isInteger(out.end), `end reached the wire as ${out.end}`);
  assert.strictEqual(out.end, 1785437897143);
});

test('syncRowForWrite rounds every int-backed column', () => {
  const c = make();
  const row = c.syncRowOf(task(c));
  Object.assign(row, {
    start: B + 0.4, end: B + 0.6, priority: 3.7, pct: 42.2,
    planned: 30.5, completion: B + 0.5, archivedAt: B + 0.5, snoozeUntil: B + 0.5,
  });
  const out = c.syncRowForWrite(row);
  ['start','end','priority','pct','planned','completion','archivedAt','snoozeUntil','spent','predicted']
    .forEach(k => {
      if (out[k] == null) return;
      assert.ok(Number.isInteger(out[k]), `${k} must be integral on the wire, got ${out[k]}`);
    });
});

test('syncRowForWrite still converts spent/predicted minutes to integer seconds', () => {
  const c = make();
  const row = c.syncRowOf(task(c, { spent: 2.5, predicted: 1.25 }));
  const out = c.syncRowForWrite(row);
  assert.strictEqual(out.spent, 150);      // 2.5 min -> 150 s
  assert.strictEqual(out.predicted, 75);   // 1.25 min -> 75 s
});

test('syncRowForWrite preserves nulls rather than coercing them to 0', () => {
  const c = make();
  const row = c.syncRowOf(task(c, { start:null, end:null, snoozeUntil:null }));
  const out = c.syncRowForWrite(row);
  assert.strictEqual(out.start, null);
  assert.strictEqual(out.end, null);
  assert.strictEqual(out.snoozeUntil, null);
});

test('syncRowForWrite still maps updatedAt -> updated_at (regression guard)', () => {
  const c = make();
  const row = c.syncRowOf(task(c, { updatedAt: B }));
  const out = c.syncRowForWrite(row);
  assert.strictEqual(out.updatedAt, undefined);
  assert.strictEqual(out.updated_at, new Date(B).toISOString());
});

// =======================================================================
// 3 — one rejected row must not wedge the whole queue
// =======================================================================
// The pure decision is "given a bulk write that failed, what do we send next?". Keeping it pure keeps
// it testable under Node, per the testing rules.

test('syncIsRowLevelReject recognises a Postgres data-shape rejection', () => {
  const c = make();
  assert.ok(c.syncIsRowLevelReject({ code:'22P02', message:'invalid input syntax for type bigint' }));
  assert.ok(c.syncIsRowLevelReject({ code:'23502', message:'null value violates not-null constraint' }));
});

test('syncIsRowLevelReject does NOT claim a network/auth failure is row-level', () => {
  const c = make();
  // Retrying these per-row would hammer the backend for no reason; they must stay whole-batch retries.
  assert.ok(!c.syncIsRowLevelReject({ code:'PGRST301', message:'JWT expired' }));
  assert.ok(!c.syncIsRowLevelReject({ message:'Failed to fetch' }));
  assert.ok(!c.syncIsRowLevelReject(null));
});

test('a poisoned batch quarantines only the offending row', () => {
  const c = make();
  const good1 = c.syncRowForWrite(c.syncRowOf(task(c, { id:'good1' })));
  const bad   = c.syncRowOf(task(c, { id:'bad' })); bad.end = FRACTIONAL_END;
  const good2 = c.syncRowForWrite(c.syncRowOf(task(c, { id:'good2' })));

  // NOTE: the component runs inside a VM sandbox, so arrays it returns have the sandbox's Array
  // prototype and deepStrictEqual would fail on the realm, not the contents. Compare ids as strings.
  const ids = a => Array.from(a).map(r=>r.id).join(',');

  const split = c.syncPartitionWritable([good1, c.syncRowForWrite(bad), good2]);
  assert.strictEqual(ids(split.bad), '', 'after syncRowForWrite nothing should remain unwritable');

  // and the raw (unrounded) row is caught rather than shipped
  const rawSplit = c.syncPartitionWritable([good1, bad, good2]);
  assert.strictEqual(ids(rawSplit.ok), 'good1,good2');
  assert.strictEqual(ids(rawSplit.bad), 'bad');
});

test('the owner\'s exact 24-op queue becomes writable end to end', () => {
  const c = make();
  // 23 healthy rows + the one ghost, the shape measured on localhost.
  const rows = [];
  for (let i = 0; i < 23; i++) rows.push(c.syncRowOf(task(c, { id:'t'+i, spent: i * 1.037 })));
  const ghost = c.syncRowOf(task(c, { id:'t8lfd5f', name:'test ghost' }));
  ghost.end = FRACTIONAL_END;
  rows.push(ghost);

  const wire = rows.map(r => c.syncRowForWrite(r));
  const split = c.syncPartitionWritable(wire);
  assert.strictEqual(split.bad.length, 0, 'no row should be unwritable after the write transform');
  assert.strictEqual(split.ok.length, 24, 'all 24 ops drain');
  wire.forEach(r => {
    ['start','end','priority','pct','planned','spent','predicted','completion','archivedAt','snoozeUntil']
      .forEach(k => { if (r[k] != null) assert.ok(Number.isInteger(r[k]), `${r.id}.${k} = ${r[k]}`); });
  });
});
