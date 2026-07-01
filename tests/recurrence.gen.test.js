// Independent test suite for recurrence date-math.
// Expectations are derived from the SPEC in the task and from naive oracles written here,
// NOT copied from the implementation body.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const DAY = 86400000;
const c = make();

// ---- Independent oracles ------------------------------------------------

// Days in a given (year, monthIndex) using local-time construction.
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// addMonths oracle: add k months, clamp day to target month length, preserve time-of-day.
function addMonthsOracle(baseMs, k, anchorDay) {
  const d = new Date(baseMs);
  const anchor = anchorDay != null ? anchorDay : d.getDate();
  const tmTotal = d.getMonth() + k;
  const ty = d.getFullYear() + Math.floor(tmTotal / 12);
  const tm = ((tmTotal % 12) + 12) % 12;
  const day = Math.min(anchor, daysInMonth(ty, tm));
  return new Date(ty, tm, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

// Naive weekday (Mon-Fri) oracle: advance one calendar day at a time, count matches.
function nthDowOracle(baseMs, i, pred) {
  if (i <= 0) return baseMs;
  const d = new Date(baseMs);
  let count = 0;
  while (count < i) {
    d.setDate(d.getDate() + 1);
    if (pred(d.getDay())) count++;
  }
  return d.getTime();
}
const isWeekday = (w) => w !== 0 && w !== 6;

const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function daysToPred(days) {
  const set = new Set(days.map((n) => WD[n]));
  return (w) => set.has(w);
}

// Calendar-day oracle (preserves wall-clock via setDate, matching the app).
function addDaysOracle(baseMs, days) {
  const d = new Date(baseMs);
  d.setDate(d.getDate() + days);
  return d.getTime();
}
function addYearsOracle(baseMs, years) {
  const d = new Date(baseMs);
  d.setFullYear(d.getFullYear() + years);
  return d.getTime();
}

function fmt(ms) { return new Date(ms).toString(); }

// ---- 1. addMonths ------------------------------------------------------
test('addMonths: Jan-31 clamps and preserves time-of-day', () => {
  const base = new Date(2023, 0, 31, 9, 30).getTime(); // Jan 31 2023 09:30 local
  assert.strictEqual(c.addMonths(base, 1), new Date(2023, 1, 28, 9, 30).getTime(), 'Jan31 +1mo -> Feb28');
  assert.strictEqual(c.addMonths(base, 2), new Date(2023, 2, 31, 9, 30).getTime(), 'Jan31 +2mo -> Mar31');
  assert.strictEqual(c.addMonths(base, 12), new Date(2024, 0, 31, 9, 30).getTime(), 'Jan31 +12mo -> Jan31 next year');
  // time-of-day preserved
  assert.strictEqual(new Date(c.addMonths(base, 1)).getHours(), 9);
  assert.strictEqual(new Date(c.addMonths(base, 1)).getMinutes(), 30);
});

test('addMonths: normal (non-clamping) case', () => {
  const base = new Date(2023, 5, 15, 14, 5).getTime(); // Jun 15
  assert.strictEqual(c.addMonths(base, 3), new Date(2023, 8, 15, 14, 5).getTime(), 'Jun15 +3mo -> Sep15');
});

test('addMonths: anchorDay override + clamp, various k', () => {
  const base = new Date(2024, 0, 10, 8, 0).getTime();
  // anchor 31 into Feb 2024 (leap) -> Feb 29
  assert.strictEqual(c.addMonths(base, 1, 31), new Date(2024, 1, 29, 8, 0).getTime());
  for (let k = -6; k <= 18; k++) {
    assert.strictEqual(c.addMonths(base, k), addMonthsOracle(base, k), 'k=' + k);
    assert.strictEqual(c.addMonths(base, k, 31), addMonthsOracle(base, k, 31), 'anchor31 k=' + k);
  }
});

// ---- 2. occStart month / monthDay clamping over a year -----------------
test('occStart month: 31st anchor never rolls over to next month', () => {
  const base = new Date(2023, 0, 31, 9, 30).getTime(); // Jan 31
  for (let i = 0; i <= 13; i++) {
    const got = c.occStart(base, { kind: 'month', n: 1 }, i);
    const exp = i === 0 ? base : addMonthsOracle(base, i);
    assert.strictEqual(got, exp, 'month i=' + i + ' got=' + fmt(got));
    const d = new Date(got);
    // target month index
    const tmTotal = 0 + i;
    const tm = ((tmTotal % 12) + 12) % 12;
    const ty = 2023 + Math.floor(tmTotal / 12);
    assert.strictEqual(d.getMonth(), i === 0 ? 0 : tm, 'month landed in wrong month at i=' + i);
    assert.strictEqual(d.getDate(), i === 0 ? 31 : Math.min(31, daysInMonth(ty, tm)),
      'day-of-month not clamped at i=' + i + ' -> ' + fmt(got));
    // explicitly assert it did NOT roll into 1st-3rd of following month
    assert.ok(d.getDate() >= 28, 'clamped day should be month-end, got ' + d.getDate() + ' at i=' + i);
  }
});

test('occStart monthDay: fixed day clamped to month length', () => {
  const base = new Date(2023, 0, 15, 7, 0).getTime();
  for (let i = 0; i <= 13; i++) {
    const got = c.occStart(base, { kind: 'monthDay', day: 31 }, i);
    const exp = i === 0 ? base : addMonthsOracle(base, i, 31);
    assert.strictEqual(got, exp, 'monthDay i=' + i);
    if (i > 0) {
      const d = new Date(got);
      assert.ok(d.getDate() >= 28, 'monthDay clamp failed at i=' + i + ' -> ' + fmt(got));
    }
  }
});

// ---- 3. occStart weekday (Mon-Fri) vs naive oracle ---------------------
test('occStart weekday matches naive Mon-Fri oracle for several base weekdays', () => {
  const bases = {
    Monday: new Date(2024, 0, 1, 10, 0).getTime(),   // 2024-01-01 is Monday
    Friday: new Date(2024, 0, 5, 10, 0).getTime(),   // Friday
    Saturday: new Date(2024, 0, 6, 10, 0).getTime(), // Saturday
    Sunday: new Date(2024, 0, 7, 10, 0).getTime(),   // Sunday
  };
  for (const [label, base] of Object.entries(bases)) {
    assert.strictEqual(new Date(base).getDay(), { Monday: 1, Friday: 5, Saturday: 6, Sunday: 0 }[label], label + ' base weekday');
    for (let i = 0; i <= 40; i++) {
      const got = c.occStart(base, { kind: 'weekday' }, i);
      const exp = nthDowOracle(base, i, isWeekday);
      assert.strictEqual(got, exp, `weekday base=${label} i=${i} got=${fmt(got)} exp=${fmt(exp)}`);
      if (i > 0) assert.ok(isWeekday(new Date(got).getDay()), 'landed on a weekend at i=' + i);
    }
  }
});

// ---- 4. occStart weekdays custom sets vs naive oracle ------------------
test('occStart weekdays [mon,wed,fri] matches naive oracle', () => {
  const days = ['mon', 'wed', 'fri'];
  const pred = daysToPred(days);
  const bases = [
    new Date(2024, 2, 4, 9, 0).getTime(), // Monday
    new Date(2024, 2, 9, 9, 0).getTime(), // Saturday
    new Date(2024, 2, 10, 9, 0).getTime(), // Sunday
  ];
  for (const base of bases) {
    for (let i = 0; i <= 30; i++) {
      const got = c.occStart(base, { kind: 'weekdays', days }, i);
      const exp = nthDowOracle(base, i, pred);
      assert.strictEqual(got, exp, `weekdays[mwf] base=${fmt(base)} i=${i}`);
      if (i > 0) assert.ok(pred(new Date(got).getDay()), 'not in set at i=' + i);
    }
  }
});

test('occStart weekdays single-day set behaves weekly', () => {
  const base = new Date(2024, 2, 6, 9, 0).getTime(); // Wednesday
  const pred = daysToPred(['wed']);
  for (let i = 0; i <= 20; i++) {
    const got = c.occStart(base, { kind: 'weekdays', days: ['wed'] }, i);
    assert.strictEqual(got, nthDowOracle(base, i, pred), 'wed-only i=' + i);
    // and equals base + i weeks (calendar) since base is a Wednesday
    if (i > 0) assert.strictEqual(got, addDaysOracle(base, 7 * i), 'weekly step i=' + i);
  }
});

test('occStart weekdays full week set = every day', () => {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const base = new Date(2024, 2, 6, 9, 0).getTime();
  const pred = daysToPred(days);
  for (let i = 0; i <= 20; i++) {
    const got = c.occStart(base, { kind: 'weekdays', days }, i);
    assert.strictEqual(got, nthDowOracle(base, i, pred), 'fullweek i=' + i);
    assert.strictEqual(got, addDaysOracle(base, i), 'fullweek == +i days i=' + i);
  }
});

// ---- 5. day / week / year basic correctness incl n>1 -------------------
test('occStart day/week/year basic correctness', () => {
  const base = new Date(2023, 5, 15, 9, 30).getTime(); // Jun 15 2023, DST-stable window
  for (let i = 0; i <= 10; i++) {
    // day n=1
    assert.strictEqual(c.occStart(base, { kind: 'day', n: 1 }, i), addDaysOracle(base, i), 'day n1 i=' + i);
    if (i > 0) assert.strictEqual(c.occStart(base, { kind: 'day', n: 1 }, i), base + i * DAY, 'day n1 ms i=' + i);
    // day n=3
    assert.strictEqual(c.occStart(base, { kind: 'day', n: 3 }, i), addDaysOracle(base, 3 * i), 'day n3 i=' + i);
    // week n=1
    assert.strictEqual(c.occStart(base, { kind: 'week', n: 1 }, i), addDaysOracle(base, 7 * i), 'week n1 i=' + i);
    // week n=2
    assert.strictEqual(c.occStart(base, { kind: 'week', n: 2 }, i), addDaysOracle(base, 14 * i), 'week n2 i=' + i);
    // year n=1
    assert.strictEqual(c.occStart(base, { kind: 'year', n: 1 }, i), addYearsOracle(base, i), 'year n1 i=' + i);
    // year n=2
    assert.strictEqual(c.occStart(base, { kind: 'year', n: 2 }, i), addYearsOracle(base, 2 * i), 'year n2 i=' + i);
  }
  // default n = 1 when omitted
  assert.strictEqual(c.occStart(base, { kind: 'day' }, 4), addDaysOracle(base, 4));
  assert.strictEqual(c.occStart(base, { kind: 'week' }, 4), addDaysOracle(base, 28));
});

test('occStart i===0 returns base unchanged even on a weekend / non-matching day', () => {
  const sat = new Date(2024, 0, 6, 11, 15).getTime(); // Saturday
  for (const rule of [
    { kind: 'weekday' },
    { kind: 'weekdays', days: ['mon'] },
    { kind: 'month', n: 1 },
    { kind: 'monthDay', day: 10 },
    { kind: 'day', n: 5 },
    { kind: 'year', n: 1 },
  ]) {
    assert.strictEqual(c.occStart(sat, rule, 0), sat, 'i0 rule=' + rule.kind);
  }
});

// ---- 6. expandTask -----------------------------------------------------
function baseTask(over) {
  return Object.assign({ id: 't' + Math.random().toString(36).slice(2), name: 'x', start: 0, end: 0 }, over);
}

test('expandTask: non-recurring task -> single occ shape', () => {
  const t = baseTask({ start: 1000, end: 2000 });
  // Array.from re-homes the vm-sandbox array/objects into this realm so deepStrictEqual's prototype check passes.
  const occs = Array.from(c.expandTask(t, t.end), (o) => ({ idx: o.idx, start: o.start, end: o.end, occ: o.occ }));
  assert.deepStrictEqual(occs, [{ idx: 0, start: 1000, end: 2000, occ: false }]);
});

test('expandTask: daily recurrence produces increasing starts', () => {
  const start = Date.now();
  const t = baseTask({ start, end: start + 60 * 60000, recur: { kind: 'day', n: 1 } });
  const horizon = start + 10 * DAY + DAY / 2;
  const occs = c.expandTask(t, horizon);
  assert.ok(occs.length >= 2, 'expected multiple occurrences, got ' + occs.length);
  for (let k = 1; k < occs.length; k++) {
    assert.ok(occs[k].start > occs[k - 1].start, 'starts must strictly increase at k=' + k);
  }
  assert.ok(occs.every((o) => o.occ === true), 'recurring occs flagged occ:true');
});

test('expandTask: until truncates the series', () => {
  const start = Date.now();
  const t = baseTask({ start, end: start + 60 * 60000, recur: { kind: 'day', n: 1, until: start + 3 * DAY + DAY / 2 } });
  const horizon = start + 100 * DAY;
  const occs = c.expandTask(t, horizon);
  // idx 0..3 have baseRaw <= until (3.5 days), idx4 (~4 days) exceeds -> 4 occurrences
  const idxs = Array.from(occs, (o) => o.idx);
  assert.deepStrictEqual(idxs, [0, 1, 2, 3], 'until should keep idx 0..3, got ' + JSON.stringify(idxs));
});

test('expandTask: overrides[idx].deleted removes that occurrence', () => {
  const start = Date.now();
  const t = baseTask({
    start, end: start + 60 * 60000,
    recur: { kind: 'day', n: 1, overrides: { 2: { deleted: true } } },
  });
  const horizon = start + 5 * DAY + DAY / 2;
  const occs = c.expandTask(t, horizon);
  const idxs = Array.from(occs, (o) => o.idx);
  assert.ok(!idxs.includes(2), 'idx 2 should be deleted, got ' + JSON.stringify(idxs));
  assert.deepStrictEqual(idxs, [0, 1, 3, 4, 5], 'expected 0,1,3,4,5 got ' + JSON.stringify(idxs));
});
