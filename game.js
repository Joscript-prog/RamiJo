// game.js
// Règles et validation intégrées
import { db, ref, set, get, onValue, onDisconnect, push } from './firebase.js';

// --- MODULE de règles internes (validation des combinaisons) ---
const Rules = {
  isQuadri(hand, jokerSet = []) {
    // 4 mêmes valeurs, jokers autorisés si remplaçant
    const vals = hand.map(c => c.value);
    for (let v of new Set(vals)) {
      const group = hand.filter(c => c.value === v || jokerSet.includes(c.id));
      if (group.length >= 4) return true;
    }
    return false;
  },
  isTri(hand, jokerSet = []) {
    const vals = hand.map(c => c.value);
    for (let v of new Set(vals)) {
      const group = hand.filter(c => c.value === v || jokerSet.includes(c.id));
      if (group.length >= 3) return true;
    }
    return false;
  },
  isEscalier(hand, len, jokerSet = []) {
    // Len séquentiel de même couleur
    const byColor = hand.reduce((o, c) => {
      o[c.suit] = o[c.suit] || new Set();
      o[c.suit].add(c.value);
      if (jokerSet.includes(c.id)) o[c.suit].add(null); // jokers wildcard
      return o;
    }, {});
    for (let suit in byColor) {
      const vals = Array.from(byColor[suit]).filter(v => v !== null).sort((a,b)=>a-b);
      for (let start of vals) {
        let count = 1;
        for (let k = 1; k < len; k++) {
          if (byColor[suit].has(start + k) || byColor[suit].has(null)) count++;
        }
        if (count >= len) return true;
      }
    }
    return false;
  },
  has7Naturel(hand, jokerSet = []) {
    return (
      (this.isQuadri(hand, []) && this.isEscalier(hand, 3, [])) ||
      (this.isEscalier(hand, 4, []) && this.isTri(hand, []))
    );
  },
  validateWinHand(hand, jokerSet = []) {
    // Conditions victoire
    const natural = hand.filter(c => !jokerSet.includes(c.id));
    const cond1 = this.isQuadri(natural) && this.isEscalier(natural, 3) &&
                  ([...Array(2)].every(_ => this.isTri(natural) || this.isEscalier(natural, 3)));
    const cond2 = this.isEscalier(natural, 4) && this.isTri(natural) &&
                  ([...Array(2)].every(_ => this.isTri(natural) || this.isEscalier(natural, 3)));
    return cond1 || cond2;
  }
};

// --- Variables UI & État ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn   = document.getElementById('joinRoom');
const roomInput     = document.getElementById('roomCodeInput');
const status        = document.getElementById('status');
const handDiv       = document.getElementById('hand');
const playersDiv    = document.getElementById('players');
const drawCardBtn   = document.getElementById('drawCard');
const takeDiscardBtn= document.getElementById('takeDiscard');
const endTurnBtn    = document.getElementById('endTurn');
const declare7NBtn  = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const menuDiv       = document.getElementById('menu');
const gameDiv       = document.getElementById('game');

const pseudo    = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId  = 'player_' + Math.floor(Math.random()*10000);
let currentRoom = '';

// État synchronisé dans Firebase
const defaultState = {
  round: 1, subRound: 1,
  drawCount: 0,
  deckEmptyAt: 5,
  playersOrder: []
};

// --- Création / Rejoindre partie ---
createRoomBtn.onclick = async () => {
  currentRoom = 'RAMI'+Math.floor(Math.random()*1000);
  await joinRoom(currentRoom);
  await set(ref(db, `rooms/${currentRoom}/state`), defaultState);
  alert(`Salle créée: ${currentRoom}`);
};
joinRoomBtn.onclick = async () => {
  const code = roomInput.value.trim();
  if (!code) return alert('Entrez un code de salle.');
  currentRoom = code;
  await joinRoom(currentRoom);
};
async function joinRoom(room) {
  const pr = ref(db, `rooms/${room}/players/${playerId}`);
  await set(pr, { pseudo });
  onDisconnect(pr).remove();
  menuDiv.style.display = 'none'; gameDiv.style.display = 'block';
  status.innerText = `Salle: ${room} | Vous: ${pseudo}`;
  initListeners(room);
}

// --- Initialisation des listeners ---
function initListeners(room) {
  listenPlayers(room);
  listenHand(room);
  listenTurn(room);
  listenActions(room);
  setupButtons(room);
}

async function listenPlayers(room) {
  onValue(ref(db, `rooms/${room}/players`), async snap => {
    const players = snap.val()||{};
    updatePlayersUI(players);
    const ids = Object.keys(players);
    if (ids.length>=2) {
      const hands = await get(ref(db, `rooms/${room}/hands`));
      if (!hands.exists()) {
        await dealCards(room, ids);
        await set(ref(db, `rooms/${room}/state/playersOrder`), ids);
        await set(ref(db, `rooms/${room}/currentTurn`), ids[0]);
      }
    }
  });
}

function updatePlayersUI(players){playersDiv.innerHTML='';
  Object.entries(players).forEach(([id,p])=>{
    const el=document.createElement('div');
    el.textContent = `${p.pseudo} ${id===playerId?'(Moi)':''}`;
    playersDiv.append(el);
  });
}

function listenHand(room){
  onValue(ref(db, `rooms/${room}/hands/${playerId}`), snap => renderHand(snap.val()||[]));
}
function renderHand(hand){
  handDiv.innerHTML='';
  hand.forEach(c=>{
    const card = document.createElement('div');
    card.className=`card ${c.color}`;
    card.textContent = c.rank + c.symbol;
    card.ondblclick = ()=> discardCard(c.id);
    handDiv.append(card);
  });
}

function listenTurn(room){
  onValue(ref(db, `rooms/${room}/currentTurn`), async snap => {
    const turn = snap.val();
    const state = (await get(ref(db, `rooms/${room}/state`))).val();
    const isMe = turn===playerId;
    drawCardBtn.disabled = !isMe;
    takeDiscardBtn.disabled = !isMe;
    endTurnBtn.disabled = true;
    if (isMe) state.drawCount=0;
    await set(ref(db, `rooms/${room}/state`), state);
    showStatus(`Tour: ${isMe?'Vous⭐':turn}`);
  });
}

function listenActions(room){
  onValue(ref(db, `rooms/${room}/actions`), async snap => {
    const acts = snap.val()||{};
    const last = Object.values(acts).pop(); if(!last) return;
    if (last.type==='WIN') await processWin(last.playerId);
    if (last.type==='7N') showNotification(`${last.playerId} a déclaré 7 Naturel!`);
  });
}

function setupButtons(room){
  drawCardBtn.onclick = ()=> drawCard(room);
  takeDiscardBtn.onclick = ()=> takeDiscard(room);
  endTurnBtn.onclick = ()=> endTurn(room);
  declare7NBtn.onclick= ()=> declare7N(room);
  declareWinBtn.onclick= ()=> declareWin(room);
}

// --- Actions joueurs ---
async function drawCard(room){
  const stRef = ref(db, `rooms/${room}/state`);
  const state = (await get(stRef)).val();
  if (state.drawCount>=1) return alert('Une seule pioche autorisée.');
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  if (hs.length!==13) return alert('Main non valide.');
  const deck = (await get(ref(db, `rooms/${room}/deck`))).val()||[];
  if (!deck.length) return alert('Deck vide');
  const card = deck.shift(); hs.push(card);
  state.drawCount++;
  // Forcer défausse joker? à deckEmptyAt
  if (deck.length <= state.deckEmptyAt) await forceDiscardJoker(room);
  await Promise.all([
    set(ref(db, `rooms/${room}/deck`), deck),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs),
    set(stRef, state)
  ]);
}
async function takeDiscard(room){
  const stRef=ref(db, `rooms/${room}/state`);
  const state=(await get(stRef)).val();
  if(state.drawCount>=1) return alert('Une seule pioche autorisée.');
  const players = Object.keys((await get(ref(db, `rooms/${room}/state/playersOrder`))).val());
  const idx = players.findIndex(id=>id===playerId);
  const prev = players[(idx+players.length-1)%players.length];
  const pile = (await get(ref(db, `rooms/${room}/discard/${prev}`))).val()||[];
  if (!pile.length) return alert('Défausse vide');
  const card = pile.pop();
  const hs = (await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  if (hs.length!==13) return;
  hs.push(card);
  state.drawCount++;
  await Promise.all([
    set(ref(db, `rooms/${room}/discard/${prev}`), pile),
    set(ref(db, `rooms/${room}/hands/${playerId}`), hs),
    set(stRef, state)
  ]);
}
async function discardCard(cardId){
  const hs=(await get(ref(db, `rooms/${currentRoom}/hands/${playerId}`))).val()||[];
  if (hs.length!==14) return alert('Main non valide pour défausse');
  const idx=hs.findIndex(c=>c.id===cardId);
  if(idx<0) return;
  const [card]=hs.splice(idx,1);
  const pile=(await get(ref(db, `rooms/${currentRoom}/discard/${playerId}`))).val()||[];
  pile.push(card);
  await Promise.all([
    set(ref(db, `rooms/${currentRoom}/hands/${playerId}`), hs),
    set(ref(db, `rooms/${currentRoom}/discard/${playerId}`), pile)
  ]);
}
async function endTurn(room){
  const players=Object.keys((await get(ref(db, `rooms/${room}/state/playersOrder`))).val());
  const idx=players.findIndex(id=>id===playerId);
  const next=players[(idx+1)%players.length];
  await set(ref(db, `rooms/${room}/currentTurn`), next);
}

async function declare7N(room){
  const turn=(await get(ref(db, `rooms/${room}/currentTurn`))).val();
  if(turn!==playerId) return alert('Pas ton tour');
  const hand=(await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  const { jokerSet=[] }=(await get(ref(db, `rooms/${room}/jokerSet`))).val()||{};
  if(!Rules.has7Naturel(hand, jokerSet)) return alert('Pas de 7 naturel valide');
  await push(ref(db, `rooms/${room}/actions`), { playerId, type:'7N' });
}
async function declareWin(room){
  const turn=(await get(ref(db, `rooms/${room}/currentTurn`))).val();
  if(turn!==playerId) return alert('Pas ton tour');
  const hand=(await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  const { jokerSet=[] }=(await get(ref(db, `rooms/${room}/jokerSet`))).val()||{};
  if(!Rules.validateWinHand(hand, jokerSet)) return alert('Main non gagnante');
  await push(ref(db, `rooms/${room}/actions`), { playerId, type:'WIN' });
}

// --- Traitement victoire et reset ---
async function processWin(winner){
  const room = currentRoom;
  const state=(await get(ref(db, `rooms/${room}/state`))).val();
  const actions=(await get(ref(db, `rooms/${room}/actions`))).val()||{};
  const has7N = Object.values(actions).some(a=>a.playerId===winner&&a.type==='7N');
  const pts7  = state.subRound * 0.5;
  const pts   = has7N ? pts7 : 1;
  const scrRef = ref(db, `rooms/${room}/scores/${winner}`);
  const cur=(await get(scrRef)).val()||0;
  await set(scrRef, cur+pts);
  showNotification(`${winner} gagne +${pts} pt(s)`);
  // round suivant
  state.subRound++;
  await set(ref(db, `rooms/${room}/state`), state);
  await resetGame(room);
}
async function resetGame(room){
  const players=Object.keys((await get(ref(db, `rooms/${room}/state/playersOrder`))).val());
  for(const id of players){
    await set(ref(db, `rooms/${room}/hands/${id}`), null);
    await set(ref(db, `rooms/${room}/discard/${id}`), null);
  }
  await set(ref(db, `rooms/${room}/deck`), null);
  await set(ref(db, `rooms/${room}/actions`), null);
  await set(ref(db, `rooms/${room}/currentTurn`), null);
  showStatus('Partie terminée.');
}

// --- Deck, jokers, distribution ---
function createDeck(){
  const suits=[{name:'Coeurs',sym:'♥',col:'red'},{name:'Carreaux',sym:'♦',col:'red'},{name:'Trèfles',sym:'♣',col:'black'},{name:'Piques',sym:'♠',col:'black'}];
  const ranks=[{sym:'A',val:1},{sym:'2',val:2},{sym:'3',val:3},{sym:'4',val:4},{sym:'5',val:5},{sym:'6',val:6},{sym:'7',val:7},{sym:'8',val:8},{sym:'9',val:9},{sym:'10',val:10},{sym:'J',val:11},{sym:'Q',val:12},{sym:'K',val:13}];
  let deck=[];
  for(let d=0;d<2;d++) suits.forEach(s=>ranks.forEach(r=>deck.push({suit:s.name, symbol:s.sym, color:s.col, rank:r.sym, value:r.val, id:`${r.sym}${s.sym}${d}`})));
  return deck;
}
function shuffle(d){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*i);[d[i],d[j]]=[d[j],d[i]];}return d;}
async function dealCards(room, players){
  let deck=shuffle(createDeck());
  const joker=deck.splice(Math.floor(Math.random()*deck.length),1)[0];
  // Calcul jokerSet
  const jokerSet = deck.filter(c=>c.value===joker.value && c.color!==joker.color).map(c=>c.id);
  await set(ref(db, `rooms/${room}/joker`), joker);
  await set(ref(db, `rooms/${room}/jokerSet`), { jokerSet });
  if(players.length*13 > deck.length) return alert('Trop de joueurs');
  let idx=0;
  for(let p of players){
    await set(ref(db, `rooms/${room}/hands/${p}`), deck.slice(idx, idx+13));
    await set(ref(db, `rooms/${room}/discard/${p}`), []);
    idx+=13;
  }
  await set(ref(db, `rooms/${room}/deck`), deck.slice(idx));
}

async function forceDiscardJoker(room){
  const hand=(await get(ref(db, `rooms/${room}/hands/${playerId}`))).val()||[];
  const { jokerSet=[] }=(await get(ref(db, `rooms/${room}/jokerSet`))).val()||{};
  const jIdx = hand.findIndex(c=>jokerSet.includes(c.id));
  if(jIdx>=0){
    alert('Vous devez défausser votre joker');
    discardCard(hand[jIdx].id);
  }
}

// --- UI helpers ---
function showStatus(m){ status.innerText=m; }
function showNotification(m){ const n=document.createElement('div');n.className='notif';n.innerText=m;document.body.append(n);
  setTimeout(()=>n.remove(),3000);
}

// --- Init ---
(function init(){ menuDiv.style.display='block'; gameDiv.style.display='none'; })();
