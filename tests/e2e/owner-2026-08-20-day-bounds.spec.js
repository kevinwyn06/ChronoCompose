const { test, expect } = require('@playwright/test');
const { bootToday, cleanDaySettings, settleTimeline, task } = require('./_seed');

/* Chain A, Task 12 — the day-bound handles (spec C3, owner-approved mockup
   `docs/superpowers/mockups/2026-08-20-task12-day-bound-handles.html`).

   The owner's report was two defects in one gesture: "absolutely no drag preview", and "even worse when
   trying to expand". The second explains the first — there was no canvas past the bound to drag into, so
   both the cursor and the preview line ran straight off the clipped body.

   Everything here needs a REAL pointer. `page.mouse` delivers hit-testing and pointer capture; a
   dispatched MouseEvent skips both, which is exactly what a 4px promotion threshold depends on. The
   assertions are taken MID-DRAG, before mouseup, because "the preview follows the cursor" is a claim
   about the frames during the gesture and a post-release check cannot see it at all. */

const SETTINGS = cleanDaySettings('10:00');   // 00:00–10:00
const fixture = () => ({
  settings: SETTINGS,
  tasks: [task('a', 'Work', { start: '0d', end: '+4d', planned: 120, priority: 1 })],
});

const handle = (page, which) => page.locator(`.pp-daybound[title*="day ${which}"]`);
const preview = (page) => page.locator('[data-dbpreview]');
const readout = (page) => page.locator('[data-dbreadout]');
const padZone = (page) => page.locator('[data-dbpad]');

/** "10:30am" -> minutes past midnight, so a readout sequence can be checked for monotonicity. */
function toMin(txt) {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(String(txt).trim());
  if (!m) return NaN;
  const h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/** Press a handle and move by `dy`, LEAVING THE BUTTON DOWN so the drag can be inspected. */
async function grab(page, which, dy) {
  const box = await handle(page, which).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 10 });
}

test.describe('Day-bound handles', () => {
  test('the handle is a tenet-sized target, not a 7px strip', async ({ page }) => {
    await bootToday(page, fixture());
    for (const which of ['start', 'end']) {
      /* `offsetHeight`, not `boundingBox()`: the drawer renders inside a 0.8 zoom wrapper, and
         HIT_MIN_PX is defined in LOCAL px, pre-zoom. Measuring the viewport rect here would assert the
         wrong number and quietly re-tune the zoom rule, which the repo has already paid for once. */
      const px = await handle(page, which).evaluate(el => el.offsetHeight);
      /* HIT_MIN_PX is 24. The visible bar is 3px — the glyph is deliberately not the hit box. */
      expect(px, which + ' handle').toBeGreaterThanOrEqual(24);
      const bar = await handle(page, which).locator('div').first().evaluate(el => el.offsetHeight);
      expect(bar, 'the painted bar stays thin').toBeLessThanOrEqual(4);
    }
  });

  test('the edge line and its readout follow the cursor for the whole drag', async ({ page }) => {
    await bootToday(page, fixture());

    await expect(preview(page)).toHaveCount(0, 'nothing is previewed at rest');

    const hbox = await handle(page, 'end').boundingBox();
    const px = hbox.x + hbox.width / 2, py = hbox.y + hbox.height / 2;
    await grab(page, 'end', -60);
    await expect(preview(page)).toHaveCount(1);
    const firstText = await readout(page).innerText();

    /* Move again WITHOUT releasing: the preview must follow. The assertion is on the READOUT, not on the
       line's viewport box — Task 20's autoscroll can scroll the drawer under a drag that reaches its
       edge, so the same instant in the day legitimately sits at different viewport y's during one
       gesture. The clock is the thing that has to track the cursor, and it is what the owner reads. */
    const seen = [];
    for (const dy of [-30, 0, 30, 60]) {
      await page.mouse.move(px, py + dy, { steps: 6 });
      await expect(preview(page)).toHaveCount(1, 'the preview is live for the WHOLE drag');
      seen.push(await readout(page).innerText());
    }
    expect(seen).toEqual([...seen].sort((a, b) => toMin(a) - toMin(b)));
    expect(new Set(seen).size, 'every step moved it').toBe(seen.length);
    expect(seen[0]).not.toBe(firstText);

    await page.mouse.up();
    await settleTimeline(page);
    await expect(preview(page)).toHaveCount(0, 'and it clears on release');
  });

  test('the readout is a 12-hour clock on a 15-minute grid', async ({ page }) => {
    await bootToday(page, fixture());

    /* Several stops down the column, each read mid-drag. Every one must land on a quarter hour and
       carry a meridiem — Task 13's formatter, not the 24-hour padStart this used to render. */
    await grab(page, 'end', -40);
    const seen = [];
    const box = await handle(page, 'end').boundingBox();
    for (const dy of [-40, -17, 6, 31]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 4 });
      seen.push(await readout(page).innerText());
    }
    await page.mouse.up();
    await settleTimeline(page);

    for (const txt of seen) {
      expect(txt, 'reads as a 12-hour clock').toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
      expect(Number(txt.split(':')[1].slice(0, 2)) % 15, txt + ' is on the 15-minute grid').toBe(0);
    }
    expect(new Set(seen).size, 'and it actually tracked, rather than repeating one value')
      .toBeGreaterThan(1);
  });

  test('two hours of room open in the drag direction, and only while dragging', async ({ page }) => {
    await bootToday(page, fixture());
    await expect(padZone(page)).toHaveCount(0, 'no padding at rest — the strong visual is earned by the drag');

    /* Dragging the END opens room BELOW the day end. The day here is 00:00–10:00, so there is a full two
       hours of real day left to clamp against and the room opens to its full depth. */
    await grab(page, 'end', -30);
    await expect(padZone(page)).toHaveCount(1);
    const dayEndY = (await handle(page, 'end').boundingBox()).y;
    const pad = await padZone(page).boundingBox();
    expect(pad.y).toBeGreaterThanOrEqual(dayEndY - 1, 'the room is BELOW the end bound, not above it');
    await expect(padZone(page)).toContainText('room to expand into');
    await page.mouse.up();
    await settleTimeline(page);
    await expect(padZone(page)).toHaveCount(0, 'and it closes again on release');
  });

  test('the room clamps at midnight rather than showing time that does not exist', async ({ page }) => {
    await bootToday(page, fixture());
    /* The day STARTS at 00:00, so there is no earlier time for the room to open into. The padding must
       be absent (or zero-height) instead of painting an hour of yesterday. */
    await grab(page, 'start', 40);
    const count = await padZone(page).count();
    if (count) {
      const box = await padZone(page).boundingBox();
      expect(box === null || box.height < 1).toBeTruthy();
    }
    await page.mouse.up();
    await settleTimeline(page);
  });

  test('a released drag writes the snapped bound', async ({ page }) => {
    await bootToday(page, fixture());
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-settings') || '{}').dayEnd);

    const box = await handle(page, 'end').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 10 });
    await page.mouse.up();
    await settleTimeline(page);

    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-settings') || '{}').dayEnd);
    expect(after).not.toBe(before);
    /* Stored as HH:MM — that string IS the settings format and stays 24-hour; only the READOUT is
       12-hour. And the stored minute is on the same 15-minute grid the preview showed. */
    expect(after).toMatch(/^\d{2}:\d{2}$/);
    expect(Number(after.slice(3)) % 15).toBe(0);
  });
});

/* Task 18 — the hover card. It replaced a `title` string, so "it appears on hover and says the right
   things" is only observable in a real browser with a real pointer. */
test.describe('Timeline block hover card', () => {
  test('hovering a block opens a card with the title, the window and a countdown', async ({ page }) => {
    await bootToday(page, fixture());
    const card = page.locator('[data-tl-tip]');
    await expect(card).toHaveCount(0, 'nothing on screen until the pointer is on a block');

    const block = page.locator('[data-tl-block]').first();
    await block.hover();
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-tl-tip-title]')).toHaveText('Work');
    /* The window is the 12-hour formatter at both ends — no 24-hour clock survives here. */
    await expect(card.locator('[data-tl-tip-window]')).toHaveText(/\d{1,2}:\d{2}(am|pm) – \d{1,2}:\d{2}(am|pm)/);
    await expect(card.locator('[data-tl-tip-primary]')).toHaveText(/(starts|ends|due) in |now/);

    /* The packer placed this block, so the window says so. */
    await expect(card.locator('[data-tl-tip-window]')).toContainText('planned');

    await page.mouse.move(2, 2);
    await expect(card).toHaveCount(0, 'and it closes when the pointer leaves');
  });
});
