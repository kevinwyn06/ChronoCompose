const { test, expect } = require('@playwright/test');
const { bootToday, cleanDaySettings, timelineBlocks, settleTimeline, task } = require('./_seed');

/* Block 11 — a dropped block SPLITS around BLOCKING busy; Alt keeps it contiguous.
   (`blockPointerDown` → `onMouseMove` (latches `bd.free` from `e.altKey`) → `onMouseUp` →
   `pinBlockAt` → `dropWallsOn` + `splitDropPieces`.)

   `tests/dragsplit.test.js` already owns the arithmetic — the piece geometry, the wall selection, the
   accumulate fix in `computeAllotted`, `netBusyClaim`'s once-only attribution. This file deliberately
   does NOT re-derive any of it. What is pinned here is only what the mock DOM structurally cannot
   reach: a trusted pointer drag over a real Lunch window, a real Alt modifier travelling through a
   real `mousemove`, and what the user actually SEES after the release.

   ── Why these fixtures ───────────────────────────────────────────────────────────────────────────
   The lunch fixture's window is 10:30–15:00 with Lunch 12:30–13:00, and `Deep work` is drawn as ONE
   90-minute block at 10:30–12:00. The drop aims 90 minutes lower, at 12:00. The landing is robust by
   construction rather than by pixel luck: ANY start in (11:00, 12:30) makes a 90-minute chunk cross
   Lunch, which is ~85 minutes of pointer slack around the aim point — far wider than `PIN_SNAP` (15),
   `PIN_MAGNET` (10) or `PIN_ORIG_MAGNET` (18) can move it. So the assertions below describe the
   SHAPE of the result (two pieces, Lunch between them, the same minutes), never an exact clock time.

   ── Reading "minutes" off the screen ─────────────────────────────────────────────────────────────
   Same technique as `timeline-drag.spec.js`: `height = max(13, minutes*px - 2)`, calibrated off a
   block of known length (Lunch is exactly 30 minutes by settings; `Work` is exactly 180). Every
   assertion compares a total BEFORE against the same total AFTER with the same `px`, so the absolute
   scale never has to be right — only unchanged, which holds because nothing here resizes the pane or
   touches the zoom buttons. The 13px floor is never reached: the smallest block here is 30 minutes. */

/* Window 10:30–15:00 (270 min) with Lunch 12:30–13:00, so the pool is 240.
   `Deep work` planned 90 and `Errands` planned 150 split that pool 90/150, and priority 1 packs
   `Deep work` first into the 120-minute pre-lunch gap — one contiguous 90-minute block at 10:30.
   Asserted as a precondition in every test, never assumed. */
const lunchFixture = () => ({
  settings: Object.assign(cleanDaySettings('15:00'), {
    dayStart: '10:30', lunchStart: '12:30', lunchEnd: '13:00',
  }),
  tasks: [
    task('deep', 'Deep work', { start: '0d', end: '+2d', planned: 90, priority: 1 }),
    task('fill', 'Errands', { start: '0d', end: '+2d', planned: 150, priority: 2 }),
  ],
});

/* The owner's real calendar shape, shrunk: a `Work` container the user deliberately works INSIDE.
   Window 08:00–15:00, no meals, `Work` 10:00–13:00 carrying `blocking:false` (block 10's field).
   Free is 08:00–10:00 + 13:00–15:00 = 240, so `Deep work` (planned 90) is again ONE block, at 08:00. */
const workFixture = (blocking) => ({
  settings: Object.assign(cleanDaySettings('15:00'), { dayStart: '08:00' }),
  tasks: [
    task('work', 'Work', {
      start: '0d+10h', end: '0d+13h', startClock: true, endClock: true, planned: 180, blocking,
    }),
    task('deep', 'Deep work', { start: '0d', end: '+2d', planned: 90, priority: 1 }),
    task('fill', 'Errands', { start: '0d', end: '+2d', planned: 150, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);
/** px-per-minute, calibrated off a block of known length. */
const pxPerMin = (blocks, name, knownMins) => (blocks.find((b) => b.title === name).h + 2) / knownMins;
/** Minutes a set of blocks draws, inverting `height = minutes*px - 2`. */
const blockMins = (blocks, px) => blocks.reduce((s, b) => s + (b.h + 2) / px, 0);

/**
 * Press a block's body and drag it down `dy` viewport px with the REAL pointer. `opts.alt` holds Alt
 * for the whole gesture: `onMouseMove` latches `bd.free = !!e.altKey` live, so the key must already be
 * down when the move is delivered — which is exactly why this cannot be a dispatched MouseEvent.
 * The press is at the block's vertical middle so the V4.2 EDGE-drag (a different gesture) is not armed.
 */
async function dragBlock(page, block, dy, opts) {
  const o = opts || {};
  await page.mouse.move(block.x + 200, block.y + block.h / 2);
  await page.mouse.down();
  if (o.alt) await page.keyboard.down('Alt');
  await page.mouse.move(block.x + 200, block.y + block.h / 2 + dy, { steps: 12 });
  await page.mouse.up();
  if (o.alt) await page.keyboard.up('Alt');
  await settleTimeline(page);
}

test.describe('Today timeline: a dropped block splits around blocking busy', () => {
  test('a 90-minute drop across Lunch lands as two pieces, and Lunch survives between them', async ({ page }) => {
    await bootToday(page, lunchFixture());
    const before = await timelineBlocks(page);

    /* Preconditions. Without these a green run could mean the fixture stopped producing a single
       draggable block, or stopped producing a Lunch to split around, rather than that the drop split. */
    const [deep] = of(before, 'Deep work');
    expect(of(before, 'Deep work'), 'fixture: the task is drawn as ONE contiguous block').toHaveLength(1);
    const lunch = before.find((b) => b.title === 'Lunch');
    expect(lunch, 'fixture: Lunch is drawn as a meal block').toBeTruthy();
    expect(lunch.kind).toBe('meal');
    expect(deep.y + deep.h, 'fixture: the block starts ABOVE Lunch and does not reach it')
      .toBeLessThanOrEqual(lunch.y + 1);

    const px = pxPerMin(before, 'Lunch', 30);
    const wasMins = blockMins(of(before, 'Deep work'), px);

    /* Aim the block's top 90 minutes lower, i.e. at 12:00 — 30 minutes before Lunch, so 30 of its 90
       minutes fall before the wall and 60 after it. */
    await dragBlock(page, deep, 90 * px);
    const after = await timelineBlocks(page);

    const mine = of(after, 'Deep work');
    expect(mine, 'the drop split around Lunch into two pieces').toHaveLength(2);
    expect(mine.every((b) => b.pinned), 'both pieces are the one hand-placed pin').toBe(true);

    /* Lunch is INTACT — same position, same height, and it sits between the two pieces rather than
       being drawn over or shortened by them. */
    const lunchAfter = after.find((b) => b.title === 'Lunch');
    expect(lunchAfter, 'Lunch is still drawn').toBeTruthy();
    expect(lunchAfter.y, 'Lunch did not move').toBeCloseTo(lunch.y, 0);
    expect(lunchAfter.h, 'Lunch was not shortened').toBeCloseTo(lunch.h, 0);
    expect(mine[0].y + mine[0].h, 'the first piece stops at Lunch')
      .toBeLessThanOrEqual(lunchAfter.y + 1);
    expect(mine[1].y, 'the second piece resumes after Lunch')
      .toBeGreaterThanOrEqual(lunchAfter.y + lunchAfter.h - 1);

    /* THE assertion. 04b had to repair exactly this once already: a drag is a MOVE, never a grant or
       a loss of time, and splitting it into pieces must not change that. Tolerance is 2 minutes —
       sub-pixel layout rounding, well under the 15-minute snap step a real arithmetic slip shows as. */
    expect(Math.abs(blockMins(mine, px) - wasMins),
      "the task's minutes for the day are unchanged by the split drop").toBeLessThan(2);
    await expect(page.getByText('⚠ Unscheduled'), 'and nothing spilled out of the day').toHaveCount(0);
  });

  test('the same drop with Alt held stays one contiguous block, overlapping Lunch', async ({ page }) => {
    await bootToday(page, lunchFixture());
    const before = await timelineBlocks(page);
    const [deep] = of(before, 'Deep work');
    expect(of(before, 'Deep work'), 'fixture: one block').toHaveLength(1);
    const lunch = before.find((b) => b.title === 'Lunch');
    const px = pxPerMin(before, 'Lunch', 30);
    const wasMins = blockMins(of(before, 'Deep work'), px);

    /* Same drop, same aim — the ONLY difference is the modifier. Alt is V4.3's free-placement key,
       reused rather than a second gesture invented for this. */
    await dragBlock(page, deep, 90 * px, { alt: true });
    const after = await timelineBlocks(page);

    const mine = of(after, 'Deep work');
    expect(mine, 'Alt suppressed the split: one contiguous span').toHaveLength(1);
    expect(mine[0].pinned, 'and it is a pin, so the ✕ is the way back').toBe(true);

    /* It really did run THROUGH Lunch — otherwise "one block" would be satisfied by a drop that
       simply missed the wall, and the test would prove nothing about Alt. */
    const lunchAfter = after.find((b) => b.title === 'Lunch');
    expect(mine[0].y, 'the block starts before Lunch ends').toBeLessThan(lunchAfter.y + lunchAfter.h);
    expect(mine[0].y + mine[0].h, '…and ends after Lunch starts').toBeGreaterThan(lunchAfter.y);
    expect(lunchAfter.y, 'Lunch is still drawn where it was').toBeCloseTo(lunch.y, 0);

    /* An overlapping drop still may not inflate the day: the minutes shared with Lunch were never
       free, so they are not handed back to the task. Same invariant as the split case. */
    expect(Math.abs(blockMins(mine, px) - wasMins),
      'an Alt-overlapped drop does not change the day total either').toBeLessThan(2);
  });
});

test.describe('Today timeline: a background container is worked inside, not around', () => {
  test('a drop inside a BACKGROUND Work event stays one block — no split', async ({ page }) => {
    await bootToday(page, workFixture(false));
    const before = await timelineBlocks(page);
    const [deep] = of(before, 'Deep work');
    expect(of(before, 'Deep work'), 'fixture: the task is drawn as ONE block').toHaveLength(1);
    const work = before.find((b) => b.title === 'Work');
    expect(work, 'fixture: the Work container is drawn as a fixed block').toBeTruthy();
    expect(work.kind).toBe('fixed');

    const px = pxPerMin(before, 'Work', 180);
    const wasMins = blockMins(of(before, 'Deep work'), px);

    /* Aim 180 minutes lower — the block's top lands at 11:00, an hour inside the 10:00–13:00
       container, with its 90 minutes finishing at 12:30, still inside. */
    await dragBlock(page, deep, 180 * px);
    const after = await timelineBlocks(page);

    const mine = of(after, 'Deep work');
    expect(mine, 'a background event is not a wall: the drop stayed in one piece').toHaveLength(1);
    expect(mine[0].pinned, 'it is a pin at the drop').toBe(true);

    /* And it landed INSIDE the container, which is the owner's actual use — a task placed within
       their Work block, not shoved out past the end of it. */
    const workAfter = after.find((b) => b.title === 'Work');
    expect(mine[0].y, 'the drop starts inside Work').toBeGreaterThanOrEqual(workAfter.y - 1);
    expect(mine[0].y + mine[0].h, '…and finishes inside it')
      .toBeLessThanOrEqual(workAfter.y + workAfter.h + 1);
    expect(workAfter.h, 'the container itself is unchanged').toBeCloseTo(work.h, 0);

    expect(Math.abs(blockMins(mine, px) - wasMins),
      "the task's minutes for the day are unchanged").toBeLessThan(2);
  });

  test('control: the SAME event, blocking, does split the drop', async ({ page }) => {
    /* Without this the previous test would also pass if `blocking` were ignored and nothing were ever
       a wall. The only difference between the two fixtures is the flag. */
    await bootToday(page, workFixture(true));
    const before = await timelineBlocks(page);
    const [deep] = of(before, 'Deep work');
    expect(of(before, 'Deep work'), 'fixture: one block').toHaveLength(1);
    const px = pxPerMin(before, 'Work', 180);
    const wasMins = blockMins(of(before, 'Deep work'), px);

    await dragBlock(page, deep, 180 * px);
    const after = await timelineBlocks(page);

    const mine = of(after, 'Deep work');
    expect(mine.length, 'a blocking container pushes the drop past itself').toBeGreaterThanOrEqual(1);
    const workAfter = after.find((b) => b.title === 'Work');
    expect(mine.every((b) => b.y >= workAfter.y + workAfter.h - 1 || b.y + b.h <= workAfter.y + 1),
      'no piece was laid through the blocking container').toBe(true);
    expect(Math.abs(blockMins(mine, px) - wasMins),
      "and the task's minutes for the day are still unchanged").toBeLessThan(2);
  });
});
