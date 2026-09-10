/* PP-EXT (owner 2026-08-25, filter-bar redesign): the bar's DOM contract, against a live mount.
   Everything provable without a browser is in the unit layer (tests/filter-horizon.test.js,
   tests/filter-prefs-migration.test.js, tests/priority-column.test.js); this file covers only what the
   mocked DOM structurally cannot reach — real trusted clicks on the real rendered bar, and the ABSENCE
   of the retired controls from the mounted tree. */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed.js');

/* FIXTURE TRAP, stated so the next reader does not re-introduce it: `_seed.js`'s `task()` helper stamps
   `included: true`, and an explicitly included task survives EVERY horizon by owner ruling ("or if the
   user has included it"). A fixture built with that helper therefore cannot exercise the slider at all —
   every row passes for the wrong reason. These are raw task objects, so `included` normalizes to `null`
   and the window is what decides. */
const T = (id, name, extra) =>
  Object.assign({ id, name, type: 'Proportional', planned: 60 }, extra || {});

const FIXTURE = {
  seedOnce: true,
  sections: [{ id: 's1', name: 'Deep work' }],
  tasks: [
    T('near',   'Near task',    { start: '+1d',   end: '+2d',   sectionId: 's1', priority: 1 }),
    T('mid',    'Mid task',     { start: '+40d',  end: '+41d',  priority: 3 }),
    T('far',    'Far task',     { start: '+300d', end: '+301d', priority: 2 }),
    T('noDate', 'Someday task', { priority: 4 }),
  ],
};

const BAR = '[data-pp-filterbar="1"]';
const ROW = '[data-task-id]';
const NAME = '[data-task-name="1"]';

test('the retired controls are gone from the bar', async ({ page }) => {
  await boot(page, FIXTURE);
  const bar = page.locator(BAR);
  await expect(bar).toHaveCount(1);
  for (const label of ['Active today', 'Startable', 'Overdue', 'Running', 'Filters ▾']) {
    await expect(bar.getByText(label, { exact: true })).toHaveCount(0);
  }
  /* Scoped to the bar on purpose: the Settings drawer legitimately has selects, and the per-calendar
     lookahead adds another. */
  await expect(bar.locator('select')).toHaveCount(0);
});

test('the horizon slider filters, spares dateless work, and clears on the active notch', async ({ page }) => {
  await boot(page, FIXTURE);
  const seg = page.locator('[data-pp-seg="horizon"]');
  await expect(seg.locator('[data-seg-key]')).toHaveCount(6);
  await expect(page.locator('[data-task-id="far"]')).toHaveCount(1);

  await seg.locator('[data-seg-key="1w"]').click();
  await expect(seg.locator('[data-seg-key="1w"][data-active="1"]')).toHaveCount(1);
  await expect(page.locator('[data-task-id="far"]')).toHaveCount(0);
  await expect(page.locator('[data-task-id="mid"]')).toHaveCount(0);
  await expect(page.locator('[data-task-id="near"]')).toHaveCount(1);
  await expect(page.locator('[data-task-id="noDate"]')).toHaveCount(1);   // dateless never drops

  await seg.locator('[data-seg-key="1w"]').click();                        // the active notch clears
  await expect(seg.locator('[data-seg-key="1w"][data-active="1"]')).toHaveCount(0);
  await expect(page.locator('[data-task-id="far"]')).toHaveCount(1);
});

test('a wider horizon admits the mid task and still excludes the far one', async ({ page }) => {
  await boot(page, FIXTURE);
  const seg = page.locator('[data-pp-seg="horizon"]');
  await seg.locator('[data-seg-key="3m"]').click();
  await expect(page.locator('[data-task-id="mid"]')).toHaveCount(1);
  await expect(page.locator('[data-task-id="far"]')).toHaveCount(0);
  /* Dateless work survives this window too — the unit layer pins all six lengths
     (tests/filter-horizon.test.js); this is the live-mount confirmation on a second notch. */
  await expect(page.locator('[data-task-id="noDate"]')).toHaveCount(1);
});

/* PP-EXT (owner 2026-09-10): the group SEGMENT is gone - sections always group, and inclusion is a
   filter chip that composes with the rest of the bar instead of excluding them. */
test('there is no group control left, and Included is a chip beside the other filters', async ({ page }) => {
  await boot(page, FIXTURE);
  await expect(page.locator('[data-pp-seg="group"]')).toHaveCount(0);
  const chip = page.locator('[data-pp-filterbar] [data-pp-chip="incl"]');
  await expect(chip).toHaveCount(1);
  await expect(chip).not.toHaveAttribute('data-active', '1');
  await chip.click();
  await expect(chip).toHaveAttribute('data-active', '1');
  /* And it is a filter like any other, so Clear all reaches it. */
  await page.locator('[data-pp-filterbar] [data-pp-chip="clr"]').click();
  await expect(chip).not.toHaveAttribute('data-active', '1');
});

/* Deliberately section-less: `sortTree` sorts SIBLINGS, so with FIXTURE's `s1` band the P1 row is alone
   in the first band and stays on top whichever way the sort points — the assertion would pass for a
   reason that has nothing to do with the sort direction. One band makes the direction observable. */
const SORT_FIXTURE = {
  seedOnce: true,
  tasks: [
    T('near',   'Near task',    { start: '+1d',  end: '+2d',  priority: 1 }),
    T('mid',    'Mid task',     { start: '+40d', end: '+41d', priority: 3 }),
    T('noDate', 'Someday task', { priority: 4 }),
  ],
};

test('the check header cycles priority sort', async ({ page }) => {
  await boot(page, SORT_FIXTURE);
  const header = page.locator('[data-colk="check"]').first();
  const names = page.locator(`${ROW} ${NAME}`);

  await header.click();                                    // asc — P1 first
  await expect(names).toHaveText(['Near task', 'Mid task', 'Someday task']);
  await header.click();                                    // desc — P4 first
  await expect(names).toHaveText(['Someday task', 'Mid task', 'Near task']);
  await header.click();                                    // cleared — manual order restored
  await expect(names).toHaveText(['Near task', 'Mid task', 'Someday task']);
});
