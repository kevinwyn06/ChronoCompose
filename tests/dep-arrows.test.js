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

// ---------------------------------------------------------------------------
// Owner, 2026-09-09b: "dependency arrows must originate and end from the side of a bar and must extend
// some distance past the bar, even if it needs to bend more times."
//
// The header of this file records the previous session's reading — that the line already "DID start at
// the predecessor's right edge". It did not. `renderArrows` departed from `xOf(occ.end)`, and bars are
// painted by INCLUSIVE day, so that x is the LEFT edge of the bar's final column — a whole day-width
// inside the bar. Since a column is always wider than the 14px stub, the vertical leg turned while still
// on top of the bar it had just left, which is exactly what the report describes. The stub was never the
// problem; the departure pixel was.

test('ganttBarRightX: the departure pixel is the bar trailing edge, not its last column', () => {
  const c = make();
  const DAY = c.DAY;
  const T = c.startOfDay(Date.now());
  c._tl = { start: T, days: 60 };
  c.state = Object.assign({}, c.state, { dayW: 40 });

  // A task Sep 10 → Sep 12 paints three columns: left 0, width 120. Its trailing edge is 120.
  assert.strictEqual(c.ganttBarRightX(false, T, T + 2 * DAY), 120,
    'the day AFTER the last painted one — the same edge ganttDayBarGeometry gives the bar');
  assert.ok(c.ganttBarRightX(false, T, T + 2 * DAY) > c.xOf(T + 2 * DAY),
    'and strictly outside xOf(end), which is where the arrow used to start');
  assert.strictEqual(c.ganttBarRightX(false, T, T + 2 * DAY) - c.xOf(T + 2 * DAY), 40,
    'by exactly one column — the gap an arrow used to spend its whole stub crossing');

  // A one-day bar is one column wide, so its trailing edge is one column out.
  assert.strictEqual(c.ganttBarRightX(false, T, T), 40);

  // An allDay end is already the exclusive next midnight, so the -1 lands it on the same column as the
  // date-only task that displays the same last day.
  assert.strictEqual(c.ganttBarRightX(true, T, T + 3 * DAY), c.ganttBarRightX(false, T, T + 2 * DAY),
    'allDay and date-only bars showing the same last day share a trailing edge');

  // A missing end paints one column from the start, and the arrow leaves that column's far side.
  assert.strictEqual(c.ganttBarRightX(false, T, null), 40);
  assert.strictEqual(c.ganttBarRightX(false, null, null), null, 'nothing to leave from');
});

test('ganttBarRightX agrees with the painted bar at every zoom', () => {
  const c = make();
  const DAY = c.DAY;
  const T = c.startOfDay(Date.now());
  c._tl = { start: T, days: 60 };
  for (const dayW of [3, 42, 720]) {
    c.state = Object.assign({}, c.state, { dayW });
    const geom = c.ganttDayBarGeometry(0, 2, dayW, 0, 60);
    assert.strictEqual(c.ganttBarRightX(false, T, T + 2 * DAY), geom.left + geom.width,
      'arrow departure == bar right edge at zoom ' + dayW);
  }
});

test('a lane offset never walks a turn back inside the bar it belongs to', () => {
  const c = make();
  const stub = c.ARROW_STUB_PX;
  // The backward route, where the lane shifts both x turns. Signed, L=-14 put the approach at tx, past
  // the arrowhead's own x — so the final run went right-to-left and the marker pointed INTO the target.
  for (const L of [-21, -14, -7, 0, 7, 14, 21]) {
    const s = segs(c.arrowPath(400, 10, 150, 60, L, 28));
    assert.strictEqual(kinds(c.arrowPath(400, 10, 150, 60, L, 28)), 'MHVHVH', 'lane ' + L);
    assert.ok(s[1][1] >= 400 + stub,
      'departure stays a full stub clear of the predecessor (lane ' + L + ', got ' + s[1][1] + ')');
    assert.ok(s[3][1] <= 150 - stub,
      'approach stays a full stub clear of the target (lane ' + L + ', got ' + s[3][1] + ')');
    assert.ok(s[5][1] > s[3][1],
      'and the last run points RIGHT, at the target edge (lane ' + L + ')');
  }
});

test('lanes still separate the edges they are there to separate', () => {
  const c = make();
  const xs = [-14, -7, 0, 7, 14].map(L => {
    const s = segs(c.arrowPath(400, 10, 150, 60, L, 28));
    return s[1][1] + ':' + s[3][1];
  });
  assert.strictEqual(new Set(xs).size, xs.length, 'every lane still draws a distinct path: ' + xs);
});
