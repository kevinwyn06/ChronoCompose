// Spec-derived unit tests for Phase 7 — sort / filter / smart-chip core.
// Behavior derived from ROADMAP.md Phase 7 owner decisions (2026-07-05) + CLAUDE.md invariants.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, DAY } = require('./_load.js');

// Build a task with sane defaults; `over` overrides fields (incl. id/parentId/name/priority/...).
function T(c, over){
  return c.normalizeTask(Object.assign({
    id:'id'+Math.random().toString(36).slice(2,8), name:'t', type:'Proportional',
    start:Date.now()-DAY, end:Date.now()+DAY, priority:4, deps:[], pct:0, planned:60, spent:0,
  }, over||{}));
}
// Array.from runs in the TEST realm, so the result has this realm's Array.prototype
// (sandbox-returned arrays otherwise fail deepStrictEqual's prototype check).
function names(list){ return Array.from(list, t=>t.name); }
function ids(list){ return Array.from(list, t=>t.id); }

// ---------------------------------------------------------------------------
// Recursive hierarchical sort — sortTree
// ---------------------------------------------------------------------------
test('sortTree sorts roots among roots and keeps each subtree glued under its parent', () => {
  const c = make();
  // manual order: B, B1, B2, A, A1  (B before A)
  const list = [
    T(c,{id:'B',name:'Bravo',parentId:null}),
    T(c,{id:'B1',name:'Bravo-2',parentId:'B'}),
    T(c,{id:'B2',name:'Bravo-1',parentId:'B'}),
    T(c,{id:'A',name:'Alpha',parentId:null}),
    T(c,{id:'A1',name:'Alpha-1',parentId:'A'}),
  ];
  const out = c.sortTree(list, {key:'name', dir:'asc'});
  // roots reorder A before B; children sort WITHIN their parent (B2 'Bravo-1' before B1 'Bravo-2');
  // each subtree stays contiguous right after its parent.
  assert.deepEqual(names(out), ['Alpha','Alpha-1','Bravo','Bravo-1','Bravo-2']);
  assert.deepEqual(ids(out), ['A','A1','B','B2','B1']);
});

test('sortTree with null/absent key returns the list unchanged (manual order restored)', () => {
  const c = make();
  const list = [T(c,{name:'z'}), T(c,{name:'a'}), T(c,{name:'m'})];
  assert.equal(c.sortTree(list, null), list);
  assert.deepEqual(names(c.sortTree(list, {key:'', dir:'asc'})), ['z','a','m']);
});

test('sortTree desc reverses order; empty values always sort last regardless of dir', () => {
  const c = make();
  const list = [T(c,{name:'a',priority:2}), T(c,{name:'b',priority:1}), T(c,{name:'c',priority:3})];
  assert.deepEqual(names(c.sortTree(list, {key:'priority', dir:'asc'})), ['b','a','c']); // 1,2,3
  assert.deepEqual(names(c.sortTree(list, {key:'priority', dir:'desc'})), ['c','a','b']); // 3,2,1
  // empty tag ('') sorts last both directions
  const tagged = [T(c,{name:'none',labels:[]}), T(c,{name:'work',labels:['work']}), T(c,{name:'admin',labels:['admin']})];
  assert.equal(names(c.sortTree(tagged, {key:'tags', dir:'asc'})).pop(), 'none');
  assert.equal(names(c.sortTree(tagged, {key:'tags', dir:'desc'})).pop(), 'none');
});

test('sortTree is stable — equal keys keep their manual (input) order', () => {
  const c = make();
  const list = [T(c,{id:'p2',name:'x',priority:1}), T(c,{id:'p1',name:'y',priority:1}), T(c,{id:'p3',name:'z',priority:1})];
  assert.deepEqual(ids(c.sortTree(list, {key:"priority", dir:"asc"})), ['p2','p1','p3']);
});

test('sortTree treats a child whose parent is outside the set as a root (no drop, no cycle)', () => {
  const c = make();
  const list = [T(c,{id:'orphan',name:'m',parentId:'GONE'}), T(c,{id:'r',name:'a',parentId:null})];
  const out = c.sortTree(list, {key:'name', dir:'asc'});
  assert.equal(out.length, 2);
  assert.deepEqual(names(out), ['a','m']);
});

// ---------------------------------------------------------------------------
// Column filters — matchColFilter / filterTasks
// ---------------------------------------------------------------------------
test('text filter: name contains (case-insensitive) and tags match any label', () => {
  const c = make();
  const a=T(c,{name:'Write Report'}), b=T(c,{name:'call bob'}), d=T(c,{name:'x',labels:['work','urgent']});
  assert.ok(c.matchColFilter(a,'name',{contains:'report'}));
  assert.ok(!c.matchColFilter(b,'name',{contains:'report'}));
  assert.ok(c.matchColFilter(d,'tags',{contains:'urgent'}));
  assert.ok(!c.matchColFilter(d,'tags',{contains:'home'}));
  assert.ok(c.matchColFilter(a,'name',{contains:''})); // empty spec passes
});

test('numeric range filter: priority/planned min & max are inclusive', () => {
  const c = make();
  const p1=T(c,{priority:1,planned:30}), p3=T(c,{priority:3,planned:120});
  assert.ok(c.matchColFilter(p1,'priority',{max:2}));
  assert.ok(!c.matchColFilter(p3,'priority',{max:2}));
  assert.ok(c.matchColFilter(p3,'planned',{min:120,max:120}));
  assert.ok(!c.matchColFilter(p1,'planned',{min:60}));
});

/* PP-EXT (owner 2026-08-25, filter-bar redesign): `togglePriority` is DELETED with the "Filters ▾"
   popover's P1–P4 chips. The colFilters.priority SPEC it authored is deliberately still supported — the
   prefs migration preserves a stored one and the `check` column's context menu still writes it — so this
   test keeps proving the spec and its mutator, and drops only the retired chip helper. */
test('priority set filter: matches membership; setColFilter still authors the spec', () => {
  const c = make();
  const p1=T(c,{priority:1}), p2=T(c,{priority:2});
  // set-membership on the num column
  assert.ok(c.matchColFilter(p1,'priority',{set:[1,3]}));
  assert.ok(!c.matchColFilter(p2,'priority',{set:[1,3]}));
  assert.ok(c.filterActive({set:[1]}));
  assert.ok(!c.filterActive({set:[]}));
  assert.equal(typeof c.togglePriority, 'undefined', 'the P1–P4 chip mutator is gone with its chips');
  const pset=()=>Array.from(c.state.colFilters.priority.set); // cross-realm array → this realm's prototype
  c.state.colFilters = {};
  c.setColFilter('priority', {set:[1,4]});
  assert.deepEqual(pset(), [1,4]);
  c.setColFilter('priority', {set:[]});
  assert.equal(c.state.colFilters.priority, undefined); // empty set drops the whole spec
});

test('bool filter on incl matches the isActiveToday state', () => {
  const c = make();
  const on = activeTask(c,{included:true}), off = T(c,{included:null, snoozeUntil: c.startOfToday()+86400000});
  assert.ok(c.matchColFilter(on,'incl',{val:true}));
  assert.ok(!c.matchColFilter(off,'incl',{val:true}));
  assert.ok(c.matchColFilter(off,'incl',{val:false}));
  assert.ok(c.matchColFilter(on,'incl',{val:null})); // null = no constraint
});

test('filterTasks ANDs active column filters and is inert when none are set', () => {
  const c = make();
  const list = [T(c,{name:'alpha',priority:1}), T(c,{name:'alphabet',priority:3}), T(c,{name:'beta',priority:1})];
  c.state.tasks = list;
  const byId = {}; list.forEach(t=>byId[t.id]=t);
  c.state.colFilters = {}; c.state.chips = [];
  assert.equal(c.filterTasks(list, byId), list); // inert → same reference
  c.state.colFilters = { name:{contains:'alpha'}, priority:{max:2} };
  assert.deepEqual(names(c.filterTasks(list, byId)), ['alpha']); // 'alpha' matches both; 'alphabet' fails priority
});

// ---------------------------------------------------------------------------
// Smart chips — matchChip
// ---------------------------------------------------------------------------
/* PP-EXT (owner 2026-08-25): the four retired chips — *"active today and startable and overdue and
   running are not selectors I would ever click on."* `matchChip` knows only `unplanned` now, and an
   unknown chip key falls through to its permissive default rather than filtering by a deleted rule. */
test('the four retired chips are gone from matchChip and from SMART_CHIPS', () => {
  const c = make();
  const done=T(c,{id:'d',pct:100}), open=T(c,{id:'o',pct:40});
  const byId={d:done,o:open};
  assert.deepEqual(Array.from(c.SMART_CHIPS()).map(x=>x.k), ['unplanned'], 'Unplanned is the only surviving chip');
  for (const k of ['activeToday','startable','overdue','running']) {
    assert.ok(c.matchChip(T(c,{deps:['o']}), k, byId), k+' no longer filters anything');
  }
});

test('unplanned chip: planned==0, not complete, not a milestone', () => {
  const c = make();
  assert.ok(c.matchChip(T(c,{planned:0,pct:0}), 'unplanned', {}));
  assert.ok(!c.matchChip(T(c,{planned:60}), 'unplanned', {}));
  assert.ok(!c.matchChip(T(c,{planned:0,pct:100}), 'unplanned', {}));
  assert.ok(!c.matchChip(T(c,{planned:0,type:'Milestone'}), 'unplanned', {}));
});

/* PP-EXT (owner 2026-08-25): overdue and running survive their chips as `is:` SEARCH tokens, which is
   where an occasional need for them belongs. Same rules, asserted through their new spelling. */
test('is:overdue is past due and under 100%; is:running reflects the timer map', () => {
  const c = make();
  const late=T(c,{start:Date.now()-3*DAY,end:Date.now()-DAY,pct:20,allDay:false});
  const future=T(c,{start:Date.now()+DAY,end:Date.now()+2*DAY,pct:0});
  assert.ok(c.searchIsMatch(late,'overdue'));
  assert.ok(!c.searchIsMatch(future,'overdue'));
  assert.ok(!c.searchIsMatch(T(c,{end:Date.now()-DAY,pct:100}),'overdue'));
  const run=T(c,{id:'r1'}); c.state.running = { r1:{startedAt:Date.now()-1000, beat:Date.now()} };
  assert.ok(c.searchIsMatch(run,'running'));
  assert.ok(!c.searchIsMatch(T(c,{id:'r2'}),'running'));
});

// ---------------------------------------------------------------------------
// visibleTasks integration — filter + sort together, identity stable when inert
// ---------------------------------------------------------------------------
test('visibleTasks returns the same array reference when nothing is hidden/filtered/sorted', () => {
  const c = make();
  c.state.tasks = [T(c,{name:'a'}), T(c,{name:'b'})];
  c.state.sort = null; c.state.colFilters = {}; c.state.chips = [];
  assert.equal(c.visibleTasks(), c.state.tasks);
});

test('visibleTasks applies column filter then hierarchical sort', () => {
  const c = make();
  const list = [
    T(c,{id:'P',name:'ProjZ',parentId:null,priority:2}),
    T(c,{id:'P1',name:'child-b',parentId:'P',priority:2}),
    T(c,{id:'P2',name:'child-a',parentId:'P',priority:2}),
    T(c,{id:'Q',name:'ProjA',parentId:null,priority:2}),
    T(c,{id:'skip',name:'ignore-me',parentId:null,priority:4}),
  ];
  c.state.tasks = list;
  c.state.colFilters = { priority:{max:2} };   // drops 'skip'
  c.state.sort = { key:'name', dir:'asc' };     // roots ProjA<ProjZ; children a<b under ProjZ
  assert.deepEqual(names(c.visibleTasks()), ['ProjA','ProjZ','child-a','child-b']);
});
