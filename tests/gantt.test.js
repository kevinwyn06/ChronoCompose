// Gantt ergonomics (workstream C): sub-day zoom clamp, bar-draw width floor, and the
// dependency-driven scheduling invariant (finish-to-start, forward-only) that the docs describe.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

// ---- C2: sub-day zoom bounds ----
test('clampDayW keeps the zoom within [GANTT_DAYW_MIN, GANTT_DAYW_MAX]', () => {
  const c = make();
  assert.strictEqual(c.clampDayW(1), c.GANTT_DAYW_MIN);      // below floor
  assert.strictEqual(c.clampDayW(99999), c.GANTT_DAYW_MAX);  // above cap
  assert.strictEqual(c.clampDayW(300), 300);                 // in range — past the old 120 cap
  assert.ok(c.GANTT_DAYW_MAX > 120, 'cap raised beyond the old one-day-ish 120 so hours are reachable');
});

// ---- C1: bar-draw width (a zero/negative span must never render as a zero-length point) ----
test('effBarEnd: a zero/negative span draws one full day; a real span draws itself', () => {
  const c = make();
  const st = Date.now();
  assert.strictEqual(c.effBarEnd(st, st), st + DAY);          // zero span → one day wide
  assert.strictEqual(c.effBarEnd(st, st - 1000), st + DAY);   // inverted → one day wide
  assert.strictEqual(c.effBarEnd(st, st + 3 * DAY), st + 3 * DAY); // real forward span unchanged
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

  // The same defect hit the milestone diamond and the collapsed-recurrence strip.
  const ms = mkTask(c, { id: 'g2', type: 'Milestone' });
  assert.strictEqual(typeof c.ganttBlock(ms, 0, occOf(ms)).props.onMouseEnter, 'function',
    'milestone diamond hovers its row too');
  const rt = mkTask(c, { id: 'g3', recur: { kind: 'day', n: 1, label: 'Daily' } });
  const strip = c.ganttRecurStrip(rt, 0, [occOf(rt), { idx: 1, start: rt.start + DAY, end: rt.end + DAY }]);
  assert.strictEqual(typeof strip.props.onMouseEnter, 'function', 'recurrence strip hovers its row too');
});

// Owner tenet (2026-07-26): "all the clickboxes are all too tiny. Humans do not have machine
// precision." Every handle carries a transparent hit box of at least HIT_MIN_PX in the axis that
// matters, with the small glyph drawn inside it.
test('the link dot carries a HIT_MIN_PX hit box that clears the right resize grip', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  const dot = findAll(bar, n => n.props && /link as predecessor/.test(n.props.title || ''))[0];
  assert.ok(dot, 'link dot exists');
  const s = styleOf(dot);
  assert.ok(px(s.width) >= c.HIT_MIN_PX, 'hit box is at least HIT_MIN_PX wide, got ' + s.width);
  assert.ok(px(s.height) >= c.HIT_MIN_PX, 'hit box is at least HIT_MIN_PX tall, got ' + s.height);
  // Must start at/after the bar's right edge — overlapping the 7px grip is the C3 regression.
  assert.strictEqual(s.left, '100%', 'hit box starts at the bar right edge, clear of the grip');
  assert.ok(findAll(dot, n => /50%/.test(String(styleOf(n).borderRadius || ''))).length,
    'the visible circle is drawn inside the hit box, not enlarged');
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

// ---- Gantt bars are ANONYMOUS again (owner 2026-08-12) ----
// V5.27b drew every bar's task name as rendered text (inside the fill when wide and solid, otherwise
// beside the bar). Four tests pinned that contract; they are RETIRED WITH IT rather than deleted
// silently, and replaced by the inverse assertion below.
//
// Why it was reversed: the feature was designed against sparse fixtures, where one bar per row makes a
// label clarifying. A real workspace repeats — a daily task drew one label per occurrence, so a single
// row emitted the same name across the whole chart width and rows of recurring work became stacked
// text (owner: "the name completely overwhelms the interface"). These very tests passed throughout,
// because none of them rendered more than two occurrences of anything: the defect was density, and the
// fixtures had none. That is the gap worth remembering, not the removed code.
//
// The replacement test asserts rendered text is ABSENT while the tooltip still carries the name, so a
// future re-introduction has to be a deliberate change to this contract rather than an accident.
const textOf = n => {
  if (n == null || n === false) return '';
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (typeof n !== 'object') return String(n);
  return textOf(n.children || []);
};
const nameNodes = root => findAll(root, n => n.props && n.props['data-ganttname'] != null);
const titlesOf = root => findAll(root, n => n.props && n.props.title).map(n => n.props.title);

test('no Gantt shape renders its task name as text; the tooltip still carries it', () => {
  const c = ganttReady();

  // A wide solid bar — the case V5.27b labelled INSIDE the fill.
  const wide = mkTask(c, { name: 'Quarterly board deck' });
  // A bar floored at BAR_MIN_PX — the case V5.27b labelled OUTSIDE.
  c.state.dayW = 6;
  const narrow = mkTask(c, { id: 'n1', name: 'Renew passport', end: B0 + DAY });
  c.state.dayW = 42;
  const ms = mkTask(c, { id: 'm1', name: 'Launch', type: 'Milestone' });
  const rt = mkTask(c, { id: 'r1', name: 'Standup', recur: { kind: 'day', n: 1, label: 'Daily' } });

  const shapes = [
    ['wide bar', c.ganttBlock(wide, 0, occOf(wide)), 'Quarterly board deck'],
    ['narrow bar', c.ganttBlock(narrow, 0, occOf(narrow)), 'Renew passport'],
    ['ghost bar', c.ganttBlock(wide, 0,
      { idx: 0, start: wide.start, end: wide.end, ghost: true, ghostStart: true }), 'Quarterly board deck'],
    ['milestone', c.ganttBlock(ms, 0, occOf(ms)), 'Launch'],
    ['recur strip', c.ganttRecurStrip(rt, 0,
      [occOf(rt), { idx: 1, start: rt.start + DAY, end: rt.end + DAY }]), 'Standup'],
  ];

  for (const [what, node, name] of shapes) {
    assert.strictEqual(nameNodes(node).length, 0, what + ' draws no [data-ganttname] label');
    assert.ok(!textOf(node).includes(name),
      what + ' does not render the task name as text anywhere, got: ' + JSON.stringify(textOf(node)));
    // Identification is not lost — it moved back to the tooltip (plus sheet row alignment).
    assert.ok(titlesOf(node).some(ti => String(ti).includes(name)),
      what + ' still names the task in a title tooltip');
  }

  // The recurrence strip keeps its RULE chip: that is per-row, not per-occurrence, so it does not
  // multiply with density the way the name did.
  const strip = shapes[4][1];
  assert.ok(textOf(strip).includes('Daily'), 'the recurrence strip still announces its rule');

  // The V1.5 hover contract and the drag must survive the removal.
  const dia = shapes[3][1];
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
  assert.ok(px(s.fontSize) <= 10, 'small text, got ' + s.fontSize);
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

test('a drag on a DIFFERENT task previews nothing here', () => {
  const c = ganttReady();
  const { t, occs } = recurFixture(c);
  const restLeft = leftOf(c.ganttBlock(t, 0, occs[0]));
  c.dragState = { id: 'someone-else', occIdx: 0, mode: 'move', recurring: true, deltaMs: 5 * DAY };
  assert.strictEqual(leftOf(c.ganttBlock(t, 0, occs[0])), restLeft, 'the preview is scoped to its own task');
  c.dragState = null;
});
