// Owner asks 2026-08-24 — the description reaches the hover card, and Focus mode can start a habit.
//
// The hover card already answered "how long have I got". It could not answer "what was this again",
// which is the question a bar labelled with a four-word title actually raises. `descSnippet` is the
// piece worth testing without a browser: turning stored rich text into one honest line is where this
// goes wrong, not in the div that shows it.
//
// The Focus habit field is here for one assertion in particular — that `addHabit` accepts a name. The
// Habits view creates a placeholder called `New habit` and relies on its own rename control; Focus has
// no rename control, so a bare button there would strand a row the user could not correct.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

test('descSnippet: block boundaries become spaces BEFORE the tags are stripped', () => {
  const c = make();
  // The defect this guards: naive tag-stripping yields "call Samre the quote".
  assert.equal(c.descSnippet('<div>call Sam</div><div>re the quote</div>'), 'call Sam re the quote');
  assert.equal(c.descSnippet('<ul><li>one</li><li>two</li></ul>'), 'one two');
  assert.equal(c.descSnippet('first<br>second'), 'first second');
});

test('descSnippet: an empty description is empty, not a string of leftover markup', () => {
  const c = make();
  // What execCommand leaves behind when the user clears a description.
  assert.equal(c.descSnippet(''), '');
  assert.equal(c.descSnippet('<p>&nbsp;</p>'), '');
  assert.equal(c.descSnippet('<div><br></div>'), '');
  assert.equal(c.descSnippet(null), '');
  assert.equal(c.descSnippet(undefined), '');
});

test('descSnippet: entities are decoded, so the card never shows &amp;', () => {
  const c = make();
  assert.equal(c.descSnippet('Ben &amp; Jerry&#39;s &lt;tag&gt;'), 'Ben & Jerry\'s <tag>');
});

test('descSnippet: truncation lands on a word boundary and marks itself', () => {
  const c = make();
  const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike';
  const out = c.descSnippet(long, 30);
  assert.equal(out.endsWith('…'), true, 'a cut snippet says so');
  assert.equal(out.length <= 31, true);
  assert.equal(/\s…$/.test(out), false, 'no dangling space before the ellipsis');
  assert.equal(long.startsWith(out.slice(0, -1)), true, 'and what it shows is a real prefix of the text');
  // A word boundary is only preferred when one is near the limit; a single long token still gets cut.
  assert.equal(c.descSnippet('x'.repeat(80), 20), 'x'.repeat(20) + '…');
});

test('hover card: the model carries the description, and omits it when there is none', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const now = Date.now();
    const blk = { id: 't1', title: 'Call Sam', start: now + 3600000, end: now + 5400000, type: 'auto' };

    const withDesc = c.normalizeTask({ id: 't1', name: 'Call Sam', description: '<div>re the Q3 quote</div>' });
    assert.equal(c.blockTooltipModel(blk, withDesc, now).desc, 're the Q3 quote');

    const bare = c.normalizeTask({ id: 't1', name: 'Call Sam' });
    assert.equal(c.blockTooltipModel(blk, bare, now).desc, '',
      'empty string rather than null, so the renderer tests it the same way as every other field');

    // Markup with no text in it must not produce a blank line in the card.
    const hollow = c.normalizeTask({ id: 't1', name: 'Call Sam', description: '<p><br></p>' });
    assert.equal(c.blockTooltipModel(blk, hollow, now).desc, '');
  });
});

test('hover card: the description does not disturb the countdown the card leads with', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const now = Date.now();
    const blk = { id: 't1', title: 'Call Sam', start: now + 3600000, end: now + 5400000, type: 'fixed' };
    const t = c.normalizeTask({ id: 't1', name: 'Call Sam', start: blk.start, end: blk.end,
      description: '<div>re the Q3 quote</div>' });
    const m = c.blockTooltipModel(blk, t, now);
    assert.equal(m.primary, 'starts in 1h', 'a clock-fixed block still leads with when it starts');
    assert.equal(m.desc, 're the Q3 quote');
  });
});

test('addHabit takes a name, so Focus mode need not create a placeholder it cannot rename', () => {
  const c = make();
  c.state.habits = [];
  const id = c.addHabit('Stretch');
  assert.equal((c.state.habits.find(x => x.id === id) || {}).name, 'Stretch');

  // The Habits view's bare call keeps its old placeholder-then-rename flow.
  const id2 = c.addHabit();
  assert.equal((c.state.habits.find(x => x.id === id2) || {}).name, 'New habit');
  // Whitespace is not a name.
  const id3 = c.addHabit('   ');
  assert.equal((c.state.habits.find(x => x.id === id3) || {}).name, 'New habit');
});

test('a habit added from Focus is scheduled today, so it appears in the list it was added from', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.habits = [];
    const id = c.addHabit('Stretch');
    const hb = c.state.habits.find(x => x.id === id);
    assert.equal(c.habitScheduledOn(hb, c.startOfToday()), true,
      'a new habit defaults to daily — creating one from Focus and not seeing it would read as a failure');
  });
});
