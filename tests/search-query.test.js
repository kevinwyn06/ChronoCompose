const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const P = (s, c) => (c || make()).parseSearchQuery(s);
const grp = (q, type, neg) => q.groups.find(g => g.type === type && !!g.neg === !!neg);
/* The component runs in a `vm` context, so arrays it builds carry that realm's Array.prototype and
   assert/strict's deepEqual rejects them on identity alone. `vals` copies into this realm so the
   assertions below are about the parser's output and nothing else. */
const vals = (g) => Array.from((g && g.values) || []);

test('empty text yields no groups', () => { assert.deepEqual(Array.from(P('').groups), []); });

test('a bare word is a text group', () => {
  assert.deepEqual(vals(grp(P('report'), 'text')), ['report']);
});

test('a quoted phrase keeps its inner space', () => {
  assert.deepEqual(vals(grp(P('"two words"'), 'text')), ['two words']);
});

test('same-type tokens OR into one group', () => {
  assert.deepEqual(vals(grp(P('@work @home'), 'tag')), ['work', 'home']);
  assert.deepEqual(vals(grp(P('p1 p3'), 'priority')), [1, 3]);
});

test('different types make separate groups (AND)', () => {
  assert.equal(P('@work p1').groups.length, 2);
});

test('negation splits into its own group', () => {
  const q = P('@work -@home');
  assert.deepEqual(vals(grp(q, 'tag', false)), ['work']);
  assert.deepEqual(vals(grp(q, 'tag', true)), ['home']);
});

test('is: accepts the six known values and drops the rest', () => {
  assert.deepEqual(vals(grp(P('is:overdue'), 'is')), ['overdue']);
  assert.equal(grp(P('is:banana'), 'is'), undefined);
});

test('a date cue resolves through the NL parser', () => {
  const g = grp(P('by:friday'), 'date');
  assert.equal(g.values[0].cue, 'by');
  assert.equal(typeof g.values[0].ms, 'number');
});

test('a section token becomes a section group', () => {
  assert.deepEqual(vals(grp(P('/deep'), 'section')), ['deep']);
});

test('malformed input never throws', () => {
  for (const s of ['-', '"unterminated', '@', '/', 'p9', 'by:']) {
    assert.doesNotThrow(() => P(s));
  }
});

const DAY = 86400000;
const ev = (c, t, s) => c.searchMatch(t, c.parseSearchQuery(s));

function fixture(){
  const c = make(); c.state.tasks = [];
  c.state.sections = [{ id:'s1', name:'Deep work' }];
  return { c, B: c.startOfToday(), mk: (o) => c.normalizeTask(o) };
}

test('bare text matches name and description', () => {
  const { c, mk } = fixture();
  assert.equal(ev(c, mk({ id:'a', name:'Write report' }), 'report'), true);
  assert.equal(ev(c, mk({ id:'b', name:'Other', desc:'<p>quarterly report</p>' }), 'report'), true);
  assert.equal(ev(c, mk({ id:'c', name:'Other' }), 'report'), false);
});

test('same-type tags OR, cross-type ANDs', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x', labels:['work'], priority:1 });
  assert.equal(ev(c, t, '@work @home'), true);
  assert.equal(ev(c, t, '@work p1'), true);
  assert.equal(ev(c, t, '@work p2'), false);
});

test('negation excludes', () => {
  const { c, mk } = fixture();
  assert.equal(ev(c, mk({ id:'a', name:'x', labels:['work'] }), '-@work'), false);
  assert.equal(ev(c, mk({ id:'b', name:'x' }), '-@work'), true);
});

test('a section token matches by prefix so multi-word names are reachable', () => {
  const { c, mk } = fixture();
  assert.equal(ev(c, mk({ id:'a', name:'x', sectionId:'s1' }), '/deep'), true);
  assert.equal(ev(c, mk({ id:'b', name:'x' }), '/deep'), false);
});

test('is:unplanned agrees with the surviving chip', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x', planned:0 });
  assert.equal(ev(c, t, 'is:unplanned'), c.matchChip(t, 'unplanned', {}));
});

test('by: is on-or-before the named day, before: is strictly before', () => {
  const { c, B, mk } = fixture();
  const soon = mk({ id:'a', name:'x', start:B, end:B + 2*DAY });
  const late = mk({ id:'b', name:'x', start:B, end:B + 20*DAY });
  const cut = { groups:[{ type:'date', neg:false, values:[{ cue:'by', ms:B + 5*DAY }] }] };
  assert.equal(c.searchMatch(soon, cut), true);
  assert.equal(c.searchMatch(late, cut), false);
  const strict = { groups:[{ type:'date', neg:false, values:[{ cue:'before', ms:B + 2*DAY }] }] };
  assert.equal(c.searchMatch(soon, strict), false);
});

test('a running search suspends horizon, chips and sort', () => {
  const { c, B, mk } = fixture();
  const a = mk({ id:'a', name:'alpha', start:B + 300*DAY, end:B + 301*DAY });
  c.state.tasks = [a];
  c.state.horizon = '1w';
  c.state.chips = ['unplanned'];
  c.state.sort = { key:'name', dir:'desc' };
  assert.equal(c.filterTasks([a], {}).length, 0);   // the horizon hides it
  c.setSearch('alpha');
  assert.equal(c.searchActive(), true);
  assert.equal(c.filterTasks([a], {}).length, 1);   // the search alone decides
  assert.equal(c.effectiveSort(), null);
  assert.equal(c.effectiveGroupBy(), 'section');
});

test('clearing the search restores everything, untouched', () => {
  const { c } = fixture();
  c.state.horizon = '1w'; c.state.chips = ['unplanned']; c.state.sort = { key:'name', dir:'desc' };
  c.setSearch('alpha'); c.clearSearch();
  assert.equal(c.searchActive(), false);
  assert.equal(c.state.horizon, '1w');
  assert.deepEqual(Array.from(c.state.chips), ['unplanned']);
  assert.deepEqual(Object.assign({}, c.state.sort), { key:'name', dir:'desc' });
});
