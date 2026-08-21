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

  assert.deepEqual(JSON.parse(JSON.stringify(shaped)), {
    name: 'Call mom', type: 'Proportional', start: null, end: 20,
    startClock: null, endClock: false, planned: 30, priority: 2,
    labels: ['@family'],
    recur: { kind: 'week', n: 1, until: 99, shifts: [], overrides: {} },
  });
  assert.equal(JSON.stringify(parsed), before, 'shaping does not mutate the parser result');
});

test('rename parses temporal text and one undo restores title and schedule', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask();
  const before = JSON.parse(JSON.stringify(task()));

  c.rename('t1', 'Call mom Friday');

  // Task 16 (2026-08-20): the recognised word STAYS. This used to assert 'Call mom' — the parse eating
  // the day was the behaviour the owner objected to; the highlight is what reports it now.
  assert.equal(task().name, 'Call mom Friday');
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
// Task 16 (owner 2026-08-20) — the title bar parses, HIGHLIGHTS, and applies.
//
// The parse-and-apply half shipped on 2026-08-17 and is asserted above. What changed here is what the
// title is left holding: the recognised words STAY, and the highlight is what tells you the date was
// taken. Eating the words was the old quick-add behaviour, where it is right — you are turning a phrase
// into a task. Editing a name is not that, and silently deleting the word you just typed reads as the
// app losing your text.

test('title edit: the recognised words stay in the title', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask({ name: 'walk the dog' });
  c.rename('t1', 'walk the dog today');
  assert.equal(task().name, 'walk the dog today', 'the title is what you typed');
  assert.equal(c.startOfDay(task().start), c.startOfDay(FIXED_NOW), 'and the date was still taken');
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
    assert.notEqual(task().name, before.name);
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
    assert.equal(task().name, 'ship it milestone', 'what you typed is what the title says');
  }));
