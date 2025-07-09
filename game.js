// game.js
import { db, ref, set, update, get, onValue, onDisconnect, push, remove } from './firebase.js';
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
      const vals = byColor[suit].sort((a,b)=>a-b);
      for (let i = 0; i <= vals.length-len; i++) {
        let ok = true;
        for (let j = 1; j < len; j++) {
          if (vals[i+j] !== vals[i]+j) { ok = false; break; }
        }
        if (ok) return true;
      }
    }
    return false;
  },
  has7Naturel(hand) {
    return (this.isQuadri(hand) && this.isEscalier(hand,3))
        || (this.isEscalier(hand,4) && this.isTri(hand));
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
    { symbol:'A',value:1 },{symbol:'2',value:2},{symbol:'3',value:3},
    { symbol:'4',value:4 },{symbol:'5',value:5},{symbol:'6',value:6},
    { symbol:'7',value:7 },{symbol:'8',value:8},{symbol:'9',value:9},
    { symbol:'10',value:10 },{symbol:'J',value:11},{symbol:'Q',value:12},{symbol:'K',value:13}
  ];
  let deck = [];
  for (let d=0; d<2; d++) {
    suits.forEach(s => ranks.forEach(r => {
      deck.push({ ...s, rank:r.symbol, value:r.value, id:`${r.symbol}${s.symbol}${d}` });
    }));
  }
  return deck;
}
function shuffle(deck) {
  for (let i=deck.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

// ----------------------------------------------------------
// Distribue et initialise jokers + mains
async function dealCards(room, players) {
  let deck = shuffle(createDeck());
  // Tire le joker
  const jokerCard = deck.splice(Math.floor(Math.random()*deck.length),1)[0];
  // Détermine l'ensemble des jokers (même valeur, couleur opposée)
  const jokerSet = deck
    .filter(c=>c.value===jokerCard.value && c.color!==jokerCard.color)
    .map(c=>c.id);
  await set(ref(db,`rooms/${room}/jokerSet`),{jokerSet});
  // Distribue 13 cartes
  let idx=0;
  for (const p of players) {
    const hand = deck.slice(idx,idx+13);
    await set(ref(db,`rooms/${room}/hands/${p}`),hand);
    await set(ref(db,`rooms/${room}/discard/${p}`),[]);
    idx+=13;
  }
  // Stocke le jokerCard pour affichage
  await set(ref(db, `rooms/${room}/jokerCard`), jokerCard);
  await set(ref(db,`rooms/${room}/deck`),deck.slice(idx));
}

function showJoker(jokerCard) {
  const jokerDiv = document.getElementById('joker');
  if (jokerDiv && jokerCard) {
    jokerDiv.innerHTML = `<div class="card ${jokerCard.color}">JOKER : ${jokerCard.rank}${jokerCard.symbol}</div>`;
  }
}

// --- DOM & état ---
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn   = document.getElementById('joinRoom');
const roomInput     = document.getElementById('roomCodeInput');
const status        = document.getElementById('status');
const playersDiv    = document.getElementById('players');
const playerHandDiv = document.getElementById('hand');
const declare7NBtn  = document.getElementById('declare7N');
const declareWinBtn = document.getElementById('declareWin');
const drawCardBtn   = document.getElementById('drawCard');
const endTurnBtn    = document.getElementById('endTurn');
const menuDiv       = document.getElementById('menu');
const gameDiv       = document.getElementById('game');

const pseudo   = prompt("Entrez votre pseudo :") || 'Anonyme';
const playerId = 'player_' + Math.floor(Math.random()*10000);
let currentRoom = '';

// --- Popup générique ---
function showPopup(content) {
  const m=document.createElement('div');
  m.className='modal';
  m.innerHTML=`<div class="modal-content">${content}<button class="modal-close">Fermer</button></div>`;
  document.body.append(m);
  m.querySelector('.modal-close').onclick=()=>m.remove();
}

// --- Drag&Drop ---
function enableDragDrop() {
  Sortable.create(playerHandDiv,{ animation:150, dataIdAttr:'data-card-id', onEnd:()=>{} });
}

// --- UI joueurs & scores ---
function renderPlayers(players){
  playersDiv.innerHTML='';
  players.forEach(p=>{
    const b=document.createElement('div');
    b.className='player-badge'; b.id=`badge-${p.id}`;
    b.innerHTML=`
      <div class="player-name">${p.pseudo}</div>
      <div class="mini-discard" id="discard-${p.id}"></div>
      <div class="player-score" id="score-${p.id}">Score: 0</div>`;
    playersDiv.append(b);
  });
}
function listenPlayers(room){
  onValue(ref(db,`rooms/${room}/players`),snap=>{
    const list=Object.entries(snap.val()||{}).map(([id,o])=>({id,pseudo:o.pseudo}));
    renderPlayers(list);
  });
  onValue(ref(db,`rooms/${room}/scores`),snap=>{
    const sc=snap.val()||{};
    for(const id in sc){ const el=document.getElementById(`score-${id}`); if(el) el.textContent=`Score: ${sc[id]}`; }
  });
}

// --- Tour automatique ---
function listenTurn(room){
  onValue(ref(db,`rooms/${room}/turn`),snap=>{
    const t=snap.val(), me=(t===playerId);
    drawCardBtn.disabled=!me; declare7NBtn.disabled=!me;
    declareWinBtn.disabled=!me; endTurnBtn.disabled=!me;
    status.innerText=me?'⭐ C’est votre tour !':'En attente du tour...';
  });
}
async function endTurn(room){
  const ps=await get(ref(db,`rooms/${room}/players`));
  const ids=Object.keys(ps.val()||{});
  const cur=await get(ref(db,`rooms/${room}/turn`));
  const idx=ids.indexOf(cur.val()); const next=ids[(idx+1)%ids.length];
  await set(ref(db,`rooms/${room}/turn`),next);
}

// --- Défausse & main ---
function listenDiscard(room){
  onValue(ref(db,`rooms/${room}/discard`),snap=>{
    const all=snap.val()||{};
    Object.entries(all).forEach(([pid,pile])=>{
      const z=document.getElementById(`discard-${pid}`); if(!z) return;
      z.innerHTML=pile.slice(-3).map(c=>`<div class="mini-card ${c.color}">${c.rank}</div>`).join('');
    });
  });
}
function listenHand(room){
  onValue(ref(db,`rooms/${room}/hands/${playerId}`),snap=>{ renderHand(snap.val()||[]); });
}
function renderHand(hand){
  playerHandDiv.innerHTML='';
  hand.forEach(c=>{
    const d=document.createElement('div'); d.className=`card ${c.color}`;
    d.textContent=c.rank+c.symbol; d.dataset.cardId=c.id;
    playerHandDiv.append(d);
  });
}

// --- Piocher une carte & gestion Joker obligatoire ---
async function drawCard(room){
  const stRef=ref(db,`rooms/${room}/state`);
  const st=(await get(stRef)).val()||{}; st.drawCount=st.drawCount||0;
  if(st.drawCount>=1) return alert('Une seule pioche par tour.');
  const [deckSnap,handSnap,jokSnap,plSnap]=await Promise.all([
    get(ref(db,`rooms/${room}/deck`)),
    get(ref(db,`rooms/${room}/hands/${playerId}`)),
    get(ref(db,`rooms/${room}/jokerSet`)),
    get(ref(db,`rooms/${room}/players`))
  ]);
  const deck=deckSnap.val()||[], hand=handSnap.val()||[],
        jokerSet=jokSnap.val()?.jokerSet||[], players=Object.keys(plSnap.val()||{});
  if(deck.length===0) return alert('Deck vide.');
  const card=deck.shift(); hand.push(card); st.drawCount++;
  if(deck.length<=players.length){
    const i=hand.findIndex(c=>jokerSet.includes(c.id));
    if(i>=0){
      const [jok]=hand.splice(i,1);
      const pileRef=ref(db,`rooms/${room}/discard/${playerId}`);
      const pile=(await get(pileRef)).val()||[]; pile.push(jok);
      await set(pileRef,pile);
      alert('Vous devez défausser votre joker !');
    }
  }
  await Promise.all([
    set(ref(db,`rooms/${room}/deck`),deck),
    set(ref(db,`rooms/${room}/hands/${playerId}`),hand),
    set(stRef,st)
  ]);
}

// --- Création / Rejoindre partie ---
async function createRoom(){
  currentRoom='RAMI'+Math.floor(Math.random()*1000);
  await set(ref(db,`rooms/${currentRoom}/players/${playerId}`),{pseudo});
  await set(ref(db,`rooms/${currentRoom}/scores/${playerId}`),0);
  await set(ref(db,`rooms/${currentRoom}/state`),{started:false,drawCount:0});
  await set(ref(db,`rooms/${currentRoom}/turn`),playerId);
  await dealCards(currentRoom,[playerId]);
  menuDiv.style.display='none'; gameDiv.style.display='block';
  status.innerText=`Salle: ${currentRoom} | Vous: ${pseudo}`;
  showPopup(`<h3>Salle créée</h3><p>Code: <b>${currentRoom}</b></p>`);
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap=>{ showJoker(snap.val()); });
}
async function joinRoom(){
  const code=roomInput.value.trim(); if(!code) return alert('Code invalide');
  currentRoom=code;
  await set(ref(db,`rooms/${currentRoom}/players/${playerId}`),{pseudo});
  await set(ref(db,`rooms/${currentRoom}/scores/${playerId}`),0);
  await update(ref(db,`rooms/${currentRoom}/state`),{drawCount:0});
  await dealCards(currentRoom,[playerId]);
  menuDiv.style.display='none'; gameDiv.style.display='block';
  status.innerText=`Salle: ${currentRoom} | Vous: ${pseudo}`;
  listenPlayers(currentRoom);
  listenDiscard(currentRoom);
  listenHand(currentRoom);
  listenTurn(currentRoom);
  onValue(ref(db, `rooms/${currentRoom}/jokerCard`), snap=>{ showJoker(snap.val()); });
}

// --- Discard à clic ---
function enableCardDiscard(){
  playerHandDiv.addEventListener('click', async e=>{
    const c=e.target.closest('.card');
    if(!c || !endTurnBtn.disabled) return;
    const id=c.dataset.cardId;
    const handRef=ref(db,`rooms/${currentRoom}/hands/${playerId}`);
    let hand=(await get(handRef)).val()||[];
    const card=hand.find(x=>x.id===id);
    hand=hand.filter(x=>x.id!==id);
    await set(handRef,hand);
    const dr=ref(db,`rooms/${currentRoom}/discard/${playerId}`);
    let pile=(await get(dr)).val()||[];
    pile.push(card);
    await set(dr,pile);
    await endTurn(currentRoom);
  });
}

// --- Init ---
function init(){
  enableDragDrop();
  createRoomBtn.onclick=createRoom;
  joinRoomBtn.onclick=joinRoom;
  drawCardBtn.onclick=()=>drawCard(currentRoom);
  endTurnBtn.onclick=()=>endTurn(currentRoom);
  declare7NBtn.onclick=()=>declare7N(currentRoom);
  declareWinBtn.onclick=()=>declareWin(currentRoom);
  enableCardDiscard();
}
window.addEventListener('load',init);
