// Shared test loader: pulls the DC component class out of index.html and runs it in a Node sandbox
// with the browser globals it touches mocked. Pure/logic methods can then be called directly.
const fs = require('fs'), path = require('path'), vm = require('vm');
const chrono = require('chrono-node'); // PP-EXT: mirrors the vendored window.chrono in the browser

// ---- injectable wall clock -------------------------------------------------
// A few tests build fixtures relative to "now" and then assert against component methods that read
// the real clock internally (startOfToday/isFixedToday/state.nowTick). Those are correct assertions
// about real behaviour, but they straddle local midnight: run the suite at 00:05 and a fixture
// "20 minutes ago" lands on *yesterday*, so the test fails for a reason that has nothing to do with
// the code under test. Rather than loosen the assertions, we make the clock injectable.
//
// A single Date subclass replaces global.Date for the whole test process. The offset is 0 unless a
// test opts in via withNow(), so by default every test sees the real wall clock exactly as before —
// and because the sandbox below is handed this same binding, freezing the clock reaches the
// component's internal Date.now()/new Date() too, which is the whole point.
const RealDate = global.Date;
let clockOffset = 0;
class TestDate extends RealDate {
  constructor(...a){ if(a.length === 0) super(RealDate.now() + clockOffset); else super(...a); }
  static now(){ return RealDate.now() + clockOffset; }
}
global.Date = TestDate;

// A deterministic instant far from any midnight/DST boundary: Mon 2026-06-15, 12:00 local.
const FIXED_NOW = new RealDate(2026, 5, 15, 12, 0, 0, 0).getTime();

// Run fn with Date.now()/new Date() reporting `ms` (default FIXED_NOW). Synchronous by design: the
// offset is restored in a finally, so a throwing assertion cannot leak a frozen clock into the next
// test. Wall-clock *advance* still happens normally inside the block — only the origin is moved.
function withNow(ms, fn){
  if(typeof ms === 'function'){ fn = ms; ms = FIXED_NOW; }
  const prev = clockOffset;
  clockOffset = ms - RealDate.now();
  try { return fn(); } finally { clockOffset = prev; }
}

function loadComponent(){
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script data-pp-app>([\s\S]*?)<\/script>/);
  if(!m) throw new Error('component script not found in index.html');
  const js = m[1];
  const store = {};
  const localStorage = {
    getItem:k=> (k in store ? store[k] : null),
    setItem:(k,v)=>{ store[k]=String(v); },
    removeItem:k=>{ delete store[k]; },
  };
  const sandbox = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Object, Array, Set, Map, Boolean, RegExp, encodeURIComponent,
    localStorage, chrono,
    document:{ documentElement:{ setAttribute(){} } },
    window:{ matchMedia:undefined, PP_CONFIG:{ googleClientId:'' }, localStorage, chrono },
    // Minimal React shim: enough for logic tests to call render helpers (e.g. renderMoodPicker) and
    // inspect the resulting element tree's shape, without a real React/DOM dependency.
    React: { createElement:(type, props, ...children)=>({ type, props:props||{}, children }) },
    setInterval:()=>0, clearInterval:()=>{},
    setTimeout:()=>0, clearTimeout:()=>{}, // two-way sync queue debounce is a no-op under test
    AppLogic: class {
      constructor(p){ this.props = p||{}; }
      setState(o){ if(typeof o==='function') o=o(this.state); Object.assign(this.state, o); }
      forceUpdate(){}
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(js + '\n;this.__C = Component;', sandbox);
  // PP-EXT: let tests probe the sandbox globals themselves (e.g. that window.chrono is reachable
  // from inside the component context, the way the vendored chrono.min.js provides it in-browser).
  loadComponent.lastSandbox = sandbox;
  return sandbox.__C;
}
function make(){ return new (loadComponent())({ accent:'#3b82f6', showCriticalPath:true }); }

const DAY = 86400000;
// A task whose [start,end] straddles today (so it is "active" for allotment).
// The window is expressed as BARE DATES (local midnight ± a day), which is what this helper always
// meant: a plain flexible task that happens to be in range, not an appointment. It used to use raw
// `Date.now()`, whose incidental wall-clock time reads as a user-typed clock on BOTH edges — and as of
// 2026-08-16 `normalizeTask` derives `uncompressable:true` from exactly that pair, which would have
// turned every fixture in the suite into a reserved, never-compressed row. Callers that do want a
// clocked span pass `start`/`end` (or `startClock`/`endClock`) explicitly through `over`.
function activeTask(c, over){
  const B = c.startOfDay(Date.now());
  return c.normalizeTask(Object.assign({
    id:'x'+Math.random().toString(36).slice(2,7), name:'t', type:'Proportional',
    start:B-DAY, end:B+DAY, priority:4, deps:[], pct:0, planned:120, spent:0, included:true,
  }, over||{}));
}

// Configure a deterministic allotment pool: full day 00:00→endHHMM, no meals, no free-time reserve,
// pack-from-now off, no inter-task breaks. So pool (minutes) = the window length, independent of
// wall-clock time.
// `breakMin:0` is stated explicitly as of 2026-08-16, when the default moved 0 → 3. It is not a new
// exemption — it is this helper's existing contract written down. Every caller reasons "pool = the
// window length" and none of them is a test ABOUT breaks; the break behaviour has its own fixture,
// which sets breakMin itself (tests/scheduling.gen.test.js, "break: breakMin shrinks the pool").
// Left implicit, the new default would silently subtract 3 minutes per packable family from every
// pool in the suite and turn a dozen unrelated assertions into arithmetic about breaks.
function cleanDay(c, endHHMM){
  Object.assign(c.state.settings, { allotMode:'today', packFromNow:false, freeTime:0, breakMin:0,
    dayStart:'00:00', dayEnd:endHHMM,
    lunchStart:'00:00', lunchEnd:'00:00', dinnerStart:'00:00', dinnerEnd:'00:00' });
}

module.exports = { loadComponent, make, activeTask, cleanDay, DAY, withNow, FIXED_NOW };
