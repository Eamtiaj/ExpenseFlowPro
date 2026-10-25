"use strict";

/* =========================================
   ExpenseFlow Pro
   Local multi-user expense tracker
   Voice recording intentionally excluded
========================================= */

const DB_KEY = "expenseflow_pro_multiuser_v2";

const $ = (id) => document.getElementById(id);

const todayISO = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
};

const makeId = () =>
  window.crypto?.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);

const prettyDate = (date) => {
  if (!date) return "—";
  const d = new Date(date + "T12:00:00");
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
};

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function loadDB() {
  try {
    const saved = localStorage.getItem(DB_KEY);
    if (!saved) {
      return {
        accounts: {},
        records: {},
        drafts: {},
        prefs: { globalTheme: "light" }
      };
    }

    const parsed = JSON.parse(saved);

    return {
      accounts: parsed.accounts || {},
      records: parsed.records || {},
      drafts: parsed.drafts || {},
      prefs: parsed.prefs || { globalTheme: "light" }
    };
  } catch (error) {
    console.error("Could not load database:", error);
    return {
      accounts: {},
      records: {},
      drafts: {},
      prefs: { globalTheme: "light" }
    };
  }
}

let db = loadDB();
let currentUserId = null;
let recoveryUserId = null;
let toastTimer = null;

function writeDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (error) {
    console.error("Could not save database:", error);
    showToast("Storage is full or unavailable. Export your data if possible.");
    return false;
  }
}

async function sha256(value) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure hashing is unavailable. Open this app using localhost or HTTPS.");
  }

  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPIN(pin) {
  const salt = makeId();
  return {
    salt,
    hash: await sha256(salt + ":" + pin)
  };
}

async function pinTag(pin) {
  // Used to check whether a PIN is already registered in this browser.
  return sha256("expenseflow-pin-index:" + pin);
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function showAuthForm(formId) {
  ["loginForm", "registerForm", "forgotForm", "resetForm"]
    .forEach((id) => $(id).classList.toggle("hidden", id !== formId));
}

function showAuthPage() {
  $("authPage").classList.remove("hidden");
  $("appPage").classList.add("hidden");
  currentUserId = null;
  recoveryUserId = null;
  showAuthForm("loginForm");
  $("loginPin").value = "";
}

function setTheme(theme, persist = true) {
  const selected = theme === "dark" ? "dark" : "light";

  document.body.classList.toggle("dark", selected === "dark");

  if (persist && currentUserId) {
    db.prefs[currentUserId] = {
      ...(db.prefs[currentUserId] || {}),
      theme: selected
    };
    writeDB();
  } else if (persist) {
    db.prefs.globalTheme = selected;
    writeDB();
  }
}

function toggleTheme() {
  const darkNow = document.body.classList.contains("dark");
  setTheme(darkNow ? "light" : "dark");
}

function enterApp(account) {
  currentUserId = account.id;

  $("authPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");

  $("userName").textContent = account.name;
  $("welcomeName").textContent = account.name;
  $("userAvatar").textContent =
    (account.name.trim()[0] || "U").toUpperCase();

  const theme =
    db.prefs[currentUserId]?.theme ||
    db.prefs.globalTheme ||
    "light";

  setTheme(theme, false);

  if (!Array.isArray(db.records[currentUserId])) {
    db.records[currentUserId] = [];
  }

  if (!db.drafts[currentUserId]) {
    db.drafts[currentUserId] = {};
  }

  $("entryDate").value = todayISO();
  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  showPage("overview");
  renderAll();
}

/* =========================================
   Registration
========================================= */

$("showRegister").addEventListener("click", () => {
  showAuthForm("registerForm");
});

$("showForgot").addEventListener("click", () => {
  showAuthForm("forgotForm");
});

["backToLogin1", "backToLogin2", "backToLogin3"].forEach((id) => {
  $(id).addEventListener("click", () => showAuthForm("loginForm"));
});

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const pin = $("registerPin").value.trim();
  const confirm = $("confirmPin").value.trim();
  const dob = $("registerDob").value;

  if (name.length < 2) {
    showToast("Please enter your full name.");
    return;
  }

  if (!/^\d{5}$/.test(pin)) {
    showToast("PIN must contain exactly 5 digits.");
    return;
  }

  if (pin !== confirm) {
    showToast("PINs do not match.");
    return;
  }

  if (!dob || dob > todayISO()) {
    showToast("Please enter a valid date of birth.");
    return;
  }

  try {
    const tag = await pinTag(pin);

    const duplicate = Object.values(db.accounts).some(
      (account) => account.pinTag === tag
    );

    if (duplicate) {
      showToast("This PIN is already in use. Choose another PIN.");
      return;
    }

    const id = makeId();
    const pinData = await hashPIN(pin);
    const dobHash = await sha256("expenseflow-dob:" + dob);

    db.accounts[id] = {
      id,
      name,
      pinTag: tag,
      pinSalt: pinData.salt,
      pinHash: pinData.hash,
      dobHash,
      createdAt: new Date().toISOString()
    };

    db.records[id] = [];
    db.drafts[id] = {};

    if (!writeDB()) {
      delete db.accounts[id];
      delete db.records[id];
      delete db.drafts[id];
      return;
    }

    $("registerForm").reset();
    showToast("Account created successfully.");
    enterApp(db.accounts[id]);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not create account.");
  }
});

/* =========================================
   Login: PIN only
========================================= */

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const pin = $("loginPin").value.trim();

  if (!/^\d{5}$/.test(pin)) {
    showToast("Enter your 5-digit PIN.");
    return;
  }

  try {
    const tag = await pinTag(pin);

    const account = Object.values(db.accounts).find(
      (item) => item.pinTag === tag
    );

    if (!account) {
      showToast("Account not found. Check your PIN or register.");
      return;
    }

    const attemptedHash = await sha256(account.pinSalt + ":" + pin);

    if (attemptedHash !== account.pinHash) {
      showToast("Incorrect PIN.");
      return;
    }

    $("loginForm").reset();
    enterApp(account);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Login failed.");
  }
});

/* =========================================
   PIN recovery
========================================= */

$("forgotForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("forgotName").value.trim().toLowerCase();
  const dob = $("forgotDob").value;

  if (!name || !dob) {
    showToast("Enter your name and date of birth.");
    return;
  }

  try {
    const dobHash = await sha256("expenseflow-dob:" + dob);

    const account = Object.values(db.accounts).find((item) =>
      item.name.trim().toLowerCase() === name &&
      item.dobHash === dobHash
    );

    if (!account) {
      showToast("Details do not match an account.");
      return;
    }

    recoveryUserId = account.id;
    $("forgotForm").reset();
    showAuthForm("resetForm");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not verify details.");
  }
});

$("resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!recoveryUserId || !db.accounts[recoveryUserId]) {
    showToast("Please verify your account again.");
    showAuthForm("forgotForm");
    return;
  }

  const pin = $("resetPin").value.trim();
  const confirm = $("resetPinConfirm").value.trim();

  if (!/^\d{5}$/.test(pin)) {
    showToast("New PIN must contain exactly 5 digits.");
    return;
  }

  if (pin !== confirm) {
    showToast("PINs do not match.");
    return;
  }

  try {
    const tag = await pinTag(pin);

    const duplicate = Object.values(db.accounts).some(
      (account) => account.id !== recoveryUserId &&
        account.pinTag === tag
    );

    if (duplicate) {
      showToast("That PIN belongs to another account. Choose another.");
      return;
    }

    const oldAccount = { ...db.accounts[recoveryUserId] };
    const pinData = await hashPIN(pin);

    db.accounts[recoveryUserId].pinTag = tag;
    db.accounts[recoveryUserId].pinSalt = pinData.salt;
    db.accounts[recoveryUserId].pinHash = pinData.hash;

    if (!writeDB()) {
      db.accounts[recoveryUserId] = oldAccount;
      return;
    }

    recoveryUserId = null;
    $("resetForm").reset();
    showAuthForm("loginForm");
    showToast("PIN reset successfully. Please log in.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not reset PIN.");
  }
});

/* =========================================
   Navigation
========================================= */

const pageTitles = {
  overview: "Overview",
  transactions: "Transactions",
  reports: "Reports"
};

function showPage(page) {
  if (!pageTitles[page]) page = "overview";

  Object.keys(pageTitles).forEach((key) => {
    $(key + "Page").classList.toggle("hidden", key !== page);
  });

  document.querySelectorAll(".nav-link[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  $("pageTitle").textContent = pageTitles[page];
}

document.querySelectorAll(".nav-link[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
    renderAll();
  });
});

document.querySelectorAll("[data-goto]").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.goto);
    renderAll();
  });
});

$("brandHome").addEventListener("click", (event) => {
  event.preventDefault();
  showPage("overview");
  renderAll();
});

$("quickAddBtn").addEventListener("click", () => {
  showPage("transactions");
  resetEntryForm();
  $("entryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("entryTitle").focus({ preventScroll: true });
});

$("themeBtn").addEventListener("click", toggleTheme);
$("mobileThemeBtn").addEventListener("click", toggleTheme);

$("logoutBtn").addEventListener("click", () => {
  if (!currentUserId) return;
  currentUserId = null;
  showAuthPage();
  showToast("You have been logged out.");
});

/* =========================================
   Transaction data
========================================= */

function getTransactions() {
  if (!currentUserId) return [];

  if (!Array.isArray(db.records[currentUserId])) {
    db.records[currentUserId] = [];
  }

  return db.records[currentUserId];
}

function saveDraftForDate() {
  if (!currentUserId) return false;

  const date = $("entryDate").value || todayISO();

  if (!db.drafts[currentUserId]) {
    db.drafts[currentUserId] = {};
  }

  db.drafts[currentUserId][date] = {
    date,
    type: $("entryType").value,
    category: $("entryCategory").value,
    amount: $("entryAmount").value,
    title: $("entryTitle").value,
    note: $("entryNote").value,
    updatedAt: new Date().toISOString()
  };

  return writeDB();
}

function loadDraftForDate(date) {
  if (!currentUserId) return;

  const draft = db.drafts[currentUserId]?.[date];
  if (!draft) return;

  $("entryType").value = draft.type || "expense";
  $("entryCategory").value = draft.category || "Other";
  $("entryAmount").value = draft.amount || "";
  $("entryTitle").value = draft.title || "";
  $("entryNote").value = draft.note || "";
}

function resetEntryForm() {
  $("entryForm").reset();
  $("editTransactionId").value = "";
  $("entryDate").value = todayISO();
  $("entryHeading").textContent = "Daily transaction";
  $("saveEntryBtn").textContent = "Save transaction";
  $("cancelEditBtn").classList.add("hidden");
  $("entryMessage").textContent = "";
  $("entryMessage").classList.remove("error");
}

$("entryDate").addEventListener("change", () => {
  const date = $("entryDate").value;
  if (date && !$("editTransactionId").value) {
    loadDraftForDate(date);
  }
});

$("draftBtn").addEventListener("click", () => {
  if (!currentUserId) {
    showToast("Please log in first.");
    return;
  }

  if (!$("entryDate").value) {
    showToast("Choose a date for this draft.");
    return;
  }

  if (saveDraftForDate()) {
    $("entryMessage").textContent = "Draft saved. You can return to it later.";
    $("entryMessage").classList.remove("error");
    showToast("Draft saved successfully.");
  }
});

/*
  IMPORTANT ENTRY FIX:
  This one submit handler handles both adding and editing.
  All form IDs below exist in index.html.
*/
$("entryForm").addEventListener("submit", (event) => {
  event.preventDefault();

  if (!currentUserId || !db.accounts[currentUserId]) {
    showToast("Your session ended. Please log in again.");
    showAuthPage();
    return;
  }

  const date = $("entryDate").value;
  const type = $("entryType").value;
  const category = $("entryCategory").value;
  const amount = Number($("entryAmount").value);
  const title = $("entryTitle").value.trim();
  const note = $("entryNote").value.trim();
  const editId = $("editTransactionId").value;

  if (!date) {
    showToast("Please choose the transaction date.");
    $("entryDate").focus();
    return;
  }

  if (!["expense", "income"].includes(type)) {
    showToast("Please choose a valid transaction type.");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter an amount greater than zero.");
    $("entryAmount").focus();
    return;
  }

  if (!title) {
    showToast("Please enter a description.");
    $("entryTitle").focus();
    return;
  }

  const transactions = getTransactions();
  const oldTransaction = editId
    ? transactions.find((item) => item.id === editId)
    : null;

  if (editId && !oldTransaction) {
    showToast("Transaction not found. Please refresh and try again.");
    resetEntryForm();
    return;
  }

  const transaction = {
    id: editId || makeId(),
    date,
    type,
    category,
    amount,
    title,
    note,
    createdAt: oldTransaction?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const previousRecords = transactions.map((item) => ({ ...item }));

  if (editId) {
    const index = transactions.findIndex((item) => item.id === editId);
    transactions[index] = transaction;
  } else {
    transactions.push(transaction);
  }

  transactions.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  if (!writeDB()) {
    db.records[currentUserId] = previousRecords;
    return;
  }

  // A successfully saved transaction supersedes its same-day draft.
  if (db.drafts[currentUserId]) {
    delete db.drafts[currentUserId][date];
    writeDB();
  }

  resetEntryForm();
  renderAll();

  $("entryMessage").textContent = editId
    ? "Transaction updated successfully."
    : "Transaction saved successfully.";

  showToast(editId ? "Transaction updated." : "Transaction saved.");
});

$("entryForm").addEventListener("reset", () => {
  // reset event fires before the browser has reset field values.
  setTimeout(() => {
    if (!$("editTransactionId").value) {
      $("entryDate").value = todayISO();
      $("entryHeading").textContent = "Daily transaction";
      $("saveEntryBtn").textContent = "Save transaction";
      $("cancelEditBtn").classList.add("hidden");
    }
  }, 0);
});

$("cancelEditBtn").addEventListener("click", resetEntryForm);
$("clearEntryBtn").addEventListener("click", () => {
  $("entryMessage").textContent = "";
  $("entryMessage").classList.remove("error");
});

/* =========================================
   Edit and delete
========================================= */

function editTransaction(id) {
  const transaction = getTransactions().find((item) => item.id === id);
  if (!transaction) {
    showToast("Transaction not found.");
    return;
  }

  showPage("transactions");

  $("editTransactionId").value = transaction.id;
  $("entryDate").value = transaction.date;
  $("entryType").value = transaction.type;
  $("entryCategory").value = transaction.category;
  $("entryAmount").value = transaction.amount;
  $("entryTitle").value = transaction.title;
  $("entryNote").value = transaction.note || "";

  $("entryHeading").textContent = "Edit transaction";
  $("saveEntryBtn").textContent = "Update transaction";
  $("cancelEditBtn").classList.remove("hidden");

  $("entryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteTransaction(id) {
  const transaction = getTransactions().find((item) => item.id === id);
  if (!transaction) return;

  if (!confirm(`Delete "${transaction.title}" (${money(transaction.amount)})?`)) {
    return;
  }

  const oldRecords = getTransactions().map((item) => ({ ...item }));
  db.records[currentUserId] = oldRecords.filter((item) => item.id !== id);

  if (!writeDB()) {
    db.records[currentUserId] = oldRecords;
    return;
  }

  if ($("editTransactionId").value === id) {
    resetEntryForm();
  }

  renderAll();
  showToast("Transaction deleted.");
}

/* =========================================
   Filtering and rendering
========================================= */

$("filterDate").addEventListener("change", renderTransactionTable);
$("filterType").addEventListener("change", renderTransactionTable);

$("clearFiltersBtn").addEventListener("click", () => {
  $("filterDate").value = "";
  $("filterType").value = "all";
  renderTransactionTable();
});

function getFilteredTransactions() {
  const filterDate = $("filterDate").value;
  const filterType = $("filterType").value;

  return getTransactions().filter((transaction) => {
    const dateMatches = !filterDate || transaction.date === filterDate;
    const typeMatches = filterType === "all" || transaction.type === filterType;
    return dateMatches && typeMatches;
  });
}

const categoryIcons = {
  Food: "🍽️",
  Travel: "🚕",
  Shopping: "🛍️",
  Bills: "🧾",
  Health: "💊",
  Education: "📚",
  Salary: "💰",
  Business: "💼",
  Home: "🏠",
  Entertainment: "🎬",
  Other: "📌"
};

function transactionItemHTML(transaction) {
  const isIncome = transaction.type === "income";

  return `
    <div class="transaction-item">
      <div class="category-icon">${categoryIcons[transaction.category] || "📌"}</div>
      <div class="transaction-info">
        <strong>${escapeHTML(transaction.title)}</strong>
        <small>${escapeHTML(transaction.category)} · ${prettyDate(transaction.date)}</small>
      </div>
      <div class="transaction-amount ${isIncome ? "income-text" : "expense-text"}">
        ${isIncome ? "+" : "−"}${money(transaction.amount)}
      </div>
    </div>
  `;
}

function renderTransactionTable() {
  const wrap = $("transactionTableWrap");
  const transactions = getFilteredTransactions();

  if (!transactions.length) {
    wrap.innerHTML = `<div class="empty-state">No transactions found. Add your first entry above.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Category</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${transactions.map((transaction) => `
          <tr>
            <td>${prettyDate(transaction.date)}</td>
            <td class="table-description">
              <strong>${escapeHTML(transaction.title)}</strong>
              ${transaction.note
                ? `<small>${escapeHTML(transaction.note)}</small>`
                : ""}
            </td>
            <td>${escapeHTML(transaction.category)}</td>
            <td>
              <span class="type-pill ${transaction.type}">
                ${transaction.type === "income" ? "Income" : "Expense"}
              </span>
            </td>
            <td class="${transaction.type === "income" ? "income-text" : "expense-text"}">
              ${money(transaction.amount)}
            </td>
            <td>
              <div class="row-actions">
                <button class="small-btn" data-action="edit"
                  data-id="${escapeHTML(transaction.id)}">Edit</button>
                <button class="small-btn delete" data-action="delete"
                  data-id="${escapeHTML(transaction.id)}">Delete</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const { action, id } = button.dataset;
      if (action === "edit") editTransaction(id);
      if (action === "delete") deleteTransaction(id);
    });
  });
}

function renderOverview() {
  const transactions = getTransactions();
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);

  const todayItems = transactions.filter((item) => item.date === today);
  const monthItems = transactions.filter((item) => item.date.startsWith(monthPrefix));

  const sum = (items, type) => items
    .filter((item) => item.type === type)
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const allIncome = sum(transactions, "income");
  const allExpense = sum(transactions, "expense");

  $("todayExpense").textContent = money(sum(todayItems, "expense"));
  $("todayIncome").textContent = money(sum(todayItems, "income"));
  $("monthExpense").textContent = money(sum(monthItems, "expense"));
  $("netBalance").textContent = money(allIncome - allExpense);

  const recent = [...transactions]
    .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.createdAt).localeCompare(String(a.createdAt))
    )
    .slice(0, 6);

  $("recentTransactions").innerHTML = recent.length
    ? recent.map(transactionItemHTML).join("")
    : `<div class="empty-state">No transactions yet. Use “Add transaction” to get started.</div>`;

  const categoryTotals = {};

  monthItems
    .filter((item) => item.type === "expense")
    .forEach((item) => {
      categoryTotals[item.category] =
        (categoryTotals[item.category] || 0) + Number(item.amount || 0);
    });

  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const highest = sortedCategories[0]?.[1] || 1;

  $("overviewInsights").innerHTML = sortedCategories.length
    ? sortedCategories.map(([category, amount]) => `
        <div>
          <div class="insight-row">
            <span>${categoryIcons[category] || "📌"} ${escapeHTML(category)}</span>
            <strong>${money(amount)}</strong>
          </div>
          <div class="insight-track">
            <div class="insight-fill" style="width:${Math.max(3, amount / highest * 100)}%"></div>
          </div>
        </div>
      `).join("")
    : `<div class="empty-state">Your category insights will appear after you add expenses.</div>`;
}

function renderReports() {
  const transactions = getTransactions();
  const income = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const expenses = transactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  $("reportIncome").textContent = money(income);
  $("reportExpense").textContent = money(expenses);
  $("reportNet").textContent = money(income - expenses);
  $("reportCount").textContent = String(transactions.length);

  const totals = {};

  transactions
    .filter((item) => item.type === "expense")
    .forEach((item) => {
      totals[item.category] = (totals[item.category] || 0) + Number(item.amount || 0);
    });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;

  $("categoryReport").innerHTML = sorted.length
    ? sorted.map(([category, amount]) => `
        <div class="category-report-row">
          <div class="category-report-label">
            <span>${categoryIcons[category] || "📌"} ${escapeHTML(category)}</span>
            <span>${money(amount)}</span>
          </div>
          <div class="category-report-track">
            <div class="category-report-fill"
              style="width:${Math.max(2, amount / max * 100)}%"></div>
          </div>
        </div>
      `).join("")
    : `<div class="empty-state">No expense data to report yet.</div>`;
}

function renderAll() {
  if (!currentUserId) return;
  renderOverview();
  renderTransactionTable();
  renderReports();
}

/* =========================================
   CSV export
========================================= */

function csvCell(value) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '""') + '"';
}

$("exportBtn").addEventListener("click", exportCSV);

function exportCSV() {
  if (!currentUserId) return;

  const transactions = getTransactions();

  if (!transactions.length) {
    showToast("There are no transactions to export yet.");
    return;
  }

  const rows = [
    ["Date", "Type", "Category", "Description", "Note", "Amount"],
    ...transactions.map((item) => [
      item.date,
      item.type,
      item.category,
      item.title,
      item.note || "",
      item.amount
    ])
  ];

  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "expenseflow-transactions-" + todayISO() + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  showToast("CSV export started.");
}

/* =========================================
   PWA install and service worker
========================================= */

let installPromptEvent = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;

  // Keep installation available without changing the main navigation.
  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.id = "installAppBtn";
  installButton.className = "nav-link";
  installButton.innerHTML = '⬇ <span>Install app</span>';
  installButton.addEventListener("click", async () => {
    if (!installPromptEvent) return;

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    installButton.remove();
  });

  if (!$("installAppBtn")) {
    $("sidebar-bottom")?.appendChild(installButton);
    if (!$("sidebar-bottom")) {
      $("logoutBtn").before(installButton);
    }
  }
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

/* =========================================
   Startup
========================================= */

(function init() {
  setTheme(db.prefs.globalTheme || "light", false);

  // Ensure storage objects exist even for older local data.
  if (!db.accounts) db.accounts = {};
  if (!db.records) db.records = {};
  if (!db.drafts) db.drafts = {};
  if (!db.prefs) db.prefs = { globalTheme: "light" };

  $("entryDate").value = todayISO();
  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  showAuthPage();
})();
