import { db, ref, set, onValue } from './firebase.js';

const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const gameDiv = document.getElementById('game');
const menuDiv = document.getElementById('menu');
const playersDiv = document.getElementById('players');

// ID joueur unique (ex : player_4821)
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';

/**
 * Crée une nouvelle salle et enregistre le joueur dans Firebase
 */
createRoomBtn.onclick = async () => {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  const roomRef = ref(db, `rooms/${currentRoom}/players/${playerId}`);
  await set(roomRef, { ready: false });

  launchGame(currentRoom);
};

/**
 * Rejoint une salle existante via le code tapé
 */
joinRoomBtn.onclick = async () => {
  currentRoom = roomInput.value.trim();
  if (!currentRoom) return alert('Veuillez entrer un code de salle.');

  const roomRef = ref(db, `rooms/${currentRoom}/players/${playerId}`);
  await set(roomRef, { ready: false });

  launchGame(currentRoom);
};

/**
 * Affiche la zone de jeu et écoute les changements de joueurs
 */
function launchGame(roomCode) {
  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  status.innerText = `Connecté à la salle ${roomCode} en tant que ${playerId}`;

  const playersRef = ref(db, `rooms/${roomCode}/players`);
  onValue(playersRef, snapshot => {
    const players = snapshot.val();
    playersDiv.innerHTML = '';
    for (let id in players) {
      const playerElement = document.createElement('p');
      playerElement.innerText = id;
      playersDiv.appendChild(playerElement);
    }
  });
}
