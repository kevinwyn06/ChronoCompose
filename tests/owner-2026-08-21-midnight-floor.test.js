// Owner ruling 2026-08-21 — the bare-day midnight floor is MIDNIGHT-UNTIMED.
//
// Diagnosis: docs/superpowers/findings/2026-08-21-bare-day-midnight-floor.md
//
// The floor was skipped whenever `days?|weeks?|months?|hours?` matched `text`, the WHOLE raw title —
// the same whole-string mistake the `dueCue` guard twenty lines below already fixed once. So
// `plan my day today` anchored at the current instant, which `hasStartTime` derives as a real clock,
// making it a keep-clear Point that reserves no minutes; `plan today` scheduled normally.
//
// The ruling goes one step further than scoping the regex: a genuine relative offset (`in 3 days`)
// names a DAY, not an hour, so the floor applies whenever the phrase carries no clock — `relOffset`
// included. The implied hour was an artifact of chrono's reference instant, never user intent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const at = (c, text) => c.parseDateText(text, Date.now());

// A phrase carrying no clock must land on midnight of the day it names.
const MIDNIGHT_PHRASES = [
  'test today',            // the control: always worked
  'plan my day today',     // "day"   anywhere in the title
  'review my week friday', // "week"  anywhere in the title
  'month review today',    // "month" anywhere in the title
  'log my hours today',    // "hours" anywhere in the title
  'call in 3 days',        // a genuine relOffset — ruled midnight-untimed
  'gym in 2 weeks',
  'renew in 2 months',     // the `moM` branch, which set relOffset explicitly
];

for(const phrase of MIDNIGHT_PHRASES){
  test(`midnight floor: "${phrase}" lands at midnight`, () => {
    withNow(FIXED_NOW, () => {
      const c = make();
      const p = at(c, phrase);
      assert.notEqual(p.date, null, 'the phrase must still parse a date');
      const d = new Date(p.date);
      assert.equal(
        `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`, '0:0:0',
        `"${phrase}" carries no clock, so it names a day — not an hour`
      );
      assert.equal(p.clock, false, 'no clock was written');
    });
  });
}

test('midnight floor: an untimed day phrase is not a keep-clear Point', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    for(const phrase of ['plan my day today', 'call in 3 days']){
      const t = c.normalizeTask(Object.assign({ id:'t1' }, c.shapeParsedTask(at(c, phrase), 'anchor')));
      assert.equal(c.isPointTask(t), false, `"${phrase}" must schedule, not reserve zero minutes`);
    }
  });
});

// The floor must not swallow the two things that legitimately set an hour.
test('midnight floor: a written clock still wins', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = at(c, 'standup today at 4pm');
    const d = new Date(p.date);
    assert.equal(d.getHours(), 16, 'a typed clock is untouched by the floor');
    assert.equal(p.clock, true);
  });
});

test('midnight floor: a soft time-of-day window still wins', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const d = new Date(at(c, 'dinner tomorrow evening').date);
    assert.notEqual(d.getHours(), 0, 'an evening window keeps chrono\'s implied hour');
    assert.equal(at(c, 'dinner tomorrow evening').clock, false, 'a window is not a clock commitment');
  });
});
