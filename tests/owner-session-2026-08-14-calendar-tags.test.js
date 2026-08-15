// Owner session, 2026-08-14. One report: "get rid of the calendar tags."
//
// This reverses a decision taken one day earlier. The 2026-08-13 pass made the reserved ChronoCompose
// calendar implicit but argued that an external calendar's tag "carries real provenance" and kept it. The
// owner withdrew that: provenance is not the user's vocabulary, and it is fully recoverable from
// `t.calendarId` without spending one of the user's labels on it. Every deletion below follows from that
// one sentence, and each removes code that was only ever CORRECT while import stamped a tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask } = require('./_load.js');

// vm-realm arrays are not `instanceof` this realm's Array; copy before deepEqual. (CURRENT.md records this
// trap from the block that was cut off mid-flight.)
const host = a => [].concat(a == null ? [] : Array.prototype.slice.call(a));
// runOnceMigrations runs inside the constructor, so every flag is already set on a fresh make(). A
// migration test must clear the flag it means to exercise or it silently asserts against a no-op.
const onlyFlags = (c, flags) => { try { c.lsSet('pp-migrations', JSON.stringify(flags || {})); } catch (e) {} };

const EXT = { id: 'x1', summary: 'Team Standups' };
const WORK = { id: 'w1', summary: 'Work' };
const CC = { id: 'cc1', summary: 'ChronoCompose' };
const evAt = (id, ms) => ({ id, summary: id, start: { dateTime: new Date(ms).toISOString() },
  end: { dateTime: new Date(ms + 3600000).toISOString() } });

// ===========================================================================================
// calTag — the single seam
// ===========================================================================================

test('calTag returns no tag for EVERY calendar, including ones it used to tag', () => {
  const c = make();
  assert.equal(c.calTag(EXT), '', 'the external carve-out is withdrawn');
  assert.equal(c.calTag(WORK), '');
  assert.equal(c.calTag(CC), '', 'ours was already implicit and stays so');
  assert.equal(c.calTag(undefined), '', 'no more "cal" default for a nameless calendar');
  assert.equal(c.calTag({}), '');
  assert.equal(c.calTag({ summary: 'Anything At All' }), '');
});

test('calTagFor is deliberately NOT suppressed — the migration needs to recognise the old tags', () => {
  const c = make();
  assert.equal(c.calTagFor('Team Standups'), 'team-standups');
  assert.equal(c.calTagFor(c.GCAL_OWN_CAL_NAME), 'chronocompose');
  assert.equal(c.calTagFor(''), '');
});

// ===========================================================================================
// import — adds nothing, and sheds what an older build added
// ===========================================================================================

test('import from an external calendar lands an untagged task, and re-import keeps it untagged', () => {
  const c = make();
  const now = c.startOfToday() + 9 * 3600000;
  const tasks = [];
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e1', now)] }], {}, { x1: EXT }, {});
  assert.equal(tasks.length, 1);
  assert.deepEqual(host(tasks[0].labels), []);
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e1', now)] }], {}, { x1: EXT }, {});
  assert.deepEqual(host(tasks[0].labels), [], 'no re-add half remains');
  assert.equal(tasks[0].calendarId, 'x1', 'the LINK is intact — that is where provenance lives now');
});

// This is what makes the migration's constructor-time blindness survivable: the import path always has
// the summaries in hand, so a workspace that syncs gets cleaned whether or not the flag ever fires.
test('re-import SHEDS a calendar tag stamped by an older build, and keeps every user label', () => {
  const c = make();
  const now = c.startOfToday() + 9 * 3600000;
  const tasks = [];
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e1', now)] }], {}, { x1: EXT }, {});
  tasks[0].labels = ['team-standups', 'urgent'];        // as a pre-2026-08-14 build left it
  c.mergeCalendarEvents(tasks, [{ cid: 'x1', items: [evAt('e1', now)] }], {}, { x1: EXT }, {});
  assert.deepEqual(host(tasks[0].labels), ['urgent'], 'the stamped tag goes; the real one stays');
});

// ===========================================================================================
// stripCalendarTags — how a calendar tag is told apart from a user tag
// ===========================================================================================

test('the migration matches the task\'s OWN calendar only — a hand-made tag that merely COLLIDES is safe', () => {
  const c = make();
  const cals = [WORK, EXT];
  const tasks = [
    // linked to "Work": @work is the tag import wrote, by construction.
    activeTask(c, { id: 'a', labels: ['work', 'urgent'], calendarId: 'w1', eventId: 'e1' }),
    // a MANUAL task the user tagged @work by hand. Matching against the whole calendar list would eat it.
    activeTask(c, { id: 'b', labels: ['work'] }),
    // linked to a DIFFERENT calendar, and hand-tagged @work. Its own calendar's tag is @team-standups,
    // so @work is not touched — this is the case a list-wide match would get wrong.
    activeTask(c, { id: 'd', labels: ['work'], calendarId: 'x1', eventId: 'e3' }),
  ];
  assert.equal(c.stripCalendarTags(tasks, cals), 1, 'exactly one task changes');
  assert.deepEqual(tasks[0].labels, ['urgent']);
  assert.deepEqual(tasks[1].labels, ['work'], 'an unlinked task is never touched');
  assert.deepEqual(tasks[2].labels, ['work'], 'a linked task keeps a tag belonging to ANOTHER calendar');
});

test('stripCalendarTags is pure-shaped and idempotent, and no-ops without a calendar list', () => {
  const c = make();
  const tasks = [activeTask(c, { id: 'a', labels: ['work'], calendarId: 'w1', eventId: 'e1' })];
  assert.equal(c.stripCalendarTags(tasks, []), 0, 'no summaries -> nothing is guessed at');
  assert.deepEqual(tasks[0].labels, ['work']);
  assert.equal(c.stripCalendarTags(tasks, [WORK]), 1);
  assert.equal(c.stripCalendarTags(tasks, [WORK]), 0, 'idempotent');
  assert.equal(c.stripCalendarTags([], [WORK]), 0);
  assert.equal(c.stripCalendarTags(null, null), 0);
});

test('a renamed calendar is the acknowledged miss — a stale tag is left, never a real one destroyed', () => {
  const c = make();
  // Imported while the calendar was called "Work", then renamed in Google to "Work Stuff".
  const tasks = [activeTask(c, { id: 'a', labels: ['work'], calendarId: 'w1', eventId: 'e1' })];
  assert.equal(c.stripCalendarTags(tasks, [{ id: 'w1', summary: 'Work Stuff' }]), 0);
  assert.deepEqual(tasks[0].labels, ['work'],
    'no local history of past summaries exists, and the broad sweep that would catch this is exactly ' +
    'the user-data-destroying heuristic the own-calendar-only rule refuses');
});

// ===========================================================================================
// the once-flag — the one migration NOT recorded unconditionally
// ===========================================================================================

test('runOnceMigrations does NOT record no-calendar-tags while the calendar list is empty', () => {
  const c = make();
  onlyFlags(c, {});
  const tasks = [activeTask(c, { id: 'a', labels: ['work'], calendarId: 'w1', eventId: 'e1' })];
  c.runOnceMigrations(tasks);
  const done = JSON.parse(c.lsGet('pp-migrations') || '{}');
  assert.notEqual(done['no-calendar-tags'], 1,
    'loadGcal rebuilds calendars:[] every boot, so stamping it here would permanently skip the sweep');
  assert.deepEqual(tasks[0].labels, ['work'], 'and with no summaries it correctly did nothing');
  // Contrast: a flag that IS recorded unconditionally, proving the difference is deliberate.
  assert.equal(done['implicit-own-calendar-tag'], 1);
});

test('sweepCalendarTags runs at the one moment a real list exists, and records the flag then', () => {
  const c = make();
  onlyFlags(c, {});
  c.state.tasks = [
    activeTask(c, { id: 'a', labels: ['work', 'urgent'], calendarId: 'w1', eventId: 'e1' }),
    activeTask(c, { id: 'b', labels: ['work'] }),
  ];
  const n = c.sweepCalendarTags([WORK]);
  assert.equal(n, 1);
  assert.deepEqual(host(c.state.tasks.find(t => t.id === 'a').labels), ['urgent']);
  assert.deepEqual(host(c.state.tasks.find(t => t.id === 'b').labels), ['work'], 'manual task untouched');
  assert.equal(JSON.parse(c.lsGet('pp-migrations') || '{}')['no-calendar-tags'], 1);
  assert.equal(c.sweepCalendarTags([WORK]), 0, 'flagged: it does not run twice');
});

test('sweepCalendarTags records the flag even when there was nothing to strip, and writes no undo step', () => {
  const c = make();
  onlyFlags(c, {});
  c.state.tasks = [activeTask(c, { id: 'a', labels: ['urgent'], calendarId: 'w1', eventId: 'e1' })];
  const before = (c.state.history || []).length;
  assert.equal(c.sweepCalendarTags([WORK]), 0);
  assert.equal(JSON.parse(c.lsGet('pp-migrations') || '{}')['no-calendar-tags'], 1);
  assert.equal((c.state.history || []).length, before,
    'a no-op migration must not spend the user\'s undo stack');
});

test('sweepCalendarTags never diffs the cleanup back out to Google as an edit', () => {
  const c = make();
  onlyFlags(c, {});
  c.state.tasks = [activeTask(c, { id: 'a', labels: ['work'], calendarId: 'w1', eventId: 'e1' })];
  const before = c._gcalApplying;
  c.sweepCalendarTags([WORK]);
  assert.equal(c._gcalApplying, before, 'the guard is restored to what it was, not left latched on');
  assert.ok(!c._gcalApplying, 'and it is not left true, which would mute genuine later edits');
});

// ===========================================================================================
// what depended on the tag for provenance
// ===========================================================================================

test('calNameOf no longer prints a user tag and calls it a calendar name', () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars: [], ccCalId: 'cc1' });
  const t = activeTask(c, { id: 'n1', labels: ['urgent'], calendarId: 'zz', eventId: 'e1' });
  assert.equal(c.calNameOf(t), 'zz',
    'the "@"+labels[0] fallback is deleted — it was only correct while labels[0] WAS the calendar name');
  const ours = activeTask(c, { id: 'n2', labels: ['urgent'], calendarId: 'cc1', eventId: 'e2' });
  assert.equal(c.calNameOf(ours), 'ChronoCompose', 'the reserved-name fallback survives; it reads ccCalId');
  c.state.gcal = Object.assign({}, c.state.gcal, { calendars: [WORK] });
  const w = activeTask(c, { id: 'n3', labels: [], calendarId: 'w1', eventId: 'e3' });
  assert.equal(c.calNameOf(w), 'Work', 'and the real summary still wins when the list has loaded');
  assert.equal(c.calNameOf(activeTask(c, { id: 'n4', labels: ['work'] })), '', 'unlinked -> no calendar');
});

test('losing calendar ACCESS no longer deletes labels — both unlink paths', () => {
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, { connected: true, selected: { g1: true }, calendars: [], ccCalId: 'cc1' });
  c.state.tasks = [
    activeTask(c, { id: 'a', labels: ['todoist', 'errand'], calendarId: 'g1', eventId: 'e1' }),
    activeTask(c, { id: 'b', labels: ['todoist'], calendarId: 'g1', eventId: 'e2' }),
  ];
  c.gcalDropGone(['g1'], { g1: { id: 'g1', summary: 'Todoist' } });
  const a = c.state.tasks.find(t => t.id === 'a'), b = c.state.tasks.find(t => t.id === 'b');
  assert.equal(a.calendarId, null, 'the LINK is what a 404 is evidence about');
  assert.deepEqual(host(a.labels), ['todoist', 'errand'], 'labels are not evidence and are not touched');
  assert.deepEqual(host(b.labels), ['todoist']);

  const c2 = make();
  c2.state.gcal = Object.assign({}, c2.state.gcal, { connected: true, selected: {}, calendars: [], ccCalId: 'cc' });
  c2.state.tasks = [
    activeTask(c2, { id: 'p', labels: ['shared', 'own'], calendarId: 'gone', eventId: 'e1' }),
    activeTask(c2, { id: 'q', labels: ['shared'], calendarId: 'gone', eventId: 'e2' }),
  ];
  assert.equal(c2.gcalReconcileLinks([{ id: 'cal1', summary: 'Work' }]), 2);
  // The old code removed @shared here purely because it was the INTERSECTION of the gone calendar's
  // tasks. With no calendar tags that intersection is just a label the user applied to all of them.
  assert.deepEqual(host(c2.state.tasks.find(t => t.id === 'p').labels), ['shared', 'own']);
  assert.deepEqual(host(c2.state.tasks.find(t => t.id === 'q').labels), ['shared']);
  assert.equal(c2.gcalReconcileLinks([{ id: 'cal1', summary: 'Work' }]), 0, 'idempotent');
});

test('sectionTagStrippable is deleted outright, not left as a weakened predicate', () => {
  const c = make();
  assert.equal(typeof c.sectionTagStrippable, 'undefined');
  // Its only reason to exist was the strip -> re-import -> re-add churn loop, and there is no re-add now.
  const secs = [c.normalizeSection({ name: 'research', order: 0 })];
  const tasks = [activeTask(c, { id: 'g', labels: ['research', 'urgent'], sectionId: secs[0].id,
    calendarId: 'w1', eventId: 'e1' })];
  assert.equal(c.stripSectionTags(tasks, secs), 1, 'a calendar-linked task is now strippable like any other');
  assert.deepEqual(tasks[0].labels, ['urgent']);
});
