/* ============================================================
   ARTHENA — Personal Finance Tracker | v5
   - Actuals feed stat cards + dashboard everywhere
   - Targets are editable (inline, click to edit)
   - No + Add buttons on dashboard cards
   - Delete on summary rows and transaction list
   - Year selector rebuilds months correctly
   Jun 2026 → Dec 2035
   ============================================================ */
'use strict';

const START_YEAR  = 2026;
const START_MONTH = 5;
const END_YEAR    = 2035;
const END_MONTH   = 11;
const LS_KEY       = 'arthena_v5';
const SB_URL       = 'https://qcwangaymlurglvamjsq.supabase.co';
const SB_ANON_KEY  = 'sb_publishable_X3X9I8eSuIEyc67AGSC9BQ_1NPaDeSu';
const SB_HEADERS   = { 'Content-Type': 'application/json', 'apikey': SB_ANON_KEY, 'Authorization': `Bearer ${SB_ANON_KEY}` };
const SB_ROW_ID    = 'swarnaraj';
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ── DEFAULT TARGETS (used only when no custom target saved) ─── */
const DEFAULT_TARGETS = {
  salary:126558, other:0,
  home_emi:45000, pers_emi:13271,
  office_ins:2083, recharge:1100, netflix:199,
  grocery:16000, travel:7000, cards:5000, others:5000,
  pli:2000, ppf:1000, lic:788, mfsip:5000,
};

/* ── LIC QUARTERLY PREMIUM ───────────────────────────────────────
   Real-world premium is ₹2,365 every 3 months (paid lump-sum to LIC).
   June 2026 was already paid directly, so the saving cycle starts July
   2026. We auto-split the quarterly amount across 3 months so the
   monthly Target stays small and predictable: 2365 / 3 = 788.33 → 788.
   Quarters are defined starting July (month index 6, 0-based) 2026.
─────────────────────────────────────────────────────────────── */
const LIC_QUARTERLY    = 2365;
const LIC_MONTHLY      = Math.round(LIC_QUARTERLY / 3); // 788
const LIC_CYCLE_START  = { year: 2026, month: 6 }; // July 2026 (0-based: Jan=0)

/* Given a year/month, return which LIC quarter it falls in and the
   1-based month-of-quarter (1, 2, or 3). Months before the cycle start
   (e.g. June 2026, already paid manually) return null. */
function licQuarterInfo(y, m) {
  const startIdx = LIC_CYCLE_START.year * 12 + LIC_CYCLE_START.month;
  const idx      = y * 12 + m;
  if (idx < startIdx) return null;
  const offset   = idx - startIdx;
  const qNum     = Math.floor(offset / 3) + 1;          // 1st, 2nd, 3rd quarter...
  const moInQ    = (offset % 3) + 1;                     // 1, 2, or 3
  // Quarter label = the month the quarter starts in
  const qStartIdx = startIdx + (qNum - 1) * 3;
  const qY = Math.floor(qStartIdx / 12), qM = qStartIdx % 12;
  return { qNum, moInQ, qStartLabel: monthLabel(qY, qM) };
}

/* ── CATEGORY DEFINITIONS (label + type only, target from state) */
const INCOME_CATS = [
  { key:'salary', label:'Salary (In-hand)', type:'income' },
  { key:'other',  label:'Other Income',     type:'income' },
];
const EXPENSE_CATS = [
  { key:'home_emi',   label:'🏠 Home Loan EMI',          type:'expense' },
  { key:'pers_emi',   label:'🏦 Personal Loan EMI',       type:'expense' },
  { key:'office_ins', label:'🏥 Office Health Insurance', type:'expense' },
  { key:'recharge',   label:'📡 Recharge/WiFi/Dish',     type:'expense' },
  { key:'netflix',    label:'🎬 Netflix',                 type:'expense' },
  { key:'grocery',    label:'🛒 Groceries',              type:'expense' },
  { key:'travel',     label:'🚗 Travel & Stay',          type:'expense' },
  { key:'cards',      label:'💳 Cards & Fix',            type:'expense' },
  { key:'others',     label:'🔧 Others (Misc)',          type:'expense' },
];
/* Annual-premium "pools": you set aside monthly + park it in an MF/RD,
   then redeem at year-end to pay the once-a-year premium. Tracked as
   savings/investment, NOT as an expense. Lives on its own "Insurance
   Pools" page now (separate from Investments).

   ANNUAL IS THE SOURCE OF TRUTH (editable in state.poolAnnual). Monthly
   target is always DERIVED as annual ÷ 12 — never edited directly — so
   monthly×12 can never drift away from the real premium again. Each
   pool maps 1:1 to an Insurance Goal (goalKey) so funding a pool each
   month automatically feeds that goal's year-to-date progress. */
const POOL_KEYS   = ['father_ins','mother_ins','term_ins'];
const DEFAULT_POOL_ANNUAL = { father_ins:73993, mother_ins:28923, term_ins:113271 };
const INSPOOL_CATS = [
  { key:'father_ins', label:'❤ Father Insurance Pool',  type:'saving', pool:true, goalKey:'father_ins_goal' },
  { key:'mother_ins', label:'❤ Mother Insurance Pool',  type:'saving', pool:true, goalKey:'mother_ins_goal' },
  { key:'term_ins',   label:'🛡 Term Insurance Pool',    type:'saving', pool:true, goalKey:'term_self_goal'  },
];
/* Investments only — insurance pools moved out to INSPOOL_CATS / their
   own page. LIC is quarterly (see LIC_QUARTERLY above); quarterly:true
   flags it for the special quarter-progress cell. */
const SAVINGS_CATS = [
  { key:'pli',   label:'📋 PLI',             type:'saving' },
  { key:'ppf',   label:'💰 PPF',             type:'saving' },
  { key:'lic',   label:'📜 LIC',             type:'saving', quarterly:true },
  { key:'mfsip', label:'📊 Mutual Fund SIP', type:'saving' },
];
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS, ...SAVINGS_CATS, ...INSPOOL_CATS];
/* Combined "anything that counts as a saving" list — used by the
   dashboard mini-card, the Add Transaction category dropdown, and the
   Monthly Targets panel, so insurance pools still show up there even
   though they now live on their own page. */
const SAVING_LIKE_CATS = [...SAVINGS_CATS, ...INSPOOL_CATS];

const BUCKETS = [
  { key:'emergency',  label:'Emergency Fund',     target:300000, color:'#34d399' },
  { key:'home_maint', label:'Home Maintenance',   target:100000, color:'#4fc3f7' },
  { key:'vacation',   label:'Vacation/Honeymoon', target:50000,  color:'#f5c842' },
  { key:'wedding',    label:'Wedding Buffer',     target:30000,  color:'#a78bfa' },
];
/* No hardcoded `target` here anymore — each goal's target is read live
   from its linked pool's annual amount (state.poolAnnual[poolKey]) via
   poolKey, so editing the pool's annual figure instantly updates the
   goal too. "Saved" is also no longer a manually-typed number — it's
   the pool's year-to-date total (yearTotalForCat), i.e. funding the
   pool each month automatically advances the goal. */
const INS_GOALS = [
  { key:'father_ins_goal', label:'Father Health Insurance', poolKey:'father_ins', color:'#fb923c' },
  { key:'mother_ins_goal', label:'Mother Health Insurance', poolKey:'mother_ins', color:'#f87171' },
  { key:'term_self_goal',  label:'Term Insurance (Self)',   poolKey:'term_ins',   color:'#7c6af7' },
];
const PIE_COLORS  = ['#7c6af7','#f87171','#fb923c','#34d399','#4fc3f7','#f5c842','#a78bfa','#e879f9','#22d3ee','#a3e635'];
const TXN_COLORS  = { income:'#34d399', expense:'#f87171', saving:'#4fc3f7' };
const TXN_LABELS  = { income:'Income',  expense:'Expense',  saving:'Saving' };
const TXN_CLASSES = { income:'type-income', expense:'type-expense', saving:'type-saving' };

/* ── STATE ──────────────────────────────────────────────────────
   targets  — global, editable, persisted (not per-month)
   months["2026-5"] = {
     actuals:  { salary: 126558, ... }   ← what user entered as actual
     checked:  { salary: true, ... }     ← checkbox per category
     transactions: [...]                 ← detailed line items
     buckets:  { emergency: 0, ... }
     ins_goals:{ father_ins_goal: 0, ... }
   }
   SINGLE SOURCE OF TRUTH: actuals drive all stat cards + dashboard.
   transactions are additional detail, not used for totals.
─────────────────────────────────────────────────────────────── */
let state = {
  targets:      { ...DEFAULT_TARGETS },
  poolAnnual:   { ...DEFAULT_POOL_ANNUAL },
  parked:       { mfsip: 'Nifty 50 Index Fund' },
  months:       {},
  currentYear:  2026,
  currentMonth: 5,
  currentPage:  'dashboard',
  theme:        'dark',
  networth:     {},
  nwViewYear:   2026,
  nwViewMonth:  5,
  nwPriorInvest: 0,  // one-time manual entry: total invested before June 2026
  loans:        [
    { id:'pl1', name:'Personal Loan', principal:400000, ratePA:11.64, emi:13271, startYear:2026, startMonth:5, totalEmis:36 }
  ],
  goldEntries:  [], // global ledger: [{ date:'2026-06-01', grams:1, name:'Gold' }, ...]
};

/* ── STORAGE ─────────────────────────────────────────────────── */
/* ── Input validation ───────────────────────────────────── */
function validateAmount(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(/[,\s₹]/g, ''));
  if (isNaN(n)) return null;
  if (n < 0) return null;
  if (n > 1e10) return null; // sanity cap — ₹1000 crore
  return n;
}

/* ── Offline queue ──────────────────────────────────────── */
let _offlineQueue = [];
let _retrying     = false;

async function flushOfflineQueue() {
  if (_retrying || _offlineQueue.length === 0) return;
  _retrying = true;
  while (_offlineQueue.length > 0) {
    const payload = _offlineQueue[0];
    try {
      const r = await fetch(`${SB_URL}/rest/v1/arthena_state`, {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        _offlineQueue.shift();
        setSyncStatus('synced', 'Saved');
      } else {
        break; // stop — still failing
      }
    } catch {
      break; // still offline
    }
  }
  _retrying = false;
}

// Listen for network restore and flush queue
window.addEventListener('online', () => {
  setSyncStatus('syncing', 'Reconnecting...');
  flushOfflineQueue();
});

function saveState() {
  // Stamp the save time for conflict resolution
  state._savedAt = new Date().toISOString();
  const json = JSON.stringify(state);
  localStorage.setItem(LS_KEY, json);
  setSyncStatus('syncing', 'Saving...');

  const payload = { id: SB_ROW_ID, data: state, updated_at: state._savedAt };

  fetch(`${SB_URL}/rest/v1/arthena_state`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(payload)
  }).then(r => {
    if (r.ok) {
      setSyncStatus('synced', 'Saved');
    } else {
      setSyncStatus('error', 'Save failed');
      _offlineQueue.push(payload);
    }
  }).catch(() => {
    setSyncStatus('error', 'Offline — queued');
    _offlineQueue.push(payload);
  });
}

async function syncFromSupabase() {
  setSyncStatus('syncing', 'Syncing...');
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/arthena_state?id=eq.${SB_ROW_ID}&select=data,updated_at`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) { setSyncStatus('error', 'Sync failed'); return false; }
    const rows = await res.json();
    if (!rows || rows.length === 0) { setSyncStatus('synced', 'No data'); return false; }
    const remote = rows[0].data;
    if (!remote) { setSyncStatus('synced', 'Ready'); return false; }

    const localRaw  = localStorage.getItem(LS_KEY);
    const localData = localRaw ? JSON.parse(localRaw) : null;
    const remoteTime = new Date(rows[0].updated_at).getTime();
    const localTime  = localData?._savedAt ? new Date(localData._savedAt).getTime() : 0;

    if (remoteTime >= localTime) {
      applyParsedState(remote);
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      setSyncStatus('synced', 'Synced');
      return true;
    }
    setSyncStatus('synced', 'Up to date');
    return false;
  } catch {
    setSyncStatus('error', 'Offline');
    return false;
  }
}
function applyParsedState(parsed) {
  state.targets       = { ...DEFAULT_TARGETS, ...(parsed.targets || {}) };
  state.poolAnnual    = { ...DEFAULT_POOL_ANNUAL, ...(parsed.poolAnnual || {}) };
  state.parked        = parsed.parked        || {};
  state.months        = parsed.months        || {};
  state.currentYear   = parsed.currentYear   || 2026;
  state.currentMonth  = parsed.currentMonth  || 5;
  state.currentPage   = parsed.currentPage   || 'dashboard';
  state.theme         = parsed.theme         || 'dark';
  state.networth      = parsed.networth      || {};
  state.nwViewYear    = parsed.nwViewYear    || 2026;
  state.nwViewMonth   = parsed.nwViewMonth   || 5;
  state.nwPriorInvest = parsed.nwPriorInvest || 0;
  state.loans         = parsed.loans         || [
    { id:'pl1', name:'Personal Loan', principal:400000, ratePA:11.64, emi:13271, startYear:2026, startMonth:5, totalEmis:36 }
  ];

  // Migrate old per-period gold entries into global goldEntries ledger
  if (parsed.goldEntries && Array.isArray(parsed.goldEntries)) {
    state.goldEntries = parsed.goldEntries;
  } else {
    // First run after migration: collect gold from old networth[k].gold arrays
    state.goldEntries = [];
    Object.keys(state.networth).forEach(k => {
      const d = state.networth[k];
      if (Array.isArray(d.gold) && d.gold.length > 0) {
        d.gold.forEach(g => {
          const [yr, mo] = k.split('-').map(Number);
          // Use 1st of that month as fallback date
          const mm = String(mo + 1).padStart(2, '0');
          const date = `${yr}-${mm}-01`;
          state.goldEntries.push({ date, grams: g.grams || 0, name: g.name || 'Gold', amount: g.amount || 0 });
        });
        d.gold = []; // clear old location
      }
    });
  }

  if (state.targets.lic === 874) state.targets.lic = LIC_MONTHLY;
  if (!state.parked.mfsip) state.parked.mfsip = 'Nifty 50 Index Fund';
  if (!parsed.txnBackfillDone) {
    let backfilled = 0;
    Object.values(state.months).forEach(month => {
      if (!month.transactions) return;
      month.transactions.forEach(t => {
        if (!month.actuals) month.actuals = {};
        month.actuals[t.catKey] = (month.actuals[t.catKey] || 0) + t.amount;
        backfilled++;
      });
    });
    state.txnBackfillDone = true;
    if (backfilled > 0) console.info(`arthena: backfilled ${backfilled} transaction(s) into actuals`);
  } else {
    state.txnBackfillDone = true;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      applyParsedState(parsed);
    }
  } catch(e) { console.warn('arthena: load failed', e); }
}

function ensureMonth(y, m) {
  const k = `${y}-${m}`;
  if (!state.months[k]) state.months[k] = {
    actuals:      {},
    checked:      {},
    transactions: [],
    buckets:      Object.fromEntries(BUCKETS.map(b   => [b.key, 0])),
    ins_goals:    Object.fromEntries(INS_GOALS.map(g => [g.key, 0])),
  };
  // Migrate older saves that lack actuals/checked
  if (!state.months[k].actuals)      state.months[k].actuals      = {};
  if (!state.months[k].checked)      state.months[k].checked      = {};
  if (!state.months[k].transactions) state.months[k].transactions = [];
  return state.months[k];
}

/* ── HELPERS ─────────────────────────────────────────────────── */
function fmtINR(n) {
  const abs = Math.abs(Math.round(n));
  return (n < 0 ? '-₹' : '₹') + abs.toLocaleString('en-IN');
}
function monthLabel(y, m) { return `${MONTH_NAMES[m]}-${y}`; }
/* Pool categories (father_ins/mother_ins/term_ins) are special-cased:
   their monthly "target" is ALWAYS annual ÷ 12, never independently
   stored or edited. Everything else reads state.targets as before. */
function getPoolAnnual(key)  { return state.poolAnnual[key] ?? (DEFAULT_POOL_ANNUAL[key] || 0); }
function getPoolMonthly(key) { return Math.round(getPoolAnnual(key) / 12); }
function getTarget(key) {
  if (POOL_KEYS.includes(key)) return getPoolMonthly(key);
  return state.targets[key] ?? (DEFAULT_TARGETS[key] || 0);
}
function getActual(y, m, key) { return ensureMonth(y,m).actuals[key] || 0; }
function getChecked(y, m, key) { return !!ensureMonth(y,m).checked[key]; }
function getParked(key) { return state.parked[key] || ''; }

/* Year-to-date accumulation for a category across the current year.
   Used for pools so you can see when the pot equals the annual premium. */
function yearTotalForCat(key) {
  const y  = state.currentYear;
  const ms = y === START_YEAR ? START_MONTH : 0;
  const me = y === END_YEAR   ? END_MONTH   : 11;
  let s = 0;
  for (let m = ms; m <= me; m++) s += (state.months[`${y}-${m}`]?.actuals?.[key]) || 0;
  return s;
}

/* ── TOTALS — from actuals (single source of truth) ─────────── */
function computeTotals(y, m) {
  const d = ensureMonth(y, m);
  let income = 0, expense = 0, saving = 0;
  INCOME_CATS.forEach(c  => { income  += d.actuals[c.key] || 0; });
  EXPENSE_CATS.forEach(c => { expense += d.actuals[c.key] || 0; });
  SAVINGS_CATS.forEach(c => { saving  += d.actuals[c.key] || 0; });
  INSPOOL_CATS.forEach(c => { saving  += d.actuals[c.key] || 0; });
  const cash = income - expense - saving;
  const rate = income ? (saving / income) * 100 : 0;
  return { income, expense, saving, cash, rate };
}

function annualTotals(y) {
  let inc = 0, exp = 0, sav = 0;
  const ms = y === START_YEAR ? START_MONTH : 0;
  const me = y === END_YEAR   ? END_MONTH   : 11;
  for (let m = ms; m <= me; m++) {
    const t = computeTotals(y, m);
    inc += t.income; exp += t.expense; sav += t.saving;
  }
  return { income: inc, expense: exp, saving: sav, cash: inc - exp - sav };
}

/* ── SELECTORS ───────────────────────────────────────────────── */
function buildSelectors() {
  const ySel = document.getElementById('yearSel');
  ySel.innerHTML = '';
  for (let y = START_YEAR; y <= END_YEAR; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === state.currentYear) o.selected = true;
    ySel.appendChild(o);
  }
  rebuildMonths(state.currentYear, state.currentMonth);

  document.getElementById('monthSel').addEventListener('change', () => {
    const [y, m] = document.getElementById('monthSel').value.split('-').map(Number);
    state.currentYear = y; state.currentMonth = m;
    document.getElementById('yearSel').value = y;
    saveState(); renderAll();
  });
  ySel.addEventListener('change', () => {
    const y = Number(ySel.value);
    state.currentYear = y;
    const ms = y === START_YEAR ? START_MONTH : 0;
    const me = y === END_YEAR   ? END_MONTH   : 11;
    if (state.currentMonth < ms) state.currentMonth = ms;
    if (state.currentMonth > me) state.currentMonth = me;
    rebuildMonths(y, state.currentMonth);
    saveState(); renderAll();
  });
}

function rebuildMonths(y, selectM) {
  const mSel = document.getElementById('monthSel');
  mSel.innerHTML = '';
  const ms = y === START_YEAR ? START_MONTH : 0;
  const me = y === END_YEAR   ? END_MONTH   : 11;
  for (let m = ms; m <= me; m++) {
    const o = document.createElement('option');
    o.value = `${y}-${m}`; o.textContent = monthLabel(y, m);
    if (m === selectM) o.selected = true;
    mSel.appendChild(o);
  }
}

/* ── NAV ─────────────────────────────────────────────────────── */
const PAGE_MAP    = { dashboard:'pageDashboard', income:'pageIncome', expenses:'pageExpenses', savings:'pageSavings', insfund:'pageInsfund', insurance:'pageInsurance', buckets:'pageBuckets', networth:'pageNetworth' };
const PAGE_TITLES = { dashboard:'Dashboard', income:'Income', expenses:'Expenses', savings:'Investments', insfund:'Insurance Pools', insurance:'Insurance Goals', buckets:'Goals / Buckets', networth:'Net Worth' };
const PAGE_SUBS   = { dashboard:'Overview of your income, expenses, savings and goals', income:'Click Actual to edit · Click Target to edit · Checkbox = received', expenses:'Click Actual to edit · Click Target to edit · Checkbox = paid', savings:'Click Actual to edit · Click Target to edit · Checkbox = done & adds Target to Actual', insfund:'Annual premium pools — check off once funded for the month, edit targets anytime for inflation', insurance:'Track your insurance saving goals', buckets:'Track your savings buckets and goals', networth:'Your total assets minus liabilities · Independent of monthly view · Loan auto-calculated' };

function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const el = document.getElementById(PAGE_MAP[page]);
  if (el) el.style.display = 'block';
  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const bnav = document.querySelector(`.bottom-nav-item[data-page="${page}"]`);
  if (bnav) bnav.classList.add('active');
  document.getElementById('pageTitle').textContent    = PAGE_TITLES[page] || '';
  document.getElementById('pageSubtitle').textContent = PAGE_SUBS[page]   || '';
  // Toggle body class for networth page (hides monthly stat cards + month/year selectors)
  if (page === 'networth') {
    document.body.classList.add('page-networth');
  } else {
    document.body.classList.remove('page-networth');
  }
  // Show Add Transaction only on pages where it makes sense
  const btnAdd = document.getElementById('btnAddTxn');
  if (btnAdd) {
    const hideOn = ['dashboard', 'networth', 'insurance', 'buckets'];
    btnAdd.style.display = hideOn.includes(page) ? 'none' : '';
  }
  renderAll();
}

/* ════════════════════════════════════════════════════════════
   RENDER — STAT CARDS (always uses actuals)
════════════════════════════════════════════════════════════ */
function renderStats() {
  const t = computeTotals(state.currentYear, state.currentMonth);
  const st = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const sc = (id,c) => { const e=document.getElementById(id); if(e) e.style.color=c; };
  st('s-income',  fmtINR(t.income));
  st('s-expense', fmtINR(t.expense));
  st('s-savings', fmtINR(t.saving));
  st('s-cash',    fmtINR(t.cash));
  st('s-rate',    t.rate.toFixed(2) + '%');
  sc('s-cash', t.cash < 0 ? 'var(--red)' : 'var(--gold)');
}

/* ════════════════════════════════════════════════════════════
   RENDER — DASHBOARD OVERVIEW TABLES (read-only, from actuals)
════════════════════════════════════════════════════════════ */
function renderCatCard(tableId, cats) {
  const y = state.currentYear, m = state.currentMonth;
  const tbl = document.getElementById(tableId);
  let rows = `<tr><th>Category</th><th>Target (₹)</th><th style="text-align:right">Actual (₹)</th></tr>`;
  let totalT = 0, totalA = 0;
  cats.forEach(c => {
    const tgt = getTarget(c.key);
    const act = getActual(y, m, c.key);
    totalT += tgt; totalA += act;
    const diff = act - tgt;
    const isOver  = c.type !== 'income' && diff > 0;
    const isUnder = c.type === 'income' && diff < 0 && tgt > 0;
    rows += `<tr>
      <td>${c.label}</td>
      <td style="color:var(--muted)">${tgt.toLocaleString('en-IN')}</td>
      <td style="text-align:right;${isOver?'color:var(--red)':isUnder?'color:var(--orange)':act>0?'color:var(--text)':'color:var(--muted)'}">${act.toLocaleString('en-IN')}</td>
    </tr>`;
  });
  const cc = cats[0].type==='income'?'income-total':cats[0].type==='expense'?'expense-total':'savings-total';
  rows += `<tr class="total-row">
    <td>Total</td>
    <td style="color:var(--muted)">${totalT.toLocaleString('en-IN')}</td>
    <td class="${cc}">${totalA.toLocaleString('en-IN')}</td>
  </tr>`;
  tbl.innerHTML = rows;
}

/* ════════════════════════════════════════════════════════════
   RENDER — CHARTS
════════════════════════════════════════════════════════════ */
function renderTrendChart() {
  const pts = [];
  for (let i = 5; i >= 0; i--) {
    let m = state.currentMonth - i, y = state.currentYear;
    while (m < 0) { m += 12; y--; }
    if (y < START_YEAR || (y===START_YEAR && m < START_MONTH)) { pts.push({label:'',inc:0,exp:0}); continue; }
    const t = computeTotals(y, m);
    pts.push({ label: MONTH_NAMES[m], inc: t.income, exp: t.expense });
  }
  const maxV = Math.max(...pts.map(p => Math.max(p.inc,p.exp)), 1);
  const W=260, H=65;
  const tx = i => Math.round((i/5)*W);
  const ty = v => H - Math.round((v/maxV)*(H-6)) + 2;
  const ip = pts.map((p,i) => `${tx(i)},${ty(p.inc)}`).join(' ');
  const ep = pts.map((p,i) => `${tx(i)},${ty(p.exp)}`).join(' ');
  const lbs = pts.map((p,i) => p.label ? `<text x="${tx(i)}" y="${H+14}" font-size="7" fill="#8892a4" text-anchor="middle">${p.label}</text>` : '').join('');
  const tcEl = document.getElementById('trendChart'); if (!tcEl) return;
  tcEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H+18}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
      <polyline fill="rgba(52,211,153,0.07)" stroke="none" points="${ip} ${tx(5)},${H+4} 0,${H+4}"/>
      <polyline fill="rgba(248,113,113,0.05)" stroke="none" points="${ep} ${tx(5)},${H+4} 0,${H+4}"/>
      <polyline fill="none" stroke="#34d399" stroke-width="2" points="${ip}"/>
      <polyline fill="none" stroke="#f87171" stroke-width="2" points="${ep}"/>
      ${lbs}
    </svg>`;
}

function renderBarChart() {
  const pts = [];
  for (let i = 5; i >= 0; i--) {
    let m = state.currentMonth - i, y = state.currentYear;
    while (m < 0) { m += 12; y--; }
    if (y < START_YEAR || (y===START_YEAR && m < START_MONTH)) { pts.push({label:'',val:0}); continue; }
    pts.push({ label: MONTH_NAMES[m], val: computeTotals(y,m).saving });
  }
  const maxV = Math.max(...pts.map(p => p.val), 1);
  const bc = document.getElementById('barChart');
  if (!bc) return;
  bc.innerHTML = '';
  pts.forEach((p, i) => {
    const pct = Math.max(Math.round((p.val/maxV)*100), p.val > 0 ? 4 : 0);
    const d = document.createElement('div');
    d.className = 'bar-month';
    d.innerHTML = `<div class="bar" style="height:${pct}%;background:${i===5?'#7c6af7':'#4fc3f7'}" title="${fmtINR(p.val)}"></div>
      <div class="bar-label">${p.label}</div>`;
    bc.appendChild(d);
  });
}

function renderPie() {
  const y = state.currentYear, m = state.currentMonth;
  const items = EXPENSE_CATS.map((c,i) => ({ label:c.label, val: getActual(y,m,c.key), color: PIE_COLORS[i%PIE_COLORS.length] })).filter(c => c.val > 0);
  const total = items.reduce((a,c) => a+c.val, 0) || 1;
  let offset = 0, segs = '';
  const leg = [];
  items.forEach(c => {
    const pct = (c.val/total)*100;
    segs += `<circle r="15.9" cx="18" cy="18" fill="none" stroke="${c.color}" stroke-width="3.8"
      stroke-dasharray="${pct.toFixed(1)} ${(100-pct).toFixed(1)}" stroke-dashoffset="${-(offset-25)}"/>`;
    leg.push(`<div class="legend-item"><div class="legend-dot" style="background:${c.color}"></div>
      <div class="legend-name">${c.label.replace(/^\S+ /,'').slice(0,14)}</div>
      <div class="legend-pct">${pct.toFixed(1)}%</div></div>`);
    offset += pct;
  });
  if (!items.length) {
    segs = `<circle r="15.9" cx="18" cy="18" fill="none" stroke="#2e3248" stroke-width="3.8" stroke-dasharray="100 0"/>`;
    leg.push('<div style="color:var(--muted);font-size:11px;padding:8px 0">No expenses yet</div>');
  }
  const pcEl = document.getElementById('pieChart'); if (pcEl) pcEl.innerHTML = `<svg width="90" height="90" viewBox="0 0 36 36">${segs}</svg>`;
  const plEl = document.getElementById('pieLegend'); if (plEl) plEl.innerHTML = leg.join('');
}

function renderAnnual() {
  const t = annualTotals(state.currentYear);
  const setT = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  setT('annualIncome', fmtINR(t.income)); setT('annualExpense', fmtINR(t.expense));
  setT('annualSaving', fmtINR(t.saving)); setT('annualCash', fmtINR(t.cash));
}

function renderInsGoals() {
  const igEl = document.getElementById('insGoals'); if (!igEl) return;
  igEl.innerHTML = INS_GOALS.map(g => {
    const target = getPoolAnnual(g.poolKey);
    const saved  = yearTotalForCat(g.poolKey);          // year-to-date, resets naturally each year
    const pct    = target > 0 ? Math.min((saved/target)*100, 100) : 0;
    return `<div class="ins-goal">
      <div class="ins-goal-header"><span class="ins-goal-name">${g.label}</span><span class="ins-goal-saved">${fmtINR(saved)}</span></div>
      <div class="ins-goal-target">Target: ${fmtINR(target)} (this year)</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${g.color}"></div></div>
      <div class="pct">${pct.toFixed(2)}%</div>
    </div>`;
  }).join('');
}

function renderBucketsWidget() {
  const d = ensureMonth(state.currentYear, state.currentMonth);
  const blEl = document.getElementById('bucketList'); if (!blEl) return;
  blEl.innerHTML =
    `<div style="display:flex;gap:8px;font-size:11px;color:var(--muted);padding-bottom:6px;border-bottom:1px solid var(--border)">
      <span style="flex:1">Bucket</span><span style="width:80px">Target (₹)</span>
      <span style="width:64px">Saved (₹)</span><span style="flex:1">Progress</span>
      <span style="width:36px;text-align:right">%</span></div>` +
    BUCKETS.map(b => {
      const saved = d.buckets[b.key] || 0;
      const pct   = Math.min((saved/b.target)*100, 100);
      return `<div class="bucket-row">
        <div class="bucket-name">${b.label}</div>
        <div style="width:80px;font-size:12px">${b.target.toLocaleString('en-IN')}</div>
        <div class="bucket-saved" style="width:64px;font-size:12px">${saved.toLocaleString('en-IN')}</div>
        <div class="bucket-prog"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${b.color}"></div></div></div>
        <div class="bucket-pct">${pct.toFixed(2)}%</div>
      </div>`;
    }).join('');
}

function renderDashboardTxns() {
  const txns = ensureMonth(state.currentYear, state.currentMonth).transactions;
  const thEl = document.getElementById('txnHeader'); if (thEl) thEl.textContent = `Recent Transactions (${monthLabel(state.currentYear, state.currentMonth)})`;
  renderTxnList('txnList', txns.slice(-8), false);
}

/* ════════════════════════════════════════════════════════════
   EDITABLE SUMMARY TABLE
   Columns: ✓ | Category | Target (click to edit) | Actual (click to edit) | Variance | ×
════════════════════════════════════════════════════════════ */
function renderEditableSummary(tableId, cats, txnListId) {
  const y = state.currentYear, m = state.currentMonth;
  const type   = cats[0].type;
  const isSav  = type === 'saving';     // savings page gets extra columns
  const isPoolPage = cats.length > 0 && cats.every(c => c.pool); // Insurance Pools page only
  let totalT = 0, totalA = 0, totalYTD = 0, totalAnnual = 0;

  let rows = `<tr>
    <th style="width:28px" title="Received / Paid / Done">✓</th>
    <th>Category</th>
    ${isSav ? `<th style="min-width:150px;cursor:pointer" title="Click to set the MF / RD where this is parked">Parked In (MF / RD) ✏</th>` : ``}
    ${isPoolPage ? `<th style="width:130px;cursor:pointer" title="Click to edit — this is the real annual premium, the source of truth">Annual Premium (₹) ✏</th>` : ``}
    <th style="width:120px;${isPoolPage?'':'cursor:pointer'}" title="${isPoolPage ? 'Auto-calculated as Annual Premium ÷ 12 — edit the Annual Premium instead' : 'Click any target to edit'}">Target (₹)${isPoolPage?' = Annual÷12':' ✏'}</th>
    <th style="width:120px;text-align:right;cursor:pointer" title="Click any actual to edit">Actual (₹) ✏</th>
    ${isSav ? `<th style="width:140px;text-align:right" title="Total parked this year so far">Year Total (₹)</th>` : ``}
    <th style="width:100px;text-align:right">Variance</th>
    <th style="width:28px"></th>
  </tr>`;

  cats.forEach(c => {
    const tgt     = getTarget(c.key);
    const act     = getActual(y, m, c.key);
    const checked = getChecked(y, m, c.key);
    totalT += tgt; totalA += act;
    const diff      = act - tgt;
    let varColor    = 'var(--muted)';
    if (diff !== 0) varColor = type==='income' ? (diff>=0?'var(--green)':'var(--red)') : (diff<=0?'var(--green)':'var(--red)');
    const strike = checked ? 'text-decoration:line-through;opacity:0.5;' : '';

    // ── savings-only cells: Parked In + Year Total ──────────────
    let parkedCell = '', ytdCell = '';
    if (isSav) {
      const park = getParked(c.key);
      parkedCell = `<td class="editable-cell" style="${strike}"
          onclick="startEditParked(this,'${c.key}')" title="Click to set where this money is parked">
        <span class="cell-val ${park?'has-value':''}" style="${park?'':'color:var(--muted);font-style:italic'}">${park ? park : 'set MF / RD…'}</span>
        <span class="edit-hint">✏</span>
      </td>`;
      const ytd = yearTotalForCat(c.key);
      totalYTD += ytd;
      if (c.pool) {
        const annual = getPoolAnnual(c.key);
        const full   = annual > 0 && ytd >= annual;
        ytdCell = `<td style="text-align:right;font-size:12px;color:${full?'var(--green)':'var(--text)'}"
            title="${full?'Pot is full — redeem & pay the premium':'Building toward annual premium'}">
          ${ytd.toLocaleString('en-IN')}<span style="color:var(--muted)"> / ${annual.toLocaleString('en-IN')}</span>${full?' ✓':''}
        </td>`;
      } else if (c.quarterly) {
        const qi = licQuarterInfo(y, m);
        if (qi) {
          ytdCell = `<td style="text-align:right;font-size:11px;color:var(--text)"
              title="Quarter starting ${qi.qStartLabel} — month ${qi.moInQ} of 3 toward ₹${LIC_QUARTERLY.toLocaleString('en-IN')}">
            Q${qi.qNum} · mo ${qi.moInQ}/3<span style="color:var(--muted)"> · ₹${LIC_QUARTERLY.toLocaleString('en-IN')}/qtr</span>
          </td>`;
        } else {
          ytdCell = `<td style="text-align:right;font-size:11px;color:var(--muted)" title="Paid directly in June 2026, before the auto-split cycle began">pre-cycle</td>`;
        }
      } else {
        ytdCell = `<td style="text-align:right;font-size:12px;color:var(--text)">${ytd.toLocaleString('en-IN')}</td>`;
      }
    }

    // ── pool-page-only cell: editable Annual Premium ─────────────
    let annualCell = '';
    if (isPoolPage) {
      const annual = getPoolAnnual(c.key);
      totalAnnual += annual;
      annualCell = `<td class="editable-cell" style="${strike}"
          onclick="startEdit(this,'annual','${c.key}','${type}')" title="Click to edit the real annual premium — this drives the monthly target and the linked Insurance Goal">
        <span class="cell-val has-value">${annual.toLocaleString('en-IN')}</span>
        <span class="edit-hint">✏</span>
      </td>`;
    }

    // Target cell: editable normally, but read-only (calculated) for pools
    const targetCell = c.pool
      ? `<td style="${strike};color:var(--muted)" title="Auto-calculated as Annual Premium ÷ 12 — edit Annual Premium to change this">
          <span class="cell-val">${tgt.toLocaleString('en-IN')}</span>
        </td>`
      : `<td class="editable-cell" style="${strike}"
          onclick="startEdit(this,'target','${c.key}','${type}')" title="Click to edit target">
          <span class="cell-val">${tgt.toLocaleString('en-IN')}</span>
          <span class="edit-hint">✏</span>
        </td>`;

    rows += `<tr class="editable-row ${checked?'row-checked':''}" data-key="${c.key}">
      <td style="text-align:center">
        <input type="checkbox" class="cat-check" ${checked?'checked':''}
          onchange="toggleCheck('${c.key}','${type}',this.checked)"
          title="${type==='income'?'Mark as received':type==='expense'?'Mark as paid':'Mark as done'}">
      </td>
      <td style="${strike}">${c.label}</td>
      ${parkedCell}
      ${annualCell}
      ${targetCell}
      <td class="editable-cell" style="text-align:right"
          onclick="startEdit(this,'actual','${c.key}','${type}')" title="Click to edit actual">
        <span class="cell-val ${act>0?'has-value':''}">${act.toLocaleString('en-IN')}</span>
        <span class="edit-hint">✏</span>
      </td>
      ${ytdCell}
      <td style="text-align:right;color:${varColor}">${(diff>=0?'+':'')+diff.toLocaleString('en-IN')}</td>
      <td style="text-align:center">
        <button class="del-btn" onclick="clearRow('${c.key}','${type}')" title="Clear actual & uncheck">×</button>
      </td>
    </tr>`;
  });

  const totalDiff = totalA - totalT;
  const totalVC   = totalDiff===0?'var(--muted)': type==='income'?(totalDiff>=0?'var(--green)':'var(--red)'):(totalDiff<=0?'var(--green)':'var(--red)');
  const cc        = type==='income'?'income-total':type==='expense'?'expense-total':'savings-total';
  rows += `<tr class="total-row">
    <td></td><td>Total</td>
    ${isSav ? `<td></td>` : ``}
    ${isPoolPage ? `<td>${totalAnnual.toLocaleString('en-IN')}</td>` : ``}
    <td>${totalT.toLocaleString('en-IN')}</td>
    <td class="${cc}" style="text-align:right">${totalA.toLocaleString('en-IN')}</td>
    ${isSav ? `<td class="${cc}" style="text-align:right">${totalYTD.toLocaleString('en-IN')}</td>` : ``}
    <td style="text-align:right;color:${totalVC}">${(totalDiff>=0?'+':'')+totalDiff.toLocaleString('en-IN')}</td>
    <td></td>
  </tr>`;

  document.getElementById(tableId).innerHTML = rows;

  // Transaction list below table — filtered to only the categories on
  // THIS page (e.g. Investments page won't show Insurance Pool entries
  // and vice versa, even though both share type 'saving').
  const catKeys = new Set(cats.map(c => c.key));
  const txns = ensureMonth(y,m).transactions.filter(t => t.type === type && catKeys.has(t.catKey));
  renderTxnList(txnListId, txns, true);
}

/* ── INLINE EDIT (target or actual) ─────────────────────────── */
function startEdit(cell, field, catKey, type) {
  if (cell.querySelector('input.ie')) return; // already open
  const current = field === 'target'
    ? getTarget(catKey)
    : field === 'annual'
    ? getPoolAnnual(catKey)
    : getActual(state.currentYear, state.currentMonth, catKey);
  const align = field === 'actual' ? 'right' : 'left';
  cell.innerHTML = `<input class="ie" type="number" min="0" value="${current}"
    style="width:95px;background:var(--surface2);border:1px solid var(--accent);
    color:var(--text);padding:4px 7px;border-radius:6px;font-size:13px;
    text-align:${align};outline:none;font-family:var(--font)"
    onblur="commitEdit(this,'${field}','${catKey}','${type}')"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){event.stopPropagation();cancelEdit('${catKey}','${type}');}">`;
  const inp = cell.querySelector('input');
  inp.focus(); inp.select();
}

function commitEdit(inp, field, catKey, type) {
  const validated = validateAmount(inp.value);
  const val = validated !== null ? Math.round(validated) : 0;
  if (field === 'annual') {
    state.poolAnnual[catKey] = val;
  } else if (field === 'target') {
    state.targets[catKey] = val;
  } else {
    ensureMonth(state.currentYear, state.currentMonth).actuals[catKey] = val;
  }
  saveState();
  rerenderPage(type);
  renderStats();          // always sync stat cards
  toast(`${field==='annual'?'Annual premium':field==='target'?'Target':'Actual'} updated — ${fmtINR(val)}`, 'success');
}

function cancelEdit(catKey, type) { rerenderPage(type); }

/* ── INLINE EDIT for "Parked In" (text, savings only) ────────── */
function startEditParked(cell, catKey) {
  if (cell.querySelector('input.ie')) return;
  const current = getParked(catKey).replace(/"/g,'&quot;');
  cell.innerHTML = `<input class="ie" type="text" value="${current}" maxlength="40"
    placeholder="e.g. HDFC RD 7.1% / Parag Parikh Flexi"
    style="width:100%;min-width:140px;background:var(--surface2);border:1px solid var(--accent);
    color:var(--text);padding:4px 7px;border-radius:6px;font-size:12px;
    outline:none;font-family:var(--font)"
    onblur="commitEditParked(this,'${catKey}')"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){event.stopPropagation();cancelEdit('${catKey}','saving');}">`;
  const inp = cell.querySelector('input');
  inp.focus(); inp.select();
}

function commitEditParked(inp, catKey) {
  const val = inp.value.trim();
  if (val) state.parked[catKey] = val;
  else delete state.parked[catKey];
  saveState();
  rerenderPage('saving');
  toast(val ? `Parked in — ${val}` : 'Parking note cleared', 'success');
}

/* Checking a box adds that category's Target to Actual (so a single
   click "marks as funded" without retyping the number). Unchecking
   subtracts the exact same amount back out. The Actual cell stays
   independently editable by hand at any time — e.g. if you only part-
   funded it, just click into Actual afterwards and correct the number;
   the checkbox state itself won't re-fight your edit. */
function toggleCheck(catKey, type, checked) {
  const d   = ensureMonth(state.currentYear, state.currentMonth);
  const tgt = getTarget(catKey);
  const cur = d.actuals[catKey] || 0;
  d.actuals[catKey] = checked ? cur + tgt : Math.max(0, cur - tgt);
  d.checked[catKey] = checked;
  saveState();
  rerenderPage(type);
  renderStats();
  toast(checked ? `Marked funded — +${fmtINR(tgt)}` : `Unmarked — -${fmtINR(tgt)}`, 'success');
}

function clearRow(catKey, type) {
  const d = ensureMonth(state.currentYear, state.currentMonth);
  d.actuals[catKey]  = 0;
  d.checked[catKey]  = false;
  saveState();
  rerenderPage(type);
  renderStats();
  toast('Row cleared', 'success');
}

function rerenderPage(type) {
  if (type==='income')  renderIncomePage();
  if (type==='expense') renderExpensePage();
  if (type==='saving') { renderSavingsPage(); renderInsfundPage(); }
}

/* ── SUB-PAGE RENDERS ────────────────────────────────────────── */
function renderIncomePage()  { renderEditableSummary('incPageTable',  INCOME_CATS,  'incPageTxns'); }
function renderExpensePage() { renderEditableSummary('expPageTable',  EXPENSE_CATS, 'expPageTxns'); }
function renderSavingsPage()  { renderEditableSummary('savPageTable',  SAVINGS_CATS,  'savPageTxns'); }
function renderInsfundPage()  { renderEditableSummary('insfPageTable', INSPOOL_CATS, 'insfPageTxns'); }

function renderInsurancePage() {
  const ipgEl = document.getElementById('insPageGoals'); if (!ipgEl) return;
  ipgEl.innerHTML = INS_GOALS.map(g => {
    const target = getPoolAnnual(g.poolKey);
    const saved  = yearTotalForCat(g.poolKey);
    const pct    = target > 0 ? Math.min((saved/target)*100, 100) : 0;
    const remaining = Math.max(target - saved, 0);
    // Donut chart — same construction as the dashboard expense pie (renderPie),
    // single segment showing % of this year's premium funded so far.
    const dash = `${pct.toFixed(1)} ${(100-pct).toFixed(1)}`;
    const donut = `<svg width="84" height="84" viewBox="0 0 36 36">
        <circle r="15.9" cx="18" cy="18" fill="none" stroke="var(--border)" stroke-width="3.8"/>
        <circle r="15.9" cx="18" cy="18" fill="none" stroke="${g.color}" stroke-width="3.8"
          stroke-dasharray="${dash}" stroke-dashoffset="25" stroke-linecap="round"/>
        <text x="18" y="20.5" text-anchor="middle" font-size="7.5" fill="var(--text)" font-weight="600">${pct.toFixed(0)}%</text>
      </svg>`;
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">${g.label}</div>
        <div style="font-size:11px;color:var(--muted)">Funds automatically as you check off the linked Insurance Pool each month</div>
      </div>
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:14px">
        <div style="flex-shrink:0">${donut}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;flex:1">
          <div><div class="mini-lbl">Target (this yr)</div><div class="mini-val">${fmtINR(target)}</div></div>
          <div><div class="mini-lbl">Saved (YTD)</div><div class="mini-val" style="color:var(--green)">${fmtINR(saved)}</div></div>
          <div><div class="mini-lbl">Remaining</div><div class="mini-val" style="color:var(--orange)">${fmtINR(remaining)}</div></div>
        </div>
      </div>
      <div class="progress-bar" style="height:10px"><div class="progress-fill" style="width:${pct}%;background:${g.color}"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-top:5px">${pct.toFixed(2)}% of ${state.currentYear}'s premium funded so far</div>
    </div>`;
  }).join('');
}


function renderBucketsPage() {
  const d = ensureMonth(state.currentYear, state.currentMonth);
  const bplEl = document.getElementById('bucketsPageList'); if (!bplEl) return;
  bplEl.innerHTML = BUCKETS.map(b => {
    const saved = d.buckets[b.key] || 0;
    const pct   = Math.min((saved/b.target)*100, 100);
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">${b.label}</div>
        <div class="card-action" onclick="openBucketModal()">Update</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
        <div><div class="mini-lbl">Target</div><div class="mini-val">${fmtINR(b.target)}</div></div>
        <div><div class="mini-lbl">Saved</div><div class="mini-val" style="color:var(--green)">${fmtINR(saved)}</div></div>
        <div><div class="mini-lbl">Remaining</div><div class="mini-val" style="color:var(--orange)">${fmtINR(b.target-saved)}</div></div>
      </div>
      <div class="progress-bar" style="height:10px"><div class="progress-fill" style="width:${pct}%;background:${b.color}"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-top:5px">${pct.toFixed(2)}% of target reached</div>
    </div>`;
  }).join('');
}

/* ── TRANSACTION LIST ────────────────────────────────────────── */
function renderTxnList(containerId, txns, allowDelete) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!txns.length) { el.innerHTML = `<div class="empty-state">No transactions for this month.</div>`; return; }
  const sorted = [...txns].sort((a,b) => b.dateISO.localeCompare(a.dateISO));
  el.innerHTML = sorted.map(t => {
    const pos      = t.type === 'income';
    const amtStr   = pos ? `+${fmtINR(t.amount)}` : `-${fmtINR(t.amount)}`;
    const amtColor = pos ? 'var(--green)' : t.type==='saving' ? 'var(--accent2)' : 'var(--red)';
    const del      = allowDelete ? `<button class="del-btn" onclick="deleteTxn('${t.id}')" title="Delete">×</button>` : '';
    return `<div class="txn-row">
      <div class="txn-dot" style="background:${TXN_COLORS[t.type]}"></div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500">${t.desc}</div>
        <div class="txn-date">${t.dateStr} · ${t.catLabel}</div>
      </div>
      <span class="txn-type ${TXN_CLASSES[t.type]}">${TXN_LABELS[t.type]}</span>
      <div class="txn-amount" style="color:${amtColor}">${amtStr}</div>
      ${del}
    </div>`;
  }).join('');
}

function deleteTxn(id) {
  const k = `${state.currentYear}-${state.currentMonth}`;
  if (!state.months[k]) return;
  const month = state.months[k];
  const txn = month.transactions.find(t => String(t.id) === String(id));
  if (txn) {
    // Reverse the actuals contribution this transaction made, so
    // deleting it from the log also removes it from every total —
    // never let actuals go negative (e.g. if it was already manually
    // adjusted down in between).
    month.actuals[txn.catKey] = Math.max(0, (month.actuals[txn.catKey] || 0) - txn.amount);
  }
  month.transactions = month.transactions.filter(t => String(t.id) !== String(id));
  saveState(); renderAll(); toast('Transaction deleted','success');
}

/* ── MASTER RENDER ───────────────────────────────────────────── */
function renderAll() {
  try {
    ensureMonth(state.currentYear, state.currentMonth);
    renderStats();
    const p = state.currentPage;
    if (p === 'dashboard') {
      renderCatCard('incomeTable',  INCOME_CATS);
      renderCatCard('expenseTable', EXPENSE_CATS);
      renderCatCard('savingsTable', SAVING_LIKE_CATS);
      renderTrendChart(); renderBarChart(); renderPie();
      renderAnnual(); renderInsGoals(); renderBucketsWidget();
      renderDashboardTxns(); renderMonthlyTargets();
    } else if (p==='income')       renderIncomePage();
    else if (p==='expenses')       renderExpensePage();
    else if (p==='savings')        renderSavingsPage();
    else if (p==='insfund')        renderInsfundPage();
    else if (p==='insurance')      renderInsurancePage();
    else if (p==='buckets')      { renderBucketsWidget(); renderBucketsPage(); }
    else if (p==='networth')       renderNetworthPage();
  } catch(err) {
    console.error('Arthena render error:', err);
    const content = document.querySelector('.content');
    if (content) {
      content.innerHTML = `
        <div style="padding:40px;text-align:center;">
          <div style="font-size:32px;margin-bottom:16px;">⚠️</div>
          <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:8px;">Something went wrong</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:20px;">${err.message || 'Unknown error'}</div>
          <button onclick="location.reload()" style="background:var(--accent);color:var(--bg);border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Reload App</button>
        </div>`;
    }
  }
}

/* ════════════════════════════════════════════════════════════
   MODALS
════════════════════════════════════════════════════════════ */
function openModal(type) {
  if (type) document.getElementById('txnType').value = type;
  updateCatDropdown();
  document.getElementById('txnDate').value   = `${state.currentYear}-${String(state.currentMonth+1).padStart(2,'0')}-01`;
  document.getElementById('txnDesc').value   = '';
  document.getElementById('txnAmount').value = '';
  document.getElementById('modalBg').classList.add('open');
}
function closeModal() { document.getElementById('modalBg').classList.remove('open'); }

function updateCatDropdown() {
  const type = document.getElementById('txnType').value;
  const cats = type==='income'?INCOME_CATS:type==='expense'?EXPENSE_CATS:SAVING_LIKE_CATS;
  const sel  = document.getElementById('txnCat');
  sel.innerHTML = '<option value="">-- Select category --</option>';
  cats.forEach(c => { sel.innerHTML += `<option value="${c.key}">${c.label}</option>`; });
  toggleParkedField();
}

/* Show "Invested In (MF/RD)" only for savings; prefill from saved note */
function toggleParkedField() {
  const isSav = document.getElementById('txnType').value === 'saving';
  const grp   = document.getElementById('txnParkedGroup');
  if (grp) grp.style.display = isSav ? 'block' : 'none';
  if (isSav) {
    const cat = document.getElementById('txnCat').value;
    document.getElementById('txnParked').value = cat ? getParked(cat) : '';
  }
}

function saveTransaction() {
  const type   = document.getElementById('txnType').value;
  const catKey = document.getElementById('txnCat').value;
  const desc   = document.getElementById('txnDesc').value.trim();
  const amount = validateAmount(document.getElementById('txnAmount').value);
  const dateV  = document.getElementById('txnDate').value;
  if (!catKey)               { toast('Select a category','error'); return; }
  if (!desc)                 { toast('Enter a description','error'); return; }
  if (amount === null || amount <= 0) { toast('Enter a valid amount greater than 0','error'); return; }
  if (!dateV)                { toast('Pick a date','error'); return; }
  const dateObj = new Date(dateV+'T00:00:00');
  const ty = dateObj.getFullYear(), tm = dateObj.getMonth();
  if (ty<START_YEAR||ty>END_YEAR||(ty===START_YEAR&&tm<START_MONTH)||(ty===END_YEAR&&tm>END_MONTH)) {
    toast('Date must be Jun 2026 – Dec 2035','error'); return;
  }
  const cats    = type==='income'?INCOME_CATS:type==='expense'?EXPENSE_CATS:SAVING_LIKE_CATS;
  const catObj  = cats.find(c=>c.key===catKey);
  const id      = Date.now()+'-'+Math.random().toString(36).slice(2);
  const dateStr = dateObj.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  // Savings: capture where it's parked (MF/RD) and remember it for the category
  let parked = '';
  if (type === 'saving') {
    parked = document.getElementById('txnParked').value.trim();
    if (parked) state.parked[catKey] = parked;
  }
  const monthData = ensureMonth(ty,tm);
  monthData.transactions.push({ id, type, catKey, catLabel:catObj?catObj.label:'Misc', desc, amount, dateStr, dateISO:dateV, parked });
  // The transaction LOG and the category's ACTUAL total are separate
  // stores — logging a transaction must also add its amount into the
  // category's actual for that month, or it shows in the list but is
  // invisible to every total (dashboard, pie chart, editable summary).
  monthData.actuals[catKey] = (monthData.actuals[catKey] || 0) + amount;
  saveState(); closeModal();
  state.currentYear=ty; state.currentMonth=tm;
  rebuildMonths(ty, tm);
  document.getElementById('yearSel').value = ty;
  renderAll();
  toast(`Saved — ${fmtINR(amount)} (${TXN_LABELS[type]})`, 'success');
}

function openBucketModal() {
  const d = ensureMonth(state.currentYear, state.currentMonth);
  const sel = document.getElementById('bucketKey');
  sel.innerHTML = '';
  BUCKETS.forEach(b => { sel.innerHTML += `<option value="${b.key}">${b.label} · Saved: ${fmtINR(d.buckets[b.key]||0)} / ${fmtINR(b.target)}</option>`; });
  document.getElementById('bucketAmount').value = '';
  document.getElementById('bucketModalBg').classList.add('open');
}
function closeBucketModal() { document.getElementById('bucketModalBg').classList.remove('open'); }
function saveBucketAmount() {
  const key = document.getElementById('bucketKey').value;
  const amt = validateAmount(document.getElementById('bucketAmount').value);
  if (amt === null) { toast('Enter a valid amount','error'); return; }
  ensureMonth(state.currentYear,state.currentMonth).buckets[key] = amt;
  saveState(); closeBucketModal(); renderAll(); toast('Bucket updated','success');
}

/* ── TOAST ───────────────────────────────────────────────────── */
function toast(msg, type='success') {
  const el = document.getElementById('toastEl');
  el.textContent = msg; el.className = `toast ${type} show`;
  clearTimeout(el._t); el._t = setTimeout(()=>{ el.className='toast'; }, 2600);
}
function bindBgClose(id, fn) {
  document.getElementById(id).addEventListener('click', e => { if(e.target.id===id) fn(); });
}

/* ── RESET ALL DATA ──────────────────────────────────────────── */
function resetAll() {
  const ok = confirm(
    'Reset Arthena?\n\n' +
    'This permanently erases everything you have entered:\n' +
    '• all monthly actuals & checkboxes\n' +
    '• all transactions\n' +
    '• buckets & parked (MF/RD) notes\n' +
    '• any edited targets and annual premiums (back to defaults)\n' +
    '• insurance goal progress (rebuilds automatically as you re-fund pools)\n\n' +
    'This cannot be undone. Continue?'
  );
  if (!ok) return;
  localStorage.removeItem(LS_KEY);
  state = {
    targets:      { ...DEFAULT_TARGETS },
    poolAnnual:   { ...DEFAULT_POOL_ANNUAL },
    parked:       { mfsip: 'Nifty 50 Index Fund' },
    months:       {},
    currentYear:  2026,
    currentMonth: 5,
    currentPage:  state.currentPage || 'dashboard',
  };
  ensureMonth(state.currentYear, state.currentMonth);
  saveState();
  buildSelectors();
  document.getElementById('yearSel').value = state.currentYear;
  renderAll();
  toast('All data reset to defaults', 'success');
}

/* ── MONTHLY TARGETS PANEL (computed from current targets) ───── */
function renderMonthlyTargets() {
  const sum = cats => cats.reduce((a,c) => a + getTarget(c.key), 0);
  const inc = sum(INCOME_CATS), exp = sum(EXPENSE_CATS), sav = sum(SAVING_LIKE_CATS);
  const set = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = fmtINR(v); };
  set('mtIncome', inc); set('mtExpense', exp); set('mtSaving', sav);
  renderBudgetAlerts();
}

function renderBudgetAlerts() {
  const el = document.getElementById('budgetAlerts');
  if (!el) return;

  const y = state.currentYear;
  const m = state.currentMonth;
  const alerts = [];

  // Check expense categories
  EXPENSE_CATS.forEach(c => {
    const actual = getActual(y, m, c.key);
    const target = getTarget(c.key);
    if (target <= 0 || actual <= 0) return;
    const pct = (actual / target) * 100;
    if (pct >= 100) {
      alerts.push({
        type: 'over',
        icon: '🚨',
        label: c.label.replace(/^\S+\s/, ''), // strip emoji
        actual, target, pct
      });
    } else if (pct >= 80) {
      alerts.push({
        type: 'near',
        icon: '⚠️',
        label: c.label.replace(/^\S+\s/, ''),
        actual, target, pct
      });
    }
  });

  // Check overall expense vs target
  const totalExpActual = EXPENSE_CATS.reduce((s,c) => s + getActual(y,m,c.key), 0);
  const totalExpTarget = EXPENSE_CATS.reduce((s,c) => s + getTarget(c.key), 0);
  if (totalExpTarget > 0 && totalExpActual > totalExpTarget) {
    alerts.unshift({
      type: 'over',
      icon: '🚨',
      label: 'Total Expenses',
      actual: totalExpActual,
      target: totalExpTarget,
      pct: (totalExpActual / totalExpTarget) * 100
    });
  }

  if (!alerts.length) {
    el.innerHTML = `<div style="font-size:11px;color:var(--green);margin-top:4px;">✓ All categories within budget</div>`;
    return;
  }

  el.innerHTML = alerts.map(a => `
    <div class="budget-alert ${a.type}">
      <span class="budget-alert-icon">${a.icon}</span>
      <span class="budget-alert-text">
        <strong>${a.label}</strong>
        ${fmtINR(a.actual)} of ${fmtINR(a.target)}
        <span class="budget-alert-pct">(${Math.round(a.pct)}%)</span>
      </span>
    </div>`).join('');
}


document.addEventListener('DOMContentLoaded', async () => {
  loadState(); // load from localStorage immediately so UI is not blank
  applyTheme(state.theme);
  navigate(state.currentPage || 'dashboard');

  // Then try to sync from Supabase in background
  // If remote is newer, re-render with synced data
  const synced = await syncFromSupabase();
  if (synced) {
    applyTheme(state.theme);
    navigate(state.currentPage || 'dashboard');
    toast('Synced from cloud', 'success');
  }

  // Poll Supabase every 30 seconds for cross-device sync
  setInterval(async () => {
    const updated = await syncFromSupabase();
    if (updated) {
      applyTheme(state.theme);
      // Re-render current page only — do NOT navigate, which would change page
      renderAll();
      toast('Synced from cloud', 'success');
    }
  }, 30000);
  buildSelectors();
  ensureMonth(state.currentYear, state.currentMonth);
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.addEventListener('click', () => navigate(n.dataset.page));
  });
  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(n => {
    n.addEventListener('click', () => navigate(n.dataset.page));
  });
  bindBgClose('modalBg',        closeModal);
  bindBgClose('bucketModalBg',  closeBucketModal);
  bindBgClose('nwRowModalBg',   closeNwRowModal);
  bindBgClose('loanModalBg',    closeLoanModal);
  document.getElementById('txnType').addEventListener('change', updateCatDropdown);
  document.getElementById('txnCat').addEventListener('change', toggleParkedField);
});

/* ════════════════════════════════════════════════════════════
   BACKUP / RESTORE
════════════════════════════════════════════════════════════ */
function exportBackup() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0,10);
  a.href     = url;
  a.download = `arthena-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded', 'success');
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.months && !parsed.targets) {
        toast('Invalid backup file', 'error'); return;
      }
      if (!confirm('This will replace ALL your current data with the backup. Are you sure?')) return;
      applyParsedState(parsed);
      saveState();
      navigate(state.currentPage || 'dashboard');
      toast('Backup restored successfully', 'success');
    } catch {
      toast('Could not read backup file', 'error');
    }
    event.target.value = ''; // reset file input
  };
  reader.readAsText(file);
}

/* ════════════════════════════════════════════════════════════
   THEME TOGGLE
════════════════════════════════════════════════════════════ */
function setSyncStatus(status, label) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if (!dot || !lbl) return;
  dot.className = `sync-dot ${status}`;
  lbl.textContent = label;
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '☀️';
  } else {
    document.body.classList.remove('light-theme');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '🌙';
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  saveState();
}


/* ════════════════════════════════════════════════════════════
   NET WORTH — full rewrite
   Loans: dynamic array with full amortization per loan
   Savings: pulled from Investment actuals June 2026 onwards
   Independent date picker
════════════════════════════════════════════════════════════ */

let nwGoldRatePerGram = 0;

/* ── Loan amortization ───────────────────────────────────── */
function calcLoanOutstandingGeneric(loan, viewYear, viewMonth) {
  const monthRate  = loan.ratePA / 100 / 12;
  let balance      = loan.principal;
  const startTotal = loan.startYear * 12 + loan.startMonth;
  const curTotal   = viewYear * 12 + viewMonth;
  const emisPaid   = curTotal - startTotal + 1;
  if (emisPaid <= 0) return loan.principal;
  for (let i = 0; i < Math.min(emisPaid, loan.totalEmis); i++) {
    const interest  = balance * monthRate;
    const principal = loan.emi - interest;
    balance -= principal;
    if (balance <= 0) { balance = 0; break; }
  }
  return Math.max(0, Math.round(balance));
}

function emisRemainingGeneric(loan, viewYear, viewMonth) {
  const startTotal = loan.startYear * 12 + loan.startMonth;
  const curTotal   = viewYear * 12 + viewMonth;
  const paid = curTotal - startTotal + 1;
  return Math.max(0, loan.totalEmis - paid);
}

/* ── Net worth key & ensure ─────────────────────────────── */
function nwKey(year, month) {
  return `${year}-${String(month).padStart(2,'0')}`;
}

function ensureNwMonth(year, month) {
  const k = nwKey(year, month);
  if (!state.networth[k]) {
    // Try to carry forward from previous month
    let prev = null;
    let prevYear = year, prevMonth = month - 1;
    if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
    const prevKey = nwKey(prevYear, prevMonth);
    if (state.networth[prevKey]) {
      const p = state.networth[prevKey];
      prev = {
        equity: p.equity || 0,
        epf:    p.epf    || 0,
        bank:   p.bank   || 0,
        cash:   p.cash   || 0,
        cc:     p.cc     || 0,
        gold:   JSON.parse(JSON.stringify(p.gold || [])),
        fd:     JSON.parse(JSON.stringify(p.fd   || [])),
        rd:     JSON.parse(JSON.stringify(p.rd   || [])),
      };
    }
    state.networth[k] = prev || { equity:0, epf:0, bank:0, cash:0, cc:0, gold:[], fd:[], rd:[] };
  }
  const d = state.networth[k];
  if (!Array.isArray(d.gold)) d.gold = [];
  if (!Array.isArray(d.fd))   d.fd   = [];
  if (!Array.isArray(d.rd))   d.rd   = [];
  return d;
}

/* ── Savings breakdown for Net Worth ────────────────────── */
function calcInvestmentBreakdown(viewYear, viewMonth) {
  const startTotal = 2026 * 12 + 5; // June 2026
  const viewTotal  = viewYear * 12 + viewMonth;
  const savingKeys = new Set([...SAVINGS_CATS, ...INSPOOL_CATS].map(c => c.key));

  let priorAutomatic = 0; // Jun 2026 up to but not including viewed month
  let currentMonth   = 0; // viewed month only

  Object.keys(state.months).forEach(key => {
    const parts = key.split('-');
    if (parts.length < 2) return;
    const yr = parseInt(parts[0]);
    const mo = parseInt(parts[1]);
    if (isNaN(yr) || isNaN(mo)) return;
    const kTotal = yr * 12 + mo;
    if (kTotal < startTotal) return;

    const monthData = state.months[key];
    if (!monthData) return;

    let monthSum = 0;
    if (monthData.actuals) {
      Object.keys(monthData.actuals).forEach(catKey => {
        if (savingKeys.has(catKey)) monthSum += (monthData.actuals[catKey] || 0);
      });
    }
    if (Array.isArray(monthData.transactions)) {
      monthData.transactions.forEach(txn => {
        if (txn.type === 'saving') monthSum += (txn.amount || 0);
      });
    }

    if (kTotal < viewTotal) priorAutomatic += monthSum;
    else if (kTotal === viewTotal) currentMonth = monthSum;
  });

  // Check for manual override on prior
  const k = `${viewYear}-${String(viewMonth).padStart(2,'0')}`;
  const override = state.networth?.[k]?.invPriorOverride;
  const prior = override !== undefined ? override : (state.nwPriorInvest || 0) + priorAutomatic;
  const total = prior + currentMonth;
  return { prior, currentMonth, total, isOverridden: override !== undefined };
}

function calcSavingsFromInvestments() {
  const b = calcInvestmentBreakdown(state.nwViewYear, state.nwViewMonth);
  return b.total;
}

/* ── Gold price fetch ───────────────────────────────────── */
// International XAU spot × INDIA_GOLD_MARKUP ≈ Indian retail 24K price
// Markup accounts for ~10% import duty + 3% GST + small margin
// Update INDIA_GOLD_MARKUP if policy changes (budget announcements etc.)
const INDIA_GOLD_MARKUP = 1.15;

async function fetchGoldRate() {
  const endpoints = [
    async () => {
      const r = await fetch(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json',
        { signal: AbortSignal.timeout(6000) }
      );
      const d = await r.json();
      // d.xau.inr = value of 1 troy oz in INR (international spot)
      if (d && d.xau && d.xau.inr) return Math.round((d.xau.inr / 31.1035) * INDIA_GOLD_MARKUP);
    },
    async () => {
      const r = await fetch(
        'https://latest.currency-api.pages.dev/v1/currencies/xau.json',
        { signal: AbortSignal.timeout(6000) }
      );
      const d = await r.json();
      if (d && d.xau && d.xau.inr) return Math.round((d.xau.inr / 31.1035) * INDIA_GOLD_MARKUP);
    },
    async () => {
      const r = await fetch('https://api.metals.live/v1/spot/gold', { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d && d.price) return Math.round((d.price * 84 / 31.1035) * INDIA_GOLD_MARKUP);
    },
  ];

  for (const fn of endpoints) {
    try {
      const rate = await fn();
      if (rate && rate > 1000) {
        nwGoldRatePerGram = rate;
        break;
      }
    } catch { /* try next */ }
  }

  const rateEl = document.getElementById('nwGoldRate');
  if (rateEl) {
    rateEl.textContent = nwGoldRatePerGram > 0
      ? `24K: ${fmtINR(nwGoldRatePerGram)}/g (approx)`
      : 'Enter ₹ value manually';
  }
  if (state.currentPage === 'networth') renderNetworthPage();
}

/* ── Date picker ────────────────────────────────────────── */
function initNwDatePicker() {
  const monthSel = document.getElementById('nwMonthSel');
  const yearSel  = document.getElementById('nwYearSel');
  if (!monthSel || !yearSel) return;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  monthSel.innerHTML = MONTHS.map((mn,i) =>
    `<option value="${i}" ${i===state.nwViewMonth?'selected':''}>${mn}</option>`
  ).join('');
  yearSel.innerHTML = '';
  for (let y = 2026; y <= 2035; y++) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === state.nwViewYear) opt.selected = true;
    yearSel.appendChild(opt);
  }
  monthSel.onchange = () => { state.nwViewMonth = parseInt(monthSel.value); saveState(); renderNetworthPage(); };
  yearSel.onchange  = () => { state.nwViewYear  = parseInt(yearSel.value);  saveState(); renderNetworthPage(); };
}

/* ── Main render ────────────────────────────────────────── */
function renderNetworthPage() {
  const y = state.nwViewYear;
  const m = state.nwViewMonth;
  const d = ensureNwMonth(y, m);

  initNwDatePicker();

  // Investment breakdown
  const invBreakdown = calcInvestmentBreakdown(y, m);
  const savingsAuto  = invBreakdown.total;

  // Gold — cumulative up to current period from global ledger
  const periodKey = `${y}-${String(m + 1).padStart(2, '0')}`; // e.g. '2026-06'
  const goldTotal = (state.goldEntries || []).reduce((sum, g) => {
    const entryMonth = g.date ? g.date.substring(0, 7) : null; // '2026-06'
    if (!entryMonth || entryMonth <= periodKey) {
      return sum + (nwGoldRatePerGram > 0 && g.grams ? g.grams * nwGoldRatePerGram : (g.amount || 0));
    }
    return sum;
  }, 0);
  const fdTotal = d.fd.reduce((s,r) => s + (r.amount||0), 0);
  const rdTotal = d.rd.reduce((s,r) => s + (r.amount||0), 0);

  const totalAssets = (d.equity||0) + (d.epf||0) + (d.bank||0) + (d.cash||0) + savingsAuto + goldTotal + fdTotal + rdTotal;

  // Loans
  const loansEl = document.getElementById('nwLoansList');
  let totalLoans = 0;
  if (loansEl) {
    if (!state.loans || state.loans.length === 0) {
      loansEl.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0;">No loans added.</div>`;
    } else {
      loansEl.innerHTML = state.loans.map((loan, i) => {
        const outstanding = calcLoanOutstandingGeneric(loan, y, m);
        const remaining   = emisRemainingGeneric(loan, y, m);
        totalLoans += outstanding;
        return `
          <div class="nw-field" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0;">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
              <span class="nw-field-label">${loan.name} <span class="nw-loan-auto">Auto</span></span>
              <span style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;">${fmtINR(outstanding)}</span>
                <button class="nw-row-del" onclick="deleteLoan(${i})" title="Remove">✕</button>
              </span>
            </div>
            <div style="font-size:10px;color:var(--muted);">
              ₹${loan.principal.toLocaleString('en-IN')} @ ${loan.ratePA}% · EMI ₹${loan.emi.toLocaleString('en-IN')} · ${remaining > 0 ? remaining + ' EMIs left' : 'Fully paid'}
            </div>
          </div>`;
      }).join('');
    }
  }

  const totalLiabilities = totalLoans + (d.cc||0);
  const netWorth = totalAssets - totalLiabilities;

  // Hero
  const hvEl = document.getElementById('nwHeroValue');
  if (hvEl) { hvEl.textContent = fmtINR(netWorth); hvEl.style.color = netWorth >= 0 ? 'var(--accent)' : 'var(--red)'; }
  const hsEl = document.getElementById('nwHeroSub');
  if (hsEl) hsEl.textContent = `${fmtINR(totalAssets)} assets − ${fmtINR(totalLiabilities)} liabilities`;

  // Simple fields
  ['equity','epf','bank','cash'].forEach(f => {
    const el = document.getElementById(`nwv-${f}`);
    if (el) el.innerHTML = `${fmtINR(d[f]||0)} <span class="edit-hint">✎</span>`;
  });
  const savEl = document.getElementById('nwv-savings');
  if (savEl) savEl.textContent = fmtINR(invBreakdown.total);

  // Investments breakdown card
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const prevMonthLabel = m > 0
    ? `till ${MONTHS[m-1]} ${y}`
    : `till Dec ${y-1}`;
  const curMonthLabel = `${MONTHS[m]} ${y}`;

  const lp = document.getElementById('nwInvPriorLabel');   if (lp) lp.textContent = prevMonthLabel;
  const lc = document.getElementById('nwInvCurLabel');     if (lc) lc.textContent = curMonthLabel;
  const ip = document.getElementById('nwv-inv-prior');
  if (ip) ip.innerHTML = `${fmtINR(invBreakdown.prior)}${invBreakdown.isOverridden ? ' <span class="nw-loan-auto" style="color:var(--orange);">edited</span>' : ''} <span class="edit-hint">✎</span>`;
  const ic = document.getElementById('nwv-inv-current');   if (ic) ic.textContent = fmtINR(invBreakdown.currentMonth);
  const it = document.getElementById('nwv-inv-total');     if (it) it.textContent = fmtINR(invBreakdown.total);
  const pe = document.getElementById('nwPriorEditVal');    if (pe) pe.textContent = fmtINR(state.nwPriorInvest||0);
  const ccEl = document.getElementById('nwv-cc');
  if (ccEl) ccEl.innerHTML = `${fmtINR(d.cc||0)} <span class="edit-hint">✎</span>`;

  // Gold rate label
  const rateEl = document.getElementById('nwGoldRate');
  if (rateEl) rateEl.textContent = nwGoldRatePerGram > 0 ? `24K: ${fmtINR(nwGoldRatePerGram)}/g` : 'Rate unavailable';

  // Rows
  renderGoldRows(y, m);
  renderNwRows('nwFdRows',   d.fd,   'fd');
  renderNwRows('nwRdRows',   d.rd,   'rd');
  el('nwGoldTotal') && (el('nwGoldTotal').textContent = fmtINR(goldTotal));
  el('nwFdTotal')   && (el('nwFdTotal').textContent   = fmtINR(fdTotal));
  el('nwRdTotal')   && (el('nwRdTotal').textContent   = fmtINR(rdTotal));

  // Totals
  el('nwTotalAssets')      && (el('nwTotalAssets').textContent      = fmtINR(totalAssets));
  el('nwTotalLiabilities') && (el('nwTotalLiabilities').textContent = fmtINR(totalLiabilities));

  renderNwHistory();
}

function el(id) { return document.getElementById(id); }

/* ── Row rendering ──────────────────────────────────────── */
function renderNwRows(containerId, rows, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:4px 0;">No entries yet.</div>`;
    return;
  }
  container.innerHTML = rows.map((r, i) => {
    let valText = '';
    if (type === 'gold') {
      const grams = r.grams || 0;
      const val   = nwGoldRatePerGram > 0 ? fmtINR(grams * nwGoldRatePerGram) : (r.amount ? fmtINR(r.amount) : '—');
      valText = `${grams}g = ${val}`;
    } else {
      valText = fmtINR(r.amount || 0);
    }
    return `
      <div class="nw-row-item">
        <span class="nw-row-label">${r.name || '—'}</span>
        <span class="nw-row-val">${valText}</span>
        <button class="nw-row-del" onclick="deleteNwRow('${type}',${i})" title="Remove">✕</button>
      </div>`;
  }).join('');
}

/* ── Gold Rows — grouped by month, collapsible ──────────── */
function renderGoldRows(viewYear, viewMonth) {
  const container = document.getElementById('nwGoldRows');
  if (!container) return;

  const entries = state.goldEntries || [];
  if (entries.length === 0) {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:4px 0;">No entries yet.</div>`;
    return;
  }

  const periodKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`; // e.g. '2026-06'

  // Group all entries by month key
  const grouped = {};
  entries.forEach((g, idx) => {
    const mk = g.date ? g.date.substring(0, 7) : periodKey;
    if (!grouped[mk]) grouped[mk] = [];
    grouped[mk].push({ ...g, _idx: idx });
  });

  // Sort month keys descending (newest first), but only show <= periodKey
  const monthKeys = Object.keys(grouped)
    .filter(mk => mk <= periodKey)
    .sort((a, b) => b.localeCompare(a));

  if (monthKeys.length === 0) {
    container.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:4px 0;">No entries yet.</div>`;
    return;
  }

  const currentMonthKey = monthKeys[0]; // newest visible = current period or last with entries
  const historyKeys     = monthKeys.slice(1);

  function monthGroupHTML(mk, entries, isHistory) {
    const totalGrams = entries.reduce((s, g) => s + (g.grams || 0), 0);
    const totalVal   = nwGoldRatePerGram > 0
      ? fmtINR(totalGrams * nwGoldRatePerGram)
      : fmtINR(entries.reduce((s, g) => s + (g.amount || 0), 0));
    const [yr, moStr] = mk.split('-');
    const moIdx = parseInt(moStr, 10) - 1;
    const label = `${MONTH_NAMES[moIdx]} ${yr}`;
    const groupId = `gold-group-${mk.replace('-', '')}`;

    const rowsHTML = entries.map(g => {
      const grams = g.grams || 0;
      const val   = nwGoldRatePerGram > 0 ? fmtINR(grams * nwGoldRatePerGram) : (g.amount ? fmtINR(g.amount) : '—');
      const dateLabel = g.date ? g.date : mk + '-01';
      return `
        <div class="nw-row-item" style="padding-left:12px;font-size:11px;">
          <span class="nw-row-label" style="color:var(--muted);">${dateLabel}</span>
          <span class="nw-row-val">${grams}g = ${val}</span>
          <button class="nw-row-del" onclick="deleteGoldEntry(${g._idx})" title="Remove">✕</button>
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:6px;">
        <div class="nw-row-item" style="cursor:pointer;" onclick="toggleGoldGroup('${groupId}')">
          <span class="nw-row-label" style="font-weight:600;">${label}</span>
          <span class="nw-row-val">${totalGrams}g = ${totalVal}</span>
          <span id="${groupId}-arrow" style="font-size:10px;color:var(--muted);margin-left:6px;">${isHistory ? '▶' : '▼'}</span>
        </div>
        <div id="${groupId}" style="display:${isHistory ? 'none' : 'block'};">
          ${rowsHTML}
        </div>
      </div>`;
  }

  let html = monthGroupHTML(currentMonthKey, grouped[currentMonthKey], false);

  if (historyKeys.length > 0) {
    const historyToggleId = 'goldHistoryToggle';
    const historyId       = 'goldHistoryBlock';
    html += `
      <div style="margin-top:4px;">
        <button class="nw-add-btn" style="width:100%;font-size:10px;padding:4px 0;" onclick="toggleGoldHistory()">
          <span id="${historyToggleId}">▶ Show history (${historyKeys.length} month${historyKeys.length>1?'s':''})</span>
        </button>
        <div id="${historyId}" style="display:none;margin-top:6px;">
          ${historyKeys.map(mk => monthGroupHTML(mk, grouped[mk], true)).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

function toggleGoldGroup(groupId) {
  const block = document.getElementById(groupId);
  const arrow = document.getElementById(groupId + '-arrow');
  if (!block) return;
  const isHidden = block.style.display === 'none';
  block.style.display = isHidden ? 'block' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
}

function toggleGoldHistory() {
  const block   = document.getElementById('goldHistoryBlock');
  const toggleEl = document.getElementById('goldHistoryToggle');
  if (!block) return;
  const isHidden = block.style.display === 'none';
  block.style.display = isHidden ? 'block' : 'none';
  if (toggleEl) {
    const count = (state.goldEntries||[]).length;
    toggleEl.textContent = isHidden
      ? '▲ Hide history'
      : `▶ Show history`;
  }
}

function deleteGoldEntry(index) {
  if (!state.goldEntries || !state.goldEntries[index]) return;
  state.goldEntries.splice(index, 1);
  saveState();
  renderNetworthPage();
  toast('Removed', 'success');
}


function renderNwHistory() {
  const container = document.getElementById('nwHistory');
  const chartEl   = document.getElementById('nwTrendChart');
  if (!container) return;

  const entries = Object.keys(state.networth)
    .sort((a,b) => a.localeCompare(b))
    .slice(-12)
    .map(k => {
      const d   = state.networth[k];
      const [yr, mo] = k.split('-').map(Number);
      const loanTotal = (state.loans||[]).reduce((s,loan) => s + calcLoanOutstandingGeneric(loan,yr,mo), 0);
      const pk = `${yr}-${String(mo + 1).padStart(2, '0')}`;
      const goldT = (state.goldEntries||[]).reduce((s,g) => {
        const em = g.date ? g.date.substring(0,7) : null;
        return (!em || em <= pk) ? s + (nwGoldRatePerGram>0&&g.grams?g.grams*nwGoldRatePerGram:g.amount||0) : s;
      }, 0);
      const fdT   = (d.fd||[]).reduce((s,r)=>s+(r.amount||0),0);
      const rdT   = (d.rd||[]).reduce((s,r)=>s+(r.amount||0),0);
      const sav   = calcSavingsFromInvestments();
      const assets = (d.equity||0)+(d.epf||0)+(d.bank||0)+(d.cash||0)+sav+goldT+fdT+rdT;
      const liab   = loanTotal + (d.cc||0);
      return { k, yr, mo, nw: assets - liab };
    });

  // Render trend chart (SVG line chart)
  if (chartEl && entries.length > 1) {
    const vals   = entries.map(e => e.nw);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const range  = maxVal - minVal || 1;
    const W = 800, H = 100, pad = 20;
    const xStep = (W - pad*2) / (entries.length - 1);
    const yScale = v => H - pad - ((v - minVal) / range) * (H - pad*2);
    const points = entries.map((e,i) => `${pad + i*xStep},${yScale(e.nw)}`).join(' ');
    const areaPoints = `${pad},${H-pad} ` + points + ` ${pad + (entries.length-1)*xStep},${H-pad}`;

    chartEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#nwGrad)"/>
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${entries.map((e,i) => `
          <circle cx="${pad + i*xStep}" cy="${yScale(e.nw)}" r="3" fill="var(--accent)"/>
          <text x="${pad + i*xStep}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${monthLabel(e.yr,e.mo).split(' ')[0]}</text>
        `).join('')}
      </svg>`;
  } else if (chartEl) {
    chartEl.innerHTML = `<div style="font-size:11px;color:var(--muted);text-align:center;padding:20px 0;">Add data for 2+ months to see trend</div>`;
  }

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">No snapshots yet. Enter values above to start tracking.</div>`;
    return;
  }
  // Show table in reverse order (newest first)
  container.innerHTML = [...entries].reverse().map(e => `
    <div class="nw-history-row">
      <span class="nw-history-month">${monthLabel(e.yr, e.mo)}</span>
      <span class="nw-history-val" style="color:${e.nw>=0?'var(--green)':'var(--red)'}">${fmtINR(e.nw)}</span>
    </div>`).join('');
}

/* ── NW Row Modal ───────────────────────────────────────── */
let _nwRowType = null;

function addNwRow(type) {
  _nwRowType = type;
  const titles = { gold:'Add Gold Entry', fd:'Add Fixed Deposit', rd:'Add Recurring Deposit' };
  document.getElementById('nwRowModalTitle').textContent = titles[type] || 'Add Entry';
  document.getElementById('nwRowName').value   = '';
  document.getElementById('nwRowGrams').value  = '';
  document.getElementById('nwRowAmount').value = '';
  document.getElementById('nwRowGramsGroup').style.display  = type==='gold' ? 'block' : 'none';
  document.getElementById('nwRowAmountGroup').style.display = 'block';
  document.getElementById('nwRowDateGroup').style.display   = type==='gold' ? 'block' : 'none';
  const nalEl = document.getElementById('nwRowAmountLabel'); if (nalEl) nalEl.textContent = type==='gold' ? 'Fallback Value ₹ (if rate unavailable)' : 'Amount (₹)';
  // Default date to today
  const dateEl = document.getElementById('nwRowDate');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  document.getElementById('nwRowModalBg').style.display     = 'flex';
}

function closeNwRowModal() {
  document.getElementById('nwRowModalBg').style.display = 'none';
  _nwRowType = null;
}

function saveNwRow() {
  const y = state.nwViewYear;
  const m = state.nwViewMonth;
  const d = ensureNwMonth(y, m);
  const name   = document.getElementById('nwRowName').value.trim();
  const amount = validateAmount(document.getElementById('nwRowAmount').value) || 0;

  if (_nwRowType === 'gold') {
    const grams = validateAmount(document.getElementById('nwRowGrams').value) || 0;
    if (!grams && !amount) { toast('Enter grams or amount', 'error'); return; }
    const dateEl = document.getElementById('nwRowDate');
    const date = (dateEl && dateEl.value) ? dateEl.value : `${y}-${String(m+1).padStart(2,'0')}-01`;
    if (!state.goldEntries) state.goldEntries = [];
    state.goldEntries.push({ date, grams, amount, name: name || 'Gold' });
  } else {
    if (!amount) { toast('Enter amount', 'error'); return; }
    d[_nwRowType].push({ name: name||(_nwRowType==='fd'?'FD':'RD'), amount });
  }
  saveState();
  closeNwRowModal();
  renderNetworthPage();
  toast('Entry saved', 'success');
}

function deleteNwRow(type, index) {
  const d = ensureNwMonth(state.nwViewYear, state.nwViewMonth);
  d[type].splice(index, 1);
  saveState();
  renderNetworthPage();
  toast('Removed', 'success');
}

/* ── Simple field edit ──────────────────────────────────── */
const NW_FIELD_LABELS = {
  equity:'Equity Portfolio (₹)', epf:'EPF Balance (₹)',
  bank:'Bank Balance (₹)',       cash:'Cash in Hand (₹)',
  cc:'Credit Card Outstanding (₹)',
};

function editPriorInvest() {
  const current = state.nwPriorInvest || 0;
  const val = prompt(`Opening Investment Balance (₹)\nTotal invested from earning start till May 2026\nCurrent: ${fmtINR(current)}\n\nEnter amount:`, current);
  if (val === null) return;
  const parsed = validateAmount(val);
  if (parsed === null) { toast('Invalid amount — enter a positive number', 'error'); return; }
  state.nwPriorInvest = parsed;
  saveState();
  renderNetworthPage();
  toast('Opening balance updated', 'success');
}

function editInvPrior() {
  // Allow manual override of the auto-calculated prior for current month
  const breakdown = calcInvestmentBreakdown(state.nwViewYear, state.nwViewMonth);
  const current = breakdown.prior;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = state.nwViewMonth > 0
    ? `till ${MONTHS[state.nwViewMonth-1]} ${state.nwViewYear}`
    : `till Dec ${state.nwViewYear-1}`;
  const val = prompt(`Prior Investments (${label})\nAuto-calculated: ${fmtINR(current)}\n\nOverride amount (or leave blank to use auto):`, current);
  if (val === null || val.trim() === '') return;
  const parsed = validateAmount(val);
  if (parsed === null) { toast('Invalid amount', 'error'); return; }
  // Store override in networth month data
  const k = `${state.nwViewYear}-${String(state.nwViewMonth).padStart(2,'0')}`;
  if (!state.networth[k]) state.networth[k] = { equity:0, epf:0, bank:0, cash:0, cc:0, gold:[], fd:[], rd:[] };
  state.networth[k].invPriorOverride = parsed;
  saveState();
  renderNetworthPage();
  toast('Prior investments overridden', 'success');
}

function editNwField(field) {
  const d = ensureNwMonth(state.nwViewYear, state.nwViewMonth);
  const current = d[field] || 0;
  const val = prompt(`${NW_FIELD_LABELS[field]}\nCurrent: ${fmtINR(current)}\n\nEnter new amount:`, current);
  if (val === null) return;
  const parsed = validateAmount(val);
  if (parsed === null) { toast('Invalid amount — enter a positive number', 'error'); return; }
  d[field] = parsed;
  saveState();
  renderNetworthPage();
  toast('Updated', 'success');
}

function copyFromPrevMonth() {
  const y = state.nwViewYear;
  const m = state.nwViewMonth;
  let prevYear = y, prevMonth = m - 1;
  if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
  const prevKey = nwKey(prevYear, prevMonth);
  const p = state.networth[prevKey];
  if (!p) { toast('No previous month data found', 'error'); return; }
  if (!confirm(`Copy all values from ${monthLabel(prevYear, prevMonth)} to ${monthLabel(y, m)}? This will overwrite current values.`)) return;
  const k = nwKey(y, m);
  state.networth[k] = {
    equity: p.equity || 0,
    epf:    p.epf    || 0,
    bank:   p.bank   || 0,
    cash:   p.cash   || 0,
    cc:     p.cc     || 0,
    gold:   JSON.parse(JSON.stringify(p.gold || [])),
    fd:     JSON.parse(JSON.stringify(p.fd   || [])),
    rd:     JSON.parse(JSON.stringify(p.rd   || [])),
  };
  saveState();
  renderNetworthPage();
  toast(`Copied from ${monthLabel(prevYear, prevMonth)}`, 'success');
}


function openLoanModal() {
  const lmtEl = document.getElementById('loanModalTitle'); if (lmtEl) lmtEl.textContent = 'Add Loan';
  document.getElementById('loanName').value       = '';
  document.getElementById('loanPrincipal').value  = '';
  document.getElementById('loanRate').value       = '';
  document.getElementById('loanEmi').value        = '';
  document.getElementById('loanTotalEmis').value  = '';
  document.getElementById('loanStartYear').value  = '2026';
  document.getElementById('loanModalBg').style.display = 'flex';
}

function closeLoanModal() {
  document.getElementById('loanModalBg').style.display = 'none';
}

function saveLoan() {
  const name       = document.getElementById('loanName').value.trim();
  const principal  = validateAmount(document.getElementById('loanPrincipal').value) || 0;
  const ratePA     = validateAmount(document.getElementById('loanRate').value) || 0;
  const emi        = validateAmount(document.getElementById('loanEmi').value) || 0;
  const totalEmis  = parseInt(document.getElementById('loanTotalEmis').value) || 0;
  const startMonth = parseInt(document.getElementById('loanStartMonth').value);
  const startYear  = parseInt(document.getElementById('loanStartYear').value) || 2026;

  if (!name)       { toast('Enter loan name', 'error'); return; }
  if (!principal)  { toast('Enter principal', 'error'); return; }
  if (!ratePA)     { toast('Enter interest rate', 'error'); return; }
  if (!emi)        { toast('Enter EMI', 'error'); return; }
  if (!totalEmis)  { toast('Enter total EMIs', 'error'); return; }

  if (!state.loans) state.loans = [];
  state.loans.push({
    id: 'loan_' + Date.now(),
    name, principal, ratePA, emi, totalEmis, startYear, startMonth
  });
  saveState();
  closeLoanModal();
  renderNetworthPage();
  toast('Loan added', 'success');
}

function deleteLoan(index) {
  if (!confirm(`Remove "${state.loans[index].name}"?`)) return;
  state.loans.splice(index, 1);
  saveState();
  renderNetworthPage();
  toast('Loan removed', 'success');
}

// Fetch gold rate on load
fetchGoldRate();
