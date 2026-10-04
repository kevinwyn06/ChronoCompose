// Phase 9 PR3 (ROADMAP.md) — Habits entity: scheduling (daily/weekdays), auto-done from linked tasks,
// streak (grace for today, break on an earlier miss), and consistency over a window.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, DAY } = require('./_load.js');

function habit(c, over){ return c.normalizeHabit(Object.assign({ id: 'h1', name: 'Read' }, over || {})); }

test('normalizeHabit fills defaults; scheduleLabel reads the cadence', () => {
  const c = make();
  const d = habit(c);
  assert.equal(d.schedule.kind, 'daily');
  assert.equal(d.taskIds.length, 0);
  assert.equal(Object.keys(d.done).length, 0);
  assert.equal(c.scheduleLabel(d), 'Daily');
  const w = habit(c, { schedule: { kind: 'weekdays', days: [1, 3, 5] } });
  assert.equal(c.scheduleLabel(w), 'Mon Wed Fri');
});

test('habitScheduledOn: daily is always on; weekdays honor the day set', () => {
  const c = make();
  const daily = habit(c);
  const mwf = habit(c, { schedule: { kind: 'weekdays', days: [1, 3, 5] } });
  // find a known Monday and Tuesday
  let mon = c.startOfToday(); while (new Date(mon).getDay() !== 1) mon -= DAY;
  const tue = mon + DAY;
  assert.equal(c.habitScheduledOn(daily, tue), true);
  assert.equal(c.habitScheduledOn(mwf, mon), true, 'Monday is in the set');
  assert.equal(c.habitScheduledOn(mwf, tue), false, 'Tuesday is not');
});

test('habitDoneOn: manual check OR a linked task worked/completed that day', () => {
  const c = make();
  const today = c.startOfToday();
  const ymd = c.ymdOf(today);
  const worked = activeTask(c, { id: 'tw', spentByDay: { [ymd]: 25 } });
  const completed = activeTask(c, { id: 'tc', pct: 100, completion: today + 1 });
  const byId = { tw: worked, tc: completed };
  const manual = habit(c, { done: { [ymd]: true } });
  assert.equal(c.habitDoneOn(manual, today, byId), true, 'manual check counts');
  assert.equal(c.habitDoneOn(habit(c, { taskIds: ['tw'] }), today, byId), true, 'timer on a linked task counts');
  assert.equal(c.habitDoneOn(habit(c, { taskIds: ['tc'] }), today, byId), true, 'completing a linked task counts');
  assert.equal(c.habitDoneOn(habit(c), today, byId), false, 'no check + no links = not done');
});

test('habitStreak: today ungraded does not break; an earlier miss does', () => {
  const c = make();
  const now = Date.now();
  const today = c.startOfToday();
  const ymd = i => c.ymdOf(today - i * DAY);
  // done yesterday + 2 days ago, but NOT today yet → streak = 2 (today graced)
  const h1 = habit(c, { done: { [ymd(1)]: true, [ymd(2)]: true } });
  assert.equal(c.habitStreak(h1, now, {}), 2);
  // also done today → streak = 3
  const h2 = habit(c, { done: { [ymd(0)]: true, [ymd(1)]: true, [ymd(2)]: true } });
  assert.equal(c.habitStreak(h2, now, {}), 3);
  // missed 2 days ago breaks it → only yesterday counts
  const h3 = habit(c, { done: { [ymd(1)]: true, [ymd(3)]: true } });
  assert.equal(c.habitStreak(h3, now, {}), 1);
});

test('habitConsistency: done scheduled / total scheduled over the window', () => {
  const c = make();
  const now = Date.now();
  const today = c.startOfToday();
  const done = {}; for (let i = 0; i < 5; i++) done[c.ymdOf(today - i * DAY)] = true; // 5 of the last 10 days
  // Created well before the window, so every day of it counts (UI revamp block 10a: counting starts at creation).
  const d = c.habitConsistency(habit(c, { done, createdAt: today - 30 * DAY }), now, 10, {});
  assert.equal(d.sched, 10, 'daily → every day scheduled');
  assert.equal(d.done, 5);
  assert.equal(d.pct, 50);
});
