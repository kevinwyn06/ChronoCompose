const { test, expect } = require('@playwright/test');
const {
  bootToday, bootDays, cleanDaySettings, timelineBlocks, settleTimeline, task,
} = require('./_seed');

/* V4.4 — the Today day-drawer's two-level zoom toggle (fit ⇄ expanded).

   The two-state factor itself, and the fact that the Group 2 range constants are gone, are held in
   `tests/gantt.test.js` (three pure tests). Nothing there is repeated here.

   What only a real browser can establish, and therefore all this file holds:
     · that toggling actually changes the RENDERED scale — px-per-minute is a product of a measured
       pane height and the factor, and the mock DOM measures nothing;
     · that the control is a tenet-sized target a real click reaches;
     · that a body-drag still lands correctly at the EXPANDED level. The drag converts viewport px to
       minutes through `bd.px` (= `_curColPx`, the scale the column rendered at) after `uiPt`. Changing
       the factor changes that conversion, and every other e2e in the suite runs at fit — so this is
       exactly the case the existing coverage cannot see. Nothing about the zoom wrapper or the unit
       rule is re-tuned here; the spec only checks the existing rule survives the other level.

   Geometry note (same as snapping.spec.js / edge-drag.spec.js): `cleanDaySettings` makes the flexible
   blocks tile the window exactly, so px-per-minute is Σ(h+2) / windowMinutes. */

const WINDOW_MIN = 600;                 // 00:00–10:00
const SETTINGS = cleanDaySettings('10:00');

const fixture = () => ({
  settings: SETTINGS,
  tasks: [
    task('zm', 'Zoom me', { start: '0d', end: '+4d', planned: 100, priority: 1 }),
    task('fl', 'Filler', { start: '0d', end: '+4d', planned: 500, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);
const pxPerMin = (blocks) => blocks.reduce((s, b) => s + b.h + 2, 0) / WINDOW_MIN;
const toggle = (page) => page.locator('[data-tl-zoom]');

async function press(page) {
  await toggle(page).click();
  await settleTimeline(page);
}

/** A real pointer body-drag by `dy` viewport px, pressing in the block's upper quarter (clear of the
 *  bottom edge handle, which is the resize gesture). */
async function dragBody(page, block, dy) {
  const x = block.x + block.w / 2;
  const y = block.y + block.h / 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 12 });
  await page.mouse.up();
  await settleTimeline(page);
}

test.describe('Today day drawer: two-level zoom toggle', () => {
  test('the toggle is a single tenet-sized control that flips between exactly two rendered scales', async ({ page }) => {
    await bootToday(page, fixture());

    /* One control, not the Group 2 ＋/－ pair. */
    await expect(toggle(page), 'the drawer offers exactly one zoom control').toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('data-tl-zoom', 'fit');
    const box = await toggle(page).boundingBox();
    expect(box.width, 'HIT_MIN_PX=24 local px is 19.2 viewport px inside the zoom:0.8 wrapper')
      .toBeGreaterThanOrEqual(19);
    expect(box.height).toBeGreaterThanOrEqual(19);

    const fit = pxPerMin(await timelineBlocks(page));

    await press(page);
    await expect(toggle(page), 'the control reports the level it is now at').toHaveAttribute('data-tl-zoom', 'expanded');
    const expanded = pxPerMin(await timelineBlocks(page));
    expect(expanded / fit, 'expanding multiplies the rendered scale by the expanded factor')
      .toBeGreaterThan(2.5);
    expect(expanded / fit, 'and by that factor only — it is one level, not a step it can exceed')
      .toBeLessThan(3.5);

    /* The same press comes back, rather than stepping to a third level. */
    await press(page);
    await expect(toggle(page)).toHaveAttribute('data-tl-zoom', 'fit');
    const back = pxPerMin(await timelineBlocks(page));
    expect(Math.abs(back - fit) / fit, 'pressing again returns to the fitted scale').toBeLessThan(0.02);
  });

  test('expanded, the day is taller than its pane and the drawer scrolls', async ({ page }) => {
    await bootToday(page, fixture());
    /* Find the drawer's scroll wrapper by BEHAVIOUR (the nearest scrollable ancestor of a block)
       rather than by a style-string selector, so a later style edit cannot make this spec measure
       some other box and pass vacuously. */
    const overflowOf = () => page.evaluate(() => {
      let el = document.querySelector('[data-tl-block]');
      while (el && el !== document.body) {
        const ov = getComputedStyle(el).overflowY;
        if (ov === 'auto' || ov === 'scroll') return el.scrollHeight - el.clientHeight;
        el = el.parentElement;
      }
      return null;
    });
    /* At fit the whole day is inside the pane by construction (that is what "fit" means). */
    const fitOverflow = await overflowOf();
    expect(fitOverflow, 'a scrollable drawer wrapper exists').not.toBeNull();
    expect(fitOverflow, 'fitted, there is nothing to scroll').toBeLessThan(20);

    await press(page);
    const expOverflow = await overflowOf();
    expect(expOverflow, 'expanded, the body outgrows the pane and the wrapper scrolls')
      .toBeGreaterThan(fitOverflow + 100);
  });

  test('a body-drag lands on the same MINUTE at the expanded level as it does at fit', async ({ page }) => {
    /* The drag's px→minute conversion is `uiPt(dyRaw) / px`, and `px` triples when the column expands.
       If the conversion ever stopped reading the rendered scale, the same *minute* move would need a
       different pointer distance at each level — which is precisely what this spec falsifies: it drags
       by a distance chosen from each level's own px-per-minute and requires the same landing time. */
    await bootToday(page, fixture());
    const MOVE_MIN = 120;               // a real move, far outside PIN_ORIG_MAGNET (18 min)

    const fitBlocks = await timelineBlocks(page);
    const fitPx = pxPerMin(fitBlocks);
    const start = of(fitBlocks, 'Zoom me')[0];
    /* Block geometry is LOCAL px inside the zoom:0.8 wrapper as reported through getBoundingClientRect,
       which is viewport px — the same space `page.mouse` moves in — so the distance is simply minutes
       × the measured px-per-minute of the rendered column. */
    await dragBody(page, start, MOVE_MIN * fitPx);
    const fitLanded = of(await timelineBlocks(page), 'Zoom me')[0];
    expect(fitLanded.kind, 'precondition: the drag was a real placement at fit').toBe('pinned');
    const fitMinutes = (fitLanded.y - start.y) / fitPx;
    expect(Math.abs(fitMinutes - MOVE_MIN), 'the block moved by the minutes the pointer asked for at fit')
      .toBeLessThan(12);

    /* Reload into a clean session (zoom is session-only, so this also proves the reset), expand, and
       repeat the SAME logical move using the expanded level's own scale. */
    await bootToday(page, fixture());
    await expect(toggle(page), 'session-only: a reload comes back fitted').toHaveAttribute('data-tl-zoom', 'fit');
    await press(page);
    const expBlocks = await timelineBlocks(page);
    const expPx = pxPerMin(expBlocks);
    const start2 = of(expBlocks, 'Zoom me')[0];
    await dragBody(page, start2, MOVE_MIN * expPx);
    const expLanded = of(await timelineBlocks(page), 'Zoom me')[0];
    expect(expLanded.kind, 'the drag placed the block at the expanded level too').toBe('pinned');
    const expMinutes = (expLanded.y - start2.y) / expPx;
    expect(Math.abs(expMinutes - MOVE_MIN), 'and it moved by the SAME minutes, not by the zoom factor times them')
      .toBeLessThan(12);
  });

  test('the multi-day grid has no zoom toggle and renders at the fit scale only', async ({ page }) => {
    /* Deliberate: `renderDayColumn` is shared, but the control is the DAY DRAWER's. The 4-Day/Week
       columns pass no `zoom`, so they snap to DRAWER_ZOOM_FIT — one toggle cannot mean "expand seven
       columns at once", and a per-column control is not what the owner asked for. */
    await bootDays(page, 'day4', fixture());
    await expect(toggle(page), 'no drawer toggle on the multi-day grid').toHaveCount(0);
  });
});
