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

/* =========================================================
   PROFILE SYSTEM
   ========================================================= */

let profileEditMode = false;
let profileUser = null;

function profileElement(id) {
  return document.getElementById(id);
}

function setProfileMessage(message, success = true) {
  const el = profileElement("profileMessage");

  if (!el) return;

  el.textContent = message;

  el.className = success
    ? "auth-message profile-message-success"
    : "auth-message profile-message-error";
}

function defaultProfilePhoto(user) {

  if (user?.photoURL) {
    return user.photoURL;
  }

  return "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg"
           width="120"
           height="120"
           viewBox="0 0 120 120">

        <circle cx="60" cy="60" r="60" fill="#e5e7eb"/>

        <circle cx="60" cy="45" r="22"
                fill="#9ca3af"/>

        <path
          d="M20 105
             C25 78 42 68 60 68
             C78 68 95 78 100 105Z"
          fill="#9ca3af"/>

      </svg>
    `);
}

async function loadProfile(user) {

  if (!user) return;

  profileUser = user;

  const nameInput = profileElement("profileName");
  const usernameInput = profileElement("profileUsername");
  const email = profileElement("profileEmail");
  const photo = profileElement("profilePhoto");
  const displayName = profileElement("profileDisplayName");
  const provider = profileElement("profileProvider");
  const googleInfo = profileElement("profileGoogleInfo");

  const profileRef = doc(
    db,
    "users",
    user.uid,
    "profile",
    "information"
  );

  let profileData = {};

  try {

    const snapshot = await getDoc(profileRef);

    if (snapshot.exists()) {
      profileData = snapshot.data();
    }

  } catch (error) {

    console.error("Profile load error:", error);

  }

  const name =
    profileData.name ||
    user.displayName ||
    "User";

  const username =
    profileData.username ||
    "";

  if (nameInput) {
    nameInput.value = name;
  }

  if (usernameInput) {
    usernameInput.value = username;
  }

  if (email) {
    email.textContent = user.email || "—";
  }

  if (displayName) {
    displayName.textContent = name;
  }

  if (photo) {
    photo.src = defaultProfilePhoto(user);
  }

  const googleProviderData =
    user.providerData?.find(
      p => p.providerId === "google.com"
    );

  if (googleProviderData) {

    if (provider) {
      provider.textContent = "Google Account";
    }

    if (googleInfo) {
      googleInfo.textContent =
        googleProviderData.email ||
        user.email ||
        "Google account connected";
    }

  } else {

    if (provider) {
      provider.textContent = "Firebase Account";
    }

    if (googleInfo) {
      googleInfo.textContent =
        "Google account not connected";
    }
  }

  setProfileEditMode(false);
}

function setProfileEditMode(enabled) {

  profileEditMode = enabled;

  const nameInput = profileElement("profileName");
  const usernameInput = profileElement("profileUsername");

  const editButton = profileElement("editProfileBtn");
  const saveButton = profileElement("saveProfileBtn");
  const cancelButton = profileElement("cancelProfileBtn");

  if (nameInput) {
    nameInput.disabled = !enabled;
  }

  if (usernameInput) {
    usernameInput.disabled = !enabled;
  }

  if (editButton) {
    editButton.hidden = enabled;
  }

  if (saveButton) {
    saveButton.hidden = !enabled;
  }

  if (cancelButton) {
    cancelButton.hidden = !enabled;
  }

  if (enabled) {
    nameInput?.focus();
  }
}

async function saveProfile() {

  if (!profileUser) {
    setProfileMessage(
      "Please sign in first.",
      false
    );
    return;
  }

  const name =
    profileElement("profileName")?.value.trim() || "";

  const username =
    profileElement("profileUsername")?.value.trim() || "";

  if (!name) {

    setProfileMessage(
      "Please enter your name.",
      false
    );

    profileElement("profileName")?.focus();

    return;
  }

  if (!username) {

    setProfileMessage(
      "Please enter a username.",
      false
    );

    profileElement("profileUsername")?.focus();

    return;
  }

  const saveButton =
    profileElement("saveProfileBtn");

  const oldText =
    saveButton?.textContent;

  try {

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    /* Update Firebase Authentication name */
    await updateProfile(
      profileUser,
      {
        displayName: name
      }
    );

    /* Save profile information to Firestore */
    await setDoc(
      doc(
        db,
        "users",
        profileUser.uid,
        "profile",
        "information"
      ),
      {
        name,
        username,
        email: profileUser.email || "",
        photoURL: profileUser.photoURL || "",
        provider: "google.com",
        updatedAt: Date.now()
      },
      {
        merge: true
      }
    );

    const displayName =
      profileElement("profileDisplayName");

    if (displayName) {
      displayName.textContent = name;
    }

    setProfileMessage(
      "Profile saved successfully.",
      true
    );

    setProfileEditMode(false);

  } catch (error) {

    console.error(
      "Save profile error:",
      error
    );

    setProfileMessage(
      "Could not save profile: " +
      (error?.message || error),
      false
    );

  } finally {

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent =
        oldText || "💾 Save Changes";
    }

  }
}

function openProfile() {

  if (!user) {

    alert(
      "Please sign in with Google first."
    );

    return;
  }

  const modal =
    profileElement("profileModal");

  if (!modal) return;

  modal.classList.remove("hidden");

  setProfileMessage("");

  loadProfile(user);
}

function closeProfile() {

  const modal =
    profileElement("profileModal");

  if (!modal) return;

  modal.classList.add("hidden");

  setProfileEditMode(false);

  setProfileMessage("");
}

function setupProfileSystem() {

  /* Open profile */

  profileElement("profileBtn")
    ?.addEventListener(
      "click",
      openProfile
    );

  /* Close */

  profileElement("closeProfileBtn")
    ?.addEventListener(
      "click",
      closeProfile
    );

  profileElement("cancelProfileBtn")
    ?.addEventListener(
      "click",
      () => {

        if (user) {
          loadProfile(user);
        }

        setProfileEditMode(false);
        setProfileMessage("");

      }
    );

  /* Edit */

  profileElement("editProfileBtn")
    ?.addEventListener(
      "click",
      () => {

        setProfileMessage("");

        setProfileEditMode(true);

      }
    );

  /* Save */

  profileElement("saveProfileBtn")
    ?.addEventListener(
      "click",
      saveProfile
    );

  /* Logout */

  profileElement("profileLogoutBtn")
    ?.addEventListener(
      "click",
      async () => {

        try {

          await signOut(auth);

          closeProfile();

        } catch (error) {

          console.error(
            "Logout error:",
            error
          );

          setProfileMessage(
            "Logout failed: " +
            error.message,
            false
          );

        }

      }
    );

  /* Settings */

  profileElement("profileSettingsBtn")
    ?.addEventListener(
      "click",
      () => {

        const panel =
          profileElement(
            "profileSettingsPanel"
          );

        if (!panel) return;

        panel.hidden = !panel.hidden;

      }
    );

  /* Close when clicking outside */

  profileElement("profileModal")
    ?.addEventListener(
      "click",
      event => {

        if (
          event.target.id ===
          "profileModal"
        ) {
          closeProfile();
        }

      }
    );
}

async function start() {
  setupProfileSystem();
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
