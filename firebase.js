// firebase.js
import { 
  initializeApp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  onValue,
  onDisconnect,
  push,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ✅ Configuration Firebase (ton projet Rami en ligne)
const firebaseConfig = {
  apiKey: "AIzaSyDnMUxn4llJdeeKWVCt-8Z4YP0rrv5BOZM",
  authDomain: "rami-en-ligne.firebaseapp.com",
  databaseURL: "https://rami-en-ligne-default-rtdb.firebaseio.com",
  projectId: "rami-en-ligne",
  storageBucket: "rami-en-ligne.appspot.com",
  messagingSenderId: "521757798474",
  appId: "1:521757798474:web:db77e704d36990a1d0b6b3"
};

// 🔧 Initialisation de l'app Firebase
const app = initializeApp(firebaseConfig);

// 🔗 Référence à la base de données temps réel
const db = getDatabase(app);

// 🔄 Exportation des fonctions Firebase pour game.js
export {
  db,
  ref,
  set,
  update,
  get,
  onValue,
  onDisconnect,
  push,
  remove
};
