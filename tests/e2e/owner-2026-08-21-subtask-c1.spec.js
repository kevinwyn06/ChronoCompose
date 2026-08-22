const { test, expect } = require('@playwright/test');
const { bootToday, task, settleTimeline } = require('./_seed');

/* Owner rulings 2026-08-21 / 2026-08-22 — C1 on the timeline, S1 in the Schedule, and the active cue.
 *
 * The unit layer owns the splitting rule and `activeKidId` (owner-2026-08-21-subtask-splitting and
 * owner-2026-08-22-active-subtask). This file exists for the three claims only a live mount can settle:
 *
 *   1. A family is ONE object with ONE border. "The parent is exactly one object" is a statement about
 *      rendered boxes, and counting them is the only way to check it.
 *   2. Depth is carried by INDENT — the reason C1 was chosen over C2 was horizontal room, so the
 *      indent has to be a measured fact, not a style string.
 *   3. The active cue costs NO LAYOUT. That is the entire reason V2 beat V1: a true border adds ~2px to
 *      a line with ~6px of slack and pushes the last child of a short block out of view. So the test
 *      that matters is that turning the cue on does not move anything.
 */

/* The window spans the whole day ON PURPOSE. The packer starts at max(now, dayStart), so a narrow
   window makes "is now inside a packed child" depend on the hour the suite happens to run at — and the
   active cue is precisely a function of the clock. A full-day window puts the family's first child at
   "now" whenever the run happens. */
const DAY_SETTINGS = { dayStart: '00:00', dayEnd: '23:59', minChunk: 15, breakMin: 0 };

/* Draft copy (90m of children) with a sub-subtask, so depth 2 is on screen — the gap the owner named.
     Draft copy
       ├── Headline pass   30m   depth 1
       ├── Body pass       40m   depth 1   (60 planned, 20 of which go to Captions)
       └──── Captions      20m   depth 2 */
const family = () => [
  task('p',  'Draft copy',    { start: '0d', end: '+2d', planned: 90 }),
  task('k1', 'Headline pass', { start: '0d', end: '+2d', planned: 30, parentId: 'p' }),
  task('k2', 'Body pass',     { start: '0d', end: '+2d', planned: 60, parentId: 'p' }),
  task('g1', 'Captions',      { start: '0d', end: '+2d', planned: 20, parentId: 'k2' }),
];

const fixture = () => ({ seedOnce: true, settings: DAY_SETTINGS, tasks: family() });

test('a family is ONE block on the timeline, with its children inside it', async ({ page }) => {
  await bootToday(page, fixture());
  await settleTimeline(page);

  /* Claim 1, and the load-bearing negative: the children do not draw blocks of their own. */
  for (const id of ['k1', 'k2', 'g1']) {
    await expect(page.locator(`[data-tl-block][data-tl-task="${id}"]`)).toHaveCount(0);
  }
  const parent = page.locator('[data-tl-block][data-tl-task="p"]');
  await expect(parent).toHaveCount(1, { timeout: 10000 });

  /* One border, on the parent, and one family container inside it. */
  await expect(parent.locator('[data-tl-family="p"]')).toHaveCount(1);
  await expect(parent.locator('[data-tl-kid]')).toHaveCount(3);
  await expect(parent.locator('[data-tl-kid="g1"]')).toHaveAttribute('data-tl-kid-depth', '2');
});

test('depth is carried by INDENT — the reason C1 beat C2', async ({ page }) => {
  await bootToday(page, fixture());
  await settleTimeline(page);

  const xOf = async (id) => {
    const box = await page.locator(`[data-tl-kid="${id}"] [data-tl-kid-gutter]`).boundingBox();
    return box.x;
  };
  const d1 = await xOf('k2');
  const d2 = await xOf('g1');
  /* Measured, not asserted from a style string: C2 (a lip repeated per level) was rejected on
     HORIZONTAL ROOM, so the thing that has to be true is that depth 2 actually sits further in — and
     by a step small enough that a fourth level would not squeeze the text off the block. */
  expect(d2).toBeGreaterThan(d1);
  expect(d2 - d1).toBeLessThan(20);
});

test('the active cue marks the line the now-rule crosses, and costs no layout', async ({ page }) => {
  await bootToday(page, fixture());
  await settleTimeline(page);

  const active = page.locator('[data-tl-kid][data-tl-kid-active="1"]');
  await expect(active).toHaveCount(1, { timeout: 10000 });

  const chosen = await active.getAttribute('data-tl-kid');
  /* And it is the child the packer put "now" inside — the first, because the family packs from the
     current instant. Asserting only that A cue exists would pass on a cue that lit every line, which
     is the failure mode worth catching. */
  expect(chosen).toBe('k1');

  /* Claim 3, and the whole reason V2 beat V1: switching the cue on must not move anything. Every kid
     line is measured, then the cue is forced onto a DIFFERENT line, and the boxes must be identical.
     A true border would have shifted them, which on a short block pushes the last child out of view. */
  const boxes = async () => page.$$eval('[data-tl-kid]', (els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('data-tl-kid'), Math.round(r.y), Math.round(r.height)]; }));
  const before = await boxes();
  await page.evaluate((cur) => {
    document.querySelectorAll('[data-tl-kid]').forEach((e) => {
      e.setAttribute('data-tl-kid-active', e.getAttribute('data-tl-kid') === cur ? '0' : '1');
    });
  }, chosen);
  expect(await boxes()).toEqual(before);
});

test('the Schedule view draws the same subtree as one lipped chip (S1)', async ({ page }) => {
  await bootToday(page, fixture());
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('pp-prefs') || '{}');
    p.mainView = 'schedule';
    localStorage.setItem('pp-prefs', JSON.stringify(p));
  });
  await page.reload();
  await expect(page.getByText('Schedule · next 7 days')).toBeVisible({ timeout: 15000 });

  /* One sort position for the whole subtree. The agenda merges blocks, Points and the now-rule into one
     array sorted by `ms`, so a chip per scheduled child (S2) would dissolve the containment that won
     C the ruling — and the two surfaces draw the same day one panel over. */
  /* The family's window is three days wide, so it packs on three of the seven days the agenda draws —
     one chip per day, which is right. Today's is the first, and it is the one under test. */
  await expect(page.locator('[data-sched-family="p"]').first()).toBeVisible({ timeout: 10000 });
  const chip = page.locator('[data-sched-family="p"]').first();
  await expect(chip.locator('[data-sched-kid]')).toHaveCount(3);
  await expect(chip.locator('[data-sched-kid="g1"]')).toHaveAttribute('data-sched-kid-depth', '2');

  /* And the lip is real paint, not a style string: a left border thicker than the other three sides. */
  const lip = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [parseFloat(cs.borderLeftWidth), parseFloat(cs.borderTopWidth)];
  });
  expect(lip[0]).toBeGreaterThan(lip[1]);
});

test('a future day gets no active cue — there is no now-line to point at', async ({ page }) => {
  await bootToday(page, fixture());
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('pp-prefs') || '{}');
    p.mainView = 'schedule';
    localStorage.setItem('pp-prefs', JSON.stringify(p));
  });
  await page.reload();
  await expect(page.getByText('Schedule · next 7 days')).toBeVisible({ timeout: 15000 });

  /* The seven-day agenda draws today AND six future days. If the cue were computed from anything other
     than the clock — the next incomplete child, say — every one of those days would carry one. */
  const cues = await page.locator('[data-sched-kid][data-sched-kid-active="1"]').count();
  expect(cues).toBeLessThanOrEqual(1);
});
