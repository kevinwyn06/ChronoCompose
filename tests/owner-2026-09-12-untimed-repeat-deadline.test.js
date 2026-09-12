// Owner report, 2026-09-12, the morning after v0.13.4, with a screenshot of the Today drawer:
// "now nothing is scheduled properly."
//
// Every flexible daily repeat — Memorize GRE words, Physics GRE Prep, Paper, Capstone, … — read a
// positive Allotted figure in the sheet and drew nothing on the timeline. Only the clocked routines drew.
//
// Two faults, one of which was already in the code:
//
//   1. `hasEndTime` inferred an END CLOCK for a repeat from `t.start + recur.durMs`. For a repeat whose
//      start has no clock, that instant is midnight plus a duration — 1:00am for a 60-minute occurrence —
//      and `hasClock` read it as a written end. `dueMsOf` then handed the packer a 1:00am hard deadline,
//      so a day that opens at 7:30am had no slot before it, and the task went to Unscheduled with
//      "no room before due". `Advisor research` was already in this shape before v0.13.4.
//   2. v0.13.4's `migrateRecurZeroOccLength` was written for four CLOCKED routines, but it repaired every
//      zero-length repeat that had a `planned` figure — so it copied `planned` into `recur.durMs` on every
//      untimed daily repeat in the workspace, and fault 1 then took all of them off the timeline at once.
//
// An untimed repeat's occurrence is its day. Its length lives in `planned`, which is what the allotment
// reads; `recur.durMs` states no clock and no deadline for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;
const MIN = 60000;

/** A day that opens at 7:30am, the owner's setting — a 1:00am deadline is only fatal when the day starts
 *  after it, which is why `cleanDay`'s midnight start hides this fault. */
function comp(){ const c = make(); c.state.tasks = []; cleanDay(c, '24:00'); c.state.settings.dayStart = '07:30'; return c; }

function paint(c){
  c._horizon = c.startOfToday() + 30 * DAY;
  c._occById = {};
  c.state.tasks.forEach(t => { c._occById[t.id] = c.expandTask(t, c._horizon); });
}

/** The owner's "Memorize GRE words" as stored after v0.13.4: a daily repeat anchored at a bare midnight
 *  (no start clock), a series window running weeks ahead, 60 planned minutes — and `durMs` 60 minutes. */
function gre(c, over){
  const B = c.startOfToday();
  const t = c.normalizeTask(Object.assign({
    id: 'gre', name: 'Memorize GRE words', start: B - 3 * DAY, end: B + 20 * DAY, startClock: null,
    planned: 60, included: true,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 60 * MIN, shifts: [], overrides: {} },
  }, over || {}));
  c.state.tasks = c.state.tasks.concat([t]);
  return t;
}

const segsFor = (data, id) => data.chunks.filter(s => s.id === id);

test('an untimed repeat with an occurrence length states no end clock and no early deadline', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); const t = gre(c); paint(c);
    const B = c.startOfToday();
    assert.equal(c.hasStartTime(t), false, 'precondition: the anchor carries no clock');
    assert.equal(c.hasEndTime(t), false,
      'midnight + 60 minutes is 1:00am by arithmetic, not a clock anyone wrote');
    assert.equal(c.dueMsOf(t, B), B + DAY,
      'the deadline is the end of the day the occurrence falls on, not 1:00am');
  });
});

test('the report: the untimed repeat packs into the day instead of going Unscheduled', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); gre(c); paint(c);
    const mine = segsFor(c.buildDayTimeline(c.startOfToday()), 'gre');
    assert.equal(mine.filter(s => s.type === 'unscheduled').length, 0,
      'it was reported "no room before due" against a 1:00am deadline');
    const placed = mine.filter(s => s.start != null);
    assert.equal(Math.round(placed.reduce((a, s) => a + (s.end - s.start) / MIN, 0)), 60);
  });
});

test('a clocked repeat still states its end clock — the guard is about the untimed anchor only', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const d = new Date(c.startOfToday()); d.setHours(12, 30, 0, 0);
    const t = gre(c, { id: 'lunch', name: 'Lunch', start: d.getTime(), end: null, startClock: true,
      planned: 30, recur: { kind: 'day', n: 1, label: 'Daily', durMs: 30 * MIN, shifts: [], overrides: {} } });
    paint(c);
    assert.equal(c.hasEndTime(t), true);
    assert.equal(c.isFixedOn(t, c.startOfToday()), true, 'and it is still an appointment');
  });
});

test('an explicit endClock on an untimed repeat is still honoured', () => {
  const c = make();
  const B = new Date(2026, 8, 12).getTime();
  const t = { start: B, end: B + 20 * DAY, startClock: null, endClock: true,
    recur: { kind: 'day', n: 1, durMs: 17 * 60 * MIN } };
  assert.equal(c.hasEndTime(t), true, 'the flag records what the user wrote; only the INFERENCE changes');
});

test('the zero-length repair leaves an untimed repeat alone — its length lives in planned', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'u', name: 'Paper', start: new Date(2026, 8, 9).getTime(),
    end: new Date(2026, 9, 1).getTime(), startClock: null, planned: 180,
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } });
  assert.equal(c.migrateRecurZeroOccLength([t]), 0);
  assert.equal(t.recur.durMs, 0, 'v0.13.4 wrote 180 minutes here, which is what re-pushed it to Google as a timed block');
});

test('a Supabase pull does not spread the repair onto untimed repeats either', () => {
  const c = make();
  const row = { id: 'u2', name: 'CV', planned: 60, start: new Date(2026, 8, 9).getTime(),
    end: new Date(2026, 8, 20).getTime(), startClock: null, calendarId: 'primary', eventId: 'e1',
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 0, shifts: [], overrides: {} } };
  const t = c.migrateIncomingRow(c.normalizeTask(row));
  assert.equal(t.recur.durMs, 0);
});
