/* ------------------ Multiplayer-ready script.js (updated) ------------------ */

/* ------------------ core game state (unchanged except small UI toggles + timers) ------------------ */
const files = ['a','b','c','d','e','f','g','h'];
const ranks = [8,7,6,5,4,3,2,1];
let state = {
  board: [], turn: 'w', moveCount: 1, selected: null,
  history: [], captured: {w:[], b:[]},
  movedFlags: { wR1:false,wR2:false,wK:false, bR1:false,bR2:false,bK:false },
  hints: true, enPassant: null, halfmoveClock:0,
  // timers in milliseconds
  timers: { w: 10*60*1000, b: 10*60*1000 },
  runningTimer: 'w', // which color's clock is currently running; null if paused/stopped
  ai: null
};

/* Multiplayer state holder (window-scoped for debugging) */
window.mp = {
  localId: null,
  peerId: null,
  connected: false,
  room: null,
  myColor: null, // 'w' or 'b' (which side this client controls)
  socket: null,
  isApplyingRemote: false
};

/* piece values for AI and for time-expiry material comparison (standard simplified) */
const pieceValues = { p:100, n:320, b:330, r:500, q:900, k:20000 };
const materialPoints = { p:1, n:3, b:3, r:5, q:9 }; // used when time expires

/* timer interval control */
let timerIntervalId = null;
let lastTick = null;

/* ---------- helper: format time mm:ss (from ms) ---------- */
function formatTime(ms){
  if(ms < 0) ms = 0;
  const totalSec = Math.floor(ms/1000);
  const mm = Math.floor(totalSec/60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

/* start timer for a color */
function startTimerFor(color){
  // set running indicator
  state.runningTimer = color;
  lastTick = Date.now();
  // update UI immediately
  updateTimerUI();
  // ensure interval running
  if(!timerIntervalId){
    timerIntervalId = setInterval(tickTimers, 200);
  }
}

/* stop all timers (pauses) */
function stopTimers(){
  state.runningTimer = null;
  if(timerIntervalId){ clearInterval(timerIntervalId); timerIntervalId = null; }
  updateTimerUI();
}

/* tick handler — deduct elapsed time from runningTimer and check expiry */
function tickTimers(){
  if(!state.runningTimer) { lastTick = Date.now(); return; }
  const now = Date.now();
  const delta = now - (lastTick || now);
  lastTick = now;
  state.timers[state.runningTimer] -= delta;
  if(state.timers[state.runningTimer] <= 0){
    state.timers[state.runningTimer] = 0;
    updateTimerUI();
    handleTimeExpired(state.runningTimer);
    return;
  }
  updateTimerUI();
}

/* update timer UI elements and running highlight */
function updateTimerUI(){
  const wEl = document.getElementById('timerWhite');
  const bEl = document.getElementById('timerBlack');
  const wBox = document.getElementById('timerWhiteBox');
  const bBox = document.getElementById('timerBlackBox');
  if(wEl) wEl.textContent = formatTime(state.timers.w);
  if(bEl) bEl.textContent = formatTime(state.timers.b);
  if(wBox) {
    if(state.runningTimer === 'w') wBox.classList.add('running'); else wBox.classList.remove('running');
  }
  if(bBox) {
    if(state.runningTimer === 'b') bBox.classList.add('running'); else bBox.classList.remove('running');
  }
}

/* when time expires: decide winner by material sum */
function handleTimeExpired(expiredColor){
  stopTimers();
  // calculate material for both sides
  const mat = calculateMaterialScores();
  const other = expiredColor === 'w' ? 'b' : 'w';
  const otherScore = mat[other];
  const expiredScore = mat[expiredColor];
  const winnerText = (otherScore > expiredScore) ? (other === 'w' ? 'White' : 'Black') : (otherScore < expiredScore ? (expiredColor === 'w' ? 'White':'Black') : 'Draw');
  let reasonText = `Time out — ${expiredColor==='w' ? 'White' : 'Black'}'s clock reached 0.`;
  if(winnerText === 'Draw') reasonText = reasonText + ' বোর্ডের পিস মান সমান — ড্র।';
  else reasonText = reasonText + ` গুটির মানে ${winnerText==='White' ? mat['w'] : mat['b']} vs ${winnerText==='White' ? mat['b'] : mat['w']} — ${winnerText} জিতেছে।`;
  if(winnerText === 'Draw') showWinnerModal('Draw', reasonText);
  else showWinnerModal(winnerText, reasonText);
}

/* compute material scores using materialPoints mapping */
function calculateMaterialScores(){
  const res = { w:0, b:0 };
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = state.board[r][c];
    if(!p) continue;
    const val = materialPoints[p.t] || 0;
    if(p.c === 'w') res.w += val; else res.b += val;
  }
  return res;
}

/* ---------- rendering ---------- */
const gridEl = document.getElementById('grid');
const turnLabel = document.getElementById('turnLabel');
const moveCountEl = document.getElementById('moveCount');
const logArea = document.getElementById('logArea');
const capturedWhite = document.getElementById('captured-white');
const capturedBlack = document.getElementById('captured-black');

const capturedStripWhitePreview = document.getElementById('capturedStripWhitePreview');
const capturedStripBlackPreview = document.getElementById('capturedStripBlackPreview');
const capturedStripWhiteCount = document.getElementById('capturedStripWhiteCount');
const capturedStripBlackCount = document.getElementById('capturedStripBlackCount');

/* Mobile-specific capture containers */
const capturedTopRow = document.getElementById('capturedTopRow');       // top player's under-board container (Black captured)
const capturedBottomRow = document.getElementById('capturedBottomRow'); // bottom player's under-board container (White captured)

function makeCellId(r,c){ return `c${r}${c}` }

function render(){
  gridEl.innerHTML='';
  // set grid sizing via CSS variable -- will auto-resize
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const cell = document.createElement('div');
      cell.className = 'cell ' + (((r+c)%2===0)?'light':'dark');
      cell.id = makeCellId(r,c);
      cell.dataset.r = r; cell.dataset.c = c;
      // coordinate labels only show file on bottom row and rank on left column
      if(c===0 || r===7){
        const coord = document.createElement('div'); coord.className='coords';
        const file = files[c]; const rank = ranks[r];
        coord.textContent = (r===7?file+' ':'') + (c===0?rank:'');
        cell.appendChild(coord);
      }
      gridEl.appendChild(cell);
      cell.addEventListener('click', onCellClick, {passive:true});
      // support keyboard focus
      cell.tabIndex = 0;
      cell.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter' || ev.key===' ') onCellClick({currentTarget:cell}); });
    }
  }
  // add pieces
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const piece = state.board[r][c];
    if(piece){ placePiece(r,c,piece); }
  }
  updateCapturedUI();
  turnLabel.textContent = state.turn==='w'? 'White':'Black';
  moveCountEl.textContent = state.moveCount;
  clearKingCheckMarks();
  const kpos = findKing(state.turn);
  if(kpos){ const enemy = (state.turn==='w')?'b':'w'; if(isSquareAttacked(kpos.r,kpos.c,enemy)){ const cell = document.getElementById(makeCellId(kpos.r,kpos.c)); if(cell) cell.classList.add('check'); }}
  updateTimerUI();
}

function placePiece(r,c,piece){
  const cell = document.getElementById(makeCellId(r,c));
  if(!cell) return;
  const div = document.createElement('div');
  div.className='piece';
  div.draggable=false;
  div.dataset.r=r; div.dataset.c=c;
  div.dataset.t=piece.t; div.dataset.colo=piece.c;
  div.innerHTML = pieceSVG(piece.t,piece.c);
  cell.appendChild(div);
}

/* ---------- realistic Staunton-like SVGs (simplified vectors) ---------- */
function pieceSVG(type,color){
  const light = getComputedStyle(document.documentElement).getPropertyValue('--light-piece').trim() || '#f4ecd8';
  const dark = getComputedStyle(document.documentElement).getPropertyValue('--dark-piece').trim() || '#2f2216';
  const fill = color==='w'? light : dark;
  const stroke = color==='w'? '#333' : '#f3efe6';

  const common = `class="svgwrap" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"`;
  const svgs = {
    p:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><path d="M32 12c-5 0-9 4-9 9 0 3 2 6 5 7v6c-6 2-10 6-10 9h28c0-3-4-7-10-9v-6c3-1 5-4 5-7 0-5-4-9-9-9z"/><path d="M16 52h32v2H16z"/></g></svg>`,
    r:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><rect x="14" y="8" width="36" height="8" rx="1"/><path d="M18 16v6h28v-6"/><path d="M18 22c6 4 12 6 14 18 2-12 8-14 14-18"/><rect x="18" y="40" width="28" height="8" rx="3"/></g></svg>`,
    n:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><path d="M22 44c6 4 18 4 22 0 0-6-6-10-10-12 0-6 4-10 2-14-3-6-14-6-18 2-3 6 2 16 4 22z"/><circle cx="36" cy="20" r="2.2" fill="${stroke}"/></g></svg>`,
    b:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><path d="M32 12c-6 6-10 10-10 18 0 6 4 8 10 12 6-4 10-6 10-12 0-8-4-12-10-18z"/><path d="M22 46h20v2H22z"/><path d="M28 36c4 1 8 1 12 0"/></g></svg>`,
    q:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><path d="M16 12h32v6H16z"/><path d="M12 22c10 6 6 16 20 22 14-6 10-16 20-22"/><path d="M18 44h28v4H18z"/><circle cx="24" cy="16" r="2.4" fill="${stroke}"/><circle cx="40" cy="16" r="2.4" fill="${stroke}"/></g></svg>`,
    k:`<svg ${common}><g fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"><path d="M32 8v10"/><rect x="28" y="4" width="8" height="6" rx="1"/><path d="M20 30c8-6 16-6 24 0-8 4-16 6-24 0z"/><path d="M18 44h28v4H18z"/></g></svg>`
  };
  return svgs[type] || svgs['p'];
}

/* ---------- interaction (same logic, slightly augmented for multiplayer) ---------- */
function onCellClick(e){
  const cell = e.currentTarget;
  const r = +cell.dataset.r; const c = +cell.dataset.c;
  const piece = state.board[r][c];

  // If we're connected multiplayer, block moves for pieces that aren't controlled by this client
  if(window.mp.connected){
    // Allow only when the piece belongs to this client AND it's their turn
    if(piece && piece.c===state.turn && piece.c !== window.mp.myColor){
      updateConnStatus('It\'s opponent\'s turn — you cannot move.', 'error');
      return;
    }
  }

  if(state.selected){
    const sel = state.selected;
    const moves = legalMovesFor(sel.r,sel.c,sel.piece,true);
    const valid = moves.some(m=>m.r===r && m.c===c && !m.invalid);
    if(valid){ moveSelectedTo(r,c); return; }
  }
  if(piece && piece.c===state.turn){
    // additionally, if multiplayer and this piece isn't our color, don't allow selecting
    if(window.mp.connected && piece.c !== window.mp.myColor){ updateConnStatus('Opponent piece — cannot select', 'error'); return; }
    clearHighlights();
    state.selected = {r,c,piece};
    const moves = legalMovesFor(r,c,piece,true);
    highlightCells(moves);
    return;
  }
  clearHighlights(); state.selected=null;
}

function clearHighlights(){
  document.querySelectorAll('.cell').forEach(x=>{ x.classList.remove('highlight','move-target','capture-target') });
}

function highlightCells(moves){
  moves.forEach(m=>{
    const id = makeCellId(m.r,m.c);
    const cell = document.getElementById(id);
    if(!cell) return;
    cell.classList.add('highlight');
    if(m.capture) cell.classList.add('capture-target'); else cell.classList.add('move-target');
  })
}

/* ---------- move execution (augmented to store timers in history and switch clocks) ---------- */
function moveSelectedTo(r,c){
  const sel = state.selected; if(!sel) return; const fromR=sel.r, fromC=sel.c;
  const moves = legalMovesFor(fromR,fromC,sel.piece,true);
  const move = moves.find(m=>m.r===r && m.c===c);
  if(!move) { clearHighlights(); state.selected=null; return; }

  // push history snapshot (include timers & runningTimer)
  state.history.push(JSON.parse(JSON.stringify({
    board:state.board,
    turn:state.turn,
    movedFlags:state.movedFlags,
    captured:state.captured,
    moveCount:state.moveCount,
    enPassant:state.enPassant,
    halfmoveClock:state.halfmoveClock,
    timers: state.timers,
    runningTimer: state.runningTimer
  })));

  const target = state.board[r][c];
  if(move.enPassant){
    const takenR = fromR; const takenC = c;
    const taken = state.board[takenR][takenC];
    if(taken){ state.captured[taken.c].push(taken); state.board[takenR][takenC]=null; }
  }

  state.board[r][c]=sel.piece;
  state.board[fromR][fromC]=null;
  if(sel.piece.t==='p' || target) state.halfmoveClock=0; else state.halfmoveClock++;
  if(sel.piece.t==='k'){
    if(sel.piece.c==='w') state.movedFlags.wK=true; else state.movedFlags.bK=true;
    if(move.castle){
      if(move.castle==='K'){
        if(sel.piece.c==='w'){ state.board[7][5]=state.board[7][7]; state.board[7][7]=null; state.movedFlags.wR2=true; }
        else { state.board[0][5]=state.board[0][7]; state.board[0][7]=null; state.movedFlags.bR2=true; }
      } else {
        if(sel.piece.c==='w'){ state.board[7][3]=state.board[7][0]; state.board[7][0]=null; state.movedFlags.wR1=true; }
        else { state.board[0][3]=state.board[0][0]; state.board[0][0]=null; state.movedFlags.bR1=true; }
      }
    }
  }
  if(sel.piece.t==='r'){
    if(sel.piece.c==='w'){ if(fromR===7 && fromC===0) state.movedFlags.wR1=true; if(fromR===7 && fromC===7) state.movedFlags.wR2=true; }
    else { if(fromR===0 && fromC===0) state.movedFlags.bR1=true; if(fromR===0 && fromC===7) state.movedFlags.bR2=true; }
  }

  if(target){
    handleCaptureAnimation(r,c,target);
    state.captured[ (target.c==='w')? 'w' : 'b' ].push(target);
    log(`${sel.piece.c==='w'?'White':'Black'} ${nameFor(sel.piece.t)} captured ${nameFor(target.t)} at ${files[c]}${ranks[r]}`);
  } else if(move.enPassant){
    log(`${sel.piece.c==='w'?'White':'Black'} Pawn captured en-passant at ${files[c]}${ranks[r]}`);
  } else {
    log(`${sel.piece.c==='w'?'White':'Black'} ${nameFor(sel.piece.t)} moved to ${files[c]}${ranks[r]}`);
  }

  if(sel.piece.t==='p' && Math.abs(r-fromR)===2){
    state.enPassant = { r: (r+fromR)/2, c: c };
  } else {
    state.enPassant = null;
  }

  // promotion — note: showPromotion now accepts from coords so we can emit properly on promotion
  if(sel.piece.t==='p' && (r===0 || r===7)){
    if(state.ai && state.ai.enabled && state.turn===state.ai.color){
      sel.piece.t='q'; log(`Pawn auto-promoted to Queen at ${files[c]}${ranks[r]}`);
    } else {
      // open promotion modal (we'll handle emitting the promotion later when player chooses)
      showPromotion(sel.piece, fromR, fromC, r, c);
      // after promotion modal: the original code swapped turn immediately — keep same behavior
      state.turn = state.turn==='w'? 'b':'w';
      state.moveCount += (state.turn==='w'?1:0);
      state.selected = null; clearHighlights(); render();
      // start opponent timer since turn changed (promotion UI may show while opponent's clock runs)
      startTimerFor(state.turn);
      return;
    }
  }

  // switch turns
  const enemy = state.turn==='w'? 'b':'w';
  state.turn = state.turn==='w'? 'b':'w';
  state.moveCount += (state.turn==='w'?1:0);
  state.selected = null; clearHighlights();
  render();

  // start clock for side to move (i.e., opponent)
  startTimerFor(state.turn);

  // emit this move to peer (if connected and not applying a remote move)
  try{
    if(window.mp.connected && window.mp.socket && !window.mp.isApplyingRemote){
      window.mp.socket.emit('mp:move', {
        room: window.mp.room,
        from: { r: fromR, c: fromC },
        to: { r: r, c: c },
        promotion: move.promotion || null,
        timers: state.timers, runningTimer: state.runningTimer
      });
    }
  }catch(e){ console.warn('mp emit failed', e); }

  const hasMoves = anyLegalMoves(state.turn);
  if(!hasMoves){
    const kingPos = findKing(state.turn);
    const inCheck = kingPos? isSquareAttacked(kingPos.r,kingPos.c, (state.turn==='w'?'b':'w')) : false;
    if(inCheck){ stopTimers(); showWinnerModal((state.turn==='w')? 'Black':'White'); log('Checkmate'); }
    else { stopTimers(); showWinnerModal('Draw'); log('Stalemate (draw)'); }
  } else {
    const kp = findKing(state.turn);
    if(kp && isSquareAttacked(kp.r,kp.c, (state.turn==='w'?'b':'w'))){ log((state.turn==='w'?'White':'Black') + ' is in check'); }
  }
}

/* ---------- promotion (modified to accept from->to so we can emit the promotion decision) ---------- */
function showPromotion(piece, fromR, fromC, toR, toC){
  const modal = document.getElementById('promoModal');
  modal.style.display='flex';
  const title = document.getElementById('promoTitle');
  title.textContent = 'Pawn promoted! কোন পিস নিতে চান?';
  document.querySelectorAll('.promoBtn').forEach(b=>{
    b.onclick = ()=>{
      const p = b.dataset.piece;
      piece.t = p; modal.style.display='none';
      log(`Pawn promoted to ${nameFor(p)} at ${files[toC]}${ranks[toR]}`);
      render();

      // emit promotion choice to peer (if connected)
      try{
        if(window.mp.connected && window.mp.socket){
          window.mp.socket.emit('mp:move', {
            room: window.mp.room,
            from: { r: fromR, c: fromC },
            to: { r: toR, c: toC },
            promotion: p,
            timers: state.timers, runningTimer: state.runningTimer
          });
        }
      }catch(e){ console.warn('mp emit promotion failed', e); }

      const hasMoves = anyLegalMoves(state.turn);
      if(!hasMoves){
        const kingPos = findKing(state.turn);
        const inCheck = kingPos? isSquareAttacked(kingPos.r,kingPos.c, (state.turn==='w'?'b':'w')) : false;
        if(inCheck){ stopTimers(); showWinnerModal((state.turn==='w')? 'Black':'White'); log('Checkmate'); }
        else { stopTimers(); showWinnerModal('Draw'); log('Stalemate (draw)'); }
      }
    }
  });
}

/* ---------- move generation & attack detection (unchanged) ---------- */
function legalMovesFor(r,c,piece,forUI=false){
  const pseudo = pseudoLegalMoves(r,c,piece);
  const legal = [];
  for(const m of pseudo){
    const snap = snapshotState();
    const target = snap.board[m.r][m.c];
    if(m.enPassant){ const takenR = r; const takenC = m.c; snap.board[takenR][takenC]=null; }
    snap.board[m.r][m.c]= {...snap.board[r][c] }; snap.board[r][c]=null;
    if(m.castle){ if(m.castle==='K'){ if(piece.c==='w'){ snap.board[7][5]=snap.board[7][7]; snap.board[7][7]=null; } else { snap.board[0][5]=snap.board[0][7]; snap.board[0][7]=null; } } else { if(piece.c==='w'){ snap.board[7][3]=snap.board[7][0]; snap.board[7][0]=null; } else { snap.board[0][3]=snap.board[0][0]; snap.board[0][0]=null; } } }
    const kingPos = findKingFor(snap, piece.c);
    if(!kingPos) continue;
    const opponent = piece.c==='w'? 'b':'w';
    if(isSquareAttackedFor(snap, kingPos.r, kingPos.c, opponent)){
      // illegal
    } else {
      legal.push(m);
    }
  }
  return legal;
}

function pseudoLegalMoves(r,c,piece){
  const moves=[];
  const dir = piece.c==='w'? -1:1;
  const inBoard = (rr,cc)=> rr>=0 && rr<8 && cc>=0 && cc<8;
  if(piece.t==='p'){
    const fr=r+dir; if(inBoard(fr,c) && !state.board[fr][c]) moves.push({r:fr,c});
    const startRow = piece.c==='w'?6:1; const fr2=r+dir*2;
    if(r===startRow && inBoard(fr2,c) && !state.board[fr][c] && !state.board[fr2][c]) moves.push({r:fr2,c});
    for(const dc of [-1,1]){ const rr=r+dir, cc=c+dc; if(inBoard(rr,cc) && state.board[rr][cc] && state.board[rr][cc].c!==piece.c) moves.push({r:rr,c:cc,capture:true}); }
    if(state.enPassant){ if(Math.abs(state.enPassant.c - c)===1 && state.enPassant.r===r+dir){ moves.push({r:state.enPassant.r,c:state.enPassant.c,enPassant:true,capture:true}); } }
  }
  if(piece.t==='n'){
    const deltas=[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
    deltas.forEach(d=>{ const rr=r+d[0], cc=c+d[1]; if(inBoard(rr,cc)){ const t=state.board[rr][cc]; if(!t) moves.push({r:rr,c:cc}); else if(t.c!==piece.c) moves.push({r:rr,c:cc,capture:true}); }});
  }
  if(piece.t==='b' || piece.t==='q' || piece.t==='r'){
    const dirs = [];
    if(piece.t==='b' || piece.t==='q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
    if(piece.t==='r' || piece.t==='q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
    dirs.forEach(d=>{
      let rr=r+d[0], cc=c+d[1];
      while(inBoard(rr,cc)){
        const t = state.board[rr][cc];
        if(!t) moves.push({r:rr,c:cc}); else { if(t.c!==piece.c) moves.push({r:rr,c:cc,capture:true}); break; }
        rr+=d[0]; cc+=d[1];
      }
    })
  }
  if(piece.t==='k'){
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){ if(dr===0 && dc===0) continue; const rr=r+dr, cc=c+dc; if(inBoard(rr,cc)){ const t=state.board[rr][cc]; if(!t) moves.push({r:rr,c:cc}); else if(t.c!==piece.c) moves.push({r:rr,c:cc,capture:true}); }}
    if(piece.c==='w' && r===7 && c===4 && !state.movedFlags.wK){
      if(!state.movedFlags.wR2 && !state.board[7][5] && !state.board[7][6]) moves.push({r:7,c:6,castle:'K'});
      if(!state.movedFlags.wR1 && !state.board[7][3] && !state.board[7][2] && !state.board[7][1]) moves.push({r:7,c:2,castle:'Q'});
    }
    if(piece.c==='b' && r===0 && c===4 && !state.movedFlags.bK){
      if(!state.movedFlags.bR2 && !state.board[0][5] && !state.board[0][6]) moves.push({r:0,c:6,castle:'K'});
      if(!state.movedFlags.bR1 && !state.board[0][3] && !state.board[0][2] && !state.board[0][1]) moves.push({r:0,c:2,castle:'Q'});
    }
  }
  return moves;
}

function isSquareAttacked(r,c,byColor){ return isSquareAttackedFor(state,r,c,byColor); }
function isSquareAttackedFor(st, r, c, byColor){
  const inBoard = (rr,cc)=> rr>=0 && rr<8 && cc>=0 && cc<8;
  const pawnDir = (byColor==='w')? -1:1;
  for(const dc of [-1,1]){ const rr = r - pawnDir; const cc = c + dc; if(inBoard(rr,cc) && st.board[rr][cc] && st.board[rr][cc].t==='p' && st.board[rr][cc].c===byColor) return true; }
  const nd = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  for(const d of nd){ const rr=r+d[0], cc=c+d[1]; if(inBoard(rr,cc) && st.board[rr][cc] && st.board[rr][cc].t==='n' && st.board[rr][cc].c===byColor) return true; }
  const diags = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for(const d of diags){ let rr=r+d[0], cc=c+d[1]; while(inBoard(rr,cc)){ const p = st.board[rr][cc]; if(p){ if(p.c===byColor && (p.t==='b' || p.t==='q')) return true; else break; } rr+=d[0]; cc+=d[1]; } }
  const strs = [[1,0],[-1,0],[0,1],[0,-1]];
  for(const d of strs){ let rr=r+d[0], cc=c+d[1]; while(inBoard(rr,cc)){ const p = st.board[rr][cc]; if(p){ if(p.c===byColor && (p.t==='r' || p.t==='q')) return true; else break; } rr+=d[0]; cc+=d[1]; } }
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){ if(dr===0 && dc===0) continue; const rr=r+dr, cc=c+dc; if(inBoard(rr,cc) && st.board[rr][cc] && st.board[rr][cc].t==='k' && st.board[rr][cc].c===byColor) return true; }
  return false;
}

function snapshotState(){
  return { board: JSON.parse(JSON.stringify(state.board)), movedFlags: JSON.parse(JSON.stringify(state.movedFlags)), enPassant: state.enPassant };
}
function isSquareAttackedForSnap(snap, r,c, byColor){ return isSquareAttackedFor({board:snap.board}, r,c, byColor); }

function findKing(color){ return findKingFor(state, color); }
function findKingFor(st, color){ for(let r=0;r<8;r++) for(let c=0;c<8;c++){ const p = st.board[r][c]; if(p && p.t==='k' && p.c===color) return {r,c}; } return null; }

function anyLegalMoves(color){
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = state.board[r][c]; if(!p || p.c!==color) continue;
    const moves = legalMovesFor(r,c,p);
    if(moves.length>0) return true;
  }
  return false;
}

/* ---------- capture animation (lightweight) ---------- */
function handleCaptureAnimation(r,c,target){
  const cell = document.getElementById(makeCellId(r,c));
  const pieceEl = cell.querySelector('.piece');
  if(!pieceEl) return;
  const floating = pieceEl.cloneNode(true);
  floating.style.position='absolute';
  const gridRect = gridEl.getBoundingClientRect();
  const fromRect = pieceEl.getBoundingClientRect();
  floating.style.left = (fromRect.left - gridRect.left) + 'px';
  floating.style.top = (fromRect.top - gridRect.top) + 'px';
  floating.style.width = pieceEl.offsetWidth+'px';
  floating.style.height = pieceEl.offsetHeight+'px';
  floating.style.zIndex = 9999;
  floating.classList.add('flying');
  gridEl.appendChild(floating);

  const dest = (target.c==='w')? capturedWhite : capturedBlack;
  const destRect = dest.getBoundingClientRect();
  const tx = (destRect.left + 8) - fromRect.left;
  const ty = (destRect.top + 8) - fromRect.top;
  floating.animate([
    { transform: 'translate(0,0) scale(1)', opacity:1 },
    { transform: `translate(${tx*0.6}px, ${ty*0.6}px) scale(1.04)`, opacity:1 },
    { transform: `translate(${tx}px, ${ty}px) scale(0.6)`, opacity:0.95 }
  ], {duration:680, easing:'cubic-bezier(.2,.9,.2,1)'});

  setTimeout(()=>{
    const small = document.createElement('div'); small.className='small-piece'; small.innerHTML = pieceSVG(target.t,target.c);
    dest.appendChild(small);
    floating.remove();
    // also update captured strip preview and mobile containers
    updateCapturedUI();
  },700);
}

/* ---------- utilities ---------- */
function nameFor(t){ return {'p':'Pawn','n':'Knight','b':'Bishop','r':'Rook','q':'Queen','k':'King'}[t] }
function log(msg){ const el = document.createElement('div'); el.textContent = msg; logArea.prepend(el); }

/* Update captured UI (both sidebars, mobile top/bottom and captured strip) */
function updateCapturedUI(){
  // sidebars (desktop)
  capturedWhite.innerHTML=''; capturedBlack.innerHTML='';
  state.captured.w.forEach(p=>{
    const d=document.createElement('div'); d.className='small-piece'; d.innerHTML=pieceSVG(p.t,p.c); capturedWhite.appendChild(d);
  });
  state.captured.b.forEach(p=>{
    const d=document.createElement('div'); d.className='small-piece'; d.innerHTML=pieceSVG(p.t,p.c); capturedBlack.appendChild(d);
  });

  // captured strip (tablet / fallback)
  capturedStripWhitePreview && (capturedStripWhitePreview.innerHTML='');
  capturedStripBlackPreview && (capturedStripBlackPreview.innerHTML='');
  (capturedStripWhiteCount) && (capturedStripWhiteCount.textContent = state.captured.w.length);
  (capturedStripBlackCount) && (capturedStripBlackCount.textContent = state.captured.b.length);

  state.captured.w.slice(-6).forEach(p=>{
    if(capturedStripWhitePreview){
      const d=document.createElement('div'); d.className='small-piece'; d.style.width='34px'; d.style.height='34px'; d.innerHTML=pieceSVG(p.t,p.c);
      capturedStripWhitePreview.appendChild(d);
    }
  });
  state.captured.b.slice(-6).forEach(p=>{
    if(capturedStripBlackPreview){
      const d=document.createElement('div'); d.className='small-piece'; d.style.width='34px'; d.style.height='34px'; d.innerHTML=pieceSVG(p.t,p.c);
      capturedStripBlackPreview.appendChild(d);
    }
  });

  // MOBILE: populate the top/bottom under-board areas
  if(capturedTopRow && capturedBottomRow){
    capturedTopRow.innerHTML = '';
    capturedBottomRow.innerHTML = '';

    // top = Black captured (we'll show last up-to-6)
    state.captured.b.slice(-6).forEach(p=>{
      const d = document.createElement('div'); d.className='small-piece'; d.style.width='34px'; d.style.height='34px'; d.innerHTML = pieceSVG(p.t,p.c);
      capturedTopRow.appendChild(d);
    });

    // bottom = White captured
    state.captured.w.slice(-6).forEach(p=>{
      const d = document.createElement('div'); d.className='small-piece'; d.style.width='34px'; d.style.height='34px'; d.innerHTML = pieceSVG(p.t,p.c);
      capturedBottomRow.appendChild(d);
    });

    // ARIA visibility toggle for small screens only
    const smallScreen = window.matchMedia && window.matchMedia('(max-width:640px)').matches;
    document.getElementById('capturedTopMobile').setAttribute('aria-hidden', !smallScreen);
    document.getElementById('capturedBottomMobile').setAttribute('aria-hidden', !smallScreen);
  }
}

function clearKingCheckMarks(){ document.querySelectorAll('.cell').forEach(x=> x.classList.remove('check')); }

/* ---------- controls ---------- */
document.getElementById('restart').addEventListener('click', ()=>{ init(); log('Game restarted'); });
document.getElementById('undo').addEventListener('click', ()=>{ 
  if(state.history.length) { 
    const prev = state.history.pop(); 
    state.board = prev.board; state.turn = prev.turn; state.movedFlags = prev.movedFlags; state.captured = prev.captured; state.moveCount = prev.moveCount; state.enPassant = prev.enPassant; state.halfmoveClock = prev.halfmoveClock || 0; 
    // restore timers & runningTimer
    if(prev.timers){ state.timers = prev.timers; } 
    if(prev.runningTimer){ state.runningTimer = prev.runningTimer; } else state.runningTimer = null;
    render(); log('Undo performed'); 
    // resume clock for the side indicated by runningTimer (or default to side to move)
    if(state.runningTimer) startTimerFor(state.runningTimer); else startTimerFor(state.turn);
  } 
});
const hintsBtn = document.getElementById('toggleHints'); hintsBtn.addEventListener('click', ()=>{ state.hints = !state.hints; hintsBtn.textContent = 'Hints: ' + (state.hints? 'ON':'OFF'); });

/* sidebars toggle for small screens */
const sideLeft = document.getElementById('sideLeft'), sideRight = document.getElementById('sideRight');
document.getElementById('toggleSides').addEventListener('click', ()=>{
  const visible = sideLeft.style.display !== 'none';
  sideLeft.style.display = visible? 'none':'block';
  sideRight.style.display = visible? 'none':'block';
  document.getElementById('toggleSides').textContent = visible? 'Show Sidebars':'Hide Sidebars';
});

/* ---------- AI opponent (unchanged logic but improved control binding) ---------- */
state.ai = { enabled:false, color:'b', thinking:false };

const aiBtn = document.getElementById('toggleAI');
const aiColorSelect = document.getElementById('aiColorSelect');
aiBtn.addEventListener('click', ()=>{
  state.ai.enabled = !state.ai.enabled;
  aiBtn.textContent = 'AI: ' + (state.ai.enabled? 'ON':'OFF');
  state.ai.color = aiColorSelect.value;
  // if enabling and it's AI's turn, let it think (its clock will be running)
  if(state.ai.enabled && state.turn===state.ai.color) { /* tick will invoke aiMakeMove by periodic check below */ }
});
aiColorSelect.addEventListener('change', ()=>{ state.ai.color = aiColorSelect.value; });

function aiMakeMove(){
  if(!state.ai.enabled) return; if(state.ai.thinking) return; state.ai.thinking = true;
  const color = state.ai.color;
  const candidates = [];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const piece = state.board[r][c]; if(!piece || piece.c!==color) continue;
    const moves = legalMovesFor(r,c,piece,true);
    for(const m of moves){
      const target = state.board[m.r][m.c];
      const capVal = target? pieceValues[target.t] || 0 : 0;
      candidates.push({fromR:r,fromC:c,toR:m.r,toC:m.c,captureValue:capVal,move: m, pieceType: piece.t});
    }
  }
  if(candidates.length===0){ state.ai.thinking=false; return; }

  let chosen;
  const caps = candidates.filter(x=>x.captureValue>0);
  if(caps.length>0){
    caps.sort((a,b)=>{ if(b.captureValue!==a.captureValue) return b.captureValue-a.captureValue; return (pieceValues[a.pieceType] || 0) - (pieceValues[b.pieceType] || 0); });
    chosen = caps[0];
  } else {
    candidates.sort((a,b)=>{ return (pieceValues[b.pieceType]||0) - (pieceValues[a.pieceType]||0); });
    const topN = Math.max(1, Math.floor(candidates.length * 0.25));
    const pool = candidates.slice(0, topN);
    chosen = pool[Math.floor(Math.random()*pool.length)];
  }

  // AI thinking delay — note: timers are running while AI thinks (its clock will decrement)
  setTimeout(()=>{
    state.selected = { r: chosen.fromR, c: chosen.fromC, piece: state.board[chosen.fromR][chosen.fromC] };
    try{ moveSelectedTo(chosen.toR, chosen.toC); } catch(e){ console.error('AI move failed', e); }
    state.ai.thinking = false;
  }, 420 + Math.floor(Math.random()*420));
}

/* periodic check to auto-trigger AI when it's its turn and clock is running */
setInterval(()=>{
  if(state.ai.enabled && state.turn===state.ai.color && !state.ai.thinking){ aiMakeMove(); }
}, 650);

/* ---------- init ---------- */
function initialBoard(){
  const empty = Array(8).fill(null).map(()=>Array(8).fill(null));
  const p = (t,c)=>({t,c});
  const back = ['r','n','b','q','k','b','n','r'];
  for(let i=0;i<8;i++){ empty[1][i]=p('p','b'); empty[6][i]=p('p','w'); }
  for(let i=0;i<8;i++){ empty[0][i]=p(back[i],'b'); empty[7][i]=p(back[i],'w'); }
  return empty;
}

function init(){ 
  state.board = initialBoard(); state.turn='w'; state.moveCount=1; state.selected=null; state.history=[]; state.captured={w:[],b:[]}; state.movedFlags={wR1:false,wR2:false,wK:false,bR1:false,bR2:false,bK:false}; state.enPassant=null; state.halfmoveClock=0;
  // reset timers to 10 minutes each
  state.timers = { w: 10*60*1000, b: 10*60*1000 };
  state.runningTimer = 'w';
  stopTimers();
  startTimerFor('w'); // white to start
  logArea.innerHTML=''; render(); 
}

/* ---------- Winner modal handling ---------- */
function showWinnerModal(winner, reason = null){
  const modal = document.getElementById('winnerModal');
  const text = document.getElementById('winnerText');
  const sub = document.getElementById('winnerSub');
  if(winner==='Draw'){ text.textContent = 'ড্র'; sub.textContent = reason || 'গেম ড্র হয়েছে। আবার চেষ্টা করবেন?'; }
  else { text.textContent = 'অভিনন্দন — ' + (winner==='White'? 'সাদা (White)':'কালো (Black)') + ' জিতেছে!'; sub.textContent = reason || 'আপনি কি আরেকটি গেম খেলতে চান?'; }
  modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
  stopTimers();

  document.getElementById('playAgainBtn').onclick = ()=>{ modal.style.display='none'; modal.setAttribute('aria-hidden','true'); init(); };
  document.getElementById('closeModalBtn').onclick = ()=>{ modal.style.display='none'; modal.setAttribute('aria-hidden','true'); };
}

/* ---------- small helpers for accessibility ---------- */
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ const pm = document.getElementById('promoModal'); if(pm.style.display==='flex'){ pm.style.display='none'; } const wm = document.getElementById('winnerModal'); if(wm.style.display==='flex'){ wm.style.display='none'; } } });

/* -------------------- Multiplayer helpers & socket handling -------------------- */
function makeLocalId(len=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid ambiguous chars
  let s=''; for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)]; return s;
}

function updateConnStatus(txt, cls=''){
  const el = document.getElementById('connStatus');
  if(!el) return;
  el.textContent = 'Status: ' + txt;
  el.classList.remove('connected','matching','error');
  if(cls) el.classList.add(cls);
}

function setupMultiplayer(){
  // populate local id
  const localId = makeLocalId();
  window.mp.localId = localId;
  const yourIdEl = document.getElementById('your-id'); if(yourIdEl) yourIdEl.textContent = localId;

  // copy button
  const copyBtn = document.getElementById('copyIdBtn'); if(copyBtn){ copyBtn.addEventListener('click', ()=>{ navigator.clipboard?.writeText(localId).then(()=>{ updateConnStatus('Copied your ID', 'connected'); setTimeout(()=>{ updateConnStatus('Not connected'); },900); }).catch(()=>{ updateConnStatus('Copy failed', 'error'); }); }); }

  // connect/disconnect
  const connectBtn = document.getElementById('connect-btn'); const disconnectBtn = document.getElementById('disconnect-btn');
  connectBtn && connectBtn.addEventListener('click', ()=>{ const peer = document.getElementById('peer-id-input').value.trim().toUpperCase(); if(!peer){ updateConnStatus('Enter peer ID first','error'); return; } if(peer===window.mp.localId){ updateConnStatus('Cannot connect to your own ID','error'); return; } connectToPeer(peer); });
  disconnectBtn && disconnectBtn.addEventListener('click', ()=>{ disconnectFromPeer(); });

  // try to init socket.io (graceful if not available)
  try{
    if(typeof io === 'function'){
      const sock = io();
      window.mp.socket = sock;

      sock.on('connect', ()=>{ updateConnStatus('Connected to server'); sock.emit('mp:register',{id: window.mp.localId}); });

      sock.on('mp:registered', (d)=>{ /* server ack */ });

      // incoming connection request (someone clicked connect to our ID)
      sock.on('mp:request', (data)=>{
        if(!data || data.to !== window.mp.localId) return;
        // auto-accept for now
        const peer = data.from;
        const room = [window.mp.localId, peer].sort().join('-');
        sock.emit('mp:accept', { from: window.mp.localId, to: peer, room });
        finalizeConnection(peer, room);
      });

      sock.on('mp:accepted', (data)=>{
        // peer accepted our request
        if(!data) return;
        if(data.to === window.mp.localId && data.from){
          const peer = data.from; const room = data.room || [window.mp.localId, peer].sort().join('-');
          finalizeConnection(peer, room);
        }
      });

      // general room join confirmation (server might echo)
      sock.on('mp:joined', (data)=>{ /* optional */ });

      // receive move from peer
      sock.on('mp:move', (data)=>{
        if(!data || !window.mp.room) return;
        // ensure this belongs to our room
        if(data.room && data.room !== window.mp.room) return;
        // apply remote move
        applyRemoteMove(data);
      });

      sock.on('disconnect', ()=>{ updateConnStatus('Server disconnected','error'); });
    } else {
      updateConnStatus('No multiplayer server (socket.io not found)','error');
    }
  }catch(e){ console.warn('socket.io init failed', e); updateConnStatus('Multiplayer initialization failed','error'); }
}

function connectToPeer(peerId){
  if(!window.mp.socket){ updateConnStatus('No server connection available','error'); return; }
  updateConnStatus('Sending request...','matching');
  // ask server to connect us to peerId
  window.mp.socket.emit('mp:request', { from: window.mp.localId, to: peerId });
}

function finalizeConnection(peerId, room){
  window.mp.peerId = peerId; window.mp.room = room; window.mp.connected = true;
  // decide color deterministically so both clients agree: lexicographic order
  window.mp.myColor = (window.mp.localId < window.mp.peerId) ? 'w' : 'b';
  updateConnStatus('Connected — peer: '+peerId, 'connected');
  document.getElementById('connect-btn')?.classList.add('hidden');
  document.getElementById('disconnect-btn')?.classList.remove('hidden');
  document.getElementById('peer-id-input').disabled = true;

  // join room on server
  try{ window.mp.socket.emit('mp:join', { room: room, id: window.mp.localId }); }catch(e){}

  // sync timers & state minimal (server-based sync would be more robust) — here we just send current timers
  try{ window.mp.socket.emit('mp:sync', { room: room, id: window.mp.localId, timers: state.timers, runningTimer: state.runningTimer }); }catch(e){}

  // if it's not our color to move, don't allow local moves for the other side (onCellClick already blocks selection)
  log('Multiplayer connected — you are ' + (window.mp.myColor==='w'? 'White':'Black'));
}

function disconnectFromPeer(){
  if(window.mp.socket && window.mp.room){ try{ window.mp.socket.emit('mp:leave', { room: window.mp.room, id: window.mp.localId }); }catch(e){} }
  window.mp.peerId = null; window.mp.room = null; window.mp.connected = false; window.mp.myColor = null;
  updateConnStatus('Not connected');
  document.getElementById('connect-btn')?.classList.remove('hidden');
  document.getElementById('disconnect-btn')?.classList.add('hidden');
  document.getElementById('peer-id-input').disabled = false;
  log('Disconnected from multiplayer');
}

function applyRemoteMove(data){
  if(!data || !data.from || !data.to) return;
  // set a flag to avoid re-emitting the move when we apply it locally
  window.mp.isApplyingRemote = true;
  try{
    // optionally sync clocks if data.timers provided
    if(data.timers){ state.timers = data.timers; if(typeof data.runningTimer !== 'undefined') state.runningTimer = data.runningTimer; updateTimerUI(); }

    // set selected to remote's from coords and perform the move
    const fr = data.from.r, fc = data.from.c, tr = data.to.r, tc = data.to.c;
    state.selected = { r: fr, c: fc, piece: state.board[fr][fc] };
    // if promotion provided, we'll set move.promotion via a small wrapper to avoid hitting the promotion modal
    try{
      moveSelectedTo(tr, tc);
      if(data.promotion){
        // remote already applied promotion by sending promotion in the move (we apply it locally by setting the piece type at destination)
        const dest = state.board[tr][tc]; if(dest) dest.t = data.promotion; render();
      }
    }catch(e){ console.error('applyRemoteMove failed', e); }
  }finally{
    window.mp.isApplyingRemote = false;
  }
}

/* ---------- controls already bound earlier; now initialize multiplayer and game ---------- */
setupMultiplayer();
init();

/* ---------- small server-note (not included here): you'll need a small Socket.IO server that:
  - listens for mp:register (map socket -> id)
  - on mp:request: if peer is online, forward mp:request to peer
  - on mp:accept: forward mp:accepted to requester, and join both sockets into provided room
  - on mp:join/mp:leave: add/remove socket to room
  - on mp:move: broadcast to the room (except sender)
  - on disconnect: cleanup mapping

  I can generate the server.js + package.json for Express + Socket.IO if you want — tell me and I'll add it.
*/
