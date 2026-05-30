import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ── REPLACE WITH YOUR FIREBASE CONFIG ────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAqZ3YUJLlKaqpa6_T65nUuReDDJ8HMYTo",
  authDomain: "last-buyer.firebaseapp.com",
  projectId: "last-buyer",
  storageBucket: "last-buyer.firebasestorage.app",
  messagingSenderId: "521628259636",
  appId: "1:521628259636:web:9d9f6f2c8a2ed5b5450161"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
