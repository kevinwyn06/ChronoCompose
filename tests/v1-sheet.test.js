const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

test('V1.5 sheet schema drops the fields edited on the Gantt bar', () => {
  const c = make();
  const keys = c.colDefs().map(col => col.k);

  assert.equal(keys.includes('start'), false, 'Start is edited from the bar');
  assert.equal(keys.includes('end'), false, 'Due is edited from the bar');
  /* Owner 2026-08-15 reversed the % Done half of this rule: "I would prefer to add percent complete back
     as a column which then updates the gantt bars." Dates stay bar-only — they are a two-ended span and a
     column would need two cells — but a percentage is one scalar, so it earns a cell. */
  assert.ok(keys.includes('pct'), '% Done is a column again (owner 2026-08-15)');
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

/* Owner report 2026-08-13: "a task right now that is overdue, from today, but it's green and not red."
   The chip's tone is now one ordered ladder (dueChipState); every rung is pinned here. */
test('dueChipState: overdue outranks every other rung', () => {
  const c = make();
  const today = new Date(2026, 7, 13).setHours(0, 0, 0, 0);
  const at = (days, h) => today + days * DAY + h * 60 * 60 * 1000;
  const now = at(0, 14);   // 14:00 today

  // THE REPORTED CASE: due earlier today with a typed clock, still open → overdue, not 'today'.
  assert.equal(c.dueChipState({ end: at(0, 9), pct: 0 }, now, true), 'overdue',
    'due at 09:00, now 14:00 → overdue beats the same-calendar-day rung');
  // Overdue outranks the recurrence rung too: a repeating task with a late due edge is late.
  assert.equal(c.dueChipState({ end: at(0, 9), pct: 0, recur: { label: 'Daily' } }, now, true), 'overdue');
  // A typed time still ahead of now today is not overdue.
  assert.equal(c.dueChipState({ end: at(0, 18), pct: 0 }, now, true), 'today');
  // Yesterday, timed or not, is overdue.
  assert.equal(c.dueChipState({ end: at(-1, 9), pct: 0 }, now, true), 'overdue');
  assert.equal(c.dueChipState({ end: at(-1, 0), pct: 0 }, now, false), 'overdue');
});

test('dueChipState: an untimed due date is not overdue mid-day', () => {
  const c = make();
  const today = new Date(2026, 7, 13).setHours(0, 0, 0, 0);
  const now = today + 14 * 60 * 60 * 1000;

  // Ruling: a bare date carries no clock, so 09:00 having passed means nothing to it.
  assert.equal(c.dueChipState({ end: today, pct: 0 }, now, false), 'today',
    'bare midnight due date stays today all day');
  // All-day tasks are untimed by construction even though their exclusive end is a midnight.
  assert.equal(c.dueChipState({ end: today + DAY, allDay: true, pct: 0 }, now, true), 'today');
  assert.equal(c.dueChipState({ end: today, allDay: true, pct: 0 }, now, true), 'overdue',
    'an all-day task whose visible day is yesterday is overdue');
});

test('dueChipState: done, recur, and the plain calendar rungs', () => {
  const c = make();
  const today = new Date(2026, 7, 13).setHours(0, 0, 0, 0);
  const at = (days, h) => today + days * DAY + h * 60 * 60 * 1000;
  const now = at(0, 14);

  assert.equal(c.dueChipState({ end: at(0, 9), pct: 100 }, now, true), 'today',
    'a completed task is not late, so it never reaches the overdue rung');
  assert.equal(c.dueChipState({ end: at(-3, 9), pct: 100 }, now, true), 'later');
  assert.equal(c.dueChipState({ end: null, recur: { label: 'Daily' } }, now, false), 'recur');
  assert.equal(c.dueChipState({ end: null }, now, false), null);
  assert.equal(c.dueChipState({ end: at(1, 9), pct: 0 }, now, true), 'tomorrow');
  assert.equal(c.dueChipState({ end: at(7, 9), pct: 0 }, now, true), 'week');
  assert.equal(c.dueChipState({ end: at(8, 9), pct: 0 }, now, true), 'later');
  assert.deepEqual(c.DUE_TONE_ORDER().indexOf('overdue') < c.DUE_TONE_ORDER().indexOf('today'), true);
});
