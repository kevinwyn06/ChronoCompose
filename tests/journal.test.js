// Phase 9 PR4 (ROADMAP.md) — Journaling / next-day planning: per-day text store round-trip, the day's
// actuals (allotted vs recorded), and the day-navigation clamp (never past today).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

test('saveJournalText persists per day; empty text clears the entry', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  c.saveJournalText(today, 'Shipped the stats page.');
  assert.equal(c.journalTextFor(today), 'Shipped the stats page.');
  assert.ok(c.state.journal[c.ymdOf(today)].updatedAt, 'stamps updatedAt');
  // a different day is independent
  c.saveJournalText(today - DAY, 'yesterday note');
  assert.equal(c.journalTextFor(today - DAY), 'yesterday note');
  assert.equal(c.journalTextFor(today), 'Shipped the stats page.');
  // clearing to blank removes the entry
  c.saveJournalText(today, '   ');
  assert.equal(c.journalTextFor(today), '');
  assert.ok(!(c.ymdOf(today) in c.state.journal), 'blank entry deleted');
});

test('journalActuals reports per-task allotted vs recorded with totals', () => {
  const c = make();
  cleanDay(c, '10:00'); // 600-min pool
  const today = c.startOfToday();
  const a = activeTask(c, { id: 'a', planned: 120, spentByDay: { [c.ymdOf(today)]: 45 } });
  const b = activeTask(c, { id: 'b', planned: 60, spentByDay: {} });
  c.state.tasks = [a, b];
  const d = c.journalActuals(today);
  assert.equal(d.rows.length, 2);
  assert.equal(Math.round(d.totalSpent), 45, 'recorded = today ledger slices');
  assert.ok(d.totalAllot > 0, 'both active tasks get an allotted slice');
  assert.equal(d.rows[0].id, 'a', 'rows sorted by recorded desc');
});

test('journalActuals skips tasks with neither allotment nor recorded time', () => {
  const c = make();
  cleanDay(c, '10:00');
  const today = c.startOfToday();
  const inactive = activeTask(c, { id: 'far', planned: 60, start: today + 30 * DAY, end: today + 31 * DAY });
  c.state.tasks = [inactive];
  const d = c.journalActuals(today);
  assert.equal(d.rows.length, 0, 'a task not active today and never worked on is omitted');
});

test('shiftJournalDay never advances past today; -1 goes back a day', () => {
  const c = make();
  c.state.journalDay = null; // today
  c.shiftJournalDay(1);
  assert.equal(c.state.journalDay, null, 'cannot go past today');
  c.shiftJournalDay(-1);
  assert.equal(c.journalDayMs(), c.startOfToday() - DAY, 'stepped back one day');
});

// ---- PR5: mood + auto-weather + auto-log ----

test('updateJournal merges fields; mood/weather keep an entry alive with no text; emptying deletes it', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  const ymd = c.ymdOf(today);
  // mood-only entry persists (no text)
  c.updateJournal(today, { mood: 'good' });
  assert.equal(c.journalEntryFor(today).mood, 'good');
  assert.equal(c.journalTextFor(today), '', 'no text yet');
  assert.ok(ymd in c.state.journal, 'mood alone keeps the entry');
  // adding text merges (mood retained)
  c.saveJournalText(today, 'productive');
  assert.equal(c.journalEntryFor(today).mood, 'good', 'mood survives a text edit');
  assert.equal(c.journalTextFor(today), 'productive');
  // clearing the mood but keeping text leaves the entry
  c.setJournalMood(today, 'good'); // toggles the active mood off
  assert.equal(c.journalEntryFor(today).mood, undefined, 'clicking the active mood clears it');
  assert.ok(ymd in c.state.journal, 'text still holds the entry');
  // clearing text now removes the whole entry
  c.saveJournalText(today, '  ');
  assert.ok(!(ymd in c.state.journal), 'empty text + no mood/weather deletes the entry');
});

test('weather stored on an entry round-trips and is not cleared by a mood edit', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  c.updateJournal(today, { weather: { tempC: 21, code: 3, at: Date.now() } });
  assert.equal(c.journalWeatherFor(today).tempC, 21);
  c.setJournalMood(today, 'ok');
  assert.equal(c.journalWeatherFor(today).code, 3, 'weather survives a mood change');
});

test('weatherDesc maps WMO codes into emoji + label buckets', () => {
  const c = make();
  assert.equal(c.weatherDesc(0).l, 'Clear');
  assert.equal(c.weatherDesc(2).l, 'Partly cloudy');
  assert.equal(c.weatherDesc(3).l, 'Overcast');
  assert.equal(c.weatherDesc(61).l, 'Rain');
  assert.equal(c.weatherDesc(75).l, 'Snow');
  assert.equal(c.weatherDesc(95).l, 'Thunderstorm');
  assert.ok(c.weatherDesc(0).e, 'has an emoji');
});

test('journalAutoLog auto-records completed, worked-on, and habits-done', () => {
  const c = make();
  const today = c.startOfToday();
  const ymd = c.ymdOf(today);
  const done = activeTask(c, { id: 'd1', completion: today + 3 * 3600000, spentByDay: { [ymd]: 30 } });
  const worked = activeTask(c, { id: 'w1', spentByDay: { [ymd]: 45 } });
  const idle = activeTask(c, { id: 'i1', spentByDay: {} });
  const mile = activeTask(c, { id: 'm1', type: 'Milestone', completion: today + 3600000 });
  c.state.tasks = [done, worked, idle, mile];
  c.state.habits = [{ id: 'h1', name: 'Read', done: { [ymd]: true } }, { id: 'h2', name: 'Run', done: {} }];
  const log = c.journalAutoLog(today);
  // NB: arrays built inside the vm sandbox realm fail deepStrictEqual's prototype check, so compare joined ids.
  assert.equal(log.completed.map(r => r.id).join(','), 'd1', 'only the completed non-milestone task');
  assert.equal(log.worked.map(r => r.id).join(','), 'w1', 'worked-on excludes completed + idle + milestone');
  assert.equal(Math.round(log.worked[0].spent), 45);
  assert.equal(log.habits.map(hb => hb.id).join(','), 'h1', 'only habits done that day');
});

// ---- tiered emotion wheel (post-Phase-10 UI ask) ----

test('EMOTION_WHEEL is the Roberts feelings wheel: 7 cores, 41 secondary, 82 leaves, unique paths', () => {
  const c = make();
  const wheel = c.EMOTION_WHEEL;
  assert.equal(wheel.length, 7, 'seven core emotions');
  let sec = 0, leaves = 0;
  const paths = new Set();
  for (const core of wheel) {
    assert.ok(core.e && core.c, 'each core has an emoji + colour');
    sec += core.kids.length;
    for (const s of core.kids) {
      for (const leaf of s.kids) {
        leaves++;
        paths.add(core.k + '/' + s.k + '/' + leaf.k);
      }
    }
  }
  assert.equal(sec, 41, '41 secondary emotions');
  assert.equal(leaves, 82, '82 tertiary leaf words');
  assert.equal(paths.size, 82, 'every leaf path is globally unique');
});

test('moodInfo resolves wheel paths (core/secondary/leaf) and legacy tokens', () => {
  const c = make();
  // leaf path
  const leaf = c.moodInfo('happy/playful/aroused');
  assert.equal(leaf.path.join(' › '), 'Happy › Playful › Aroused');
  assert.equal(leaf.coreKey, 'happy');
  assert.ok(leaf.color.startsWith('#'), 'leaf carries the core colour');
  // stop at a core
  assert.equal(c.moodInfo('sad').path.join(''), 'Sad');
  // stop at a secondary
  assert.equal(c.moodInfo('angry/mad').path.join(' › '), 'Angry › Mad');
  // duplicate leaf word disambiguated by path (overwhelmed lives under both fearful and bad)
  assert.equal(c.moodInfo('fearful/anxious/overwhelmed').path[0], 'Fearful');
  assert.equal(c.moodInfo('bad/stressed/overwhelmed').path[0], 'Bad');
  // legacy single-token mood still renders
  const lg = c.moodInfo('good');
  assert.ok(lg.legacy && lg.label === 'Good');
  // unknown + null degrade safely
  assert.equal(c.moodInfo('happy/bogus').label, 'happy/bogus');
  assert.equal(c.moodInfo(null), null);
});

test('renderMoodPicker reveals secondary/leaf rows for a bare-core stored mood (C1 drill-down fix)', () => {
  const c = make();
  // children = [badge, coreRow, secRow?, leafRow?] — count tells us how many tiers unlocked.
  const rowsOf = mood => c.renderMoodPicker(Date.now(), mood).children.length;
  // no mood yet: badge + core row only
  assert.equal(rowsOf(null), 2, 'no mood -> badge + core row only');
  // bare core key (what setJournalMood actually stores on a top-level tap) must unlock the secondary row
  assert.equal(rowsOf('happy'), 3, 'bare core mood reveals the secondary row');
  // core/secondary unlocks the leaf row too
  assert.equal(rowsOf('happy/playful'), 4, 'core/secondary mood reveals the leaf row');
  // full leaf path stays at 4 (badge+core+sec+leaf, no deeper tier)
  assert.equal(rowsOf('happy/playful/cheeky'), 4, 'full leaf path keeps all tiers');
  // legacy single-token mood (not a wheel core) must not blow up and shows no secondary row
  assert.equal(rowsOf('good'), 2, 'legacy single-token mood has no wheel children to reveal');
});

test('setJournalMood stores the wheel path and drilling deeper replaces it', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  c.setJournalMood(today, 'happy');
  assert.equal(c.journalEntryFor(today).mood, 'happy');
  c.setJournalMood(today, 'happy/playful');
  assert.equal(c.journalEntryFor(today).mood, 'happy/playful', 'drilling into a secondary replaces the core');
  c.setJournalMood(today, 'happy/playful/cheeky');
  assert.equal(c.journalEntryFor(today).mood, 'happy/playful/cheeky');
  c.setJournalMood(today, 'happy/playful/cheeky'); // click the active leaf again → clear
  assert.equal(c.journalEntryFor(today).mood, undefined, 'clicking the active chip clears the mood');
});
