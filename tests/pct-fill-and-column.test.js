/* Percent complete stays one solid success fill after Chain 6 retires ghost paint. The column half is
   asserted through the ordinary column machinery below. */
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

test('pctFillPaint: zero is no fill at all', () => {
  const c = make();
  assert.equal(c.pctFillPaint(0), null);
  assert.equal(c.pctFillPaint(-20), null, 'a negative pct is not a fill');
});

test('pctFillPaint: width is the pct, and the colour is the success token', () => {
  const c = make();
  [0.5, 45, 100].forEach(p => {
    const f = c.pctFillPaint(p);
    assert.equal(f.width, p + '%');
    assert.equal(f.background, 'var(--success-strong)');
  });
  assert.equal(c.pctFillPaint(140).width, '100%', 'clamped at the bar edge');
});

test('pctFillPaint carries no retired ghost mask fields', () => {
  const c = make();
  assert.deepEqual(c.pctFillPaint(45), {width:'45%', background:'var(--success-strong)'});
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
