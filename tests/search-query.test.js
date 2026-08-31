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

/* ---- Task 1: the lexer ---- */
const TK = (s, c) => Array.from((c || make()).searchTokens(s)).map(t => Object.assign({}, t));

test('lexer: a bare word is one term token', () => {
  assert.deepEqual(TK('report'), [{ k:'term', neg:false, cue:'', raw:'report', quoted:false }]);
});

test('lexer: uppercase AND/OR are structural, other cases are text', () => {
  assert.deepEqual(TK('AND').map(t => t.k), ['AND']);
  assert.deepEqual(TK('OR').map(t => t.k), ['OR']);
  assert.deepEqual(TK('and').map(t => t.k), ['term']);
  assert.deepEqual(TK('And').map(t => t.k), ['term']);
  assert.deepEqual(TK('oR').map(t => t.k), ['term']);
});

test('lexer: parens split off tokens they are glued to', () => {
  assert.deepEqual(TK('(@work OR @home)').map(t => t.k),
    ['(', 'term', 'OR', 'term', ')']);
  assert.deepEqual(TK('(@work OR @home)').filter(t => t.k === 'term').map(t => t.raw),
    ['@work', '@home']);
});

test('lexer: -( is one negated open paren', () => {
  const t = TK('-(p1)');
  assert.equal(t[0].k, '(');
  assert.equal(t[0].neg, true);
});

test('lexer: a bare dash is still text, not a negation', () => {
  assert.deepEqual(TK('-').map(t => t.k), ['term']);
  assert.equal(TK('-')[0].raw, '-');
  assert.equal(TK('-')[0].neg, false);
});

test('lexer: quotes are inviolate', () => {
  assert.deepEqual(TK('"AND"').map(t => t.k), ['term']);
  assert.equal(TK('"AND"')[0].raw, 'AND');
  assert.equal(TK('"(a OR b)"').length, 1);
  assert.equal(TK('"(a OR b)"')[0].raw, '(a OR b)');
});

test('lexer: a cued quoted phrase keeps its cue and its negation', () => {
  assert.deepEqual(TK('-by:"next monday"'),
    [{ k:'term', neg:true, cue:'by', raw:'next monday', quoted:true }]);
});

/* ---- Task 2: the parser ---- */
const N = (s, c) => P(s, c).node;
/* Shape-only summary of a tree, so assertions read as the grammar rather than as object soup.
   A default node prints as `(type:val|val & type:val)`, with `!` marking a negated group. */
function shape(n){
  if(!n) return 'null';
  if(n.op === 'and') return '(' + Array.from(n.nodes).map(shape).join(' AND ') + ')';
  if(n.op === 'or')  return '(' + Array.from(n.nodes).map(shape).join(' OR ')  + ')';
  if(n.op === 'not') return 'NOT' + shape(n.node);
  return '[' + Array.from(n.groups).map(g =>
    (g.neg ? '!' : '') + g.type + ':' + Array.from(g.values).map(v =>
      (v && v.cue) ? v.cue + '=' + v.ms : v).join('|')).join(' & ') + ']';
}

test('parser: an operator-free query is one default node, groups intact', () => {
  const q = P('@work @home p1');
  assert.equal(q.node.op, 'default');
  assert.equal(shape(q.node), '[tag:work|home & priority:1]');
  assert.equal(q.groups, q.node.groups);   // the root still exposes the flat list
});

test('parser: AND overrides same-type OR', () => {
  assert.equal(shape(N('@work AND @home')), '([tag:work] AND [tag:home])');
});

test('parser: OR overrides cross-type AND', () => {
  assert.equal(shape(N('@work OR p1')), '([tag:work] OR [priority:1])');
});

test('parser: adjacency binds tighter than AND', () => {
  assert.equal(shape(N('@work @home AND p1')), '([tag:work|home] AND [priority:1])');
});

test('parser: AND binds tighter than OR', () => {
  assert.equal(shape(N('p1 @work OR @home p2')),
    '([priority:1 & tag:work] OR [tag:home & priority:2])');
  assert.equal(shape(N('a OR b AND c')), '([text:a] OR ([text:b] AND [text:c]))');
});

test('parser: parentheses regroup', () => {
  assert.equal(shape(N('p1 AND (@work OR @home)')),
    '([priority:1] AND ([tag:work] OR [tag:home]))');
});

test('parser: a paren beside a term ANDs into the run', () => {
  assert.equal(shape(N('p1 (@work OR @home)')),
    '([priority:1] AND ([tag:work] OR [tag:home]))');
});

test('parser: -( negates a whole group', () => {
  assert.equal(shape(N('-(p1 AND @work)')), 'NOT([priority:1] AND [tag:work])');
});

test('parser: token-level negation is unchanged', () => {
  assert.equal(shape(N('@work -@home')), '[tag:work & !tag:home]');
});

/* ---- Task 2: silent repair ---- */
test('repair: a dangling operator is dropped', () => {
  assert.equal(shape(N('@work AND')), '[tag:work]');
  assert.equal(shape(N('AND @work')), '[tag:work]');
  assert.equal(shape(N('@work AND OR p1')), '([tag:work] OR [priority:1])');
});

test('repair: an unclosed ( closes at end of line', () => {
  assert.equal(shape(N('p1 AND (@work OR @home')),
    '([priority:1] AND ([tag:work] OR [tag:home]))');
});

test('repair: a stray ) degrades to free text', () => {
  assert.equal(shape(N('@work )')), '[tag:work & text:)]');
});

test('repair: an empty group contributes nothing', () => {
  assert.equal(shape(N('p1 ()')), '[priority:1]');
  assert.equal(shape(N('()')), '[]');
});

test('repair: nothing throws, whatever is typed', () => {
  ['(', ')', '-(', '((((', '))))', 'AND', 'OR', '- ', 'a AND (b OR (c AND', '"unterminated']
    .forEach(s => assert.doesNotThrow(() => P(s), s));
});

/* ---- Task 3: the evaluator ---- */
test('eval: AND demands both tags where the default would accept either', () => {
  const { c, mk } = fixture();
  const both = mk({ id:'a', name:'x', labels:['work','home'] });
  const one  = mk({ id:'b', name:'x', labels:['work'] });
  assert.equal(ev(c, both, '@work @home'), true);
  assert.equal(ev(c, one,  '@work @home'), true);    // default: either
  assert.equal(ev(c, both, '@work AND @home'), true);
  assert.equal(ev(c, one,  '@work AND @home'), false);
});

test('eval: OR accepts either where the default would demand both', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x', labels:['work'], priority:3 });
  assert.equal(ev(c, t, '@work p1'), false);         // default: both
  assert.equal(ev(c, t, '@work OR p1'), true);
});

test('eval: adjacency binds tighter than AND', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x', labels:['home'], priority:1 });
  assert.equal(ev(c, t, '@work @home AND p1'), true);   // (work OR home) AND p1
  assert.equal(ev(c, mk({ id:'b', name:'x', labels:['home'], priority:2 }),
                     '@work @home AND p1'), false);
});

test('eval: parentheses regroup', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x', labels:['home'], priority:1 });
  assert.equal(ev(c, t, 'p1 AND (@work OR @home)'), true);
  assert.equal(ev(c, mk({ id:'b', name:'x', labels:['other'], priority:1 }),
                     'p1 AND (@work OR @home)'), false);
});

test('eval: -(a AND b) excludes only BOTH — what -a -b cannot say', () => {
  const { c, mk } = fixture();
  const both = mk({ id:'a', name:'x', labels:['work'], priority:1 });
  const half = mk({ id:'b', name:'x', labels:['work'], priority:3 });
  const none = mk({ id:'c', name:'x', priority:3 });
  assert.equal(ev(c, both, '-(p1 AND @work)'), false);
  assert.equal(ev(c, half, '-(p1 AND @work)'), true);   // the new capability
  assert.equal(ev(c, none, '-(p1 AND @work)'), true);
  assert.equal(ev(c, half, '-p1 -@work'), false);       // the old shape still excludes it
});

test('eval: -(a OR b) means neither', () => {
  const { c, mk } = fixture();
  assert.equal(ev(c, mk({ id:'a', name:'x', labels:['home'] }), '-(@work OR @home)'), false);
  assert.equal(ev(c, mk({ id:'b', name:'x', labels:['other'] }), '-(@work OR @home)'), true);
});

test('eval: an empty or all-repaired query matches everything', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'x' });
  assert.equal(ev(c, t, ''), true);
  assert.equal(ev(c, t, '   '), true);
  assert.equal(ev(c, t, '()'), true);
  assert.equal(ev(c, t, 'AND'), true);
});

test('eval: lowercase and/or stay free text', () => {
  const { c, mk } = fixture();
  assert.equal(ev(c, mk({ id:'a', name:'milk and eggs' }), 'milk and eggs'), true);
  /* 'and' is a text term like any other — same-type terms OR, so this is the pre-existing
     default rule, not operator behaviour. The proof that it is NOT an operator is the parse. */
  assert.deepEqual(vals(grp(P('milk and eggs'), 'text')), ['milk', 'and', 'eggs']);
  assert.equal(ev(c, mk({ id:'b', name:'bread' }), 'milk and eggs'), false);
});

test('eval: the haystack is built once per task, however deep the tree', () => {
  const { c, mk } = fixture();
  const t = mk({ id:'a', name:'alpha beta gamma delta' });
  let built = 0;
  const realDesc = Object.getOwnPropertyDescriptor(t, 'name');
  Object.defineProperty(t, 'name', { get(){ built++; return 'alpha beta gamma delta'; }, configurable:true });
  ev(c, t, 'alpha OR (beta AND gamma) OR delta');
  Object.defineProperty(t, 'name', realDesc || { value:'alpha beta gamma delta' });
  assert.equal(built, 1);
});
