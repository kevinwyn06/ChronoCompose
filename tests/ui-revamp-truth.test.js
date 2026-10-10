// UI revamp block 11b — the app tells the truth, and the first minute works.
// 1. Settings, signed out, offers nothing that cannot work (no Calendar connect, Backfill or Import) and
//    says why, with a Sign in action; no developer copy reaches users; Journal weather lives in General;
//    the tabs are a real tab set (tablist / tab / tabpanel, arrow keys).
// 2. The top bar carries a quiet sync status built from the existing sync state (no request).
// 3. One product name; a real first run (routines already seeded) shows the welcome; the welcome's own
//    example lands as one task due Friday 2pm that is on TODAY's list; quick add closes; the demo keeps
//    the welcome for later and files into real sections.
// 4. Dates render in one English format whatever the machine locale; a bare toLocale*String call fails.
// 5. Review's comparison reads "vs this time last week".
// 6. The light toast has a real edge; the habit menu closes on Escape and on an outside press.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { make, withNow } = require('./_load.js');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
const SCRIPT = HTML.match(/<script data-pp-app>([\s\S]*?)<\/script>/)[1];

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};

// Sunday 2026-10-04, 3pm local — the audit's day.
const SUN = new Date(2026, 9, 4, 15, 0, 0, 0).getTime();

function settingsText(c, tab) { c.state.settingsTab = tab; return textOf(c.renderSettings()); }

// ---------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------

test('signed out: Calendar offers no connect, Backfill or Import — a reason and a Sign in action instead', () => {
  const c = make();
  c.syncConfigured = () => true;
  c.state.sync = Object.assign({}, c.state.sync, { connected: false });
  c.state.settingsTab = 'integrations';
  const tree = c.renderSettings();
  const text = textOf(tree);
  assert.doesNotMatch(text, /Sign in with Google|Reconnect Google/);
  assert.doesNotMatch(text, /Backfill to Google|Import now|Import window|Auto-sync every/);
  assert.doesNotMatch(text, /already on Google/);
  assert.match(text, /Sign in to your account to connect Google Calendar\./);
  const btn = find(tree, (p) => p['data-settings-signin'])[0];
  assert.ok(btn && btn.type === 'button', 'a real Sign in button');
  assert.equal(textOf(btn), 'Sign in');
});

test('signed in: the Calendar controls are there; "already on Google" is said only when connected', () => {
  const c = make();
  c.syncConfigured = () => true;
  c.state.sync = Object.assign({}, c.state.sync, { connected: true });
  const text = settingsText(c, 'integrations');
  assert.match(text, /Sign in with Google/);
  assert.match(text, /Backfill to Google/);
  assert.match(text, /Import now/);
  assert.match(text, /Connect Google Calendar first\./, 'calendar not connected yet: no false claim');
  assert.equal(c.gcalBackfillNote(false, 0), 'Connect Google Calendar first.');
  assert.equal(c.gcalBackfillNote(true, 0), 'All dated tasks are already on Google.');
  assert.match(c.gcalBackfillNote(true, 3), /Send 3 un-synced tasks/);
});

test('no developer copy reaches users in any Settings tab', () => {
  for (const connected of [false, true]) {
    const c = make();
    c.state.sync = Object.assign({}, c.state.sync, { connected });
    for (const tab of ['general', 'scheduling', 'notifications', 'integrations', 'data']) {
      const text = settingsText(c, tab);
      assert.doesNotMatch(text, /config\.js|static-server|\.telemetry|Supabase|anon key|Client ID loaded/i, tab + ' (connected=' + connected + ')');
    }
  }
});

test('Journal weather is a General setting, not an Integration', () => {
  const c = make();
  assert.match(settingsText(c, 'general'), /Journal.*Auto weather \(location\)/);
  assert.doesNotMatch(settingsText(c, 'integrations'), /Auto weather/);
});

test('Settings tabs: tablist / tab / tabpanel, one Tab stop, arrows move and select', () => {
  const c = make();
  c.state.settingsTab = 'general';
  const tree = c.renderSettings();
  const list = find(tree, (p) => p.role === 'tablist')[0];
  assert.ok(list && list.props['aria-label'], 'a named tablist');
  const tabs = find(list, (p) => p.role === 'tab');
  assert.equal(tabs.length, 5);
  assert.deepEqual(tabs.map((t) => t.props.tabIndex), [0, -1, -1, -1, -1], 'only the selected tab is a Tab stop');
  tabs.forEach((t) => assert.equal(t.props['aria-controls'], 'pp-settings-panel'));
  const panel = find(tree, (p) => p.role === 'tabpanel')[0];
  assert.ok(panel, 'a tabpanel');
  assert.equal(panel.props.id, 'pp-settings-panel');
  assert.equal(panel.props['aria-labelledby'], tabs[0].props.id);
  const keys = ['general', 'scheduling', 'notifications', 'integrations', 'data'];
  assert.equal(c.settingsTabKey(keys, 'general', 'ArrowRight'), 'scheduling');
  assert.equal(c.settingsTabKey(keys, 'general', 'ArrowLeft'), 'data', 'wraps');
  assert.equal(c.settingsTabKey(keys, 'data', 'ArrowRight'), 'general', 'wraps');
  assert.equal(c.settingsTabKey(keys, 'scheduling', 'Home'), 'general');
  assert.equal(c.settingsTabKey(keys, 'scheduling', 'End'), 'data');
  assert.equal(c.settingsTabKey(keys, 'scheduling', 'a'), null);
  let prevented = false;
  tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(c.state.settingsTab, 'scheduling');
  assert.ok(prevented);
});

// ---------------------------------------------------------------------------
// 2. Sync status in the top bar
// ---------------------------------------------------------------------------

test('sync status: local only, sign-in prompt, syncing, synced, error — from existing state only', () => {
  const c = make();
  assert.equal(c.syncStatusModel({}, false).text, 'Local only');
  assert.equal(c.syncStatusModel({ connected: false }, true).text, 'Local only · Sign in to sync');
  assert.equal(c.syncStatusModel({ connected: true, pulling: true }, true).text, 'Syncing…');
  assert.equal(c.syncStatusModel({ connected: true, sending: true }, true).kind, 'syncing');
  assert.equal(c.syncStatusModel({ connected: true }, true).text, 'Synced');
  assert.equal(c.syncStatusModel({ connected: true, lastError: { msg: 'x' } }, true).text, 'Sync error');
  assert.equal(c.syncStatusModel({ connected: true, needsReauth: true, lastError: { msg: 'x' } }, true).kind, 'error');
});

test('the top bar always shows the sync status, beside the gear, and it opens the account settings', () => {
  const c = make();
  c.state.sync = Object.assign({}, c.state.sync, { connected: false });
  const vals = c.renderVals();
  const right = vals.drawertoggle;
  assert.equal(right.props['data-topbar-right'], '1');
  const st = find(right, (p) => p['data-sync-status'])[0];
  assert.ok(st, 'present while idle and signed out');
  assert.equal(st.type, 'button');
  assert.match(st.props['aria-label'], /^Sync: Local only/);
  assert.doesNotMatch(st.props['aria-label'], /settings/i, 'the gear stays the only control named Settings');
  assert.ok(parseFloat(st.props.style.height) * c.SHELL_ZOOM >= c.HIT_MIN_PX);
  st.props.onClick();
  assert.equal(c.state.settingsOpen, true);
  assert.equal(c.state.settingsTab, 'integrations');
});

// ---------------------------------------------------------------------------
// 3. The first minute
// ---------------------------------------------------------------------------

test('one product name: the detail panel\'s Project row says ChronoCompose', () => {
  const c = make();
  assert.equal(c.PROJECT, 'ChronoCompose');
  assert.equal(c.APP_TITLE, 'ChronoCompose');
});

test('a real first run (routines already seeded) still shows the welcome; adding work retires it', () => withNow(SUN, () => {
  const c = make();
  c.state.settings.usageTracking = false;
  c.seedRoutines();
  assert.ok(c.state.tasks.length >= 2, 'the new workspace has its routines');
  assert.equal(c.workTaskCount(), 0, 'routines are not the user\'s work');
  assert.equal(c.firstRunModal(), true, 'so the welcome shows');
  assert.equal(c.firstRunStep(), 0);
  c.setState({ quickOpen: true, quickText: 'Finish the report by Friday 2pm' });
  c.runQuickAdd('bottom');
  assert.equal(c.state.quickOpen, false, 'quick add closes after the add (decision 21)');
  assert.equal(c.firstRunModal(), false);
  assert.equal(c.firstRunStep(), 1);
}));

test('the welcome\'s example lands as ONE task due Friday 2pm that is on today\'s list', () => withNow(SUN, () => {
  const c = make();
  c.state.settings.usageTracking = false;
  c.setState({ quickOpen: true, quickText: 'Finish the report by Friday 2pm' });
  c.runQuickAdd('bottom');
  assert.equal(c.state.tasks.length, 1, 'one task');
  const t = c.state.tasks[0];
  assert.equal(t.name, 'Finish the report');
  assert.equal(t.recur, null, 'not a repeat');
  assert.equal(t.start, null, 'no invented start');
  assert.equal(t.end, new Date(2026, 9, 9, 14, 0, 0, 0).getTime(), 'due Friday 2pm');
  c.renderVals();
  const B = c.startOfToday();
  assert.equal(c.autoIncludedToday(t), true, 'deadline-only work is on today\'s list from the day it is typed');
  assert.equal(c.isActiveOn(t, B), true, 'and it is drawn today, not only on the days after');
  assert.equal(c.startsToday(t), false, 'filing is unchanged: a deadline is not New every day');
}));

test('deadline-only work stays out of today once its deadline has passed, when snoozed, or when done', () => withNow(SUN, () => {
  const c = make();
  const B = c.startOfToday();
  const done = c.normalizeTask({ id: 'd', name: 'Done', end: B + 3 * 86400000, pct: 100 });
  const snoozed = c.normalizeTask({ id: 's', name: 'Later', end: B + 3 * 86400000, snoozeUntil: B + 2 * 86400000 });
  const past = c.normalizeTask({ id: 'p', name: 'Past', end: B - 3 * 86400000 });
  c.state.tasks = [done, snoozed, past];
  c.renderVals();
  assert.equal(c.autoIncludedToday(done), false);
  assert.equal(c.autoIncludedToday(snoozed), false);
  assert.equal(c.autoIncludedToday(past), false, 'auto-inclusion is not how overdue work comes back');
}));

test('no morning summary over the first-run welcome', () => withNow(SUN, () => {
  const c = make();
  c.notifyOn = () => true;
  c.saveNotify = () => {};
  c._notify = { fired: {}, summaryDay: null };
  c.maybeMorningSummary(SUN);
  assert.equal(c.state.summary == null, true);
}));

test('Load demo: real sections (reusing a same-named one), no tag chips, and the welcome is kept for later', () => withNow(SUN, () => {
  const c = make();
  c.state.settings.usageTracking = false;
  c.saveSections(c.addSectionTo([], 'Work'));
  const workId = c.state.sections[0].id;
  c.loadDemo();
  const demo = c.state.tasks.filter((t) => t.demo);
  assert.ok(demo.length >= 5);
  demo.forEach((t) => assert.ok(t.sectionId, t.name + ' is in a section, not "No section"'));
  demo.forEach((t) => assert.deepEqual(t.labels, [], t.name + ' carries no tag chips'));
  const names = new Set(c.state.sections.map((s) => s.name));
  ['Work', 'Study', 'Personal'].forEach((n) => assert.ok(names.has(n), n));
  assert.equal(c.state.sections.filter((s) => s.name === 'Work').length, 1, 'the existing Work section is reused');
  assert.ok(demo.some((t) => t.sectionId === workId));
  assert.equal(c.state.firstRunSeen, false, 'loading the demo does not consume the welcome');
  c.clearDemo();
  assert.deepEqual(c.state.sections.map((s) => s.name), ['Work'], 'the sections the demo made go with it; yours stay');
  assert.equal(c.firstRunModal(), true, 'an empty workspace again → the welcome is back');
}));

// ---------------------------------------------------------------------------
// 4. Locale
// ---------------------------------------------------------------------------

test('no bare-locale date formatting: every toLocale*String goes through fmtDate (this.LOCALE)', () => {
  const calls = SCRIPT.match(/\.toLocale(?:Date|Time)?String\([^)]*\)?/g) || [];
  const bad = calls.filter((s) => !/^\.toLocaleDateString\(this\.LOCALE/.test(s));
  assert.deepEqual(bad, [], 'route dates through fmtDate()');
  assert.equal(calls.length, 1, 'fmtDate is the only caller');
  const intl = SCRIPT.match(/Intl\.DateTimeFormat\([^)]*\)(\.\w+)?/g) || [];
  intl.forEach((s) => assert.match(s, /^Intl\.DateTimeFormat\(\)\.resolvedOptions$/, 'Intl only for the time zone: ' + s));
});

test('fmtDate is English whatever the machine says', () => {
  const c = make();
  assert.equal(c.LOCALE, 'en-US');
  const d = new Date(2026, 9, 4, 12, 0, 0, 0).getTime();
  assert.equal(c.fmtDate(d, { month: 'short', day: 'numeric' }), 'Oct 4');
  assert.equal(c.fmtDate(new Date(d), { weekday: 'long', month: 'long', day: 'numeric' }), 'Sunday, October 4');
  assert.equal(c.sheetDateParts({ start: d, startClock: null }, 'start').date, 'Oct 4');
});

// ---------------------------------------------------------------------------
// 5–6. Review wording, toast, habit menu
// ---------------------------------------------------------------------------

test('Review compares with "this time last week"', () => {
  const c = make();
  assert.equal(c.reviewVsText({ partial: true, n: 1, off: 0 }), 'vs this time last week');
  assert.equal(c.reviewVsText({ partial: true, n: 4, off: 0 }), 'vs this time last week');
  assert.equal(c.reviewVsText({ partial: false, off: 0 }), 'vs last week');
});

test('the light toast has a visible edge (≥3:1 on the page) and the deeper lift', () => {
  const light = STYLE.slice(STYLE.indexOf(':root[data-theme="light"]{\n  --sh-1'));
  const border = (light.match(/--toast-border:(#[0-9a-f]{6})/i) || [])[1];
  assert.ok(border, 'a light --toast-border hex');
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bg = (STYLE.match(/:root\[data-theme="light"\]\{[^}]*?--bg:(#[0-9a-f]{6})/i) || [])[1];
  const r = (Math.max(lum(rgb(border)), lum(rgb(bg))) + 0.05) / (Math.min(lum(rgb(border)), lum(rgb(bg))) + 0.05);
  assert.ok(r >= 3, 'toast border vs page: ' + r.toFixed(2));
  assert.match(STYLE, /\.pp-toast\{[^}]*border:1px solid var\(--toast-border\)[^}]*box-shadow:var\(--toast-sh\)/);
});

function habitRig() {
  const c = make();
  c.state.habits = [{ id: 'h1', name: 'Stretch', schedule: { kind: 'daily', days: [] }, taskIds: [], done: {}, createdAt: SUN - 3 * 86400000 }];
  return c;
}

test('habit ⋯ menu: Escape closes it (one rung, before anything else)', () => withNow(SUN, () => {
  const c = habitRig();
  c.state.habitMenuFor = 'h1';
  c.state.detailId = null;
  let prevented = false;
  c.onKey({ key: 'Escape', target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    preventDefault() { prevented = true; } });
  assert.equal(c.state.habitMenuFor, null);
  assert.ok(prevented);
}));

test('habit ⋯ menu: an outside press closes it', () => withNow(SUN, () => {
  const c = habitRig();
  c.state.habitMenuFor = 'h1';
  const tree = c.renderHabitsView();
  const catcher = find(tree, (p) => p['data-habit-menu-catcher'])[0];
  assert.ok(catcher, 'an outside-press catcher while open');
  assert.equal(catcher.props.style.position, 'fixed');
  catcher.props.onMouseDown({ preventDefault() {} });
  assert.equal(c.state.habitMenuFor, null);
  c.state.habitMenuFor = null;
  assert.equal(find(c.renderHabitsView(), (p) => p['data-habit-menu-catcher']).length, 0, 'gone when closed');
}));
