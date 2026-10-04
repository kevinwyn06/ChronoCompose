// @ts-check
/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP): *"Gantt: an edge drag sets a date; a no-drag click on an edge opens
 * the date picker."*
 *
 * The picker's own arithmetic is unit-covered (`tests/datepick.test.js`), and `gantt-gestures.spec.js`
 * covers the bar BODY's click-vs-drag. The edge grips were the gap: they are a third mousedown mode on
 * the same element tree (`startBarDrag(…, 'start'|'end')`), and the branch that decides what a
 * zero-distance release means lives in `onMouseUp`, keyed on `this.dragMoved`.
 *
 * That branch is exactly the shape a synthetic MouseEvent cannot test. `dragMoved` is set only when
 * `snapDragMs` returns a whole-day delta, so "did not drag" is a fact about pointer travel measured
 * against the live day width — hit-testing on a 7px grip, pointer capture, and a real px scale. A
 * dispatched event skips all three, and calling `openDatePickAt` directly would only prove the method
 * exists.
 *
 * ── Addressing ─────────────────────────────────────────────────────────────────────────────────
 * The grips carry `data-gantt-edge` / `data-gantt-edge-task` (index.html, `grip(side)`), so nothing
 * here depends on a tooltip. The picker itself has no root hook; it is identified by the two controls
 * that exist nowhere else in the app while it is open — its AM/PM pair (`data-dp-mer`) and its
 * Clear/Cancel/Done row — plus the section caption, which is the only thing that says WHICH edge was
 * clicked and is therefore the assertion that matters.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* A bar wide enough that its two 7px grips are far apart and neither can be hit by accident from the
   other's centre, and short enough that BOTH stay inside the 1280px viewport. The second matters: the
   chart's default window starts two days back and draws roughly 34px per day, so an eight-day bar puts
   its right grip past x=1280 — `boundingBox()` still reports a box there, `elementFromPoint` returns
   nothing, and the press lands on the page instead of the grip. That failure reads as "the gesture
   does not work" rather than "the target was off screen", which is why the span is pinned here.
   A second task exists so the chart is not a single-row special case. */
const fixture = () => ({
  tasks: [
    task('g-long', 'Ship the release', { start: '0d', end: '+3d', priority: 1, planned: 300 }),
    task('g-other', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
  ],
});

const grip = (page, edge) => page.locator(`[data-gantt-edge-task="g-long"][data-gantt-edge="${edge}"]`);
/** The picker, identified by a control that exists only inside it. */
const picker = (page) => page.locator('[data-dp-mer]');
const detail = (page) => page.getByRole('button', { name: 'Previous task' });

async function bootGantt(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await grip(page, 'start').waitFor({ state: 'visible', timeout: 15000 });
}

/** The dates the app has stored for the long bar. */
const datesOf = (page) => page.evaluate(() => {
  try {
    const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === 'g-long');
    return t ? { start: t.start, end: t.end } : null;
  } catch (e) { return null; }
});

/** Press and release on an edge grip without travelling far enough to be a drag. */
async function clickEdge(page, edge) {
  const box = await grip(page, edge).boundingBox();
  if (!box) throw new Error('the ' + edge + ' grip had no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  /* A pixel or two, on purpose rather than a perfectly still press: a real hand never holds a mouse
     motionless, and `dragMoved` is supposed to ignore travel below one day column. */
  await page.mouse.move(x + 2, y + 1);
  await page.mouse.up();
}

test.describe('Gantt edge grips: a click opens the picker, a drag sets the date', () => {
  test('a no-drag click on the LEFT grip opens the picker on the start date', async ({ page }) => {
    await bootGantt(page);
    const before = await datesOf(page);

    await clickEdge(page, 'start');

    await expect(picker(page), 'the date picker is open').toHaveCount(2);
    await expect(page.locator('[data-qa="dp-head"]').filter({ hasText: /^Start/ }), 'and it is editing the START edge').toBeVisible();
    /* Separates the two possible outcomes rather than merely proving something opened: the bar BODY's
       no-drag click opens the detail panel, and an edge that fell through to the body would look like
       a pass to any weaker assertion. */
    await expect(detail(page), 'an edge click is not a body click').toHaveCount(0);
    /* Opening the picker is not itself an edit — the draft commits on Done/Enter. */
    expect(await datesOf(page), 'nothing was written by merely opening it').toEqual(before);
  });

  test('a no-drag click on the RIGHT grip opens the picker on the end date', async ({ page }) => {
    await bootGantt(page);
    await clickEdge(page, 'end');
    await expect(picker(page)).toHaveCount(2);
    /* The caption is the only thing in the DOM that says which edge you are editing, and the two
       grips share every other attribute — so this is the assertion that the RIGHT grip is wired to
       the right mode, not merely that some picker opened. */
    await expect(page.locator('[data-qa="dp-head"]').filter({ hasText: /^End/ }), 'the right grip edits the END edge (UI revamp block 4: sentence-case "End")').toBeVisible();
    await expect(page.locator('[data-qa="dp-head"]').filter({ hasText: /^Start/ })).toHaveCount(0);
    await expect(detail(page)).toHaveCount(0);
  });

  test('Escape closes the picker without writing anything', async ({ page }) => {
    await bootGantt(page);
    const before = await datesOf(page);
    await clickEdge(page, 'start');
    await expect(picker(page)).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(picker(page), 'the topmost overlay closes first').toHaveCount(0);
    expect(await datesOf(page), 'and the draft was discarded').toEqual(before);
  });

  test('a real drag on the same grip moves the date and opens NO picker', async ({ page }) => {
    await bootGantt(page);
    const before = await datesOf(page);
    const box = await grip(page, 'end').boundingBox();
    if (!box) throw new Error('the end grip had no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    /* Two-and-a-bit day columns at the default zoom — comfortably past `snapDragMs`'s whole-day gate,
       and still short of the viewport's right edge, which the pointer must never leave. */
    await page.mouse.move(x + 90, y, { steps: 14 });
    await page.mouse.up();

    await expect(picker(page), 'a drag is not a click — no picker').toHaveCount(0);
    await expect(detail(page), 'and not a body click either').toHaveCount(0);
    await expect
      .poll(async () => {
        const now = await datesOf(page);
        return now && before ? now.end - before.end : 0;
      }, { message: 'the drag pushed the end date later' })
      .toBeGreaterThan(0);
    const after = await datesOf(page);
    expect(after && before && after.start, 'and left the start edge alone').toBe(before && before.start);
  });
});
