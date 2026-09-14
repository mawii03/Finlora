import {
  auth, db, signInWithPopup, signOut, onAuthStateChanged, updateProfile,
  collection, doc, getDoc, addDoc, deleteDoc, setDoc, query, orderBy, onSnapshot,
  googleProvider
} from "./firebase-app.js";

const $ = id => document.getElementById(id);
const hiddenBalances = JSON.parse(localStorage.getItem("lapmobHiddenBalances") || "{}");
const ACCOUNTS = ["cash", "bank", "savings", "emergency", "other"];
let user = null;
let data = [];
let unsubscribe = null;

function money(n) {
  return "NT$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function today() { return new Date().toISOString().slice(0, 10); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function setSensitiveValue(id, value) {
  const el = $(id); if (!el) return;
  el.dataset.value = value;
  el.textContent = hiddenBalances[id] ? "••••••" : value;
  const eye = document.querySelector(`.eye-toggle[data-target="${id}"]`);
  if (eye) eye.textContent = hiddenBalances[id] ? "👁‍🗨" : "👁";
}
document.addEventListener("click", e => {
  const eye = e.target.closest(".eye-toggle");
  if (!eye) return;
  e.preventDefault(); e.stopPropagation();
  const id = eye.dataset.target;
  hiddenBalances[id] = !hiddenBalances[id];
  localStorage.setItem("lapmobHiddenBalances", JSON.stringify(hiddenBalances));
  setSensitiveValue(id, $(id)?.dataset.value || "NT$0");
});

function calculateFunds() {
  const funds = Object.fromEntries(ACCOUNTS.map(a => [a, 0]));
  for (const x of data) {
    if (!ACCOUNTS.includes(x.account)) continue;
    const amount = Number(x.amount);
    if (!Number.isFinite(amount) || amount < 0) continue;
    if (x.type === "income") funds[x.account] += amount;
    if (x.type === "expense" || x.type === "withdrawal") funds[x.account] -= amount;
  }
  return funds;
}
function otherName() {
  return localStorage.getItem("lapmobOtherName") || "Other";
}
function renderFunds() {
  const f = calculateFunds();
  for (const a of ACCOUNTS) setSensitiveValue(a === "cash" ? "cashAmount" : a + "Amount", money(f[a]));
  if ($("otherFundName")) $("otherFundName").textContent = otherName();
  if ($("fundTotal")) $("fundTotal").textContent = money(f.cash + f.bank);
}
function renderGroup(id, rows, cls, sign, empty) {
  const el = $(id); if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="transaction-empty">${empty}</div>`; return; }
  el.innerHTML = rows.map(x => `
    <div class="transaction-row">
      <span>${esc(x.date)}</span><span>${esc(x.category)}</span>
      <span>${esc(x.note || "—")}</span>
      <span class="amount ${cls}">${sign}${money(x.amount)}</span>
      <span><button class="row-delete" type="button" data-delete-id="${esc(x.id)}">Delete</button></span>
    </div>`).join("");
}
function render() {
  const f = calculateFunds();
  setSensitiveValue("balance", money(f.cash + f.bank));
  const income = data.filter(x => x.type === "income");
  const expense = data.filter(x => x.type === "expense");
  setSensitiveValue("income", money(income.reduce((s, x) => s + Number(x.amount || 0), 0)));
  setSensitiveValue("expenses", money(expense.reduce((s, x) => s + Number(x.amount || 0), 0)));
  if ($("count")) $("count").textContent = data.length;

  const cash = data.filter(x => x.account === "cash").sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderGroup("cashIncomeRows", cash.filter(x => x.type === "income"), "income", "+", "No cash income yet.");
  renderGroup("cashExpenseRows", cash.filter(x => x.type === "expense"), "expense", "-", "No cash expenses yet.");
  renderGroup("cashWithdrawalRows", cash.filter(x => x.type === "withdrawal"), "withdrawal", "-", "No cash withdrawals yet.");
  if ($("cashIncomeTotal")) $("cashIncomeTotal").textContent = money(cash.filter(x => x.type === "income").reduce((s, x) => s + Number(x.amount || 0), 0));
  if ($("cashExpenseTotal")) $("cashExpenseTotal").textContent = money(cash.filter(x => x.type === "expense").reduce((s, x) => s + Number(x.amount || 0), 0));
  if ($("cashWithdrawalTotal")) $("cashWithdrawalTotal").textContent = money(cash.filter(x => x.type === "withdrawal").reduce((s, x) => s + Number(x.amount || 0), 0));
  const ym = today().slice(0, 7);
  if ($("monthSpend")) $("monthSpend").textContent = money(cash.filter(x => x.type === "expense" && String(x.date).startsWith(ym)).reduce((s, x) => s + Number(x.amount || 0), 0));
  const cats = {};
  cash.filter(x => x.type === "expense").forEach(x => cats[x.category] = (cats[x.category] || 0) + Number(x.amount || 0));
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  if ($("topCategory")) $("topCategory").textContent = top ? `${top[0]} (${money(top[1])})` : "—";
  if ($("rows")) {
    let rows = [...data];
    const month = $("monthFilter")?.value || "all";
    const type = $("typeFilter")?.value || "all";
    if (month !== "all") rows = rows.filter(x => String(x.date).startsWith(month));
    if (type !== "all") rows = rows.filter(x => x.type === type);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    renderGroup("rows", rows, "amount", "", "No transactions yet.");
  }
}
async function addTransaction(e) {
  e.preventDefault();
  if (!user) return alert("Please sign in first.");
  const amount = Number($("amount").value), date = $("date").value, account = $("account").value;
  if (!ACCOUNTS.includes(account) || !Number.isFinite(amount) || amount <= 0 || !date) return alert("Please enter valid transaction details.");
  await addDoc(collection(db, "users", user.uid, "transactions"), {
    account, type: $("type").value, amount, category: $("category").value,
    date, note: $("note").value.trim(), createdAt: Date.now()
  });
  e.target.reset(); $("date").value = today();
}
async function removeTransaction(id) {
  if (!user || !id || !confirm("Delete this transaction?")) return;

  try {
    await deleteDoc(
      doc(db, "users", user.uid, "transactions", id)
    );
  } catch (error) {
    console.error("Delete transaction error:", error);
    alert("Could not delete the transaction: " + error.message);
  }
}
async function start() {
  if ($("date")) $("date").value = today();
  $("form")?.addEventListener("submit", addTransaction);
  document.addEventListener("click", e => {
  const b = e.target.closest("[data-delete-id]");

  if (!b) return;

  e.preventDefault();
  e.stopPropagation();

  removeTransaction(b.dataset.deleteId);
});
  $("refreshFundsBtn")?.addEventListener("click", renderFunds);
  $("editOtherNameBtn")?.addEventListener("click", () => {
    const n = prompt("Enter a name for this account:", otherName());
    if (n?.trim()) { localStorage.setItem("lapmobOtherName", n.trim()); renderFunds(); }
  });
  $("googleSignInBtn")?.addEventListener("click", async () => {
  const btn = $("googleSignInBtn");

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing in...";
    }

    await signInWithPopup(auth, googleProvider);

  } catch (e) {
    console.error("Google sign-in error:", e);

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sign in with Google";
    }

    alert("Google sign-in failed: " + (e?.message || e));
  }
});
  
  $("logoutBtn")?.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, u => {
  user = u;

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const signInBtn = $("googleSignInBtn");
  const logoutBtn = $("logoutBtn");
  const status = $("status");
  const userEmail = $("userEmail");

  if (!u) {
    if (status) {
      status.textContent = "Signed out";
      status.classList.remove("ok");
    }

    if (userEmail) {
      userEmail.textContent = "";
    }

    if (signInBtn) {
      signInBtn.hidden = false;
      signInBtn.disabled = false;
      signInBtn.textContent = "Sign in with Google";
    }

    if (logoutBtn) {
      logoutBtn.hidden = true;
    }

    data = [];
    renderFunds();
    render();
    return;
  }

  // USER IS REALLY SIGNED IN
  if (status) {
    status.textContent = "Connected";
    status.classList.add("ok");
  }

  if (userEmail) {
    userEmail.textContent = u.email || "";
  }

  if (signInBtn) {
    signInBtn.hidden = true;
    signInBtn.disabled = false;
  }

  if (logoutBtn) {
    logoutBtn.hidden = false;
  }

  const q = query(
    collection(db, "users", u.uid, "transactions"),
    orderBy("date", "desc")
  );

  unsubscribe = onSnapshot(
    q,
    snap => {
      data = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      renderFunds();
      render();
    },
    err => {
      console.error("Firestore error:", err);

      alert(
        "Firestore error: " +
        (err?.message || "Unable to load your transactions.")
      );
    }
  );
});

}
start();
