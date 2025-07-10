// game.js
import { db, ref, set, update, get, onValue, push } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

// --- Variables globales ---
const pseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let hasDrawnOrPicked = false;

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
    const bySuit = hand.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c.value);
      return acc;
    }, {});
    for (let suit in bySuit) {
      const vals = bySuit[suit].sort((a, b) => a - b);
      for (let i = 0; i <= vals.length - len; i++) {
        let ok = true;
        for (let j = 1; j < len; j++) {
          if (vals[i + j] !== vals[i] + j) { ok = false; break; }
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
    // 4 formations avec au moins un tri et un escalier naturels
    const f1 = this.isQuadri(hand) && this.isEscalier(hand, 3);
    const f2 = this.isEscalier(hand, 4) && this.isTri(hand);
    const rest = this.isTri(hand) || this.isEscalier(hand, 3);
    return (f1 || f2) && rest;
  }
};

// --- Création et mélange du deck ---
function createDeck() {
  const suits = [
    { suit: 'Coeurs', symbol: '♥', color: 'red' },
    { suit: 'Carreaux', symbol: '♦', color: 'red' },
    { suit: 'Trèfles', symbol: '♣', color: 'black' },
    { suit: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    suits.forEach(s => ranks.forEach(r => {
      const value = r === 'A' ? 1 : r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : parseInt(r);
      deck.push({ suit: s.suit, symbol: s.symbol, color: s.color, rank: r, value, id: `${r}${s.symbol}${d}` });
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

// --- Distribution des cartes ---
async function dealCards(roomId, playerIds) {
  let deck = shuffle(createDeck());
  const jokerCard = deck[Math.floor(Math.random() * deck.length)];
  const jokerSet = deck.filter(c => c.value === jokerCard.value && c.suit !== jokerCard.suit);
  const hands = {}, discards = {};
  playerIds.forEach(pid => {
    hands[pid] = deck.splice(0, 13);
    discards[pid] = [];
  });
  await Promise.all([
    set(ref(db, `rooms/${roomId}/deck`), deck),
    set(ref(db, `rooms/${roomId}/jokerCard`), jokerCard),
    set(ref(db, `rooms/${roomId}/jokerSet`), { jokerSet: jokerSet.map(c => c.id) }),
    set(ref(db, `rooms/${roomId}/hands`), hands),
    set(ref(db, `rooms/${roomId}/discard`), discards)
  ]);
}

// --- Sélecteurs DOM ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const playersDiv = document.getElementById('players');
const playerHandDiv = document.getElementById('hand');
const jokerDiv = document.getElementById('joker');
const drawCardBtn = document.getElementById('drawCard');
const endTurnBtn = document.getElementById('endTurn');
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const menuDiv = document.getElementById('menu');
const gameDiv = document.getElementById('game');

// --- Affichage du joker ---
function showJoker(jokerCard) {
  jokerDiv.innerHTML = jokerCard?.rank
    ? `<div class="card ${jokerCard.color}">JOKER: ${jokerCard.rank}${jokerCard.symbol}</div>`
    : '';
}

// --- Popups ---
function showPopup(content) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-content">${content}<button class="modal-close">Fermer</button></div>`;
  document.body.append(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
}

// --- Drag & Drop ---
function enableDragDrop() {
  new Sortable(playerHandDiv, { animation: 150, ghostClass: 'sortable-ghost' });
}

// --- Rendu des joueurs ---
function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const badge = document.createElement('div');
    badge.className = 'player-badge'; badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard" id="discard-${p.id}"></div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>`;
    playersDiv.append(badge);
  });
}

// --- Listeners Firebase ---
function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const players = Object.entries(snap.val()||{}).map(([id,o])=>({id,pseudo:o.pseudo}));
    renderPlayers(players);
  });
  onValue(ref(db, `rooms/${room}/scores`), snap => {
    Object.entries(snap.val()||{}).forEach(([id,score])=>{
      const el = document.getElementById(`score-${id}`);
      if(el) el.textContent = `Score: ${score}`;
    });
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => renderHand(snap.val()||[]));
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    Object.entries(snap.val()||{}).forEach(([pid,pile])=>{
      const z = document.getElementById(`discard-${pid}`);
      if(z) z.innerHTML = pile.length
        ? `<div class="mini-card ${pile[pile.length-1].color}" data-card-id="${pile[pile.length-1].id}">${pile[pile.length-1].rank}</div>`
        : '';
    });
  });
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val(), myTurn = turn===playerId;
    hasDrawnOrPicked = myTurn ? false : hasDrawnOrPicked;
    drawCardBtn.disabled = !myTurn || hasDrawnOrPicked;
    endTurnBtn.disabled = !myTurn;
    declare7NBtn.disabled = !myTurn;
    declareWinBtn.disabled = !myTurn;
    status.textContent = myTurn ? "⭐ C'est votre tour !" : "En attente...";
  });
}

// --- Rendu de la main ---
function renderHand(hand) {
  playerHandDiv.innerHTML = '';
  hand.forEach(c=>{
    const div = document.createElement('div');
    div.className = `card ${c.color}`;
    div.dataset.cardId = c.id;
    div.innerHTML = `<div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>`+
                    `<div class="suit main">${c.symbol}</div>`+
                    `<div class="corner bottom"><span>${c.rank}</span><span>${c.symbol}</span></div>`;
    playerHandDiv.append(div);
  });
}

// --- Pioche ---
async function drawCard(room) {
  const turnSnap = await get(ref(db, `rooms/${room}/turn`));
  if(turnSnap.val()!==playerId) return alert("Ce n'est pas votre tour.");
  const stateRef = ref(db, `rooms/${room}/state`);
  let state = (await get(stateRef)).val()||{drawCount:0};
  if(state.drawCount>=1) return alert('Vous avez déjà pioché.');
  let [deckSnap,handSnap,jokerSetSnap] = await Promise.all([
    get(ref(db, `rooms/${room}/deck`)),
    get(ref(db, `rooms/${room}/hands/${playerId}`)),
    get(ref(db, `rooms/${room}/jokerSet`))
  ]);
  let deck = deckSnap.val()||[], hand = handSnap.val()||[], jokerSet = jokerSetSnap.val()?.jokerSet||[];
  if(!deck.length) return alert('Deck vide');
  const card = deck.shift(); hand.push(card);
  // Défausse auto du joker si nécessaire
  if(deck.length <= Object.keys((await get(ref(db, `rooms/${room}/players`))).val()||{}).length && hand.some(c=>jokerSet.includes(c.id))) {
    const idx = hand.findIndex(c=>jokerSet.includes(c.id));
    const [jok] = hand.splice(idx,1);
    let pile = (await get(ref(db, `rooms/${room}/discard/${playerId}`))).val()||[];
    pile.push(jok);
    await set(ref(db, `rooms/${room}/discard/${playerId}`), pile);
    alert('Joker défaussé automatiquement');
  }
  state.drawCount++; hasDrawnOrPicked=true;
  await Promise.all([
    set(ref(db, `rooms/${room}/deck`), deck),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hand),
    set(stateRef, state)
  ]);
  drawCardBtn.disabled=true;
}

// --- Prendre défausse ---
async function takeDiscardedCard(ownerId) {
  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if(turn!==playerId) return alert("Pas votre tour.");
  if(hasDrawnOrPicked) return alert('Déjà pioché.');
  const last = (await get(ref(db, `rooms/${currentRoom}/state/lastDiscarder`))).val();
  if(ownerId!==last) return alert("Uniquement dernière défausse.");
  let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${ownerId}`))).val()||[];
  if(!pile.length) return alert('Vide');
  const card = pile.pop();
  let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val()||[];
  hand.push(card);
  let state = (await get(ref(db, `rooms/${currentRoom}/state`))).val()||{drawCount:0};
  state.drawCount++; hasDrawnOrPicked=true;
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), pile),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    set(ref(db, `rooms/${currentRoom}/state`), state)
  ]);
}

// --- Défausse manuelle ---
function setupPlayerHandDiscardListener() {
  playerHandDiv.addEventListener('click', async e => {
    const cardEl = e.target.closest('.card');
    if(!cardEl) return;
    const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
    if(turn!==playerId) return;
    if(!hasDrawnOrPicked) return alert('Piochez avant.');
    const cardId = cardEl.dataset.cardId;
    let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val()||[];
    const idx = hand.findIndex(c=>c.id===cardId);
    if(idx===-1) return;
    const [card] = hand.splice(idx,1);
    let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val()||[];
    pile.push(card);
    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
      set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
    ]);
    await endTurn(currentRoom);
  });
}

// --- Fin de tour ---
async function endTurn(room) {
  const players = Object.keys((await get(ref(db, `rooms/${room}/players`))).val()||{});
  const current = (await get(ref(db, `rooms/${room}/turn`))).val();
  const idx = players.indexOf(current);
  const next = players[(idx+1)%players.length];
  await Promise.all([
    set(ref(db, `rooms/${room}/turn`), next),
    update(ref(db, `rooms/${room}/state`), { drawCount:0, lastDiscarder: current })
  ]);
}

// --- Interaction piles adverses ---
function enableDiscardPileInteraction() {
  onValue(ref(db, `rooms/${currentRoom}/players`), snap => {
    Object.keys(snap.val()||{}).forEach(pid => {
      if(pid!==playerId) {
        const el = document.getElementById(`discard-${pid}`);
        if(el) el.onclick = () => takeDiscardedCard(pid);
      }
    });
  },{onlyOnce:true});
}

// --- Création de salle ---
async function createRoom() {
  currentRoom = 'RAMI'+Math.floor(Math.random()*1000);
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo }),
    set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
    set(ref(db, `rooms/${currentRoom}/state`), { started:false, drawCount:0, lastDiscarder:null }),
    set(ref(db, `rooms/${currentRoom}/turn`), playerId)
  ]);
  const playerIds = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val());
  await dealCards(currentRoom, playerIds);
  menuDiv.style.display='none'; gameDiv.style.display='block';
  status.textContent=`Salle: ${currentRoom} | Vous: ${pseudo}`;
  showPopup(`<h3>Salle créée</h3><p>Code: <b>${currentRoom}</b></p>`);
  listenPlayers(currentRoom); listenDiscard(currentRoom);
  listenHand(currentRoom); listenTurn(currentRoom);
  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => showJoker(snap.val()));
  enableDragDrop(); setupPlayerHandDiscardListener(); enableDiscardPileInteraction();
}

// --- Rejoindre salle ---
async function joinRoom() {
  const code = roomInput.value.trim();
  if(!code) return alert('Code invalide');
  currentRoom = code;
  const roomSnap = await get(ref(db, `rooms/${currentRoom}`)); if(!roomSnap.exists()) return alert('Salle inexistante');
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo }),
    set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
    update(ref(db, `rooms/${currentRoom}/state`), { drawCount:0 })
  ]);
  menuDiv.style.display='none'; gameDiv.style.display='block';
  status.textContent=`Salle: ${currentRoom} | Vous: ${pseudo}`;
  listenPlayers(currentRoom); listenDiscard(currentRoom);
  listenHand(currentRoom); listenTurn(currentRoom);
  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => showJoker(snap.val()));
  enableDragDrop(); setupPlayerHandDiscardListener(); enableDiscardPileInteraction();
}

// --- Déclarations de points ---
async function declare7N(room) {
  const hand = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  if(!Rules.has7Naturel(hand)) return alert('Combinaison invalide');
  const scoreRef = ref(db, `rooms/${room}/scores/${playerId}`);
  const cur = (await get(scoreRef)).val()||0;
  await set(scoreRef, cur + 0.5);
  alert('7 Naturel validé ! +0.5 point');
}
async function declareWin(room) {
  const hand = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  if(!Rules.validateWinHand(hand)) return alert('Combinaison invalide');
  const scoreRef = ref(db, `rooms/${room}/scores/${playerId}`);
  const cur = (await get(scoreRef)).val()||0;
  await set(scoreRef, cur + 1);
  alert('Victoire validée ! +1 point');
}

// --- Initialisation générale ---
function init() {
  createRoomBtn.onclick = createRoom;
  joinRoomBtn.onclick = joinRoom;
  drawCardBtn.onclick = () => drawCard(currentRoom);
  endTurnBtn.onclick = () => endTurn(currentRoom);
  declare7NBtn.onclick = () => declare7N(currentRoom);
  declareWinBtn.onclick = () => declareWin(currentRoom);
  enableDragDrop(); setupPlayerHandDiscardListener(); enableDiscardPileInteraction();
}
window.addEventListener('load', init);
