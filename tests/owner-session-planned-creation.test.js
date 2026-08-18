const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, withNow, FIXED_NOW } = require('./_load.js');

function quick(c, text, choice='anchor'){
  c.setState({ quickText:text, quickChoice:choice });
  c.runQuickAdd('bottom');
  return c.state.tasks.at(-1);
}

test('quick add preserves a typed duration through every chooser path', () => withNow(FIXED_NOW, () => {
  const c=make();
  const bare=quick(c, 'write report 30m');
  assert.equal(bare.planned, 30);
  assert.equal(bare.start, null);
  assert.equal(bare.name, 'write report');
  assert.equal(quick(c, 'write report for 30m').planned, 30);
  assert.equal(quick(c, 'meeting tomorrow for 30m', 'anchor').planned, 30);
  assert.equal(quick(c, 'meeting tomorrow for 30m', 'due').planned, 30);
}));

test('quick add without a duration is unestimated and receives the default slice', () => withNow(FIXED_NOW, () => {
  const c=make(), t=quick(c, 'clear inbox');
  assert.equal(t.planned, null);
  assert.equal(c.requestedMinutes(t), c.DEFAULT_TASK_MINUTES);
}));

test('new subtasks and imported all-day events start unestimated', () => {
  const c=make(), p=activeTask(c, {id:'p', name:'Parent'});
  c.state.tasks=[p];
  c.addSubtask('p');
  assert.equal(c.state.tasks.find(t=>t.parentId==='p').planned, null);

  const tasks=[];
  c.mergeCalendarEvents(tasks, [{cid:'cal1', items:[{
    id:'holiday', status:'confirmed', summary:'Holiday', description:'',
    start:{date:'2026-08-20'}, end:{date:'2026-08-21'}
  }]}], {}, {cal1:{id:'cal1', summary:'Work'}}, {});
  assert.equal(tasks[0].planned, null);
});

test('all-day cleanup is order-independent with planned-null-unset', () => {
  const c=make(), first=[{allDay:true, planned:60}], second=[{allDay:true, planned:60}];
  c.migrateAllDayPlanned(first); c.migratePlannedNull(first);
  c.migratePlannedNull(second); c.migrateAllDayPlanned(second);
  assert.equal(first[0].planned, null);
  assert.equal(second[0].planned, null);
});

test('a typed zero remains deliberate and receives zero minutes', () => {
  const c=make(), t=activeTask(c, {id:'zero', planned:null});
  c.state.tasks=[t];
  c.setPlanned('zero', '0');
  assert.equal(c.state.tasks[0].planned, 0);
  assert.equal(c.requestedMinutes(c.state.tasks[0]), 0);
});

test('mixed-day allotment distinguishes legacy zero from unestimated null', () => {
  const c=make(), B=c.startOfToday();
  cleanDay(c, '02:00');
  const estimated=activeTask(c, {id:'estimated', planned:60});
  const legacy=activeTask(c, {id:'unset', planned:0});
  c.state.tasks=[legacy, estimated];
  const before=c.computeAllotted(c.state.tasks, B);
  assert.equal(before.unset.allotted, 0);
  assert.equal(before.estimated.allotted, 60);

  c.state.tasks=[activeTask(c, {id:'unset', planned:null}), estimated];
  const after=c.computeAllotted(c.state.tasks, B);
  assert.equal(after.unset.allotted, c.DEFAULT_TASK_MINUTES);
  assert.equal(after.estimated.allotted, 60);
});
