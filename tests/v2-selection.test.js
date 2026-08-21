/* PP-EXT V2.9 §3/§4: the shared derivations behind the Selection view, the Gantt inclusion division, and
   the Eisenhower matrix. All of these are pure projections over tasks + today, so they are tested here
   rather than through a render surface — the whole point of defining them once is that three consumers
   cannot disagree about them. */
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

/* ---------- §4.1 origin: the three columns ---------- */

/* PP-EXT (owner 2026-08-20): the `overdue / existing / new / extra` trio that lived here is SUPERSEDED.
   The partition is now five buckets read off `onListSince` — see the A1 worked-cases table in
   tests/owner-2026-08-20-triage-buckets.test.js, which covers every case these three did and several they
   could not express (completion removing a row, a recurrence gap, an undated task nobody pressed).
   What survives here is the part that is still true of the new partition: the keys are exhaustive, and
   Overdue outranks everything else. */

test('origin: every task on the surface lands in exactly one declared bucket', () => {
  const c=make(); const B=c.startOfToday();
  const cont=activeTask(c,{id:'cont',start:B-2*DAY,end:B+2*DAY,included:null,pct:20,onListSince:c.ymdOf(B-2*DAY)});
  const fresh=activeTask(c,{id:'fresh',start:B,end:B+2*DAY,included:null,pct:0,onListSince:c.ymdOf(B)});
  const pulled=activeTask(c,{id:'pulled',start:B+2*DAY,end:B+3*DAY,included:true,pct:0});
  const dateless=activeTask(c,{id:'dateless',start:null,end:null,included:true,pct:0,onListSince:c.ymdOf(B)});
  c.state.tasks=[cont,fresh,pulled,dateless];

  assert.strictEqual(c.originOf(cont),'continued');
  assert.strictEqual(c.originOf(fresh),'new');
  assert.strictEqual(c.originOf(pulled),'upcoming','a window that has not opened is Upcoming');
  assert.strictEqual(c.originOf(dateless),'new','pressed today, so today is when it arrived');

  const keys=c.ORIGIN_KEYS();
  c.state.tasks.forEach(t=>assert.ok(keys.includes(c.originOf(t)), t.id+' has a bucket'));
});

test('Overdue outranks every other bucket rule', () => {
  const c=make(); const B=c.startOfToday();
  /* both carried over AND past due - overdue has to win, because once work is late, where it came from
     stopped being the interesting question */
  const late=activeTask(c,{id:'late',start:B-3*DAY,end:B-DAY,included:null,pct:20,onListSince:c.ymdOf(B-3*DAY)});
  const lateButDone=activeTask(c,{id:'done',start:B-3*DAY,end:B-DAY,included:null,pct:100});
  c.state.tasks=[late,lateButDone];
  assert.strictEqual(c.isOverdueToday(late),true);
  assert.strictEqual(c.originOf(late),'overdue','overdue beats continued');
  assert.strictEqual(c.isOverdueToday(lateButDone),false,'completed work is never overdue');
  assert.strictEqual(c.originOf(lateButDone),null,'and finished work leaves the surface entirely');
});

test('V2.9 startsToday is strictly "the window begins today", not merely "today is inside it"', () => {
  const c=make(); const B=c.startOfToday();
  const beginsToday=activeTask(c,{id:'a',start:B,end:B+DAY});
  const spansToday=activeTask(c,{id:'b',start:B-DAY,end:B+DAY});
  const future=activeTask(c,{id:'c',start:B+DAY,end:B+2*DAY});
  const dateless=activeTask(c,{id:'d',start:null,end:null});
  c.state.tasks=[beginsToday,spansToday,future,dateless];

  assert.strictEqual(c.startsToday(beginsToday),true);
  assert.strictEqual(c.startsToday(spansToday),false,'yesterday was already in the window');
  assert.strictEqual(c.startsToday(future),false);
  assert.strictEqual(c.startsToday(dateless),false,
    'ghostSpan anchors dateless work at today; it must not flood the New column');
});

/* ---------- §4.2 inclusion: the two rows ---------- */

test('the sheet inclusion band folds four states into two, keeping undecided distinct from snoozed', () => {
  const c=make(); const B=c.startOfToday();
  const pressed=activeTask(c,{id:'pressed',start:B,end:B+DAY,included:true});
  const undecided=activeTask(c,{id:'undecided',start:B+2*DAY,end:B+3*DAY,included:null});
  const snoozed=activeTask(c,{id:'snoozed',start:B,end:B+DAY,included:true,snoozeUntil:B+DAY});
  c.state.tasks=[pressed,undecided,snoozed];

  assert.strictEqual(c.inclBand(pressed),'included');
  assert.strictEqual(c.inclBand(undecided),'excluded');
  assert.strictEqual(c.inclBand(snoozed),'excluded','a snooze excludes for today');

  /* The failure mode this guards: collapsing "I haven't looked" into "I said no". */
  assert.strictEqual(c.isUndecided(undecided),true);
  assert.strictEqual(c.isUndecided(snoozed),false,'a snooze IS a decision, with an end date');
  assert.strictEqual(c.isUndecided(pressed),false);
});

test('setInclBand writes through the existing mutators and adds no new fields', () => {
  const c=make(); const B=c.startOfToday();
  /* V5 block 20 (F19): the window must NOT open today, or auto-inclusion would legitimately add the
     snooze on the way out. A window that has not started yet is the case where a bare unpress suffices. */
  const t=activeTask(c,{id:'t1',start:B+2*DAY,end:B+4*DAY,included:null,snoozeUntil:B+DAY});
  c.state.tasks=[t];

  c.setInclBand('t1','included');
  let got=c.state.tasks.find(x=>x.id==='t1');
  assert.strictEqual(got.included,true,'dropping into Included presses the task');
  assert.strictEqual(got.snoozeUntil,null,'turning on clears any snooze');

  c.setInclBand('t1','excluded');
  got=c.state.tasks.find(x=>x.id==='t1');
  /* V2.11: excluding UNPRESSES (null) rather than writing the retired `false`. Nothing pulls this
     fixture back into today — no inheritance, and no auto-inclusion — so no snooze is needed. */
  assert.strictEqual(got.included,null,'dropping into Excluded unpresses the task');
  assert.strictEqual(got.snoozeUntil,null,'nothing to suppress, so no snooze is added');
});

test('snoozing work V2.2 would inherit actually removes it, so the gesture is not a no-op', () => {
  const c=make(); const B=c.startOfToday();
  /* yesterday sits inside this window and it is unfinished, so unpressing alone would be undone
     immediately by inheritance - the exact failure that makes retiring Off more than a deleted branch */
  const t=activeTask(c,{id:'carry',start:B-2*DAY,end:B+2*DAY,included:true,pct:10});
  c.state.tasks=[t];
  assert.strictEqual(c.isInheritedToday(t),true,'precondition: inheritance would carry it');

  /* PP-EXT (owner 2026-08-20): SNOOZE is the verb that removes. `setIncludedOff` used to write this
     snooze itself, which is what made it indistinguishable from the snooze button. */
  c.snoozeToday('carry');
  const got=c.state.tasks.find(x=>x.id==='carry');
  assert.strictEqual(got.included,true,'snoozing never touches inclusion — an expiry falls back to it');
  assert.strictEqual(got.snoozeUntil,B+DAY,'snoozed through today so the opt-out actually takes effect');
  assert.strictEqual(c.isActiveToday(got),false,'and it really is out of today');
  assert.strictEqual(c.isActiveOn(got,B+2*DAY),true,'...but tomorrow it returns on its own - no dead end');
});

/* ---------- §5 the projection ---------- */

test('selectionProjection places every live task in exactly one flat bucket', () => {
  const c=make(); const B=c.startOfToday();
  const tasks=[
    activeTask(c,{id:'over', start:B-3*DAY,end:B-DAY,included:true, pct:10, onListSince:c.ymdOf(B-3*DAY)}),
    activeTask(c,{id:'cont', start:B-2*DAY,end:B+2*DAY,included:true,pct:10, onListSince:c.ymdOf(B-2*DAY)}),
    activeTask(c,{id:'new',  start:B,       end:B+DAY,included:true,        onListSince:c.ymdOf(B)}),
    activeTask(c,{id:'up',   start:null,    end:null, included:null}),
    activeTask(c,{id:'snz',  start:B,       end:B+DAY,included:true, snoozeUntil:B+DAY})
  ];
  c.state.tasks=tasks;
  const p=c.selectionProjection(tasks);

  /* join, not deepStrictEqual: the app runs in a VM realm, so its Array has a different prototype */
  assert.strictEqual(p.keys.join(','),'overdue,new,continued,upcoming,snoozed');
  const placed=p.keys.reduce((n,k)=>n+p.cells[k].length,0);
  assert.strictEqual(placed,tasks.length,'nothing falls out of the partition');
  assert.strictEqual(p.keys.reduce((n,k)=>n+p.colCount[k],0),tasks.length,'counts are exhaustive');

  assert.ok(p.cells.overdue.some(t=>t.id==='over'));
  assert.ok(p.cells.continued.some(t=>t.id==='cont'));
  assert.ok(p.cells.new.some(t=>t.id==='new'));
  assert.ok(p.cells.upcoming.some(t=>t.id==='up'));
  assert.ok(p.cells.snoozed.some(t=>t.id==='snz'));
});

test('selectionProjection ignores archived tasks', () => {
  const c=make(); const B=c.startOfToday();
  const live=activeTask(c,{id:'live',start:B,end:B+DAY,included:true,onListSince:c.ymdOf(B)});
  const gone=activeTask(c,{id:'gone',start:B,end:B+DAY,included:true,archivedAt:B-DAY});
  c.state.tasks=[live,gone];
  const p=c.selectionProjection(c.state.tasks);
  assert.strictEqual(p.keys.reduce((n,k)=>n+p.colCount[k],0),1,"archived work is not part of today's selection");
});

/* ---------- §3 Eisenhower — DELETED 2026-08-21 (A8b) ----------
   `isUrgent`, `isImportant`, `quadrantOf`, `eisenhowerProjection` and `setQuadrantImportance` went with
   the Matrix surface on the owner's ruling. Their tests are deleted rather than skipped: a skipped test
   for code that no longer exists is a claim the surface is coming back, and it is not. */

/* ---------- §6 the Gantt inclusion division ---------- */

test('V2.9 inclusionProjection emits the same band shape sectionProjection does', () => {
  const c=make(); const B=c.startOfToday();
  const inTask=activeTask(c,{id:'in',start:B,end:B+DAY,included:true});
  /* V2.11: unpressed is the excluded state. V5 block 20: the window must not open today, or the task
     would be auto-included and there would be nothing in the Excluded band to assert on. */
  const outTask=activeTask(c,{id:'out',start:B+2*DAY,end:B+4*DAY,included:null});
  c.state.tasks=[inTask,outTask];
  const bands=c.inclusionProjection(c.state.tasks);

  assert.strictEqual(bands.length,2,'both bands always render');
  assert.strictEqual(bands[0].id,c.INCL_BAND_IN());
  assert.strictEqual(bands[1].id,c.INCL_BAND_OUT());
  assert.strictEqual(bands[0].name,'Included');
  assert.strictEqual(bands[1].name,'Excluded');
  assert.strictEqual(bands[0].tasks.length,1);
  assert.strictEqual(bands[1].tasks.length,1);
  /* the shape sectionGeometry consumes: every band carries id/name/tasks/collapsed */
  bands.forEach(b=>{ assert.ok('collapsed' in b); assert.ok(Array.isArray(b.tasks)); });
});

test('V2.9 both bands render even when empty, and Excluded defaults to collapsed-but-counted', () => {
  const c=make(); const B=c.startOfToday();
  const only=activeTask(c,{id:'only',start:B,end:B+DAY,included:true});
  c.state.tasks=[only]; c.state.collapsedSections={};
  const bands=c.inclusionProjection(c.state.tasks);

  assert.strictEqual(bands.length,2,'an empty Excluded band still renders — it is structure, not a bucket');
  assert.strictEqual(bands[0].collapsed,false,'Included is expanded by default');
  assert.strictEqual(bands[1].collapsed,true,'Excluded is collapsed by default');
  assert.strictEqual(bands[1].tasks.length,0,'…but its count is still derivable, never hidden');
});

test('V2.9 a subtree follows its ROOT across the division, never tearing parent from child', () => {
  const c=make(); const B=c.startOfToday();
  /* V5 block 20: a not-yet-open window keeps the root genuinely undecided (auto-inclusion only fires on
     the day a window opens), so the subtree rule is still being tested rather than the new default. */
  const root=activeTask(c,{id:'root',start:B+2*DAY,end:B+4*DAY,included:null});
  const kid=activeTask(c,{id:'kid',parentId:'root',start:B+2*DAY,end:B+4*DAY,included:true});
  c.state.tasks=[root,kid];
  const bands=c.inclusionProjection(c.state.tasks);

  assert.strictEqual(bands[0].tasks.length,0);
  assert.strictEqual(bands[1].tasks.length,2,'the child follows its root into Excluded');
});

test('V2.9 sectionProjection routes the inclusion mode, so both panes consume one projection', () => {
  const c=make(); const B=c.startOfToday();
  c.state.tasks=[activeTask(c,{id:'a',start:B,end:B+DAY,included:true})];
  c.state.groupBy='inclusion';
  const p=c.sectionProjection(c.state.tasks);
  assert.strictEqual(p.length,2);
  assert.strictEqual(p[0].id,c.INCL_BAND_IN(),'the same entry point both renderSheet and renderGantt call');
});

test('V2.9 a row dragged across the divider writes included in ONE commit, and clears any snooze', () => {
  const c=make(); const B=c.startOfToday();
  const t=activeTask(c,{id:'t',start:B,end:B+DAY,included:true,snoozeUntil:B+DAY});
  c.state.tasks=[t]; c._visTasks=c.state.tasks;
  const undo0=c.history.length;

  c.reorderRows(['t'],0,undefined,undefined,'excluded');
  const got=c.state.tasks.find(x=>x.id==='t');
  assert.strictEqual(got.included,null,'the drop writes inclusion (V2.11: unpressed), not sectionId');
  assert.strictEqual(got.sectionId,t.sectionId,'sectionId is untouched in inclusion mode');
  assert.strictEqual(c.history.length,undo0+1,'one drag is exactly one undo step');
  /* The contract is AGREEMENT between the two paths, not a particular snooze value: a cross-divider drag
     and the popover must leave a task in the same state, or the Gantt division and the Selection view
     would quietly mean different things. Asserted by running both and comparing. */
  const viaMutator=activeTask(c,{id:'t2',start:B,end:B+DAY,included:true,snoozeUntil:B+DAY});
  c.state.tasks=c.state.tasks.concat([viaMutator]);
  c.setIncludedOff('t2');
  const m=c.state.tasks.find(x=>x.id==='t2');
  assert.strictEqual(got.included,m.included,'drag and popover agree about included');
  assert.strictEqual(got.snoozeUntil,m.snoozeUntil,'drag and popover agree about snooze');
});
