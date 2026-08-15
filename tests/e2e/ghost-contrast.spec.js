/* GHOST-BAR CONTRAST (owner 2026-08-12; extended 2026-08-13).
 *
 * Owner 2026-08-12: "contrast too low for tasks like 'Heritage Day'. It's greyish and just hard on the
 * eyes whether in light or dark mode."
 *
 * "Heritage Day" is a due date with no start — a HALF-ghost. Three things stacked to make it vanish:
 *
 *   - the ghost fill token was one hardcoded rgba(148,163,184,0.16) used unchanged in BOTH themes. A grey
 *     at 16% alpha is faint on #191919 and fainter on #ffffff, which is exactly the "whether in light or
 *     dark" half of the report: a single literal cannot serve two opposite surfaces.
 *   - The fill ramp held task colour for only the first GHOST_FILL_HOLD = 12% of the bar, so ~88% of a
 *     half-ghost was a fade to transparent over the chart background.
 *   - And a not-in-today bar multiplied all of that by a further 0.55 opacity.
 *
 * Owner 2026-08-13 changed the DOUBLE-ghost (neither date set) from flat grey to a symmetric gradient:
 * transparent at the left edge, accent core at the centre, transparent at the right, dotted outline
 * retained. `--ghost-flat` is retired; `--ghost-core` is its per-theme replacement. The same session
 * deleted the not-in-today paint channel from Gantt bars outright, so the third case below — "dimmed
 * once, not compounded into nothing" — is retired rather than relaxed: there is no dimming left to bound.
 *
 * This file measures what is actually PAINTED rather than asserting the constants changed: it composites
 * the resolved token over the chart's own background and computes the WCAG relative-luminance contrast
 * ratio, per theme, AND reads the live bar's computed background-image so the gradient's symmetry is
 * checked on the rendered element, not on the source string.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* WCAG 1.4.11 asks 3:1 for meaningful non-text graphics. A ghost is deliberately recessive — it must
   still read as derived rather than committed — so it is not held to a solid bar's ratio. But
   "recessive" and "invisible" are different things, and this floor is what separates them. */
const MIN_RATIO = 1.6;

const fixture = (theme) => ({
  theme,
  tasks: [
    /* The owner's shape: a due date, no start. */
    task('g-due', 'Heritage Day (Alberta)', { end: '+3d', planned: 0 }),
    /* And the double ghost, which is the one painted with the core token. */
    task('g-none', 'Someday reading', { planned: 60 }),
  ],
});

/* sRGB relative luminance + contrast ratio, per WCAG 2.x. Runs in the page so it reads the tokens the
   browser actually resolved, including the theme cascade. */
const MEASURE = `(() => {
  const parse = (s) => {
    const n = (s.match(/[\\d.]+/g) || []).map(Number);
    return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  const cs = getComputedStyle(document.documentElement);
  const core = cs.getPropertyValue('--ghost-core').trim();
  const dots = cs.getPropertyValue('--ghost-dots').trim();
  const ganttBg = cs.getPropertyValue('--gantt-bg').trim();

  /* Resolve each token to real rgb through a probe element, so hex, rgb() and rgba() all normalise. */
  const probeOf = (v) => {
    const el = document.createElement('div');
    el.style.background = v;
    document.body.appendChild(el);
    const out = parse(getComputedStyle(el).backgroundColor);
    el.remove();
    return out;
  };
  const bg = probeOf(ganttBg), fg = probeOf(core), dg = probeOf(dots);

  /* The LIVE double-ghost bar. Its title is the only stable hook on the bar body itself. */
  const barEl = document.querySelector('[title*="no dates set"]');
  const barBg = barEl ? getComputedStyle(barEl).backgroundImage : '';
  const barShadow = barEl ? getComputedStyle(barEl).boxShadow : '';
  /* The dotted outline overlay is the bar's first child that carries a dotted border. */
  const dotEl = barEl ? [...barEl.children].find(
    (c) => (getComputedStyle(c).borderTopStyle === 'dotted')) : null;
  const dotMask = dotEl ? (getComputedStyle(dotEl).maskImage || getComputedStyle(dotEl).webkitMaskImage) : null;

  /* Sample the painted gradient itself: rasterise the bar's background-image into a canvas the bar's own
     width and read the alpha at the left edge, the centre, and the right edge. This is the actual claim —
     "fades in from transparent at the left, accent at the centre, fades out to transparent at the right" —
     measured rather than inferred from a string. */
  let ramp = null;
  if (barEl && /linear-gradient/.test(barBg)) {
    const w = Math.max(40, Math.round(barEl.getBoundingClientRect().width));
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;height:10px;width:' + w + 'px;';
    probe.style.backgroundImage = barBg;
    document.body.appendChild(probe);
    /* Chromium resolves background-image to a computed gradient with concrete colour stops; parse the
       stop list and evaluate alpha at 0% / 50% / 100% by linear interpolation. */
    const stops = (barBg.match(/rgba?\\([^)]*\\)\\s*[\\d.]+%/g) || []).map((s) => {
      const pos = parseFloat(s.match(/([\\d.]+)%$/)[1]);
      return { pos, c: parse(s) };
    });
    probe.remove();
    const alphaAt = (p) => {
      if (!stops.length) return null;
      if (p <= stops[0].pos) return stops[0].c.a;
      if (p >= stops[stops.length - 1].pos) return stops[stops.length - 1].c.a;
      for (let i = 1; i < stops.length; i++) {
        if (p <= stops[i].pos) {
          const a = stops[i - 1], b = stops[i];
          const f = b.pos === a.pos ? 0 : (p - a.pos) / (b.pos - a.pos);
          return a.c.a + (b.c.a - a.c.a) * f;
        }
      }
      return null;
    };
    ramp = { left: alphaAt(0), mid: alphaAt(50), right: alphaAt(100), stops: stops.length };
  }

  return {
    core, dots, ganttBg,
    coreAlpha: fg.a,
    coreRatio: ratio(over(fg, bg), bg),
    dotsRatio: ratio(over(dg, bg), bg),
    barBg, barShadow, dotMask, ramp,
    /* Regression guards for the two channels deleted on 2026-08-13. */
    goldHatchCount: [...document.querySelectorAll('*')].filter((el) => {
      const b = el.style && el.style.background;
      return b && b.indexOf('repeating-linear-gradient(45deg') > -1;
    }).length,
  };
})()`;

async function boot(page, theme) {
  await bootSurface(page, { view: 'gantt' }, fixture(theme));
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(150);
}

test.describe('ghost bars are legible in both themes', () => {
  for (const theme of ['dark', 'light']) {
    test(`${theme}: the ghost fill and its dotted outline clear the contrast floor`, async ({ page }) => {
      await boot(page, theme);
      const m = await page.evaluate(MEASURE);

      /* Premise: the tokens exist at all. A mistyped custom property resolves to "" and would otherwise
         sail through this test as a fully transparent background. */
      expect(m.core, `${theme}: --ghost-core is defined`).toBeTruthy();
      expect(m.dots, `${theme}: --ghost-dots is defined`).toBeTruthy();
      expect(m.coreAlpha, `${theme}: the fill is translucent, not accidentally opaque`).toBeLessThan(1);

      expect(m.coreRatio,
        `${theme}: double-ghost core vs chart bg (${m.core} over ${m.ganttBg}) = ${m.coreRatio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(MIN_RATIO);
      expect(m.dotsRatio,
        `${theme}: dotted outline vs chart bg = ${m.dotsRatio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(MIN_RATIO);
    });

    test(`${theme}: the double-ghost is painted as a symmetric fade with its dots retained`, async ({ page }) => {
      await boot(page, theme);
      const m = await page.evaluate(MEASURE);

      expect(m.barBg, `${theme}: the double-ghost bar renders a gradient`).toMatch(/linear-gradient/);
      expect(m.ramp, `${theme}: the gradient's stops parsed`).toBeTruthy();
      expect(m.ramp.stops, `${theme}: four stops — transparent, core, core, transparent`)
        .toBeGreaterThanOrEqual(4);

      /* The owner's sentence, measured. */
      expect(m.ramp.left, `${theme}: fully transparent at the left edge`).toBeLessThanOrEqual(0.01);
      expect(m.ramp.right, `${theme}: fully transparent at the right edge`).toBeLessThanOrEqual(0.01);
      expect(m.ramp.mid, `${theme}: opaque core at the centre (alpha ${m.ramp.mid})`)
        .toBeGreaterThan(0.3);
      /* Symmetric: neither end may read as the committed one. That is the whole distinction from a
         half-ghost, whose solid bordered edge IS the real one. */
      expect(Math.abs(m.ramp.left - m.ramp.right),
        `${theme}: the two edges are indistinguishable`).toBeLessThanOrEqual(0.01);

      /* The dotted outline survives the redraw, unmasked (a double-ghost has no ramp to mask against). */
      expect(m.dotMask === null || m.dotMask === 'none' || m.dotMask === '',
        `${theme}: the double-ghost's dots are unmasked, all round (got ${m.dotMask})`).toBeTruthy();
      expect(m.barShadow, `${theme}: still no shadow — a ghost is not a committed bar`).toMatch(/none/);
    });
  }

  test('the two themes do NOT share one ghost value, which is the defect that caused this', async ({ page }) => {
    await boot(page, 'dark');
    const d = await page.evaluate(MEASURE);
    await boot(page, 'light');
    const l = await page.evaluate(MEASURE);

    expect(d.core, 'dark and light resolve different --ghost-core').not.toBe(l.core);
    expect(d.dots, 'dark and light resolve different --ghost-dots').not.toBe(l.dots);
    /* Both must clear the floor independently — a value tuned against one theme only is the bug. */
    expect(Math.min(d.coreRatio, l.coreRatio),
      `worst of the two themes: dark ${d.coreRatio.toFixed(2)}:1, light ${l.coreRatio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(MIN_RATIO);
    /* Print the measured pair so a run is self-documenting. */
    console.log(`[ghost-core contrast] dark ${d.coreRatio.toFixed(2)}:1 (${d.core} over ${d.ganttBg}) · `
      + `light ${l.coreRatio.toFixed(2)}:1 (${l.core} over ${l.ganttBg})`);
    console.log(`[ghost-dots contrast] dark ${d.dotsRatio.toFixed(2)}:1 · light ${l.dotsRatio.toFixed(2)}:1`);
  });

  /* RETIRED 2026-08-13: 'a not-in-today ghost is dimmed once, not compounded into nothing'.
     It bounded BAR_OPTED_OUT_OPACITY from below. The owner deleted the whole not-in-today paint channel
     from Gantt bars — hatch, dimming and glyph — so the constant no longer exists and there is no
     product behaviour left for that assertion to describe. What replaces it is the inverse guard below:
     the channel must stay gone. Its state predicates (`isOptedOut`, `inclState`) are untouched and are
     still covered by tests/ambient.test.js and tests/v5-autoinclude-snooze.test.js. */
  test('the not-in-today paint channel is gone from Gantt bars', async ({ page }) => {
    await boot(page, 'dark');
    const m = await page.evaluate(MEASURE);
    expect(m.goldHatchCount, 'no +45° gold hatch anywhere — it also collided with the −45° repeat strip')
      .toBe(0);

    const dimmed = await page.evaluate(() => [...document.querySelectorAll('div')]
      .filter((d) => d.style.position === 'absolute' && d.style.zIndex === '5' && d.style.opacity)
      .map((d) => parseFloat(d.style.opacity)).filter((n) => n < 1));
    expect(dimmed, 'no Gantt bar wrapper carries a whole-bar mute').toEqual([]);

    const glyphs = await page.evaluate(() => {
      const chart = document.querySelector('[data-gantt-task-id]');
      const root = chart ? chart.closest('div[style*="position"]') || document.body : document.body;
      return (root.textContent.match(/[☐💤]/g) || []).length;
    });
    expect(glyphs, 'no ☐ / 💤 glyphs painted on bars').toBe(0);
  });
});
