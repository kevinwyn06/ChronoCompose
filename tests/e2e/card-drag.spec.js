/* RETIRED (owner 2026-08-20, Chain A Task 8).
 *
 * This file covered the Selection view's card drag across the Included/Excluded divider. That gesture is
 * deleted: the five-bucket partition replaced the vertical dimension, and ticking the checkbox is the
 * gesture now (`tickOnToday` / `untickOnToday`). Its user-facing contract is covered end-to-end by
 * tests/e2e/incl-popover.spec.js, which was rewritten for the new verbs and buckets.
 *
 * The shared drag implementation itself (`cardPointerDown` → `beginCardDrag` → `resolveCardZone` →
 * `onMouseUp`) is still in index.html and is still correct, but it now has NO REACHABLE SURFACE: the
 * Matrix — its only other consumer — was retired from the surface lists by V5 block 32, and Selection
 * was its last live caller. That makes the machinery dead code in practice. Deleting it is deliberately
 * NOT done here, because it is outside this task's scope and the Matrix renderer is kept precisely so
 * re-adding 'matrix' to the two surface lists is the whole job. It is recorded in the backlog instead.
 *
 * What this file used to prove and nothing currently does: that the 4px promotion threshold separates a
 * click from a drag, and that `elementFromPoint` hit-testing resolves the zone under the cursor. If the
 * Matrix is ever un-retired, that coverage has to come back with it — a dispatched MouseEvent cannot
 * stand in for it (synthetic events are not evidence for gestures).
 */
