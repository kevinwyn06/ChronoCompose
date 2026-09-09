// Owner ruling 2026-09-09 — a parent with no planned time of its own is a CONTAINER.
//
// Owner, verbatim: *"if a parent task doesn't have a time planned, the child tasks should have their
// planned times treated as top level times"*, and: *"parent doesn't display anything — if it has no time
// of its own it is merely an organizational tool and should not crowd with redundant information"*.
//
// The existing budget model is unchanged wherever the parent HAS a figure. The hole it had is the shape
// people actually make — a heading with work under it: such a parent asked the day for nothing, was
// allotted nothing, and then split that nothing among its children, so a whole family of real work
// received no time at all while the parent still drew a bar for it.
const test = require('node:test');
const assert = require('node:assert');
const { make, cleanDay, DAY, withNow, FIXED_NOW } = require('./_load.js');

function family(c, parentPlanned) {
  const B = c.startOfToday();
  const mk = (id, over) => c.normalizeTask(Object.assign({
    id, name: id, type: 'Proportional', start: B, end: B + DAY - 1,
    priority: 4, deps: [], pct: 0, included: true,
  }, over));
  return [
    mk('p', { planned: parentPlanned }),
    mk('c1', { parentId: 'p', planned: 60 }),
    mk('c2', { parentId: 'p', planned: 60 }),
  ];
}

test('a parent with no planned time is a container; one with a figure is not', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = family(c, null);
    const kb = c.buildKids(c.state.tasks);
    assert.strictEqual(c.isContainerParent(kb.byId.p, kb.kids), true);
    c.state.tasks = family(c, 120);
    const kb2 = c.buildKids(c.state.tasks);
    assert.strictEqual(c.isContainerParent(kb2.byId.p, kb2.kids), false, 'a real budget is still a budget');
  });
});

test('a childless task is never a container, however little time it has', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = c.normalizeTask({ id: 'a', name: 'a', planned: null, deps: [], pct: 0 });
    c.state.tasks = [t];
    const kb = c.buildKids(c.state.tasks);
    assert.strictEqual(c.isContainerParent(t, kb.kids), false);
  });
});

// The defect, stated as a number: under the old rule the family's allotment was zero.
test("a container's children are allotted time — the family is no longer starved", () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    c.state.tasks = family(c, null);
    const map = c.computeAllotted(c.state.tasks, c.startOfToday());
    assert.ok(map.c1.allotted > 0, 'the first child got real minutes');
    assert.ok(map.c2.allotted > 0, 'and so did the second');
    assert.strictEqual(map.p.active, false, 'the container itself holds nothing');
    assert.strictEqual(map.p.allotted, 0);
  });
});

test("a container's children compete as top-level work, not out of its share", () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    // The same two children, one under a container and one at top level, ask the day for the same thing.
    c.state.tasks = family(c, null);
    const inFamily = c.computeAllotted(c.state.tasks, c.startOfToday()).c1.allotted;
    const B = c.startOfToday();
    c.state.tasks = [
      c.normalizeTask({ id: 'c1', name: 'c1', type: 'Proportional', start: B, end: B + DAY - 1,
        planned: 60, priority: 4, deps: [], pct: 0, included: true }),
      c.normalizeTask({ id: 'c2', name: 'c2', type: 'Proportional', start: B, end: B + DAY - 1,
        planned: 60, priority: 4, deps: [], pct: 0, included: true }),
    ];
    const flat = c.computeAllotted(c.state.tasks, B).c1.allotted;
    assert.strictEqual(inFamily, flat, 'the container is not in the way of anything');
  });
});

// The budgeted model must survive untouched — this is the case the ruling deliberately does not change.
test('a BUDGETED parent still keeps its own time and splits it among its children', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    c.state.tasks = family(c, 180);
    const map = c.computeAllotted(c.state.tasks, c.startOfToday());
    assert.ok(map.p.active, 'the parent competes for the day');
    assert.ok(map.c1.fromParent, 'and its children are paid out of its share');
    assert.ok(map.c2.fromParent);
  });
});

test('a container draws no Gantt bar; its children draw their own', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = family(c, null);
    const kb = c.buildKids(c.state.tasks);
    c._kids = kb.kids;
    assert.strictEqual(c.isContainerParent(kb.byId.p), true, 'reads the render memo when given no map');
    assert.strictEqual(c.isContainerParent(kb.byId.c1), false, 'a leaf child still draws');
  });
});

// Giving the parent a figure must put it straight back into the ordinary model, with no lingering state:
// the container rule is derived on every read, exactly like `isChore`.
test('typing a Planned figure turns a container back into a budgeted parent', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    c.state.tasks = family(c, null);
    c.setPlanned('p', 180);
    const map = c.computeAllotted(c.state.tasks, c.startOfToday());
    assert.ok(map.p.active, 'it competes again');
    assert.ok(map.c1.fromParent, 'and its children are paid from its share again');
  });
});

test('emptying a parent Planned figure makes it a container again', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    c.state.tasks = family(c, 180);
    c.setPlanned('p', '');
    const kb = c.buildKids(c.state.tasks);
    assert.strictEqual(c.isContainerParent(kb.byId.p, kb.kids), true);
    const map = c.computeAllotted(c.state.tasks, c.startOfToday());
    assert.ok(map.c1.allotted > 0);
    assert.strictEqual(map.p.allotted, 0);
  });
});

// A container in the day timeline packs nothing of its own; the children pack themselves.
test('the day timeline packs the children, never the container', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    cleanDay(c, '18:00');
    c.state.tasks = family(c, null);
    c._allot = c.computeAllotted(c.state.tasks, c.startOfToday());
    const tl = c.buildDayTimeline(c.startOfToday());
    const ids = (tl.chunks || []).map(b => b && b.id).filter(Boolean);
    assert.ok(!ids.includes('p'), 'the container is not a block');
    assert.ok(ids.includes('c1') || ids.includes('c2'), 'the children are');
  });
});
