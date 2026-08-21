const test = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load.js');

/* Chain A, Task 13 — ONE 12-hour clock formatter.
 *
 * The owner found the app rendering a time of day four different ways: 24-hour `HH:MM` on the day-bound
 * drag readout and in the long date label, a locale default in the sheet's date cells, and two private
 * 12-hour copies (`clockLabel`, a local `fmtClock` inside the Schedule view) that agreed with each other
 * only by luck. This file pins the single formatter and the boundaries where 12-hour clocks break.
 *
 * DURATIONS ARE NOT CLOCK TIMES and are deliberately untested here beyond one guard: `fmtDur` still
 * renders `H:MM`. Conflating the two would turn "1:30 of work" into "1:30am".
 */

const at = (c, h, m) => c.startOfToday() + h * 3600000 + (m || 0) * 60000;

test('clock format: 12-hour output, zero-padded minutes, lowercase meridiem', () => {
  const c = make();
  assert.strictEqual(c.fmtClock(at(c, 21, 0)), '9:00pm');
  assert.strictEqual(c.fmtClock(at(c, 9, 5)), '9:05am');
  assert.strictEqual(c.fmtClock(at(c, 13, 45)), '1:45pm');
});

test('clock format: midnight and noon are the cases 12-hour formatters get wrong', () => {
  const c = make();
  assert.strictEqual(c.fmtClock(at(c, 0, 0)), '12:00am', 'midnight is 12am, never 0am');
  assert.strictEqual(c.fmtClock(at(c, 12, 0)), '12:00pm', 'noon is 12pm, never 0pm');
  assert.strictEqual(c.fmtClock(at(c, 0, 30)), '12:30am');
  assert.strictEqual(c.fmtClock(at(c, 12, 30)), '12:30pm');
  assert.strictEqual(c.fmtClock(at(c, 23, 59)), '11:59pm');
});

test('clock format: the compact variant drops a zero minute, and only that', () => {
  const c = make();
  assert.strictEqual(c.fmtClock(at(c, 9, 0), { compact: true }), '9am');
  assert.strictEqual(c.fmtClock(at(c, 9, 30), { compact: true }), '9:30am');
  assert.strictEqual(c.fmtClock(at(c, 0, 0), { compact: true }), '12am');
  assert.strictEqual(c.fmtClock(at(c, 12, 0), { compact: true }), '12pm');
});

test('clock format: the minutes-of-day entry point agrees with the ms one', () => {
  const c = make();
  for (const [h, m] of [[0,0],[0,15],[9,5],[12,0],[13,45],[23,59]]) {
    assert.strictEqual(c.fmtClockMins(h * 60 + m), c.fmtClock(at(c, h, m)), h + ':' + m);
  }
  // 1440 is the day-END bound: a real, reachable value that is midnight at the far edge, not 24am.
  assert.strictEqual(c.fmtClockMins(24 * 60), '12:00am');
});

test('clock format: every clock renderer routes through the one formatter', () => {
  const c = make();
  const ms = at(c, 21, 0);

  // `clockLabel` is a Design method and keeps its name; its BODY now delegates, so the notification
  // bodies that read it say the same thing the rest of the app does.
  assert.strictEqual(c.clockLabel(ms), c.fmtClock(ms));
  // The parser chooser's short label is the compact variant, not a third private copy.
  assert.strictEqual(c._fmtClockLabel(at(c, 9, 0)), c.fmtClock(at(c, 9, 0), { compact: true }));
  // The long date label carries a real clock, not a 24-hour one.
  assert.match(c.fmtDT(ms), /9:00pm$/);
  assert.ok(!/21:00/.test(c.fmtDT(ms)), 'no 24-hour clock survives in the date label');
  // The sheet's compact date cell defers to the same formatter instead of the browser locale.
  const t = c.normalizeTask({ id: 'x', name: 'x', start: ms, end: ms + DAY, startClock: true });
  assert.strictEqual(c.sheetDateParts(t, 'start').time, '9:00pm');
});

test('clock format: durations are untouched and still render H:MM', () => {
  const c = make();
  assert.strictEqual(c.fmtDur(90), '1:30');
  assert.strictEqual(c.fmtDur(600), '10:00', 'ten hours of work is not ten in the morning');
});
