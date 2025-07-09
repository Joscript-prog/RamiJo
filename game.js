// game.js
import { db, ref, set, update, get, onValue, onDisconnect, push, remove } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

// --- MODULE Règles ---
const Rules = {
  isQuadri(hand) {
    const vals = hand.map(c => c.value);
    return [...new Set(vals)].some(v => hand.filter(c => c.value === v).length >= 4);
  },
  isTri(hand) {
    const vals = hand.map(c => c.value);
    return [...new Set(vals)].some(v => hand.filter(c => c.value === v).length >= 3);
  },
  isEscalier(hand, len) {
    const byColor = {};
    hand.forEach(c => {
      if (!byColor[c.suit]) byColor[c.suit] = [];
      byColor[c.suit].push(c.value);
    });
    for (let suit in byColor) {
      const values = byColor[suit].sort((a, b) => a - b);
      for (let i = 0; i <= values.length - len; i++) {
        let ok = true;
        for (let j = 1; j < len; j++) {
          if (values[i + j] !== values[i] + j) {
            ok = false; break;
          }
        }
        if (ok) return true;
      }
    }
    return false;
  },
  has7Naturel(hand) {
    return (this.isQuadri(hand) && this.isEscalier(hand, 3)) ||
           (this.isEscalier(hand, 4) && this.isTri(hand));
  },
  validateWinHand(hand) {
    const f1 = this.isQuadri(hand) && this.isEscalier(hand, 3);
    const f2 = this.isEscalier(hand, 4) && this.isTri(hand);
    const rest = this.isTri(hand) || this.isEscalier(hand, 3);
    return (f1 || f2) && rest && rest;
  }
};

// --- Fonctions de deck et distribution ---
function createDeck() {
  const suits = [
    { suit: 'Coeurs', symbol: '♥', color: 'red' },
    { suit: 'Carreaux', symbol: '♦', color: 'red' },
    { suit: 'Trèfles', symbol: '♣', color: 'black' },
    { suit: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = [
    { symbol: 'A', value: 1 }, { symbol: '2', value: 2 }, { symbol: '3', value: 3 },
    { symbol: '4', value: 4 }, { symbol: '5', value: 5 }, { symbol: '6', value: 6 },
    { symbol: '7', value: 7 }, { symbol: '8', value: 8 }, { symbol: '9', value: 9 },
    { symbol: '10', value: 10 }, { symbol: 'J', value: 11 }, { symbol: 'Q', value: 12 }, { symbol: 'K', value: 13 }
  ];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    suits.forEach(s => ranks.forEach(r => {
      deck.push({ ...s, rank: r.symbol, value: r.value, id: `${r.symbol}${s.symbol}${d}` });
    }));
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Distribue 13 cartes à chaque joueur et initialise le deck en base
async function dealCards(room, players) {
  let deck = shuffle(createDeck());
  // Extrait le joker
  const jokerCard = deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
  // Calcule le set de jokers
  const jokerSet = deck
    .filter(c => c.value === jokerCard.value && c.color !== jokerCard.color)
    .map(c => c.id);
  await set(ref(db, `rooms/${room}/jokerSet`), { jokerSet });

  let idx = 0;
  for (const p of players) {
    const hand = deck.slice(idx, idx + 13);
    await set(ref(db, `rooms/${room}/hands/${p}`), hand);
    await set(ref(db, `rooms/${room}/discard/${p}`), []);
    idx += 13;
  }
  await set(ref(db, `rooms/${room}/deck`), deck.slice(idx));
}

// --- DOM & état ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn   = document.getElementById('joinRoom');
const roomInput     = document.getElementById('roomCodeInput');
const status        = document.getElementById('status');
const playersDiv    = document.getElementById('players');
const playerHandDiv = document.getElementById('hand');
const declare7NBtn  = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const drawCardBtn   = document.getElementById('drawCard');
const endTurnBtn    = document.getElementById('endTurn');
const menuDiv       = document.getElementById('menu');
const gameDiv       = document.getElementById('game');

const pseudo   = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';

// --- Popup générique ---
function showPopup(content) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      ${content}
      <button class="modal-close">Fermer</button>
    </div>`;
  document.body.append(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
}

// --- Drag & Drop main ---
function enableDragDrop() {
  Sortable.create(playerHandDiv, {
    animation: 150,
    dataIdAttr: 'data-card-id',
    onEnd: () => {}
  });
}

// --- UI Joueurs / Scores ---
function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const badge = document.createElement('div');
    badge.className = 'player-badge';
    badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard" id="discard-${p.id}"></div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>`;
    playersDiv.append(badge);
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const raw = snap.val() || {};
    const list = Object.entries(raw).map(([id, o]) => ({ id, pseudo: o.pseudo }));
    renderPlayers(list);
  });
  onValue(ref(db, `rooms/${room}/scores`), snap => {
    const scores = snap.val() || {};
    for (let id in scores) {
      const el = document.getElementById(`score-${id}`);
      if (el) el.textContent = `Score: ${scores[id]}`;
    }
  });
}

// --- Tour automatique ---
function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const isMyTurn = turn === playerId;
    drawCardBtn.disabled = !isMyTurn;
    declare7NBtn.disabled = !isMyTurn;
    declareWinBtn.disabled = !isMyTurn;
    endTurnBtn.disabled = !isMyTurn;
    status.innerText = isMyTurn ? '⭐ C’est votre tour !' : 'En attente du tour des autres...';
  });
}
async function endTurn(room) {
  const ps = await get(ref(db, `rooms/${room}/players`));
  const ids = Object.keys(ps.val() || {});
  const turnSnap = await get(ref(db, `rooms/${room}/turn`));
  const idx = ids.indexOf(turnSnap.val());
  const next = ids[(idx + 1) % ids.length];
  await set(ref(db, `rooms/${room}/turn`), next);
}

// --- Défausse et main ---
function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const all = snap.val() || {};
    Object.entries(all).forEach(([pid, pile]) => {
      const zone = document.getElementById(`discard-${pid}`);
      if (!zone) return;
      zone.innerHTML = pile.slice(-3).map(c => `<div class="mini-card ${c.color}">${c.rank}</div>`).join('');
    });
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    const hand = snap.val() || [];
    renderHand(hand);
  });
}

function renderHand(hand) {
  playerHandDiv.innerHTML = '';
  hand.forEach(c => {
    const div = document.createElement('div');
    div.className = `card ${c.color}`;
    div.textContent = c.rank + c.symbol;
    div.dataset.cardId = c.id;
    playerHandDiv.append(div);
  });
}

// --- Actions spéciales ---
async function declare7N(room) {
  const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  if (!Rules.has7Naturel(hand)) return alert('Pas de 7 naturel.');
  const html = hand.slice(0, 7).map(c => `<div class="card ${c.color}" data-card-id="${c.id}">${c.rank}${c.symbol}</div>`).join('');
  showPopup(`<h3>${pseudo} a un 7 Naturel</h3><div class="popup-hand">${html}</div>`);
  await push(ref(db, `rooms/${room}/actions`), { playerId, type: '7N' });
}

async function declareWin(room) {
  const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  if (!Rules.validateWinHand(hand)) return alert('Main non gagnante');
  let content = '<h3>Dépose tes 4 formations</h3>';
  for (let i = 1; i <= 4; i++) content += `<div class="drop-zone" id="zone${i}">Formation ${i}</div>`;
  content += '<button id="confirmWin">Valider</button>';
  showPopup(content);
  for (let i = 1; i <= 4; i++) Sortable.create(document.getElementById(`zone${i}`), { group: 'win', animation: 150 });
  document.getElementById('confirmWin').onclick = async () => {
    const forms = [];
    for (let i = 1; i <= 4; i++) forms.push(Array.from(document.getElementById(`zone${i}`).children).map(el => el.dataset.cardId));
    await push(ref(db, `rooms/${room}/actions`), { playerId, type: 'WIN', formations: forms });
    document.querySelector('.modal').remove();
    await updateScoreAndNext(room);
  };
}

async function updateScoreAndNext(room) {
  const scoreRef = ref(db, `rooms/${room}/scores/${playerId}`);
  const snap = await get(scoreRef);
  const cur = snap.val() || 0;
  await set(scoreRef, cur + 10);
  const stateRef = ref(db, `rooms/${room}/state`);
  await update(stateRef, { started: false, lastWinner: playerId });
  showPopup(`<h3>Bravo ${pseudo} !</h3><p>+10 points</p>`);
  setTimeout(() => {
    showPopup(`<p>Prochaine manche dans 10 secondes...</p>`);
    setTimeout(() => update(stateRef, { started: true }), 10000);
  }, 1000);
}

// --- Création / Rejoindre partie ---
async function createRoom() {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  // Inscription joueur & initialisation
  await set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo });
  await set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0);
  await set(ref(db, `rooms/${currentRoom}/state`), { started: false });
  await set(ref(db, `rooms/${currentRoom}/turn`), playerId);

  // Distribue les cartes pour que listenHand() récupère quelque chose
  await dealCards(currentRoom, [playerId]);

  // Affichage UI
  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  status.innerText = `Salle: ${currentRoom} | Vous: ${pseudo}`;
  showPopup(`<h3>Salle créée</h3><p>Code: <b>${currentRoom}</b></p>`);

  // Démarre les listeners
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
}

async function joinRoom() {
  const code = roomInput.value.trim(); if (!code) return alert('Entrez un code valide.');
  currentRoom = code;
  await set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo });
  await set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0);

  // Distribue cartes au joueur rejoignant (optionnel)
  await dealCards(currentRoom, [playerId]);

  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  status.innerText = `Salle: ${currentRoom} | Vous: ${pseudo}`;

  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
}

// --- Init ---
function init() {
  enableDragDrop();
  createRoomBtn.onclick = createRoom;
  joinRoomBtn.onclick   = joinRoom;
  drawCardBtn.onclick   = () => alert('Pioche à implémenter');
  endTurnBtn.onclick    = () => endTurn(currentRoom);
  declare7NBtn.onclick  = () => declare7N(currentRoom);
  declareWinBtn.onclick = () => declareWin(currentRoom);
}
window.addEventListener('load', init);
