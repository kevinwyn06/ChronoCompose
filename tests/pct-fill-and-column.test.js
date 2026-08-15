/* Owner report 2026-08-15: "The contrast is not high enough on the left and right of the percent complete
   bar, especially for ghost bars which already have a gradient... I think I would prefer to add percent
   complete back as a column which then updates the gantt bars."

   Two subjects, one report. `pctFillPaint` is the paint half — pure, so the ghost × pct matrix is provable
   here rather than by eye on a chart. The column half is asserted through the existing column machinery,
   which is the whole reason the column was added to `colDefs()` rather than special-cased. */
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

const solid = { ghost: false };
const startGhost = { ghost: true, ghostStart: true, ghostEnd: false };  // committed END, dissolves left
const endGhost   = { ghost: true, ghostStart: false, ghostEnd: true };  // committed START, dissolves right
const bothGhost  = { ghost: true, ghostStart: true, ghostEnd: true };

test('pctFillPaint: zero is no fill at all, on every shape', () => {
  const c = make();
  [solid, startGhost, endGhost, bothGhost, null].forEach(o => {
    assert.equal(c.pctFillPaint(o, 0, '#123456'), null);
    assert.equal(c.pctFillPaint(o, -20, '#123456'), null, 'a negative pct is not a fill');
  });
});

test('pctFillPaint: width is the pct, and the colour is the success token', () => {
  const c = make();
  [0.5, 45, 100].forEach(p => {
    const f = c.pctFillPaint(solid, p, '#123456');
    assert.equal(f.width, p + '%');
    assert.equal(f.background, 'var(--success-strong)');
  });
  assert.equal(c.pctFillPaint(solid, 140, '#123456').width, '100%', 'clamped at the bar edge');
});

test('pctFillPaint: a solid bar carries no mask', () => {
  const c = make();
  const f = c.pctFillPaint(solid, 45, '#123456');
  assert.equal(f.mask, null);
  assert.equal(f.maskSize, null);
});

/* The point of the whole fix: on a ghost the green must dissolve on the SAME ramp as the base beneath it,
   so the two halves of the bar stay distinguishable instead of converging into a white wash. The ramp is
   ghostPaint's, expressed as alpha — these assertions pin the two to the same stop values. */
test('pctFillPaint: a half-ghost masks on ghostPaint\'s own ramp, in the same direction', () => {
  const c = make();
  const hold = c.GHOST_FILL_HOLD, fade = c.GHOST_FILL_FADE;

  const fe = c.pctFillPaint(endGhost, 45, '#123456');
  assert.equal(fe.mask,
    'linear-gradient(to right, #000 0%, #000 ' + hold + '%, transparent ' + fade + '%)');
  assert.ok(c.ghostPaint(endGhost, '#123456').fill.startsWith('linear-gradient(to right,'),
    'base dissolves to the right, so the green must too');

  const fs = c.pctFillPaint(startGhost, 45, '#123456');
  assert.equal(fs.mask,
    'linear-gradient(to left, #000 0%, #000 ' + hold + '%, transparent ' + fade + '%)');
  assert.ok(c.ghostPaint(startGhost, '#123456').fill.startsWith('linear-gradient(to left,'));
});

test('pctFillPaint: a double-ghost gets the symmetric core mask', () => {
  const c = make();
  const f = c.pctFillPaint(bothGhost, 45, '#123456');
  assert.equal(f.mask,
    'linear-gradient(to right, transparent 0%, #000 ' + c.GHOST_BOTH_LO + '%, '
      + '#000 ' + c.GHOST_BOTH_HI + '%, transparent 100%)');
});

/* The mask is authored in BAR percentages but painted on an element only pct% of the bar wide. Without the
   rescale the whole ramp compresses into the filled part and every stop lands on the wrong pixel. */
test('pctFillPaint: maskSize rescales the ramp back to the full bar', () => {
  const c = make();
  assert.equal(c.pctFillPaint(endGhost, 50, '#123456').maskSize, '200% 100%');
  assert.equal(c.pctFillPaint(endGhost, 100, '#123456').maskSize, '100% 100%',
    'a full bar needs no rescale');
  assert.equal(c.pctFillPaint(endGhost, 25, '#123456').maskSize, '400% 100%');
});

test('% Done is an ordinary column: present, placed, hideable, restorable', () => {
  const c = make();
  const def = c.colDefs().find(x => x.k === 'pct');
  assert.ok(def, 'colDefs carries pct');
  assert.equal(def.l, '% Done');
  assert.ok(!def.lock, 'not locked — it can be hidden and reordered like any data column');

  const keys = c.colDefs().map(x => x.k);
  assert.ok(keys.indexOf('pct') > keys.indexOf('planned'), 'after Planned → Allotted');
  assert.ok(keys.indexOf('pct') < keys.indexOf('actions'), 'before Actions');

  assert.ok(c.visibleCols().some(x => x.k === 'pct'), 'visible by default');
  c.setColHidden(['pct'], true);
  assert.ok(!c.visibleCols().some(x => x.k === 'pct'), 'hides');
  assert.ok(c.orderedCols().some(x => x.k === 'pct'), 'still ordered, just hidden');
  c.setColHidden(['pct'], false);
  assert.ok(c.visibleCols().some(x => x.k === 'pct'), 'restores');
});

/* The cell's click/drag is the same pointer-x mapping the Gantt band uses — one path, so the two surfaces
   cannot snap differently. `startPctDrag` is fed a synthetic rect because the mock DOM has no layout. */
test('the cell\'s pointer-x maps to a PCT_STEP-snapped, clamped value', () => {
  const c = make();
  const t = { id: 'a', pct: 0 };
  const el = { getBoundingClientRect: () => ({ left: 100, width: 200 }) };
  c.startPctDrag({ button: 0, clientX: 100, preventDefault(){}, stopPropagation(){} }, t, 0, el, 'set');

  assert.equal(c.pctDrag.mode, 'set', 'the cell resolves a zero-distance press as a value, not a popover');
  assert.equal(c.pctDragValue(100), 0);
  assert.equal(c.pctDragValue(300), 100);
  assert.equal(c.pctDragValue(200), 50);
  assert.equal(c.pctDragValue(0), 0, 'clamped below the left edge');
  assert.equal(c.pctDragValue(9999), 100, 'clamped past the right edge');

  const step = c.PCT_STEP;
  [104, 137, 191, 266].forEach(x => {
    assert.equal(c.pctDragValue(x) % step, 0, 'every value is a multiple of PCT_STEP');
  });
});

test('the Gantt band still resolves a zero-distance press as the popover', () => {
  const c = make();
  const el = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  c.startPctDrag({ button: 0, clientX: 10, preventDefault(){}, stopPropagation(){} }, { id: 'a', pct: 0 }, 0, el);
  assert.equal(c.pctDrag.mode, 'pop', 'unspecified mode keeps the bar\'s existing behaviour');
});
