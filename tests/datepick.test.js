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
// snapDragMs: pixels dragged → a snapped time delta (ms). Whole DAYS at day/week
//   zoom; whole HOURS once zoomed into the hour grid (dayW >= GANTT_HOUR_GRID_DAYW),
//   so a small drag on a narrow bar still moves it and tracks the cursor. all-day
//   tasks stay day-snapped at every zoom (they own midnight-based exclusive ends).
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

test('snapDragMs: zoomed into the hour grid, snaps to whole hours so small drags register', () => {
  const c = make();
  const z = c.GANTT_HOUR_GRID_DAYW; // 240 px/day => 10 px/hr
  assert.equal(c.snapDragMs(10, z, false), HOUR, 'one hour column of drag = one hour');
  assert.equal(c.snapDragMs(25, z, false), 3 * HOUR, 'rounds to the nearest hour');
  assert.equal(c.snapDragMs(4, z, false), 0, 'under half an hour column snaps back to 0');
  assert.equal(c.snapDragMs(-10, z, false), -HOUR, 'symmetric leftward');
});

test('snapDragMs: an all-day task stays day-snapped even when zoomed in', () => {
  const c = make();
  const z = c.GANTT_HOUR_GRID_DAYW;
  assert.equal(c.snapDragMs(10, z, true), 0, 'a sub-day drag does not nudge an all-day task');
  assert.equal(c.snapDragMs(130, z, true), DAY, 'past half a day column it moves a whole day');
});

test('zoomScrollAnchor: keeps the timeline point under the cursor fixed across a zoom', () => {
  const c = make();
  // content point under cursor = scrollLeft(100) + cursorOffset(200) = 300 px at oldW.
  // doubling the scale puts it at 600 px; to keep it at viewport offset 200, scroll to 400.
  assert.equal(c.zoomScrollAnchor(40, 80, 100, 200), 400);
  // zooming out (halving) brings it back symmetrically.
  assert.equal(c.zoomScrollAnchor(80, 40, 400, 200), 100);
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

test('barDragEdit: deadline ghost (start=null) — dragging the ghost START commits a real start, keeps the real due', () => {
  const c = make();
  const today = c.startOfToday();
  const due = at(2026, 6, 30, 9, 0);
  // occ carries the DERIVED span (ghost start = today); data start is null.
  const r = c.barDragEdit('start', 1 * DAY, today, due, null, due);
  assert.equal(r.start, today + DAY, 'the ghost start becomes a real date');
  assert.equal(r.end, due, 'the already-real due is preserved');
});

test('barDragEdit: deadline ghost — dragging the real END leaves the START null (does not de-ghost it)', () => {
  const c = make();
  const today = c.startOfToday();
  const due = at(2026, 6, 30, 9, 0);
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
