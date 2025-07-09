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
const takeDiscardBtn = document.getElementById('takeDiscard'); // Nouveau bouton pour prendre la défausse du joueur précédent
const endTurnBtn = document.getElementById('endTurn');
const handDiv = document.getElementById('hand');

const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');

// --- Variables de config ---
const pseudo = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let gameInitialized = false;

let draggedCard = null;
let draggedCardIndex = null;

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

// --- Création ou Rejoindre une salle ---
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

// --- Gestion du tour et boutons ---
function listenToTurn(roomCode) {
  const currentTurnRef = ref(db, `rooms/${roomCode}/currentTurn`);

  onValue(currentTurnRef, async snapshot => {
    const currentPlayer = snapshot.val();
    const isMyTurn = currentPlayer === playerId;

    // On récupère main du joueur courant
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${playerId}`));
    const hand = handSnap.val() || [];

    // On récupère la défausse du joueur précédent (s'il y a un joueur précédent)
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = Object.keys(playersSnap.val() || {});
    const currentIndex = players.indexOf(currentPlayer);

    // Trouver joueur précédent en boucle
    const prevPlayerIndex = (currentIndex - 1 + players.length) % players.length;
    const prevPlayerId = players[prevPlayerIndex];

    const discardPrevSnap = await get(ref(db, `rooms/${roomCode}/discardPile/${prevPlayerId}`));
    const discardPrev = discardPrevSnap.val() || [];

    const hasDiscardCard = discardPrev.length > 0;

    // Gestion des boutons selon état :
    if (!isMyTurn) {
      drawCardBtn.disabled = true;
      takeDiscardBtn.disabled = true;
      endTurnBtn.disabled = true;
    } else {
      if (hand.length === 13) {
        // Doit choisir piocher ou prendre la défausse du joueur précédent
        drawCardBtn.disabled = false;
        takeDiscardBtn.disabled = !hasDiscardCard;
        endTurnBtn.disabled = true;
      } else if (hand.length === 14) {
        // Doit jeter une carte (double clic sur une carte de la main)
        drawCardBtn.disabled = true;
        takeDiscardBtn.disabled = true;
        endTurnBtn.disabled = true;
      } else {
        // Cas inattendu
        drawCardBtn.disabled = true;
        takeDiscardBtn.disabled = true;
        endTurnBtn.disabled = true;
      }
    }

    const turnText = isMyTurn
      ? '<span class="turn-indicator">⭐ À votre tour !</span>'
      : (currentPlayer ? `Tour de : ${getPlayerName(currentPlayer)}` : 'Tour non défini');

    status.innerHTML = `Salle : ${currentRoom} | Vous : ${pseudo} | ${turnText}`;
  });
}

function getPlayerName(playerId) {
  return playerId.replace('player_', 'Joueur ');
}

// --- Écoute de la main ---
function listenToHand(roomCode) {
  const handRef = ref(db, `rooms/${roomCode}/hands/${playerId}`);
  onValue(handRef, snapshot => {
    const hand = snapshot.val() || [];
    renderHand(hand);
  });
}

// --- Affichage main ---
function renderHand(hand) {
  handDiv.innerHTML = '<h3>Votre main :</h3>';
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards-container';

  hand.forEach((card, index) => {
    const cardEl = createCardElement(card, index);
    cardsContainer.appendChild(cardEl);
  });

  handDiv.appendChild(cardsContainer);

  setupCardEvents();
}

// --- Création d’une carte HTML ---
function createCardElement(card, index) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.color}`;
  cardEl.dataset.index = index;
  cardEl.dataset.cardId = card.id;
  cardEl.draggable = false; // Pas besoin drag & drop pour l’instant
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

// --- Événements sur les cartes de la main ---
function setupCardEvents() {
  const cards = document.querySelectorAll('.cards-container .card');

  cards.forEach(card => {
    card.addEventListener('dblclick', async () => {
      await handleDiscardCard(card);
    });
  });
}

// --- Gestion du jeté d’une carte ---
async function handleDiscardCard(cardEl) {
  const cardId = cardEl.dataset.cardId;

  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  let hand = handSnap.val() || [];

  // Vérifier que la main est bien à 14 cartes (on ne peut jeter que dans ce cas)
  if (hand.length !== 14) {
    alert("Vous ne pouvez jeter une carte que si vous avez 14 cartes en main.");
    return;
  }

  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    alert("Carte introuvable dans votre main.");
    return;
  }

  const [discardedCard] = hand.splice(cardIndex, 1);

  // Mettre à jour la main (13 cartes)
  await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);

  // Ajouter la carte jetée dans la défausse du joueur
  const discardRef = ref(db, `rooms/${currentRoom}/discardPile/${playerId}`);
  const discardSnap = await get(discardRef);
  let discardPile = discardSnap.val() || [];

  discardPile.push(discardedCard);
  await set(discardRef, discardPile);

  // Activer le bouton fin de tour car main = 13 après jeté
  endTurnBtn.disabled = false;

  showNotification(`Vous avez jeté ${discardedCard.rank}${discardedCard.symbol}`);
}

// --- Gestion des actions ---
function setupActions(roomCode) {
  drawCardBtn.onclick = () => handleDrawCard(roomCode);
  takeDiscardBtn.onclick = () => handleTakeDiscard(roomCode);
  endTurnBtn.onclick = () => handleEndTurn(roomCode);
  declare7NBtn.onclick = () => handleDeclare7N(roomCode);
  declareWinBtn.onclick = () => handleDeclareWin(roomCode);
}

// --- Piocher dans le deck ---
async function handleDrawCard(roomCode) {
  const turnSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
  if (turnSnap.val() !== playerId) return alert("Ce n'est pas votre tour !");

  const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${playerId}`));
  let hand = handSnap.val() || [];

  if (hand.length !== 13) {
    return alert("Vous devez avoir exactement 13 cartes pour piocher.");
  }

  const deckSnap = await get(ref(db, `rooms/${roomCode}/deck`));
  let deck = deckSnap.val() || [];

  if (deck.length === 0) {
    return alert("Plus de cartes dans le deck !");
  }

  // Prendre la première carte du deck
  const drawnCard = deck.shift();
  hand.push(drawnCard);

  // Mise à jour
  await set(ref(db, `rooms/${roomCode}/deck`), deck);
  await set(ref(db, `rooms/${roomCode}/hands/${playerId}`), hand);

  showCardDrawAnimation(drawnCard);

  // Après pioche, désactiver piocher et prendre défausse, obliger à jeter
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
}

// --- Prendre la dernière carte défaussée du joueur précédent ---
async function handleTakeDiscard(roomCode) {
  const turnSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
  if (turnSnap.val() !== playerId) return alert("Ce n'est pas votre tour !");

  const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${playerId}`));
  let hand = handSnap.val() || [];

  if (hand.length !== 13) {
    return alert("Vous devez avoir exactement 13 cartes pour prendre la défausse.");
  }

  // Trouver joueur précédent
  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = Object.keys(playersSnap.val() || {});
  const currentIndex = players.indexOf(playerId);
  const prevPlayerIndex = (currentIndex - 1 + players.length) % players.length;
  const prevPlayerId = players[prevPlayerIndex];

  const discardRef = ref(db, `rooms/${roomCode}/discardPile/${prevPlayerId}`);
  const discardSnap = await get(discardRef);
  let discardPile = discardSnap.val() || [];

  if (discardPile.length === 0) {
    return alert("La défausse du joueur précédent est vide.");
  }

  // Prendre la dernière carte de la défausse
  const cardTaken = discardPile.pop();

  await set(discardRef, discardPile);

  hand.push(cardTaken);
  await set(ref(db, `rooms/${roomCode}/hands/${playerId}`), hand);

  // Après prise défausse, désactiver piocher et prendre défausse, obliger à jeter
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;

  showNotification(`Vous avez pris ${cardTaken.rank}${cardTaken.symbol} de la défausse.`);
}

// --- Fin du tour ---
async function handleEndTurn(roomCode) {
  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = Object.keys(playersSnap.val() || {});

  if (players.length < 2) return alert("Pas assez de joueurs pour changer de tour.");

  const currentSnap = await get(ref(db, `rooms/${roomCode}/currentTurn`));
  const currentIndex = players.indexOf(currentSnap.val());
  const nextIndex = (currentIndex + 1) % players.length;

  await set(ref(db, `rooms/${roomCode}/currentTurn`), players[nextIndex]);

  // Après changement de tour, désactiver tous les boutons côté joueur
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
}

// --- Animation de la carte piochée ---
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

// --- Notifications ---
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
    // Initialiser défausse vide pour chaque joueur
    await set(ref(db, `rooms/${roomCode}/discardPile/${pId}`), []);
    index += 13;
  }

  const remainingDeck = deck.slice(index);
  await set(ref(db, `rooms/${roomCode}/deck`), remainingDeck);
  await set(ref(db, `rooms/${roomCode}/currentTurn`), players[0]);

  return true;
}

// --- Démarrer la partie ---
async function startGame(roomCode, players) {
  showNotification('La partie commence !');
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
}

// --- Initialisation générale ---
function init() {
  menuDiv.style.display = 'block';
  gameDiv.style.display = 'none';
  drawCardBtn.disabled = true;
  takeDiscardBtn.disabled = true;
  endTurnBtn.disabled = true;
}

init();
