// Derived scheduling shapes: fixed blocks at clock time, due-by deadline clamping
// (ported GAS Canvas guards), not-before placement, Points, and pool agreement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const H = 3600000;

function pack(c, tasks){
  c.state.tasks = tasks;
  c._allot = c.computeAllotted(tasks);
  return c.buildDayTimeline();
}
const sched = chunks => chunks.filter(x => x.type === 'scheduled');
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// ---------------------------------------------------------------------------
// Derived shapes (no pin fields)
// ---------------------------------------------------------------------------
test('hasStartTime: derives from the timestamp, explicit flag wins', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  assert.equal(c.hasStartTime(activeTask(c, { start: B })), false, 'midnight = untimed');
  assert.equal(c.hasStartTime(activeTask(c, { start: B + 14 * H })), true, '14:00 = timed');
  assert.equal(c.hasStartTime(activeTask(c, { start: B, startClock: true })), true,
    'explicit true = the user really typed 12:00am');
  assert.equal(c.hasStartTime(activeTask(c, { start: null })), false, 'no start = no time');
});

test('isFixedOn: clocked start + real end + same day + span <= 1 day', () => {
  const c = make();
  const B = c.startOfToday();
  const appt = activeTask(c, { start: B + 14 * H, end: B + 15 * H });
  assert.equal(c.isFixedOn(appt, B), true);
  const untimed = activeTask(c, { start: B, end: B + DAY });
  assert.equal(c.isFixedOn(untimed, B), false, 'no clock = not an appointment');
  const endless = activeTask(c, { start: B + 14 * H, end: null });
  assert.equal(c.isFixedOn(endless, B), false, 'no end = never fixed (no null-end garbage block)');
});

test('isFixedOn: a multi-day clocked span stays flexible and does not eat the pool', () => {
  const c = make();
  const B = c.startOfToday();
  const long = activeTask(c, { start: B + 9 * H, end: B + 4 * DAY + 17 * H });
  assert.equal(c.isFixedOn(long, B), false, 'span > 1 day → flexible');
  assert.equal(c.isFixedOn(long, B + DAY), false, 'and not on later days either');
});

test('isFixedOn: a clocked start only locks its own start day', () => {
  const c = make();
  const B = c.startOfToday();
  const appt = activeTask(c, { start: B + 14 * H, end: B + 15 * H });
  assert.equal(c.isFixedOn(appt, B + DAY), false, 'tomorrow is not its start day');
});

test('isPointOn: clocked start + no end + no planned, without any pin field', () => {
  const c = make();
  const B = c.startOfToday();
  const pt = activeTask(c, { start: B + 14 * H, end: null, planned: 0 });
  assert.equal(c.isPointOn(pt, B), true);
  const keepClear = c.keepClearToday(B, [pt]);
  assert.equal(keepClear.length, 1);
  assert.equal(keepClear[0], B + 14 * H);
  const withDur = activeTask(c, { start: B + 14 * H, end: null, planned: 60 });
  assert.equal(c.isPointOn(withDur, B), false, 'a duration makes it a real block, not a divider');
});

// ---------------------------------------------------------------------------
// dueMsOf
// ---------------------------------------------------------------------------
test('dueMsOf: timed end is itself; midnight (date-only) end means end of that day; all-day end is already exclusive', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const timed = activeTask(c, { end: B + 15 * H });
  assert.equal(c.dueMsOf(timed), B + 15 * H);
  const dateOnly = activeTask(c, { end: B + DAY }); // midnight tomorrow, not all-day
  assert.equal(c.dueMsOf(dateOnly), B + 2 * DAY, 'due that whole day (EOD rule)');
  const allday = activeTask(c, { allDay: true, start: B, end: B + DAY }); // gcal exclusive end
  assert.equal(c.dueMsOf(allday), B + DAY);
});

test('dueMsOf: explicit midnight is the exact due instant', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  assert.equal(c.dueMsOf(activeTask(c, { end: B + DAY, endClock: true })), B + DAY,
    'the user typed 12:00am — honour it');
});

// ---------------------------------------------------------------------------
// Fixed blocks: occupy the clock slot; pool and packing agree
// ---------------------------------------------------------------------------
test('a timed event renders as a fixed block at its clock time and nothing overlaps it', () => {
  const c = make();
  cleanDay(c, '10:00'); // pool 600 min
  const B = c.startOfDay(Date.now());
  const ev = activeTask(c, { id: 'ev', eventId: 'g1', allDay: false, start: B + 8 * H, end: B + 9 * H, planned: 60 });
  const flexT = activeTask(c, { id: 'fx', planned: 540 });
  const data = pack(c, [ev, flexT]);
  const fixed = data.chunks.filter(x => x.type === 'fixed');
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].id, 'ev');
  assert.equal(fixed[0].start, B + 8 * H);
  assert.equal(fixed[0].end, B + 9 * H);
  sched(data.chunks).forEach(sc => assert.ok(!overlaps(sc, fixed[0]), 'flex must pack around the pinned block'));
  // pool agreement: fixed task's allot = its span; flex pool shrank by the span
  assert.equal(c._allot['ev'].allotted, 60);
  assert.ok(c._allot['ev'].fixed);
  assert.equal(c._allot['fx'].allotted, 540);
});

// ---------------------------------------------------------------------------
// Due-by clamping (the three GAS guards)
// ---------------------------------------------------------------------------
test('due-by task never gets minutes after its deadline; leftover is unscheduled with a reason', () => {
  const c = make();
  cleanDay(c, '10:00');
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'due8', planned: 600, end: B + 8 * H }); // due 08:00, wants all 600
  const data = pack(c, [t]);
  const chunks = sched(data.chunks);
  assert.ok(chunks.length >= 1);
  chunks.forEach(sc => assert.ok(sc.end <= B + 8 * H, 'no scheduled minute may pass the deadline'));
  const un = data.chunks.find(x => x.type === 'unscheduled' && x.id === 'due8');
  assert.ok(un, 'excess is reported unscheduled');
  assert.equal(un.durationMin, 120);
  assert.equal(un.reason, 'no room before due');
});

test('deadline trim re-checks minChunk in the strict pass, relaxed pass still fills the fragment', () => {
  const c = make();
  cleanDay(c, '04:00');
  c.state.settings.minChunk = 30;
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { id: 'tiny', planned: 60, end: B + 20 * 60000 }); // only 20 min exist before due
  const data = pack(c, [t]);
  const allotted = c._allot['tiny'].allotted; // proportional allot expands to the whole pool
  const chunks = sched(data.chunks).filter(x => x.id === 'tiny');
  assert.equal(chunks.length, 1, 'relaxed pass places the sub-minChunk fragment');
  assert.equal(Math.round((chunks[0].end - chunks[0].start) / 60000), 20);
  assert.ok(chunks[0].end <= B + 20 * 60000);
  const un = data.chunks.find(x => x.type === 'unscheduled' && x.id === 'tiny');
  assert.equal(un.durationMin, allotted - 20);
  assert.equal(un.reason, 'no room before due');
});

test('a task due beyond today is not clamped (deadline outside the window)', () => {
  const c = make();
  cleanDay(c, '10:00');
  const t = activeTask(c, { id: 'later', planned: 300 }); // due tomorrow (activeTask default)
  const data = pack(c, [t]);
  const un = data.chunks.find(x => x.type === 'unscheduled' && x.id === 'later');
  assert.equal(un, undefined, 'fits fully today');
  assert.equal(sched(data.chunks).length >= 1, true);
});

// ---------------------------------------------------------------------------
// Not-before (start-pin only)
// ---------------------------------------------------------------------------
test('clocked-start flex task is never scheduled before its clock start', () => {
  const c = make();
  cleanDay(c, '10:00');
  const B = c.startOfDay(Date.now());
  const nb = activeTask(c, { id: 'nb', planned: 120, start: B + 5 * H, end: null,
    priority: 1 }); // packs FIRST but may not start before 05:00
  const filler = activeTask(c, { id: 'fill', planned: 300, priority: 4 });
  const data = pack(c, [nb, filler]);
  const nbChunks = sched(data.chunks).filter(x => x.id === 'nb');
  assert.ok(nbChunks.length >= 1);
  nbChunks.forEach(sc => assert.ok(sc.start >= B + 5 * H, 'not-before violated'));
  const fillChunks = sched(data.chunks).filter(x => x.id === 'fill');
  assert.ok(fillChunks.some(sc => sc.start < B + 5 * H), 'filler uses the early slots the clocked task skipped');
});

// ---------------------------------------------------------------------------
// 'day full' reason (no deadline in play)
// ---------------------------------------------------------------------------
test('oversubscribed (manual-override) task reports "day full", not a due reason', () => {
  const c = make();
  cleanDay(c, '02:00'); // 120 min pool — proportional allot never exceeds it, so force via manual override
  const t = activeTask(c, { id: 'big', planned: 300, predictManual: true, predicted: 300 });
  const data = pack(c, [t]);
  const un = data.chunks.find(x => x.type === 'unscheduled' && x.id === 'big');
  assert.ok(un, 'excess over the pool is unscheduled');
  assert.equal(un.durationMin, 180);
  assert.equal(un.reason, 'day full');
});
