/* PP-EXT V2.9 §3/§4: the shared derivations behind the Selection view, the Gantt inclusion division, and
   the Eisenhower matrix. All of these are pure projections over tasks + today, so they are tested here
   rather than through a render surface — the whole point of defining them once is that three consumers
   cannot disagree about them. */
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

/* ---------- §4.1 origin: the three columns ---------- */

test('V2.11 origin: overdue / existing / new / extra are derived, exhaustive, and never chosen', () => {
  const c=make(); const B=c.startOfToday();
  /* carried over: yesterday was inside the window, unfinished, and it is not yet due */
  const existing=activeTask(c,{id:'existing',start:B-2*DAY,end:B+2*DAY,included:null,pct:20});
  /* today entered the range: the window STARTS today */
  const fresh=activeTask(c,{id:'fresh',start:B,end:B+2*DAY,included:null,pct:0});
  /* a future window the user pulled in by hand: not inherited, does not start today */
  const pulled=activeTask(c,{id:'pulled',start:B+2*DAY,end:B+3*DAY,included:true,pct:0});
  /* dateless discretionary pick */
  const dateless=activeTask(c,{id:'dateless',start:null,end:null,included:true,pct:0});
  c.state.tasks=[existing,fresh,pulled,dateless];

  assert.strictEqual(c.originOf(existing),'existing','yesterday leftovers are Existing');
  assert.strictEqual(c.originOf(fresh),'new','a window that starts today is New');
  assert.strictEqual(c.originOf(pulled),'extra','an out-of-window pick falls to the Extra fallback');
  assert.strictEqual(c.originOf(dateless),'extra','a dateless pick is Extra, never New');

  /* V2.11 consequence worth naming: with Off retired, MID-WINDOW work can no longer reach Extra. Nothing
     can block V2.2 inheritance any more, so any task whose window covered yesterday is Existing. Extra is
     now dateless picks, out-of-window picks, and work that finished yesterday. */
  const keys=c.ORIGIN_KEYS();
  c.state.tasks.forEach(t=>assert.ok(keys.includes(c.originOf(t)), t.id+' has a column'));
});

test('V2.11 Overdue outranks every other column rule', () => {
  const c=make(); const B=c.startOfToday();
  /* both carried over AND past due - overdue has to win, because once work is late, where it came from
     stopped being the interesting question */
  const late=activeTask(c,{id:'late',start:B-3*DAY,end:B-DAY,included:null,pct:20});
  const lateButDone=activeTask(c,{id:'done',start:B-3*DAY,end:B-DAY,included:null,pct:100});
  c.state.tasks=[late,lateButDone];
  assert.strictEqual(c.isOverdueToday(late),true);
  assert.strictEqual(c.originOf(late),'overdue','overdue beats existing');
  assert.strictEqual(c.isOverdueToday(lateButDone),false,'completed work is never overdue');
  assert.strictEqual(c.originOf(lateButDone),'extra');
});

test('V2.11 New admits a snooze that ended today, not just a window that opened', () => {
  const c=make(); const B=c.startOfToday();
  /* snoozeUntil is never cleared on expiry, so the field itself records that the snooze ran out today */
  const back=activeTask(c,{id:'back',start:B+2*DAY,end:B+3*DAY,included:true,snoozeUntil:B});
  const stillOut=activeTask(c,{id:'still',start:B+2*DAY,end:B+3*DAY,included:true,snoozeUntil:B+DAY});
  c.state.tasks=[back,stillOut];
  assert.strictEqual(c.snoozeEndedToday(back),true);
  assert.strictEqual(c.originOf(back),'new','a snooze that ended today is work today brought back');
  assert.strictEqual(c.snoozeEndedToday(stillOut),false,'a snooze still running has not ended');
  assert.strictEqual(c.originOf(stillOut),'extra');
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

test('V2.11 inclusion folds four states into two rows and keeps undecided distinct from snoozed', () => {
  const c=make(); const B=c.startOfToday();
  const pressed=activeTask(c,{id:'pressed',start:B,end:B+DAY,included:true});
  const undecided=activeTask(c,{id:'undecided',start:B+2*DAY,end:B+3*DAY,included:null});
  const snoozed=activeTask(c,{id:'snoozed',start:B,end:B+DAY,included:true,snoozeUntil:B+DAY});
  c.state.tasks=[pressed,undecided,snoozed];

  assert.strictEqual(c.inclusionRow(pressed),'included');
  assert.strictEqual(c.inclusionRow(undecided),'excluded');
  assert.strictEqual(c.inclusionRow(snoozed),'excluded','a snooze excludes for today');

  /* The failure mode this guards: collapsing "I haven't looked" into "I said no". */
  assert.strictEqual(c.isUndecided(undecided),true);
  assert.strictEqual(c.isUndecided(snoozed),false,'a snooze IS a decision, with an end date');
  assert.strictEqual(c.isUndecided(pressed),false);
});

test('V2.9 setInclusionRow writes through the existing mutators and adds no new fields', () => {
  const c=make(); const B=c.startOfToday();
  const t=activeTask(c,{id:'t1',start:B,end:B+DAY,included:null,snoozeUntil:B+DAY});
  c.state.tasks=[t];

  c.setInclusionRow('t1','included');
  let got=c.state.tasks.find(x=>x.id==='t1');
  assert.strictEqual(got.included,true,'dropping into Included presses the task');
  assert.strictEqual(got.snoozeUntil,null,'turning on clears any snooze');

  c.setInclusionRow('t1','excluded');
  got=c.state.tasks.find(x=>x.id==='t1');
  /* V2.11: excluding UNPRESSES (null) rather than writing the retired `false`. This fixture's window
     opens today, so V2.2 inheritance cannot pull it back and no snooze is needed. */
  assert.strictEqual(got.included,null,'dropping into Excluded unpresses the task');
  assert.strictEqual(got.snoozeUntil,null,'nothing to suppress, so no snooze is added');
});

test('V2.11 excluding work V2.2 would inherit snoozes it, so the gesture is not a no-op', () => {
  const c=make(); const B=c.startOfToday();
  /* yesterday sits inside this window and it is unfinished, so unpressing alone would be undone
     immediately by inheritance - the exact failure that makes retiring Off more than a deleted branch */
  const t=activeTask(c,{id:'carry',start:B-2*DAY,end:B+2*DAY,included:true,pct:10});
  c.state.tasks=[t];
  assert.strictEqual(c.isInheritedToday(t),true,'precondition: inheritance would carry it');

  c.setIncludedOff('carry');
  const got=c.state.tasks.find(x=>x.id==='carry');
  assert.strictEqual(got.included,null,'unpressed, never "off"');
  assert.strictEqual(got.snoozeUntil,B+DAY,'snoozed through today so the unpress actually takes effect');
  assert.strictEqual(c.isActiveToday(got),false,'and it really is out of today');
  assert.strictEqual(c.isActiveOn(got,B+2*DAY),true,'...but tomorrow it returns on its own - no dead end');
});

/* ---------- §5 the 3x2 projection ---------- */

test('V2.9 selectionProjection fills a 3x2 grid with per-column and per-row counts', () => {
  const c=make(); const B=c.startOfToday();
  const tasks=[
    activeTask(c,{id:'o-in', start:B-3*DAY,end:B-DAY,included:true, pct:10}),  /* overdue · included */
    activeTask(c,{id:'e-in', start:B-2*DAY,end:B+2*DAY,included:true,pct:10}), /* existing · included */
    activeTask(c,{id:'n-in', start:B,       end:B+DAY,included:true}),          /* new · included */
    activeTask(c,{id:'n-un', start:B,       end:B+DAY,included:null}),          /* new · undecided */
    activeTask(c,{id:'x-in', start:null,    end:null, included:true})           /* extra · included */
  ];
  c.state.tasks=tasks;
  const p=c.selectionProjection(tasks);

  /* join, not deepStrictEqual: the app runs in a VM realm, so its Array has a different prototype */
  assert.strictEqual(p.keys.join(','),'overdue,existing,new,extra');
  /* every task is placed exactly once */
  const placed=p.keys.reduce((n,k)=>n+p.cells[k].included.length+p.cells[k].excluded.length,0);
  assert.strictEqual(placed,tasks.length,'nothing falls out of the grid');
  assert.strictEqual(p.rowCount.included+p.rowCount.excluded,tasks.length,'row counts are exhaustive');
  assert.strictEqual(p.keys.reduce((n,k)=>n+p.colCount[k],0),tasks.length,'column counts are exhaustive');

  assert.ok(p.cells.new.included.some(t=>t.id==='n-in'));
  assert.ok(p.cells.new.excluded.some(t=>t.id==='n-un'),'undecided sits in the Excluded row');
  assert.ok(p.cells.extra.included.some(t=>t.id==='x-in'));
});

test('V2.9 selectionProjection ignores archived tasks', () => {
  const c=make(); const B=c.startOfToday();
  const live=activeTask(c,{id:'live',start:B,end:B+DAY,included:true});
  const gone=activeTask(c,{id:'gone',start:B,end:B+DAY,included:true,archivedAt:B-DAY});
  c.state.tasks=[live,gone];
  const p=c.selectionProjection(c.state.tasks);
  assert.strictEqual(p.rowCount.included,1,'archived work is not part of today\'s selection');
});

/* ---------- §3 Eisenhower ---------- */

test('V2.9 urgency is derived from dates and undated work is never urgent', () => {
  const c=make(); const B=c.startOfToday();
  c.state.settings=Object.assign({},c.state.settings,{eisenhowerUrgentDays:2});
  const overdue=activeTask(c,{id:'overdue',start:B-3*DAY,end:B-DAY});
  const soon=activeTask(c,{id:'soon',start:B+DAY,end:B+2*DAY});
  const far=activeTask(c,{id:'far',start:B+9*DAY,end:B+10*DAY});
  const spanning=activeTask(c,{id:'spanning',start:B-DAY,end:B+9*DAY});
  const undated=activeTask(c,{id:'undated',start:null,end:null});
  c.state.tasks=[overdue,soon,far,spanning,undated];

  assert.strictEqual(c.isUrgent(overdue,B),true,'overdue is urgent');
  assert.strictEqual(c.isUrgent(soon,B),true,'due inside the horizon is urgent');
  assert.strictEqual(c.isUrgent(far,B),false,'due beyond the horizon is not urgent');
  assert.strictEqual(c.isUrgent(spanning,B),true,'today inside the window is urgent');
  assert.strictEqual(c.isUrgent(undated,B),false,'undated work is never urgent');
});

test('V2.9 the urgency horizon honours the eisenhowerUrgentDays setting', () => {
  const c=make(); const B=c.startOfToday();
  const t=activeTask(c,{id:'t',start:B+4*DAY,end:B+4*DAY});
  c.state.tasks=[t];
  c.state.settings=Object.assign({},c.state.settings,{eisenhowerUrgentDays:2});
  assert.strictEqual(c.isUrgent(t,B),false,'outside a 2-day horizon');
  c.state.settings=Object.assign({},c.state.settings,{eisenhowerUrgentDays:7});
  assert.strictEqual(c.isUrgent(t,B),true,'inside a 7-day horizon');
});

test('V2.9 importance is declared via priority, never inferred', () => {
  const c=make();
  assert.strictEqual(c.isImportant({priority:1}),true);
  assert.strictEqual(c.isImportant({priority:2}),true);
  assert.strictEqual(c.isImportant({priority:3}),false);
  assert.strictEqual(c.isImportant({priority:4}),false);
  assert.strictEqual(c.isImportant({}),false,'the normalizeTask default (4) reads as not-important');
});

test('V2.9 quadrantOf maps the two axes onto the four cells', () => {
  const c=make(); const B=c.startOfToday();
  c.state.settings=Object.assign({},c.state.settings,{eisenhowerUrgentDays:2});
  const mk=(id,priority,start,end)=>activeTask(c,{id,priority,start,end});
  const doIt   =mk('do',1,B-DAY,B);          /* important + overdue */
  const sched  =mk('sched',1,B+9*DAY,B+9*DAY);
  const deleg  =mk('deleg',4,B-DAY,B);
  const drop   =mk('drop',4,B+9*DAY,B+9*DAY);
  c.state.tasks=[doIt,sched,deleg,drop];

  assert.strictEqual(c.quadrantOf(doIt,B),'do');
  assert.strictEqual(c.quadrantOf(sched,B),'schedule');
  assert.strictEqual(c.quadrantOf(deleg,B),'delegate');
  assert.strictEqual(c.quadrantOf(drop,B),'drop');

  const p=c.eisenhowerProjection(c.state.tasks,B);
  assert.strictEqual(p.do.length,1);
  assert.strictEqual(p.schedule.length,1);
  assert.strictEqual(p.delegate.length,1);
  assert.strictEqual(p.drop.length,1);
  assert.strictEqual(p.do.length+p.schedule.length+p.delegate.length+p.drop.length,4,
    'every task lands in exactly one quadrant');
});

test('V2.9 a quadrant drag writes priority ONLY and never touches dates', () => {
  const c=make(); const B=c.startOfToday();
  const t=activeTask(c,{id:'t',priority:4,start:B+9*DAY,end:B+9*DAY});
  c.state.tasks=[t];
  const start0=t.start, end0=t.end;

  c.setQuadrantImportance('t',true);
  let got=c.state.tasks.find(x=>x.id==='t');
  assert.strictEqual(got.priority,2,'promoted into the important row');
  assert.strictEqual(got.start,start0,'start is untouched');
  assert.strictEqual(got.end,end0,'end is untouched — a drop must never silently reschedule work');

  c.setQuadrantImportance('t',false);
  got=c.state.tasks.find(x=>x.id==='t');
  assert.strictEqual(got.priority,3);
  assert.strictEqual(got.end,end0,'still untouched');
});

/* ---------- §6 the Gantt inclusion division ---------- */

test('V2.9 inclusionProjection emits the same band shape sectionProjection does', () => {
  const c=make(); const B=c.startOfToday();
  const inTask=activeTask(c,{id:'in',start:B,end:B+DAY,included:true});
  const outTask=activeTask(c,{id:'out',start:B,end:B+DAY,included:null}); /* V2.11: unpressed is the excluded state */
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
  const root=activeTask(c,{id:'root',start:B,end:B+DAY,included:null});
  const kid=activeTask(c,{id:'kid',parentId:'root',start:B,end:B+DAY,included:true});
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
