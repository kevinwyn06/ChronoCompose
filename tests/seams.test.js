const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

test('S1 compression seam is pure and reserves, shares, then caps', () => {
  const c = make();
  const features = [
    { id:'a', planned:120, spent:30, predicted:0, predictManual:false, priority:2, labels:['deep'] },
    { id:'b', planned:60, spent:0, predicted:0, predictManual:false, priority:4, labels:[] },
    { id:'m', planned:30, spent:0, predicted:45, predictManual:true, priority:1, labels:['fixed'] },
  ];
  const before = JSON.parse(JSON.stringify(features));
  const first = c.compressionSeam(features, 300);
  const second = c.compressionSeam(features, 300);

  // By hand under the 2026-08-16 rules (reserve → share → cap):
  //   reserve: m is predictManual, so it takes its typed 45 off the top → pool = 300 − 45 = 255.
  //   share:   Σ compressible demand = 120 + 60 = 180, so a's share = 120/180 × 255 = 170 and
  //            b's share = 60/180 × 255 = 85.
  //   cap:     a is capped at demand − spent = 120 − 30 = 90; b at 60 − 0 = 60.
  //   apportion: 90 + 60 are already whole minutes, so nothing is redistributed and the remaining
  //            105 minutes of the day stay free.
  // `computed` on the reserved row is now the reserved figure itself (was a counterfactual share of
  // 43, which nothing consumed — togglePredictManual only reads it while the row is compressible).
  assert.deepEqual(first, {
    a:{ allotted:90, computed:90 },
    b:{ allotted:60, computed:60 },
    m:{ allotted:45, computed:45 },
  });
  assert.deepEqual(second, first, 'same inputs return the same allocation');
  assert.deepEqual(features, before, 'feature records are not mutated');
});

test('S1 ordering seam is pure and matches priority, EDF, then longer-first', () => {
  const c = make();
  const features = [
    { id:'p4', priority:4, due:10, rem:200, labels:['later'] },
    { id:'short', priority:1, due:20, rem:30, labels:[] },
    { id:'long', priority:1, due:20, rem:90, labels:['deep'] },
    { id:'due', priority:1, due:10, rem:10, labels:[] },
  ];
  const before = JSON.parse(JSON.stringify(features));
  const ordered = c.orderingSeam(features);

  assert.deepEqual(ordered.map(x=>x.id), ['due','long','short','p4']);
  assert.notStrictEqual(ordered, features, 'returns a new array');
  assert.deepEqual(features, before, 'input order and feature records are not mutated');
  assert.deepEqual(c.orderingSeam(features).map(x=>x.id), ordered.map(x=>x.id));
});
