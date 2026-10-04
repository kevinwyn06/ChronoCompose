// The morning summary's "Needs planning" listed the default routines on later days. Review and the Journal
// already left routines, Points and clock-only appointments out (`reviewSkip`); the summary built its own
// list from the bare `unplanned` chip. Every Needs-planning builder now reads `reviewUnplanned()`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, withNow, FIXED_NOW, DAY } = require('./_load.js');

test('morning summary: Needs planning lists only real work, never the seeded routines (later day)', () => {
  let c;
  withNow(FIXED_NOW, () => {
    c = make();
    c.initRoutines();                                   // Breakfast, Lunch, Dinner, Wake up, Shut down
    c.state.tasks = c.state.tasks.concat([activeTask(c, { id: 'work', name: 'Write report', planned: 0 })]);
  });
  const later = FIXED_NOW + 3 * DAY - 4 * 3600000;    // 08:00 three days on
  withNow(later, () => {
    const d = c.morningSummaryData(later);
    assert.deepEqual(Array.from(d.unplanned), ['Write report']);
    assert.equal(d.unplannedTotal, 1);
    // The same list every other Needs-planning surface shows.
    assert.deepEqual(Array.from(c.reviewUnplanned(), t => t.name), ['Write report']);
    assert.equal(c.statsData(later, 14).unplanned, 1);
  });
});

test('morning summary: Points and clock-only appointments stay out of Needs planning too', () => withNow(() => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'plain', name: 'Plain', planned: 0 }),
    activeTask(c, { id: 'point', name: 'Call mom', planned: 0, start: B + DAY + 18 * 3600000, end: null, startClock: true }),
    activeTask(c, { id: 'appt', name: 'Dentist', planned: 0, start: B + DAY + 14 * 3600000, end: B + DAY + 15 * 3600000,
      startClock: true, endClock: true, uncompressable: true }),
    activeTask(c, { id: 'arch', name: 'Archived', planned: 0, archivedAt: B }),
  ];
  assert.deepEqual(Array.from(c.morningSummaryData(B + 8 * 3600000).unplanned), ['Plain']);
}));
