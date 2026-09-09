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
 *      and pointer capture and is not evidence here (AGENTS.md), so everything below uses page.mouse.
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

const BAR = name => `[title^="${name} ·"]`;

async function bootGantt(page, data) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, data || fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(BAR('Draft the spec')).first().waitFor({ state: 'visible', timeout: 15000 });
}

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
    // The trailing dot's box starts at the bar's right edge and is HIT_MIN_PX wide.
    await page.mouse.move(barA.x + barA.width + 10, barA.y + barA.height / 2);
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

});
