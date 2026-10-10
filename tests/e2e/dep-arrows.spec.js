/* Owner reports 2026-09-09 — the dependency-arrow gestures, at the only layer that can prove them.
 *
 *   "No circle in front of a task to drag dependency arrows to."
 *   "Dependency arrows overlap."
 *
 * The routing arithmetic is pure and lives in tests/dep-arrows.test.js, where it belongs. Two things
 * cannot be proved there:
 *
 *   1. The leading dot is HIT-TESTABLE and the drag off it actually lands. It is hover-gated and sits
 *      outside the bar's left edge, next to a resize grip — the exact geometry that made the trailing
 *      dot unstartable in V1.5, found only by a real pointer. A dispatched MouseEvent skips hit-testing
 *      and pointer capture and is not evidence here, so everything below uses page.mouse.
 *   2. That two arrows drawn on one chart really do get different geometry once the whole render has
 *      run — the lane assignment is a fact about the collected set, not about either edge alone.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  tasks: [
    task('a', 'Draft the spec', { start: '+0d', end: '+1d', priority: 1, planned: 120 }),
    task('b', 'Build the thing', { start: '+4d', end: '+5d', priority: 1, planned: 120 }),
    task('c', 'Ship it', { start: '+4d', end: '+5d', priority: 1, planned: 120 }),
  ],
});

const BAR = name => `[data-gantt-tip^="${name} ·"]`;

async function bootGantt(page, data, leadBar) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, data || fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR(leadBar || 'Draft the spec')).first().waitFor({ state: 'visible', timeout: 15000 });
}

/* The arrow's departure point in CLIENT pixels. The `d` attribute is in SVG USER units and the app runs
   the board at `zoom:0.8`, so adding the svg's client x to a raw `M` coordinate compares two different
   spaces (and reads 25% long). `getScreenCTM` is the mapping between them, zoom included. */
const arrowStartClient = page => page.evaluate(() => {
  const p = document.querySelector('path[data-dep-edge]');
  const m = p.getAttribute('d').match(/^M([-\d.]+),([-\d.]+)/);
  const pt = p.ownerSVGElement.createSVGPoint();
  pt.x = Number(m[1]); pt.y = Number(m[2]);
  return pt.matrixTransform(p.getScreenCTM()).x;
});

const depsOf = (page, id) => page.evaluate(tid => {
  const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(x => x.id === tid);
  return ((t && t.deps) || []).map(d => (d && typeof d === 'object' ? d.id : d));
}, id);

test.describe('dependency arrows 2026-09-09', () => {

  test('dragging from the circle in FRONT of a task links what comes before it', async ({ page }) => {
    await bootGantt(page);
    expect(await depsOf(page, 'b')).toEqual([]);

    // Hover B's bar so its leading dot becomes hit-testable, then press ON the dot itself.
    const barB = await page.locator(BAR('Build the thing')).first().boundingBox();
    await page.mouse.move(barB.x + barB.width / 2, barB.y + barB.height / 2);
    const dot = await page.locator('[data-dep-dot-in="b"]').first().boundingBox();
    expect(dot, 'the leading dot is in the DOM once the bar is hovered').toBeTruthy();

    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    // Drop on A's ROW. The whole row is the target; the dot is what says so.
    const barA = await page.locator(BAR('Draft the spec')).first().boundingBox();
    await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2, { steps: 12 });
    await page.mouse.up();

    // "A comes before B" — so the edge is stored on B, never on A.
    await expect.poll(() => depsOf(page, 'b')).toEqual(['a']);
    expect(await depsOf(page, 'a')).toEqual([]);
  });

  test('the trailing circle still links what comes after — the two directions are mirrors', async ({ page }) => {
    await bootGantt(page);
    const barA = await page.locator(BAR('Draft the spec')).first().boundingBox();
    await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2);
    // The trailing dot's box starts past the right grip's outside extension (UI revamp block 7 gave the
    // grip a HIT_MIN_PX target; the dot moved out by the extension's width) — press the dot itself.
    const out = await page.locator('[data-dep-dot-out="a"]').first().boundingBox();
    expect(out, 'the trailing dot is in the DOM once the bar is hovered').toBeTruthy();
    expect(out.x, 'the dot box starts clear of the bar edge').toBeGreaterThan(barA.x + barA.width);
    await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
    await page.mouse.down();
    const barB = await page.locator(BAR('Build the thing')).first().boundingBox();
    await page.mouse.move(barB.x + barB.width / 2, barB.y + barB.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => depsOf(page, 'b')).toEqual(['a']);
  });

  test('two arrows out of one predecessor are drawn apart, not on top of each other', async ({ page }) => {
    await bootGantt(page, {
      tasks: [
        task('a', 'Draft the spec', { start: '+0d', end: '+1d', priority: 1, planned: 120 }),
        task('b', 'Build the thing', { start: '+4d', end: '+5d', priority: 1, planned: 120, deps: ['a'] }),
        task('c', 'Ship it', { start: '+4d', end: '+5d', priority: 1, planned: 120, deps: ['a'] }),
      ],
    });
    const ds = await page.locator('path[data-dep-edge]').evaluateAll(
      ns => ns.map(n => n.getAttribute('d')));
    expect(ds.length).toBe(2);
    expect(new Set(ds).size).toBe(2, 'the two edges have different geometry');

    // And each really does leave the predecessor's side horizontally before turning — the report was
    // that they dropped out of the middle of the block.
    ds.forEach(d => {
      const m = d.match(/^M([-\d.]+),([-\d.]+) H([-\d.]+)/);
      expect(m, 'path starts with a horizontal run: ' + d).toBeTruthy();
      expect(Math.abs(Number(m[3]) - Number(m[1]))).toBeGreaterThanOrEqual(10);
    });
  });

  /* Owner, 2026-09-11: "arrows should be rerendered when dates change."
   *
   * The unit layer pins WHICH occurrence an arrow anchors to (tests/owner-2026-09-11-spotfix.test.js).
   * What only a real pointer can show is the second half: a RECURRING bar previews its drag through
   * `forceUpdate` alone — `state.tasks` and `_occById` are untouched for the whole gesture by design — so
   * "the arrow keeps up with the block" is a claim about what a live drag repaints, and a dispatched
   * MouseEvent would not start that drag at all. */
  test('an arrow out of a repeat leaves the bar the chart actually paints', async ({ page }) => {
    await bootGantt(page, {
      tasks: [
        task('r', 'Standup', { start: '-6d', end: '-5d', allDay: true, priority: 1, planned: 30,
          recur: { kind: 'week', n: 1, label: 'Weekly', until: '+21d', overrides: {}, shifts: [] } }),
        task('b', 'Write it up', { start: '+9d', end: '+10d', priority: 1, planned: 120, deps: ['r'] }),
      ],
    }, 'Standup');
    await page.locator('path[data-dep-edge]').first().waitFor();
    const bar = await page.locator('[data-gantt-bar-id="r"]').first().boundingBox();
    // The bars loop hides a repeat's PAST occurrences, so the anchor must be the first PAINTED one —
    // which is what `.first()` returns, the anchored occurrence having already been dropped.
    expect(await arrowStartClient(page)).toBeCloseTo(bar.x + bar.width, 0);
  });

  test('dragging a recurring bar drags its arrow with it', async ({ page }) => {
    await bootGantt(page, {
      tasks: [
        /* Two days wide on purpose: inside a one-column bar `[data-gantt-bar-body]` is narrower than the
           two 7px edge grips beside it, so the press lands on the START grip and the gesture under test
           is quietly not the one being run. */
        task('r', 'Standup', { start: '+1d', end: '+3d', allDay: true, priority: 1, planned: 30,
          recur: { kind: 'week', n: 1, label: 'Weekly', until: '+21d', overrides: {}, shifts: [] } }),
        task('b', 'Write it up', { start: '+9d', end: '+10d', priority: 1, planned: 120, deps: ['r'] }),
      ],
    }, 'Standup');
    await page.locator('path[data-dep-edge]').first().waitFor();
    const before = await arrowStartClient(page);
    const bar = page.locator('[data-gantt-bar-id="r"]').first();
    const box = await bar.boundingBox();
    const columns = Number(await bar.getAttribute('data-gantt-columns'));
    const day = box.width / columns;

    const target = await bar.locator(':scope > [data-gantt-bar-body]').first().boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2 + day, target.y + target.height / 2, { steps: 12 });
    const during = await arrowStartClient(page);
    const moved = await bar.boundingBox();
    expect(moved.x - box.x, 'the block previews').toBeCloseTo(day, 0);
    expect(during - before, 'and the arrow departs from where the block now is, not where it was')
      .toBeCloseTo(day, 0);
    expect(during).toBeCloseTo(moved.x + moved.width, 0);
    await page.mouse.up();
    await page.keyboard.press('Escape');
  });

});
