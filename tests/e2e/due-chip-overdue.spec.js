/* Owner report 2026-08-13: "I have a task right now that is overdue, from today, but it's green and
   not red."

   The ladder itself is pinned in the unit layer (`tests/v1-sheet.test.js`, dueChipState). What only a
   live mount can prove is the thing the report was actually about: the COMPUTED COLOUR the chip ends up
   painted, through the real stylesheet, on both surfaces that share `taskDueRecurChip` — the task sheet
   row and the plan card. A mocked DOM has no cascade, so it cannot see `--danger` vs `--success`.

   The wall clock is pinned with `page.clock.setFixedTime` so "09:00 has already passed" is true no
   matter what hour the suite runs at. */

const { test, expect } = require('@playwright/test');
const { boot, bootPlan, task } = require('./_seed');

/** today at `h`:00, local. */
function todayAt(h) { const d = new Date(); d.setHours(h, 0, 0, 0); return d; }

const FIXTURE = [
  task('od-late', 'Late today', { start: '0d', end: '0d+9h', priority: 1 }),
  task('od-soon', 'Later today', { start: '0d', end: '0d+18h', priority: 2 }),
  /* A bare date sits at midnight and carries no clock; an all-day end is EXCLUSIVE, so "due today"
     is tomorrow's midnight. Both must stay 'today' at 14:00. */
  task('od-bare', 'Untimed today', { start: '0d', end: '0d', priority: 3 }),
  task('od-allday', 'All-day today', { start: '0d', end: '+1d', allDay: true, priority: 4 }),
];

async function chipColours(page, sel) {
  return page.$$eval(sel, (els) => {
    const out = {};
    els.forEach((el) => {
      const chip = el.querySelector('.pp-due-chip');
      if (!chip) return;
      out[el.getAttribute('data-task-id') || el.getAttribute('data-card-id')] = {
        cls: chip.className,
        color: getComputedStyle(chip).color,
      };
    });
    return out;
  });
}

test.describe('due chip: overdue outranks due-today', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(todayAt(14));
  });

  test('the sheet row paints a past-due-today task red', async ({ page }) => {
    await boot(page, { tasks: FIXTURE });
    const c = await chipColours(page, '[data-task-id]');

    expect(c['od-late'].cls).toContain('pp-due-chip--overdue');
    expect(c['od-soon'].cls).toContain('pp-due-chip--today');
    // Ruling: a bare/all-day due date carries no clock, so it is not overdue mid-day.
    expect(c['od-bare'].cls).toContain('pp-due-chip--today');
    expect(c['od-allday'].cls).toContain('pp-due-chip--today');

    // The reported symptom was a COLOUR, so assert the colour, not just the class.
    expect(c['od-late'].color).not.toBe(c['od-soon'].color);
    const danger = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
    const probe = await page.evaluate((v) => {
      const el = document.createElement('span');
      el.style.color = v; document.body.appendChild(el);
      const c = getComputedStyle(el).color; el.remove(); return c;
    }, danger);
    expect(c['od-late'].color).toBe(probe);
  });

  test('the plan card shares the fix (one builder, two call sites)', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: FIXTURE });
    const c = await chipColours(page, '[data-card-id]');

    expect(c['od-late'].cls).toContain('pp-due-chip--overdue');
    expect(c['od-soon'].cls).toContain('pp-due-chip--today');
    expect(c['od-late'].color).not.toBe(c['od-soon'].color);
  });
});
