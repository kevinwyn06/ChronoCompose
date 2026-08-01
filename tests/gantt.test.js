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
