// Phase 9 PR4 (ROADMAP.md) — Journaling / next-day planning: per-day text store round-trip, the day's
// actuals (allotted vs recorded), and the day-navigation clamp (never past today).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

test('saveJournalText persists per day; empty text clears the entry', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  c.saveJournalText(today, 'Shipped the stats page.');
  assert.equal(c.journalTextFor(today), 'Shipped the stats page.');
  assert.ok(c.state.journal[c.ymdOf(today)].updatedAt, 'stamps updatedAt');
  // a different day is independent
  c.saveJournalText(today - DAY, 'yesterday note');
  assert.equal(c.journalTextFor(today - DAY), 'yesterday note');
  assert.equal(c.journalTextFor(today), 'Shipped the stats page.');
  // clearing to blank removes the entry
  c.saveJournalText(today, '   ');
  assert.equal(c.journalTextFor(today), '');
  assert.ok(!(c.ymdOf(today) in c.state.journal), 'blank entry deleted');
});

test('journalActuals reports per-task allotted vs recorded with totals', () => {
  const c = make();
  cleanDay(c, '10:00'); // 600-min pool
  const today = c.startOfToday();
  const a = activeTask(c, { id: 'a', planned: 120, spentByDay: { [c.ymdOf(today)]: 45 } });
  const b = activeTask(c, { id: 'b', planned: 60, spentByDay: {} });
  c.state.tasks = [a, b];
  const d = c.journalActuals(today);
  assert.equal(d.rows.length, 2);
  assert.equal(Math.round(d.totalSpent), 45, 'recorded = today ledger slices');
  assert.ok(d.totalAllot > 0, 'both active tasks get an allotted slice');
  assert.equal(d.rows[0].id, 'a', 'rows sorted by recorded desc');
});

test('journalActuals skips tasks with neither allotment nor recorded time', () => {
  const c = make();
  cleanDay(c, '10:00');
  const today = c.startOfToday();
  const inactive = activeTask(c, { id: 'far', planned: 60, start: today + 30 * DAY, end: today + 31 * DAY });
  c.state.tasks = [inactive];
  const d = c.journalActuals(today);
  assert.equal(d.rows.length, 0, 'a task not active today and never worked on is omitted');
});

test('shiftJournalDay never advances past today; -1 goes back a day', () => {
  const c = make();
  c.state.journalDay = null; // today
  c.shiftJournalDay(1);
  assert.equal(c.state.journalDay, null, 'cannot go past today');
  c.shiftJournalDay(-1);
  assert.equal(c.journalDayMs(), c.startOfToday() - DAY, 'stepped back one day');
});
