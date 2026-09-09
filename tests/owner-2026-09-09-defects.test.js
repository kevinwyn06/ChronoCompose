// Owner defect report, 2026-09-09 (second session). One test per reported defect, at the lowest layer
// that can prove it. The e2e counterpart for the date-cell/Clear defect is
// tests/e2e/owner-2026-09-09-clear-repeat-date.spec.js — that one needs a real click on a real picker.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, withNow } = require('./_load');

const DAY = 86400000;
// Wed 2026-09-09, 14:00 local — the day the report was written, well clear of any midnight boundary.
const NOW = new Date(2026, 8, 9, 14, 0, 0, 0).getTime();
const day = (y, m, d, h, mi) => new Date(y, m, d, h || 0, mi || 0, 0, 0).getTime();

// ---------------------------------------------------------------------------
// "Should not have good morning popup occur a minute after midnight. Needs to be after 3am or something."
// ---------------------------------------------------------------------------

// A component with the notification ledger and the summary toggle in a known state.
function summaryRig() {
  const c = make();
  c.state.tasks = [];
  c._notify = { fired: {}, summaryDay: null };
  c.saveNotify = () => {};
  c.notifyOn = () => true;
  const raised = [];
  c.setState = o => { if (typeof o === 'function') o = o(c.state); Object.assign(c.state, o); if (o.summary) raised.push(o.summary); };
  return { c, raised };
}

test('morning summary: 00:01 raises nothing and does NOT consume the day', () => {
  const { c, raised } = summaryRig();
  withNow(day(2026, 8, 10, 0, 1), () => c.maybeMorningSummary(day(2026, 8, 10, 0, 1)));
  assert.equal(raised.length, 0, 'a minute after midnight is not morning');
  assert.equal(c._notify.summaryDay, null,
    'the day must stay unconsumed, or the real morning would find it already spent');
});

test('morning summary: fires once the floor hour has passed, then only once that day', () => {
  const { c, raised } = summaryRig();
  const at = h => day(2026, 8, 10, h, 5);
  withNow(at(3), () => c.maybeMorningSummary(at(3)));
  assert.equal(raised.length, 0, '3:05am is still below the floor');
  withNow(at(8), () => c.maybeMorningSummary(at(8)));
  assert.equal(raised.length, 1, 'the first tick at or after the floor raises it');
  withNow(at(9), () => c.maybeMorningSummary(at(9)));
  assert.equal(raised.length, 1, 'still once per calendar day');
  assert.equal(c._notify.summaryDay, c.startOfDay(at(8)));
});

test('morning summary: the floor is a named constant, after 3am', () => {
  const c = make();
  assert.ok(c.SUMMARY_HOUR > 3 && c.SUMMARY_HOUR < 12, 'SUMMARY_HOUR is a sane morning hour');
});

// ---------------------------------------------------------------------------
// "If I change a daily task to not daily, it briefly becomes a non recurring task but in a few
//  seconds reverts to a recurring task."
// ---------------------------------------------------------------------------

test('gcal: dropping a repeat PATCHES recurrence:[] so Google stops sending the series back', () => {
  const c = make();
  const before = c.normalizeTask({ id: 'a', name: 'Standup', start: day(2026, 8, 1, 9, 0), end: day(2026, 8, 1, 9, 15),
    startClock: true, endClock: true, calendarId: 'primary', eventId: 'e1',
    recur: { kind: 'day', n: 1, label: 'Daily', durMs: 15 * 60000, shifts: [], overrides: {} } });
  const after = Object.assign({}, before, { recur: null });

  const ops = c.computeOutboundOps([before], [after]);
  const patch = ops.find(o => o.op === 'patch');
  assert.ok(patch, 'dropping the rule is an outbound change');
  assert.deepEqual(patch.body.recurrence, [],
    'an empty recurrence list is how Google is told the series is now a single event; ' +
    'omitting the key left the RRULE in place and the next import restored the rule');
});

test('gcal: a task that never had a rule still says so, and a live rule still ships its RRULE', () => {
  const c = make();
  const plain = c.normalizeTask({ id: 'p', name: 'One off', start: day(2026, 8, 11, 9, 0), end: day(2026, 8, 11, 10, 0), startClock: true, endClock: true });
  assert.deepEqual(c.eventBodyOf(plain, true).recurrence, []);
  const rep = c.normalizeTask({ id: 'r', name: 'Weekly', start: day(2026, 8, 11, 9, 0), end: null,
    startClock: true, recur: { kind: 'week', n: 1, label: 'Weekly', durMs: 3600000, shifts: [], overrides: {} } });
  assert.ok(/^RRULE:/.test(c.eventBodyOf(rep, true).recurrence[0]), 'a live rule still ships as an RRULE');
  assert.equal(c.eventBodyOf(rep, false).recurrence, undefined,
    'and the "do not touch the RRULE" path still writes nothing at all');
});

// ---------------------------------------------------------------------------
// "I write in the when line of the detail panel 'from A to B' and only A gets stored."
// ---------------------------------------------------------------------------

// Apply `text` to a dateless task through the When line and report the window it stored.
function whenWindow(text) {
  const c = make();
  const t = c.normalizeTask({ id: 'a', name: 'T', start: null, end: null });
  c.state.tasks = [t]; c.state.sections = [];
  const r = c.applyWhenText('a', text);
  const x = c.state.tasks[0];
  return { ok: r.ok, error: r.error, start: x.start, end: x.end, recur: x.recur };
}

test('When line: every spelling of a day range stores BOTH edges', () => {
  const A = day(2026, 8, 10), B = day(2026, 8, 13); // Sep 10 → Sep 12 inclusive (end is exclusive)
  withNow(NOW, () => {
    [
      'from sept 10 to sept 12',   // the shape that already worked — the control
      'sept 10 to sept 12',        // no "from": the cue is not what makes B real
      'sept 10 - sept 12',
      'from sept 10 until sept 12', // "until" with no rule is a range, not a series end
      'from 10 sept to 12 sept',    // day-first
      '10 sept to 12 sept',
    ].forEach(txt => {
      const w = whenWindow(txt);
      assert.equal(w.start, A, txt + ': start');
      assert.equal(w.end, B, txt + ': end (this is the edge that used to be dropped)');
    });
  });
});

test('When line: "until <date>" is still a SERIES end when a rule was actually typed', () => {
  withNow(NOW, () => {
    const w = whenWindow('every wednesday until sept 30');
    assert.ok(w.recur, 'the rule survives');
    assert.equal(w.end, day(2026, 8, 30) + DAY,
      'a series end is stored exclusively, so the 30th still fires');
  });
});

test('parser: a range whose window is still running is not rolled a year forward', () => {
  withNow(NOW, () => {
    const c = make();
    const p = c.parseDateText('from Sep 1 to Sep 30');
    assert.equal(new Date(p.date).getFullYear(), 2026,
      'Sep 1 is eight days behind, but the window it opens has not closed');
    assert.equal(p.end, day(2026, 9, 1), 'the window closes at the exclusive start of Oct 1');
  });
});

test('parser: a range that is genuinely over still rolls forward', () => {
  withNow(NOW, () => {
    const c = make();
    const p = c.parseDateText('from Mar 1 to Mar 5');
    assert.equal(new Date(p.date).getFullYear(), 2027, 'a closed window means next year');
  });
});

test('parser: a day-first range reads as one window, not as its closing date alone', () => {
  withNow(NOW, () => {
    const c = make();
    const p = c.parseDateText('every wednesday from 1 Sep to 30 Sep');
    assert.ok(p.recur, 'the rule is still claimed');
    assert.equal(p.date, day(2026, 8, 1), 'the window opens on the 1st');
    assert.equal(p.windowEnd, day(2026, 9, 1), 'and closes after the 30th');
  });
});

// ---------------------------------------------------------------------------
// "the clear button on start/end date edit panel does not work, at least on recurring tasks"
// ---------------------------------------------------------------------------

test('a repeat\'s date cells state the SERIES WINDOW — the same fact their editor writes', () => {
  withNow(NOW, () => {
    const c = make();
    const t = c.normalizeTask({ id: 'r', name: 'R', start: day(2026, 7, 1, 9, 0), end: day(2026, 9, 30),
      startClock: true, recur: { kind: 'day', n: 1, label: 'Daily', durMs: 3600000, shifts: [], overrides: {} } });
    c.state.tasks = [t]; c.state.sections = []; c._horizon = NOW + 400 * DAY;

    // The occurrence and the window are different days, which is exactly why the cell has to pick one.
    assert.notEqual(c.currentOcc(c.state.tasks[0]).end, t.end);

    c.clearDate('r', 'end');
    const x = c.state.tasks[0];
    assert.equal(x.end, null, 'Clear writes null — it always did');
    assert.deepEqual(c.sheetDateParts(x, 'end', x.end), { date: '—', time: null },
      'and the cell now SHOWS it, instead of holding a rule-derived occurrence date that never moved');
  });
});
