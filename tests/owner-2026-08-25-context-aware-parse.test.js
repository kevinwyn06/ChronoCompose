// Owner ask 2026-08-25 — the parser must read the TASK, not only the text.
//
// Owner, verbatim: "a duration in the parser should generate the second endpoint if the first one is
// already given, rather than becoming a planned duration. Also, the parser should work in conjunction
// with existing information. Say the task is already scheduled to start at 8:30pm today. Then if I add
// in the title bar 'by 9:00pm' that should be perfectly clear what that means and silently parse that."
//
// The shaping rule was never wrong — it was being applied to the TEXT instead of to the task. Proof, on
// the code as it stood:
//
//   title bar : start 8:30pm + "deep work 45m"              -> planned 45, end NULL
//   When line : start 8:30pm + "Mon Jun 15, 8:30pm for 45m" -> end 9:15pm
//
// Same parser, same shaping, opposite outcome — because the When line restates the start IN THE TEXT, so
// the parse sees both sides. `shapeParsedTask` is context-free and saw a lone duration, so it called it a
// budget. Hence `reconcileWhen`: one pure resolver owning all endpoint arithmetic, handed the existing
// task by the title bar and `null` by everything else.
//
// OWNER RULING (2026-08-25): a duration is a BUDGET when both endpoints are known or neither is, and
// DERIVES the missing endpoint when exactly one is known and it is a real instant. A bare day is not an
// instant — "gym friday for 45m" must not become a midnight appointment. When both edges are already
// clocked, a typed duration RESIZES from the start (owner picked this over storing a contradiction).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

function withTask(c, extra){
  const t = c.normalizeTask(Object.assign({ id: 't1', name: 'deep work' }, extra || {}));
  c.state.tasks = [t];
  return () => c.state.tasks.find(x => x.id === 't1');
}
const day = (c, n) => c.startOfToday() + (n || 0) * DAY;
const at = (c, n, h, m) => day(c, n) + (h * 60 + (m || 0)) * 60000;

// ---------------------------------------------------------------------------
// The owner's own case: a duration added to a task that already has a start.
// ---------------------------------------------------------------------------

test('title bar: a bare duration on a clocked start generates the END, not a budget', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true, planned: null });
    c.rename('t1', 'deep work 45m');
    const t = get();
    assert.equal(t.start, at(c, 0, 20, 30), 'the start it already had is untouched');
    assert.equal(t.end, at(c, 0, 21, 15), 'the duration produced the second endpoint');
    assert.equal(t.endClock, true);
    assert.equal(t.planned, 45);
  });
});

test('title bar: "for 45m" reads the same as a bare duration', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    c.rename('t1', 'deep work for 45m');
    assert.equal(get().end, at(c, 0, 21, 15));
  });
});

test('title bar: a duration on a DEADLINE derives the start backwards', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: null, end: at(c, 0, 21, 0), endClock: true });
    c.rename('t1', 'deep work 2h');
    const t = get();
    assert.equal(t.end, at(c, 0, 21, 0), 'the deadline holds');
    assert.equal(t.start, at(c, 0, 19, 0), 'the work runs back from it, never past it');
    assert.equal(t.startClock, true);
    assert.equal(t.planned, 120);
  });
});

test('a bare DAY is not an instant — the duration stays a budget, not a midnight appointment', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: day(c, 2), end: day(c, 3), startClock: null, endClock: null });
    c.rename('t1', 'deep work 45m');
    const t = get();
    assert.equal(t.planned, 45);
    assert.equal(t.start, day(c, 2), 'the day is unchanged');
    assert.equal(t.end, day(c, 3), 'and NOT collapsed onto a 00:00-00:45 block');
  });
});

test('no dates at all — the duration is the movable budget it has always been', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: null, end: null });
    c.rename('t1', 'deep work 45m');
    const t = get();
    assert.equal(t.planned, 45);
    assert.equal(t.start, null);
    assert.equal(t.end, null);
    assert.equal(t.name, 'deep work 45m', 'nothing moved, so the strip leaves the words alone');
  });
});

test('both edges clocked: a typed duration RESIZES from the start (owner ruling)', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 14, 0), end: at(c, 0, 15, 0), startClock: true, endClock: true });
    c.rename('t1', 'deep work 90m');
    const t = get();
    assert.equal(t.start, at(c, 0, 14, 0), 'the start anchors');
    assert.equal(t.end, at(c, 0, 15, 30), 'the end moves to honour the duration');
    assert.equal(t.planned, 90);
  });
});

// ---------------------------------------------------------------------------
// "by 9:00pm" on a task that already starts at 8:30pm — absence in the text is
// NOT an instruction to delete.
// ---------------------------------------------------------------------------

test('title bar: a deadline keeps the start the task already had', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    c.rename('t1', 'deep work by 9:00pm');
    const t = get();
    assert.equal(t.start, at(c, 0, 20, 30), 'the start survives — it was never mentioned, not cleared');
    assert.equal(t.end, at(c, 0, 21, 0));
    assert.equal(t.startClock, true);
    assert.equal(t.endClock, true);
    assert.equal(t.planned, 30, 'a booked intra-day span is the plan');
  });
});

test('title bar: a start keeps the due date the task already had', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: null, end: at(c, 3, 17, 0), endClock: true });
    c.rename('t1', 'deep work start wednesday');
    const t = get();
    assert.equal(t.end, at(c, 3, 17, 0), 'the deadline survives the start edit');
    assert.notEqual(t.start, null);
    assert.ok(t.start <= t.end);
  });
});

test('a retained edge that would INVERT the span is dropped, and the text wins', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    c.rename('t1', 'deep work by 8:00pm');
    const t = get();
    assert.equal(t.end, at(c, 0, 20, 0), 'the deadline the user typed is what they get');
    assert.equal(t.start, null, 'rather than a task that ends before it begins');
  });
});

test('a bare day well after the task\'s own end does not drag the old end along', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 9, 0), end: at(c, 0, 10, 0), startClock: true, endClock: true });
    c.rename('t1', 'deep work friday');
    const t = get();
    assert.ok(t.start > at(c, 0, 10, 0), 'moved to Friday');
    assert.equal(t.end, null, 'and the Monday 10am end did not survive as an inverted edge');
  });
});

test('a recurrence the text never mentions is not destroyed by a date edit', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 9, 0), end: null, startClock: true,
      recur: { kind: 'week', n: 1, label: 'Weekly', until: null, shifts: [], overrides: {} } });
    c.rename('t1', 'team sync by 10:00am');
    const t = get();
    assert.ok(t.recur, 'the rule survives');
    assert.equal(t.recur.label, 'Weekly');
    assert.equal(t.start, at(c, 0, 9, 0));
    assert.equal(t.end, at(c, 0, 10, 0));
  });
});

// ---------------------------------------------------------------------------
// The parser's own half: a deadline cue plus a duration ran PAST the deadline.
// ---------------------------------------------------------------------------

test('parser: "by 9pm for 2h" runs BACK from the deadline, not past it', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('write by 9pm for 2h');
    const s = c.shapeParsedTask(p, 'anchor');
    assert.equal(s.end, at(c, 0, 21, 0), 'the clock the user wrote is the DEADLINE');
    assert.equal(s.start, at(c, 0, 19, 0));
    assert.equal(s.startClock, true);
    assert.equal(s.endClock, true);
  });
});

test('parser: a start cue plus a duration still runs forward', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const s = c.shapeParsedTask(c.parseDateText('write from 9pm for 2h'), 'anchor');
    assert.equal(s.start, at(c, 0, 21, 0));
    assert.equal(s.end, at(c, 0, 23, 0));
  });
});

test('parser: an explicit clock RANGE is untouched by the deadline rule', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const s = c.shapeParsedTask(c.parseDateText('call 3pm to 4pm'), 'anchor');
    assert.equal(s.start, at(c, 0, 15, 0));
    assert.equal(s.end, at(c, 0, 16, 0));
  });
});

// ---------------------------------------------------------------------------
// Quick-add and the When line must not drift from the title bar.
// ---------------------------------------------------------------------------

test('quick-add is unchanged: no task to read, so the text is the whole story', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const s = c.shapeParsedTask(c.parseDateText('gym friday for 45m'), 'anchor');
    assert.equal(s.planned, 45, 'a bare day keeps the budget');
    assert.equal(s.end, null);
    const b = c.shapeParsedTask(c.parseDateText('call at 8:30pm for 45m'), 'anchor');
    assert.equal(b.start, at(c, 0, 20, 30));
    assert.equal(b.end, at(c, 0, 21, 15), 'a clocked start still derives its end');
  });
});

test('the When line REPLACES rather than merges — it prints the whole state', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    const r = c.applyWhenText('t1', 'by 9:00pm');
    assert.equal(r.ok, true);
    const t = get();
    assert.equal(t.end, at(c, 0, 21, 0));
    assert.equal(t.start, null, 'the line states everything, so what it omits is deliberate');
  });
});

test('the When line still derives an end from a duration it can see', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    c.applyWhenText('t1', 'Mon Jun 15, 8:30pm for 45m');
    assert.equal(get().end, at(c, 0, 21, 15));
  });
});

// ---------------------------------------------------------------------------
// The no-op guard and the strip must read the RECONCILED result, not the raw parse.
// ---------------------------------------------------------------------------

test('a re-worded title that changes no date leaves the recognised words alone', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const get = withTask(c, { start: at(c, 0, 20, 30), end: null, startClock: true });
    c.rename('t1', 'deep work by 9:00pm');
    assert.equal(get().name, 'deep work', 'the first edit moved the date, so the words moved too');
    c.rename('t1', 'deep work by 9:00pm');
    const t = get();
    assert.equal(t.start, at(c, 0, 20, 30), 'and re-applying it changes nothing');
    assert.equal(t.end, at(c, 0, 21, 0));
  });
});

test('reconcileWhen is pure and takes a null base', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('call at 8:30pm for 45m');
    const shaped = c.shapeParsedTask(p, 'anchor');
    const a = c.reconcileWhen(null, shaped, p);
    const b = c.reconcileWhen(null, shaped, p);
    assert.deepEqual(a, b);
    assert.equal(shaped.end, at(c, 0, 21, 15), 'the input was not mutated into something new');
  });
});
