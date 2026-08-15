/* CRITICAL-PATH PAINT IS OPT-IN, DEFAULT OFF (owner, 2026-08-13b).
 *
 * Owner: "I don't think critical paths are going to be helpful to the average user." The Gantt bar
 * stacked five independent paint channels (architecture/ui-runtime.md § "Gantt bar legend"), which is
 * the same note that produced "way too much visual information to decode intuitively". This makes one
 * of the five opt-in, so a default bar carries four.
 *
 * Why this lives in the e2e layer and not the unit layer: the unit layer
 * (`tests/critical-path-toggle.test.js`) pins the GATE — `cpDisplayOn()`'s two-source truth table. It
 * cannot pin the PAINT, because the mock DOM resolves no CSS custom properties and has no layout, so
 * `var(--danger)` never becomes a colour there. The claim under test here is the one the owner actually
 * made, and it is about pixels: on a real mount, with a real dependency chain that really does have a
 * critical path, NO bar comes up red until the user asks for it.
 *
 * The fixture is deliberately a chain whose critical path is non-empty. A test that seeded tasks with no
 * dependencies would report "no red bars" while proving nothing at all — so `criticalPathExists` below
 * is a PREMISE assertion, checked by turning the setting on first.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* A → B → C finish-to-start, plus a short parallel task with slack. A, B and C are the critical path. */
const TASKS = [
  task('cp-a', 'Foundation', { start: '0d', end: '+2d', deps: [] }),
  task('cp-b', 'Framing', { start: '+2d', end: '+4d', deps: ['cp-a'] }),
  task('cp-c', 'Roofing', { start: '+4d', end: '+6d', deps: ['cp-b'] }),
  task('cp-p', 'Pick paint colours', { start: '0d', end: '+1d', deps: [] }),
];

/* Read what is actually painted. Resolves --danger through a probe element so the comparison is against
   the colour the browser computed, not against the token's source text. */
const MEASURE = `(() => {
  const probe = (v) => {
    const el = document.createElement('div');
    el.style.background = v;
    document.body.appendChild(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  };
  const danger = probe(getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
  /* IMPORTANT: data-gantt-task-id marks the row HOVER STRIPE, which is empty — the bars are
     absolutely-positioned SIBLINGS of the stripes inside the same chart body, not descendants of them.
     An earlier version of this file scanned the stripes' subtrees and found nothing, which would have
     made the default-off assertion pass for entirely the wrong reason. So: take the shared chart body
     and scan every element in it, then name what is red by the bar's own title attribute. */
  const rows = [...document.querySelectorAll('[data-gantt-task-id]')];
  if (!rows.length) return { danger, barCount: 0, reds: [] };
  const body = rows[0].parentElement;
  const isRed = (el) => {
    const cs = getComputedStyle(el);
    return cs.backgroundColor === danger
      || (cs.backgroundImage || '').includes(danger)
      || (cs.borderTopColor === danger);
  };
  const titleOf = (el) => {
    for (let n = el; n && n !== body; n = n.parentElement) if (n.title) return n.title.split(' · ')[0];
    return '(untitled)';
  };
  const reds = [...new Set([...body.querySelectorAll('*')].filter(isRed).map(titleOf))];
  return { danger, barCount: rows.length, reds };
})()`;

async function measure(page, settings) {
  await bootSurface(page, { view: 'gantt' }, { tasks: TASKS, settings });
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(150);
  return page.evaluate(MEASURE);
}

test.describe('critical-path highlighting is a user toggle, default off', () => {
  test('a default mount paints no red bars, and the console stays clean', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    /* No `criticalPath` key seeded at all — this is the shipped default path. */
    const m = await measure(page, {});

    expect(m.danger, '--danger resolves to a real colour (else this test cannot fail)').toBeTruthy();
    expect(m.barCount, 'the fixture actually drew bars').toBeGreaterThan(0);
    expect(m.reds, `no bar is painted --danger by default (got: ${m.reds.join(', ')})`).toEqual([]);
    expect(errors, `clean console on mount: ${errors.join(' | ')}`).toEqual([]);
  });

  test('turning the setting on restores the red critical-path fill', async ({ page }) => {
    const m = await measure(page, { criticalPath: true });

    /* PREMISE: this fixture really does have a critical path. If this ever fails, the default-off test
       above is vacuous and must not be trusted. */
    expect(m.reds.length, 'the A→B→C chain paints red once the user opts in').toBeGreaterThan(0);
    /* The parallel task has slack, so it is NOT on the critical path even with the toggle on — which is
       what distinguishes "the toggle works" from "everything turned red". */
    expect(m.reds, 'the slack task stays off the critical path').not.toContain('Pick paint colours');
  });

  /* The OTHER half of the gate — the Design prop `showCriticalPath` vetoing the user's opt-in — is
     pinned in the unit layer's truth table (`tests/critical-path-toggle.test.js`) rather than here. It
     is not reachable from e2e without rewriting the Design `data-props` JSON between parse and boot,
     and the veto is pure boolean logic in `cpDisplayOn()` with nothing browser-shaped about it. What
     needs a real browser is the PAINT, which is what this file covers. */

  test('the toggle is reachable in Settings › General and flipping it repaints live', async ({ page }) => {
    await bootSurface(page, { view: 'gantt' }, { tasks: TASKS });
    await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });

    const before = await page.evaluate(MEASURE);
    expect(before.reds, 'starts off').toEqual([]);

    /* Open Settings, land on General, and click the row's switch by its label — the same path a user
       takes. If the setting were code-only, this locator would not resolve. */
    await page.locator('button[title="Settings"]').first().click();
    /* Not `exact`: the label span holds the text AND the ⓘ infoNote, so the accessible text is longer. */
    const label = page.getByText('Highlight critical path').first();
    await label.waitFor({ state: 'visible', timeout: 5000 });
    /* The row is <div><span>label ⓘ</span><switch/></div>; the switch is the label's row sibling. */
    await label.locator('xpath=ancestor::div[1]').locator('[role="switch"]').first().click();

    await page.waitForTimeout(200);
    const after = await page.evaluate(MEASURE);
    expect(after.reds.length, 'the Gantt repaints red without a reload').toBeGreaterThan(0);
  });
});
