const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

/* Chain A, Task 15 — ONE duration grammar, shared by every field that takes a duration.
 *
 * The owner's point was not that `m` and `h` were missing from one box: *"just one example there might
 * be more"*. Three fields each with their own idea of what `90` means is the failure being prevented, so
 * the table below is the grammar, pinned verbatim, and every field routes through the one helper.
 *
 * DAYS ARE DELIBERATELY UNSUPPORTED — see the comment on `parseDurationText`.
 */

const TABLE = [
  ['90', 90],
  ['90m', 90], ['90 min', 90], ['90 mins', 90], ['90 minute', 90], ['90 minutes', 90],
  ['2h', 120], ['2 hr', 120], ['2 hrs', 120], ['2 hour', 120], ['2 hours', 120],
  ['1h30', 90], ['1h30m', 90], ['1:30', 90],
  ['1.5h', 90],
  ['.5h', 30],
];
const INVALID = ['1d', '1 day', 'garbage', '', '   ', null, undefined, '—'];

test('duration grammar: every row of the owner\'s table', () => {
  const c = make();
  for (const [input, min] of TABLE) {
    assert.equal(c.parseDurationText(input), min, JSON.stringify(input));
  }
});

test('duration grammar: invalid input is null, never a guess', () => {
  const c = make();
  for (const input of INVALID) {
    assert.equal(c.parseDurationText(input), null, JSON.stringify(input));
  }
});

test('duration grammar: case-insensitive and whitespace-tolerant', () => {
  const c = make();
  assert.equal(c.parseDurationText('1 H 30 M'), c.parseDurationText('1h30m'));
  assert.equal(c.parseDurationText('  2 HOURS  '), 120);
  assert.equal(c.parseDurationText('90 MINUTES'), 90);
});

test('duration grammar: days are rejected rather than guessed', () => {
  const c = make();
  // A day of planned work is ambiguous between 24 hours and a working day, and guessing wrong silently
  // corrupts an estimate. Rejecting is the honest answer; changing it needs an owner ruling.
  assert.equal(c.parseDurationText('1d'), null);
  assert.equal(c.parseDurationText('2 days'), null);
});

test('duration grammar: every duration field routes through the one helper', () => {
  const c = make();
  // The planned field — nullable, so blank stays "no estimate" rather than becoming zero.
  assert.equal(c.parsePlannedDur('90m'), 90);
  assert.equal(c.parsePlannedDur('1.5h'), 90);
  assert.equal(c.parsePlannedDur(''), null, 'blank still means "no estimate"');
  assert.equal(c.parsePlannedDur('0'), 0, 'and a typed 0 is still a decision');

  // Every other duration field — blank means zero, which is the contract they were written against.
  assert.equal(c.parseDur('90m'), 90);
  assert.equal(c.parseDur('2 hrs'), 120);
  assert.equal(c.parseDur(''), 0);

  // The snooze field takes the same grammar for a duration, and still hands anything else to chrono.
  const now = c.startOfDay(Date.now()) + 9 * 3600000;
  assert.equal(c.parseSnoozeText('2h', now), c.startOfDay(now) + c.DAY,
    'a sub-day snooze still floors forward to tomorrow — that rule is unchanged');
});

test('duration grammar: an invalid duration leaves the value alone', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a', type: 'Proportional',
    start: B, end: B + c.DAY, priority: 4, deps: [], pct: 0, planned: 75, spent: 0 })];
  const got = () => c.state.tasks.find(x => x.id === 'a');

  c.setPlanned('a', 'garbage');
  assert.equal(got().planned, 75, 'garbage does not wipe an estimate');
  c.setPlanned('a', '1d');
  assert.equal(got().planned, 75, 'and neither does the one unit we refuse');

  c.setPlanned('a', '');
  assert.equal(got().planned, null, 'clearing the box is still how you say "no estimate"');
});

test('duration grammar: a bare number is MINUTES, per the owner table', () => {
  const c = make();
  // This is a deliberate change of meaning: `parseDur` used to read a bare number as decimal HOURS, so
  // "90" meant ninety hours. The table says 90 minutes, and one grammar means one answer everywhere.
  // H:MM is how you type hours now, and it always was.
  assert.equal(c.parseDur('90'), 90);
  assert.equal(c.parseDur('2'), 2);
  assert.equal(c.parseDur('2h'), 120, 'and the unit is right there when you want hours');
  assert.equal(c.parseDur('2:00'), 120);
});
