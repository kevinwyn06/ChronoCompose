// UI revamp block 10b — Review as a weekly review; Journal opens on "Your day"; Archive labels and sort.
// 1. Window maths: no day inside a window is masked; the comparison is over an EQUAL-LENGTH window.
// 2. Time by section (tags were folded into sections), in the section's hue.
// 3. Routines, Points and clock-only tasks are left out of every review queue.
// 4. Archive: each row's label names its date ("Done" vs "Archived"), and rows sort by that date.
// 5. Journal: "Your day" leads the page, expanded; the day arrows are real, labelled, >= HIT_MIN_PX buttons.
// 6. Review's page header carries week navigation, and the cards answer questions with deltas.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, withNow, FIXED_NOW, DAY } = require('./_load.js');

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

// FIXED_NOW is Mon 2026-06-15 12:00 local, so this week is Sun 06-14 .. Sat 06-20 and today is its 2nd day.
const day = (c, y, m, d) => new Date(y, m - 1, d).getTime();
const ymd = (c, y, m, d) => c.ymdOf(day(c, y, m, d));

const SECTIONS = [
  { id: 'sec_a', name: 'Study', order: 0, color: '#3b82f6' },
  { id: 'sec_b', name: 'Work', order: 1, color: '#10b981' },
  { id: 'sec_r', name: 'Routines', order: 2, color: '#ef4444' },
];

// ---------------------------------------------------------------------------
// 1. Window maths
// ---------------------------------------------------------------------------

test('this week so far is compared with the SAME days of last week, not the whole week', () => withNow(() => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', spentByDay: {
    [ymd(c, 2026, 6, 14)]: 60, [ymd(c, 2026, 6, 15)]: 30,      // this week: Sun, Mon (today)
    [ymd(c, 2026, 6, 7)]: 40, [ymd(c, 2026, 6, 8)]: 20,        // last week: Sun, Mon
    [ymd(c, 2026, 6, 9)]: 100,                                  // last week: Tue — outside the equal window
  } })];
  const d = c.reviewWeekData(0);
  assert.equal(d.n, 2);
  assert.equal(d.partial, true);
  assert.equal(d.cur.days, d.prev.days, 'equal-length windows');
  assert.equal(d.cur.tracked, 90);
  assert.equal(d.prev.tracked, 60, 'last Tuesday is not compared with a week that has no Tuesday yet');
  assert.deepEqual(d.perDay, [60, 30, null, null, null, null, null], 'days still to come are null, not zero');
  assert.match(c.reviewVsText(d), /^vs this time last week$/);
}));

test('a past week is a whole week, compared with the whole week before it', () => withNow(() => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', spentByDay: {
    [ymd(c, 2026, 6, 7)]: 40, [ymd(c, 2026, 6, 9)]: 100, [ymd(c, 2026, 6, 13)]: 5,
    [ymd(c, 2026, 5, 31)]: 30, [ymd(c, 2026, 6, 6)]: 15,
  } })];
  const d = c.reviewWeekData(-1);
  assert.equal(d.n, 7);
  assert.equal(d.partial, false);
  assert.equal(d.start, day(c, 2026, 6, 7));
  assert.equal(d.cur.tracked, 145);
  assert.equal(d.prev.tracked, 45);
  assert.equal(c.reviewVsText(d), 'vs the week before');
  assert.equal(c.reviewWeekData(3).off, 0, 'the future is clamped to this week');
}));

test('the day grid never masks a day inside it (the old 14d window zeroed days 15-35)', () => withNow(() => {
  const c = make();
  const old = ymd(c, 2026, 5, 10);   // 36 days back — inside a 12-week grid, outside the old 14d ledger
  c.state.tasks = [activeTask(c, { id: 'a', spentByDay: { [old]: 240, [ymd(c, 2026, 6, 15)]: 30 } })];
  const heat = c.reviewHeat(0, 12);
  assert.equal(heat.cols.length, 12);
  const cells = heat.cols.flatMap((x) => x.days);
  assert.equal(cells.length, 84, 'whole weeks');
  assert.equal(cells.find((x) => x.ymd === old).min, 240, 'an old day reads its real figure');
  assert.equal(cells.filter((x) => x.min == null).length, 5, 'only the five days after today are empty');
  assert.equal(heat.max, 240);
  assert.equal(heat.best.ms, day(c, 2026, 5, 10));
  assert.equal(c.reviewHeatStep(240, 240), c.REVIEW_HEAT_STEPS.length);
  assert.equal(c.reviewHeatStep(1, 240), 1, 'any tracked time is at least the first step');
  assert.equal(c.reviewHeatStep(0, 240), 0);
}));

test('finished counts completions in the window (archived too), keeps routines apart, and pairs estimates', () => withNow(() => {
  const c = make();
  c.state.sections = SECTIONS;
  const mon = day(c, 2026, 6, 15) + 3600000, lastMon = day(c, 2026, 6, 8) + 3600000;
  c.state.tasks = [
    activeTask(c, { id: 'd1', pct: 100, completion: mon, planned: 60, spent: 90, archivedAt: mon }),
    activeTask(c, { id: 'd2', pct: 100, completion: mon, planned: 0, spent: 20 }),
    activeTask(c, { id: 'old', pct: 100, completion: lastMon, planned: 30, spent: 30 }),
    activeTask(c, { id: 'rt', sectionId: 'sec_r', recur: { kind: 'day', n: 1, overrides: { 0: { completion: mon } } } }),
  ];
  const d = c.reviewWeekData(0);
  assert.equal(d.cur.finished, 2);
  assert.equal(d.cur.routinesDone, 1, 'a ticked routine is not a finished task');
  assert.equal(d.prev.finished, 1);
  assert.deepEqual(d.cur.est, { plan: 60, spent: 90, n: 1 }, 'only finished tasks that had a Planned budget');
}));

// ---------------------------------------------------------------------------
// 2. Time by section
// ---------------------------------------------------------------------------

test('time is grouped by root section, in the section hue — not by an empty first tag', () => withNow(() => {
  const c = make();
  c.state.sections = SECTIONS;
  const today = ymd(c, 2026, 6, 15), lastSun = ymd(c, 2026, 6, 7);
  c.state.tasks = [
    activeTask(c, { id: 'p', sectionId: 'sec_a', labels: [], spentByDay: { [today]: 60, [lastSun]: 20 } }),
    activeTask(c, { id: 'kid', parentId: 'p', labels: [], spentByDay: { [today]: 30 } }),    // inherits Study
    activeTask(c, { id: 'w', sectionId: 'sec_b', spentByDay: { [today]: 45 }, archivedAt: 1 }),
    activeTask(c, { id: 'n', spentByDay: { [today]: 10 } }),                                 // no section
  ];
  const d = c.reviewWeekData(0);
  assert.deepEqual(d.sections.map((s) => [s.name, s.min, s.prevMin]),
    [['Study', 90, 20], ['Work', 45, 0], ['No section', 10, 0]]);
  assert.equal(d.sections[0].color, c.sectionHue('sec_a'));
  assert.equal(d.sections[2].color, c.SECCOL_NONE);
  // The card renders one row per section, never an "untagged" bar.
  const page = c.renderReviewWeek(false);
  const rows = find(page, (p) => p['data-review-section']);
  assert.deepEqual(rows.map((r) => r.props['data-review-section']), ['Study', 'Work', 'No section']);
  assert.doesNotMatch(textOf(page), /untagged/);
  const bar = find(page, (p) => p['data-review-section-bar'] === 'Study')[0];
  assert.equal(bar.props.style.background, c.sectionHue('sec_a'));
}));

// ---------------------------------------------------------------------------
// 3. Routines and other clock-shaped tasks never queue
// ---------------------------------------------------------------------------

function queueFixture(c) {
  c.state.sections = SECTIONS;
  const B = c.startOfToday();
  const old = B - (c.AGING_DAYS + 5) * DAY;
  return [
    activeTask(c, { id: 'plain', name: 'Plain unplanned', planned: 0 }),
    activeTask(c, { id: 'rsec', name: 'Wakeup', planned: 0, sectionId: 'sec_r', start: old, end: null,
      recur: { kind: 'day', n: 1, overrides: {}, durMs: 15 * 60000 } }),
    activeTask(c, { id: 'rtag', name: 'Lunch', planned: 0, labels: ['@routines'] }),
    activeTask(c, { id: 'clock', name: 'Daily standup', planned: 0, start: old + 9 * 3600000, end: null, startClock: true,
      recur: { kind: 'day', n: 1, overrides: {}, durMs: 15 * 60000 } }),
    activeTask(c, { id: 'point', name: 'Call mom', planned: 0, start: B + DAY + 18 * 3600000, end: null, startClock: true }),
    activeTask(c, { id: 'appt', name: 'Dentist', planned: 0, start: B + DAY + 14 * 3600000, end: B + DAY + 15 * 3600000,
      startClock: true, endClock: true, uncompressable: true }),
    activeTask(c, { id: 'stale', name: 'Stale thing', planned: 60, start: old, end: B + DAY }),
    activeTask(c, { id: 'stale-r', name: 'Shutdown', planned: 60, start: old, end: B + DAY, sectionId: 'sec_r' }),
  ];
}

test('reviewSkip: routines (section, tag, clocked daily), Points and clock-only appointments', () => {
  const c = make();
  c.state.tasks = queueFixture(c);
  const skip = c.state.tasks.filter((t) => c.reviewSkip(t)).map((t) => t.id);
  assert.deepEqual(skip, ['rsec', 'rtag', 'clock', 'point', 'appt', 'stale-r']);
});

test('Needs planning (Review and Journal) and "Still relevant?" leave routines out', () => {
  const c = make();
  c.state.tasks = queueFixture(c);
  assert.deepEqual(c.reviewUnplanned().map((t) => t.id), ['plain']);
  assert.match(textOf(c.renderReviewPlanning()), /Plain unplanned/);
  assert.doesNotMatch(textOf(c.renderReviewPlanning()), /Wakeup|Lunch|standup|Call mom|Dentist/);
  assert.deepEqual(c.agingTasks().map((t) => t.id), ['stale'], 'a routine is never "still relevant?"');
  const j = textOf(c.renderJournalView());
  assert.match(j, /Needs planning \(1\)/);
  assert.doesNotMatch(j, /Wakeup|Call mom|Dentist/);
  assert.equal(c.statsData(Date.now(), 14).unplanned, 1);
});

test('Your day folds routines: planned-only dropped, ticked without time listed by name, timed kept', () => {
  const c = make();
  c.state.sections = SECTIONS;
  const B = c.startOfToday(); const k = c.ymdOf(B);
  c.state.tasks = [
    activeTask(c, { id: 'w', name: 'Write report', planned: 60, spentByDay: { [k]: 25 } }),
    activeTask(c, { id: 'd', name: 'Send invoice', planned: 30, pct: 100, completion: B + 3600000, spentByDay: { [k]: 10 } }),
    activeTask(c, { id: 'rx', name: 'Exercise', sectionId: 'sec_r', planned: 60, spentByDay: { [k]: 40 } }),
    activeTask(c, { id: 'rw', name: 'Wakeup', sectionId: 'sec_r', planned: 15, pct: 100, completion: B + 7 * 3600000 }),
    activeTask(c, { id: 'rl', name: 'Lunch', sectionId: 'sec_r', planned: 45 }),
  ];
  const m = c.journalDayModel(B);
  assert.deepEqual(m.rows.map((r) => [r.id, r.kind]), [['d', 'done'], ['rx', 'worked'], ['w', 'worked']]);
  assert.deepEqual(m.routines, ['Wakeup']);
  assert.equal(m.doneN, 1);
  assert.equal(Math.round(m.totalSpent), 75);
});

// ---------------------------------------------------------------------------
// 4. Archive
// ---------------------------------------------------------------------------

test('archive rows say which date they show and sort by it, newest first', () => {
  const c = make();
  c.state.tasks = [
    { id: 'a', name: 'Done long ago, archived yesterday', pct: 100, completion: 1000, archivedAt: 9000 },
    { id: 'b', name: 'Never done, archived', pct: 20, completion: null, archivedAt: 5000 },
    { id: 'c', name: 'Done recently', pct: 100, completion: 7000, archivedAt: 7100 },
    { id: 'live', name: 'not archived', pct: 0 },
  ];
  const rows = c.archiveRows();
  assert.deepEqual(rows.map((r) => [r.t.id, r.kind, r.at]), [['c', 'done', 7000], ['b', 'archived', 5000], ['a', 'done', 1000]]);
  const page = c.renderArchiveView();
  const labels = find(page, (p) => p['data-archive-date']).map((n) => [n.props['data-archive-date'], textOf(n)]);
  assert.equal(labels.length, 3);
  assert.match(labels[0][1], /^Done /);
  assert.match(labels[1][1], /^Archived /, 'a never-completed task never reads "Done"');
  assert.equal(labels[0][0], 'done');
  assert.equal(find(page, (p) => p['data-archive-back']).length, 1, 'Back to Plan stays');
});

// ---------------------------------------------------------------------------
// 5. Journal
// ---------------------------------------------------------------------------

test('the Journal opens on an expanded "Your day", ahead of the prompts and the entry', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [activeTask(c, { id: 'w', name: 'Write report', spentByDay: { [c.ymdOf(B)]: 25 } })];
  const page = c.renderJournalView();
  const order = [];
  find(page, (p) => { if (p['data-journal-day']) order.push('day'); if (p['data-journal-prompts']) order.push('prompts');
    if (p.id === 'pp-journal-editor') order.push('entry'); return false; });
  assert.deepEqual(order.slice(0, 3), ['day', 'prompts', 'entry']);
  assert.equal(find(page, (p) => p['data-your-day-row'] === 'w').length, 1, 'rows render without a click');
  assert.doesNotMatch(textOf(page), /Today’s actuals|Done today/, 'the collapsed rail cards are gone');
  c.state.tasks = [];
  assert.equal(find(c.renderJournalView(), (p) => p['data-your-day-empty']).length, 1, 'an empty day says what will appear');
});

test('Journal day arrows are labelled buttons that render at HIT_MIN_PX', () => {
  const c = make();
  c.state.journalDay = c.startOfToday() - 2 * DAY;
  const btns = find(c.renderJournalNav(), (p) => p['data-journal-nav']);
  assert.deepEqual(btns.map((b) => b.props['data-journal-nav']), ['prev', 'next', 'today']);
  for (const b of btns) {
    assert.equal(b.type, 'button');
    assert.ok(b.props['aria-label']);
    assert.ok(renderedPx(c, b.props.style.height) >= c.HIT_MIN_PX, 'rendered height >= HIT_MIN_PX');
    assert.ok(renderedPx(c, b.props.style.minWidth) >= c.HIT_MIN_PX, 'rendered width >= HIT_MIN_PX');
  }
  btns[0].props.onClick();
  assert.equal(c.state.journalDay, c.startOfToday() - 3 * DAY);
});

// ---------------------------------------------------------------------------
// 6. Review page
// ---------------------------------------------------------------------------

test('Review header: ‹ This week ›, next stops at this week, prev steps back', () => withNow(() => {
  const c = make();
  const head = find(c.renderDashReview(), (p) => p['data-review-head'])[0];
  assert.match(textOf(head), /This week/);
  const nav = (n, which) => find(n, (p) => p['data-review-week-nav'] === which)[0];
  assert.equal(nav(head, 'next').props.disabled, true);
  nav(head, 'prev').props.onClick();
  assert.equal(c.state.reviewWeekOff, -1);
  const head2 = find(c.renderDashReview(), (p) => p['data-review-head'])[0];
  assert.match(textOf(head2), /Last week/);
  assert.equal(nav(head2, 'next').props.disabled, false);
  assert.ok(renderedPx(c, nav(head2, 'prev').props.style.width) >= c.HIT_MIN_PX);
  assert.equal(find(head2, (p) => p['data-archive-link'] === 'review').length, 1, 'the archive link stays');
}));

test('each card asks a question and answers with units and a comparison', () => withNow(() => {
  const c = make();
  c.state.sections = SECTIONS;
  c.state.tasks = [activeTask(c, { id: 'a', sectionId: 'sec_a', spentByDay: {
    [ymd(c, 2026, 6, 14)]: 400, [ymd(c, 2026, 6, 15)]: 360, [ymd(c, 2026, 6, 7)]: 150 } })];
  const page = c.renderReviewWeek(false);
  const cards = find(page, (p) => p['data-review-card']).map((n) => n.props['aria-label']);
  assert.deepEqual(cards, ['How much did I track?', 'What did I finish?', 'Where did the time go?',
    'Were my estimates right?', 'When did I work?']);
  const ans = (k) => textOf(find(page, (p) => p['data-review-answer'] === k)[0]);
  const dl = (k) => textOf(find(page, (p) => p['data-review-delta'] === k)[0]);
  assert.equal(ans('tracked'), '12h 40m');
  assert.equal(dl('tracked'), '+10h 10m vs this time last week');
  assert.equal(c.fmtHM(45), '45m');
  assert.equal(c.fmtHM(120), '2h');
  assert.equal(c.fmtDeltaHM(-30), '−30m');
  // A card with nothing to show says what will appear there and how.
  assert.ok(find(page, (p) => p['data-review-card'] === 'estimates').length);
  const est = find(page, (p) => p['data-review-card'] === 'estimates')[0];
  assert.equal(find(est, (p) => p['data-review-empty']).length, 1);
  // Clicking a week in the grid opens that week.
  find(page, (p) => p['data-heat-week'] === '-2')[0].props.onClick();
  assert.equal(c.state.reviewWeekOff, -2);
}));

test('an empty Review explains itself instead of drawing zeros', () => withNow(() => {
  const c = make();
  c.state.tasks = [];
  const page = c.renderReviewWeek(false);
  assert.equal(find(page, (p) => p['data-review-first']).length, 1);
  assert.equal(find(page, (p) => p['data-review-heat']).length, 0, 'no empty grid and "0:00 / 0:00" legend');
  assert.ok(find(page, (p) => p['data-review-empty']).length >= 4);
}));
