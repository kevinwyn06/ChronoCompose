// Shared test loader: pulls the DC component class out of index.html and runs it in a Node sandbox
// with the browser globals it touches mocked. Pure/logic methods can then be called directly.
const fs = require('fs'), path = require('path'), vm = require('vm');

function loadComponent(){
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/data-dc-script[^>]*>([\s\S]*?)<\/script>/);
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
    localStorage,
    document:{ documentElement:{ setAttribute(){} } },
    window:{ matchMedia:undefined, PP_CONFIG:{ googleClientId:'' }, localStorage },
    // Minimal React shim: enough for logic tests to call render helpers (e.g. renderMoodPicker) and
    // inspect the resulting element tree's shape, without a real React/DOM dependency.
    React: { createElement:(type, props, ...children)=>({ type, props:props||{}, children }) },
    setInterval:()=>0, clearInterval:()=>{},
    setTimeout:()=>0, clearTimeout:()=>{}, // two-way sync queue debounce is a no-op under test
    DCLogic: class {
      constructor(p){ this.props = p||{}; }
      setState(o){ if(typeof o==='function') o=o(this.state); Object.assign(this.state, o); }
      forceUpdate(){}
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(js + '\n;this.__C = Component;', sandbox);
  return sandbox.__C;
}
function make(){ return new (loadComponent())({ accent:'#3b82f6', showCriticalPath:true }); }

const DAY = 86400000;
// A task whose [start,end] straddles today (so it is "active" for allotment).
function activeTask(c, over){
  const B = Date.now();
  return c.normalizeTask(Object.assign({
    id:'x'+Math.random().toString(36).slice(2,7), name:'t', type:'Proportional',
    start:B-DAY, end:B+DAY, priority:4, deps:[], pct:0, planned:120, spent:0,
  }, over||{}));
}

// Configure a deterministic allotment pool: full day 00:00→endHHMM, no meals, no free-time reserve,
// pack-from-now off. So pool (minutes) = the window length, independent of wall-clock time.
function cleanDay(c, endHHMM){
  Object.assign(c.state.settings, { allotMode:'today', packFromNow:false, freeTime:0,
    dayStart:'00:00', dayEnd:endHHMM,
    lunchStart:'00:00', lunchEnd:'00:00', dinnerStart:'00:00', dinnerEnd:'00:00' });
}

module.exports = { loadComponent, make, activeTask, cleanDay, DAY };
