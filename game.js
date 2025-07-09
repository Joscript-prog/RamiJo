import { db, ref, set, get, onValue } from './firebase.js';

const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const gameDiv = document.getElementById('game');
const menuDiv = document.getElementById('menu');
const playersDiv = document.getElementById('players');
const drawCardBtn = document.getElementById('drawCard');
const endTurnBtn = document.getElementById('endTurn');

const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;

// --- Création deck 104 cartes ---
function createDeck() {
  const suits = ['Coeurs', 'Carreaux', 'Trèfles', 'Piques'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

createRoomBtn.onclick = async () => {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  await set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { ready: false });
  launchGame(currentRoom);
};

joinRoomBtn.onclick = async () => {
  currentRoom = roomInput.value.trim();
  if (!currentRoom) return alert('Veuillez entrer un code de salle.');

  await set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { ready: false });
  launchGame(currentRoom);
};

function launchGame(roomCode) {
  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  status.innerText = `Connecté à la salle ${roomCode} en tant que ${playerId}`;

  const playersRef = ref(db, `rooms/${roomCode}/players`);
  onValue(playersRef, async snapshot => {
    const players = snapshot.val() || {};
    playersDiv.innerHTML = '<h3>Joueurs dans la salle :</h3>';
    for (let id in players) {
      const p = document.createElement('p');
      p.innerText = id === playerId ? id + ' (Moi)' : id;
      playersDiv.appendChild(p);
    }

    // Distribution des cartes une seule fois
    if (!gameInitialized && Object.keys(players).length >= 2) {
      const handsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
      if (!handsSnap.exists()) {
        gameInitialized = true;
        await dealCards(roomCode, Object.keys(players));
        await startGame(roomCode, Object.keys(players));
      }
    }
  });

  const currentTurnRef = ref(db, `rooms/${roomCode}/currentTurn`);
  onValue(currentTurnRef, snapshot => {
    const currentPlayerTurn = snapshot.val();
    status.innerText = `Connecté à la salle ${roomCode} en tant que ${playerId}\nC'est au tour de ${currentPlayerTurn}${currentPlayerTurn === playerId ? " (Moi)" : ""}`;
  });

  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    const handDiv = document.getElementById('hand');
    handDiv.innerHTML = '<h3>Votre main :</h3>';
    hand.forEach(card => {
      const cardP = document.createElement('p');
      cardP.innerText = `${card.rank} de ${card.suit}`;
      handDiv.appendChild(cardP);
    });
  });

  drawCardBtn.onclick = async () => {
    const turnSnap = await get(ref(db, `rooms/${currentRoom}/currentTurn`));
    if (turnSnap.val() !== playerId) {
      alert("Ce n'est pas votre tour !");
      return;
    }

    const deckSnap = await get(ref(db, `rooms/${currentRoom}/deck`));
    const deck = deckSnap.val();

    if (!deck || deck.length === 0) {
      alert("Plus de cartes à piocher !");
      return;
    }

    const drawnCard = deck[0];
    const newDeck = deck.slice(1);
    await set(ref(db, `rooms/${currentRoom}/deck`), newDeck);

    const handRef = ref(db, `rooms/${currentRoom}/hands/${playerId}`);
    const handSnap = await get(handRef);
    const hand = handSnap.val() || [];
    hand.push(drawnCard);
    await set(handRef, hand);

    alert(`Vous avez pioché : ${drawnCard.rank} de ${drawnCard.suit}`);
  };

  endTurnBtn.onclick = async () => {
    const turnSnap = await get(ref(db, `rooms/${currentRoom}/currentTurn`));
    if (turnSnap.val() !== playerId) {
      alert("Ce n'est pas votre tour !");
      return;
    }
    const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = Object.keys(playersSnap.val() || {});
    if (players.length === 0) return;

    const currentIndex = players.indexOf(playerId);
    const nextIndex = (currentIndex + 1) % players.length;
    await set(ref(db, `rooms/${currentRoom}/currentTurn`), players[nextIndex]);
  };
}

// Distribuer les cartes + créer le deck
async function dealCards(roomCode, players) {
  let deck = shuffleDeck(createDeck());
  let index = 0;
  for (const pId of players) {
    const playerCards = deck.slice(index, index + 13);
    index += 13;
    await set(ref(db, `rooms/${roomCode}/hands/${pId}`), playerCards);
  }
  const remainingDeck = deck.slice(index);
  await set(ref(db, `rooms/${roomCode}/deck`), remainingDeck);
}

// Lancer la partie (donner le tour à un joueur au hasard)
async function startGame(roomCode, players) {
  if (players.length === 0) return;
  const firstPlayer = players[Math.floor(Math.random() * players.length)];
  await set(ref(db, `rooms/${roomCode}/currentTurn`), firstPlayer);
}

// ✅ Rendre dispo dans la console pour debug manuel
window.dealCards = dealCards;
window.startGame = startGame;
