import { db, ref, push, onChildAdded, set, update, get, onValue } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

let myPseudo = '';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let hasDrawnOrPicked = false;
let hasDiscardedThisTurn = false;
let handDisplayType = 'horizontal';
let currentHand = [];

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
          if (cardsInSuit[i + j] && cardsInSuit[i + j].value === sequence[sequence.length - 1].value + 1) { // Corrected line
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
              const newCombo = [card1, { value: missingValue, suit: suit, id: joker.id, rank: 'Joker', symbol: joker.symbol, color: joker.color }, card2].sort((a, b) => a.value - b.value);
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

  if (deck.length !== 104) {
    console.error(`Erreur createDeck : attendu 104 cartes, trouvé ${deck.length}`);
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
  const jokerSet = deck.filter(c => c.value === revealedJokerCard.value).map(c => c.id);

  await Promise.all([
    set(ref(db, `rooms/${roomId}/deck`), deck),
    set(ref(db, `rooms/${roomId}/jokerCard`), revealedJokerCard),
    set(ref(db, `rooms/${roomId}/jokerSet`), { jokerSet }),
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

function showJoker(jokerCard) {
  const jokerDiv = document.getElementById('joker');
  if (jokerCard?.rank) {
    jokerDiv.innerHTML = `
      <div class="card ${jokerCard.color}">
        <div class="corner top"><span>${jokerCard.rank}</span><span>${jokerCard.symbol}</span></div>
        <div class="suit main">${jokerCard.symbol}</div>
        <div class="corner bottom"><span>${jokerCard.rank}</span><span>${jokerCard.symbol}</span></div>
      </div>
    `;
  } else {
    jokerDiv.innerHTML = '';
  }
}

function showPopup(content, isError = false) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      ${content}
      <button class="modal-close">Fermer</button>
    </div>`;
  document.body.appendChild(modal);

  let trapFocus = null;
  const keyHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  document.addEventListener('keydown', keyHandler);
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length > 0) {
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];
    firstFocusable.focus();

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

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', keyHandler);
    if (trapFocus) {
      modal.removeEventListener('keydown', trapFocus);
    }
  };

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  if (isError) {
    modal.querySelector('.modal-content').style.background = '#ffe6e6';
  }
}
function askPseudo() {
  showPopup(`
    <h3>Entrez votre pseudo</h3>
    <input id="pseudoInput" type="text" placeholder="Votre pseudo" aria-label="Pseudo" />
    <button id="pseudoSubmit" class="btn btn-primary">Valider</button>
  `);
  document.getElementById('pseudoSubmit').addEventListener('click', () => {
    const val = document.getElementById('pseudoInput').value.trim();
    myPseudo = val || 'Anonyme';
    // ferme la modal
    document.querySelector('.modal-close').click();
  });
}
document.addEventListener('DOMContentLoaded', () => {
  // on demande le pseudo avant tout
  askPseudo();

  // options d’affichage de la main
  setupHandDisplayOptions();

  // bouton Créer
  const btnCreate = document.getElementById('createRoom');
  if (btnCreate) btnCreate.addEventListener('click', createRoom);
  else console.warn('⚠️ #createRoom introuvable');

  // bouton Rejoindre
  const btnJoin = document.getElementById('joinRoom');
  if (btnJoin) btnJoin.addEventListener('click', joinRoom);
  else console.warn('⚠️ #joinRoom introuvable');

  // bouton Démarrer la partie (seulement visible par le créateur)
  const btnStart = document.getElementById('startGameBtn');
  if (btnStart) btnStart.addEventListener('click', startGame);

  // bouton Terminer le tour
  const btnEnd = document.getElementById('endTurnBtn');
  if (btnEnd) btnEnd.addEventListener('click', endTurn);

  // déclarations/spam 7 naturel et victoire
  document.getElementById('declare7N')?.addEventListener('click', declare7Naturel);
  document.getElementById('declareWin')?.addEventListener('click', () => sendNotification('win'));
  document.getElementById('remind7NBtn')?.addEventListener('click', async () => {
    const hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
    const combo = extractSevenCombo(hand);
    if (combo.length === 7) await sendNotification('7N', true);
    else showPopup("Aucune combinaison de 7 cartes trouvée.", true);
  });

  // double‑clic pour piocher
  document.getElementById('deck')?.addEventListener('dblclick', drawCard);
});


function showGlobalPopup(message, cards = null) {
  const overlay = document.createElement('div');
  overlay.className = 'global-popup-overlay';
  const box = document.createElement('div');
  box.className = 'global-popup-box';
  box.innerHTML = `<div class="notif-message">${message}</div>`;

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
  setTimeout(() => overlay.remove(), 3000);
  overlay.addEventListener('click', () => overlay.remove());
}

function enableDragDrop() {
  new Sortable(document.getElementById('hand'), {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      const hand = Array.from(document.getElementById('hand').children).map(el => ({
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

function renderPlayers(players) {
  const playersDiv = document.getElementById('players');
  playersDiv.innerHTML = '';
  players.forEach((p, index) => {
    const badge = document.createElement('div');
    badge.className = `player-info ${p.id === playerId ? 'active' : ''}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo} ${p.id === playerId ? '(Vous)' : ''}</div>
      <div class="player-hand-count" id="hand-count-${p.id}">${p.id === playerId ? '13' : '?'} cartes</div>
    `;
    playersDiv.appendChild(badge);
  });
}

function renderDiscardPiles(players, discards) {
  const discardArea = document.getElementById('global-discard');
  discardArea.innerHTML = '<div class="discard-label">Défausses des joueurs</div>';

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
            await takeDiscardedCard(ownerId);
          } else {
            showPopup('Vous ne pouvez prendre qu’une carte de la défausse du joueur précédent.', true);
          }
        } else {
          showPopup('Ce n’est pas votre tour.', true);
        }
      });
    }

    cardContainer.appendChild(cardEl);
    playerDiscard.appendChild(playerName);
    playerDiscard.appendChild(cardContainer);
    discardArea.appendChild(playerDiscard);
  });
}

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
    const playersSnap = await get(ref(db, `rooms/${room}/players`));
    const players = playersSnap.val() || {};
    renderDiscardPiles(players, discards);
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async snap => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo
    }));
    const stateSnap = await get(ref(db, `rooms/${room}/state`));
    const gameStarted = stateSnap.val()?.started;
    renderPlayers(players);

    const creatorSnap = await get(ref(db, `rooms/${room}/creator`));
    const creatorId = creatorSnap.val();
    const startGameBtn = document.getElementById('startGameBtn');
    if (startGameBtn) {
      startGameBtn.style.display = creatorId === playerId && !gameStarted ? 'block' : 'none';
    }
  });
}
// ─── 1. Fonction de déclaration du 7 Naturel ───────────────────────────────────
async function declare7Naturel() {
  const playerRef = ref(db, `rooms/${currentRoom}/players/${playerId}`);
  const playerSnap = await get(playerRef);
  const playerData = playerSnap.val() || {};

  // Si déjà déclaré, on renvoie juste la notification (sans points)
  if (playerData.hasDeclared7N) {
    return sendNotification('7N', true);
  }

  // Sinon, première déclaration
  await update(playerRef, { hasDeclared7N: true });

  // On ajoute 0.5 point
  const scoresRef = ref(db, `rooms/${currentRoom}/scores/${playerId}`);
  const currentScore = (await get(scoresRef)).val() || 0;
  await set(scoresRef, currentScore + 0.5);

  // On envoie la notification
  await sendNotification('7N');
}

// ─── 2. Écoute des scores et mise à jour de l'affichage ─────────────────────────
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

async function createRoom() {
  const roomCode = 'RAMI' + Math.floor(100 + Math.random() * 900);
  currentRoom = roomCode;

  const roomRef = ref(db, `rooms/${roomCode}`);
  if ((await get(roomRef)).exists()) {
    showPopup("La salle existe déjà, réessayez.", true);
    return;
  }

  // 1️⃣ On initialise hasDeclared7N ici
  await Promise.all([
    set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
      pseudo: myPseudo,
      hasDeclared7N: false
    }),
    set(ref(db, `rooms/${roomCode}/creator`), playerId),
    set(ref(db, `rooms/${roomCode}/turn`), playerId)
  ]);

  // 2️⃣ On lance tous les listeners (sans setupPlayerHandDiscardListener())
  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  listenJokerCard(roomCode);
  listenNotifications(roomCode);
  // Si vous voulez mettre à jour automatiquement le compteur de mains :
  // listenHandCounts(roomCode);

  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  showPopup(`
    <h3>Salle créée</h3>
    <p>Code de la salle : <b>${roomCode}</b></p>
    <button id="copyRoomCode">Copier</button>
  `);
  document.getElementById('copyRoomCode').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode);
    showPopup('Code copié !');
  });

  enableChat();
}

async function joinRoom() {
  const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!/^RAMI\d{3}$/.test(roomCode)) {
    showPopup("Code de salle invalide. Il doit être au format RAMI123.", true);
    return;
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) {
    showPopup("Cette salle n'existe pas.", true);
    return;
  }

  const stateSnap = await get(ref(db, `rooms/${roomCode}/state`));
  const gameStarted = stateSnap.exists() && stateSnap.val().started;
  const players = (await get(ref(db, `rooms/${roomCode}/players`))).val() || {};

  if (Object.keys(players).length >= 5) {
    showPopup("Cette salle est déjà complète (5 joueurs max).", true);
    return;
  }
  if (players[playerId]) {
    showPopup("Vous êtes déjà dans cette salle.", true);
    return;
  }

  // 1️⃣ On initialise hasDeclared7N ici aussi
  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
    hasDeclared7N: false,
    isSpectator: gameStarted
  });
  currentRoom = roomCode;

  // 2️⃣ On relance les mêmes listeners
  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  listenJokerCard(roomCode);
  listenNotifications(roomCode);
  // listenHandCounts(roomCode);

  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  showPopup(`<p>Connecté à la salle <b>${roomCode}</b>${gameStarted ? ' en tant que spectateur' : ''}</p>`);

  enableChat();
}


function arrangeCardsInSemiCircle() {
  const cards = document.getElementById('hand').querySelectorAll('.card');
  const cardCount = cards.length;
  const radius = Math.min(150, window.innerWidth / 5);
  const maxAngle = 60; // Degrés
  const angleStep = maxAngle / (cardCount - 1);

  cards.forEach((card, index) => {
    const angle = (index * angleStep) - (maxAngle / 2);
    const angleRad = angle * Math.PI / 180;
    const x = Math.sin(angleRad) * radius;
    const y = -Math.abs(Math.cos(angleRad)) * 20; // Léger décalage vertical
    card.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`;
    card.style.zIndex = index;
  });
}
function listenHand(room) {
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => {
    const hand = snap.val() || [];
    renderHand(hand);
    updateActionButtons(hand);
  });
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const myTurn = turn === playerId;
    hasDrawnOrPicked = false;
    hasDiscardedThisTurn = false;

    const status = document.getElementById('status');
    status.textContent = myTurn ? "⭐ C'est votre tour !" : "En attente…";

    const deckPile = document.getElementById('deck');
    deckPile.style.pointerEvents = myTurn ? 'auto' : 'none';
    deckPile.style.opacity = myTurn ? '1' : '0.5';

    const endTurnBtn = document.getElementById('endTurnBtn');
    if (endTurnBtn) {
      endTurnBtn.disabled = !myTurn || !hasDrawnOrPicked || !hasDiscardedThisTurn;
    }
  });
}

function listenJokerCard(room) {
  onValue(ref(db, `rooms/${room}/jokerCard`), snap => {
    const card = snap.val();
    showJoker(card);
  });
}

function listenNotifications(room) {
  const notifRef = ref(db, `rooms/${room}/notifications`);
  onChildAdded(notifRef, snap => {
    const notif = snap.val();
    if (!notif) return;

    if (notif.type === '7N') {
      const msg = notif.reminder ? `📌 ${notif.pseudo} réaffiche son 7 Naturel :` : `🎉 ${notif.pseudo} a déclaré un 7 Naturel !`;
      showGlobalPopup(msg, notif.combo);
    } else if (notif.type === 'win') {
      showGlobalPopup(`🏆 ${notif.pseudo} a déclaré la victoire !`);
      terminateGame(notif.playerId);
    }
  });
}

async function sendNotification(type, isReminder = false) {
  const notifRef = ref(db, `rooms/${currentRoom}/notifications`);
  let payload = {
    type,
    playerId,
    pseudo: myPseudo,
    timestamp: Date.now(),
    reminder: isReminder
  };

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
  const jokerSet = jokerSnap.val()?.jokerSet || [];
  document.getElementById('declare7N').disabled = !Rules.has7Naturel(hand);
  document.getElementById('declareWin').disabled = !Rules.validateWinHandWithJoker(hand, jokerSet);
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
    winnerId,
    winnerPseudo,
    winCombos,
    has7Naturel: has7
  });

  showPopup(`<h3>Partie terminée !</h3><p>${winnerPseudo} a gagné !</p>`);
}

async function checkEndGame() {
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const stateSnap = await get(stateRef);
  const state = stateSnap.val() || {};

  if (state.winDeclared) return;

  const deckSnap = await get(ref(db, `rooms/${currentRoom}/deck`));
  const deck = deckSnap.val() || [];
  if (deck.length === 0) {
    const handsSnap = await get(ref(db, `rooms/${currentRoom}/hands`));
    const allHands = handsSnap.val() || {};
    const someoneHas7 = Object.values(allHands).some(hand => Rules.has7Naturel(hand));

    if (someoneHas7) {
      await newRound('♻️ Deck vide – 7 Naturel détecté, nouvelle manche');
    } else {
      await update(stateRef, { roundOver: true, reason: 'deck_empty_no_7' });
      showPopup('<h3>Partie terminée !</h3><p>Le deck est vide et aucun 7 Naturel n’a été trouvé.</p>');
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
  const playerHandDiv = document.getElementById('hand');
  playerHandDiv.innerHTML = '';
  currentHand = hand;

  hand.forEach(c => {
    const div = document.createElement('div');
    div.className = `card ${c.color} dealing`;
    div.dataset.cardId = c.id;
    div.dataset.rank = c.rank;
    div.dataset.symbol = c.symbol;
    div.dataset.color = c.color;
    div.dataset.suit = c.suit;
    div.dataset.value = c.value;
    div.innerHTML = `
      <div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>
      <div class="suit main">${c.symbol}</div>
      <div class="corner bottom"><span>${c.rank}</span><span>${c.symbol}</span></div>
    `;
    div.addEventListener('dblclick', () => discardCard(c.id));
    playerHandDiv.appendChild(div);
  });

  playerHandDiv.className = `player-hand ${handDisplayType}`;
  if (handDisplayType === 'semi-circle') {
    arrangeCardsInSemiCircle();
  }
  enableDragDrop();
}


function setupHandDisplayOptions() {
  const buttons = Array.from(document.querySelectorAll('.hand-display-btn'));
  const handContainer = document.getElementById('hand');

  // Initialisation : active le bouton correspondant et applique la classe sur la main
  buttons.forEach(btn => {
    if (btn.dataset.display === handDisplayType) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  if (handContainer) {
    handContainer.className = `player-hand ${handDisplayType}`;
    if (handDisplayType === 'semi-circle') {
      arrangeCardsInSemiCircle();
    }
  }

  // Événements au clic
  buttons.forEach(button => {
    button.addEventListener('click', function() {
      // Retire l’état actif de tous
      buttons.forEach(b => b.classList.remove('active'));
      // Définit l’actif sur celui cliqué
      this.classList.add('active');

      // Met à jour le type d’affichage et la classe du container
      handDisplayType = this.dataset.display;
      if (handContainer) {
        handContainer.className = `player-hand ${handDisplayType}`;
        if (handDisplayType === 'semi-circle') {
          arrangeCardsInSemiCircle();
        }
      }
    });
  });
}

async function drawCard() {
  if (!currentRoom) return;

  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return showPopup("Ce n'est pas votre tour.", true);
  }

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || { drawCount: 0, hasDrawnOrPicked: false };

  if (state.drawCount >= 1 || state.hasDrawnOrPicked) {
    return showPopup('Vous avez déjà pioché ou pris une carte ce tour.', true);
  }

  const [deckSnap, handSnap, jokerSetSnap] = await Promise.all([
    get(ref(db, `rooms/${currentRoom}/deck`)),
    get(ref(db, `rooms/${currentRoom}/hands/${playerId}`)),
    get(ref(db, `rooms/${currentRoom}/jokerSet`))
  ]);
  const deck = deckSnap.val() || [];
  const hand = handSnap.val() || [];
  const jokerSet = jokerSetSnap.val()?.jokerSet || [];

  if (!deck.length) {
    return showPopup('Deck vide.', true);
  }

  const card = deck.shift();
  hand.push(card);

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

  state.drawCount++;
  state.hasDrawnOrPicked = true;
  hasDrawnOrPicked = true;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/deck`), deck),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    update(stateRef, { drawCount: state.drawCount, hasDrawnOrPicked: state.hasDrawnOrPicked, started: true })
  ]);

  await checkEndGame();
}

async function takeDiscardedCard(ownerId) {
  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const stateSnap = await get(stateRef);
  const state = stateSnap.val() || {};

  if (ownerId !== state.lastDiscarder) {
    return showPopup("Vous ne pouvez prendre qu'une carte de la défausse du joueur précédent.", true);
  }

  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return showPopup("Ce n'est pas votre tour.", true);
  }

  if (state.drawCount >= 1) {
    return showPopup('Vous avez déjà pioché ou pris une carte ce tour.', true);
  }

  const pileSnap = await get(ref(db, `rooms/${currentRoom}/discard/${ownerId}`));
  const pile = pileSnap.val() || [];
  if (pile.length === 0) {
    return showPopup("La défausse est vide.", true);
  }

  const card = pile.pop();
  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  hand.push(card);

  state.hasDrawnOrPicked = true;
  state.drawCount++;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), pile),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    update(stateRef, { hasDrawnOrPicked: state.hasDrawnOrPicked, drawCount: state.drawCount })
  ]);

  await checkEndGame();
}

async function discardCard(cardId) {
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return showPopup("Ce n'est pas votre tour.", true);
  }

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const state = (await get(stateRef)).val() || { hasDrawnOrPicked: false, hasDiscardedThisTurn: false };

  if (!state.hasDrawnOrPicked) {
    return showPopup("Vous devez piocher ou prendre une carte avant de défausser.", true);
  }

  if (state.hasDiscardedThisTurn) {
    return showPopup("Vous avez déjà défaussé une carte ce tour.", true);
  }

  const handRef = ref(db, `rooms/${currentRoom}/hands/${playerId}`);
  const handSnap = await get(handRef);
  const hand = handSnap.val() || [];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    return showPopup("Erreur : Cette carte n'est pas dans votre main.", true);
  }

  const [cardToDiscard] = hand.splice(cardIndex, 1);
  const discardPileRef = ref(db, `rooms/${currentRoom}/discard/${playerId}`);
  const discardPileSnap = await get(discardPileRef);
  const discardPile = discardPileSnap.val() || [];
  discardPile.push(cardToDiscard);

  state.hasDiscardedThisTurn = true;
  state.lastDiscarder = playerId;
  hasDiscardedThisTurn = true;

  await Promise.all([
    set(handRef, hand),
    set(discardPileRef, discardPile),
    update(stateRef, { hasDiscardedThisTurn: state.hasDiscardedThisTurn, lastDiscarder: state.lastDiscarder })
  ]);

  renderHand(hand);
}

async function endTurn() {
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return showPopup("Ce n'est pas votre tour.", true);
  }

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  const stateSnap = await get(stateRef);
  const state = stateSnap.val() || {};

  if (!state.hasDrawnOrPicked) {
    return showPopup("Vous devez piocher une carte (ou en prendre une de la défausse) avant de terminer votre tour.", true);
  }

  const handSnap = await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`));
  const hand = handSnap.val() || [];
  if (hand.length !== 13) {
    return showPopup("Votre main doit contenir 13 cartes pour terminer le tour (vous devez défausser une carte).", true);
  }

  if (!state.hasDiscardedThisTurn) {
    return showPopup("Vous devez défausser une carte.", true);
  }

  const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
  const players = Object.keys(playersSnap.val() || {});
  const currentIndex = players.indexOf(playerId);
  const nextPlayerId = players[(currentIndex + 1) % players.length];

  await Promise.all([
    update(stateRef, {
      hasDrawnOrPicked: false,
      hasDiscardedThisTurn: false,
      drawCount: 0,
      lastDiscarder: state.lastDiscarder
    }),
    set(ref(db, `rooms/${currentRoom}/turn`), nextPlayerId)
  ]);

  await checkEndGame();
}

async function createRoom() {
  const roomCode = 'RAMI' + Math.floor(100 + Math.random() * 900);
  currentRoom = roomCode;

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (snapshot.exists()) {
    showPopup("La salle existe déjà, réessayez.", true);
    return;
  }

  await Promise.all([
    set(ref(db, `rooms/${roomCode}/players/${playerId}`), { pseudo: myPseudo }),
    set(ref(db, `rooms/${roomCode}/creator`), playerId),
    set(ref(db, `rooms/${roomCode}/turn`), playerId)
  ]);

  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  setupPlayerHandDiscardListener();
  listenJokerCard(roomCode);
  listenNotifications(roomCode);

  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  showPopup(`
    <h3>Salle créée</h3>
    <p>Code de la salle : <b>${roomCode}</b></p>
    <button id="copyRoomCode">Copier</button>
  `);
  document.getElementById('copyRoomCode').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode);
    showPopup('Code copié !');
  });

  enableChat();
}

async function joinRoom() {
  const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!/^RAMI\d{3}$/.test(roomCode)) {
    showPopup("Code de salle invalide. Il doit être au format RAMI123.", true);
    return;
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) {
    showPopup("Cette salle n'existe pas.", true);
    return;
  }

  const stateSnap = await get(ref(db, `rooms/${roomCode}/state`));
  const gameStarted = stateSnap.exists() && stateSnap.val().started;
  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = playersSnap.val() || {};

  if (Object.keys(players).length >= 5) {
    showPopup("Cette salle est déjà complète (5 joueurs max).", true);
    return;
  }

  if (players[playerId]) {
    showPopup("Vous êtes déjà dans cette salle.", true);
    return;
  }

  await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
    pseudo: myPseudo,
    isSpectator: gameStarted
  });

  currentRoom = roomCode;
  listenPlayers(roomCode);
  listenScores(roomCode);
  listenDiscard(roomCode);
  listenHand(roomCode);
  listenTurn(roomCode);
  setupPlayerHandDiscardListener();
  listenJokerCard(roomCode);
  listenNotifications(roomCode);
  enableChat();

  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  showPopup(`<p>Connecté à la salle <b>${roomCode}</b>${gameStarted ? ' en tant que spectateur' : ''}</p>`);
}

async function startGame() {
  if (!currentRoom) return;

  const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
  const players = playersSnap.val() || {};
  const playerIds = Object.keys(players);

  await dealCards(currentRoom, playerIds);
  await set(ref(db, `rooms/${currentRoom}/turn`), playerIds[0]);
  await update(ref(db, `rooms/${currentRoom}/state`), { started: true });

  const startGameBtn = document.getElementById('startGameBtn');
  if (startGameBtn) {
    startGameBtn.style.display = 'none';
  }

  playerIds.forEach(id => {
    update(ref(db, `rooms/${currentRoom}/players/${id}`), { isSpectator: false });
  });
}

function enableChat() {
  const toggleChatBtn = document.getElementById('toggleChat');
  const chatContainer = document.getElementById('chat-container');
  const chatToggleIcon = document.querySelector('.chat-header span');
  
  toggleChatBtn.addEventListener('click', () => {
    chatContainer.classList.toggle('collapsed');
    chatToggleIcon.textContent = chatContainer.classList.contains('collapsed') ? '▲' : '▼';
  });

  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('chat-input').value.trim();
    if (!message) return;

    const messageData = {
      sender: playerId,
      pseudo: myPseudo,
      message,
      timestamp: Date.now()
    };

    await set(ref(db, `rooms/${currentRoom}/chat/${Date.now()}`), messageData);
    document.getElementById('chat-input').value = '';
  });

  onValue(ref(db, `rooms/${currentRoom}/chat`), (snapshot) => {
    const messages = snapshot.val() || {};
    const messagesArray = Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => a.timestamp - b.timestamp);

    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';

    messagesArray.forEach(msg => {
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${msg.sender === playerId ? 'me' : 'other'}`;
      messageDiv.innerHTML = `<b>${msg.pseudo}:</b> ${msg.message}`;
      chatMessages.appendChild(messageDiv);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function setupPlayerHandDiscardListener() {
  document.getElementById('hand').addEventListener('dblclick', async e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    e.stopPropagation();

    const cardId = cardEl.dataset.cardId;
    await discardCard(cardId);
    await endTurn();
  });
}
