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

test('parseDateText: a bare start-clock is a Point (pinStart, NOT pinEnd, open end)', () => {
  const c = make();
  const r = c.parseDateText('meeting 2pm', BASE);
  assert.strictEqual(r.pinStart, true,  'start is pinned');
  assert.strictEqual(r.pinEnd,   false, 'end is explicitly NOT pinned (Point tuple)');
  assert.strictEqual(r.end,      null,  'no end');
});

test('parseDateText: "mon 9am" is a Point too', () => {
  const c = make();
  const r = c.parseDateText('report mon 9am', BASE);
  assert.strictEqual(r.pinStart, true);
  assert.strictEqual(r.pinEnd,   false);
  assert.strictEqual(r.end,      null);
});

test('parseDateText: clock RANGE stays a both-pinned span (regression)', () => {
  const c = make();
  const r = c.parseDateText('eating tomorrow from 17:00 to 18:00', BASE);
  assert.strictEqual(r.pinStart, true);
  assert.strictEqual(r.pinEnd,   true);
});

test('parseDateText: a due cue stays a deadline (regression)', () => {
  const c = make();
  const r = c.parseDateText('submit report by friday', BASE);
  assert.strictEqual(r.pinEnd, true);
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

test('parseDateText: an ambiguous bare "N to M" is not a time range', () => {
  const c = make(); // "5 to 6 apples" is a count, not 17:00-18:00
  const r = c.parseDateText('buy 5 to 6 apples', BASE);
  assert.strictEqual(r.date, null);
  assert.strictEqual(r.end, null);
  assert.strictEqual(r.rest, 'buy 5 to 6 apples');
});

test('parseDateText: a weekday keeps the 9am default and drops the preposition', () => {
  // Regression: /days?/ had no word boundary, so the "day" inside "friday" matched and suppressed
  // the 9am default, landing the task at midnight. "by" also leaked into the title.
  const c = make();
  const r = c.parseDateText('submit report by friday', BASE);
  assert.strictEqual(r.date, at(17, 9, 0)); // raw found day (datePick/preview back-compat)
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'submit report');
  // V1.1B shaped anchors: "by" is a deadline cue → R5 (start=null, EOD due, pinEnd).
  assert.strictEqual(r.start, null);
  assert.strictEqual(r.end, eod(17));
  assert.strictEqual(r.pinStart, null);
  assert.strictEqual(r.pinEnd, true);
});

test('parseDateText: relative offset still suppresses the 9am default', () => {
  const c = make(); // "in 3 days" means 3*24h from now (10:00), not 09:00
  const r = c.parseDateText('task in 3 days', BASE);
  assert.strictEqual(r.date, at(18, 10, 0));
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
  assert.strictEqual(r.until, new Date(2027, 0, 3, 9, 0, 0, 0).getTime());
  assert.strictEqual(r.end, null);
});

test('parseDateText: an explicit year on a month-name date is honoured', () => {
  const c = make(); // "25 jul 2027" used to ignore the year and land in the current one
  const r = c.parseDateText('ship 25 jul 2027', BASE);
  assert.strictEqual(r.date, new Date(2027, 6, 25, 9, 0, 0, 0).getTime());
  assert.strictEqual(r.rest, 'ship');
  const r2 = c.parseDateText('ship jul 25, 2027', BASE);
  assert.strictEqual(r2.date, new Date(2027, 6, 25, 9, 0, 0, 0).getTime());
});

// ==== V1.1B: axis-based parser — exhaustive shaped-anchor fixtures per architecture.md ====
// "Parser task-type cases" surviving regions R0–R11 + RM + modifier layering. parseDateText now
// emits the SHAPED anchors (start/end/pinStart/pinEnd/mile) the task model consumes, alongside the
// raw date/dur/clock it always exposed. BASE = Wed 2026-07-15 10:00 (see top of file); Fri=17,
// Mon=20, Sat=18, tomorrow(Thu)=16, next Tue=21.
const d9 = (day) => new Date(2026, 6, day, 9, 0, 0, 0).getTime();
const mid = (day) => new Date(2026, 6, day, 0, 0, 0, 0).getTime();
const eod = (day) => new Date(2026, 6, day, 23, 59, 59, 999).getTime();
// assert a full shape at once; pass only the fields that matter (undefined = skip)
const shape = (r, exp) => {
  for (const k of ['start', 'end', 'pinStart', 'pinEnd', 'mile', 'dur']) {
    if (k in exp) assert.strictEqual(r[k], exp[k], `${k}: ${JSON.stringify(r[k])} !== ${JSON.stringify(exp[k])}`);
  }
};

// ---- R0 Floating (no dates, no pins) ----
test('R0: a bare task floats — null anchors, no pins', () => {
  const c = make();
  const r = c.parseDateText('email sam', BASE);
  shape(r, { start: null, end: null, pinStart: null, pinEnd: null, mile: false });
  assert.strictEqual(r.rest, 'email sam');
  const r2 = c.parseDateText('read the paper', BASE);
  shape(r2, { start: null, end: null, pinStart: null, pinEnd: null });
});

// ---- R1 Duration-only (movable, no anchors) ----
test('R1: "for <dur>" / "takes <dur>" / "~<dur>" set a budget but no anchors', () => {
  const c = make();
  const a = c.parseDateText('call plumber for 45m', BASE);
  shape(a, { start: null, end: null, pinStart: null, pinEnd: null, dur: 45 });
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
  shape(r, { start: at(15, 11, 0), end: null, pinStart: true, pinEnd: false }); // PP-EXT: Point tuple, pinEnd explicit false
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'standup');
});

// ---- R3 Fixed appointment, today implied ----
test('R3: a clock span with no day is a fixed block today (both pins)', () => {
  const c = make();
  const r = c.parseDateText('call client 2-3pm', BASE);
  shape(r, { start: at(15, 14, 0), end: at(15, 15, 0), pinStart: true, pinEnd: true, dur: 60 });
  assert.strictEqual(r.rest, 'call client');
  const r2 = c.parseDateText('block at 2pm for 1h', BASE);
  shape(r2, { start: at(15, 14, 0), end: at(15, 15, 0), pinStart: true, pinEnd: true, dur: 60 });
  assert.strictEqual(r2.rest, 'block');
});

// ---- R4 Not-before (start-cued day) ----
test('R4: a start cue pins the start day at 9am, no end', () => {
  const c = make();
  // cue adjacent to the date (the canonical R4 form); a detached leading "start …" stays in the title.
  const r = c.parseDateText('project starts monday', BASE);
  shape(r, { start: d9(20), end: null, pinStart: true, pinEnd: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'project');
  const r2 = c.parseDateText('diet begins tomorrow', BASE);
  shape(r2, { start: d9(16), end: null, pinStart: true, pinEnd: null });
  assert.strictEqual(r2.rest, 'diet');
});

// Bare ordinal: chrono finds no date here; the Task-2 roll-forward override resolves it.
test('R4: a start cue with a bare ordinal day', () => {
  const c = make();
  const r3 = c.parseDateText('prep after the 20th', BASE);
  shape(r3, { start: d9(20), pinStart: true });
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
  shape(r, { start: d9(17), end: null, pinStart: true, pinEnd: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'submit'); // the orphaned "not" is stripped too
});

// The clocked form routes through R2 (Point tuple): start pinned at the clock, end explicitly open.
test('R2: "not before <day> <clock>" pins the start clock, not a due deadline', () => {
  const c = make();
  const r = c.parseDateText('deploy not before monday 5pm', BASE);
  shape(r, { start: at(20, 17, 0), end: null, pinStart: true, pinEnd: false });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'deploy');
});

// ---- R5 Deadline (due-cued day) ----
test('R5: a deadline cue sets an EOD due, start stays null, pinEnd', () => {
  const c = make();
  const r = c.parseDateText('pay taxes due aug 3', BASE);
  shape(r, { start: null, end: new Date(2026, 7, 3, 23, 59, 59, 999).getTime(), pinStart: null, pinEnd: true });
});

// Bare ordinal, deadline side (see R4 above).
test('R5: a deadline cue with a bare ordinal day', () => {
  const c = make();
  const r2 = c.parseDateText('finish deck by the 20th', BASE);
  shape(r2, { start: null, end: eod(20), pinEnd: true });
  assert.strictEqual(r2.rest, 'finish deck');
});

// ---- R6 Deadline + budget ----
test('R6: a budget with a deadline keeps the EOD due and the planned minutes', () => {
  const c = make();
  const r = c.parseDateText('study for 90m due monday', BASE);
  shape(r, { start: null, end: eod(20), pinStart: null, pinEnd: true, dur: 90 });
});

// ---- R8 All-day, uncued single day ----
test('R8: an uncued bare day binds to start at 9am but leaves pins null', () => {
  const c = make();
  const r = c.parseDateText('dentist on saturday', BASE);
  shape(r, { start: d9(18), end: null, pinStart: null, pinEnd: null });
  assert.strictEqual(r.clock, false);
  assert.strictEqual(r.rest, 'dentist');
  const r2 = c.parseDateText('meditate tomorrow', BASE);
  shape(r2, { start: d9(16), end: null, pinStart: null, pinEnd: null });
  assert.strictEqual(r2.rest, 'meditate');
});

// ---- R9 Fixed appointment on a day ----
test('R9: a day + clock span is a fixed block on that day (both pins)', () => {
  const c = make();
  const r = c.parseDateText('meeting friday 14:00-15:30', BASE);
  shape(r, { start: at(17, 14, 0), end: at(17, 15, 30), pinStart: true, pinEnd: true, dur: 90 });
  assert.strictEqual(r.rest, 'meeting');
});

// ---- R10 Start-clock on a day (open) ----
test('R10: a day + start clock (no end) pins the start only', () => {
  const c = make();
  const r = c.parseDateText('gym tomorrow at 3pm', BASE);
  shape(r, { start: at(16, 15, 0), end: null, pinStart: true, pinEnd: false }); // PP-EXT: Point tuple, pinEnd explicit false
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'gym');
  const r2 = c.parseDateText('kickoff monday 9am', BASE);
  shape(r2, { start: at(20, 9, 0), end: null, pinStart: true, pinEnd: false }); // PP-EXT: Point tuple, pinEnd explicit false
});

// ---- R11 Deadline at a clock ----
test('R11: a deadline cue with a clock sets an exact-clock due, start null', () => {
  const c = make();
  const r = c.parseDateText('email boss by friday 5pm', BASE);
  shape(r, { start: null, end: at(17, 17, 0), pinStart: null, pinEnd: true });
  assert.strictEqual(r.clock, true);
  assert.strictEqual(r.rest, 'email boss');
  const r2 = c.parseDateText('report due friday at 4pm', BASE);
  shape(r2, { start: null, end: at(17, 16, 0), pinEnd: true });
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
  shape(r, { start: at(20, 14, 0), end: at(20, 15, 0), pinStart: true, pinEnd: true, dur: 60 });
  assert.strictEqual(r.recur.kind, 'weekday');
  assert.strictEqual(r.until, new Date(2026, 7, 15, 9, 0, 0, 0).getTime()); // "aug 15" → Aug 15 9am
  assert.strictEqual(r.priority, 1);
  assert.strictEqual((r.labels || []).join(','), 'work');
});

test('3-axis: "gym every mon,wed,fri 6-7am @health" — weekday set + span + tag', () => {
  const c = make();
  const r = c.parseDateText('gym every mon,wed,fri 6-7am @health', BASE);
  shape(r, { pinStart: true, pinEnd: true, dur: 60 });
  assert.strictEqual(r.recur.kind, 'weekdays');
  assert.strictEqual(r.recur.days.join(','), 'mon,wed,fri');
  assert.strictEqual((r.labels || []).join(','), 'health');
});

test('3-axis: "standup daily 9:15-9:30 p2" — recur + span + priority', () => {
  const c = make();
  const r = c.parseDateText('standup daily 9:15-9:30 p2', BASE);
  shape(r, { pinStart: true, pinEnd: true, dur: 15 });
  assert.strictEqual(r.recur.kind, 'day');
  assert.strictEqual(r.priority, 2);
});

test('3-axis: "submit report by friday for 2h @work p1" — deadline + budget + tag + priority', () => {
  const c = make();
  const r = c.parseDateText('submit report by friday for 2h @work p1', BASE);
  shape(r, { start: null, end: eod(17), pinStart: null, pinEnd: true, dur: 120 });
  assert.strictEqual(r.priority, 1);
  assert.strictEqual((r.labels || []).join(','), 'work');
  assert.strictEqual(r.rest, 'submit report');
});

test('3-axis: "review notes every week until 3 jan @study" — floating recurring with until', () => {
  const c = make();
  const r = c.parseDateText('review notes every week until 3 jan @study', BASE);
  shape(r, { start: null, end: null });
  assert.strictEqual(r.recur.kind, 'week');
  assert.strictEqual(r.until, new Date(2027, 0, 3, 9, 0, 0, 0).getTime());
  assert.strictEqual((r.labels || []).join(','), 'study');
});

test('3-axis: "sync with sam every 2 weeks tue 3pm for 30m" — n-weekly appointment', () => {
  const c = make();
  const r = c.parseDateText('sync with sam every 2 weeks tue 3pm for 30m', BASE);
  shape(r, { start: at(21, 15, 0), end: at(21, 15, 30), pinStart: true, pinEnd: true, dur: 30 });
  assert.strictEqual(r.recur.kind, 'week');
  assert.strictEqual(r.recur.n, 2);
});

// ---- R7 Window (start + due, two days) — KNOWN GAP: single-date resolver only finds one day.
// Documented in architecture.md; deferred to a follow-up. Kept as todo so the region is tracked.
test('R7: "start mon due fri" resolves a two-day window', { todo: true }, () => {
  const c = make();
  const r = c.parseDateText('sprint start monday due friday', BASE);
  shape(r, { start: d9(20), end: eod(17), pinStart: true, pinEnd: true });
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
// PP-EXT (#68): a bare day's 9am is a placeholder, not a user-typed time — the task must record that
// (startClock:false) so the timeline draws it as a "🕓" agenda chip, not a phantom "◆ 9:00a" Point.
test('runQuickAdd: a bare-day task records startClock:false (9am is a placeholder)', () => {
  const c = make();
  c.setState({ quickText: 'report friday' });
  c.runQuickAdd('bottom');
  assert.strictEqual(c.state.tasks[c.state.tasks.length - 1].startClock, false);
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
test('parseDateText: a bare day still gets the 9am default, not chrono filler', () => {
  const c = make();
  // chrono implies noon for "friday" / the current hour for "tomorrow"; neither is a real signal.
  assert.strictEqual(new Date(c.parseDateText('gym friday', BASE).date).getHours(), 9);
  assert.strictEqual(new Date(c.parseDateText('gym tomorrow', BASE).date).getHours(), 9);
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
  assert.strictEqual(anchor.tuple.pinStart, true);
  assert.strictEqual(anchor.tuple.pinEnd, false);
  const due = r.candidates.find(x => x.kind === 'due');
  assert.strictEqual(due.tuple.pinEnd, true);
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
  assert.strictEqual(r.start, at(17, 9, 0));
  assert.strictEqual(r.end, null);
  assert.strictEqual(r.pinStart, null);
  assert.strictEqual(r.pinEnd, null);
});

// ---- Track B Group 3: the ambiguity chooser. pickCandidate + ambigChoiceLabels are the pure
// helpers renderQuickAddPopup/runQuickAdd lean on; unit-test the mapping directly so the DOM path
// stays thin (design 2026-07-21 §Group 3). ----
test('pickCandidate: "anchor" choice returns the anchor tuple (== the interim default)', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  const t = c.pickCandidate(r, 'anchor');
  assert.strictEqual(t.pinStart, true);
  assert.strictEqual(t.pinEnd, false);
  assert.strictEqual(t.start, at(17, 9, 0));
  assert.strictEqual(t.end, null);
});
test('pickCandidate: "due" choice returns the due tuple (only this changes the outcome)', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  const t = c.pickCandidate(r, 'due');
  assert.strictEqual(t.pinEnd, true);
  assert.strictEqual(t.pinStart, false);
  assert.strictEqual(t.end, at(17, 9, 0));
  assert.strictEqual(t.start, null);
});
test('pickCandidate: an unknown/empty choice falls back to the anchor tuple', () => {
  const c = make();
  const r = c.parseDateText('gym friday', BASE);
  assert.strictEqual(c.pickCandidate(r, 'nonsense').kind, undefined); // returns the tuple, not the wrapper
  assert.strictEqual(c.pickCandidate(r, 'nonsense').pinStart, true);
  assert.strictEqual(c.pickCandidate(r, null).pinStart, true);
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
