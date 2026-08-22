const { test, expect } = require('@playwright/test');
const { bootToday, task, settleTimeline, timelineBlocks } = require('./_seed');

/* Owner rulings 2026-08-21 — "a drag moves the piece you grabbed, and everything contained in it".
 *
 * Two rulings meet here and are not in conflict, because they answer different questions:
 *   · dragging a PARENT moves its children — the whole family IS that one piece;
 *   · dragging one HALF of a split parent moves only that half.
 *
 * This has to be an e2e, and specifically a `page.mouse` one. The drag threshold and pointer capture
 * are exactly what a synthetic dispatched MouseEvent skips, so a dispatched event proves nothing about
 * whether the gesture started — the standing rule in AGENTS.md.
 *
 * Two build consequences the mockup states, both asserted: the drag handle is the PARENT row and a
 * child line never starts its own drag; and a dragged piece keeps its identity as part of the parent —
 * it does not become a separate task.
 */

const DAY_SETTINGS = { dayStart: '00:00', dayEnd: '23:59', minChunk: 15, breakMin: 0 };

const family = () => [
  task('p',  'Draft copy',    { start: '0d', end: '+2d', planned: 90 }),
  task('k1', 'Headline pass', { start: '0d', end: '+2d', planned: 30, parentId: 'p' }),
  task('k2', 'Body pass',     { start: '0d', end: '+2d', planned: 60, parentId: 'p' }),
  task('g1', 'Captions',      { start: '0d', end: '+2d', planned: 20, parentId: 'k2' }),
];

const stored = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pp-tasks') || '[]'));

test('dragging a parent moves the whole family, and the family stays one piece', async ({ page }) => {
  await bootToday(page, { seedOnce: true, settings: DAY_SETTINGS, tasks: family() });
  await settleTimeline(page);

  const block = page.locator('[data-tl-block][data-tl-task="p"]');
  const before = await block.boundingBox();
  expect(before).not.toBeNull();

  /* A real gesture: press on the PARENT row (the block's own title area, above the child lines), move
     past the threshold, release. */
  await page.mouse.move(before.x + before.width / 2, before.y + 4);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 90, { steps: 12 });
  await page.mouse.up();

  /* The pin landed on the PARENT — one task, not four. That is "the dragged piece keeps its identity
     as part of the parent": the children did not become separately placed tasks. */
  await expect.poll(async () => {
    const ts = await stored(page);
    return !!(ts.find((t) => t.id === 'p') || {}).pin;
  }, { timeout: 10000 }).toBe(true);

  const ts = await stored(page);
  for (const id of ['k1', 'k2', 'g1']) {
    expect((ts.find((t) => t.id === id) || {}).pin, `${id} was not pinned separately`).toBeFalsy();
  }

  /* And the family still draws as one object with its children inside — the packer did not dissolve
     the subtree into peers on the pass after the drop. */
  await settleTimeline(page);
  const after = await timelineBlocks(page);
  const fam = after.filter((b) => b.taskId === 'p');
  expect(fam.length).toBe(1);
  expect(fam[0].kids.map((k) => k.id).sort()).toEqual(['g1', 'k1', 'k2']);
  for (const id of ['k1', 'k2', 'g1']) {
    expect(after.some((b) => b.taskId === id), `${id} did not become a block of its own`).toBe(false);
  }
});

test('a child line does not start a drag — the handle is the parent row', async ({ page }) => {
  await bootToday(page, { seedOnce: true, settings: DAY_SETTINGS, tasks: family() });
  await settleTimeline(page);

  const kid = page.locator('[data-tl-kid="k2"]');
  const box = await kid.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 90, { steps: 12 });
  await page.mouse.up();

  /* Nothing was pinned by the child. Whether the gesture fell through to the parent row underneath is
     a separate question; what the ruling forbids is the CHILD becoming its own placed piece. */
  const ts = await stored(page);
  for (const id of ['k1', 'k2', 'g1']) {
    expect((ts.find((t) => t.id === id) || {}).pin, `${id} must not pin itself`).toBeFalsy();
  }
});
