// game.js (version améliorée avec drag & drop avancé et animations)
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

// Configuration
const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;
let draggedCard = null;
let draggedCardIndex = null;
let draggedFromHand = false;

// Création du deck avec couleurs et symboles
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

// Mélange Fisher-Yates optimisé
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Gestion des salles
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

// Initialisation des écouteurs
function initGameListeners(roomCode) {
  listenToPlayers(roomCode);
  listenToTurn(roomCode);
  listenToHand(roomCode);
  setupActions(roomCode);
}

// Gestion des joueurs
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

// Gestion du tour
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
  // À implémenter selon ta structure de données
  return playerId.replace('player_', 'Joueur ');
}

// Gestion de la main
function listenToHand(roomCode) {
  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    renderHand(hand);
    renderDropZone(hand);
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

function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.color}`;
  cardEl.dataset.index = index;
  cardEl.dataset.cardId = card.id;
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
  
  e.dataTransfer.setData('text/plain', this.dataset.cardId);
  setTimeout(() => {
    this.classList.add('dragging');
  }, 0);
}

function handleDragEnd() {
  this.classList.remove('dragging');
  draggedCard = null;
  draggedCardIndex = null;
}

function handleDoubleClick() {
  // Ajouter la carte à la première zone de dépôt disponible
  const firstEmptySlot = document.querySelector('.drop-slot:empty');
  if (firstEmptySlot) {
    moveCardToSlot(this, firstEmptySlot);
  }
}

// Gestion de la zone de dépôt
function renderDropZone(hand) {
  dropZone.innerHTML = '<h3>Combinaisons :</h3>';
  const slotsContainer = document.createElement('div');
  slotsContainer.className = 'slots-container';

  for (let i = 0; i < 14; i++) {
    const slot = document.createElement('div');
    slot.className = 'drop-slot';
    slot.dataset.index = i;
    
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('dragenter', handleDragEnter);
    slot.addEventListener('dragleave', handleDragLeave);
    slot.addEventListener('drop', handleDrop);
    slot.addEventListener('click', handleSlotClick);
    
    slotsContainer.appendChild(slot);
  }

  dropZone.appendChild(slotsContainer);
}

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

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drop-target');
  
  const cardId = e.dataTransfer.getData('text/plain');
  const cardElement = draggedCard || document.querySelector(`.card[data-card-id="${cardId}"]`);
  
  if (cardElement) {
    moveCardToSlot(cardElement, this);
  }
}

function handleSlotClick() {
  if (this.children.length > 0) {
    // Retourner la carte à la main
    returnCardToHand(this.firstChild);
  }
}

function moveCardToSlot(cardElement, slot) {
  // Cloner la carte pour l'animation
  const clonedCard = cardElement.cloneNode(true);
  clonedCard.classList.add('moving-to-slot');
  
  // Positionner la carte clone sur l'originale
  const rect = cardElement.getBoundingClientRect();
  clonedCard.style.position = 'fixed';
  clonedCard.style.left = `${rect.left}px`;
  clonedCard.style.top = `${rect.top}px`;
  clonedCard.style.width = `${rect.width}px`;
  clonedCard.style.height = `${rect.height}px`;
  clonedCard.style.transition = 'all 0.3s ease';
  
  document.body.appendChild(clonedCard);
  
  // Calculer la position finale
  const slotRect = slot.getBoundingClientRect();
  
  // Lancer l'animation
  requestAnimationFrame(() => {
    clonedCard.style.left = `${slotRect.left}px`;
    clonedCard.style.top = `${slotRect.top}px`;
    clonedCard.style.width = `${slotRect.width}px`;
    clonedCard.style.height = `${slotRect.height}px`;
    
    // À la fin de l'animation
    setTimeout(() => {
      // Vider la slot et ajouter la carte
      slot.innerHTML = '';
      slot.appendChild(cardElement.cloneNode(true));
      
      // Nettoyer
      clonedCard.remove();
      
      // Si la carte vient de la main, la supprimer de la main
      if (draggedFromHand) {
        removeCardFromHand(draggedCardIndex);
      }
    }, 300);
  });
}

function returnCardToHand(cardElement) {
  const handContainer = document.querySelector('.cards-container');
  const cardClone = cardElement.cloneNode(true);
  
  // Position de départ (slot)
  const startRect = cardElement.getBoundingClientRect();
  cardClone.style.position = 'fixed';
  cardClone.style.left = `${startRect.left}px`;
  cardClone.style.top = `${startRect.top}px`;
  cardClone.style.width = `${startRect.width}px`;
  cardClone.style.height = `${startRect.height}px`;
  cardClone.style.transition = 'all 0.3s ease';
  
  document.body.appendChild(cardClone);
  
  // Vider la slot
  cardElement.parentNode.innerHTML = '';
  
  // Position finale (main)
  const endRect = handContainer.getBoundingClientRect();
  
  requestAnimationFrame(() => {
    cardClone.style.left = `${endRect.right - 100}px`;
    cardClone.style.top = `${endRect.top}px`;
    cardClone.style.transform = 'scale(0.5)';
    cardClone.style.opacity = '0';
    
    setTimeout(() => {
      // Ajouter la carte à la main (à implémenter selon ta logique Firebase)
      addCardToHand(cardElement.dataset.cardId);
      cardClone.remove();
    }, 300);
  });
}

// Gestion des actions
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

// Distribution des cartes
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

// Fonctions utilitaires pour la gestion des cartes
function removeCardFromHand(index) {
  // À implémenter avec Firebase
  console.log(`Retirer la carte à l'index ${index} de la main`);
}

function addCardToHand(cardId) {
  // À implémenter avec Firebase
  console.log(`Ajouter la carte ${cardId} à la main`);
}
