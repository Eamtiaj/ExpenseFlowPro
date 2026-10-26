import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

/* -------------------------------------------------------
   1. FIREBASE CONFIGURATION
------------------------------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyCHCeqEUf_0Jt-mHnmB9upNQ5hC8GZu1gg",
  authDomain: "expenseflow-pro-74238.firebaseapp.com",
  projectId: "expenseflow-pro-74238",
  storageBucket: "expenseflow-pro-74238.firebasestorage.app",
  messagingSenderId: "313212882336",
  appId: "1:313212882336:web:f80494a37bbc1406b9e8c5"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/* -------------------------------------------------------
   2. DOM HELPERS AND APPLICATION STATE
------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  user: null,
  transactions: [],
  drafts: [],
  page: "dashboard",
  authMode: "login",
  editingTransactionId: null,
  reportTransactions: [],
  busy: false
};

const PAGE_NAMES = {
  dashboard: "Dashboard",
  transactions: "Transactions",
  reports: "Reports",
  drafts: "Saved drafts",
  settings: "Settings"
};

const CATEGORY_OPTIONS = [
  "Food", "Transport", "Shopping", "Bills", "Education",
  "Health", "Salary", "Business", "Investment", "Other"
];

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function money(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function safeText(value) {
  return String(value ?? "");
}

function setMessage(elementId, text, type = "") {
  const element = $(elementId);
  if (!element) return;
  element.textContent = text;
  element.className = `message${type ? ` ${type}` : ""}`;
}

function setBusy(busy) {
  state.busy = busy;
  $("authSubmit").disabled = busy;
  $("authSubmit").textContent = busy
    ? "Please wait..."
    : state.authMode === "register"
      ? "Create account"
      : "Sign in";
}

function showOnlyAuth() {
  $("appLoader").classList.add("hidden");
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
}

function showOnlyApp() {
  $("appLoader").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}

function friendlyError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use": "An account already exists with this email. Try signing in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account was found. Check your email or create an account.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase Authentication.",
    "permission-denied": "Firestore denied access. Check your Firestore security rules.",
    "unavailable": "The cloud service is temporarily unavailable. Try again."
  };

  return messages[code] || error?.message || "Something went wrong. Please try again.";
}

function requireSignedInUser() {
  if (!state.user) throw new Error("Please sign in again.");
  return state.user;
}

function getUserCollection(name) {
  const user = requireSignedInUser();
  return collection(db, "users", user.uid, name);
}

function getUserDocument(name, id) {
  const user = requireSignedInUser();
  return doc(db, "users", user.uid, name, id);
}

/* -------------------------------------------------------
   3. AUTHENTICATION UI
------------------------------------------------------- */

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";

  $("authTitle").textContent = isRegister ? "Create your account" : "Welcome back";
  $("authSubtitle").textContent = isRegister
    ? "Start managing your finances in one place."
    : "Sign in to manage your money.";

  $("nameField").classList.toggle("hidden", !isRegister);
  $("displayName").required = isRegister;
  $("password").autocomplete = isRegister ? "new-password" : "current-password";
  $("authSwitchText").textContent = isRegister
    ? "Already have an account?"
    : "New to ExpenseFlow?";
  $("authSwitch").textContent = isRegister ? "Sign in" : "Create account";
  $("forgotBtn").classList.toggle("hidden", isRegister);

  setMessage("authMessage", "");
  setBusy(false);
}

$("authSwitch").addEventListener("click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  const displayName = $("displayName").value.trim();

  if (!email || !password) {
    setMessage("authMessage", "Enter your email and password.", "error");
    return;
  }

  if (state.authMode === "register" && !displayName) {
    setMessage("authMessage", "Enter your name.", "error");
    return;
  }

  if (state.authMode === "register" && password.length < 6) {
    setMessage("authMessage", "Password must contain at least 6 characters.", "error");
    return;
  }

  setBusy(true);
  setMessage("authMessage", "");

  try {
    if (state.authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);

      try {
        await updateProfile(credential.user, { displayName });
      } catch (profileError) {
        console.error("Profile name update failed:", profileError);
      }

      setMessage("authMessage", "Account created successfully.", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    setMessage("authMessage", friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});

$("forgotBtn").addEventListener("click", async () => {
  const email = $("email").value.trim().toLowerCase();

  if (!email) {
    setMessage("authMessage", "Enter your email first, then choose Forgot password.", "error");
    $("email").focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setMessage("authMessage", "If an account exists for this email, a reset email will be sent.", "success");
  } catch (error) {
    setMessage("authMessage", friendlyError(error), "error");
  }
});

$("signOutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    alert(friendlyError(error));
  }
});

/* -------------------------------------------------------
   4. CLOUD DATA LOAD / SAVE
   Each user gets:
   users/{uid}/transactions/{documentId}
   users/{uid}/drafts/{documentId}
------------------------------------------------------- */

async function loadCollection(name) {
  const ref = getUserCollection(name);
  const snapshot = await getDocs(query(ref, orderBy("updatedAt", "desc")));

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}

async function loadAllData() {
  const [transactions, drafts] = await Promise.all([
    loadCollection("transactions"),
    loadCollection("drafts")
  ]);

  state.transactions = transactions.filter(isValidTransaction);
  state.drafts = drafts.filter(isValidDraft);

  renderAll();
}

function isValidTransaction(item) {
  return Boolean(
    item &&
    typeof item.id === "string" &&
    (item.type === "income" || item.type === "expense") &&
    Number.isFinite(Number(item.amount)) &&
    Number(item.amount) > 0 &&
    typeof item.date === "string"
  );
}

function isValidDraft(item) {
  return Boolean(item && typeof item.id === "string");
}

async function saveCloudDocument(collectionName, id, data) {
  const ref = getUserDocument(collectionName, id);
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function removeCloudDocument(collectionName, id) {
  await deleteDoc(getUserDocument(collectionName, id));
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/* -------------------------------------------------------
   5. NAVIGATION AND THEME
------------------------------------------------------- */

function navigateTo(page) {
  if (!PAGE_NAMES[page]) return;

  state.page = page;

  $$(".page").forEach((element) => {
    element.classList.toggle("hidden", element.id !== `page-${page}`);
  });

  $$(".nav-item[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  $("breadcrumbTitle").textContent = PAGE_NAMES[page];
  $("topbarHeading").textContent = PAGE_NAMES[page];

  closeSidebar();

  if (page === "transactions") renderTransactions();
  if (page === "drafts") renderDrafts();
  if (page === "reports") runReport();
}

$$(".nav-item[data-page]").forEach((button) => {
  button.addEventListener("click", () => navigateTo(button.dataset.page));
});

$$("[data-goto]").forEach((button) => {
  button.addEventListener("click", () => navigateTo(button.dataset.goto));
});

$("menuBtn").addEventListener("click", () => {
  $("sidebar").classList.add("sidebar-open");
  $("sidebarOverlay").classList.add("overlay-open");
});

function closeSidebar() {
  $("sidebar").classList.remove("sidebar-open");
  $("sidebarOverlay").classList.remove("overlay-open");
}

$("sidebarOverlay").addEventListener("click", closeSidebar);

function applyTheme(theme) {
  let resolved = theme;

  if (theme === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  document.documentElement.dataset.theme = resolved;
  $("themeSelect").value = theme;
  $("themeBtn").textContent = resolved === "dark" ? "☀" : "☾";
}

function loadSavedTheme() {
  let savedTheme = "system";
  try {
    savedTheme = localStorage.getItem("expenseflow-theme") || "system";
  } catch {
    // Storage can be unavailable in some browser modes.
  }

  if (!["system", "light", "dark"].includes(savedTheme)) savedTheme = "system";
  applyTheme(savedTheme);
}

function saveTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem("expenseflow-theme", theme);
  } catch {
    // Theme still works for the current session.
  }
}

$("themeBtn").addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  saveTheme(current === "dark" ? "light" : "dark");
});

$("themeSelect").addEventListener("change", () => {
  saveTheme($("themeSelect").value);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  let saved = "system";
  try {
    saved = localStorage.getItem("expenseflow-theme") || "system";
  } catch {}
  if (saved === "system") applyTheme("system");
});

/* -------------------------------------------------------
   6. ACCOUNT DISPLAY
------------------------------------------------------- */

function renderAccount() {
  const user = state.user;
  if (!user) return;

  const displayName = user.displayName?.trim() || user.email?.split("@")[0] || "User";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";

  $("sidebarUserName").textContent = displayName;
  $("sidebarUserEmail").textContent = user.email || "";
  $("userAvatar").textContent = initial;
  $("settingsEmail").textContent = user.email || "—";
}

/* -------------------------------------------------------
   7. DASHBOARD
------------------------------------------------------- */

function totals(items) {
  return items.reduce((result, item) => {
    const amount = Number(item.amount) || 0;
    if (item.type === "income") result.income += amount;
    if (item.type === "expense") result.expense += amount;
    return result;
  }, { income: 0, expense: 0 });
}

function sortedTransactions(items) {
  return [...items].sort((a, b) => {
    const dateComparison = safeText(b.date).localeCompare(safeText(a.date));
    if (dateComparison !== 0) return dateComparison;
    return safeText(b.updatedAt?.seconds || b.createdAt || b.id)
      .localeCompare(safeText(a.updatedAt?.seconds || a.createdAt || a.id));
  });
}

function renderDashboard() {
  const all = state.transactions;
  const { income, expense } = totals(all);
  const balance = income - expense;

  $("statBalance").textContent = money(balance);
  $("statIncome").textContent = money(income);
  $("statExpense").textContent = money(expense);
  $("statTransactions").textContent = String(all.length);

  $("chartIncomeLabel").textContent = money(income);
  $("chartExpenseLabel").textContent = money(expense);
  $("chartNetBalance").textContent = money(balance);

  const max = Math.max(income, expense, 1);
  $("chartIncome").style.width = `${(income / max) * 100}%`;
  $("chartExpense").style.width = `${(expense / max) * 100}%`;

  const recent = sortedTransactions(all).slice(0, 5);
  $("recentEmptyState").classList.toggle("hidden", recent.length > 0);
  $("recentTableWrap").classList.toggle("hidden", recent.length === 0);

  $("recentTransactionRows").replaceChildren(
    ...recent.map((item) => createTransactionRow(item, false))
  );
}

/* -------------------------------------------------------
   8. TRANSACTION FORM
------------------------------------------------------- */

function openTransactionForm(type = "expense", item = null) {
  navigateTo("transactions");
  $("transactionEditor").classList.remove("hidden");
  $("transactionForm").reset();

  state.editingTransactionId = item?.id || null;
  $("transactionId").value = item?.id || "";
  $("transactionFormTitle").textContent = item ? "Edit transaction" : "New transaction";

  $("typeIncome").checked = item ? item.type === "income" : type === "income";
  $("typeExpense").checked = item ? item.type === "expense" : type !== "income";

  $("txAmount").value = item?.amount ?? "";
  $("txDate").value = item?.date || localDateString();
  $("txDescription").value = item?.description || "";
  $("txCategory").value = CATEGORY_OPTIONS.includes(item?.category)
    ? item.category
    : (item?.type === "income" ? "Salary" : "Food");
  $("txPaymentMethod").value = item?.paymentMethod || "UPI";
  $("txNote").value = item?.note || "";

  setMessage("transactionMessage", "");
  $("saveTransactionBtn").textContent = item ? "Update transaction" : "Save transaction";

  $("transactionEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeTransactionForm() {
  $("transactionEditor").classList.add("hidden");
  $("transactionForm").reset();
  state.editingTransactionId = null;
  $("transactionId").value = "";
  setMessage("transactionMessage", "");
}

$$("[data-open-form]").forEach((button) => {
  button.addEventListener("click", () => openTransactionForm(button.dataset.openForm));
});

$("topbarAddBtn").addEventListener("click", () => openTransactionForm("expense"));
$("closeTransactionFormBtn").addEventListener("click", closeTransactionForm);
$("cancelEditBtn").addEventListener("click", closeTransactionForm);

$("transactionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = state.user;
  if (!user) {
    setMessage("transactionMessage", "Please sign in again.", "error");
    return;
  }

  const amount = Number($("txAmount").value);
  const date = $("txDate").value;
  const description = $("txDescription").value.trim();
  const type = $("typeIncome").checked ? "income" : "expense";

  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999) {
    setMessage("transactionMessage", "Enter an amount greater than zero.", "error");
    return;
  }

  if (!date || !description) {
    setMessage("transactionMessage", "Enter a date and description.", "error");
    return;
  }

  const id = state.editingTransactionId || makeId();
  const existing = state.transactions.find((item) => item.id === id);

  const record = {
    type,
    amount,
    date,
    description,
    category: $("txCategory").value,
    paymentMethod: $("txPaymentMethod").value,
    note: $("txNote").value.trim(),
    createdAt: existing?.createdAt || Date.now()
  };

  const button = $("saveTransactionBtn");
  button.disabled = true;
  setMessage("transactionMessage", "Saving to your account...");

  try {
    await saveCloudDocument("transactions", id, record);

    const localRecord = { ...record, id };
    const index = state.transactions.findIndex((item) => item.id === id);

    if (index >= 0) state.transactions[index] = localRecord;
    else state.transactions.push(localRecord);

    // If a draft was converted into a transaction, remove that draft too.
    const matchingDraft = state.drafts.find((draft) => draft.id === id);
    if (matchingDraft) {
      await removeCloudDocument("drafts", id);
      state.drafts = state.drafts.filter((draft) => draft.id !== id);
    }

    closeTransactionForm();
    renderAll();
    navigateTo("transactions");
  } catch (error) {
    setMessage("transactionMessage", friendlyError(error), "error");
  } finally {
    button.disabled = false;
  }
});

/* -------------------------------------------------------
   9. SAVE / RESUME / DELETE DRAFTS
------------------------------------------------------- */

$("saveDraftBtn").addEventListener("click", async () => {
  if (!state.user) {
    setMessage("transactionMessage", "Please sign in again.", "error");
    return;
  }

  const amountText = $("txAmount").value.trim();
  const amount = amountText === "" ? null : Number(amountText);

  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 999999999)) {
    setMessage("transactionMessage", "Enter a valid draft amount.", "error");
    return;
  }

  const id = state.editingTransactionId || makeId();
  const record = {
    type: $("typeIncome").checked ? "income" : "expense",
    amount,
    date: $("txDate").value || localDateString(),
    description: $("txDescription").value.trim(),
    category: $("txCategory").value,
    paymentMethod: $("txPaymentMethod").value,
    note: $("txNote").value.trim()
  };

  const button = $("saveDraftBtn");
  button.disabled = true;
  setMessage("transactionMessage", "Saving draft...");

  try {
    await saveCloudDocument("drafts", id, record);

    const localDraft = { ...record, id };
    const index = state.drafts.findIndex((item) => item.id === id);

    if (index >= 0) state.drafts[index] = localDraft;
    else state.drafts.push(localDraft);

    renderDrafts();
    closeTransactionForm();
    navigateTo("drafts");
  } catch (error) {
    setMessage("transactionMessage", friendlyError(error), "error");
  } finally {
    button.disabled = false;
  }
});

function renderDrafts() {
  const drafts = [...state.drafts].sort((a, b) =>
    safeText(b.updatedAt?.seconds || b.id)
      .localeCompare(safeText(a.updatedAt?.seconds || a.id))
  );

  $("draftBadge").textContent = String(drafts.length);
  $("draftBadge").classList.toggle("hidden", drafts.length === 0);
  $("draftEmptyState").classList.toggle("hidden", drafts.length > 0);

  $("draftList").replaceChildren(
    ...drafts.map((draft) => {
      const card = document.createElement("article");
      card.className = "draft-card";

      const type = document.createElement("span");
      type.className = "draft-type";
      type.textContent = draft.type || "expense";

      const title = document.createElement("h3");
      title.textContent = draft.description || "Untitled draft";

      const details = document.createElement("p");
      const amount = draft.amount == null ? "Amount not entered" : money(draft.amount);
      details.textContent = `${amount} · ${draft.date || "No date"} · ${draft.category || "No category"}`;

      const note = document.createElement("p");
      note.textContent = draft.note || "No note";

      const actions = document.createElement("div");
      actions.className = "draft-card-actions";

      const resume = document.createElement("button");
      resume.className = "btn btn-primary";
      resume.type = "button";
      resume.textContent = "Continue editing";
      resume.addEventListener("click", () => openTransactionForm(draft.type, draft));

      const remove = document.createElement("button");
      remove.className = "btn btn-secondary";
      remove.type = "button";
      remove.textContent = "Delete draft";
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this draft permanently?")) return;

        remove.disabled = true;
        try {
          await removeCloudDocument("drafts", draft.id);
          state.drafts = state.drafts.filter((item) => item.id !== draft.id);
          renderDrafts();
        } catch (error) {
          alert(friendlyError(error));
          remove.disabled = false;
        }
      });

      actions.append(resume, remove);
      card.append(type, title, details, note, actions);
      return card;
    })
  );
}

/* -------------------------------------------------------
   10. TRANSACTION TABLE / FILTERS / EDIT / DELETE
------------------------------------------------------- */

function createTransactionRow(item, includeActions = true) {
  const row = document.createElement("tr");

  const titleCell = document.createElement("td");
  const titleWrap = document.createElement("div");
  titleWrap.className = "transaction-title";

  const mark = document.createElement("span");
  mark.className = `transaction-mark ${item.type === "income" ? "income-mark" : "expense-mark"}`;
  mark.textContent = item.type === "income" ? "+" : "−";

  const titleCopy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.description || "Untitled";
  titleCopy.append(title);

  if (item.note) {
    const note = document.createElement("div");
    note.className = "muted";
    note.style.fontSize = "10px";
    note.textContent = item.note;
    titleCopy.append(note);
  }

  titleWrap.append(mark, titleCopy);
  titleCell.append(titleWrap);

  const categoryCell = document.createElement("td");
  categoryCell.textContent = item.category || "Other";

  const dateCell = document.createElement("td");
  dateCell.textContent = item.date || "—";

  const amountCell = document.createElement("td");
  amountCell.className = `amount-cell ${item.type === "income" ? "amount-income" : "amount-expense"}`;
  amountCell.textContent = `${item.type === "income" ? "+" : "−"}${money(item.amount)}`;

  row.append(titleCell, categoryCell, dateCell);

  if (includeActions) {
    const paymentCell = document.createElement("td");
    paymentCell.textContent = item.paymentMethod || "—";

    const actionCell = document.createElement("td");
    const actionWrap = document.createElement("div");
    actionWrap.className = "row-actions";

    const edit = document.createElement("button");
    edit.className = "row-action";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openTransactionForm(item.type, item));

    const remove = document.createElement("button");
    remove.className = "row-action delete";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete "${item.description || "this transaction"}"? This cannot be undone.`)) return;

      remove.disabled = true;
      try {
        await removeCloudDocument("transactions", item.id);
        state.transactions = state.transactions.filter((transaction) => transaction.id !== item.id);
        renderAll();
      } catch (error) {
        alert(friendlyError(error));
        remove.disabled = false;
      }
    });

    actionWrap.append(edit, remove);
    actionCell.append(actionWrap);
    row.append(paymentCell);
    row.append(amountCell);
    row.append(actionCell);
  } else {
    row.append(amountCell);
  }

  return row;
}

function getFilteredTransactions() {
  const search = $("filterSearch").value.trim().toLowerCase();
  const type = $("filterType").value;
  const category = $("filterCategory").value;
  const from = $("filterFrom").value;
  const to = $("filterTo").value;

  return sortedTransactions(state.transactions).filter((item) => {
    const text = `${item.description || ""} ${item.note || ""}`.toLowerCase();

    if (search && !text.includes(search)) return false;
    if (type !== "all" && item.type !== type) return false;
    if (category !== "all" && item.category !== category) return false;
    if (from && item.date < from) return false;
    if (to && item.date > to) return false;
    return true;
  });
}

function renderTransactions() {
  const items = getFilteredTransactions();

  $("transactionCount").textContent = `${items.length} record${items.length === 1 ? "" : "s"}`;
  $("transactionsEmptyState").classList.toggle("hidden", items.length > 0);
  $("transactionsTableWrap").classList.toggle("hidden", items.length === 0);

  $("transactionRows").replaceChildren(
    ...items.map((item) => createTransactionRow(item, true))
  );
}

["filterSearch", "filterType", "filterCategory", "filterFrom", "filterTo"]
  .forEach((id) => $(id).addEventListener(
    id === "filterSearch" ? "input" : "change",
    renderTransactions
  ));

$("clearFiltersBtn").addEventListener("click", () => {
  $("filterSearch").value = "";
  $("filterType").value = "all";
  $("filterCategory").value = "all";
  $("filterFrom").value = "";
  $("filterTo").value = "";
  renderTransactions();
});

/* -------------------------------------------------------
   11. REPORTS
------------------------------------------------------- */

function setDefaultReportPeriod() {
  const now = new Date();
  $("reportMonth").value = monthString(now);
  $("reportFrom").value = `${monthString(now)}-01`;
  $("reportTo").value = localDateString(now);
}

$("reportMonth").addEventListener("change", () => {
  const month = $("reportMonth").value;
  if (!/^\d{4}-\d{2}$/.test(month)) return;

  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();

  $("reportFrom").value = `${month}-01`;
  $("reportTo").value = `${month}-${String(lastDay).padStart(2, "0")}`;
});

$("runReportBtn").addEventListener("click", runReport);

function runReport() {
  const from = $("reportFrom").value;
  const to = $("reportTo").value;

  if (from && to && from > to) {
    setMessage("reportMessage", "The start date must be on or before the end date.", "error");
    return;
  }

  setMessage("reportMessage", "");

  const filtered = state.transactions.filter((item) => {
    if (from && item.date < from) return false;
    if (to && item.date > to) return false;
    return true;
  });

  state.reportTransactions = sortedTransactions(filtered);

  const { income, expense } = totals(filtered);
  $("reportIncome").textContent = money(income);
  $("reportExpense").textContent = money(expense);
  $("reportBalance").textContent = money(income - expense);

  const categoryTotals = new Map();

  filtered.filter((item) => item.type === "expense").forEach((item) => {
    const category = item.category || "Other";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + Number(item.amount));
  });

  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
  const totalExpenses = categories.reduce((sum, item) => sum + item[1], 0);

  $("categoryEmptyState").classList.toggle("hidden", categories.length > 0);
  $("categoryBreakdown").replaceChildren(
    ...categories.map(([category, amount]) => {
      const item = document.createElement("div");
      item.className = "category-item";

      const info = document.createElement("div");
      info.className = "category-info";

      const name = document.createElement("span");
      name.textContent = category;

      const value = document.createElement("span");
      const percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
      value.textContent = `${money(amount)} · ${percentage.toFixed(1)}%`;

      info.append(name, value);

      const track = document.createElement("div");
      track.className = "category-track";

      const fill = document.createElement("div");
      fill.className = "category-fill";
      fill.style.width = `${percentage}%`;
      track.append(fill);

      item.append(info, track);
      return item;
    })
  );
}

/* -------------------------------------------------------
   12. CSV EXPORT
------------------------------------------------------- */

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTransactions(items, filename = "expenseflow-transactions.csv") {
  const headers = [
    "Date", "Type", "Description", "Category", "Payment method", "Amount", "Note"
  ];

  const rows = items.map((item) => [
    item.date,
    item.type,
    item.description,
    item.category,
    item.paymentMethod,
    Number(item.amount).toFixed(2),
    item.note
  ]);

  downloadCsv(filename, [headers, ...rows]);
}

$("exportReportBtn").addEventListener("click", () => {
  exportTransactions(state.reportTransactions, "expenseflow-report.csv");
});

$("settingsExportBtn").addEventListener("click", () => {
  exportTransactions(sortedTransactions(state.transactions));
  setMessage("settingsMessage", "Your CSV export has been prepared.", "success");
});

/* -------------------------------------------------------
   13. RENDER ALL VIEWS
------------------------------------------------------- */

function renderAll() {
  renderAccount();
  renderDashboard();
  renderTransactions();
  renderDrafts();
  runReport();
}

/* -------------------------------------------------------
   14. AUTH STATE
------------------------------------------------------- */

let firstAuthCallback = true;

onAuthStateChanged(auth, async (user) => {
  state.user = user;

  if (!user) {
    state.transactions = [];
    state.drafts = [];
    state.reportTransactions = [];
    showOnlyAuth();
    setAuthMode("login");

    if (firstAuthCallback) {
      $("appLoader").classList.add("hidden");
      firstAuthCallback = false;
    }
    return;
  }

  showOnlyApp();
  loadSavedTheme();
  renderAccount();

  try {
    await loadAllData();
    navigateTo("dashboard");
  } catch (error) {
    console.error("Unable to load account data:", error);
    alert(
      "Could not load your cloud data. Check your internet connection and Firestore rules.\n\n" +
      friendlyError(error)
    );
  } finally {
    firstAuthCallback = false;
    $("appLoader").classList.add("hidden");
  }
});

/* -------------------------------------------------------
   15. INITIAL DEFAULTS AND PWA SERVICE WORKER
------------------------------------------------------- */

loadSavedTheme();
setDefaultReportPeriod();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then((registration) => {
        console.info("ExpenseFlow service worker registered:", registration.scope);
      })
      .catch((error) => {
        console.warn("Service worker registration failed:", error);
      });
  });
}
