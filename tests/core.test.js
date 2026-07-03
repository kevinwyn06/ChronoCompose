const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

test('parseDur / fmtDur (minutes; bare number = hours)', () => {
  const c = make();
  assert.strictEqual(c.parseDur('1:30'), 90);
  assert.strictEqual(c.parseDur('2'), 120);
  assert.strictEqual(c.parseDur(''), 0);
  assert.strictEqual(c.parseDur('0:45'), 45);
  assert.strictEqual(c.fmtDur(90), '1:30');
  assert.strictEqual(c.fmtDur(0), '0:00');
  assert.strictEqual(c.fmtDur(null), '—');
  assert.strictEqual(c.fmtDur(c.parseDur('3:05')), '3:05');
});

test('normalizeTask fills defaults', () => {
  const c = make();
  const t = c.normalizeTask({ id:'a', name:'n' });
  assert.strictEqual(t.spent, 0);
  assert.strictEqual(t.goal, '');
  assert.strictEqual(t.predictManual, false);
  assert.strictEqual(t.calendarId, null);
  assert.strictEqual(t.eventId, null);
  assert.ok(Array.isArray(t.labels));
  assert.ok(Array.isArray(t.deps));
  assert.strictEqual(t.priority, 4);
});

test('isActiveToday: only today in [start,end], excludes milestones and included:false', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const B = Date.now();
  assert.strictEqual(c.isActiveToday(activeTask(c)), true);
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:B+2*DAY, end:B+4*DAY })), false, 'future');
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:B-4*DAY, end:B-2*DAY })), false, 'past');
  assert.strictEqual(c.isActiveToday(activeTask(c, { included:false })), false, 'excluded');
  assert.strictEqual(c.isActiveToday(activeTask(c, { type:'Milestone' })), false, 'milestone');
  // included:true forces active even outside the [start,end] window
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:B+2*DAY, end:B+4*DAY, included:true })), true, 'force-included');
});

test('inWindowToday is date-only (ignores time of day at the window edges)', () => {
  const c = make();
  const B = Date.now();
  c.state.nowTick = B;
  // a task that ends at 00:30 today (very early) is still "in window today" by date
  const endEarly = c.startOfDay(B) + 30 * 60000;
  const startYesterday = c.startOfDay(B) - 12 * 3600000;
  assert.strictEqual(c.inWindowToday(activeTask(c, { start:startYesterday, end:endEarly })), true);
  assert.strictEqual(c.inWindowToday(activeTask(c, { start:B+2*DAY, end:B+4*DAY })), false);
});

test('toggleIncluded flips the effective include state and stores it explicitly', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const t = activeTask(c); // straddles today -> effectively included (included:null)
  c.state.tasks = [t];
  assert.strictEqual(c.isActiveToday(t), true);
  c.toggleIncluded(t.id);
  assert.strictEqual(c.state.tasks[0].included, false, 'first toggle excludes');
  assert.strictEqual(c.isActiveToday(c.state.tasks[0]), false);
  c.toggleIncluded(t.id);
  assert.strictEqual(c.state.tasks[0].included, true, 'second toggle re-includes explicitly');
  assert.strictEqual(c.isActiveToday(c.state.tasks[0]), true);
});

test('isMilestone reflects the internal Milestone marker', () => {
  const c = make();
  assert.strictEqual(c.isMilestone(activeTask(c, { type:'Milestone' })), true);
  assert.strictEqual(c.isMilestone(activeTask(c)), false);
});

test('computeAllotted: manual-override fixed, excluded/milestone inactive, Proportional split', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00'); // 600 min pool
  const ex = activeTask(c, { predictManual:true, predicted:120, planned:120 });
  const p1 = activeTask(c, { planned:120 });
  const p2 = activeTask(c, { planned:240 });
  const excl = activeTask(c, { included:false, planned:999 });
  c.state.tasks = [ex, p1, p2, excl];
  const a = c.computeAllotted(c.state.tasks);
  assert.strictEqual(a[ex.id].allotted, 120, 'override = predicted');
  // pool after fixed = 600-120 = 480; split 120:240 => 160 and 320
  assert.strictEqual(a[p1.id].allotted, 160);
  assert.strictEqual(a[p2.id].allotted, 320);
  assert.strictEqual(a[excl.id].active, false);
  assert.strictEqual(a[excl.id].allotted, 0);
});

test('computeAllotted: manual override redistributes pool to remaining Proportional', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00'); // 600
  const p1 = activeTask(c, { type:'Proportional', planned:120 });
  const p2 = activeTask(c, { type:'Proportional', planned:240 });
  c.state.tasks = [p1, p2];
  const before = c.computeAllotted(c.state.tasks);
  assert.strictEqual(before[p1.id].allotted, 200); // 600 * 120/360
  assert.strictEqual(before[p2.id].allotted, 400);
  // override p1 to a fixed 60 -> p2 should get whole remaining 540
  p1.predictManual = true; p1.predicted = 60;
  const after = c.computeAllotted(c.state.tasks);
  assert.strictEqual(after[p1.id].allotted, 60);
  assert.strictEqual(after[p2.id].allotted, 540, 'remaining pool 600-60 all to p2');
});

test('getSpent adds live elapsed while running', () => {
  const c = make();
  const t = activeTask(c, { spent:10 });
  c.state.tasks = [t];
  assert.strictEqual(c.getSpent(t), 10);
  c.state.running = { id:t.id, startedAt: Date.now() - 60*60000 };
  c.state.nowTick = Date.now();
  const s = c.getSpent(t);
  assert.ok(s >= 69 && s <= 71, 'about 10 + 60 minutes, got '+s);
});

test('timers: one at a time; stop accumulates spent', () => {
  const c = make();
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 });
  c.state.tasks = [a, b];
  c.startTimer(a.id);
  assert.strictEqual(c.state.running.id, a.id);
  c.startTimer(b.id); // starting b stops a
  assert.strictEqual(c.state.running.id, b.id);
  // simulate 30 min elapsed then stop
  c.state.running = { id:b.id, startedAt: Date.now() - 30*60000 };
  c.stopTimer();
  assert.strictEqual(c.state.running, null);
  const bb = c.state.tasks.find(t=>t.id===b.id);
  assert.ok(bb.spent >= 29 && bb.spent <= 31, 'b spent ~30, got '+bb.spent);
  // toggle same running task stops it
  c.startTimer(a.id);
  c.toggleTimer(a.id);
  assert.strictEqual(c.state.running, null);
});

test('togglePredictManual / setPredict', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00');
  const p1 = activeTask(c, { type:'Proportional', planned:120 });
  c.state.tasks = [p1];
  c._allot = c.computeAllotted(c.state.tasks); // togglePredictManual reads allotOf -> _allot
  const computed = c._allot[p1.id].computed;
  c.togglePredictManual(p1.id);
  let t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predictManual, true);
  assert.strictEqual(t.predicted, computed, 'seeded with computed');
  c.togglePredictManual(p1.id);
  t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predictManual, false);
  c.setPredict(p1.id, '2:00');
  t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predicted, 120);
  assert.strictEqual(t.predictManual, true);
});

test('buildDayTimeline: meals present, chunks in-window & non-overlapping', () => {
  const c = make();
  c.state.nowTick = Date.now();
  c.state.settings.freeTime = 0; // no evening reserve, so meals are the only busy blocks
  const p1 = activeTask(c, { type:'Proportional', planned:120, name:'A' });
  const p2 = activeTask(c, { type:'Proportional', planned:120, name:'B' });
  c.state.tasks = [p1, p2];
  c._allot = c.computeAllotted(c.state.tasks);
  const d = c.buildDayTimeline();
  assert.ok(d.dayStart < d.dayEnd);
  const meals = d.chunks.filter(x=>x.type==='meal').map(x=>x.title).sort();
  assert.deepEqual(meals, ['Dinner','Lunch']);
  const sched = d.chunks.filter(x=>x.start && x.type==='scheduled');
  assert.ok(sched.length > 0, 'some scheduled chunks');
  sched.forEach(x=>{
    assert.ok(x.start >= d.dayStart && x.end <= d.dayEnd, 'within window');
    assert.ok(x.start < x.end, 'positive duration');
  });
  // no scheduled chunk overlaps a meal
  const mealsFull = d.chunks.filter(x=>x.type==='meal');
  sched.forEach(x=> mealsFull.forEach(mm=>{
    assert.ok(x.end <= mm.start || x.start >= mm.end, 'no overlap with meal');
  }));
});

test('buildDayTimeline: overflow tasks become unscheduled', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '01:00'); // 60-min window
  // A manual Predict override is a fixed slice, not pool-capped, so 10h into a 1h window overflows.
  const big = activeTask(c, { predictManual:true, predicted:600, planned:600, name:'Big' });
  c.state.tasks = [big];
  c._allot = c.computeAllotted(c.state.tasks);
  const d = c.buildDayTimeline();
  const uns = d.chunks.filter(x=>x.start===null && x.type==='unscheduled');
  assert.ok(uns.length >= 1, 'expected an unscheduled remainder');
  assert.ok(uns[0].durationMin > 0);
});
