// 2026-08-24 — naming today's date means today, and the When line's own sentence is never a mutation.
//
// FOUND BY A RED E2E, NOT BY READING. `tests/e2e/owner-2026-08-19-input.spec.js` began failing with
// "expected Mon Aug 24, received Tue Aug 24" — an internally impossible pair, because Aug 24 2026 is a
// Monday. The task had been moved to Aug 24 **2027**, and its `end` nulled, by pressing ESCAPE.
//
// Two independent faults, each harmless alone and destructive together:
//
//   1. THE PARSER. chrono's `forwardDate` rolls anything not strictly after `now` to its next
//      occurrence. But `now` is an INSTANT and a written calendar date is a DAY, so `Aug 24` typed on
//      the afternoon of Aug 24 implied midnight, read as already past, and rolled a whole year. This
//      reached quick-add too: any task filed on the day it names.
//
//   2. THE NO-OP GUARD in `applyWhenText`, which compared the PARSE of the submitted sentence against
//      the task. That silently assumed the When line round-trips — that reading back what the line
//      prints reproduces the task it was printed from. The moment the parser disagreed with the
//      printer, an unedited sentence looked like a real edit and was committed.
//
// Escape's rung 0 is what joined them: it restores the field's focus-time value and blurs, and the blur
// commits. So the cancel path re-submitted the line's own sentence, and the round-trip failure landed on
// the task as a twelve-month jump. Both are fixed here, deliberately: the guard should never have
// depended on a perfect round-trip, whatever the parser does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;
// FIXED_NOW is Mon 2026-06-15 12:00 local — mid-afternoon relative to an implied midnight, which is
// exactly the condition the roll-forward mis-read.
const dayOf = (c, ms) => c.startOfDay(ms);

test('naming TODAY’s date resolves to today, not to the same date next year', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    const d = new Date(today);
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    const phrase = MON + ' ' + d.getDate();

    const p = c.parseDateText(phrase);
    assert.notEqual(p.date, null, 'the phrase is a date at all');
    assert.equal(dayOf(c, p.date), today,
      phrase + ' typed on ' + phrase + ' means today — it rolled a full year before this fix');

    // The weekday prefix the When line prints is not what broke it, and must not break it now either.
    const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    assert.equal(dayOf(c, c.parseDateText(WD + ' ' + phrase).date), today);

    // A written clock on today's date stays on today's date.
    assert.equal(dayOf(c, c.parseDateText(phrase + ' 3pm').date), today);
  });
});

test('a genuinely past date still rolls forward — the roll itself is not disabled', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    const back = new Date(today - 5 * DAY);
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][back.getMonth()];
    const p = c.parseDateText(MON + ' ' + back.getDate());
    assert.equal(p.date > today, true, 'five days ago is in the past, so it still rolls to next year');
  });
});

test('relative phrases are untouched by the correction', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    assert.equal(dayOf(c, c.parseDateText('tomorrow').date), today + DAY);
    assert.equal(dayOf(c, c.parseDateText('today').date), today);
    assert.equal(c.parseDateText('friday').date > today, true);
  });
});

// The second fault, tested on its own so it stays fixed even if the parser drifts again.
test('applyWhenText: re-submitting the line’s own sentence changes nothing and records no undo', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    const t = c.normalizeTask({ id: 'a', name: 'Write', start: today, end: today + DAY, planned: 60 });
    c.state.tasks = [t];

    const before = JSON.stringify(c.state.tasks);
    const sentence = c.whenSentence(t).text;
    assert.notEqual(sentence, '', 'the fixture really does render a sentence');

    const r = c.applyWhenText('a', sentence);
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(c.state.tasks), before,
      'the task is byte-identical — this is the Escape path, and it must not move anything');
  });
});

// The shape the round-trip cannot survive, which is why text identity is the right test rather than a
// better comparison of parses. A written start clock with no end is printed by the When line and read
// back by the parser as something else entirely; re-submitting it must still be a no-op.
test('applyWhenText: text identity holds even for a sentence the parser cannot reproduce', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    const t = c.normalizeTask({ id: 'a', name: 'Write', start: today + 9 * 3600000, end: null,
      startClock: true, planned: 90 });
    c.state.tasks = [t];

    const before = JSON.stringify(c.state.tasks);
    const r = c.applyWhenText('a', c.whenSentence(t).text);
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(c.state.tasks), before);
  });
});

test('applyWhenText: a REAL edit still applies — the guard is identity, not a blanket refusal', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const today = c.startOfToday();
    const t = c.normalizeTask({ id: 'a', name: 'Write', start: today, end: today + DAY, planned: 60 });
    c.state.tasks = [t];

    const r = c.applyWhenText('a', 'tomorrow');
    assert.equal(r.ok, true);
    assert.equal(dayOf(c, c.state.tasks[0].start), today + DAY, 'editing the sentence still moves the task');
  });
});
