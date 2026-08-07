const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* The Overdue column and its "→ Today" quick reschedule (V2.11).

   Two owner rules are encoded here and neither is visible from a unit test of `rescheduleToToday`:

   1. The Overdue column is CONDITIONAL — it "only pops up when there is stuff overdue", so it must
      appear when something is late and vanish when nothing is, rather than sitting there as a
      permanent guilt column on a clean week.
   2. The button is PER-CARD, deliberately not a column-header "reschedule everything" — a one-click
      bulk date rewrite is exactly what the Matrix drag rules already refuse.

   Both are statements about rendering, so they belong here. The date arithmetic itself (`setDate`'s
   window ordering) is unit territory and is not re-tested. */

const cardIn = (page, cellSel, name) =>
  page.locator(`${cellSel} [data-card-id]`).filter({ hasText: name });
const overdueCells = (page) => page.locator('[data-selcell^="overdue-"]');
const reschedBtn = (page, id) => page.locator(`[data-card-id="${id}"]`).getByText('→ Today', { exact: true });

/* `pct` stays 0: `dueChipClass` only calls a past due date overdue while the task is incomplete. */
const tasks = [
  task('od-1', 'Late task', { start: '-3d', end: '-2d', included: true }),
  task('od-2', 'Fine task', { start: '0d', end: '+2d', included: true }),
];

test.describe('Overdue column', () => {
  test('renders only while something is overdue, and only late cards carry "→ Today"', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    await expect(overdueCells(page).first()).toBeVisible();
    await expect(cardIn(page, '[data-selcell^="overdue-"]', 'Late task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selcell^="overdue-"]', 'Fine task')).toHaveCount(0);

    await expect(reschedBtn(page, 'od-1')).toBeVisible();
    await expect(reschedBtn(page, 'od-2')).toHaveCount(0);
  });

  test('is absent entirely when nothing is late', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: [tasks[1]] });
    await expect(overdueCells(page)).toHaveCount(0);
    await expect(page.getByText('past due — reschedule or do it')).toHaveCount(0);
  });

  test('"→ Today" clears the task out of Overdue and presses it into today', async ({ page }) => {
    await bootPlan(page, 'select', { tasks });

    await reschedBtn(page, 'od-1').click();

    /* It left the Overdue column — and since it was the only late task, the column itself is gone. */
    await expect(overdueCells(page)).toHaveCount(0);
    /* The button goes with it: the card is no longer late, so the affordance must not linger. */
    await expect(reschedBtn(page, 'od-1')).toHaveCount(0);
    /* And it is INCLUDED, not merely re-dated. The owner's rule: "a task you just rescued from
       overdue is one you have decided to do — leaving it excluded would make the button a
       half-gesture." This is the half of the behaviour a date-only test would miss. */
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Late task')).toHaveCount(1);
    await expect(cardIn(page, '[data-selcell$="-excluded"]', 'Late task')).toHaveCount(0);
  });

  test('it presses in an EXCLUDED overdue task too', async ({ page }) => {
    /* `included:null` = unpressed. The rescue has to work from the state a forgotten task is actually
       in, which is "never looked at", not "already chosen". */
    await bootPlan(page, 'select', {
      tasks: [task('od-3', 'Forgotten task', { start: '-3d', end: '-2d', included: null }), tasks[1]],
    });

    await expect(cardIn(page, '[data-selcell="overdue-excluded"]', 'Forgotten task')).toHaveCount(1);
    await reschedBtn(page, 'od-3').click();

    await expect(overdueCells(page)).toHaveCount(0);
    await expect(cardIn(page, '[data-selcell$="-included"]', 'Forgotten task')).toHaveCount(1);
  });

  test('rescheduling one late task leaves another still late', async ({ page }) => {
    await bootPlan(page, 'select', {
      tasks: [tasks[0], task('od-4', 'Also late', { start: '-3d', end: '-1d', included: true })],
    });

    await reschedBtn(page, 'od-1').click();

    /* The column survives on the strength of the OTHER task — this is what distinguishes "the column
       is conditional" from "the button hides the column". */
    await expect(overdueCells(page).first()).toBeVisible();
    await expect(cardIn(page, '[data-selcell^="overdue-"]', 'Also late')).toHaveCount(1);
    await expect(cardIn(page, '[data-selcell^="overdue-"]', 'Late task')).toHaveCount(0);
  });
});
