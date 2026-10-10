// Phase 9 PR4 — Journaling / next-day planning: per-day text store round-trip, the day's
// actuals (allotted vs recorded), and the day-navigation clamp (never past today).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY, withNow, FIXED_NOW, loadComponent } = require('./_load.js');

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
  const inactive = activeTask(c, { id: 'far', included:null, planned: 60, start: today + 30 * DAY, end: today + 31 * DAY });
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

/* ===== V3.2 鈥?the guided journal: a curated, EDITABLE prompt set ==============================
   Everything here is provable without a browser and therefore belongs in `npm test`: the store, the
   CRUD, the serialisation, the "today's lines" selector over the scratchpad, and the shape of the
   rendered panel. What the mock DOM structurally cannot reach 鈥?a live mount, real typing into the
   prompt inputs, the scroll-to 鈥?is in tests/e2e/journal-prompts.spec.js and is NOT restated here.

   The load-bearing product rule these tests exist to protect: prompts are GUIDANCE, NOT persisted
   Q&A. No test below may ever start asserting that an answer was stored against a prompt. */

/** The raw localStorage store behind the sandbox the component was built in. */
function promptStore() { return loadComponent.lastSandbox.localStorage; }

/** Every element node in a shim-React tree, depth-first. */
function nodes(el, out) {
  out = out || [];
  if (!el || typeof el !== 'object') return out;
  if (Array.isArray(el)) { el.forEach((c) => nodes(c, out)); return out; }
  if (!el.props) return out;
  out.push(el);
  (el.children || []).forEach((c) => nodes(c, out));
  return out;
}
/** Elements carrying a given prop key, in render order. */
function withProp(el, key) { return nodes(el).filter((n) => n.props[key] !== undefined); }

/** Re-wrap a value the component built into TEST-realm arrays/objects.
    `tests/_load.js` runs index.html inside a `vm` context, so an array or object literal created in
    there has that context's Array/Object prototype — not the test process's. `assert/strict`'s
    deepStrictEqual compares prototype identity, so comparing such a value against a plain literal
    here fails with "same structure but not reference-equal" even when the data matches exactly.
    Same problem `tests/calendar.gen.test.js` sidesteps with `[...r.shifts]`; this just does it
    recursively so nested rows compare too. It re-homes the container ONLY — every value, key, order
    and length is preserved, so no assertion below is loosened by it. */
function host(v) {
  // NB: `v.map(...)` would hand back another vm-realm array (species comes from the value's own
  // constructor), so the container has to be built here, in this realm.
  if (Array.isArray(v)) { const a = []; for (let i = 0; i < v.length; i++) a.push(host(v[i])); return a; }
  if (v && typeof v === 'object') {
    const o = {}; Object.keys(v).forEach((k) => { o[k] = host(v[k]); }); return o;
  }
  return v;
}

test('V3.2 an unconfigured workspace gets the psychology-informed defaults', () => {
  const c = make();
  const ids = c.journalPromptList().map((p) => p.id);
  assert.deepEqual(ids, c.DEFAULT_JOURNAL_PROMPTS().map((p) => p.id));
  // The two DERIVED prompts are the ones the app can answer for the user; both must ship by default.
  const kinds = c.journalPromptList().map((p) => p.kind);
  assert.ok(kinds.includes('scratch'), '"review your scratchpad" is a required default prompt');
  assert.ok(kinds.includes('aging'), 'the V2 surface-aging hook lands here as a default prompt');
  assert.equal(c.lsGet('pp-journal-prompts'), null, 'defaults are NOT written until the user edits');
});

test('V3.2 prompt-set CRUD (add / edit / reorder / delete) persists', () => {
  const c = make();
  const before = c.journalPromptList().length;

  c.addJournalPrompt('  What did I avoid today?  ');
  const added = c.journalPromptList()[c.journalPromptList().length - 1];
  assert.equal(added.text, 'What did I avoid today?', 'trimmed');
  assert.equal(added.kind, 'text', 'a user prompt is plain guidance, never a derived kind');
  assert.equal(c.journalPromptList().length, before + 1);

  c.addJournalPrompt('   '); // blank is not a prompt
  assert.equal(c.journalPromptList().length, before + 1);

  c.setJournalPromptText('wins', 'Name three good things.');
  assert.equal(c.journalPromptList().find((p) => p.id === 'wins').text, 'Name three good things.');
  c.setJournalPromptText('wins', '   '); // blanking must not silently delete the prompt
  assert.equal(c.journalPromptList().find((p) => p.id === 'wins').text, 'Name three good things.');
  assert.equal(c.journalPromptList().find((p) => p.id === 'scratch').kind, 'scratch',
    'rewording never changes a derived prompt back into plain text');

  const order0 = c.journalPromptList().map((p) => p.id);
  c.moveJournalPrompt(order0[1], -1);
  const order1 = c.journalPromptList().map((p) => p.id);
  assert.deepEqual(host(order1.slice(0, 2)), [order0[1], order0[0]], 'moved up');
  c.moveJournalPrompt(order1[0], -1);
  assert.deepEqual(c.journalPromptList().map((p) => p.id), order1, 'a move off the top is a no-op');
  const last = order1[order1.length - 1];
  c.moveJournalPrompt(last, 1);
  assert.equal(c.journalPromptList()[c.journalPromptList().length - 1].id, last, 'and off the bottom');

  c.deleteJournalPrompt('friction');
  assert.equal(c.journalPromptList().some((p) => p.id === 'friction'), false);

  // Every one of those went through the store, not just through state.
  const reloaded = c.loadJournalPrompts();
  assert.deepEqual(reloaded.items, c.journalPromptList(), 'state and pp-journal-prompts agree');
  assert.ok(reloaded.updatedAt > 0, 'a real write stamps updatedAt');
});

test('V3.2 "I deleted them all" is honoured; only an unconfigured key seeds defaults', () => {
  const c = make();
  c.journalPromptList().slice().forEach((p) => c.deleteJournalPrompt(p.id));
  assert.deepEqual(host(c.journalPromptList()), [], 'an empty set is a legitimate configuration');
  assert.deepEqual(host(c.loadJournalPrompts().items), [], 'and it survives a reload 鈥?not re-seeded');

  c.resetJournalPrompts();
  assert.deepEqual(c.journalPromptList().map((p) => p.id), c.DEFAULT_JOURNAL_PROMPTS().map((p) => p.id));
  assert.equal(c.lsGet('pp-journal-prompts'), null,
    'reset returns to "never configured" so a future default change still reaches the user');
});

test('V3.2 normalizeJournalPrompts is pure and tolerates a hand-edited backup', () => {
  const c = make();
  assert.equal(c.normalizeJournalPrompts(null), null, 'null = no usable list; the caller seeds defaults');
  assert.equal(c.normalizeJournalPrompts(42), null);
  assert.equal(c.normalizeJournalPrompts({ items: 'nope' }), null);
  assert.deepEqual(host(c.normalizeJournalPrompts({ items: [] })), { items: [], updatedAt: 0 });
  // A bare array, and bare strings inside it, are read as the list 鈥?losing a user's prompts to a
  // shape mismatch is a worse failure than accepting a loose shape.
  assert.deepEqual(host(c.normalizeJournalPrompts(['ask me things']).items),
    [{ id: 'p0', kind: 'text', text: 'ask me things' }]);
  const out = c.normalizeJournalPrompts({ items: [
    { id: 'a', text: 'keep', kind: 'aging' },
    { id: 'a', text: 'dup id' },
    { text: 'no id' },
    { id: 'b', text: '   ' },                 // blank -> dropped
    { id: 'c', text: 'weird', kind: 'sql' },  // unknown kind -> plain guidance
    null,
  ], updatedAt: 5 });
  assert.deepEqual(host(out.items.map((p) => p.id)), ['a', 'a~', 'p2', 'c'],
    'duplicate ids disambiguated, blank dropped');
  assert.equal(out.items[0].kind, 'aging');
  assert.equal(out.items[3].kind, 'text');
  assert.equal(out.updatedAt, 5);
});

test('V3.2 a corrupt pp-journal-prompts value loads as the defaults, not as an empty journal', () => {
  const c = make();
  promptStore().setItem('pp-journal-prompts', '{not json');
  assert.deepEqual(c.loadJournalPrompts().items.map((p) => p.id),
    c.DEFAULT_JOURNAL_PROMPTS().map((p) => p.id));
  promptStore().removeItem('pp-journal-prompts');
});

test('V3.2 the prompt set is workspace-scoped, backed up, and NOT synced', () => {
  const c = make();
  c._workspace = 'uid-abc';
  assert.equal(c.wsKey('pp-journal-prompts'), 'pp-journal-prompts::uid-abc');
  c.addJournalPrompt('account A only');
  assert.ok(promptStore().getItem('pp-journal-prompts::uid-abc'));
  assert.equal(promptStore().getItem('pp-journal-prompts'), null, 'the anon key is untouched');
  c._workspace = null;
  promptStore().removeItem('pp-journal-prompts::uid-abc');

  assert.equal(c.BACKUP_KEYS().includes('pp-journal-prompts'), true,
    'local-only store: backup is its ONLY portability today');
  c.addJournalPrompt('worth keeping');
  const backup = c.collectBackup();
  c.lsRemove('pp-journal-prompts');
  assert.deepEqual(c.loadJournalPrompts().items.map((p) => p.id),
    c.DEFAULT_JOURNAL_PROMPTS().map((p) => p.id));
  c.applyBackup(backup);
  assert.equal(c.loadJournalPrompts().items.some((p) => p.text === 'worth keeping'), true);

  // KV_TABLES names real Supabase tables; there is no journal_prompts table, so the set must not
  // claim to sync. Tripwire for whoever adds the table later.
  assert.equal(c.KV_TABLES().includes('journal_prompts'), false);
  assert.equal(c.KV_TABLES().includes('journalPrompts'), false);
  c.state.settings.syncEnabled = true;
  c.addJournalPrompt('should not enqueue');
  assert.deepEqual(c.loadKvQueue(), [], 'editing prompts enqueues nothing');
});

test('V3.2 the day entry persists independently of the prompt set', () => {
  const c = make();
  c.state.journal = {};
  const today = c.startOfToday();
  c.saveJournalText(today, 'the day itself');
  c.journalPromptList().slice().forEach((p) => c.deleteJournalPrompt(p.id));
  assert.equal(c.journalTextFor(today), 'the day itself',
    'deleting every prompt cannot touch a word of it');
  c.resetJournalPrompts();
  assert.equal(c.journalTextFor(today), 'the day itself');
  // And the reverse: writing the day's entry must not write the prompt store.
  const before = c.lsGet('pp-journal-prompts');
  c.saveJournalText(today, 'edited again');
  assert.equal(c.lsGet('pp-journal-prompts'), before, 'a journal entry never touches pp-journal-prompts');
  // Nothing anywhere stores an answer keyed by a prompt id.
  assert.equal(JSON.stringify(c.state.journal).indexOf('grateful'), -1, 'prompts are guidance, not Q&A');
});

test('V3.2 splitScratchBlocks splits the pad into lines (pure, no DOM)', () => {
  const c = make();
  assert.deepEqual(host(c.splitScratchBlocks('')), []);
  assert.deepEqual(host(c.splitScratchBlocks(null)), []);
  assert.deepEqual(host(c.splitScratchBlocks('<div>one</div><div>two</div>')), ['<div>one</div>', '<div>two</div>']);
  // contentEditable leaves the first line bare and wraps the rest.
  assert.deepEqual(host(c.splitScratchBlocks('first<div>second</div>')), ['first', '<div>second</div>']);
  // A top-level <br> is a line break; one inside a block is not.
  assert.deepEqual(host(c.splitScratchBlocks('a<br>b')), ['a', 'b']);
  assert.deepEqual(host(c.splitScratchBlocks('<div>a<br>b</div>')), ['<div>a<br>b</div>']);
  // Nested markup stays with its block; a markup-only block is not a line.
  assert.deepEqual(host(c.splitScratchBlocks('<div><b>bold</b> tail</div><div></div>')), ['<div><b>bold</b> tail</div>']);
  assert.deepEqual(host(c.splitScratchBlocks('<ul><li>x</li><li>y</li></ul>')), ['<ul><li>x</li><li>y</li></ul>']);
});

test('V3.2 "todays lines" is a high-water mark that rolls over with the day', () => {
  const c = make();
  const day2 = FIXED_NOW + DAY;

  withNow(FIXED_NOW, () => {
    // Written on day 1 鈥?from day 2's point of view this is a pad with a stale (day-1) mark.
    c.saveScratchHtml('<div>yesterday note</div>');
  });

  withNow(day2, () => {
    assert.deepEqual(host(c.todayScratchLines()), [], 'a stale mark means nothing has been typed today yet');
    assert.deepEqual(host(c.scratchReviewLines().map((l) => l.today)), [false], 'the old line is not highlighted');

    c.saveScratchHtml('<div>yesterday note</div><div>today A</div>');
    c.saveScratchHtml('<div>yesterday note</div><div>today A</div><div>today B</div>');
    assert.deepEqual(host(c.todayScratchLines().map((l) => l.html)),
      ['<div>today A</div>', '<div>today B</div>'], 'both of todays lines, and only todays');
    assert.deepEqual(host(c.scratchReviewLines().map((l) => l.today)), [false, true, true]);
    assert.deepEqual(host(c.scratchDayMark()), { ymd: c.ymdOf(c.startOfToday()), blocks: 1 },
      'the mark froze at the block count the pad had before todays first edit');
  });

  // The next day rolls the mark forward again 鈥?today's lines are empty until something is typed.
  withNow(day2 + DAY, () => {
    assert.deepEqual(host(c.todayScratchLines()), []);
    c.saveScratchHtml('<div>yesterday note</div><div>today A</div><div>today B</div><div>day three</div>');
    assert.deepEqual(host(c.todayScratchLines().map((l) => l.html)), ['<div>day three</div>']);
  });

  // The document itself is untouched by any of this: no day marker was ever written into pp-scratch.
  assert.deepEqual(Object.keys(JSON.parse(c.lsGet('pp-scratch'))).sort(), ['html', 'updatedAt']);
});

test('V3.2 the mark lives in pp-prefs, so no scratchpad migration is possible or needed', () => {
  const c = make();
  c.saveScratchHtml('<div>a</div>');
  assert.ok(c.loadPrefs().scratchDayMark, 'stamped as a pref');
  assert.equal(JSON.parse(c.lsGet('pp-scratch')).dayMark, undefined, 'never inside the document');
  // Losing prefs costs the highlight for a day, never a line of text.
  c.savePrefs({ scratchDayMark: null });
  assert.equal(c.scratchHtml(), '<div>a</div>');
  assert.deepEqual(host(c.todayScratchLines()), []);
});

test('V3.2 agingTasks surfaces long-open, never-worked tasks (derived, no new field)', () => {
  const c = make();
  const B = c.startOfToday();
  const old = B - (c.AGING_DAYS + 3) * DAY;
  const mk = (over) => c.normalizeTask(Object.assign({
    id: 'ag' + Math.random().toString(36).slice(2, 7), name: 'x', type: 'Proportional',
    start: old, end: B + DAY, planned: 60, spent: 0 }, over));
  c.state.tasks = [
    mk({ id: 'stale', name: 'Stale thing' }),
    mk({ id: 'young', start: B - 2 * DAY }),   // not old enough
    mk({ id: 'worked', spent: 12 }),           // has recorded time
    mk({ id: 'done', completion: B - DAY }),   // finished
    mk({ id: 'pctdone', pct: 100 }),
    mk({ id: 'archived', archivedAt: B }),
    mk({ id: 'milestone', type: 'Milestone' }),
    mk({ id: 'undated', start: null }),        // no measurable age
  ];
  assert.deepEqual(c.agingTasks().map((t) => t.id), ['stale']);

  // It is a review cue, not a backlog dump.
  c.state.tasks = [];
  for (let i = 0; i < c.JOURNAL_AGING_MAX + 5; i++) c.state.tasks.push(mk({ id: 'm' + i, start: old - i * DAY }));
  assert.equal(c.agingTasks().length, c.JOURNAL_AGING_MAX);
  assert.equal(c.agingTasks()[0].id, 'm' + (c.JOURNAL_AGING_MAX + 4), 'oldest first');
  // Nothing was mutated by looking.
  assert.equal(c.state.tasks.every((t) => t.updatedAt == null), true);
});

test('V3.2 renderJournalPrompts renders one row per prompt, editable only in edit mode', () => {
  const c = make();
  c.state.tasks = [];
  c.saveScratchHtml('<div>a note</div>');
  const view = c.renderJournalPrompts();
  const rows = withProp(view, 'data-prompt-id');
  assert.deepEqual(rows.map((r) => r.props['data-prompt-id']), host(c.journalPromptList().map((p) => p.id)));
  assert.equal(withProp(view, 'data-prompt-input').length, 0, 'view mode has no text inputs');
  assert.equal(withProp(view, 'data-prompt-new').length, 0, 'and no adder');
  // The derived prompts render their own body rather than asking the user to answer in a box.
  assert.equal(withProp(view, 'data-scratch-review').length, 1, 'the scratch prompt renders the pad itself');
  assert.equal(withProp(view, 'data-aging-list').length, 0, 'no aging tasks in this fixture');

  c.state.journalPromptsEdit = true;
  const edit = c.renderJournalPrompts();
  assert.equal(withProp(edit, 'data-prompt-input').length, c.journalPromptList().length, 'every prompt is editable');
  assert.equal(withProp(edit, 'data-prompt-new').length, 1, 'add-your-own');
  assert.equal(withProp(edit, 'data-prompts-reset').length, 1, 'restore defaults');
  // The edit input commits through the store writer, not a per-row closure.
  withProp(edit, 'data-prompt-input')[0].props.onBlur({ target: { value: 'reworded' } });
  assert.equal(c.journalPromptList()[0].text, 'reworded');

  // Collapsed: header only, no rows 鈥?the panel never blocks the day's entry.
  c.state.journalPromptsOpen = false;
  assert.equal(withProp(c.renderJournalPrompts(), 'data-prompt-id').length, 0);
  assert.equal(withProp(c.renderJournalPrompts(), 'data-prompts-toggle').length, 1, 'and is reopenable');
});

test('V3.2 the aging prompt lists stalled tasks and links straight to them', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [c.normalizeTask({ id: 'rot', name: 'Old thing', type: 'Proportional',
    start: B - (c.AGING_DAYS + 5) * DAY, end: B + DAY, planned: 60, spent: 0 })];
  const el = c.renderAgingBody();
  const rows = withProp(el, 'data-aging-task');
  assert.deepEqual(rows.map((r) => r.props['data-aging-task']), ['rot']);
  assert.equal(typeof rows[0].props.onClick, 'function', 'answering "still relevant?" means opening it');
  // Rendering the prompt must never change a task 鈥?surfacing is not nagging, and not editing.
  const snapshot = JSON.stringify(c.state.tasks);
  c.renderAgingBody();
  assert.equal(JSON.stringify(c.state.tasks), snapshot);
});

test('V3.2 renderScratchReview marks todays lines and targets the first of them', () => {
  const c = make();
  withNow(FIXED_NOW, () => { c.saveScratchHtml('<div>old</div>'); });
  withNow(FIXED_NOW + DAY, () => {
    c.saveScratchHtml('<div>old</div><div>fresh</div>');
    const el = c.renderScratchReview();
    const lines = withProp(el, 'data-scratch-line');
    assert.deepEqual(lines.map((l) => l.props['data-scratch-line']), ['past', 'today']);
    assert.equal(lines[1].props.id, 'pp-scratch-today', 'the first of todays lines is the scroll target');
    assert.equal(lines[0].props.id, undefined);
    assert.equal(typeof lines[1].props.ref, 'function', 'scrolled into view on mount');
  });
});

test('V3.2 the evening auto-open fires at most once per session and only opens', () => {
  const c = make();
  const evening = new Date(FIXED_NOW); evening.setHours(c.JOURNAL_EVENING_HOUR + 1, 0, 0, 0);
  const morning = new Date(FIXED_NOW); morning.setHours(9, 0, 0, 0);
  const fresh = () => { const x = make(); x.state.journalPromptsOpen = false; x._journalPromptsAuto = false; return x; };

  let x = fresh();
  withNow(morning.getTime(), () => { assert.equal(x.journalPromptsEveningAutoOpen(), false, 'not before evening'); });

  x = fresh();
  withNow(evening.getTime(), () => {
    assert.equal(x.journalPromptsEveningAutoOpen(), true, 'the first evening open');
    assert.equal(x.journalPromptsEveningAutoOpen(), false, 'session-guarded: never twice');
  });

  // A panel the user already has open is not "auto-opened", and the guard never closes anything.
  x = fresh(); x.state.journalPromptsOpen = true;
  withNow(evening.getTime(), () => { assert.equal(x.journalPromptsEveningAutoOpen(), false); });
  assert.equal(x.state.journalPromptsOpen, true);
  // It also never writes the pref 鈥?a deliberate "keep it collapsed" must survive tomorrow.
  assert.equal(c.loadPrefs().journalPromptsOpen, undefined);
});
