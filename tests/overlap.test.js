// Serial chain block 12 — OVERLAP LAYOUT.
//
// Owner, 2026-08-06, verbatim, given against a Google Calendar screenshot: *"Side by side if the titles
// will overlap (50/50), offset otherwise (~90/10). Recursively defined for >2 tasks."*
//
// `overlapLayout` is pure — blocks in, geometry out — which is deliberate: the recursion is the part
// that can be wrong in a way no screenshot would show, so it is proved here and the e2e layer only has
// to confirm the renderer honours the numbers this file pins.
//
// Every `left` below is a FRACTION of the block band. A block runs from its `left` to the band's right
// edge, so its width is `1 - left` and the sliver the block underneath still shows is the next block's
// `left` minus its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const H = 3600000, M = 60000;

/* px-per-minute chosen so the title band is exactly 30 minutes wide: TITLE_BAND_PX (18) / 0.6 = 30 min.
   Stating the band in minutes is what lets every fixture below say "these two start 15 minutes apart"
   and mean "their titles collide" without re-deriving the pixel arithmetic in each test. */
const PX = 0.6;
const bandMins = (c) => Math.round(c.TITLE_BAND_PX / PX);

const at = (h0, h1) => ({ start: h0 * H, end: h1 * H });
const lefts = (out) => Array.from(out, (o) => Number(o.left.toFixed(6)));
const zs = (out) => Array.from(out, (o) => o.z);

// =======================================================================
// The band itself
// =======================================================================
test('the fixture scale makes the title band exactly 30 minutes wide', () => {
  const c = make();
  assert.equal(c.TITLE_BAND_PX, 18);
  assert.equal(bandMins(c), 30, 'if this changes, every "15 minutes apart" fixture below means something else');
});

// =======================================================================
// No overlap ⇒ no layout. This is the invariant that keeps a normal day byte-identical.
// =======================================================================
test('a day with no overlap lays every block at the full width', () => {
  const c = make();
  const out = c.overlapLayout([at(9, 10), at(11, 12), at(14, 18)], PX);
  assert.deepEqual(lefts(out), [0, 0, 0]);
  assert.deepEqual(zs(out), [0, 0, 0]);
});

test('abutting blocks are not a cluster — a.end === b.start does not intersect', () => {
  const c = make();
  /* The packer emits back-to-back chunks all day long. If touching counted as overlap, every packed
     day would suddenly go stepped and this feature would fire on nothing. */
  assert.deepEqual(lefts(c.overlapLayout([at(9, 10), at(10, 11), at(11, 12)], PX)), [0, 0, 0]);
});

test('an empty list, and blocks with no start, are handled without throwing', () => {
  const c = make();
  assert.deepEqual(lefts(c.overlapLayout([], PX)), []);
  assert.deepEqual(lefts(c.overlapLayout(null, PX)), []);
  const out = c.overlapLayout([{ start: null, end: null }, at(9, 10)], PX);
  assert.deepEqual(lefts(out), [0, 0], 'an unplaced entry takes part in no cluster');
});

// =======================================================================
// The two shapes the owner named
// =======================================================================
test('two identical spans read 50/50 — their titles are on the same line', () => {
  const c = make();
  const out = c.overlapLayout([at(9, 10), at(9, 10)], PX);
  assert.deepEqual(lefts(out), [0, 0.5]);
  assert.deepEqual(zs(out), [0, 1], 'the later one draws on top');
});

test('a short block starting well below a long one reads 90/10', () => {
  const c = make();
  /* GCal's own shape, and the owner's screenshot: a 30-minute task inset inside a 3-hour Work event.
     The gap is 60 minutes — twice the band — so the titles do not collide and the inset block only has
     to be SEEN, not read side by side. It takes 90% and Work keeps a 10% sliver on the left. */
  const out = c.overlapLayout([at(10, 13), at(11, 11.5)], PX);
  assert.deepEqual(lefts(out), [0, 0.1]);
  assert.deepEqual(zs(out), [0, 1]);
});

test('the title-band test is a pixel test: the same pair flips at a coarser scale', () => {
  const c = make();
  const pair = [at(10, 13), at(11, 11.5)];
  assert.deepEqual(lefts(c.overlapLayout(pair, PX)), [0, 0.1], '60-min gap > a 30-min band ⇒ offset');
  /* Zoom the column out until the band swallows 60 minutes (18px / 0.2 = 90 min) and the two titles
     really would be drawn on the same pixels — so the rule correctly puts them side by side. */
  assert.deepEqual(lefts(c.overlapLayout(pair, 0.2)), [0, 0.5]);
});

test('the boundary is exclusive: exactly one band apart does NOT collide', () => {
  const c = make();
  const b = bandMins(c);
  assert.deepEqual(lefts(c.overlapLayout([at(10, 13), { start: 10 * H + b * M, end: 12 * H }], PX)), [0, 0.1]);
  assert.deepEqual(lefts(c.overlapLayout([at(10, 13), { start: 10 * H + (b - 1) * M, end: 12 * H }], PX)), [0, 0.5]);
});

// =======================================================================
// The recursion — this is the point of the file
// =======================================================================
test('three nested spans step against the REMAINING width, not the whole width', () => {
  const c = make();
  /* Three containers, each starting an hour after the last and all running to 18:00. No pair's titles
     collide, so each step is 10% of what is left: 0 → 0.1 → 0.1 + 0.1*0.9 = 0.19. The third block is
     81% wide; the second shows a 9% sliver; the first shows 10%. Nothing is special-cased for the
     third — it is the same one line applied again, which is what "recursively defined" means. */
  const out = c.overlapLayout([at(9, 18), at(11, 18), at(13, 18)], PX);
  assert.deepEqual(lefts(out), [0, 0.1, 0.19]);
  assert.deepEqual(zs(out), [0, 1, 2]);
});

test('three same-start spans step 50% of the remaining width each time', () => {
  const c = make();
  const out = c.overlapLayout([at(9, 12), at(9, 11), at(9, 10)], PX);
  assert.deepEqual(lefts(out), [0, 0.5, 0.75], 'halve what is left, then halve that');
  assert.deepEqual(zs(out), [0, 1, 2]);
});

test('a cluster mixes the two steps — collide then offset', () => {
  const c = make();
  /* 09:00, 09:15 (inside the band ⇒ 50%), 11:00 (an hour later ⇒ 10% of what remains).
     0 → 0.5 → 0.5 + 0.1*0.5 = 0.55. */
  const out = c.overlapLayout([at(9, 18), { start: 9.25 * H, end: 18 * H }, at(11, 18)], PX);
  assert.deepEqual(lefts(out), [0, 0.5, 0.55]);
});

test('a chain where the third block overlaps only the second is still ONE cluster', () => {
  const c = make();
  /* 09–11, 10–13, 12–14. The first and third never touch, but the second joins them, so all three are
     one connected component and the third does not restart at the full width — otherwise it would be
     drawn over the second at exactly the width the second already has. */
  const out = c.overlapLayout([at(9, 11), at(10, 13), at(12, 14)], PX);
  assert.deepEqual(lefts(out), [0, 0.1, 0.19]);
  assert.deepEqual(zs(out), [0, 1, 2]);
});

test('a cluster ENDS at a real gap, and the next one restarts at the full width', () => {
  const c = make();
  const out = c.overlapLayout([at(9, 11), at(10, 12), at(14, 16), at(15, 17)], PX);
  assert.deepEqual(lefts(out), [0, 0.1, 0, 0.1]);
  assert.deepEqual(zs(out), [0, 1, 0, 1], 'depth resets with the cluster');
});

test('a cluster is held open by the LATEST end seen, not by the previous block', () => {
  const c = make();
  /* 09–18 is a container; 10–11 sits inside it; 12–13 does not touch 10–11 but is still inside the
     container, so it must not restart at the full width and be drawn over the container's own title. */
  const out = c.overlapLayout([at(9, 18), at(10, 11), at(12, 13)], PX);
  assert.deepEqual(lefts(out), [0, 0.1, 0.19]);
});

// =======================================================================
// Order, ties, and the shape of the output
// =======================================================================
test('the output is parallel to the INPUT order, however the blocks are ordered', () => {
  const c = make();
  /* renderDayColumn indexes `lay[i]` against its own chunk array, so a sorted-inside answer returned in
     sorted order would silently paint the wrong block at the wrong width. */
  const out = c.overlapLayout([at(11, 11.5), at(10, 13)], PX);
  assert.deepEqual(lefts(out), [0.1, 0], 'the inset block is entry 0 here');
  assert.deepEqual(zs(out), [1, 0]);
});

test('on a tie the LONGER span keeps the full width', () => {
  const c = make();
  const out = c.overlapLayout([at(9, 10), at(9, 17)], PX);
  assert.deepEqual(lefts(out), [0.5, 0], 'the container is the one that stays readable');
});

test('every block runs to the cluster right edge — left is strictly inside [0,1)', () => {
  const c = make();
  /* Twelve blocks a minute apart, all inside the band, all colliding — the worst case the recursion can
     be handed. It must stay well-defined: no left ever reaches or passes 1 (which would invert the
     block), and each one really does step right. It also shows the rule's cost honestly — by the 12th
     the sliver is 2^-11 of the band, which is a taste call for the owner, not a correctness bug. */
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ start: 9 * H + i * M, end: 22 * H });
  const out = c.overlapLayout(many, PX);
  out.forEach((o, i) => {
    assert.ok(o.left >= 0 && o.left < 1, 'block ' + i + ' left in range: ' + o.left);
    if (i) assert.ok(o.left > out[i - 1].left, 'strictly stepping right');
  });
  assert.ok(out.every((o) => o.z <= c.OVERLAP_MAX_Z), 'z is clamped below the Points and now-line layers');
});
