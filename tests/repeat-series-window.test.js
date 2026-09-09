/* A repeating task's start and end are the SERIES WINDOW.
 *
 * Owner, 2026-09-09: *"the start and end times should be the recurrence start and end times. The details
 * of each occurrence should be stored in the detail panel and be parsed. So something like 'from A to B
 * every wednesday and every other thursday' should have A and B be the start and end columns and be the
 * recurrence start and end, and occurrences would be on wednesday and every other thursday."*
 *
 * The old model read `t.end - t.start` as each OCCURRENCE's length and bounded the series with
 * `recur.until` — a field the repeat picker always wrote as null and no control could ever set. So a task
 * dated Sep 1 → Sep 30 and set to Daily became a thirty-day-long bar starting every day, forever, which
 * is the "extend indefinitely" report.
 *
 * The new shape:
 *   t.start        the first day the series may produce an occurrence (the anchor)
 *   t.end          the last instant it may — null means unbounded
 *   recur.durMs    how long ONE occurrence lasts
 *
 * `recur.until` is retired to a legacy INPUT (Google's RRULE and the quick-add "until" clause still write
 * it) and folded into `t.end` by `normalizeTask`, so there is exactly one series end in stored data.
 */
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

const HOUR = 3600000;
const daily = { kind:'day', n:1, label:'Daily', shifts:[], overrides:{} };

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
test('a bounded window produces one occurrence per day and stops at the end', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'sprint', start:B, end:B + 4*DAY,
      recur:Object.assign({}, daily, { durMs: DAY }) });
    const occs = c.expandTask(t, B + 60*DAY);
    assert.strictEqual(occs.length, 5, 'today plus four more days, then it stops');
    assert.strictEqual(occs[0].start, B);
    assert.strictEqual(occs[0].end - occs[0].start, DAY, 'each occurrence is ONE day, not the window');
    assert.ok(occs[occs.length-1].start <= B + 4*DAY, 'nothing past the window end');
  });
});

test('a null end is an unbounded series', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:null,
      recur:Object.assign({}, daily, { durMs: HOUR }) });
    const occs = c.expandTask(t, B + 30*DAY);
    assert.ok(occs.length >= 30, 'runs to the horizon');
    assert.strictEqual(occs[0].end - occs[0].start, HOUR, 'the occurrence is an hour');
  });
});

test('a repeat with only a start is still SCHEDULED — its end is genuinely optional', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const open = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:null,
      recur:Object.assign({}, daily, { durMs: HOUR }) });
    assert.strictEqual(c.isScheduled(open), true, 'an unbounded repeat is not a dateless ghost');
    const plain = c.normalizeTask({ id:'p', name:'plain', start:B, end:null });
    assert.strictEqual(c.isScheduled(plain), false, 'a NON-repeat still needs both edges');
  });
});

test('the series end bounds the expansion even when the horizon reaches further', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'sprint', start:B, end:B + 2*DAY,
      recur:Object.assign({}, daily, { durMs: DAY }) });
    assert.strictEqual(c.seriesEndMs(t), B + 2*DAY);
    assert.ok(c.expandTask(t, B + 365*DAY).every(o => o.start <= B + 2*DAY));
  });
});

// ---------------------------------------------------------------------------
// The legacy shape keeps working — the accessors, not a rewrite at every call site
// ---------------------------------------------------------------------------
test('a legacy repeat (no durMs) still reads its occurrence length from start..end', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const legacy = { id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:null } };
    assert.strictEqual(c.recurDurMs(legacy), HOUR);
    assert.strictEqual(c.seriesEndMs(legacy), null, 'no until means unbounded, as it always did');
  });
});

test('a legacy repeat bounded by recur.until still stops there', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const legacy = { id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:B + 3*DAY } };
    assert.strictEqual(c.seriesEndMs(legacy), B + 3*DAY);
  });
});

// ---------------------------------------------------------------------------
// normalizeTask is the single funnel that converts the shape
// ---------------------------------------------------------------------------
test('normalizeTask migrates a legacy repeat: length onto the rule, window opened', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:null } });
    assert.strictEqual(t.recur.durMs, HOUR, 'the occurrence length moved onto the rule');
    assert.strictEqual(t.end, null, 'the window is unbounded, as an unbounded series always was');
    assert.strictEqual(t.recur.until, null);
    // and the behaviour is unchanged
    assert.strictEqual(c.expandTask(t, B + 5*DAY)[0].end - c.expandTask(t, B + 5*DAY)[0].start, HOUR);
  });
});

test('normalizeTask folds recur.until into the window end', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:B + 6*DAY } });
    assert.strictEqual(t.end, B + 6*DAY, 'the series end is now the task end');
    assert.strictEqual(t.recur.until, null, 'exactly one series end in stored data');
    assert.strictEqual(t.recur.durMs, HOUR);
  });
});

test('normalizeTask is idempotent — a migrated repeat passes through untouched', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const once = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:null } });
    const twice = c.normalizeTask(JSON.parse(JSON.stringify(once)));
    assert.strictEqual(twice.recur.durMs, once.recur.durMs);
    assert.strictEqual(twice.end, once.end);
  });
});

test('normalizeTask leaves a DATELESS repeat alone — there is no length to move', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = c.normalizeTask({ id:'r', name:'someday', start:null, end:null, recur:Object.assign({}, daily) });
    assert.ok(t.recur.durMs == null, 'no invented duration');
    assert.strictEqual(c.isScheduled(t), false, 'still a ghost, as before');
  });
});

// ---------------------------------------------------------------------------
// Applying a repeat from the picker
// ---------------------------------------------------------------------------
test('setRecur on a span LONGER than one period keeps the span as the window', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    c.state.tasks = [c.normalizeTask({ id:'r', name:'sprint', start:B, end:B + 30*DAY })];
    c.setRecur('r', 'day');
    const t = c.state.tasks[0];
    assert.strictEqual(t.start, B, 'window start unchanged');
    assert.strictEqual(t.end, B + 30*DAY, 'window end unchanged — this is the report');
    assert.strictEqual(t.recur.durMs, DAY, 'and each occurrence is one day, not thirty');
    const occs = c.expandTask(t, B + 365*DAY);
    assert.ok(occs.length > 25 && occs.length <= 31, 'about a month of daily occurrences');
    assert.ok(occs.every(o => o.start <= B + 30*DAY), 'and it stops at the window end');
  });
});

test('setRecur on a span SHORTER than one period reads it as the occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    c.state.tasks = [c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
      startClock:true, endClock:true })];
    c.setRecur('r', 'day');
    const t = c.state.tasks[0];
    assert.strictEqual(t.recur.durMs, HOUR, 'an hour long, every day');
    assert.strictEqual(t.end, null, 'unbounded — no end was stated');
  });
});

// ---------------------------------------------------------------------------
// "This and following" deletes now move the WINDOW end, which is the only series end
// ---------------------------------------------------------------------------
test('deleting "this and following" ends the series at the window, not at recur.until', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    c.state.tasks = [c.normalizeTask({ id:'r', name:'standup', start:B, end:null,
      recur:Object.assign({}, daily, { durMs: DAY }) })];
    const occs = c.expandTask(c.state.tasks[0], B + 10*DAY);
    const third = occs[2];
    c.openScope('delete', 'r', third.idx);
    c.applyScope('subsequent');
    const t = c.state.tasks[0];
    assert.ok(t.end != null && t.end < third.start, 'the window closed before that occurrence');
    assert.ok(c.expandTask(t, B + 30*DAY).every(o => o.start < third.start));
  });
});

// ---------------------------------------------------------------------------
// Google Calendar round-trip: the RRULE's UNTIL is the window end
// ---------------------------------------------------------------------------
test('recurToRRule takes the series end from the task, not from a retired field', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:B + 6*DAY,
      recur:Object.assign({}, daily, { durMs: HOUR }) });
    const rule = c.recurToRRule(t.recur, c.seriesEndMs(t));
    assert.match(rule, /^RRULE:FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/);
  });
});

test('an unbounded series emits no UNTIL', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id:'r', name:'standup', start:B + 9*HOUR, end:null,
      recur:Object.assign({}, daily, { durMs: HOUR }) });
    assert.strictEqual(c.recurToRRule(t.recur, c.seriesEndMs(t)), 'RRULE:FREQ=DAILY');
  });
});

// ---------------------------------------------------------------------------
// The one-time sweep over an existing workspace
// ---------------------------------------------------------------------------
test('the migration converts every stored repeat and leaves plain tasks alone', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const tasks = [
      { id:'a', name:'standup', start:B + 9*HOUR, end:B + 10*HOUR,
        recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{}, until:B + 6*DAY } },
      { id:'b', name:'plain', start:B, end:B + 2*DAY },
    ];
    const n = c.migrateRecurWindow(tasks);
    assert.strictEqual(n, 1, 'one repeat converted');
    assert.strictEqual(tasks[0].recur.durMs, HOUR);
    assert.strictEqual(tasks[0].end, B + 6*DAY);
    assert.strictEqual(tasks[0].recur.until, null);
    assert.strictEqual(tasks[1].end, B + 2*DAY, 'a plain task is untouched');
    assert.strictEqual(c.migrateRecurWindow(tasks), 0, 'and the sweep is idempotent');
  });
});
