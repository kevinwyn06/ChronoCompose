const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The Overdue bucket and its "→ Today" quick reschedule (V2.11).

   Two owner rules are encoded here and neither is visible from a unit test of `rescheduleToToday`:

   1. The Overdue bucket is CONDITIONAL — it "only pops up when there is stuff overdue", so it must
      appear when something is late and vanish when nothing is, rather than sitting there as a
      permanent guilt column on a clean week. It is the ONLY bucket that collapses when empty.
   2. The button is PER-CARD, deliberately not a bucket-header "reschedule everything" — a one-click
      bulk date rewrite is exactly what the Matrix drag rules already refuse.

   Both are statements about rendering, so they belong here. The date arithmetic itself (`setDate`'s
   window ordering) is unit territory and is not re-tested.

   REWRITTEN (owner 2026-08-20, Chain A task 8): the 3×2 grid this was written against is gone. There is
   no Included/Excluded row dimension any more, so `data-selcell="overdue-excluded"` has no successor —
   a card's home is a BUCKET, addressed by `data-selbucket`. "Pressed into today" is therefore no longer
   asserted as a row; it is asserted as the bucket the press MOVES the card to, which is a stronger
   statement about the same behaviour. */

const cardIn = (page, sel, name) =>
  page.locator(`${sel} [data-card-id]`).filter({ hasText: name });
const bucket = (page, k) => page.locator(`[data-selbucket="${k}"]`);
const overdue = (page) => bucket(page, 'overdue');
const reschedBtn = (page, id) => page.locator(`[data-card-id="${id}"]`).getByText('→ Today', { exact: true });

/* `pct` stays 0: `dueChipClass` only calls a past due date overdue while the task is incomplete. */
const tasks = [
  task('od-1', 'Late task', { start: '-3d', end: '-2d', included: true }),
  task('od-2', 'Fine task', { start: '0d', end: '+2d', included: true }),
];

test.describe('Overdue bucket', () => {
  test('renders only while something is overdue, and only late cards carry "→ Today"', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    await expect(overdue(page)).toBeVisible();
    await expect(cardIn(page, '[data-selbucket="overdue"]', 'Late task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selbucket="overdue"]', 'Fine task')).toHaveCount(0);

    await expect(reschedBtn(page, 'od-1')).toBeVisible();
    await expect(reschedBtn(page, 'od-2')).toHaveCount(0);
  });

  test('is absent entirely when nothing is late', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: [tasks[1]] });
    await expect(overdue(page)).toHaveCount(0);
    await expect(page.getByText('past due — reschedule or do it')).toHaveCount(0);
    /* The other four buckets keep their places — an empty New is itself information, so only Overdue
       is allowed to disappear. This is the half of the rule a bare "overdue is gone" would not pin. */
    for (const k of ['new', 'continued', 'upcoming', 'snoozed']) {
      await expect(bucket(page, k)).toHaveCount(1);
    }
  });

  test('"→ Today" clears the task out of Overdue and presses it into today', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    await reschedBtn(page, 'od-1').click();

    /* It left the Overdue bucket — and since it was the only late task, the bucket itself is gone. */
    await expect(overdue(page)).toHaveCount(0);
    /* The button goes with it: the card is no longer late, so the affordance must not linger. */
    await expect(reschedBtn(page, 'od-1')).toHaveCount(0);
    /* And it lands in CONTINUED, not merely re-dated. The owner's rule: "a task you just rescued from
       overdue is one you have decided to do — leaving it excluded would make the button a half-gesture."
       A8c (owner ruling, 2026-08-21) sharpens where it lands: a rescued overdue task is old work still
       being carried, so it keeps the day it arrived. This task arrived three days ago (the backfill reads
       that off its window), going overdue is no longer a departure, and the press finds a key already
       there. Landing in UPCOMING would mean the press never registered at all — the defect this spec
       originally caught in `rescheduleToToday` — so that assertion stays. */
    await expect(cardIn(page, '[data-selbucket="continued"]', 'Late task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selbucket="upcoming"]', 'Late task')).toHaveCount(0);
  });

  test('it presses in an UNDECIDED overdue task too', async ({ page }) => {
    /* `included:null` = unpressed. The rescue has to work from the state a forgotten task is actually
       in, which is "never looked at", not "already chosen". */
    await bootPlan(page, 'select', {
      tasks: [task('od-3', 'Forgotten task', { start: '-3d', end: '-2d', included: null }), tasks[1]],
    });

    await expect(cardIn(page, '[data-selbucket="overdue"]', 'Forgotten task')).toHaveCount(1);
    await reschedBtn(page, 'od-3').click();

    await expect(overdue(page)).toHaveCount(0);
    /* Continued, per A8c: unpressed or not, it has been on the list since its window opened. */
    await expect(cardIn(page, '[data-selbucket="continued"]', 'Forgotten task')).toHaveCount(1);
  });

  test('rescheduling one late task leaves another still late', async ({ page }) => {
    await bootPlan(page, 'select', {
      tasks: [tasks[0], task('od-4', 'Also late', { start: '-3d', end: '-1d', included: true })],
    });

    await reschedBtn(page, 'od-1').click();

    /* The bucket survives on the strength of the OTHER task — this is what distinguishes "the bucket
       is conditional" from "the button hides the bucket". */
    await expect(overdue(page)).toBeVisible();
    await expect(cardIn(page, '[data-selbucket="overdue"]', 'Also late')).toHaveCount(1);
    await expect(cardIn(page, '[data-selbucket="overdue"]', 'Late task')).toHaveCount(0);
  });
});
