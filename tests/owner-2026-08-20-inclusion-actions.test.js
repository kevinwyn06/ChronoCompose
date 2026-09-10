/* PP-EXT (owner 2026-08-20) Chain A, Task 7 — one snooze verb, three variants.
 *
 * The reported defect: "Snooze today" and "Take out of today" behaved identically. They did, and not by
 * coincidence — `setIncludedOff` ends with a tail that snoozes the task until tomorrow whenever
 * inheritance or auto-inclusion would immediately undo the unpress. For exactly the tasks a user is
 * looking at on today's list, that tail fires, so the two buttons wrote the same two fields.
 *
 * The resolution is not to make them differ more; it is that there is only ONE verb. Removing work from
 * today needs a duration, so the surface offers three durations of the same verb — today, until a date,
 * until it is relevant — and `setIncludedOff` stops secretly snoozing.
 *
 * The wake triggers behind "until it's relevant" (`snoozeWakeReason`) are correct and are NOT touched
 * here. Only the label and its explanation changed.
 */
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY, withNow, FIXED_NOW } = require('./_load.js');

// Every string a row renders, flattened, so a test can ask what the menu OFFERS.
function rowText(node){
  if(node==null || node===false) return '';
  if(typeof node === 'string' || typeof node === 'number') return String(node);
  if(Array.isArray(node)) return node.map(rowText).join(' ');
  const kids = [].concat(node.children||[], (node.props && node.props.children)||[]);
  return kids.map(rowText).join(' ');
}
const labels = rows => rows.map(rowText).map(s => s.trim()).filter(Boolean);

test('inclusion actions: the menu offers exactly three snooze variants', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'t1', start:B, end:B+DAY, included:true });
    c.state.tasks = [t];

    const got = labels(c.inclActionRows(t));
    assert.ok(got.some(s => s.includes('Snooze · today')), 'today');
    assert.ok(got.some(s => s.includes('Snooze · until')), 'until a date');
    assert.ok(got.some(s => s.includes("Snooze · until it's relevant")), 'until it is relevant');

    // One verb: nothing else on this menu removes work from today.
    const joined = got.join(' | ');
    assert.ok(!/Take out of today/.test(joined), 'Take out of today is gone');
    assert.ok(!/Snooze indefinitely/.test(joined), 'and the dishonest name with it');
    assert.ok(!/Not today/.test(joined), 'the old first variant is renamed, not kept alongside');
  });
});

test("inclusion actions: until-it's-relevant explains its own wake triggers", () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'t1', start:B, end:B+DAY, included:true });
    c.state.tasks = [t];
    const joined = labels(c.inclActionRows(t)).join(' | ');
    assert.ok(/wakes when it starts, falls due, or its last dependency is done/.test(joined),
      'an open-ended snooze has to say what ends it, or it reads as a black hole');
  });
});

test('inclusion actions: setIncludedOff no longer secretly snoozes an inherited task', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Yesterday sits inside this window and it is unfinished, so inheritance WOULD carry it — the exact
    // fixture whose snooze tail made the two buttons identical.
    const t = activeTask(c, { id:'carry', start:B-2*DAY, end:B+2*DAY, included:true, pct:10 });
    c.state.tasks = [t];
    assert.strictEqual(c.isInheritedToday(t), true, 'precondition: the tail would have fired');

    c.setIncludedOff('carry');
    const got = c.state.tasks.find(x => x.id === 'carry');
    assert.strictEqual(got.included, null, 'unpressed, never "off"');
    assert.strictEqual(got.snoozeUntil, null, 'and NOT snoozed — that is the reported defect');
    assert.strictEqual(got.snoozeIndef, false);
  });
});

/* PP-EXT (owner 2026-09-10): the row-drag MIRROR is deleted with Group by: Inclusion — a row drag
   re-sections and reorders, and `setIncludedOff` is once again the only way to take a task off today.
   What the mirror test protected (the two paths agreeing) is now true by there being only one path. */
test('inclusion actions: a row drag no longer writes inclusion at all', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'carry', start:B-2*DAY, end:B+2*DAY, included:true, pct:10 });
    c.state.tasks = [t]; c._visTasks = c.state.tasks;
    c.reorderRows(['carry'], 0, undefined, undefined, 'excluded'); /* the old 5th argument is ignored */
    const got = c.state.tasks.find(x => x.id === 'carry');
    assert.strictEqual(got.included, true, 'reordering a row is not an inclusion decision');
  });
});

test('inclusion actions: each variant writes its own distinct state', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    c.state.tasks = [
      activeTask(c, { id:'a', start:B, end:B+DAY, included:true }),
      activeTask(c, { id:'b', start:B, end:B+DAY, included:true }),
      activeTask(c, { id:'c', start:B, end:B+DAY, included:true }),
    ];
    c.snoozeToday('a');
    c.snoozeUntilText('b', '3 days');
    c.snoozeIndefinitely('c');
    const by = id => c.state.tasks.find(x => x.id === id);

    assert.strictEqual(by('a').snoozeUntil, B + DAY, 'today: expires at midnight');
    assert.ok(by('b').snoozeUntil > B + DAY, 'until a date: expires then');
    assert.strictEqual(by('c').snoozeIndef, true, "until it's relevant: ends on an event, not a date");
    assert.strictEqual(by('c').snoozeUntil, null, 'and carries no date at all');

    // None of them touches `included` — an expired snooze always falls back to what was already there.
    c.state.tasks.forEach(t => assert.strictEqual(t.included, true, t.id + ' keeps its inclusion'));
  });
});

test('inclusion actions: a snoozed task is still offered a way back', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'t1', start:B, end:B+DAY, included:true, snoozeUntil:B+3*DAY });
    c.state.tasks = [t];
    const joined = labels(c.inclActionRows(t)).join(' | ');
    assert.ok(/Snoozed until/.test(joined), 'it says what state it is in');
    assert.ok(/Turn on/.test(joined), 'and offers the way out — no dead ends');
  });
});

// ---------------------------------------------------------------------------
// Task 8 — the checkbox IS the gesture.
//
// The asymmetry is the point. Including needs no duration, so ticking just does it. REMOVING needs one —
// "not today" and "not until it's relevant" are different answers — so unticking asks, and until the user
// picks a variant nothing is written. That is also what keeps the tick from being a confirmation dialog
// for a checkbox, which is the rule the owner set on 2026-08-12.

test('tick: ticking an undated task puts it on today AND stamps onListSince', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // An active snooze too, so the tick is also shown to clear it.
    const t = activeTask(c, { id:'u1', start:null, end:null, included:null, snoozeUntil:c.startOfToday()+DAY });
    c.state.tasks = [t];
    assert.strictEqual(t.onListSince, null, 'precondition: not on the list');
    assert.strictEqual(c.originOf(t), 'snoozed', 'and currently snoozed');

    c.tickOnToday('u1');
    const got = c.state.tasks.find(x => x.id === 'u1');
    assert.strictEqual(got.included, true);
    assert.strictEqual(got.includedExplicit, true, 'a manual press records provenance');
    assert.strictEqual(got.snoozeUntil, null, 'ticking clears any snooze');
    assert.strictEqual(got.snoozeIndef, false);
    assert.strictEqual(got.onListSince, c.ymdOf(c.startOfToday()),
      'this is the stamp that moves an undated task from Upcoming to New');
    assert.strictEqual(c.originOf(got), 'new');
  });
});

test('tick: ticking work already on the list does NOT reset its age', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'old', start:B-4*DAY, end:B+4*DAY, included:null,
      onListSince:c.ymdOf(B-4*DAY) });
    c.state.tasks = [t];
    c.tickOnToday('old');
    const got = c.state.tasks.find(x => x.id === 'old');
    assert.strictEqual(got.onListSince, c.ymdOf(B-4*DAY),
      'only a NULL key is stamped — the age of a row is exactly what the field is for');
    assert.strictEqual(c.originOf(got), 'continued');
  });
});

test('tick: ticking is ONE commit, so one undo takes it back', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = activeTask(c, { id:'u1', start:null, end:null, included:null });
    c.state.tasks = [t];
    const before = c.history.length;
    c.tickOnToday('u1');
    assert.strictEqual(c.history.length, before + 1, 'one gesture, one undo entry');
  });
});

test('tick: unticking opens the snooze window and mutates NOTHING', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'p1', start:B, end:B+DAY, included:true, onListSince:c.ymdOf(B) });
    c.state.tasks = [t];
    const before = JSON.stringify(c.state.tasks);
    const hist = c.history.length;

    // openInclPick anchors the popover off the clicked element's rect.
    const ev = { stopPropagation(){}, currentTarget:{ getBoundingClientRect:()=>({left:10,bottom:20}) } };
    c.untickOnToday(ev, 'p1');

    assert.ok(c.state.inclPick, 'the snooze window is open');
    assert.strictEqual(c.state.inclPick.id, 'p1');
    assert.strictEqual(JSON.stringify(c.state.tasks), before, 'and not one field was written');
    assert.strictEqual(c.history.length, hist, 'nothing to undo, because nothing happened');
  });
});

test('tick: the untick window offers the three snooze durations and nothing else that removes', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'p1', start:B, end:B+DAY, included:true });
    c.state.tasks = [t];
    const got = labels(c.inclActionRows(t)).join(' | ');
    assert.ok(/Snooze · today/.test(got));
    assert.ok(/Snooze · until/.test(got));
    assert.ok(/relevant/.test(got));
  });
});

test('tick: isUndecided is RETAINED — never-looked-at must not render as decided-against', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const untouched = activeTask(c, { id:'u', start:B+2*DAY, end:B+3*DAY, included:null });
    const snoozed = activeTask(c, { id:'s', start:B, end:B+DAY, included:true, snoozeUntil:B+DAY });
    c.state.tasks = [untouched, snoozed];
    assert.strictEqual(c.isUndecided(untouched), true, 'Upcoming: not looked at');
    assert.strictEqual(c.isUndecided(snoozed), false, 'Snoozed: a decision, with an end');
    // The dashed edge is the channel that keeps them apart on the card.
    const card = JSON.stringify(c.planCard(untouched));
    assert.ok(/dashed/.test(card), 'undecided still paints a dashed edge');
  });
});

test('tick: the Selection drag is gone and the band sizing with it', () => {
  const c = make();
  assert.strictEqual(typeof c.selectionHalfFlex, 'undefined', 'two-row band sizing deleted');
  assert.strictEqual(typeof c.selectionSplitHeights, 'undefined');
  assert.strictEqual(c.SEL_HALF_MIN_PX, undefined, 'and its constants with it');

  // A card carries no drag initiator at all. A8b (2026-08-21) went further than Task 8 did: with the
  // Matrix deleted there is no second consumer, so `planCard` lost its `zone` parameter and the whole
  // `cardPointerDown` → `beginCardDrag` → `resolveCardZone` chain went with it.
  const B = c.startOfToday();
  const t = activeTask(c, { id:'x', start:B, end:B+DAY, included:true });
  c.state.tasks = [t];
  assert.strictEqual(typeof c.planCard(t).props.onMouseDown, 'undefined', 'no drag to arm');
  assert.strictEqual(c.planCard.length, 1, 'and no zone parameter left to pass one');
  ['cardPointerDown','beginCardDrag','resolveCardZone','setQuadrantImportance','renderMatrixView',
   'eisenhowerProjection','quadrantOf','isUrgent','isImportant']
    .forEach(m => assert.strictEqual(typeof c[m], 'undefined', m + ' is deleted, not merely unreachable'));
});

/* PP-EXT (owner 2026-08-20) Chain A, Task 8 follow-up — the OTHER two press-in gestures.
 *
 * Task 8 routed the checkbox and the card's 💤 shortcut through `tickOnToday`, and fixed "Turn on" for
 * the same reason: a press that does not stamp `onListSince` leaves an undated task reading as the state
 * it just left. Two gestures were missed by that sweep and have the identical defect:
 *
 *   - "→ Today" on an overdue card (`rescheduleToToday`), and
 *   - dropping a SHEET row into the Included band (`setInclBand`).
 *
 * Both are explicit "yes, today" presses — the same sentence the checkbox says — so both must record the
 * arrival at the moment the user makes it, not whenever the throttled sweep next runs. `setIncludedOn`
 * survives as the primitive those two verbs are built from and as the field-level unit under test
 * elsewhere; it is simply no longer what a GESTURE calls.
 */
test('tick: "→ Today" stamps the arrival, like every other explicit press', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Overdue and never looked at: the state a forgotten task is actually in.
    const t = activeTask(c, { id:'od', start:B-3*DAY, end:B-2*DAY, included:null, onListSince:null });
    c.state.tasks = [t];

    c.rescheduleToToday('od');
    const got = c.state.tasks.find(x=>x.id==='od');
    assert.strictEqual(got.included, true, 'rescued work is chosen, not merely re-dated');
    assert.strictEqual(got.onListSince, c.ymdOf(B), 'and it arrived on the list TODAY');
  });
});

test('tick: "→ Today" does not reset the age of work already on the list', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const old = c.ymdOf(B - 6*DAY);
    const t = activeTask(c, { id:'od', start:B-3*DAY, end:B-2*DAY, included:true, onListSince:old });
    c.state.tasks = [t];

    c.rescheduleToToday('od');
    assert.strictEqual(c.state.tasks.find(x=>x.id==='od').onListSince, old,
      'a re-date is not a new arrival — the field records age, and this task has some');
  });
});

test('tick: dropping a sheet row into Included is a press, and stamps like one', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id:'sh', start:B+2*DAY, end:B+3*DAY, included:null, onListSince:null });
    c.state.tasks = [t];

    c.setInclBand('sh', 'included');
    const got = c.state.tasks.find(x=>x.id==='sh');
    assert.strictEqual(got.included, true);
    assert.strictEqual(got.onListSince, c.ymdOf(B),
      'an undated future task has no window to observe — the press is the only evidence it arrived');
  });
});
