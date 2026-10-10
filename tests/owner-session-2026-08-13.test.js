// Owner session, 2026-08-13. Four reports from hands-on use of the production build, plus one
// documentation answer that needed no code. Each block below states the report verbatim, because in three
// of the four cases the defect was invisible to the existing suite for a reason worth keeping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, DAY } = require('./_load.js');

const styleOf = n => (n && n.props && n.props.style) || {};

// The component runs in a vm realm, so an array it CREATES is not `instanceof` this realm's Array and
// assert.deepEqual fails on the prototype alone — the trap the status notes records from the block that was cut
// off mid-flight. Copy into a host array before comparing anything the component built.
const host = a => [].concat(a == null ? [] : Array.prototype.slice.call(a));

// runOnceMigrations already ran once inside the constructor (index.html line ~641), so every flag is
// already set on a fresh `make()`. A migration test must clear the flag it means to exercise, or it
// silently asserts against a no-op.
const onlyFlags = (c, flags) => { try { c.lsSet('pp-migrations', JSON.stringify(flags || {})); } catch (e) {} };

// Walk a rendered tree for the first node satisfying `pred`. The mocked React nests children as arrays.
function find(node, pred) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = find(n, pred); if (r) return r; } return null; }
  if (pred(node)) return node;
  return find(node.children, pred);
}
function findAll(node, pred, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (pred(node)) out.push(node);
  return findAll(node.children, pred, out);
}
const attr = (n, k) => (n && n.props && n.props[k]);
const text = n => [].concat((n && n.children) || []).filter(x => typeof x === 'string' || typeof x === 'number').join('');

// ===========================================================================================
// (2) "When a task is deleted from ChronoCompose, it should be deleted from the calendar too.
//      I deleted two tasks from the ChronoCompose calendar, and it came back after a few minutes."
//
// Root cause: `gcalTwoWay` defaults to FALSE, and gcalSyncOut returned on that flag before computing any
// op at all. So a delete queued no remote DELETE *and* — because the tombstone is written inside
// gcalEnqueue — recorded nothing locally either. The next silent gcalImport found a live Google event
// with no local task and no tombstone, and re-created it. A few minutes later, exactly as reported.
//
// Why the suite was blind: every existing outbound test sets gcalTwoWay:true first, because that is the
// interesting case for edits. Nothing asserted what happens in the DEFAULT configuration, which is the
// one every user is actually in.
// ===========================================================================================

function twoWay(c, on) {
  c.state.settings = Object.assign({}, c.state.settings, { gcalTwoWay: !!on });
}
const linked = (c, over) => activeTask(c, Object.assign({ eventId: 'ev1', calendarId: 'cal1' }, over || {}));

test('a DELETE reaches the queue with two-way sync OFF — the default every user is in', () => {
  const c = make();
  twoWay(c, false);
  const t = linked(c, { id: 'd1', name: 'gone' });
  c.gcalSyncOut([t], []);

  const q = c.loadQueue();
  assert.equal(q.length, 1, 'the delete is queued despite gcalTwoWay:false');
  assert.equal(q[0].op, 'delete');
  assert.equal(q[0].eventId, 'ev1');
  assert.equal(q[0].calendarId, 'cal1');
});

test('and the TOMBSTONE is written, which is what actually stops the resurrection', () => {
  const c = make();
  twoWay(c, false);
  const t = linked(c, { id: 'd2', name: 'gone' });
  c.gcalSyncOut([t], []);

  const tomb = c.loadTombstones();
  assert.ok(tomb['ev1'] > 0, 'the deleted event id is tombstoned');

  // The exact resurrection the owner saw: a silent import re-reads the still-live Google event.
  const tasks = [];
  const ev = { id: 'ev1', summary: 'gone', start: { dateTime: new Date(Date.now()).toISOString() },
    end: { dateTime: new Date(Date.now() + 3600000).toISOString() } };
  const r = c.mergeCalendarEvents(tasks, [{ cid: 'cal1', items: [ev] }], {}, { cal1: { id: 'cal1', summary: 'ChronoCompose' } }, tomb);
  assert.equal(r.added, 0, 'the tombstone suppresses the re-import');
  assert.equal(tasks.length, 0, 'the task stays deleted');

  // Control: without the tombstone it comes straight back — proving the fixture reproduces the bug.
  const tasks2 = [];
  const r2 = c.mergeCalendarEvents(tasks2, [{ cid: 'cal1', items: [ev] }], {}, { cal1: { id: 'cal1', summary: 'ChronoCompose' } }, {});
  assert.equal(r2.added, 1, 'with no tombstone the event resurrects — this is what the owner saw');
});

test('the retired two-way OFF value cannot gate an edit after Calendar becomes two-way only', () => {
  const c = make();
  twoWay(c, false);
  const before = linked(c, { id: 'e1', name: 'old' });
  const after = Object.assign(JSON.parse(JSON.stringify(before)), { name: 'renamed', updatedAt: Date.now() + 1 });
  c.gcalSyncOut([before], [after]);
  assert.equal(c.loadQueue().length, 1, 'old persisted settings are inert; the edit queues');
  assert.equal(c.loadQueue()[0].op, 'patch');
});

test('the retired two-way ON value is equally inert and edits still push', () => {
  const c = make();
  twoWay(c, true);
  const before = linked(c, { id: 'e2', name: 'old' });
  const after = Object.assign(JSON.parse(JSON.stringify(before)), { name: 'renamed', updatedAt: Date.now() + 1 });
  c.gcalSyncOut([before], [after]);
  const q = c.loadQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].op, 'patch');
});

test('an UNLINKED task deleted with two-way off queues nothing and tombstones nothing', () => {
  const c = make();
  twoWay(c, false);
  const t = activeTask(c, { id: 'manual', name: 'never synced' }); // no eventId
  c.gcalSyncOut([t], []);
  assert.equal(c.loadQueue().length, 0, 'cancelInsert drops the pending insert; nothing to send');
  assert.deepEqual(c.loadTombstones(), {}, 'and nothing to tombstone — it never reached Google');
});

test('isGcalDeleteOp names the legacy ops that may cross the queue-generation boundary', () => {
  const c = make();
  ['delete', 'deleteInstance', 'cancelInsert'].forEach(op =>
    assert.equal(c.isGcalDeleteOp({ op }), true, op + ' remains safe to drain from a legacy queue'));
  ['insert', 'patch', 'patchInstance'].forEach(op =>
    assert.equal(c.isGcalDeleteOp({ op }), false, op + ' does not'));
});

// ===========================================================================================
// (1) "When a task has its timer running, do not highlight that task, just let the pause/play
//      indicator do the work."
//
// Same argument the pressed depth lost on 2026-08-12, applied to the channel that was exempted from it.
// Asserted on BOTH surfaces because V2.11 card↔row parity means dropping it on one only would put them
// back out of step — which is precisely how the 2026-08-12 change left this state behind.
// ===========================================================================================

test('a running task gets no ring and no wash on the sheet row OR the plan card', () => {
  const c = make();
  const B = c.startOfToday();
  const run = activeTask(c, { id: 'r1', name: 'running', start: B, end: B + DAY, included: true, planned: 60 });
  const idle = activeTask(c, { id: 'r2', name: 'idle', start: B, end: B + DAY, included: true, planned: 60 });
  c.state.tasks = [run, idle];
  c.renderVals();
  c.startTimer('r1');
  const running = c.state.tasks.find(t => t.id === 'r1');

  assert.equal(c.inclState(running), 'active', 'the bucket survives — only the paint is gone');

  // Sheet row: same index for both, so the striping is identical and any difference is the retired paint.
  const rs = styleOf(c.sheetRow(running, 0, c.state.cols || [], 400, c._byId || {}));
  const is = styleOf(c.sheetRow(idle, 0, c.state.cols || [], 400, c._byId || {}));
  assert.strictEqual(String(rs.background), String(is.background), 'row: no accent wash');
  assert.strictEqual(String(rs.boxShadow || 'none'), String(is.boxShadow || 'none'), 'row: no accent ring');

  // Plan card.
  const rc = styleOf(c.planCard(running));
  const ic = styleOf(c.planCard(idle));
  assert.strictEqual(String(rc.boxShadow), String(ic.boxShadow), 'card: parity holds — no ring here either');
});

test('the running state is still fully legible, because the timer control carries it', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id: 'r3', start: B, end: B + DAY, included: true, planned: 60 });
  c.state.tasks = [t]; c.renderVals();

  assert.strictEqual([].concat(c.taskTimerBtn(c.state.tasks[0]).children).join(''), '▶', 'stopped reads play');
  c.startTimer('r3');
  assert.strictEqual([].concat(c.taskTimerBtn(c.state.tasks[0]).children).join(''), '■', 'running reads stop');
});

// ===========================================================================================
// (5) "In the Overview page, there are instances where say I'll have 12 included tasks in a column.
//      I won't be able to even see the excluded tasks at all. I should always be able to see both
//      included and excluded, and they should be given about the same amount of scroll."
//
// THE DEFECT WAS NOT IN THE ARITHMETIC. `selectionSplitHeights` applied a SEL_HALF_MIN_PX floor and was
// unit-tested, so it stayed green throughout. But that function is only a JS MIRROR of the layout — the
// thing that renders is flexbox, and the `half` renderer carried `minHeight:0`, which not only omitted
// the floor but also disabled flexbox's own automatic min-content floor. So the Excluded half shrank to
// literally 0px on screen while the mirror said 72.
//
// The lesson is the repo's own recurring one (tasksByTagSection, the two _yTop call sites): a pure
// function asserted in isolation proves nothing about the surface unless something also asserts that the
// surface consumes it. Hence the first test here reads the RENDERED style.
// ===========================================================================================

/* PP-EXT (owner 2026-08-20): the rendered-floor test that lived here is RETIRED with its subject. The
   Selection view's Included/Excluded halves are gone — the five-bucket partition replaced the vertical
   dimension outright, so there is no half to floor and `data-selhalf` no longer exists. The lesson the
   test recorded is NOT retired and is worth keeping in view: a pure function asserted in isolation proves
   nothing about a surface unless something also asserts that the surface consumes it. The equivalent
   guard for the new surface is in tests/v2-plan-tab.test.js ("the width floor and the renderer agree on
   which columns exist"), which pins selectionCols against the rendered grid. */

/* PP-EXT (owner 2026-08-20): the four band-sizing tests that lived here are RETIRED with their subject.
   `selectionSplitHeights` and its SEL_* constants are gone — Task 8 deleted the Included/Excluded halves
   along with the arithmetic that balanced them. See the note at the top of tests/v5-selection-ux.test.js
   for what carried forward. */

const focusRowIds = c => findAll(c.renderDashFocus(c.state.tasks), n => attr(n, 'data-task-id')).map(n => attr(n, 'data-task-id'));

function focusCol(c) {
  const view = c.renderDashFocus(c.state.tasks);
  return find(view, n => find(n, x => attr(x, 'data-task-id')) || attr(n, 'data-task-id')) ? view : view;
}

function focusFixture(c) {
  const B = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'fi1', name: 'in one', start: B, end: B + DAY, included: true, planned: 30 }),
    activeTask(c, { id: 'fi2', name: 'in two', start: B, end: B + DAY, included: true, planned: 30 }),
    activeTask(c, { id: 'fo1', name: 'out one', start: B, end: B + DAY, included: null, snoozeUntil: B + DAY, planned: 30 }),
  ];
  c.renderVals();
}

test('Focus hides the not-in-today tasks by default, but always states how many there are', () => {
  const c = make();
  focusFixture(c);
  const ids = focusRowIds(c);
  assert.ok(ids.includes('fi1') && ids.includes('fi2'), 'included work is listed');
  assert.equal(ids.includes('fo1'), false, 'excluded work is collapsed by default');

  const band = find(c.renderDashFocus(c.state.tasks), n => /Not in today/.test(text(n) || '') || findAll(n, x => text(x) === 'Not in today').length > 0);
  assert.ok(band, 'the separator band renders');
  const labels = findAll(c.renderDashFocus(c.state.tasks), n => text(n) === 'Not in today');
  assert.equal(labels.length, 1, 'exactly one separator, not one per section');
});

test('expanding the band reveals them, and included work always sorts above it', () => {
  const c = make();
  focusFixture(c);
  c.setState({ focusExclOpen: true });
  const ids = focusRowIds(c);
  assert.ok(ids.includes('fo1'), 'excluded work appears when expanded');
  assert.ok(ids.indexOf('fi1') < ids.indexOf('fo1'), 'included ones are at the top');
  assert.ok(ids.indexOf('fi2') < ids.indexOf('fo1'));
});

test('the band disappears entirely when nothing is excluded — no empty divider', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [activeTask(c, { id: 'only', start: B, end: B + DAY, included: true, planned: 30 })];
  c.renderVals();
  assert.equal(findAll(c.renderDashFocus(c.state.tasks), n => text(n) === 'Not in today').length, 0);
});

test('Focus reuses inclBand, so it cannot invent a fifth opinion about "in today"', () => {
  const c = make();
  focusFixture(c);
  c.setState({ focusExclOpen: true });
  const ids = focusRowIds(c);
  const expectIn = c.state.tasks.filter(t => c.inclBand(t) === 'included').map(t => t.id);
  const expectOut = c.state.tasks.filter(t => c.inclBand(t) !== 'included').map(t => t.id);
  expectIn.forEach(id => assert.ok(ids.indexOf(id) >= 0));
  // Every included id precedes every excluded id — the division IS inclBand's.
  expectIn.forEach(i => expectOut.forEach(o => assert.ok(ids.indexOf(i) < ids.indexOf(o), i + ' before ' + o)));
});

test('sections survive for INCLUDED and are not duplicated under the excluded band', () => {
  const c = make();
  const B = c.startOfToday();
  const secs = [c.normalizeSection({ name: 'research', order: 0 })];
  try { c.lsSet('pp-sections', JSON.stringify(secs)); } catch (e) {}
  c.state.sections = secs;
  c.state.tasks = [
    activeTask(c, { id: 's1', name: 'in', start: B, end: B + DAY, included: true, planned: 30, sectionId: secs[0].id }),
    activeTask(c, { id: 's2', name: 'out', start: B, end: B + DAY, included: null, snoozeUntil: B + DAY, planned: 30, sectionId: secs[0].id }),
  ];
  c.renderVals();
  c.setState({ focusExclOpen: true, groupBy: 'section' });
  const heads = findAll(c.renderDashFocus(c.state.tasks), n => text(n) === 'research');
  assert.ok(heads.length <= 1,
    'a section holding both included and excluded work must not print its header twice (V2.9 §6)');
});

// ===========================================================================================
// (6) "Sections should not be a tag."  (retroactive half — the forward half is in v2-sections.test.js)
// ===========================================================================================

test('strip-section-tags re-sweeps a workspace that already ran the OLD V2.6 migration', () => {
  const c = make();
  const secs = [c.normalizeSection({ name: 'work', order: 0 })];
  try { c.lsSet('pp-sections', JSON.stringify(secs)); } catch (e) {}
  // Exactly the state the old migration left behind: sectioned AND still tagged.
  const tasks = [
    activeTask(c, { id: 'w1', labels: ['work', 'deep'], sectionId: secs[0].id }),
    activeTask(c, { id: 'w2', labels: ['work'], sectionId: secs[0].id }),
  ];
  // Pretend the V2.6 flag is already set — which it is, in every real workspace.
  onlyFlags(c, { 'sections-from-primary-tag': 1 });

  c.runOnceMigrations(tasks);

  assert.deepEqual(tasks[0].labels, ['deep'], 'the redundant section tag is gone, other labels stay');
  assert.deepEqual(tasks[1].labels, []);
  assert.ok(tasks.every(t => t.sectionId === secs[0].id), 'and the sections themselves are untouched');

  const done = JSON.parse(c.lsGet('pp-migrations') || '{}');
  assert.equal(done['strip-section-tags'], 1, 'the flag is recorded');
  assert.equal(done['sections-from-primary-tag'], 1, 'and the old flag is NOT reset — sections the user deleted stay deleted');
});

// ===========================================================================================
// (7) "The ChronoCompose calendar should be implicit. Like that name should be reserved, and pull into
//      the regular task pool without that calendar tag."
//
// Same principle as (6) one report later: a container's name is not one of the user's tags. An external
// calendar's tag carries real information — which calendar this came from — so those keep theirs. Ours
// carries none: every task in it is a ChronoCompose task by definition.
// ===========================================================================================

const CC = { id: 'cc1', summary: 'ChronoCompose' };
const EXT = { id: 'x1', summary: 'Team Standups' };
const evAt = (id, ms) => ({ id, summary: id, start: { dateTime: new Date(ms).toISOString() },
  end: { dateTime: new Date(ms + 3600000).toISOString() } });

// SUPERSEDED 2026-08-14: this test's second half ("every other calendar keeps its own") is the exact claim
// the owner withdrew — see tests/owner-session-2026-08-14.test.js, which now owns the calTag contract.
// Kept here only for `isOwnCalendar`, which is still live and still matches case/whitespace-insensitively
// because `gcalEnsureCalendar` adopts by summary.
test('isOwnCalendar still recognises the reserved name, case and whitespace insensitively', () => {
  const c = make();
  assert.equal(c.isOwnCalendar(CC), true);
  assert.equal(c.isOwnCalendar({ summary: '  chronocompose ' }), true,
    'reserved means reserved — case and whitespace do not create a second one');
  assert.equal(c.isOwnCalendar(EXT), false);
});

test('importing from our own calendar lands an UNTAGGED task in the regular pool', () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars: [CC], ccCalId: 'cc1' });
  const tasks = [];
  const now = c.startOfToday() + 9 * 3600000;
  c.mergeCalendarEvents(tasks, [{ cid: 'cc1', items: [evAt('e1', now)] }], {}, { cc1: CC }, {});
  assert.equal(tasks.length, 1);
  assert.deepEqual(host(tasks[0].labels), [], 'no @chronocompose');
  assert.equal(tasks[0].calendarId, 'cc1', 'but the link itself is intact, so sync still works');
  assert.equal(c.calNameOf(tasks[0]), 'ChronoCompose',
    'and it still sorts/filters by calendar — only the TAG is implicit, not the provenance');
});

test('the Calendar column names our calendar even before the calendar LIST has loaded', () => {
  const c = make();
  // Offline / signed out / mid-restore: no `calendars`, but ccCalId is persisted. Before this session the
  // @chronocompose tag was what rescued this fallback; removing the tag exposed a raw Google id here.
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars: [], ccCalId: 'cc1' });
  const t = activeTask(c, { id: 'n1', labels: [], calendarId: 'cc1', eventId: 'e1' });
  assert.equal(c.calNameOf(t), 'ChronoCompose', 'the reserved name is knowable without the network');
  const x = activeTask(c, { id: 'n2', labels: [], calendarId: 'zz', eventId: 'e2' });
  assert.equal(c.calNameOf(x), 'zz', 'an unknown external calendar is unchanged — still its id');
});

test('a RE-import never re-adds the tag — this is the churn loop the guard exists to stop', () => {
  const c = make();
  const now = c.startOfToday() + 9 * 3600000;
  const tasks = [];
  c.mergeCalendarEvents(tasks, [{ cid: 'cc1', items: [evAt('e1', now)] }], {}, { cc1: CC }, {});
  c.mergeCalendarEvents(tasks, [{ cid: 'cc1', items: [evAt('e1', now)] }], {}, { cc1: CC }, {});
  assert.equal(tasks.length, 1, 'still one task');
  assert.deepEqual(host(tasks[0].labels), [], 'still untagged after a second import');
});

// RETIRED CONTRACT (owner 2026-08-14, "get rid of the calendar tags"): "external provenance is real
// information" was the 2026-08-13 argument for keeping external tags, and the owner withdrew it —
// provenance is not the user's vocabulary and is fully recoverable from `t.calendarId`. The replacement
// assertion is its exact inverse, and it lives here rather than being deleted so the reversal is legible.
test('an external calendar tags on NEITHER first import nor re-import', () => {
  const c = make();
  const now = c.startOfToday() + 9 * 3600000;
  const tasks = [];
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e9', now)] }], {}, { x1: EXT }, {});
  assert.deepEqual(host(tasks[0].labels), [], 'no tag on first import');
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e9', now)] }], {}, { x1: EXT }, {});
  assert.deepEqual(host(tasks[0].labels), [], 'and none re-added — there is no re-add half any more');
  assert.equal(c.calNameOf(tasks[0]), 'x1',
    'provenance survives on calendarId, which is what calNameOf reads');
});

test('implicit-own-calendar-tag migration strips the tag every past import stamped on', () => {
  const c = make();
  const tasks = [
    activeTask(c, { id: 'o1', labels: ['chronocompose', 'urgent'], calendarId: 'cc1', eventId: 'e1' }),
    activeTask(c, { id: 'o2', labels: ['chronocompose'], calendarId: 'cc1', eventId: 'e2' }),
    activeTask(c, { id: 'o3', labels: ['team-standups'], calendarId: 'x1', eventId: 'e3' }),
  ];
  onlyFlags(c, {});
  c.runOnceMigrations(tasks);
  assert.deepEqual(tasks[0].labels, ['urgent'], 'the reserved tag goes, real tags stay');
  assert.deepEqual(tasks[1].labels, []);
  assert.deepEqual(tasks[2].labels, ['team-standups'], 'another calendar\'s tag is untouched');
  assert.equal(JSON.parse(c.lsGet('pp-migrations') || '{}')['implicit-own-calendar-tag'], 1);
  assert.equal(c.stripOwnCalendarTag(tasks), 0, 'and it is idempotent');
});

test('the reserved name has ONE definition — the constant, not a string literal', () => {
  const c = make();
  assert.equal(c.GCAL_OWN_CAL_NAME, 'ChronoCompose');
  assert.equal(c.calTagFor(c.GCAL_OWN_CAL_NAME), 'chronocompose',
    'calTagFor sees through the suppression, which is what the migration matches on');
  assert.equal(c.calTag({ summary: c.GCAL_OWN_CAL_NAME }), '', 'while calTag suppresses it — as it now does for every calendar');
});

test('the strip is a separate flag, so it never re-promotes tags into sections', () => {
  const c = make();
  try { c.lsSet('pp-sections', JSON.stringify([])); } catch (e) {}
  onlyFlags(c, { 'sections-from-primary-tag': 1 });
  // A user who ran V2.6, then deliberately deleted every section. Their tags must NOT rebuild them.
  const tasks = [
    activeTask(c, { id: 'a', labels: ['work'], sectionId: null }),
    activeTask(c, { id: 'b', labels: ['work'], sectionId: null }),
  ];
  c.runOnceMigrations(tasks);
  assert.deepEqual(tasks.map(t => t.labels), [['work'], ['work']],
    'no section means no redundancy — the tags are still doing a tag\'s job');
  assert.deepEqual(JSON.parse(c.lsGet('pp-sections') || '[]'), [], 'and no section is resurrected');
});
