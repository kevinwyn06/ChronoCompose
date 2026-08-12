/* SHEET ⇄ GANTT SCROLL SYNC (owner 2026-08-12).
 *
 * Owner: "The scrolling between the list and the gantt is not fully synced. One kind of follows the
 * other rather than always being equal."
 *
 * This has to live in the browser layer, not the unit layer, because both defects are things the mock
 * DOM structurally cannot have:
 *
 *   1. The echo is ASYNCHRONOUS. Assigning `scrollTop` does not dispatch `scroll` synchronously — the
 *      browser fires it later, before the next paint. The old guard was raised and cleared inside one
 *      synchronous call, so it was always already down when the echo arrived. A mock DOM with no event
 *      loop and no real scrollTop cannot reproduce that ordering, which is why this shipped green.
 *   2. The panes CLAMP at different maxima. The sheet ends in a trailing "+ Add task" row, so its
 *      content was `rowH` taller than the Gantt's. Only a real layout has scrollHeight/clientHeight to
 *      clamp against.
 *
 * The two combined were the actual bug: near the bottom the sheet reached an offset the Gantt could not,
 * the write clamped, and the unguarded echo wrote the clamped value back — dragging the sheet up under
 * the user. So the assertions below deliberately include the BOTTOM of a long list, which is the only
 * place the old code misbehaved.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* Long enough that both panes overflow by a wide margin and the bottom is far from the top. */
const N = 60;
const tasks = Array.from({ length: N }, (_, i) =>
  task('s' + i, 'Task number ' + i, { start: '+0d', end: '+' + ((i % 9) + 1) + 'd', planned: 60 }));

async function bootSplit(page) {
  await bootSurface(page, { view: 'gantt' }, { theme: 'dark', tasks });
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(200);
}

/** The two scroll containers, located through the component's own refs' DOM shape. */
async function panes(page) {
  return page.evaluate(() => {
    const gantt = document.querySelector('[data-gantt-tail]')?.closest('div[style*="overflow"]')
      || document.querySelector('[data-gantt-task-id]')?.closest('div[style*="overflow"]');
    // The sheet is the other overflow:auto scroller in the split.
    const all = [...document.querySelectorAll('div')].filter((d) => {
      const cs = getComputedStyle(d);
      return /auto|scroll/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 4;
    });
    const sheet = all.find((d) => d !== gantt && !d.contains(gantt) && !gantt?.contains(d));
    const mark = (el, name) => { if (el) el.setAttribute('data-pane', name); };
    mark(gantt, 'gantt'); mark(sheet, 'sheet');
    return {
      ok: !!gantt && !!sheet,
      gantt: gantt && { max: gantt.scrollHeight - gantt.clientHeight, h: gantt.scrollHeight },
      sheet: sheet && { max: sheet.scrollHeight - sheet.clientHeight, h: sheet.scrollHeight },
    };
  });
}

const tops = (page) => page.evaluate(() => ({
  sheet: document.querySelector('[data-pane="sheet"]').scrollTop,
  gantt: document.querySelector('[data-pane="gantt"]').scrollTop,
}));

async function scrollPane(page, which, to) {
  await page.evaluate(([w, y]) => {
    document.querySelector(`[data-pane="${w}"]`).scrollTop = y;
  }, [which, to]);
  /* Let the scroll event, the sync write, the echo, and the rAF release all land. */
  await page.waitForTimeout(120);
}

test.describe('sheet ⇄ Gantt scroll sync', () => {
  test('the two panes have identical scrollable height', async ({ page }) => {
    await bootSplit(page);
    const p = await panes(page);
    expect(p.ok, 'found both scroll containers').toBe(true);
    /* The premise: both actually overflow, so this is not a trivially-equal pair of zeros. */
    expect(p.sheet.max, 'the sheet overflows').toBeGreaterThan(100);
    expect(p.gantt.max, 'the Gantt overflows').toBeGreaterThan(100);
    /* The fix: the Gantt's tail spacer matches the sheet's trailing add-row. Sub-pixel tolerance only,
       for the zoom:0.8 wrapper's rounding. */
    expect(Math.abs(p.sheet.max - p.gantt.max),
      `scroll maxima must match; sheet ${p.sheet.max} vs gantt ${p.gantt.max}`).toBeLessThanOrEqual(1);
  });

  test('scrolling either pane moves the other to the SAME offset', async ({ page }) => {
    await bootSplit(page);
    await panes(page);

    for (const [which, y] of [['sheet', 250], ['gantt', 480], ['sheet', 120], ['gantt', 0]]) {
      await scrollPane(page, which, y);
      const t = await tops(page);
      expect(Math.abs(t.sheet - t.gantt),
        `after scrolling ${which} to ${y}: sheet ${t.sheet} vs gantt ${t.gantt}`).toBeLessThanOrEqual(1);
      expect(Math.abs(t[which] - y), `${which} actually landed where it was put`).toBeLessThanOrEqual(1);
    }
  });

  test('at the BOTTOM of a long list neither pane drags the other back', async ({ page }) => {
    /* The regression case. Under the old code the sheet could scroll past the Gantt's maximum, the
       write clamped, and the unguarded echo wrote the clamped value back into the sheet — so the sheet
       visibly jumped upward after the user released. */
    await bootSplit(page);
    const p = await panes(page);

    await scrollPane(page, 'sheet', p.sheet.max);
    const atBottom = await tops(page);
    expect(atBottom.sheet, 'the sheet stayed at the bottom it was scrolled to')
      .toBeGreaterThanOrEqual(p.sheet.max - 1);
    expect(Math.abs(atBottom.sheet - atBottom.gantt), 'and the Gantt is level with it').toBeLessThanOrEqual(1);

    /* Settle: give several frames for any echo loop to reveal itself, then re-read. A ping-pong would
       show up as the value having moved on its own. */
    await page.waitForTimeout(400);
    const settled = await tops(page);
    expect(settled.sheet, 'no delayed echo moved the sheet').toBe(atBottom.sheet);
    expect(settled.gantt, 'no delayed echo moved the Gantt').toBe(atBottom.gantt);
  });

  test('a real wheel gesture over the Gantt keeps both panes level', async ({ page }) => {
    /* Programmatic scrollTop and a trusted wheel take different paths into the scroller; the sync must
       hold for the gesture the user actually performs. */
    await bootSplit(page);
    await panes(page);
    const box = await page.locator('[data-gantt-task-id]').first().boundingBox();
    await page.mouse.move(box.x + 60, box.y + 40);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(250);
    const t = await tops(page);
    expect(t.gantt, 'the wheel actually scrolled the Gantt').toBeGreaterThan(50);
    expect(Math.abs(t.sheet - t.gantt),
      `wheel: sheet ${t.sheet} vs gantt ${t.gantt}`).toBeLessThanOrEqual(1);
  });
});
