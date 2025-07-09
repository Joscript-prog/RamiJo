// game.js
import { db, ref, set, update, get, onValue, onDisconnect, push, remove } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

// --- MODULE Règles ---
const Rules = {
  isQuadri(hand, jokerSet = []) {
    const vals = hand.map(c => c.value);
    for (let v of new Set(vals)) {
      const group = hand.filter(c => c.value === v || jokerSet.includes(c.id));
      if (group.length >= 4) return true;
    }
    return false;
  },
  isTri(hand, jokerSet = []) {
    const vals = hand.map(c => c.value);
    for (let v of new Set(vals)) {
      const group = hand.filter(c => c.value === v || jokerSet.includes(c.id));
      if (group.length >= 3) return true;
    }
    return false;
  },
  isEscalier(hand, len, jokerSet = []) {
    const byColor = hand.reduce((acc, c) => {
      if (!acc[c.suit]) acc[c.suit] = new Set();
      acc[c.suit].add(c.value);
      if (jokerSet.includes(c.id)) acc[c.suit].add(null);
      return acc;
    }, {});
    for (let suit in byColor) {
      const vals = [...byColor[suit]].filter(v => v !== null).sort((a, b) => a - b);
      for (let start of vals) {
        let count = 1;
        for (let k = 1; k < len; k++) {
          if (byColor[suit].has(start + k) || byColor[suit].has(null)) count++;
        }
        if (count >= len) return true;
      }
    }
    return false;
  },
  has7Naturel(hand, jokerSet = []) {
    return (
      (this.isQuadri(hand) && this.isEscalier(hand, 3)) ||
      (this.isEscalier(hand, 4) && this.isTri(hand))
    );
  },
  validateWinHand(hand, jokerSet = []) {
    const cond1 = this.isQuadri(hand) && this.isEscalier(hand, 3) &&
      [1, 2].every(_ => this.isTri(hand) || this.isEscalier(hand, 3));
    const cond2 = this.isEscalier(hand, 4) && this.isTri(hand) &&
      [1, 2].every(_ => this.isTri(hand) || this.isEscalier(hand, 3));
    return cond1 || cond2;
  }
};

// --- Sélection DOM & variables ---
const createRoomBtn        = document.getElementById('createRoom');
const joinRoomBtn          = document.getElementById('joinRoom');
const roomInput            = document.getElementById('roomCodeInput');
const status               = document.getElementById('status');
const playersDiv           = document.getElementById('players');
const playerHandDiv        = document.getElementById('hand');
const declare7NBtn         = document.getElementById('declare7N');
const declareWinBtn        = document.getElementById('declareWin');

const pseudo   = prompt('Entrez votre pseudo:') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';

// --- Drag & Drop main ---
function enableDragDrop() {
  Sortable.create(playerHandDiv, {
    animation: 150,
    dataIdAttr: 'data-card-id',
    onEnd: () => {
      // ordre visuel uniquement
    }
  });
}

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

// --- Déclaration 7 Naturel ---
async function declare7N(room) {
  const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  if (!Rules.has7Naturel(hand)) return alert('Pas de 7 naturel.');
  const html = hand.slice(0, 7).map(c =>
    `<div class="card ${c.color}" data-card-id="${c.id}">${c.rank}${c.symbol}</div>`
  ).join('');
  showPopup(`<h3>${pseudo} a un 7 Naturel</h3><div class="popup-hand">${html}</div>`);
  await push(ref(db, `rooms/${room}/actions`), { playerId, type: '7N' });
}

// --- Déclaration victoire ---
async function declareWin(room) {
  const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  if (!Rules.validateWinHand(hand)) return alert('Main non gagnante');
  let content = '<h3>Dépose tes 4 formations</h3>';
  for (let i = 1; i <= 4; i++) {
    content += `<div class="drop-zone" id="zone${i}">Formation ${i}</div>`;
  }
  content += '<button id="confirmWin">Valider</button>';
  showPopup(content);
  for (let i = 1; i <= 4; i++) {
    Sortable.create(document.getElementById(`zone${i}`), { group: 'win', animation: 150 });
  }
  document.getElementById('confirmWin').onclick = async () => {
    const formations = [];
    for (let i = 1; i <= 4; i++) {
      formations.push(
        Array.from(document.getElementById(`zone${i}`).children)
          .map(el => el.dataset.cardId)
      );
    }
    await push(ref(db, `rooms/${room}/actions`), { playerId, type: 'WIN', formations });
    document.querySelector('.modal').remove();
  };
}

// --- Render joueurs et défausses ---
function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const badge = document.createElement('div'); badge.className = 'player-badge'; badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard" id="discard-${p.id}"></div>`;
    playersDiv.append(badge);
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const raw = snap.val() || {};
    const list = Object.entries(raw).map(([id, o]) => ({ id, pseudo: o.pseudo }));
    renderPlayers(list);
  });
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const all = snap.val() || {};
    Object.entries(all).forEach(([pid, pile]) => {
      const zone = document.getElementById(`discard-${pid}`);
      if (!zone) return;
      zone.innerHTML = pile.slice(-3).map(c =>
        `<div class="mini-card ${c.color}">${c.rank}</div>`
      ).join('');
    });
  });
}

// --- Initialisation ---
function init() {
  enableDragDrop();
  createRoomBtn.onclick = async () => { /* création + listeners */ };
  joinRoomBtn.onclick   = async () => { /* rejoindre + listeners */ };
  declare7NBtn.onclick  = () => declare7N(currentRoom);
  declareWinBtn.onclick = () => declareWin(currentRoom);
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
}
window.addEventListener('load', init);
