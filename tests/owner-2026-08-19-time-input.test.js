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

// Owner decision: "Start moves end; end sets duration."
//   9:00-10:00 (1h)  set start 8:00 -> 8:00-9:00  (1h kept)
//                    set end  11:00 -> 9:00-11:00 (2h, deliberately)

function clocked(c, B, id, startH, endH) {
  return c.normalizeTask({ id, name: id, type: 'Proportional', included: true,
    start: B + startH * H, end: B + endH * H, startClock: true, endClock: true,
    uncompressable: true, priority: 4, deps: [], pct: 0, planned: 60, spent: 0 });
}

test('duration preserved: moving the start slides the end', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [clocked(c, B, 'a', 9, 10)];
  c.setDate('a', 'start', B + 8 * H, true);
  const t = c.state.tasks.find(x => x.id === 'a');
  assert.equal(t.start, B + 8 * H);
  assert.equal(t.end, B + 9 * H, 'the end slid by the same delta');
  assert.equal(t.planned, 60, 'the span is still the plan, and the span did not change');
});

test('duration preserved: moving the end changes the duration', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [clocked(c, B, 'a', 9, 10)];
  c.setDate('a', 'end', B + 11 * H, true);
  const t = c.state.tasks.find(x => x.id === 'a');
  assert.equal(t.start, B + 9 * H, 'the start held');
  assert.equal(t.planned, 120, 'an end edit is how you change a duration');
});

test('duration preserved: a multi-day window\'s end is not dragged', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  // Mon 09:00 -> Fri 17:00: hasStartTime && hasEndTime is TRUE here, clockSpanMinutes is null.
  const t0 = c.normalizeTask({ id: 'w', name: 'w', type: 'Proportional', included: true,
    start: B + 9 * H, end: B + 4 * DAY + 17 * H, startClock: true, endClock: true,
    priority: 4, deps: [], pct: 0, planned: 300, spent: 0 });
  c.state.tasks = [t0];
  c.setDate('w', 'start', B + 8 * H, true);
  assert.equal(c.state.tasks[0].end, B + 4 * DAY + 17 * H, 'a window is not an appointment');
});

test('duration preserved: one clock only is untouched', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t0 = c.normalizeTask({ id: 'd', name: 'd', type: 'Proportional', included: true,
    start: null, end: B + 17 * H, endClock: true, priority: 4, deps: [], pct: 0, planned: 30, spent: 0 });
  c.state.tasks = [t0];
  c.setDate('d', 'end', B + 18 * H, true);
  assert.equal(c.state.tasks[0].start, null);
});
