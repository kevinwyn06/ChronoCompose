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

test('rename silently parses temporal text and one undo restores title and schedule', () => withNow(FIXED_NOW, () => {
  const { c, task } = withTask();
  const before = JSON.parse(JSON.stringify(task()));

  c.rename('t1', 'Call mom Friday');

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
