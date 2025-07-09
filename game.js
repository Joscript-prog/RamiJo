import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// DOM
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

const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;

// Création / Rejoindre une partie
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
  await set(playerRef, { pseudo });
  onDisconnect(playerRef).remove();
  status.innerText = `Salle : ${roomCode} | Vous : ${pseudo}`;
}

function initGameListeners(roomCode) {
  listenPlayers(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  setupButtons(roomCode);
  listenActions(roomCode);
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async snap => {
    const players = snap.val() || {};
    updatePlayersUI(players);
    if (!gameInitialized && Object.keys(players).length >= 2) {
      const hands = await get(ref(db, `rooms/${room}/hands`));
      if (!hands.exists()) {
        gameInitialized = true;
        await dealCards(room, Object.entries(players).map(([id])=>id));
      }
    }
  });
}

function updatePlayersUI(players) {
  playersDiv.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    const el = document.createElement('div');
    el.textContent = `${p.pseudo} ${id===playerId?'(Moi)':''}`;
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
    executeUIState(turn);
    showStatus(`Tour de : ${isMe ? 'Vous ⭐' : turn}`);
  });
}

function executeUIState(turn) {
  get(ref(db, `rooms/${currentRoom}/hands/${turn}`)).then(hs => {
    const hand = hs.val() || [];
    const isMe = turn === playerId;
    if (!isMe) { drawCardBtn.disabled=true; takeDiscardBtn.disabled=true; endTurnBtn.disabled=true; return; }
    drawCardBtn.disabled = hand.length !== 13;
    takeDiscardBtn.disabled = hand.length !== 13;
    endTurnBtn.disabled = !(hand.length === 14);
  });
}

function setupButtons(room) {
  drawCardBtn.onclick = () => drawCard(room);
  takeDiscardBtn.onclick = () => takeDiscard(room);
  endTurnBtn.onclick = () => endTurn(room);
  declare7NBtn.onclick = () => declare7N(room);
  declareWinBtn.onclick = () => declareWin(room);
}

async function drawCard(room) {
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  if (hs.length !== 13) return alert('Tu dois avoir 13 cartes.');
  const deck = (await get(ref(db, `rooms/${room}/deck`))).val() || [];
  if (!deck.length) return alert('Deck vide');
  hs.push(deck.shift());
  await Promise.all([
    set(ref(db, `rooms/${room}/deck`), deck),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs)
  ]);
}

async function takeDiscard(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val());
  const idx = players.findIndex(id=>id===playerId);
  const prevId = players[(idx+players.length-1)%players.length];
  const pile = (await get(ref(db, `rooms/${room}/discard/${prevId}`))).val() || [];
  if (!pile.length) return alert('Défausse vide');
  const card = pile.pop();
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val();
  if (hs.length!==13) return;
  hs.push(card);
  await Promise.all([
    set(ref(db, `rooms/${room}/discard/${prevId}`), pile),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs)
  ]);
}

async function discardCard(cardId) {
  const hs = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val();
  if (hs.length !== 14) return;
  const idx = hs.findIndex(c=>c.id===cardId);
  const card = hs.splice(idx,1)[0];
  const pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
  pile.push(card);
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hs),
    set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
  ]);
}

async function endTurn(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val());
  const idx = players.findIndex(id=>id===playerId);
  await set(ref(db, `rooms/${room}/currentTurn`), players[(idx+1)%players.length]);
}

async function declare7N(room) {
  await push(ref(db, `rooms/${room}/actions`), { playerId, type:'7N' });
  showStatus('7 Naturel déclaré !');
}

async function declareWin(room) {
  await push(ref(db, `rooms/${room}/actions`), { playerId, type:'WIN' });
}

function listenActions(room) {
  onValue(ref(db, `rooms/${room}/actions`), async snap => {
    const acts = snap.val() || {};
    const last = Object.values(acts).pop();
    if (!last) return;
    if (last.type==='WIN') await processWin(last.playerId);
    if (last.type==='7N') showNotification(`${last.playerId} a déclaré 7N !`);
  });
}

async function processWin(winner) {
  const room = currentRoom;
  const actions = await get(ref(db, `rooms/${room}/actions`));
  const has7N = Object.values(actions.val()).find(a=>a.playerId===winner && a.type==='7N');
  const pts = has7N ? 1.5 : 1;
  const scrRef = ref(db, `rooms/${room}/scores/${winner}`);
  const cur = (await get(scrRef)).val() || 0;
  await set(scrRef, cur + pts);
  showNotification(`Victoire de ${winner} : +${pts} pt(s)`);
  resetGame(room);
}

async function resetGame(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val());
  players.forEach(id => set(ref(db, `rooms/${room}/hands/${id}`), null));
  await set(ref(db, `rooms/${room}/deck`), null);
  await set(ref(db, `rooms/${room}/currentTurn`), null);
  await set(ref(db, `rooms/${room}/actions`), null);
  showStatus('Partie terminée. Rejoignez ou créez une nouvelle partie.');
  gameInitialized=false;
}

function showStatus(msg) {
  status.textContent = msg;
}

function showNotification(msg) {
  const div = document.createElement('div');
  div.className = 'notification';
  div.textContent = msg;
  document.body.append(div);
  setTimeout(() => div.remove(), 3000);
}

function createDeck() {
  const suits = [
    { name: 'Coeurs', symbol: '♥', color: 'red' },
    { name: 'Carreaux', symbol: '♦', color: 'red' },
    { name: 'Trèfles', symbol: '♣', color: 'black' },
    { name: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = [
    { symbol: 'A', value: 1 },
    { symbol: '2', value: 2 },
    { symbol: '3', value: 3 },
    { symbol: '4', value: 4 },
    { symbol: '5', value: 5 },
    { symbol: '6', value: 6 },
    { symbol: '7', value: 7 },
    { symbol: '8', value: 8 },
    { symbol: '9', value: 9 },
    { symbol: '10', value: 10 },
    { symbol: 'J', value: 11 },
    { symbol: 'Q', value: 12 },
    { symbol: 'K', value: 13 }
  ];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({
          suit: suit.name,
          symbol: suit.symbol,
          color: suit.color,
          rank: rank.symbol,
          value: rank.value,
          id: `${rank.symbol}${suit.symbol}${d}`
        });
      }
    }
  }
  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

async function dealCards(room, players) {
  const deck = createDeck();
  let index = 0;
  for (const id of players) {
    await set(ref(db, `rooms/${room}/hands/${id}`), deck.slice(index, index + 13));
    await set(ref(db, `rooms/${room}/discard/${id}`), []);
    index += 13;
  }
  await set(ref(db, `rooms/${room}/deck`), deck.slice(index));
  await set(ref(db, `rooms/${room}/currentTurn`), players[0]);
}
