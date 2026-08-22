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
//   MATCHING (2026-08-22): multi-word names match greedily but SHORTEST-first. With sections `Deep work`
//   and `Deep work planning`, longest-first would let the token reach one word further and start
//   competing with the date parser; shortest-first stops at the first complete section name, and Tab
//   keeps the longer one a single keystroke away.
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

test('section token: shortest-first stops at the first complete name, leaving the date alone', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    // Longest-first would swallow "planning" and keep reaching until it hit `friday`.
    const p = parse(c, '/deep work friday');
    assert.equal(p.sectionId, 'sec_deep', 'the SHORTER `Deep work` wins over `Deep work planning`');
    assert.notEqual(p.date, null, 'and `friday` is still there for the date parser');
  });
});

// The consequence of shortest-first, pinned deliberately rather than discovered later: typing the
// LONGER name in full still resolves to the shorter one, and the extra words stay in the title. That is
// what "stops at the first complete section name" means, and it is the price the ruling accepted to stop
// the token reaching a word further and competing with the date parser. Tab is the way out, which is why
// `sectionCompletions` is part of this feature and not a nicety — see the completion tests below.
test('section token: shortest-first is greedy-but-stopping, even when the longer name is typed in full', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const p = parse(c, '/deep work planning friday');
    assert.equal(p.sectionId, 'sec_deep');
    assert.equal(p.rest, 'planning', 'the unclaimed words stay in the title rather than vanishing');
    assert.equal(c.completeSectionToken('/deep work planning friday', 1), '/Deep work planning planning friday',
      'and Tab reaches the longer section — the token span is rewritten, nothing else is');
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
test('sectionCompletions: the longer names sharing the typed prefix, shortest first', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const r = c.sectionCompletions('/deep work friday');
    assert.equal(r.token, '/deep work');
    assert.deepEqual(r.names, ['Deep work', 'Deep work planning'],
      'the match itself is first, so Tab cycles forward from what is already applied');
  });
});

test('sectionCompletions: completing rewrites only the token, keeping the rest of the line', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    assert.equal(c.completeSectionToken('/deep work friday', 1), '/Deep work planning friday');
    // Cycling wraps back to the shortest rather than dead-ending.
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
