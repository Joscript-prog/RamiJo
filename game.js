// game.js (version corrigée)
import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// --- Références DOM ---
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

// --- Variables de config ---
const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;
let draggedCard = null;
let draggedCardIndex = null;
let draggedFromHand = false;
let draggedFromSlot = null;

// --- Création du deck ---
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
  return deck;
}

// --- Mélange Fisher-Yates ---
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// --- Gestion des salles ---
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

// --- Initialisation des écouteurs ---
function initGameListeners(roomCode) {
  listenToPlayers(roomCode);
  listenToTurn(roomCode);
  listenToHand(roomCode);
  listenToSlots(roomCode);
  setupActions(roomCode);
}

// --- Écoute des joueurs ---
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
  playersDiv.innerHTML = '<h3>Joueurs :</h3>';
  const playerOrder = Object.entries(players).map(([id, info]) => 
    `<span class="${id === playerId ? 'player-me' : 'player-other'}">${info.pseudo}</span>`
  ).join(' → ');
  
  playersDiv.innerHTML += `<div class="players-list">${playerOrder}</div>`;
}

// --- Gestion du tour ---
function listenToTurn(roomCode) {
  const currentTurnRef = ref(db, `rooms/${roomCode}/currentTurn`);
  onValue(currentTurnRef, snapshot => {
    const currentPlayer = snapshot.val();
    const isMyTurn = currentPlayer === playerId;
    endTurnBtn.disabled = !isMyTurn;
    
    const turnText = isMyTurn 
      ? '<span class="turn-indicator">⭐ À votre tour !</span>' 
      : `Tour de : ${getPlayerName(currentPlayer)}`;
    
    status.innerHTML = `Salle : ${currentRoom} | Vous : ${pseudo} | ${turnText}`;
  });
}

function getPlayerName(playerId) {
  return playerId.replace('player_', 'Joueur ');
}

// --- Gestion de la main ---
function listenToHand(roomCode) {
  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    renderHand(hand);
  });
}

function renderHand(hand) {
  handDiv.innerHTML = '<h3>Votre main :</h3>';
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards-container';

  hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    cardsContainer.appendChild(cardEl);
  });

  handDiv.appendChild(cardsContainer);
  setupDragEvents();
}

// --- Création d'une carte HTML ---
function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.color}`;
  cardEl.dataset.index = index;
  cardEl.dataset.cardId = card.id;
  cardEl.draggable = true;
  cardEl.innerHTML = `
    <div class="card-corner top-left">
      <span>${card.rank}</span>
      <span>${card.symbol}</span>
    </div>
    <div class="card-center">${card.symbol}</div>
    <div class="card-corner bottom-right">
      <span>${card.rank}</span>
      <span>${card.symbol}</span>
    </div>
  `;
  return cardEl;
}

// --- Gestion drag & drop main ---
function setupDragEvents() {
  const cards = document.querySelectorAll('.card');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dblclick', handleDoubleClick);
  });
}

function handleDragStart(e) {
  draggedCard = this;
  draggedCardIndex = parseInt(this.dataset.index);
  draggedFromHand = true;
  draggedFromSlot = null;

  e.dataTransfer.setData('text/plain', this.dataset.cardId);
  setTimeout(() => {
    this.classList.add('dragging');
  }, 0);
}

function handleDragEnd() {
  this.classList.remove('dragging');
  draggedCard = null;
  draggedCardIndex = null;
  draggedFromHand = false;
  draggedFromSlot = null;
}

function handleDoubleClick() {
  const firstEmptySlot = document.querySelector('.drop-slot.empty');
  if (firstEmptySlot) {
    moveCardToSlot(this, firstEmptySlot);
  }
}

// --- Gestion de la zone de dépôt (combinaisons) ---
function listenToSlots(roomCode) {
  const slotsRef = ref(db, `rooms/${roomCode}/slots/${playerId}`);
  onValue(slotsRef, snapshot => {
    const slots = snapshot.val() || {};
    renderDropZone(slots);
  });
}

function renderDropZone(slots) {
  dropZone.innerHTML = '<h3>Combinaisons :</h3>';
  const slotsContainer = document.createElement('div');
  slotsContainer.className = 'slots-container-horizontal'; // <-- horizontal layout (voir CSS)

  // 14 slots max
  for (let i = 0; i < 14; i++) {
    const slot = document.createElement('div');
    slot.className = 'drop-slot';
    slot.dataset.index = i;

    // Si slot vide ou pas
    if (!slots[i]) {
      slot.classList.add('empty');
      // Ajouter un bouton + pour ajouter une carte
      const plusBtn = document.createElement('button');
      plusBtn.textContent = '+';
      plusBtn.title = 'Ajouter une carte';
      plusBtn.className = 'plus-btn';
      plusBtn.onclick = () => openCardSelector(i);
      slot.appendChild(plusBtn);
    } else {
      // Afficher les cartes dans le slot (on suppose un tableau de cartes dans slots[i])
      slots[i].forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.draggable = true;
        cardEl.addEventListener('dragstart', e => {
          draggedCard = cardEl;
          draggedFromHand = false;
          draggedFromSlot = i;
          e.dataTransfer.setData('text/plain', card.id);
          setTimeout(() => cardEl.classList.add('dragging'), 0);
        });
        cardEl.addEventListener('dragend', e => {
          cardEl.classList.remove('dragging');
          draggedCard = null;
          draggedFromSlot = null;
        });
        // Clique pour retirer la carte vers la main
        cardEl.addEventListener('click', () => {
          returnCardToHandFromSlot(card, i);
        });
        slot.appendChild(cardEl);
      });
    }

    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('dragenter', handleDragEnter);
    slot.addEventListener('dragleave', handleDragLeave);
    slot.addEventListener('drop', handleDrop);

    dropZone.appendChild(slotsContainer);
    slotsContainer.appendChild(slot);
  }
}

// --- Gestion drag & drop sur slots ---
function handleDragOver(e) {
  e.preventDefault();
}

function handleDragEnter(e) {
  e.preventDefault();
  this.classList.add('drop-target');
}

function handleDragLeave() {
  this.classList.remove('drop-target');
}

async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drop-target');

  const slotIndex = parseInt(this.dataset.index);
  const cardId = e.dataTransfer.getData('text/plain');

  if (!cardId) return;

  if (draggedFromHand) {
    // Carte venant de la main => ajouter au slot
    const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
    let hand = handSnap.val() || [];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = hand[cardIndex];

    // Supprimer carte de la main
    hand.splice(cardIndex, 1);
    await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);

    // Ajouter carte au slot
    const slotsSnap = await get(ref(db, `rooms/${currentRoom}/slots/${playerId}`));
    let slots = slotsSnap.val() || {};
    if (!slots[slotIndex]) slots[slotIndex] = [];
    slots[slotIndex].push(card);
    await set(ref(db, `rooms/${currentRoom}/slots/${playerId}`), slots);

  } else if (draggedFromSlot !== null) {
    // Carte venant d'un autre slot => déplacer entre slots
    if (draggedFromSlot === slotIndex) return; // même slot, rien à faire

    const slotsSnap = await get(ref(db, `rooms/${currentRoom}/slots/${playerId}`));
    let slots = slotsSnap.val() || {};

    const fromCards = slots[draggedFromSlot] || [];
    const cardIndex = fromCards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    const card = fromCards[cardIndex];

    // Enlever de l'ancien slot
    fromCards.splice(cardIndex, 1);
    slots[draggedFromSlot] = fromCards;

    // Ajouter au nouveau slot
    if (!slots[slotIndex]) slots[slotIndex] = [];
    slots[slotIndex].push(card);

    await set(ref(db, `rooms/${currentRoom}/slots/${playerId}`), slots);

  } else {
    // Peut-être cas non prévu
    console.warn("Drop card from unknown source");
  }
}

// --- Ouvrir sélecteur de carte pour ajouter dans slot vide ---
async function openCardSelector(slotIndex) {
  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  const hand = handSnap.val() || [];

  if (hand.length === 0) return alert("Votre main est vide !");

  // Créer un prompt simple pour choisir une carte (améliorable)
  const cardList = hand.map((c, i) => `${i + 1}: ${c.rank}${c.symbol}`).join('\n');
  const choice = prompt(`Choisissez une carte à ajouter au slot ${slotIndex + 1}:\n${cardList}\nEntrez un numéro:`);

  const choiceIndex = parseInt(choice) - 1;
  if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= hand.length) {
    alert("Choix invalide.");
    return;
  }

  // Retirer la carte de la main
  const card = hand[choiceIndex];
  hand.splice(choiceIndex, 1);
  await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);

  // Ajouter la carte au slot
  const slotsSnap = await get(ref(db, `rooms/${currentRoom}/slots/${playerId}`));
  let slots = slotsSnap.val() || {};
  if (!slots[slotIndex]) slots[slotIndex] = [];
  slots[slotIndex].push(card);
  await set(ref(db, `rooms/${currentRoom}/slots/${playerId}`), slots);
}

// --- Retourner une carte du slot à la main ---
async function returnCardToHandFromSlot(card, slotIndex) {
  const slotsSnap = await get(ref(db, `rooms/${currentRoom}/slots/${playerId}`));
  let slots = slotsSnap.val() || {};
  if (!slots[slotIndex]) return;

  // Retirer la carte du slot
  slots[slotIndex] = slots[slotIndex].filter(c => c.id !== card.id);
  if (slots[slotIndex].length === 0) delete slots[slotIndex];
  await set(ref(db, `rooms/${currentRoom}/slots/${playerId}`), slots);

  // Ajouter la carte à la main
  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  let hand = handSnap.val() || [];
  hand.push(card);
  await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);
}

// --- Gestion des actions ---
function setupActions(roomCode) {
  drawCardBtn.onclick = () => handleDrawCard(roomCode);
  endTurnBtn.onclick = () => handleEndTurn(roomCode);
  declare7NBtn.onclick = () => handleDeclare7N(roomCode);
  declareWinBtn.onclick = () => handleDeclareWin(roomCode);
}

async function handleDrawCard(roomCode) {
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

  showCardDrawAnimation(drawnCard);
}

function showCardDrawAnimation(card) {
  const animationDiv = document.createElement('div');
  animationDiv.className = 'card-draw-animation';
  animationDiv.innerHTML = `
    <div class="card ${card.color}">
      <div class="card-corner top-left">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
      <div class="card-center">${card.symbol}</div>
      <div class="card-corner bottom-right">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
    </div>
    <p>Nouvelle carte : ${card.rank} ${card.symbol}</p>
  `;
  document.body.appendChild(animationDiv);
  
  setTimeout(() => {
    animationDiv.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    animationDiv.classList.remove('show');
    setTimeout(() => animationDiv.remove(), 500);
  }, 2000);
}

async function handleEndTurn(roomCode) {
  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = Object.keys(playersSnap.val() || {});
  if (players.length < 2) return alert("Pas assez de joueurs pour changer de tour.");

  const currentSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
  const currentIndex = players.indexOf(currentSnap.val());
  const nextIndex = (currentIndex + 1) % players.length;
  await set(ref(db, `rooms/${roomCode}/currentTurn`), players[nextIndex]);
}

function handleDeclare7N(roomCode) {
  push(ref(db, `rooms/${roomCode}/actions`), {
    type: '7N_DECLARED',
    playerId,
    pseudo,
    timestamp: Date.now()
  });
  showNotification("7 naturel déclaré !");
}

function handleDeclareWin(roomCode) {
  push(ref(db, `rooms/${roomCode}/actions`), {
    type: 'VICTORY_DECLARED',
    playerId,
    pseudo,
    timestamp: Date.now()
  });
  showNotification("Fin de manche déclarée !");
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

// --- Distribution des cartes ---
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
