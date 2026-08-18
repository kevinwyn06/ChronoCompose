const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

test('Block 46: sheet split clamps at its visible-column edge in rendered coordinates', () => {
  const c = make();
  const boardRendered = 1000;
  const scale = 0.8;
  const expectedMax = c.sheetMinWidthPx() * scale / boardRendered * 100;

  assert.equal(c.clampSplitPct(90, 'agenda', boardRendered, scale), expectedMax);
  assert.equal(c.clampSplitPct(expectedMax - 10, 'agenda', boardRendered, scale), expectedMax - 10,
    'the sheet can be compressed below its content width');
  assert.equal(c.clampSplitPct(1, 'agenda', boardRendered, scale),
    c.SHEET_PANE_MIN_PX * scale / boardRendered * 100,
    'sheet compression uses its responsive pixel floor; the percentage floor belongs to triage');
});

test('Block 46: hiding and resizing columns immediately changes the sheet clamp', () => {
  const c = make();
  const full = c.sheetMinWidthPx();
  c.state.colHidden = { pct: true, exact: true };
  const hidden = c.sheetMinWidthPx();
  assert.ok(hidden < full);

  c.state.colW = { name: 240 };
  assert.equal(c.sheetMinWidthPx(), hidden + 130);

  const narrowContentPct = c.sheetMinWidthPx() / 4000 * 100;
  assert.equal(c.clampSplitPct(50, 'cal', 4000, 1), narrowContentPct,
    'the last-column edge remains the maximum when content is narrow');
  const usableMinPct = c.SHEET_PANE_MIN_PX / 4000 * 100;
  assert.equal(c.clampSplitPct(1, 'cal', 4000, 1), usableMinPct,
    'a wide board uses a responsive pixel floor below the content edge instead of locking min to max');
  assert.equal(c.clampSplitPct((usableMinPct + narrowContentPct) / 2, 'cal', 4000, 1),
    (usableMinPct + narrowContentPct) / 2,
    'every divider position between the usable floor and last-column edge remains reachable');
});

test('Block 46: triage retains its independent percentage clamp', () => {
  const c = make();
  assert.equal(c.clampSplitPct(99, 'triage', 1000, 0.8), c.PANE_MAX_FRAC);
  assert.equal(c.clampSplitPct(1, 'triage', 1000, 0.8), c.PANE_MIN_FRAC);
});
