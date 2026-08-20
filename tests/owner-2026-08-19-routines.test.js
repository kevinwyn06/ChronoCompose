// Owner, 2026-08-19: "Instead of having lunch and dinner be hardcoded options, have breakfast lunch
// dinner wakeup shutdown routines be default tasks included for new users in an appropriately named
// section." Decision: seed for new users, MIGRATE existing.
//
// Lunch and Dinner were two addBusy calls with no task behind them (index.html:2783-2784) — they could
// not be renamed, moved for a day, completed, or given a duration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

const H = 3600000;

test('routines: a new workspace seeds the five routine tasks', () => {
  const c = make();
  c.seedRoutines();
  const sec = c.state.sections.find(s => s.name === 'Routines');
  assert.ok(sec, 'the section exists');
  const names = c.state.tasks.filter(t => t.sectionId === sec.id).map(t => t.name).sort();
  assert.deepEqual([...names], ['Breakfast', 'Dinner', 'Lunch', 'Shut down', 'Wake up']);
});

test('routines: Wake up and Shut down are Points', () => {
  const c = make();
  c.seedRoutines();
  const wake = c.state.tasks.find(t => t.name === 'Wake up');
  assert.equal(wake.end, null);
  assert.equal(wake.planned, 0);
  assert.equal(c.isPointTask(wake), true, 'a Point reserves no duration but divides packing intervals');
});

test('routines: the migration carries a moved lunch', () => {
  const c = make();
  Object.assign(c.state.settings, { lunchStart: '13:00', lunchEnd: '13:45',
                                    dinnerStart: '18:00', dinnerEnd: '18:30' });
  c.migrateRoutines();
  const lunch = c.state.tasks.find(t => t.name === 'Lunch');
  assert.equal(new Date(lunch.start).getHours(), 13);
  assert.equal(Math.round((lunch.end - lunch.start) / 60000), 45, 'a user who moved lunch keeps it');
});

// The migration carries ONLY what the four settings encoded. Seeding Breakfast into an existing
// workspace would reserve 30 minutes a day it never had — the exact regression the next test forbids.
test('routines: the migration adds no meal the workspace did not already have', () => {
  const c = make();
  c.migrateRoutines();
  const names = c.state.tasks.map(t => t.name);
  assert.equal(names.indexOf('Breakfast'), -1, 'an existing day does not silently lose 30 minutes');
  assert.ok(names.indexOf('Lunch') >= 0 && names.indexOf('Dinner') >= 0);
});

test('routines: the migration runs exactly once', () => {
  const c = make();
  Object.assign(c.state.settings, { lunchStart: '12:30', lunchEnd: '13:00',
                                    dinnerStart: '17:30', dinnerEnd: '18:00' });
  c.migrateRoutines();
  c.state.tasks = c.state.tasks.filter(t => t.name !== 'Lunch');   // the user deletes Lunch
  c.migrateRoutines();
  assert.equal(c.state.tasks.filter(t => t.name === 'Lunch').length, 0, 'a deleted routine stays deleted');
});

// THE regression: the day a migrated workspace sees must be minute-identical to the day it saw before.
// The `before` arm is LITERAL, not computed: the meal addBusy calls are gone, so computing it from the
// current code would compare the new behaviour to itself and prove nothing.
// Window 07:00–23:00, lunch 12:30–13:00, dinner 17:30–18:00, no free-time reserve.
const BEFORE_FREE = [[7 * H, 12.5 * H], [13 * H, 17.5 * H], [18 * H, 23 * H]];

test('routines: dayIntervals is unchanged for a migrated workspace', () => {
  const c = make();
  Object.assign(c.state.settings, { dayStart: '07:00', dayEnd: '23:00', freeTime: 0, breakMin: 0,
    lunchStart: '12:30', lunchEnd: '13:00', dinnerStart: '17:30', dinnerEnd: '18:00' });
  c.migrateRoutines();
  const B = c.startOfDay(Date.now());
  const fixed = c.fixedBlocksToday(B, c.state.tasks);
  const after = c.dayIntervals(B, null, fixed, c.keepClearToday(B, c.state.tasks))
    .free.map(iv => [iv.start - B, iv.end - B]);

  assert.deepEqual([...after].map(p => [...p]), BEFORE_FREE,
    'the meals moved from settings into tasks; the DAY did not change');
});
