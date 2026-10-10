// Phase 9 PR2 — Stats page aggregation over the per-day spentByDay ledger.
// statsData is pure over state.tasks; we assert the daily buckets, per-tag rollup, completion
// counts (incl. archived tasks — the point of stats), and the backlog tallies.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

function ymd(c, ms){ return c.ymdOf(ms); }

test('statsData buckets daily spent from the ledger and rolls it up by first tag', () => {
  const c = make();
  const now = Date.now();
  const today = c.startOfToday();
  const y1 = ymd(c, today), y0 = ymd(c, today - DAY);
  const a = activeTask(c, { id: 'a', labels: ['@work'], spentByDay: { [y1]: 60, [y0]: 30 } });
  const b = activeTask(c, { id: 'b', labels: ['@gym'], spentByDay: { [y1]: 45 } });
  const old = activeTask(c, { id: 'old', labels: ['@work'], spentByDay: { [ymd(c, today - 60 * DAY)]: 120 } }); // outside 14d window
  c.state.tasks = [a, b, old];
  const d = c.statsData(now, 14);
  assert.equal(d.buckets.length, 14);
  assert.equal(d.buckets[d.buckets.length - 1].spent, 105, 'today = 60 + 45');
  assert.equal(d.buckets[d.buckets.length - 2].spent, 30, 'yesterday = 30');
  assert.equal(d.windowSpent, 135, 'old task’s 120 is outside the window');
  const work = d.byTag.find(x => x.tag === '@work');
  assert.equal(work.min, 90, 'work = 60 + 30 (window only)');
  assert.equal(d.byTag[0].tag, '@work', 'tags sorted by minutes desc');
});

test('statsData counts completions in-window, including archived tasks', () => {
  const c = make();
  const now = Date.now();
  const today = c.startOfToday();
  const doneArch = activeTask(c, { id: 'da', pct: 100, completion: today + 1, archivedAt: today + 2 });
  const doneOld = activeTask(c, { id: 'do', pct: 100, completion: today - 40 * DAY }); // outside window
  const openT = activeTask(c, { id: 'op', pct: 30 });
  c.state.tasks = [doneArch, doneOld, openT];
  const d = c.statsData(now, 14);
  assert.equal(d.completedWin, 1, 'archived completion counts; out-of-window one does not');
  assert.equal(d.buckets[d.buckets.length - 1].completed, 1, 'counted on its completion day');
});

test('statsData tallies overdue + unplanned backlog and planned-vs-spent accuracy', () => {
  const c = make();
  const now = Date.now();
  const today = c.startOfToday();
  const overdue = activeTask(c, { id: 'od', pct: 20, start: today - 5 * DAY, end: today - 2 * DAY });
  const unplanned = activeTask(c, { id: 'un', planned: 0, pct: 0 });
  const done = activeTask(c, { id: 'dn', planned: 100, spent: 120, pct: 100, completion: today + 1 });
  c.state.tasks = [overdue, unplanned, done];
  const d = c.statsData(now, 14);
  assert.equal(d.overdue, 1);
  assert.equal(d.unplanned, 1);
  assert.equal(d.accuracy.n, 1);
  assert.equal(d.accuracy.planSum, 100);
  assert.equal(Math.round(d.accuracy.spentSum), 120, 'spent÷planned = 120% (over budget)');
});

test('statsData adherence compares today’s allotted plan to recorded spent', () => {
  const c = make();
  cleanDay(c, '10:00'); // 600-min pool, no meals
  const today = c.startOfToday();
  const t = activeTask(c, { id: 't', planned: 120, spentByDay: { [c.ymdOf(today)]: 90 } });
  c.state.tasks = [t];
  const d = c.statsData(Date.now(), 14);
  assert.ok(d.adherence.allotted > 0, 'today has an allotted plan');
  assert.equal(Math.round(d.adherence.actual), 90, 'recorded = today’s ledger slice');
});
