const { test, expect } = require('@playwright/test');
const { bootToday, bootDays, cleanDaySettings, timelineBlocks, dayColumns, task } = require('./_seed');

/* Block 12 — OVERLAP LAYOUT in the rendered column.
   Owner, 2026-08-06, against a Google Calendar screenshot: *"Side by side if the titles will overlap
   (50/50), offset otherwise (~90/10). Recursively defined for >2 tasks."*

   `tests/overlap.test.js` owns the RULE — clustering, the recursion, the title-band test, tie-breaking.
   None of that is re-derived here. What this file pins is the one thing the pure function cannot know:
   that `renderDayColumn` actually turns those fractions into boxes on screen, at a real column width,
   with the right edges still aligned and nothing widened past the band.

   ── Reading widths ───────────────────────────────────────────────────────────────────────────────
   Every block runs from its own left edge to the band's RIGHT edge, so the full-width block in a
   cluster is the widest and every other width is a fraction of it. Assertions are therefore RATIOS
   against the widest block in the cluster, never absolute pixels — which is what makes the same
   assertions hold in the drawer and in a narrow 4-Day column without a second set of numbers.

   ── Why the fixtures are clock-fixed events ──────────────────────────────────────────────────────
   The packer never lays two flexible chunks over each other, by construction. Overlap only exists
   between things the user placed: clock-fixed events, hand pins, and meals. Fixed events are the
   cheapest of the three to state exactly, so the geometry under test is unambiguous. */

/** Two events over exactly the same span — the 50/50 shape. */
const twinFixture = () => ({
  settings: Object.assign(cleanDaySettings('18:00'), { dayStart: '08:00' }),
  tasks: [
    task('a', 'Standup', { start: '0d+10h', end: '0d+11h', startClock: true, endClock: true, planned: 60 }),
    task('b', 'Review', { start: '0d+10h', end: '0d+11h', startClock: true, endClock: true, planned: 60 }),
  ],
});

/** A short event an hour inside a long one — the owner's screenshot, the ~90/10 shape. */
const insetFixture = () => ({
  settings: Object.assign(cleanDaySettings('18:00'), { dayStart: '08:00' }),
  tasks: [
    task('w', 'Work', { start: '0d+9h', end: '0d+17h', startClock: true, endClock: true, planned: 480 }),
    task('s', 'Sync', { start: '0d+11h', end: '0d+11h30m', startClock: true, endClock: true, planned: 30 }),
  ],
});

/** Three containers, each an hour inside the last — the recursion, on screen. */
const nestedFixture = () => ({
  settings: Object.assign(cleanDaySettings('18:00'), { dayStart: '08:00' }),
  tasks: [
    task('w', 'Work', { start: '0d+9h', end: '0d+17h', startClock: true, endClock: true, planned: 480 }),
    task('m', 'Offsite', { start: '0d+11h', end: '0d+16h', startClock: true, endClock: true, planned: 300 }),
    task('s', 'Sync', { start: '0d+13h', end: '0d+15h', startClock: true, endClock: true, planned: 120 }),
  ],
});

/** Nothing overlaps — the regression guard for every column that existed before block 12. */
const plainFixture = () => ({
  settings: Object.assign(cleanDaySettings('18:00'), { dayStart: '08:00' }),
  tasks: [
    task('a', 'Standup', { start: '0d+10h', end: '0d+11h', startClock: true, endClock: true, planned: 60 }),
    task('b', 'Review', { start: '0d+12h', end: '0d+13h', startClock: true, endClock: true, planned: 60 }),
    task('f', 'Errands', { start: '0d', end: '+2d', planned: 120 }),
  ],
});

const by = (blocks, name) => blocks.find((b) => b.title === name);
const right = (b) => b.x + b.w;

test.describe('Today drawer: overlapping blocks are laid out side by side', () => {
  test('two events over the same span split the band 50/50', async ({ page }) => {
    await bootToday(page, twinFixture());
    const blocks = await timelineBlocks(page);
    const a = by(blocks, 'Standup'), b = by(blocks, 'Review');
    expect(a, 'fixture: both events are drawn').toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.y, 'fixture: they really are at the same time').toBeCloseTo(b.y, 0);

    /* The rule's answer… */
    expect(a.ov, 'the earlier-sorted block keeps the full band').toBe(0);
    expect(b.ov, 'the other steps in 50% of the remaining width').toBeCloseTo(0.5, 6);
    /* …and the boxes that answer produced. */
    expect(b.w / a.w, 'so it is drawn at half the width').toBeCloseTo(0.5, 2);
    expect(right(b), 'both still end at the band’s right edge').toBeCloseTo(right(a), 0);
    expect(b.x, 'and the second starts where the first block’s half ends').toBeGreaterThan(a.x + a.w / 2 - 2);

    /* Both are readable: neither collapsed to nothing, which is the failure mode a fraction-based
       layout has when the band arithmetic is wrong at a real column width. */
    expect(a.w, 'the left half is a real, hittable width').toBeGreaterThan(40);
    expect(b.w).toBeGreaterThan(40);
  });

  test('a short event inside a long one is inset ~90/10, not split in half', async ({ page }) => {
    await bootToday(page, insetFixture());
    const blocks = await timelineBlocks(page);
    const work = by(blocks, 'Work'), sync = by(blocks, 'Sync');
    expect(work && sync, 'fixture: both events are drawn').toBeTruthy();
    /* Precondition: it really is INSIDE, so a pass cannot mean "they never overlapped". */
    expect(sync.y).toBeGreaterThan(work.y);
    expect(sync.y + sync.h).toBeLessThan(work.y + work.h);

    expect(work.ov).toBe(0);
    expect(sync.ov, 'their titles are nowhere near each other, so this is the offset step').toBeCloseTo(0.1, 6);
    expect(sync.w / work.w, 'the inset event takes 90% and Work keeps a 10% sliver').toBeCloseTo(0.9, 2);
    expect(right(sync)).toBeCloseTo(right(work), 0);
    expect(sync.x, 'the sliver of Work on the left is real, not sub-pixel')
      .toBeGreaterThan(work.x + work.w * 0.05);
  });

  test('three nested events step against the remaining width, on screen', async ({ page }) => {
    await bootToday(page, nestedFixture());
    const blocks = await timelineBlocks(page);
    const work = by(blocks, 'Work'), off = by(blocks, 'Offsite'), sync = by(blocks, 'Sync');
    expect(work && off && sync, 'fixture: all three are drawn').toBeTruthy();

    expect([work.ov, off.ov].concat([sync.ov]).map((n) => Number(n.toFixed(4))))
      .toEqual([0, 0.1, 0.19]);
    /* 0.9 and 0.81 of the band — the third is NOT 0.8, which is what a "step 10% of the whole width"
       misreading would produce. That difference is the whole content of "recursively defined". */
    expect(off.w / work.w).toBeCloseTo(0.9, 2);
    expect(sync.w / work.w).toBeCloseTo(0.81, 2);
    expect(right(off)).toBeCloseTo(right(work), 0);
    expect(right(sync)).toBeCloseTo(right(work), 0);
    /* Each one leaves a visible sliver of the one behind it. */
    expect(off.x).toBeGreaterThan(work.x + 2);
    expect(sync.x).toBeGreaterThan(off.x + 2);
  });

  test('a day with no overlap is drawn exactly as it was before — every block full width', async ({ page }) => {
    /* The guard that matters most: this rule must fire on overlap and on nothing else, or every
       ordinary packed day changes shape. */
    await bootToday(page, plainFixture());
    const blocks = await timelineBlocks(page);
    expect(blocks.length, 'fixture: a day with several blocks').toBeGreaterThan(2);
    expect(blocks.every((b) => b.ov === 0), 'no block was stepped').toBe(true);
    const w0 = blocks[0].w;
    blocks.forEach((b) => expect(b.w, `${b.title} is full width`).toBeCloseTo(w0, 0));
  });
});

test.describe('4-Day grid: the same rule in a narrow column', () => {
  test('overlap is laid out inside the column and never escapes it', async ({ page }) => {
    /* The queue asked how this reads where the column is already narrow. It is reported in the
       handoff; what is ASSERTED here is the part that is not a taste call — the layout stays inside
       its own column, so an overlapped block can never be drawn over the neighbouring day. */
    await bootDays(page, 'day4', insetFixture());
    const cols = await dayColumns(page);
    const today = cols[0];
    const blocks = (await timelineBlocks(page)).filter((b) => b.day === today.day);
    const work = by(blocks, 'Work'), sync = by(blocks, 'Sync');
    expect(work && sync, 'fixture: both events are drawn in today’s column').toBeTruthy();

    expect(sync.ov, 'the same rule, the same answer').toBeCloseTo(0.1, 6);
    expect(sync.w / work.w).toBeCloseTo(0.9, 2);
    expect(work.x, 'the wide block starts inside the column').toBeGreaterThanOrEqual(today.x - 1);
    expect(right(sync), 'and the stepped block still ends inside it')
      .toBeLessThanOrEqual(today.x + today.w + 1);
    /* The honest narrow-column number: at 10% of an already narrow band the sliver of the block
       underneath is only a few px. It is still non-zero — a zero-width sliver would mean the rule
       silently stops working here. */
    expect(sync.x - work.x, 'the sliver survives the narrow column').toBeGreaterThan(1);
  });
});
