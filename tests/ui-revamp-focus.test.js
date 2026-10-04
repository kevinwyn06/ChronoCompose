// UI revamp block 10a — Focus re-laid around a "Now" hero.
// 1. focusNowModel: the hero is the running timer's task, else the block spanning now, else the next block;
//    "next up" lists the following blocks, one per task, meals excluded.
// 2. Habit consistency counts from creation (pages audit finding 8), not over days before the habit existed.
// 3. Note and Scratchpad are two tabs of one editor panel; "n" selects the Scratchpad tab.
// 4. The Music stub is not rendered until it is wired.
// 5. Habits are one strip that collapses to one line, and the page's small controls render >= HIT_MIN_PX.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, withNow, FIXED_NOW, DAY } = require('./_load.js');

const M = 60000;
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const renderedPx = (c, v) => parseFloat(v) * c.SHELL_ZOOM;

// ---------------------------------------------------------------------------
// 1. Hero model
// ---------------------------------------------------------------------------

const NOW = 1000 * M;
const chunks = [
  { id: 'past', title: 'Past', start: NOW - 90 * M, end: NOW - 30 * M, type: 'scheduled' },
  { title: 'Lunch', start: NOW - 10 * M, end: NOW + 20 * M, type: 'meal' },
  { id: 'cur', title: 'Current', start: NOW - 20 * M, end: NOW + 10 * M, type: 'scheduled' },
  { id: 'n1', title: 'Next one', start: NOW + 10 * M, end: NOW + 40 * M, type: 'scheduled' },
  { id: 'n2', title: 'Next two', start: NOW + 40 * M, end: NOW + 60 * M, type: 'fixed' },
  { id: 'n1', title: 'Next one', start: NOW + 60 * M, end: NOW + 70 * M, type: 'scheduled' },
  { id: 'n3', title: 'Next three', start: NOW + 70 * M, end: NOW + 80 * M, type: 'scheduled' },
  { id: 'n4', title: 'Next four', start: NOW + 80 * M, end: NOW + 90 * M, type: 'scheduled' },
];

test('focusNowModel: a running timer is the hero, whatever the timeline says', () => {
  const c = make();
  const m = c.focusNowModel({ id: 'n3', name: 'Next three', elapsedMs: 5 * M }, chunks, NOW, 3);
  assert.equal(m.hero.source, 'running');
  assert.equal(m.hero.id, 'n3');
  assert.equal(m.hero.elapsedMs, 5 * M);
  assert.deepEqual(m.next.map((b) => b.id), ['cur', 'n1', 'n2'], 'next up skips the hero, keeps timeline order');
});

test('focusNowModel: no timer → the block spanning now; never a meal', () => {
  const c = make();
  const m = c.focusNowModel(null, chunks, NOW, 3);
  assert.equal(m.hero.source, 'current');
  assert.equal(m.hero.id, 'cur');
  assert.equal(m.hero.end, NOW + 10 * M);
  assert.deepEqual(m.next.map((b) => b.id), ['n1', 'n2', 'n3'], 'one entry per task, at most n, past blocks dropped');
});

test('focusNowModel: nothing now → the next block; nothing left → no hero', () => {
  const c = make();
  const later = chunks.filter((x) => x.id !== 'cur');
  const m = c.focusNowModel(null, later, NOW, 2);
  assert.equal(m.hero.source, 'next');
  assert.equal(m.hero.id, 'n1');
  assert.equal(m.next.length, 2);
  assert.ok(m.next.every((b) => b.id !== 'n1'), 'the hero is not repeated in next up');
  const none = c.focusNowModel(null, [chunks[0], chunks[1]], NOW, 3);
  assert.equal(none.hero, null);
  assert.deepEqual(none.next, []);
  assert.equal(c.focusNowModel(null, null, NOW).next.length, 0);
});

test('focusNowModel: routines are never the idle hero nor next up; a RUNNING routine still is the hero', () => {
  const c = make();
  const isR = (id) => id === 'cur' || id === 'n2';
  const m = c.focusNowModel(null, chunks, NOW, 3, isR);
  assert.equal(m.hero.source, 'next', 'the routine under now is skipped');
  assert.equal(m.hero.id, 'n1');
  assert.deepEqual(m.next.map((b) => b.id), ['n3', 'n4']);
  const r = c.focusNowModel({ id: 'cur', name: 'Exercise', elapsedMs: 0 }, chunks, NOW, 3, isR);
  assert.equal(r.hero.source, 'running');
  assert.equal(r.hero.id, 'cur');
});

test('focusNowModel: n defaults to FOCUS_NEXT_N', () => {
  const c = make();
  assert.equal(c.focusNowModel(null, chunks, NOW).next.length, c.FOCUS_NEXT_N);
});

test('the hero names the running task with Stop; Stop stops it; idle it offers Start', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'Write report' })];
  c.startTimer('a'); c.state.nowTick = Date.now() + 3 * M;
  let hero = c.renderFocusNow();
  assert.equal(hero.props['data-focus-hero'], 'running');
  assert.equal(textOf(find(hero, (p) => p['data-focus-hero-name'])[0]), 'Write report');
  const tog = find(hero, (p) => p['data-focus-hero-toggle'])[0];
  assert.equal(tog.props['data-focus-hero-toggle'], 'stop');
  assert.ok(renderedPx(c, tog.props.style.height) >= c.HIT_MIN_PX, 'Start/Stop renders at least HIT_MIN_PX');
  assert.equal(find(hero, (p) => p['data-pomo-mode'] === 'mirror').length, 1, 'the Pomodoro ring is part of the hero');
  assert.equal(find(hero, (p) => p['data-task-id']).length, 0, 'the hero adds no task-list rows');
  tog.props.onClick();
  assert.equal(c.isRunning('a'), false);
  hero = c.renderFocusNow();
  assert.notEqual(hero.props['data-focus-hero'], 'running');
}));

// ---------------------------------------------------------------------------
// 2. Habit consistency counts from creation
// ---------------------------------------------------------------------------

test('habitConsistency: a habit created today and done today is 100%, not 3%', () => withNow(FIXED_NOW, () => {
  const c = make();
  const today = c.startOfToday();
  const hb = c.normalizeHabit({ id: 'h', name: 'Stretch', createdAt: today + 9 * 3600000, done: { [c.ymdOf(today)]: true } });
  const d = c.habitConsistency(hb, Date.now(), 30, {});
  assert.deepEqual(d, { sched: 1, done: 1, pct: 100 });
}));

test('habitConsistency: done 8 of its 9 days reads 89%, not 27%', () => withNow(FIXED_NOW, () => {
  const c = make();
  const today = c.startOfToday();
  const done = {}; for (let i = 0; i < 9; i++) if (i !== 4) done[c.ymdOf(today - i * DAY)] = true;
  const hb = c.normalizeHabit({ id: 'h', name: 'Read', createdAt: today - 8 * DAY + 3600000, done });
  const d = c.habitConsistency(hb, Date.now(), 30, {});
  assert.equal(d.sched, 9); assert.equal(d.done, 8); assert.equal(d.pct, 89);
}));

test('habitConsistency: today is not a miss until it ends (the streak\'s grace); a brand-new habit has nothing to score', () => withNow(FIXED_NOW, () => {
  const c = make();
  const today = c.startOfToday();
  const fresh = c.normalizeHabit({ id: 'h', name: 'New', createdAt: today + 3600000 });
  assert.deepEqual(c.habitConsistency(fresh, Date.now(), 30, {}), { sched: 0, done: 0, pct: 0 });
  const old = c.normalizeHabit({ id: 'h', name: 'Old', createdAt: today - 2 * DAY, done: { [c.ymdOf(today - DAY)]: true } });
  assert.deepEqual(c.habitConsistency(old, Date.now(), 30, {}), { sched: 2, done: 1, pct: 50 });
}));

test('habitTrackStart: creation day, opened earlier by a deliberate back-filled check', () => withNow(FIXED_NOW, () => {
  const c = make();
  const today = c.startOfToday();
  assert.equal(c.habitTrackStart(c.normalizeHabit({ createdAt: today + 5 * 3600000 })), today);
  const back = c.normalizeHabit({ createdAt: today, done: { [c.ymdOf(today - 3 * DAY)]: true } });
  assert.equal(c.habitTrackStart(back), c.startOfDay(today - 3 * DAY));
  assert.equal(c.habitConsistency(back, Date.now(), 30, {}).sched, 3, 'the back-filled day opens the window (today, not yet done, is not counted)');
  assert.equal(c.habitTrackStart({ done: {} }), null, 'no createdAt, no ticks → no clamp');
  assert.equal(c.habitTrackStart(null), null);
}));

test('the Habits view marks days before creation as "before", not as misses, and carries weekday ticks', () => withNow(FIXED_NOW, () => {
  const c = make();
  const today = c.startOfToday();
  c.state.habits = [c.normalizeHabit({ id: 'h', name: 'Stretch', createdAt: today - 2 * DAY })];
  const v = c.renderHabitsView(true);
  const cells = find(v, (p) => p['data-habit-cell']).map((n) => n.props['data-habit-cell']);
  assert.equal(cells.length, 14);
  assert.equal(cells.filter((x) => x === 'before').length, 11);
  assert.equal(cells.filter((x) => x === 'missed').length, 3);
  const ticks = find(v, (p) => p['data-habit-ticks'])[0];
  assert.equal(textOf(ticks).length, 14, 'one weekday letter per cell');
  // delete lives behind the ⋯ menu, which is a real HIT_MIN_PX button
  assert.equal(find(v, (p) => p['data-habit-delete']).length, 0);
  const more = find(v, (p) => p['data-habit-menu'])[0];
  assert.ok(renderedPx(c, more.props.style.width) >= c.HIT_MIN_PX);
  more.props.onClick();
  assert.equal(find(c.renderHabitsView(true), (p) => p['data-habit-delete']).length, 1);
}));

test('the Habits view adds a habit by NAME (no unnamed "New habit")', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.habits = [];
  const add = find(c.renderHabitsView(true), (p) => p['data-qa'] === 'habits-add-habit')[0];
  add.props.onClick();
  const draft = find(c.renderHabitsView(true), (p) => p['data-qa'] === 'habits-habit-draft')[0];
  assert.ok(draft, 'the button opens an inline name field');
  draft.props.onChange({ target: { value: 'Floss' } });
  find(c.renderHabitsView(true), (p) => p['data-qa'] === 'habits-habit-draft')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(c.state.habits.map((x) => x.name), ['Floss']);
}));

// ---------------------------------------------------------------------------
// 3. Note | Scratchpad tabs
// ---------------------------------------------------------------------------

test('Note and Scratchpad are tabs of one panel: one editor at a time, the choice persists', () => withNow(FIXED_NOW, () => {
  const c = make();
  let p = c.renderFocusNotes();
  const tabs = find(p, (q) => q['data-focus-note-tab']);
  assert.deepEqual(tabs.map((t) => t.props['data-focus-note-tab']), ['note', 'scratch']);
  tabs.forEach((t) => assert.ok(renderedPx(c, t.props.style.height) >= c.HIT_MIN_PX));
  assert.equal(c.focusNoteTab(), 'scratch', 'the scratchpad (Focus is its home) by default');
  assert.equal(find(p, (q) => q.id === 'pp-scratch-editor').length, 1);
  assert.equal(find(p, (q) => q.id === 'pp-journal-editor').length, 0);
  tabs[0].props.onClick();
  p = c.renderFocusNotes();
  assert.equal(find(p, (q) => q.id === 'pp-journal-editor').length, 1, 'Note = today’s journal entry');
  assert.equal(find(p, (q) => q.id === 'pp-scratch-editor').length, 0);
  assert.equal(c.loadPrefs().focusNoteTab, 'note', 'persisted in pp-prefs');
  c.state.focusNoteTab = undefined; c._focusNoteTabPref = undefined; // as a fresh mount sees it
  assert.equal(c.focusNoteTab(), 'note', 'a new mount reopens the tab last used');
}));

test('"n" (gotoScratchpad) opens Focus on the Scratchpad tab', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.setFocusNoteTab('note');
  c.gotoScratchpad();
  assert.equal(c.state.dashMode, 'focus');
  assert.equal(c.focusNoteTab(), 'scratch');
  assert.equal(find(c.renderFocusNotes(), (q) => q.id === 'pp-scratch-editor').length, 1);
}));

// ---------------------------------------------------------------------------
// 4. Music stub hidden; 5. habits strip and hit targets
// ---------------------------------------------------------------------------

test('the Music stub is not rendered until it is wired (the code path stays)', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'A' })];
  assert.equal(c.MUSIC_WIRED, false);
  assert.ok(!/Not wired up yet|♪ Music/.test(textOf(c.renderDashFocus(c.state.tasks))));
  c.MUSIC_WIRED = true;
  assert.ok(/♪ Music/.test(textOf(c.renderDashFocus(c.state.tasks))), 'flipping the constant brings the dock back');
}));

test('Focus is two columns: the work column (hero, habits, tasks | notes) and the timeline', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'A' })];
  const v = c.renderDashFocus(c.state.tasks);
  assert.ok(v.props['data-focus-layout']);
  const work = find(v, (p) => p['data-focus-work'])[0];
  assert.ok(work && find(v, (p) => p['data-focus-timeline']).length === 1);
  assert.ok(find(work, (p) => p['data-focus-hero']).length === 1);
  assert.ok(find(work, (p) => p['data-focus-habits']).length === 1);
  assert.ok(find(work, (p) => p['data-focus-tasks']).length === 1);
  assert.ok(find(work, (p) => p['data-focus-notes']).length === 1);
}));

test('habits strip: one line with Add habit when nothing is due; chips with real hit boxes when it is', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.habits = [];
  let s = c.renderFocusHabitStrip();
  assert.ok(/No habits scheduled today\./.test(textOf(s)));
  assert.equal(find(s, (p) => p['data-qa'] === 'focus-add-habit').length, 1);
  assert.equal(find(s, (p) => p['data-habit-chip']).length, 0);
  c.state.habits = [c.normalizeHabit({ id: 'h1', name: 'Stretch' }), c.normalizeHabit({ id: 'h2', name: 'Walk' })];
  s = c.renderFocusHabitStrip();
  const chips = find(s, (p) => p['data-habit-chip']);
  assert.equal(chips.length, 2);
  chips.forEach((ch) => assert.ok(renderedPx(c, ch.props.style.height) >= c.HIT_MIN_PX));
  assert.equal(textOf(find(s, (p) => p['data-focus-habits-count'])[0]), '0/2');
  chips[0].props.onClick();
  assert.equal(textOf(find(c.renderFocusHabitStrip(), (p) => p['data-focus-habits-count'])[0]), '1/2');
}));

test('Pomodoro: the gear is a real HIT_MIN_PX button, and the ring wears tokens (no danger red)', () => withNow(FIXED_NOW, () => {
  const c = make();
  const panel = c.renderPomodoroPanel({ inHero: true, taskId: null });
  const gear = find(panel, (p) => p['data-pomo-gear'])[0];
  assert.equal(gear.type, 'button');
  assert.ok(renderedPx(c, gear.props.style.width) >= c.HIT_MIN_PX);
  assert.ok(renderedPx(c, gear.props.style.height) >= c.HIT_MIN_PX);
  const arc = find(panel, (p) => p['data-pomo-arc'])[0];
  assert.equal(arc.props.stroke, 'var(--accent)');
  c.startPomodoro(null);
  c.skipPomoPhase();
  const brk = c.renderPomodoroPanel({ inHero: true });
  assert.equal(brk.props['data-pomo-phase'], 'break');
  assert.equal(find(brk, (p) => p['data-pomo-arc'])[0].props.stroke, 'var(--calm)', 'a break is calm, not red');
  find(brk, (p) => p['data-pomo-skip']).forEach((b) => assert.ok(renderedPx(c, b.props.style.height) >= c.HIT_MIN_PX));
}));
