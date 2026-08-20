// Owner, 2026-08-19: "I'll think 'okay this task is 10pm, I want it to be 9pm instead' and type 9 only
// for it to end up as 9am." Decision: keep the current field's meridiem.
//
// `clockH(tok, inherit)` already accepted an inherited meridiem — the clock-RANGE parser uses it so
// "9 to 10:30am" reads the bare 9 as am. This wires the same mechanism to the single-field case.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

const H = 3600000;
const win = { start: '07:00', end: '23:00' };

test('bare hour: an explicit meridiem always wins', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  assert.equal(c.resolveBareHour(c.parseClockTok('9p'), B + 8 * H, win, null), 21);
  assert.equal(c.resolveBareHour(c.parseClockTok('9am'), B + 22 * H, win, null), 9);
});

test('bare hour: an hour above 12 passes through untouched', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  // The guard that matters: clockH does h%12 before adding 12, so 17 with an inherited `am`
  // would resolve to 5am.
  assert.equal(c.resolveBareHour(c.parseClockTok('17'), B + 8 * H, win, null), 17);
  assert.equal(c.resolveBareHour(c.parseClockTok('23'), B + 8 * H, win, null), 23);
});

test('bare hour: the field\'s own meridiem is inherited', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  assert.equal(c.resolveBareHour(c.parseClockTok('9'), B + 22 * H, win, null), 21, '10pm + "9" -> 9pm');
  assert.equal(c.resolveBareHour(c.parseClockTok('9'), B + 8 * H, win, null), 9, '8am + "9" -> 9am');
  assert.equal(c.resolveBareHour(c.parseClockTok('12'), B + 22 * H, win, null), 12, 'noon/midnight is not ambiguous by hour');
});

test('bare hour: an empty field falls back to the day window', () => {
  const c = make();
  assert.equal(c.resolveBareHour(c.parseClockTok('9'), null, win, null), 9, '9am is inside 07:00-23:00, 9pm too — prefer am');
  assert.equal(c.resolveBareHour(c.parseClockTok('6'), null, win, null), 18, '6am is outside the window; 6pm is inside');
});

test('bare hour: a tie breaks toward the task\'s other clock', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  assert.equal(c.resolveBareHour(c.parseClockTok('9'), null, win, B + 20 * H), 21,
    'editing the end of a task starting at 8pm, "9" means 9pm');
});
