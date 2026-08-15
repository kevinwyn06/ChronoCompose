const { test } = require('node:test');
const assert = require('node:assert');
const { make, activeTask } = require('./_load');

/* V2.6 — sections as a first-class entity.
   Spec: docs/superpowers/specs/2026-08-03-sections-and-triage-design.md §1-§2. */

const secs = c => [
  c.normalizeSection({ id:'s1', name:'Research', order:0 }),
  c.normalizeSection({ id:'s2', name:'Admin',    order:1 }),
];

test('V2.6 tasksBySection groups by the SUBTREE ROOT section, never tearing parent/child apart', () => {
  const c = make();
  c.state.sections = secs(c);
  const parent = activeTask(c, { id:'p', sectionId:'s1' });
  /* the child names a DIFFERENT section — the root must still win, verbatim from the V2.3 rule */
  const child = activeTask(c, { id:'kid', parentId:'p', sectionId:'s2' });
  const admin = activeTask(c, { id:'a', sectionId:'s2' });
  const loose = activeTask(c, { id:'u', sectionId:null });

  const out = c.tasksBySection([parent, child, admin, loose]);
  assert.deepEqual(out.map(x => x.id), ['s1', 's2', null]);
  assert.deepEqual(out.map(x => x.tasks.map(t => t.id)), [['p', 'kid'], ['a'], ['u']]);
  assert.equal(out.flatMap(x => x.tasks).length, 4, 'each task appears exactly once');
});

test('V2.6 the No-section bucket renders LAST even when it is seen first', () => {
  const c = make();
  c.state.sections = secs(c);
  /* untagged task first in the list — V2.3 first-seen ordering would have put it at index 0 */
  const out = c.tasksBySection([
    activeTask(c, { id:'u', sectionId:null }),
    activeTask(c, { id:'r', sectionId:'s1' }),
  ]);
  /* s2 is declared-but-empty and still renders; the point is that `null` is last regardless */
  assert.deepEqual(out.map(x => x.id), ['s1', 's2', null]);
  assert.equal(out[out.length - 1].id, null, 'No section is always last');
});

test('V2.6 sections order by `order`, ties broken by id, and empty sections still render', () => {
  const c = make();
  c.state.sections = [
    c.normalizeSection({ id:'b', name:'B', order:5 }),
    c.normalizeSection({ id:'a', name:'A', order:5 }),
    c.normalizeSection({ id:'z', name:'Z', order:1 }),
  ];
  const out = c.tasksBySection([activeTask(c, { id:'t', sectionId:'a' })]);
  assert.deepEqual(out.map(x => x.id), ['z', 'a', 'b'], 'order asc, then id');
  assert.equal(out.find(x => x.id === 'z').tasks.length, 0, 'an empty section you created still renders');
  assert.equal(out.some(x => x.id === null), false, 'an EMPTY No-section bucket does not render');
});

test('V2.6 a task pointing at a deleted section falls back to No section rather than vanishing', () => {
  const c = make();
  c.state.sections = secs(c);
  const orphan = activeTask(c, { id:'o', sectionId:'gone' });
  const out = c.tasksBySection([orphan]);
  assert.deepEqual(out[out.length - 1].tasks.map(t => t.id), ['o']);
  assert.equal(out.flatMap(x => x.tasks).length, 1, 'the task is not lost');
});

test('V2.6 deleting a section dissolves its tasks to No section instead of deleting work', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [activeTask(c, { id:'x', sectionId:'s1' }), activeTask(c, { id:'y', sectionId:'s2' })];

  c.deleteSection('s1');

  assert.deepEqual(c.state.sections.map(s => s.id), ['s2']);
  assert.equal(c.state.sections[0].order, 0, 'order is renumbered densely after a delete');
  assert.equal(c.state.tasks.length, 2, 'no task was deleted');
  assert.equal(c.state.tasks.find(t => t.id === 'x').sectionId, null, 'dissolved to No section');
  assert.equal(c.state.tasks.find(t => t.id === 'y').sectionId, 's2', 'other sections untouched');
});

test('V2.6 section CRUD: append lands at the end, reorder renumbers densely, both are pure', () => {
  const c = make();
  const base = secs(c);
  const added = c.addSectionTo(base, 'Later');
  assert.equal(base.length, 2, 'addSectionTo does not mutate its input');
  assert.equal(added[2].name, 'Later');
  assert.equal(added[2].order, 2, 'appended after the current max order');

  const moved = c.reorderSectionsIn(added, added[2].id, 0);
  assert.deepEqual(moved.map(s => s.name), ['Later', 'Research', 'Admin']);
  assert.deepEqual(moved.map(s => s.order), [0, 1, 2], 'order is renumbered densely');

  const noop = c.reorderSectionsIn(added, 'missing', 0);
  assert.equal(noop.length, 3, 'reordering an unknown id is a no-op, not a throw');
});

// PP-EXT (owner 2026-08-13): "Sections should not be a tag." The migration now CONSUMES the tag it
// promotes. V2.6 read the tag and kept it, so a task in section "work" also wore an @work chip on every
// row and card — the app went on presenting a section as a kind of tag, which is the exact model V2.6
// existed to break. Only the promoted tag goes; every other label survives, and an unpromoted singleton
// is untouched because it is still doing a tag's job.
test('V2.6 migration promotes a tag only at threshold 2 and CONSUMES exactly that tag', () => {
  const c = make();
  const tasks = [
    activeTask(c, { id:'w1', labels:['work', 'deep'] }),
    activeTask(c, { id:'w2', labels:['work'] }),
    activeTask(c, { id:'solo', labels:['reading'] }),   // singleton -> No section
    activeTask(c, { id:'bare', labels:[] }),
  ];
  const { sections, changed } = c.migrateSectionsFromTags(tasks);

  assert.deepEqual(sections.map(s => s.name), ['work'], 'only the >=2 tag is promoted');
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  assert.equal(byId.w1.sectionId, sections[0].id);
  assert.equal(byId.w2.sectionId, sections[0].id);
  assert.equal(byId.solo.sectionId, null, 'a singleton tag lands in No section');
  assert.equal(byId.bare.sectionId, null);
  assert.deepEqual(byId.w1.labels, ['deep'],
    'the promoted tag is consumed; the task\'s OTHER labels are untouched');
  assert.deepEqual(byId.w2.labels, []);
  assert.deepEqual(byId.solo.labels, ['reading'],
    'an unpromoted singleton tag stays — it is still doing a tag\'s job');
  assert.ok(changed >= 2, 'the strip is counted too, so the caller still saves');
});

test('a calendar-linked task keeps its tag — the calendar owns that label, not the section', () => {
  const c = make();
  // mergeCalendarEvents re-adds this tag on every import and calTag renders the chip from it, so
  // stripping it would start a churn loop and break the calendar chip. The section rule yields.
  const tasks = [
    activeTask(c, { id:'g1', labels:['work'], calendarId:'cal-a', eventId:'e1' }),
    activeTask(c, { id:'g2', labels:['work'], calendarId:'cal-a', eventId:'e2' }),
  ];
  const { sections } = c.migrateSectionsFromTags(tasks);
  assert.deepEqual(sections.map(s => s.name), ['work']);
  assert.deepEqual(tasks.map(t => t.labels), [['work'], ['work']], 'gcal tags survive');
  assert.ok(tasks.every(t => t.sectionId != null), 'but they are still sectioned');
});

test('stripSectionTags is idempotent and matches a section by NAME, not by insertion order', () => {
  const c = make();
  const secs = [c.normalizeSection({ name:'research', order:0 })];
  const tasks = [
    activeTask(c, { id:'a', labels:['urgent', 'research'], sectionId: secs[0].id }),
    activeTask(c, { id:'b', labels:['research'], sectionId: null }),  // no section -> untouched
  ];
  assert.equal(c.stripSectionTags(tasks, secs), 1, 'only the sectioned task changes');
  assert.deepEqual(tasks[0].labels, ['urgent'], 'matched mid-list, not just at labels[0]');
  assert.deepEqual(tasks[1].labels, ['research'], 'a task in No section keeps every label');
  assert.equal(c.stripSectionTags(tasks, secs), 0, 're-running changes nothing');
});

test('V2.6 migration counts ROOT tasks only, so subtrees cannot inflate a tag past the threshold', () => {
  const c = make();
  const tasks = [
    activeTask(c, { id:'p', labels:['solo'] }),
    activeTask(c, { id:'k1', parentId:'p', labels:['solo'] }),
    activeTask(c, { id:'k2', parentId:'p', labels:['solo'] }),
  ];
  const { sections } = c.migrateSectionsFromTags(tasks);
  assert.deepEqual(sections, [], 'three tasks but only one root — below threshold 2');
});

test('V2.6 migration is idempotent on re-run', () => {
  const c = make();
  const tasks = [
    activeTask(c, { id:'w1', labels:['work'] }),
    activeTask(c, { id:'w2', labels:['work'] }),
  ];
  const first = c.migrateSectionsFromTags(tasks);
  assert.equal(tasks.every(t => t.sectionId != null), true, 'both assigned');
  assert.deepEqual(tasks.map(t => t.labels), [[], []], 'and the promoted tag consumed');

  /* Re-running is STABLE in what it promotes and never orphans a task. It is not assignment-stable,
     because fresh section ids are minted each call — which is exactly why the real guard is the
     pp-migrations flag in runOnceMigrations (asserted in the next test), not this function.
     PP-EXT (owner 2026-08-13): the second run promotes NOTHING, because the first run consumed the tags
     it read. That is the correct consequence of consuming rather than a regression — the once-flag is
     what actually protects a real workspace, and this is the reason it has to. */
  const second = c.migrateSectionsFromTags(tasks);
  assert.deepEqual(second.sections, [], 'nothing left to promote — the tags were consumed');
  assert.equal(second.changed, 0, 'and a second run is a pure no-op');
  assert.deepEqual(tasks.map(t => t.labels), [[], []], 'no further labels are eaten');
  assert.equal(tasks.every(t => t.sectionId != null), true,
    'and critically, still assigned — a re-run never CLEARS a section it can no longer re-derive');
  assert.deepEqual(tasks.map(t => t.sectionId), first.sections.length
    ? tasks.map(() => tasks[0].sectionId) : tasks.map(t => t.sectionId),
    'both still share the one section from the first run');
});

test('V2.6 runOnceMigrations records the sections flag and does not re-run it', () => {
  const c = make();
  c.state.tasks = [];
  const tasks = [
    activeTask(c, { id:'w1', labels:['work'] }),
    activeTask(c, { id:'w2', labels:['work'] }),
  ];
  /* make() constructs the app, and the constructor already ran runOnceMigrations over its own seed —
     so clear the flag to observe a genuine first run against THESE tasks. */
  const flags = JSON.parse(c.lsGet('pp-migrations') || '{}');
  delete flags['sections-from-primary-tag'];
  c.lsSet('pp-migrations', JSON.stringify(flags));

  c.runOnceMigrations(tasks);
  const done = JSON.parse(c.lsGet('pp-migrations') || '{}');
  assert.equal(done['sections-from-primary-tag'], 1, 'flag is recorded');

  const stored = JSON.parse(c.lsGet('pp-sections') || '[]');
  assert.deepEqual(stored.map(s => s.name), ['work'], 'promoted section was persisted');

  /* second run: the guard short-circuits, so a hand-edited sectionId survives */
  tasks[0].sectionId = null;
  c.runOnceMigrations(tasks);
  assert.equal(tasks[0].sectionId, null, 'guarded migration did not re-stamp');
});

test('V2.6 sectionId defaults to null in normalizeTask and stays out of SYNC_FIELDS', () => {
  const c = make();
  assert.equal(c.normalizeTask({ id:'n' }).sectionId, null);
  assert.equal(c.SYNC_FIELDS().includes('sectionId'), false,
    'sectionId is deferred to the batched sync migration (spec §2.6)');
  assert.equal(c.BACKUP_KEYS().includes('pp-sections'), true,
    'local-only means backup is its only portability');
  assert.equal(c.WS_SCOPED_KEYS().includes('pp-sections'), true,
    'sections are per-account workspace data');
});

test('V2.6 assignment resolves to the subtree ROOT, so picking a section on a subtask works', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [
    activeTask(c, { id:'p', sectionId:null }),
    activeTask(c, { id:'kid', parentId:'p', sectionId:null }),
    activeTask(c, { id:'loner', sectionId:null }),
  ];

  assert.equal(c.sectionRootId(c.state.tasks, 'kid'), 'p', 'walks to the subtree root');
  assert.equal(c.sectionRootId(c.state.tasks, 'loner'), 'loner', 'a root is its own root');

  /* choosing a section while a SUBTASK is selected must move the whole subtree, not stamp a field
     that tasksBySection never reads */
  c.setTaskSectionMulti(['kid'], 's1');
  assert.equal(c.state.tasks.find(t => t.id === 'p').sectionId, 's1', 'the root moved');
  assert.equal(c.state.tasks.find(t => t.id === 'kid').sectionId, null, 'the subtask is not stamped');

  const grouped = c.tasksBySection(c.state.tasks);
  assert.deepEqual(grouped.find(x => x.id === 's1').tasks.map(t => t.id), ['p', 'kid'],
    'the subtree groups under the chosen section');
});

test('V2.6 multi-select assignment de-duplicates a parent and its own child to one move', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [
    activeTask(c, { id:'p', sectionId:null }),
    activeTask(c, { id:'kid', parentId:'p', sectionId:null }),
    activeTask(c, { id:'other', sectionId:null }),
  ];
  c.setTaskSectionMulti(['p', 'kid', 'other'], 's2');
  assert.equal(c.state.tasks.find(t => t.id === 'p').sectionId, 's2');
  assert.equal(c.state.tasks.find(t => t.id === 'other').sectionId, 's2');
  assert.equal(c.state.tasks.find(t => t.id === 'kid').sectionId, null, 'child rides along via its root');
});

test('V2.6 collapse removes rows from the FLATTENED list, not just from the paint', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.groupBy = 'section';
  const tasks = [
    activeTask(c, { id:'a', sectionId:'s1' }),
    activeTask(c, { id:'b', sectionId:'s2' }),
  ];

  let proj = c.sectionProjection(tasks);
  assert.deepEqual(c.flattenSections(proj).map(t => t.id), ['a', 'b']);
  assert.equal(proj.every(s => s.collapsed === false), true);

  c.toggleSectionCollapse('s1');
  proj = c.sectionProjection(tasks);
  assert.equal(proj.find(s => s.id === 's1').collapsed, true, 'the flag is stamped on the projection');
  assert.deepEqual(c.flattenSections(proj).map(t => t.id), ['b'],
    '_yTop is indexed by this list, so a collapsed row must leave it or every bar below shifts');
  assert.equal(proj.find(s => s.id === 's1').tasks.length, 1, 'the header still knows its count');

  c.toggleSectionCollapse('s1');
  assert.deepEqual(c.flattenSections(c.sectionProjection(tasks)).map(t => t.id), ['a', 'b'], 'toggles back');
});

test('V2.6 REGRESSION: a collapsed section keeps its true task count', () => {
  /* The panes receive _visTasks, which flattenSections has already stripped of collapsed rows. Re-projecting
     that list showed a collapsed section as "0" in its own header. The projection must be built from the
     UNFILTERED list and then cached, not rebuilt from the flattened one. */
  const c = make();
  c.state.sections = secs(c);
  c.state.groupBy = 'section';
  const tasks = [
    activeTask(c, { id:'a', sectionId:'s1' }),
    activeTask(c, { id:'b', sectionId:'s1' }),
    activeTask(c, { id:'z', sectionId:'s2' }),
  ];
  c.toggleSectionCollapse('s1');

  const proj = c.sectionProjection(tasks);
  assert.equal(proj.find(s => s.id === 's1').tasks.length, 2, 'the header still reports 2, not 0');

  const flat = c.flattenSections(proj);
  assert.deepEqual(flat.map(t => t.id), ['z'], 'but the collapsed rows are gone from the flat list');
  /* the bug was re-projecting `flat`: */
  const reprojected = c.sectionProjection(flat);
  assert.equal(reprojected.find(s => s.id === 's1').tasks.length, 0,
    'documents WHY the panes must not re-project the flattened list');
});

test('V2.6 collapse state persists to prefs and keys the null No-section bucket stably', () => {
  const c = make();
  c.toggleSectionCollapse(null);
  assert.equal(c.isSectionCollapsed(null), true, 'No section can collapse despite a null id');
  assert.equal(JSON.parse(c.lsGet('pp-prefs') || '{}').collapsedSections['__none'], 1, 'persisted under a stable key');
  c.toggleSectionCollapse(null);
  assert.equal(c.isSectionCollapsed(null), false);
});

test('V2.6 inline rename commits a trimmed name and ignores an empty one', () => {
  const c = make();
  c.state.sections = secs(c);
  c.startSectionEdit('s1');
  assert.equal(c.state.secEdit, 's1');

  c.commitSectionEdit('s1', '  Deep work  ');
  assert.equal(c.state.sections.find(s => s.id === 's1').name, 'Deep work', 'trimmed');
  assert.equal(c.state.secEdit, null, 'edit mode closes');

  c.commitSectionEdit('s1', '   ');
  assert.equal(c.state.sections.find(s => s.id === 's1').name, 'Deep work', 'blank is refused, old name kept');
});

test('V2.6 Group by: None yields one flat, header-less band containing every task', () => {
  const c = make();
  c.state.sections = secs(c);
  const tasks = [
    activeTask(c, { id:'a', sectionId:'s1' }),
    activeTask(c, { id:'b', sectionId:null }),
  ];

  c.state.groupBy = 'section';
  /* s1 (has 'a'), s2 (declared, empty), No section (has 'b') */
  assert.equal(c.sectionProjection(tasks).length, 3, 'grouped: a band per section plus No section');

  c.state.groupBy = 'none';
  const flat = c.sectionProjection(tasks);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].flat, true, 'the flag both panes read to skip TAG_SECTION_H in lock-step');
  assert.deepEqual(flat[0].tasks.map(t => t.id), ['a', 'b']);
});

/* ---- V2.6b: drag. Sections were reorderable only by ▲▼, and a task could only change section through the
   row menu — so an EMPTY section was a place nothing could be put, which is the one thing a freshly created
   section always is. Both gaps come down to the same missing fact: _yTop is indexed by TASKS, so it cannot
   answer "which section owns this Y" and an empty section owns Y-space but no row. _secLayout supplies it. */

/* Mirrors what renderGantt builds: header band + rows, per section, in paint order. */
const layout = c => {
  const H = c.TAG_SECTION_H, R = c.rowH;
  return [
    { id:'s1', top:0,        headerBottom:H,        bottom:H + 2*R, firstIndex:0, endIndex:2, collapsed:false },
    { id:'s2', top:H + 2*R,  headerBottom:2*H+2*R,  bottom:2*H+2*R, firstIndex:2, endIndex:2, collapsed:false },
    { id:null, top:2*H+2*R,  headerBottom:3*H+2*R,  bottom:3*H+3*R, firstIndex:2, endIndex:3, collapsed:false },
  ];
};

test('V2.6b sectionAtY resolves a drop inside an EMPTY section, which has no task row to target', () => {
  const c = make(); const L = layout(c); const H = c.TAG_SECTION_H, R = c.rowH;

  assert.equal(c.sectionAtY(L, 5).id, 's1', 'inside s1 header');
  assert.equal(c.sectionAtY(L, H + R + 1).id, 's1', 'over s1 second row');
  /* s2 is declared but empty: its band is exactly its header, and it must still be a valid drop target */
  assert.equal(c.sectionAtY(L, H + 2*R + 2).id, 's2');
  assert.equal(c.sectionAtY(L, 2*H + 2*R + 4).id, null, 'No section');
});

test('V2.6b sectionAtY clamps past both ends rather than returning null', () => {
  const c = make(); const L = layout(c);
  assert.equal(c.sectionAtY(L, -50).id, 's1', 'overshooting upward still lands somewhere');
  assert.equal(c.sectionAtY(L, 99999).id, null, 'overshooting downward lands in the last band');
  assert.equal(c.sectionAtY([], 10), null, 'Group by: None has no bands, so no section drop');
});

test('V2.6b secDropIndex never orders a section after No section', () => {
  const c = make(); const L = layout(c);
  assert.equal(c.secDropIndex(L, 2), 0, 'in s1 → slot 0');
  assert.equal(c.secDropIndex(L, c.TAG_SECTION_H + 2*c.rowH + 2), 1, 'in s2 → slot 1');
  /* dropping over the No-section band clamps to the last DECLARED slot: No section is always last */
  assert.equal(c.secDropIndex(L, 99999), 1);
  assert.equal(c.secDropIndex([], 10), 0);
});

test('V2.6b dragging a section onto another swaps them via reorderSectionsIn', () => {
  const c = make();
  c.state.sections = secs(c);
  /* the band the cursor is in IS the target slot, because reorderSectionsIn removes then inserts */
  const moved = c.reorderSectionsIn(c.state.sections, 's1', 1);
  assert.deepEqual(moved.map(s => s.id), ['s2', 's1']);
  assert.deepEqual(moved.map(s => s.order), [0, 1], 'order renumbered densely');
});

test('V2.6b a row drag into a section stamps sectionId in the SAME commit as the reorder', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [activeTask(c, { id:'a', sectionId:'s1' }), activeTask(c, { id:'b', sectionId:'s1' })];
  c._visTasks = c.state.tasks.slice();
  const before = c.history.length;

  c.reorderRows(['a'], 2, undefined, 's2');
  assert.equal(c.state.tasks.find(t => t.id === 'a').sectionId, 's2', 'dropped into the empty section');
  assert.equal(c.state.tasks.find(t => t.id === 'b').sectionId, 's1', 'untouched row keeps its section');
  assert.equal(c.history.length, before + 1, 'one drag is ONE undo step, not a reorder plus a re-section');
});

test('V2.6b sectionId undefined leaves sections alone; null really means No section', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [activeTask(c, { id:'a', sectionId:'s1' })];
  c._visTasks = c.state.tasks.slice();

  c.reorderRows(['a'], 0, undefined, undefined);
  assert.equal(c.state.tasks.find(t => t.id === 'a').sectionId, 's1', 'a plain reorder is not a re-section');

  c.reorderRows(['a'], 0, undefined, null);
  assert.equal(c.state.tasks.find(t => t.id === 'a').sectionId, null, 'null is a real value, not "unset"');
});

test('V2.6b a NESTED drop does not stamp sectionId — the root owns the section', () => {
  const c = make();
  c.state.sections = secs(c);
  c.state.tasks = [activeTask(c, { id:'p', sectionId:'s1' }), activeTask(c, { id:'x', sectionId:'s1' })];
  c._visTasks = c.state.tasks.slice();

  /* drag x under p: reparent wins, and stamping x would write a field tasksBySection never reads */
  c.reorderRows(['x'], 1, 'p', 's2');
  const got = c.state.tasks.find(t => t.id === 'x');
  assert.equal(got.parentId, 'p');
  assert.equal(got.sectionId, 's1', 'unchanged: only roots carry a section');
});

/* ---- The bottom-most slot of a section. Owner report: "a task cannot be dragged to become the bottom-most
   task in a section — it is currently impossible entirely."
   Root cause: a gap index is SHARED by the band that ends there and the band that starts there, so resolving
   the index and the section as two independent passes gave "after the last row of S" no representation of its
   own. resolveRowInsert resolves index + section + `atEnd` in one pass, and clamps the index into the band the
   cursor is in — which is also what makes an empty or collapsed band stop borrowing a neighbour's index. */

/* Real geometry, built by sectionGeometry itself rather than by hand, so the fixture cannot drift from the
   layout both panes actually paint: s1 (2 rows) · sEmpty (declared, 0 rows) · s2 (2 rows) · No section (1). */
const geo = c => {
  const T = n => ({ id:n });
  const bands = [
    { id:'s1',     name:'Research', tasks:[T('a1'), T('a2')] },
    { id:'sEmpty', name:'Empty',    tasks:[] },
    { id:'s2',     name:'Admin',    tasks:[T('b1'), T('b2')] },
    { id:null,     name:'No section', tasks:[T('n1')] },
  ];
  const g = c.sectionGeometry(bands);
  return { g, count:5, H:c.TAG_SECTION_H, R:c.rowH };
};
const at = (c, y) => { const { g, count } = geo(c); return c.resolveRowInsert(y, g.yTop, g.secLayout, count); };

test('bottom-of-section: dropping below the last row of a MIDDLE section resolves to that section, atEnd', () => {
  const c = make(); const { H, R } = geo(c);
  const r = at(c, H + 2*R - 1); /* lower half of s1's last row */
  assert.equal(r.sectionId, 's1');
  assert.equal(r.index, 2, 'the gap after s1\'s last row');
  assert.equal(r.atEnd, true, 'the slot that had no representation before');
  assert.equal(r.bandEmpty, false);
});

test('bottom-of-section: it is DISTINCT from the top of the next section, which shares its index', () => {
  const c = make(); const { H, R } = geo(c);
  const bottomOfS1 = at(c, H + 2*R - 1);
  const topOfEmpty = at(c, H + 2*R + 2); /* one band down: same integer, different place */
  assert.equal(bottomOfS1.index, topOfEmpty.index, 'the two positions really are the same gap index');
  assert.notEqual(bottomOfS1.sectionId, topOfEmpty.sectionId, '...and were therefore indistinguishable');
  assert.equal(topOfEmpty.atEnd, false, 'only the flag separates them');
});

test('bottom-of-section: the LAST section\'s bottom row resolves to the end of the visible list', () => {
  const c = make(); const { H, R, count } = { ...geo(c), ...{} };
  const r = at(c, 4*H + 5*R - 1); /* lower half of the No-section bucket\'s only row */
  assert.equal(r.sectionId, null, 'No section is the last bucket');
  assert.equal(r.index, 5);
  assert.equal(r.index, count, 'past every visible row');
  assert.equal(r.atEnd, true);
});

test('bottom-of-section: the boundary between the last DECLARED section and No section', () => {
  const c = make(); const { H, R } = geo(c);
  const bottomOfS2 = at(c, 3*H + 4*R - 1);
  assert.deepEqual([bottomOfS2.sectionId, bottomOfS2.index, bottomOfS2.atEnd], ['s2', 4, true],
    'bottom-most in s2, even though index 4 is also No section\'s first row');
  const topOfNone = at(c, 3*H + 4*R + 2);
  assert.deepEqual([topOfNone.sectionId, topOfNone.index, topOfNone.atEnd], [null, 4, false],
    'No section is a valid drop target but nothing is ordered AFTER it as a section');
});

test('bottom-of-section: a declared-but-EMPTY section clamps to its own gap and paints no row rule', () => {
  const c = make(); const { H, R } = geo(c);
  const r = at(c, H + 2*R + 5); /* inside sEmpty\'s header — its whole band */
  assert.equal(r.sectionId, 'sEmpty');
  assert.equal(r.index, 2, 'clamped into the band, never borrowing a neighbour\'s index');
  assert.equal(r.bandEmpty, true, 'no visible row, so the band highlight is the only possible feedback');
  assert.equal(r.atEnd, false, 'atEnd would put the rule on the PREVIOUS section\'s last row');
});

test('bottom-of-section: a COLLAPSED section behaves like an empty one and cannot steal a neighbour index', () => {
  const c = make();
  const g = c.sectionGeometry([
    { id:'s1', name:'Research', tasks:[{ id:'a1' }, { id:'a2' }] },
    { id:'s2', name:'Admin', tasks:[{ id:'b1' }], collapsed:true },
    { id:null, name:'No section', tasks:[{ id:'n1' }] },
  ]);
  const H = c.TAG_SECTION_H, R = c.rowH;
  /* s2 is collapsed: header only, and its one row is NOT in yTop, so the visible count is 3 */
  const r = c.resolveRowInsert(H + 2*R + 5, g.yTop, g.secLayout, 3);
  assert.equal(r.sectionId, 's2');
  assert.equal(r.index, 2);
  assert.equal(r.bandEmpty, true);
});

test('bottom-of-section: Group by: None has no bands, so the drop resolves an index and no section', () => {
  const c = make();
  const g = c.sectionGeometry([{ id:null, name:'', flat:true, tasks:[{ id:'a' }, { id:'b' }] }]);
  assert.equal(g.secLayout.length, 0, 'a flat band emits no layout at all');
  const mid = c.resolveRowInsert(c.rowH * 0.4, g.yTop, g.secLayout, 2);
  assert.equal(mid.sectionId, undefined, 'undefined means "leave sectionId alone", never null');
  assert.equal(mid.sectionPos, null);
  assert.equal(mid.atEnd, false);
  const end = c.resolveRowInsert(c.rowH * 2 - 1, g.yTop, g.secLayout, 2);
  assert.deepEqual([end.index, end.atEnd], [2, true], 'the end of a flat list is still an end slot');
});

test('bottom-of-section: the resolved slot really lands the row bottom-most, through reorderRows', () => {
  const c = make();
  c.state.sections = [c.normalizeSection({ id:'s1', name:'Research', order:0 }),
                      c.normalizeSection({ id:'s2', name:'Admin', order:1 })];
  c.state.tasks = [activeTask(c, { id:'a1', sectionId:'s1' }), activeTask(c, { id:'a2', sectionId:'s1' }),
                   activeTask(c, { id:'b1', sectionId:'s2' })];
  c._visTasks = c.state.tasks.slice();
  const before = c.history.length;

  /* the drop resolved above for "below s1's last row": index 2, section s1 */
  c.reorderRows(['b1'], 2, null, 's1');
  const ids = c.tasksBySection(c.state.tasks).find(s => s.id === 's1').tasks.map(t => t.id);
  assert.deepEqual(ids, ['a1', 'a2', 'b1'], 'bottom-most in s1, not first in s2');
  assert.equal(c.history.length, before + 1, 'still one undo step');
});
