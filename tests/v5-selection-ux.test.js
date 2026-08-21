/* RETIRED (owner 2026-08-20). This file tested the Selection view's per-column Included/Excluded band
 * sizing — the equal-max-scroll flex arithmetic (`selectionHalfFlex`, `selectionSplitHeights`) and the
 * SEL_* constants it was calibrated on. Chain A Task 8 deleted that mechanism along with its subject:
 * the five-bucket partition replaced the vertical Included/Excluded dimension, so there are no halves
 * left to balance. Each bucket is one flat list that sizes to content inside a scrolling column.
 *
 * The e2e companions went with it: tests/e2e/selection-bands.spec.js and
 * tests/e2e/selection-half-floor.spec.js.
 *
 * The lesson those tests recorded is NOT retired, and it is worth carrying forward to whatever replaces
 * them: a pure function asserted in isolation proves nothing about a surface unless something also
 * asserts that the surface CONSUMES it. `selectionSplitHeights` was green through the entire life of a
 * bug that shipped a 0px band, because the floor it modelled never reached the DOM. The equivalent guard
 * for the new surface is in tests/v2-plan-tab.test.js ("the width floor and the renderer agree on which
 * columns exist"), which pins `selectionCols` against the rendered grid rather than against itself.
 *
 * The file is kept as this note rather than deleted outright so the reasoning is findable from the test
 * names in git history.
 */
