/* ACCEPTANCE → AUTOMATION.
 *
 * Former manual item (ROADMAP "V3/V4 owner user-check"): *"Confirm the unpin ✕ and the ⧉ regroup
 * control are comfortably clickable at HIT_MIN_PX=24."*
 *
 * The ✕ half is already pinned by `timeline-drag.spec.js` ("the unpin ✕ is a generous hit target").
 * The ⧉ half was NOT: `visual-evidence.spec.js` only photographs the glyph (the tofu question), and a
 * screenshot says nothing about the size of the box behind it. That gap is exactly the hit-target
 * tenet's failure mode — a 16px glyph doubling as its own hit box.
 *
 * Both halves are asserted: the measured box, and a real trusted click at the far corner of that box
 * (never its centre, which the old glyph-sized target would also have satisfied).
 */
const { test, expect } = require('@playwright/test');
const { bootToday, cleanDaySettings, timelineBlocks, settleTimeline, task } = require('./_seed');

/* Window 00:00–10:00 with a 01:00–02:00 appointment, so `Split me` is drawn in two chunks and a
   contiguous slot still exists afterwards — `regroupSpan`'s precondition for offering the control. */
const regroupFixture = () => ({
  settings: cleanDaySettings('10:00'),
  tasks: [
    task('appt', 'Standup', { start: '0d+1h', end: '0d+2h', startClock: true, endClock: true, planned: 60 }),
    task('split', 'Split me', { start: '0d', end: '+2d', planned: 100, priority: 1 }),
    task('filler', 'Filler', { start: '0d', end: '+2d', planned: 440, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);

test.describe('the ⧉ regroup control is a real hit target', () => {
  test('its box is HIT_MIN_PX, and a click at the far corner of that box regroups', async ({ page }) => {
    await bootToday(page, regroupFixture());
    const before = await timelineBlocks(page);
    expect(of(before, 'Split me'), 'fixture: the appointment split the task').toHaveLength(2);

    const rg = page.locator('[title^="Regroup"]');
    await expect(rg, 'a split task offers regroup').toHaveCount(1);
    const box = await rg.boundingBox();

    /* HIT_MIN_PX is 24 LOCAL px and the app renders inside a `zoom:0.8` wrapper, so the same target
       measures 19.2 viewport px. Same conversion the ✕ assertion uses. */
    expect(box.width, 'at least HIT_MIN_PX wide').toBeGreaterThanOrEqual(19);
    expect(box.height, 'at least HIT_MIN_PX tall').toBeGreaterThanOrEqual(19);

    /* Behavioural half. Click 2px inside the BOTTOM-RIGHT corner — a glyph-sized box centred in this
       target would not cover this point, so a regression to glyph-as-hit-box fails here rather than
       passing on a centre click. */
    await page.mouse.click(box.x + box.width - 2, box.y + box.height - 2);
    await settleTimeline(page);

    const after = await timelineBlocks(page);
    expect(of(after, 'Split me'), 'the corner click reached the control: one contiguous block')
      .toHaveLength(1);
    expect(of(after, 'Split me')[0].pinned, 'and it is held by a pin').toBe(true);
  });
});
