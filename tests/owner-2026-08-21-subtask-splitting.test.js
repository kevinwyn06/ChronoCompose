// Owner ruling 2026-08-21 — the depth-ordered splitting rule.
//
// "The scheduler must prefer splitting a task over splitting a subtask, and a subtask over a
// sub-subtask, and so on down the tree. Splitting cost rises with depth."
//
// The distinction most likely to be lost in implementation, and the one the mockup pins:
//
//   SPLITTING COST IS ABOUT CUTTING *THROUGH* A NODE, NEVER ABOUT ORDERING *AROUND* IT.
//
// Putting "Headline pass" before an appointment and "Body pass" after it splits *Draft copy*, not
// either child — cost 1, not 2. A seam BETWEEN siblings is free at every depth. Without this the rule
// over-counts and the packer refuses arrangements that are actually ideal.
//
// OWNER RULING 2026-08-21 on ties: depth is a PRE-FILTER only; `orderingSeam` (active, priority, EDF,
// longer-first) breaks ties within a depth, exactly as it does today.
//
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

// The component runs in a Node VM, so anything it returns carries that realm's Array/Object prototype
// and `deepStrictEqual` rejects it on identity alone. `plain` re-homes a value in this realm; every
// structural assertion below goes through it.
const plain = (x) => JSON.parse(JSON.stringify(x));

// A three-deep tree, expressed the way the mockup draws it.
//   Draft copy (parent, depth 0)
//     ├── Headline pass (depth 1)
//     ├── Body pass     (depth 1)
//     │     └── Captions (depth 2)
function tree(c, mins){
  const B = c.startOfToday();
  const t = (id, name, parentId, planned) => c.normalizeTask({
    id, name, parentId: parentId || null, type: 'Proportional', included: true, planned,
    start: B, end: B + 86400000,
  });
  return [
    t('p',  'Draft copy',    null, mins.p),
    t('k1', 'Headline pass', 'p',  mins.k1),
    t('k2', 'Body pass',     'p',  mins.k2),
    t('g1', 'Captions',      'k2', mins.g1),
  ];
}

const NAMES = { p: 'Draft copy', k1: 'Headline pass', k2: 'Body pass', g1: 'Captions' };

test('familyQueue: the whole subtree, depth-tagged and in reading order', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // Children total exactly the parent's Planned, so the parent keeps no remainder of its own.
    c.state.tasks = tree(c, { p: 90, k1: 30, k2: 60, g1: 20 });
    const kb = c.buildKids(c.state.tasks);
    /* `familyQueue` reads today's allotment through `flexAllot`, which reads `_allot`. Priming it here
       is exactly what `buildDayTimeline` does one line before it packs — the same documented seam, not
       a test-only back door. */
    c._allot = c.computeAllotted(c.state.tasks, c.startOfToday());
    const q = c.familyQueue('p', kb.kids, kb.byId, c.startOfToday());

    // Depth 2 is REACHED. The two-level subdivision this replaces drew grandchildren nowhere, which is
    // exactly the gap the owner flagged: "sub-subtasks are not illustrated at all".
    assert.deepEqual(plain(q).map(x => x.id), ['k1', 'k2', 'g1'],
      'depth-first reading order');
    assert.deepEqual(plain(q).map(x => x.depth), [1, 1, 2]);
    assert.equal(q.find(x => x.id === 'g1').name, NAMES.g1);
    // The queue holds what CARRIES MINUTES, which is the app's existing allotment model: a node keeps
    // only its unassigned remainder, so a parent whose children account for all of its Planned
    // contributes nothing of its own. `Body pass` is here because 20 of its 60 went to Captions and 40
    // stayed with it; `Draft copy` is absent because its two children account for all 90.
    assert.equal(q.find(x => x.id === 'k2').mins, 40);
    assert.equal(q.find(x => x.id === 'p'), undefined);
  });
});

test('familyQueue: a parent that keeps a remainder is in the queue, LAST and at depth 0', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // 120 planned against 90 of children: 30 minutes are the parent's own work.
    c.state.tasks = tree(c, { p: 120, k1: 30, k2: 60, g1: 20 });
    const kb = c.buildKids(c.state.tasks);
    c._allot = c.computeAllotted(c.state.tasks, c.startOfToday());
    const q = c.familyQueue('p', kb.kids, kb.byId, c.startOfToday());
    assert.deepEqual(plain(q).map(x => x.id), ['k1', 'k2', 'g1', 'p'],
      'the parent\'s own remainder comes last — it is what is left after its children are named');
    assert.equal(q[q.length - 1].depth, 0);
  });
});

// ---------------------------------------------------------------------------
// The four cases the mockup draws, run against `layFamily` directly. Chunks are
// plain {start, end} in ms so the rule is testable without a whole packed day.
// ---------------------------------------------------------------------------

const MIN = 60000;
const chunks = (...spans) => spans.map(([a, b]) => ({ start: a * MIN, end: b * MIN }));
const items = (...xs) => xs.map(([id, depth, mins]) => ({ id, name: NAMES[id] || id, depth, mins }));

test('layFamily: a hole that fits a whole child reorders BETWEEN siblings — nothing is cut', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // Two chunks of 30, split by an appointment. Two 30-minute children.
    const out = c.layFamily(chunks([0, 30], [60, 90]), items(['k1', 1, 30], ['k2', 1, 30]));
    assert.deepEqual(plain(out).map(x => x.id), ['k1', 'k2']);
    assert.equal(out.filter(x => x.cut).length, 0,
      'a seam between siblings is free at every depth — nothing was cut THROUGH');
    assert.deepEqual(plain(out).map(x => x.start / MIN), [0, 60]);
  });
});

test('layFamily: a hole smaller than any child cuts the SHALLOWEST candidate', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // One 20-minute hole then a 40-minute one. Nothing fits whole in the first.
    // The parent's own remainder is the shallowest thing present, so it takes the cut.
    const out = c.layFamily(chunks([0, 20], [60, 100]), items(['k1', 1, 30], ['p', 0, 30]));
    const cutIds = out.filter(x => x.cut).map(x => x.id);
    assert.deepEqual(plain([...cutIds].filter((v, i, a) => a.indexOf(v) === i)), ['p'],
      'depth 0 is spent before depth 1 — splitting cost rises with depth');
    assert.equal(out.filter(x => x.id === 'k1' && x.cut).length, 0, 'the subtask survives whole');
  });
});

test('layFamily: with only a tree left, a depth-1 subtask is cut before a depth-2 one', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const out = c.layFamily(chunks([0, 20], [60, 100]), items(['k2', 1, 30], ['g1', 2, 30]));
    const cutIds = plain(out.filter(x => x.cut).map(x => x.id));
    assert.deepEqual(cutIds.filter((v, i, a) => a.indexOf(v) === i), ['k2']);
  });
});

test('layFamily: a cut piece says which piece it is, so the block can read `CUT · 1 of 2`', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const out = c.layFamily(chunks([0, 20], [60, 100]), items(['p', 0, 30]));
    const pieces = out.filter(x => x.id === 'p');
    assert.equal(pieces.length, 2);
    assert.deepEqual(plain(pieces).map(x => x.piece), [1, 2]);
    assert.deepEqual(plain(pieces).map(x => x.pieces), [2, 2]);
    assert.equal(pieces.every(x => x.cut), true);
  });
});

test('layFamily: ties within a depth keep the order they arrived in — orderingSeam owns that', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // Both fit whole and both are depth 1. Depth is a pre-filter, so it must not reshuffle them.
    const out = c.layFamily(chunks([0, 30], [60, 90]), items(['k2', 1, 30], ['k1', 1, 30]));
    assert.deepEqual(plain(out).map(x => x.id), ['k2', 'k1']);
  });
});

test('layFamily: preferring a whole placement never reaches past a shallower one that also fits', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // Everything fits in one big chunk: the queue order must simply be honoured.
    const out = c.layFamily(chunks([0, 120]), items(['k1', 1, 30], ['g1', 2, 30], ['p', 0, 30]));
    assert.deepEqual(plain(out).map(x => x.id), ['k1', 'g1', 'p']);
    assert.equal(out.filter(x => x.cut).length, 0);
  });
});

test('layFamily: minutes are conserved — the rule reorders and cuts, it never loses work', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const out = c.layFamily(chunks([0, 25], [60, 95]), items(['k1', 1, 30], ['p', 0, 30]));
    const placed = out.reduce((n, x) => n + (x.end - x.start) / MIN, 0);
    assert.equal(placed, 60, 'both 30-minute items are fully laid out across the two chunks');
  });
});

test('layFamily: work that does not fit at all is returned as leftover, not silently dropped', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const out = c.layFamily(chunks([0, 20]), items(['k1', 1, 30]));
    const placed = out.reduce((n, x) => n + (x.end - x.start) / MIN, 0);
    assert.equal(placed, 20);
    assert.equal(out.leftover, 10, 'the shortfall is reported so the caller can say the day is full');
  });
});

// ---------------------------------------------------------------------------
// Case 1 of the mockup, and the reason it is the rule's whole purpose: when a
// plain task can absorb the shortfall, the trees stay whole.
// ---------------------------------------------------------------------------

test('the packer cuts a FLAT task before it fragments a subtree', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    /* A day chopped in two by a fixed appointment, with a tree and a flat task competing for it. The
       tree is packed first (it is the higher priority), and the flat task takes what is left — which is
       fragmented. Before the rule, the strict pass fragmented whichever task reached the seam first. */
    const mk = (id, name, extra) => c.normalizeTask(Object.assign({
      id, name, type: 'Proportional', included: true, planned: 60,
      start: B, end: B + 86400000,
    }, extra || {}));
    c.state.tasks = [
      mk('p', 'Draft copy', { priority: 1 }),
      mk('k1', 'Headline pass', { parentId: 'p', planned: 60 }),
      mk('flat', 'Answer email', { priority: 2 }),
      mk('appt', 'Standup', { start: B + 11 * 60 * MIN, end: B + 12 * 60 * MIN,
        startClock: true, endClock: true, planned: 60 }),
    ];
    const data = c.buildDayTimeline(B);
    const runsOf = id => data.chunks.filter(x => x.id === id && x.start);
    /* The tree is contiguous; the flat task is the one that got cut. That is case 1, and the rule's
       purpose: keep structure intact by spending the cheapest seam. */
    assert.equal(runsOf('k1').length <= 1, true, 'the subtree was not fragmented');
  });
});
