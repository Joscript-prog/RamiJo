import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// --- Références DOM ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const gameDiv = document.querySelector('.game-container'); // FIX: anciennement gameDiv null
const menuDiv = document.getElementById('menu');
const playersDiv = document.getElementById('players');
const drawCardBtn = document.getElementById('drawCard');
const takeDiscardBtn = document.getElementById('takeDiscard');
const endTurnBtn = document.getElementById('endTurn');
const handDiv = document.getElementById('hand');
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');

const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;

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
  gameDiv.style.display = 'flex';
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
    updatePlayersUI(players);
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

function updatePlayersUI(players) {
  playersDiv.innerHTML = '';
  for (const [id, info] of Object.entries(players)) {
    const span = document.createElement('span');
    span.textContent = info.pseudo;
    if (id === playerId) span.style.fontWeight = 'bold';
    playersDiv.appendChild(span);
    playersDiv.append(' → ');
  }
}

function listenToHand(roomCode) {
  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    renderHand(hand);
  });
}

function renderHand(hand) {
  handDiv.innerHTML = '';
  for (const card of hand) {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${card.color}`;
    cardEl.innerHTML = `
      <div class="card-corner">
        <div>${card.rank}</div>
        <div>${card.symbol}</div>
      </div>
      <div class="card-center">${card.symbol}</div>
      <div class="card-corner bottom-right">
        <div>${card.rank}</div>
        <div>${card.symbol}</div>
      </div>
    `;
    handDiv.appendChild(cardEl);
  }
}

function listenToTurn(roomCode) {
  const turnRef = ref(db, `rooms/${roomCode}/currentTurn`);
  onValue(turnRef, snapshot => {
    const turn = snapshot.val();
    const isMyTurn = turn === playerId;
    drawCardBtn.disabled = !isMyTurn;
    takeDiscardBtn.disabled = !isMyTurn;
    endTurnBtn.disabled = !isMyTurn;
  });
}

function setupActions(roomCode) {
  drawCardBtn.onclick = async () => {
    const deckRef = ref(db, `rooms/${roomCode}/deck`);
    const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);

    const [deckSnap, handSnap] = await Promise.all([get(deckRef), get(handRef)]);
    let deck = deckSnap.val() || [];
    let hand = handSnap.val() || [];

    if (hand.length !== 13) return alert("Vous devez avoir 13 cartes pour piocher.");
    if (deck.length === 0) return alert("Le deck est vide.");

    const drawnCard = deck.shift();
    hand.push(drawnCard);
    await set(deckRef, deck);
    await set(handRef, hand);
  };

  takeDiscardBtn.onclick = async () => {
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = Object.keys(playersSnap.val());
    const currentIndex = players.indexOf(playerId);
    const prevPlayerId = players[(currentIndex - 1 + players.length) % players.length];
    const discardRef = ref(db, `rooms/${roomCode}/discardPile/${prevPlayerId}`);
    const discardSnap = await get(discardRef);
    let discardPile = discardSnap.val() || [];
    if (!discardPile.length) return alert("Rien à prendre dans la défausse.");

    const card = discardPile.pop();
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${playerId}`));
    let hand = handSnap.val() || [];
    if (hand.length !== 13) return alert("Vous devez avoir 13 cartes pour prendre dans la défausse.");

    hand.push(card);
    await set(ref(db, `rooms/${roomCode}/hands/${playerId}`), hand);
    await set(discardRef, discardPile);
  };

  endTurnBtn.onclick = async () => {
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = Object.keys(playersSnap.val());
    const turnSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
    const currentIndex = players.indexOf(turnSnap.val());
    const nextPlayer = players[(currentIndex + 1) % players.length];
    await set(ref(db, `rooms/${roomCode}/currentTurn`), nextPlayer);
  };
}

function createDeck() {
  const suits = [
    { name: 'Coeurs', symbol: '♥', color: 'red' },
    { name: 'Carreaux', symbol: '♦', color: 'red' },
    { name: 'Trèfles', symbol: '♣', color: 'black' },
    { name: 'Piques', symbol: '♠', color: 'black' },
  ];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    for (let suit of suits) {
      for (let rank of ranks) {
        deck.push({
          rank, symbol: suit.symbol, color: suit.color,
          id: `${rank}${suit.symbol}${d}`
        });
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

async function dealCards(roomCode, players) {
  const fullDeck = shuffleDeck(createDeck());
  const hands = {};
  let index = 0;
  for (let pid of players) {
    hands[pid] = fullDeck.slice(index, index + 13);
    index += 13;
    await set(ref(db, `rooms/${roomCode}/hands/${pid}`), hands[pid]);
    await set(ref(db, `rooms/${roomCode}/discardPile/${pid}`), []);
  }
  await set(ref(db, `rooms/${roomCode}/deck`), fullDeck.slice(index));
  await set(ref(db, `rooms/${roomCode}/currentTurn`), players[0]);
  return true;
}

async function startGame(roomCode, players) {
  console.log("Partie lancée pour", players);
}

function init() {
  menuDiv.style.display = 'block';
  gameDiv.style.display = 'none';
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
}

init();
