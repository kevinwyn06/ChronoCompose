// Chain 4 / block 18 — two things, both about days that are already gone.
//
// A) `scheduledLoadOn` is RETIRED. It spread a task's Planned budget across the days its occurrence
//    spanned (divide by span) while computeAllotted grants the full per-day figure on every one of
//    those days (multiply by span) — 7x apart on a 7-day task, both claiming to answer "how much work
//    is on day B". The app keeps per-day semantics, so the helper and the Stats readout it fed are gone.
//    Nothing replaces it here: the capacity indicator is a separate, deliberate piece of work.
//
// B) A PAST day draws no FLEXIBLE allotment. Nothing will ever be scheduled into a day that is gone.
//    Past days keep what actually happened — fixed appointments and logged time. TODAY AND FUTURE DAYS
//    ARE UNTOUCHED: deliberate over-subscription there is a feature the owner uses, not a defect.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

test('scheduledLoadOn is gone from the component and from the source', () => {
  const c = make();
  assert.equal(typeof c.scheduledLoadOn, 'undefined', 'the method must not exist');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // The identifier survives only in PP-EXT prose (backticked) recording why it was removed —
  // never as a definition or a call.
  const hits = src.split('\n')
    .map((l, i) => ({ l, i }))
    .filter(x => /scheduledLoadOn\s*\(/.test(x.l) || /\bthis\.scheduledLoadOn\b/.test(x.l));
  assert.deepEqual(hits.map(x => x.i + 1), [], 'no definition of or call to scheduledLoadOn may remain');
});

test('statsData still produces every figure it produced before, with the helper gone', () => {
  const c = make();
  const today = c.startOfToday();
  const t = activeTask(c, { id: 'a', labels: ['@work'], planned: 60, pct: 100,
    completion: today + 1, spentByDay: { [c.ymdOf(today)]: 45 } });
  c.state.tasks = [t];
  const d = c.statsData(Date.now(), 14);
  ['days', 'buckets', 'byTag', 'windowSpent', 'completedWin', 'overdue', 'unplanned',
   'accuracy', 'adherence'].forEach(k => assert.ok(k in d, 'statsData still returns ' + k));
  assert.equal(d.windowSpent, 45);
  assert.equal(d.completedWin, 1);
});

// --- B: past days -------------------------------------------------------------------------------

function pastDayFixture(){
  const c = make();
  cleanDay(c, '23:59');
  const today = c.startOfToday();
  const past = today - 2 * DAY;
  // Flexible work whose window covers the past day, today, and tomorrow.
  const flex = activeTask(c, { id: 'flex', name: 'flex', start: past, end: today + DAY, planned: 120 });
  // A real appointment ON the past day: 09:00–10:00, written clock start.
  const appt = c.normalizeTask({ id: 'appt', name: 'appt', type: 'Proportional', priority: 4, deps: [],
    pct: 0, planned: 60, spent: 0, start: past + 9 * HOUR, end: past + 10 * HOUR,
    startClock: true, endClock: true });
  // Logged time on the past day, on the flexible task.
  flex.spentByDay = { [c.ymdOf(past)]: 75 };
  c.state.tasks = [flex, appt];
  return { c, today, past, flex, appt };
}

test('a past day yields no flexible allotment', () => {
  const { c, past, flex } = pastDayFixture();
  const map = c.computeAllotted(c.state.tasks, past);
  assert.equal((map[flex.id] || {}).allotted, 0, 'flexible work gets nothing on a day that is gone');
});

test('a fixed appointment on that same past day is still present', () => {
  const { c, past, appt } = pastDayFixture();
  assert.equal(c.isFixedOn(appt, past), true, 'fixture sanity: it really is a fixed appointment');
  const map = c.computeAllotted(c.state.tasks, past);
  assert.equal(map[appt.id].fixed, true, 'the appointment keeps its slot');
  assert.equal(map[appt.id].allotted, 60, 'and its full clock span');
  const blocks = c.fixedBlocksToday(past, c.state.tasks);
  assert.equal(blocks.filter(b => b.taskId === appt.id).length, 1, 'still drawn as a busy block');
});

test('logged time on a past day is still reported', () => {
  const { c, past, flex } = pastDayFixture();
  assert.equal(c.getSpentOn(flex, past), 75, 'the timer ledger is untouched');
  const j = c.journalActuals(past);
  const row = j.rows.find(r => r.id === flex.id);
  assert.ok(row, 'the worked task still appears in the day’s actuals');
  assert.equal(row.spent, 75);
  assert.equal(j.totalSpent, 75);
});

test('today and future days are untouched — flexible allotment still flows', () => {
  const { c, today, flex } = pastDayFixture();
  const t0 = c.computeAllotted(c.state.tasks, today);
  assert.ok(t0[flex.id].allotted > 0, 'today still allots flexible work');
  const t1 = c.computeAllotted(c.state.tasks, today + DAY);
  assert.ok(t1[flex.id].allotted > 0, 'tomorrow still allots flexible work');
});

test('over-subscription on today is preserved — the pool is not quietly shrunk', () => {
  const c = make();
  cleanDay(c, '09:00'); // a 9-hour day
  const today = c.startOfToday();
  const many = [];
  for (let i = 0; i < 6; i++) many.push(activeTask(c, { id: 'o' + i, planned: 300 })); // 30h asked for
  c.state.tasks = many;
  const map = c.computeAllotted(many, today);
  const total = many.reduce((a, t) => a + (map[t.id].allotted || 0), 0);
  assert.ok(total > 0, 'the day is still planned');
  assert.ok(total <= 9 * 60 + 1, 'and still compresses into the day rather than expanding it');
});
