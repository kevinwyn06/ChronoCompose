// Date picker (state.datePick) — the start/end editing path added alongside clearDate.
// Covers the pure logic: window ordering in setDate, the all-day exclusive-end round trip,
// the Monday-first grid, and clock-token resolution.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const at = (y, mo, d, h, mi) => new Date(y, mo, d, h || 0, mi || 0, 0, 0).getTime();

function withTask(over) {
  const c = make();
  const t = c.normalizeTask(Object.assign({
    id: 't1', name: 'x', type: 'Proportional',
    start: at(2026, 6, 15, 9, 0), end: at(2026, 6, 20, 9, 0),
  }, over || {}));
  c.state.tasks = [t];
  return { c, t: () => c.state.tasks.find(x => x.id === 't1') };
}

// ---------------------------------------------------------------------------
// setDate — the mutation clearDate never had a counterpart for
// ---------------------------------------------------------------------------
test('setDate: sets the instant through commit', () => {
  const { c, t } = withTask();
  c.setDate('t1', 'start', at(2026, 6, 16, 17, 0));
  assert.equal(t().start, at(2026, 6, 16, 17, 0));
});

test('setDate: pushing start past end carries end with it (never inverts the window)', () => {
  // computeAllotted/dayIntervals assume end >= start; an inverted window yields negative spans.
  const { c, t } = withTask();
  c.setDate('t1', 'start', at(2026, 6, 25, 9, 0));
  assert.equal(t().start, at(2026, 6, 25, 9, 0));
  assert.equal(t().end, at(2026, 6, 25, 9, 0), 'end follows start rather than staying behind it');
});

test('setDate: pulling end before start carries start with it', () => {
  const { c, t } = withTask();
  c.setDate('t1', 'end', at(2026, 6, 10, 9, 0));
  assert.equal(t().end, at(2026, 6, 10, 9, 0));
  assert.equal(t().start, at(2026, 6, 10, 9, 0));
});

test('setDate: an all-day carried end clears the start day (stays exclusive)', () => {
  // Caught in the browser: start=Dec 25 carried end=Dec 25, and since an all-day end renders as
  // (end-1) the row showed "Due Thu Dec 24" — a due date BEFORE its own start.
  const { c, t } = withTask({ allDay: true, start: at(2026, 6, 15), end: at(2026, 6, 21) });
  c.setDate('t1', 'start', at(2026, 11, 25));
  assert.equal(t().start, at(2026, 11, 25));
  assert.equal(t().end, at(2026, 11, 26), 'end is the midnight AFTER the start day, not equal to it');
  assert.ok(t().end - 1 > t().start, 'the displayed due day is not before the start');
});

test('setDate: an all-day carried start sits on the inclusive end day', () => {
  const { c, t } = withTask({ allDay: true, start: at(2026, 6, 15), end: at(2026, 6, 21) });
  c.setDate('t1', 'end', at(2026, 5, 2)); // "through Jun 1"
  assert.equal(t().end, at(2026, 5, 2));
  assert.equal(t().start, at(2026, 5, 1), 'start lands on the last included day, not the exclusive end');
});

test('setDate: a null counterpart is left alone', () => {
  const { c, t } = withTask({ end: null });
  c.setDate('t1', 'start', at(2026, 6, 25, 9, 0));
  assert.equal(t().end, null);
});

test('setDate: start/end edits are undoable (they route through commit)', () => {
  const { c, t } = withTask();
  const before = t().start;
  c.setDate('t1', 'start', at(2026, 6, 25, 9, 0));
  c.undo();
  assert.equal(t().start, before);
});

test('setDate: a completed intra-day clock span always overwrites planned', () => {
  const { c, t } = withTask({
    start: at(2026, 6, 15, 9, 0), end: at(2026, 6, 15, 10, 0), planned: 30,
  });
  c.setDate('t1', 'end', at(2026, 6, 15, 11, 0), true);
  assert.equal(t().planned, 120, 'the booked clock span wins over a deliberately different estimate');
});

test('setDate: clock-span planning stays in the same undo entry as the date edit', () => {
  const { c, t } = withTask({
    start: at(2026, 6, 15, 9, 0), end: at(2026, 6, 15, 10, 0), planned: 30,
  });
  const before = { end: t().end, planned: t().planned };
  c.setDate('t1', 'end', at(2026, 6, 15, 11, 0), true);
  assert.equal(t().planned, 120, 'the edit changes planned before undo');
  c.undo();
  assert.equal(t().end, before.end);
  assert.equal(t().planned, before.planned);
});

test('setDate: a task with only one clock leaves planned untouched', () => {
  const { c, t } = withTask({ end: null, planned: 25 });
  c.setDate('t1', 'start', at(2026, 6, 15, 9, 30), true);
  assert.equal(t().planned, 25);
});

test('setDate: a multi-day clock span leaves planned untouched', () => {
  const { c, t } = withTask({
    start: at(2026, 6, 15, 9, 0), end: at(2026, 6, 16, 10, 0), planned: 25,
  });
  c.setDate('t1', 'end', at(2026, 6, 16, 11, 0), true);
  assert.equal(t().planned, 25);
});

test('setDate: an explicit time sets the clock flag; clearing it returns to derived midnight', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [c.normalizeTask({ id: 'd1', start: B })];
  c.setDate('d1', 'start', B, false);
  assert.equal(c.state.tasks[0].start, B);
  assert.equal(c.state.tasks[0].startClock, null, 'derive: midnight reads as untimed');
  c.setDate('d1', 'start', B, true);
  assert.equal(c.state.tasks[0].startClock, true, 'explicit midnight is remembered');
  assert.equal(c.hasStartTime(c.state.tasks[0]), true);
});

// ---------------------------------------------------------------------------
// all-day round trip: stored ends are the EXCLUSIVE next-day midnight (dueInstant)
// ---------------------------------------------------------------------------
test('openDatePick: an all-day end opens on the inclusive last day', () => {
  const { c } = withTask({ allDay: true, end: at(2026, 6, 21, 0, 0) }); // exclusive → means "through the 20th"
  c.openDatePick(fakeEvent(), 't1', 'end');
  assert.equal(new Date(c.state.datePick.ms).getDate(), 20);
});

test('dpApply: an all-day end is re-encoded as the exclusive next-day midnight', () => {
  const { c, t } = withTask({ allDay: true, end: at(2026, 6, 21, 0, 0) });
  c.openDatePick(fakeEvent(), 't1', 'end');
  c.dpPickDay(at(2026, 6, 24, 0, 0)); // user picks "through the 24th"
  c.dpApply();
  assert.equal(t().end, at(2026, 6, 25, 0, 0), 'stored end is midnight AFTER the picked day');
  assert.equal(c.state.datePick, null, 'picker closes on apply');
});

test('dpApply: an all-day start is normalised to midnight', () => {
  const { c, t } = withTask({ allDay: true });
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpPickDay(at(2026, 6, 24, 0, 0));
  c.dpApply();
  assert.equal(t().start, at(2026, 6, 24, 0, 0));
});

test('dpApply: a timed task keeps its clock', () => {
  const { c, t } = withTask();
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpSetTime('17:30');
  c.dpPickDay(at(2026, 6, 24, 0, 0)); // picking a day must not wipe the time
  c.dpApply();
  assert.equal(t().start, at(2026, 6, 24, 17, 30));
});

test('date picker: untimed dates render a blank TIME field and date-only preview', () => {
  const B = at(2026, 6, 24);
  const { c } = withTask({ start: B, startClock: null });
  c.openDatePick(fakeEvent(), 't1', 'start');
  const tree = c.renderDatePick();
  const nodes = [];
  (function walk(node) {
    if(!node || typeof node !== 'object') return;
    nodes.push(node);
    (node.children || []).forEach(walk);
  })(tree);
  const timeInput = nodes.find(node => node.type === 'input' && node.props.defaultValue !== undefined);
  assert.equal(timeInput.props.defaultValue, '', 'a bare date does not masquerade as 00:00');
  const preview = nodes.find(node => node.type === 'div' && node.props.style?.fontVariantNumeric === 'tabular-nums'
    && node.props.style?.marginBottom === '8px');
  assert.equal(preview.children[0], c.fmtDT(B, true), 'untimed preview omits the clock');
});

test('date picker: explicit midnight renders 12:00am and applies startClock:true', () => {
  const B = at(2026, 6, 24);
  const { c, t } = withTask({ start: B, startClock: true });
  c.openDatePick(fakeEvent(), 't1', 'start');
  let tree = c.renderDatePick();
  let timeInput;
  (function walk(node) {
    if(!node || typeof node !== 'object' || timeInput) return;
    if(node.type === 'input' && node.props.defaultValue !== undefined) timeInput = node;
    (node.children || []).forEach(walk);
  })(tree);
  // Task 14 (2026-08-20): the field is 12-hour now and the meridiem lives in the control beside it,
  // so an explicit midnight reads '12:00' with AM selected rather than the 24-hour '00:00'.
  assert.equal(timeInput.props.defaultValue, '12:00');
  const merOn = [];
  (function walk(node) {
    if(!node || typeof node !== 'object') return;
    if(node.props && node.props['data-dp-on'] === '1') merOn.push(node.props['data-dp-mer']);
    (node.children || []).forEach(walk);
  })(tree);
  assert.deepEqual(merOn, ['am'], 'and it says which twelve');
  c.dpSetTime('12:00am');
  c.dpApply();
  assert.equal(t().start, B);
  assert.equal(t().startClock, true, 'typed 00:00 survives as an explicit clock');
});

test('date picker: clearing TIME applies untimed midnight with a null flag', () => {
  const B = at(2026, 6, 24);
  const { c, t } = withTask({ start: B + 17 * HOUR, startClock: null });
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpSetTime('   ');
  assert.equal(c.state.datePick.ms, B, 'the draft returns to midnight');
  assert.equal(c.state.datePick.dpTimed, false);
  c.dpApply();
  assert.equal(t().start, B);
  assert.equal(t().startClock, null);
});

// ---------------------------------------------------------------------------
// draft behaviour
// ---------------------------------------------------------------------------
test('the draft is not committed until dpApply (Escape/outside-click cancels)', () => {
  const { c, t } = withTask();
  const before = t().start;
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpPickDay(at(2026, 6, 24, 0, 0));
  assert.equal(t().start, before, 'clicking a day only moves the draft');
  c.closeDatePick();
  assert.equal(t().start, before, 'cancelling discards the draft');
});

test('dpText: natural language drives the draft', () => {
  const { c } = withTask();
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpText('25 jul 2027 4pm');
  assert.equal(c.state.datePick.ms, at(2027, 6, 25, 16, 0));
});

test('dpText: unparseable text leaves the draft alone', () => {
  const { c } = withTask();
  c.openDatePick(fakeEvent(), 't1', 'start');
  const draft = c.state.datePick.ms;
  c.dpText('qqq');
  assert.equal(c.state.datePick.ms, draft);
  assert.equal(c.state.datePick.text, 'qqq', 'the text still echoes what was typed');
});

test('dpSetTime: accepts 24h, meridiem, and rejects junk', () => {
  const { c } = withTask();
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpSetTime('17:00');
  assert.equal(new Date(c.state.datePick.ms).getHours(), 17);
  c.dpSetTime('5pm');
  assert.equal(new Date(c.state.datePick.ms).getHours(), 17);
  const draft = c.state.datePick.ms;
  c.dpSetTime('nonsense');
  assert.equal(c.state.datePick.ms, draft);
});

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------
test('dpGrid: Monday-first, whole weeks, every day of the month present', () => {
  const c = make();
  const cells = c.dpGrid(at(2026, 6, 15)); // Jul 2026: 31 days, starts Wed
  assert.equal(cells.length % 7, 0, 'padded to whole weeks');
  assert.equal(cells.filter(x => x !== null).length, 31);
  assert.equal(cells[0], null, 'Jul 1 is a Wednesday, so Mon/Tue lead with blanks');
  assert.equal(cells[1], null);
  assert.equal(new Date(cells[2]).getDate(), 1, 'the 1st sits in the Wednesday column');
});

test('dpGrid: a month starting on Monday has no leading blanks', () => {
  const c = make();
  const cells = c.dpGrid(at(2026, 5, 15)); // Jun 2026 starts Mon
  assert.equal(new Date(cells[0]).getDate(), 1);
});

test('dpNudgeMonth: steps months without skipping (31st → shorter month)', () => {
  const { c } = withTask();
  c.openDatePick(fakeEvent(), 't1', 'start');
  c.dpSet({ view: at(2026, 0, 31) }); // Jan 31
  c.dpNudgeMonth(1);
  assert.equal(new Date(c.state.datePick.view).getMonth(), 1, 'Jan 31 + 1 month lands in February');
});

// ---------------------------------------------------------------------------
// V1.3 bar-as-editor — pure drag math
// snapDragMs: pixels dragged → a whole-day delta at every Gantt zoom. Bars encode
//   dates only; clock time remains available in the day timeline.
// barDragEdit: a drag gesture → {start,end}, ghost-aware (an UNtouched ghost edge
//   stays null — only the dragged edge is committed to a real date).
// ---------------------------------------------------------------------------
const DAY = 86400000;
const HOUR = 3600000;

test('snapDragMs: at day zoom, rounds the pixel drag to the nearest whole day', () => {
  const c = make();
  assert.equal(c.snapDragMs(0, 64, false), 0);
  assert.equal(c.snapDragMs(31, 64, false), 0, 'under half a column snaps back to 0');
  assert.equal(c.snapDragMs(33, 64, false), DAY, 'over half a column snaps forward one day');
  assert.equal(c.snapDragMs(128, 64, false), 2 * DAY);
  assert.equal(c.snapDragMs(-33, 64, false), -DAY, 'symmetric for leftward drags');
});

test('snapDragMs: at the widest day zoom still snaps to whole days', () => {
  const c = make();
  const z = c.GANTT_DAYW_MAX;
  assert.equal(c.snapDragMs(10, z, false), 0, 'sub-day drag cannot move a day-only bar');
  assert.equal(c.snapDragMs(z/2-1, z, false), 0, 'under half a day snaps back to 0');
  assert.equal(c.snapDragMs(z/2+1, z, false), DAY, 'over half a day moves one whole day');
  assert.equal(c.snapDragMs(-(z/2+1), z, false), -DAY, 'symmetric leftward');
});

test('snapDragMs: an all-day task stays day-snapped even when zoomed in', () => {
  const c = make();
  const z = c.GANTT_DAYW_MAX;
  assert.equal(c.snapDragMs(10, z, true), 0, 'a sub-day drag does not nudge an all-day task');
  assert.equal(c.snapDragMs(z/2+1, z, true), DAY, 'past half a day column it moves a whole day');
});

test('zoomScrollAnchor: keeps the timeline point under the cursor fixed across a zoom', () => {
  const c = make();
  // content point under cursor = scrollLeft(100) + cursorOffset(200) = 300 px at oldW.
  // doubling the scale puts it at 600 px; to keep it at viewport offset 200, scroll to 400.
  assert.equal(c.zoomScrollAnchor(40, 80, 100, 200), 400);
  // zooming out (halving) brings it back symmetrically.
  assert.equal(c.zoomScrollAnchor(80, 40, 400, 200), 100);
});

// zoomStep: one wheel event -> next dayW. Exponential + proportional to scroll delta, so a trackpad's
// many-tiny-events gesture and a mouse's few-big-events gesture zoom by how far they scrolled, not by
// event count; per-event step capped so one fast tick can't fly past.
test('zoomStep: scroll direction + proportionality (small delta = small change)', () => {
  const c = make();
  const w0 = 40;
  const inSmall = c.zoomStep(w0, -10);   // gentle trackpad tick up
  const inBig = c.zoomStep(w0, -100);    // full mouse notch up
  assert.ok(inSmall > w0, 'scroll up zooms in');
  assert.ok(inBig > inSmall, 'a larger delta zooms in more');
  assert.ok((inSmall - w0) / w0 < 0.05, 'a 10px delta nudges dayW under 5% (no fly-past)');
  assert.ok(c.zoomStep(w0, 100) < w0, 'scroll down zooms out');
});

test('zoomStep: a single very fast event is capped', () => {
  const c = make();
  const w0 = 40;
  const huge = c.zoomStep(w0, -100000);
  assert.ok(huge > w0);
  assert.ok(huge / w0 <= Math.exp(c.GANTT_ZOOM_STEP_CAP) + 1e-9, 'one event never exceeds the per-event cap');
});

test('zoomStep: respects the dayW clamp bounds', () => {
  const c = make();
  assert.equal(c.zoomStep(c.GANTT_DAYW_MAX, -100), c.GANTT_DAYW_MAX, 'cannot exceed max');
  assert.equal(c.zoomStep(c.GANTT_DAYW_MIN, 100), c.GANTT_DAYW_MIN, 'cannot go below min');
});

test('barDragEdit: solid bar — dragging the start edge moves start, leaves end', () => {
  const c = make();
  const s = at(2026, 6, 15, 9, 0), e = at(2026, 6, 20, 9, 0);
  const r = c.barDragEdit('start', 2 * DAY, s, e, s, e);
  assert.equal(r.start, at(2026, 6, 17, 9, 0));
  assert.equal(r.end, e, 'the untouched end is unchanged');
});

test('barDragEdit: solid bar — the start edge cannot cross the end (clamped to end-1d)', () => {
  const c = make();
  const s = at(2026, 6, 15, 9, 0), e = at(2026, 6, 20, 9, 0);
  const r = c.barDragEdit('start', 100 * DAY, s, e, s, e);
  assert.equal(r.start, e - DAY, 'start clamps to one day before the end');
});

test('barDragEdit: solid bar — the end edge cannot cross the start (clamped to start+1d)', () => {
  const c = make();
  const s = at(2026, 6, 15, 9, 0), e = at(2026, 6, 20, 9, 0);
  const r = c.barDragEdit('end', -100 * DAY, s, e, s, e);
  assert.equal(r.end, s + DAY);
});

test('barDragEdit: solid bar — body move shifts both edges by the delta', () => {
  const c = make();
  const s = at(2026, 6, 15, 9, 0), e = at(2026, 6, 20, 9, 0);
  const r = c.barDragEdit('move', 3 * DAY, s, e, s, e);
  assert.equal(r.start, at(2026, 6, 18, 9, 0));
  assert.equal(r.end, at(2026, 6, 23, 9, 0));
});

test('barDragEdit: civil-day moves preserve clock time across both Vancouver DST changes', () => {
  const c = make();
  const cases = [
    [at(2026, 2, 7, 9, 15), at(2026, 2, 8, 9, 15), 'spring-forward'],
    [at(2026, 9, 31, 9, 15), at(2026, 10, 1, 9, 15), 'fall-back'],
  ];
  for (const [start, expected, label] of cases) {
    const end = c.addLocalDays(start, 2);
    const r = c.barDragEdit('move', DAY, start, end, start, end);
    assert.equal(r.start, expected, label + ' lands on the next local date at the same clock time');
    assert.equal(new Date(r.start).getHours(), 9, label + ' does not drift the clock by an hour');
    assert.equal(new Date(r.start).getMinutes(), 15);
    assert.equal(r.end, c.addLocalDays(end, 1), label + ' shifts the far edge by its own civil day');
  }
});

test('civil Gantt day indexes stay integral across Vancouver spring-forward and fall-back', () => {
  const c = make();
  for (const [a, b, label] of [
    [at(2026, 2, 7), at(2026, 2, 8), 'spring-forward'],
    [at(2026, 9, 31), at(2026, 10, 1), 'fall-back'],
  ]) {
    assert.equal(c.ganttDayIndex(b, a), 1, label + ' adjacent local midnights are one column apart');
    assert.equal(c.ganttDayAt(a, 1), b, label + ' header day lookup uses local calendar addition');
  }
});

test('recurrence drag scopes use civil days and keep clock time through DST', () => {
  const start = at(2026, 2, 7, 9, 15), end = at(2026, 2, 7, 10, 15);
  const { c, t } = withTask({ start, end, recur: { kind: 'day', n: 1, label: 'Daily', overrides: {}, shifts: [] } });
  c._occById = { t1: [{ idx: 0, start, end }] };

  c.state.scopePrompt = { kind: 'date', taskId: 't1', occIdx: 0, payload: { mode: 'move', deltaMs: DAY } };
  c.applyScope('this');
  assert.equal(t().recur.overrides[0].start, at(2026, 2, 8, 9, 15), 'this occurrence keeps 09:15');
  assert.equal(t().recur.overrides[0].end, at(2026, 2, 8, 10, 15), 'each edge keeps its own clock');

  c.state.scopePrompt = { kind: 'date', taskId: 't1', occIdx: 0, payload: { mode: 'move', deltaMs: DAY } };
  c.applyScope('subsequent');
  assert.equal(t().recur.shifts[0].from, 0);
  assert.equal(t().recur.shifts[0].days, 1, 'new subsequent shifts persist civil-day provenance');
  const expanded = c.expandTask(t(), at(2026, 2, 12));
  assert.equal(new Date(expanded[0].start).getHours(), 9, 'expanded subsequent occurrence does not drift to 10:15');

  c.state.scopePrompt = { kind: 'date', taskId: 't1', occIdx: 0, payload: { mode: 'move', deltaMs: DAY } };
  c.applyScope('all');
  assert.equal(t().start, at(2026, 2, 8, 9, 15), 'whole series base keeps clock time');
  assert.equal(t().end, at(2026, 2, 8, 10, 15));
});

test('barDragEdit: deadline ghost (start=null) — dragging the ghost START commits a real start, keeps the real due', () => {
  const c = make();
  const today = c.startOfToday();
  const due = today + 30 * DAY;
  // occ carries the DERIVED span (ghost start = today); data start is null.
  const r = c.barDragEdit('start', 1 * DAY, today, due, null, due);
  assert.equal(r.start, today + DAY, 'the ghost start becomes a real date');
  assert.equal(r.end, due, 'the already-real due is preserved');
});

test('barDragEdit: deadline ghost — dragging the real END leaves the START null (does not de-ghost it)', () => {
  const c = make();
  const today = c.startOfToday();
  const due = today + 30 * DAY;
  const r = c.barDragEdit('end', 2 * DAY, today, due, null, due);
  assert.equal(r.start, null, 'the untouched ghost start stays null');
  assert.equal(r.end, due + 2 * DAY);
});

test('barDragEdit: half-ghost (end=null) — dragging the real START leaves the END null (the V1.2 bug fix)', () => {
  const c = make();
  const start = at(2026, 6, 10, 9, 0);
  const derivedEnd = c.startOfToday() + DAY;
  const r = c.barDragEdit('start', 1 * DAY, start, derivedEnd, start, null);
  assert.equal(r.end, null, 'dragging the start must NOT stamp the derived ghost end');
  assert.equal(r.start, start + DAY);
});

test('barDragEdit: half-ghost — dragging the ghost END commits a real end, keeps the real start', () => {
  const c = make();
  const start = at(2026, 6, 10, 9, 0);
  const derivedEnd = start + DAY; // clamp floor is start+DAY
  const r = c.barDragEdit('end', 3 * DAY, start, derivedEnd, start, null);
  assert.equal(r.start, start, 'the already-real start is preserved');
  assert.equal(r.end, derivedEnd + 3 * DAY, 'the ghost end becomes a real date');
});

test('barDragEdit: double-ghost (both null) — dragging one edge commits only that edge', () => {
  const c = make();
  const today = c.startOfToday();
  const rs = c.barDragEdit('start', 0, today, today + DAY, null, null);
  assert.equal(rs.start, today, 'start is committed');
  assert.equal(rs.end, null, 'end stays a ghost');
  const re = c.barDragEdit('end', 0, today, today + DAY, null, null);
  assert.equal(re.start, null, 'start stays a ghost');
  assert.equal(re.end, today + DAY, 'end is committed');
});

test('barDragEdit: double-ghost — a body move places the whole span (both become real)', () => {
  const c = make();
  const today = c.startOfToday();
  const r = c.barDragEdit('move', 0, today, today + DAY, null, null);
  assert.equal(r.start, today);
  assert.equal(r.end, today + DAY);
});

// A click event stands in for the DOM one openDatePick reads for anchor positioning.
function fakeEvent() {
  return {
    stopPropagation() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 100, bottom: 200 }) },
  };
}

// ---------------------------------------------------------------------------
// V1.4 — right-click bar menu: null-back-to-ghost, pins, repeat presets, and the
// CSS-`zoom` coordinate conversion every cursor-anchored overlay now goes through.
// ---------------------------------------------------------------------------

// The bar's right-click handler only needs these three members off a DOM event.
function ctxEvent(x, y) {
  return { preventDefault() {}, stopPropagation() {}, clientX: x == null ? 400 : x, clientY: y == null ? 300 : y };
}

test('scaleFixedPt: divides a client point by the wrapper scale (fixed overlays paint at left*zoom)', () => {
  const c = make();
  const p = c.scaleFixedPt(1200, 600, 0.8);
  assert.equal(p.x, 1500, 'left:1500 inside zoom:0.8 paints at 1200 = the cursor');
  assert.equal(p.y, 750);
});

test('scaleFixedPt: a missing/zero/unity scale is an identity (unzoomed embed keeps working)', () => {
  const c = make();
  for (const k of [1, 0, null, undefined]) {
    const p = c.scaleFixedPt(120, 40, k);
    assert.equal(p.x, 120, 'scale ' + k + ' → x unchanged');
    assert.equal(p.y, 40, 'scale ' + k + ' → y unchanged');
  }
});

test('uiScale: 1 when there is no measurable root (Node/vm, or before mount)', () => {
  const c = make();
  assert.equal(c.uiScale(), 1);
  const p = c.uiPt(400, 300);
  assert.equal(p.x, 400);
  assert.equal(p.y, 300);
});

test('openBarMenu: selects the bar and remembers BOTH the overlay point and the raw client point', () => {
  const { c } = withTask();
  c.openBarMenu(ctxEvent(640, 480), c.state.tasks[0], 0);
  const m = c.state.barMenu;
  assert.equal(m.id, 't1');
  assert.equal(m.occIdx, 0);
  assert.equal(m.cx, 640, 'client point kept for the child popups');
  assert.equal(m.cy, 480);
  assert.equal(m.x, 640, 'overlay point (unzoomed in tests)');
  assert.equal(m.y, 480);
  assert.equal(c.state.selectedIds.join(), 't1');
  assert.equal(c.state.menu, null, 'the row menu never shows at the same time');
});

// --- null-back-to-ghost: the de-commit escape hatch a drag cannot express ---
test('canClearDate: a dated non-recurring edge may go back to a ghost', () => {
  const { c, t } = withTask();
  assert.equal(c.canClearDate(t(), 'start').ok, true);
  assert.equal(c.canClearDate(t(), 'end').ok, true);
});

test('canClearDate: an already-null edge offers nothing to clear', () => {
  const { c, t } = withTask({ start: null });
  const r = c.canClearDate(t(), 'start');
  assert.equal(r.ok, false);
  assert.match(r.why, /already a ghost/);
});

test('canClearDate: a repeating task refuses — an unscheduled recur renders NO bar at all', () => {
  const { c, t } = withTask({ recur: { kind: 'week', n: 1, label: 'Weekly' } });
  const r = c.canClearDate(t(), 'end');
  assert.equal(r.ok, false);
  assert.match(r.why, /repeat/, 'the reason names the repeat, so the menu tooltip explains itself');
});

test('clearDate via the menu returns the edge to a DERIVED ghost (no residual date)', () => {
  const { c, t } = withTask();
  c.clearDate('t1', 'start');
  assert.equal(t().start, null, 'the data value is gone, not overwritten with a derived one');
  assert.equal(c.isScheduled(t()), false);
  const g = c.ghostSpan(t(), c.startOfToday());
  assert.equal(g.ghostStart, true, 'the left edge now renders as a ghost');
  assert.equal(g.ghostEnd, false, 'the untouched due edge stays real');
});

test('each remaining menu mutation is exactly ONE undo entry', () => {
  const { c } = withTask();
  const n = c.history.length;
  c.clearDate('t1', 'start');
  assert.equal(c.history.length, n + 1, 'clear → 1');
  c.setRecur('t1', 'week');
  assert.equal(c.history.length, n + 2, 'repeat → 1');
});

// --- repeat presets ---
test('recurPresetKey: none / a preset rule / a parser-only custom rule', () => {
  const { c, t } = withTask();
  assert.equal(c.recurPresetKey(t()), 'none');
  c.setRecur('t1', 'week');
  assert.equal(c.recurPresetKey(t()), 'week');
  c.commit(tasks => { tasks[0].recur = { kind: 'weekdays', days: ['mon', 'wed'], label: 'every mon, wed' }; });
  assert.equal(c.recurPresetKey(t()), null, 'a weekdays set has no preset row → shown read-only as Custom');
});

test('setRecur: applies a preset in the shape parseDateText emits (so expandTask needs no new case)', () => {
  const { c, t } = withTask();
  c.setRecur('t1', 'week');
  assert.equal(t().recur.kind, 'week');
  assert.equal(t().recur.n, 1);
  assert.equal(t().recur.label, 'Weekly');
  assert.equal(Object.keys(t().recur.overrides).length, 0);
  assert.equal(t().recur.shifts.length, 0);
});

test("setRecur('none') clears the rule outright", () => {
  const { c, t } = withTask({ recur: { kind: 'week', n: 1, label: 'Weekly', overrides: {}, shifts: [] } });
  c.setRecur('t1', 'none');
  assert.equal(t().recur, null);
});

test('setRecur: changing the rule DROPS occurrence-indexed state (idx 3 is a different date now)', () => {
  const { c, t } = withTask({ recur: { kind: 'week', n: 1, label: 'Weekly', overrides: { 3: { pct: 50 } }, shifts: [{ idx: 2, ms: 1 }], until: 123 } });
  c.setRecur('t1', 'month');
  assert.equal(t().recur.kind, 'month');
  assert.equal(Object.keys(t().recur.overrides).length, 0, 'per-occurrence progress does not carry across rules');
  assert.equal(t().recur.shifts.length, 0);
  assert.equal(t().recur.until, null);
});

test('setRecur: re-picking the ACTIVE preset keeps overrides/shifts/until intact', () => {
  const { c, t } = withTask({ recur: { kind: 'week', n: 1, label: 'Weekly', overrides: { 3: { pct: 50 } }, shifts: [{ idx: 2, ms: 1 }], until: 123 } });
  c.setRecur('t1', 'week');
  assert.equal(t().recur.overrides[3].pct, 50);
  assert.equal(t().recur.shifts.length, 1);
  assert.equal(t().recur.shifts[0].idx, 2);
  assert.equal(t().recur.until, 123);
});

test('setRecur on a GHOST commits the derived span first — a repeat needs a real anchor', () => {
  const { c, t } = withTask({ start: null, end: null });
  const today = c.startOfToday();
  c.setRecur('t1', 'day');
  assert.equal(t().start, today, 'the double-ghost derived start is now real data');
  // owner 2026-08-20 (task 11): the derived span now closes at 23:59:59.999 so day-membership tests put
  // an undated task on today only — but a non-midnight timestamp is what `hasEndTime` reads as a typed
  // end CLOCK. So the commit rounds up to the clean boundary: membership wants the closed span, stored
  // data wants midnight.
  assert.equal(t().end, today + 86400000, 'persisted on a midnight boundary, not at 23:59:59.999');
  assert.equal(c.hasEndTime(t()), false, 'de-ghosting must not invent an end clock');
  assert.equal(c.isScheduled(t()), true, 'so expandTask can produce occurrences (and the bar still exists)');
});
