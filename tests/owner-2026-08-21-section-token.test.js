// Owner ruling 2026-08-21 — the parser takes `/` as the SECTION identifier.
//
// `sectionId` is a one-per-task, exclusive, ORDERED container in `pp-sections` — deliberately not a
// `@tag` — so `/` is exclusive assignment, and a second `/` in one title is not a second section.
//
// Two rules carry the whole feature, and both were chosen to avoid special cases:
//
//   TOKENISING (2026-08-21): `/` is a section token only when preceded by whitespace or start-of-string
//   AND followed by a letter. That one rule kills `3/4` (a date), `docs/README`, `and/or` and every URL
//   at once, with no allow-list to maintain.
//
//   MATCHING (2026-08-24, reversing 2026-08-22): multi-word names match greedily, LONGEST-first. The
//   earlier ruling feared the token reaching a word further and competing with the date parser, but the
//   mechanics rule that out: matching is prefix-anchored at the `/` and requires a word boundary after
//   the name, so a longer name can only win where it was typed IN FULL. The shorter name is never
//   starved — the two orders disagree on exactly one input, and shortest-first got that one wrong.
//
// An unmatched name must NOT auto-create a section: section ORDER drives timeline block hue, so a typo
// would repaint real work. It files under No section and offers creation instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const SECTIONS = [
  { id: 'sec_work',  name: 'Work',               order: 0 },
  { id: 'sec_deep',  name: 'Deep work',          order: 1 },
  { id: 'sec_plan',  name: 'Deep work planning', order: 2 },
  { id: 'sec_home',  name: 'Home',               order: 3 },
];

function comp(){ const c = make(); c.state.sections = SECTIONS.slice(); return c; }
const parse = (c, text) => c.parseDateText(text, Date.now());

test('section token: `/Work` files the task and leaves the title clean', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, 'ship the thing /work');
    assert.equal(p.sectionId, 'sec_work');
    assert.equal(p.sectionOffer, null, 'a matched name offers nothing to create');
    assert.equal(p.rest, 'ship the thing', 'the token is consumed, like a date or a tag');
  });
});

// THE LOAD-BEARING CASE FOR THE 2026-08-24 REVERSAL. Longest-first was rejected on the theory that it
// would swallow `planning` here and keep reaching until it hit `friday`. It cannot: `Deep work planning`
// is not a prefix of `deep work friday`, so the longer name simply does not apply and the matcher falls
// through to `Deep work`. This test passed under BOTH orders — which is the point. It is the evidence
// that flipping the comparator costs the shorter name nothing.
test('longest-first: a longer name that was not typed does not apply, so the shorter one still wins', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, '/deep work friday');
    assert.equal(p.sectionId, 'sec_deep', '`Deep work planning` does not prefix-match, so `Deep work` files it');
    assert.notEqual(p.date, null, 'and `friday` is still there for the date parser, never in reach of the token');
  });
});

// The one input the two orders disagree on, and the reason the ruling was reversed. Typing the longer
// name IN FULL now files under it. Under shortest-first this filed under `Deep work` and stranded the
// word `planning` in the title — the user spelled out a section name and was ignored.
test('longest-first: the longer name typed in full claims the whole token', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, '/deep work planning friday');
    assert.equal(p.sectionId, 'sec_plan', 'the words say `Deep work planning`, so that is where it files');
    assert.equal(p.rest, '', 'and nothing is stranded in the title');
    assert.notEqual(p.date, null, '`friday` is still the date — the token stopped at the name');
  });
});

// The escape hatch now runs the OTHER way, and this is the case the old completion list could not have
// served: the alternative reading is SHORTER than what matched, so an extensions-only list would have
// been empty and Tab a dead key. Shortening must also keep the surplus words rather than deleting text
// the user typed — the result is byte-for-byte the old shortest-first reading, now chosen rather than
// imposed.
test('longest-first: Tab reaches the SHORTER section, and the surplus words survive as title text', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const r = c.sectionCompletions('/deep work planning friday');
    assert.deepEqual(r.names, ['Deep work planning', 'Deep work'],
      'index 0 is what is already applied, so Tab steps away from it');
    const after = c.completeSectionToken('/deep work planning friday', 1);
    assert.equal(after, '/Deep work planning friday',
      '`planning` stays in the line as title text instead of being deleted');
    // Text alone cannot carry the choice: the line still spells out the longer name. preferId does.
    assert.equal(c.matchSectionToken(after, SECTIONS, 'sec_deep').id, 'sec_deep',
      'preferId pins the shorter section against the longer name still present in the text');
    assert.equal(c.matchSectionToken(after, SECTIONS).id, 'sec_plan',
      'and without the pin it resolves the long way again, which is why Tab must pin');
  });
});

test('section token: matching is case-insensitive and order-independent in the title', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    assert.equal(parse(c, '/HOME laundry').sectionId, 'sec_home');
    assert.equal(parse(c, 'laundry /Home').sectionId, 'sec_home');
  });
});

// The tokenising rule, stated as the collisions it was designed to kill.
const COLLISIONS = [
  ['ship 3/4 of it',            'a date or a fraction — `/` is not preceded by whitespace'],
  ['update docs/readme',        'a path — same reason'],
  ['pick one and/or the other', 'a conjunction — same reason'],
  ['read https://work.example', 'a URL — `/` is followed by `/`, not a letter'],
  ['tidy / work',               'a bare slash — `/` is not followed by a letter'],
];
for(const [phrase, why] of COLLISIONS){
  test('section token: "' + phrase + '" is not a section (' + why + ')', () => {
    withNow(FIXED_NOW, () => {
      const c = comp();
      const p = parse(c, phrase);
      assert.equal(p.sectionId, null);
      assert.equal(p.sectionOffer, null, 'and nothing is offered for creation either');
    });
  });
}

test('section token: an unmatched name is NOT created — it is offered, and the title keeps it', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, 'draft the memo /marketing');
    assert.equal(p.sectionId, null, 'section ORDER drives block hue, so a typo must not repaint real work');
    assert.equal(p.sectionOffer, 'marketing');
    assert.equal(p.rest, 'draft the memo /marketing', 'it strips when it files, and not when it did not');
    assert.equal(c.state.sections.length, SECTIONS.length, 'parsing creates nothing');
  });
});

test('section token: `/` is exclusive — a second one is not a second section', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, '/work sync /home');
    assert.equal(p.sectionId, 'sec_work', 'the first match wins; sectionId is one field, not a list');
    assert.equal(p.rest, 'sync /home', 'the loser is left in the title rather than silently eaten');
  });
});

test('section token: the token is highlighted as its own kind', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const text = 'ship the thing /deep work';
    const p = parse(c, text);
    const span = (p.matches || []).find(m => m.kind === 'section');
    assert.notEqual(span, undefined, 'the mirror must be able to paint it');
    assert.equal(text.slice(span.start, span.end), '/deep work');
  });
});

test('section token: shapeParsedTask carries the section onto the task', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const shaped = c.shapeParsedTask(parse(c, 'ship the thing /work friday'), 'anchor');
    assert.equal(shaped.sectionId, 'sec_work');
    assert.equal(shaped.name, 'ship the thing');
    const t = c.normalizeTask(Object.assign({ id: 't1' }, shaped));
    assert.equal(t.sectionId, 'sec_work', 'and survives normalizeTask');
  });
});

test('section token: with no sections defined, `/anything` is only an offer', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.sections = [];
    const p = c.parseDateText('ship it /work', Date.now());
    assert.equal(p.sectionId, null);
    assert.equal(p.sectionOffer, 'work');
  });
});

// Tab autocomplete — the half of the shortest-first ruling that keeps the longer names reachable.
test('sectionCompletions: the alternative readings of the token, the applied one first', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const r = c.sectionCompletions('/deep work friday');
    assert.equal(r.token, '/deep work');
    assert.deepEqual(r.names, ['Deep work', 'Deep work planning'],
      'the match itself is forced to index 0, so Tab cycles away from what is already applied');
  });
});

test('sectionCompletions: extending rewrites the whole token, keeping the rest of the line', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    assert.equal(c.completeSectionToken('/deep work friday', 1), '/Deep work planning friday');
    // Cycling wraps rather than dead-ending.
    assert.equal(c.completeSectionToken('/deep work friday', 2), '/Deep work friday');
  });
});

test('sectionCompletions: nothing to complete is null, not a crash', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    assert.equal(c.sectionCompletions('just a task'), null);
    assert.equal(c.sectionCompletions('read https://work.example'), null);
  });
});

// `/` typed on a SUBTASK is a no-op: only roots carry sectionId, and a subtree inherits the root's.
// Consuming it quietly is the honest outcome — the alternative is a field nothing ever reads.
test('section token: rename on a subtask consumes the token without filing anything', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const root = c.normalizeTask({ id: 'r1', name: 'Parent', sectionId: 'sec_home' });
    const kid = c.normalizeTask({ id: 'k1', name: 'Child', parentId: 'r1' });
    c.state.tasks = [root, kid];
    c.rename('k1', 'Child /work');
    const after = c.state.tasks.find(t => t.id === 'k1');
    assert.equal(after.name, 'Child', 'the token is consumed rather than left as litter');
    assert.equal(after.sectionId == null, true, 'and nothing is stamped on the subtask');
    assert.equal(c.state.tasks.find(t => t.id === 'r1').sectionId, 'sec_home', 'the root is untouched');
  });
});

test('section token: rename on a root files it', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    c.state.tasks = [c.normalizeTask({ id: 'r1', name: 'Parent' })];
    c.rename('r1', 'Parent /work');
    const after = c.state.tasks.find(t => t.id === 'r1');
    assert.equal(after.sectionId, 'sec_work');
    assert.equal(after.name, 'Parent');
  });
});
