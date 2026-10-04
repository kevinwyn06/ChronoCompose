// UI revamp block 8 — timeline legibility, and a quieter Gantt.
// 1. A short block (≤ TL_COMPACT_MAX_MIN, or drawn too short for a regular block) is a one-line chip whose
//    text renders ≥ 11px; a run of chips reads as a list and a block a chip spills into pads its title.
// 2. The visible hour range widens so the first and last block of the day are never clipped.
// 3. Month: real work ranked first (priority, then duration), routines folded to one line, "+N" counts tasks.
// 4. Routines are neutral; one "Exact" chip style.
// 5. Gantt bars: the section hue toned toward the pane (label ≥ 4.5:1), the full hue as progress fill.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const H = 3600000, M = 60000;
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);

// ---------------------------------------------------------------------------
// 1. Compact chips
// ---------------------------------------------------------------------------

test('tlIsCompact: twenty minutes or less, or too short to draw a regular block', () => {
  const c = make();
  assert.equal(c.tlIsCompact(c.TL_COMPACT_MAX_MIN, 200), true, 'the threshold itself is compact');
  assert.equal(c.tlIsCompact(c.TL_COMPACT_MAX_MIN + 1, 200), false, 'one minute over, when there is room, is a block');
  assert.equal(c.tlIsCompact(45, c.TL_FULL_MIN_PX - 1), true, 'a 45-minute block squeezed by the Week scale is a chip');
  assert.equal(c.tlIsCompact(45, c.TL_FULL_MIN_PX), false);
});

test('chip text renders at or above the 11px floor under the 0.8 shell', () => {
  const c = make();
  assert.ok(c.TL_BLOCK_FS * c.SHELL_ZOOM >= 11, 'rendered ' + (c.TL_BLOCK_FS * c.SHELL_ZOOM));
  assert.ok(c.TL_CHIP_H_PX > c.TL_BLOCK_FS, 'the chip is taller than its line');
});

test('tlChipLayout: a run of chips reads as a list; a block a chip spills into pads its title', () => {
  const c = make();
  const ch = c.TL_CHIP_H_PX;
  const g = c.tlChipLayout([
    { top: 0, natH: 8, mins: 15 },        // chip, spills to ch
    { top: 10, natH: 8, mins: 15 },       // chip, starts under the first one's bottom
    { top: 20, natH: 120, mins: 120 },    // block, its title padded below the second chip
    { top: 300, natH: 120, mins: 120 },   // far away: untouched
  ]);
  assert.deepEqual(g.map((x) => x.compact), [true, true, false, false]);
  assert.equal(g[0].top, 0); assert.equal(g[0].height, ch);
  assert.equal(g[1].top, ch, 'the second chip starts where the first one ends');
  assert.equal(g[2].top, 20, 'a regular block keeps its true top');
  assert.equal(g[2].padTop, 2 * ch - 20, 'and pads its title below the spill');
  assert.equal(g[3].padTop, 0);
  // A dragged chip goes exactly where the pointer puts it.
  const d = c.tlChipLayout([{ top: 0, natH: 8, mins: 15 }, { top: 5, natH: 8, mins: 15, free: true }]);
  assert.equal(d[1].top, 5);
});

function routineDay(c) {
  const B = c.startOfToday();
  Object.assign(c.state.settings, { allotMode: 'today', packFromNow: false, freeTime: 0, breakMin: 0,
    dayStart: '07:00', dayEnd: '23:00' });
  c.state.sections = [{ id: 'sR', name: 'Routines', order: 0, color: '#ef4444' }, { id: 'sW', name: 'Work', order: 1, color: '#3b82f6' }];
  const routine = (id, name, h, m, dur) => activeTask(c, { id, name, sectionId: 'sR', start: B - 20 * DAY + h * H + m * M, end: null,
    startClock: true, uncompressable: true, planned: null, recur: { kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {}, durMs: dur * M } });
  c.state.tasks = [
    routine('wake', 'Wakeup', 7, 0, 15),
    routine('shut', 'Shutdown', 22, 30, 15),
    activeTask(c, { id: 'w1', name: 'Write the report', sectionId: 'sW', planned: 120 }),
    activeTask(c, { id: 'w2', name: 'Reply to emails', sectionId: 'sW', planned: 15 }),
  ];
  return B;
}

test('renderDayColumn draws a 15-minute routine as a compact, neutral chip with its start time', () => {
  const c = make();
  const B = routineDay(c);
  const col = c.renderDayColumn(B, { showLabels: false, availH: 700 });
  const wake = find(col, (p) => p['data-tl-block'] && p['data-tl-task'] === 'wake')[0];
  assert.ok(wake, 'the Wakeup block is drawn');
  assert.equal(wake.props['data-tl-compact'], '1');
  assert.equal(wake.props['data-tl-routine'], '1');
  assert.equal(wake.props.style.background, 'var(--routine-bg)', 'neutral, not the Routines section red');
  assert.ok(px(wake.props.style.height) >= c.TL_CHIP_H_PX);
  assert.equal(px(wake.props.style.fontSize), c.TL_BLOCK_FS);
  const label = find(wake, (p) => p['data-tl-chip-time'])[0];
  assert.equal(label.props['data-tl-chip-time'], '7:00am', 'the time is an attribute, drawn by CSS');
  assert.equal(textOf(label).replace('📌 ', ''), 'Wakeup', 'the block text stays exactly the name');
  assert.match(wake.props.style.boxShadow, /--tl-pin-edge/, 'owner 2026-09-10: a clock-pinned routine keeps its red pinned edge');
  const shortWork = find(col, (p) => p['data-tl-block'] && p['data-tl-task'] === 'w2')[0];
  assert.equal(shortWork.props['data-tl-compact'], '1', 'a 15-minute work block is a chip too');
  const longWork = find(col, (p) => p['data-tl-block'] && p['data-tl-task'] === 'w1')[0];
  assert.equal(longWork.props['data-tl-compact'], null);
});
const px = (v) => parseFloat(String(v || 0));

// ---------------------------------------------------------------------------
// 2. Hour range
// ---------------------------------------------------------------------------

test('tlViewRange keeps the first and last block in view, snapped to the half hour, inside the day', () => {
  const c = make();
  const B = c.startOfToday();
  const win = { start: B + 7 * H, end: B + 23 * H };
  // Blocks well inside the window: unchanged.
  assert.deepEqual(c.tlViewRange(B, win, [{ start: B + 9 * H, end: B + 10 * H }]), win);
  // A block AT the window start gets room above; one ending at the window end gets room below.
  const r = c.tlViewRange(B, win, [{ start: B + 7 * H, end: B + 7 * H + 15 * M }, { start: B + 22 * H + 50 * M, end: B + 23 * H }]);
  assert.equal(r.start, B + 6 * H + 30 * M);
  assert.equal(r.end, B + 23 * H + 30 * M);
  // Never past midnight either side.
  const r2 = c.tlViewRange(B, { start: B, end: B + DAY }, [{ start: B, end: B + 15 * M }, { start: B + DAY - 10 * M, end: B + DAY }]);
  assert.deepEqual(r2, { start: B, end: B + DAY });
  // Focus's from-now column keeps its own start.
  assert.equal(c.tlViewRange(B, win, [{ start: B + 7 * H, end: B + 8 * H }], { fromNow: true }).start, win.start);
});

test('the column range includes Wakeup at the day start and Shutdown near its end; clock windows do not widen it', () => {
  const c = make();
  const B = routineDay(c);
  const data = c.buildDayTimeline(B);
  const items = c.tlRangeItems(data);
  assert.ok(items.every((x) => x.start != null));
  const r = c.tlViewRange(B, { start: data.dayStart, end: data.dayEnd }, items);
  const wake = data.chunks.find((x) => x.id === 'wake'), shut = data.chunks.find((x) => x.id === 'shut');
  assert.ok(r.start <= wake.start - c.TL_RANGE_PAD_MIN * M, 'room above Wakeup');
  assert.ok(r.end >= shut.start + c.TL_RANGE_PAD_MIN * M, 'room below the Shutdown chip');
  // The free-time window alone (a setting) does not widen anything.
  c.state.tasks = []; c.state.settings.freeTime = 120;
  const d2 = c.buildDayTimeline(B);
  assert.deepEqual(c.tlViewRange(B, { start: d2.dayStart, end: d2.dayEnd }, c.tlRangeItems(d2)), { start: d2.dayStart, end: d2.dayEnd });
});

test('a multi-day grid shares ONE range across its columns, and the gutter labels it', () => {
  const c = make();
  const B = routineDay(c);
  const days = [B, B + DAY, B + 2 * DAY];
  const range = c.multiDayRange(days, days.map((d) => c.buildDayTimeline(d)));
  assert.equal(range.startMin, 6 * 60 + 30);
  assert.ok(range.endMin >= 23 * 60, 'Shutdown at 22:30 keeps room below it');
  const gutter = c.renderHourGutter(600, range);
  const labels = find(gutter, (p, n) => p.style && p.style.position === 'absolute' && /^\d+(a|p)$/.test(textOf(n.children)));
  const at = (txt) => labels.find((n) => textOf(n.children) === txt);
  assert.ok(at('7a') && at('11p'), 'the gutter labels the widened range');
  const pxPerMin = 600 / (range.endMin - range.startMin);
  assert.ok(Math.abs(px(at('7a').props.style.top) - 30 * pxPerMin) < 0.5, '7a sits 30 minutes below the 6:30 top');
});

// ---------------------------------------------------------------------------
// 3. Month
// ---------------------------------------------------------------------------

test('monthCellLines: work ranked by priority then duration, routines folded, "+N" counts tasks', () => {
  const c = make();
  c.state.sections = [{ id: 'sR', name: 'Routines', order: 0 }];
  const byId = {};
  const add = (t) => { byId[t.id] = t; return t.id; };
  const ids = [
    add({ id: 'r1', name: 'Wakeup', sectionId: 'sR' }),
    add({ id: 'r2', name: 'Lunch', sectionId: 'sR' }),
    add({ id: 'r3', name: 'Dinner', labels: ['@routines'] }),
    add({ id: 'a', name: 'Small P1', priority: 1, planned: 15 }),
    add({ id: 'b', name: 'Big P3', priority: 3, planned: 300 }),
    add({ id: 'cc', name: 'Big P1', priority: 1, planned: 240 }),
    add({ id: 'e', name: 'Birthday', displayOnly: true }),
  ];
  const all = c.monthCellLines(ids, byId, Infinity);
  assert.deepEqual(all.work, ['cc', 'a', 'b'], 'P1 before P3; within P1 the longer first');
  assert.deepEqual(all.routines, ['r1', 'r2', 'r3']);
  assert.deepEqual(all.lines.map((l) => l.kind), ['task', 'task', 'task', 'routines', 'event']);
  const four = c.monthCellLines(ids, byId, 4);
  assert.equal(four.lines.length, 3, 'three lines and the "+N" row make four');
  assert.deepEqual(four.lines.map((l) => l.kind), ['task', 'task', 'routines'], 'the routine line keeps its row; work gives way');
  assert.deepEqual(four.hiddenIds, ['b', 'e'], '"+N" counts the tasks that did not fit');
  const tight = c.monthCellLines(ids, byId, 1);
  assert.deepEqual(tight.hiddenIds.slice().sort(), ['a', 'b', 'e', 'r1', 'r2', 'r3'].sort(), 'a hidden routine line counts every routine in it');
  const fits = c.monthCellLines(['a', 'r1'], byId, 4);
  assert.equal(fits.hiddenIds.length, 0);
  assert.equal(c.monthCellLines(ids, byId, 1).lines.length, 1, 'a one-line cell keeps its line beside "+N"');
});

test('the month "+N" is a control that opens the day list; Escape closes it', () => {
  const c = make();
  c.setState = function (o) { if (typeof o === 'function') o = o(this.state); Object.assign(this.state, o); };
  const B = c.startOfToday();
  c.state.tasks = [];
  for (let i = 0; i < 7; i++) c.state.tasks.push(activeTask(c, { id: 'm' + i, name: 'Task ' + i, start: B, end: B + DAY - 1, planned: 30 + i }));
  c._calTasks = c.state.tasks;
  let v = c.renderMonthView(false);
  const more = find(v, (p) => p['data-pp-month-more'] === String(B))[0];
  assert.ok(more, '"+N more" is rendered for today');
  assert.equal(more.type, 'button');
  more.props.onClick({ stopPropagation() {}, preventDefault() {} });
  assert.equal(c.state.monthMore, B);
  v = c.renderMonthView(false);
  const pop = find(v, (p) => p['data-pp-month-pop'] === String(B))[0];
  assert.ok(pop, 'the day list is open');
  assert.equal(find(pop, (p) => p['data-pp-month-more-item']).length, 7, 'and lists every task of the day');
  c.isEditingTarget = () => false;
  c.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {}, target: { tagName: 'BODY' } });
  assert.equal(c.state.monthMore, null, 'one Escape closes the day list');
});

// ---------------------------------------------------------------------------
// 4. Routines and the Exact chip
// ---------------------------------------------------------------------------

test('isRoutineTask: the Routines section, an @routines tag, or a daily repeat at a clock time', () => {
  const c = make();
  c.state.sections = [{ id: 'sR', name: 'Routines', order: 0 }, { id: 'sW', name: 'Work', order: 1 }];
  assert.equal(c.isRoutineTask({ sectionId: 'sR' }), true);
  assert.equal(c.isRoutineTask({ labels: ['@routines'] }), true);
  assert.equal(c.isRoutineTask(c.normalizeTask({ id: 'd', name: 'Standup', start: Date.now(), startClock: true, recur: { kind: 'day', n: 1 } })), true);
  assert.equal(c.isRoutineTask(c.normalizeTask({ id: 'u', name: 'GRE', start: c.startOfToday(), recur: { kind: 'day', n: 1 } })), false, 'an untimed daily repeat is work');
  assert.equal(c.isRoutineTask(c.normalizeTask({ id: 'w', name: 'Lab', start: Date.now(), startClock: true, recur: { kind: 'week', n: 1 } })), false, 'a weekly meeting is work');
  assert.equal(c.isRoutineTask({ sectionId: 'sW' }), false);
});

test('one "Exact" chip style: a decided and a derived Exact share fill, ink and border', () => {
  const c = make();
  const B = c.startOfToday();
  const set = c.normalizeTask({ id: 's', name: 'Wakeup', start: B + 7 * H, end: B + 7 * H + 15 * M, startClock: true, endClock: true, uncompressable: true });
  const derived = c.normalizeTask({ id: 'd', name: 'Dentist', start: B + 14 * H, end: B + 15 * H, startClock: true, endClock: true });
  c.state.tasks = [set, derived];
  const chipOf = (t) => {
    const row = c.sheetRow(t, 0, c.visibleCols(), 1400, { s: set, d: derived });
    return find(row, (p) => p['data-exact-cell'] === t.id)[0];
  };
  const a = chipOf(set), b = chipOf(derived);
  assert.equal(c.isUncompressable(derived), true, 'the fixture really derives Exact');
  for (const k of ['background', 'color', 'border']) assert.equal(a.props.style[k], b.props.style[k], k);
  assert.equal(a.props['data-exact-src'], 'set');
  assert.equal(b.props['data-exact-src'], 'derived');
});

// ---------------------------------------------------------------------------
// 5. Gantt bar paint
// ---------------------------------------------------------------------------

const DARK_PANE = '#15181e', LIGHT_PANE = '#fbfcfb'; // the two --gantt-bg values
test('ganttTone mixes the hue toward the pane and every section label clears 4.5:1 in both themes', () => {
  const c = make();
  assert.equal(c.mixHex('#ff0000', '#000000', 0.5), '#800000');
  for (const pane of [DARK_PANE, LIGHT_PANE]) {
    for (const hue of c.SECCOL.concat([c.SECCOL_NONE])) {
      const t = c.ganttTone(hue, pane);
      assert.ok(t.share <= c.GANTT_TONE && t.share >= c.GANTT_TONE_MIN, hue + ' share ' + t.share);
      assert.ok(c.inkContrast(t.body) >= c.TEXT_AA, `${hue} on ${pane}: ${c.inkContrast(t.body).toFixed(2)}`);
      assert.equal(t.ink, c.barInk(t.body));
      assert.notEqual(t.body, hue, 'the body is toned, not the raw hue');
    }
  }
  assert.deepEqual(c.ganttTone('#3b82f6', null), { body: '#3b82f6', ink: c.barInk('#3b82f6'), share: 1 }, 'no pane → the hue as is');
});

test('ganttBarPaint: toned body, full-strength hue as the progress fill, routines neutral', () => {
  const c = make();
  c.state.sections = [{ id: 'sW', name: 'Work', order: 0, color: '#3b82f6' }, { id: 'sR', name: 'Routines', order: 1, color: '#ef4444' }];
  c._toneBase = { theme: c.state.theme, hex: DARK_PANE };
  const t = c.normalizeTask({ id: 'a', name: 'Report', sectionId: 'sW', start: c.startOfToday(), end: c.startOfToday() + DAY });
  c.state.tasks = [t];
  const p = c.ganttBarPaint(t, false, false);
  assert.equal(p.hue, '#3b82f6');
  assert.equal(p.fill, '#3b82f6', 'done is the same colour at full strength');
  assert.equal(p.base, c.ganttTone('#3b82f6', DARK_PANE).body);
  assert.deepEqual(c.pctFillPaint(40, p.fill), { width: '40%', background: '#3b82f6' });
  const r = c.ganttBarPaint(c.normalizeTask({ id: 'r', name: 'Lunch', sectionId: 'sR', start: c.startOfToday() }), false, false);
  assert.equal(r.base, 'var(--routine-bg)');
  assert.equal(r.routine, true);
});

test('ganttLabelInk: one ink; a halo only where that ink is weak on the fill; the fill ink at 100%', () => {
  const c = make();
  const body = c.ganttTone('#f59e0b', DARK_PANE).body;
  const paint = { base: body, ink: c.barInk(body), hue: '#f59e0b', fill: '#f59e0b', fillInk: c.barInk('#f59e0b') };
  assert.deepEqual(c.ganttLabelInk(paint, 0), { ink: paint.ink, halo: null });
  const mid = c.ganttLabelInk(paint, 40);
  assert.equal(mid.ink, paint.ink, 'the whole label keeps the body ink');
  assert.ok(mid.halo, 'white on full amber is below AA, so it carries a dark halo');
  assert.deepEqual(c.ganttLabelInk(paint, 100), { ink: paint.fillInk, halo: null });
});
