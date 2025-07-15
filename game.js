import { db, ref, push, onChildAdded, set, update, get, onValue } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

const myPseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let hasDrawnOrPicked    = false;
let hasDiscardedThisTurn = false;

const Rules = {
  isQuadri(hand) {
    const vals = hand.map(c => c.value);
    const counts = {};
    vals.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.values(counts).some(count => count >= 4);
  },

  isTri(hand) {
    const vals = hand.map(c => c.value);
    const counts = {};
    vals.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.values(counts).some(count => count >= 3);
  },

  isEscalier(hand, len) {
    const bySuit = hand.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c.value);
      return acc;
    }, {});

    for (let suit in bySuit) {
      const vals = [...new Set(bySuit[suit])].sort((a, b) => a - b);
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

  isTriJoker(hand, jokerSet, requireNatural) {
    if (this.isTri(hand.filter(c => !jokerSet.includes(c.id))) && !requireNatural) return true;
    if (!requireNatural) return false;

    const naturalCards = hand.filter(c => !jokerSet.includes(c.id));
    const handJokersCount = hand.filter(c => jokerSet.includes(c.id)).length;

    if (handJokersCount === 0) {
      return this.isTri(naturalCards);
    }

    const counts = {};
    naturalCards.forEach(c => {
      counts[c.value] = (counts[c.value] || 0) + 1;
    });

    for (let value in counts) {
      if (counts[value] >= 2 && handJokersCount >= 1) {
        return true;
      }
    }
    return false;
  },

  isEscalierJoker(hand, len, jokerSet, requireNatural) {
    if (this.isEscalier(hand.filter(c => !jokerSet.includes(c.id)), len) && !requireNatural) return true;
    if (!requireNatural) return false;

    const naturalCards = hand.filter(c => !jokerSet.includes(c.id));
    const handJokersCount = hand.filter(c => jokerSet.includes(c.id)).length;

    if (handJokersCount === 0) {
      return this.isEscalier(naturalCards, len);
    }

    const bySuit = naturalCards.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c.value);
      return acc;
    }, {});

    for (let suit in bySuit) {
      const vals = [...new Set(bySuit[suit])].sort((a, b) => a - b);
      for (let i = 0; i < vals.length; i++) {
        let currentSequenceLength = 1;
        let jokersUsed = 0;
        let currentVal = vals[i];

        for (let j = i + 1; j < vals.length && currentSequenceLength < len; j++) {
          if (vals[j] === currentVal + 1) {
            currentSequenceLength++;
            currentVal++;
          } else if (vals[j] > currentVal + 1) {
            const gap = vals[j] - (currentVal + 1);
            if (jokersUsed + gap <= handJokersCount) {
              jokersUsed += gap;
              currentSequenceLength += gap + 1;
              currentVal = vals[j];
            } else {
              break;
            }
          }
        }

        if (currentSequenceLength < len) {
          const needed = len - currentSequenceLength;
          if (jokersUsed + needed <= handJokersCount) {
            currentSequenceLength += needed;
          }
        }

        if (currentSequenceLength >= len) {
          return true;
        }
      }
    }
    return false;
  },

  has7Naturel(hand) {
    return (this.isQuadri(hand) && this.isEscalier(hand, 3)) ||
           (this.isEscalier(hand, 4) && this.isTri(hand));
  },

  validateWinHandWithJoker(hand, jokerSet) {
    const has7 = this.has7Naturel(hand);
    const condition1 = this.isQuadri(hand) && this.isEscalierJoker(hand, 3, jokerSet, has7);
    const condition2 = this.isEscalierJoker(hand, 4, jokerSet, has7) && this.isTriJoker(hand, jokerSet, has7);

    if (condition1 || condition2) {
      const extractedCombos = extractWinCombosJoker(hand, jokerSet);
      const usedCardIds = new Set(extractedCombos.flat().map(c => c.id));
      return usedCardIds.size === hand.length;
    }

    return false;
  }
};

function extractSevenCombo(hand) {
  const combos = [];

  for (let v = 1; v <= 13; v++) {
    const sameVal = hand.filter(c => c.value === v);
    if (sameVal.length >= 4) {
      combos.push(sameVal.slice(0, 4));
    }
  }

  const bySuit = hand.reduce((acc, c) => {
    acc[c.suit] = acc[c.suit] || [];
    acc[c.suit].push(c.value);
    return acc;
  }, {});

  for (let suit in bySuit) {
    const vals = [...new Set(bySuit[suit])].sort((a, b) => a - b);
    for (let i = 0; i <= vals.length - 3; i++) {
      if (vals[i + 1] === vals[i] + 1 && vals[i + 2] === vals[i] + 2) {
        combos.push(vals.slice(i, i + 3).map(v => hand.find(c => c.value === v && c.suit === suit)));
      }
    }
  }

  if (Rules.isQuadri(hand) && Rules.isEscalier(hand, 3)) {
    const quadri = combos.find(c => c.length === 4);
    const escalier3 = combos.find(c => c.length === 3);
    if (quadri && escalier3) {
      const allCards = [...quadri, ...escalier3];
      if (new Set(allCards.map(c => c.id)).size === 7) {
        return allCards;
      }
    }
  }

  if (Rules.isEscalier(hand, 4) && Rules.isTri(hand)) {
    const escalier4 = combos.find(c => c.length === 4);
    const tri = combos.find(c => c.length === 3);
    if (escalier4 && tri) {
      const allCards = [...escalier4, ...tri];
      if (new Set(allCards.map(c => c.id)).size === 7) {
        return allCards;
      }
    }
  }

  return [];
}

function extractWinCombosJoker(hand, jokerSet) {
  const has7 = Rules.has7Naturel(hand);
  let availableCards = [...hand];
  let availableJokers = availableCards.filter(c => jokerSet.includes(c.id));
  let nonJokers = availableCards.filter(c => !jokerSet.includes(c.id));
  const combos = [];

  const findAndRemoveCards = (sourceArray, predicate, count) => {
    const foundCards = [];
    let tempArray = [...sourceArray];
    for (let i = 0; i < tempArray.length && foundCards.length < count; i++) {
      if (predicate(tempArray[i])) {
        foundCards.push(tempArray[i]);
        tempArray.splice(i, 1);
        i--;
      }
    }
    if (foundCards.length === count) {
      return { found: foundCards, remaining: tempArray };
    }
    return { found: [], remaining: sourceArray };
  };

  if (has7) {
    const sevenCombo = extractSevenCombo(hand);
    if (sevenCombo.length === 7) {
      combos.push(sevenCombo);
      availableCards = availableCards.filter(c => !sevenCombo.map(sc => sc.id).includes(c.id));
      availableJokers = availableCards.filter(c => jokerSet.includes(c.id));
      nonJokers = availableCards.filter(c => !jokerSet.includes(c.id));
    }
  }

  for (let v = 1; v <= 13; v++) {
    const { found, remaining } = findAndRemoveCards(nonJokers, c => c.value === v, 4);
    if (found.length === 4) {
      combos.push(found);
      nonJokers = remaining;
    }
  }

  for (let len of [4, 3]) {
    const bySuit = nonJokers.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c);
      return acc;
    }, {});

    for (let suit in bySuit) {
      const cardsInSuit = bySuit[suit].sort((a, b) => a.value - b.value);
      for (let i = 0; i <= cardsInSuit.length - len; i++) {
        let sequence = [cardsInSuit[i]];
        for (let j = 1; j < len; j++) {
          if (cardsInSuit[i + j] && cardsInSuit[i + j].value === sequence[sequence.length - 1].value + 1) {
            sequence.push(cardsInSuit[i + j]);
          } else {
            sequence = [];
            break;
          }
        }
        if (sequence.length === len) {
          combos.push(sequence);
          nonJokers = nonJokers.filter(c => !sequence.map(sc => sc.id).includes(c.id));
          break;
        }
      }
    }
  }

  for (let v = 1; v <= 13; v++) {
    const { found, remaining } = findAndRemoveCards(nonJokers, c => c.value === v, 3);
    if (found.length === 3) {
      combos.push(found);
      nonJokers = remaining;
    }
  }

  if (has7 || availableJokers.length > 0) {
    const nonJokersForTri = [...nonJokers];
    for (let v = 1; v <= 13; v++) {
      const matches = nonJokersForTri.filter(c => c.value === v);
      if (matches.length === 2 && availableJokers.length > 0) {
        const joker = availableJokers.shift();
        combos.push([...matches, joker]);
        nonJokers = nonJokers.filter(c => !matches.includes(c));
      }
    }
  }

  if (has7 || availableJokers.length > 0) {
    const nonJokersForEsc = [...nonJokers];
    const bySuit = nonJokersForEsc.reduce((acc, c) => {
      acc[c.suit] = acc[c.suit] || [];
      acc[c.suit].push(c);
      return acc;
    }, {});

    for (let suit in bySuit) {
      const cardsInSuit = bySuit[suit].sort((a, b) => a.value - b.value);
      for (let i = 0; i < cardsInSuit.length; i++) {
        for (let j = 0; j < cardsInSuit.length; j++) {
          if (i === j) continue;
          const card1 = cardsInSuit[i];
          const card2 = cardsInSuit[j];
          if (Math.abs(card1.value - card2.value) === 2 && availableJokers.length > 0) {
            const missingValue = Math.min(card1.value, card2.value) + 1;
            if (!nonJokers.some(c => c.suit === suit && c.value === missingValue)) {
              const joker = availableJokers.shift();
              const newCombo = [card1, { value: missingValue, suit: suit, id: joker.id, rank: 'Joker', symbol: joker.symbol, color: joker.color }, card2].sort((a,b) => a.value - b.value);
              combos.push(newCombo);
              nonJokers = nonJokers.filter(c => c.id !== card1.id && c.id !== card2.id);
              break;
            }
          }
        }
      }
    }
  }

  const allUsedCardIds = new Set(combos.flat().map(c => c.id));
  if (allUsedCardIds.size !== hand.length) {
    return [];
  }

  return combos;
}

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

  // SUPPRIMER LES JOKERS ORIGINAUX
  // Pas de jokers dans ce jeu

  if (deck.length !== 104) {
    console.error(`Erreur createDeck : attendu 104 cartes, trouvé ${deck.length}`);
  }
  return deck;
}
function shuffle(array) {
  let currentIndex = array.length, randomIndex;

  // Tant qu’il reste des éléments à mélanger
  while (currentIndex !== 0) {
    // Prend un élément au hasard
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // Et l’échange avec l’élément actuel
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }

  return array;
}

async function dealCards(roomId, playerIds) {
  let deck = shuffle(createDeck());

  const actualJokerCards = deck.filter(c => c.rank === 'Joker');
  const jokerSet = actualJokerCards.map(c => c.id);

  const tempDeck = [...deck];
  const initialJokerCard = tempDeck.splice(0, 1)[0];

  const temporaryJokerIds = deck.filter(c => c.value === initialJokerCard.value && c.rank !== 'Joker').map(c => c.id);
  const allJokerIds = [...jokerSet, ...temporaryJokerIds];

  const hands = {};
  playerIds.forEach(pid => {
    hands[pid] = deck.splice(0, 13);
  });
  const revealedJokerCard = deck.shift();

  await Promise.all([
    set(ref(db, `rooms/${roomId}/deck`), deck),
    set(ref(db, `rooms/${roomId}/jokerCard`), revealedJokerCard),
    set(ref(db, `rooms/${roomId}/jokerSet`), { jokerSet: allJokerIds }),
    set(ref(db, `rooms/${roomId}/hands`), hands),
    set(ref(db, `rooms/${roomId}/discard`), {}),
    set(ref(db, `rooms/${roomId}/state`), {
      started: false,
      drawCount: 0,
      lastDiscarder: null,
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false,
      sevenPlayed: false,
      winDeclared: false,
      sevenCombo: null,
      winCombos: null,
      roundOver: false
    }),
    set(ref(db, `rooms/${roomId}/chat`), {})
  ]);
}

const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const playersDiv = document.getElementById('players');
const playerHandDiv = document.getElementById('hand');
const jokerDiv = document.getElementById('joker');
const declare7NBtn = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const menuDiv = document.getElementById('menu');
const gameDiv = document.getElementById('game');
const toggleChatBtn = document.getElementById('toggleChat');
const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const endTurnBtn = document.getElementById('endTurnBtn');
const startGameBtn = document.getElementById('startGameBtn'); // Nouveau bouton

const remind7NBtn = document.getElementById('remind7NBtn');
if (remind7NBtn) {
  remind7NBtn.addEventListener('click', async () => {
    // On récupère la main et on extrait le combo
    const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    const sevenCombo = extractSevenCombo(hand);
    if (sevenCombo.length === 7) {
      // Envoi d'une notif de rappel (reminder: true)
      await sendNotification('7N', true);
    } else {
      alert("Aucune combinaison de 7 cartes trouvée.");
    }
  });
}


const deckPile = document.getElementById('deck');
deckPile.classList.add('clickable');
deckPile.addEventListener('dblclick', drawCard);

if (endTurnBtn) {
  endTurnBtn.addEventListener('click', endTurn);
} else {
  console.warn("Le bouton 'endTurnBtn' n'a pas été trouvé dans le DOM. Le tour ne pourra pas être terminé manuellement.");
}

function showJoker(jokerCard) {
  if (jokerCard?.rank) {
    jokerDiv.innerHTML = `<div class="card ${jokerCard.color}">JOKER: ${jokerCard.rank}${jokerCard.symbol}</div>`;
  } else {
    jokerDiv.innerHTML = '';
  }
}
function listenJokerCard(room) {
  onValue(ref(db, `rooms/${room}/jokerCard`), snap => {
    showJoker(snap.val());
  });
}
function showPopup(content) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      ${content}
      <button class="modal-close">Fermer</button>
    </div>`;
  document.body.append(modal);

  // Déclarer trapFocus à un niveau supérieur
  let trapFocus = null;

  // Gestion de la touche Échap
  const keyHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  
  document.addEventListener('keydown', keyHandler);
  
  // Piégeage du focus
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  
  if (focusable.length > 0) {
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];
    
    firstFocusable.focus();
    
    // Assigner la fonction à la variable trapFocus
    trapFocus = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };
    
    modal.addEventListener('keydown', trapFocus);
  }

  // Fonction de fermeture
  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', keyHandler);
    
    // Retirer trapFocus seulement si elle a été définie
    if (trapFocus) {
      modal.removeEventListener('keydown', trapFocus);
    }
  };
  
  modal.querySelector('.modal-close').onclick = closeModal;
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
function listenNotifications(room) {
  const notifRef = ref(db, `rooms/${room}/notifications`);
  onChildAdded(notifRef, snap => {
    const notif = snap.val();
    if (!notif) return;

    if (notif.type === '7N') {
      const msg = notif.reminder
        ? `📌 ${notif.pseudo} réaffiche son 7 Naturel :`
        : `🎉 ${notif.pseudo} a déclaré un 7 Naturel !`;
      showGlobalPopup(msg, notif.combo);
    } else if (notif.type === 'win') {
      showGlobalPopup(`🏆 ${notif.pseudo} a déclaré la victoire !`);
    }
  });
}


function showGlobalPopup(message, cards = null) {
  const overlay = document.createElement('div');
  overlay.className = 'global-popup-overlay';

  const box = document.createElement('div');
  box.className = 'global-popup-box';

  box.innerHTML = `<div class="notif-message">${message}</div>`;

  // Ajouter cartes si fournies
  if (cards && Array.isArray(cards)) {
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'notif-cards';
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = `card ${card.color}`;
      cardEl.innerHTML = `
        <div class="corner top"><span>${card.rank}</span><span>${card.symbol}</span></div>
        <div class="suit main">${card.symbol}</div>
        <div class="corner bottom"><span>${card.rank}</span><span>${card.symbol}</span></div>
      `;
      cardsDiv.appendChild(cardEl);
    });
    box.appendChild(cardsDiv);
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Auto-disparition après 3s
  setTimeout(() => overlay.remove(), 3000);
  overlay.addEventListener('click', () => overlay.remove());
}

function enableDragDrop() {
  new Sortable(playerHandDiv, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      const hand = Array.from(playerHandDiv.children).map(el => {
        return {
          id: el.dataset.cardId,
          rank: el.dataset.rank,
          symbol: el.dataset.symbol,
          color: el.dataset.color,
          suit: el.dataset.suit,
          value: parseInt(el.dataset.value, 10)
        };
      });
      await set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand);
    }
  });
}

function renderPlayers(players) {
  playersDiv.innerHTML = '';
  players.forEach((p, index) => {
    const badge = document.createElement('div');
    badge.className = `player-info ${p.id === playerId ? 'active' : ''}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo} ${p.id === playerId ? '(Vous)' : ''}</div>
      <div class="player-hand-count" id="hand-count-${p.id}">${p.id === playerId ? '13' : '?'} cartes</div>
    `;
    playersDiv.append(badge);
  });
}
/**
 * Positionne chaque pile de défausse en cercle autour du centre.
 * @param {Array} players — liste des pseudos ou IDs des joueurs
 * @param {Object} discards — objet { playerId: [cartes…], … }
 */
function renderDiscardPiles(players, discards) {
  // centre = 50% / 50%, R = 40% du container (ajuste selon besoin)
  players.forEach((playerId, index) => {
    const angleDeg = (index / players.length) * 360;
    const angleRad = angleDeg * Math.PI / 180;
    const x = 50 + 40 * Math.cos(angleRad);
    const y = 50 + 40 * Math.sin(angleRad);

    // on récupère (ou crée) la div de défausse pour ce joueur
    let pileDiv = document.getElementById(`discard-${playerId}`);
    if (!pileDiv) {
      pileDiv = document.createElement('div');
      pileDiv.id = `discard-${playerId}`;
      pileDiv.classList.add('player-discard');
      document.getElementById('players-discard-circle').appendChild(pileDiv);
    }
    pileDiv.style.position    = 'absolute';
    pileDiv.style.left        = `${x}%`;
    pileDiv.style.top         = `${y}%`;
    pileDiv.innerHTML = `
      <div class="player-name">${playerId}</div>
      <div class="discard-cards">
        ${ (discards[playerId] || []).map(c => `<div class="card" data-card-id="${c.id}"></div>`).join('') }
      </div>
    `;
  });
}

// Ajouter cette fonction pour écouter les comptes de cartes
function listenHandCounts(room) {
  onValue(ref(db, `rooms/${room}/hands`), snap => {
    const hands = snap.val() || {};
    Object.keys(hands).forEach(pid => {
      const el = document.getElementById(`hand-count-${pid}`);
      if (el) {
        el.textContent = `${hands[pid]?.length || 0} cartes`;
      }
    });
  });
}
function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), async snap => {
    const discards = snap.val() || {};
    const discardArea = document.getElementById('global-discard');
    discardArea.innerHTML = '';
    
    // Ajout du label une seule fois
    if (!discardArea.querySelector('.discard-label')) {
      const discardLabel = document.createElement('div');
      discardLabel.className = 'discard-label';
      discardLabel.textContent = 'Défausses';
      discardArea.appendChild(discardLabel);
    }

    const playersSnap = await get(ref(db, `rooms/${room}/players`));
    const players = playersSnap.val() || {};

    Object.entries(discards).forEach(([ownerId, pile]) => {
      if (!pile || pile.length === 0) return;

      const playerDiscard = document.createElement('div');
      playerDiscard.className = 'player-discard';
      playerDiscard.id = `discard-${ownerId}`;

      const playerName = document.createElement('div');
      playerName.className = 'player-name';
      playerName.textContent = players[ownerId]?.pseudo || `Joueur ${ownerId.substring(7)}`;

      const cardContainer = document.createElement('div');
      cardContainer.className = 'discard-cards';

      const topCard = pile[pile.length - 1];
      const cardEl = document.createElement('div');
      cardEl.className = `card ${topCard.color}`;
      cardEl.dataset.cardId = topCard.id;
      cardEl.dataset.ownerId = ownerId;
      cardEl.innerHTML = `
        <div class="corner top"><span>${topCard.rank}</span><span>${topCard.symbol}</span></div>
        <div class="suit main">${topCard.symbol}</div>
        <div class="corner bottom"><span>${topCard.rank}</span><span>${topCard.symbol}</span></div>
      `;

      if (ownerId !== playerId) {
        cardEl.style.cursor = 'pointer';
        cardEl.addEventListener('dblclick', async () => {
          const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
          if (turnSnap.val() === playerId) {
            const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
            if (stateSnap.val()?.lastDiscarder === ownerId) {
              takeDiscardedCard(ownerId);
            } else {
              alert("Vous ne pouvez prendre qu'une carte de la défausse du joueur précédent.");
            }
          } else {
            alert("Ce n'est pas votre tour.");
          }
        });
      }

      cardContainer.appendChild(cardEl);
      playerDiscard.appendChild(playerName);
      playerDiscard.appendChild(cardContainer);
      discardArea.appendChild(playerDiscard);
    });
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async (snap) => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo
    }));
    
    // Vérifier si la partie a commencé
    const stateSnap = await get(ref(db, `rooms/${room}/state`));
    const gameStarted = stateSnap.val()?.started;
    
    renderPlayers(players);
    
    // Afficher le bouton "Démarrer" uniquement au créateur si la partie n'a pas commencé
    if (startGameBtn) {
      const creatorSnap = await get(ref(db, `rooms/${room}/creator`));
      const creatorId = creatorSnap.val();
      
      if (creatorId === playerId && !gameStarted) {
        startGameBtn.style.display = 'block';
      } else {
        startGameBtn.style.display = 'none';
      }
    }
  });
}

function listenScores(room) {
  onValue(ref(db, `rooms/${room}/scores`), snap => {
    const scores = snap.val() || {};
    Object.entries(scores).forEach(([id, score]) => {
      const el = document.getElementById(`score-${id}`);
      if (el) {
        el.textContent = `Score: ${score}`;
      }
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
// 1. Fonction pour émettre la notification (déclaration ou rappel)
async function sendNotification(type, isReminder = false) {
  const notifRef = ref(db, `rooms/${currentRoom}/notifications`);

  let payload = {
    type,                   // '7N' ou 'win'
    playerId,               
    pseudo: myPseudo,       
    timestamp: Date.now(),
    reminder: isReminder    // true si c'est un rappel
  };

  // S’il s’agit d’un vrai 7N (pas un rappel), inclure les 7 cartes
  if (type === '7N' && !isReminder) {
    const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    const sevenCombo = extractSevenCombo(hand);
    if (sevenCombo.length === 7) {
      payload.combo = sevenCombo;
    }
  }

  return push(notifRef, payload);
}
async function updateActionButtons(hand) {
  const jokerSnap = await get(ref(db, `rooms/${currentRoom}/jokerSet`));
  const jokerSet  = jokerSnap.val()?.jokerSet || [];

  declare7NBtn.disabled   = !Rules.has7Naturel(hand);
  declareWinBtn.disabled  = !Rules.validateWinHandWithJoker(hand, jokerSet);
}
async function terminateGame(winnerId) {
  const winnerPseudoSnap = await get(ref(db, `rooms/${currentRoom}/players/${winnerId}/pseudo`));
  const winnerPseudo = winnerPseudoSnap.val() || 'Joueur Inconnu';

  const winnerHandSnap = await get(ref(db, `rooms/${currentRoom}/hands/${winnerId}`));
  const winnerHand = winnerHandSnap.val() || [];

  const jokerSetSnap = await get(ref(db, `rooms/${currentRoom}/jokerSet`));
  const jokerSet = jokerSetSnap.val()?.jokerSet || [];

  const winCombos = extractWinCombosJoker(winnerHand, jokerSet);
  const has7 = Rules.has7Naturel(winnerHand);

  await update(ref(db, `rooms/${currentRoom}/state`), {
    roundOver: true,
    winDeclared: true,
    winnerId: winnerId,
    winnerPseudo: winnerPseudo,
    winCombos: winCombos,
    has7Naturel: has7
  });
}

async function checkEndGame() {
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const stateSnap = await get(stateRef);
  const state = stateSnap.val() || {};

  // 1) Si un vainqueur vient d’être déclaré, on ne fait rien
  if (state.winDeclared) return;

  // 2) Si le deck est vide sans victoire
  const deckSnap = await get(ref(db, `rooms/${currentRoom}/deck`));
  const deck = deckSnap.val() || [];
  if (deck.length === 0) {
    // Récupérer toutes les mains
    const handsSnap = await get(ref(db, `rooms/${currentRoom}/hands`));
    const allHands = handsSnap.val() || {};

    // Vérifier si quelqu’un a un 7 naturel
    const someoneHas7 = Object.values(allHands).some(hand =>
      Rules.has7Naturel(hand)
    );

    if (someoneHas7) {
      // relancer une nouvelle manche immédiatement
      await newRound('♻️ Deck vide – 7 Naturel détecté, nouvelle manche');
    } else {
      // on peut choisir de stopper vraiment la partie
      await update(stateRef, { roundOver: true, reason: 'deck_empty_no_7' });
    }
  }
}

async function newRound(message) {
  const playerIds = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {});
  await dealCards(currentRoom, playerIds);
  await update(ref(db, `rooms/${currentRoom}/state`), {
    roundOver: false,
    started: true,
    sevenPlayed: false,
    winDeclared: false,
    sevenCombo: null,
    winCombos: null,
    reason: null,
    drawCount: 0,
    lastDiscarder: null
  });
  showPopup(`🔄 ${message}`);
}

function renderHand(hand) {
  playerHandDiv.innerHTML = '';
  hand.forEach(c => {
    const div = document.createElement('div');
    div.className = `card ${c.color}`;
    div.dataset.cardId = c.id;
    div.dataset.rank = c.rank;
    div.dataset.symbol = c.symbol;
    div.dataset.color = c.color;
    div.dataset.suit = c.suit;
    div.dataset.value = c.value;
    // Affichage des faces de carte avec coins et symbole
    div.innerHTML = `
      <div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>
      <div class="suit main">${c.symbol}</div>
      <div class="corner bottom"><span>${c.rank}</span><span>${c.symbol}</span></div>
    `;
    playerHandDiv.append(div);
  });
  enableDragDrop();
}

// ─────────── Fonction pour piocher une carte ───────────
async function drawCard() {
  if (!currentRoom) return;

  // 1) Vérifie que c’est votre tour
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  // 2) Récupère et initialise state depuis Firebase
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || { drawCount: 0, hasDrawnOrPicked: false };

  // 3) Empêche de piocher plus d’une fois
  if (state.drawCount >= 1 || state.hasDrawnOrPicked) {
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');
  }

  // 4) Récupère deck, main et jokers simultanément
  const [deckSnap, handSnap, jokerSetSnap] = await Promise.all([
    get(ref(db, `rooms/${currentRoom}/deck`)),
    get(ref(db, `rooms/${currentRoom}/hands/${playerId}`)),
    get(ref(db, `rooms/${currentRoom}/jokerSet`))
  ]);
  const deck = deckSnap.val() || [];
  const hand = handSnap.val() || [];
  const jokerSet = jokerSetSnap.val()?.jokerSet || [];

  if (!deck.length) {
    return alert('Deck vide.');
  }

  // 5) Pioche la carte et l’ajoute à la main
  const card = deck.shift();
  hand.push(card);

  // 6) Si un joker apparaît dans la main alors que le deck est presque vide, on le défausse automatiquement
  const playersCount = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {}).length;
  if (deck.length < playersCount) {
    const idx = hand.findIndex(c => jokerSet.includes(c.id));
    if (idx !== -1) {
      const [jok] = hand.splice(idx, 1);
      const pileRef = ref(db, `rooms/${currentRoom}/discard/${playerId}`);
      const pile = (await get(pileRef)).val() || [];
      pile.push(jok);
      await set(pileRef, pile);
      showPopup('Joker défaussé automatiquement.');
    }
  }

  // 7) Met à jour state et drapeaux global/local
  state.drawCount++;
  state.hasDrawnOrPicked = true;
  hasDrawnOrPicked = true;  // flag local

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/deck`), deck),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    update(stateRef, {
      drawCount: state.drawCount,
      hasDrawnOrPicked: state.hasDrawnOrPicked,
      started: true
    })
  ]);
}

async function takeDiscardedCard(ownerId) {
  // 1) Récupère d'abord le state pour connaître lastDiscarder
  const stateRef = ref(db, `rooms/${currentRoom}/state`); // Obtenir la référence ici
  const stateSnap = await get(stateRef);
  let state = stateSnap.val() || {}; // Utiliser 'let' pour pouvoir modifier l'objet state

  // 2) Seule la défausse du joueur précédent peut être piochée
  if (ownerId !== state.lastDiscarder) {
    return alert("Vous ne pouvez prendre qu'une carte de la défausse du joueur précédent.");
  }

  // 3) Vérifie que c'est votre tour
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  // Vérifie si le joueur a déjà pioché/pris une carte
  if (state.drawCount >= 1) { // || state.hasDrawnOrPicked) { // Optionnel: vérifier le flag aussi ici
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');
  }

  // 4) Récupère la pile de défausse du propriétaire
  const pileSnap = await get(ref(db, `rooms/${currentRoom}/discard/${ownerId}`));
  const pile = pileSnap.val() || [];
  if (pile.length === 0) {
    return alert("La défausse est vide.");
  }

  // 5) Déplace la carte du sommet vers la main
  const card = pile.pop();
  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  hand.push(card);

  // Mettre à jour les drapeaux et le compteur de pioches dans l'objet state
  state.hasDrawnOrPicked = true;
  state.drawCount++; // IMPORTANT: Incrémenter drawCount pour la cohérence

  // 6) Mise à jour atomique
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), pile),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    // Mettre à jour les drapeaux dans Firebase
    update(stateRef, { hasDrawnOrPicked: state.hasDrawnOrPicked, drawCount: state.drawCount })
  ]);
}
// ─────────── Fonction pour défausser une carte ───────────
async function discardCard(cardId) {
  // 1) Vérifie que c’est votre tour
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  // 2) Récupère et initialise state depuis Firebase
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || { hasDrawnOrPicked: false, hasDiscardedThisTurn: false };

  // 3) Doit avoir pioché ou pris une carte avant de défausser
  if (!state.hasDrawnOrPicked) {
    return alert("Vous devez piocher ou prendre une carte avant de défausser.");
  }

  // 4) Empêche la défausse multiple
  if (state.hasDiscardedThisTurn) {
    return alert("Vous avez déjà défaussé une carte ce tour.");
  }

  // 5) Retire la carte de la main
  const handRef = ref(db, `rooms/${currentRoom}/hands/${playerId}`);
  const handSnap = await get(handRef);
  const hand = handSnap.val() || [];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    return alert("Erreur : Cette carte n'est pas dans votre main.");
  }
  const [cardToDiscard] = hand.splice(cardIndex, 1);

  // 6) Ajoute la carte à la pile de défausse du joueur
  const discardPileRef = ref(db, `rooms/${currentRoom}/discard/${playerId}`);
  const discardPileSnap = await get(discardPileRef);
  const discardPile = discardPileSnap.val() || [];
  discardPile.push(cardToDiscard);

  // 7) Met à jour state et drapeaux global/local
  state.hasDiscardedThisTurn = true;
  state.lastDiscarder = playerId;
  hasDiscardedThisTurn = true;  // flag local

  await Promise.all([
    set(handRef, hand),
    set(discardPileRef, discardPile),
    update(stateRef, {
      hasDiscardedThisTurn: state.hasDiscardedThisTurn,
      lastDiscarder: state.lastDiscarder
    })
  ]);

  // 8) Ré-affiche la main si nécessaire
  renderHand(hand);
}


async function endTurn() {
  try {
    // S'assurer que c'est bien votre tour
    const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
    if (turnSnap.val() !== playerId) {
      return alert("Ce n'est pas votre tour.");
    }

    const stateRef = ref(db, `rooms/${currentRoom}/state`);
    const stateSnap = await get(stateRef);
    const state = stateSnap.val() || {};

    // Vérifier que vous avez pioché ou pris une carte
    if (!state.hasDrawnOrPicked) {
      return alert("Vous devez piocher une carte (ou en prendre une de la défausse) avant de terminer votre tour.");
    }

    // Vérifier que vous avez défaussé pour revenir à 13 cartes
    const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    if (hand.length !== 13) {
      return alert("Votre main doit contenir 13 cartes pour terminer le tour (vous devez défausser une carte).");
    }
    if (!state.hasDiscardedThisTurn) {
      return alert("Vous devez défausser une carte.");
    }

    // Calcul du prochain joueur
    const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = Object.keys(playersSnap.val() || {});
    const currentIndex = players.indexOf(playerId);
    const nextPlayerId = players[(currentIndex + 1) % players.length];

    // Réinitialisation des flags dans state
    const newState = {
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false,
      drawCount: 0,
      lastDiscarder: state.lastDiscarder
    };

    // On met à jour en parallèle : 
    // 1) l’état (sans le champ turn)
    // 2) la racine turn pour passer au joueur suivant
    await Promise.all([
      update(stateRef, newState),
      set(ref(db, `rooms/${currentRoom}/turn`), nextPlayerId)
    ]);
  await checkEndGame();
    console.log(`Tour terminé. C'est le tour de ${nextPlayerId}.`);
  } catch (error) {
    console.error("Erreur lors de la fin du tour:", error);
    alert("Une erreur est survenue lors de la fin du tour.");
  }
}

function setupPlayerHandDiscardListener() {
  playerHandDiv.addEventListener('dblclick', async e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    e.stopPropagation();

    const cardId = cardEl.dataset.cardId;

    // 1) Vérifier que c'est bien votre tour
    const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
    if (turnSnap.val() !== playerId) {
      return alert("Ce n'est pas votre tour.");
    }

    // 2) Récupérer l'état pour vérifier draw & discard
    const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
    const {
      drawCount = 0,
      hasDrawnOrPicked = false,
      hasDiscardedThisTurn = false
    } = stateSnap.val() || {};

    if (!hasDrawnOrPicked || drawCount === 0) {
      return alert("Vous devez piocher ou prendre une carte avant de défausser.");
    }
    if (hasDiscardedThisTurn) {
      return alert("Vous avez déjà défaussé ce tour.");
    }

    // 3) On appelle discardCard()
    try {
      await discardCard(cardId);
    } catch (err) {
      // Si la carte n'était plus dans la main, on sort sans alerter l'utilisateur
      console.warn("Discard skipped:", err);
      return;
    }

    // 4) Puis on termine le tour
    try {
      await endTurn();
      console.log("Carte défaussée et tour terminé.");
    } catch (err) {
      console.error("Erreur en fin de tour :", err);
      alert("Une erreur est survenue lors de la fin du tour.");
    }
  });
}

function enableChat() {
  toggleChatBtn.addEventListener('click', () => {
    chatContainer.classList.toggle('open');
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;

    const timestamp = Date.now();
    const messageData = {
      sender: playerId,
      pseudo: myPseudo,
      message: message,
      timestamp: timestamp
    };

    const messageRef = ref(db, `rooms/${currentRoom}/chat/${timestamp}`);
    await set(messageRef, messageData);
    chatInput.value = '';
  });

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
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}
  } else {
    console.warn("Bouton 'joinRoom' introuvable");
  }

  // Fin de tour
  if (endTurnBtn) {
    endTurnBtn.addEventListener('click', endTurn);
  } else {
    console.warn("Le bouton 'endTurnBtn' est introuvable, ajout manuel du DOM ?");
  }

  // Déclarations 7N / Win
  declare7NBtn.addEventListener('click', async () => {
    await sendNotification('7N');
  });
  declareWinBtn.addEventListener('click', async () => {
    await sendNotification('win');
  });

  // Si on recharge la page déjà dans une room
  if (currentRoom) {
    enableChat(currentRoom);
  }
});

// Exemple de createRoom (inchangé, on retire le enableChat() d'ici)
async function createRoom() {
  const roomCode = 'RAMI' + Math.floor(100 + Math.random() * 900);
  currentRoom = roomCode;

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (snapshot.exists()) {
    alert("La salle existe déjà, réessayez.");
    return;
  }

  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
  });
  await set(ref(db, `rooms/${roomCode}/creator`), playerId);
  await set(ref(db, `rooms/${roomCode}/turn`), playerId);

  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  setupPlayerHandDiscardListener();
  // ← on ne met plus enableChat() ici
  listenJokerCard(roomCode);
  listenNotifications(roomCode);

  menuDiv.style.display = 'none';
  gameDiv.style.display = 'flex';
  actionCreateRoomPopup();
}

async function joinRoom() {
  const roomCode = roomInput.value.trim().toUpperCase();
  if (!roomCode) {
    alert("Veuillez entrer un code de salle.");
    return;
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) {
    alert("Cette salle n'existe pas.");
    return;
  }

  // Vérifier si la partie a déjà commencé
  const stateSnap = await get(ref(db, `rooms/${roomCode}/state`));
  const gameStarted = stateSnap.exists() && stateSnap.val()?.started;

  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = playersSnap.val() || {};

  if (Object.keys(players).length >= 5) {
    alert("Cette salle est déjà complète (5 joueurs max).");
    return;
  }

  if (players[playerId]) {
    alert("Vous êtes déjà dans cette salle.");
    return;
  }

  // Ajout du joueur
  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
    isSpectator: gameStarted // Marquer comme spectateur si la partie a commencé
  });

  currentRoom = roomCode;

  // Écoute des données
  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  setupPlayerHandDiscardListener();
  enableChat();
  listenJokerCard(roomCode);
  listenNotifications(roomCode);

  // Affichage du jeu
  menuDiv.style.display = 'none';
  gameDiv.style.display = 'block';

  // Afficher un message différent pour les spectateurs
  if (gameStarted) {
    showPopup(`<p>Connecté en tant que spectateur à la salle <b>${roomCode}</b></p>`);
  } else {
    showPopup(`<p>Connecté à la salle <b>${roomCode}</b></p>`);
  }
}

// Fonction pour démarrer la partie
async function startGame() {
  if (!currentRoom) return;
  
  // Récupérer la liste des joueurs
  const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
  const players = playersSnap.val() || {};
  const playerIds = Object.keys(players);
  
  // Distribuer les cartes
  await dealCards(currentRoom, playerIds);
  
  // Initialiser le tour au premier joueur
  await set(ref(db, `rooms/${currentRoom}/turn`), playerIds[0]);
  
  // Mettre à jour l'état de la partie
  await update(ref(db, `rooms/${currentRoom}/state`), {
    started: true
  });
  
  // Cacher le bouton démarrer
  if (startGameBtn) {
    startGameBtn.style.display = 'none';
  }
  
  // Mettre à jour tous les joueurs pour indiquer qu'ils ne sont plus spectateurs
  playerIds.forEach(id => {
    update(ref(db, `rooms/${currentRoom}/players/${id}`), {
      isSpectator: false
    });
  });
}

// Ajout de l'écouteur pour le bouton "Démarrer la partie"
if (startGameBtn) {
  startGameBtn.addEventListener('click', startGame);
}

// —————————————
// Initialisation au chargement du DOM
// —————————————
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn     = document.getElementById('toggleChat');
  const chatContainer = document.getElementById('chat-container');
  const chatHeader    = chatContainer.querySelector('.chat-header');
  const createRoomBtn = document.getElementById('createRoom');
  const joinRoomBtn   = document.getElementById('joinRoom');
  const startGameBtn  = document.getElementById('startGameBtn');
  const endTurnBtn    = document.getElementById('endTurnBtn');
  const declare7NBtn  = document.getElementById('declare7N');
  const declareWinBtn = document.getElementById('declareWin');
  const remind7NBtn   = document.getElementById('remind7NBtn');

  // Basculer l’affichage du chat
  [toggleBtn, chatHeader].forEach(el =>
    el.addEventListener('click', () => {
      chatContainer.classList.toggle('open');
    })
  );

  // Création de salle + chat
  createRoomBtn?.addEventListener('click', async () => {
    await createRoom();
    enableChat(currentRoom);
  });

  // Rejoindre une salle + chat
  joinRoomBtn?.addEventListener('click', async () => {
    await joinRoom();
    enableChat(currentRoom);
  });

  // Démarrer la partie
  startGameBtn?.addEventListener('click', startGame);

  // Fin de tour
  endTurnBtn?.addEventListener('click', endTurn);

  // Déclarations 7N / Win
  declare7NBtn?.addEventListener('click', async () => {
    await sendNotification('7N');
  });
  declareWinBtn?.addEventListener('click', async () => {
    await sendNotification('win');
  });

  // Rappel 7N
  remind7NBtn?.addEventListener('click', async () => {
    const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
    const hand = handSnap.val() || [];
    const sevenCombo = extractSevenCombo(hand);
    if (sevenCombo.length === 7) {
      await sendNotification('7N', true);
    } else {
      alert("Aucune combinaison de 7 cartes trouvée.");
    }
  });

  // Si on recharge déjà dans une room : on initialise le chat une seule fois
  if (currentRoom) {
    enableChat(currentRoom);
  }
});
