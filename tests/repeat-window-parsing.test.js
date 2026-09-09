// Owner ruling 2026-09-09, second half — the OCCURRENCE details of a repeat are written and read as
// text, in the detail panel, by the same parser everything else uses.
//
// Owner, verbatim: *"the start and end times should be the recurrence start and end times. The details
// of each occurrence should be stored in the detail panel and be parsed. So something like 'from A to B
// every wednesday and every other thursday' should have A and B be the start and end columns and be the
// recurrence start and end, and occurrences would be on wednesday and every other thursday."*
//
// The model half (tests/repeat-series-window.test.js) settled what the two edges MEAN. This file settles
// how a person states them: the parser must read a window and an occurrence out of one sentence, and the
// When line must print a sentence that reads back as the task it was printed from. A display that cannot
// be re-parsed is a caption, and the When line is supposed to be an editor.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

const HOUR = 3600000;

function shaped(c, text) {
  const p = c.parseDateText(text, Date.now());
  return { p, t: c.normalizeTask(Object.assign({ id: 'r1', name: 'x' }, c.shapeParsedTask(p, 'anchor'))) };
}

// ---------------------------------------------------------------------------
// The owner's sentence: two dates and a rule in one line.
// ---------------------------------------------------------------------------
test('"every wednesday from A to B" makes A and B the SERIES WINDOW, not one occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30');
    assert.ok(t.recur, 'the rule survived');
    assert.strictEqual(new Date(t.start).getMonth(), 8);
    assert.strictEqual(new Date(t.start).getDate(), 1, 'A is the anchor');
    // An all-day window end is the EXCLUSIVE next midnight, so the last day covered is the one named.
    assert.strictEqual(new Date(t.end - 1).getDate(), 30, 'B closes the window');
    assert.strictEqual(c.recurDurMs(t), 0, 'no occurrence length was stated — the rule is day-granular');
  });
});

// The defect this guards: `normalizeTask` converts a legacy repeat by reading `end - start` as ONE
// occurrence. A freshly parsed window must never reach it in that shape, or "from 1 Sep to 30 Sep every
// wednesday" becomes a 29-day occurrence repeating forever — the very bug the model replaced.
test('a parsed window is never re-read as one long occurrence by the legacy conversion', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30');
    assert.notStrictEqual(t.recur.durMs, null, 'durMs is written unconditionally, including as 0');
    assert.strictEqual(t.recur.until, null, 'one series end, and it lives on the task');
    const occs = c.expandTask(t, t.end + 60 * DAY);
    // The anchor is always occurrence 0, so a rule anchored on Tue 1 Sep yields that day plus the five
    // Wednesdays of September — and nothing in October, which is the point being made here.
    assert.strictEqual(occs.length, 6);
    occs.forEach(o => assert.ok(o.start <= t.end, 'nothing fires after the window closes'));
  });
});

test('a duration in the same sentence is the OCCURRENCE, and the window survives it', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30 for 45m');
    assert.strictEqual(c.recurDurMs(t), 45 * 60000, '45 minutes per occurrence');
    assert.strictEqual(new Date(t.end - 1).getDate(), 30, 'the window is still September');
    assert.strictEqual(t.planned, 45, 'the budget follows the occurrence, not the window');
  });
});

test('a clock range in the same sentence is the occurrence, and the window survives it', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'yoga every tuesday from sept 1 to sept 30 from 9am to 10am');
    assert.strictEqual(c.recurDurMs(t), HOUR);
    assert.strictEqual(new Date(t.start).getHours(), 9, 'the anchor keeps the time of day');
    assert.strictEqual(t.startClock, true);
    assert.strictEqual(new Date(t.end - 1).getDate(), 30, 'the window is still September');
  });
});

// A clock range alone states an occurrence and says nothing about how long the series runs.
test('a clocked repeat with no window stated is UNBOUNDED, not a one-hour series', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'standup daily from 9am to 10am');
    assert.strictEqual(c.recurDurMs(t), HOUR, 'the hour is the occurrence');
    assert.strictEqual(t.end, null, 'and nothing said when the series stops');
    assert.strictEqual(c.seriesEndMs(t), null);
    assert.ok(c.isScheduled(t), 'an open-ended series is scheduled — it is not a dateless ghost');
  });
});

// ---------------------------------------------------------------------------
// The series end is an EXCLUSIVE instant. `expandTask` caps on occurrence STARTS, so an inclusive
// midnight would silently drop every occurrence on the last day the user named.
// ---------------------------------------------------------------------------
test('"until 30 sep" still fires on 30 September', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'standup every weekday at 9am until 30 sep');
    const occs = c.expandTask(t, t.end + 30 * DAY);
    const last = occs[occs.length - 1];
    assert.strictEqual(new Date(last.start).getMonth(), 8);
    assert.strictEqual(new Date(last.start).getDate(), 30, 'the day named is covered, not excluded');
  });
});

test('a bare clock beside a window is the occurrence time, not the window edge', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'standup every weekday at 9am until 30 sep');
    assert.strictEqual(new Date(t.start).getHours(), 9);
    assert.strictEqual(t.startClock, true);
    // The window closes at a day boundary — a series does not end at a time of day.
    assert.strictEqual(c.hasClock(t.end), false);
  });
});

// ---------------------------------------------------------------------------
// The When line is an EDITOR, so every shape it prints has to read back as itself. The clock sits last
// in the sentence for a mechanical reason: the clock-range matcher demands whitespace or end-of-string
// after the closing time, so "9:00am–10:00am, from …" is not recognised at all and the time is dropped.
// That failure is silent and destroys data, which is why it is asserted rather than assumed.
// ---------------------------------------------------------------------------
const ROUND_TRIP = [
  'standup every weekday at 9am until 30 sep',
  'standup daily from 9am to 10am',
  'review every wednesday from sept 1 to sept 30',
  'review every wednesday from sept 1 to sept 30 for 45m',
  'pay rent every month',
  'yoga every tuesday from sept 1 to sept 30 from 9am to 10am',
];
ROUND_TRIP.forEach(text => {
  test('the When line round-trips: ' + text, () => {
    withNow(FIXED_NOW, () => {
      const c = make();
      const { t } = shaped(c, text);
      c.state.tasks = [t];
      const sentence = c.whenSentence(t).text;
      const { t: back } = shaped(c, sentence);
      const shape = x => JSON.stringify({
        start: x.start, end: x.end, startClock: x.startClock,
        kind: x.recur && x.recur.kind, dur: x.recur && x.recur.durMs,
      });
      assert.strictEqual(shape(back), shape(t), 'printed as: ' + sentence);
    });
  });
});

test('the When line states the rule, the window and the occurrence, in that order', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'yoga every tuesday from sept 1 to sept 30 from 9am to 10am');
    c.state.tasks = [t];
    const w = c.whenSentence(t);
    assert.strictEqual(w.chip, 'repeats');
    assert.ok(w.text.indexOf('from Tue Sep 01') < w.text.indexOf('9:00am'),
      'the occurrence comes last — see the round-trip note above');
    assert.ok(w.text.includes('to Wed Sep 30'), 'the window is stated, and read back inclusively');
  });
});

// The old sentence read the clock off `t.end`, which under the window model is the SERIES end. It would
// have printed "9:00am–12:00am" for a daily standup running until the end of the month.
test('the sentence reads the occurrence clock from the RULE, never from the window end', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = c.normalizeTask({
      id: 'r1', name: 'standup', start: c.startOfToday() + 9 * HOUR,
      end: c.startOfToday() + 30 * DAY, startClock: true,
      recur: { kind: 'day', n: 1, label: 'Daily', durMs: HOUR, shifts: [], overrides: {} },
    });
    c.state.tasks = [t];
    const w = c.whenSentence(t);
    assert.ok(w.text.includes('9:00am–10:00am'), 'one hour, from durMs: ' + w.text);
  });
});

// ---------------------------------------------------------------------------
// Editing the occurrence length THROUGH the line — the control the ruling asked for. The rule's identity
// now includes `durMs`, without which this edit compared equal to the stored task and committed nothing.
// ---------------------------------------------------------------------------
test('applyWhenText edits the occurrence length without touching the window', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30 for 45m');
    c.state.tasks = [t];
    const windowBefore = { start: t.start, end: t.end };
    const r = c.applyWhenText('r1', 'every wednesday, from Tue Sep 01 to Wed Sep 30, for 90m');
    assert.strictEqual(r.ok, true, r.error || '');
    const after = c.state.tasks[0];
    assert.strictEqual(c.recurDurMs(after), 90 * 60000, 'the occurrence grew');
    assert.strictEqual(after.start, windowBefore.start, 'the window did not move');
    assert.strictEqual(after.end, windowBefore.end);
    assert.strictEqual(after.planned, 90, 'the booked span is the plan, as on every other date path');
  });
});

test('moving only the window END keeps the occurrence exceptions', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30 for 45m');
    t.recur.overrides = { 2: { deleted: true } };
    c.state.tasks = [t];
    c.applyWhenText('r1', 'every wednesday, from Tue Sep 01 to Fri Oct 30, for 45m');
    const after = c.state.tasks[0];
    assert.deepStrictEqual(Object.keys(after.recur.overrides), ['2'],
      'the window closing later renames no occurrence, so nothing is discarded');
  });
});

test('moving the ANCHOR still discards them — the indexes it renames are not the same occurrences', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30 for 45m');
    t.recur.overrides = { 2: { deleted: true } };
    c.state.tasks = [t];
    c.applyWhenText('r1', 'every wednesday, from Thu Sep 03 to Wed Sep 30, for 45m');
    assert.deepStrictEqual(Object.keys(c.state.tasks[0].recur.overrides), []);
  });
});

// ---------------------------------------------------------------------------
// The non-repeating shapes the same parser changes pass through. A day range is still a plain window,
// and a plain task must not grow a `recur.durMs` out of nowhere.
// ---------------------------------------------------------------------------
test('a plain day range is untouched by the repeat shaping', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'write the report from sept 9 to sept 12');
    assert.strictEqual(t.recur, null);
    assert.strictEqual(new Date(t.start).getDate(), 9);
    assert.strictEqual(new Date(t.end - 1).getDate(), 12);
    assert.strictEqual(t.planned, null, 'a day range is not a duration');
  });
});

test('a plain day range with a duration keeps BOTH', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'write the report from sept 9 to sept 12 for 2h');
    assert.strictEqual(new Date(t.start).getDate(), 9);
    assert.strictEqual(new Date(t.end - 1).getDate(), 12, 'the window is the window');
    assert.strictEqual(t.planned, 120, 'and the two hours are the budget inside it');
  });
});

// `reconcileWhen` deliberately RETAINS a rule the title never mentioned — "a title that names no repeat
// is not an instruction to stop repeating". Re-shaping there would read the window the text said nothing
// about as absent and erase the series end, which is why the shaping is gated on the parse.
test('renaming a repeat without mentioning the rule leaves its window alone', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const { t } = shaped(c, 'review every wednesday from sept 1 to sept 30 for 45m');
    c.state.tasks = [t];
    const before = { start: t.start, end: t.end, dur: t.recur.durMs };
    c.rename('r1', 'review the September numbers');
    const after = c.state.tasks[0];
    assert.ok(after.recur, 'the rule is retained');
    assert.strictEqual(after.end, before.end, 'and so is the window it runs in');
    assert.strictEqual(after.recur.durMs, before.dur);
  });
});
