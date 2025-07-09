// game.js
import { db, ref, set, update, get, onValue, push } from './firebase.js';
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
      byColor[c.suit] = byColor[c.suit] || [];
      byColor[c.suit].push(c.value);
    });
    for (let suit in byColor) {
      const vals = byColor[suit].sort((a,b) => a - b);
      for (let i = 0; i <= vals.length - len; i++) {
        let ok = true;
        for (let j = 1; j < len; j++) {
          if (vals[i+j] !== vals[i] + j) { ok = false; break; }
        }
        if (ok) return true;
      }
    }
    return false;
  },
  has7Naturel(hand) {
    return (this.isQuadri(hand) && this.isEscalier(hand,3)) || (this.isEscalier(hand,4) && this.isTri(hand));
  },
  validateWinHand(hand) {
    const f1 = this.isQuadri(hand) && this.isEscalier(hand,3);
    const f2 = this.isEscalier(hand,4) && this.isTri(hand);
    const rest = this.isTri(hand) || this.isEscalier(hand,3);
    return (f1||f2) && rest && rest;
  }
};

// --- Deck / Joker Helpers ---
function createDeck() {
  const suits = [
    { suit:'Coeurs', symbol:'♥', color:'red' },
    { suit:'Carreaux', symbol:'♦', color:'red' },
    { suit:'Trèfles', symbol:'♣', color:'black' },
    { suit:'Piques', symbol:'♠', color:'black' }
  ];
  const ranks = [
    'A','2','3','4','5','6','7','8','9','10','J','Q','K'
  ];
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
        id:`${r}${s.symbol}${d}` 
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

// --- Distribue et initialise jokers + mains ---
async function dealCards(room, players) {
  let deck = shuffle(createDeck());
  const jokerCard = deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
  const jokerSet = deck.filter(c => c.value === jokerCard.value && c.color !== jokerCard.color).map(c => c.id);
  
  await Promise.all([
    set(ref(db, `rooms/${room}/jokerSet`), { jokerSet }),
    set(ref(db, `rooms/${room}/jokerCard`), jokerCard)
  ]);
  
  let idx = 0;
  for (const p of players) {
    const hand = deck.slice(idx, idx + 13);
    await set(ref(db, `rooms/${room}/hands/${p}`), hand);
    await set(ref(db, `rooms/${room}/discard/${p}`), []);
    idx += 13;
  }
  await set(ref(db, `rooms/${room}/deck`), deck.slice(idx));
}

function showJoker(jokerCard) {
  const jokerDiv = document.getElementById('joker');
  if (!jokerCard || !jokerCard.rank) {
    jokerDiv.innerHTML = '';
    return;
  }
  jokerDiv.innerHTML = `
    <div class="card ${jokerCard.color}">
      JOKER: ${jokerCard.rank}${jokerCard.symbol}
    </div>
  `;
}

// --- DOM & État ---
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

const pseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';

// --- UI Helpers ---
function showPopup(content) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      ${content}
      <button class="modal-close">Fermer</button>
    </div>
  `;
  document.body.append(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
}

function enableDragDrop() {
  new Sortable(playerHandDiv, { 
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: (evt) => {
      console.log('Card moved from', evt.oldIndex, 'to', evt.newIndex);
    }
  });
}

function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const badge = document.createElement('div');
    badge.className = 'player-badge';
    badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard" id="discard-${p.id}"></div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>
    `;
    playersDiv.append(badge);
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const players = Object.entries(snap.val()||{}).map(([id,o]) => ({ id, pseudo: o.pseudo }));
    renderPlayers(players);
  });
  
  onValue(ref(db, `rooms/${room}/scores`), snap => {
    const scores = snap.val() || {};
    Object.entries(scores).forEach(([id, score]) => {
      const el = document.getElementById(`score-${id}`);
      if (el) el.textContent = `Score: ${score}`;
    });
  });
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const myTurn = turn === playerId;
    drawCardBtn.disabled = !myTurn;
    endTurnBtn.disabled = !myTurn;
    declare7NBtn.disabled = !myTurn;
    declareWinBtn.disabled = !myTurn;
    status.textContent = myTurn ? "⭐ C'est votre tour !" : "En attente...";
  });
}

async function endTurn(room) {
  const playersSnap = await get(ref(db, `rooms/${room}/players`));
  const ids = Object.keys(playersSnap.val()||{});
  const turnSnap = await get(ref(db, `rooms/${room}/turn`));
  const idx = ids.indexOf(turnSnap.val());
  const next = ids[(idx + 1) % ids.length];
  await set(ref(db, `rooms/${room}/turn`), next);
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const all = snap.val() || {};
    Object.entries(all).forEach(([pid, pile]) => {
      const z = document.getElementById(`discard-${pid}`);
      if (z) {
        z.innerHTML = pile.slice(-3).map(c => `
          <div class="mini-card ${c.color}">${c.rank}</div>
        `).join('');
      }
    });
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    console.log('Hand updated:', snap.val());
    renderHand(snap.val()||[]);
  });
}

function renderHand(hand) {
    if (!Array.isArray(hand)) {
    console.error("La main doit être un tableau", hand);
    return;
  }
  console.log('Rendering hand:', hand);
  playerHandDiv.innerHTML = '';
  hand.forEach(c => {
    const div = document.createElement('div');
    div.className = `card ${c.color}`;
    div.textContent = c.rank + c.symbol;
    div.dataset.cardId = c.id;
    div.title = `${c.rank} de ${c.suit}`; // Tooltip
    playerHandDiv.append(div);
  });
}

// --- Pioche & Joker obligatoire ---
async function drawCard(room) {
  try {
    const stateRef = ref(db, `rooms/${room}/state`);
    const stateSnapshot = await get(stateRef);
    const state = stateSnapshot.val() || { drawCount: 0 };
    
    if (state.drawCount >= 1) {
      alert('Une seule pioche par tour');
      return;
    } catch (error) {
    console.error("Erreur lors de la pioche:", error);
    alert("Une erreur est survenue lors de la pioche");
  }
}
    
    const [deckSnap, handSnap, jokerSetSnap, playersSnap] = await Promise.all([
      get(ref(db, `rooms/${room}/deck`)),
      get(ref(db, `rooms/${room}/hands/${playerId}`)),
      get(ref(db, `rooms/${room}/jokerSet`)),
      get(ref(db, `rooms/${room}/players`))
    ]);
    
    const deck = deckSnap.val() || [];
    const hand = handSnap.val() || [];
    const jokerSet = jokerSetSnap.val()?.jokerSet || [];
    const players = Object.keys(playersSnap.val()||{});
    
    if (deck.length === 0) {
      alert('Deck vide');
      return;
    }
    
    const card = deck.shift(); 
    hand.push(card);
    
    // Vérification et défausse automatique du joker
    if (deck.length <= players.length && hand.some(c => jokerSet.includes(c.id))) {
      const idx = hand.findIndex(c => jokerSet.includes(c.id));
      if (idx !== -1) {
        const [jok] = hand.splice(idx, 1);
        const discardRef = ref(db, `rooms/${room}/discard/${playerId}`);
        const pile = (await get(discardRef)).val()||[];
        pile.push(jok);
        await set(discardRef, pile);
        alert('Joker défaussé automatiquement');
      }
    }
    
    state.drawCount = (state.drawCount||0) + 1;
    
    await Promise.all([
      set(ref(db, `rooms/${room}/deck`), deck),
      set(ref(db, `rooms/${room}/hands/${playerId}`), hand),
      set(stateRef, state)
    ]);
    
  } catch (error) {
    console.error('Error drawing card:', error);
    alert('Erreur lors de la pioche');
  }
}

// --- Défausse manuelle ---
function enableCardDiscard() {
  playerHandDiv.addEventListener('click', async e => {
    console.log('Click event on hand');
    const cardEl = e.target.closest('.card');
    
    if (!cardEl) {
      console.log('No card element clicked');
      return;
    }
    
    if (endTurnBtn.disabled) {
      console.log('Not your turn, cannot discard');
      return;
    }
    
    const cardId = cardEl.dataset.cardId;
    console.log('Attempting to discard card:', cardId);
    
    try {
      const handRef = ref(db, `rooms/${currentRoom}/hands/${playerId}`);
      const hand = (await get(handRef)).val() || [];
      const cardIndex = hand.findIndex(c => c.id === cardId);
      
      if (cardIndex === -1) {
        console.log('Card not found in hand');
        return;
      }
      
      const card = hand[cardIndex];
      const newHand = hand.filter(c => c.id !== cardId);
      
      const discardRef = ref(db, `rooms/${currentRoom}/discard/${playerId}`);
      const discardPile = (await get(discardRef)).val() || [];
      discardPile.push(card);
      
      await Promise.all([
        set(handRef, newHand),
        set(discardRef, discardPile)
      ]);
      
      console.log('Card discarded successfully');
      await endTurn(currentRoom);
      
    } catch (error) {
      console.error('Error discarding card:', error);
      alert('Erreur lors de la défausse');
    }
  });
}

// --- Création / Rejoindre partie ---
async function createRoom() {
  try {
    currentRoom = 'RAMI'+Math.floor(Math.random()*1000);
    console.log('Creating room:', currentRoom);
    
    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo }),
      set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
      set(ref(db, `rooms/${currentRoom}/state`), { started: false, drawCount: 0 }),
      set(ref(db, `rooms/${currentRoom}/turn`), playerId)
    ]);
    
    await dealCards(currentRoom, [playerId]);
    
    menuDiv.style.display = 'none';
    gameDiv.style.display = 'block';
    status.textContent = `Salle: ${currentRoom} | Vous: ${pseudo}`;
    
    showPopup(`<h3>Salle créée</h3><p>Code: <b>${currentRoom}</b></p>`);
    
    // Initialisation des écouteurs
    listenPlayers(currentRoom);
    listenDiscard(currentRoom);
    listenHand(currentRoom);
    listenTurn(currentRoom);
    
    // Écoute du joker
    onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => {
      console.log('Joker updated:', snap.val());
      showJoker(snap.val());
    });
    
  } catch (error) {
    console.error('Error creating room:', error);
    alert('Erreur lors de la création de la salle');
  }
}

async function joinRoom() {
  try {
    const code = roomInput.value.trim();
    if (!code) {
      alert('Code invalide');
      return;
    }
    
    currentRoom = code;
    console.log('Joining room:', currentRoom);
    
    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/players/${playerId}`), { pseudo }),
      set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
      update(ref(db, `rooms/${currentRoom}/state`), { drawCount: 0 })
    ]);
    
    menuDiv.style.display = 'none';
    gameDiv.style.display = 'block';
    status.textContent = `Salle: ${currentRoom} | Vous: ${pseudo}`;
    
    // Initialisation des écouteurs
    listenPlayers(currentRoom);
    listenDiscard(currentRoom);
    listenHand(currentRoom);
    listenTurn(currentRoom);
    
    // Écoute du joker
    onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap => {
      console.log('Joker updated:', snap.val());
      showJoker(snap.val());
    });
    
  } catch (error) {
    console.error('Error joining room:', error);
    alert('Erreur lors de la connexion à la salle');
  }
}

// --- Déclarations de victoire ---
async function declare7N(room) {
  try {
    const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    
    if (Rules.has7Naturel(hand)) {
      await update(ref(db, `rooms/${room}/scores/${playerId}`), { $inc: 7 });
      alert('7 Naturel validé ! +7 points');
    } else {
      alert('Combinaison invalide pour 7 Naturel');
    }
  } catch (error) {
    console.error('Error declaring 7N:', error);
  }
}

async function declareWin(room) {
  try {
    const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    
    if (Rules.validateWinHand(hand)) {
      await update(ref(db, `rooms/${room}/scores/${playerId}`), { $inc: 10 });
      alert('Victoire validée ! +10 points');
    } else {
      alert('Combinaison invalide pour victoire');
    }
  } catch (error) {
    console.error('Error declaring win:', error);
  }
}

// --- Initialisation ---
function init() {
  console.log('Initializing game...');

    // Vérification des éléments DOM
  if (!createRoomBtn || !joinRoomBtn) {
    console.error("Boutons introuvables dans le DOM");
    return;
  }

  // Initialisation des écouteurs
  createRoomBtn.addEventListener("click", createRoom);
  joinRoomBtn.addEventListener("click", joinRoom);
  
  // Activation des fonctionnalités
  enableDragDrop();
  enableCardDiscard();
  
  // Gestion des événements
  createRoomBtn.onclick = createRoom;
  joinRoomBtn.onclick = joinRoom;
  drawCardBtn.onclick = () => drawCard(currentRoom);
  endTurnBtn.onclick = () => endTurn(currentRoom);
  declare7NBtn.onclick = () => declare7N(currentRoom);
  declareWinBtn.onclick = () => declareWin(currentRoom);
  
  console.log('Game initialized');
}

window.addEventListener('load', init);
