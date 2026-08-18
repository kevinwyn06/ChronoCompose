// Owner session 2026-08-17, Block 36: "included" is a creation default chosen by
// datedness, not a permanent press applied to every task shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

function dated(c, over){
  const B=c.startOfToday();
  return c.normalizeTask(Object.assign({ id:'dated', name:'Dated', start:B+2*DAY, end:B+3*DAY }, over||{}));
}

test('new inclusion defaults are true for dateless work and null for every dated shape', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday();
  assert.equal(c.normalizeTask({id:'bare', name:'Fold clothes'}).included, true);
  assert.equal(c.normalizeTask({id:'bare-proof', name:'Fold clothes'}).includedExplicit, false,
    'dateless automatic inclusion is not a manual press');
  assert.equal(c.normalizeTask({id:'start', start:B+DAY}).included, null);
  assert.equal(c.normalizeTask({id:'end', end:B+DAY}).included, null);
  assert.equal(c.normalizeTask({id:'both', start:B+DAY, end:B+2*DAY}).included, null);
  assert.equal(c.normalizeTask({id:'pressed', start:B+DAY, end:B+2*DAY, included:true}).included, true,
    'an explicit press is a decision and still wins');
}));

test('a future dated task stays visible but inactive until one press includes it', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday();
  const t=dated(c);
  c.state.tasks=[t];
  assert.equal(c.isActiveOn(t,B), false);
  const p=c.selectionProjection(c.state.tasks);
  assert.equal(p.rowCount.included+p.rowCount.excluded, 1, 'the sheet projection does not drop it');
  c.setIncludedOn(t.id);
  const pressed=c.state.tasks[0];
  assert.equal(pressed.included, true);
  assert.equal(pressed.includedExplicit, true, 'the manual press records provenance');
  assert.equal(c.isActiveOn(pressed,B), true, 'an intentional press overrides the date window');
}));

test('Google Calendar imports inherit the dated default and do not enter today early', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday(), tasks=[];
  const start=new Date(B+2*DAY+9*3600000).toISOString();
  const end=new Date(B+2*DAY+10*3600000).toISOString();
  c.mergeCalendarEvents(tasks, [{cid:'cal1', items:[{
    id:'future-event', status:'confirmed', summary:'Future meeting', description:'',
    start:{dateTime:start}, end:{dateTime:end}
  }]}], {}, {cal1:{id:'cal1', summary:'Work'}}, {});
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].included, null);
  assert.equal(c.isActiveOn(tasks[0],B), false);
}));

test('legacy included:true migration is idempotent and reports the representative active-today drop', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday();
  const tasks=[
    c.normalizeTask({id:'bare', name:'Fold clothes', included:true}),
    c.normalizeTask({id:'today', name:'Today', start:B, end:B+DAY, included:true}),
    c.normalizeTask({id:'future', name:'Future', start:B+2*DAY, end:B+3*DAY, included:true}),
    c.normalizeTask({id:'past', name:'Past', start:B-3*DAY, end:B-2*DAY, included:true}),
    c.normalizeTask({id:'weekly', name:'Weekly later', start:B+2*DAY+14*3600000,
      end:B+2*DAY+15*3600000, startClock:true, endClock:true, included:true,
      recur:{kind:'week', interval:1, days:[new Date(B+2*DAY).getDay()], until:null}})
  ];
  const before=tasks.filter(t=>c.isActiveOn(t,B)).length;
  assert.equal(before, 5, 'legacy unconditional presses make every fixture active');
  assert.equal(c.migrateIncludedDatedDefault(tasks), 3);
  const after=tasks.filter(t=>c.isActiveOn(t,B)).length;
  assert.equal(after, 2, 'only dateless work and a window containing today remain active');
  assert.equal(c.migrateIncludedDatedDefault(tasks), 0, 'the correction is safe on every pull');
}));

test('the local once-guard and incoming sync path both apply the legacy default correction', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday();
  c.lsSet('pp-migrations', JSON.stringify({'included-dated-default':0}));
  const local=[dated(c,{id:'local', included:true, planned:60})];
  c.runOnceMigrations(local);
  assert.equal(local[0].included, null);
  assert.equal(local[0].includedExplicit, false);
  assert.equal(JSON.parse(c.lsGet('pp-migrations'))['included-dated-default'], 1);

  const legacy=dated(c,{id:'remote', included:true, updatedAt:5000});
  const row=c.syncRowOf(legacy);
  row.owner_id='00000000-0000-0000-0000-00000000000a';
  row.updated_at=new Date(5000).toISOString();
  delete row.updatedAt;
  const pulled=c.applyRemoteSnapshot([], [row], {});
  assert.equal(pulled[0].included, null, 'an old client cannot re-seed the unconditional press');
  assert.equal(c.isActiveOn(pulled[0],B), false);
}));

test('a current explicit dated press survives incoming processing and a later remote-winning edit', () => withNow(FIXED_NOW, () => {
  const source=make();
  source.state.tasks=[dated(source,{id:'pressed-sync', included:null, updatedAt:1000})];
  source.setIncludedOn('pressed-sync');
  const pressed=source.state.tasks[0];
  assert.equal(pressed.included, true, 'the source device records the explicit press');
  assert.equal(pressed.includedExplicit, true);

  const firstRow=source.syncRowOf(pressed);
  assert.equal(firstRow.includedExplicit, true, 'manual-press provenance crosses the sync boundary');
  firstRow.owner_id='00000000-0000-0000-0000-00000000000a';
  firstRow.updated_at=new Date(pressed.updatedAt).toISOString();
  delete firstRow.updatedAt;

  const target=make();
  const firstPull=target.applyRemoteSnapshot([], [firstRow], {});
  assert.equal(firstPull[0].included, true,
    'incoming migration must not mistake a current-client explicit press for the legacy default');

  const laterRow=Object.assign({}, firstRow, {
    name:'Remote edit after press',
    updated_at:new Date(pressed.updatedAt+1000).toISOString()
  });
  const afterRemoteWin=target.applyRemoteSnapshot(firstPull, [laterRow], {});
  assert.equal(afterRemoteWin[0].name, 'Remote edit after press');
  assert.equal(afterRemoteWin[0].included, true,
    'a later remote-winning edit must not clear an explicit press as though migration were permanent');
}));
