
"use strict";

const DB_KEY = "expenseflow_pro_multiuser_v2";
const $ = id => document.getElementById(id);

const state = {
  userId: null,
  resetUserId: null,
  page: "overview",
  theme: "light",
  installPrompt: null
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const currentMonth = () => today().slice(0,7);
const cleanName = s => s.trim().replace(/\s+/g," ");
const normalizedName = s => cleanName(s).toLocaleLowerCase();
const id = () => crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(36).slice(2);
const money = n => new Intl.NumberFormat("en-IN", {
  style:"currency", currency:"INR", maximumFractionDigits:2
}).format(Number(n)||0);

function readDB() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
    return {
      users: Array.isArray(d.users) ? d.users : [],
      records: d.records && typeof d.records === "object" ? d.records : {},
      prefs: d.prefs && typeof d.prefs === "object" ? d.prefs : {}
    };
  } catch {
    return { users:[], records:{}, prefs:{} };
  }
}
function writeDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}
async function hash(text) {
  const result = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(text)
  );
  return [...new Uint8Array(result)]
    .map(b => b.toString(16).padStart(2,"0")).join("");
}
async function pinTag(pin) {
  return hash("expenseflow-unique-pin:"+pin);
}
async function secretHash(value, salt) {
  return hash(salt+":"+value);
}
function user() {
  return readDB().users.find(u => u.id === state.userId);
}
function userRecords() {
  return readDB().records[state.userId] || {};
}
function recordFor(date) {
  return userRecords()[date] || {
    date, entries:[], draft:null
  };
}
function allEntries() {
  const records = userRecords();
  return Object.values(records)
    .flatMap(r => (r.entries || []).map(e => ({
      ...e, bucketDate:r.date
    })))
    .sort((a,b) => (b.date||"").localeCompare(a.date||"") ||
      (b.updatedAt||0)-(a.updatedAt||0));
}
function saveRecord(date, record) {
  const db = readDB();
  db.records[state.userId] ||= {};
  db.records[state.userId][date] = record;
  writeDB(db);
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  }[c]));
}

/* Authentication screens */
function showAuth(which) {
  ["loginForm","registerForm","forgotForm","resetForm"].forEach(form => {
    $(form).classList.toggle("hidden", form !== which);
  });
  $("loginTab").classList.toggle("active", which === "loginForm");
  $("registerTab").classList.toggle("active", which === "registerForm");
  $("loginTab").classList.toggle("hidden", ["forgotForm","resetForm"].includes(which));
  $("registerTab").classList.toggle("hidden", ["forgotForm","resetForm"].includes(which));
}
function setTheme(theme, save = true) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content =
    state.theme === "dark" ? "#191c29" : "#6658e8";
  $("authTheme").textContent = state.theme === "dark" ? "☀" : "◐";
  $("mobileTheme").textContent = state.theme === "dark" ? "☀" : "◐";
  $("themeBtn").innerHTML = state.theme === "dark"
    ? '☀ <span>Light theme</span>'
    : '◐ <span>Dark theme</span>';

  if (save) {
    const db = readDB();
    if (state.userId) {
      db.prefs[state.userId] ||= {};
      db.prefs[state.userId].theme = state.theme;
    } else {
      db.prefs.globalTheme = state.theme;
    }
    writeDB(db);
  }
}
function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}
function enterApp(account) {
  state.userId = account.id;
  const db = readDB();
  setTheme(db.prefs[account.id]?.theme || db.prefs.globalTheme || "light", false);
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userName").textContent = account.name;
  $("avatar").textContent = account.name.charAt(0).toUpperCase();
  $("welcome").textContent = `Good to see you, ${account.name.split(/\s+/)[0]}.`;
  $("selectedDate").value = today();
  $("entryDate").value = today();
  $("reportMonth").value = currentMonth();
  showPage("overview");
  renderAll();
}
function logout() {
  state.userId = null;
  $("app").classList.add("hidden");
  $("auth").classList.remove("hidden");
  $("loginPin").value = "";
  $("entryForm").reset();
  showAuth("loginForm");
}

/* Registration: name + unique PIN + birth date */
$("registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = cleanName($("regName").value);
  const pin = $("regPin").value;
  const confirmPin = $("regPin2").value;
  const dob = $("regDob").value;

  if (name.length < 2) return toast("Please enter your full name.");
  if (!/^\d{5}$/.test(pin)) return toast("PIN must be exactly 5 digits.");
  if (pin !== confirmPin) return toast("PINs do not match.");
  if (!dob || dob >= today()) return toast("Enter a valid past date of birth.");

  const db = readDB();
  const tag = await pinTag(pin);
  if (db.users.some(u => u.pinTag === tag)) {
    return toast("This PIN is already used. Please choose another.");
  }

  const salt = id();
  const account = {
    id:id(),
    name,
    dobHash:await secretHash(dob, salt),
    salt,
    pinHash:await secretHash(pin, salt),
    pinTag:tag,
    createdAt:Date.now()
  };

  db.users.push(account);
  db.records[account.id] = {};
  db.prefs[account.id] = {theme:db.prefs.globalTheme || "light"};
  writeDB(db);
  enterApp(account);
  toast("Account created successfully.");
});

/* Login: PIN only */
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const pin = $("loginPin").value;
  if (!/^\d{5}$/.test(pin)) return toast("Enter your 5-digit PIN.");

  const db = readDB();
  const tag = await pinTag(pin);
  const account = db.users.find(u => u.pinTag === tag);
  if (!account) return toast("PIN not found. Try Forgot PIN.");

  if (await secretHash(pin, account.salt) !== account.pinHash) {
    return toast("Incorrect PIN.");
  }

  enterApp(account);
  toast("Welcome back, "+account.name.split(/\s+/)[0]+".");
});

/* Forgot PIN: name + DOB */
$("forgotForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = normalizedName($("forgotName").value);
  const dob = $("forgotDob").value;
  const accounts = readDB().users.filter(u => normalizedName(u.name) === name);
  let match = null;

  for (const account of accounts) {
    if (await secretHash(dob, account.salt) === account.dobHash) {
      match = account;
      break;
    }
  }

  if (!match) {
    return toast("Name or date of birth could not be verified.");
  }

  state.resetUserId = match.id;
  $("resetInfo").textContent =
    `Identity verified for ${match.name}. Choose a new unique PIN.`;
  showAuth("resetForm");
});

/* Reset PIN; uniqueness is checked again */
$("resetForm").addEventListener("submit", async event => {
  event.preventDefault();
  const pin = $("newPin").value;
  const confirmPin = $("newPin2").value;

  if (!/^\d{5}$/.test(pin)) return toast("PIN must be exactly 5 digits.");
  if (pin !== confirmPin) return toast("PINs do not match.");

  const db = readDB();
  const account = db.users.find(u => u.id === state.resetUserId);
  if (!account) return toast("Recovery expired. Start again.");

  const tag = await pinTag(pin);
  if (db.users.some(u => u.id !== account.id && u.pinTag === tag)) {
    return toast("That PIN is already in use. Choose another.");
  }

  account.pinTag = tag;
  account.pinHash = await secretHash(pin, account.salt);
  writeDB(db);

  state.resetUserId = null;
  $("resetForm").reset();
  $("loginPin").value = "";
  showAuth("loginForm");
  toast("PIN reset successfully. Login with your new PIN.");
});

/* Navigation and theme */
function showPage(page) {
  state.page = page;
  ["overview","transactions","reports"].forEach(p => {
    $(p+"Page").classList.toggle("hidden", p !== page);
  });
  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  $("pageTitle").textContent =
    page === "overview" ? "Overview" :
    page === "transactions" ? "Transactions" : "Reports";

  if (page === "transactions") renderAllTransactions();
  if (page === "reports") renderReports();
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-page]").forEach(button =>
  button.addEventListener("click", () => showPage(button.dataset.page))
);
document.querySelectorAll("[data-go]").forEach(button =>
  button.addEventListener("click", () => showPage(button.dataset.go))
);
$("loginTab").addEventListener("click", () => showAuth("loginForm"));
$("registerTab").addEventListener("click", () => showAuth("registerForm"));
$("forgotBtn").addEventListener("click", () => showAuth("forgotForm"));
$("backLogin").addEventListener("click", () => showAuth("loginForm"));
$("cancelReset").addEventListener("click", () => {
  state.resetUserId = null;
  showAuth("loginForm");
});
["authTheme","themeBtn","mobileTheme"].forEach(id =>
  $(id).addEventListener("click", toggleTheme)
);
$("logoutBtn").addEventListener("click", () => {
  if (confirm("Log out? Your saved data will remain in this browser.")) logout();
});

/* Entry form */
function resetEntryForm() {
  $("entryForm").reset();
  $("editId").value = "";
  $("entryDate").value = $("selectedDate").value || today();
  $("entryType").value = "expense";
  $("entryCategory").value = "Food";
  $("cancelEdit").classList.add("hidden");
}
$("addBtn").addEventListener("click", () => {
  $("entryTitle").focus();
  $("entryForm").scrollIntoView({behavior:"smooth",block:"center"});
});
$("cancelEdit").addEventListener("click", resetEntryForm);
$("selectedDate").addEventListener("change", () => {
  resetEntryForm();
  renderAll();
});

$("entryForm").addEventListener("submit", event => {
  event.preventDefault();

  const editId = $("editId").value;
  const date = $("entryDate").value;
  const amount = Number($("entryAmount").value);
  const title = $("entryTitle").value.trim();

  if (!date) return toast("Choose a transaction date.");
  if (!title) return toast("Enter a description.");
  if (!Number.isFinite(amount) || amount <= 0) {
    return toast("Enter an amount greater than zero.");
  }

  const entry = {
    id:editId || id(),
    type:$("entryType").value,
    title,
    amount,
    category:$("entryCategory").value,
    date,
    note:$("entryNote").value.trim(),
    updatedAt:Date.now()
  };

  const db = readDB();
  db.records[state.userId] ||= {};

  // Editing removes the old copy from whichever day contains it.
  if (editId) {
    for (const bucketDate of Object.keys(db.records[state.userId])) {
      const record = db.records[state.userId][bucketDate];
      record.entries = (record.entries || []).filter(e => e.id !== editId);
    }
  }

  const record = db.records[state.userId][date] || {
    date, entries:[], draft:null
  };
  record.entries ||= [];
  record.entries.push(entry);
  record.date = date;
  record.updatedAt = Date.now();
  db.records[state.userId][date] = record;
  writeDB(db);

  $("selectedDate").value = date;
  resetEntryForm();
  renderAll();
  $("saveStatus").textContent = "Saved just now";
  toast(editId ? "Transaction updated." : "Transaction saved.");
});

function editEntry(entryId) {
  const entry = allEntries().find(e => e.id === entryId);
  if (!entry) return;

  $("selectedDate").value = entry.bucketDate || entry.date;
  $("editId").value = entry.id;
  $("entryType").value = entry.type;
  $("entryTitle").value = entry.title;
  $("entryAmount").value = entry.amount;
  $("entryCategory").value = entry.category;
  $("entryDate").value = entry.date;
  $("entryNote").value = entry.note || "";
  $("cancelEdit").classList.remove("hidden");

  showPage("overview");
  renderOverview();
  $("entryTitle").focus();
}
function deleteEntry(entryId) {
  if (!confirm("Delete this transaction? This cannot be undone.")) return;
  const db = readDB();
  for (const record of Object.values(db.records[state.userId] || {})) {
    record.entries = (record.entries || []).filter(e => e.id !== entryId);
  }
  writeDB(db);
  renderAll();
  toast("Transaction deleted.");
}
function handleEntryClick(event) {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) editEntry(edit.dataset.edit);
  if (del) deleteEntry(del.dataset.delete);
}
$("dayBody").addEventListener("click", handleEntryClick);
$("allBody").addEventListener("click", handleEntryClick);

/* Rendering */
function rowHTML(e, dayMode = false) {
  const symbol = e.type === "income" ? "↗" : "•";
  return `<tr>
    <td><div class="tx-name"><span class="tx-icon">${symbol}</span>
      <div><strong>${escapeHTML(e.title)}</strong>
      <small>${escapeHTML(e.note || e.type)}</small></div></div></td>
    <td><span class="category-chip">${escapeHTML(e.category)}</span></td>
    <td>${escapeHTML(e.date)}</td>
    ${dayMode ? "" : `<td>${e.type === "income" ? "Income" : "Expense"}</td>`}
    <td class="amount ${e.type}">${e.type === "income" ? "+" : "−"}${money(e.amount)}</td>
    <td><div class="row-actions">
      <button class="mini-btn" data-edit="${escapeHTML(e.id)}">Edit</button>
      <button class="mini-btn" data-delete="${escapeHTML(e.id)}">Delete</button>
    </div></td>
  </tr>`;
}
function renderOverview() {
  const date = $("selectedDate").value || today();
  const record = recordFor(date);
  const entries = record.entries || [];
  const income = entries.filter(e => e.type === "income")
    .reduce((sum,e) => sum + Number(e.amount), 0);
  const expenses = entries.filter(e => e.type === "expense")
    .reduce((sum,e) => sum + Number(e.amount), 0);

  $("incomeTotal").textContent = money(income);
  $("expenseTotal").textContent = money(expenses);
  $("balanceTotal").textContent = money(income-expenses);
  $("entryTotal").textContent = entries.length;
  $("dayBody").innerHTML = entries.slice()
    .sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0))
    .map(e => rowHTML(e,true)).join("");
  $("dayEmpty").classList.toggle("hidden", entries.length > 0);
  $("dayBody").parentElement.classList.toggle("hidden", entries.length === 0);

  const recent = allEntries().slice(0,6);
  $("recentList").innerHTML = recent.length ? recent.map(e => `
    <div class="recent-item">
      <div class="tx-name"><span class="tx-icon">${e.type==="income"?"↗":"•"}</span>
        <div><strong>${escapeHTML(e.title)}</strong>
        <small>${escapeHTML(e.date)} · ${escapeHTML(e.category)}</small></div>
      </div>
      <span class="amount ${e.type}">${e.type==="income"?"+":"−"}${money(e.amount)}</span>
    </div>`).join("") : `<p class="empty">Your latest transactions will appear here.</p>`;
}
function renderAllTransactions() {
  const q = $("searchBox").value.trim().toLowerCase();
  const type = $("typeFilter").value;
  const category = $("categoryFilter").value;
  const entries = allEntries().filter(e =>
    (!q || `${e.title} ${e.note||""} ${e.category}`.toLowerCase().includes(q)) &&
    (type === "all" || e.type === type) &&
    (category === "all" || e.category === category)
  );
  $("allBody").innerHTML = entries.map(e => rowHTML(e,false)).join("");
  $("allEmpty").classList.toggle("hidden", entries.length > 0);
  $("allBody").parentElement.classList.toggle("hidden", entries.length === 0);
}
function renderReports() {
  const month = $("reportMonth").value || currentMonth();
  const entries = allEntries().filter(e => (e.date||"").startsWith(month));
  const income = entries.filter(e => e.type === "income").reduce((s,e)=>s+Number(e.amount),0);
  const expenses = entries.filter(e => e.type === "expense").reduce((s,e)=>s+Number(e.amount),0);
  const days = new Set(entries.filter(e => e.type === "expense").map(e=>e.date)).size;

  $("monthIncome").textContent = money(income);
  $("monthExpense").textContent = money(expenses);
  $("monthBalance").textContent = money(income-expenses);
  $("monthAverage").textContent = money(days ? expenses/days : 0);

  const groups = {};
  entries.filter(e => e.type === "expense").forEach(e => {
    groups[e.category] = (groups[e.category] || 0) + Number(e.amount);
  });
  const max = Math.max(1,...Object.values(groups));
  const sorted = Object.entries(groups).sort((a,b)=>b[1]-a[1]);
  $("categoryReport").innerHTML = sorted.length ? sorted.map(([name,value]) => `
    <div class="report-line">
      <div class="report-line-head"><span>${escapeHTML(name)}</span><strong>${money(value)}</strong></div>
      <div class="track"><div class="fill" style="width:${value/max*100}%"></div></div>
    </div>`).join("") : `<p class="empty">No expenses for this month yet.</p>`;

  const months = {};
  allEntries().forEach(e => {
    const m = (e.date||"").slice(0,7);
    if (!m) return;
    months[m] ||= {income:0,expense:0};
    months[m][e.type] += Number(e.amount) || 0;
  });
  const recentMonths = Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6);
  const maxMonth = Math.max(1,...recentMonths.flatMap(([,v])=>[v.income,v.expense]));
  $("monthlyReport").innerHTML = recentMonths.length ? recentMonths.map(([m,v]) => `
    <div class="month-row">
      <strong>${escapeHTML(m)}</strong>
      <div class="month-bars">
        <div class="bar" style="width:${v.income/maxMonth*100}%"></div>
        <div class="bar expense" style="width:${v.expense/maxMonth*100}%"></div>
      </div>
      <div class="month-values">+${money(v.income)}<br>−${money(v.expense)}</div>
    </div>`).join("") : `<p class="empty">No monthly history yet.</p>`;
}
function renderAll() {
  if (!state.userId) return;
  renderOverview();
  if (state.page === "transactions") renderAllTransactions();
  if (state.page === "reports") renderReports();
}

/* Draft saves a snapshot and ordinary saves preserve it. */
$("draftBtn").addEventListener("click", () => {
  const date = $("selectedDate").value;
  const record = recordFor(date);
  record.draft = {
    entries:JSON.parse(JSON.stringify(record.entries||[])),
    savedAt:Date.now()
  };
  record.updatedAt = Date.now();
  saveRecord(date,record);
  $("saveStatus").textContent = "Draft saved.";
  toast("Draft saved for "+date+".");
});
$("restoreBtn").addEventListener("click", () => {
  const date = $("selectedDate").value;
  const record = recordFor(date);
  if (!record.draft) return toast("No draft saved for this day.");
  if (!confirm("Restore this draft? Current entries for this day will be replaced.")) return;
  record.entries = JSON.parse(JSON.stringify(record.draft.entries||[]));
  record.updatedAt = Date.now();
  saveRecord(date,record);
  renderAll();
  $("saveStatus").textContent = "Draft restored.";
  toast("Draft restored.");
});
$("saveDayBtn").addEventListener("click", () => {
  const date = $("selectedDate").value;
  const record = recordFor(date);
  record.date = date;
  record.updatedAt = Date.now();
  saveRecord(date,record);
  renderAll();
  $("saveStatus").textContent = "Day saved successfully.";
  toast("Day saved.");
});

/* Export the current user's transactions only */
function exportCSV() {
  const entries = allEntries();
  if (!entries.length) return toast("No transactions to export yet.");
  const rows = [
    ["Date","Type","Description","Category","Amount","Note"],
    ...entries.map(e => [e.date,e.type,e.title,e.category,e.amount,e.note||""])
  ];
  const csv = rows.map(row => row.map(v =>
    `"${String(v??"").replace(/"/g,'""')}"`
  ).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `expenseflow-${today()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("CSV downloaded.");
}
$("exportBtn").addEventListener("click",exportCSV);
$("exportAllBtn").addEventListener("click",exportCSV);
$("reportMonth").addEventListener("change",renderReports);
["searchBox","typeFilter","categoryFilter"].forEach(id =>
  $(id).addEventListener(id === "searchBox" ? "input" : "change",renderAllTransactions)
);

/* PWA installation */
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  state.installPrompt = event;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click", async () => {
  if (!state.installPrompt) {
    toast("Open the browser menu and choose Install app or Add to Home Screen.");
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  $("installBtn").classList.add("hidden");
});
window.addEventListener("appinstalled", () => toast("App installed successfully."));

/* Start */
function init() {
  const db = readDB();
  setTheme(db.prefs.globalTheme || "light",false);
  showAuth(db.users.length ? "loginForm" : "registerForm");

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
init();
