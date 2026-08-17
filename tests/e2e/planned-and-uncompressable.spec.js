/* ACCEPTANCE → AUTOMATION (owner report, 2026-08-16: *"0 minute tasks are getting 30 minutes while
 * 1 hour tasks get just a few minutes"*).
 *
 * The unit layer already proves the rules. This file covers only the two things the mock DOM
 * structurally cannot reach:
 *
 *   1. What the Planned cell actually RENDERS. `planned` became three-valued — `null` = "no time
 *      given" → `—`, `0` = "deliberately zero" → `0:00` — and the round trip back through the input
 *      is a real `<input>` with a real blur. Every write is read back out of `pp-tasks`, not inferred
 *      from the DOM, so a fix that only repaints the box cannot pass.
 *   2. Real GEOMETRY. Switching "Time needed" from Exact to Flexible on a clocked task must keep the
 *      block's start and let its end float. `isFixedOn` is gated on `uncompressable`; `notBeforeMsOf`
 *      is deliberately untouched. Only a rendered timeline can show that as "same top, shorter box".
 *
 * The "Time needed" control is driven through the real UI — open the detail panel by clicking the
 * row, click the option — never through the mutator. A control that only works when called
 * programmatically is the exact failure this repo already paid for once with the %-done caret.
 */
const { test, expect } = require('@playwright/test');
const { boot, bootToday, cleanDaySettings, settleTimeline } = require('./_seed');

/** The stored task, straight out of `pp-tasks` (unscoped: e2e runs anonymous). */
const stored = (page, id) => page.evaluate((tid) => {
  const raw = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return raw.find((t) => t.id === tid) || null;
}, id);

/* `taskFlowCell` renders the sheet's editable Planned box as `input.pp-num` with this title. */
const plannedInput = (page, id) => page.locator(`[data-task-id="${id}"] input[title="Planned time"]`);

test.describe('the Planned cell tells "unset" from "a deliberate zero"', () => {
  const fixture = {
    tasks: [
      { id: 'unset', name: 'Never estimated', type: 'Proportional', included: true, planned: null, start: '0d', end: '+1d' },
      { id: 'zero', name: 'Deliberately zero', type: 'Proportional', included: true, planned: 0, start: '0d', end: '+1d' },
    ],
  };

  test('null renders — and 0 renders 0:00', async ({ page }) => {
    await boot(page, fixture);
    await expect(plannedInput(page, 'unset'), 'no time given').toHaveValue('—');
    await expect(plannedInput(page, 'zero'), 'a typed zero is a decision, and reads as one').toHaveValue('0:00');
  });

  test('blanking the box writes null, and typing 0 writes 0', async ({ page }) => {
    await boot(page, fixture);
    const box = plannedInput(page, 'unset');

    /* First give it a real figure, so the later null is a WRITE and not just the fixture showing
       through — `1:30` is 90 minutes. */
    await box.fill('1:30');
    await box.blur();
    await expect.poll(async () => (await stored(page, 'unset')).planned).toBe(90);

    /* Blank → null. Read back from storage: `parsePlannedDur('')` returning 0 would still leave an
       empty-looking box, so the DOM cannot tell these two apart. */
    await plannedInput(page, 'unset').fill('');
    await plannedInput(page, 'unset').blur();
    await expect.poll(async () => (await stored(page, 'unset')).planned,
      { message: 'a blank box means "no estimate", not zero' }).toBe(null);

    /* A typed 0 → 0, and specifically not null. */
    await plannedInput(page, 'unset').fill('0');
    await plannedInput(page, 'unset').blur();
    await expect.poll(async () => (await stored(page, 'unset')).planned,
      { message: 'a typed 0 is a decision and survives the round trip' }).toBe(0);
  });
});

test.describe('"Time needed": Exact holds the span, Flexible floats the end', () => {
  /* Fixture arithmetic, by hand from the rules:
     - The day window is 10:00–13:00 = 180 minutes, no meals, no free-time reserve,
       `packFromNow:false`, so the wall clock cannot move where blocks land.
     - `appt` is clocked 10:30 → 12:00 (a 90-minute span) with `planned:null`. With `uncompressable`
       ON it is fixed: `isFixedOn` is true, so the packer draws exactly its 90-minute clock span, and
       `filler` gets the 90 minutes left over.
     - Unticked, `isFixedOn` goes false and the task rejoins the flexible pool. `notBeforeMsOf` is
       untouched, so it still cannot start before 10:30 — the START holds. Its ask is still 90
       (requestedMinutes reads the clock span for `planned:null`), but it now has to SHARE: against
       `filler`'s 600 the pool of 180 gives it roughly 180·90/690 ≈ 23 minutes, so the box shrinks to
       about a quarter of its fixed height. The day has to be oversubscribed for this to be visible —
       an under-full day compresses nobody and both states would draw identically.
     The assertions stay directional (same top, materially smaller height) rather than naming pixels:
     the board sits in a `zoom:0.8` wrapper and the pane scale is set by a ResizeObserver, so an
     absolute px expectation would encode neither rule. */
  const fixture = {
    settings: Object.assign(cleanDaySettings('13:00'), { dayStart: '10:00' }),
    tasks: [
      { id: 'appt', name: 'Standing meeting', type: 'Proportional', included: true, planned: null,
        start: '0d+10h30m', end: '0d+12h', startClock: true, endClock: true, uncompressable: true },
      { id: 'filler', name: 'Deep work', type: 'Proportional', included: true, planned: 600, start: '0d', end: '+1d' },
    ],
  };

  /** The one block belonging to `appt`, in viewport space. Relative before/after use only. */
  async function apptBox(page) {
    const b = await page.locator('[data-tl-task="appt"]').first().boundingBox();
    if (!b) throw new Error('the appointment has no timeline block');
    return b;
  }

  test('switching Exact → Flexible keeps the start and shortens the block', async ({ page }) => {
    await bootToday(page, fixture);

    expect((await stored(page, 'appt')).uncompressable, 'the fixture starts Exact').toBe(true);
    const before = await apptBox(page);
    /* Exact means the block IS the clock span, so it must be the taller of the two states — assert
       the precondition rather than trusting the fixture. */
    expect(before.height, 'a 90-minute fixed block is a real box').toBeGreaterThan(20);

    /* Through the real UI: the timeline block's click handler opens the detail panel, and the
       "Time needed" control lives there as two role="button" options mirroring `blockingCtl`. */
    await page.locator('[data-tl-task="appt"]').first().click();
    const flexible = page.getByRole('button', { name: 'Flexible', exact: true });
    await expect(flexible, 'the detail panel offers the Time needed control').toBeVisible();
    await flexible.click();

    /* The stored field is the contract; the geometry below is the consequence. */
    await expect.poll(async () => (await stored(page, 'appt')).uncompressable).toBe(false);

    /* Close the panel so the timeline is measurable again, and let the packer re-lay out. */
    await page.keyboard.press('Escape');
    await page.locator('[data-tl-task="appt"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await settleTimeline(page);

    const after = await apptBox(page);
    expect(Math.abs(after.y - before.y), 'the start holds — notBeforeMsOf is untouched').toBeLessThan(1.5);
    /* 23 of 90 minutes — assert it lost at least a third, so a 1px wobble cannot pass for a rule. */
    expect(after.height, 'the end floats — a flexible task takes a share, not its whole span')
      .toBeLessThan(before.height * 0.67);
  });

  test('switching back to Exact restores the full clock span', async ({ page }) => {
    /* The reverse direction, because a one-way test would pass against a control that simply
       destroys the field. */
    const flexFixture = JSON.parse(JSON.stringify(fixture));
    flexFixture.tasks[0].uncompressable = false;
    await bootToday(page, flexFixture);

    const before = await apptBox(page);

    await page.locator('[data-tl-task="appt"]').first().click();
    const exact = page.getByRole('button', { name: 'Exact', exact: true });
    await expect(exact).toBeVisible();
    await exact.click();
    await expect.poll(async () => (await stored(page, 'appt')).uncompressable).toBe(true);

    await page.keyboard.press('Escape');
    await page.locator('[data-tl-task="appt"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await settleTimeline(page);

    const after = await apptBox(page);
    expect(Math.abs(after.y - before.y), 'still starting at 10:30').toBeLessThan(1.5);
    /* The same 23 → 90 in reverse. */
    expect(after.height, 'Exact takes its planned time in full').toBeGreaterThan(before.height * 1.5);
  });
});
