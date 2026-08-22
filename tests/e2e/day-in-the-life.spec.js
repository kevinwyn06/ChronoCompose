/* Block 13 — A DAY IN THE LIFE.
 *
 * Every other spec in this directory is a per-feature suite: it boots one surface, exercises one
 * gesture, and asserts one subsystem. That is exactly the shape that cannot see a coherence bug —
 * a day where the sheet charges a task 90 minutes and the timeline draws it 120, where a drag
 * quietly mints time, or where work you pressed into today evaporates overnight. Each of those
 * passes every feature suite it touches.
 *
 * So this file is ONE long realistic day, on ONE page load, and the assertions are deliberately
 * few and deep. The rule for what belongs here: an assertion earns its place only if it compares
 * two INDEPENDENT answers to the same question — the sheet's arithmetic against the timeline's
 * geometry, a number before an interaction against the same number after it, a value in memory
 * against the same value after a reload. A single widget's own opinion of itself is not evidence.
 *
 * Two independent readings, both off the DOM (there is no app handle on `window`, and reading
 * through a back door would only prove the back door works):
 *
 *   · `allottedByTask` — `taskFlowCell`'s `[title="Allotted today"]`, i.e. `computeAllotted`.
 *   · `drawnMinutes`   — block heights on the timeline, i.e. `buildDayTimeline`.
 *
 * The two are computed by different code from different inputs. They must agree, and the day's
 * whole arithmetic invariant is that they keep agreeing across a sweep, a timer, and a drag.
 *
 * VERIFICATION BLOCK: defects found here are REPORTED in
 * `.orchestration/13-day-in-the-life.handoff.md`, never fixed. A fix in a review pass is unreviewed
 * production work, and it would destroy the evidence the next block consumes.
 */
const { test, expect } = require('@playwright/test');
const {
  bootPlan, bootDays, task, timelineBlocks, settleTimeline, dayColumns,
  allottedByTask, drawnMinutes, switchView, switchLeftSurface, DAY, mealTask,
} = require('./_seed');

/* ── The day ────────────────────────────────────────────────────────────────────────────────────
   08:00–18:00, lunch 12:00–13:00, no free-time reserve, no break reserve. `packFromNow:false` is
   what keeps the packing wall-clock independent — the same flake class block 02 removed from the
   unit layer, avoided here by construction rather than by mocking a clock. */
function daySettings() {
  return {
    allotMode: 'today', packFromNow: false, freeTime: 0,
    dayStart: '08:00', dayEnd: '18:00',
    /* 2026-08-19: lunch is a TASK now (see the backlog below), not a settings clock pair. */
    minChunk: 30, breakMin: 0, multitask: false,
  };
}

/* A believable backlog, one of each shape the scheduler treats differently. If any shape is
   missing, a coherence bug in that shape's arithmetic cannot show up in the totals below.

     · `standup`  a FIXED appointment (09:00–09:30). Leaves the flexible pool; its span is busy.
                  Also the calibration anchor: a known 30 minutes drawn as exactly one block.
     · `pickup`   a POINT (15:00, no end, planned 0). Reserves nothing but the packer will not
                  cross it, so it splits the afternoon without consuming any of it.
     · `tax`      a DEADLINE — its window ends today.
     · `report`   a MULTI-DAY flexible task.
     · `move`+2   a SUBTASK TREE. Children never compete in the pool; the parent packs the family
                  total and its chunks are subdivided. This is the one shape where a double-count
                  in the totals would be easy to write and invisible per-feature.
     · `someday`  NOT in today. The sweep is what puts it in.
                  V5 block 20 (F19): its window must OPEN LATER than today, or auto-inclusion would
                  legitimately bring it in and there would be nothing for the sweep to do. A backlog
                  item you have not reached yet is exactly a window that has not opened. */
function backlog() {
  return [
    task('t-standup', 'Standup', { start: '0d+9h', end: '0d+9h30m', startClock: true, endClock: true, planned: 30, priority: 1 }),
    task('t-pickup', 'Pick up the kids', { start: '0d+15h', startClock: true, end: null, planned: 0, priority: 1 }),
    task('t-tax', 'File the tax return', { start: '0d', end: '0d', planned: 90, priority: 1 }),
    task('t-report', 'Write the quarterly report', { start: '0d', end: '+3d', planned: 240, priority: 2 }),
    task('t-move', 'Move flat', { start: '0d', end: '+6d', planned: 90, priority: 3 }),
    task('t-move-a', 'Pack the kitchen', { start: '0d', end: '+6d', planned: 60, priority: 3, parentId: 't-move' }),
    task('t-move-b', 'Book a van', { start: '0d', end: '+6d', planned: 30, priority: 3, parentId: 't-move' }),
    task('t-someday', 'Learn Portuguese', { start: '+1d', end: '+30d', planned: 60, priority: 4, included: false }),
    /* 2026-08-19: the 12:00-13:00 lunch this day was always built around, now as the task it became. */
    mealTask('t-lunch', 'Lunch', '0d+12h', '0d+13h'),
  ];
}

const dayFixture = (extra) => Object.assign({ settings: daySettings(), tasks: backlog() }, extra || {});

/** Σ of a {id: minutes} map. */
const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);

/* Two rulers of known length that the day draws for reasons of its own: the 09:00–09:30 appointment
   and the 12:00–13:00 lunch. Neither is packed, so neither can move when the flexible work does. */
const CAL = [
  { pick: (b) => b.taskId === 't-standup', minutes: 30 },
  /* 2026-08-19: lunch is a task, drawn as a `fixed` block, so the calibrator names it directly. */
  { pick: (b) => b.taskId === 't-lunch', minutes: 60 },
];

/**
 * The whole invariant, in one place: what the sheet charges is what the timeline draws.
 * Compared per task AND in total, because two per-task errors of opposite sign cancel in the sum.
 */
async function expectSheetAndTimelineAgree(page, why) {
  await settleTimeline(page);
  const charged = await allottedByTask(page);
  const drawn = await drawnMinutes(page, CAL);
  const ids = [...new Set([...Object.keys(charged), ...Object.keys(drawn.byTask)])]
    /* A task charged 0 minutes draws no block; that is agreement, not a discrepancy. */
    .filter((id) => (charged[id] || 0) > 0.5 || (drawn.byTask[id] || 0) > 0.5);
  /* Tolerance, and why it is not zero.
       · 0.5 min is the sheet's own display rounding — `fmtDur` prints whole minutes.
       · a further 1 min was `compressionSeam`'s ROUNDING RESIDUE, a real defect this block found and
         left for block 28a, which fixed it (largest-remainder apportionment — see the comment above
         the `fixed (28a)` describe below). The slack is kept because whole-minute apportionment can
         still move one row by up to a minute against its exact fractional share; the strict
         sub-minute check now lives in that describe, so nothing can hide inside this tolerance.
     Measurement itself contributes under 0.01 min on the expanded scale, so everything above is the
     app's arithmetic, not the ruler's. */
  const PER_TASK = 1.55;
  ids.forEach((id) => {
    expect(Math.abs((drawn.byTask[id] || 0) - (charged[id] || 0)),
      `${why}: ${id} — sheet charges ${charged[id] || 0} min, timeline draws ${(drawn.byTask[id] || 0).toFixed(2)}`)
      .toBeLessThan(PER_TASK);
  });
  /* The day as a whole is held far tighter than the per-task bound allows, because the residue is a
     redistribution: it cannot make the day's total drift by more than a couple of minutes however
     many tasks there are. A drag that mints time shows up here first. */
  expect(Math.abs(drawn.total - sum(charged)),
    `${why}: the day's drawn total (${drawn.total.toFixed(2)}) matches its charged total (${sum(charged)})`)
    .toBeLessThan(3);
  return { charged, drawn };
}

/**
 * Put the day drawer on its EXPANDED scale (V4.4's one two-level zoom toggle).
 *
 * This is a measurement precondition, not decoration. `renderDayColumn` floors a block's height at
 * 13px, so on the fitted scale any chunk under ~15 minutes is drawn at the floor and its duration is
 * no longer recoverable from its box — and a wall-to-wall day (which `allotMode:'today'` always is,
 * since the seam hands out the whole pool) produces exactly such slivers around a fresh pin.
 * Expanded, the same day draws every chunk well clear of the floor and the readings come back exact.
 * `drawnMinutes` refuses to guess if a block is ever clamped, so a regression here fails loudly.
 */
async function expandDrawer(page) {
  await page.locator('[data-tl-zoom]').click();
  await settleTimeline(page);
}

test.describe('A day in the life', () => {
  /* Tall enough that the expanded day fits without the packer's smallest chunks colliding with the
     13px floor. Nothing under test depends on the viewport otherwise. */
  test.use({ viewport: { width: 1400, height: 1100 } });

  test('plan the morning, work it, drag what slipped, journal it, and hand the day over', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    /* ── 07:50 · sit down at the Plan tab ─────────────────────────────────────────────────────
       One page load for the whole journey. `seedOnce` makes the fixture survive the reload later
       on — without it `addInitScript` would re-seed `pp-tasks` and erase the day's work, which is
       precisely what the "spent survives a reload" step has to prove. */
    await bootPlan(page, 'select', dayFixture({ seedOnce: true }));

    /* The sweep order IS the DOM order: `selectionFlat` walks the buckets in `p.keys` order and each
       bucket is one flat list, which is exactly the order `renderSelectionView` paints. Reading the
       cursor's target off the page instead of counting by hand is what keeps this step honest. */
    const cards = await page.$$eval('[data-card-id]', (els) => els.map((e) => e.getAttribute('data-card-id')));
    expect(cards, 'the backlog is on the board').toContain('t-someday');
    expect(cards.length, 'and so is everything else').toBeGreaterThan(4);

    /* "On the day" used to be a ROW — the Included half of each column. Task 8 deleted that dimension,
       so the honest reading is now the buckets that MEAN on the list: New (arrived today) and Continued
       (been there a while). Both are `onListSince != null`, which is the single definition of on-list
       that `originOf` uses, so this is the same question asked of the surface that still answers it. */
    const included = () => page.$$eval('[data-selbucket="new"] [data-card-id], [data-selbucket="continued"] [data-card-id]',
      (els) => els.map((e) => e.getAttribute('data-card-id')).sort());
    const inBefore = await included();
    expect(inBefore, 'the someday task starts out of the day').not.toContain('t-someday');

    const idx = cards.indexOf('t-someday');
    /* `selectionKey` starts the cursor at 0 on the first `j`, so n presses land on index n−1. */
    for (let i = 0; i <= idx; i++) await page.keyboard.press('j');
    /* k walks back and j returns: a pass has to be reversible or it is not a sweep, it is a one-way
       commit. The neighbour it steps onto is checked below — if the cursor were simply stuck, the
       step back and forth would be unobservable and `space` would still hit the right card. */
    await page.keyboard.press('k');
    await page.keyboard.press('j');
    await page.keyboard.press(' ');

    /* EXACTLY one card joined the day. A cursor that had drifted — or a space that toggled the whole
       selection — would still put the target in, and only this comparison would notice. */
    expect(await included(), 'the sweep moved exactly one card into the day')
      .toEqual([...inBefore, 't-someday'].sort());

    /* And the decision reached the arithmetic, not just the card's row. */
    const afterSweep = await allottedByTask(page);
    expect(afterSweep['t-someday'], 'the swept-in task is now charged real time today')
      .toBeGreaterThan(0);

    /* ── 08:00 · move to the board and check the plan holds together ──────────────────────────
       Overview hosts the task sheet and the main pane side by side, so the sheet's arithmetic and
       the timeline's geometry are read from the SAME frame of the SAME state.

       V5 block 27a: this used to be a TAB click, because Selection lived on a tab of its own. It is
       now a left-PANE switch — the sweep above and the board below are the same screen. The step is
       re-pointed rather than deleted: everything it goes on to assert is unchanged, and dropping the
       switch entirely would leave the spec reading the triage cards' controls while believing it was
       reading sheet rows (which is exactly how this failed first). */
    await switchLeftSurface(page, 'list');
    await switchView(page, 'Today');
    await page.locator('[data-tl-block]').first().waitFor({ state: 'attached', timeout: 15000 });
    await expandDrawer(page);

    const morning = await expectSheetAndTimelineAgree(page, 'the morning plan');

    /* Every shape actually made it onto the day — otherwise the agreement above is agreement about
       a day with nothing interesting in it. */
    const blocks = await timelineBlocks(page);
    expect(blocks.some((b) => b.kind === 'fixed' && b.taskId === 't-standup'),
      'the appointment is drawn locked').toBe(true);
    /* 2026-08-19: lunch is a task, so it is drawn as a `fixed` block like any other appointment. */
    expect(blocks.some((b) => b.kind === 'fixed' && b.taskId === 't-lunch'), 'lunch is on the day').toBe(true);
    /* Owner ruling C1 (2026-08-21): the subtask is a LINE inside its parent's single block, not a
       block of its own. Containment is the whole point of the ruling, so the assertion follows it
       there — the parent stays exactly one object with one border. */
    expect(blocks.some((b) => b.taskId === 't-move' && b.kids.some((k) => k.id === 't-move-a')),
      'a subtask is drawn INSIDE its parent\'s block').toBe(true);
    expect(morning.charged['t-move-a'], 'and it is charged its share of the family').toBeGreaterThan(0);

    /* Something runs into lunch: the meal splits somebody's work into two chunks that sit either
       side of it. This is the "a task overruns into lunch" step, and it is asserted through the
       shape of the day rather than through a widget. */
    const meal = blocks.find((b) => b.taskId === 't-lunch');   /* 2026-08-19: lunch is a task */
    const splitTask = [...new Set(blocks.filter((b) => b.taskId).map((b) => b.taskId))]
      .find((id) => {
        const mine = blocks.filter((b) => b.taskId === id);
        return mine.some((b) => b.y + b.h <= meal.y + 1) && mine.some((b) => b.y >= meal.y + meal.h - 1);
      });
    expect(splitTask, 'lunch splits somebody\'s work, either side of the meal block').toBeTruthy();
    /* ── 09:40 · log the morning's work, then run a timer and switch tasks ────────────────────
       Task 26 (2026-08-20) replaced the `+15` button with a box that SETS today's figure — "+15" could
       only add, so an overcount could not be corrected. Setting is the stronger move for this walkthrough
       anyway: the ledger ends at a number this spec chose, rather than at a multiple of a constant it had
       to read off a button. Task 15's duration grammar is what the box speaks. */
    const reportBefore = morning.charged['t-report'];
    const spentBox = page.locator('[data-task-id="t-report"] [data-spent-box]');
    await expect(spentBox, 'the row has one time-worked box').toHaveCount(1);
    await spentBox.fill('45m');
    await spentBox.press('Enter');
    await settleTimeline(page);

    const afterWork = await allottedByTask(page);
    expect(afterWork['t-report'], 'time spent comes off what the task still needs today')
      .toBeLessThan(reportBefore);
    expect(reportBefore - afterWork['t-report'], 'by exactly the amount that was logged')
      .toBeCloseTo(45, -0.7);

    /* The timer itself: start one, then start another. V2.4's strict single-timer policy means the
       second start stops the first — a cross-subsystem rule no per-widget test can see, because it
       is about the relationship between two widgets. */
    await page.locator('[data-task-id="t-tax"] [title="Start timer"]').first().click();
    await expect(page.locator('[data-task-id="t-tax"] [title="Stop timer"]').first()).toBeVisible();
    await page.locator('[data-task-id="t-move-b"] [title="Start timer"]').first().click();
    await expect(page.locator('[data-task-id="t-move-b"] [title="Stop timer"]').first()).toBeVisible();
    /* Scoped to task rows: the running task also shows a stop control outside the sheet, and counting
       every one of them would be counting surfaces rather than timers. */
    await expect(page.locator('[data-task-id] [title="Stop timer"]'),
      'exactly one task is running — V2.4 strict single timer, asserted across two rows').toHaveCount(1);
    await expect(page.locator('[data-task-id="t-tax"] [title="Start timer"]'),
      'and the one that was running before is stopped, not merely un-highlighted').toHaveCount(1);
    await page.locator('[data-task-id="t-move-b"] [title="Stop timer"]').first().click();
    await expect(page.locator('[data-task-id] [title="Stop timer"]'), 'and now none').toHaveCount(0);

    /* ── 10:10 · the day still adds up after the work was logged ──────────────────────────────*/
    await expectSheetAndTimelineAgree(page, 'after logging work');

    /* ── 11:00 · something slipped — drag it later ────────────────────────────────────────────
       Trusted pointer input. A dispatched MouseEvent skips hit-testing and pointer capture, which
       is what the 4px promotion threshold depends on, so it would prove nothing here. */
    await settleTimeline(page);
    const before = await timelineBlocks(page);
    const grab = before.filter((b) => b.kind === 'auto' && b.h > 30)[0];
    expect(grab, 'there is a flexible block big enough to grab').toBeTruthy();
    const gx = grab.x + grab.w / 2, gy = grab.y + Math.min(8, grab.h / 3);
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx, gy + 40, { steps: 8 });
    await page.mouse.move(gx, gy + 110, { steps: 8 });
    await page.mouse.up();
    await settleTimeline(page);

    const pinned = (await timelineBlocks(page)).filter((b) => b.kind === 'pinned');
    expect(pinned.length, 'the drop pinned something').toBeGreaterThan(0);
    /* THE invariant a drag must not break: moving work does not create or destroy it. The day is
       re-checked whole, so a pin that inflated its own task at the pool's expense fails here even
       though the pinned block itself looks perfectly correct. */
    const afterDrag = await expectSheetAndTimelineAgree(page, 'after the drag');
    expect(page.locator('text=⚠ Unscheduled'), 'and nothing fell off the day').toHaveCount(0);

    /* ── 11:05 · the Today drawer and the Gantt are describing the same day ───────────────────
       Same state, two renderers. The sheet's numbers must not move when the right-hand pane does. */
    await switchView(page, 'Gantt');
    await expect(page.locator('[data-task-id]').first()).toBeVisible();
    const onGantt = await allottedByTask(page);
    expect(onGantt, 'the Gantt charges the same day the Today drawer drew').toEqual(afterDrag.charged);

    /* ── 22:30 · journal the day ──────────────────────────────────────────────────────────────*/
    await page.locator('[role="button"][title="Journal"]').click();
    const editors = page.locator('.pp-rich[contenteditable]');
    await expect(editors.first()).toBeVisible();
    const entry = editors.last();
    await entry.click();
    await page.keyboard.type('Tax return finally out of the way.');
    await page.keyboard.press('Tab'); /* richField commits on blur */
    await expect(page.locator('.pp-rich[contenteditable]').last())
      .toContainText('Tax return finally out of the way.');

    /* ── the next morning · none of it was a rendering trick ──────────────────────────────────
       A real reload. The fixture does not re-seed (`seedOnce`), so everything below came out of
       `pp-tasks` / `pp-journal`, not out of the test's own setup. */
    await page.reload();
    await expect(page.locator('.pp-rich[contenteditable]').last())
      .toContainText('Tax return finally out of the way.');

    /* Back to the board the way a user would: the sidebar, then the view the app remembered. */
    await page.locator('[role="button"][title="Dash"]').click();
    await switchView(page, 'Today');
    await page.locator('[data-tl-block]').first().waitFor({ state: 'attached', timeout: 15000 });
    await expandDrawer(page); /* `_drawerZoom` is session-only by design, so it resets on reload */
    const reloaded = await expectSheetAndTimelineAgree(page, 'after a reload');

    expect(reloaded.charged['t-report'], 'the time worked survived the reload')
      .toBeCloseTo(afterDrag.charged['t-report'], -0.7);
    expect(reloaded.charged['t-someday'], 'and so did the morning\'s decision to take it on')
      .toBeGreaterThan(0);
    expect((await timelineBlocks(page)).filter((b) => b.kind === 'pinned').length,
      'and so did the pin').toBeGreaterThan(0);

    expect(errors, 'no page errors across the whole day').toEqual([]);
  });
});

/* ── The rounding residue, isolated ────────────────────────────────────────────────────────────
   Found by the journey above, which deliberately did NOT fix it — block 13 was a verification pass.

   The defect: `compressionSeam` rounded every task's share to whole minutes with `Math.round`
   INDEPENDENTLY, so with enough tasks Σ charged overshot the day's free minutes by up to n/2. The
   pool the packer fills is the unrounded one, so the overshoot had nowhere to go: the last task
   placed was drawn a minute short of the number the sheet printed beside its name, with no warning
   and no Unscheduled entry. User impact was small (one minute); the class was not — this is the
   pool-agreement invariant that V4's whole allotment story rests on, failing quietly.

   FIXED in chain 4 / block 28a, and the `test.fail()` marker went with the fix. The seam now
   apportions whole minutes by largest remainder (Hamilton) instead of rounding each row on its own:
   every row takes floor(share) and the leftover whole minutes go to the largest fractional parts, so
   Σ allotted = floor(Σ share) ≤ pool BY CONSTRUCTION, and no row moves by a whole minute against its
   true share. Manual Predicts are excluded from the apportionment — a typed figure is a promise, not
   a share to shave. The assertion below is unchanged from the day it was written as a marker; the
   production code moved to meet it. Unit coverage of the arithmetic itself, including a sweep of
   every pool from 7 to 900 against 1–9 tasks, is in `tests/v5-seam-residue.test.js`. */
test.describe('fixed (28a): the seam\'s rounding residue', () => {
  test.use({ viewport: { width: 1400, height: 1100 } });
  test('the sheet never charges a task a minute the day cannot draw', async ({ page }) => {
    await bootPlan(page, 'select', dayFixture());
    /* Press the last task in, so Σ of the rounded shares overshoots the pool. */
    const cards = await page.$$eval('[data-card-id]', (els) => els.map((e) => e.getAttribute('data-card-id')));
    const idx = cards.indexOf('t-someday');
    for (let i = 0; i <= idx; i++) await page.keyboard.press('j');
    await page.keyboard.press(' ');

    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await switchView(page, 'Today');
    await page.locator('[data-tl-block]').first().waitFor({ state: 'attached', timeout: 15000 });
    await expandDrawer(page);

    const charged = await allottedByTask(page);
    const drawn = await drawnMinutes(page, CAL);
    Object.keys(charged).forEach((id) => {
      if ((charged[id] || 0) <= 0.5) return;
      expect(Math.abs((drawn.byTask[id] || 0) - charged[id]),
        `${id}: charged ${charged[id]}, drawn ${(drawn.byTask[id] || 0).toFixed(2)}`)
        .toBeLessThan(0.6);
    });
  });
});

/* ── Known defect: a keep-clear Point becomes real work on the next day ────────────────────────
   Found by looking at `week-light.png` — "Pick up the kids" is a caret on today's column and a
   full block on tomorrow's. A Point is "a clocked instant with no end and no duration"; it reserves
   nothing, by definition. But `isPointOn` only recognises it on the day its clock falls on, and on
   any OTHER day the same task is just a zero-planned active task, which `compressionSeam` hands
   `DEFAULT_TASK_MINUTES` of the pool. So the marker turns into an hour of scheduled work on a day it
   was never about, taking that hour off everything else.

   FIXED in chain 4 / block 19b, and the `test.fail()` marker went with the fix. Owner decision,
   verbatim: "A Point exists only on its own day." `isActiveOn` now vetoes a Point on any day that is
   not its own, via the day-independent `isPointTask`/`pointDayOf` split — absent, not
   present-with-zero, because zero-minutes-but-present is exactly what leaked the 30 minutes.

   Note the second half of the assertion: the SHEET is already right (it prints "—"), so this is the
   two-renderers disagreement the journey above is built to catch, in a case the journey's own
   fixture cannot reach — the journey only ever looks at today.

   WHY THE CLOCK IS PINNED (chain 4 / block 19a). This marker was WALL-CLOCK DEPENDENT and lied
   because of it. The Week view is Sunday-first and anchored on the week containing today, so on a
   SATURDAY today is the last column and the grid contains no day after it; block 18 then stopped
   past columns drawing flexible work, so the columns before today draw nothing either. On Saturday
   8 Aug 2026 this spec therefore found no leaked block anywhere in the grid and reported "Expected
   to fail, but passed" — a false "already fixed" — while the identical code reproduced the defect
   on Sunday 9 Aug. A marker that lies is the mechanism by which a real defect gets closed.
   `page.clock.install` pins today to a known WEDNESDAY before the first navigation, so the anchored
   week always has three future columns for the Point to leak into. The pin must be installed BEFORE
   `bootDays` navigates: `_seed.js` resolves relative day offsets at page-eval time, so fixture and
   app read the same pinned midnight. The spec needs no moving time, so freezing is safe here. */
test.describe('fixed (19b): a Point no longer leaks onto the next day', () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  const pointWeek = () => ({
    settings: daySettings(),
    tasks: [
      task('p-fill', 'Write the quarterly report', { start: '-7d', end: '+7d', planned: 240, priority: 2 }),
      task('p-point', 'Pick up the kids', { start: '0d+15h', startClock: true, end: null, planned: 0 }),
    ],
  });

  test.beforeEach(async ({ page }) => {
    /* Wednesday 12 August 2026, 09:00 local. Any fixed Wednesday would do; the weekday is the point. */
    await page.clock.install({ time: new Date(2026, 7, 12, 9, 0, 0) });
    await bootDays(page, 'week', pointWeek());
    await settleTimeline(page);
  });

  /* The structural guard, kept OUT of the marked test on purpose. `test.fail()` is satisfied by ANY
     failure, so a guard living inside it would be indistinguishable from the defect it pins. Here it
     is an ordinary test: if the pin ever stops producing days after today, this goes red on its own
     and the marker's silence stops being trusted. */
  test('the pinned week really does have days after today for a Point to leak into', async ({ page }) => {
    const cols = await dayColumns(page);
    expect(cols, 'seven columns').toHaveLength(7);
    const today = cols.find((c) => c.isToday);
    expect(today, 'today is inside the rendered week').toBeTruthy();
    expect(new Date(today.day).getDay(), 'the clock pin put us on a Wednesday').toBe(3);
    expect(cols.filter((c) => c.day > today.day).length, 'days after today').toBe(3);
  });

  test('a zero-duration marker is drawn on its own day only', async ({ page }) => {
    const cols = await dayColumns(page);
    const today = cols.find((c) => c.isToday).day;
    const drawn = (await timelineBlocks(page)).filter((b) => b.taskId === 'p-point');
    expect(drawn.map((b) => (b.day - today) / DAY),
      'the Point is drawn as a block on days that are not its own').toEqual([]);
    /* The other half of the finding: the day the marker leaked into must be no EMPTIER for the fix —
       the flexible task simply gets back the half hour that was never the Point's to take. Deliberate
       over-subscription is a feature; this block only removes 30 illegitimate minutes. */
    const spanBlocks = (await timelineBlocks(page)).filter((b) => b.taskId === 'p-fill');
    expect(spanBlocks.filter((b) => b.day === today + DAY).length,
      'the next day still carries its real work').toBeGreaterThan(0);
  });
});

/* ── V2.2 inheritance ──────────────────────────────────────────────────────────────────────────
   The one part of the day that cannot be observed without the clock moving. `page.clock.setFixedTime`
   is used rather than `clock.install()` on purpose: `install` also replaces the timer queue, and
   React's scheduler runs on it. Fixing `Date` alone is the smallest change that makes
   `startOfToday()` say "tomorrow", which is the entire input to `isInheritedToday`. */
test.describe('the next day inherits the day before', () => {
  test('unfinished work carries, finished work does not, and a snooze expires', async ({ page }) => {
    const fixture = {
      settings: daySettings(),
      tasks: [
        /* Pressed in explicitly. `included:true` is a stored decision, so inheritance is not what
           keeps this one on the day — it is the control that separates "the state persisted" from
           "the V2.2 rule fired". */
        task('i-pressed', 'Pressed in by hand', { start: '0d', end: '0d', planned: 60, included: true }),
        /* Never pressed. Its window started yesterday, so on BOTH days it is `isInheritedToday`
           and nothing else that puts it on the plan. */
        task('i-open', 'Unfinished, never pressed', { start: '-1d', end: '+2d', planned: 60, included: null }),
        /* Same shape, but done. Finished work must not clog tomorrow. */
        task('i-done', 'Finished it', { start: '-1d', end: '+2d', planned: 60, included: null, pct: 100 }),
        /* The one that gets snoozed below: "not today" has to mean today only. */
        task('i-snooze', 'Not in the mood', { start: '-1d', end: '+2d', planned: 60, included: null }),
        /* Nothing to do with this week at all — the guard against "everything inherits". */
        task('i-later', 'Starts next week', { start: '+7d', end: '+9d', planned: 60, included: null }),
      ],
      seedOnce: true,
    };
    await bootPlan(page, 'select', fixture);

    const today = await allottedByTask(page);
    expect(today['i-pressed'], 'today: the pressed task is on the day').toBeGreaterThan(0);
    expect(today['i-open'], 'today: so is yesterday\'s unfinished work').toBeGreaterThan(0);
    expect(today['i-done'], 'today: finished work is not').toBeUndefined();
    expect(today['i-later'], 'today: next week\'s work is not').toBeUndefined();

    /* "Not today." Snooze, not exclusion — V2.11's division of labour: unpressing a task that
       inheritance is currently re-including would be a no-op, so it snoozes instead. */
    await page.locator('[data-card-id="i-snooze"] [title="Snooze until tomorrow"]').click();
    expect((await allottedByTask(page))['i-snooze'], 'today: a snoozed task is off the day')
      .toBeUndefined();

    /* Tomorrow. Same browser, same storage, only the clock has moved.
       `setFixedTime` rather than `clock.install()`: install also replaces the timer queue that
       React's scheduler runs on, and fixing `Date` is the whole input to `startOfToday()`. */
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
    }) + DAY + 10 * 3600000;
    await page.clock.setFixedTime(tomorrow);
    await page.reload();
    await page.locator('[data-card-id]').first().waitFor({ state: 'attached', timeout: 15000 });
    expect(await page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }),
      'the app really is on the next day').toBe(tomorrow - 10 * 3600000);

    const next = await allottedByTask(page);
    expect(next['i-pressed'], 'tomorrow: an explicit decision sticks — the standing tenet is that '
      + 'the laziest path must never silently drop work').toBeGreaterThan(0);
    expect(next['i-open'], 'tomorrow: unfinished work that was on yesterday carries forward').toBeGreaterThan(0);
    expect(next['i-snooze'], 'tomorrow: "not today" expired, so it is back on the plan').toBeGreaterThan(0);
    expect(next['i-done'], 'tomorrow: finished work does not carry').toBeUndefined();
    expect(next['i-later'], 'tomorrow: and neither does work that never started').toBeUndefined();
  });
});
