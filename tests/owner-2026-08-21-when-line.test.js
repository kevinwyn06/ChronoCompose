// Owner rulings 2026-08-21 — the date-parse editor ("the When line") and the title strip.
//
// Two rulings that must land together, and the mockup says why:
//
//   1. The recurrence panel was rejected — "not a form". The replacement is a plain-text display of the
//      current date state which can be edited and re-parsed, REPLACING Start, Due and Duration in the
//      detail panel. Framed correctly it is not a recurrence editor at all: it is the same parser the
//      title bar runs, round-tripped through readable text instead of consumed once.
//   2. The title-bar parser strips the words it consumes, reversing the 2026-08-20 Task 16 ruling.
//
// Task 16's argument for keeping the word — "the HIGHLIGHT is what says the date was taken" — was
// correct only while the title was the ONLY place a parsed date was visible. Ship the strip first and
// there is a state where a date is consumed, deleted from the title, and shown nowhere editable: worse
// than either ruling's status quo. Hence one branch.
//
// OWNER RULING 2026-08-21 on the one open question: strip ONLY when the parse actually CHANGES the
// stored date. Rewording "Move the friday deploy to staging" leaves `friday` alone, because a re-parse
// yielding the date the task already holds is not new information.
//
// Board: docs/superpowers/mockups/2026-08-21-date-editor-and-title-strip.md
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

function comp(){ return make(); }
function withTask(c, extra){
  const t = c.normalizeTask(Object.assign({ id: 't1', name: 'Write the report' }, extra || {}));
  c.state.tasks = [t];
  return () => c.state.tasks.find(x => x.id === 't1');
}
const day = (c, n) => c.startOfToday() + (n || 0) * DAY;
const at = (c, n, h, m) => day(c, n) + (h * 60 + (m || 0)) * 60000;

// ---------------------------------------------------------------------------
// Part 2 of the mockup — the six shapes one line has to read back unambiguously,
// because it replaces Start, Due AND Duration.
// ---------------------------------------------------------------------------

test('whenSentence: no date is the someday placeholder, not an empty line', () => {
  withNow(FIXED_NOW, () => {
    const c = comp(); const t = withTask(c, {});
    const w = c.whenSentence(t());
    assert.equal(w.text, '');
    assert.equal(w.empty, true);
    assert.match(w.placeholder, /someday/i);
    assert.equal(w.chip, null);
  });
});

test('whenSentence: a bare day reads as the day, chipped `all day`', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: day(c, 1), end: null, startClock: null, planned: 45 });
    const w = c.whenSentence(t());
    assert.equal(w.chip, 'all day');
    assert.doesNotMatch(w.text, /\d:\d\d/, 'a day names no hour');
    // Ruling 8: Planned is not repeated outside the When block — the sub-line carries it.
    assert.match(w.sub, /no time set/);
    assert.match(w.sub, /45m planned/);
  });
});

test('whenSentence: a clocked anchor with no end is a `marker` that reserves nothing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: at(c, 1, 15), end: null, startClock: true, planned: null });
    const w = c.whenSentence(t());
    assert.equal(w.chip, 'marker');
    assert.match(w.text, /3:00\s*pm/i);
    assert.match(w.sub, /reserves no time/i, 'the chip names the shape; the sub-line says what it costs');
  });
});

// The shape that is neither a Point nor a bare day, and the one the six-shape table does not name: a
// written start clock, no end, and a budget. The clock is real, so the sentence has to say it — reading
// it back as a bare day would make re-committing the line quietly discard the hour.
test('whenSentence: a clocked start with a budget states its clock, chipped with the budget', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: at(c, 1, 15), end: null, startClock: true, planned: 45 });
    const w = c.whenSentence(t());
    assert.match(w.text, /3:00\s*pm/i, 'the hour the user typed is in the sentence');
    assert.equal(w.chip, '45m', 'the chip carries what it reserves');
    assert.doesNotMatch(w.sub, /planned/, 'and is therefore not repeated in the sub-line');
  });
});

test('whenSentence: an appointment reads as a span, chipped with its length', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: at(c, 1, 15), end: at(c, 1, 16), startClock: true, endClock: true, planned: 60 });
    const w = c.whenSentence(t());
    assert.equal(w.chip, '1h');
    assert.match(w.text, /3:00.*4:00\s*pm/i, 'one line states both edges');
  });
});

test('whenSentence: a deadline leads with `by`, chipped `due`', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: null, end: day(c, 2) + DAY - 1, endClock: false });
    const w = c.whenSentence(t());
    assert.equal(w.chip, 'due');
    assert.match(w.text, /^by /);
  });
});

test('whenSentence: a repeat reads its rule, chipped `repeats`', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = c.parseDateText('standup every weekday at 9am until 30 sep', Date.now());
    const t = withTask(c, c.shapeParsedTask(p, 'anchor'));
    const w = c.whenSentence(t());
    assert.equal(w.chip, 'repeats');
    assert.match(w.text, /every/i);
    assert.match(w.text, /until/i, 'the until clause is part of the rule, so it is part of the sentence');
  });
});

// Part 3.2 of the mockup — moved occurrences have no text form, so they are COUNTED, not sentenced.
// Sentencing them would make the editable text lie about the rule; hiding them would make it lie about
// the series.
test('whenSentence: moved occurrences are counted beside the rule, never written into it', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = c.parseDateText('standup every weekday at 9am', Date.now());
    const shaped = c.shapeParsedTask(p, 'anchor');
    shaped.recur.shifts = [{ idx: 1, ms: DAY }, { idx: 4, ms: DAY }, { idx: 7, ms: -DAY }];
    const t = withTask(c, shaped);
    const w = c.whenSentence(t());
    assert.equal(w.moved, 3);
    assert.match(w.sub, /3 occurrences moved/);
    assert.doesNotMatch(w.text, /occurrence/i, 'the sentence stays honest to the RULE');
  });
});

// ---------------------------------------------------------------------------
// The failure state — the case that justifies the whole approach. A form cannot
// produce an unparseable value; a text editor can, and must handle it well.
// ---------------------------------------------------------------------------

test('applyWhenText: an unreadable string never destroys the value already stored', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: day(c, 1), end: null, planned: 45 });
    const before = JSON.parse(JSON.stringify(t()));
    const r = c.applyWhenText('t1', 'sometime after the thing probably');
    assert.equal(r.ok, false);
    assert.match(r.error, /couldn.t read|did not understand|understand/i);
    assert.deepEqual(JSON.parse(JSON.stringify(t())), before, 'the old value is untouched');
  });
});

// Part 3.1 — `t.recur` has no COUNT field: `recurToRRule` emits UNTIL, never COUNT. Reading
// "every monday, 5 times" back as "until 22 Sep" would silently rewrite what the user typed, and the
// date goes wrong the moment the interval is edited. An honest refusal beats a silent conversion.
test('applyWhenText: "N times" is refused explicitly rather than converted to an until date', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: day(c, 1) });
    const before = JSON.parse(JSON.stringify(t()));
    const r = c.applyWhenText('t1', 'every monday, 5 times');
    assert.equal(r.ok, false);
    assert.match(r.error, /times/i);
    assert.match(r.error, /until/i, 'the refusal has to say what CAN be written, or it is just a wall');
    assert.deepEqual(JSON.parse(JSON.stringify(t())), before);
  });
});

test('applyWhenText: a good sentence round-trips through the same parser the title uses', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    assert.equal(c.applyWhenText('t1', 'tomorrow 3-4pm').ok, true);
    const after = t();
    assert.equal(new Date(after.start).getHours(), 15);
    assert.equal(new Date(after.end).getHours(), 16);
    assert.equal(after.planned, 60);
    /* And what it reads back is what was typed — that is the whole contract of a display that is also
       the editor. */
    assert.equal(c.whenSentence(after).chip, '1h');
  });
});

test('applyWhenText: emptying the line clears the dates rather than failing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: day(c, 1), end: day(c, 2) });
    assert.equal(c.applyWhenText('t1', '   ').ok, true);
    assert.equal(t().start, null);
    assert.equal(t().end, null);
    assert.equal(c.whenSentence(t()).empty, true);
  });
});

test('applyWhenText: one commit — a single undo restores the whole pre-edit shape', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, { start: day(c, 1), end: null, planned: 45 });
    const before = JSON.parse(JSON.stringify(t()));
    c.applyWhenText('t1', 'tomorrow 3-4pm');
    assert.notEqual(t().end, null);
    c.undo();
    assert.deepEqual(JSON.parse(JSON.stringify(t())), before);
  });
});

test('applyWhenText: re-dating a repeat across a calendar day drops stale occurrence state', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = c.parseDateText('standup every weekday at 9am', Date.now());
    const shaped = c.shapeParsedTask(p, 'anchor');
    const t = withTask(c, shaped);
    c.commit(tasks => { const x = tasks.find(y => y.id === 't1');
      x.recur.overrides = { 0: { pct: 100 } }; x.recur.shifts = [{ idx: 2, ms: DAY }]; });

    c.applyWhenText('t1', 'every weekday at 9am starting ' + new Date(day(c, 3)).toDateString());
    /* Occurrence overrides are indexed from the series anchor: moving the anchor to another calendar
       day changes which real occurrence every index names, so retaining them would transfer an old
       completion onto a newly dated occurrence. Same rule `setDate` applies — deliberately shared. */
    // Compared by content, not by deepEqual: the component runs in a Node VM, so its `{}` has a
    // different realm's prototype and deepStrictEqual rejects it on identity alone.
    assert.equal(Object.keys(t().recur.overrides || {}).length, 0);
    assert.equal((t().recur.shifts || []).length, 0);
  });
});

// ---------------------------------------------------------------------------
// The title strip, and the ruling that makes it safe.
// ---------------------------------------------------------------------------

test('title strip: a NEW date is consumed from the title, because the When line now shows it', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    c.rename('t1', 'Write the report friday');
    assert.equal(t().name, 'Write the report', 'the word moved to the When line, it was not lost');
    assert.notEqual(t().start, null);
    assert.notEqual(c.whenSentence(t()).text, '', 'and it is visible and editable there');
  });
});

test('title strip: rewording a title whose date it already holds leaves the word ALONE', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    c.rename('t1', 'Move the friday deploy');           // consumed once: friday is now the task's date
    const dated = t().start;
    c.rename('t1', 'Move the friday deploy to staging'); // a re-parse yielding the SAME date
    assert.equal(t().name, 'Move the friday deploy to staging',
      'the parse changed nothing, so it is not new information and must not edit the user\'s words');
    assert.equal(t().start, dated, 'and the schedule is unchanged');
  });
});

test('title strip: a date that CHANGES the stored one is consumed', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    c.rename('t1', 'Ship it friday');
    const first = t().start;
    c.rename('t1', 'Ship it friday next week');
    assert.notEqual(t().start, first, 'the date genuinely moved');
    assert.doesNotMatch(t().name, /friday/i, 'so the words that moved it are consumed');
  });
});

test('title strip: a title with no date at all is never touched', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    c.rename('t1', 'Just some words');
    assert.equal(t().name, 'Just some words');
  });
});

test('title strip: the strip and the schedule land in ONE commit', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = withTask(c, {});
    const before = JSON.parse(JSON.stringify(t()));
    c.rename('t1', 'Write the report friday');
    c.undo();
    assert.deepEqual(JSON.parse(JSON.stringify(t())), before,
      'one Ctrl+Z restores the complete pre-edit task, name and dates together');
  });
});
