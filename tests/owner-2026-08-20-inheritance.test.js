/* PP-EXT (owner 2026-08-20) Chain A, Task 6 — spec A2.
 *
 * An APPOINTMENT exists on the days its occurrence covers, and on no others. V2.2 inheritance ("unfinished
 * work that participated yesterday carries into today") is right for flexible work and wrong for a fixed
 * booking: yesterday's 09:00 standup does not become today's 09:00 standup by not having been ticked.
 *
 * The guard uses `clockSpanMinutes`, NOT `hasStartTime`/`hasEndTime`. Those two derive a clock from the
 * timestamp, so "has both clocks" is a strictly WIDER set than "is an appointment" — it also catches a
 * multi-week task that happens to start and end at non-midnight instants. Three separate defects in this
 * repo have come from that substitution, so the predicate is named here on purpose.
 *
 * And the case that is NOT optional: a missed appointment must still reach Overdue. Suppressing a task
 * from today's list is not the same as forgetting it, and the standing rule is that the laziest user path
 * never silently drops a deadline.
 */
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow } = require('./_load.js');

const HOUR = 3600000;
const at = (y, m, d, hh, mm) => new Date(y, m, d, hh || 0, mm || 0, 0, 0).getTime();

// Anchors in a fixed week: Mon 2026-06-15 .. Sun 2026-06-21.
const MON = at(2026, 5, 15, 12, 0);
const TUE = at(2026, 5, 16, 12, 0);
const THU = at(2026, 5, 18, 12, 0);
const SAT = at(2026, 5, 20, 12, 0);

function task(c, over){
  return c.normalizeTask(Object.assign({
    id:'t'+Math.random().toString(36).slice(2,7), name:'t', type:'Proportional',
    priority:4, deps:[], pct:0, planned:60, spent:0,
  }, over||{}));
}

test('inherit: the guard is clockSpanMinutes, not the two has*Time helpers', () => {
  withNow(TUE, () => {
    const c = make();
    // A three-week task that merely starts and ends at a clock time. Both has*Time helpers say true;
    // it is NOT an appointment, and it must keep inheriting.
    const long = task(c, { start: at(2026,5,1,9,0), end: at(2026,5,22,17,0),
      startClock:true, endClock:true, pct:10 });
    c.state.tasks = [long];
    assert.strictEqual(c.hasStartTime(long), true, 'fixture sanity: both clocks present');
    assert.strictEqual(c.hasEndTime(long), true);
    assert.strictEqual(c.clockSpanMinutes(long, c.startOfToday()), null,
      'a span longer than a day is not an appointment, whatever its clocks say');
    assert.strictEqual(c.isInheritedToday(long), true,
      'using has*Time here would have silently stopped long clocked work from carrying over');
  });
});

test('inherit: a weekly standup on Wednesday is not on the list on Thursday', () => {
  withNow(THU, () => {
    const c = make();
    const wed = at(2026, 5, 17, 9, 0);
    const standup = task(c, { start: wed, end: wed + 30*60000, startClock:true, endClock:true,
      planned:30, recur:{ kind:'week', n:1 } });
    c.state.tasks = [standup];
    assert.strictEqual(c.isInheritedToday(standup), false,
      "yesterday's 09:00 standup does not become today's by not having been ticked");
    assert.strictEqual(c.isActiveToday(standup), false, 'and it really is off today');
  });
});

test('inherit: a multi-day conference Mon 09:00 -> Wed 17:00 IS on the list on Tuesday', () => {
  withNow(TUE, () => {
    const c = make();
    const conf = task(c, { start: at(2026,5,15,9,0), end: at(2026,5,17,17,0),
      startClock:true, endClock:true, planned:480, onListSince: c.ymdOf(at(2026,5,15,0,0)) });
    c.state.tasks = [conf];
    // Tuesday is INSIDE the occurrence, so inheritance was never involved and A2 must not fire.
    assert.strictEqual(c.isActiveToday(conf), true, 'the window itself covers today');
    assert.strictEqual(c.originOf(conf), 'continued');
  });
});

test('inherit: a missed flight still reaches Overdue — this test is not optional', () => {
  withNow(SAT, () => {
    const c = make();
    // Flight Fri 14:00-18:00, today Saturday, never completed.
    const flight = task(c, { start: at(2026,5,19,14,0), end: at(2026,5,19,18,0),
      startClock:true, endClock:true, planned:240, pct:0 });
    c.state.tasks = [flight];

    assert.strictEqual(c.clockSpanMinutes(flight, c.startOfDay(flight.start)), 240,
      'fixture sanity: this is appointment-shaped');
    assert.strictEqual(c.isInheritedToday(flight), false, 'A2 suppresses the inheritance...');
    assert.strictEqual(c.originOf(flight), 'overdue',
      '...but suppressing it from today is NOT the same as forgetting it');
  });
});

test('inherit: Overdue precedence is a rule, not statement order', () => {
  withNow(SAT, () => {
    const c = make();
    // Overdue AND carrying a Continued-shaped key: overdue has to win regardless of where the key check
    // sits in the function body.
    const late = task(c, { start: at(2026,5,17,9,0), end: at(2026,5,18,17,0),
      startClock:true, endClock:true, pct:20, included:true,
      onListSince: c.ymdOf(at(2026,5,17,0,0)) });
    c.state.tasks = [late];
    assert.strictEqual(c.isOverdueToday(late), true, 'fixture sanity');
    assert.notStrictEqual(late.onListSince, null, 'fixture sanity: it also looks Continued');
    assert.strictEqual(c.originOf(late), 'overdue');
  });
});

test('inherit: a flexible multi-day task still carries over — A2 is scoped to appointments', () => {
  withNow(TUE, () => {
    const c = make();
    // Bare dates, no clocks: ordinary flexible work spanning yesterday.
    const flex = task(c, { start: at(2026,5,15,0,0), end: at(2026,5,20,0,0), pct:30 });
    c.state.tasks = [flex];
    assert.strictEqual(c.clockSpanMinutes(flex, c.startOfToday()), null, 'not an appointment');
    assert.strictEqual(c.isInheritedToday(flex), true);
  });
});
