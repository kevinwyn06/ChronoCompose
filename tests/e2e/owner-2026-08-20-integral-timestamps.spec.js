const { test, expect } = require('@playwright/test');
const { seed, boot, bootSurface, task } = require('./_seed');

/* Owner report 2026-08-20 — "the tasks I have are not the same on my localhost and vercel deployments".
   Root cause: ONE task carried a fractional `end` (1785437897142.8572). `start`/`end` are `bigint`
   columns, so the bulk upsert died with `22P02 invalid input syntax for type bigint`, and because the
   flush keeps the queue on failure that single row wedged EVERY write from that origin — permanently and
   silently. Measured live: Vercel 11 tasks, localhost 28, 24 ops stuck in the queue.

   ── Why these tests are HERE and not in the unit layer ──────────────────────────────────────────────
   The funnel itself (normalizeTask coercion, syncRowForWrite rounding, the quarantine split) is pure and
   is exhaustively covered in `tests/owner-2026-08-20-sync-queue-wedge.test.js` — 14 cases, and none of
   them are duplicated here. What the mock DOM structurally cannot reach is the PRODUCER: whether a real
   gesture, under a trusted pointer, at a real zoom level, can mint a fractional timestamp in the first
   place. I could not identify which historical code path produced the owner's value, so the guard has to
   be behavioural: drive the real gestures that write dates and assert the invariant holds after each.

   Synthetic dispatched MouseEvents would prove nothing here: they skip hit-testing and
   pointer capture, which is exactly what a drag threshold and a pointer-captured resize depend on.

   ── The invariant ───────────────────────────────────────────────────────────────────────────────────
   Every epoch-ms task field backed by a bigint column is an integer, always, in persisted state.
   Anything else is unsendable and wedges the account's sync. */

/** Task fields backed by an integer/bigint Postgres column (index.html INT_MS_FIELDS). */
const INT_MS = ['start', 'end', 'completion', 'archivedAt', 'snoozeUntil'];

/** Read persisted tasks. e2e runs anonymous, so the keys are unscoped (see `_seed.js`). */
async function persistedTasks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks') || '[]'));
}

/** The assertion this whole file exists for. Names the offender so a failure is actionable. */
function expectIntegral(tasks, where) {
  const bad = [];
  tasks.forEach((t) => {
    INT_MS.forEach((k) => {
      const v = t[k];
      if (typeof v === 'number' && !Number.isInteger(v)) bad.push(`${t.id}.${k} = ${v}`);
    });
  });
  expect(bad, `fractional epoch-ms after ${where} — this value would wedge the sync queue`).toEqual([]);
}

const fixture = () => ({
  tasks: [
    task('a', 'Ship the release', { start: '-2d', end: '+6d', priority: 1, planned: 300 }),
    task('b', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
    task('c', 'Dateless chore', { planned: 30 }),
  ],
});

const BAR = '[data-gantt-tip^="Ship the release ·"]';

async function bootGantt(page, data) {
  await bootSurface(page, { view: 'gantt' }, data || fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function barBox(page) {
  return page.locator(BAR).first().boundingBox();
}

/* ==================================================================================================
   1 — the poison row already on disk is healed, not preserved
   ================================================================================================== */

test.describe('a legacy fractional timestamp is healed on load', () => {
  test('the owner\'s exact bad value is rounded once the app persists', async ({ page }) => {
    /* Seed the real thing: a task whose `end` carries the owner's fraction. This is the state localhost
       was actually in — the value was already in localStorage, so it reached the queue without ever
       passing back through normalizeTask. */
    await seed(page, {
      prefs: { firstRunSeen: true, mainView: 'gantt' },
      tasks: [
        task('poison', 'test ghost', { start: '0d', end: '+1d' }),
        task('ok', 'Healthy task', { start: '0d', end: '+4d', priority: 1, planned: 200 }),
      ],
    });
    await page.addInitScript(() => {
      /* runs after _seed's init script, so it can corrupt what the fixture just wrote */
      const raw = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
      const p = raw.find((t) => t.id === 'poison');
      if (p) { p.end = 1785437897142.8572; localStorage.setItem('pp-tasks', JSON.stringify(raw)); }
    });
    await page.goto('/index.html');
    await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
    const healthyBar = page.locator('[data-gantt-tip^="Healthy task ·"]').first();
    await healthyBar.waitFor({ state: 'visible', timeout: 15000 });

    /* Confirm the fixture really was poisoned, or this test proves nothing.
       UPDATED 2026-08-20 (Chain A): the value on disk here may ALREADY be healed. Chain A's once-per-day
       `onListSince` maintenance pass commits on the load path whenever it stamps a task, and any commit
       rewrites the whole array through `normalizeTask`. That is the coercion working sooner, not a
       weaker guarantee — but it means "still fractional at this instant" is a fact about the load path
       rather than about the fix, and asserting it made this spec fail for the wrong reason.
       What is NOT relaxed is the vacuity guard: the poisoned value must have been written to disk by the
       init script, so the assertion below is that it is one of the two — the raw fraction, or the rounded
       value it heals to. A fixture that never poisoned anything would carry the fixture's own `end` and
       fail both. */
    const onDisk = await persistedTasks(page);
    expect([1785437897142.8572, 1785437897143],
      'the fixture must actually be poisoned or this test is vacuous')
      .toContain(onDisk.find((t) => t.id === 'poison').end);

    /* Any commit rewrites the whole array through normalizeTask, because the load already healed it in
       memory. Drag the OTHER task's bar, so the poisoned row is touched by normalization alone and never
       by the edit itself — that is what makes this a test of healing rather than of the drag. */
    const hb = await healthyBar.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 90, hb.y + hb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const tasks = await persistedTasks(page);
    const poison = tasks.find((t) => t.id === 'poison');
    expect(poison, 'the poisoned task must survive, not be dropped').toBeTruthy();
    expectIntegral(tasks, 'loading a workspace containing a fractional end');
    expect(poison.end).toBe(1785437897143);
  });

  test('healing does not invent dates for a dateless task', async ({ page }) => {
    await boot(page, { tasks: [task('c', 'Dateless chore', { planned: 30 })] });
    const tasks = await persistedTasks(page);
    const c = tasks.find((t) => t.id === 'c');
    expect(c.start == null, 'a dateless start must stay null, never become 0').toBeTruthy();
    expect(c.end == null, 'a dateless end must stay null, never become 0').toBeTruthy();
  });
});

/* ==================================================================================================
   2 — real gestures cannot mint a fractional timestamp
   ================================================================================================== */

test.describe('real pointer gestures keep timestamps integral', () => {
  test('a bar move-drag writes integral dates', async ({ page }) => {
    await bootGantt(page);
    const before = await persistedTasks(page);
    const box = await barBox(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 137, box.y + box.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await persistedTasks(page);
    expectIntegral(after, 'a bar move-drag');
    /* the drag must actually have done something, or the invariant is vacuous */
    const a0 = before.find((t) => t.id === 'a'), a1 = after.find((t) => t.id === 'a');
    expect(a1.start, 'the drag should have moved the bar').not.toBe(a0.start);
  });

  test('an edge-drag (resize) writes integral dates', async ({ page }) => {
    await bootGantt(page);
    const box = await barBox(page);
    /* grab the right edge handle rather than the body — a different drag mode, different arithmetic */
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3 + 95, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expectIntegral(await persistedTasks(page), 'an edge-drag resize');
  });

  test('a drag at a FRACTIONAL zoom still writes integral dates', async ({ page }) => {
    /* The highest-suspicion path. `dayW` is a float after a real ctrl+wheel zoom, and every px→ms
       conversion divides by it. `snapDragMs` rounds to whole days, but that is precisely the kind of
       guard that a future refactor drops — which is how the owner's value plausibly appeared. */
    await bootGantt(page);
    const box = await barBox(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -123);   // deliberately not a round number of zoom steps
    await page.mouse.wheel(0, -37);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);

    const zoomed = await barBox(page);
    await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height / 2);
    await page.mouse.down();
    await page.mouse.move(zoomed.x + zoomed.width / 2 + 83, zoomed.y + zoomed.height / 2, { steps: 11 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expectIntegral(await persistedTasks(page), 'a bar drag at a fractional zoom');
  });

  test('a whole session of mixed gestures leaves every task integral', async ({ page }) => {
    /* Breadth over depth: the invariant must survive a realistic sequence, not one isolated gesture. */
    await bootGantt(page);

    const box = await barBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const b2 = await barBox(page);
    await page.mouse.move(b2.x + 3, b2.y + b2.height / 2);          // left edge
    await page.mouse.down();
    await page.mouse.move(b2.x + 3 - 45, b2.y + b2.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+z');                          // undo
    await page.waitForTimeout(200);

    expectIntegral(await persistedTasks(page), 'a mixed drag / resize / undo session');
  });
});

/* ==================================================================================================
   3 — the sync payload itself, built from live app state
   ================================================================================================== */

test.describe('the outbound sync row is always writable', () => {
  test('every persisted task would survive the bigint columns', async ({ page }) => {
    /* The strongest end-to-end statement available without a live backend: take the app's REAL persisted
       state after real interaction and check it against the column types that rejected the owner's row.
       (The per-row quarantine and the 22P02 classification are network behaviour and are covered in the
       unit layer instead; e2e runs anonymous with no Supabase client.) */
    await bootGantt(page);
    const box = await barBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const tasks = await persistedTasks(page);
    expect(tasks.length).toBeGreaterThan(0);

    const unwritable = [];
    tasks.forEach((t) => {
      /* spent/predicted are fractional MINUTES in memory by design and become integer seconds at the
         wire; they are excluded here for the same reason syncRowForWrite converts them separately. */
      INT_MS.concat(['priority', 'pct', 'planned']).forEach((k) => {
        const v = t[k];
        if (typeof v === 'number' && !Number.isInteger(v)) unwritable.push(`${t.id}.${k}=${v}`);
      });
    });
    expect(unwritable, 'these rows would return 22P02 and wedge the queue').toEqual([]);
  });
});
