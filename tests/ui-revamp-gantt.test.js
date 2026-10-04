// UI revamp block 7 — readable Gantt and drag feedback.
// 1. Bars carry their names: inside when the whole name fits, beside the bar when it fits there, otherwise
//    whichever side shows more; a repeat names only its first painted run (the 2026-08-12 density rule).
// 2. A drawn tooltip ("Name · Tue Oct 06 → Thu Oct 08 · 1:30 planned") replaces the native title.
// 3. Row ↔ bar hover link: one hoverId; the hovered row's bar is ringed, the hovered bar's row is filled.
// 4. Bars wear the task's SECTION hue — the same hue the Day/Week blocks are filled from.
// 5. Grips and link dots have hit boxes that RENDER at HIT_MIN_PX under the 0.8 shell.
// 6. A live chip names the new dates during a Gantt drag and the landing time during a block drag.
// 7. The row menu's "Dates and progress…" opens the bar menu from the keyboard.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const DAY = 86400000;
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const px = (v) => parseFloat(String(v || 0));

const OCT6 = new Date(2026, 9, 6).getTime(); // a Tuesday
function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.state.sections = [
    { id: 'sWork', name: 'Work', order: 0, color: '#3b82f6' },
    { id: 'sHome', name: 'Home', order: 1, color: '#f59e0b' },
  ];
  c.savePrefs = () => {};
  c._cpm = { critical: {} };
  c._showCP = false;
  c._tl = { start: OCT6 - 10 * DAY, days: 60 };
  c._vwin = { d0: 0, d1: 60 };
  c.state.dayW = 42;
  return c;
}
const T = (c, over) => c.normalizeTask(Object.assign({ id: 'a', name: 'Prepare TA slides', type: 'Proportional',
  sectionId: 'sWork', start: OCT6, end: OCT6 + 2 * DAY, priority: 4, deps: [], pct: 0, planned: 90, labels: [] }, over || {}));
const occOf = (t) => ({ idx: 0, start: t.start, end: t.end });
const body = (bar) => find(bar, (p) => p['data-gantt-bar-body'] === '1')[0];

// ---------------------------------------------------------------------------
// 1. Label placement
// ---------------------------------------------------------------------------

test('ganttLabelPlan: inside when the whole name fits, outside when it fits there, the bigger side otherwise', () => {
  const c = setup();
  const name = 'Prepare TA slides'; // 17 chars
  const textW = Math.ceil(name.length * c.GANTT_LABEL_CHAR_PX);
  const fitIn = textW + 2 * c.GANTT_LABEL_PAD_PX;
  assert.equal(c.ganttLabelPlan(name, fitIn, 0).mode, 'inside', 'a bar exactly wide enough holds the name');
  assert.equal(c.ganttLabelPlan(name, fitIn - 1, 500).mode, 'outside', 'one px short → beside the bar, where it fits');
  // The n% readout claims the bar's right end, so the same bar can no longer hold the name inside.
  assert.equal(c.ganttLabelPlan(name, fitIn, 500, { pctShown: true }).mode, 'outside');
  // Neither side holds the whole name: the side that shows more wins, truncated by CSS.
  const p = c.ganttLabelPlan(name, 90, 60);
  assert.equal(p.mode, 'inside', 'a 90px bar beats 60px of room');
  assert.equal(p.maxW, 90 - 2 * c.GANTT_LABEL_PAD_PX);
  assert.equal(c.ganttLabelPlan(name, 30, 80).mode, 'outside', 'a one-day bar with room beside it labels outside');
  // Room is measured to the NEXT bar in the row, so an outside label never runs into it.
  const q = c.ganttLabelPlan(name, 30, 80);
  assert.ok(q.maxW <= 80 - c.GANTT_LABEL_GAP_PX, 'outside label stops short of the next bar');
  assert.equal(c.ganttLabelPlan(name, 30, 20).mode, 'none', 'no side worth GANTT_LABEL_MIN_PX → no label at all');
  assert.equal(c.ganttLabelPlan('Launch', 400, 200, { milestone: true }).mode, 'outside', 'a diamond has no inside');
  assert.equal(c.ganttLabelPlan('', 400, 400).mode, 'none');
  assert.ok(c.ganttLabelPlan(name, 30, 10000).maxW <= c.GANTT_LABEL_MAX_PX, 'outside labels are capped');
});

test('a bar renders its label inside or beside itself, as the plan says, never as a native title', () => {
  const c = setup();
  const wide = T(c, { end: OCT6 + 6 * DAY });
  const bar = c.ganttBlock(wide, 0, occOf(wide));
  const lab = find(bar, (p) => p['data-gantt-label'])[0];
  assert.equal(lab.props['data-gantt-label'], 'inside');
  assert.equal(lab.props.style.pointerEvents, 'none', 'a label never eats a drag');
  assert.match(textOf(lab), /Prepare TA slides/);
  assert.equal(body(bar).props.title, undefined, 'the native title is retired');

  const one = T(c, { id: 'b', end: OCT6 });
  const bar1 = c.ganttBlock(one, 0, occOf(one));
  const lab1 = find(bar1, (p) => p['data-gantt-label'])[0];
  assert.equal(lab1.props['data-gantt-label'], 'outside');
  assert.equal(lab1.props.style.left, 'calc(100% + ' + c.GANTT_LABEL_GAP_PX + 'px)', 'just right of the bar end');

  // While the link dots show (row hovered), the outside label steps past them instead of sitting under them.
  c.setState({ hoverId: 'b' });
  const lab2 = find(c.ganttBlock(one, 0, occOf(one)), (p) => p['data-gantt-label'])[0];
  assert.ok(px(lab2.props.style.left.replace(/calc\(100% \+ |px\)/g, '')) >= c.BAR_GRIP_OUT_PX + c.GANTT_HIT_PX,
    'the shifted label clears the grip extension and the dot');
});

test('a partly done bar draws its inside label ONCE, in one ink — no seam through the word (block 8)', () => {
  const c = setup();
  const t = T(c, { end: OCT6 + 6 * DAY, pct: 40 });
  const bar = c.ganttBlock(t, 0, occOf(t));
  const layers = find(bar, (p) => p.style && /inset\(/.test(String(p.style.clipPath || '')));
  assert.equal(layers.length, 0, 'block 7 clipped two copies at the fill edge; block 8 draws one');
  const labs = find(bar, (p) => p['data-gantt-label']);
  assert.equal(labs.length, 1, 'one label');
  assert.equal(labs[0].props.style.color, labs[0].props['data-gantt-label-ink']);
  assert.equal(textOf(bar).split('Prepare TA slides').length - 1, 1, 'the name is painted once');
});

test('density: a weekly repeat names its first painted run only, however many runs it draws', () => {
  const c = setup();
  const today = c.startOfToday();
  c._tl = { start: today - 7 * DAY, days: 60 };
  c.state.tasks = [T(c, { id: 'w', name: 'Weekly review', start: today + 9 * 3600000, end: today + 10 * 3600000,
    recur: { kind: 'week', n: 1, label: 'Weekly' } })];
  c.renderVals();
  c._tl = { start: today - 7 * DAY, days: 60 };
  c._vwin = null;
  const g = c.renderGantt(c._visTasks);
  const bars = find(g, (p) => p['data-gantt-bar-id'] === 'w');
  assert.ok(bars.length >= 3, 'the fixture really draws several runs, got ' + bars.length);
  assert.equal(find(g, (p) => p['data-gantt-label-task'] === 'w').length, 1, 'one label for the whole row');
});

// ---------------------------------------------------------------------------
// 2. Tooltip
// ---------------------------------------------------------------------------

test('the tooltip reads "Name · Tue Oct 06 → Thu Oct 08 · 1:30 planned" through the shared formatters', () => {
  const c = setup();
  const t = T(c);
  const m = c.barTipModel(t, t.start, t.end);
  assert.equal(c.barTipText(m), 'Prepare TA slides · Tue Oct 06 → Thu Oct 08 · 1:30 planned');
  assert.equal(m.when.split(' → ')[1], c.fmtEnd(t), 'the end is fmtEnd, the one end formatter');
  // An all-day end is exclusive in storage; the tooltip names the inclusive day, as every surface does.
  const ad = T(c, { allDay: true, end: OCT6 + 3 * DAY });
  assert.match(c.barTipModel(ad, ad.start, ad.end).when, /→ Thu Oct 08$/);
  // Open edges say so instead of inventing a date; no planned time, no planned clause.
  const open = T(c, { start: null, planned: null });
  assert.equal(c.barTipText(c.barTipModel(open, null, open.end)), 'Prepare TA slides · No start → Thu Oct 08');
  // The machine-readable twin on the bar body starts with the name (the e2e specs address bars by it).
  const tip = body(c.ganttBlock(t, 0, occOf(t))).props['data-gantt-tip'];
  assert.equal(tip, 'Prepare TA slides · Tue Oct 06 → Thu Oct 08 · 1:30 planned');
});

test('entering a bar records hoverId and the tooltip anchor in ONE setState; leaving clears both', () => {
  const c = setup();
  const t = T(c);
  c.state.tasks = [t];
  let calls = 0; const orig = c.setState.bind(c); c.setState = (s, cb) => { calls++; return orig(s, cb); };
  const bar = c.ganttBlock(t, 0, occOf(t));
  const el = { getBoundingClientRect: () => ({ left: 100, top: 50, right: 200, bottom: 70, width: 100, height: 20 }) };
  bar.props.onMouseEnter({ currentTarget: el, clientX: 120 });
  assert.equal(calls, 1, 'one render on enter');
  assert.equal(c.state.hoverId, 'a');
  assert.equal(c.state.barTip.id, 'a');
  const tip = c.renderBarTip();
  assert.ok(tip && tip.props['data-gantt-tooltip'] === 'a', 'the tooltip renders');
  assert.equal(tip.props.role, 'tooltip');
  assert.match(textOf(tip), /Prepare TA slides/);
  assert.match(textOf(tip), /Tue Oct 06 → Thu Oct 08 · 1:30 planned/);
  c.dragState = { id: 'a' };
  assert.equal(c.renderBarTip(), null, 'no tooltip while a drag is live');
  c.dragState = null;
  bar.props.onMouseLeave();
  assert.equal(calls, 2, 'one render on leave');
  assert.equal(c.state.hoverId, null);
  assert.equal(c.state.barTip, null);
  assert.equal(c.renderBarTip(), null);
});

// ---------------------------------------------------------------------------
// 3. Row ↔ bar hover link
// ---------------------------------------------------------------------------

test('hovering a sheet row rings its bar; hovering a bar fills its sheet row', () => {
  const c = setup();
  c.state.tasks = [T(c), T(c, { id: 'b', name: 'Other' })];
  c.renderVals();
  c._tl = { start: OCT6 - 10 * DAY, days: 60 }; c._vwin = { d0: 0, d1: 60 };
  const t = c.state.tasks[0];
  assert.equal(body(c.ganttBlock(t, 0, occOf(t))).props['data-gantt-hover'], null, 'no ring at rest');
  c.setState({ hoverId: 'a' }); // what the sheet row's onMouseEnter writes
  const b = body(c.ganttBlock(t, 0, occOf(t)));
  assert.equal(b.props['data-gantt-hover'], '1');
  assert.match(b.props.style.boxShadow, /--bar-hover-ring/);
  c.setState({ selectedIds: ['a'] });
  assert.match(body(c.ganttBlock(t, 0, occOf(t))).props.style.boxShadow, /--bar-ring\)/, 'selection keeps its own ring');
  // And the other direction: the bar's enter writes the same hoverId the sheet row paints from.
  c.setState({ selectedIds: [], hoverId: null });
  c.ganttBlock(t, 0, occOf(t)).props.onMouseEnter();
  const row = c.sheetRow(t, 0, c.visibleCols(), 1200, { a: t });
  assert.equal(row.props.style.background, 'var(--hover)', 'the hovered bar fills its row');
});

// ---------------------------------------------------------------------------
// 4. Section hue
// ---------------------------------------------------------------------------

test('a bar wears its section hue — the same colour its Day/Week block is filled from', () => {
  const c = setup();
  const work = T(c), home = T(c, { id: 'h', sectionId: 'sHome' });
  const kid = T(c, { id: 'k', sectionId: null, parentId: 'h' });
  const none = T(c, { id: 'n', sectionId: null });
  c.state.tasks = [work, home, kid, none];
  // Block 8: the body is the hue TONED toward the pane; the hue itself rides on data-gantt-hue.
  const hue = (t) => body(c.ganttBlock(t, 0, occOf(t))).props['data-gantt-hue'];
  assert.equal(hue(work), '#3b82f6');
  assert.equal(hue(home), '#f59e0b');
  assert.equal(hue(kid), '#f59e0b', 'a subtask wears its root section, as the sheet files it');
  assert.equal(hue(none), c.SECCOL_NONE, 'no section → the reserved no-section hue, as on the timeline');
  for (const t of [work, home, kid, none]) assert.equal(hue(t), c.tlSurface({ type: 'auto' }, t).col, 'Gantt and timeline agree');
  // Priority never colours a bar; critical still outranks the hue.
  assert.equal(hue(T(c, { id: 'p', priority: 1 })), '#3b82f6', 'P1 is the sheet circle, not the bar');
  c._showCP = true; c._cpm = { critical: { a: true } };
  assert.equal(body(c.ganttBlock(work, 0, occOf(work))).props.style.background, 'var(--danger)');
});

test('barInk picks whichever of white and the dark ink contrasts more with the hue', () => {
  const c = setup();
  assert.equal(c.barInk('#1e3a8a'), 'var(--bar-ink-light)', 'deep blue → white');
  assert.equal(c.barInk('#f59e0b'), 'var(--bar-ink-dark)', 'amber → dark');
  assert.equal(c.barInk('#fff'), 'var(--bar-ink-dark)');
  assert.equal(c.barInk('var(--bar)'), 'var(--bar-ink-light)', 'a token falls back to white, which tokens were tuned for');
  for (const col of c.SECCOL.concat([c.SECCOL_NONE])) {
    const L = c.hexLum(col);
    const ink = c.barInk(col) === 'var(--bar-ink-light)' ? 1 : c.BAR_INK_DARK_LUM;
    assert.ok(c.contrastRatio(L, ink) >= 3.5, col + ' label contrast ' + c.contrastRatio(L, ink).toFixed(2));
  }
});

// ---------------------------------------------------------------------------
// 5. Hit boxes
// ---------------------------------------------------------------------------

test('each grip has an outside extension: together they render at HIT_MIN_PX, live only while the bar is hovered', () => {
  const c = setup();
  const t = T(c); c.state.tasks = [t];
  const exts = (bar) => find(bar, (p) => p['data-gantt-edge-ext']);
  let bar = c.ganttBlock(t, 0, occOf(t));
  assert.equal(exts(bar).length, 2);
  for (const e of exts(bar)) {
    assert.equal(px(e.props.style.width), c.BAR_GRIP_OUT_PX);
    assert.ok((c.BAR_GRIP_PX + c.BAR_GRIP_OUT_PX) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'inside + outside renders ≥ 24px');
    assert.ok(px(e.props.style.height) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'and is at least as tall');
    assert.equal(e.props.style.pointerEvents, 'none', 'at rest a press beside a bar still belongs to the lane');
    assert.equal(typeof e.props.onMouseDown, 'function');
  }
  // The inside grip is unchanged, so pctGrabZone's clearance rule is unchanged.
  assert.equal(find(bar, (p) => p['data-gantt-edge'] === 'end')[0].props.style.width, c.BAR_GRIP_PX + 'px');
  c.setState({ barTip: { id: 'a', idx: 0 } });
  bar = c.ganttBlock(t, 0, occOf(t));
  for (const e of exts(bar)) assert.equal(e.props.style.pointerEvents, 'auto', 'live while this bar is hovered');
  // Hover-owner tenet: the extensions are children of the bar wrapper that owns the hover.
  assert.equal(typeof bar.props.onMouseEnter, 'function');
});

// ---------------------------------------------------------------------------
// 6. Live drag chips
// ---------------------------------------------------------------------------

test('ganttDragChipText names both ends of a move and only the moved edge of a resize', () => {
  const c = setup();
  const t = T(c);
  assert.equal(c.ganttDragChipText(t, 'move', t.start, t.end, 2), 'Tue Oct 06 → Thu Oct 08 (+2d)');
  assert.equal(c.ganttDragChipText(t, 'start', t.start, t.end, -1), 'Start Tue Oct 06 (−1d)');
  assert.equal(c.ganttDragChipText(t, 'end', t.start, t.end, 0), 'End Thu Oct 08');
});

test('renderDragChip follows a live bar drag with the previewed dates, and stays hidden for a click', () => {
  const c = setup();
  const t = T(c, { start: OCT6 + 2 * DAY, end: OCT6 + 4 * DAY }); // the live preview onMouseMove wrote
  c.state.tasks = [t];
  c.dragState = { id: 'a', mode: 'move', recurring: false, origStart: OCT6, origEnd: OCT6 + 2 * DAY, cx: 300, cy: 200 };
  assert.equal(c.renderDragChip(), null, 'not live yet (under the 4px slop) → no chip');
  c.dragState.live = true;
  const chip = c.renderDragChip();
  assert.equal(chip.props['data-drag-chip'], 'gantt');
  assert.equal(textOf(chip), 'Thu Oct 08 → Sat Oct 10 (+2d)');
  assert.equal(chip.props.style.position, 'fixed');
  assert.equal(chip.props.style.pointerEvents, 'none');
  c.dragState.clamped = true;
  assert.match(textOf(c.renderDragChip()), /held by a dependency/);
});

test('a recurring drag previews its shifted run in the chip (its tasks are not remapped live)', () => {
  const c = setup();
  const t = T(c, { recur: { kind: 'day', n: 1, label: 'Daily' } });
  c.state.tasks = [t];
  const d = { id: 'a', mode: 'move', recurring: true, deltaMs: 3 * DAY, origStart: OCT6, origEnd: OCT6 + 3600000 };
  const p = c.dragPreviewSpan(d);
  assert.equal(p.st, c.addLocalDays(OCT6, 3));
  assert.equal(c.dragChipDays(d, p), 3);
  const e = c.dragPreviewSpan(Object.assign({}, d, { mode: 'end', deltaMs: -5 * DAY }));
  assert.ok(e.en >= c.addLocalDays(OCT6, 1), 'an end drag never crosses its start');
});

test('a timeline block drag names its landing time', () => {
  const c = setup();
  const st = new Date(2026, 9, 6, 14, 30).getTime();
  assert.equal(c.blockDragChipText({ previewStart: st, dur: 45 }), 'Tue 2:30pm – 3:15pm');
  assert.equal(c.blockDragChipText({ previewStart: st, dur: 45, atOrig: true }), 'Tue 2:30pm – 3:15pm · back to auto');
  c._blockDrag = { previewStart: st, dur: 45, moved: true, cx: 50, cy: 60 };
  const chip = c.renderDragChip();
  assert.equal(chip.props['data-drag-chip'], 'block');
  assert.equal(textOf(chip), 'Tue 2:30pm – 3:15pm');
});

// ---------------------------------------------------------------------------
// 7. Keyboard reach of the bar menu
// ---------------------------------------------------------------------------

test('the row menu offers "Dates and progress…", which opens the bar menu for that task', () => {
  const c = setup();
  c.state.tasks = [T(c)];
  c.setState({ menu: { x: 40, y: 40, ids: ['a'], kbd: true } });
  const m = c.renderMenu();
  const item = find(m, (p, n) => p.role === 'menuitem' && /Dates and progress/.test(textOf(n)))[0];
  assert.ok(item, 'the item exists and is a real menu item');
  item.props.onClick();
  assert.equal(c.state.menu, null, 'the row menu closes');
  assert.equal(c.state.barMenu.id, 'a');
  assert.equal(c.state.barMenu.kbd, true);
  const bm = c.renderBarMenu();
  const menu = find(bm, (p) => p.role === 'menu')[0];
  assert.equal(menu.props['data-pp-menu'], 'bar', 'the bar menu is the keyboard-driven role=menu');
});
