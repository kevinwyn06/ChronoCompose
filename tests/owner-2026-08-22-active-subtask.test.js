// Owner ruling 2026-08-22 — the ACTIVE subtask is the one overlapping the now-line.
//
// "Active" is three different things in this app and they disagree constantly: the subtask whose timer
// is running, the subtask the now-line falls inside, and the next incomplete child. The common case is
// a running timer on a child while the clock has already moved past that child's slot.
//
// The ruling picks the second, and the reason is structural rather than aesthetic: it is a pure
// function of the packed layout and the clock, so it is the only one of the three that cannot disagree
// with what the surface is already drawing. The now-rule is right there on both views, and the cue
// simply names the line it crosses.
//
// Two consequences follow directly and are pinned here because they are easy to build wrong:
//   · NO cue on a day that is not today — a future day has no now-line to overlap.
//   · A running timer does NOT move the cue. If a timer runs on a child the clock has passed, the cue
//     stays on whatever "now" is actually inside, and the timer keeps its own ▶/■ affordance. The two
//     signals are allowed to point at different children: they answer different questions.
//
// Board: docs/superpowers/mockups/2026-08-21-subtasks-in-schedule-and-active-cue.md
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

const MIN = 60000;

function blockAt(c, baseMs){
  return {
    id: 'p',
    start: baseMs,
    end: baseMs + 90 * MIN,
    kids: [
      { id: 'k1', name: 'Headline pass', depth: 1, start: baseMs,             end: baseMs + 30 * MIN },
      { id: 'k2', name: 'Body pass',     depth: 1, start: baseMs + 30 * MIN,  end: baseMs + 60 * MIN },
      { id: 'g1', name: 'Captions',      depth: 2, start: baseMs + 60 * MIN,  end: baseMs + 90 * MIN },
    ],
  };
}

test('activeKidId: the cue names the line the now-rule crosses', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const b = blockAt(c, B + 9 * 60 * MIN);
    assert.equal(c.activeKidId(b, B, B + (9 * 60 + 10) * MIN), 'k1');
    assert.equal(c.activeKidId(b, B, B + (9 * 60 + 45) * MIN), 'k2');
    assert.equal(c.activeKidId(b, B, B + (10 * 60 + 15) * MIN), 'g1', 'depth 2 is eligible like any other');
  });
});

test('activeKidId: a boundary belongs to the line that is starting, not the one that ended', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const b = blockAt(c, B + 9 * 60 * MIN);
    // Half-open [start, end): at exactly 09:30 the now-line has crossed into Body pass.
    assert.equal(c.activeKidId(b, B, B + (9 * 60 + 30) * MIN), 'k2');
  });
});

test('activeKidId: no cue before the block starts or after it ends', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const b = blockAt(c, B + 9 * 60 * MIN);
    assert.equal(c.activeKidId(b, B, B + 8 * 60 * MIN), null);
    assert.equal(c.activeKidId(b, B, B + 11 * 60 * MIN), null);
  });
});

test('activeKidId: NO cue on a day that is not today — there is no now-line to point at', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const tomorrow = c.startOfToday() + DAY;
    const b = blockAt(c, tomorrow + 9 * 60 * MIN);
    assert.equal(c.activeKidId(b, tomorrow, tomorrow + (9 * 60 + 10) * MIN), null);
  });
});

test('activeKidId: a running timer does NOT move the cue', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const b = blockAt(c, B + 9 * 60 * MIN);
    /* A timer left running on the FIRST child while the clock has already moved into the second — the
       common case, and the one the superseded "running timer first" recommendation got wrong. It would
       also have made the cue jump BACKWARDS as the timer was stopped. */
    c.state.run = { k1: { startedAt: B + 9 * 60 * MIN, beat: B + (9 * 60 + 45) * MIN } };
    assert.equal(c.activeKidId(b, B, B + (9 * 60 + 45) * MIN), 'k2',
      'the cue follows the clock, not the timer');
  });
});

test('activeKidId: a block with no children has no cue to give', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    assert.equal(c.activeKidId({ id: 'x', start: B, end: B + MIN, kids: [] }, B, B), null);
    assert.equal(c.activeKidId(null, B, B), null);
  });
});
