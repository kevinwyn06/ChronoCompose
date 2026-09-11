const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

test.use({ timezoneId: 'America/Vancouver' });

/* REVISED 2026-09-11 (owner: *"if all occurances are merged together, then dragging the start or end
   should not have a popup for if its an individual or bulk change"*).

   This file used to prove that EVERY recurring drag raises the scope prompt, and it used a fixture whose
   occurrences all merge into one block to prove it — which is precisely the case the owner says must not
   ask. So the fixture keeps its job and swaps its expectation: a fully merged run commits straight to the
   series, and a repeat that paints SEPARATE blocks (the second fixture below) still asks, because there
   the choice is real. The PREVIEW assertions are unchanged in both — how the block follows the pointer is
   a different question from what the release commits, and it was always the harder half to get right. */

/* Three consecutive days: the chart merges them into ONE block, so there is nothing to choose between. */
async function bootRun(page) {
  await bootSurface(page, { view: 'gantt' }, { tasks: [
    task('run', 'Three-day run', {
      /* The run must be VISIBLE in the Gantt's scroll viewport, not merely present in its content: the
         chart scrolls (scrollWidth ~2226 against a ~690px viewport), and a bar past the right edge still
         reports a boundingBox — one that lies outside the browser window. At +6d..+8d the last
         occurrence sat at viewport x~1299, so `page.mouse` pushed its right edge into dead space and the
         resize previewed zero. Whether it landed there depended on today's weekday, which is why this
         spec passed on 08-27 and failed on 08-30. Near-today offsets are on screen under every weekday
         alignment; `expectDragOnScreen` fails loudly if that ever stops holding. */
      start: '+2d', end: '+3d', allDay: true,
      recur: { kind: 'day', n: 1, label: 'Daily', until: '+4d', overrides: {}, shifts: [] },
    }),
  ] });
  const bar = page.locator('[data-gantt-bar-id="run"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-gantt-run-occurrences', '0,1,2');
  return bar;
}

/* Two-day occurrences four days apart: nothing is adjacent, so the chart paints three separate blocks and
   "this one" and "all of them" are different sentences again. The occurrence is two days wide on purpose —
   a one-column bar leaves `[data-gantt-bar-body]` narrower than the two 7px edge grips beside it, so the
   press lands on the START grip and the gesture under test is quietly not the one being run. */
async function bootSeparate(page) {
  await bootSurface(page, { view: 'gantt' }, { tasks: [
    task('sep', 'Every fourth day', {
      start: '+1d', end: '+3d', allDay: true,
      recur: { kind: 'day', n: 4, label: 'Every 4 days', until: '+9d', overrides: {}, shifts: [] },
    }),
  ] });
  const bar = page.locator('[data-gantt-bar-id="sep"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-gantt-run-occurrences', '0');
  return bar;
}

/* An off-screen drag and a broken drag both read as "the bar did not move", so assert the precondition
   separately: both ends of the gesture must land inside the Gantt's visible scroll rect. A bar scrolled
   past that rect still reports a boundingBox, so the box alone proves nothing about reachability. */
async function expectDragOnScreen(page, x, direction, day, surface) {
  const view = await page.locator('[data-gantt-scroll]').boundingBox();
  const why = `the ${surface} drag target is outside the Gantt's visible scroll rect — move the fixture nearer today, or scroll it into view; do not loosen the assertion`;
  expect(x, why).toBeGreaterThan(view.x);
  expect(x, why).toBeLessThan(view.x + view.width);
  expect(x + direction * day, why).toBeGreaterThan(view.x);
  expect(x + direction * day, why).toBeLessThan(view.x + view.width);
}

/** Drag one day and release. Returns nothing; the caller asserts what the release committed. */
async function dragOneDay(page, bar, surface, direction) {
  const before = await bar.boundingBox();
  const columns = Number(await bar.getAttribute('data-gantt-columns'));
  const day = before.width / columns;
  const target = surface === 'body'
    ? bar.locator(':scope > [data-gantt-bar-body]').first()
    : bar.locator(`[data-gantt-edge="${surface}"]`).first();
  const box = await target.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await expectDragOnScreen(page, x, direction, day, surface);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + direction * day, y, { steps: 12 });
  const preview = await bar.boundingBox();
  if (surface === 'body') {
    expect(preview.x - before.x, 'the entire merged run moves during trusted-pointer preview').toBeCloseTo(direction * day, 0);
    expect(preview.width).toBeCloseTo(before.width, 0);
  } else if (surface === 'start') {
    expect(preview.x - before.x).toBeCloseTo(direction * day, 0);
    expect(preview.width - before.width).toBeCloseTo(-direction * day, 0);
  } else {
    expect(preview.x).toBeCloseTo(before.x, 0);
    expect(preview.width - before.width).toBeCloseTo(direction * day, 0);
  }
  await page.mouse.up();
}

const stored = (page, i) => page.evaluate(n => JSON.parse(localStorage.getItem('pp-tasks'))[n], i || 0);
const plusDays = (page, ms, n) =>
  page.evaluate(([m, k]) => { const d = new Date(m); d.setDate(d.getDate() + k); return d.getTime(); }, [ms, n]);

async function expectNoPrompt(page) {
  await expect(page.getByText('Edit repeating task', { exact: true })).toHaveCount(0);
  await expect(page.getByText('This run', { exact: true })).toHaveCount(0);
  await expect(page.getByText('All occurrences', { exact: true })).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// One merged block ⇒ no question to ask.
// ---------------------------------------------------------------------------

test('a body drag on a fully merged run commits to the series without asking', async ({ page }) => {
  const bar = await bootRun(page);
  const before = await stored(page);
  await dragOneDay(page, bar, 'body', 1);
  await expectNoPrompt(page);
  const saved = await stored(page);
  expect(saved.start).toBe(await plusDays(page, before.start, 1));
  expect(saved.recur.durMs).toBe(86400000, 'a move is not a resize');
  expect(saved.recur.overrides || {}).toEqual({},
    'the series WINDOW moved — an unambiguous gesture leaves no per-occurrence residue');
});

test('the left edge of a merged run moves the series start, still without asking', async ({ page }) => {
  const bar = await bootRun(page);
  const before = await stored(page);
  await dragOneDay(page, bar, 'start', -1);
  await expectNoPrompt(page);
  const saved = await stored(page);
  expect(saved.start).toBe(await plusDays(page, before.start, -1));
  expect(saved.recur.overrides || {}).toEqual({});
});

test('the right edge of a merged run moves the series end, still without asking', async ({ page }) => {
  const bar = await bootRun(page);
  const before = await stored(page);
  await dragOneDay(page, bar, 'end', 1);
  await expectNoPrompt(page);
  const saved = await stored(page);
  expect(saved.start).toBe(before.start, 'the leading edge is untouched by a trailing-edge drag');
  expect(saved.recur.overrides || {}).toEqual({});
  /* The stored window END is deliberately not compared against `before`: `before` is the seeded LEGACY
     row, and the window conversion happens in `normalizeTask` on load, so the two sides of that
     subtraction are in different shapes. What "the series end moved a day" MEANS on screen is that the
     series fires once more, which the painted run states directly. */
  await expect(page.locator('[data-gantt-bar-id="run"]').first())
    .toHaveAttribute('data-gantt-run-occurrences', '0,1,2,3');
});

// ---------------------------------------------------------------------------
// Separate blocks ⇒ the choice is real, so the prompt stays.
// ---------------------------------------------------------------------------

test('a repeat that paints separate blocks still asks which occurrences the drag meant', async ({ page }) => {
  const bar = await bootSeparate(page);
  await dragOneDay(page, bar, 'body', 1);
  await expect(page.getByText('Edit repeating task', { exact: true })).toBeVisible();
  await expect(page.getByText('This occurrence only', { exact: true })).toBeVisible();
  await expect(page.getByText('All occurrences', { exact: true })).toBeVisible();
  await page.getByText('This occurrence only', { exact: true }).click();
  const saved = await stored(page);
  expect(Object.keys(saved.recur.overrides || {})).toEqual(['0'],
    'and the answer lands on the one occurrence the user was holding');
});

test('choosing All occurrences on a separate-block repeat still moves the series', async ({ page }) => {
  const bar = await bootSeparate(page);
  const before = await stored(page);
  await dragOneDay(page, bar, 'body', 1);
  await page.getByText('All occurrences', { exact: true }).click();
  const saved = await stored(page);
  expect(saved.start).toBe(await plusDays(page, before.start, 1));
  expect(saved.recur.overrides || {}).toEqual({});
});
