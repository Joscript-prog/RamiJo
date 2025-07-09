// game.js (version enrichie avec zone de dépôt + actions manuelles)
import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// Références DOM
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const gameDiv = document.getElementById('game');
const menuDiv = document.getElementById('menu');
const playersDiv = document.getElementById('players');
const drawCardBtn = document.getElementById('drawCard');
const endTurnBtn = document.getElementById('endTurn');
const handDiv = document.getElementById('hand');
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const dropZone = document.getElementById('dropZone');

const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;

// Création du deck 104 cartes (2 jeux de 52)
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

// Mélange Fisher-Yates
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

createRoomBtn.onclick = async () => {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  await joinRoom(currentRoom);
  initGameListeners(currentRoom);
};

joinRoomBtn.onclick = async () => {
  const code = roomInput.value.trim();
  if (!code) return alert('Veuillez entrer un code de salle.');
  currentRoom = code;
  await joinRoom(currentRoom);
  initGameListeners(currentRoom);
};

async function joinRoom(roomCode) {
  const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
  await set(playerRef, { pseudo, ready: false });
  onDisconnect(playerRef).remove();

  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  status.innerText = `Salle : ${roomCode} | Vous : ${pseudo}`;
}

function initGameListeners(roomCode) {
  listenToPlayers(roomCode);
  listenToTurn(roomCode);
  listenToHand(roomCode);
  setupActions(roomCode);
}

function listenToPlayers(roomCode) {
  const playersRef = ref(db, `rooms/${roomCode}/players`);
  onValue(playersRef, async snapshot => {
    const players = snapshot.val() || {};
    playersDiv.innerHTML = '<h3>Joueurs :</h3>';
    const playerOrder = Object.entries(players).map(([id, info]) => `${info.pseudo}${id === playerId ? ' (Moi)' : ''}`);
    playersDiv.innerHTML += '<p>' + playerOrder.join(' → ') + '</p>';

    if (!gameInitialized && Object.keys(players).length >= 2) {
      const handsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
      if (!handsSnap.exists()) {
        const success = await dealCards(roomCode, Object.keys(players));
        if (success) {
          gameInitialized = true;
          await startGame(roomCode, Object.keys(players));
        }
      }
    }
  });
}

function listenToTurn(roomCode) {
  const currentTurnRef = ref(db, `rooms/${roomCode}/currentTurn`);
  onValue(currentTurnRef, snapshot => {
    const currentPlayer = snapshot.val();
    const turnText = currentPlayer === playerId ? "(Moi) ⭐ ← À vous de jouer !" : `Tour de : ${currentPlayer}`;
    status.innerText = `Salle : ${roomCode} | Vous : ${pseudo} | ${turnText}`;
  });
}

function listenToHand(roomCode) {
  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    handDiv.innerHTML = '<h3>Votre main :</h3>';

    hand.forEach((card, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.draggable = true;
      cardEl.dataset.index = index;
      cardEl.innerText = `${card.rank} de ${card.suit}`;
      cardEl.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', index);
      });
      handDiv.appendChild(cardEl);
    });

    // Générer les zones de dépôt (14 cases)
    dropZone.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const slot = document.createElement('div');
      slot.className = 'drop-slot';
      slot.dataset.index = i;
      slot.ondragover = e => e.preventDefault();
      slot.ondrop = e => {
        const cardIndex = e.dataTransfer.getData('text/plain');
        const card = hand[cardIndex];
        slot.innerText = `${card.rank} de ${card.suit}`;
      };
      dropZone.appendChild(slot);
    }
  });
}

function setupActions(roomCode) {
  drawCardBtn.onclick = async () => {
    const turnSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
    if (turnSnap.val() !== playerId) return alert("Ce n'est pas votre tour !");

    const deckSnap = await get(ref(db, `rooms/${roomCode}/deck`));
    const deck = deckSnap.val();
    if (!deck || deck.length === 0) return alert("Plus de cartes disponibles !");

    const drawnCard = deck[0];
    const newDeck = deck.slice(1);
    await set(ref(db, `rooms/${roomCode}/deck`), newDeck);

    const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    hand.push(drawnCard);
    await set(ref(db, `rooms/${roomCode}/hands/${playerId}`), hand);

    alert(`Vous avez pioché : ${drawnCard.rank} de ${drawnCard.suit}`);
  };

  endTurnBtn.onclick = async () => {
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = Object.keys(playersSnap.val() || {});
    if (players.length < 2) return alert("Pas assez de joueurs pour changer de tour.");

    const currentSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
    const currentIndex = players.indexOf(currentSnap.val());
    const nextIndex = (currentIndex + 1) % players.length;
    await set(ref(db, `rooms/${roomCode}/currentTurn`), players[nextIndex]);
  };

  declare7NBtn.onclick = () => {
    push(ref(db, `rooms/${roomCode}/actions`), {
      type: '7N_DECLARED',
      playerId,
      pseudo,
      timestamp: Date.now()
    });
    alert("Vous avez déclaré un 7 naturel !");
  };

  declareWinBtn.onclick = () => {
    push(ref(db, `rooms/${roomCode}/actions`), {
      type: 'VICTORY_DECLARED',
      playerId,
      pseudo,
      timestamp: Date.now()
    });
    alert("Vous avez déclaré la fin de la manche !");
  };
}

async function dealCards(roomCode, players) {
  const deck = shuffleDeck(createDeck());
  if (players.length * 13 > deck.length) {
    alert("Trop de joueurs pour la taille du deck !");
    return false;
  }

  let index = 0;
  for (const pId of players) {
    const playerCards = deck.slice(index, index + 13);
    await set(ref(db, `rooms/${roomCode}/hands/${pId}`), playerCards);
    index += 13;
  }

  const remainingDeck = deck.slice(index);
  await set(ref(db, `rooms/${roomCode}/deck`), remainingDeck);
  await set(ref(db, `rooms/${roomCode}/discardPile`), []);
  return true;
}

async function startGame(roomCode, players) {
  const firstPlayer = players[Math.floor(Math.random() * players.length)];
  await set(ref(db, `rooms/${roomCode}/currentTurn`), firstPlayer);
}

// Expose pour debug manuel
window.dealCards = dealCards;
window.startGame = startGame;
