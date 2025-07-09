// game.js
import { db, ref, set, update, get, onValue, push } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

// --- Variables globales définies immédiatement après les imports ---
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
    const byColor = {};
    hand.forEach(c => {
      byColor[c.suit] = byColor[c.suit] || [];
      byColor[c.suit].push(c.value);
    });
    for (let suit in byColor) {
      const vals = byColor[suit].sort((a, b) => a - b);
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
    return (this.isQuadri(hand) && this.isEscalier(hand, 3)) || (this.isEscalier(hand, 4) && this.isTri(hand));
  },
  validateWinHand(hand) {
    const f1 = this.isQuadri(hand) && this.isEscalier(hand, 3);
    const f2 = this.isEscalier(hand, 4) && this.isTri(hand);
    const rest = this.isTri(hand) || this.isEscalier(hand, 3);
    return (f1 || f2) && rest;
  }
};

// --- Deck / Joker Helpers ---
function createDeck() {
  const suits = [
    { suit: 'Coeurs', symbol: '♥', color: 'red' },
    { suit: 'Carreaux', symbol: '♦', color: 'red' },
    { suit: 'Trèfles', symbol: '♣', color: 'black' },
    { suit: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = [
    'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'
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

// --- DOM Elements ---
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

// --- showJoker sécurisé ---
function showJoker(jokerCard) {
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
// Define player-specific variables FIRST
const pseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000); // Corrected: playerId is defined here!
let currentRoom = '';
let hasDrawnOrPicked = false; // Flag to track if a card has been drawn/picked this turn

// Now, it's safe to use playerId for DOM element selection if needed
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

// Removed playerDiscardPileDiv constant here as it's not universally needed
// The clickability is handled by iterating through all player discard piles
// in `enableDiscardPileInteraction` and `listenTurn`.


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
      // For a real game, you'd update the hand order in the database here
      // For now, this just logs the client-side reordering
      // If you want to save hand order, you'd need to re-read children from playerHandDiv
      // and then update the 'hands' path in Firebase for this player.
    }
  });
}

function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const badge = document.createElement('div');
    badge.className = 'player-badge';
    badge.id = `badge-${p.id}`;
    // Add specific ID for their discard pile to allow click handling
    badge.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard ${p.id === playerId ? 'current-player-discard' : ''}" id="discard-${p.id}"></div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>
    `;
    playersDiv.append(badge);
  });
  // Re-enable discard pile listener after re-rendering players to ensure clickability
  // This is called here and in `listenTurn` to ensure it's always active when needed
  enableDiscardPileInteraction();
}


function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo
    }));
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

    // Reset draw/pick state at the start of YOUR turn
    if (myTurn) {
      hasDrawnOrPicked = false;
    }

    // Disable all discard piles by default at the start of any turn update
    // Then re-enable specifically the relevant one if it's my turn
    document.querySelectorAll('.mini-discard').forEach(pileDiv => {
      pileDiv.style.pointerEvents = 'none'; // Disable all by default
      pileDiv.classList.remove('clickable-discard'); // Remove visual feedback
    });

    // Control buttons based on turn and action taken
    drawCardBtn.disabled = !myTurn || hasDrawnOrPicked;
    endTurnBtn.disabled = !myTurn || !hasDrawnOrPicked; // End turn enabled only if a card has been picked/drawn AND a discard has occurred (handled by `enablePlayerHandDiscard` which calls `endTurn`).
    declare7NBtn.disabled = !myTurn;
    declareWinBtn.disabled = !myTurn;


    if (myTurn) {
      status.textContent = "⭐ C'est votre tour !";

      // Enable previous player's discard pile if it's my turn and I haven't drawn/picked yet
      if (!hasDrawnOrPicked) {
        onValue(ref(db, `rooms/${room}/state/lastDiscarder`), (discarderSnap) => {
          const lastDiscarderId = discarderSnap.val();
          // Ensure it's not my own pile and there was actually a last discarder
          if (lastDiscarderId && lastDiscarderId !== playerId) {
            const prevPlayerDiscardDiv = document.getElementById(`discard-${lastDiscarderId}`);
            if (prevPlayerDiscardDiv) {
              prevPlayerDiscardDiv.style.pointerEvents = 'auto'; // Enable interaction
              prevPlayerDiscardDiv.classList.add('clickable-discard'); // Add a class for visual feedback
            }
          }
        }, { onlyOnce: true }); // Listen once to get the last discarder
      }

    } else {
      status.textContent = "En attente...";
      // If it's not my turn, ensure my discard pile is not clickable for picking
      const myDiscardPileDiv = document.getElementById(`discard-${playerId}`);
      if (myDiscardPileDiv) {
        myDiscardPileDiv.style.pointerEvents = 'none';
        myDiscardPileDiv.classList.remove('clickable-discard');
      }
    }
  });
}

async function endTurn(room) {
  // This check is now mostly handled by button disabled state, but good for backend logic
  // A discard implies hasDrawnOrPicked is true, and the discard function calls endTurn.
  // So, if endTurn is manually called, it means a card has been drawn/picked AND discarded.
  
  const playersSnap = await get(ref(db, `rooms/${room}/players`));
  const ids = Object.keys(playersSnap.val() || {});
  const turnSnap = await get(ref(db, `rooms/${room}/turn`));
  const currentTurnPlayerId = turnSnap.val();
  const idx = ids.indexOf(currentTurnPlayerId);
  const next = ids[(idx + 1) % ids.length];

  await Promise.all([
    set(ref(db, `rooms/${room}/turn`), next),
    update(ref(db, `rooms/${room}/state`), { drawCount: 0, lastDiscarder: currentTurnPlayerId }) // Store who discarded last
  ]);
  // hasDrawnOrPicked will be reset at the start of the *next* player's turn in listenTurn
  // No need to reset here, as this function completes the *current* player's turn.
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const all = snap.val() || {};
    Object.entries(all).forEach(([pid, pile]) => {
      const z = document.getElementById(`discard-${pid}`);
      if (z) {
        // Display only the top card if the pile has cards, otherwise clear
        z.innerHTML = pile.length > 0 ? `
          <div class="mini-card ${pile[pile.length - 1].color}" data-card-id="${pile[pile.length - 1].id}">
            ${pile[pile.length - 1].rank}
          </div>
        ` : '';

        // If it's another player's discard pile, ensure it's not clickable by default
        // unless explicitly enabled by the turn logic (see `listenTurn` and `handleDiscardPileClick`).
        if (pid !== playerId) {
          z.style.pointerEvents = 'none';
          z.classList.remove('clickable-discard');
        }
      }
    });
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    console.log('Hand updated:', snap.val());
    renderHand(snap.val() || []);
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
    // Improved card display with rank and suit symbol, and proper HTML structure
    div.innerHTML = `
      <div class="corner top">
        <span class="rank">${c.rank}</span>
        <span class="suit">${c.symbol}</span>
      </div>
      <div class="suit main">${c.symbol}</div>
      <div class="corner bottom">
        <span class="rank">${c.rank}</span>
        <span class="suit">${c.symbol}</span>
      </div>
    `;
    div.dataset.cardId = c.id;
    div.title = `${c.rank} de ${c.suit}`; // Tooltip
    playerHandDiv.append(div);
  });
}

// --- Pioche du talon ---
async function drawCard(room) {
  try {
    const turnSnapshot = await get(ref(db, `rooms/${room}/turn`));
    const currentTurnPlayerId = turnSnapshot.val();
    if (currentTurnPlayerId !== playerId) {
      alert("Ce n'est pas votre tour de piocher.");
      return;
    }

    const stateRef = ref(db, `rooms/${room}/state`);
    const stateSnapshot = await get(stateRef);
    const state = stateSnapshot.val() || { drawCount: 0 };

    if (state.drawCount >= 1) {
      alert('Vous avez déjà pioché ou pris une carte ce tour.');
      return;
    }

    const [deckSnap, handSnap, jokerSetSnap, playersSnap] = await Promise.all([
      get(ref(db, `rooms/${room}/deck`)),
      get(ref(db, `rooms/${room}/hands/${playerId}`)),
      get(ref(db, `rooms/${room}/jokerSet`)),
      get(ref(db, `rooms/${room}/players`))
    ]);

    const deck = deckSnap.val() || [];
    let hand = handSnap.val() || [];
    const jokerSet = jokerSetSnap.val()?.jokerSet || [];
    const players = Object.keys(playersSnap.val() || {});

    if (deck.length === 0) {
      alert('Deck vide');
      return;
    }

    const card = deck.shift(); // Take card from top of the deck
    hand.push(card);

    // Vérifie et défausse automatiquement le joker si nécessaire (rare edge case)
    if (deck.length <= players.length && hand.some(c => jokerSet.includes(c.id))) {
      const idx = hand.findIndex(c => jokerSet.includes(c.id));
      if (idx !== -1) {
        const [jok] = hand.splice(idx, 1);
        const discardRef = ref(db, `rooms/${room}/discard/${playerId}`);
        const pile = (await get(discardRef)).val() || [];
        pile.push(jok);
        await set(discardRef, pile);
        alert('Joker défaussé automatiquement !');
      }
    }

    state.drawCount = (state.drawCount || 0) + 1;
    hasDrawnOrPicked = true; // Mark that a card has been drawn

    await Promise.all([
      set(ref(db, `rooms/${room}/deck`), deck),
      set(ref(db, `rooms/${room}/hands/${playerId}`), hand),
      set(stateRef, state)
    ]);

    drawCardBtn.disabled = true; // Disable draw button after drawing
    // Enable other player's discard piles for potential picking if they are the last discarder
    enableDiscardPileInteraction();

  } catch (error) {
    console.error('Erreur lors de la pioche :', error);
    alert("Une erreur est survenue lors de la pioche");
  }
}

// --- Prendre la carte de la défausse ---
async function takeDiscardedCard(targetDiscardPileOwnerId) {
  try {
    const turnSnapshot = await get(ref(db, `rooms/${currentRoom}/turn`));
    const currentTurnPlayerId = turnSnapshot.val();

    if (currentTurnPlayerId !== playerId) {
      alert("Ce n'est pas votre tour de prendre de la défausse.");
      return;
    }

    if (hasDrawnOrPicked) {
      alert('Vous avez déjà pioché ou pris une carte ce tour.');
      return;
    }

    // Only allow picking from the last discarder's pile
    const lastDiscarderSnapshot = await get(ref(db, `rooms/${currentRoom}/state/lastDiscarder`));
    const lastDiscarder = lastDiscarderSnapshot.val();
    if (targetDiscardPileOwnerId !== lastDiscarder) {
      alert("Vous ne pouvez prendre une carte que de la dernière défausse.");
      return;
    }


    const discardRef = ref(db, `rooms/${currentRoom}/discard/${targetDiscardPileOwnerId}`);
    const discardPileSnap = await get(discardRef);
    const discardPile = discardPileSnap.val() || [];

    if (discardPile.length === 0) {
      alert('La pile de défausse est vide.');
      return;
    }

    const cardToTake = discardPile.pop(); // Take the top card

    const handRef = ref(db, `rooms/${currentRoom}/hands/${playerId}`);
    const handSnap = await get(handRef);
    const hand = handSnap.val() || [];
    hand.push(cardToTake);

    const stateRef = ref(db, `rooms/${currentRoom}/state`);
    const stateSnapshot = await get(stateRef);
    const state = stateSnapshot.val() || { drawCount: 0 };
    state.drawCount = (state.drawCount || 0) + 1; // Increment drawCount for taking from discard

    hasDrawnOrPicked = true; // Mark that a card has been picked

    await Promise.all([
      set(discardRef, discardPile), // Update the source discard pile
      set(handRef, hand), // Add card to hand
      set(stateRef, state) // Update game state
    ]);

    alert(`Vous avez pris le ${cardToTake.rank}${cardToTake.symbol} de la défausse de ${targetDiscardPileOwnerId}!`);
    drawCardBtn.disabled = true; // Disable draw button after drawing/picking
    // Disable all clickable discard piles after taking a card
    document.querySelectorAll('.clickable-discard').forEach(pile => {
      pile.classList.remove('clickable-discard');
      pile.style.pointerEvents = 'none';
    });

  } catch (error) {
    console.error('Erreur lors de la prise de carte de la défausse :', error);
    alert('Une erreur est survenue lors de la prise de carte de la défausse.');
  }
}

// --- Défausse manuelle ---
// Renamed function for clarity
function setupPlayerHandDiscardListener() {
  playerHandDiv.addEventListener('click', async e => {
    console.log('Click event on hand');
    const cardEl = e.target.closest('.card');

    if (!cardEl) {
      console.log('No card element clicked');
      return;
    }

    const turnSnapshot = await get(ref(db, `rooms/${currentRoom}/turn`));
    const currentTurnPlayerId = turnSnapshot.val();

    if (currentTurnPlayerId !== playerId) {
      console.log('Not your turn, cannot discard');
      return;
    }
    
    // Allow discard only if a card has been drawn or picked this turn
    if (!hasDrawnOrPicked) {
        alert("Vous devez piocher une carte ou prendre de la défausse avant de défausser.");
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
      const newHand = hand.filter(c => c.id !== cardId); // Remove card from hand

      const discardRef = ref(db, `rooms/${currentRoom}/discard/${playerId}`);
      const discardPile = (await get(discardRef)).val() || [];
      discardPile.push(card); // Add card to *my* discard pile

      await Promise.all([
        set(handRef, newHand),
        set(discardRef, discardPile)
      ]);

      console.log('Card discarded successfully');
      // After successfully discarding, it's the end of the turn
      endTurnBtn.disabled = false; // Make sure the button is enabled for visual feedback, though it will be clicked immediately
      drawCardBtn.disabled = true; // Ensure draw button remains disabled
      
      // Automatically end turn after a successful discard
      await endTurn(currentRoom);

    } catch (error) {
      console.error('Error discarding card:', error);
      alert('Erreur lors de la défausse');
    }
  });
}

// Enable interaction for all player discard piles (except current player's own)
function enableDiscardPileInteraction() {
    // This function sets up click listeners for the *other* players' discard piles.
    // It is called whenever players are rendered or turn state changes.
    onValue(ref(db, `rooms/${currentRoom}/players`), (playersSnap) => {
        const players = playersSnap.val() || {};
        Object.keys(players).forEach(pId => {
            if (pId !== playerId) { // Don't make my own discard pile clickable for picking
                const discardPileEl = document.getElementById(`discard-${pId}`);
                if (discardPileEl) {
                    discardPileEl.removeEventListener('click', handleDiscardPileClick); // Prevent duplicate listeners
                    discardPileEl.addEventListener('click', handleDiscardPileClick);
                }
            }
        });
    }, { onlyOnce: true }); // Only listen once on player changes to setup listeners
}

async function handleDiscardPileClick(e) {
  const discardPileEl = e.currentTarget;
  const discardPileOwnerId = discardPileEl.id.replace('discard-', '');

  const turnSnapshot = await get(ref(db, `rooms/${currentRoom}/turn`));
  const currentTurnPlayerId = turnSnapshot.val();

  const lastDiscarderSnapshot = await get(ref(db, `rooms/${currentRoom}/state/lastDiscarder`));
  const lastDiscarder = lastDiscarderSnapshot.val();

  if (currentTurnPlayerId === playerId) {
    if (!hasDrawnOrPicked) {
      // Check if the clicked pile belongs to the last discarder
      if (discardPileOwnerId === lastDiscarder) {
        await takeDiscardedCard(discardPileOwnerId);
      } else {
        alert("Vous ne pouvez prendre une carte que de la dernière défausse.");
      }
    } else {
      alert("Vous avez déjà pioché ou pris une carte ce tour. Défaussez une carte de votre main.");
    }
  } else {
    alert("Ce n'est pas votre tour.");
  }
}


// --- Création / Rejoindre partie ---
async function createRoom() {
  try {
    currentRoom = 'RAMI' + Math.floor(Math.random() * 1000);
    console.log('Creating room:', currentRoom);

    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/players/${playerId}`), {
        pseudo
      }),
      set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
      set(ref(db, `rooms/${currentRoom}/state`), {
        started: false,
        drawCount: 0,
        lastDiscarder: null // Initialize lastDiscarder
      }),
      set(ref(db, `rooms/${currentRoom}/turn`), playerId)
    ]);

    // Distribute cards after setting up initial room state
    // This function will also initialize deck, joker, and player hands/discards in DB
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
    // Ensure discard pile interactions are set up after player rendering
    enableDiscardPileInteraction();

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

    const roomExistsSnap = await get(ref(db, `rooms/${currentRoom}`));
    if (!roomExistsSnap.exists()) {
        alert("Cette salle n'existe pas.");
        return;
    }

    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/players/${playerId}`), {
        pseudo
      }),
      set(ref(db, `rooms/${currentRoom}/scores/${playerId}`), 0),
      // Update state, but don't reset drawCount if game is already in progress.
      // This is for new players joining, not resetting game for existing ones.
      update(ref(db, `rooms/${currentRoom}/state`), { drawCount: 0 }) // Reset for *this* player's state
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
    // Ensure discard pile interactions are set up after player rendering
    enableDiscardPileInteraction();

  } catch (error) {
    console.error('Error joining room:', error);
    alert('Erreur lors de la connexion à la salle');
  }
}

// --- Déclarations de victoire ---
async function declare7N(room) {
  try {
    const turnSnapshot = await get(ref(db, `rooms/${room}/turn`));
    if (turnSnapshot.val() !== playerId) {
        alert("Vous ne pouvez déclarer que pendant votre tour.");
        return;
    }
    const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
    const hand = handSnap.val() || [];

    if (Rules.has7Naturel(hand)) {
      const scoreRef = ref(db, `rooms/${room}/scores/${playerId}`);
      const currentScoreSnap = await get(scoreRef);
      const currentScore = currentScoreSnap.val() || 0;
      await set(scoreRef, currentScore + 7);
      alert('7 Naturel validé ! +7 points');
    } else {
      alert('Combinaison invalide pour 7 Naturel');
    }
  } catch (error) {
    console.error('Error declaring 7N:', error);
    alert('Erreur lors de la déclaration du 7 Naturel');
  }
}

async function declareWin(room) {
  try {
    const turnSnapshot = await get(ref(db, `rooms/${room}/turn`));
    if (turnSnapshot.val() !== playerId) {
        alert("Vous ne pouvez déclarer que pendant votre tour.");
        return;
    }
    const handSnap = await get(ref(db, `rooms/${room}/hands/${playerId}`));
    const hand = handSnap.val() || [];

    if (Rules.validateWinHand(hand)) {
      const scoreRef = ref(db, `rooms/${room}/scores/${playerId}`);
      const currentScoreSnap = await get(scoreRef);
      const currentScore = currentScoreSnap.val() || 0;
      await set(scoreRef, currentScore + 10);
      alert('Victoire validée ! +10 points');
      // Optionally end game or reset round here
    } else {
      alert('Combinaison invalide pour victoire');
    }
  } catch (error) {
    console.error('Error declaring win:', error);
    alert('Erreur lors de la déclaration de victoire');
  }
}

// --- Initialisation ---
function init() {
  console.log('Initializing game...');

  // Vérification des éléments DOM
  if (!createRoomBtn || !joinRoomBtn || !drawCardBtn || !endTurnBtn || !declare7NBtn || !declareWinBtn) {
    console.error("Un ou plusieurs boutons sont introuvables dans le DOM. Vérifiez votre HTML.");
    return;
  }

  // Initialisation des écouteurs d'événements
  createRoomBtn.addEventListener("click", createRoom);
  joinRoomBtn.addEventListener("click", joinRoom);
  drawCardBtn.addEventListener("click", () => drawCard(currentRoom));
  // The endTurn button will be clicked by the discard function, so no direct listener needed here for now
  // If you want a dedicated end turn button, you'd add: endTurnBtn.addEventListener("click", () => endTurn(currentRoom));
  declare7NBtn.addEventListener("click", () => declare7N(currentRoom));
  declareWinBtn.addEventListener("click", () => declareWin(currentRoom));

  // Activation des fonctionnalités
  enableDragDrop();
  setupPlayerHandDiscardListener(); // Updated function name for clarity

  console.log('Game initialized');
}

// This ensures init() runs once the entire page (including all DOM elements) has loaded
window.addEventListener('load', init);
