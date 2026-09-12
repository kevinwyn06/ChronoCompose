// Owner report, 2026-09-12: "Give each section a color at instantiation time. Don't have it change if I
// delete a [section]." The order-derived hue re-coloured every later section on delete/reorder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

test('a new section is given a stored colour at creation', () => {
  const c = make();
  c.state.sections = [];
  const list = c.addSectionTo([], 'Work');
  assert.equal(list[0].color, c.SECCOL[0], 'first section takes the first palette hue');
  const two = c.addSectionTo(list, 'Home');
  assert.equal(two[1].color, c.SECCOL[1], 'next section takes the next unused hue');
});

test('deleting a section does not re-colour the ones after it', () => {
  const c = make();
  let list = c.addSectionTo([], 'A');
  list = c.addSectionTo(list, 'B');
  list = c.addSectionTo(list, 'C');
  c.state.sections = list;
  const before = { b: c.sectionHue(list[1].id), c: c.sectionHue(list[2].id) };
  c.state.sections = list.filter(s => s.id !== list[0].id).map((s, i) => Object.assign({}, s, { order: i }));
  assert.equal(c.sectionHue(list[1].id), before.b);
  assert.equal(c.sectionHue(list[2].id), before.c);
});

test('reordering keeps each section its colour', () => {
  const c = make();
  let list = c.addSectionTo([], 'A');
  list = c.addSectionTo(list, 'B');
  c.state.sections = list;
  const hueA = c.sectionHue(list[0].id);
  c.state.sections = c.reorderSectionsIn(list, list[1].id, 0);
  assert.equal(c.sectionHue(list[0].id), hueA);
});

test('a freed hue is reused before any hue is doubled', () => {
  const c = make();
  let list = c.addSectionTo([], 'A');
  list = c.addSectionTo(list, 'B');
  list = list.filter(s => s.name !== 'A');
  const next = c.addSectionTo(list, 'C');
  assert.equal(next[next.length - 1].color, c.SECCOL[0]);
});

test('colour survives normalizeSection (the load and sync-pull path)', () => {
  const c = make();
  assert.equal(c.normalizeSection({ id: 's', name: 'S', order: 0, color: '#123456' }).color, '#123456');
  assert.equal('color' in c.normalizeSection({ id: 's', name: 'S', order: 0 }), false);
});

test('legacy sections are backfilled with the hue they already wear', () => {
  const c = make();
  const legacy = ['X', 'Y', 'Z'].map((name, i) => c.normalizeSection({ id: 's' + i, name, order: i }));
  c.state.sections = legacy;
  const worn = legacy.map(s => c.sectionHue(s.id));
  const filled = c.ensureSectionColors(legacy);
  assert.deepEqual(filled.map(s => s.color), worn, 'invisible backfill');
  const colored = filled;
  assert.equal(c.ensureSectionColors(colored), colored, 'idempotent: an all-coloured list is returned as-is');
});
