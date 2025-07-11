import { db, ref, set, update, get, onValue } from './firebase.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.esm.js';

const pseudo = prompt('Entrez votre pseudo :') || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random() * 10000);
let currentRoom = '';
let hasDrawnOrPicked = false;
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

  deck.push(
    { suit: 'Joker', symbol: '🃏', color: 'red', rank: 'Joker', value: 0, id: 'joker_red_1' },
    { suit: 'Joker', symbol: '🃏', color: 'black', rank: 'Joker', value: 0, id: 'joker_black_1' },
    { suit: 'Joker', symbol: '🃏', color: 'red', rank: 'Joker', value: 0, id: 'joker_red_2' },
    { suit: 'Joker', symbol: '🃏', color: 'black', rank: 'Joker', value: 0, id: 'joker_black_2' }
  );

  if (deck.length !== 108) {
    console.error(`Erreur createDeck : attendu 108 cartes, trouvé ${deck.length}`);
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

const deckPile = document.getElementById('deck');
deckPile.classList.add('clickable');
deckPile.addEventListener('click', drawCard);

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
  playersDiv.className = `players-circle ${players.length === 2 ? 'two-players' : ''}`;

  players.forEach((p, index) => {
    const badge = document.createElement('div');
    badge.className = `player-badge ${p.id === playerId ? 'current-player' : ''}`;
    badge.id = `badge-${p.id}`;
    badge.innerHTML = `
      <div class="player-name">${p.pseudo} ${p.id === playerId ? '(Vous)' : ''}</div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>
      <div class="opponent-hand" id="hand-${p.id}"></div>
      <div class="discard-pile" id="discard-${p.id}"></div> `;
    playersDiv.append(badge);
  });
}

function listenDiscard(room) {
  onValue(ref(db, `rooms/${room}/discard`), snap => {
    const discards = snap.val() || {};
    Object.entries(discards).forEach(([pid, pile]) => {
      const el = document.getElementById(`discard-${pid}`);
      if (!el) return;
      const top = pile.length ? pile[pile.length - 1] : null;
      el.innerHTML = top ? `
        <div class="discard-card ${top.color}"
             data-card-id="${top.id}"
             data-player-id="${pid}"
             data-rank="${top.rank}"
             data-symbol="${top.symbol}"
             data-color="${top.color}"
             data-suit="${top.suit}"
             data-value="${top.value}">
          ${top.rank}${top.symbol}
        </div>
      ` : '';
      if (top) {
        const cardEl = el.querySelector('.discard-card');
        cardEl.style.cursor = 'pointer';
        if (pid !== playerId) {
          cardEl.onclick = async () => {
            const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
            if (turnSnap.val() === playerId) {
              takeDiscardedCard(pid);
            } else {
              alert("Ce n'est pas votre tour.");
            }
          };
        } else {
          cardEl.onclick = null;
          cardEl.style.cursor = 'default';
        }
      }
    });
  });
}

function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), snap => {
    const players = Object.entries(snap.val() || {}).map(([id, o]) => ({
      id,
      pseudo: o.pseudo
    }));
    renderPlayers(players);
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

async function updateActionButtons(hand) {
  const jokerSnap = await get(ref(db, `rooms/${currentRoom}/jokerSet`));
  const jokerSet = jokerSnap.val()?.jokerSet || [];

  declare7NBtn.disabled = !Rules.has7Naturel(hand);
  declareWinBtn.disabled = !Rules.validateWinHandWithJoker(hand, jokerSet);
}

function listenTurn(room) {
  onValue(ref(db, `rooms/${room}/turn`), snap => {
    const turn = snap.val();
    const myTurn = turn === playerId;
    hasDrawnOrPicked = false;
    hasDiscardedThisTurn = false;

    status.textContent = myTurn ? "⭐ C'est votre tour !" : "En attente...";

    document.querySelectorAll('.player-badge').forEach(badge => {
      badge.classList.toggle('current-turn', badge.id === `badge-${turn}`);
    });

    deckPile.style.pointerEvents = myTurn ? 'auto' : 'none';
    deckPile.style.opacity = myTurn ? '1' : '0.5';
    if (endTurnBtn) {
      endTurnBtn.disabled = !myTurn || !hasDrawnOrPicked || !hasDiscardedThisTurn;
    }
  });
}

async function terminateGame(winnerId) {
  const winnerPseudoSnap = await get(ref(db, `rooms/${currentRoom}/players/${winnerId}/pseudo`));
  const winnerPseudo = winnerPseudoSnap.val() || 'Joueur Inconnu';

  const winnerHandSnap = await get(ref(db, `rooms/${currentRoom}/hands/${winnerId}`));
  const winnerHand = winnerHandSnap.val() || [];

  const jokerSetSnap = await get(ref(db, `rooms/${currentRoom}/jokerSet`));
  const jokerSet = jokerSetSnap.val()?.jokerSet || [];

  const winCombos = extractWinCombosJoker(winnerHand, jokerSet);

  await update(ref(db, `rooms/${currentRoom}/state`), {
    roundOver: true,
    winDeclared: true,
    winnerId: winnerId,
    winnerPseudo: winnerPseudo,
    winCombos: winCombos
  });
}

async function checkEndGame() {
  const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
  const state = stateSnap.val() || {};

  if (state.roundOver || state.winDeclared) return;

  const deckSnap = await get(ref(db, `rooms/${currentRoom}/deck`));
  const deck = deckSnap.val() || [];

  if (deck.length === 0 && !state.winDeclared) {
    await update(ref(db, `rooms/${currentRoom}/state`), { roundOver: true, reason: 'deck_empty_no_win' });
    return;
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
    div.innerHTML = `
      <div class="corner top"><span>${c.rank}</span><span>${c.symbol}</span></div>
      <div class="suit main">${c.symbol}</div>
      <div class="corner bottom"><span>${c.rank}</span><span>${c.symbol}</span></div>
    `;
    playerHandDiv.append(div);
  });
  enableDragDrop();
}

async function drawCard() {
  if (!currentRoom) return;

  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || { drawCount: 0 };

  if (state.drawCount >= 1) {
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');
  }

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

  const card = deck.shift();
  hand.push(card);

  const playersCount = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || {}).length;
  if (deck.length < playersCount && hand.some(c => jokerSet.includes(c.id))) {
    const idx = hand.findIndex(c => jokerSet.includes(c.id));
    if (idx !== -1) {
      const [jok] = hand.splice(idx, 1);
      let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
      pile.push(jok);
      await set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile);
      showPopup('Joker défaussé automatiquement.');
    }
  }

  state.drawCount++;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/deck`), deck),
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    update(stateRef, { drawCount: state.drawCount, started: true })
  ]);

  hasDrawnOrPicked = true;
}

async function takeDiscardedCard(ownerId) {
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId)
    return alert("Ce n'est pas votre tour.");

  const stateRef = ref(db, `rooms/${currentRoom}/state`);
  let state = (await get(stateRef)).val() || { drawCount: 0, lastDiscarder: null };

  if (state.drawCount >= 1)
    return alert('Vous avez déjà pioché ou pris une carte ce tour.');

  if (ownerId !== state.lastDiscarder) {
    return alert("Vous ne pouvez prendre qu'une carte de la défausse du joueur précédent.");
  }

  let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${ownerId}`))).val() || [];
  if (!pile.length)
    return alert('Défausse vide.');

  const card = pile.pop();

  let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  hand.push(card);

  state.drawCount++;

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
    set(ref(db, `rooms/${currentRoom}/discard/${ownerId}`), pile),
    update(stateRef, { drawCount: state.drawCount, started: true })
  ]);

  hasDrawnOrPicked = true;
}

async function endTurn() {
  const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
  if (turnSnap.val() !== playerId) {
    return alert("Ce n'est pas votre tour.");
  }

  const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
  const state = stateSnap.val() || {};

  if (!hasDrawnOrPicked) {
    return alert("Vous devez piocher une carte (ou en prendre une de la défausse) avant de terminer votre tour.");
  }

  const currentHand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
  if (currentHand.length !== 13) {
    return alert("Vous devez défausser une carte pour avoir 13 cartes en main avant de terminer votre tour.");
  }

  const players = Object.keys((await get(ref(db, `rooms/${currentRoom}/players`))).val() || []);
  const current = playerId;

  const idx = players.indexOf(current);
  const next = players[(idx + 1) % players.length];

  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/turn`), next),
    update(ref(db, `rooms/${currentRoom}/state`), {
      lastDiscarder: current,
      drawCount: 0
    })
  ]);

  await checkEndGame();

  hasDrawnOrPicked = false;
  hasDiscardedThisTurn = false;
}

function setupPlayerHandDiscardListener() {
  playerHandDiv.addEventListener('click', async e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;

    const turnSnap = await get(ref(db, `rooms/${currentRoom}/turn`));
    if (turnSnap.val() !== playerId) {
      return alert("Ce n'est pas votre tour.");
    }

    if (hasDiscardedThisTurn) {
      return alert("Vous avez déjà jeté une carte ce tour.");
    }

    const stateSnap = await get(ref(db, `rooms/${currentRoom}/state`));
    const drawCount = stateSnap.val()?.drawCount || 0;
    if (!hasDrawnOrPicked || drawCount === 0) {
      return alert("Vous devez piocher ou prendre une carte avant de défausser.");
    }

    const cardId = cardEl.dataset.cardId;
    let hand = (await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val() || [];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [card] = hand.splice(idx, 1);

    let pile = (await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val() || [];
    pile.push(card);

    await Promise.all([
      set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hand),
      set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
    ]);

    hasDiscardedThisTurn = true;

    await endTurn();
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
      pseudo: pseudo,
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

createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
setupPlayerHandDiscardListener();
