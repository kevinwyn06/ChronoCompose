const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

/* Owner report, 2026-08-14: "dropping INTO a section" and "dropping BETWEEN two tasks" were told apart
   only by a header tint in --menu-hover — the ordinary hover colour. The into-section case is now a
   claim on the section's whole band, resolved by the pure `sectionDropBand`.

   The contract these tests pin is that the indicator is a function of the RESOLVED drop target, not of
   the raw cursor: the drop-resolution lane may add slots (a bottom-most-in-section slot, for instance)
   and this resolver must keep rendering them with no change. */

const layout = () => ([
  { id:'s1', name:'Research', top:0,   headerBottom:24, bottom:96,  firstIndex:0, endIndex:3, collapsed:false },
  { id:'s2', name:'Admin',    top:96,  headerBottom:120, bottom:120, firstIndex:3, endIndex:3, collapsed:false },
  { id:null, name:'No section', top:120, headerBottom:144, bottom:168, firstIndex:3, endIndex:4, collapsed:false },
]);

test('sectionDropBand returns the FULL band — header plus every row it holds, not just the header', () => {
  const c = make();
  const L = layout();
  const band = c.sectionDropBand(L, { origSectionId:null, dropSectionId:'s1' }, false);
  assert.equal(band.id, 's1');
  assert.equal(band.top, 0);
  assert.equal(band.bottom, 96, 'the outline spans the whole band, not the 24px header');
  assert.ok(band.bottom - band.top > band.headerBottom - band.top,
    'a band with rows is strictly taller than its header — that height difference is the whole point');
});

test('sectionDropBand lights NOTHING when the drop would not change the section', () => {
  const c = make();
  const L = layout();
  assert.equal(c.sectionDropBand(L, { origSectionId:'s1', dropSectionId:'s1' }, false), null,
    'picking a row up inside its own section must not paint a claim');
  assert.equal(c.sectionDropBand(L, { origSectionId:'s1', dropSectionId:undefined }, false), null,
    'undefined means "leave sectionId alone" and is not a section change');
});

test('sectionDropBand handles the No-section bucket and an EMPTY section', () => {
  const c = make();
  const L = layout();
  const none = c.sectionDropBand(L, { origSectionId:'s1', dropSectionId:null }, false);
  assert.equal(none.id, null, 'null is a real target (No section), distinct from undefined');
  const empty = c.sectionDropBand(L, { origSectionId:'s1', dropSectionId:'s2' }, false);
  assert.equal(empty.top, 96);
  assert.equal(empty.bottom, 120, 'an empty section still owns its header band — the case with no rows '
    + 'for an insertion rule to sit between, which is why the outline exists');
});

/* Coordination with the drop-resolution lane (#114): `resolveRowInsert` now reports `atEnd` and
   `bandEmpty` alongside `index`/`sectionId`. The indicator must key off the RESOLVED SECTION only —
   "bottom-most row of section S" and "somewhere in the middle of section S" are the same claim on the
   same band, and an outline that flickered between them would be describing the wrong thing. */
test('sectionDropBand is indifferent to #114\'s atEnd/bandEmpty — the band is the same claim either way', () => {
  const c = make();
  const L = layout();
  const base = { origSectionId:null, dropSectionId:'s1' };
  const mid = c.sectionDropBand(L, Object.assign({}, base, { atEnd:false, bandEmpty:false }), false);
  const end = c.sectionDropBand(L, Object.assign({}, base, { atEnd:true, bandEmpty:false }), false);
  const empty = c.sectionDropBand(L, Object.assign({}, base, { atEnd:false, bandEmpty:true }), false);
  assert.deepEqual(mid, end, 'the bottom-most slot claims the same band as any other slot in it');
  assert.deepEqual(mid, empty, 'and so does an empty band — where the outline is the ONLY feedback, '
    + 'because rowDropDeco draws no rule when bandEmpty');
});

test('sectionDropBand reads the INCLUSION bands under Group by: Inclusion', () => {
  const c = make();
  const IN = c.INCL_BAND_IN(), OUT = c.INCL_BAND_OUT();
  const L = [
    { id:IN,  top:0,  headerBottom:24, bottom:96 },
    { id:OUT, top:96, headerBottom:120, bottom:144 },
  ];
  const band = c.sectionDropBand(L, { origInclusion:'included', dropInclusion:'excluded' }, true);
  assert.equal(band.id, OUT);
  assert.equal(c.sectionDropBand(L, { origInclusion:'excluded', dropInclusion:'excluded' }, true), null);
  /* and it must not fall through to the section branch in inclusion mode */
  assert.equal(c.sectionDropBand(L, { origSectionId:null, dropSectionId:'s1', dropInclusion:undefined }, true), null);
});

test('sectionDropBand is pure and total — no drag, no layout, unknown id all resolve to null', () => {
  const c = make();
  const L = layout();
  const frozen = JSON.stringify(L);
  assert.equal(c.sectionDropBand(L, null, false), null);
  assert.equal(c.sectionDropBand(null, { origSectionId:null, dropSectionId:'s1' }, false), null);
  assert.equal(c.sectionDropBand([], { origSectionId:null, dropSectionId:'s1' }, false), null);
  assert.equal(c.sectionDropBand(L, { origSectionId:null, dropSectionId:'ghost' }, false), null,
    'a target with no painted band paints nothing — the outline can never claim a band the drop misses');
  assert.equal(JSON.stringify(L), frozen, 'the layout is not mutated');
});

test('the section header no longer carries a row-drag tint of its own', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/isRowTarget/.test(src),
    'the --menu-hover header tint is gone; the band outline replaced it');
});

test('both drop-indicator modes define per-theme tokens, not one hardcoded rgba', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  for (const tok of ['--drop-band-bg', '--drop-band-halo']) {
    const defs = src.match(new RegExp(tok.replace(/-/g, '\\-') + '\\s*:', 'g')) || [];
    assert.ok(defs.length >= 2, tok + ' must be defined in BOTH themes (found ' + defs.length + ')');
  }
  const dark = src.slice(src.indexOf('--drop-band-bg'));
  const lightIdx = dark.indexOf('data-theme="light"');
  assert.ok(lightIdx > -1, 'a light-theme override block follows the dark defaults');
});
