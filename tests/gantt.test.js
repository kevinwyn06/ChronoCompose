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

test('the %-done handle sits BELOW the bar, never inside it (owner 2026-07-26)', () => {
  const c = ganttReady();
  const t = mkTask(c);
  const bar = c.ganttBlock(t, 0, occOf(t));
  const pctH = findAll(bar, n => n.props && /^% done/.test(n.props.title || ''))[0];
  assert.ok(pctH, '%-done handle exists');
  const s = styleOf(pctH);
  assert.ok(/px$/.test(String(s.top)), 'handle top is an absolute offset, not a %-of-bar, got ' + s.top);
  assert.ok(px(s.top) >= c.barH, 'handle top is at/below the bar bottom, got top=' + s.top);
  assert.ok(!/translateY/.test(String(s.transform || '')), 'handle is not re-centred back onto the bar');
  assert.ok(px(s.width) >= c.HIT_MIN_PX, 'handle is at least HIT_MIN_PX wide, got ' + s.width);
  // …and it must not reach into the row below: the bar is centred, so the budget under it is
  // (rowH - barH)/2 plus the row gap the next stripe can spare.
  assert.ok(px(s.top) + px(s.height) <= c.barH + (c.rowH - c.barH) / 2 + 6,
    'handle stays within the row (≤6px into the next stripe), got bottom=' + (px(s.top) + px(s.height)));
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

// ---- V5.27b: a Gantt bar carries its task's NAME (owner: "gantt … should be given tasks labels") ----
// Before this, the ONLY identification on a bar was a `title` tooltip, so on a triage surface you had
// to hover — or trust row alignment with the sheet — to know which bar was which. These tests assert
// RENDERED TEXT, never a title: a check that passes on a tooltip has not tested this fix.
const textOf = n => {
  if (n == null || n === false) return '';
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (typeof n !== 'object') return String(n);
  return textOf(n.children || []);
};
const nameNodes = root => findAll(root, n => n.props && n.props['data-ganttname'] != null);
const titlesOf = root => findAll(root, n => n.props && n.props.title).map(n => n.props.title);

test('V5.27b: a wide Gantt bar renders its task name as text inside the bar, not only as a tooltip', () => {
  const c = ganttReady();
  const t = mkTask(c, { name: 'Quarterly board deck' });
  const bar = c.ganttBlock(t, 0, occOf(t));
  const labels = nameNodes(bar);
  assert.strictEqual(labels.length, 1, 'exactly one name label is drawn');
  assert.strictEqual(labels[0].props['data-ganttname'], t.id, 'the label identifies its task');
  assert.strictEqual(textOf(labels[0]), 'Quarterly board deck', 'the NAME is rendered text');
  // The point of the fix: identification does not depend on a hover.
  assert.ok(!('onMouseEnter' in labels[0].props), 'the label is not hover-gated');
  const s = styleOf(labels[0]);
  assert.ok(!/^0$/.test(String(s.opacity)) && s.opacity !== 0, 'and it is not hidden at rest');
  assert.strictEqual(s.pointerEvents, 'none', 'it never steals a bar drag');
  // 3 days at dayW 42 is ~126px — comfortably inside the inside-label threshold.
  assert.ok(c.GANTT_LABEL_MIN_PX > 0 && 3 * 42 >= c.GANTT_LABEL_MIN_PX);
});

test('V5.27b: a bar too narrow for an inside name keeps the name OUTSIDE it — never invisible', () => {
  const c = ganttReady();
  c.state.dayW = 6;                        // month-ish zoom: a 1-day bar floors at BAR_MIN_PX
  const t = mkTask(c, { name: 'Renew passport', end: B0 + DAY });
  const bar = c.ganttBlock(t, 0, occOf(t));
  const labels = nameNodes(bar);
  assert.strictEqual(labels.length, 1, 'the narrow bar still has exactly one name label');
  assert.strictEqual(textOf(labels[0]), 'Renew passport', 'the full name is still rendered');
  const s = styleOf(labels[0]);
  assert.strictEqual(s.textOverflow, 'ellipsis', 'it truncates with an ellipsis rather than clipping blind');
  assert.strictEqual(s.whiteSpace, 'nowrap', 'and never reflows into the row below');
  // It must be OUTSIDE the bar: the label's row starts past the bar's right edge.
  const row = findAll(bar, n => styleOf(n).display === 'flex' && nameNodes(n).length)[0];
  assert.ok(row, 'the outside label lives in the side row');
  assert.ok(px(styleOf(row).left) >= c.BAR_MIN_PX,
    'the side row starts at/after the bar right edge, got ' + styleOf(row).left);
  // …and clear of the link dot's hit box, so it cannot swallow a dependency drag.
  assert.ok(px(styleOf(row).left) >= c.BAR_MIN_PX + c.HIT_MIN_PX,
    'the side row clears the HIT_MIN_PX link box');
});

test('V5.27b: the inside/outside decision is a width rule, and a ghost fill always goes outside', () => {
  const c = ganttReady();
  assert.strictEqual(c.ganttLabelInside(c.GANTT_LABEL_MIN_PX, true), true, 'at the threshold: inside');
  assert.strictEqual(c.ganttLabelInside(c.GANTT_LABEL_MIN_PX - 1, true), false, 'one px under: outside');
  // A ghost's fill dissolves toward the derived edge, so --on-accent on it is not reliably legible.
  assert.strictEqual(c.ganttLabelInside(400, false), false, 'a wide ghost still labels outside');
  const t = mkTask(c, { name: 'Ghosted work' });
  const gb = c.ganttBlock(t, 0, { idx: 0, start: t.start, end: t.end, ghost: true, ghostStart: true });
  const labels = nameNodes(gb);
  assert.strictEqual(labels.length, 1, 'a ghost bar is named too');
  assert.strictEqual(textOf(labels[0]), 'Ghosted work');
});

test('V5.27b: milestones and collapsed recurrence strips are named too, and no bar stays anonymous', () => {
  const c = ganttReady();
  const ms = mkTask(c, { id: 'm1', name: 'Launch', type: 'Milestone' });
  const dia = c.ganttBlock(ms, 0, occOf(ms));
  assert.strictEqual(textOf(nameNodes(dia)[0] || null), 'Launch', 'the milestone diamond carries its name');
  // The hover contract from V1.5 must survive the wrapper the label needed.
  assert.strictEqual(typeof dia.props.onMouseEnter, 'function', 'milestone still owns its hover state');
  assert.strictEqual(typeof dia.props.onMouseDown, 'function', 'and is still draggable');
  const rt = mkTask(c, { id: 'r1', name: 'Standup', recur: { kind: 'day', n: 1, label: 'Daily' } });
  const strip = c.ganttRecurStrip(rt, 0, [occOf(rt), { idx: 1, start: rt.start + DAY, end: rt.end + DAY }]);
  assert.strictEqual(textOf(nameNodes(strip)[0] || null), 'Standup', 'the recurrence strip names its task');
  // And the negative: none of the three relies on the tooltip alone any more.
  for (const [what, node] of [['bar', c.ganttBlock(mkTask(c, { name: 'Nm' }), 0, occOf(mkTask(c)))],
                              ['milestone', dia], ['recur strip', strip]]) {
    assert.ok(titlesOf(node).length, what + ' keeps its tooltip as a bonus');
    assert.ok(nameNodes(node).length, what + ' is identifiable WITHOUT the tooltip');
  }
});
