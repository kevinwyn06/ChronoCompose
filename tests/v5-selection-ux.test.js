// Chain 4 / block 24 — Selection: per-column band sizing (F16).
//
// Block 30a REMOVED the quick-swap control at the owner's direction ("get rid of the quick swap button
// entirely, on second thought"), and its five 24b tests went with it. Only 24a's band sizing remains,
// which is what the owner asked for and has not withdrawn.
//
// 24a, owner verbatim: "Excluded is just as important. This surface is for the user to veto stuff.
// Visually though let's have it so that each column has its own divider. And then make sure if stuff
// starts to overflow, included and excluded overflow roughly the same amount (require the same amount
// of max scroll) for each column."
//
// The review proposed sizing each band to its content and collapsing Excluded. The OWNER OVERRODE
// that. Vetoing is a first-class activity, so Excluded keeps its space; what changes is that the
// divider becomes PER COLUMN, and the two halves of a column are balanced so neither is crammed while
// the other sits half empty.
//
// Before: both bands were `flex:1` regardless of content, so 7 included against 3 excluded split the
// surface down the middle — Included needed a long scroll while Excluded showed whitespace.
//
// The balance is expressed in ordinary flexbox and therefore reproduces in the browser exactly:
//   • flex-basis = content height (count × card estimate)  → when the column has slack, both halves
//     receive the SAME absolute slack, so neither scrolls.
//   • flex-shrink = C / basis                              → the scaled shrink factors (shrink × basis)
//     are EQUAL, so a deficit is split evenly in absolute px and both halves scroll the same amount.
// `selectionSplitHeights` resolves that arithmetic in pure JS so it can be asserted here, and
// `selectionHalfFlex` is what the renderer hands to the DOM. One source, two consumers.
//
// NOT TESTED HERE, deliberately: opt-out persistence (old 24c) was MOOTED by 30a — with no swap there is
// nothing to persist, and the owner ruled that no persistence policy be built.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, DAY } = require('./_load.js');

// --- 24a: per-column split arithmetic ----------------------------------------------------------

// Max scroll of a half = its content height minus the height it was given, floored at zero.
const scrolls = (c, nIncl, nExcl, H) => {
  const r = c.selectionSplitHeights(nIncl, nExcl, H);
  return [r.scrollIncluded, r.scrollExcluded];
};

test('24a: 7 included against 3 excluded scroll by roughly the same amount', () => {
  const c = make();
  const H = 6 * c.SEL_CARD_EST_PX; // a column tall enough for six cards, holding ten
  const [si, se] = scrolls(c, 7, 3, H);
  assert.ok(si > 0, 'the fixture must actually overflow, or it proves nothing');
  assert.ok(se > 0, 'and the balance must push some of that overflow onto Excluded too');
  assert.ok(Math.abs(si - se) <= 0.5 * c.SEL_CARD_EST_PX,
    'the two halves must require comparable max scroll, not 7:3 (' + si + ' vs ' + se + ')');
});

test('24a: the old flex:1 split is what this replaces — half the height each is NOT balanced', () => {
  const c = make();
  const H = 6 * c.SEL_CARD_EST_PX;
  // What the previous implementation produced: each band got exactly H/2 whatever it held.
  const oldIncl = Math.max(0, 7 * c.SEL_CARD_EST_PX - H / 2);
  const oldExcl = Math.max(0, 3 * c.SEL_CARD_EST_PX - H / 2);
  assert.ok(Math.abs(oldIncl - oldExcl) > 2 * c.SEL_CARD_EST_PX,
    'sanity: the old behaviour really was lopsided, so the new assertion above is meaningful');
  const [si, se] = scrolls(c, 7, 3, H);
  assert.ok(Math.abs(si - se) < Math.abs(oldIncl - oldExcl), 'and the new split is strictly better');
});

test('24a: when nothing overflows, neither half scrolls and both keep space', () => {
  const c = make();
  const H = 20 * c.SEL_CARD_EST_PX;
  const r = c.selectionSplitHeights(3, 1, H);
  assert.equal(r.scrollIncluded, 0);
  assert.equal(r.scrollExcluded, 0);
  assert.ok(r.excluded >= c.SEL_HALF_MIN_PX, 'Excluded is never collapsed — the owner overrode that');
  assert.ok(r.included + r.excluded <= H + 0.001, 'the two halves fill the column and no more');
});

test('24a: an EMPTY Excluded half still gets a usable drop target', () => {
  const c = make();
  const r = c.selectionSplitHeights(9, 0, 6 * c.SEL_CARD_EST_PX);
  assert.ok(r.excluded >= c.SEL_HALF_MIN_PX,
    'vetoing is first-class: you must be able to drag into an empty Excluded half');
});

test('24a: the split is stable across a re-render and depends only on counts and height', () => {
  const c = make();
  const H = 6 * c.SEL_CARD_EST_PX;
  const a = c.selectionSplitHeights(7, 3, H);
  const b = c.selectionSplitHeights(7, 3, H);
  assert.deepEqual(a, b, 'pure — the same inputs must give byte-identical geometry');
  // And the flex triple the renderer emits comes from the same place.
  const f = c.selectionHalfFlex(7);
  assert.equal(f.basis, 7 * c.SEL_CARD_EST_PX);
  assert.ok(f.grow > 0 && f.shrink > 0, 'both halves must be able to grow AND shrink');
  // Equal SCALED shrink factor is the whole mechanism: shrink × basis identical for both halves.
  const g = c.selectionHalfFlex(3);
  assert.ok(Math.abs(f.shrink * f.basis - g.shrink * g.basis) < 1e-9,
    'scaled shrink factors must match, or the browser will not split a deficit evenly');
});

test('24a: the split is per COLUMN — different columns get different geometry', () => {
  const c = make();
  const H = 6 * c.SEL_CARD_EST_PX;
  const busy = c.selectionSplitHeights(8, 1, H);
  const quiet = c.selectionSplitHeights(1, 8, H);
  assert.notEqual(busy.included, quiet.included,
    'one divider across the whole surface cannot do this; a per-column divider can');
});
