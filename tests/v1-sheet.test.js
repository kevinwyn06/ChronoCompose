const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

test('V1.5 sheet schema drops the fields edited on the Gantt bar', () => {
  const c = make();
  const keys = c.colDefs().map(col => col.k);

  assert.equal(keys.includes('start'), false, 'Start is edited from the bar');
  assert.equal(keys.includes('end'), false, 'Due is edited from the bar');
  assert.equal(keys.includes('pct'), false, '% Done is edited from the bar');
  assert.ok(keys.includes('name'), 'task name remains');
  assert.ok(keys.includes('planned'), 'planned → allotted remains as one composite readout');
  assert.equal(keys.includes('predicted'), false, 'allotted is no longer a spreadsheet column');
  assert.ok(keys.includes('actions'), 'row actions remain reachable');
});

test('dueChipClass assigns the five owner-defined date buckets', () => {
  const c = make();
  const today = new Date(2026, 7, 3).setHours(0, 0, 0, 0);
  const atNoon = days => today + days * DAY + 12 * 60 * 60 * 1000;
  const task = end => ({ end, pct: 0 });

  assert.equal(c.dueChipClass(task(atNoon(-1)), today), 'overdue');
  assert.equal(c.dueChipClass(task(atNoon(0)), today), 'today');
  assert.equal(c.dueChipClass(task(atNoon(1)), today), 'tomorrow');
  assert.equal(c.dueChipClass(task(atNoon(7)), today), 'week');
  assert.equal(c.dueChipClass(task(atNoon(8)), today), 'later');
  assert.equal(c.dueChipClass({ end: atNoon(-1), pct: 100 }, today), 'later',
    'a completed past task is no longer overdue');
});

test('dueChipClass treats all-day exclusive ends as their visible due day', () => {
  const c = make();
  const today = new Date(2026, 7, 3).setHours(0, 0, 0, 0);

  assert.equal(c.dueChipClass({ end: today + DAY, allDay: true, pct: 0 }, today), 'today');
  assert.equal(c.dueChipClass({ end: null, allDay: false, pct: 0 }, today), null);
});
