// Owner report, 2026-09-12, with a screenshot of the 4-Day timeline: "Why is lunch and dinner not
// scheduled".
//
// Both rows read "0:30 allotted" in the sheet and drew nothing at their clocks. They were neither
// packed nor reported Unscheduled — the minutes were simply gone, which is the worst shape a
// scheduling bug can take, because nothing on screen says anything is wrong.
//
// The cause is a zero-length occurrence (`recur.durMs: 0`, the open item CURRENT.md carried after the
// 2026-09-09 Google Calendar sweep) meeting an explicit `uncompressable: true`. `isFixedOn` is the fork
// both halves of the renderer read: `fixedBlocksToday` draws what it calls fixed, and
// `buildDayTimeline`'s `flex` filter packs what it does not. Calling a zero-length occurrence an
// appointment routed the task away from the packer, and then `fixedBlocksToday`'s own `if(b>a)` guard
// declined to emit the degenerate interval. Drawn by neither.
//
// Three things are tested here, and they are three different levels of the same fix:
//   1. the predicate      — `isFixedOn` rejects a zero span;
//   2. the safety net     — a task that holds minutes and is drawn nowhere is NAMED, whatever the route;
//   3. the data           — `migrateRecurZeroOccLength` repairs lengths that were wrong to begin with.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;
const MIN = 60000;

function comp(){ const c = make(); c.state.tasks = []; cleanDay(c, '24:00'); return c; }

/** Today at HH:MM, as an epoch instant. */
function at(c, h, mi){ const d = new Date(c.startOfToday()); d.setHours(h, mi || 0, 0, 0); return d.getTime(); }

/** The owner's Lunch, verbatim in shape: a daily repeat clocked at 12:30pm, 30 planned minutes,
 *  explicitly Exact, and an occurrence length of zero. */
function lunch(c, over){
  const t = c.normalizeTask(Object.assign({
    id: 'lunch', name: 'Lunch', start: at(c, 12, 30), end: null, startClock: true,
    planned: 30, included: true, uncompressable: true,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} },
  }, over || {}));
  c.state.tasks = c.state.tasks.concat([t]);
  return t;
}

/** Fill the occurrence memo the way a paint does — `occForDay` expands only to `_horizon || t.end`, and
 *  an unbounded repeat has no `t.end` at all under the window model. */
function paint(c){
  c._horizon = c.startOfToday() + 14 * DAY;
  c._occById = {};
  c.state.tasks.forEach(t => { c._occById[t.id] = c.expandTask(t, c._horizon); });
}

const segsFor = (data, id) => data.chunks.filter(s => s.id === id);

// ---------------------------------------------------------------------------
// 1. The predicate
// ---------------------------------------------------------------------------

test('a zero-length occurrence is not an appointment, however Exact the task is', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); const t = lunch(c); paint(c);
    const B = c.startOfToday();

    const oc = c.occForDay(t, B);
    assert.equal(oc.end - oc.start, 0, 'precondition: the occurrence really does have no length');
    assert.equal(c.isUncompressable(t, B), true, 'precondition: and the task really is explicitly Exact');

    assert.equal(c.isFixedOn(t, B), false,
      'claiming it as fixed is what routed it away from the packer into a block that was never emitted');
  });
});

test('a real appointment is untouched — the guard bounds the span, it does not abolish fixing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = lunch(c, { id: 'standup', name: 'Standup',
      recur: { kind: 'day', n: 1, label: 'Daily', durMs: 30 * MIN, shifts: [], overrides: {} } });
    paint(c);
    assert.equal(c.isFixedOn(t, c.startOfToday()), true);

    const blocks = c.fixedBlocksToday(c.startOfToday(), c.state.tasks);
    assert.equal(blocks.length, 1, 'and it still emits its busy interval');
    assert.equal(blocks[0].end - blocks[0].start, 30 * MIN);
  });
});

test('a lengthless occurrence states no end clock and no deadline', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); const t = lunch(c); paint(c);
    const B = c.startOfToday();

    assert.equal(c.hasEndTime(t), false,
      '`anchorEndMs` returns start+0, so the START clock was being reported as a written end');
    assert.equal(c.dueMsOf(t, B), B + DAY,
      'read literally, the deadline equalled the not-before boundary and no slot could ever measure ' +
      'more than zero minutes — the task would be permanently Unscheduled instead of drawn');
  });
});

test('an explicitly written 00:00-00:00 span still counts as written', () => {
  const c = make();
  const midnight = new Date(2026, 7, 18).setHours(0, 0, 0, 0);
  assert.equal(c.hasEndTime({ start: midnight, end: midnight, endClock: true }), true,
    'the flag records what the user typed; only an INFERRED end is disqualified by landing on the start');
  assert.equal(c.hasEndTime({ start: midnight, end: midnight, endClock: null }), false);
});

// ---------------------------------------------------------------------------
// The report itself
// ---------------------------------------------------------------------------

test('Lunch is drawn at its clock instead of vanishing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); lunch(c); paint(c);
    const data = c.buildDayTimeline(c.startOfToday());

    const mine = segsFor(data, 'lunch');
    assert.ok(mine.length > 0, 'the whole report: nothing was drawn for it at all');
    const placed = mine.filter(s => s.start != null);
    assert.equal(placed.length, 1, 'and it is one block, not a scatter');
    assert.ok(placed[0].start >= at(c, 12, 30),
      'its written start clock is still a not-before boundary — the packer may not pull it earlier');
    assert.equal(Math.round((placed[0].end - placed[0].start) / MIN), 30,
      'it asks the day for its planned minutes, which is what "0:30 allotted" always claimed');
  });
});

test('the minutes it holds and the minutes it draws are the same minutes', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); lunch(c); paint(c);
    const B = c.startOfToday();
    const data = c.buildDayTimeline(B);
    const allot = c.computeAllotted(c.state.tasks, B);

    const drawn = segsFor(data, 'lunch').filter(s => s.start != null)
      .reduce((a, s) => a + (s.end - s.start) / MIN, 0);
    assert.equal(Math.round(drawn), Math.round(allot['lunch'].allotted),
      'the sheet read 0:30 while the timeline drew 0:00 — that gap IS the bug');
  });
});

// ---------------------------------------------------------------------------
// 2. The safety net
// ---------------------------------------------------------------------------

test('a task that holds minutes and is drawn nowhere is reported, not swallowed', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); lunch(c); paint(c);
    const B = c.startOfToday();

    // Re-create the defect from ABOVE the fix: force the old answer out of the predicate, so the task
    // is claimed as fixed (and therefore not packed) while `fixedBlocksToday` still drops its
    // zero-length interval. This is the exact state the owner was looking at.
    const realIsFixedOn = c.isFixedOn.bind(c);
    c.isFixedOn = (t, day) => (t && t.id === 'lunch') ? true : realIsFixedOn(t, day);
    try {
      const data = c.buildDayTimeline(B);
      const mine = segsFor(data, 'lunch');
      assert.equal(mine.length, 1, 'silence is the failure mode the net exists to prevent');
      assert.equal(mine[0].type, 'unscheduled');
      assert.equal(mine[0].reason, 'not placed');
      assert.equal(mine[0].durationMin, 30, 'and it names the minutes that have no home');
    } finally { c.isFixedOn = realIsFixedOn; }
  });
});

test('the net stays quiet about everything that legitimately reserves nothing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    // A Point: a clocked instant with no end and no duration. It reserves no time on purpose.
    c.state.tasks = c.state.tasks.concat([c.normalizeTask({ id: 'wake', name: 'Wake up',
      start: at(c, 7, 0), end: null, startClock: true, planned: 0, included: true,
      recur: { kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {} } })]);
    // An ordinary flexible task, so the day is not empty.
    c.state.tasks = c.state.tasks.concat([c.normalizeTask({ id: 'paper', name: 'Paper',
      start: c.startOfToday(), end: c.startOfToday() + DAY - 1, planned: 60, included: true })]);
    paint(c);

    const data = c.buildDayTimeline(c.startOfToday());
    assert.equal(c.isPointTask(c.state.tasks[0]), true, 'precondition: it really is a Point');
    assert.equal(segsFor(data, 'wake').length, 0, 'a Point draws as a caret and owes the day nothing');
    assert.equal(data.chunks.filter(s => s.reason === 'not placed').length, 0,
      'the net must not invent work; a false Unscheduled row is its own kind of noise');
  });
});

// ---------------------------------------------------------------------------
// 3. The data
// ---------------------------------------------------------------------------

const zeroRepeat = (c, over) => c.normalizeTask(Object.assign({
  id: 'z', name: 'Lunch', start: new Date(2026, 8, 1, 12, 30).getTime(), end: null, startClock: true,
  recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} },
}, over || {}));

test('a zero-length occurrence is repaired from the task\'s own planned minutes', () => {
  const c = make();
  const t = zeroRepeat(c, { planned: 30 });
  assert.equal(c.migrateRecurZeroOccLength([t]), 1);
  assert.equal(t.recur.durMs, 30 * MIN);
  assert.equal(c.migrateRecurZeroOccLength([t]), 0, 'second run finds nothing');
});

test('Todoist\'s stated duration outranks planned here too', () => {
  const c = make();
  const t = zeroRepeat(c, { planned: 90, description: '//planned-duration: 00:45 1\n\nhttps://app.todoist.com/x' });
  assert.equal(c.migrateRecurZeroOccLength([t]), 1);
  assert.equal(t.recur.durMs, 45 * MIN);
});

test('with no evidence at all the zero is LEFT — it is a legal shape, not a hole to fill', () => {
  const c = make();
  const t = zeroRepeat(c, { planned: null });
  assert.equal(c.migrateRecurZeroOccLength([t]), 0);
  assert.equal(t.recur.durMs, 0,
    'clamping to the period, which the too-long repair does, would turn a routine into a 24-hour block');
  assert.equal(c.isScheduled(t), true, 'and the shape remains a scheduled one, as isScheduled states');
});

test('a replacement that would break the period invariant is declined, not written', () => {
  const c = make();
  const t = zeroRepeat(c, { planned: 48 * 60,            // two days of "planned" on a DAILY rule
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } });
  assert.equal(c.migrateRecurZeroOccLength([t]), 0);
  assert.equal(t.recur.durMs, 0, 'or this pass would hand the too-long repair something to undo');
});

test('the sibling repair still ignores zero, so the two passes cannot fight', () => {
  const c = make();
  const t = zeroRepeat(c, { planned: 30 });
  assert.equal(c.migrateRecurOccLength([t]), 0, 'zero is inside every period — invisible to that pass');
});

test('a Supabase pull cannot re-import the zero over the repair', () => {
  const c = make();
  const row = { id: 'z', name: 'Dinner', planned: 30, start: new Date(2026, 8, 1, 17, 30).getTime(),
    end: null, startClock: true, calendarId: 'primary', eventId: 'e9',
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } };
  const t = c.migrateIncomingRow(c.normalizeTask(row));
  assert.equal(t.recur.durMs, 30 * MIN);
});
