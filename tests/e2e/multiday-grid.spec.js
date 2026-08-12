/* V4.1 — the multi-day time grid (4-Day and Week).
 *
 * `render4DayView` / `renderWeekView` both go through `renderMultiDayView` → `renderDayColumn`, the same
 * render path the Today view uses, but with `showLabels:false` and a DIFFERENT day per column. 04v's
 * twelve timeline specs cover the Today column only and named this the largest hole in the net: a block
 * drawn into — or dropped onto — the wrong day's column would pass every one of them silently.
 *
 * What is pinned here:
 *   · the grid renders the right days, in order, with today marked exactly once;
 *   · a block belonging to a given day is rendered inside THAT day's column and no neighbour's, checked
 *     two independent ways (DOM containment, and the block's own `data-tl-day`) so a hook that lies
 *     about itself cannot make the pair agree;
 *   · locked (clock-fixed / hand-pinned) and auto-scheduled blocks are drawn as visibly different
 *     surfaces, not merely tagged with different attributes — V4.1's whole point;
 *   · a real `page.mouse` drag inside a FUTURE column pins for that column's day, not for today.
 *
 * Blocks are addressed by `data-tl-block` (added by V4.1). Do not go back to matching tooltip strings.
 *
 * Fixture note — `included`. `isActiveOn(t, today)` short-circuits on `t.included===true`, so an
 * INCLUDED task is drawn on today's column whatever its date window says. A task that is meant to prove
 * "this day and no other" therefore has to be `included:false`, which leaves the window alone to decide
 * every day including today. That is existing behaviour, observed here, not changed by this block.
 */
const { test, expect } = require('@playwright/test');
const {
  bootDays, task, cleanDaySettings, timelineBlocks, settleTimeline,
  dayColumns, blocksInColumn,
} = require('./_seed');

const DAY = 86400000;

/** Midnight today, in the browser's zone — the columns are keyed by this. */
async function midnight(page) {
  return page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });
}

/**
 * One 00:00–10:00 window on every day, no meals, no free-time reserve, so a column's contents are a
 * function of the fixture alone. `packFromNow:false` keeps TODAY's column wall-clock-independent for the
 * same reason 04v needed it; the future columns never packed from now anyway.
 *
 *   · `Every day`     — flexible, included, spans the whole grid → the control: it must be in EVERY column.
 *   · `Standup`       — a 02:00–03:00 clock appointment on +1d only → the locked block.
 *   · `Day two only`  — flexible, confined to +2d → the one-column-only case.
 */
function gridFixture() {
  return {
    settings: cleanDaySettings('10:00'),
    tasks: [
      task('md-span', 'Every day', { start: '0d', end: '+3d', planned: 120, priority: 2 }),
      task('md-appt', 'Standup', { start: '+1d+2h', end: '+1d+3h', priority: 1, included: false }),
      task('md-d2', 'Day two only', { start: '+2d', end: '+2d', planned: 60, priority: 1, included: false }),
    ],
  };
}

const has = (blocks, name) => blocks.some((b) => b.title.includes(name));

test.describe('4-Day grid: which days it draws', () => {
  test('renders exactly four consecutive columns starting today', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const cols = await dayColumns(page);
    expect(cols, 'four day columns').toHaveLength(4);

    const B = await midnight(page);
    expect(cols.map((c) => c.day), 'today, then the next three days, left to right')
      .toEqual([B, B + DAY, B + 2 * DAY, B + 3 * DAY]);

    /* Today is marked, once. A grid that accents every column — or none — is exactly the "identical
       bland columns" the V4 milestone rules out. */
    expect(cols.filter((c) => c.isToday), 'exactly one column is today').toHaveLength(1);
    expect(cols[0].isToday, 'and it is the leftmost one').toBe(true);
  });

  test('the columns tile the grid left to right without overlapping', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const cols = await dayColumns(page);
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i].x, `column ${i} starts at or after column ${i - 1} ends`)
        .toBeGreaterThanOrEqual(cols[i - 1].x + cols[i - 1].w - 2);
    }
    cols.forEach((c, i) => expect(c.w, `column ${i} has real width`).toBeGreaterThan(20));
  });
});

test.describe('Week grid: which days it draws', () => {
  test('renders seven consecutive columns, Sunday-first, containing today', async ({ page }) => {
    await bootDays(page, 'week', gridFixture());
    const cols = await dayColumns(page);
    expect(cols, 'seven day columns').toHaveLength(7);

    const dows = await page.evaluate((ds) => ds.map((d) => new Date(d).getDay()), cols.map((c) => c.day));
    expect(dows, 'Sun → Sat').toEqual([0, 1, 2, 3, 4, 5, 6]);

    for (let i = 1; i < cols.length; i++) {
      expect(cols[i].day - cols[i - 1].day, 'consecutive days').toBe(DAY);
    }

    const B = await midnight(page);
    expect(cols.map((c) => c.day), 'the anchored week is the one containing today').toContain(B);
    expect(cols.filter((c) => c.isToday), 'exactly one column is today').toHaveLength(1);
    expect(cols.find((c) => c.isToday).day, 'and it is the one whose key is today').toBe(B);
  });
});

test.describe('multi-day grid: a block lands in its own day\'s column', () => {
  test('a task confined to one day is drawn in that column and in no neighbour', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const B = await midnight(page);

    /* Read through the DOM: what is actually NESTED inside each column element. */
    const perCol = [];
    for (let i = 0; i < 4; i++) perCol.push(await blocksInColumn(page, B + i * DAY));

    expect(has(perCol[2], 'Day two only'), 'the +2d task is in the +2d column').toBe(true);
    [0, 1, 3].forEach((i) => {
      expect(has(perCol[i], 'Day two only'), `and NOT in the +${i}d column`).toBe(false);
    });

    /* The appointment is the second one-day case, and the one that carries a clock: it must sit on its
       own day only, and be LOCKED there. */
    expect(has(perCol[1], 'Standup'), 'the +1d appointment is in the +1d column').toBe(true);
    [0, 2, 3].forEach((i) => {
      expect(has(perCol[i], 'Standup'), `and NOT in the +${i}d column`).toBe(false);
    });

    /* The spanning task is the control: it appears in every column, so a bug that simply drops blocks
       from three of the four columns cannot pass the assertions above. */
    perCol.forEach((blocks, i) => {
      expect(has(blocks, 'Every day'), `the spanning task is in the +${i}d column`).toBe(true);
    });
  });

  test('every block\'s own day hook agrees with the column it is nested in', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const B = await midnight(page);

    let seen = 0;
    for (let i = 0; i < 4; i++) {
      const day = B + i * DAY;
      const blocks = await blocksInColumn(page, day);
      expect(blocks.length, `column +${i}d drew something`).toBeGreaterThan(0);
      blocks.forEach((b) => expect(b.day, `a block in the +${i}d column claims that day`).toBe(day));
      seen += blocks.length;
    }
    /* Nothing was drawn outside a day column — no orphan blocks, and no column counted twice. */
    const all = await timelineBlocks(page);
    expect(seen, 'every block on the grid lives inside exactly one day column').toBe(all.length);
  });

  test('the appointment splits its own day\'s flexible work and leaves the other days whole', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const B = await midnight(page);

    const chunks = async (i) => (await blocksInColumn(page, B + i * DAY)).filter((b) => b.title.includes('Every day'));
    expect((await chunks(1)).length, '+1d\'s flexible work is drawn around the 02:00–03:00 appointment')
      .toBeGreaterThan(1);
    expect((await chunks(3)).length, 'while a clear day draws it in one piece').toBe(1);
  });
});

test.describe('multi-day grid: locked vs auto-scheduled', () => {
  test('a locked block and an auto-scheduled block are drawn as different surfaces', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const all = await timelineBlocks(page);

    const appt = all.filter((b) => b.title.includes('Standup'));
    expect(appt, 'the appointment renders once, on its own day').toHaveLength(1);
    expect(appt[0].kind, 'and it is drawn as locked').toBe('fixed');

    const auto = all.filter((b) => b.title.includes('Every day'));
    expect(auto.length, 'the flexible task is drawn across the grid').toBeGreaterThan(0);
    auto.forEach((b) => expect(b.kind, 'and every one of its blocks is auto-scheduled').toBe('auto'));

    /* The distinction has to be legible, not merely encoded in an attribute. Two independent channels
       are asserted separately so that dropping either one fails here rather than quietly halving the
       signal.

       V5 block 25a REPLACED the first channel. It used to be "auto blocks carry a hatch the locked one
       does not" — but the hatch marked the COMMON case (~90% of the week is auto-scheduled) and so said
       nothing, and the owner deleted it. The signal is now inverted onto the rare case: the LOCKED block
       carries a heavier border. Asserted as a strict width inequality plus an explicit "and nothing is
       hatched any more", so neither the old texture creeping back nor the new border being dropped can
       pass here. */
    expect(auto[0].borderW, 'an app-placed block carries the thin border').toBeLessThan(appt[0].borderW);
    /* A ratio, not an absolute px count: the whole app is drawn inside the `zoom:0.8` wrapper, so a
       3px source border measures 2.5px here and a pixel threshold would be asserting the zoom. */
    expect(appt[0].borderW / auto[0].borderW, 'and by a factor the eye can read, not a hairline')
      .toBeGreaterThanOrEqual(2);
    all.forEach((b) => expect(b.bg, `${b.title}: nothing on the grid is hatched any more`)
      .not.toContain('repeating-linear-gradient'));
    expect(appt[0].rail, 'locked blocks carry an inset rail').toContain('inset');
    expect(appt[0].rail, 'in a colour the auto blocks do not use').not.toBe(auto[0].rail);
  });
});

test.describe('multi-day grid: dragging in a future column', () => {
  test('a drag inside tomorrow\'s column pins for TOMORROW, not for today', async ({ page }) => {
    await bootDays(page, 'day4', gridFixture());
    const B = await midnight(page);
    const tomorrow = B + DAY;
    const cols = await dayColumns(page);

    const before = await timelineBlocks(page);
    expect(before.filter((b) => b.kind === 'pinned'), 'precondition: nothing is pinned yet').toHaveLength(0);

    /* Grab the topmost AUTO block in tomorrow's column. It is identified geometrically — the highest
       block whose horizontal centre falls inside that column — because `timelineBlocks` returns the
       whole grid, and `auto` because the appointment in that column is not draggable. */
    const col = cols.find((c) => c.day === tomorrow);
    const inCol = before.filter((b) => b.kind === 'auto' && b.x + b.w / 2 > col.x && b.x + b.w / 2 < col.x + col.w);
    expect(inCol.length, 'tomorrow\'s column has a draggable block').toBeGreaterThan(0);
    const grab = inCol[0];

    /* Trusted pointer input. A dispatched MouseEvent skips hit-testing and pointer capture, which is
       precisely what the 4px promotion threshold and the drop's day resolution depend on. */
    const cx = grab.x + grab.w / 2, cy = grab.y + Math.min(6, grab.h / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 40, { steps: 8 });
    await page.mouse.move(cx, cy + 90, { steps: 8 });
    await page.mouse.up();
    await settleTimeline(page);

    const after = await timelineBlocks(page);
    const pins = after.filter((b) => b.kind === 'pinned');
    /* V5 block 23: this used to read `toHaveLength(1)` on the BLOCKS. That was over-specified and it
       started failing the moment the shell height fix made the columns taller — not because the drop
       stopped working, but because the same pixel offsets now cover fewer minutes and the drop lands
       across the column's appointment. `pinBlockAt` splits a drop around a blocking wall on purpose
       (see index.html's "one drop → one or more records" note), so one PLACEMENT is legitimately
       drawn as more than one block. What this test is actually about is WHICH DAY the pin landed on,
       so it now asserts one pinned TASK and requires EVERY piece of it to be tomorrow's — which is
       strictly stronger than checking a single block was. */
    expect(pins.length, 'the drop created a pin').toBeGreaterThan(0);
    expect([...new Set(pins.map((b) => b.taskId))], 'exactly one task became pinned').toHaveLength(1);
    pins.forEach((p) => {
      expect(p.day, 'every pinned piece belongs to the day whose column was dragged in').toBe(tomorrow);
      expect(p.title, 'it is the block that was grabbed').toContain('Every day');
    });

    /* Corroborate through the DOM as well: the pin is nested in tomorrow's column, not today's. */
    expect(has((await blocksInColumn(page, tomorrow)).filter((b) => b.kind === 'pinned'), 'Every day'),
      'nested in tomorrow\'s column').toBe(true);
    expect((await blocksInColumn(page, B)).some((b) => b.kind === 'pinned'),
      'today\'s column gained no pin').toBe(false);
  });
});
