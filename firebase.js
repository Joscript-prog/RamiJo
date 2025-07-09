import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnMUxn4llJdeeKWVCt-8Z4YP0rrv5BOZM",
  authDomain: "rami-en-ligne.firebaseapp.com",
  databaseURL: "https://rami-en-ligne-default-rtdb.firebaseio.com",  // ✅ ajout essentiel
  projectId: "rami-en-ligne",
  storageBucket: "rami-en-ligne.firebasestorage.app",
  messagingSenderId: "521757798474",
  appId: "1:521757798474:web:db77e704d36990a1d0b6b3"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, get, onValue };
