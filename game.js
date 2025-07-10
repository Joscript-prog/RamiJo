import { db, ref, set, update, get, onValue } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

// --- Variables globales ---
const pseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let hasDrawnOrPicked = false;
let hasDiscardedThisTurn = false;

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
          if (vals[i + j] !== vals[i] + j) {
            ok = false;
            break;
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
    return (f1 || f2) && rest;
  }
};

// --- Création et mélange du deck ---
function createDeck() {
  const suits = [{
    suit: 'Coeurs',
    symbol: '♥',
    color: 'red'
  }, {
    suit: 'Carreaux',
    symbol: '♦',
    color: 'red'
  }, {
    suit: 'Trèfles',
    symbol: '♣',
    color: 'black'
  }, {
    suit: 'Piques',
    symbol: '♠',
    color: 'black'
  }];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];
  for (let d = 0; d < 2; d++) {
    suits.forEach(s => ranks.forEach(r => {
      const value = r === 'A' ? 1 : r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : parseInt(r);
      deck.push({
        suit: s.suit,
        symbol: s.symbol,
        color: s.color,
        rank: r,
        value,
        id: `${r}${s.symbol}${d}`
      });
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
  const hands = {},
    discards = {};
  playerIds.forEach(pid => {
    hands[pid] = deck.splice(0, 13);
    discards[pid] = [];
  });

  await Promise.all([
    set(ref(db, `rooms/${roomId}/deck`), deck),
    set(ref(db, `rooms/${roomId}/jokerCard`), jokerCard),
    set(ref(db, `rooms/${roomId}/jokerSet`), {
      jokerSet: jokerSet.map(c => c.id)
    }),
    set(ref(db, `rooms/${roomId}/hands`), hands),
    set(ref(db, `rooms/${roomId}/discard`), discards),
    set(ref(db, `rooms/${roomId}/state`), {
      started: false,
      drawCount: 0,
      lastDiscarder: null,
      currentPlayerIndex: 0
    }),
    set(ref(db, `rooms/${roomId}/chat`), {}) // Initialiser le chat
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
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const menuDiv = document.getElementById('menu');
const gameDiv = document.getElementById('game');
const toggleChatBtn = document.getElementById('toggleChat');
const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

// --- Affichage du joker ---
function showJoker(jokerCard) {
  jokerDiv.innerHTML = jokerCard?.rank ?
    `<div class="card ${jokerCard.color}">JOKER: ${jokerCard.rank}${jokerCard.symbol}</div>` :
    '';
}

// --- Popups ---
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

function actionCreateRoomPopup() {
  showPopup(`
    <h3>Salle créée</h3>
    <p>Code de la salle : <b>${currentRoom}</b></p>
    <button id="copyRoomCode">Copier</button>
  `);
  document.getElementById('copyRoomCode').onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert('Code copié !');
  };
}

// --- Drag & Drop ---
function enableDragDrop() {
  new Sortable(playerHandDiv, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      const hand = Array.from(playerHandDiv.children).map(el => {
        return {
          id: el.dataset.cardId,
          rank: el.querySelector('.corner.top span').textContent,
          symbol: el.querySelector('.corner.top span:nth-child(2)').textContent,
          color: el.classList.contains('red') ? 'red' : 'black',
          suit: el.querySelector('.corner.top span:nth-child(2)').textContent === '♥' ? 'Coeurs' :
            el.querySelector('.corner.top span:nth-child(2)').textContent === '♦' ? 'Carreaux' :
            el.querySelector('.corner.top span:nth-child(2)').textContent === '♣' ? 'Trèfles' : 'Piques',
          value: parseInt(el.querySelector('.corner.top span').textContent) ||
            (el.querySelector('.corner.top span').textContent === 'A' ? 1 :
              el.querySelector('.corner.top span').textContent === 'J' ? 11 :
              el.querySelector('.corner.top span').textContent === 'Q' ? 12 :
              el.querySelector('.corner.top span').textContent === 'K' ? 13 : 0)
        };
      });
      await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);
    }
  });
}

// --- Rendu des joueurs et de leurs mains ---
function renderPlayers(players) {
  playersDiv.innerHTML = '';
  playersDiv.className = `players-circle ${players.length === 2 ? 'two-players' : ''}`;

  players.forEach((p, index) => {
    const badge = document.createElement('div');
    badge.className = `player-badge ${p.id === playerId ? 'current-player' : ''}`;
    badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo} ${p.id === playerId ? '(Vous)' : ''}</div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>
      <div class="opponent-hand" id="hand-${p.id}"></div>
    `;
    playersDiv.append(badge);
    
    // Ajouter une zone de défausse spécifique pour chaque joueur
    const discardZone = document.createElement('div');
    discardZone.className = 'discard-pile';
    discardZone.id = `discard-${p.id}`;
    document.querySelector('.game-table').appendChild(discardZone);
  });
}

// Mettre à jour listenDiscard
function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const discards = snap.val() || {};
    
    Object.entries(discards).forEach(([pid, pile]) => {
      const discardEl = document.getElementById(`discard-${pid}`);
      if (discardEl) {
        discardEl.innerHTML = pile.slice(-3).map(card => `
          <div class="discard-card ${card.color}" 
               data-card-id="${card.id}" 
               data-player-id="${pid}">
            ${card.rank}${card.symbol}
          </div>
        `).join('');
      }
      
      // Mettre à jour la défausse centrale pour le joueur courant
      if (pid === playerId && pile.length > 0) {
        const lastCard = pile[pile.length - 1];
        const globalDiscard = document.getElementById('global-discard');
        globalDiscard.innerHTML = `
          <div class="discard-card ${lastCard.color}" 
               data-card-id="${lastCard.id}" 
               data-player-id="${pid}">
            ${lastCard.rank}${lastCard.symbol}
          </div>
        `;
      }
    });
  });
}

// --- Listeners Firebase ---
function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo
    }));
    renderPlayers(players);
  });

  onValue(ref(db, `rooms/${room}/scores`), snap => {
    Object.entries(snap.val() || {}).forEach(([id, score]) => {
      const el = document.getElementById(`score-${id}`);
      if (el) el.textContent = `Score: ${score}`;
    });
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    const hand = snap.val() || [];
    renderHand(hand);
    updateActionButtons(hand);
  });
}

function updateActionButtons(hand) {
  declare7NBtn.disabled = !Rules.has7Naturel(hand);
  declareWinBtn.disabled = !Rules.validateWinHand(hand);
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const myTurn = turn === playerId;
    hasDrawnOrPicked = false; // Réinitialiser à chaque nouveau tour
    drawCardBtn.disabled = !myTurn;
    status.textContent = myTurn ? "⭐ C'est votre tour !" : "En attente...";

    // Mettre en évidence le joueur courant
    document.querySelectorAll('.player-badge').forEach(badge => {
      badge.classList.toggle('current-turn', badge.id === `badge-${turn}`);
    });
  });
}

// --- Rendu de la main du joueur ---
function renderHand(hand) {
  playerHandDiv.innerHTML = '';
  hand.forEach(c => {
    const div = document.createElement('div');
    div.className = `card ${c.color}`;
    div.dataset.cardId = c.id;
    div.innerHTML = `
      <div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>
      <div class="suit main">${c.symbol}</div>
      <div class="corner bottom"><span>${c.rank}</span><span>${c.symbol}</span></div>
    `;
    playerHandDiv.append(div);
  });
}

// --- Pioche ---
async function drawCard() {
  if (!currentRoom) return;

  // 1) Vérifier que c'est votre tour
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  // 2) Récupérer & initialiser l'état
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || {
    drawCount: 0
  };
  console.log("⚙️ avant pioche, drawCount =", state.drawCount);

  // 3) Empêcher la double pioche
  if (state.drawCount >= 1) {
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');
  }

  // 4) Récupérer deck/hand
  let [deckSnap, handSnap, jokerSetSnap] = await Promise.all([
    get(ref(db, `rooms/${currentRoom}/deck`)),
    get(ref(db, `rooms/${currentRoom}/hands/${playerId}`)),
    get(ref(db, `rooms/${currentRoom}/jokerSet`))
  ]);
  let deck = deckSnap.val() || [];
  let hand = handSnap.val() || [];
  const jokerSet = jokerSetSnap.val()?.jokerSet || [];

  if (!deck.length) {
    return alert('Deck vide');
  }

  // 5) Pioche
  const card = deck.shift();
  hand.push(card);

  // 6) (optionnel) défausse automatique du joker
  const playersCount = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {}).length;
  if (deck.length <= playersCount && hand.some(c => jokerSet.includes(c.id))) {
    const idx = hand.findIndex(c => jokerSet.includes(c.id));
    const [jok] = hand.splice(idx, 1);
    let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
    pile.push(jok);
    await set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile);
    showPopup('Joker défaussé automatiquement');
  }

  // 7) Incrémenter drawCount et enregistrer
  state.drawCount++;
  console.log("⚙️ après pioche, drawCount =", state.drawCount);

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/deck`), deck),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    update(stateRef, { drawCount: state.drawCount })
  ]);

  // 8) ✅ Marquer la pioche effectuée localement
  hasDrawnOrPicked = true;
}

// --- Prendre la carte défaussée (joueur précédent) ---
async function takeDiscardedCard(ownerId) {
  // Vérification que c'est le tour du joueur
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId)
    return alert("Ce n'est pas votre tour.");

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || {
    drawCount: 0,
    lastDiscarder: null
  };

  // Empêche de prendre plus d'une carte ce tour
  if (state.drawCount >= 1)
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');

  // Vérifie que la carte vient bien du joueur précédent
  if (ownerId !== state.lastDiscarder)
    return alert("Vous ne pouvez prendre qu'une carte de la défausse du joueur précédent.");

  // Récupérer la défausse de ce joueur
  let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${ownerId}`))).val() || [];
  if (!pile.length)
    return alert('Défausse vide.');

  // Prendre la dernière carte
  const card = pile.pop();

  // Ajouter à la main du joueur
  let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  hand.push(card);

  // Incrémentation du drawCount
  state.drawCount++;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), pile),
    update(stateRef, { drawCount: state.drawCount }) // utiliser update pour ne pas écraser l'état
  ]);

  // Flag local
  hasDrawnOrPicked = true;
}

// --- Fin de tour ---
async function endTurn() {
  // Référence à l'état du jeu
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const stateSnap = await get(stateRef);
  const state = stateSnap.val() || {};

  // Récupérer la liste des joueurs et l'ID du joueur courant
  const players = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || []);
  const current = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();

  // Calculer l'ID du joueur suivant
  const idx = players.indexOf(current);
  const next = players[(idx + 1) % players.length];

  // Mettre à jour le tour, le dernier défausseur et réinitialiser drawCount
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/turn`), next),
    update(stateRef, {
      lastDiscarder: current,
      drawCount: 0
    })
  ]);

  // Réinitialiser les flags locaux pour le prochain joueur
  hasDrawnOrPicked = false;
  hasDiscardedThisTurn = false;
}

// --- Défausse manuelle & passage immédiat de tour ---
function setupPlayerHandDiscardListener() {
  playerHandDiv.addEventListener('click', async e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;

    // 1) Vérifier que c'est bien votre tour
    const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
    if (turnSnap.val() !== playerId) {
      return alert("Ce n'est pas votre tour.");
    }

    // 2) Empêcher plusieurs défausses dans le même tour
    if (hasDiscardedThisTurn) {
      return alert("Vous avez déjà jeté une carte ce tour.");
    }

    // 3) Vérifier qu'une carte a bien été piochée ou prise
    const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
    const drawCount = stateSnap.val()?.drawCount || 0;
    if (!hasDrawnOrPicked && drawCount === 0) {
      return alert("Vous devez piocher ou prendre une carte avant de défausser.");
    }

    // 4) Retirer la carte de la main
    const cardId = cardEl.dataset.cardId;
    let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [card] = hand.splice(idx, 1);

    // 5) Ajouter la carte à votre défausse
    let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
    pile.push(card);

    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
      set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
    ]);

    // 6) Marquer la défausse effectuée localement
    hasDiscardedThisTurn = true;

    // 7) Passage automatique au tour suivant
    await endTurn();
  });
}

// --- Gestion du chat ---
function enableChat() {
  // Toggle du chat
  toggleChatBtn.addEventListener('click', () => {
    chatContainer.classList.toggle('open');
  });

  // Envoi des messages
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    
    const timestamp = Date.now();
    const messageData = {
      sender: playerId,
      pseudo: pseudo,
      message: message,
      timestamp: timestamp
    };
    
    const messageRef = ref(db, `rooms/${currentRoom}/chat/${timestamp}`);
    await set(messageRef, messageData);
    chatInput.value = '';
  });

  // Réception des messages en temps réel
  const chatRef = ref(db, `rooms/${currentRoom}/chat`);
  onValue(chatRef, (snapshot) => {
    const messages = snapshot.val() || {};
    const messagesArray = Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    chatMessages.innerHTML = '';
    
    messagesArray.forEach(msg => {
      const messageDiv = document.createElement('div');
      messageDiv.className = msg.sender === playerId ? 'me' : '';
      messageDiv.innerHTML = `<b>${msg.pseudo}:</b> ${msg.message}`;
      chatMessages.appendChild(messageDiv);
    });
    
    // Scroll automatique vers le dernier message
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// --- Création de salle ---
async function createRoom() {
  currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/players/${playerId}`), {
      pseudo
    }),
    set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
    set(ref(db, `rooms/${currentRoom}/turn`), playerId)
  ]);

  const playerIds = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val());
  await dealCards(currentRoom, playerIds);

  menuDiv.style.display = 'none';
  gameDiv.hidden = false;
  status.textContent = `Salle: ${currentRoom} | Vous: ${pseudo}`;
  actionCreateRoomPopup();

  // Initialisation des écouteurs
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
  enableChat(); // Activation du chat

  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => showJoker(snap.val()));
}

// --- Rejoindre salle ---
async function joinRoom() {
  const code = roomInput.value.trim();
  if (!code) return alert('Code invalide');
  currentRoom = code;

  // Vérifier que la salle existe
  const roomSnap = await get(ref(db, `rooms/${currentRoom}`));
  if (!roomSnap.exists()) return alert('Salle inexistante');

  // Empêcher l’entrée si le jeu est déjà commencé
  const stateRef      = ref(db, `rooms/${currentRoom}/state`);
  const stateSnapInit = await get(stateRef);
  if (stateSnapInit.val()?.started) {
    return alert('Le jeu a déjà commencé : plus aucune entrée n’est possible.');
  }

  // Ajouter le joueur et initialiser son score
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo }),
    set(ref(db, `rooms/${currentRoom}/scores/${playerId}`),  0),
  ]);

  // S’assurer que chacun a bien 13 cartes (nouveau joueur inclus)
  const handsSnap = await get(ref(db, `rooms/${currentRoom}/hands`));
  const hands     = handsSnap.val() || {};
  if (!hands[playerId]) {
    const playerIds = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val());
    await dealCards(currentRoom, playerIds);
  }

  // Masquer le menu, afficher le jeu
  menuDiv.style.display = 'none';
  gameDiv.hidden      = false;
  status.textContent  = `Salle: ${currentRoom} | Vous: ${pseudo}`;
  showPopup(`<h3>Vous avez rejoint :</h3><p><b>${currentRoom}</b></p>`);

  // Lancer les écouteurs
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
  enableChat(); // Activation du chat
  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => showJoker(snap.val()));

  // Début du jeu dès que le second joueur (ou plus) rejoint
  const playersCount  = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {}).length;
  const stateSnapNow  = await get(stateRef);
  if (playersCount > 1 && !stateSnapNow.val()?.started) {
    await update(stateRef, { started: true });
  }
}

// --- Abandon de partie (–0.5 point) ---
async function abandonGame() {
  if (!currentRoom) return;
  // Retirer le joueur de la liste
  await set(ref(db, `rooms/${currentRoom}/players/${playerId}`), null);
  // Décrémenter son score
  const scoreRef = ref(db, `rooms/${currentRoom}/scores/${playerId}`);
  const cur = (await get(scoreRef)).val() || 0;
  await set(scoreRef, cur - 0.5);
  alert('Vous avez abandonné : –0.5 point');
  // Optionnel : masquer l’UI ou rediriger
  gameDiv.hidden = true;
  menuDiv.style.display = 'block';
}

// --- Déclarations ---
async function declare7N() {
  if (!currentRoom) return;
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  if (!Rules.has7Naturel(hand)) return alert('Combinaison invalide pour 7 Naturel');

  const scoreRef = ref(db, `rooms/${currentRoom}/scores/${playerId}`);
  const cur = (await get(scoreRef)).val() || 0;
  await set(scoreRef, cur + 0.5);

  showPopup('7 Naturel validé ! +0.5 point');
}

async function declareWin() {
  if (!currentRoom) return;
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  if (!Rules.validateWinHand(hand)) return alert('Combinaison invalide pour la victoire');

  const scoreRef = ref(db, `rooms/${currentRoom}/scores/${playerId}`);
  const cur = (await get(scoreRef)).val() || 0;
  await set(scoreRef, cur + 1);

  showPopup('Victoire validée ! +1 point');
}

// --- Initialisation générale ---
function init() {
  createRoomBtn.onclick = createRoom;
  joinRoomBtn.onclick = joinRoom;
  drawCardBtn.onclick = drawCard;
  declare7NBtn.onclick = declare7N;
  declareWinBtn.onclick = declareWin;

  // Initialiser les interactions de jeu
  enableDragDrop();
  setupPlayerHandDiscardListener();

  // Cacher la partie jeu au départ
  gameDiv.hidden = true;
}

window.addEventListener('load', init);
