/* DELETED (owner 2026-08-20, Chain A Task 28).
 *
 * This file, and `capacity-shots.spec.js` beside it, covered the capacity readout: "N asked / M free"
 * in the Today header and the mini strip under each Week/4-Day column header. The owner deleted both
 * from the UI, so there is nothing left for these specs to look at. `capacity-shots.spec.js` is removed
 * outright — a screenshot suite for a surface that no longer renders has nothing to capture.
 *
 * What these specs proved, and where it lives now:
 *   · That an over-subscribed day reports the FULL ask rather than a clamped one, and that NOTHING is
 *     trimmed, capped or hidden because of it — the owner over-subscribes deliberately and that is the
 *     mechanism, not a mistake. That is a property of `computeAllotted`, not of the bar, and it is
 *     asserted in tests/v5-capacity.test.js and tests/allotment-rules.test.js.
 *   · That past columns carry no figure, because a past day has no flexible pool by design (block 18).
 *     `dayCapacity` still returns null for a past day and is still tested for it.
 *
 * There is no card-drag-style "if it comes back" clause here: the numbers behind the readout are the
 * scheduling pool itself and are covered on their own terms. Only the rendering is gone.
 */
