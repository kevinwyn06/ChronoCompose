// Chain 6 block 47: retire ghost PAINT and the fourth (Hour) zoom label without changing
// ghostSpan's scheduling/inclusion semantics.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

test('ghost paint-only API and hour-grid threshold are retired', () => {
  const c=make();
  assert.equal(typeof c.ghostSpan, 'function', 'the scheduling predicate survives');
  assert.equal(c.ghostDrawSpan, undefined, 'the render-only widened span is deleted');
  assert.equal(c.ghostPaint, undefined, 'gradient/dotted ghost paint is deleted');
  assert.equal(c.GANTT_HOUR_GRID_DAYW, undefined, 'there is no hour-grid zoom threshold');
  for(const key of ['GHOST_FILL_HOLD','GHOST_FILL_FADE','GHOST_DOTS_HOLD','GHOST_DOTS_FADE',
    'GHOST_BOTH_CORE','GHOST_BOTH_LO','GHOST_BOTH_HI','GHOST_VIEW_FRAC']){
    assert.equal(c[key], undefined, key+' is paint-only and must be deleted');
  }
});

test('percent fill is a plain solid fill with no retired ghost mask fields', () => {
  const c=make();
  assert.equal(JSON.stringify(c.pctFillPaint(45)),
    '{"width":"45%","background":"var(--success-strong)"}');
  assert.equal(c.pctFillPaint(0), null);
});

test('Gantt zoom reports exactly Month, Week, and Day', () => {
  const c=make();
  const labels=new Set([3, 35, 36, 63, 64, 240, c.GANTT_DAYW_MAX].map(w=>c.ganttZoomLabel(w)));
  assert.deepEqual([...labels], ['Month','Week','Day']);
  assert.equal(c.ganttZoomLabel(99999), 'Day', 'wide continuous zoom never becomes Hour');
});

test('an open-edge drag starts at the same virtual edge the bar paints', () => {
  const c=make(), B=c.startOfToday();
  const t=c.normalizeTask({id:'open',name:'Open',start:B,end:null});
  c.state.tasks=[t];
  c._tl={start:B-10*DAY,days:60}; c._vwin={d0:7,d1:19};
  c._occById={open:[{idx:0,start:B,end:B+DAY,ghost:true,ghostStart:false,ghostEnd:true}]};
  c.startBarDrag({button:0,clientX:100,preventDefault(){},stopPropagation(){}},t,0,'end');
  assert.equal(c.dragState.origStart,B, 'the committed edge stays on its real date');
  assert.equal(c.dragState.origEnd,c.ganttDayAt(c._tl.start,c._vwin.d1-1),
    'the missing edge starts on the last inclusive painted day, not the exclusive boundary or finite ghostSpan data');
});

test('post-block-36 inclusion output stays byte-identical while ghost paint is deleted', () => withNow(FIXED_NOW, () => {
  const c=make(), B=c.startOfToday();
  const tasks=[
    c.normalizeTask({id:'bare',name:'Bare'}),
    c.normalizeTask({id:'today',name:'Today',start:B,end:B+DAY}),
    c.normalizeTask({id:'future',name:'Future',start:B+2*DAY,end:B+3*DAY}),
    c.normalizeTask({id:'past-open',name:'Past open',start:B-DAY,end:null}),
    c.normalizeTask({id:'due',name:'Due',start:null,end:B})
  ];
  c.state.tasks=tasks;
  const bytes=JSON.stringify(tasks.map(t=>({
    id:t.id,
    eligible:c.isEligibleToday(t,tasks),
    inherited:c.isInheritedToday(t),
    activeToday:c.isActiveOn(t,B),
    activeTomorrow:c.isActiveOn(t,B+DAY),
    incl:c.inclState(t)
  })));
  assert.equal(bytes,
    '[{"id":"bare","eligible":true,"inherited":false,"activeToday":true,"activeTomorrow":true,"incl":"pressed"},'+
    '{"id":"today","eligible":true,"inherited":false,"activeToday":true,"activeTomorrow":true,"incl":"pressed"},'+
    '{"id":"future","eligible":false,"inherited":false,"activeToday":false,"activeTomorrow":false,"incl":"unpressed"},'+
    '{"id":"past-open","eligible":true,"inherited":true,"activeToday":true,"activeTomorrow":true,"incl":"pressed"},'+
    '{"id":"due","eligible":true,"inherited":true,"activeToday":true,"activeTomorrow":false,"incl":"pressed"}]');
}));
