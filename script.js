const API = "http://127.0.0.1:5000";
let CurrentUser = null;
let AppBootstrapped = false;
function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "₹0.00";
    const abs = Math.abs(+n);
    const [int, dec] = abs.toFixed(2).split(".");
    const last3 = int.slice(-3), rest = int.slice(0,-3);
    return "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g,",")+","+last3 : last3) + "." + dec;
}
function fmtK(n) {
    const v = Math.abs(+n);
    if (v >= 100000) return "₹" + (v/100000).toFixed(1) + "L";
    if (v >= 1000)   return "₹" + (v/1000).toFixed(1) + "K";
    return "₹" + v.toFixed(0);
}
function shortDesc(desc) {
    if (!desc) return "Unknown";
    const m = (desc.split("/")[1] || desc.split("/")[0] || desc).trim();
    return m.length > 32 ? m.slice(0,32)+"…" : m;
}
function clr(n) { return +n >= 0 ? "#10b981" : "#ef4444"; }
function setText(id, v) { const e = document.getElementById(id); if(e) e.textContent = v; }
function setAuthError(message = "") {
    const el = document.getElementById("auth-error");
    if (el) el.textContent = message;
}
function setAuthMode(mode = "login") {
    document.querySelectorAll("[data-auth-tab]").forEach(btn => {
        const active = btn.dataset.authTab === mode;
        btn.classList.toggle("active", active);
        btn.classList.toggle("text-slate-400", !active);
    });
    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    if (loginForm) loginForm.style.display = mode === "login" ? "" : "none";
    if (signupForm) signupForm.style.display = mode === "signup" ? "" : "none";
    setAuthError("");
}
function setAuthOverlay(visible) {
    const overlay = document.getElementById("auth-overlay");
    if (overlay) overlay.style.display = visible ? "flex" : "none";
}
function applyUserProfile(user) {
    CurrentUser = user || null;
    const displayName = user?.display_name || user?.username || "Guest";
    const initial = (displayName[0] || "G").toUpperCase();
    setText("user-name", displayName);
    setText("user-avatar", initial);
    setText("welcome-heading", `Welcome, ${displayName}!`);
    const bank = document.getElementById("user-bank");
    if (bank && (!MLState.activeReport || !MLState.activeReport.name)) {
        bank.textContent = user ? `@${user.username} account` : "Sign in to continue";
    }
}
async function authRequest(path, payload) {
    const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Authentication failed");
    return data;
}
async function ensureAuthenticated() {
    try {
        const response = await fetch(`${API}/api/auth/me`);
        const data = await response.json();
        if (data.authenticated && data.user) {
            applyUserProfile(data.user);
            setAuthOverlay(false);
            return true;
        }
    } catch (e) {
        console.warn("Auth:", e.message);
    }
    applyUserProfile(null);
    setAuthOverlay(true);
    return false;
}
async function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById("login-username")?.value?.trim() || "";
    const password = document.getElementById("login-password")?.value || "";
    if (!username || !password) {
        setAuthError("Enter both username and password.");
        return;
    }
    try {
        const data = await authRequest("/api/auth/login", { username, password });
        applyUserProfile(data.user);
        setAuthOverlay(false);
        await bootstrapAuthenticatedApp();
        showToast("Login successful.");
    } catch (e) {
        setAuthError(e.message);
    }
}
async function handleSignupSubmit(event) {
    event.preventDefault();
    const display_name = document.getElementById("signup-display-name")?.value?.trim() || "";
    const username = document.getElementById("signup-username")?.value?.trim() || "";
    const password = document.getElementById("signup-password")?.value || "";
    const confirm_password = document.getElementById("signup-confirm-password")?.value || "";
    if (display_name.length < 2) {
        setAuthError("Display name must be at least 2 characters.");
        return;
    }
    if (username.length < 3) {
        setAuthError("Username must be at least 3 characters.");
        return;
    }
    if (password.length < 6) {
        setAuthError("Password must be at least 6 characters.");
        return;
    }
    if (password !== confirm_password) {
        setAuthError("Passwords do not match.");
        return;
    }
    try {
        const data = await authRequest("/api/auth/signup", { display_name, username, password, confirm_password });
        applyUserProfile(data.user);
        setAuthOverlay(false);
        await bootstrapAuthenticatedApp();
        showToast("Account created successfully.");
    } catch (e) {
        setAuthError(e.message);
    }
}
async function handleLogout() {
    try {
        await authRequest("/api/auth/logout", {});
    } catch (e) {
        console.warn("Logout:", e.message);
    }
    CurrentUser = null;
    MLState = { data: null, allTxns: [], snapshots: [], filedReports: [], activeReportId: null, activeReport: null };
    applyUserProfile(null);
    setAuthMode("login");
    setAuthOverlay(true);
    location.reload();
}
function showToast(msg, type) {
    document.getElementById("fin-toast")?.remove();
    const t = document.createElement("div");
    t.id = "fin-toast";
    const bg = type==="red" ? "#dc2626" : type==="amber" ? "#d97706" : "#059669";
    t.style.cssText = `position:fixed;bottom:2rem;right:2rem;z-index:9999;background:${bg};color:#fff;padding:.75rem 1.4rem;border-radius:.75rem;font-size:.8rem;font-weight:600;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:340px;transition:opacity .3s;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity="0"; setTimeout(()=>t.remove(),300); }, 4000);
}
function showSection(id, evt) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
    document.querySelectorAll(".nav-item").forEach(i => { i.classList.remove("active"); i.classList.add("text-slate-400"); });
    if (evt?.currentTarget) { evt.currentTarget.classList.add("active"); evt.currentTarget.classList.remove("text-slate-400"); }
    if (MLState.data) {
        if (id === "dashboard")    renderDashboardML(MLState.data);
        if (id === "transactions") renderTransactionsML(MLState.data);
        if (id === "reports")      loadReportClusters();
    }
    if (id === "goals") loadGoals();
    if (id === "investments") loadStockPrices();
}
var MLState = { data: null, allTxns: [], snapshots: [], filedReports: [], activeReportId: null, activeReport: null };
function getActiveReportQuery() {
    return MLState.activeReportId ? `?report_id=${encodeURIComponent(MLState.activeReportId)}` : "";
}
function renderReportDataset(data) {
    const summary = data.summary || {};
    const cats = ["Food","Shopping","Utilities","Entertainment","Transfer","Others"];
    if (_charts["clusterBarChart"]) {
        _charts["clusterBarChart"].data.datasets[0].data = cats.map(c => summary[c]?.total || 0);
        _charts["clusterBarChart"].update();
    }
    const reportTotal = document.getElementById("report-total");
    if (reportTotal) reportTotal.textContent = fmtK(data.spent || 0);
    const chips = document.getElementById("rpt-chips");
    if (chips) {
        const items = [
            ["Income", data.income || 0, "text-emerald-400"],
            ["Spent", data.spent || 0, "text-red-400"],
            ["Net", data.net || 0, (data.net || 0) >= 0 ? "text-emerald-400" : "text-red-400"],
            ["Transactions", data.total_txns || 0, "text-slate-200"],
        ];
        chips.innerHTML = items.map(([label, value, klass]) => `
            <div class="p-3 rounded-xl bg-white/5 border border-white/5">
                <p class="text-[10px] text-slate-500 uppercase tracking-wider">${label}</p>
                <p class="mt-1 text-sm font-bold ${klass}">${label === "Transactions" ? value : fmtK(value)}</p>
            </div>
        `).join("");
    }
    const tbody = document.getElementById("rpt-body");
    if (tbody) {
        const rows = Object.entries(summary).sort((a,b)=>b[1].total-a[1].total);
        tbody.innerHTML = rows.length
            ? rows.map(([cat, stats]) => `
                <tr class="border-b border-white/5">
                    <td class="py-2 text-sm">${cat}</td>
                    <td class="py-2 text-center text-xs text-slate-400">${stats.count || 0}</td>
                    <td class="py-2 text-right text-xs font-mono text-slate-300">${fmt(stats.avg || 0)}</td>
                    <td class="py-2 text-right text-xs font-mono" style="color:${stats.color || "#6b7280"}">${fmt(stats.total || 0)}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="4" class="py-6 text-center text-xs text-slate-500">No category breakdown available.</td></tr>`;
    }
}
function applyDataset(data) {
    if (!data) return;
    if (data.user) applyUserProfile(data.user);
    MLState.data = data;
    MLState.allTxns = data.transactions || [];
    MLState.filedReports = data.filed_reports || MLState.filedReports || [];
    MLState.activeReport = data.active_report || null;
    MLState.activeReportId = data.active_report?.id || null;
    renderDashboardML(data);
    renderTransactionsML(data);
    renderInvestmentsML(data.investments || {});
    renderGoals(data.saved_goals || [], data.achieved_goals || [], data.goal_stats || {});
    renderMLInsights(data);
    renderAnomalies(data.anomalies || []);
    renderForecast(data.forecast || {}, data.summary || {});
    renderReportDataset(data);
    renderFiledReports(MLState.filedReports);
    const ub = document.getElementById("user-bank");
    if (ub) {
        if (MLState.activeReport) {
            ub.textContent = `${MLState.activeReport.name} · filtered view`;
        } else {
            ub.textContent = CurrentUser ? `@${CurrentUser.username} account` : "All Statements · combined view";
        }
    }
    const dp = document.getElementById("data-pill");
    if (dp) {
        dp.style.display = "block";
        dp.textContent = MLState.activeReport ? "Filtered Report" : "Saved Data";
    }
}
async function loadActiveDataset(reportId = null) {
    MLState.activeReportId = reportId || null;
    const query = MLState.activeReportId ? `?report_id=${encodeURIComponent(MLState.activeReportId)}` : "";
    const data = await fetch(`${API}/api/bootstrap${query}`).then(r=>r.json());
    applyDataset(data);
    return data;
}
let _charts = {};
function mkChart(id, cfg) {
    if (typeof Chart === "undefined") return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch(e){} }
    const ctx = document.getElementById(id); if (!ctx) return;
    if (!cfg.options) cfg.options = {};
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = false;
    try { _charts[id] = new Chart(ctx, cfg); } catch(e) { console.warn("chart", id, e); }
}
function initCharts() {
    const dark = { x:{display:false}, y:{display:false} };
    mkChart("trendsChart", {type:"line", data:{labels:["W1","W2","W3","W4"],datasets:[{data:[0,0,0,0],borderColor:"#10b981",tension:0.4,fill:true,backgroundColor:"rgba(16,185,129,0.05)"}]},
        options:{plugins:{legend:{display:false}},scales:dark}});
    mkChart("liquidityPie", {type:"doughnut", data:{labels:["Used","Remaining"],datasets:[{data:[65,35],backgroundColor:["#10b981","#1e293b"],borderWidth:0}]},
        options:{cutout:"80%",plugins:{legend:{display:false}}}});
    mkChart("modeBarChart", {type:"bar", data:{labels:["UPI","Card","Net Banking","ATM","Bank"],datasets:[{data:[0,0,0,0,0],backgroundColor:"#10b981",borderRadius:5}]},
        options:{plugins:{legend:{display:false}},scales:{y:{grid:{color:"rgba(255,255,255,0.05)"},ticks:{color:"#64748b",callback:v=>fmtK(v)}}}}});
    mkChart("clusterBarChart", {type:"bar",
        data:{labels:["Food","Shopping","Utilities","Entertainment","Others"],datasets:[{data:[0,0,0,0,0],backgroundColor:["#f59e0b","#a855f7","#3b82f6","#ef4444","#6b7280"],borderRadius:8,barThickness:30}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
                 scales:{y:{beginAtZero:true,grid:{color:"rgba(255,255,255,0.05)"},ticks:{color:"#64748b",font:{size:10},callback:v=>fmtK(v)}},
                         x:{grid:{display:false},ticks:{color:"#f8fafc",font:{size:10}}}}}});
}
function renderDashboardML(data) {
    const income = data.income||0, spent = data.spent||0, net = data.net||0, rate = data.savings_rate||0;
    const txns = data.transactions||[], summary = data.summary||{}, cashflow = data.cashflow||[];
    setText("dash-credit", "+" + fmt(income));
    setText("dash-debit",  "-" + fmt(spent));
    const ne = document.getElementById("dash-net");
    if (ne) { ne.textContent = fmt(Math.abs(net)); ne.className = "text-xl font-bold mt-1 " + (net>=0?"text-emerald-500":"text-red-400"); }
    setText("dash-savings-rate", rate + "% savings rate");
    setText("dash-tx-count", txns.length);
    const credits = txns.filter(t=>t.amount>0).length;
    const debits  = txns.filter(t=>t.amount<0).length;
    setText("dash-credit-sub", credits + " credits");
    setText("dash-debit-sub",  debits  + " debits");
    const cf = cashflow.slice(-20);
    if (cf.length) {
        mkChart("trendsChart", {type:"line", data:{
            labels: cf.map(c=>c.date.slice(5)),
            datasets:[
                {label:"Income", data:cf.map(c=>c.income), borderColor:"#10b981",borderWidth:2,tension:.4,pointRadius:0,fill:true,backgroundColor:"rgba(16,185,129,0.08)"},
                {label:"Spent",  data:cf.map(c=>c.spent),  borderColor:"#ef4444",borderWidth:2,tension:.4,pointRadius:0,fill:true,backgroundColor:"rgba(239,68,68,0.06)"}
            ]},
            options:{plugins:{legend:{display:false}},scales:{
                x:{ticks:{color:"#4a5568",font:{size:9}},grid:{display:false}},
                y:{ticks:{color:"#4a5568",font:{size:9},callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}
            }}});
    }
    const cats = Object.keys(summary).sort((a,b)=>summary[b].total-summary[a].total).slice(0,6);
    const vals = cats.map(c=>summary[c].total);
    const cols = cats.map(c=>summary[c].color||"#6b7280");
    if (cats.length) {
        mkChart("liquidityPie", {type:"doughnut", data:{labels:cats, datasets:[{data:vals,backgroundColor:cols,borderWidth:0,hoverOffset:6}]},
            options:{cutout:"68%",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>" "+fmt(c.raw)}}}}});
        const legEl = document.getElementById("donut-legend");
        const tot = vals.reduce((a,b)=>a+b,0)||1;
        if (legEl) legEl.innerHTML = cats.slice(0,5).map((c,i)=>
            `<div class="flex justify-between items-center text-xs"><div class="flex items-center gap-1.5"><span style="width:7px;height:7px;border-radius:50%;background:${cols[i]};display:inline-block;"></span>${c}</div><span class="font-mono" style="color:${cols[i]};">${((vals[i]/tot)*100).toFixed(0)}%</span></div>`
        ).join("");
    }
    renderCategoryBars(summary);
}
async function loadDashboard() {
    try {
        const { summary, clusters } = await fetch(`${API}/dashboard`).then(r=>r.json());
        if (!MLState.data) {
            const cr = summary.total_credit||0, db = summary.total_debit||0, net = summary.net_position||0;
            setText("dash-credit", "+" + fmt(cr));
            setText("dash-debit",  "-" + fmt(db));
            const ne = document.getElementById("dash-net");
            if (ne) { ne.textContent = fmt(Math.abs(net)); ne.className="text-xl font-bold mt-1 "+(net>=0?"text-emerald-500":"text-red-400"); }
        }
    } catch(e) { console.warn("Dashboard:", e.message); }
}
function renderCategoryBars(summary) {
    const el = document.getElementById("dash-cats"); if(!el) return;
    const cats = Object.keys(summary).sort((a,b)=>summary[b].total-summary[a].total).slice(0,5);
    const tot  = cats.reduce((s,c)=>s+summary[c].total,0)||1;
    el.innerHTML = cats.map(c=>{
        const pct = Math.round(summary[c].total/tot*100);
        const col = summary[c].color||"#6b7280";
        return `<div class="mb-3">
            <div class="flex justify-between mb-1">
                <span class="text-xs flex items-center gap-1.5"><span style="width:7px;height:7px;border-radius:50%;background:${col};display:inline-block;"></span>${c}</span>
                <span class="text-xs font-mono" style="color:${col};">${fmt(summary[c].total)}</span>
            </div>
            <div class="h-1.5 rounded-full bg-white/5"><div style="width:${pct}%;background:${col};height:100%;border-radius:9999px;transition:width .6s ease;"></div></div>
        </div>`;
    }).join("");
}
function renderTransactionsML(data) {
    const txns = data.transactions||[], summary = data.summary||{}, mode_breakdown = data.mode_breakdown||{};
    const mKeys = Object.keys(mode_breakdown);
    const mColors = ["#10b981","#06b6d4","#f59e0b","#a855f7","#ef4444"];
    if (mKeys.length) mkChart("modeBarChart", {type:"bar", data:{labels:mKeys,datasets:[{
        data:mKeys.map(k=>mode_breakdown[k]), backgroundColor:mKeys.map((_,i)=>mColors[i%5]), borderRadius:5}]},
        options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#4a5568"},grid:{display:false}},y:{ticks:{color:"#64748b"},grid:{color:"rgba(255,255,255,0.05)"}}}}});
    const cats = Object.keys(summary).sort((a,b)=>summary[b].total-summary[a].total);
    const vals = cats.map(c=>summary[c].total);
    const cols = cats.map(c=>summary[c].color||"#6b7280");
    if (cats.length) mkChart("txCatChart", {type:"bar", data:{labels:cats,datasets:[{
        data:vals, backgroundColor:cols, borderRadius:5}]},
        options:{indexAxis:"y", plugins:{legend:{display:false}},
                 scales:{x:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}},y:{ticks:{color:"#9ca3af"},grid:{display:false}}}}});
    const bills = data.bills||[];
    const billsEl = document.getElementById("bills-list");
    if (billsEl) billsEl.innerHTML = bills.length ? bills.map(b=>
        `<div class="flex justify-between items-center p-3 rounded-xl ${b.urgent?"bg-amber-500/10 border border-amber-500/30":"bg-white/5"} mb-2">
            <div><p class="text-sm font-semibold">${b.name}</p><p class="text-xs text-slate-500">${b.due} · ${b.category}</p></div>
            <span class="font-bold text-sm" style="color:${b.urgent?"#f59e0b":"#f8fafc"};">${fmt(b.amount)}</span>
        </div>`).join("") : `<p class="text-xs text-slate-500">No recurring bills detected.</p>`;
    const anomalies = data.anomalies||[];
    const awEl = document.getElementById("anom-warning");
    const acEl = document.getElementById("anom-count");
    if (awEl) awEl.style.display = anomalies.length ? "" : "none";
    if (acEl) acEl.textContent = anomalies.length;
    MLState.allTxns = txns;
    renderTxTable(txns);
}
var _txTableExpanded = false;
var _txTableData     = [];
const TX_INITIAL     = 5;
function buildTxRows(txns) {
    return txns.map(t => {
        const col  = t.color || "#6b7280";
        return `<tr class="border-b border-white/5 hover:bg-white/5 transition">
            <td class="py-2 text-xs font-mono text-slate-400 whitespace-nowrap">${t.date}</td>
            <td class="py-2 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-sm" title="${t.description||""}">${shortDesc(t.description)}</td>
            <td class="py-2"><span class="text-xs px-2 py-0.5 rounded-full font-semibold" style="background:${col}18;color:${col};">${t.category||"—"}</span></td>
            <td class="py-2 text-xs text-slate-400">${t.mode||"—"}</td>
            <td class="py-2 text-right font-bold text-sm font-mono" style="color:${clr(t.amount)}">${t.amount>0?"+":""}${fmt(t.amount)}</td>
            <td class="py-2 text-right text-xs font-mono text-slate-400">${fmt(t.balance||0)}</td>
        </tr>`;
    }).join("");
}
function renderTxViewMoreFooter(total, shown) {
    const remaining = total - shown;
    if (remaining <= 0) return "";
    return `<tr id="tx-view-more-row">
        <td colspan="6" class="pt-4 pb-2 text-center">
            <button onclick="expandTxTable()"
                class="inline-flex items-center gap-2 px-5 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-xl transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                View More &nbsp;<span class="opacity-60">(${remaining} remaining)</span>
            </button>
        </td>
    </tr>`;
}
function renderTxCollapseFooter() {
    return `<tr id="tx-collapse-row">
        <td colspan="6" class="pt-4 pb-2 text-center">
            <button onclick="collapseTxTable()"
                class="inline-flex items-center gap-2 px-5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 text-xs font-bold rounded-xl transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
                Show Less
            </button>
        </td>
    </tr>`;
}
function renderTxTable(txns) {
    const el = document.getElementById("recent-txn-list-full"); if (!el) return;
    if (!txns.length) {
        el.innerHTML = `<tr><td colspan="6" class="text-center text-xs text-slate-500 py-6">No transactions found.</td></tr>`;
        return;
    }
    _txTableData     = txns.slice().reverse().slice(0, 50); // newest first, cap at 50
    _txTableExpanded = false;
    const visible    = _txTableData.slice(0, TX_INITIAL);
    el.innerHTML = buildTxRows(visible) + renderTxViewMoreFooter(_txTableData.length, visible.length);
}
function expandTxTable() {
    const el = document.getElementById("recent-txn-list-full"); if (!el) return;
    _txTableExpanded = true;
    el.innerHTML = buildTxRows(_txTableData) + renderTxCollapseFooter();
}
function collapseTxTable() {
    const el = document.getElementById("recent-txn-list-full"); if (!el) return;
    _txTableExpanded = false;
    const visible = _txTableData.slice(0, TX_INITIAL);
    el.innerHTML = buildTxRows(visible) + renderTxViewMoreFooter(_txTableData.length, visible.length);
    el.closest(".overflow-x-auto")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function loadTransactions(period="1M") {
    try {
        const data = await fetch(`${API}/transactions?period=${period}`).then(r=>r.json());
        if (!MLState.data && data.mode_counts) {
            const m = data.mode_counts;
            if (_charts["modeBarChart"]) {
                _charts["modeBarChart"].data.datasets[0].data = [m.UPI||0,m.Card||0,m["Net Banking"]||0,m.ATM||0,m.Bank||0];
                _charts["modeBarChart"].update();
            }
        }
        if (!document.getElementById("recent-txn-list-full")) {
        }
    } catch(e) { console.warn("Transactions:", e.message); }
}
async function hydratePersistedState() {
    try {
        const data = await loadActiveDataset(null);
        if (!data || !Array.isArray(data.transactions) || !data.transactions.length) return;
    } catch (e) {
        console.warn("Bootstrap:", e.message);
    }
}
async function bootstrapAuthenticatedApp() {
    if (!AppBootstrapped) AppBootstrapped = true;
    await hydratePersistedState();
    await Promise.all([loadDashboard(), loadReportClusters(), loadGoals()]);
    await loadTransactions("1M");
    rptTab("overview");
}
function updatePeriod(period, evt) {
    document.querySelectorAll(".active-period").forEach(b=>b.classList.remove("bg-emerald-500","text-white","active-period"));
    evt?.currentTarget?.classList.add("bg-emerald-500","text-white","active-period");
    loadTransactions(period);
}
async function loadGoals() {
    try {
        const data = await fetch(`${API}/goals`).then(r=>r.json());
        renderGoals(data.goals||[], data.achieved_goals||[], data.stats||{});
    } catch(e) { console.warn("Goals:", e.message); }
}
function renderGoals(goals, achieved, stats = {}) {
    const el = document.getElementById("goals-list");
    const btnNewGoal = document.getElementById("btn-new-goal");
    const monthly = Number(stats.monthly_savings ?? (MLState.data?.goal_stats?.monthly_savings ?? MLState.data?.goal_projection?.monthly_savings ?? 0));
    const savingsRate = Number(stats.savings_rate ?? (MLState.data?.goal_stats?.savings_rate ?? MLState.data?.goal_projection?.savings_rate ?? 0));
    const achievedCount = Number(stats.achieved_count ?? achieved.length ?? 0);
    const activeCount = Number(stats.active_count ?? goals.length ?? 0);
    const totalTarget = Number(stats.total_target ?? goals.reduce((sum, g) => sum + (+g.target || 0), 0));
    const totalSaved = Number(stats.total_saved ?? goals.reduce((sum, g) => sum + (+g.saved || 0), 0));
    const msave = monthly;
    if (!el) return;
    setText("g-monthly", fmt(monthly));
    setText("g-rate-val", `${savingsRate.toFixed(1)}%`);
    setText("g-achieved-count", String(achievedCount));
    if (btnNewGoal) btnNewGoal.textContent = goals.length ? "+ New Goal" : "Add New Goal";
    if (!goals.length) {
        el.innerHTML = `
            <div class="glass-card p-6 text-center">
                <p class="text-sm font-semibold text-slate-200">No ongoing goals</p>
                <p class="text-xs text-slate-500 italic mt-2">Active goals: ${activeCount} · Saved: ${fmt(totalSaved)} · Target: ${fmt(totalTarget)}</p>
                <button onclick="document.getElementById('goal-modal')?.classList.add('open')" class="mt-4 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm rounded-xl transition">Add New Goal</button>
            </div>`;
    } else {
        el.innerHTML = goals.map(g=>{
            const pct = Math.min(100, g.percent||0);
            const col = g.color||"#10b981";
            const rem = g.target - (g.saved||0);
            const mn  = msave > 0 ? (rem/msave).toFixed(1) : "—";
            const onTrack = msave > 0 && parseFloat(mn) <= 12;
            return `<div class="glass-card p-5 mb-4">
                <div class="flex justify-between items-start mb-3">
                    <div><p class="font-bold">${g.name}</p><p class="text-xs text-slate-400">Target ${fmt(g.target)} · Deadline: ${g.deadline||"Open"}</p></div>
                    <span class="text-2xl font-black" style="color:${col};">${pct.toFixed(0)}%</span>
                </div>
                <div class="h-2 rounded-full bg-white/5 mb-3"><div style="width:${pct}%;background:${col};height:100%;border-radius:9999px;transition:width .6s ease;"></div></div>
                <div class="flex justify-between text-xs text-slate-400 mb-3">
                    <span style="color:${col};">Saved: ${fmt(g.saved||0)}</span>
                    <span>Remaining: ${fmt(rem)}</span>
                </div>
                ${msave > 0 ? `<div class="text-xs font-semibold px-3 py-2 rounded-lg mb-3" style="color:${onTrack?"#10b981":"#f59e0b"};background:${onTrack?"rgba(16,185,129,.08)":"rgba(245,158,11,.08)"};">${onTrack?`On track — ~${mn} months`:`~${mn} months needed`}</div>` : ""}
                <div class="flex gap-2">
                    <button onclick="openAddMoney('${g.id}','${g.name}',${g.target},${g.saved||0})" class="flex-1 py-2 text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition">+ Add Money</button>
                    <button onclick="deleteGoal('${g.id}')" class="px-4 py-2 text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition">Delete</button>
                </div>
            </div>`;
        }).join("");
    }
    const achEl = document.getElementById("achieved-goals-list");
    if (achEl) {
        if (!achieved.length) {
            achEl.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-3">No goals achieved yet — keep saving!</p>`;
        } else {
            achEl.innerHTML = achieved.map(g=>`
                <div class="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                    <div class="w-8 h-8 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
                    </div>
                    <div class="flex-1 min-w-0"><p class="text-sm font-bold text-emerald-400 truncate">${g.name}</p>
                    <p class="text-xs text-slate-400">Target ${fmt(g.target)} · Achieved ${g.achieved_at}</p></div>
                    <span class="text-xs font-bold text-emerald-400 shrink-0">DONE 🏆</span>
                </div>`).join("");
        }
    }
    mkChart("goalForecastChart", {type:"bar", data:{
        labels:["M+1","M+2","M+3","M+4","M+5","M+6"],
        datasets:[{data:[1,2,3,4,5,6].map(i=>Math.max(0, +(msave*i).toFixed(0))), backgroundColor:"rgba(16,185,129,.6)",borderRadius:5}]},
        options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#4a5568"},grid:{display:false}},y:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}}}});
}
let _addMoneyId = null;
function openAddMoney(id, name, target, saved) {
    _addMoneyId = id;
    setText("add-money-title", `${name} — ${fmt(saved)} saved`);
    setText("add-money-remain", `Remaining: ${fmt(target - saved)}`);
    const inp = document.getElementById("add-money-amount"); if(inp) inp.value="";
    document.getElementById("add-money-modal")?.classList.add("open");
}
async function confirmAddMoney() {
    const amt = +(document.getElementById("add-money-amount")?.value||0);
    if (!amt||amt<=0) { showToast("Enter a valid amount","amber"); return; }
    if (!_addMoneyId)  { showToast("No goal selected","red"); return; }
    try {
        const goals = await fetch(`${API}/goals`).then(r=>r.json());
        const g = (goals.goals||[]).find(x=>x.id===_addMoneyId);
        if (!g) return;
        const r = await fetch(`${API}/goals/${_addMoneyId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({saved:(g.saved||0)+amt})}).then(r=>r.json());
        document.getElementById("add-money-modal")?.classList.remove("open");
        if (r.just_completed) showToast("🏆 Goal achieved! Congratulations!");
        else showToast(`✓ Added ${fmt(amt)} to ${g.name}`);
        await loadGoals();
    } catch(e) { showToast("Update failed","red"); }
}
async function deleteGoal(gid) {
    if (!confirm("Delete this goal?")) return;
    try {
        await fetch(`${API}/goals/${gid}`,{method:"DELETE"});
        await loadGoals(); showToast("Goal deleted");
    } catch(e) { showToast("Delete failed","red"); }
}
async function saveGoal() {
    const name     = document.getElementById("g-name")?.value?.trim();
    const target   = +(document.getElementById("g-target")?.value||0);
    const saved    = +(document.getElementById("g-saved")?.value||0);
    const deadline = document.getElementById("g-deadline")?.value?.trim()||"Open";
    const color    = document.getElementById("g-color")?.value||"#10b981";
    if (!name||!target) { showToast("Fill goal name and target amount","amber"); return; }
    try {
        await fetch(`${API}/goals`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,target,saved,deadline,color})});
        document.getElementById("goal-modal")?.classList.remove("open");
        ["g-name","g-target","g-saved","g-deadline"].forEach(id=>{const e=document.getElementById(id);if(e)e.value="";});
        await loadGoals(); showToast("✓ Goal created!");
    } catch(e) { showToast("Failed to save goal","red"); }
}
const STOCK_BASE = {NIFTY:24142.70,SENSEX:72831.94,GOLD:14110.00,SILVER:260.00};
async function loadStockPrices() {
    try {
        const {prices} = await fetch(`${API}/investments/prices`).then(r=>r.json());
        [["NIFTY","nifty-price"],["SENSEX","sensex-price"],["GOLD","gold-price"],["SILVER","silver-price"]].forEach(([sym,id])=>{
            const el = document.getElementById(id); if(!el||!prices[sym]) return;
            const p = prices[sym];
            el.className = "text-sm font-mono " + (p.change>=0?"text-emerald-500":"text-red-400");
            el.textContent = "₹" + p.price.toLocaleString("en-IN");
        });
    } catch(e) { console.warn("Stock prices:", e.message); }
}
function renderInvestmentsML(inv) {
    if (!inv) return;
    const detected = inv.detected_txns||[];
    const total    = inv.total_invested||0;
    setText("inv-total-amount", fmt(total));
    setText("inv-tx-count", String(detected.length));
    const detEl = document.getElementById("inv-detected");
    if (detEl) {
        if (!detected.length) {
            detEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No investment transactions detected yet.</p>`;
        } else {
            detEl.innerHTML = `<table class="w-full text-sm"><thead><tr class="text-slate-500 text-xs border-b border-white/5"><th class="pb-2 text-left">Date</th><th class="pb-2 text-left">Description</th><th class="pb-2 text-right">Amount</th></tr></thead><tbody>` +
                detected.map(t=>`<tr class="border-b border-white/5"><td class="py-2 text-xs font-mono text-slate-400 whitespace-nowrap">${t.date}</td><td class="py-2 truncate max-w-[200px]">${t.name}</td><td class="py-2 text-right font-bold text-purple-400">${fmt(t.amount)}</td></tr>`).join("") +
                `</tbody></table><div class="flex justify-between mt-3 pt-3 border-t border-white/5"><span class="text-xs text-slate-400">Total invested</span><span class="font-bold text-purple-400">${fmt(total)}</span></div>`;
        }
    }
    if (detected.length) {
        mkChart("inv-chart", {type:"bar", data:{
            labels: detected.map(t=>t.name.slice(0,16)),
            datasets:[{data:detected.map(t=>t.amount), backgroundColor:"rgba(168,85,247,.7)", borderRadius:7}]},
            options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#64748b",font:{size:10}},grid:{display:false}},y:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}}}});
    }
}
var _rptStagedFile = null;
async function loadReportClusters() {
    try {
        const {filed_reports} = await fetch(`${API}/reports`).then(r=>r.json());
        MLState.filedReports = filed_reports || [];
        renderFiledReports(MLState.filedReports);
        if (MLState.data) renderReportDataset(MLState.data);
        await loadTrendAnalysis();
    } catch(e) { console.warn("Reports:", e.message); }
}
async function loadTrendAnalysis() {
    try {
        const {monthly} = await fetch(`${API}/api/trends${getActiveReportQuery()}`).then(r=>r.json());
        if (!monthly || !monthly.length) return;
        renderTrendCharts(monthly);
        renderMonthComparisonTable(monthly);
    } catch(e) { console.warn("Trends:", e.message); }
}
function renderTrendCharts(monthly) {
    const labels = monthly.map(m=>m.month);
    const incomes = monthly.map(m=>m.income);
    const spents  = monthly.map(m=>m.spent);
    const nets    = monthly.map(m=>m.net);
    mkChart("trendIncomeSpentChart", {type:"bar", data:{
        labels, datasets:[
            {label:"Income", data:incomes, backgroundColor:"rgba(16,185,129,.7)",  borderRadius:5},
            {label:"Spent",  data:spents,  backgroundColor:"rgba(239,68,68,.6)", borderRadius:5}
        ]},
        options:{plugins:{legend:{labels:{color:"#9ca3af",font:{size:10}}}},
                 scales:{x:{ticks:{color:"#4a5568"},grid:{display:false}},y:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}}}});
    mkChart("trendNetChart", {type:"line", data:{
        labels, datasets:[{label:"Net Savings", data:nets, borderColor:"#10b981",borderWidth:2,tension:.4,
            pointRadius:4, fill:true, backgroundColor:"rgba(16,185,129,0.06)"}]},
        options:{plugins:{legend:{display:false}},
                 scales:{x:{ticks:{color:"#4a5568"},grid:{display:false}},y:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}}}});
}
function renderMonthComparisonTable(monthly) {
    const el = document.getElementById("month-compare-table"); if (!el) return;
    if (!monthly.length) { el.innerHTML=`<p class="text-xs text-slate-500">No data yet.</p>`; return; }
    const maxSpent = Math.max(...monthly.map(m=>m.spent));
    el.innerHTML = `<table class="w-full text-sm">
        <thead><tr class="text-xs text-slate-500 border-b border-white/5">
            <th class="pb-2 text-left">Month</th>
            <th class="pb-2 text-right">Income</th>
            <th class="pb-2 text-right">Spent</th>
            <th class="pb-2 text-right">Net</th>
        </tr></thead>
        <tbody>` +
        monthly.slice().reverse().map(m=>`
        <tr class="border-b border-white/5 ${m.spent===maxSpent?"bg-red-500/5":""}">
            <td class="py-2 font-mono text-xs text-slate-400">${m.month}</td>
            <td class="py-2 text-right text-emerald-500 font-mono text-xs">${fmtK(m.income)}</td>
            <td class="py-2 text-right font-mono text-xs" style="color:${m.spent===maxSpent?"#ef4444":"#f8fafc"};">${fmtK(m.spent)}${m.spent===maxSpent?' 🔴':''}</td>
            <td class="py-2 text-right font-mono text-xs" style="color:${m.net>=0?"#10b981":"#ef4444"};">${fmtK(m.net)}</td>
        </tr>`).join("") +
        `</tbody></table>`;
}
function renderFiledReports(reports) {
    const el = document.getElementById("filed-reports-list"); if(!el) return;
    if (!reports.length) { el.innerHTML=`<p class="text-xs text-slate-500 text-center py-4">No reports filed yet.</p>`; return; }
    el.innerHTML = reports.map(r=>`
        <div class="flex items-center justify-between p-3 bg-white/5 rounded-xl text-xs hover:bg-white/10 transition mb-2">
            <div class="flex-1 min-w-0 mr-3">
                <p class="font-semibold truncate">${r.name}</p>
                <p class="text-slate-500 mt-0.5">${r.period||r.filed_at||""} · ${r.tx_count||0} txns</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="text-emerald-500 font-semibold">Filed</span>
                <button onclick="downloadReportExcel('${r.id}','${r.name}')" class="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md font-bold transition" title="Download Excel">⬇ Excel</button>
                <button onclick="deleteReport('${r.id}')" class="text-red-400 hover:text-red-300 font-bold px-1 transition" title="Delete">✕</button>
            </div>
        </div>`).join("");
}
function renderFiledReports(reports) {
    const el = document.getElementById("filed-reports-list"); if(!el) return;
    if (!reports.length) { el.innerHTML=`<p class="text-xs text-slate-500 text-center py-4">No reports filed yet.</p>`; return; }
    const allActive = !MLState.activeReportId;
    const allCard = `
        <button onclick="showAllReports()" class="w-full text-left flex items-center justify-between p-3 rounded-xl text-xs transition mb-2 border ${allActive ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/5 hover:bg-white/10"}">
            <div class="flex-1 min-w-0 mr-3">
                <p class="font-semibold truncate">All Statements</p>
                <p class="text-slate-500 mt-0.5">Combined graphs and totals</p>
            </div>
            <span class="${allActive ? "text-emerald-400" : "text-slate-400"} font-semibold">${allActive ? "Active" : "View"}</span>
        </button>`;
    el.innerHTML = allCard + reports.map(r=>`
        <div class="flex items-center justify-between p-3 rounded-xl text-xs transition mb-2 border ${MLState.activeReportId===r.id ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/5 hover:bg-white/10"}">
            <div class="flex-1 min-w-0 mr-3">
                <button onclick="viewReport('${r.id}')" class="w-full text-left">
                    <p class="font-semibold truncate">${r.name}</p>
                    <p class="text-slate-500 mt-0.5">${r.period||r.filed_at||""} · ${r.tx_count||0} txns</p>
                </button>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="${MLState.activeReportId===r.id ? "text-emerald-400" : "text-emerald-500"} font-semibold">${MLState.activeReportId===r.id ? "Active" : "Filed"}</span>
                <button onclick="downloadReportExcel('${r.id}','${r.name}')" class="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md font-bold transition" title="Download Excel">Excel</button>
                <button onclick="deleteReport('${r.id}')" class="text-red-400 hover:text-red-300 font-bold px-1 transition" title="Delete">X</button>
            </div>
        </div>`).join("");
}
async function viewReport(rid) {
    try {
        await loadActiveDataset(rid);
        await loadReportClusters();
    } catch (e) {
        showToast("Failed to load selected report.", "red");
    }
}
async function showAllReports() {
    try {
        await loadActiveDataset(null);
        await loadReportClusters();
    } catch (e) {
        showToast("Failed to load combined data.", "red");
    }
}
async function downloadReportExcel(rid, name) {
    showToast("Generating Excel report…");
    try {
        const r = await fetch(`${API}/api/report/download/${rid}`);
        if (r.ok) {
            const blob = await r.blob();
            _triggerDownload(blob, `FinUP_${name}_Categorised.xlsx`);
            showToast("✓ Excel report downloaded!");
            return;
        }
    } catch(e) {}
    if (MLState.data) {
        try {
            const r2 = await fetch(`${API}/api/report/rebuild`, {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ml_result: MLState.data, account: MLState.data.account||{}})
            });
            if (r2.ok) {
                _triggerDownload(await r2.blob(), "FinUP_Categorised_Report.xlsx");
                showToast("✓ Excel report downloaded!");
                return;
            }
        } catch(e) {}
    }
    if (MLState.data) {
        downloadCSV(MLState.data);
    } else {
        showToast("No data to export. Upload a statement first.","amber");
    }
}
function downloadCSV(data) {
    const txns = data.transactions||[];
    if (!txns.length) { showToast("No transactions to export","amber"); return; }
    const rows = [["Date","Description","Category","Mode","Confidence %","Amount","Balance"]];
    txns.forEach(t=>rows.push([t.date, `"${(t.description||"").replace(/"/g,"'")}"`, t.category||"", t.mode||"", (t.confidence||0).toFixed(1), t.amount, t.balance||0]));
    const csv = rows.map(r=>r.join(",")).join("\n");
    _triggerDownload(new Blob([csv],{type:"text/csv"}), "FinUP_Transactions.csv");
    showToast("✓ CSV downloaded!");
}
function downloadCurrentReport() {
    if (!MLState.data) { showToast("Upload a statement first","amber"); return; }
    fetch(`${API}/api/report/rebuild`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ml_result:MLState.data, account:MLState.data.account||{}})
    }).then(r=>{
        if (r.ok) return r.blob().then(b=>{ _triggerDownload(b,"FinUP_Report.xlsx"); showToast("✓ Excel downloaded!"); });
        return Promise.reject("server error");
    }).catch(()=>{
        downloadCSV(MLState.data);
    });
}
function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a"); a.href=url; a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
}
async function deleteReport(rid) {
    if (!confirm("Remove this report and all its transactions?")) return;
    try {
        await fetch(`${API}/reports/${rid}`, {method:"DELETE"});
        const nextReportId = MLState.activeReportId === rid ? null : MLState.activeReportId;
        await loadActiveDataset(nextReportId);
        await loadReportClusters();
        showToast("Report removed.");
    } catch(e) { showToast("Failed to delete report.","red"); }
}
function stageReportFile(file) {
    _rptStagedFile = file;
    const fl = document.getElementById("fileName");
    const pb = document.getElementById("process-btn");
    if (fl) fl.textContent = file.name;
    if (pb) {
        pb.disabled = false;
        pb.className = "mt-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold transition cursor-pointer";
    }
    showToast(`✓ "${file.name}" ready — click Process & Analyse`);
}
async function processClusters() {
    if (!_rptStagedFile) { showToast("Choose a file first (.xlsx / .csv / .pdf)","amber"); return; }
    const btn = document.getElementById("process-btn");
    if (btn) { btn.textContent="Analysing…"; btn.disabled=true; }
    const overlay = document.getElementById("proc-overlay");
    const procMsg = document.getElementById("proc-msg");
    if (overlay) overlay.style.display = "flex";
    if (procMsg) procMsg.textContent = "Running ML analysis on " + _rptStagedFile.name + "…";
    try {
        const fd = new FormData(); fd.append("file", _rptStagedFile);
        const r  = await fetch(`${API}/api/ml/upload`, {method:"POST", body:fd});
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        MLState.snapshots.push({ml_result:data, account:data.account||{}});
        await loadActiveDataset(null);
        await loadReportClusters();
        if (data.account?.period) {
            const ub = document.getElementById("user-bank");
            if (ub) ub.textContent = (data.account.bank||"Indian Bank") + " · " + data.account.period.split(" ")[0];
        }
        const dp = document.getElementById("data-pill");
        if (dp) { dp.style.display="block"; dp.textContent="Live Data ✓"; }
        showToast(`✓ ${data.total_txns} transactions analysed! ${data.db_saved ? data.db_saved+" saved to DB" : ""}`);
        showSection("dashboard", null);
        document.querySelectorAll(".nav-item").forEach(i=>i.classList.remove("active"));
        document.querySelector(".nav-item")?.classList.add("active");
    } catch(e) {
        showToast("Analysis failed: " + e.message, "red");
    } finally {
        if (overlay) overlay.style.display = "none";
        if (btn) { btn.textContent = "Process & Analyse"; btn.disabled = false; }
    }
}
function renderMLInsights(data) {
    const el = document.getElementById("rpt-insights"); if(!el) return;
    const insights = data.insights||[];
    el.innerHTML = insights.length
        ? insights.map(t=>`<div class="p-3 bg-white/5 rounded-xl border border-white/5 text-xs text-slate-300 mb-2">${t}</div>`).join("")
        : `<div class="p-3 bg-white/5 rounded-xl text-xs text-slate-500">Upload a statement to see AI insights.</div>`;
}
function renderAnomalies(anomalies) {
    const el = document.getElementById("rpt-anomalies"); if(!el) return;
    if (!anomalies.length) {
        el.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No unusual transactions detected. ✓</p>`;
        return;
    }
    el.innerHTML = anomalies.map(a=>`
        <div class="flex justify-between items-center p-3 bg-red-500/5 border border-red-500/20 rounded-xl mb-2">
            <div><p class="text-sm font-semibold">${shortDesc(a.description)}</p>
            <p class="text-xs text-slate-500">${a.date} · ${a.category}</p></div>
            <p class="text-sm font-bold text-red-400">${fmt(Math.abs(a.amount))}</p>
        </div>`).join("");
}
function renderForecast(forecast, summary) {
    const el = document.getElementById("rpt-forecast-table"); if(!el) return;
    const cats = Object.keys(forecast).filter(c=>forecast[c]>0).sort((a,b)=>forecast[b]-forecast[a]);
    if (!cats.length) { el.innerHTML=`<p class="text-xs text-slate-500 text-center py-4">No forecast available yet.</p>`; return; }
    const total = cats.reduce((s,c)=>s+forecast[c],0);
    setText("rpt-forecast-total", fmtK(total));
    el.innerHTML = cats.map(c=>{
        const col = (summary[c]&&summary[c].color)||"#6b7280";
        return `<div class="flex justify-between items-center py-2.5 border-b border-white/5">
            <div class="flex items-center gap-2"><span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;"></span><span class="text-sm">${c}</span></div>
            <span class="text-sm font-bold" style="color:${col};">${fmtK(forecast[c])}</span>
        </div>`;
    }).join("");
    const fcCats = cats, fcVals = cats.map(c=>forecast[c]), fcCols = cats.map(c=>(summary[c]&&summary[c].color)||"#6b7280");
    mkChart("rptForecast", {type:"bar", data:{labels:fcCats, datasets:[{data:fcVals, backgroundColor:fcCols, borderRadius:5}]},
        options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#9ca3af"},grid:{display:false}},y:{ticks:{color:"#4a5568",callback:v=>fmtK(v)},grid:{color:"rgba(255,255,255,0.05)"}}}}});
}
function rptTab(name) {
    ["overview","table","anomalies","forecast","trends"].forEach(t=>{
        const el = document.getElementById("rpt-tab-"+t);
        if (el) el.style.display = (t===name) ? "" : "none";
    });
    document.querySelectorAll(".rpt-tab-btn[data-tab]").forEach(b=>{
        b.classList.toggle("bg-emerald-500/20", b.dataset.tab===name);
        b.classList.toggle("text-emerald-400",  b.dataset.tab===name);
    });
    if (name === "trends" && MLState.data) {
        loadTrendAnalysis();
    }
}
function bindAuthUI() {
    document.querySelectorAll("[data-auth-tab]").forEach(btn => {
        btn.addEventListener("click", () => setAuthMode(btn.dataset.authTab));
    });
    document.getElementById("login-form")?.addEventListener("submit", handleLoginSubmit);
    document.getElementById("signup-form")?.addEventListener("submit", handleSignupSubmit);
    document.getElementById("logout-btn")?.addEventListener("click", handleLogout);
}
async function wirePayButton() {
    const btn = document.querySelector("button.bg-amber-500");
    if (!btn) return;
    btn.addEventListener("click", async function() {
        this.disabled=true; this.textContent="Processing…";
        try {
            const data = await fetch(`${API}/pay_bills`,{method:"POST"}).then(r=>r.json());
            showToast("Redirecting to payment portal…");
            setTimeout(()=>{ this.textContent="Pay All Now"; this.disabled=false; }, 3000);
        } catch(e) { this.textContent="Pay All Now"; this.disabled=false; }
    });
}
window.addEventListener("DOMContentLoaded", async () => {
    initCharts();
    bindAuthUI();
    setAuthMode("login");
    const fi = document.getElementById("statementFile");
    if (fi && !fi.dataset.bound) {
        fi.dataset.bound = "true";
        fi.addEventListener("change", function(){ if(this.files[0]) stageReportFile(this.files[0]); });
    }
    const dz = document.getElementById("report-drop-zone");
    if (dz) {
        dz.addEventListener("dragover",  e=>{e.preventDefault();dz.classList.add("border-emerald-500");});
        dz.addEventListener("dragleave", ()=>dz.classList.remove("border-emerald-500"));
        dz.addEventListener("drop", e=>{
            e.preventDefault(); dz.classList.remove("border-emerald-500");
            const f = e.dataTransfer?.files?.[0];
            if (f) stageReportFile(f);
        });
    }
    const gModal   = document.getElementById("goal-modal");
    const amModal  = document.getElementById("add-money-modal");
    if (gModal)  gModal.addEventListener("click",  e=>{if(e.target===gModal)  gModal.classList.remove("open");});
    if (amModal) amModal.addEventListener("click", e=>{if(e.target===amModal) amModal.classList.remove("open");});
    const btnNewGoal  = document.getElementById("btn-new-goal");
    const btnCancel   = document.getElementById("btn-cancel-goal");
    const btnSave     = document.getElementById("btn-save-goal");
    const btnCancelAm = document.getElementById("btn-cancel-add-money");
    const btnConfAm   = document.getElementById("btn-confirm-add-money");
    if (btnNewGoal) btnNewGoal.addEventListener("click", ()=>gModal?.classList.add("open"));
    if (btnCancel)  btnCancel.addEventListener("click",  ()=>gModal?.classList.remove("open"));
    if (btnSave)    btnSave.addEventListener("click",    saveGoal);
    if (btnCancelAm) btnCancelAm.addEventListener("click", ()=>amModal?.classList.remove("open"));
    if (btnConfAm)   btnConfAm.addEventListener("click",   confirmAddMoney);
    document.getElementById("add-money-amount")?.addEventListener("keydown", e=>{if(e.key==="Enter") confirmAddMoney();});
    document.getElementById("tx-search")?.addEventListener("input", function(){
        const q = this.value.toLowerCase();
        if (!MLState.allTxns.length) return;
        const filtered = MLState.allTxns.filter(t=>
            (t.description||"").toLowerCase().includes(q)||
            (t.category||"").toLowerCase().includes(q)||
            (t.date||"").includes(q)
        );
        if (q.length > 0) {
            const el = document.getElementById("recent-txn-list-full"); if(!el) return;
            _txTableData     = filtered.slice().reverse();
            _txTableExpanded = true;
            el.innerHTML = buildTxRows(_txTableData) + (filtered.length > TX_INITIAL ? renderTxCollapseFooter() : "");
        } else {
            renderTxTable(MLState.allTxns);
        }
    });
    document.querySelectorAll(".rpt-tab-btn[data-tab]").forEach(b=>{
        b.addEventListener("click", ()=>rptTab(b.dataset.tab));
    });
    wirePayButton();
    loadStockPrices();
    setInterval(loadStockPrices, 15000);
    const authenticated = await ensureAuthenticated();
    if (!authenticated) return;
    await bootstrapAuthenticatedApp();
});
