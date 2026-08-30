const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const DAY = 86400000;
function comp(){ const c = make(); c.state.tasks = []; return c; }
function dated(c, id, fromDays, toDays, extra){
  const B = c.startOfToday();
  return c.normalizeTask(Object.assign({ id, name:id, start:B+fromDays*DAY, end:B+toDays*DAY }, extra||{}));
}

test('a span inside the window matches', () => {
  const c = comp(), B = c.startOfToday();
  assert.equal(c.horizonMatch(dated(c,'a',1,3), B, 7), true);
});

test('a span straddling the far edge still matches', () => {
  const c = comp(), B = c.startOfToday();
  assert.equal(c.horizonMatch(dated(c,'a',5,20), B, 7), true);
});

test('a span entirely beyond the window does not match', () => {
  const c = comp(), B = c.startOfToday();
  assert.equal(c.horizonMatch(dated(c,'a',30,32), B, 7), false);
});

test('a span entirely in the past still matches — overdue work never leaves', () => {
  const c = comp(), B = c.startOfToday();
  assert.equal(c.horizonMatch(dated(c,'a',-9,-8), B, 7), true);
});

test('a dateless task passes every horizon, via ghostSpan', () => {
  const c = comp(), B = c.startOfToday();
  const t = c.normalizeTask({ id:'g', name:'g' });
  for (const d of [7,14,30,91,183,365]) assert.equal(c.horizonMatch(t, B, d), true);
});

test('an explicitly included task survives any window', () => {
  const c = comp(), B = c.startOfToday();
  assert.equal(c.horizonMatch(dated(c,'a',300,301,{included:true}), B, 7), true);
});

test('a yearly repeat 300 days out matches 1y and not 1m', () => {
  const c = comp(), B = c.startOfToday();
  const start = B + 300*DAY;
  const t = c.normalizeTask({ id:'b', name:'birthday', start, end:start+DAY-1, recur:{ kind:'year', every:1 } });
  assert.equal(c.horizonMatch(t, B, 365), true);
  assert.equal(c.horizonMatch(t, B, 30), false);
});

test('a daily repeat matches the shortest window', () => {
  const c = comp(), B = c.startOfToday();
  const t = c.normalizeTask({ id:'d', name:'daily', start:B, end:B+DAY-1, recur:{ kind:'day', every:1 } });
  assert.equal(c.horizonMatch(t, B, 7), true);
});

test('hasFilters reports an active horizon, and the active notch clears', () => {
  const c = comp();
  assert.equal(c.hasFilters(), false);
  c.setHorizon('1w');
  assert.equal(c.state.horizon, '1w');
  assert.equal(c.hasFilters(), true);
  c.setHorizon('1w');
  assert.equal(c.state.horizon, null);
});
