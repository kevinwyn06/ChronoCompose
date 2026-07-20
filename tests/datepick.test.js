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

// A click event stands in for the DOM one openDatePick reads for anchor positioning.
function fakeEvent() {
  return {
    stopPropagation() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 100, bottom: 200 }) },
  };
}
