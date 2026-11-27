import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC06R-hiKFBGlhTWgX18O47ynSMd48Kmf8",
  authDomain: "moc-shop-2500016046.firebaseapp.com",
  projectId: "moc-shop-2500016046",
  storageBucket: "moc-shop-2500016046.firebasestorage.app",
  messagingSenderId: "101789182203",
  appId: "1:101789182203:web:8aac24a540218ad9fde85e"
};

export const ADMIN_EMAILS = ["hoangvancu1999@gmail.com"];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};
