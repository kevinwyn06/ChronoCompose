const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

test('V2.2 eligibility requires today in the window and completed dependencies, not planned time', () => {
  const c=make(); const B=c.startOfToday();
  const predecessor=activeTask(c,{id:'pred',pct:100});
  const eligible=activeTask(c,{id:'eligible',start:B-DAY,end:B+DAY,deps:['pred'],planned:0});
  const blocked=activeTask(c,{id:'blocked',start:B-DAY,end:B+DAY,deps:['open'],planned:60});
  const open=activeTask(c,{id:'open',pct:40});
  const future=activeTask(c,{id:'future',start:B+DAY,end:B+2*DAY,deps:[],planned:60});
  const tasks=[predecessor,eligible,blocked,open,future]; c.state.tasks=tasks;

  assert.strictEqual(c.isEligibleToday(eligible,tasks),true,'zero-planned task remains eligible');
  assert.strictEqual(c.isEligibleToday(blocked,tasks),false,'unfinished predecessor hatches the task');
  assert.strictEqual(c.isEligibleToday(future,tasks),false,'out-of-window task is ineligible');
});

test('V2.2 inheritance carries yesterday-scheduled unfinished work but respects done and explicit off', () => {
  const c=make(); const B=c.startOfToday();
  const inherited=activeTask(c,{id:'carry',start:B-2*DAY,end:B-DAY,included:null,pct:35});
  const done=activeTask(c,{id:'done',start:B-2*DAY,end:B-DAY,included:null,pct:100});
  const off=activeTask(c,{id:'off',start:B-2*DAY,end:B-DAY,included:false,pct:20});
  const manual=activeTask(c,{id:'manual',start:B+DAY,end:B+2*DAY,included:null,pct:10,
    pin:{day:B-DAY,start:B-DAY+9*3600000,dur:30}});
  const recurDone=activeTask(c,{id:'recur-done',start:B-DAY,end:B-DAY+3600000,included:null,pct:0,
    recur:{kind:'day',n:1,overrides:{0:{pct:100,completion:B-DAY+1}},shifts:[]}});
  c.state.tasks=[inherited,done,off,manual,recurDone];

  assert.strictEqual(c.isInheritedToday(inherited),true);
  assert.strictEqual(c.isActiveToday(inherited),true,'inherited legacy task is auto-included today');
  assert.strictEqual(c.isOptedOut(inherited),false,'inherited auto-inclusion is not rendered as opted out');
  assert.strictEqual(c.inclState(inherited),'pressed','inherited task receives pressed depth plus shaded tint');
  assert.strictEqual(c.isInheritedToday(done),false,'completed work does not inherit');
  assert.strictEqual(c.isInheritedToday(off),false,'explicit unpress wins over inheritance');
  assert.strictEqual(c.isInheritedToday(manual),true,'yesterday manual placement inherits');
  assert.strictEqual(c.isInheritedToday(recurDone),false,'completed yesterday occurrence does not inherit its series');
});

/* PP-EXT V2.9 §2: the V2.2 "texture and tint compose with the caller background" test is RETIRED with its
   contract — `ambientRowBackground` no longer exists. What replaces it is the invariant that actually
   matters after the strip: the paint is gone, but the predicates behind it are NOT, because
   `isInheritedToday` decides what is on today via isActiveOn. Deleting the encoding must not quietly
   delete the semantics. */
test('V2.9 the ambient encoding is gone but its predicates still decide what is on today', () => {
  const c=make(); const B=c.startOfToday();
  const pred=activeTask(c,{id:'pred',pct:0});
  const both=activeTask(c,{id:'both',start:B-2*DAY,end:B-DAY,included:true,deps:['pred']});
  c.state.tasks=[pred,both];

  assert.strictEqual(typeof c.ambientRowBackground,'undefined','the ambient background composer is deleted');
  /* The two predicates the deleted paint used to read still report the same facts. */
  assert.strictEqual(c.isEligibleToday(both,c.state.tasks),false,'ineligibility survives as a fact');
  assert.strictEqual(c.isInheritedToday(both),true,'inheritance survives as a fact');
  assert.strictEqual(c.isActiveToday(both),true,'and still carries the task onto today');
});
