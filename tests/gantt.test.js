// Gantt ergonomics: continuous day zoom clamp, bar-draw width floor, and the
// dependency-driven scheduling invariant (finish-to-start, forward-only) that the docs describe.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

// ---- continuous day zoom bounds ----
test('clampDayW keeps the zoom within [GANTT_DAYW_MIN, GANTT_DAYW_MAX]', () => {
  const c = make();
  assert.strictEqual(c.clampDayW(1), c.GANTT_DAYW_MIN);      // below floor
  assert.strictEqual(c.clampDayW(99999), c.GANTT_DAYW_MAX);  // above cap
  assert.strictEqual(c.clampDayW(300), 300);                 // in range — past the old 120 cap
  assert.ok(c.GANTT_DAYW_MAX > 120, 'wide day columns remain reachable without changing granularity');
});

// ---- C1: bar-draw width (a zero/negative span must never render as a zero-length point) ----
test('effBarEnd: a zero/negative span draws one full day; a real span draws itself', () => {
  const c = make();
  const st = Date.now();
  assert.strictEqual(c.effBarEnd(st, st), st + DAY);          // zero span → one day wide
  assert.strictEqual(c.effBarEnd(st, st - 1000), st + DAY);   // inverted → one day wide
  assert.strictEqual(c.effBarEnd(st, st + 3 * DAY), st + 3 * DAY); // real forward span unchanged
});

// ---- Chain 6 block 43: day-only Gantt geometry ----
test('ganttDayBarGeometry renders inclusive whole-day spans independent of clock time', () => {
  const c = make();
  assert.strictEqual(JSON.stringify(c.ganttDayBarGeometry(4, 4, 42, 0, 20)),
    JSON.stringify({ left: 168, width: 42, first: 4, last: 4 }));
  assert.strictEqual(JSON.stringify(c.ganttDayBarGeometry(4, 6, 42, 0, 20)),
    JSON.stringify({ left: 168, width: 126, first: 4, last: 6 }));
});

test('ganttDayBarGeometry clamps open edges to each virtual window at every zoom and scroll', () => {
  const c = make();
  for (const dayW of [3, 42, 720]) {
    assert.strictEqual(JSON.stringify(c.ganttDayBarGeometry(5, null, dayW, 0, 12)),
      JSON.stringify({ left: 5 * dayW, width: 7 * dayW, first: 5, last: 11 }), 'start-only at zoom ' + dayW);
    assert.strictEqual(JSON.stringify(c.ganttDayBarGeometry(5, null, dayW, 8, 16)),
      JSON.stringify({ left: 8 * dayW, width: 8 * dayW, first: 8, last: 15 }), 'start-only after scroll at zoom ' + dayW);
    assert.strictEqual(JSON.stringify(c.ganttDayBarGeometry(null, 11, dayW, 8, 16)),
      JSON.stringify({ left: 8 * dayW, width: 4 * dayW, first: 8, last: 11 }), 'end-only after scroll at zoom ' + dayW);
  }
  assert.strictEqual(c.ganttDayBarGeometry(null, null, 42, 0, 12), null,
    'fully dateless tasks leave the Gantt row empty');
  assert.strictEqual(c.ganttDayBarGeometry(20, null, 42, 0, 12), null,
    'a future start-only task does not paint before its committed edge');
  assert.strictEqual(c.ganttDayBarGeometry(null, 3, 42, 8, 16), null,
    'a past end-only task does not paint after its committed edge');
});

// ---- Chain 6 block 44: recurring occurrences merge by consecutive calendar day ----
test('mergeConsecutiveOccurrenceDays turns a daily series into one continuous run without mutating input', () => {
  const c = make();
  const base = new Date(2026, 7, 17, 9, 0, 0, 0).getTime();
  const occs = Array.from({ length: 7 }, (_, idx) => ({
    idx, start: base + idx * DAY, end: base + idx * DAY + 60 * 60 * 1000, occ: true,
  }));
  const before = JSON.stringify(occs);
  const runs = c.mergeConsecutiveOccurrenceDays(occs);

  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].idx, 0, 'the run retains the first occurrence identity for compatibility');
  assert.deepStrictEqual(Array.from(runs[0].runOccIdxs), [0, 1, 2, 3, 4, 5, 6],
    'the projection carries explicit membership instead of pretending the run is occurrence zero');
  assert.strictEqual(runs[0].runFirstStart, occs[0].start);
  assert.strictEqual(runs[0].runFirstEnd, occs[0].end);
  assert.strictEqual(runs[0].runLastStart, occs[6].start);
  assert.strictEqual(runs[0].runLastEnd, occs[6].end);
  assert.strictEqual(runs[0].start, occs[0].start);
  assert.strictEqual(runs[0].end, occs[6].end);
  assert.strictEqual(JSON.stringify(occs), before, 'the pure merge leaves its input untouched');
});

test('mergeConsecutiveOccurrenceDays keeps weekday runs apart across weekend gaps', () => {
  const c = make();
  const monday = new Date(2026, 7, 17, 9, 0, 0, 0).getTime();
  const offsets = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
  const occs = offsets.map((offset, idx) => ({
    idx, start: monday + offset * DAY, end: monday + offset * DAY + 60 * 60 * 1000, occ: true,
  }));
  const runs = c.mergeConsecutiveOccurrenceDays(occs);

  assert.strictEqual(runs.length, 2);
  assert.strictEqual(JSON.stringify(runs.map(r => [r.start, r.end])), JSON.stringify([
    [occs[0].start, occs[4].end],
    [occs[5].start, occs[9].end],
  ]));
});

test('mergeConsecutiveOccurrenceDays leaves weekly occurrences as separate blocks', () => {
  const c = make();
  const monday = new Date(2026, 7, 17, 9, 0, 0, 0).getTime();
  const occs = [0, 7, 14].map((offset, idx) => ({
    idx, start: monday + offset * DAY, end: monday + offset * DAY + 60 * 60 * 1000, occ: true,
  }));
  const runs = c.mergeConsecutiveOccurrenceDays(occs);

  assert.strictEqual(runs.length, 3);
  assert.strictEqual(JSON.stringify(runs.map(r => [r.start, r.end])),
    JSON.stringify(occs.map(o => [o.start, o.end])));
});

test('mergeConsecutiveOccurrenceDays treats local dates across a DST boundary as consecutive', () => {
  const c = make();
  const beforeFallback = new Date('2026-11-01T09:00:00-07:00').getTime();
  const afterFallback = new Date('2026-11-02T09:00:00-08:00').getTime();
  assert.strictEqual(afterFallback-beforeFallback, 25*60*60*1000, 'fixture crosses the fallback hour');
  const occs = [
    { idx: 0, start: beforeFallback, end: beforeFallback + 60 * 60 * 1000, occ: true },
    { idx: 1, start: afterFallback, end: afterFallback + 60 * 60 * 1000, occ: true },
  ];
  const runs = c.mergeConsecutiveOccurrenceDays(occs);

  assert.strictEqual(runs.length, 1, 'calendar adjacency does not depend on a fixed 24-hour delta');
  assert.strictEqual(runs[0].end, occs[1].end);
});

test('consecutive recurrence rendering replaces the dense hatched-strip helpers', () => {
  const c = make();
  assert.strictEqual(typeof c.recurTooDense, 'undefined');
  assert.strictEqual(typeof c.ganttRecurStrip, 'undefined');
});

// ---- C4: dependency-driven scheduling (verify the documented behaviour) ----
test('autoSchedule drives dependents finish-to-start, forward-only', () => {
  const c = make();
  const B = Date.now();
  const mk = (id, s, e, deps) => c.normalizeTask({ id, name: id, type: 'Proportional',
    start: s, end: e, priority: 4, deps: deps || [], pct: 0, planned: 60 });

  // B depends on A; A ends AFTER B starts → B is pushed so it starts no earlier than A.end (duration kept).
  const tasks = [mk('A', B, B + 2 * DAY), mk('B', B, B + DAY, ['A'])];
  c.autoSchedule(tasks);
  assert.strictEqual(tasks[1].start, B + 2 * DAY, 'successor starts at predecessor end');
  assert.strictEqual(tasks[1].end, B + 3 * DAY, 'successor duration preserved');

  // A predecessor moved EARLIER must NOT drag a later successor back — banked slack survives (forward-only).
  const t2 = [mk('A', B - 5 * DAY, B - 3 * DAY), mk('B', B + 10 * DAY, B + 11 * DAY, ['A'])];
  c.autoSchedule(t2);
  assert.strictEqual(t2[1].start, B + 10 * DAY, 'earlier predecessor never pulls the successor back');
});

// ---- V1.5 (owner 2026-07-26): bar hover-state + hit targets ----
// The dependency drag was unstartable: the link dot's pointerEvents/opacity are gated on
// state.hoverId, but hoverId was only ever set by the ROW STRIPE's onMouseEnter. Bars (and their
// satellite handles) are SIBLINGS of that stripe, so landing on one fired the stripe's mouseleave →
// hoverId:null → the dot switched itself off under the cursor. Measured in-browser before the fix:
// cursor on the row background ⇒ hoverId 't1', dot pointerEvents 'auto'; cursor on the dot itself ⇒
// hoverId null, dot pointerEvents 'none'. So the bar itself must own a hover state too.
const B0 = Date.UTC(2026, 6, 1);
function ganttReady(){
  const c = make();
  c._tl = { start: B0, days: 60 };
  c.state.dayW = 42;
  c._cpm = { critical: {} };
  c._showCP = false;
  c._accent = '#3b82f6';
  return c;
}
const mkTask = (c, over) => c.normalizeTask(Object.assign({
  id: 'g1', name: 'g1', type: 'Proportional', start: B0, end: B0 + 3 * DAY,
  priority: 4, deps: [], pct: 20, planned: 120,
}, over || {}));
const occOf = t => ({ idx: 0, start: t.start, end: t.end, ghost: false });
// Walk a shim element tree (see _load.js React shim) and collect every node passing `pred`.
function findAll(node, pred, out){
  out = out || [];
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  findAll(node.children || [], pred, out);
  return out;
}
const styleOf = n => (n.props && n.props.style) || {};
const px = v => parseFloat(String(v || 0));

test('clocked and all-day tasks on the same date render with identical bar geometry', () => {
  const c = ganttReady();
  const localBase = new Date(2026, 6, 1).getTime();
  c._tl = { start: localBase, days: 60 };
  c._vwin = { d0: 0, d1: 20 };
  const clocked = mkTask(c, { id: 'clocked', start: localBase + 14 * 3600000, end: localBase + 15 * 3600000 });
  const allDay = mkTask(c, { id: 'all-day', start: localBase, end: localBase + DAY, allDay: true });
  const a = styleOf(c.ganttBlock(clocked, 0, occOf(clocked)));
  const b = styleOf(c.ganttBlock(allDay, 0, occOf(allDay)));
  assert.strictEqual(a.left, b.left);
  assert.strictEqual(a.width, b.width);
});

test('a start-only rendered bar reclamps when the virtual window scrolls', () => {
  const c = ganttReady();
  const localBase = new Date(2026, 6, 1).getTime();
  c._tl = { start: localBase, days: 60 };
  const t = mkTask(c, { id: 'open-right', start: localBase + 5 * DAY, end: null });
  const o = { idx: 0, start: t.start, end: t.start + DAY, ghost: true, ghostStart: false, ghostEnd: true };
  c._vwin = { d0: 0, d1: 12 };
  const before = styleOf(c.ganttBlock(t, 0, o));
  c._vwin = { d0: 8, d1: 16 };
  const after = styleOf(c.ganttBlock(t, 0, o));
  assert.strictEqual(before.left, (5 * c.state.dayW) + 'px');
  assert.strictEqual(before.width, (7 * c.state.dayW) + 'px');
  assert.strictEqual(after.left, (8 * c.state.dayW) + 'px');
  assert.strictEqual(after.width, (8 * c.state.dayW) + 'px');
});

test('a Gantt bar owns its own hover state (the row stripe alone cannot keep hoverId set)', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  assert.strictEqual(typeof bar.props.onMouseEnter, 'function', 'bar sets hoverId on enter');
  assert.strictEqual(typeof bar.props.onMouseLeave, 'function', 'bar clears hoverId on leave');
  bar.props.onMouseEnter();
  assert.strictEqual(c.state.hoverId, t.id, 'entering the bar hovers its task');
  bar.props.onMouseLeave();
  assert.strictEqual(c.state.hoverId, null, 'leaving the bar clears it');

  // The same defect hit the milestone diamond.
  const ms = mkTask(c, { id: 'g2', type: 'Milestone' });
  assert.strictEqual(typeof c.ganttBlock(ms, 0, occOf(ms)).props.onMouseEnter, 'function',
    'milestone diamond hovers its row too');
});

// Owner tenet (2026-07-26): "all the clickboxes are all too tiny. Humans do not have machine
// precision." Every handle carries a transparent hit box of at least HIT_MIN_PX in the axis that
// matters, with the small glyph drawn inside it.
// Owner report 2026-09-09: *"No circle in front of a task to drag dependency arrows to."* There are TWO
// dots now — trailing ("comes after") and leading ("comes before") — and the C3 rule applies to both: the
// hit box sits fully OUTSIDE its edge, clear of that side's 7px resize grip, with the small circle drawn
// inside it. The 2026-07-26 note that "there is exactly one link handle" is superseded; the objection it
// recorded (a circle drawn INSIDE the bar) is honoured by this one being outside, exactly like its twin.
test('both link dots carry a HIT_MIN_PX hit box that clears their resize grip', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  const out = findAll(bar, n => n.props && /comes AFTER this one/.test(n.props.title || ''))[0];
  const inn = findAll(bar, n => n.props && /come BEFORE this one/.test(n.props.title || ''))[0];
  assert.ok(out, 'the trailing link dot exists');
  assert.ok(inn, 'the leading link dot exists');
  [out, inn].forEach(dot => {
    const s = styleOf(dot);
    assert.ok(px(s.width) >= c.HIT_MIN_PX, 'hit box is at least HIT_MIN_PX wide, got ' + s.width);
    assert.ok(px(s.height) >= c.HIT_MIN_PX, 'hit box is at least HIT_MIN_PX tall, got ' + s.height);
    assert.ok(findAll(dot, n => /50%/.test(String(styleOf(n).borderRadius || ''))).length,
      'the visible circle is drawn inside the hit box, not enlarged');
  });
  // Overlapping either grip is the C3 regression. UI revamp block 7 gave each grip a BAR_GRIP_OUT_PX
  // extension outside the bar, so each dot box now starts past that extension rather than at the edge.
  const off = 'calc(100% + ' + c.BAR_GRIP_OUT_PX + 'px)';
  assert.strictEqual(styleOf(out).left, off, 'trailing box starts past the right grip extension');
  assert.strictEqual(styleOf(inn).right, off, 'leading box starts past the left grip extension');
  // …and the boxes render at HIT_MIN_PX under the 0.8 shell (GANTT_HIT_PX local px).
  assert.ok(px(styleOf(out).width) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'rendered dot box ≥ HIT_MIN_PX');
});

// The %-done control has TWO targets as of the owner's 2026-08-15 instruction ("I would actually prefer
// to click and click drag directly on the bar"). The band ON the bar is primary; the caret BELOW the bar
// survives as the secondary/narrow-bar fallback. Both start the same `startPctDrag`, so both are found by
// the same `% done` title — this pair of tests keeps them straight by position.
const pctNodes = (c, bar) => findAll(bar, n => n.props && /^% done/.test(n.props.title || ''));

test('the primary %-done target is a band ON the bar, centred on the fill edge (owner 2026-08-15)', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  const band = pctNodes(c, bar).filter(n => px(styleOf(n).top) === 0)[0];
  assert.ok(band, 'the on-bar %-done band exists');
  const s = styleOf(band);
  assert.strictEqual(px(s.height), c.barH, 'the band is the full height of the bar, not a sliver');
  assert.strictEqual(px(s.width), c.PCT_GRAB_PX * 2, 'the band is 2×PCT_GRAB_PX wide');
  // It must sit UNDER the resize grips in stacking order, so a geometry bug can never cost the bar its
  // resize handles — defence in depth behind pctGrabZone's own clearance rule.
  assert.ok(Number(s.zIndex) < 3, 'the band stacks below the grips at zIndex 3, got ' + s.zIndex);
  assert.strictEqual(s.cursor, 'ew-resize', 'the cursor is the affordance distinguishing it from the bar body');
  // Not hover-gated: unlike the caret it is ON the bar's own drag surface, so hiding it would only hide
  // it from the person hunting for it — which is the whole defect being fixed.
  assert.strictEqual(s.pointerEvents, 'auto', 'the band is always hit-testable, not hover-gated');
});

test('the %-done caret survives BELOW the bar as the secondary target (owner 2026-07-26)', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  const pctH = pctNodes(c, bar).filter(n => px(styleOf(n).top) >= c.barH)[0];
  assert.ok(pctH, '%-done caret exists');
  const s = styleOf(pctH);
  assert.ok(/px$/.test(String(s.top)), 'caret top is an absolute offset, not a %-of-bar, got ' + s.top);
  assert.ok(px(s.top) >= c.barH, 'caret top is at/below the bar bottom, got top=' + s.top);
  assert.ok(!/translateY/.test(String(s.transform || '')), 'caret is not re-centred back onto the bar');
  assert.ok(px(s.width) >= c.HIT_MIN_PX, 'caret is at least HIT_MIN_PX wide, got ' + s.width);
  // …and it must not reach into the row below: the bar is centred, so the budget under it is
  // (rowH - barH)/2 plus the row gap the next stripe can spare.
  assert.ok(px(s.top) + px(s.height) <= c.barH + (c.rowH - c.barH) / 2 + 6,
    'caret stays within the row (≤6px into the next stripe), got bottom=' + (px(s.top) + px(s.height)));
});

// The owner's one hard constraint on the band, verbatim: "if you have the grab at ±n, make sure 0% and
// 100% have no drag range overlap with the edges of the bar for date dragging." `pctGrabZone` is pure, so
// the extremes are provable here rather than by eye on a chart.
test('pctGrabZone never overlaps either resize grip, at any percentage', () => {
  const c = make();
  const w = 200;
  for (let pct = 0; pct <= 100; pct += 5) {
    const z = c.pctGrabZone(w, pct);
    assert.ok(z, 'a 200px bar can afford a band at ' + pct + '%');
    assert.ok(z.left >= c.BAR_GRIP_PX, 'band clears the LEFT grip at ' + pct + '%, got left=' + z.left);
    assert.ok(z.left + z.width <= w - c.BAR_GRIP_PX,
      'band clears the RIGHT grip at ' + pct + '%, got right=' + (z.left + z.width));
    // Shifted, never shrunk: a clipped band would degrade to a sliver at exactly the two most common
    // values, which is the failure mode this change exists to remove.
    assert.strictEqual(z.width, c.PCT_GRAB_PX * 2, 'band keeps its full width at ' + pct + '%');
  }
});

test('pctGrabZone yields no band at all when the bar cannot hold one clear of both grips', () => {
  const c = make();
  const tooNarrow = c.BAR_GRIP_PX * 2 + c.PCT_GRAB_PX * 2 - 1;
  assert.strictEqual(c.pctGrabZone(tooNarrow, 50), null, 'no partial band on a bar that cannot fit one');
  assert.ok(c.pctGrabZone(tooNarrow + 1, 50), 'exactly one px more is enough');
  // The caret below the bar is the fallback there, which is why it was kept rather than deleted.
});

test('the band reports the true fill edge as `centre`, even when it has been shifted clear of a grip', () => {
  const c = make();
  const w = 200;
  assert.strictEqual(c.pctGrabZone(w, 0).centre, 0, 'centre is the fill edge (0%), not the shifted band centre');
  assert.strictEqual(c.pctGrabZone(w, 100).centre, w, 'centre is the fill edge (100%)');
  assert.strictEqual(c.pctGrabZone(w, 50).centre, 100, 'centre is the fill edge (50%)');
  // At 0% the band has been pushed right off the grip, so its own midpoint is NOT the fill edge — which
  // is exactly why the seam is positioned from `centre` rather than from the band.
  const z = c.pctGrabZone(w, 0);
  assert.notStrictEqual(z.left + z.width / 2, z.centre, 'the shifted band midpoint is not the fill edge');
});

// ---- V4.4: the day-drawer zoom is a two-level toggle, not a range ----
// The Track B Group 2 control stepped `_drawerZoom` by DRAWER_ZOOM_STEP between DRAWER_ZOOM_MIN and
// DRAWER_ZOOM_MAX. The owner asked (2026-07-22) for two states instead: fit ⇄ expanded. These tests
// hold the collapse itself — that the range constants are GONE, not merely unused — plus the pure
// mapping `renderDayColumn`, the toggle button and `toggleDrawerZoom` all share.
test('V4.4: the incremental drawer-zoom range collapsed to two named levels', () => {
  const c = make();
  assert.strictEqual(c.DRAWER_ZOOM_MIN, undefined, 'DRAWER_ZOOM_MIN is retired, not kept as a synonym');
  assert.strictEqual(c.DRAWER_ZOOM_MAX, undefined, 'DRAWER_ZOOM_MAX is retired');
  assert.strictEqual(c.DRAWER_ZOOM_STEP, undefined, 'DRAWER_ZOOM_STEP is retired — nothing steps any more');
  assert.strictEqual(c.DRAWER_ZOOM_FIT, 1, 'the fit level must be exactly 1 — it is the no-op multiplier');
  assert.ok(c.DRAWER_ZOOM_EXPANDED > 1, 'the expanded level is taller than fit');
});

test('V4.4: drawerZoomFactor/drawerZoomIsExpanded are a two-state pair with no third value', () => {
  const c = make();
  assert.strictEqual(c.drawerZoomFactor(false), c.DRAWER_ZOOM_FIT);
  assert.strictEqual(c.drawerZoomFactor(true), c.DRAWER_ZOOM_EXPANDED);
  // Round-trip both ways: the two helpers cannot disagree about what a level means.
  assert.strictEqual(c.drawerZoomIsExpanded(c.drawerZoomFactor(true)), true);
  assert.strictEqual(c.drawerZoomIsExpanded(c.drawerZoomFactor(false)), false);
  // Every value the RETIRED control could produce now reads as fit rather than as "some zoom" — this
  // is what stops a stale intermediate level surviving anywhere as a third rendered scale.
  for (const stale of [1.5, 2.25, 3.375, 8, 0, -1, null, undefined, NaN, '3']) {
    assert.strictEqual(c.drawerZoomIsExpanded(stale), false, 'stale level reads as fit: ' + String(stale));
    assert.strictEqual(c.drawerZoomFactor(c.drawerZoomIsExpanded(stale)), c.DRAWER_ZOOM_FIT,
      'and snaps to the fit factor: ' + String(stale));
  }
});

test('V4.4: toggleDrawerZoom flips between exactly the two levels and stays session-only', () => {
  const c = make();
  assert.strictEqual(c._drawerZoom, undefined, 'a fresh session starts unset, i.e. fitted');
  c.toggleDrawerZoom();
  assert.strictEqual(c._drawerZoom, c.DRAWER_ZOOM_EXPANDED, 'first press expands');
  c.toggleDrawerZoom();
  assert.strictEqual(c._drawerZoom, c.DRAWER_ZOOM_FIT, 'second press fits — it is a toggle, not a ratchet');
  c.toggleDrawerZoom();
  assert.strictEqual(c._drawerZoom, c.DRAWER_ZOOM_EXPANDED, 'and it keeps alternating');
  // Owner decision 2026-07-22: NOT persisted. It is an instance field, never React state and never a
  // `pp-*` key, so a reload is fit-to-height again.
  assert.ok(!('drawerZoom' in c.state), 'the level is not React state');
  assert.ok(!('drawerZoom' in (c.state.prefs || {})), 'and not a persisted pref');
});

// ---- Gantt bars carry their names again (UI revamp block 7, 2026-10-04) ----
// History: V5.27b drew every bar's task name; the owner removed it on 2026-08-12 because a DAILY repeat
// drew one label per occurrence and rows of recurring work became stacked text ("the name completely
// overwhelms the interface"). Both causes are gone now: Chain 6 block 44 merges consecutive occurrence
// days into one run, and `renderGantt` names only the FIRST painted run of a repeat (`lab.show`). The
// audit (finding 11: "bars are anonymous and linked to nothing") brought the label back on that basis.
// This test pins the new contract, and the density half lives in tests/ui-revamp-gantt.test.js.
const textOf = n => {
  if (n == null || n === false) return '';
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (typeof n !== 'object') return String(n);
  return textOf(n.children || []);
};
const labelNodes = root => findAll(root, n => n.props && n.props['data-gantt-label'] != null);
const tipsOf = root => findAll(root, n => n.props && n.props['data-gantt-tip']).map(n => n.props['data-gantt-tip']);

test('every Gantt shape names its task — inside, beside, or (for a later repeat run) only in its tooltip', () => {
  const c = ganttReady();

  // A wide bar: the name fits inside.
  const wide = mkTask(c, { name: 'Quarterly board deck', end: B0 + 6 * DAY });
  // A one-day bar: the name does not fit inside, so it goes beside the bar.
  const narrow = mkTask(c, { id: 'n1', name: 'Renew passport', end: B0 + DAY });
  const ms = mkTask(c, { id: 'm1', name: 'Launch', type: 'Milestone' });
  const rt = mkTask(c, { id: 'r1', name: 'Standup', recur: { kind: 'day', n: 1, label: 'Daily' } });
  const run = c.mergeConsecutiveOccurrenceDays(
    [occOf(rt), { idx: 1, start: rt.start + DAY, end: rt.start + DAY + c.recurDurMs(rt) }])[0];

  const shapes = [
    ['wide bar', c.ganttBlock(wide, 0, occOf(wide)), 'Quarterly board deck', 'inside'],
    ['narrow bar', c.ganttBlock(narrow, 0, occOf(narrow)), 'Renew passport', 'outside'],
    ['milestone', c.ganttBlock(ms, 0, occOf(ms)), 'Launch', 'outside'],
    ['first repeat run', c.ganttBlock(rt, 0, run, { show: true, nextX: null }), 'Standup', 'inside'],
    ['later repeat run', c.ganttBlock(rt, 0, run, { show: false, nextX: null }), 'Standup', null],
  ];
  for (const [what, node, name, mode] of shapes) {
    const labs = labelNodes(node);
    if (mode) {
      assert.strictEqual(labs.length, 1, what + ' draws exactly one name label');
      assert.strictEqual(labs[0].props['data-gantt-label'], mode, what + ' puts its name ' + mode);
      assert.ok(textOf(node).includes(name), what + ' renders the name as text');
    } else {
      assert.strictEqual(labs.length, 0, what + ' draws no label — one label per repeat row');
      assert.ok(!textOf(node).includes(name), what + ' does not repeat the name');
    }
    // The machine-readable tooltip still names it, so specs and screen readers lose nothing.
    assert.ok(tipsOf(node).some(ti => String(ti).startsWith(name)), what + ' carries data-gantt-tip');
    // The native `title` is retired from the bar itself — it doubled the drawn tooltip.
    assert.ok(!findAll(node, n => n.props && n.props['data-gantt-tip'] && n.props.title).length,
      what + ' carries no native title next to data-gantt-tip');
  }
  assert.ok(!textOf(shapes[3][1]).includes('Daily'), 'a merged recurrence run is a plain bar with no hatch label');

  // The V1.5 hover contract and the drag must survive.
  const dia = shapes[2][1];
  assert.strictEqual(typeof dia.props.onMouseEnter, 'function', 'milestone still owns its hover state');
  assert.strictEqual(typeof dia.props.onMouseDown, 'function', 'and is still draggable');
});

// Owner, 2026-08-15: "Make % complete overlaid in small text in the bar." The readout used to live in
// `ganttSideRow`, OUTSIDE the bar to its right; that helper had no other children and was deleted with it.
test('the %-done readout is overlaid INSIDE the bar, and the side row is gone (owner 2026-08-15)', () => {
  const c = ganttReady();
  const t = mkTask(c, { name: 'Half done', pct: 50 });
  const bar = c.ganttBlock(t, 0, occOf(t));

  assert.strictEqual(typeof c.ganttSideRow, 'undefined',
    'ganttSideRow is deleted, not merely unused — a dead helper invites a second readout');

  const lbl = findAll(bar, n => n.props && n.props['data-pct-label'] != null)[0];
  assert.ok(lbl, 'the in-bar %-done readout renders');
  assert.strictEqual(lbl.props['data-pct-label'], '50', 'and reports the task percentage');
  assert.ok(textOf(lbl).includes('50%'), 'as visible text, not attribute-only');
  const s = styleOf(lbl);
  // Inside the bar means positioned within it, not offset past its right edge the way the side row was.
  assert.ok(px(s.right) >= 0 && px(s.right) < c.BAR_MIN_PX, 'anchored inside the bar, got right=' + s.right);
  // UI revamp block 11a: small, but at the caption floor of the type scale (13 CSS px → 10.4 rendered), not under it.
  assert.strictEqual(px(s.fontSize), 13, 'caption-size text, got ' + s.fontSize);
  // It must never eat the grab band underneath it — the band is the whole point of this change.
  assert.strictEqual(s.pointerEvents, 'none', 'the readout never takes pointer events');
});

test('a bar too narrow for the readout drops it rather than clipping it', () => {
  const c = ganttReady();
  const t = mkTask(c, { name: 'Tiny', pct: 50 });
  const occ = occOf(t);
  // Collapse the span so the drawn width falls under PCT_LABEL_MIN_W.
  const bar = c.ganttBlock(t, 0, Object.assign({}, occ, { end: occ.start }));
  const lbl = findAll(bar, n => n.props && n.props['data-pct-label'] != null)[0];
  assert.ok(!lbl, 'no readout on a bar narrower than PCT_LABEL_MIN_W');
});

test('a 0% bar carries no readout at all — "0%" on every untouched bar is noise', () => {
  const c = ganttReady();
  const t = mkTask(c, { name: 'Not started', pct: 0 });
  const bar = c.ganttBlock(t, 0, occOf(t));
  assert.ok(!findAll(bar, n => n.props && n.props['data-pct-label'] != null)[0], 'no readout at 0%');
});

// ---------------------------------------------------------------------------------------------------
// Owner, 2026-08-15: "No haptic feedback from dragging a block on a recurring block: show just that
// block getting dragged." The preview was already written and already occurrence-scoped — it read
// `dragState.deltaSteps`, a field NOTHING in the file ever assigned, so it evaluated to a constant 0 and
// a recurring bar never moved until the scope prompt resolved on release. These tests pin the live
// preview by POSITION, so a rename that breaks the wiring again cannot pass.
// ---------------------------------------------------------------------------------------------------
function recurFixture(c) {
  const t = mkTask(c, { id: 'r1', recur: { kind: 'day', n: 1, label: 'Daily' } });
  const occs = [
    { idx: 0, start: B0, end: B0 + DAY, ghost: false },
    { idx: 1, start: B0 + 3 * DAY, end: B0 + 4 * DAY, ghost: false },
  ];
  return { t, occs };
}
const leftOf = bar => px(styleOf(bar).left);

test('dragging one occurrence of a recurring task previews THAT occurrence moving', () => {
  const c = ganttReady();
  const { t, occs } = recurFixture(c);
  const restLeft = leftOf(c.ganttBlock(t, 0, occs[0]));

  c.dragState = { id: 'r1', occIdx: 0, mode: 'move', recurring: true, deltaMs: 2 * DAY };
  const dragged = leftOf(c.ganttBlock(t, 0, occs[0]));
  assert.ok(dragged > restLeft, 'the dragged occurrence moves during the gesture, got ' + dragged + ' vs ' + restLeft);
  // Two days at the fixture's dayW — the shift is the snapped delta itself, not a multiple of it. The
  // dead field was multiplied by DAY; doing that to a millisecond delta flings the bar off the chart.
  assert.strictEqual(dragged - restLeft, 2 * c.state.dayW, 'it moves by exactly the snapped delta');
});

test('its SIBLING occurrences hold still — "just that block"', () => {
  const c = ganttReady();
  const { t, occs } = recurFixture(c);
  const siblingAtRest = leftOf(c.ganttBlock(t, 0, occs[1]));
  c.dragState = { id: 'r1', occIdx: 0, mode: 'move', recurring: true, deltaMs: 2 * DAY };
  assert.strictEqual(leftOf(c.ganttBlock(t, 0, occs[1])), siblingAtRest,
    'occurrence 1 does not move while occurrence 0 is dragged');
});

test('a recurring drag previews the edge modes too, without inverting the span', () => {
  const c = ganttReady();
  const { t, occs } = recurFixture(c);
  const w = bar => px(styleOf(bar).width);
  const restW = w(c.ganttBlock(t, 0, occs[0]));

  c.dragState = { id: 'r1', occIdx: 0, mode: 'end', recurring: true, deltaMs: 2 * DAY };
  assert.ok(w(c.ganttBlock(t, 0, occs[0])) > restW, 'dragging the end grows the bar');

  // Dragged far enough backwards to invert, the span floors at one day rather than going negative.
  c.dragState = { id: 'r1', occIdx: 0, mode: 'end', recurring: true, deltaMs: -30 * DAY };
  assert.ok(w(c.ganttBlock(t, 0, occs[0])) > 0, 'an over-dragged end never renders a negative span');
  c.dragState = null;
});

test('a merged recurring run previews as one interaction unit', () => {
  const c = ganttReady();
  const { t } = recurFixture(c);
  const occs = [0, 1, 2].map(idx => ({ idx, start: B0 + idx * DAY, end: B0 + (idx + 1) * DAY, occ: true }));
  const run = c.mergeConsecutiveOccurrenceDays(occs)[0];
  const rest = styleOf(c.ganttBlock(t, 0, run));

  c.dragState = { id: 'r1', occIdx: 0, runOccIdxs: [0, 1, 2], mode: 'move', recurring: true, deltaMs: 2 * DAY };
  const moved = styleOf(c.ganttBlock(t, 0, run));
  assert.strictEqual(px(moved.left) - px(rest.left), 2 * c.state.dayW, 'the whole run moves in preview');
  assert.strictEqual(px(moved.width), px(rest.width), 'body drag preserves the run width');

  c.dragState.mode = 'start'; c.dragState.deltaMs = -DAY;
  const left = styleOf(c.ganttBlock(t, 0, run));
  assert.strictEqual(px(rest.left) - px(left.left), c.state.dayW, 'left grip previews only the run boundary');
  assert.strictEqual(px(left.width) - px(rest.width), c.state.dayW);

  c.dragState.mode = 'end'; c.dragState.deltaMs = DAY;
  const right = styleOf(c.ganttBlock(t, 0, run));
  assert.strictEqual(px(right.left), px(rest.left));
  assert.strictEqual(px(right.width) - px(rest.width), c.state.dayW, 'right grip previews only the run boundary');
});

test('This run commits every body member but only the grabbed edge boundary in one undo step', () => {
  const c = ganttReady();
  const { t } = recurFixture(c);
  t.recur.overrides = {};
  const occs = [0, 1, 2].map(idx => ({ idx, start: B0 + idx * DAY, end: B0 + (idx + 1) * DAY, occ: true }));
  c._occById = { r1: occs };
  c.state.tasks = [t];
  c.saveTasks = () => {};
  const apply = mode => {
    t.recur.overrides = {};
    const before = c.history.length;
    c.state.scopePrompt = { kind: 'date', taskId: 'r1', occIdx: 0,
      payload: { mode, deltaMs: mode === 'start' ? -DAY : DAY, runOccIdxs: [0, 1, 2] } };
    c.applyScope('this');
    assert.strictEqual(c.history.length, before + 1, mode + ' is one commit and therefore one undo step');
    return t.recur.overrides;
  };

  let ov = apply('move');
  assert.deepStrictEqual(Object.keys(ov), ['0', '1', '2']);
  occs.forEach(o => {
    assert.strictEqual(ov[o.idx].start, c.addLocalDays(o.start, 1));
    assert.strictEqual(ov[o.idx].end, c.addLocalDays(o.end, 1));
  });

  ov = apply('start');
  assert.deepStrictEqual(Object.keys(ov), ['0'], 'left resize edits only the first member');
  assert.strictEqual(ov[0].start, c.addLocalDays(occs[0].start, -1));

  ov = apply('end');
  assert.deepStrictEqual(Object.keys(ov), ['2'], 'right resize edits only the last member');
  assert.strictEqual(ov[2].end, c.addLocalDays(occs[2].end, 1));
});

test('a drag on a DIFFERENT task previews nothing here', () => {
  const c = ganttReady();
  const { t, occs } = recurFixture(c);
  const restLeft = leftOf(c.ganttBlock(t, 0, occs[0]));
  c.dragState = { id: 'someone-else', occIdx: 0, mode: 'move', recurring: true, deltaMs: 5 * DAY };
  assert.strictEqual(leftOf(c.ganttBlock(t, 0, occs[0])), restLeft, 'the preview is scoped to its own task');
  c.dragState = null;
});
