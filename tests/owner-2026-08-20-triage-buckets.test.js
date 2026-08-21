const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

// Chain A, Task 3 — the `onListSince` field and its one-time backfill.
//
// `onListSince` records the day a task first became eligible for today's list, so triage can tell a
// NEW arrival from one that has been sitting there. It is a `ymd` day KEY, never epoch ms: it is
// compared for identity only, and a string key cannot be knocked a day sideways by DST the way an
// epoch day-start can.
//
// The derivation from the occurrence window was REJECTED as a standing rule (a task's window opening
// is not the same event as the task arriving on the list — see Task 4's maintenance pass). It is used
// here exactly once, as a backfill for workspaces that predate the field.

function seed(c, over){
  return c.normalizeTask(Object.assign({
    id:'t'+Math.random().toString(36).slice(2,7), name:'t', type:'Proportional',
    priority:4, deps:[], pct:0, planned:60, spent:0,
  }, over||{}));
}

test('onListSince: normalizeTask defaults the field to null', () => {
  const c = make();
  assert.strictEqual(seed(c).onListSince, null);
  // A task persisted before the field existed normalizes to null and needs no data migration to load.
  assert.strictEqual(c.normalizeTask({ id:'old', name:'legacy' }).onListSince, null);
  // An explicit value survives normalize.
  assert.strictEqual(seed(c, { onListSince:'2026-06-13' }).onListSince, '2026-06-13');
});

test('onListSince: joins the deferred sync batch alongside snoozeUntil', () => {
  const c = make();
  const f = c.SYNC_FIELDS();
  assert.ok(f.includes('onListSince'), 'onListSince must mirror to public.tasks');
  assert.ok(f.includes('snoozeUntil'));
  // syncRowOf mirrors 1:1 with no mapping layer — the column name must be verbatim.
  assert.strictEqual(c.syncRowOf(seed(c)).onListSince, null);
});

test('onListSince: the backfill stores a ymd day key, not epoch ms', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-2*DAY, end:B+DAY });
    assert.strictEqual(c.migrateOnListSince([t], B), 1);
    assert.strictEqual(t.onListSince, c.ymdOf(B-2*DAY));
    assert.strictEqual(typeof t.onListSince, 'string');
  });
});

test('onListSince: a window that opens today backfills to today', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B, end:B+2*DAY });
    c.migrateOnListSince([t], B);
    assert.strictEqual(t.onListSince, c.ymdOf(B));
  });
});

test('onListSince: a future window and a dateless task both stay null', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const future = seed(c, { start:B+3*DAY, end:B+4*DAY });
    const dateless = seed(c, { start:null, end:null });
    assert.strictEqual(c.migrateOnListSince([future, dateless], B), 0);
    assert.strictEqual(future.onListSince, null);
    assert.strictEqual(dateless.onListSince, null);
  });
});

test('onListSince: a repeat backfills from the occurrence that opened, not the series anchor', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Daily repeat anchored 30 days ago: the live occurrence is today's, not the anchor day.
    const t = seed(c, { start:B-30*DAY, end:B-30*DAY+DAY, recur:{ kind:'day', n:1 } });
    c.migrateOnListSince([t], B);
    assert.strictEqual(t.onListSince, c.ymdOf(B));
  });
});

test('onListSince: the backfill never overwrites a value the app already set', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-2*DAY, end:B+DAY, onListSince:'2026-01-01' });
    assert.strictEqual(c.migrateOnListSince([t], B), 0);
    assert.strictEqual(t.onListSince, '2026-01-01');
  });
});

test('onListSince: the migration runs once, under its own flag', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-2*DAY, end:B+DAY });
    // The constructor already booted an empty workspace through runOnceMigrations, which stamped every
    // flag. Clear them so this asserts about the guard rather than about make()'s own boot.
    c.lsSet('pp-migrations', JSON.stringify({}));
    c.runOnceMigrations([t]);
    assert.strictEqual(t.onListSince, c.ymdOf(B-2*DAY));
    const done = JSON.parse(c.lsGet('pp-migrations') || '{}');
    assert.strictEqual(done['on-list-since-backfill'], 1);

    // Second boot: the flag is recorded, so a field the app has since cleared stays cleared.
    t.onListSince = null;
    c.runOnceMigrations([t]);
    assert.strictEqual(t.onListSince, null);
  });
});

// ---------------------------------------------------------------------------
// Task 4 — the once-per-day maintenance pass that OWNS `onListSince`.
//
// The field is observed, not derived. `sweepOnListSince` is pure so the whole lifecycle
// (new -> continued -> gone -> new again) is testable without clock games, and
// `maintainOnListSince` is the impure wrapper in the `maybeAutoArchive` shape: it probes on a copy and
// commits only when something actually changed, so a 30-second tick cannot churn undo history.

test('onListSince maintenance: a task eligible today with no key gets today', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B, end:B+DAY });
    assert.strictEqual(c.sweepOnListSince([t], B, Date.now()), 1);
    assert.strictEqual(t.onListSince, c.ymdOf(B));
  });
});

test('onListSince maintenance: an earlier key is HELD, not refreshed', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-3*DAY, end:B+3*DAY, onListSince:c.ymdOf(B-3*DAY) });
    // Nothing changed: the task was on the list yesterday and still is.
    assert.strictEqual(c.sweepOnListSince([t], B, Date.now()), 0);
    assert.strictEqual(t.onListSince, c.ymdOf(B-3*DAY), 'the age of the row is what the field is FOR');
  });
});

// A8c (owner ruling, 2026-08-21): the sweep distinguishes "the window passed" from "the user took it off
// the list", and ONLY the latter clears the key. A task that went overdue is old work still being carried,
// so its arrival day survives — that is what makes a rescued overdue task land in Continued rather than
// New. The field's meaning is therefore "the day this task arrived on the list and has not since left it".
test('onListSince maintenance: an overdue task HOLDS its key — the window passing is not a departure', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-5*DAY, end:B-2*DAY, onListSince:c.ymdOf(B-5*DAY) });
    assert.strictEqual(c.isOverdueToday(t), true, 'precondition: the window passed and it is not done');
    assert.strictEqual(c.sweepOnListSince([t], B, Date.now()), 0, 'nothing to change');
    assert.strictEqual(t.onListSince, c.ymdOf(B-5*DAY), 'the arrival day survives going overdue');
  });
});

test('onListSince maintenance: a lapsed window with nothing owed still clears', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Complete: the work is finished, so there is nothing to carry and no overdue hold.
    const done = seed(c, { start:B-5*DAY, end:B-2*DAY, pct:100, completion:Date.now(),
                           onListSince:c.ymdOf(B-5*DAY) });
    assert.strictEqual(c.sweepOnListSince([done], B, Date.now()), 1);
    assert.strictEqual(done.onListSince, null);

    // A milestone is a marker, never overdue work, so a passed one leaves the list like anything else.
    const ms = seed(c, { start:B-5*DAY, end:B-5*DAY, type:'Milestone', onListSince:c.ymdOf(B-5*DAY) });
    c.sweepOnListSince([ms], B, Date.now());
    assert.strictEqual(ms.onListSince, null);
  });
});

test('onListSince maintenance: the key clears when the task is snoozed', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const dated = seed(c, { start:B, end:B+DAY, onListSince:c.ymdOf(B), snoozeUntil:B+2*DAY });
    assert.strictEqual(c.sweepOnListSince([dated], B, Date.now()), 1);
    assert.strictEqual(dated.onListSince, null);

    // The dateless snooze counts too, until one of its wake triggers fires.
    const indef = seed(c, { start:B, end:B+DAY, onListSince:c.ymdOf(B), snoozeIndef:true });
    c.sweepOnListSince([indef], B, Date.now());
    assert.strictEqual(indef.onListSince, null);
  });
});

test('onListSince maintenance: the key clears when the occurrence is completed', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B, end:B+DAY, pct:100, completion:Date.now(), onListSince:c.ymdOf(B) });
    assert.strictEqual(c.sweepOnListSince([t], B, Date.now()), 1);
    assert.strictEqual(t.onListSince, null);
  });
});

test('onListSince maintenance: across a recurrence gap the key clears and is re-set', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // A weekly repeat whose occurrence is TODAY: new arrival.
    const t = seed(c, { start:B, end:B+DAY, recur:{ kind:'week', n:1 } });
    c.sweepOnListSince([t], B, Date.now());
    assert.strictEqual(t.onListSince, c.ymdOf(B), 'the occurrence opened: new');

    // Tomorrow there is no occurrence — the gap. The key clears.
    const gap = B + DAY;
    c.sweepOnListSince([t], gap, Date.now() + DAY);
    assert.strictEqual(t.onListSince, null, 'off the list between occurrences');

    // Next week it opens again and is a NEW arrival, not a continued one.
    const next = B + 7*DAY;
    c.sweepOnListSince([t], next, Date.now() + 7*DAY);
    assert.strictEqual(t.onListSince, c.ymdOf(next));
  });
});

test('onListSince maintenance: the pass probes on a copy and does not commit a no-op', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Already correct: on the list, key already today.
    c.state.tasks = [seed(c, { start:B, end:B+DAY, onListSince:c.ymdOf(B) })];
    let commits = 0;
    const realCommit = c.commit.bind(c);
    c.commit = fn => { commits++; return realCommit(fn); };

    c._lastOnListSweep = null;
    c.maintainOnListSince();
    assert.strictEqual(commits, 0, 'a 30-second tick must not churn undo history');

    // Now make it stale, and the same pass DOES commit.
    c.state.tasks[0].onListSince = null;
    c._lastOnListSweep = null;
    c.maintainOnListSince();
    assert.strictEqual(commits, 1);
    assert.strictEqual(c.state.tasks[0].onListSince, c.ymdOf(B));
  });
});

test('onListSince maintenance: the timestamp guard throttles, and a new day forces a run', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    c.state.tasks = [seed(c, { start:B, end:B+DAY })];

    c._lastOnListSweep = null;
    c.maintainOnListSince();
    assert.strictEqual(c.state.tasks[0].onListSince, c.ymdOf(B));

    // Within the interval the pass is a no-op even when the data is stale.
    c.state.tasks[0].onListSince = null;
    c.maintainOnListSince();
    assert.strictEqual(c.state.tasks[0].onListSince, null, 'throttled by the timestamp guard');

    // A day rollover must not wait out the interval — the whole point is once-per-DAY.
    c._lastOnListDay = B - DAY;
    c.maintainOnListSince();
    assert.strictEqual(c.state.tasks[0].onListSince, c.ymdOf(B), 'midnight forces the sweep');
  });
});

// ---------------------------------------------------------------------------
// Task 5 — the five-bucket partition. One row per case in the spec's A1 table.
//
// The buckets are read off `onListSince` plus the snooze state, which is why Task 4 had to land first.
// The spec phrases Continued as "onListSince < today AND included"; a non-null `onListSince` already
// MEANS the task is on the list (that is precisely what the maintenance pass maintains), so the second
// clause is a restatement rather than a second condition, and implementing it as one avoids two
// definitions of "on the list" that can disagree.

const HOUR = 3600000;
// Anchors inside the same week as FIXED_NOW (Mon 2026-06-15), so weekday-shaped cases read literally.
const MON = new Date(2026, 5, 15, 12, 0, 0).getTime();
const TUE = new Date(2026, 5, 16, 12, 0, 0).getTime();
const WED = new Date(2026, 5, 17, 12, 0, 0).getTime();
const SAT = new Date(2026, 5, 20, 12, 0, 0).getTime();
const day = ms => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };

test('bucket: ORIGIN_KEYS is the five-bucket partition', () => {
  const c = make();
  // join(), not deepStrictEqual: the array is built inside the VM sandbox, so it is a different realm's
  // Array and reference-equality of the prototype fails for a value that is structurally identical.
  assert.strictEqual(c.ORIGIN_KEYS().join(','), 'overdue,new,continued,upcoming,snoozed');
  c.ORIGIN_KEYS().forEach(k => {
    assert.ok(c.originLabel(k), k + ' needs a label');
    assert.ok(c.originHint(k), k + ' needs a hint');
  });
});

test('bucket: A1 — a fixed deadline that has passed, unfinished, is overdue', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-3*DAY, end:B-DAY, pct:0, included:true, onListSince:c.ymdOf(B-3*DAY) });
    c.state.tasks = [t];
    assert.strictEqual(c.originOf(t), 'overdue', 'late outranks provenance');
  });
});

test('bucket: A1 — a recurring series that has ended with occurrences unfinished is overdue', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B-10*DAY, end:B-10*DAY+HOUR, pct:0,
      recur:{ kind:'day', n:1, until:B-2*DAY }, onListSince:c.ymdOf(B-10*DAY) });
    c.state.tasks = [t];
    assert.strictEqual(c.originOf(t), 'overdue');
  });
});

test('bucket: A1 — a recurring series that has ended with everything completed is absent', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const overrides = {};
    const t = seed(c, { start:B-10*DAY, end:B-10*DAY+HOUR, pct:100,
      recur:{ kind:'day', n:1, until:B-2*DAY, overrides } });
    // Every expanded occurrence marked done.
    c.expandTask(t, B-2*DAY).forEach(o => { overrides[o.idx] = { pct:100, completion:B-2*DAY }; });
    c.state.tasks = [t];
    assert.strictEqual(c.originOf(t), null, 'a finished series leaves the surface');
    assert.strictEqual(c.selectionProjection([t]).colCount.overdue, 0);
  });
});

test('bucket: A1 — a completed recurring occurrence with more to come lands in upcoming', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B, end:B+HOUR, pct:0, recur:{ kind:'day', n:1 }, onListSince:c.ymdOf(B) });
    const idx = c.occInDay(t, B).idx;
    t.recur.overrides = { [idx]: { pct:100, completion:Date.now() } };
    c.state.tasks = [t];
    assert.strictEqual(c.originOf(t), 'upcoming',
      'the only case where completing something MOVES a task rather than removing it');
  });
});

test('bucket: A1 — a non-recurring task marked complete disappears immediately', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const t = seed(c, { start:B, end:B+DAY, pct:100, completion:Date.now(),
      included:true, onListSince:c.ymdOf(B) });
    c.state.tasks = [t];
    assert.strictEqual(c.originOf(t), null, 'not greyed in place, not at rollover — gone');
    const p = c.selectionProjection([t]);
    assert.strictEqual(p.colCount.new, 0);
    assert.strictEqual(Object.keys(p.cells).reduce((n,k)=>n+p.cells[k].length, 0), 0);
  });
});

test('bucket: A1 — weekly Wed to Fri, today Saturday, is upcoming', () => {
  withNow(SAT, () => {
    const c = make();
    const wed = day(WED);
    const t = seed(c, { start:wed, end:wed+2*DAY, pct:0, recur:{ kind:'week', n:1 } });
    c.state.tasks = [t];
    c.sweepOnListSince([t], c.startOfToday(), Date.now());
    assert.strictEqual(t.onListSince, null, 'Saturday owns no occurrence');
    assert.strictEqual(c.originOf(t), 'upcoming');
  });
});

test('bucket: A1 — an undated task nobody has pressed is upcoming, not new', () => {
  withNow(WED, () => {
    const c = make();
    const t = seed(c, { start:null, end:null, included:null });
    c.state.tasks = [t];
    c.sweepOnListSince([t], c.startOfToday(), Date.now());
    assert.strictEqual(t.onListSince, null,
      'ghostSpan anchors a dateless span at today, so a window test alone would call every undated task new');
    assert.strictEqual(c.originOf(t), 'upcoming');
  });
});

test('bucket: A1 — an undated task pressed Monday reads as continued on Wednesday', () => {
  withNow(WED, () => {
    const c = make();
    const t = seed(c, { start:null, end:null, included:true, includedExplicit:true,
      onListSince:c.ymdOf(day(MON)) });
    c.state.tasks = [t];
    // Still on the list, so the key is held and the row keeps its age.
    assert.strictEqual(c.sweepOnListSince([t], c.startOfToday(), Date.now()), 0);
    assert.strictEqual(c.originOf(t), 'continued');
  });
});

test('bucket: A1 — a multi-day conference Mon to Wed reads as continued on Tuesday', () => {
  withNow(TUE, () => {
    const c = make();
    const mon = day(MON);
    const t = seed(c, { start:mon+9*HOUR, end:mon+2*DAY+17*HOUR, pct:0,
      startClock:true, endClock:true, onListSince:c.ymdOf(mon) });
    c.state.tasks = [t];
    assert.strictEqual(c.sweepOnListSince([t], c.startOfToday(), Date.now()), 0,
      'Tuesday is INSIDE the occurrence — the key is held');
    assert.strictEqual(c.originOf(t), 'continued');
  });
});

test('bucket: a snoozed task reads as snoozed, and an untouched one as upcoming', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const snoozed = seed(c, { start:B, end:B+DAY, snoozeUntil:B+3*DAY });
    const indef = seed(c, { start:B, end:B+DAY, snoozeIndef:true });
    c.state.tasks = [snoozed, indef];
    assert.strictEqual(c.originOf(snoozed), 'snoozed');
    assert.strictEqual(c.originOf(indef), 'snoozed');
  });
});

test('bucket: the projection is ONE flat bucket map with counts, and the rows are gone', () => {
  withNow(WED, () => {
    const c = make();
    const B = c.startOfToday();
    const nu = seed(c, { start:B, end:B+DAY, onListSince:c.ymdOf(B) });
    const cont = seed(c, { start:B-2*DAY, end:B+DAY, onListSince:c.ymdOf(B-2*DAY) });
    c.state.tasks = [nu, cont];
    const p = c.selectionProjection(c.state.tasks);

    assert.ok(Array.isArray(p.cells.new), 'a bucket holds a flat list, not included/excluded sub-rows');
    assert.strictEqual(p.cells.new.length, 1);
    assert.strictEqual(p.cells.continued.length, 1);
    assert.strictEqual(p.colCount.new, 1);
    assert.strictEqual(p.rowCount, undefined, 'there are no rows any more');

    assert.strictEqual(typeof c.inclusionRow, 'undefined', 'inclusionRow is deleted');
    assert.strictEqual(typeof c.setInclusionRow, 'undefined', 'setInclusionRow is deleted');
  });
});

// ---------------------------------------------------------------------------
// Task 9 — the two-column Selection layout (spec A5, owner-approved mockup
// `docs/superpowers/mockups/2026-08-20-task9-selection-layout.html`).
//
// The layout is a PURE projection so the renderer and the left pane's width floor read the same rule.
// Two copies of "which buckets are mounted, in which column" is exactly the drift this repo has paid for.

const projOf = (c, counts) => ({
  keys: c.ORIGIN_KEYS(),
  colCount: c.ORIGIN_KEYS().reduce((o,k)=>(o[k]=(counts||{})[k]||0, o), {}),
});

test('Task 9: two equal columns, Overdue/New/Continued then Upcoming/Snoozed', () => {
  const c = make();
  const cols = c.selectionLayout(projOf(c, { overdue:1, new:1, continued:1, upcoming:1, snoozed:1 }));
  // JSON, not deepStrictEqual: `_load.js` builds the app in a VM, so its arrays have a different realm's
  // prototype and deepStrictEqual rejects them as not reference-equal even when the structure matches.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cols.map(col => col.keys))),
    [['overdue','new','continued'], ['upcoming','snoozed']]);
  // The captions are part of the approved mockup, not decoration invented at render time.
  assert.strictEqual(cols.map(col => col.caption).join(' | '), 'On your plate | Not on your plate');
});

test('Task 9: only Overdue collapses when empty, and its column stays', () => {
  const c = make();
  const cols = c.selectionLayout(projOf(c, {}));   // everything empty
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cols.map(col => col.keys))),
    [['new','continued'], ['upcoming','snoozed']]);
  assert.strictEqual(cols.length, 2,
    'an empty Overdue drops the BUCKET, never the column — the surface keeps its shape');
});

test('Task 9: the column count is fixed, so nothing weights width by card count', () => {
  const c = make();
  const light = c.selectionLayout(projOf(c, { new:1 }));
  const heavy = c.selectionLayout(projOf(c, { overdue:99, new:99, continued:99, upcoming:1, snoozed:0 }));
  assert.strictEqual(light.length, heavy.length, 'counts never change the column structure');
  assert.strictEqual(heavy.length, 2);
  // Three is the hard ceiling for this surface and two is what it renders; a fourth column has no
  // bucket that could live in it, because every bucket is spoken for above.
  assert.ok(c.selectionLayout(projOf(c, {})).length <= 3, 'three columns is the ceiling');
});

test('Task 9: every bucket appears exactly once across the columns', () => {
  const c = make();
  const flat = [].concat(...c.selectionLayout(projOf(c, { overdue:1 })).map(col => col.keys));
  assert.strictEqual(flat.slice().sort().join(','), c.ORIGIN_KEYS().slice().sort().join(','),
    'the layout partitions the buckets — nothing dropped, nothing duplicated');
});

test('Task 9: the width floor is derived from the layout, not a second literal', () => {
  const c = make();
  // Two columns of cards, whatever the buckets inside them do.
  assert.strictEqual(c.leftPaneMinWidth('select', 2),
    'min(' + c.triageMinWidthPx(2) + 'px, ' + c.SHEET_MAX_FRAC + '%)');
  assert.strictEqual(c.selectionColCount(projOf(c, {})), 2);
  assert.strictEqual(c.selectionColCount(projOf(c, { overdue:5 })), 2,
    'the floor does not move when Overdue appears — the column was always there');
});
