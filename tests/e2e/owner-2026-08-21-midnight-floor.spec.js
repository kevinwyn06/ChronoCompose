const { test, expect } = require('@playwright/test');
const { bootToday, task, timelineBlocks } = require('./_seed');

/* Owner ruling 2026-08-21 — the bare-day midnight floor is MIDNIGHT-UNTIMED, proved end to end.
 *
 * The unit layer pins the parser (tests/owner-2026-08-21-midnight-floor.test.js). This file exists for
 * the half the mock DOM cannot reach, and it is the half the defect was actually about: the SHAPE the
 * task took on a real rendered day. A common English noun in the title — "day", "week", "month",
 * "hour" — cancelled the midnight floor, so the task anchored at the current instant, `hasStartTime`
 * derived a real clock from that timestamp, and the task drew as a keep-clear ◆ Point reserving no
 * minutes instead of a packed block. `plan today` scheduled normally; `plan my day today` did not.
 *
 * So the assertion that matters is a NEGATIVE one on the live surface: no Point marker, and a block.
 *
 * Diagnosis: docs/superpowers/findings/2026-08-21-bare-day-midnight-floor.md
 */

const anchorTask = task('anchor', 'Anchor', { start: '0d+9h', end: '0d+10h', startClock: true, endClock: true });

async function quickAdd(page, text) {
  await page.keyboard.press('q');
  const input = page.locator('input[placeholder^="Quick add"]');
  await expect(input).toBeFocused({ timeout: 5000 });
  await page.keyboard.type(text, { delay: 5 });
  await input.press('Enter');
}

const stored = (page, name) => page.evaluate((n) => {
  const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return tasks.find(t => t.name === n) || null;
}, name);

/* Both halves of the ruling on one live mount: a title carrying a unit word, and a genuine relative
   offset, which used to keep chrono's implied hour deliberately. */
for(const [phrase, label, sameDay] of [
  ['plan my day today', 'plan my day', true],
  ['call in 3 days', 'call', false],
]){
  test(`"${phrase}" is an untimed day, not a keep-clear Point`, async ({ page }) => {
    await bootToday(page, { tasks: [anchorTask], seedOnce: true });
    await quickAdd(page, phrase);

    await expect.poll(async () => (await stored(page, label))?.start != null).toBe(true);
    const t = await stored(page, label);

    /* The data half: midnight of the day it names, and no clock claimed. */
    const hm = await page.evaluate((ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes()]; }, t.start);
    expect(hm).toEqual([0, 0]);
    expect(t.startClock == null || t.startClock === false).toBe(true);

    /* The surface half, and the actual defect: NO ◆ marker. A Point reserves nothing, and that is the
       shape this phrase used to take purely because it contained the word "day". */
    await expect(page.locator(`[data-tl-point="${t.id}"]`)).toHaveCount(0, { timeout: 10000 });

    if(sameDay){
      /* And it is scheduled: the packer gives it real minutes on today's timeline, exactly as the same
         phrase without the noun always did. */
      await expect.poll(async () => (await timelineBlocks(page)).some(b => b.taskId === t.id),
        { timeout: 10000 }).toBe(true);
    }
  });
}
