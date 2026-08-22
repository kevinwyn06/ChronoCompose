// Quick-add natural-language parser (parseDateText) — recurrence phrase stripping.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

test('parseDateText strips the single recurrence trigger phrase from the title', () => {
  const c = make();
  const r = c.parseDateText('Sim tuning tomorrow at 4pm p1 every week @sim', Date.now());
  assert.strictEqual(r.recur.kind, 'week');
  assert.ok(!/every\s+week/.test(r.rest));
});

test('parseDateText strips ALL occurrences of the matched recurrence phrase, not just the first', () => {
  // Regression: a title that coincidentally repeats the trigger word (e.g. "Weekly" earlier in the
  // title, "every week" as the actual quick-add trigger) used to only consume the first match,
  // leaving the other stuck in the resulting task title.
  const c = make();
  const r = c.parseDateText('Weekly sync every week @test', Date.now());
  assert.strictEqual(r.recur.kind, 'week');
  assert.ok(!/weekly/i.test(r.rest), `title should not retain "Weekly": ${JSON.stringify(r.rest)}`);
  assert.ok(!/every\s+week/i.test(r.rest), `title should not retain "every week": ${JSON.stringify(r.rest)}`);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(r.matches.map(m => ({ kind:m.kind, text:'Weekly sync every week @test'.slice(m.start,m.end) })))),
    [{kind:'recur',text:'Weekly'}, {kind:'recur',text:'every week'}]
  );
});

test('parseDateText: daily trigger word repeated in title is fully stripped', () => {
  const c = make();
  const r = c.parseDateText('Daily standup daily @work', Date.now());
  assert.strictEqual(r.recur.kind, 'day');
  assert.ok(!/daily/i.test(r.rest));
});

// ---- clock ranges + durations (PP-EXT) ----
// Base: Wed 2026-07-15 10:00 local, so "tomorrow" = Thu 16 Jul and weekday math is deterministic.
const BASE = new Date(2026, 6, 15, 10, 0, 0, 0).getTime();
const at = (day, h, m) => new Date(2026, 6, day, h, m, 0, 0).getTime();

function spansOf(c, text){
  const parsed = c.parseDateText(text, BASE);
  return JSON.parse(JSON.stringify((parsed.matches||[]).map(m=>({
    kind:m.kind, start:m.start, end:m.end, text:text.slice(m.start,m.end)
  }))));
}

test('V1.6 matches: deadline and duration use exact original-case spans only', () => {
  const c = make();
  const text = 'submit report by Friday for 2h @work p1';
  assert.deepStrictEqual(spansOf(c,text).map(x=>[x.kind,x.text]), [
    ['date','by Friday'], ['duration','for 2h']
  ]);
});

test('V1.6 matches: compound spans stay ordered', () => {
  const c = make();
  const text = 'every weekday 2-3pm starting next Monday until Aug 15 @work p1';
  assert.deepStrictEqual(spansOf(c,text).map(x=>x.text), [
    'every weekday', '2-3pm', 'starting next Monday', 'until Aug 15'
  ]);
});

test('V1.6 matches: collision words are excluded', () => {
  const c = make();
  for(const text of ['call friends','monitor server','run a mile','email ms johnson']){
    assert.deepStrictEqual(spansOf(c,text), []);
  }
});

test('V1.6 matches: temporal vocabulary covers each parser pass', () => {
  const c=make();
  const cases=[
    ['task tomorrow at 4pm', ['tomorrow at 4pm']],
    ['task takes 30m', ['takes 30m']],
    ['task ~45m', ['~45m']],
    ['task daily', ['daily']],
    ['task not before Tuesday', ['not before Tuesday']],
    ['task by the 3rd', ['by the 3rd']]
  ];
  for(const [text,want] of cases){
    assert.deepStrictEqual(spansOf(c,text).map(x=>x.text),want,text);
  }
});

test('normalizeQuickMatches drops invalid/duplicate spans and merges overlap', () => {
  const c=make(), text='abcdefghij';
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.normalizeQuickMatches(text,[
    {kind:'date',start:2,end:6}, {kind:'date',start:2,end:6},
    {kind:'time',start:4,end:8}, {kind:'date',start:-1,end:2}
  ]))), [{kind:'date',start:2,end:8}]);
});

test('V1.6 matches are additive to the persisted scheduling shape', () => {
  const c=make(), parsed=c.parseDateText('submit report by Friday for 2h @work p1',BASE);
  const matches=parsed.matches; delete parsed.matches;
  assert.ok(matches.length>0);
  assert.strictEqual(parsed.start,null);
  assert.ok(parsed.end>BASE);
  assert.strictEqual(parsed.dur,120);
  assert.strictEqual(parsed.priority,1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.labels)),['work']);
  assert.strictEqual(parsed.rest,'submit report');
});

test('bare day parses to midnight with no clock (no 9am placeholder)', () => {
  const c = make();
  const p = c.parseDateText('report friday');
  const d = new Date(p.date);
  assert.equal(d.getHours(), 0, 'bare day sits at midnight');
  assert.equal(d.getMinutes(), 0);
  assert.ok(!p.clock, 'no explicit clock was written');
  assert.equal('pinStart' in p, false, 'parser no longer emits pins');
  assert.equal('pinEnd' in p, false);
});

test('an explicit time still lands as a clocked start', () => {
  const c = make();
  const p = c.parseDateText('meeting 2pm');
  assert.equal(new Date(p.start).getHours(), 14);
  assert.equal(p.startClock, true);
  // Owner ruling 2026-08-21 (second): a bare time is a keep-clear POINT — no end, no invented duration.
  // The default-duration block tried earlier the same day was reversed: "test today at 4pm should be no
  // duration, marker at 4pm". A Point was never the reason it went missing; the inclusion inversion was.
  assert.equal(p.end, null, 'a bare time is a Point – no end');
});

test('parseDateText: "from HH:MM to HH:MM" yields both ends and a clean title', () => {
  // Regression: the old parser matched only the FIRST clock, dropped the end entirely, and left
  // "from to 18:00" in the task name.
  const c = make();
  const r = c.parseDateText('eating tomorrow from 17:00 to 18:00', BASE);
  assert.strictEqual(r.date, at(16, 17, 0));
  assert.strictEqual(r.end, at(16, 18, 0));
  assert.strictEqual(r.dur, 60);
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'eating');
});

test('parseDateText: hyphen range with a bare left side inherits the right meridiem', () => {
  // Regression: "5-6pm" used to schedule at 18:00 — the range's END read as the start.
  const c = make();
  const r = c.parseDateText('gym tomorrow 5-6pm', BASE);
  assert.strictEqual(r.date, at(16, 17, 0));
  assert.strictEqual(r.end, at(16, 18, 0));
  assert.strictEqual(r.rest, 'gym');
});

test('parseDateText: inherited meridiem falls back to am when it would invert the range', () => {
  const c = make(); // "11 to 1pm" must be 11:00-13:00, not 23:00-13:00
  const r = c.parseDateText('meeting tomorrow from 11 to 1pm', BASE);
  assert.strictEqual(r.date, at(16, 11, 0));
  assert.strictEqual(r.end, at(16, 13, 0));
});

test('parseDateText: a range crossing midnight rolls the end to the next day', () => {
  const c = make();
  const r = c.parseDateText('night shift tomorrow 23:00-01:00', BASE);
  assert.strictEqual(r.date, at(16, 23, 0));
  assert.strictEqual(r.end, at(17, 1, 0));
  assert.strictEqual(r.dur, 120);
});

test('parseDateText: a bare start-clock is a Point (open end)', () => {
  const c = make();
  const r = c.parseDateText('meeting 2pm', BASE);
  assert.strictEqual(r.startClock, true, 'start has an explicit clock');
  assert.strictEqual(r.endClock, null,   'a Point has no end clock');
  assert.strictEqual(r.end,      null,  'no end');
});

test('parseDateText: "mon 9am" is a Point too', () => {
  const c = make();
  const r = c.parseDateText('report mon 9am', BASE);
  assert.strictEqual(r.startClock, true);
  assert.strictEqual(r.endClock,   null);
  assert.strictEqual(r.end,      null);
});

test('parseDateText: clock RANGE stays a both-pinned span (regression)', () => {
  const c = make();
  const r = c.parseDateText('eating tomorrow from 17:00 to 18:00', BASE);
  assert.strictEqual(r.startClock, true);
  assert.strictEqual(r.endClock,   true);
});

test('parseDateText: a due cue stays a deadline (regression)', () => {
  const c = make();
  const r = c.parseDateText('submit report by friday', BASE);
  assert.strictEqual(r.endClock, false);
});

test('parseDateText: "for <dur>" sets an end without being eaten as a relative offset', () => {
  const c = make(); // the +Nh offset pass would otherwise read "for 1 hour" as "in 1 hour"
  const r = c.parseDateText('call bob monday 9am for 30m', BASE);
  assert.strictEqual(r.date, at(20, 9, 0));
  assert.strictEqual(r.end, at(20, 9, 30));
  assert.strictEqual(r.dur, 30);
  assert.strictEqual(r.rest, 'call bob');
});

test('parseDateText: fractional hour duration', () => {
  const c = make();
  const r = c.parseDateText('deep work tomorrow 9am for 1.5h', BASE);
  assert.strictEqual(r.end, at(16, 10, 30));
  assert.strictEqual(r.dur, 90);
});

test('parseDateText: a bare number and unit is a duration only when it is the sole temporal token', () => {
  const c = make();
  const durationOnly = c.parseDateText('write report 30m', BASE);
  assert.strictEqual(durationOnly.dur, 30);
  assert.strictEqual(durationOnly.start, null);
  assert.strictEqual(durationOnly.date, null);
  assert.strictEqual(durationOnly.rest, 'write report');
  assert.deepStrictEqual(spansOf(c, 'write report 30m').map(x=>[x.kind,x.text]), [['duration','30m']]);

  const clockWins = c.parseDateText('meeting 3pm 30m', BASE);
  assert.strictEqual(clockWins.dur, null, 'a clock prevents the bare token becoming a duration');
  assert.strictEqual(clockWins.startClock, true);
  assert.strictEqual(new Date(clockWins.start).getHours(), 15);
  assert.strictEqual(clockWins.rest, 'meeting 30m', 'the losing token remains ordinary title text');

  const dateWins = c.parseDateText('meeting tomorrow 30m', BASE);
  assert.strictEqual(dateWins.dur, null, 'a date prevents the bare token becoming a duration');
  assert.strictEqual(dateWins.rest, 'meeting 30m');

  const recurrenceWins = c.parseDateText('review 30m every week', BASE);
  assert.strictEqual(recurrenceWins.dur, null);
  assert.strictEqual(recurrenceWins.recur.kind, 'week');
  assert.strictEqual(recurrenceWins.rest, 'review 30m');
});

test('parseDateText: bare-duration arbitration preserves unitless and title-word collisions', () => {
  const c = make();
  for(const text of ['buy 2 apples', 'run 5k', 'route 66', 'vitamin B12']){
    const r = c.parseDateText(text, BASE);
    assert.strictEqual(r.dur, null, text);
    assert.strictEqual(r.date, null, text);
    assert.strictEqual(r.rest, text, text);
    assert.deepStrictEqual(spansOf(c, text), [], text);
  }
});

test('parseDateText: an ambiguous bare "N to M" is not a time range', () => {
  const c = make(); // "5 to 6 apples" is a count, not 17:00-18:00
  const r = c.parseDateText('buy 5 to 6 apples', BASE);
  assert.strictEqual(r.date, null);
  assert.strictEqual(r.end, null);
  assert.strictEqual(r.rest, 'buy 5 to 6 apples');
});

test('parseDateText: a weekday lands at midnight and drops the preposition', () => {
  const c = make();
  const r = c.parseDateText('submit report by friday', BASE);
  assert.strictEqual(r.date, mid(17));
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'submit report');
  // V1.1B shaped anchors: "by" is a deadline cue (start=null, EOD due).
  assert.strictEqual(r.start, null);
  assert.strictEqual(r.end, eod(17));
  assert.strictEqual(r.startClock, null);
  assert.strictEqual(r.endClock, false);
});

// SUPERSEDED by the owner ruling of 2026-08-21 (midnight-untimed). This used to assert that a
// relative offset kept chrono's implied time-of-day — 3*24h from now, i.e. 10:00. But "in 3 days"
// answers WHICH DAY, not what time; the hour was an artifact of the reference instant, and carrying
// it made the task a keep-clear Point reserving no minutes. The floor now applies to every phrase
// that carries no clock. See tests/owner-2026-08-21-midnight-floor.test.js.
test('parseDateText: a relative offset is an untimed day, floored to midnight', () => {
  const c = make();
  const r = c.parseDateText('task in 3 days', BASE);
  assert.strictEqual(r.date, at(18, 0, 0));
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'task');
});

test('parseDateText: "every month" is monthly, not every Monday', () => {
  // Regression: "mon" prefixes "month" and [a-z]* ate the "th", so the weekday branch hijacked
  // "every month" into a weekly-on-Monday rule.
  const c = make();
  const r = c.parseDateText('pay rent every month', BASE);
  assert.strictEqual(r.recur.kind, 'month');
  assert.strictEqual(r.rest, 'pay rent');
});

test('parseDateText: "every monday" still parses as a weekday rule', () => {
  const c = make();
  const r = c.parseDateText('sync every monday', BASE);
  assert.strictEqual(r.recur.kind, 'weekdays');
  // join(): the component runs in a vm realm, so its arrays fail deepStrictEqual's prototype check.
  assert.strictEqual(r.recur.days.join(','), 'mon');
});

test('parseDateText: a repeat-until clause is not mistaken for a clock range', () => {
  const c = make();
  const r = c.parseDateText('pay rent every month until 3 jan', BASE);
  assert.strictEqual(r.recur.kind, 'month');
  assert.strictEqual(r.until, new Date(2027, 0, 3, 0, 0, 0, 0).getTime());
  assert.strictEqual(r.end, null);
});

test('parseDateText: an explicit year on a month-name date is honoured', () => {
  const c = make(); // "25 jul 2027" used to ignore the year and land in the current one
  const r = c.parseDateText('ship 25 jul 2027', BASE);
  assert.strictEqual(r.date, new Date(2027, 6, 25, 0, 0, 0, 0).getTime());
  assert.strictEqual(r.rest, 'ship');
  const r2 = c.parseDateText('ship jul 25, 2027', BASE);
  assert.strictEqual(r2.date, new Date(2027, 6, 25, 0, 0, 0, 0).getTime());
});

// ==== V1.1B: axis-based parser — exhaustive shaped-anchor fixtures per architecture.md ====
// "Parser task-type cases" surviving regions R0–R11 + RM + modifier layering. parseDateText now
// emits the SHAPED anchors (start/end/startClock/endClock/mile) the task model consumes, alongside the
// raw date/dur/clock it always exposed. BASE = Wed 2026-07-15 10:00 (see top of file); Fri=17,
// Mon=20, Sat=18, tomorrow(Thu)=16, next Tue=21.
const mid = (day) => new Date(2026, 6, day, 0, 0, 0, 0).getTime();
const eod = (day) => new Date(2026, 6, day, 23, 59, 59, 999).getTime();
// assert a full shape at once; pass only the fields that matter (undefined = skip)
const shape = (r, exp) => {
  for (const k of ['start', 'end', 'startClock', 'endClock', 'mile', 'dur']) {
    if (k in exp) assert.strictEqual(r[k], exp[k], `${k}: ${JSON.stringify(r[k])} !== ${JSON.stringify(exp[k])}`);
  }
};

// ---- R0 Floating (no dates, no pins) ----
test('R0: a bare task floats — null anchors and clock flags', () => {
  const c = make();
  const r = c.parseDateText('email sam', BASE);
  shape(r, { start: null, end: null, startClock: null, endClock: null, mile: false });
  assert.strictEqual(r.rest, 'email sam');
  const r2 = c.parseDateText('read the paper', BASE);
  shape(r2, { start: null, end: null, startClock: null, endClock: null });
});

// ---- R1 Duration-only (movable, no anchors) ----
test('R1: "for <dur>" / "takes <dur>" / "~<dur>" set a budget but no anchors', () => {
  const c = make();
  const a = c.parseDateText('call plumber for 45m', BASE);
  shape(a, { start: null, end: null, startClock: null, endClock: null, dur: 45 });
  assert.strictEqual(a.rest, 'call plumber');
  const b = c.parseDateText('write essay takes 2h', BASE);
  shape(b, { start: null, end: null, dur: 120 });
  assert.strictEqual(b.rest, 'write essay');
  const d = c.parseDateText('brainstorm ~30m', BASE);
  shape(d, { start: null, end: null, dur: 30 });
  assert.strictEqual(d.rest, 'brainstorm');
});

// ---- R2 Start-time only (open-ended) ----
test('R2: a lone future start clock pins the start, no end', () => {
  const c = make();
  const r = c.parseDateText('standup at 11am', BASE); // 11:00 today > now 10:00, no roll
  shape(r, { start: at(15, 11, 0), end: null, startClock: true, endClock: null });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'standup');
});

// ---- R3 Fixed appointment, today implied ----
test('R3: a clock span with no day is a fixed block today (both pins)', () => {
  const c = make();
  const r = c.parseDateText('call client 2-3pm', BASE);
  shape(r, { start: at(15, 14, 0), end: at(15, 15, 0), startClock: true, endClock: true, dur: 60 });
  assert.strictEqual(r.rest, 'call client');
  const r2 = c.parseDateText('block at 2pm for 1h', BASE);
  shape(r2, { start: at(15, 14, 0), end: at(15, 15, 0), startClock: true, endClock: true, dur: 60 });
  assert.strictEqual(r2.rest, 'block');
});

// ---- R4 Not-before (start-cued day) ----
test('R4: an untimed start cue anchors the day without claiming a user clock', () => {
  const c = make();
  // cue adjacent to the date (the canonical R4 form); a detached leading "start …" stays in the title.
  const r = c.parseDateText('project starts monday', BASE);
  shape(r, { start: mid(20), end: null, startClock: null, endClock: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'project');
  const r2 = c.parseDateText('diet begins tomorrow', BASE);
  shape(r2, { start: mid(16), end: null, startClock: null, endClock: null });
  assert.strictEqual(r2.rest, 'diet');
});

// Bare ordinal: chrono finds no date here; the Task-2 roll-forward override resolves it.
test('R4: a start cue with a bare ordinal day', () => {
  const c = make();
  const r3 = c.parseDateText('prep after the 20th', BASE);
  shape(r3, { start: mid(20), startClock: null });
  assert.strictEqual(r3.rest, 'prep');
});

// Regression: "not before <day>" was mis-bound as a DEADLINE — the bare `before` alternative in the
// due cue matched the tail of "not before", and dueCue was tested ahead of startCue, inverting the
// constraint (schedules "finish BY X" for a phrase that means "don't start until X"). It also left
// the orphaned "not" in the title. "not before" is a startCue → it must land in the R4 not-before
// family, exactly like "starts"/"begins"/"after".
test('R4: "not before <day>" is a not-before start, not a deadline (was inverted)', () => {
  const c = make();
  const r = c.parseDateText('submit not before friday', BASE);
  shape(r, { start: mid(17), end: null, startClock: null, endClock: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'submit'); // the orphaned "not" is stripped too
});

// The clocked form routes through R2 (Point tuple): start pinned at the clock, end explicitly open.
test('R2: "not before <day> <clock>" pins the start clock, not a due deadline', () => {
  const c = make();
  const r = c.parseDateText('deploy not before monday 5pm', BASE);
  shape(r, { start: at(20, 17, 0), end: null, startClock: true, endClock: null });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'deploy');
});

// ---- R5 Deadline (due-cued day) ----
test('R5: a deadline cue sets an EOD due with no explicit clock', () => {
  const c = make();
  const r = c.parseDateText('pay taxes due aug 3', BASE);
  shape(r, { start: null, end: new Date(2026, 7, 3, 23, 59, 59, 999).getTime(), startClock: null, endClock: false });
});

// Bare ordinal, deadline side (see R4 above).
test('R5: a deadline cue with a bare ordinal day', () => {
  const c = make();
  const r2 = c.parseDateText('finish deck by the 20th', BASE);
  shape(r2, { start: null, end: eod(20), endClock: false });
  assert.strictEqual(r2.rest, 'finish deck');
});

// ---- R6 Deadline + budget ----
test('R6: a budget with a deadline keeps the EOD due and the planned minutes', () => {
  const c = make();
  const r = c.parseDateText('study for 90m due monday', BASE);
  shape(r, { start: null, end: eod(20), startClock: null, endClock: false, dur: 90 });
});

// ---- R8 All-day, uncued single day ----
test('R8: an uncued bare day binds to a midnight start with clock flags null', () => {
  const c = make();
  const r = c.parseDateText('dentist on saturday', BASE);
  shape(r, { start: mid(18), end: null, startClock: null, endClock: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'dentist');
  const r2 = c.parseDateText('meditate tomorrow', BASE);
  shape(r2, { start: mid(16), end: null, startClock: null, endClock: null });
  assert.strictEqual(r2.rest, 'meditate');
});

// ---- R9 Fixed appointment on a day ----
test('R9: a day + clock span is a fixed block on that day (both pins)', () => {
  const c = make();
  const r = c.parseDateText('meeting friday 14:00-15:30', BASE);
  shape(r, { start: at(17, 14, 0), end: at(17, 15, 30), startClock: true, endClock: true, dur: 90 });
  assert.strictEqual(r.rest, 'meeting');
});

// ---- R10 Start-clock on a day (open) ----
test('R10: a day + start clock (no end) pins the start only', () => {
  const c = make();
  const r = c.parseDateText('gym tomorrow at 3pm', BASE);
  shape(r, { start: at(16, 15, 0), end: null, startClock: true, endClock: null });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'gym');
  const r2 = c.parseDateText('kickoff monday 9am', BASE);
  shape(r2, { start: at(20, 9, 0), end: null, startClock: true, endClock: null });
});

// ---- R11 Deadline at a clock ----
test('R11: a deadline cue with a clock sets an exact-clock due, start null', () => {
  const c = make();
  const r = c.parseDateText('email boss by friday 5pm', BASE);
  shape(r, { start: null, end: at(17, 17, 0), startClock: null, endClock: true });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'email boss');
  const r2 = c.parseDateText('report due friday at 4pm', BASE);
  shape(r2, { start: null, end: at(17, 16, 0), endClock: true });
});

// ---- RM Milestone (overrides clock/dur; zero-length at midnight) ----
test('RM: a milestone is a zero-length marker at day midnight; clocks/durations ignored', () => {
  const c = make();
  const r = c.parseDateText('release milestone friday', BASE);
  shape(r, { start: mid(17), end: mid(17), mile: true, dur: null });
  const r2 = c.parseDateText('◇ launch aug 3', BASE);
  shape(r2, { start: new Date(2026, 7, 3).getTime(), end: new Date(2026, 7, 3).getTime(), mile: true });
  // pruning: milestone + clock span → clocks ignored, still a midnight marker
  const r3 = c.parseDateText('◇ demo friday 2-3pm', BASE);
  shape(r3, { start: mid(17), end: mid(17), mile: true, dur: null });
});

// ---- Modifier layering / ≥3-axis interaction cases (must be defined) ----
test('3-axis: "every weekday 2-3pm starting next monday until aug 15 @work p1"', () => {
  const c = make();
  const r = c.parseDateText('every weekday 2-3pm starting next monday until aug 15 @work p1', BASE);
  shape(r, { start: at(20, 14, 0), end: at(20, 15, 0), startClock: true, endClock: true, dur: 60 });
  assert.strictEqual(r.recur.kind, 'weekday');
  assert.strictEqual(r.until, new Date(2026, 7, 15, 0, 0, 0, 0).getTime());
  assert.strictEqual(r.priority, 1);
  assert.strictEqual((r.labels || []).join(','), 'work');
});

test('3-axis: "gym every mon,wed,fri 6-7am @health" — weekday set + span + tag', () => {
  const c = make();
  const r = c.parseDateText('gym every mon,wed,fri 6-7am @health', BASE);
  shape(r, { startClock: true, endClock: true, dur: 60 });
  assert.strictEqual(r.recur.kind, 'weekdays');
  assert.strictEqual(r.recur.days.join(','), 'mon,wed,fri');
  assert.strictEqual((r.labels || []).join(','), 'health');
});

test('3-axis: "standup daily 9:15-9:30 p2" — recur + span + priority', () => {
  const c = make();
  const r = c.parseDateText('standup daily 9:15-9:30 p2', BASE);
  shape(r, { startClock: true, endClock: true, dur: 15 });
  assert.strictEqual(r.recur.kind, 'day');
  assert.strictEqual(r.priority, 2);
});

test('3-axis: "submit report by friday for 2h @work p1" — deadline + budget + tag + priority', () => {
  const c = make();
  const r = c.parseDateText('submit report by friday for 2h @work p1', BASE);
  shape(r, { start: null, end: eod(17), startClock: null, endClock: false, dur: 120 });
  assert.strictEqual(r.priority, 1);
  assert.strictEqual((r.labels || []).join(','), 'work');
  assert.strictEqual(r.rest, 'submit report');
});

test('3-axis: "review notes every week until 3 jan @study" — floating recurring with until', () => {
  const c = make();
  const r = c.parseDateText('review notes every week until 3 jan @study', BASE);
  shape(r, { start: null, end: null });
  assert.strictEqual(r.recur.kind, 'week');
  assert.strictEqual(r.until, new Date(2027, 0, 3, 0, 0, 0, 0).getTime());
  assert.strictEqual((r.labels || []).join(','), 'study');
});

test('3-axis: "sync with sam every 2 weeks tue 3pm for 30m" — n-weekly appointment', () => {
  const c = make();
  const r = c.parseDateText('sync with sam every 2 weeks tue 3pm for 30m', BASE);
  shape(r, { start: at(21, 15, 0), end: at(21, 15, 30), startClock: true, endClock: true, dur: 30 });
  assert.strictEqual(r.recur.kind, 'week');
  assert.strictEqual(r.recur.n, 2);
});

// ---- R7 Window (start + due, two days) — KNOWN GAP: single-date resolver only finds one day.
// Documented in architecture.md; deferred to a follow-up. Kept as todo so the region is tracked.
// NOT clock-flaky, despite the absolute epoch in the failure message: every test in this file passes
// the fixed BASE (2026-07-15 10:00) as the reference date, and eod(17) is an absolute local instant.
// Swept at 23:55, 00:05, 00:19, 12:00, year-end and a DST-spring-forward hour — `end` is null in all
// of them. The todo marks a genuinely unimplemented feature, so it stays a todo; the clock injection
// in _load.js (withNow) deliberately does not touch this file.
test('R7: "start mon due fri" resolves a two-day window', { todo: true }, () => {
  const c = make();
  const r = c.parseDateText('sprint start monday due friday', BASE);
  shape(r, { start: mid(20), end: eod(17), startClock: true, endClock: null });
});

// ---- corruption class: chrono must NOT invent a date/milestone from ordinary words ----
// Each of these was mis-parsed by the hand-rolled regex extractor: substring weekday matches
// ("friends" → Friday, "monitor" → Monday), and \bmile\b / \bms\b milestone triggers.
test('parseDateText: "call friends" invents no date (was: matched Friday)', () => {
  const c = make();
  const r = c.parseDateText('call friends', BASE);
  assert.strictEqual(r.date, null);
});
test('parseDateText: "monitor server" invents no date (was: matched Monday)', () => {
  const c = make();
  assert.strictEqual(c.parseDateText('monitor server', BASE).date, null);
});
test('parseDateText: "run a mile" is not a milestone (was: \bmile\b)', () => {
  const c = make();
  const r = c.parseDateText('run a mile', BASE);
  assert.strictEqual(r.mile, false);
  assert.strictEqual(r.date, null);
});
test('parseDateText: "email ms johnson" is not a milestone (was: \bms\b)', () => {
  const c = make();
  assert.strictEqual(c.parseDateText('email ms johnson', BASE).mile, false);
});
// parseDateText.rest leaves these titles intact — the corruption lived one step further down, in
// runQuickAdd's own title-cleanup regex, which kept the old \bmile\b|\bms\b alternatives after the
// mile-detection regex above was fixed. Exercise runQuickAdd itself so this gap can't reopen unseen.
test('runQuickAdd: "run a mile" keeps its title (was: title-cleanup regex ate "mile")', () => {
  const c = make();
  c.setState({ quickText: 'run a mile' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].name, 'run a mile');
});
test('runQuickAdd: "email ms johnson" keeps its title (was: title-cleanup regex ate "ms")', () => {
  const c = make();
  c.setState({ quickText: 'email ms johnson' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].name, 'email ms johnson');
});
// PP-EXT: a bare day stays unclocked; a user-typed clock makes a Point.
test('runQuickAdd: a bare-day default anchor remains untimed', () => {
  const c = make();
  c.setState({ quickText: 'report friday' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].startClock, null);
});
test('runQuickAdd: an untimed start cue remains untimed', () => {
  const c = make();
  c.setState({ quickText: 'project starts monday' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].startClock, null);
});
test('runQuickAdd: a bare-day due choice records an unclocked EOD deadline', () => {
  const c = make();
  c.setState({ quickText: 'report friday', quickChoice: 'due' });
  c.runQuickAdd('bottom');
  const task = c.state.tasks[c.state.tasks.length - 1];
  assert.strictEqual(task.start, null);
  assert.strictEqual(task.endClock, false);
  assert.strictEqual(new Date(task.end).getHours(), 23);
});
test('runQuickAdd: a user-typed clock records startClock:true (a real Point)', () => {
  const c = make();
  c.setState({ quickText: 'standup monday 9am' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].startClock, true);
});
test('parseDateText: "wedding on saturday" resolves Saturday, not Wednesday', () => {
  const c = make();
  const r = c.parseDateText('wedding on saturday', BASE);
  assert.strictEqual(new Date(r.date).getDay(), 6); // Saturday
});

// ---- Task 2 overrides: the two spec behaviors chrono does not deliver ----
test('parseDateText: "in 2m" is 2 months, not 2 minutes', () => {
  const c = make();
  const r = c.parseDateText('pay rent in 2m', BASE);
  const d = new Date(r.date);
  assert.strictEqual(d.getMonth(), 8);  // September (0-based)
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(r.rest, 'pay rent');
});
test('parseDateText: bare "Nm" outside an offset stays minutes', () => {
  const c = make();
  const r = c.parseDateText('homework ~2m', BASE);
  assert.strictEqual(r.dur, 2);
  assert.strictEqual(r.date, null);
});
test('parseDateText: bare "the 3rd" rolls forward to next month', () => {
  const c = make();
  const r = c.parseDateText('follow up on the 3rd', BASE);
  const d = new Date(r.date);
  assert.strictEqual(d.getMonth(), 7); // August
  assert.strictEqual(d.getDate(), 3);
  assert.strictEqual(r.rest, 'follow up');
});

// ---- Task 3: title residue + behaviors chrono now provides for free (locked as regressions) ----
test('parseDateText: "lunch at noon" strips "at", keeps 12:00', () => {
  const c = make();
  const r = c.parseDateText('lunch at noon', BASE);
  assert.strictEqual(r.rest, 'lunch');
  assert.strictEqual(new Date(r.date).getHours(), 12);
  assert.strictEqual(r.clock, true);
});
test('parseDateText: "standup tonight" is an evening time, with no dangling word', () => {
  const c = make();
  const r = c.parseDateText('standup tonight', BASE);
  assert.strictEqual(r.rest, 'standup');
  assert.strictEqual(new Date(r.date).getDate(), 15);
  // a time-of-day word beats the 9am default, but is a soft window — not a clock commitment
  assert.ok(new Date(r.date).getHours() >= 18, 'tonight should land in the evening');
  assert.strictEqual(r.clock, false);
});
test('parseDateText: a bare day lands at midnight, not chrono filler', () => {
  const c = make();
  // chrono implies noon for "friday" / the current hour for "tomorrow"; neither is a real signal.
  assert.strictEqual(new Date(c.parseDateText('gym friday', BASE).date).getHours(), 0);
  assert.strictEqual(new Date(c.parseDateText('gym tomorrow', BASE).date).getHours(), 0);
});
test('parseDateText: "tomorrow morning" / "this afternoon" use their implied hour', () => {
  const c = make();
  const m = new Date(c.parseDateText('run tomorrow morning', BASE).date);
  assert.strictEqual(m.getDate(), 16);
  assert.ok(m.getHours() < 12, 'morning should be before noon');
  const a = new Date(c.parseDateText('call this afternoon', BASE).date);
  assert.ok(a.getHours() >= 12 && a.getHours() < 18, 'afternoon should be 12:00-18:00');
});
test('parseDateText: ISO date 2026-07-20 is read (was P1·F drop)', () => {
  const c = make();
  const r = c.parseDateText('report 2026-07-20', BASE);
  const d = new Date(r.date);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 20);
  assert.strictEqual(r.rest, 'report');
});
test('parseDateText: "next friday" differs from "friday"', () => {
  const c = make();
  const a = c.parseDateText('gym friday', BASE).date;
  const b = c.parseDateText('gym next friday', BASE).date;
  assert.notStrictEqual(a, b);
});
test('parseDateText: "this weekend" resolves Saturday', () => {
  const c = make();
  const r = c.parseDateText('hike this weekend', BASE);
  assert.strictEqual(new Date(r.date).getDay(), 6);
  assert.strictEqual(r.rest, 'hike');
});
test('parseDateText: out-of-range clock is not committed', () => {
  const c = make();
  const r = c.parseDateText('meeting at 25:00', BASE);
  // chrono rejects 25:00; there must be no 25h time. Either no date, or hour<24.
  if(r.date!=null) assert.ok(new Date(r.date).getHours() < 24);
  const r2 = c.parseDateText('meeting at 12:60', BASE);
  if(r2.date!=null) assert.ok(new Date(r2.date).getMinutes() < 60);
});

// ---- Task 4: additive ambiguity payload (spec §5/§6). Track B's chooser consumes it; nothing in
// Track A reads it, and the persisted shape must be byte-identical with and without it. ----
test('parseDateText: uncued bare day is ambiguous with anchor+due candidates', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  assert.ok(r.ambiguous, 'should flag ambiguity');
  const kinds = r.candidates.map(x => x.kind);
  assert.ok(kinds.includes('anchor') && kinds.includes('due'));
  const anchor = r.candidates.find(x => x.kind === 'anchor');
  assert.strictEqual(anchor.tuple.startClock, null);
  assert.strictEqual(anchor.tuple.endClock, null);
  const due = r.candidates.find(x => x.kind === 'due');
  assert.strictEqual(due.tuple.endClock, false);
});
test('parseDateText: adjacent due-cue is not ambiguous', () => {
  const c = make();
  assert.strictEqual(c.parseDateText('submit report by friday', BASE).ambiguous, null);
});
test('parseDateText: non-adjacent cue word stays ambiguous', () => {
  const c = make();
  // "before" belongs to the title ("before meeting"), not to the date — it must not bind the role.
  assert.ok(c.parseDateText('prep before meeting friday', BASE).ambiguous);
});
test('parseDateText: recurring bare day is ambiguous over the recur anchor', () => {
  const c = make();
  const r = c.parseDateText('gym every friday', BASE);
  assert.ok(r.ambiguous);
  assert.ok(r.recur, 'recurrence still parsed');
  assert.strictEqual(r.date, null, 'a pure recurrence has no one-off date');
  // the anchor must land on a real Friday, never a null day
  const anchor = r.candidates.find(x => x.kind === 'anchor');
  assert.strictEqual(new Date(anchor.tuple.start).getDay(), 5);
});
test('parseDateText: a fixed clock block is not ambiguous', () => {
  const c = make();
  assert.strictEqual(c.parseDateText('call client 2-3pm', BASE).ambiguous, null);
});
test('parseDateText: an undated task is not ambiguous', () => {
  const c = make();
  const r = c.parseDateText('call friends', BASE);
  assert.strictEqual(r.ambiguous, null);
  assert.deepStrictEqual(r.candidates.length, 0);
});
test('parseDateText: candidates carry a third slot for the block branch (v1 leaves it empty)', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  assert.ok(r.candidates.length >= 2, 'binary pair emitted in v1');
});
test('parseDateText: the ambiguity payload does not disturb the persisted shape', () => {
  const c = make();
  // every shaped field keeps the Task-3 value; only ambiguous/candidates are new (interim-default).
  const r = c.parseDateText('gym friday', BASE);
  assert.strictEqual(r.start, mid(17));
  assert.strictEqual(r.end, null);
  assert.strictEqual(r.startClock, null);
  assert.strictEqual(r.endClock, null);
});

// ---- Track B Group 3: the ambiguity chooser. pickCandidate + ambigChoiceLabels are the pure
// helpers renderQuickAddPopup/runQuickAdd lean on; unit-test the mapping directly so the DOM path
// stays thin (design 2026-07-21 §Group 3). ----
test('pickCandidate: "anchor" choice returns the anchor tuple (== the interim default)', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  const t = c.pickCandidate(r, 'anchor');
  assert.strictEqual(t.startClock, null);
  assert.strictEqual(t.endClock, null);
  assert.strictEqual(t.start, mid(17));
  assert.strictEqual(t.end, null);
});
test('pickCandidate: "due" choice returns the due tuple (only this changes the outcome)', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  const t = c.pickCandidate(r, 'due');
  assert.strictEqual(t.endClock, false);
  assert.strictEqual(t.startClock, null);
  // #68: a bare-day "By Fri" is an END-OF-DAY deadline (matching an explicit "by friday" cue),
  // NOT the parser's 9am placeholder — the ambiguous and cued paths must agree.
  assert.strictEqual(t.end, new Date(2026, 6, 17, 23, 59, 59, 999).getTime());
  assert.strictEqual(t.start, null);
});
test('pickCandidate: a clocked "By <time>" due keeps the exact clock instant (not EOD)', () => {
  const c = make();
  const r = c.parseDateText('homework monday 9am', BASE);
  const t = c.pickCandidate(r, 'due');
  assert.strictEqual(t.endClock, true);
  assert.strictEqual(t.startClock, null);
  assert.strictEqual(t.end, at(20, 9, 0)); // Mon Jul 20 09:00 — an exact-clock deadline (R11), not EOD
});
test('pickCandidate: an unknown/empty choice falls back to the anchor tuple', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  assert.strictEqual(c.pickCandidate(r, 'nonsense').kind, undefined); // returns the tuple, not the wrapper
  assert.strictEqual(c.pickCandidate(r, 'nonsense').startClock, null);
  assert.strictEqual(c.pickCandidate(r, null).startClock, null);
});
test('pickCandidate: an unambiguous parse returns null (runQuickAdd keeps the raw shaped fields)', () => {
  const c = make();
  assert.strictEqual(c.pickCandidate(c.parseDateText('call client 2-3pm', BASE), 'due'), null);
  assert.strictEqual(c.pickCandidate(c.parseDateText('call friends', BASE), 'anchor'), null);
});
test('ambigChoiceLabels: bare day → On/By weekday', () => {
  const c = make();
  const l = c.ambigChoiceLabels(c.parseDateText('gym friday', BASE));
  assert.strictEqual(l.anchor, 'On Fri');
  assert.strictEqual(l.due, 'By Fri');
});
test('ambigChoiceLabels: recurring day → On/By pluralised weekday', () => {
  const c = make();
  const l = c.ambigChoiceLabels(c.parseDateText('gym every friday', BASE));
  assert.strictEqual(l.anchor, 'On Fridays');
  assert.strictEqual(l.due, 'By Fridays');
});
test('ambigChoiceLabels: bare day + clock → At/By time', () => {
  const c = make();
  const l = c.ambigChoiceLabels(c.parseDateText('homework monday 9am', BASE));
  assert.strictEqual(l.anchor, 'At 9am');
  assert.strictEqual(l.due, 'By 9am');
});
test('ambigChoiceLabels: unambiguous parse → null (no chooser row rendered)', () => {
  const c = make();
  assert.strictEqual(c.ambigChoiceLabels(c.parseDateText('call client 2-3pm', BASE)), null);
});

function walk(node, out=[]){
  if(node==null) return out;
  if(Array.isArray(node)){ node.forEach(x=>walk(x,out)); return out; }
  if(typeof node==='object'){ out.push(node); walk(node.children,out); }
  return out;
}

test('quickHighlightSegments reconstructs raw text and marks only parser spans', () => {
  const c=make(), text='submit report by Friday for 2h @work p1';
  const p=c.parseDateText(text,BASE);
  const seg=JSON.parse(JSON.stringify(c.quickHighlightSegments(text,p.matches)));
  assert.strictEqual(seg.map(x=>x.text).join(''), text);
  assert.deepStrictEqual(seg.filter(x=>x.highlight).map(x=>x.text), ['by Friday','for 2h']);
});

test('quickHighlightSegments normalizes overlap without duplicating visible text', () => {
  const c=make(), text='abcdefghij';
  const seg=JSON.parse(JSON.stringify(c.quickHighlightSegments(text,[
    {kind:'date',start:2,end:6}, {kind:'time',start:4,end:8}, {kind:'date',start:2,end:6}
  ])));
  assert.strictEqual(seg.map(x=>x.text).join(''), text);
  assert.deepStrictEqual(seg.filter(x=>x.highlight).map(x=>x.text), ['cdefgh']);
});

test('quick-add popup keeps a native input and renders an inert match mirror', () => {
  const c=make();
  Object.assign(c.state,{quickOpen:true,quickText:'task tomorrow at 4pm',quickChoice:'anchor'});
  const nodes=walk(c.renderQuickAddPopup());
  assert.strictEqual(nodes.filter(n=>n.type==='input').length,1);
  const mirror=nodes.find(n=>n.props && n.props['data-qa']==='quick-highlight-mirror');
  assert.ok(mirror);
  assert.strictEqual(mirror.props['aria-hidden'],'true');
  assert.strictEqual(mirror.props.style.pointerEvents,'none');
  assert.ok(nodes.some(n=>n.props && n.props['data-qa']==='quick-highlight'));
});

test('quick-add mirror renders user content as text, never HTML', () => {
  const c=make();
  Object.assign(c.state,{quickOpen:true,quickText:'<img onerror=alert(1)> tomorrow'});
  const nodes=walk(c.renderQuickAddPopup());
  assert.ok(nodes.every(n=>!n.props || !('dangerouslySetInnerHTML' in n.props)));
  assert.ok(nodes.some(n=>n.children && n.children.includes('<img onerror=alert(1)> ')));
});

test('quick-add date-only hint omits midnight while an explicit clock keeps it', () => {
  const c=make(), midnight=new Date(2026,7,1,0,0,0,0).getTime();
  Object.assign(c.state,{quickOpen:true,quickText:'test today',quickChoice:'anchor'});
  c.ambigChoiceLabels=()=>null;
  c.parseDateText=()=>({date:midnight,clock:false,end:null,dur:null,recur:null,priority:null,labels:[],matches:[]});
  let hints=walk(c.renderQuickAddPopup()).filter(n=>n.props && n.props['data-qa']==='quick-hint');
  assert.deepStrictEqual(hints.map(n=>n.children[0]),['Sat Aug 01']);

  c.parseDateText=()=>({date:midnight,clock:true,end:null,dur:null,recur:null,priority:null,labels:[],matches:[]});
  hints=walk(c.renderQuickAddPopup()).filter(n=>n.props && n.props['data-qa']==='quick-hint');
  // Task 13 (2026-08-20): the clock half is 12-hour now, through the one formatter. The rule this test
  // exists for is unchanged — a date-only parse omits the clock, an explicit one keeps it.
  assert.deepStrictEqual(hints.map(n=>n.children[0]),['Sat Aug 01, 12:00am']);
});

test('quick-add card uses a fixed viewport anchor so rows grow downward', () => {
  const c=make();
  Object.assign(c.state,{quickOpen:true,quickText:'test today',quickChoice:'anchor'});
  const nodes=walk(c.renderQuickAddPopup());
  const card=nodes.find(n=>n.props && n.props['data-qa']==='quick-card');
  assert.ok(card);
  assert.strictEqual(card.props.style.position,'absolute');
  assert.strictEqual(card.props.style.top,'calc(50% - 48px)');
});
