
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAspBA_bsCDKSuOhuxlFLWZXOCf5zPnrFs",
  authDomain: "justiceai-14c20.firebaseapp.com",
  projectId: "justiceai-14c20",
  storageBucket: "justiceai-14c20.firebasestorage.app",
  messagingSenderId: "1561810758",
  appId: "1:1561810758:web:b2ce62f387b47086303747",
  measurementId: "G-BKQSC7JQ50"
};

let auth;
try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (err) {
  console.warn("Firebase not properly configured yet. Using mock auth.");
}

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup };
