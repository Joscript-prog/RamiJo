import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// --- DOM ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const handDiv = document.getElementById('hand');
const playersDiv = document.getElementById('players');
const drawCardBtn = document.getElementById('drawCard');
const takeDiscardBtn = document.getElementById('takeDiscard');
const endTurnBtn = document.getElementById('endTurn');
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');

const menuDiv = document.getElementById('menu');
const gameDiv = document.getElementById('game');

// --- Variables ---
const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);

let currentRoom = '';
let gameInitialized = false;
let jokerCard = null; // Carte joker tirée au hasard

// --- Création ou rejoindre une partie ---
createRoomBtn.onclick = async () => {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  await joinRoom(currentRoom);
  initGameListeners(currentRoom);
  alert(`Code de la salle : ${currentRoom}`);
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
  await set(playerRef, { pseudo });
  onDisconnect(playerRef).remove();

  if (menuDiv) menuDiv.style.display = 'none';
  if (gameDiv) gameDiv.style.display = 'block';
  status.innerText = `Salle : ${roomCode} | Vous : ${pseudo}`;
}

// --- Listeners et UI ---
function initGameListeners(roomCode) {
  listenPlayers(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  listenActions(roomCode);
  setupButtons(roomCode);
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async snap => {
    const players = snap.val() || {};
    updatePlayersUI(players);

    // Lancer la partie si pas encore initialisée et au moins 2 joueurs
    if (!gameInitialized && Object.keys(players).length >= 2) {
      const hands = await get(ref(db, `rooms/${room}/hands`));
      if (!hands.exists()) {
        gameInitialized = true;
        await dealCards(room, Object.keys(players));
        await set(ref(db, `rooms/${room}/currentTurn`), Object.keys(players)[0]);
      }
    }
  });
}

function updatePlayersUI(players) {
  playersDiv.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    const el = document.createElement('div');
    el.textContent = `${p.pseudo} ${id === playerId ? '(Moi)' : ''}`;
    playersDiv.append(el);
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    const hand = snap.val() || [];
    renderHand(hand);
  });
}

function renderHand(hand) {
  handDiv.innerHTML = '';
  hand.forEach(c => {
    const card = document.createElement('div');
    card.className = `card ${c.color}`;
    card.textContent = c.rank + c.symbol;
    card.ondblclick = () => discardCard(c.id);
    handDiv.append(card);
  });
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/currentTurn`), snap => {
    const turn = snap.val();
    const isMe = turn === playerId;
    drawCardBtn.disabled = !isMe;
    takeDiscardBtn.disabled = !isMe;
    endTurnBtn.disabled = true; // Par défaut désactivé, état sera mis à jour ensuite
    executeUIState(turn);
    showStatus(`Tour de : ${isMe ? 'Vous ⭐' : turn}`);
  });
}

function executeUIState(turn) {
  get(ref(db, `rooms/${currentRoom}/hands/${turn}`)).then(hs => {
    const hand = hs.val() || [];
    const isMe = turn === playerId;
    if (!isMe) {
      drawCardBtn.disabled = true;
      takeDiscardBtn.disabled = true;
      endTurnBtn.disabled = true;
      return;
    }
    drawCardBtn.disabled = hand.length !== 13;
    takeDiscardBtn.disabled = hand.length !== 13;

    endTurnBtn.disabled = !(hand.length === 13);
  });
}

function listenActions(room) {
  onValue(ref(db, `rooms/${room}/actions`), async snap => {
    const acts = snap.val() || {};
    const last = Object.values(acts).pop();
    if (!last) return;
    if (last.type === 'WIN') await processWin(last.playerId);
    if (last.type === '7N') showNotification(`${last.playerId} a déclaré 7 Naturel !`);
  });
}

// --- Actions boutons ---
function setupButtons(room) {
  drawCardBtn.onclick = () => drawCard(room);
  takeDiscardBtn.onclick = () => takeDiscard(room);
  endTurnBtn.onclick = () => endTurn(room);
  declare7NBtn.onclick = () => declare7N(room);
  declareWinBtn.onclick = () => declareWin(room);
}

async function drawCard(room) {
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val() || [];
  if (hs.length !== 13) return alert('Tu dois avoir 13 cartes.');
  const deck = (await get(ref(db, `rooms/${room}/deck`))).val() || [];
  if (!deck.length) return alert('Deck vide');
  const card = deck.shift();
  hs.push(card);
  await Promise.all([
    set(ref(db, `rooms/${room}/deck`), deck),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs)
  ]);
}

async function takeDiscard(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val());
  const idx = players.findIndex(id => id === playerId);
  const prevId = players[(idx + players.length - 1) % players.length];
  const pile = (await get(ref(db, `rooms/${room}/discard/${prevId}`))).val() || [];
  if (!pile.length) return alert('Défausse vide');
  const card = pile.pop();
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val() || [];
  if (hs.length !== 13) return;
  hs.push(card);
  await Promise.all([
    set(ref(db, `rooms/${room}/discard/${prevId}`), pile),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs)
  ]);
}

async function discardCard(cardId) {
  const hs = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  if (hs.length !== 14) return alert("Tu dois avoir 14 cartes pour jeter une carte.");
  const idx = hs.findIndex(c => c.id === cardId);
  if (idx === -1) return alert("Carte introuvable dans ta main.");
  const card = hs.splice(idx, 1)[0];
  const pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
  pile.push(card);
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hs),
    set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
  ]);
}

async function endTurn(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val());
  const idx = players.findIndex(id => id === playerId);
  await set(ref(db, `rooms/${room}/currentTurn`), players[(idx + 1) % players.length]);
}

async function declare7N(room) {
  const turn = (await get(ref(db, `rooms/${room}/currentTurn`))).val();
  if (turn !== playerId) return alert("Ce n'est pas ton tour !");
  await push(ref(db, `rooms/${room}/actions`), { playerId, type: '7N' });
  showNotification('7 Naturel déclaré !');
}

async function declareWin(room) {
  const turn = (await get(ref(db, `rooms/${room}/currentTurn`))).val();
  if (turn !== playerId) return alert("Ce n'est pas ton tour !");
  await push(ref(db, `rooms/${room}/actions`), { playerId, type: 'WIN' });
}

async function processWin(winner) {
  const room = currentRoom;
  const actions = await get(ref(db, `rooms/${room}/actions`));
  const has7N = Object.values(actions.val() || {}).some(a => a.playerId === winner && a.type === '7N');
  let pts = 1;
  if (has7N) pts += 0.5;
  const scrRef = ref(db, `rooms/${room}/scores/${winner}`);
  const cur = (await get(scrRef)).val() || 0;
  await set(scrRef, cur + pts);
  showNotification(`Victoire de ${winner} : +${pts} pt(s)`);
  await resetGame(room);
}

async function resetGame(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val() || {});
  for (const id of players) {
    await set(ref(db, `rooms/${room}/hands/${id}`), null);
    await set(ref(db, `rooms/${room}/discard/${id}`), null);
  }
  await set(ref(db, `rooms/${room}/deck`), null);
  await set(ref(db, `rooms/${room}/currentTurn`), null);
  await set(ref(db, `rooms/${room}/actions`), null);
  showStatus('Partie terminée. Rejoignez ou créez une nouvelle partie.');
  gameInitialized = false;
  jokerCard = null;
}

function createDeck() {
  const suits = [
    { name: 'Coeurs', symbol: '♥', color: 'red' },
    { name: 'Carreaux', symbol: '♦', color: 'red' },
    { name: 'Trèfles', symbol: '♣', color: 'black' },
    { name: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = [
    { symbol: 'A', value: 1 }, { symbol: '2', value: 2 }, { symbol: '3', value: 3 },
    { symbol: '4', value: 4 }, { symbol: '5', value: 5 }, { symbol: '6', value: 6 },
    { symbol: '7', value: 7 }, { symbol: '8', value: 8 }, { symbol: '9', value: 9 },
    { symbol: '10', value: 10 }, { symbol: 'J', value: 11 }, { symbol: 'Q', value: 12 }, { symbol: 'K', value: 13 }
  ];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit: suit.name, symbol: suit.symbol, color: suit.color, rank: rank.symbol, value: rank.value, id: `${rank.symbol}${suit.symbol}${d}` });
      }
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function drawJoker(deck) {
  const randomIndex = Math.floor(Math.random() * deck.length);
  return deck[randomIndex];
}

async function dealCards(roomCode, players) {
  let deck = shuffleDeck(createDeck());
  jokerCard = drawJoker(deck);
  await set(ref(db, `rooms/${roomCode}/joker`), jokerCard);
  if (players.length * 13 > deck.length) return alert("Trop de joueurs pour la taille du deck !");
  let index = 0;
  for (const pId of players) {
    const playerCards = deck.slice(index, index + 13);
    await set(ref(db, `rooms/${roomCode}/hands/${pId}`), playerCards);
    await set(ref(db, `rooms/${roomCode}/discard/${pId}`), []);
    index += 13;
  }
  const remainingDeck = deck.slice(index);
  await set(ref(db, `rooms/${roomCode}/deck`), remainingDeck);
  return true;
}

function showStatus(message) {
  if (status) status.innerText = message;
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => { notification.classList.add('show'); }, 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

function init() {
  if (menuDiv) menuDiv.style.display = 'block';
  if (gameDiv) gameDiv.style.display = 'none';
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
  gameInitialized = false;
  currentRoom = '';
  jokerCard = null;
}

init();
