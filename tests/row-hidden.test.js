const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

const task = (c, id, over) => c.normalizeTask(Object.assign({
  id, name:id, type:'Proportional', planned:30, included:true,
}, over || {}));

test('rowHidden defaults false and is a mirrored task field', () => {
  const c = make();
  const t = task(c, 'a');
  assert.equal(t.rowHidden, false);
  assert.equal(c.SYNC_FIELDS().includes('rowHidden'), true);
  assert.equal(c.syncRowOf(t).rowHidden, false);
});

test('rowProjectionItems replaces only consecutive hidden rows with truthful runs', () => {
  const c = make();
  const rows = [task(c,'a'), task(c,'b',{rowHidden:true}), task(c,'c',{rowHidden:true}),
    task(c,'d'), task(c,'e',{rowHidden:true})];
  const items = c.rowProjectionItems(rows);
  assert.deepEqual(items.map(x=>x.kind), ['task','hidden','task','hidden']);
  assert.deepEqual(items[1].tasks.map(t=>t.id), ['b','c']);
  assert.deepEqual(items[3].tasks.map(t=>t.id), ['e']);
});

test('section boundaries keep adjacent hidden tasks in separate reachable markers', () => {
  const c = make();
  c.state.sections = [{id:'s1',name:'One',order:0},{id:'s2',name:'Two',order:1}];
  c.state.groupBy = 'section';
  const proj = c.sectionProjection([
    task(c,'a',{sectionId:'s1',rowHidden:true}), task(c,'b',{sectionId:'s2',rowHidden:true}),
  ]);
  assert.equal(proj.length, 2);
  assert.deepEqual(proj.map(sec=>c.rowProjectionItems(sec.tasks)[0].tasks.map(t=>t.id)), [['a'],['b']]);
  assert.equal(c.sectionGeometry(proj).hiddenRuns.length, 2);
});

test('hidden rows leave compact geometry slots while visible task indices remain aligned', () => {
  const c = make();
  const rows = [task(c,'a'), task(c,'b',{rowHidden:true}), task(c,'c',{rowHidden:true}), task(c,'d')];
  const sections = [{id:null,name:null,flat:true,collapsed:false,tasks:rows}];
  assert.deepEqual(c.flattenSections(sections).map(t=>t.id), ['a','d']);
  const g = c.sectionGeometry(sections);
  assert.deepEqual(g.yTop, [0, c.rowH + c.ROW_HIDDEN_H]);
  assert.equal(g.hiddenRuns.length, 1);
  assert.deepEqual(g.hiddenRuns[0].ids, ['b','c']);
  assert.equal(g.hiddenRuns[0].top, c.rowH);
  assert.equal(g.bodyH, c.rowH * 2 + c.ROW_HIDDEN_H);
});

test('hide/show uses commit, preserves order, and remote-wins sync carries the state', () => {
  const c = make();
  c.state.tasks = [task(c,'a'), task(c,'b'), task(c,'c')];
  c.setRowsHidden(['b'], true);
  assert.deepEqual(c.state.tasks.map(t=>t.id), ['a','b','c']);
  assert.equal(c.state.tasks[1].rowHidden, true);

  const local = c.state.tasks.map(t=>Object.assign({},t,{updatedAt:100}));
  const remote = c.syncRowOf(Object.assign({},local[1],{rowHidden:false,updatedAt:200}));
  remote.updated_at = 200; delete remote.updatedAt;
  const out = c.applyRemoteSnapshot(local, [remote], {});
  assert.equal(out.find(t=>t.id==='b').rowHidden, false);
  assert.deepEqual(out.map(t=>t.id), ['a','b','c']);
});

test('row hiding does not change inclusion, scheduling shape, or Google Calendar payload', () => {
  const c = make();
  const t = task(c,'a',{start:c.startOfToday(),end:c.startOfToday()+c.DAY,calendarId:'cal',eventId:'ev'});
  const beforeActive = c.isActiveToday(t);
  const beforeBody = c.eventBodyOf(t,true);
  t.rowHidden = true;
  assert.equal(c.isActiveToday(t), beforeActive);
  assert.deepEqual(c.eventBodyOf(t,true), beforeBody);
});

test('sorting and filtering only change the projection; hidden persisted order is untouched', () => {
  const c = make();
  c.state.tasks = [task(c,'z',{rowHidden:true,priority:2}), task(c,'a',{priority:1}), task(c,'m',{rowHidden:true,priority:3})];
  c.state.sort = {key:'name',dir:'asc'};
  const sorted = c.visibleTasks();
  assert.deepEqual(sorted.map(t=>t.id), ['a','m','z']);
  assert.deepEqual(c.rowProjectionItems(sorted).map(x=>x.kind), ['task','hidden']);
  assert.deepEqual(c.state.tasks.map(t=>t.id), ['z','a','m'], 'persisted order never follows view sorting');

  c.state.sort = null;
  c.state.colFilters = {priority:{set:[1]}};
  assert.deepEqual(c.visibleTasks().map(t=>t.id), ['a'], 'ordinary filters still apply to hidden tasks');
  assert.deepEqual(c.state.tasks.map(t=>t.id), ['z','a','m']);
});
