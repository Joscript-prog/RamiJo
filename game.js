import { db, ref, push, onChildAdded, set, update, get, onValue } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

let myPseudo = '';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let isDrawing = false;
let hasDrawnOrPicked = false;
let hasDiscardedThisTurn = false;
let handDisplayType = 'horizontal';
let currentHand = [];
let gameRounds = 0;
let jokerSet = [];

// NOUVELLE LOGIQUE DE RÈGLES
const Rules = {
  // Validation principale de victoire
  validateWinHand(hand, jokerCards, has7Naturel) {
    const naturalCards = hand.filter(c => !jokerCards.includes(c.id));
    const jokers = hand.filter(c => jokerCards.includes(c.id));
    
    // Extraire toutes les formations possibles
    const formations = this.extractAllFormations(naturalCards, jokers);
    
    // Si 7N, les 2 formations de 3 peuvent être tri avec 1 joker max
    if (has7Naturel) {
      return this.validateWith7N(formations, naturalCards, jokers);
    }
    
    // Sinon, besoin d'au moins 1 escalier et 1 tri, jokers autorisés
    return this.validateWithout7N(formations, naturalCards, jokers);
  },
  
  extractAllFormations(naturalCards, jokers) {
    const formations = {
      quadri: [],
      escalier4: [],
      escalier3: [],
      tri: []
    };
    
    // Formations naturelles
    this.extractNaturalFormations(formations, naturalCards);
    
    // Formations avec jokers (1 max par formation)
    this.extractJokerFormations(formations, naturalCards, jokers);
    
    return formations;
  },
  
  extractNaturalFormations(formations, cards) {
    // Par valeur pour quadri et tri
    const byValue = cards.reduce((acc, c) => {
      acc[c.value] = acc[c.value] || [];
      acc[c.value].push(c);
      return acc;
    }, {});
    
    Object.entries(byValue).forEach(([value, cards]) => {
      if (cards.length >= 4) {
        formations.quadri.push({cards: cards.slice(0, 4), type: 'natural'});
      }
      if (cards.length === 3) {
        formations.tri.push({cards, type: 'natural'});
      }
    });
    
    // Par couleur pour escaliers
    const bySuit = cards.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c);
      return acc;
    }, {});
    
    Object.entries(bySuit).forEach(([suit, cards]) => {
      const sorted = cards.sort((a, b) => a.value - b.value);
      
      // Escalier de 4
      for (let i = 0; i <= sorted.length - 4; i++) {
        if (sorted[i+3].value === sorted[i].value + 3) {
          formations.escalier4.push({cards: sorted.slice(i, i+4), type: 'natural'});
        }
      }
      
      // Escalier de 3
      for (let i = 0; i <= sorted.length - 3; i++) {
        if (sorted[i+2].value === sorted[i].value + 2) {
          formations.escalier3.push({cards: sorted.slice(i, i+3), type: 'natural'});
        }
      }
    });
  },
  
  extractJokerFormations(formations, naturalCards, jokers) {
    jokers.forEach(joker => {
      // Escalier de 3 avec 1 joker
      const bySuit = naturalCards.reduce((acc, c) => {
        acc[c.suit] = acc[c.suit] || [];
        acc[c.suit].push(c);
        return acc;
      }, {});
      
      Object.entries(bySuit).forEach(([suit, cards]) => {
        const sorted = cards.sort((a, b) => a.value - b.value);
        
        // Trouver les séquences manquantes
        for (let i = 0; i < sorted.length - 1; i++) {
          const gap = sorted[i+1].value - sorted[i].value;
          if (gap === 2) {
            const neededValue = sorted[i].value + 1;
            formations.escalier3.push({
              cards: [sorted[i], {...joker, value: neededValue, suit}, sorted[i+1]],
              type: 'joker',
              jokerUsed: 1
            });
          }
        }
      });
      
      // Tri avec 1 joker
      Object.entries(naturalCards.reduce((acc, c) => {
        acc[c.value] = acc[c.value] || [];
        acc[c.value].push(c);
        return acc;
      }, {})).forEach(([value, cards]) => {
        if (cards.length === 2) {
          formations.tri.push({
            cards: [...cards, {...joker, value}],
            type: 'joker',
            jokerUsed: 1
          });
        }
      });
    });
  },
  
  validateWithout7N(formations, naturalCards, jokers) {
    // Besoin d'au moins 1 escalier et 1 tri
    const escaliers = [...formations.escalier4, ...formations.escalier3];
    const tris = formations.tri;
    
    if (escaliers.length === 0 || tris.length === 0) return false;
    
    // Chercher 4 formations disjointes totalisant 13 cartes
    return this.findDisjointFormations([...escaliers, ...formations.quadri, ...tris]);
  },
  
  validateWith7N(formations, naturalCards, jokers) {
    // Le 7N compte pour 2 formations (4+3 cartes)
    // Il reste 2 formations de 3 cartes chacune, avec 1 joker max par formation
    const remainingCards = this.getRemainingCards(naturalCards, jokers, formations);
    return this.canFormTwoTriWithJokers(remainingCards);
  },
  
  findDisjointFormations(allFormations) {
    // Logique de recherche de 4 formations disjointes
    // Implémentation simplifiée pour l'instant
    let totalCards = 0;
    const usedCards = new Set();
    
    allFormations.forEach(formation => {
      formation.cards.forEach(card => {
        if (!usedCards.has(card.id)) {
          usedCards.add(card.id);
          totalCards++;
        }
      });
    });
    
    return totalCards >= 13;
  },
  
  // Vérifie le 7 naturel (sans joker)
  has7Naturel(hand, jokerCards) {
    const naturalCards = hand.filter(c => !jokerCards.includes(c.id));
    
    // Quadri + escalier3
    const quadri = this.findNaturalQuadri(naturalCards);
    const escalier3 = this.findNaturalEscalier3(naturalCards);
    
    if (quadri && escalier3) {
      const cards = [...quadri, ...escalier3];
      if (cards.length === 7) return true;
    }
    
    // Escalier4 + tri
    const escalier4 = this.findNaturalEscalier4(naturalCards);
    const tri = this.findNaturalTri(naturalCards);
    
    if (escalier4 && tri) {
      const cards = [...escalier4, ...tri];
      if (cards.length === 7) return true;
    }
    
    return false;
  },
  
  findNaturalQuadri(cards) {
    const byValue = cards.reduce((acc, c) => {
      acc[c.value] = acc[c.value] || [];
      acc[c.value].push(c);
      return acc;
    }, {});
    
    const quadri = Object.values(byValue).find(vals => vals.length >= 4);
    return quadri ? quadri.slice(0, 4) : null;
  },
  
  findNaturalEscalier3(cards) {
    const bySuit = cards.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c);
      return acc;
    }, {});
    
    for (const suitCards of Object.values(bySuit)) {
      const sorted = suitCards.sort((a, b) => a.value - b.value);
      for (let i = 0; i <= sorted.length - 3; i++) {
        if (sorted[i+2].value === sorted[i].value + 2) {
          return sorted.slice(i, i+3);
        }
      }
    }
    return null;
  },
  
  findNaturalEscalier4(cards) {
    const bySuit = cards.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c);
      return acc;
    }, {});
    
    for (const suitCards of Object.values(bySuit)) {
      const sorted = suitCards.sort((a, b) => a.value - b.value);
      for (let i = 0; i <= sorted.length - 4; i++) {
        if (sorted[i+3].value === sorted[i].value + 3) {
          return sorted.slice(i, i+4);
        }
      }
    }
    return null;
  },
  
  findNaturalTri(cards) {
    const byValue = cards.reduce((acc, c) => {
      acc[c.value] = acc[c.value] || [];
      acc[c.value].push(c);
      return acc;
    }, {});
    
    const tri = Object.values(byValue).find(vals => vals.length === 3);
    return tri || null;
  }
};

// FONCTIONS UTILITAIRES
function getCardValue(rank) {
  switch (rank) {
    case 'A': return 1;
    case 'J': return 11;
    case 'Q': return 12;
    case 'K': return 13;
    default: return parseInt(rank, 10);
  }
}

function createDeck() {
  const suits = [
    { suit: 'Coeurs', symbol: '♥', color: 'red' },
    { suit: 'Carreaux', symbol: '♦', color: 'red' },
    { suit: 'Trèfles', symbol: '♣', color: 'black' },
    { suit: 'Piques', symbol: '♠', color: 'black' }
  ];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];

  for (let d = 0; d < 2; d++) {
    suits.forEach(suitObj => {
      ranks.forEach(rank => {
        const value = getCardValue(rank);
        deck.push({
          suit: suitObj.suit,
          symbol: suitObj.symbol,
          color: suitObj.color,
          rank,
          value,
          id: `${rank}${suitObj.symbol}${d}`
        });
      });
    });
  }
  return deck;
}

function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

async function dealCards(roomId, playerIds) {
  let deck = shuffle(createDeck());
  const hands = {};
  playerIds.forEach(pid => {
    hands[pid] = deck.splice(0, 13);
  });
  const revealedJokerCard = deck.shift();
  
  // Déterminer les jokers (même valeur, couleur opposée)
  jokerSet = deck
    .filter(c => c.value === revealedJokerCard.value && c.color !== revealedJokerCard.color)
    .map(c => c.id);

  await Promise.all([
    set(ref(db, `rooms/${roomId}/deck`), deck),
    set(ref(db, `rooms/${roomId}/jokerCard`), revealedJokerCard),
    set(ref(db, `rooms/${roomId}/jokerSet`), jokerSet),
    set(ref(db, `rooms/${roomId}/hands`), hands),
    set(ref(db, `rooms/${roomId}/discard`), {}),
    set(ref(db, `rooms/${roomId}/scores`), {}),
    set(ref(db, `rooms/${roomId}/state`), {
      started: false,
      drawCount: 0,
      lastDiscarder: null,
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false,
      sevenDeclared: false,
      winDeclared: false,
      roundOver: false,
      lastDiscardPlayer: null,
      lastDiscardCard: null,
      gameRound: gameRounds
    }),
    set(ref(db, `rooms/${roomId}/chat`), {})
  ]);
}

 // INITIALISATION DES BOUTONS (module chargé après le DOM)
 const btnCreate = document.getElementById('createRoom');
 const btnJoin   = document.getElementById('joinRoom');
 if (btnCreate) btnCreate.addEventListener('click', createRoom);
 if (btnJoin)   btnJoin.addEventListener('click', joinRoom);

// FONCTIONS PRINCIPALES
function askPseudo() {
  return new Promise(resolve => {
    showPopup(`
      <h3>Entrez votre pseudo</h3>
      <input id="pseudoInput" type="text" placeholder="Votre pseudo" maxlength="15" style="width: 100%; padding: 0.5rem; margin: 1rem 0;" />
      <button id="pseudoSubmit" class="btn btn-primary">Valider</button>
    `);
    document.getElementById('pseudoSubmit').addEventListener('click', () => {
      const val = document.getElementById('pseudoInput').value.trim();
      myPseudo = val || 'Joueur';
      document.querySelector('.modal')?.remove();
      resolve();
    });
  });
}

async function createRoom() {
  await askPseudo();

  const roomCode = 'RAMI' + Math.floor(100 + Math.random() * 900);
  currentRoom = roomCode;
  gameRounds = 0;

  // 🔧 Affichage du code de la partie
  showPopup(`
    <h3>🎉 Salle créée</h3>
    <p>Partage ce code :</p>
    <b style="font-size: 1.5rem; color: #e74c3c;">${roomCode}</b>
    <br><br>
    <button onclick="navigator.clipboard.writeText('${roomCode}')" class="btn btn-secondary">📋 Copier</button>
    <br><br>
    <button class="btn btn-primary modal-close">Continuer</button>
  `);

  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
    hasDeclared7N: false,
    score: 0,
    isSpectator: false,
    sevenNPoints: 0,
    totalScore: 0
  });
  await set(ref(db, `rooms/${roomCode}/creator`), playerId);

  setupListeners(roomCode);
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
}

async function joinRoom() {
  const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!/^RAMI\d{3}$/.test(roomCode)) return showPopup("Code invalide (format: RAMI123)", true);

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return showPopup("Salle introuvable", true);

  await askPseudo();
  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
    hasDeclared7N: false,
    score: 0,
    isSpectator: false,
    sevenNPoints: 0,
    totalScore: 0
  });

  currentRoom = roomCode;
  setupListeners(roomCode);
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
}

function setupListeners(roomCode) {
  listenPlayers(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  listenJokerCard(roomCode);
  listenDiscard(roomCode);
  listenChat(roomCode);

  // 🔧 Écouteurs
  document.getElementById('startGameBtn')?.addEventListener('click', startGame);
  document.getElementById('deck')?.addEventListener('click', drawCard);
  setupHandDisplayOptions();
  enableChat();
  enableDragDrop();
  
  // Nouvel écouteur pour la défausse centrale
  document.getElementById('discard')?.addEventListener('click', () => {
    if (!currentRoom) return;
    pickFromDiscard();
  });

  // ✅ Écouteur pour le bouton "Ranger les cartes"
  document.getElementById('sortHandBtn')?.addEventListener('click', sortHandByFormation);
}
async function startGame() {
  const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
  const players = playersSnap.val() || {};
  const playerIds = Object.keys(players);

  await dealCards(currentRoom, playerIds);
  await set(ref(db, `rooms/${currentRoom}/turn`), playerIds[0]);
  
  // ✅ Toutes les valeurs définies
  await update(ref(db, `rooms/${currentRoom}/state`), { 
    started: true,
    sevenDeclared: false,
    winDeclared: false,
    roundOver: false,
    gameRound: 0,
    drawCount: 0,
    hasDrawnOrPicked: false,
    hasDiscardedThisTurn: false
  });
  
  // ✅ Mise à jour sécurisée de tous les joueurs
  const updates = {};
  playerIds.forEach(id => {
    updates[`${id}/isSpectator`] = false;
    updates[`${id}/hasDeclared7N`] = false;
    updates[`${id}/score`] = 0;
    updates[`${id}/sevenNPoints`] = 0;
    updates[`${id}/totalScore`] = 0;
  });
  
  await update(ref(db, `rooms/${currentRoom}/players`), updates);
  
  document.getElementById('startGameBtn').style.display = 'none';
}

// GESTION DES DÉCLARATIONS
async function declare7Naturel() {
  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (state.sevenDeclared) {
    showPopup("Un 7N a déjà été déclaré.");
    return;
  }

  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  const jokerCards = (await get(ref(db, `rooms/${currentRoom}/jokerSet`))).val() || [];
  
  if (!Rules.has7Naturel(hand, jokerCards)) {
    showPopup("Pas de 7 Naturel valide.");
    return;
  }

  const points = gameRounds === 0 ? 0.5 : 1.0;
  await Promise.all([
    update(ref(db, `rooms/${currentRoom}/players/${playerId}`), {
      hasDeclared7N: true,
      sevenNPoints: points
    }),
    update(ref(db, `rooms/${currentRoom}/state`), {
      sevenDeclared: true,
      sevenDeclarant: playerId
    })
  ]);

  showGlobalPopup(`🎉 ${myPseudo} déclare 7N (+${points} pts)`, []);
}

async function declareWin() {
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  const jokerCards = (await get(ref(db, `rooms/${currentRoom}/jokerSet`))).val() || [];
  
  if (!Rules.validateWinHand(hand, jokerCards, false)) {
    showPopup("Main non valide pour la victoire.", true);
    return;
  }

  const winBonus = gameRounds + 1;
  const sevenNPoints = (await get(ref(db, `rooms/${currentRoom}/players/${playerId}/sevenNPoints`))).val() || 0;
  const totalScore = sevenNPoints + winBonus;

  await update(ref(db, `rooms/${currentRoom}/players/${playerId}`), {
    totalScore,
    winBonus
  });

  await update(ref(db, `rooms/${currentRoom}/state`), {
    winDeclared: true,
    winner: playerId,
    winnerName: myPseudo
  });

  showGlobalPopup(`🏆 ${myPseudo} gagne ! (+${winBonus} pts)`, []);
}

// AFFICHAGE DES CARTES
function renderHand(hand) {
  const handDiv = document.getElementById('hand');
  if (!handDiv) return; // Sécurité si l'élément n'existe pas

  handDiv.innerHTML = '';

  hand.forEach(card => {
    const div = document.createElement('div');
    div.className = `card ${card.color}`;
    div.dataset.cardId = card.id;
    div.dataset.rank = card.rank;
    div.dataset.symbol = card.symbol;
    div.dataset.color = card.color;
    div.dataset.suit = card.suit;
    div.dataset.value = card.value;

    div.innerHTML = `
      <div class="corner top">${card.rank}${card.symbol}</div>
      <div class="suit main">${card.symbol}</div>
    `;

    div.addEventListener('dblclick', () => discardCard(card.id));

    handDiv.appendChild(div);
  });
}
function getPreviousPlayerId(currentPlayerId, allPlayers) {
  const index = allPlayers.indexOf(currentPlayerId);
  const prevIndex = (index - 1 + allPlayers.length) % allPlayers.length;
  return allPlayers[prevIndex];
}
async function renderPreviousDiscard(discards) {
  const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
  const players = Object.keys(playersSnap.val() || {});
  const prevPlayerId = getPreviousPlayerId(playerId, players);
  const prevDiscard = discards[prevPlayerId] || [];
  const lastCard = prevDiscard[prevDiscard.length - 1];

  const container = document.getElementById('previous-discard');
  if (!container) return;

  container.innerHTML = '';

  if (lastCard) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card ${lastCard.color} clickable`;
    cardDiv.dataset.cardId = lastCard.id;
    cardDiv.innerHTML = `
      <div class="corner top">${lastCard.rank}${lastCard.symbol}</div>
      <div class="suit main">${lastCard.symbol}</div>
    `;

    const label = document.createElement('div');
    label.className = 'discard-label';
    label.textContent = `Défausse de ${players[players.indexOf(prevPlayerId)]}`;

    container.appendChild(label);
    container.appendChild(cardDiv);

    cardDiv.addEventListener('click', () => pickFromPreviousDiscard(lastCard, prevPlayerId));
  } else {
    container.innerHTML = '<div class="discard-label">Aucune carte à prendre</div>';
  }
}
async function pickFromPreviousDiscard(card, prevPlayerId) {
  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if (turn !== playerId) return showPopup("Ce n'est pas votre tour.");

  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (state.hasDrawnOrPicked) return showPopup("Vous avez déjà pioché.");

  const discards = (await get(ref(db, `rooms/${currentRoom}/discard`))).val() || {};
  const newPile = discards[prevPlayerId].slice(0, -1);
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/discard/${prevPlayerId}`), newPile),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), [...hand, card]),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDrawnOrPicked: true
    })
  ]);
}
async function sortHandByFormation() {
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  const jokerCards = (await get(ref(db, `rooms/${currentRoom}/jokerSet`))).val() || [];

  // Trie par valeur, puis par couleur
  const sorted = [...hand].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    const suitOrder = ['♠', '♣', '♦', '♥'];
    return suitOrder.indexOf(a.symbol) - suitOrder.indexOf(b.symbol);
  });

  await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), sorted);
}
// LISTENERS
async function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async snap => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo,
      score: o.totalScore || 0
    }));
    renderPlayers(players);

    const creator = (await get(ref(db, `rooms/${room}/creator`))).val();
    const state = (await get(ref(db, `rooms/${room}/state`))).val() || {};
    const btn = document.getElementById('startGameBtn');
    btn.style.display = (creator === playerId && !state.started) ? 'block' : 'none';
  });
}

function renderPlayers(players) {
  const container = document.getElementById('players-container');
  container.innerHTML = '';

  players.forEach((p, index) => {
    const prevIndex = (index - 1 + players.length) % players.length;
    const prevPlayer = players[prevIndex];

    const playerDiv = document.createElement('div');
    playerDiv.className = 'player-slot';
    playerDiv.innerHTML = `
      <div class="player-name">${p.pseudo}</div>
      <div class="discard-slot" data-owner="${prevPlayer.id}"></div>
    `;
    container.appendChild(playerDiv);
  });
}

function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    const hand = snap.val() || [];
    renderHand(hand);
  });
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const myTurn = turn === playerId;
    hasDrawnOrPicked = false;
    hasDiscardedThisTurn = false;

    document.getElementById('status').textContent = myTurn ? "Votre tour" : "En attente...";
    document.getElementById('endTurnBtn').disabled = !myTurn;
  });
}

function listenJokerCard(room) {
  onValue(ref(db, `rooms/${room}/jokerCard`), snap => {
    const card = snap.val();
    const jokerDiv = document.getElementById('joker');
    if (!jokerDiv) return; // Sécurité si l'élément n'existe pas
    
    if (card) {
      jokerDiv.innerHTML = `
        <div class="card ${card.color}">
          <div class="corner top">${card.rank}${card.symbol}</div>
          <div class="suit main">${card.symbol}</div>
        </div>
      `;
    } else {
      jokerDiv.innerHTML = '';
    }
  });
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const discards = snap.val() || {};
    renderPreviousDiscard(discards);
  });
}

function renderDiscardPiles(discards) {
  const discardDiv = document.getElementById('discard');
  if (!discardDiv) return; // Sécurité si l'élément n'existe pas

  // Trouver la dernière carte défaussée
  let lastCard = null;
  for (const pile of Object.values(discards)) {
    if (pile.length > 0) {
      const card = pile[pile.length - 1];
      if (!lastCard || card.timestamp > lastCard.timestamp) {
        lastCard = card;
      }
    }
  }

  // Mettre à jour l'affichage
  if (lastCard) {
    discardDiv.innerHTML = `
      <div class="card ${lastCard.color}" data-card-id="${lastCard.id}">
        <div class="corner top">${lastCard.rank}${lastCard.symbol}</div>
        <div class="suit main">${lastCard.symbol}</div>
      </div>
    `;
  } else {
    discardDiv.innerHTML = '';
  }
}

async function updateActionButtons(hand) {
  const jokerCards = (await get(ref(db, `rooms/${currentRoom}/jokerSet`))).val() || [];
  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  
  document.getElementById('declare7N').disabled = state.sevenDeclared || 
    !Rules.has7Naturel(hand, jokerCards);
  document.getElementById('declareWin').disabled = 
    !Rules.validateWinHand(hand, jokerCards, state.sevenDeclared);
}

// ACTIONS DU JEU
async function drawCard() {
  if (isDrawing) return;
  isDrawing = true;

  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if (turn !== playerId) {
    isDrawing = false;
    return showPopup("Ce n'est pas votre tour.");
  }

  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (state.hasDrawnOrPicked) {
    isDrawing = false;
    showPopup("Vous avez déjà pioché.");
    return;
  }

  const [deck, hand] = await Promise.all([
    get(ref(db, `rooms/${currentRoom}/deck`)),
    get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))
  ]);
  const deckCards = deck.val() || [];
  if (deckCards.length === 0) {
    isDrawing = false;
    return showPopup("Deck vide.");
  }

  const card = deckCards.shift();
  const newHand = [...(hand.val() || []), card];

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/deck`), deckCards),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), newHand),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDrawnOrPicked: true
    })
  ]);

  isDrawing = false;
}

async function discardCard(cardId) {
  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if (turn !== playerId) return showPopup("Ce n'est pas votre tour.");

  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (!state.hasDrawnOrPicked) {
    showPopup("Piochez d'abord.");
    return;
  }
  if (state.hasDiscardedThisTurn) {
    showPopup("Vous avez déjà défaussé.");
    return;
  }

  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return;

  const [card] = hand.splice(cardIndex, 1);
  const discard = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
  discard.push(card);

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), discard),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDiscardedThisTurn: true,
      lastDiscardPlayer: playerId,
      lastDiscardCard: card
    })
  ]);

  // ✅ Passage automatique au joueur suivant
  const players = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {});
  const nextIndex = (players.indexOf(playerId) + 1) % players.length;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/turn`), players[nextIndex]),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false
    })
  ]);

  renderHand(hand);
}

async function pickFromDiscard() {
  if (isDrawing) return;
  isDrawing = true;

  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if (turn !== playerId) {
    isDrawing = false;
    return showPopup("Ce n'est pas votre tour.");
  }

  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (state.hasDrawnOrPicked) {
    isDrawing = false;
    return showPopup("Vous avez déjà pioché.");
  }

  const discRef = ref(db, `rooms/${currentRoom}/discard`);
  const snap = await get(discRef);
  const discards = snap.val() || {};

  let ownerId = null, card = null;
  for (let [id, pile] of Object.entries(discards)) {
    if (pile.length && (!card || pile[pile.length - 1].timestamp > card.timestamp)) {
      ownerId = id;
      card = pile[pile.length - 1];
    }
  }

  if (!card) {
    isDrawing = false;
    return showPopup("Rien à piocher dans la défausse.");
  }

  const newPile = discards[ownerId].slice(0, -1);
  const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), newPile),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), [...hand, card]),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDrawnOrPicked: true
    })
  ]);

  isDrawing = false;
}

async function endTurn() {
  const turn = (await get(ref(db, `rooms/${currentRoom}/turn`))).val();
  if (turn !== playerId) return;

  const state = (await get(ref(db, `rooms/${currentRoom}/state`))).val() || {};
  if (!state.hasDrawnOrPicked || !state.hasDiscardedThisTurn) {
    showPopup("Terminez votre tour (piocher + défausser).");
    return;
  }

  const players = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {});
  const nextIndex = (players.indexOf(playerId) + 1) % players.length;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/turn`), players[nextIndex]),
    update(ref(db, `rooms/${currentRoom}/state`), {
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false,
      drawCount: 0
    })
  ]);
}

// CHAT
function enableChat() {
  const chatContainer = document.getElementById('chat-container');
  if (!chatContainer) return; // Sécurité si l'élément n'existe pas
  
  const chatHeader = chatContainer.querySelector('.chat-header');
  if (!chatHeader) return;

  // 🔧 Ouvre le chat par défaut
  chatContainer.classList.remove('collapsed');
  const arrow = chatHeader.querySelector('span');
  if (arrow) arrow.textContent = '▼';

  // 🔧 Gestion du clic sur l’en-tête
  chatHeader.addEventListener('click', () => {
    chatContainer.classList.toggle('collapsed');
    const arrow = chatHeader.querySelector('span');
    if (arrow) {
      arrow.textContent = chatContainer.classList.contains('collapsed') ? '▲' : '▼';
    }
  });

  // 🔧 Envoi des messages
  document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('chat-input')?.value.trim();
    if (!message) return;

    await set(ref(db, `rooms/${currentRoom}/chat/${Date.now()}`), {
      sender: playerId,
      pseudo: myPseudo,
      message,
      timestamp: Date.now()
    });
    document.getElementById('chat-input').value = '';
  });
}

function listenChat(room) {
  onValue(ref(db, `rooms/${room}/chat`), (snapshot) => {
    const messages = snapshot.val() || {};
    const messagesArray = Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => a.timestamp - b.timestamp);

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return; // Sécurité si l'élément n'existe pas
    
    chatMessages.innerHTML = '';
    messagesArray.forEach(msg => {
      const div = document.createElement('div');
      div.className = `message ${msg.sender === playerId ? 'me' : 'other'}`;
      div.innerHTML = `<b>${msg.pseudo}:</b> ${msg.message}`;
      chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// UTILITAIRES
function setupHandDisplayOptions() {
  const buttons = document.querySelectorAll('.hand-display-btn');
  if (!buttons.length) return;
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const displayType = btn.getAttribute('data-display');
      if (displayType) {
        handDisplayType = displayType;
        const hand = document.getElementById('hand');
        if (hand) {
          hand.className = `player-hand ${displayType}`;
        }
      }
    });
  });
}

function enableDragDrop() {
  const handElement = document.getElementById('hand');
  if (!handElement) return;
  
  new Sortable(handElement, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      const hand = Array.from(handElement.children).map(el => ({
        id: el.dataset.cardId,
        rank: el.dataset.rank,
        symbol: el.dataset.symbol,
        color: el.dataset.color,
        suit: el.dataset.suit,
        value: parseInt(el.dataset.value, 10)
      }));
      await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);
    }
  });
}

function showPopup(content, isError = false) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;
  modal.innerHTML = `
    <div class="modal-content" style="background: white; padding: 2rem; border-radius: 12px; max-width: 400px; text-align: center;">
      ${content}
      <button class="modal-close" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #3498db; color: white; border: none; border-radius: 6px;">OK</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
}

function showGlobalPopup(message, cards = null) {
  const overlay = document.createElement('div');
  overlay.className = 'global-popup-overlay';
  overlay.innerHTML = `
    <div class="global-popup-box">
      <div class="notif-message">${message}</div>
      ${cards ? '<div class="notif-cards">' + cards.map(c => `
        <div class="card ${c.color}">
          <div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>
          <div class="suit main">${c.symbol}</div>
        </div>
      `).join('') + '</div>' : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 4000);
  overlay.addEventListener('click', () => overlay.remove());
}

window.addEventListener('resize', () => {
  if (handDisplayType === 'semi-circle') {
    setTimeout(arrangeCardsInSemiCircle, 100);
  }
});

// Gestion du bouton "Terminer le tour"
document.getElementById('endTurnBtn')?.addEventListener('click', endTurn);

// Gestion des déclarations
document.getElementById('declare7N')?.addEventListener('click', declare7Naturel);
document.getElementById('declareWin')?.addEventListener('click', declareWin);
