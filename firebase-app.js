// LapMob Budget Tracker - Shared Firebase module
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence, updateProfile
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  setDoc, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(console.warn);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export {
  app, auth, db, googleProvider, signInWithPopup, signOut,
  onAuthStateChanged, updateProfile, collection, doc, getDoc, getDocs,
  addDoc, deleteDoc, setDoc, query, orderBy, onSnapshot
};

export const transactionsRef = uid => collection(db, "users", uid, "transactions");
export const settingRef = (uid, name) => doc(db, "users", uid, "settings", name);
