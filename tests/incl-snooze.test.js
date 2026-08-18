// Track B — explicit include/exclude/snooze mutators + the reuse-only snooze free-text parser.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

// V2.11 - "Off" is retired (owner: *Off is a dangerous button*). setIncludedOff now UNPRESSES, so the
// task's own triggers can press it back later instead of it being stuck out of today forever. The one
// subtlety: activeTask's window covers yesterday, so V2.2 inheritance would undo a bare unpress on the
// spot - hence the snooze, which is what makes the gesture actually take effect.
test('setIncludedOff: unpresses (never writes false) and snoozes inherited work; one commit', () => {
  const c = make();
  const today = c.startOfToday();
  const t = activeTask(c, { snoozeUntil: Date.now() + DAY });
  c.state.tasks = [t];
  const histLen = c.history.length;
  c.setIncludedOff(t.id);
  assert.strictEqual(c.state.tasks[0].included, null, 'unpressed, not off');
  assert.strictEqual(c.state.tasks[0].snoozeUntil, today + DAY, 'inherited work is snoozed through today');
  assert.strictEqual(c.history.length, histLen + 1, 'exactly one undo entry');
});

test('setIncludedOff on work nothing would inherit leaves the snooze alone', () => {
  const c = make();
  const today = c.startOfToday();
  // V5 block 20 (F19): a window OPENING today is no longer such a case — it now auto-includes, so
  // unpressing it alone would be undone on the spot and the snooze is correct there. The premise
  // survives with a window that has not started yet: nothing would bring this back into TODAY, so a
  // bare unpress is enough and a phantom snooze would be noise.
  const t = activeTask(c, { start: today + 2 * DAY, end: today + 4 * DAY, included: true });
  c.state.tasks = [t];
  c.setIncludedOff(t.id);
  assert.strictEqual(c.state.tasks[0].included, null);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null, 'no phantom snooze when unpressing is enough');
});

test('migrateRetireOff folds any surviving included:false into unpressed', () => {
  const c = make();
  const tasks = [activeTask(c, { id:'a', included:false }), activeTask(c, { id:'b', included:true }),
                 activeTask(c, { id:'c', included:null })];
  assert.strictEqual(c.migrateRetireOff(tasks), 1, 'only the off task is rewritten');
  assert.strictEqual(tasks[0].included, null);
  assert.strictEqual(tasks[1].included, true, 'pressed is untouched');
  assert.strictEqual(tasks[2].included, null);
});

test('setIncludedOn: presses task and clears snoozeUntil', () => {
  const c = make();
  const t = activeTask(c, { included:null, snoozeUntil: Date.now() + DAY });
  c.state.tasks = [t];
  c.setIncludedOn(t.id);
  assert.strictEqual(c.state.tasks[0].included, true);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null);
});

test('setIncludedTrue: force-in, does not touch snoozeUntil', () => {
  const c = make();
  const t = activeTask(c, {});
  c.state.tasks = [t];
  c.setIncludedTrue(t.id);
  assert.strictEqual(c.state.tasks[0].included, true);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null);
});

test('snoozeToday: sets snoozeUntil to start-of-tomorrow, leaves included untouched', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const t = activeTask(c, { included:true });
  c.state.tasks = [t];
  c.snoozeToday(t.id);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, c.startOfToday() + DAY);
  assert.strictEqual(c.state.tasks[0].included, true, 'snooze never touches included');
});

test('parseSnoozeText: sub-day explicit and bare durations floor forward to tomorrow', () => {
  const c = make();
  const now = new Date(2026, 6, 21, 10, 0, 0).getTime(); // Tue 2026-07-21 10:00
  const tomorrow = c.startOfDay(new Date(2026, 6, 22).getTime());
  assert.strictEqual(c.parseSnoozeText('for 3 hours', now), tomorrow, 'an explicit sub-day duration must not snooze to today');
  assert.strictEqual(c.parseSnoozeText('30m', now), tomorrow, 'the new bare duration must not snooze to today');
});

test('parseSnoozeText: falls back to chrono.parse for bare durations and absolute anchors', () => {
  const c = make();
  const now = new Date(2026, 6, 21, 10, 0, 0).getTime(); // Tue 2026-07-21
  const threeDays = c.parseSnoozeText('3 days', now);
  assert.strictEqual(threeDays, c.startOfDay(new Date(2026, 6, 24).getTime()), '"3 days" -> Fri Jul 24');
  const untilMon = c.parseSnoozeText('until Monday', now);
  assert.strictEqual(untilMon, c.startOfDay(new Date(2026, 6, 27).getTime()), '"until Monday" -> Mon Jul 27');
});

test('parseSnoozeText: unparseable text returns null', () => {
  const c = make();
  assert.strictEqual(c.parseSnoozeText('asdf qwerty', Date.now()), null);
});

test('snoozeUntilText: false + no commit on unparseable text; commits on success without touching included', () => {
  const c = make();
  c.state.nowTick = new Date(2026, 6, 21, 10, 0, 0).getTime();
  const t = activeTask(c, { included:true });
  c.state.tasks = [t];
  const histLen = c.history.length;
  assert.strictEqual(c.snoozeUntilText(t.id, 'gibberish'), false);
  assert.strictEqual(c.history.length, histLen, 'no commit on a failed parse');
  assert.strictEqual(c.snoozeUntilText(t.id, '3 days'), true);
  assert.strictEqual(c.history.length, histLen + 1, 'exactly one commit on success');
  assert.strictEqual(c.state.tasks[0].snoozeUntil, c.startOfDay(new Date(2026, 6, 24).getTime()));
  assert.strictEqual(c.state.tasks[0].included, true, 'snooze never touches included');
});

// ---- TICKING A ROW IN IS NOT A DIALOG (owner 2026-08-12) ----
// Owner: "ticking a task from unincluded to included should not bring up a confirmation popup."
// An unpressed row's inclusion popover held exactly ONE action, "Press into today" — a menu with no
// choice in it, i.e. a confirmation dialog attached to a checkbox. The rule now: a click with one
// possible outcome performs it; a click with several still opens the menu (snooze today, snooze
// until…, take out of today), because there the destination is not implied by the glyph.
function inclClick(c, t) {
  const node = c.taskInclControl(t);
  return node && node.props && node.props.onClick;
}
// `openInclPick` anchors the popover off the control's own rect, so the event needs a currentTarget
// that can answer getBoundingClientRect.
const fakeEvt = () => { let stopped = false;
  return { stopPropagation() { stopped = true; }, get stopped() { return stopped; },
    clientX: 10, clientY: 10,
    currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 10, right: 26, bottom: 26,
      width: 16, height: 16, x: 10, y: 10 }) } }; };

test('clicking an UNPRESSED row control includes it directly, opening no popover', () => {
  const c = make();
  const B = c.startOfToday();
  // A window that does NOT straddle yesterday, so inheritance cannot press it back on its own and
  // `unpressed` is genuinely the state under test.
  const t = c.normalizeTask({ id: 'u1', name: 'undecided', type: 'Proportional',
    start: B + 2 * DAY, end: B + 3 * DAY, included: null, priority: 4, deps: [], pct: 0, planned: 60 });
  c.state.tasks = [t];
  assert.strictEqual(c.inclState(t), 'unpressed', 'premise: the row is unpressed');

  const before = c.history.length;
  const e = fakeEvt();
  inclClick(c, t)(e);

  assert.strictEqual(c.state.tasks[0].included, true, 'the tick took effect immediately');
  assert.ok(!c.state.inclPick, 'no popover was opened');
  assert.strictEqual(c.history.length, before + 1, 'exactly one undoable commit, same as the menu path');
  assert.ok(e.stopped, 'the click does not also fall through to the row (which would open details)');
});

test('a PRESSED row control still opens the menu, because there the click has several outcomes', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id: 'p1', start: B, end: B + DAY, included: true, planned: 60 });
  c.state.tasks = [t];
  assert.ok(['pressed', 'active'].includes(c.inclState(t)), 'premise: the row is pressed');

  const before = c.history.length;
  inclClick(c, t)(fakeEvt());
  assert.ok(c.state.inclPick, 'the popover opened');
  assert.strictEqual(c.state.tasks[0].included, true, 'and nothing was mutated by merely opening it');
  assert.strictEqual(c.history.length, before, 'opening a menu is not an undoable step');

  // The menu earns its place: it offers more than one action here.
  const rows = c.inclActionRows(t, () => {});
  assert.ok(rows.length > 1, 'a pressed row has several possible outcomes, so a menu is the right shape');
});

test('the two paths agree: the direct tick and the menu action write the same thing', () => {
  // The contract that actually matters — a shortcut must not become a second, divergent mutator.
  const mkUndecided = (c, id) => c.normalizeTask({ id, name: id, type: 'Proportional',
    start: c.startOfToday() + 2 * DAY, end: c.startOfToday() + 3 * DAY, included: null,
    priority: 4, deps: [], pct: 0, planned: 60 });

  const viaClick = make();
  const a = mkUndecided(viaClick, 'x');
  viaClick.state.tasks = [a];
  inclClick(viaClick, a)(fakeEvt());

  const viaMenu = make();
  const b = mkUndecided(viaMenu, 'x');
  viaMenu.state.tasks = [b];
  viaMenu.setIncludedTrue('x');

  assert.deepStrictEqual(
    { included: viaClick.state.tasks[0].included, snooze: viaClick.state.tasks[0].snoozeUntil },
    { included: viaMenu.state.tasks[0].included, snooze: viaMenu.state.tasks[0].snoozeUntil },
    'the shortcut and the menu action are the same mutation');
});

// ---- THE PRESSED DEPTH IS GONE (owner 2026-08-12) ----
// Owner: "get rid of the pressed-in effect — it's the same thing as the inclusion check, but is super
// annoying to work with." V2.1 made inclusion a depth channel and V2.9 §2 left it as "the only visual
// the inclusion model has". On a real workspace most rows are included, so the inset meant to mark a
// state became the background texture of the sheet. ACTIVE depth deliberately survives: it marks the
// running timer, which is transient, single-row, and not what the checkbox is saying.
const styleOf = n => (n && n.props && n.props.style) || {};

test('an included row draws no pressed inset or tint; the ACTIVE ring survives', () => {
  const c = make();
  const B = c.startOfToday();
  const pressed = c.normalizeTask({ id: 'pr', name: 'pressed', type: 'Proportional',
    start: B, end: B + DAY, included: true, priority: 4, deps: [], pct: 0, planned: 60 });
  const plain = c.normalizeTask({ id: 'pl', name: 'plain', type: 'Proportional',
    start: B + 2 * DAY, end: B + 3 * DAY, included: null, priority: 4, deps: [], pct: 0, planned: 60 });
  c.state.tasks = [pressed, plain];
  c.renderVals();

  const rowOf = t => c.sheetRow(t, 0, c.state.cols || [], 400, c._byId || {});
  const pS = styleOf(rowOf(pressed)), nS = styleOf(rowOf(plain));

  assert.ok(!/inset 0 3px/.test(String(pS.boxShadow || '')), 'no pressed inset shadow');
  // Same row index for both, so striping is identical — any difference would be the retired tint.
  assert.strictEqual(String(pS.background), String(nS.background),
    'an included row and an undecided one share the same background');

  // The state is still legible, just as a glyph rather than as depth.
  const glyph = c.taskInclControl(pressed);
  // The mocked React collects children into an array.
  assert.strictEqual([].concat(glyph.children).join(''), '☑',
    'inclusion reads from the control, which is the point');

  // ACTIVE went the same way on 2026-08-13 — owner: "when a task has its timer running, do not highlight
  // that task, just let the pause/play indicator do the work." Same argument as the pressed inset one
  // release earlier, applied to the one channel that had been exempted from it: the row's own ■/▶ control
  // already says "running", on the same row, and is the thing the user clicks.
  const act = activeTask(c, { id: 'ac', start: B, end: B + DAY, included: true, planned: 60 });
  c.state.tasks = [act]; c.renderVals();
  c.startTimer(act.id);
  assert.equal(c.inclState(c.state.tasks[0]), 'active',
    'the bucket itself is untouched — it still feeds the popover copy and the V2.1 scheduling seam');
  const aS = styleOf(c.sheetRow(c.state.tasks[0], 0, c.state.cols || [], 400, c._byId || {}));
  assert.doesNotMatch(String(aS.boxShadow || ''), /inset 0 0 0 2px/, 'no active ring');
  // The running row is now visually indistinguishable from any other row at the same stripe index.
  const idle = c.normalizeTask({ id: 'id2', name: 'idle', type: 'Proportional',
    start: B, end: B + DAY, included: true, priority: 4, deps: [], pct: 0, planned: 60 });
  c.state.tasks = [c.state.tasks[0], idle]; c.renderVals();
  const iS = styleOf(c.sheetRow(idle, 0, c.state.cols || [], 400, c._byId || {}));
  const aS2 = styleOf(c.sheetRow(c.state.tasks[0], 0, c.state.cols || [], 400, c._byId || {}));
  assert.strictEqual(String(aS2.background), String(iS.background),
    'and no accent wash either — a running row is plain striping');

  // The state is still legible, because the timer control is what carries it.
  assert.equal(c.isRunning(c.state.tasks[0].id), true);
  const btn = c.taskTimerBtn(c.state.tasks[0]);
  assert.strictEqual([].concat(btn.children).join(''), '■',
    'the pause/play indicator does the work, which is the point');
});
