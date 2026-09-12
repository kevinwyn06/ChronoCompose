// Owner reports, 2026-08-19: "Assign different colors to different sections for the timeline blocks"
// and "Get rid of the priority coloring."
//
// Scope decided with the owner: TIMELINE BLOCKS ONLY. The sheet rows, month calendar, dashboards and —
// crucially — the priority picker and the P1–P4 filter chips keep `PCOL`, because there the colour IS
// the control's meaning. Section hue is AUTO-ASSIGNED from a palette by section order, so it stays a
// pure projection of the data: no `color` field, no Supabase migration, nothing to keep in sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

function withSections(c, names){
  c.state.sections = names.map((name, i) => c.normalizeSection({ id: 's' + i, name, order: i }));
  return c.state.sections;
}

test('the palette gives each section in order its own hue', () => {
  const c = make();
  withSections(c, ['Work', 'Home', 'Errands']);
  const hues = ['s0', 's1', 's2'].map(id => c.sectionHue(id));
  assert.equal(new Set(hues).size, 3, 'three sections, three distinct hues');
  hues.forEach(x => assert.match(x, /^#[0-9a-f]{6}$/i, 'a real colour, not a token that may not exist'));
});

// Superseded 2026-09-12: a section now stores its colour at creation. This order rule survives only as
// the fallback for a legacy section that has no stored colour yet (these fixtures have none).
test('a legacy section with no stored colour falls back to its ORDER position', () => {
  const c = make();
  withSections(c, ['Work', 'Home']);
  const first = c.sectionHue('s0');
  c.state.sections = c.reorderSectionsIn(c.state.sections, 's1', 0);
  assert.equal(c.sectionHue('s1'), first, 'whatever sits first wears the first hue');
});

test('the palette wraps rather than running out', () => {
  const c = make();
  withSections(c, Array.from({ length: 20 }, (_, i) => 'S' + i));
  const all = c.state.sections.map(s => c.sectionHue(s.id));
  assert.ok(all.every(Boolean), 'a 20-section workspace still colours every section');
});

test('an unfiled task, and an unknown section, take the reserved No-section hue', () => {
  const c = make();
  withSections(c, ['Work']);
  assert.equal(c.sectionHue(null), c.SECCOL_NONE, 'No-section has a hue of its own');
  assert.equal(c.sectionHue('sec_deleted'), c.SECCOL_NONE, 'a dangling id lands in the same bucket');
  /* Not neutral, and this is the point: a workspace with no sections yet would otherwise paint its whole
     timeline flat grey. Not a section hue either, so unfiled can never read as filed. */
  assert.notEqual(c.SECCOL_NONE, 'var(--pri-default)');
  assert.ok(!c.SECCOL.includes(c.SECCOL_NONE), 'reserved, outside the section rotation');
});

test('a subtask wears its ROOT task section hue, the same rule tasksBySection files it under', () => {
  const c = make();
  withSections(c, ['Work', 'Home']);
  const parent = c.normalizeTask({ id: 'p', name: 'Parent', sectionId: 's1' });
  const kid = c.normalizeTask({ id: 'k', name: 'Kid', parentId: 'p' });
  c.state.tasks = [parent, kid];
  assert.equal(c.taskHue(kid), c.sectionHue('s1'),
    'a subtask is filed under its parent section, so it is painted with it');
  assert.equal(c.taskHue(parent), c.sectionHue('s1'));
});

test('tlSurface paints a timeline block from its SECTION, never from priority', () => {
  const c = make();
  withSections(c, ['Work', 'Home']);
  const p1Work = c.normalizeTask({ id: 'a', name: 'A', priority: 1, sectionId: 's0' });
  const p4Work = c.normalizeTask({ id: 'b', name: 'B', priority: 4, sectionId: 's0' });
  const p1Home = c.normalizeTask({ id: 'd', name: 'D', priority: 1, sectionId: 's1' });
  c.state.tasks = [p1Work, p4Work, p1Home];

  const surf = t => c.tlSurface({ id: t.id, type: 'task' }, t);
  assert.equal(surf(p1Work).col, surf(p4Work).col,
    'same section, different priority — one colour: priority no longer speaks here');
  assert.notEqual(surf(p1Work).col, surf(p1Home).col,
    'same priority, different section — different colours');
  assert.equal(surf(p1Work).col, c.sectionHue('s0'));
  assert.ok(!surf(p1Work).bg.includes(c.PCOL[1]), 'no priority red anywhere in the fill');
});

test('a meal window is still a window, and an unfiled block still renders', () => {
  const c = make();
  withSections(c, ['Work']);
  assert.equal(c.tlSurface({ type: 'meal' }, null).window, true, 'meals are untouched');
  const loose = c.normalizeTask({ id: 'x', name: 'X', priority: 1 });
  c.state.tasks = [loose];
  assert.equal(c.tlSurface({ id: 'x', type: 'task' }, loose).col, c.SECCOL_NONE,
    'an unfiled task takes the reserved hue rather than borrowing the first section');
});

test('PCOL survives for the controls whose meaning IS the colour', () => {
  const c = make();
  assert.equal(c.PCOL[1], '#d1453b', 'the priority picker and P1–P4 filter chips still need it');
  assert.equal(Object.keys(c.PCOL).length, 4);
});
