const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi, 0, 0).getTime();

function withTask(over) {
  const c = make();
  c.state.tasks = [c.normalizeTask(Object.assign({
    id: 't1', name: 'Call mom', type: 'Proportional',
    start: at(2026, 5, 15, 9), end: at(2026, 5, 15, 10),
    startClock: true, endClock: true, planned: 60,
  }, over || {}))];
  return { c, task: () => c.state.tasks.find(t => t.id === 't1') };
}

function fakeEvent() {
  return { stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } };
}

test('shapeParsedTask is a pure single binding for quick-add task fields', () => {
  const c = make();
  const parsed = {
    rest: 'Call mom', mile: false, start: 10, end: null,
    startClock: null, endClock: null, dur: 30, priority: 2,
    labels: ['@family'], recur: { kind: 'week', n: 1 }, until: 99,
    ambiguous: 'day', candidates: [
      { kind: 'anchor', tuple: { start: 10, end: null, startClock: null, endClock: null } },
      { kind: 'due', tuple: { start: null, end: 20, startClock: null, endClock: false } },
    ],
  };
  const before = JSON.stringify(parsed);
  const shaped = c.shapeParsedTask(parsed, 'due');

  // Owner ruling 2026-09-09: a parsed repeat is bound to the SERIES-WINDOW model on the way out —
  // `until` is consumed into the window's `end`, the occurrence length is lifted onto `recur.durMs`
  // (here from the typed 30-minute duration), and `endClock` is dropped because the window's close is a
  // day, not a time of day. Writing `durMs` unconditionally is what stops `normalizeTask`'s legacy
  // conversion from re-reading a fresh window as one long occurrence.
  assert.deepEqual(JSON.parse(JSON.stringify(shaped)), {
    name: 'Call mom', type: 'Proportional', start: null, end: 99,
    startClock: null, endClock: null, planned: 30, priority: 2,
    labels: ['@family'],
    // Owner ask 2026-09-09: links ride the same single binding as tags — a URL pasted into a title is
    // filed against the task rather than left in its name.
    links: [],
    recur: { kind: 'week', n: 1, until: null, durMs: 30 * 60000, shifts: [], overrides: {} },
    // Owner ruling 2026-08-21: the `/` section token rides the same single binding. Both fields are
    // always present and null when the text named no section — "leave the section alone", which is
    // NOT the same as "move this task to No section".
    sectionId: null, sectionOffer: null,
  });
  assert.equal(JSON.stringify(parsed), before, 'shaping does not mutate the parser result');
});

test('rename parses temporal text and one undo restores title and schedule', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask();
  const before = JSON.parse(JSON.stringify(task()));

  c.rename('t1', 'Call mom Friday');

  // REVERSED by the owner ruling of 2026-08-21, which lands with the When line. Task 16 kept the word
  // on the reasoning that the highlight was the only proof the date had been taken — true while the
  // title was the ONLY place a parsed date was visible, and untrue the moment the detail panel gained an
  // editable When line. The word is not lost; it MOVED one line down, and `whenSentence` is where it now
  // lives. See tests/owner-2026-08-21-when-line.test.js.
  assert.equal(task().name, 'Call mom');
  assert.equal(task().start, at(2026, 5, 19), 'the uncued day uses quick-add\'s anchor default');
  assert.equal(task().end, null);
  assert.equal(task().startClock, null);
  c.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(task())), before);
}));

test('date picker applies a parsed clock range and both clock flags in one undo entry', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask();
  const before = JSON.parse(JSON.stringify(task()));
  c.openDatePick(fakeEvent(), 't1', 'start');

  c.dpText('5-6pm');
  c.dpApply();

  assert.equal(task().start, at(2026, 5, 15, 17));
  assert.equal(task().end, at(2026, 5, 15, 18));
  assert.equal(task().startClock, true);
  assert.equal(task().endClock, true);
  assert.equal(task().planned, 60);
  c.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(task())), before);
}));

test('date picker consumes a duration-only parse without discarding the existing window', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask({ planned: null });
  const before = { start: task().start, end: task().end };
  c.openDatePick(fakeEvent(), 't1', 'end');

  c.dpText('30m');
  c.dpApply();

  assert.equal(task().planned, 30);
  assert.deepEqual({ start: task().start, end: task().end }, before);
}));

// ---------------------------------------------------------------------------
// Task 16 (owner 2026-08-20) — the title bar parses, HIGHLIGHTS, and applies — as REVERSED by the
// owner ruling of 2026-08-21.
//
// The parse-and-apply half shipped on 2026-08-17 and is asserted above. Task 16 then ruled that the
// recognised words STAY, with the highlight reporting that the date had been taken. The 2026-08-21
// ruling reverses that half, and the reversal is not a change of mind about the argument — it is the
// argument's premise expiring. "The highlight is what says the date was taken" held only while the title
// was the one place a parsed date was visible. The When line makes the date visible AND editable one
// line below, so the word moves rather than disappears.
//
// The highlight tests below are untouched and still matter: the mirror still paints the span while the
// caret is in the field, which is the live feedback DURING the edit. What changed is only what survives
// the commit.

test('title edit: a recognised date is consumed, because the When line now shows it', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask({ name: 'walk the dog' });
  c.rename('t1', 'walk the dog today');
  assert.equal(task().name, 'walk the dog', 'the word moved to the When line — it was not lost');
  assert.equal(c.startOfDay(task().start), c.startOfDay(FIXED_NOW), 'and the date was taken');
  assert.notEqual(c.whenSentence(task()).text, '', 'and it is visible and editable there');
}));

test('title edit: the temporal span is highlighted, with the quick-add treatment', () => {
  const c = make();
  const segs = c.titleHighlightSegments('walk the dog today');
  assert.equal(segs.map(s => s.text).join(''), 'walk the dog today',
    'the segments reconstruct the title exactly — a highlight never edits the text');
  const hot = segs.filter(s => s.highlight);
  assert.equal(hot.length, 1);
  assert.equal(hot[0].text.trim(), 'today');
});

test('title edit: a title with nothing temporal in it highlights nothing', () => {
  const c = make();
  const segs = c.titleHighlightSegments('walk the dog');
  assert.equal(segs.filter(s => s.highlight).length, 0);
  assert.equal(segs.map(s => s.text).join(''), 'walk the dog');
});

test('title edit: still ONE commit — a single undo restores both the title and the date', () =>
  withNow(FIXED_NOW, () => {
    const { c, task } = withTask({ name: 'walk the dog' });
    const before = JSON.parse(JSON.stringify(task()));
    c.rename('t1', 'walk the dog friday');
    assert.equal(task().name, 'walk the dog', 'consumed, per the 2026-08-21 reversal');
    assert.notEqual(task().start, before.start);
    c.undo();
    assert.deepEqual(JSON.parse(JSON.stringify(task())), before, 'one undo, both fields');
  }));

test('title edit: the ambiguity chooser shapes DATES and never eats a parsed duration', () => {
  const c = make();
  const parsed = {
    rest: 'gym', mile: false, start: 10, end: null, startClock: null, endClock: null,
    dur: 45, priority: null, labels: [], recur: null, until: null,
    ambiguous: 'day', candidates: [
      { kind: 'anchor', tuple: { start: 10, end: null, startClock: null, endClock: null, planned: 999 } },
      { kind: 'due', tuple: { start: null, end: 20, startClock: null, endClock: false, planned: 999 } },
    ],
  };
  for (const choice of ['anchor', 'due']) {
    assert.equal(c.shapeParsedTask(parsed, choice).planned, 45,
      choice + ': the duration came from the text, so the chooser must not overwrite it');
  }
  // With no duration in the text, the candidate tuple is free to carry one.
  const noDur = Object.assign({}, parsed, { dur: null });
  assert.equal(c.shapeParsedTask(noDur, 'anchor').planned, 999);
});

test('title edit: a milestone marker still converts the type and still stays visible', () =>
  withNow(FIXED_NOW, () => {
    const { c, task } = withTask({ name: 'ship it' });
    c.rename('t1', 'ship it milestone');
    assert.equal(task().type, 'Milestone');
    // `milestone` was ALWAYS stripped, on both sides of the Task 16 ruling — `shapeParsedTask` removes
    // the marker words unconditionally, and a title edit only reached that name once the date changed.
    // Now that the strip fires here, the marker goes with it.
    assert.equal(task().name, 'ship it', 'the marker word is consumed, like every claimed token');
  }));
