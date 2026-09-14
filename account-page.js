/* LapMob account pages - Firebase-safe version */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  setPersistence, browserLocalPersistence, signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, deleteDoc, getDocs,
  query, orderBy, onSnapshot, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const $ = id => document.getElementById(id);
const accountKey = document.body.dataset.accountPage;
const VALID_ACCOUNTS = ["bank", "savings", "emergency", "other"];

let currentUser = null;
let transactions = [];
let unsubscribe = null;

const hiddenBalances = JSON.parse(
  localStorage.getItem("lapmobHiddenBalances") || "{}"
);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return "NT$" + Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setSensitiveValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.dataset.value = value;
  el.textContent = hiddenBalances[id] ? "••••••" : value;
}

document.addEventListener("click", event => {
  const eye = event.target.closest(".eye-toggle");
  if (!eye) return;
  event.preventDefault();
  event.stopPropagation();

  const id = eye.dataset.target;
  hiddenBalances[id] = !hiddenBalances[id];
  localStorage.setItem(
    "lapmobHiddenBalances",
    JSON.stringify(hiddenBalances)
  );
  setSensitiveValue(id, $(id)?.dataset.value || "NT$0");
});

/* Back button works independently of Firebase. */
$("backBtn")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  window.location.href = "./index.html";
});

/* Make absolutely sure the amount input remains editable. */
const amountInput = $("amount");
if (amountInput) {
  amountInput.disabled = false;
  amountInput.readOnly = false;
  amountInput.removeAttribute("disabled");
  amountInput.style.pointerEvents = "auto";
  amountInput.style.userSelect = "text";
}

if ($("date") && !$("date").value) {
  $("date").value = today();
}

function balanceForPage() {
  return transactions.reduce((total, t) => {
    if (t.account !== accountKey) return total;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount < 0) return total;
    if (t.type === "income") return total + amount;
    if (t.type === "expense" || t.type === "withdrawal") return total - amount;
    return total;
  }, 0);
}

function sumType(type) {
  return transactions
    .filter(t => t.account === accountKey && t.type === type)
    .reduce((s, t) => s + Number(t.amount || 0), 0);
}

function render() {
  setSensitiveValue("pageBalance", money(balanceForPage()));
  setSensitiveValue("pageIncome", money(sumType("income")));
  setSensitiveValue("pageExpense", money(sumType("expense")));
  setSensitiveValue("pageWithdrawal", money(sumType("withdrawal")));

  if ($("pageIncomeTotal")) $("pageIncomeTotal").textContent = money(sumType("income"));
  if ($("pageExpenseTotal")) $("pageExpenseTotal").textContent = money(sumType("expense"));
  if ($("pageWithdrawalTotal")) $("pageWithdrawalTotal").textContent = money(sumType("withdrawal"));

  renderGroup("incomeRows", "income", "+");
  renderGroup("expenseRows", "expense", "-");
  renderGroup("withdrawalRows", "withdrawal", "-");
}

function renderGroup(id, type, sign) {
  const el = $(id);
  if (!el) return;

  const rows = transactions
    .filter(t => t.account === accountKey && t.type === type)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!rows.length) {
    el.innerHTML = '<div class="transaction-empty">No transactions yet.</div>';
    return;
  }

  el.innerHTML = rows.map(t => `
    <div class="transaction-row">
      <span>${esc(t.date)}</span>
      <span>${esc(t.category)}</span>
      <span>${esc(t.note || "—")}</span>
      <span class="amount ${type}">${sign}${money(t.amount)}</span>
      <span>
        <button class="row-delete" type="button" data-delete-id="${esc(t.id)}">Delete</button>
      </span>
    </div>
  `).join("");
}

async function loadTransactions(user) {
  if (unsubscribe) unsubscribe();

  const ref = collection(db, "users", user.uid, "transactions");
  const q = query(ref, orderBy("date", "desc"));

  unsubscribe = onSnapshot(q, snapshot => {
    transactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, error => {
    console.error(error);
    alert("Firebase could not load transactions: " + error.message);
  });
}

async function migrateLocalData(user) {
  const raw = localStorage.getItem("lapmobData");
  if (!raw) return;

  let localData;
  try { localData = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(localData) || !localData.length) return;

  const ref = collection(db, "users", user.uid, "transactions");
  const existing = await getDocs(ref);
  if (!existing.empty) return;

  for (const t of localData) {
    if (!["cash", "bank", "savings", "emergency", "other"].includes(t.account)) continue;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    await addDoc(ref, {
      account: t.account,
      type: t.type,
      amount,
      category: t.category || "Other",
      date: t.date || today(),
      note: t.note || "",
      createdAt: t.createdAt || Date.now(),
      migratedFromLocalStorage: true
    });
  }
}

async function addTransaction(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!currentUser) {
    alert("Please sign in with Google first.");
    return;
  }

  const form = event.currentTarget;
  const amount = Number($("amount")?.value);
  const type = $("type")?.value || "income";
  const category = $("category")?.value || "Other";
  const date = $("date")?.value;
  const note = $("note")?.value.trim() || "";

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Please enter a valid amount.");
    $("amount")?.focus();
    return;
  }

  if (!date) {
    alert("Please select a date.");
    $("date")?.focus();
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  const oldText = submit?.textContent;

  try {
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Saving...";
    }

    await addDoc(
      collection(db, "users", currentUser.uid, "transactions"),
      {
        account: accountKey,
        type,
        amount,
        category,
        date,
        note,
        createdAt: Date.now()
      }
    );

    form.reset();
    if ($("date")) $("date").value = today();
    if ($("account")) $("account").value = accountKey;
  } catch (error) {
    console.error(error);
    alert("Could not save the transaction: " + error.message);
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = oldText || "+ Add Transaction";
    }
  }
}

async function deleteTransaction(id) {
  if (!currentUser || !id) return;
  if (!confirm("Delete this transaction?")) return;

  try {
    await deleteDoc(
      doc(db, "users", currentUser.uid, "transactions", id)
    );
  } catch (error) {
    console.error(error);
    alert("Could not delete the transaction: " + error.message);
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  deleteTransaction(button.dataset.deleteId);
});

if (accountKey === "other") {
  $("editOtherNameBtn")?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();

    const current = localStorage.getItem("lapmobOtherName") || "Other";
    const name = prompt("Enter a name for this account:", current);
    if (!name?.trim()) return;

    localStorage.setItem("lapmobOtherName", name.trim());

    if (currentUser) {
      await setDoc(
        doc(db, "users", currentUser.uid, "settings", "otherName"),
        { name: name.trim() },
        { merge: true }
      );
    }
  });
}

const form = $("accountTransactionForm");
if (form) {
  form.addEventListener("submit", addTransaction);
}

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    transactions = [];
    render();
    return;
  }

  loadTransactions(user);
});

setPersistence(auth, browserLocalPersistence).catch(console.warn);
