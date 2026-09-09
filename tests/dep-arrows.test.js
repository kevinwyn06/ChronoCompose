// Owner reports 2026-09-09 — the three complaints about dependency arrows.
//
//   "Dependency arrows overlap."
//   "No circle in front of a task to drag dependency arrows to."
//   "Arrows start from the middle of a block and point down instead of starting from the side, pointing
//    to the side, then zig zagging."
//
// The third is worth stating precisely, because the old code was not doing what the report says: the line
// DID start at the predecessor's right edge. What made it read as a drop out of the middle was a 13px
// stub — it turned downward before the eye registered a horizontal run at all, right beside the bar it
// came from. The fix is where the vertical leg goes, not where the line begins.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

// A path like "M10,20 H50 V80 H120" → [['M',10,20],['H',50],['V',80],['H',120]]
function segs(d) {
  return (d.match(/[MHV][-\d.,]+/g) || []).map(s => [s[0], ...s.slice(1).split(',').map(Number)]);
}
const kinds = d => segs(d).map(s => s[0]).join('');

test('a forward arrow leaves the side, runs across, then drops and runs in', () => {
  const c = make();
  const d = c.arrowPath(100, 10, 400, 60, 0, 28);
  assert.strictEqual(kinds(d), 'MHVH', 'out along the row, down the corridor, in to the target');
  const s = segs(d);
  assert.strictEqual(s[0][1], 100, 'it starts ON the predecessor edge, not inside the bar');
  assert.strictEqual(s[0][2], 10);
  // The first horizontal run is long enough to be seen as a run. That is the whole report.
  assert.ok(s[1][1] - 100 >= c.ARROW_STUB_PX,
    'the horizontal run out of the bar is at least a stub, got ' + (s[1][1] - 100));
  assert.ok(400 - s[3][1] < c.ARROW_STUB_PX + 8, 'and it arrives at the target edge');
  assert.strictEqual(s[2][1], 60, 'the vertical leg lands on the target row');
});

test('the vertical leg runs down the MIDDLE of the gap, not against the source bar', () => {
  const c = make();
  const s = segs(c.arrowPath(100, 10, 400, 60, 0, 28));
  const mx = s[1][1];
  assert.ok(Math.abs(mx - 250) < 1, 'the corridor is the midpoint of the gap, got ' + mx);
});

test('two bars on the same row are joined by one straight line', () => {
  const c = make();
  const d = c.arrowPath(100, 30, 400, 30, 0, 28);
  assert.strictEqual(kinds(d), 'MH', 'no corners where none are needed');
});

// The target starting at or before the predecessor's end has no gap to run down, so the route has to
// leave right and double back. The corner count is what makes this readable as a detour.
test('a backward arrow leaves right, crosses between the rows, and comes back', () => {
  const c = make();
  const d = c.arrowPath(400, 10, 150, 60, 0, 28);
  assert.strictEqual(kinds(d), 'MHVHVH');
  const s = segs(d);
  assert.ok(s[1][1] > 400, 'it still leaves through the predecessor’s right edge');
  assert.ok(s[2][1] > 10 && s[2][1] < 60, 'and crosses in the channel between the two rows');
});

// ---------------------------------------------------------------------------
// Overlap.
// ---------------------------------------------------------------------------
test('edges sharing a corridor are given separate lanes', () => {
  const c = make();
  const lanes = c.arrowLanes([
    { key: 'a', sx: 100, tx: 400 },
    { key: 'b', sx: 100, tx: 400 },
    { key: 'c', sx: 100, tx: 400 },
  ]);
  const xs = ['a', 'b', 'c'].map(k => c.arrowCorridorX(100, 400, lanes[k]));
  assert.strictEqual(new Set(xs).size, 3, 'three edges, three corridors: ' + xs.join(','));
  xs.forEach((x, i) => xs.forEach((y, j) => { if (i !== j)
    assert.ok(Math.abs(x - y) >= c.ARROW_LANE_PX - 0.001, 'lanes are at least a lane apart'); }));
});

test('lanes spread both ways, so a busy chart stays centred', () => {
  const c = make();
  const lanes = c.arrowLanes([{ key: 'a', sx: 0, tx: 300 }, { key: 'b', sx: 0, tx: 300 },
    { key: 'c', sx: 0, tx: 300 }]);
  const offs = ['a', 'b', 'c'].map(k => lanes[k]);
  assert.strictEqual(offs[0], 0, 'the first edge keeps the true corridor');
  assert.ok(offs.some(o => o > 0) && offs.some(o => o < 0), 'the rest alternate: ' + offs.join(','));
});

test('edges in different corridors are not pushed apart for nothing', () => {
  const c = make();
  const lanes = c.arrowLanes([{ key: 'a', sx: 0, tx: 200 }, { key: 'b', sx: 600, tx: 900 }]);
  assert.strictEqual(lanes.a, 0);
  assert.strictEqual(lanes.b, 0, 'a distant edge shares nothing and is left alone');
});

test('a corridor is never pushed outside the gap it belongs to', () => {
  const c = make();
  // A narrow gap with a big lane offset: clamping keeps the stub on both ends.
  const x = c.arrowCorridorX(100, 160, 40);
  assert.ok(x >= 100 + c.ARROW_STUB_PX && x <= 160 - c.ARROW_STUB_PX, 'clamped into the gap, got ' + x);
});

test('several edges leaving one bar fan out instead of stacking on one pixel', () => {
  const c = make();
  const offs = c.arrowFanOffsets(3);
  assert.strictEqual(offs.length, 3);
  assert.strictEqual(new Set(offs).size, 3, 'three distinct departure heights');
  assert.strictEqual(offs.reduce((a, b) => a + b, 0), 0, 'centred on the bar, not drifting off it');
  assert.strictEqual(c.arrowFanOffsets(1)[0], 0, 'a lone edge leaves dead centre');
});

test('the fan stays inside a bar height', () => {
  const c = make();
  const offs = c.arrowFanOffsets(4);
  const span = Math.max(...offs) - Math.min(...offs);
  assert.ok(span <= c.barH, 'the spread fits on the bar it leaves from, got ' + span);
});

// ---------------------------------------------------------------------------
// The circle in front of a task.
// ---------------------------------------------------------------------------
test('a leading drag writes the edge the other way round', () => {
  const c = make();
  c.state.tasks = [
    c.normalizeTask({ id: 'a', name: 'a', deps: [], pct: 0 }),
    c.normalizeTask({ id: 'b', name: 'b', deps: [], pct: 0 }),
  ];
  // Dragging from B's LEADING dot onto A means "A comes first", so the edge lands on B.
  c.linkState = { fromId: 'b', fromOcc: null, dir: 'pred', x: 0, y: 0 };
  c.tryAddDep('a', null, 'b');
  // join(): the component runs in a vm realm, so its arrays fail deepStrictEqual's prototype check.
  assert.strictEqual(c.state.tasks[1].deps.map(d => c.depId(d)).join(','), 'a');
  assert.strictEqual(c.state.tasks[0].deps.length, 0, 'and never on the task that comes first');
});

test('startLink records which end the drag is fixed at', () => {
  const c = make();
  c.bodyEl = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const t = c.normalizeTask({ id: 'a', name: 'a', deps: [], pct: 0 });
  const ev = { button: 0, clientX: 5, clientY: 5, preventDefault() {}, stopPropagation() {} };
  c.startLink(ev, t, 0, 'pred');
  assert.strictEqual(c.linkState.dir, 'pred');
  c.startLink(ev, t, 0);
  assert.strictEqual(c.linkState.dir, 'succ', 'the historic direction is the default');
});
