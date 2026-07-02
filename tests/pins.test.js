// Phase 1 (ROADMAP.md) — start/end pins: effPins inference, fixed blocks at clock time,
// due-by deadline clamping (ported GAS Canvas guards), not-before placement, pool agreement.
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
// effPins inference + explicit overrides
// ---------------------------------------------------------------------------
// note: vm-realm objects fail deepStrictEqual on prototype identity — compare fields instead
const pins = (c, t) => { const p = c.effPins(t); return p.ps + '/' + p.pe; };

test('effPins: timed calendar event infers both pins; plain task infers due-pin only', () => {
  const c = make();
  assert.equal(pins(c, activeTask(c, { eventId: 'e1', calendarId: 'cal', allDay: false })), 'true/true');
  assert.equal(pins(c, activeTask(c, {})), 'false/true');
  assert.equal(c.effPins(activeTask(c, { eventId: 'e2', allDay: true })).ps, false,
    'all-day events are not fixed at a clock time');
});

test('effPins: explicit pins beat inference; Milestone/Excluded never pin', () => {
  const c = make();
  assert.equal(pins(c, activeTask(c, { eventId: 'e1', pinStart: false, pinEnd: false })), 'false/false');
  assert.equal(pins(c, activeTask(c, { type: 'Milestone', pinStart: true, pinEnd: true })), 'false/false');
});

test('togglePin stores an explicit flipped value', () => {
  const c = make();
  const t = activeTask(c, { id: 'tp' });
  c.state.tasks = [t];
  c.togglePin('tp', 'end'); // eff default true → explicit false
  assert.equal(c.state.tasks.find(x => x.id === 'tp').pinEnd, false);
  c.togglePin('tp', 'start'); // eff default false → explicit true
  assert.equal(c.state.tasks.find(x => x.id === 'tp').pinStart, true);
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
test('start-pinned (only) task is never scheduled before its clock start', () => {
  const c = make();
  cleanDay(c, '10:00');
  const B = c.startOfDay(Date.now());
  const nb = activeTask(c, { id: 'nb', planned: 120, start: B + 5 * H, end: B + 23 * H,
    pinStart: true, pinEnd: false, priority: 1 }); // packs FIRST but may not start before 05:00
  const filler = activeTask(c, { id: 'fill', planned: 300, priority: 4 });
  const data = pack(c, [nb, filler]);
  const nbChunks = sched(data.chunks).filter(x => x.id === 'nb');
  assert.ok(nbChunks.length >= 1);
  nbChunks.forEach(sc => assert.ok(sc.start >= B + 5 * H, 'not-before violated'));
  const fillChunks = sched(data.chunks).filter(x => x.id === 'fill');
  assert.ok(fillChunks.some(sc => sc.start < B + 5 * H), 'filler uses the early slots the pinned task skipped');
});

// ---------------------------------------------------------------------------
// 'day full' reason (no deadline in play)
// ---------------------------------------------------------------------------
test('oversubscribed (manual-override) task reports "day full", not a due reason', () => {
  const c = make();
  cleanDay(c, '02:00'); // 120 min pool — proportional allot never exceeds it, so force via manual override
  const t = activeTask(c, { id: 'big', planned: 300, predictManual: true, predicted: 300, pinEnd: false });
  const data = pack(c, [t]);
  const un = data.chunks.find(x => x.type === 'unscheduled' && x.id === 'big');
  assert.ok(un, 'excess over the pool is unscheduled');
  assert.equal(un.durationMin, 180);
  assert.equal(un.reason, 'day full');
});
