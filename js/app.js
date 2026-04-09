/**
 * CHESSMASTER PRO — MAIN APPLICATION
 * Board rendering, game logic, UI wiring, drag/click interaction
 */

// ============================================================
// CONSTANTS
// ============================================================

const PIECE_GLYPHS = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

const DIFF_LABELS = { 1: 'Beginner', 2: 'Easy', 3: 'Intermediate', 4: 'Hard', 5: 'Master' };

// ============================================================
// STATE
// ============================================================

const State = {
  chess: null,
  flipped: false,
  mode: 'computer',      // 'computer' | 'friend' | 'analysis'
  playerColor: 'w',      // player's color in computer mode
  aiLevel: 2,
  timeMin: 5,
  timeInc: 0,
  selected: null,        // currently selected square
  legalTargets: [],      // squares the selected piece can move to
  lastMove: null,        // { from, to }
  gameOver: false,
  drawOffered: false,
  historyIdx: -1,        // for move navigation (-1 = live)
  showHints: true,
  autoQueen: false,
  soundOn: true,
  animOn: true,
  coordsOn: true,
  theme: 'classic',
  // Pending promotion
  promoFrom: null,
  promoTo: null,
  // Drag
  dragPiece: null,
  dragGhost: null,
  // Player names
  names: { w: 'White', b: 'Black' }
};

// ============================================================
// DOM HELPERS
// ============================================================
const $ = id => document.getElementById(id);
const $q = sel => document.querySelector(sel);

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration + 400);
  setTimeout(() => el.style.opacity = '0', duration);
}

// ============================================================
// BOARD RENDERING
// ============================================================

function squareToCoords(sq, flipped) {
  const file = sq.charCodeAt(0) - 97; // a=0..h=7
  const rank = parseInt(sq[1]) - 1;    // 1=0..8=7
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { row, col };
}

function coordsToSquare(row, col, flipped) {
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row + 1 : 8 - row;
  return String.fromCharCode(97 + file) + rank;
}

function isLegalTarget(sq) {
  return State.legalTargets.includes(sq);
}

function hasPieceAt(sq) {
  return !!State.chess.get(sq);
}

function renderBoard() {
  const board = $('chessboard');
  board.innerHTML = '';

  const pos = State.chess.board(); // [row0=rank8][col0=fileA]
  const inCheck = State.chess.in_check();
  const turn = State.chess.turn();

  // Find king square if in check
  let checkSq = null;
  if (inCheck) checkSq = findKingSquare(turn);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = coordsToSquare(row, col, State.flipped);
      const isLight = (sq.charCodeAt(0) - 97 + parseInt(sq[1])) % 2 === 1;

      const sqEl = document.createElement('div');
      sqEl.className = `sq ${isLight ? 'light' : 'dark'}`;
      sqEl.dataset.sq = sq;

      // Last move highlight
      if (State.lastMove) {
        if (sq === State.lastMove.from) sqEl.classList.add('last-from');
        if (sq === State.lastMove.to)   sqEl.classList.add('last-to');
      }
      // Selected
      if (sq === State.selected) sqEl.classList.add('selected');
      // Check
      if (sq === checkSq) sqEl.classList.add('in-check');

      // Coordinate labels (on edge squares)
      if (State.coordsOn) {
        if (col === 0) {
          const rLabel = document.createElement('span');
          rLabel.className = 'sq-rank';
          rLabel.textContent = sq[1];
          sqEl.appendChild(rLabel);
        }
        if (row === 7) {
          const fLabel = document.createElement('span');
          fLabel.className = 'sq-file';
          fLabel.textContent = sq[0];
          sqEl.appendChild(fLabel);
        }
      }

      // Legal move hints
      if (State.showHints && State.selected && isLegalTarget(sq)) {
        const piece = State.chess.get(sq);
        const indicator = document.createElement('div');
        indicator.className = piece ? 'capture-ring' : 'move-dot';
        sqEl.appendChild(indicator);
      }

      // Piece
      const br = State.flipped ? (7 - row) : row;
      const bc = State.flipped ? (7 - col) : col;
      const piece = pos[br][bc];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece piece-${piece.color}`;
        pieceEl.textContent = PIECE_GLYPHS[piece.color][piece.type];
        pieceEl.dataset.sq = sq;
        pieceEl.dataset.color = piece.color;
        pieceEl.dataset.type = piece.type;

        // Drag
        pieceEl.addEventListener('mousedown', onPieceMouseDown);
        pieceEl.addEventListener('touchstart', onPieceTouchStart, { passive: false });

        sqEl.appendChild(pieceEl);
      }

      // Square click
      sqEl.addEventListener('click', onSquareClick);

      board.appendChild(sqEl);
    }
  }

  renderCoords();
  updateClockUI();
  updateStatusBar();
  renderMoveList();
  renderCaptured();
}

function renderCoords() {
  // External rank + file labels
  const rl = $('rank-labels');
  const fl = $('file-labels');
  if (!rl || !fl) return;
  rl.innerHTML = '';
  fl.innerHTML = '';

  const ranks = State.flipped
    ? ['1','2','3','4','5','6','7','8']
    : ['8','7','6','5','4','3','2','1'];
  const files = State.flipped
    ? ['h','g','f','e','d','c','b','a']
    : ['a','b','c','d','e','f','g','h'];

  ranks.forEach(r => { const s = document.createElement('span'); s.textContent = r; rl.appendChild(s); });
  files.forEach(f => { const s = document.createElement('span'); s.textContent = f; fl.appendChild(s); });
}

// ============================================================
// FIND KING
// ============================================================
function findKingSquare(color) {
  const board = State.chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) {
        return String.fromCharCode(97 + c) + (8 - r);
      }
    }
  }
  return null;
}

// ============================================================
// CAPTURED PIECES
// ============================================================
function renderCaptured() {
  const hist = State.chess.history({ verbose: true });
  const capturedByWhite = []; // pieces white captured (black pieces)
  const capturedByBlack = []; // pieces black captured (white pieces)

  hist.forEach(m => {
    if (m.captured) {
      const glyph = PIECE_GLYPHS[m.color === 'w' ? 'b' : 'w'][m.captured];
      if (m.color === 'w') capturedByWhite.push(glyph);
      else capturedByBlack.push(glyph);
    }
  });

  $('cap-white').textContent = capturedByWhite.join('');
  $('cap-black').textContent = capturedByBlack.join('');
}

// ============================================================
// MOVE EXECUTION
// ============================================================
function tryMove(from, to, promotion) {
  if (State.gameOver) return false;
  if (State.historyIdx !== -1) return false; // browsing history

  const turn = State.chess.turn();

  // ---- ONLINE MODE: send to server, don't apply locally ----
  if (State.mode === 'online') {
    if (turn !== State.onlineColor) return false; // not your turn

    const piece = State.chess.get(from);
    if (!piece || piece.color !== State.onlineColor) return false;

    // Promotion check
    if (!promotion && piece.type === 'p') {
      const toRank = parseInt(to[1]);
      if ((piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)) {
        if (State.autoQueen) {
          promotion = 'q';
        } else {
          State.promoFrom = from;
          State.promoTo   = to;
          showPromoModal(piece.color);
          return false;
        }
      }
    }

    // Validate locally for instant illegal-move feedback
    const moveObj = { from, to };
    if (promotion) moveObj.promotion = promotion;
    const test = State.chess.move(moveObj);
    if (!test) { SoundEngine.illegal(); return false; }
    State.chess.undo();

    // Send to server — server will broadcast move-made to both players
    Multiplayer.sendMove(from, to, promotion);
    State.selected     = null;
    State.legalTargets = [];
    renderBoard(); // clear selection dots
    return true;
  }
  // ---- END ONLINE MODE ----

  // Check if it's the right player's turn (CPU / pass-and-play)
  if (State.mode === 'computer' && turn !== State.playerColor) return false;

  const piece = State.chess.get(from);
  if (!piece) return false;

  // Promotion check
  if (!promotion && piece.type === 'p') {
    const toRank = parseInt(to[1]);
    if ((piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)) {
      if (State.autoQueen) {
        promotion = 'q';
      } else {
        // Show promotion dialog
        State.promoFrom = from;
        State.promoTo = to;
        showPromoModal(piece.color);
        return false;
      }
    }
  }

  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;

  const result = State.chess.move(moveObj);
  if (!result) { SoundEngine.illegal(); return false; }

  // Update state
  State.selected = null;
  State.legalTargets = [];
  State.lastMove = { from, to };
  State.historyIdx = -1;

  // Sound
  if (State.soundOn) {
    if (result.flags.includes('k') || result.flags.includes('q')) SoundEngine.castle();
    else if (result.flags.includes('p')) SoundEngine.promote();
    else if (result.captured) SoundEngine.capture();
    else SoundEngine.move();
    if (State.chess.in_check()) setTimeout(() => SoundEngine.check(), 100);
  }

  // Clock switch turn
  if (!isUnlimitedTime()) ChessClock.switchTurn();

  renderBoard();
  checkGameOver();

  // Trigger AI
  if (!State.gameOver && State.mode === 'computer' && State.chess.turn() !== State.playerColor) {
    scheduleAI();
  }

  return true;
}

function isUnlimitedTime() {
  return State.timeMin === 0;
}

function showPromoModal(color) {
  const row = $('promo-row');
  row.innerHTML = '';
  const pieces = color === 'w'
    ? [['q','♕'],['r','♖'],['b','♗'],['n','♘']]
    : [['q','♛'],['r','♜'],['b','♝'],['n','♞']];
  pieces.forEach(([type, glyph]) => {
    const btn = document.createElement('button');
    btn.textContent = glyph;
    btn.onclick = () => {
      closeModal('modal-promo');
      tryMove(State.promoFrom, State.promoTo, type);
    };
    row.appendChild(btn);
  });
  openModal('modal-promo');
}

// ============================================================
// CLICK INTERACTION
// ============================================================
function onSquareClick(e) {
  if (State.gameOver) return;
  SoundEngine.unlock();

  const sq = e.currentTarget.dataset.sq;
  const turn = State.chess.turn();

  // If browsing history — jump to live
  if (State.historyIdx !== -1) {
    State.historyIdx = -1;
    renderBoard();
    return;
  }

  // Computer mode: only allow player's pieces
  if (State.mode === 'computer' && turn !== State.playerColor) return;

  const piece = State.chess.get(sq);

  if (State.selected) {
    // Attempt move
    if (isLegalTarget(sq)) {
      tryMove(State.selected, sq);
    } else if (piece && piece.color === turn) {
      // Re-select
      selectSquare(sq);
    } else {
      // Deselect
      State.selected = null;
      State.legalTargets = [];
      renderBoard();
    }
  } else {
    if (piece && piece.color === turn) {
      selectSquare(sq);
    }
  }
}

function selectSquare(sq) {
  State.selected = sq;
  const moves = State.chess.moves({ square: sq, verbose: true });
  State.legalTargets = moves.map(m => m.to);
  renderBoard();
}

// ============================================================
// DRAG INTERACTION
// ============================================================
let dragFrom = null;
let ghostEl = null;

function createGhost(glyph, color) {
  if (ghostEl) ghostEl.remove();
  ghostEl = document.createElement('div');
  ghostEl.className = `drag-ghost active piece-${color}`;
  ghostEl.textContent = glyph;
  document.body.appendChild(ghostEl);
  return ghostEl;
}

function moveGhost(x, y) {
  if (!ghostEl) return;
  ghostEl.style.left = x + 'px';
  ghostEl.style.top  = y + 'px';
}

function removeGhost() {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

function getSquareFromPoint(x, y) {
  const board = $('chessboard');
  const rect = board.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const col = Math.floor((x - rect.left) / (rect.width  / 8));
  const row = Math.floor((y - rect.top)  / (rect.height / 8));
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return coordsToSquare(row, col, State.flipped);
}

function onPieceMouseDown(e) {
  if (State.gameOver || State.historyIdx !== -1) return;
  e.preventDefault();
  SoundEngine.unlock();

  const sq = e.currentTarget.dataset.sq;
  const piece = State.chess.get(sq);
  if (!piece) return;

  const turn = State.chess.turn();
  if (State.mode === 'computer' && turn !== State.playerColor) return;
  if (piece.color !== turn) return;

  dragFrom = sq;
  selectSquare(sq);

  const glyph = PIECE_GLYPHS[piece.color][piece.type];
  createGhost(glyph, piece.color);
  moveGhost(e.clientX, e.clientY);

  // Mark piece as dragging
  e.currentTarget.classList.add('dragging');

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
  moveGhost(e.clientX, e.clientY);
}

function onMouseUp(e) {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  const toSq = getSquareFromPoint(e.clientX, e.clientY);
  removeGhost();

  // Restore piece appearance
  const dragging = $q('.piece.dragging');
  if (dragging) dragging.classList.remove('dragging');

  if (toSq && dragFrom && isLegalTarget(toSq)) {
    tryMove(dragFrom, toSq);
  } else {
    renderBoard();
  }
  dragFrom = null;
}

// Touch support
function onPieceTouchStart(e) {
  if (State.gameOver || State.historyIdx !== -1) return;
  e.preventDefault();
  SoundEngine.unlock();

  const sq = e.currentTarget.dataset.sq;
  const piece = State.chess.get(sq);
  if (!piece) return;

  const turn = State.chess.turn();
  if (State.mode === 'computer' && turn !== State.playerColor) return;
  if (piece.color !== turn) return;

  dragFrom = sq;
  selectSquare(sq);

  const touch = e.touches[0];
  const glyph = PIECE_GLYPHS[piece.color][piece.type];
  createGhost(glyph, piece.color);
  moveGhost(touch.clientX, touch.clientY);

  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
}

function onTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  moveGhost(touch.clientX, touch.clientY);
}

function onTouchEnd(e) {
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);

  const touch = e.changedTouches[0];
  const toSq = getSquareFromPoint(touch.clientX, touch.clientY);
  removeGhost();

  if (toSq && dragFrom && isLegalTarget(toSq)) {
    tryMove(dragFrom, toSq);
  } else {
    renderBoard();
  }
  dragFrom = null;
}

// ============================================================
// AI
// ============================================================
function scheduleAI() {
  // Small delay so UI updates first
  setTimeout(runAI, 300 + Math.random() * 200);
}

function runAI() {
  if (State.gameOver || State.chess.game_over()) return;
  if (State.chess.turn() === State.playerColor) return;

  const move = ChessAI.pickBestMove(State.chess, State.aiLevel);
  if (!move) return;

  const result = State.chess.move(move);
  if (!result) return;

  State.selected = null;
  State.legalTargets = [];
  State.lastMove = { from: result.from, to: result.to };

  if (State.soundOn) {
    if (result.flags.includes('k') || result.flags.includes('q')) SoundEngine.castle();
    else if (result.flags.includes('p')) SoundEngine.promote();
    else if (result.captured) SoundEngine.capture();
    else SoundEngine.move();
    if (State.chess.in_check()) setTimeout(() => SoundEngine.check(), 100);
  }

  if (!isUnlimitedTime()) ChessClock.switchTurn();

  renderBoard();
  checkGameOver();
}

// ============================================================
// GAME OVER
// ============================================================
function checkGameOver() {
  if (!State.chess.game_over()) return;
  State.gameOver = true;
  ChessClock.stop();

  let title, sub, icon;

  if (State.chess.in_checkmate()) {
    const winner = State.chess.turn() === 'w' ? 'b' : 'w';
    const winnerName = State.names[winner];
    title = `${winnerName} wins!`;
    sub = 'By Checkmate ♟';
    icon = winner === State.playerColor || State.mode === 'friend' ? '🏆' : '😔';
    if (State.soundOn) SoundEngine.gameOver(winner === State.playerColor || State.mode === 'friend');
  } else if (State.chess.in_stalemate()) {
    title = 'Stalemate!'; sub = 'The game is a draw'; icon = '🤝';
    if (State.soundOn) SoundEngine.draw();
  } else if (State.chess.in_threefold_repetition()) {
    title = 'Draw!'; sub = 'By threefold repetition'; icon = '🔁';
    if (State.soundOn) SoundEngine.draw();
  } else if (State.chess.insufficient_material()) {
    title = 'Draw!'; sub = 'Insufficient material'; icon = '⚖'; 
    if (State.soundOn) SoundEngine.draw();
  } else if (State.chess.in_draw()) {
    title = 'Draw!'; sub = 'By the 50-move rule'; icon = '🤝';
    if (State.soundOn) SoundEngine.draw();
  }

  updateStatusBar();

  // Populate game-over modal
  $('go-icon').textContent = icon;
  $('go-title').textContent = title;
  $('go-sub').textContent = sub;
  $('go-stats').innerHTML = buildGameStats();

  setTimeout(() => openModal('modal-gameover'), 800);
}

function buildGameStats() {
  const hist = State.chess.history();
  const moves = Math.ceil(hist.length / 2);
  const clock = ChessClock.getState();
  return `
    <div>Total moves: <span>${hist.length}</span></div>
    <div>Moves played: <span>${moves}</span></div>
    <div>White time left: <span>${clock.whiteStr}</span></div>
    <div>Black time left: <span>${clock.blackStr}</span></div>
  `;
}

// ============================================================
// STATUS BAR
// ============================================================
function updateStatusBar() {
  const dot  = $('status-dot');
  const text = $('status-text');
  dot.className = 'status-dot';

  if (State.gameOver || State.chess.game_over()) {
    dot.classList.add('over');
    if (State.chess.in_checkmate()) {
      const winner = State.chess.turn() === 'w' ? 'Black' : 'White';
      text.textContent = `${winner} wins by checkmate`;
    } else { text.textContent = 'Game over — Draw'; dot.classList.add('draw'); }
    return;
  }
  if (State.chess.in_check()) {
    dot.classList.add('check');
    const who = State.chess.turn() === 'w' ? State.names.w : State.names.b;
    text.textContent = `${who} is in CHECK!`;
    return;
  }
  const who = State.chess.turn() === 'w' ? State.names.w : State.names.b;
  text.textContent = `${who} to move`;

  // Highlight active player card
  ['white','black'].forEach(c => $(`card-${c}`).classList.remove('active-turn'));
  const activeCard = State.chess.turn() === 'w' ? 'card-white' : 'card-black';
  $(activeCard).classList.add('active-turn');
}

// ============================================================
// CLOCK UI
// ============================================================
function updateClockUI(state) {
  state = state || ChessClock.getState();
  $('time-white').textContent = state.whiteStr;
  $('time-black').textContent = state.blackStr;

  const cwEl = $('clock-white');
  const cbEl = $('clock-black');
  cwEl.classList.toggle('active', state.active === 'w');
  cbEl.classList.toggle('active', state.active === 'b');
  cwEl.classList.toggle('low-time', state.whiteLow && state.active === 'w');
  cbEl.classList.toggle('low-time', state.blackLow && state.active === 'b');

  // Clock warning sound
  if (State.soundOn) {
    if ((state.whiteLow && state.active === 'w') || (state.blackLow && state.active === 'b')) {
      // Throttle: only every tick when < 10s
    }
  }
}

// ============================================================
// MOVE LIST (PGN sidebar)
// ============================================================
function renderMoveList() {
  const list = $('move-list');
  list.innerHTML = '';
  const hist = State.chess.history();

  for (let i = 0; i < hist.length; i += 2) {
    const pair = document.createElement('div');
    pair.className = 'move-pair';

    const numEl = document.createElement('div');
    numEl.className = 'move-num';
    numEl.textContent = (i / 2 + 1) + '.';

    const wEl = document.createElement('div');
    wEl.className = 'move-san';
    wEl.textContent = hist[i];
    wEl.dataset.idx = i;
    if (State.historyIdx === i) wEl.classList.add('current');
    else if (State.historyIdx === -1 && i === hist.length - (hist.length % 2 === 0 ? 2 : 1)) {
      if (hist.length % 2 === 0) wEl.classList.add('current'); // last white move
    }
    wEl.addEventListener('click', () => jumpToMove(i));

    const bEl = document.createElement('div');
    bEl.className = 'move-san';
    if (hist[i + 1]) {
      bEl.textContent = hist[i + 1];
      bEl.dataset.idx = i + 1;
      if (State.historyIdx === i + 1) bEl.classList.add('current');
      else if (State.historyIdx === -1 && i + 1 === hist.length - 1) bEl.classList.add('current');
      bEl.addEventListener('click', () => jumpToMove(i + 1));
    }

    pair.appendChild(numEl);
    pair.appendChild(wEl);
    pair.appendChild(bEl);
    list.appendChild(pair);
  }
  // Scroll to bottom
  list.scrollTop = list.scrollHeight;
}

function jumpToMove(idx) {
  const hist = State.chess.history();
  if (idx < 0 || idx >= hist.length) return;
  // Replay from start up to idx
  const tempChess = new Chess();
  for (let i = 0; i <= idx; i++) tempChess.move(hist[i]);
  State.historyIdx = idx;
  // Temporarily display this position
  const savedChess = State.chess;
  State.chess = tempChess;
  State.selected = null; State.legalTargets = [];
  State.lastMove = null;
  renderBoard();
  State.chess = savedChess;
}

// Move navigation buttons
function navFirst()  { const h = State.chess.history(); if (h.length) jumpToMove(0); }
function navPrev()   {
  const idx = State.historyIdx === -1 ? State.chess.history().length - 1 : State.historyIdx;
  if (idx > 0) jumpToMove(idx - 1);
}
function navNext()   {
  const h = State.chess.history();
  const idx = State.historyIdx === -1 ? h.length : State.historyIdx;
  if (idx < h.length - 1) jumpToMove(idx + 1);
  else { State.historyIdx = -1; renderBoard(); }
}
function navLast()   { State.historyIdx = -1; renderBoard(); }

// ============================================================
// NEW GAME
// ============================================================
function startNewGame(playerColor) {
  ChessClock.stop();
  State.chess = new Chess();
  State.gameOver = false;
  State.drawOffered = false;
  State.selected = null;
  State.legalTargets = [];
  State.lastMove = null;
  State.historyIdx = -1;
  State.promoFrom = null;
  State.promoTo = null;
  State.playerColor = playerColor || 'w';
  State.flipped = (playerColor === 'b');

  // Set player names from auth session
  const user = Auth.current();
  const displayName = user ? user.username : 'Player';
  if (State.mode === 'computer') {
    State.names[playerColor] = displayName;
    State.names[playerColor === 'w' ? 'b' : 'w'] = 'Computer';
  } else if (State.mode === 'friend') {
    State.names.w = displayName;
    State.names.b = 'Opponent';
  } else {
    State.names.w = displayName;
    State.names.b = displayName;
  }
  $('name-white').textContent = State.names.w;
  $('name-black').textContent = State.names.b;

  closeModal('modal-gameover');
  closeModal('modal-newgame');

  // Setup & start clock
  if (!isUnlimitedTime()) {
    ChessClock.setup(State.timeMin, State.timeInc);
    ChessClock.start('w');
  } else {
    $('time-white').textContent = '∞';
    $('time-black').textContent = '∞';
  }

  renderBoard();
  toast('New game started! ' + (playerColor === 'w' ? '♔' : '♚') + ' Good luck, ' + displayName + '!', 'info', 2500);

  // If player is black and vs computer, AI goes first
  if (State.mode === 'computer' && State.playerColor === 'b') {
    scheduleAI();
  }
}

// ============================================================
// VOICE COMMAND HANDLER
// ============================================================
function handleVoiceResult(transcript, parsed) {
  $('voice-heard').textContent = '"' + transcript + '"';

  if (!parsed) {
    toast('Could not understand: "' + transcript + '"', 'error');
    return;
  }

  if (parsed.action === 'resign') { doResign(); return; }
  if (parsed.action === 'draw')   { doOfferDraw(); return; }
  if (parsed.action === 'newGame') { openModal('modal-newgame'); return; }
  if (parsed.action === 'flip')   { State.flipped = !State.flipped; renderBoard(); return; }
  if (parsed.action === 'undo')   { doUndo(); return; }
  if (parsed.action === 'acceptDraw') { doAcceptDraw(); return; }

  if (parsed.move) {
    // Try from/to style
    if (typeof parsed.move === 'object' && parsed.move.from) {
      tryMove(parsed.move.from, parsed.move.to);
      return;
    }

    // Try SAN style — find unambiguous legal move
    const turn = State.chess.turn();
    const legal = State.chess.moves({ verbose: true });

    // If it's a specific to-square hint, find matching moves
    if (parsed.toSq) {
      const candidates = legal.filter(m =>
        m.to === parsed.toSq &&
        (parsed.piece === '' ? m.piece === 'p' : m.piece === parsed.piece.toLowerCase()) &&
        m.color === turn
      );
      if (candidates.length === 1) {
        tryMove(candidates[0].from, candidates[0].to);
        return;
      }
      if (candidates.length > 1) {
        toast(`Ambiguous move — be more specific (from which square?)`, 'error');
        return;
      }
    }

    // Try direct SAN
    const result = State.chess.move(parsed.move);
    if (result) {
      State.chess.undo();
      tryMove(result.from, result.to);
      return;
    }

    toast(`Illegal move: "${transcript}"`, 'error');
  }
}

function handleVoiceStatus(status) {
  const btn = $('btn-voice');
  const mic = $('voice-mic');
  const label = $('voice-label');

  if (status === 'always-on') {
    // Continuous mode — stays on
    btn.classList.add('listening');
    btn.classList.add('always-on');
    mic.classList.add('listening');
    mic.textContent = '🟢';
    label.textContent = 'Listening (hands-free)…';
  } else if (status === 'listening') {
    btn.classList.add('listening');
    btn.classList.remove('always-on');
    mic.classList.add('listening');
    mic.textContent = '🔴';
    label.textContent = 'Listening…';
    $('voice-heard').textContent = '';
  } else if (status.startsWith('heard:')) {
    const h = status.replace('heard:', '');
    $('voice-heard').textContent = h ? `"${h}"` : '';
  } else {
    // idle
    btn.classList.remove('listening', 'always-on');
    mic.classList.remove('listening');
    mic.textContent = '🎤';
    label.textContent = 'Click to Speak';
    if (status.startsWith('error:')) {
      toast('Microphone error: ' + status.replace('error:', ''), 'error');
    }
  }
}

// ============================================================
// GAME ACTIONS
// ============================================================
function doResign() {
  if (State.gameOver) return;
  if (State.mode === 'online') {
    Multiplayer.sendResign();
    return;
  }
  const resigner = State.chess.turn() === 'w' ? State.names.w : State.names.b;
  const winner   = State.chess.turn() === 'w' ? State.names.b : State.names.w;
  State.gameOver = true;
  ChessClock.stop();
  if (State.soundOn) SoundEngine.gameOver(false);
  $('go-icon').textContent = '🏳';
  $('go-title').textContent = `${winner} wins!`;
  $('go-sub').textContent = `${resigner} resigned`;
  $('go-stats').innerHTML = buildGameStats();
  updateStatusBar();
  setTimeout(() => openModal('modal-gameover'), 300);
}

function doOfferDraw() {
  if (State.gameOver) return;
  if (State.mode === 'online') {
    Multiplayer.sendDrawOffer();
    toast('Draw offer sent...', 'info');
    return;
  }
  if (State.mode === 'friend') {
    openModal('modal-draw');
  } else {
    // vs AI: AI has a chance to accept based on position evaluation
    const eval_ = ChessAI.evaluate(State.chess);
    const aiColor = State.playerColor === 'w' ? 'b' : 'w';
    const aiEval = aiColor === 'w' ? eval_ : -eval_;
    // AI accepts if it's worse or roughly even
    if (aiEval <= 100) {
      doAcceptDraw();
      toast('The computer accepts the draw.', 'info');
    } else {
      toast('The computer declines the draw offer.', 'info');
    }
  }
}

function doAcceptDraw() {
  State.gameOver = true;
  ChessClock.stop();
  if (State.soundOn) SoundEngine.draw();
  $('go-icon').textContent = '🤝';
  $('go-title').textContent = 'Draw!';
  $('go-sub').textContent = 'By mutual agreement';
  $('go-stats').innerHTML = buildGameStats();
  updateStatusBar();
  closeModal('modal-draw');
  setTimeout(() => openModal('modal-gameover'), 300);
}

function doUndo() {
  if (State.gameOver) return;
  if (State.mode === 'computer') {
    State.chess.undo(); // undo AI move
    State.chess.undo(); // undo player move
  } else {
    State.chess.undo();
  }
  const hist = State.chess.history({ verbose: true });
  State.lastMove = hist.length ? { from: hist[hist.length-1].from, to: hist[hist.length-1].to } : null;
  State.selected = null; State.legalTargets = [];
  State.historyIdx = -1;
  if (!isUnlimitedTime()) {
    // Switch clock back
    ChessClock.switchTurn();
    if (State.mode === 'computer') ChessClock.switchTurn();
  }
  renderBoard();
  toast('Move undone', 'info', 1500);
}

// ============================================================
// SETTINGS
// ============================================================
function applyTheme(theme) {
  State.theme = theme;
  document.body.dataset.theme = theme;
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

function applyTimeControl(min, inc) {
  State.timeMin = min;
  State.timeInc = inc;
  document.querySelectorAll('.time-btn').forEach(el => {
    el.classList.toggle('active',
      parseInt(el.dataset.min) === min && parseInt(el.dataset.inc) === inc);
  });
}

function applyAILevel(level) {
  State.aiLevel = parseInt(level);
  $('diff-label').textContent = DIFF_LABELS[State.aiLevel] || 'Easy';
  // Update slider gradient
  const pct = ((level - 1) / 4 * 100) + '%';
  $('ai-level').style.setProperty('--pct', pct);
}

// ============================================================
// EVENT WIRING
// ============================================================
function wireEvents() {

  // New Game button (header) — goes back to landing/mode selection
  $('btn-new-game-header').addEventListener('click', () => showLandingPage());

  // Settings
  $('btn-settings-header').addEventListener('click', () => openModal('modal-settings'));
  $('close-settings').addEventListener('click', () => closeModal('modal-settings'));
  $('btn-close-settings').addEventListener('click', () => closeModal('modal-settings'));

  // New game color choice
  $('ng-white').addEventListener('click', () => startNewGame('w'));
  $('ng-random').addEventListener('click', () => startNewGame(Math.random() < 0.5 ? 'w' : 'b'));
  $('ng-black').addEventListener('click', () => startNewGame('b'));
  $('btn-cancel-ng').addEventListener('click', () => closeModal('modal-newgame'));

  // Game over actions
  $('btn-rematch').addEventListener('click', () => {
    closeModal('modal-gameover');
    startNewGame(State.playerColor === 'w' ? 'b' : 'w'); // swap sides
  });
  $('btn-newgame-go').addEventListener('click', () => {
    closeModal('modal-gameover');
    openModal('modal-newgame');
  });

  // Board controls
  $('btn-resign').addEventListener('click', () => {
    if (confirm('Are you sure you want to resign?')) doResign();
  });
  $('btn-draw').addEventListener('click', doOfferDraw);
  $('btn-flip').addEventListener('click', () => {
    State.flipped = !State.flipped;
    renderBoard();
  });
  $('btn-copy-pgn').addEventListener('click', () => {
    const pgn = State.chess.pgn();
    navigator.clipboard.writeText(pgn).then(() => toast('PGN copied!', 'success', 2000));
  });

  // Draw modal
  $('btn-accept-draw').addEventListener('click', doAcceptDraw);
  $('btn-decline-draw').addEventListener('click', () => closeModal('modal-draw'));

  // Move navigation
  $('nav-first').addEventListener('click', navFirst);
  $('nav-prev').addEventListener('click', navPrev);
  $('nav-next').addEventListener('click', navNext);
  $('nav-last').addEventListener('click', navLast);

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if ($('modal-settings').classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  navPrev();
    if (e.key === 'ArrowRight') navNext();
    if (e.key === 'Home')       navFirst();
    if (e.key === 'End')        navLast();
    if (e.key === 'f' || e.key === 'F') { State.flipped = !State.flipped; renderBoard(); }
  });

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.mode = btn.dataset.mode;
      document.body.dataset.mode = State.mode;
      $('ai-card').style.display = State.mode === 'computer' ? '' : 'none';
    });
  });

  // Time buttons
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'custom-time-btn') {
        const ci = $('custom-inputs');
        ci.style.display = ci.style.display === 'none' ? '' : 'none';
        return;
      }
      applyTimeControl(parseInt(btn.dataset.min), parseInt(btn.dataset.inc));
      $('custom-inputs').style.display = 'none';
    });
  });

  // Custom time apply
  $('ci-apply').addEventListener('click', () => {
    const min = parseInt($('ci-min').value) || 10;
    const inc = parseInt($('ci-inc').value) || 0;
    applyTimeControl(min, inc);
    $('custom-inputs').style.display = 'none';
  });

  // AI difficulty
  $('ai-level').addEventListener('input', e => applyAILevel(e.target.value));

  // Voice button — toggles always-on continuous listening mode
  $('btn-voice').addEventListener('click', () => {
    if (!VoiceEngine.isSupported()) {
      toast('Voice commands not supported in this browser. Try Chrome.', 'error');
      return;
    }
    const on = VoiceEngine.toggleAlwaysOn();
    if (on) {
      toast('🎤 Hands-free voice ON — speak your moves!', 'success', 2500);
    } else {
      toast('Voice commands off.', 'info', 1500);
    }
  });

  // Settings toggles
  $('opt-hints').addEventListener('change', e => {
    State.showHints = e.target.checked;
    renderBoard();
  });
  $('opt-autoqueen').addEventListener('change', e => { State.autoQueen = e.target.checked; });
  $('opt-sound').addEventListener('change', e => {
    State.soundOn = e.target.checked;
    SoundEngine.setEnabled(e.target.checked);
  });
  $('opt-anim').addEventListener('change', e => { State.animOn = e.target.checked; });
  $('opt-coords').addEventListener('change', e => {
    State.coordsOn = e.target.checked;
    renderBoard();
  });

  // Theme swatches
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.addEventListener('click', () => applyTheme(el.dataset.theme));
  });

  // Save player names
  $('btn-save-names').addEventListener('click', () => {
    State.names.w = $('inp-white-name').value.trim() || 'White';
    State.names.b = $('inp-black-name').value.trim() || 'Black';
    $('name-white').textContent = State.names.w;
    $('name-black').textContent = State.names.b;
    updateStatusBar();
    toast('Names saved!', 'success', 1500);
  });

  // Close modals on overlay click
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov && ov.id !== 'modal-promo' && ov.id !== 'modal-gameover') {
        ov.classList.remove('open');
      }
    });
  });
}

// ============================================================
// CLOCK SETUP
// ============================================================
function wireClocks() {
  ChessClock.onTick(state => updateClockUI(state));
  ChessClock.onExpire(color => {
    State.gameOver = true;
    const winner = color === 'w' ? 'b' : 'w';
    const winnerName = State.names[winner];
    if (State.soundOn) SoundEngine.gameOver(false);
    $('go-icon').textContent = '⏰';
    $('go-title').textContent = `${winnerName} wins!`;
    $('go-sub').textContent = `${State.names[color]} ran out of time`;
    $('go-stats').innerHTML = buildGameStats();
    updateStatusBar();
    setTimeout(() => openModal('modal-gameover'), 300);
  });
}

// ============================================================
// VOICE SETUP
// ============================================================
function wireVoice() {
  VoiceEngine.onResult(handleVoiceResult);
  VoiceEngine.onStatus(handleVoiceStatus);
  VoiceEngine.init();
}

// ============================================================
// ENTRY POINT
// ============================================================
function init() {
  State.chess = new Chess();
  applyTheme('classic');
  applyAILevel(2);
  wireEvents();
  wireClocks();
  wireVoice();

  // Setup clock but DON'T start — game only starts when user picks a mode
  ChessClock.setup(State.timeMin, State.timeInc);

  // Render board in idle state (no clock running)
  renderBoard();
  $('name-white').textContent = State.names.w;
  $('name-black').textContent = State.names.b;

  // Wire online multiplayer UI (after DOM is ready)
  wireOnlineMode();

  // Show landing page instead of jumping into game
  showLandingPage();
}

// Bootstrap is at the END of this file (after Auth and landing page are defined)

// ============================================================
// AUTH SYSTEM (localStorage-based)
// ============================================================
const Auth = (() => {
  const KEY_USERS = 'cm_users';
  const KEY_SESSION = 'cm_current_user';

  function getUsers() {
    try { return JSON.parse(localStorage.getItem(KEY_USERS)) || []; } catch { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem(KEY_USERS, JSON.stringify(users));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(KEY_SESSION)); } catch { return null; }
  }
  function register(username, password) {
    const users = getUsers();
    if (!username || username.trim().length < 2) return { ok: false, msg: 'Username must be at least 2 characters.' };
    if (!password || password.length < 4) return { ok: false, msg: 'Password must be at least 4 characters.' };
    const name = username.trim();
    if (users.find(u => u.username.toLowerCase() === name.toLowerCase()))
      return { ok: false, msg: 'Username already taken. Try another.' };
    const user = { username: name, password, elo: 1200, joined: Date.now() };
    users.push(user);
    saveUsers(users);
    localStorage.setItem(KEY_SESSION, JSON.stringify({ username: user.username, elo: user.elo }));
    return { ok: true, user };
  }
  function login(username, password) {
    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return { ok: false, msg: 'Account not found. Check your username.' };
    if (user.password !== password) return { ok: false, msg: 'Incorrect password.' };
    localStorage.setItem(KEY_SESSION, JSON.stringify({ username: user.username, elo: user.elo }));
    return { ok: true, user };
  }
  function logout() { localStorage.removeItem(KEY_SESSION); }
  function current() { return getSession(); }
  return { register, login, logout, current };
})();

// ============================================================
// LANDING PAGE
// ============================================================
function showLandingPage() {
  document.querySelector('.game-container').style.display = 'none';
  document.querySelector('.app-header').style.display = 'none';

  const user = Auth.current();

  if (!$('landing-page')) {
    const landing = document.createElement('div');
    landing.id = 'landing-page';
    document.body.insertBefore(landing, document.body.firstChild);
  }

  const user2 = Auth.current();
  $('landing-page').style.display = 'flex';
  $('landing-page').classList.remove('lp-exit');
  $('landing-page').innerHTML = `
    <div class="lp-bg-orbs">
      <div class="lp-orb lp-orb1"></div>
      <div class="lp-orb lp-orb2"></div>
      <div class="lp-orb lp-orb3"></div>
    </div>

    <div class="lp-pieces-deco" aria-hidden="true">
      <span class="lp-deco-piece" style="top:8%;left:4%;animation-delay:0s">♜</span>
      <span class="lp-deco-piece" style="top:15%;right:6%;animation-delay:0.7s">♞</span>
      <span class="lp-deco-piece" style="top:70%;left:2%;animation-delay:1.2s">♝</span>
      <span class="lp-deco-piece" style="bottom:8%;right:4%;animation-delay:0.4s">♛</span>
      <span class="lp-deco-piece" style="top:40%;right:2%;animation-delay:1.8s">♚</span>
      <span class="lp-deco-piece" style="bottom:20%;left:5%;animation-delay:0.9s">♟</span>
    </div>

    <!-- Top nav bar -->
    <div class="lp-topnav">
      <div class="lp-topnav-brand">
        <span class="lp-topnav-icon">♟</span>
        <span class="lp-topnav-name">ChessMaster <span style="color:var(--gold)">Pro</span></span>
      </div>
      <div class="lp-topnav-auth" id="lp-topnav-auth">
        ${user2 ? `
          <div class="lp-user-pill">
            <div class="lp-user-avatar">${user2.username[0].toUpperCase()}</div>
            <span class="lp-user-name">${user2.username}</span>
            <span class="lp-user-elo">⚡ ${user2.elo} ELO</span>
          </div>
          <button class="lp-btn-ghost" id="lp-btn-logout">Sign Out</button>
        ` : `
          <button class="lp-btn-ghost" id="lp-btn-signin">Sign In</button>
          <button class="lp-btn-primary" id="lp-btn-register">Create Account</button>
        `}
      </div>
    </div>

    <div class="lp-content">
      <!-- Logo -->
      <div class="lp-logo-wrap">
        <div class="lp-logo-icon">♟</div>
        <div class="lp-logo-text">
          <span class="lp-logo-name">ChessMaster</span>
          <span class="lp-logo-pro">PRO</span>
        </div>
      </div>

      ${user2 ? `<p class="lp-tagline">Welcome back, <strong style="color:var(--purple-light)">${user2.username}</strong>! Ready to play?</p>` :
                `<p class="lp-tagline">Master the board. Outsmart the world.</p>`}

      <!-- Mode cards -->
      <div class="lp-modes">
        <button class="lp-mode-card${!user2 ? ' lp-mode-locked' : ''}" id="lp-vs-ai" data-mode="computer">
          <div class="lp-mode-icon">🤖</div>
          <div class="lp-mode-title">vs Computer</div>
          <div class="lp-mode-desc">Challenge our AI from Beginner to Master level</div>
        </button>
        <button class="lp-mode-card lp-mode-featured${!user2 ? ' lp-mode-locked' : ''}" id="lp-vs-online" data-mode="online">
          <div class="lp-mode-badge">LIVE</div>
          <div class="lp-mode-icon">🌐</div>
          <div class="lp-mode-title">Play Online</div>
          <div class="lp-mode-desc">Challenge a friend in real-time with a room code</div>
        </button>
        <button class="lp-mode-card${!user2 ? ' lp-mode-locked' : ''}" id="lp-vs-friend" data-mode="friend">
          <div class="lp-mode-icon">👥</div>
          <div class="lp-mode-title">Pass &amp; Play</div>
          <div class="lp-mode-desc">Two players on the same device, face to face</div>
        </button>
        <button class="lp-mode-card${!user2 ? ' lp-mode-locked' : ''}" id="lp-analysis" data-mode="analysis">
          <div class="lp-mode-icon">🔍</div>
          <div class="lp-mode-title">Analysis</div>
          <div class="lp-mode-desc">Free-move board to study openings and positions</div>
        </button>
      </div>

      <div class="lp-stats">
        <div class="lp-stat"><span class="lp-stat-val">4</span><span class="lp-stat-label">Game Modes</span></div>
        <div class="lp-stat-divider"></div>
        <div class="lp-stat"><span class="lp-stat-val">5</span><span class="lp-stat-label">AI Levels</span></div>
        <div class="lp-stat-divider"></div>
        <div class="lp-stat"><span class="lp-stat-val">7+</span><span class="lp-stat-label">Time Controls</span></div>
        <div class="lp-stat-divider"></div>
        <div class="lp-stat"><span class="lp-stat-val">🎤</span><span class="lp-stat-label">Voice Moves</span></div>
      </div>

      ${!user2 ?
        `<p class="lp-footer-note lp-footer-auth">🔐 <strong style="color:var(--purple-light)">Account required to play.</strong>&nbsp; <button class="lp-inline-link" id="lp-guest-signin">Sign in</button> or <button class="lp-inline-link" id="lp-guest-register">create a free account</button> to get started.</p>` :
        `<p class="lp-footer-note">Select a game mode above to start playing 👆</p>`}
    </div>

    <!-- Auth Modals inside landing page -->
    <div class="lp-modal-overlay" id="lp-modal-signin" style="display:none">
      <div class="lp-modal">
        <button class="lp-modal-close" id="lp-close-signin">✕</button>
        <div class="lp-modal-icon">♟</div>
        <h2 class="lp-modal-title">Welcome Back</h2>
        <p class="lp-modal-sub">Sign in to your ChessMaster account</p>
        <div class="lp-form">
          <div class="lp-field">
            <label>Username</label>
            <input type="text" id="si-username" placeholder="Your username" autocomplete="username" />
          </div>
          <div class="lp-field">
            <label>Password</label>
            <div class="lp-pw-wrap">
              <input type="password" id="si-password" placeholder="Your password" autocomplete="current-password" />
              <button class="lp-pw-toggle" data-target="si-password">👁</button>
            </div>
          </div>
          <div class="lp-form-error" id="si-error"></div>
          <button class="lp-submit-btn" id="lp-do-signin">Sign In →</button>
          <p class="lp-form-switch">Don't have an account? <button class="lp-inline-link" id="si-switch-register">Create one free</button></p>
        </div>
      </div>
    </div>

    <div class="lp-modal-overlay" id="lp-modal-register" style="display:none">
      <div class="lp-modal">
        <button class="lp-modal-close" id="lp-close-register">✕</button>
        <div class="lp-modal-icon">♚</div>
        <h2 class="lp-modal-title">Create Account</h2>
        <p class="lp-modal-sub">Join ChessMaster Pro — it's free!</p>
        <div class="lp-form">
          <div class="lp-field">
            <label>Username</label>
            <input type="text" id="reg-username" placeholder="Choose a username" maxlength="20" autocomplete="username" />
          </div>
          <div class="lp-field">
            <label>Password</label>
            <div class="lp-pw-wrap">
              <input type="password" id="reg-password" placeholder="Choose a password (min 4 chars)" autocomplete="new-password" />
              <button class="lp-pw-toggle" data-target="reg-password">👁</button>
            </div>
          </div>
          <div class="lp-form-error" id="reg-error"></div>
          <button class="lp-submit-btn" id="lp-do-register">Create Account →</button>
          <p class="lp-form-switch">Already have an account? <button class="lp-inline-link" id="reg-switch-signin">Sign in</button></p>
        </div>
      </div>
    </div>
  `;

  // Wire mode cards — require auth before entering any game mode
  $('landing-page').querySelectorAll('.lp-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const loggedIn = Auth.current();
      if (!loggedIn) {
        // Store the pending mode so we can auto-launch after auth
        window._pendingMode = card.dataset.mode;
        showAuthModal('register');
        // Update the modal sub-text to explain why
        const sub = $('lp-modal-register') && $('lp-modal-register').querySelector('.lp-modal-sub');
        if (sub) sub.textContent = 'Create a free account to start playing!';
        return;
      }
      hideLandingPage(card.dataset.mode);
    });
  });

  // Auth button wiring
  const btnSignIn      = $('lp-btn-signin');
  const btnRegister    = $('lp-btn-register');
  const btnLogout      = $('lp-btn-logout');
  const guestLink      = $('lp-guest-signin');
  const guestRegLink   = $('lp-guest-register');

  if (btnSignIn)     btnSignIn.addEventListener('click', () => showAuthModal('signin'));
  if (btnRegister)   btnRegister.addEventListener('click', () => showAuthModal('register'));
  if (btnLogout)     btnLogout.addEventListener('click', () => { Auth.logout(); window._pendingMode = null; showLandingPage(); toast('Signed out.', 'info', 1500); });
  if (guestLink)     guestLink.addEventListener('click', () => showAuthModal('signin'));
  if (guestRegLink)  guestRegLink.addEventListener('click', () => showAuthModal('register'));

  $('lp-close-signin').addEventListener('click',   () => hideAuthModal('signin'));
  $('lp-close-register').addEventListener('click', () => hideAuthModal('register'));
  $('si-switch-register').addEventListener('click', () => { hideAuthModal('signin'); showAuthModal('register'); });
  $('reg-switch-signin').addEventListener('click',  () => { hideAuthModal('register'); showAuthModal('signin'); });

  // Password toggles
  $('landing-page').querySelectorAll('.lp-pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = $(btn.dataset.target);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });

  // Submit handlers
  $('lp-do-signin').addEventListener('click', () => {
    const username = $('si-username').value.trim();
    const password = $('si-password').value;
    const res = Auth.login(username, password);
    if (!res.ok) { $('si-error').textContent = res.msg; return; }
    hideAuthModal('signin');
    toast(`Welcome back, ${res.user.username}! ♟`, 'success', 2500);
    const pending = window._pendingMode;
    window._pendingMode = null;
    if (pending) {
      setTimeout(() => hideLandingPage(pending), 150);
    } else {
      showLandingPage();
    }
  });

  $('lp-do-register').addEventListener('click', () => {
    const username = $('reg-username').value.trim();
    const password = $('reg-password').value;
    const res = Auth.register(username, password);
    if (!res.ok) { $('reg-error').textContent = res.msg; return; }
    hideAuthModal('register');
    toast(`Account created! Welcome, ${res.user.username}! 🎉`, 'success', 3000);
    const pending = window._pendingMode;
    window._pendingMode = null;
    if (pending) {
      setTimeout(() => hideLandingPage(pending), 150);
    } else {
      showLandingPage();
    }
  });

  // Enter key submit
  [$('si-username'), $('si-password')].forEach(el => {
    el && el.addEventListener('keydown', e => { if (e.key === 'Enter') $('lp-do-signin').click(); });
  });
  [$('reg-username'), $('reg-password')].forEach(el => {
    el && el.addEventListener('keydown', e => { if (e.key === 'Enter') $('lp-do-register').click(); });
  });

  // Close on overlay click
  ['lp-modal-signin', 'lp-modal-register'].forEach(id => {
    $(id).addEventListener('click', e => { if (e.target.id === id) hideAuthModal(id.replace('lp-modal-','')); });
  });
}

function showAuthModal(type) {
  const id = type === 'signin' ? 'lp-modal-signin' : 'lp-modal-register';
  $(id).style.display = 'flex';
  setTimeout(() => $(id).classList.add('lp-modal-open'), 10);
  // Focus first input
  setTimeout(() => {
    const inp = type === 'signin' ? $('si-username') : $('reg-username');
    if (inp) inp.focus();
  }, 150);
}

function hideAuthModal(type) {
  const id = type === 'signin' ? 'lp-modal-signin' : 'lp-modal-register';
  $(id).classList.remove('lp-modal-open');
  setTimeout(() => { $(id).style.display = 'none'; }, 250);
  // Clear errors
  const errId = type === 'signin' ? 'si-error' : 'reg-error';
  if ($(errId)) $(errId).textContent = '';
}

function hideLandingPage(mode) {
  const landing = $('landing-page');
  if (landing) {
    landing.classList.add('lp-exit');
    setTimeout(() => { landing.style.display = 'none'; }, 400);
  }

  // Show main game UI
  document.querySelector('.game-container').style.display = '';
  document.querySelector('.app-header').style.display = '';

  // Set the selected mode
  State.mode = mode;
  document.body.dataset.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  $('ai-card').style.display = mode === 'computer' ? '' : 'none';

  if (mode === 'online') {
    // For online mode, open the online modal instead of starting a local game
    setTimeout(() => openModal('modal-online'), 450);
  } else {
    // For all other modes, open the new-game (color picker) modal
    setTimeout(() => openModal('modal-newgame'), 450);
  }
}

// ============================================================
// ONLINE MULTIPLAYER — state extensions
// ============================================================
State.onlineColor  = null;
State.onlineRoomId = null;
State.onlineName   = '';
State.chatUnread   = 0;
State.chatOpen     = false;

// ---- Patch tryMove to handle online mode (must use arrow fn to avoid redeclaration) ----
const _origTryMove = tryMove;
// Overwrite with a new reference — works because tryMove was declared with `function`
// and JS hoists it, but we can shadow it in module scope after the fact via this wrapper:
window._chessTryMove = function(from, to, promotion) {
  if (State.mode === 'online') {
    if (State.gameOver || State.historyIdx !== -1) return false;
    const turn = State.chess.turn();
    if (turn !== State.onlineColor) return false;

    const piece = State.chess.get(from);
    if (!piece) return false;

    // Promotion check
    if (!promotion && piece.type === 'p') {
      const toRank = parseInt(to[1]);
      if ((piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)) {
        if (State.autoQueen) {
          promotion = 'q';
        } else {
          State.promoFrom = from;
          State.promoTo   = to;
          showPromoModal(piece.color);
          return false;
        }
      }
    }

    // Local validation for instant feedback
    const moveObj = { from, to };
    if (promotion) moveObj.promotion = promotion;
    const test = State.chess.move(moveObj);
    if (!test) { SoundEngine.illegal(); return false; }
    State.chess.undo();

    Multiplayer.sendMove(from, to, promotion);
    State.selected = null;
    State.legalTargets = [];
    renderBoard(); // re-render to clear selection
    return true;
  }
  return _origTryMove(from, to, promotion);
};

// Patch the board click handler to use the wrapper
const _origSquareClick = onSquareClick;

// ---- Apply move from server ----
function applyOnlineMove(data) {
  const result = State.chess.move({
    from: data.from, to: data.to,
    promotion: data.promotion || undefined
  });
  if (!result) return;

  State.selected     = null;
  State.legalTargets = [];
  State.lastMove     = { from: data.from, to: data.to };
  State.historyIdx   = -1;

  if (State.soundOn) {
    if (result.flags.includes('k') || result.flags.includes('q')) SoundEngine.castle();
    else if (result.flags.includes('p')) SoundEngine.promote();
    else if (data.captured) SoundEngine.capture();
    else SoundEngine.move();
    if (State.chess.in_check()) setTimeout(() => SoundEngine.check(), 100);
  }

  if (data.whiteMs !== undefined) {
    $('time-white').textContent = ChessClock.fmt(data.whiteMs);
    $('time-black').textContent = ChessClock.fmt(data.blackMs);
  }

  renderBoard();
}

// ---- Clock sync from server ----
function handleClockSync({ white, black, turn }) {
  $('time-white').textContent = ChessClock.fmt(white);
  $('time-black').textContent = ChessClock.fmt(black);
  const cw = $('clock-white'), cb = $('clock-black');
  cw.classList.toggle('active',   turn === 'w');
  cb.classList.toggle('active',   turn === 'b');
  cw.classList.toggle('low-time', white < 10000 && turn === 'w');
  cb.classList.toggle('low-time', black < 10000 && turn === 'b');
}

// ---- Start the online game ----
function startOnlineGame(data) {
  ChessClock.stop();
  State.chess        = new Chess();
  State.gameOver     = false;
  State.selected     = null;
  State.legalTargets = [];
  State.lastMove     = null;
  State.historyIdx   = -1;
  State.promoFrom    = null;
  State.promoTo      = null;
  State.onlineRoomId = data.roomId;
  State.playerColor  = State.onlineColor;
  State.flipped      = (State.onlineColor === 'b');
  State.names.w      = data.whiteName;
  State.names.b      = data.blackName;
  $('name-white').textContent = data.whiteName;
  $('name-black').textContent = data.blackName;
  closeModal('modal-online');
  closeModal('modal-gameover');
  $('btn-chat-toggle').style.display = '';
  renderBoard();
  updateStatusBar();
  toast(`Game started! You are ${State.onlineColor === 'w' ? '♔ White' : '♚ Black'}`, 'success', 3000);
}

// ---- Handle server game-over ----
function handleOnlineGameOver({ result, reason }) {
  State.gameOver = true;
  ChessClock.stop();
  const REASONS = {
    checkmate:'By Checkmate ♟', stalemate:'Stalemate',
    resignation:'By Resignation 🏳', agreement:'By Mutual Agreement 🤝',
    timeout:'On Time ⏰', disconnect:'Opponent Disconnected 🔌',
    insufficient_material:'Insufficient Material',
    threefold_repetition:'Threefold Repetition',
    fifty_move_rule:'50-Move Rule',
  };
  const isDraw  = result === 'draw';
  const iWin    = result === State.onlineColor;
  const winCol  = result === 'white' ? 'w' : result === 'black' ? 'b' : null;
  const winName = winCol ? State.names[winCol] : null;
  $('go-icon').textContent  = isDraw ? '🤝' : iWin ? '🏆' : '😔';
  $('go-title').textContent = isDraw ? 'Draw!' : `${winName} wins!`;
  $('go-sub').textContent   = REASONS[reason] || reason;
  $('go-stats').innerHTML   = `
    <div>Result: <span>${isDraw ? 'Draw' : winName + ' wins'}</span></div>
    <div>Reason: <span>${REASONS[reason] || reason}</span></div>
    <div>Moves: <span>${State.chess.history().length}</span></div>
  `;
  if (State.soundOn) SoundEngine.gameOver(iWin);
  updateStatusBar();
  setTimeout(() => openModal('modal-gameover'), 600);
}

// ---- Chat ----
function addChatMessage(name, message, isMine, isSystem = false) {
  const msgs = $('chat-messages');
  const div  = document.createElement('div');
  if (isSystem) {
    div.className   = 'chat-msg system';
    div.textContent = message;
  } else {
    div.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');
    const nm = document.createElement('div');
    nm.className   = 'chat-msg-name';
    nm.textContent = name;
    div.appendChild(nm);
    div.appendChild(document.createTextNode(message));
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!State.chatOpen && !isSystem) {
    State.chatUnread++;
    const b = $('chat-badge');
    b.textContent  = State.chatUnread > 9 ? '9+' : State.chatUnread;
    b.style.display = '';
  }
}

function sendChat() {
  const inp = $('chat-input');
  const msg = inp.value.trim();
  if (!msg || State.mode !== 'online') return;
  Multiplayer.sendChat(msg);
  addChatMessage('You', msg, true);
  inp.value = '';
}

function setOnlineStatus(msg, type = '') {
  const el = $('online-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'online-status ' + type;
}

// ---- Wire all online UI events ----
function wireOnlineMode() {

  // Online mode button
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode !== 'online') return;
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.mode = 'online';
      $('ai-card').style.display = 'none';
      setOnlineStatus('Connecting…', 'info');
      try {
        await Multiplayer.connect();
        setOnlineStatus('Connected ✓', 'ok');
      } catch (e) {
        setOnlineStatus('Cannot connect: ' + e.message, 'err');
      }
      openModal('modal-online');
    });
  });

  $('close-online').addEventListener('click', () => closeModal('modal-online'));

  // Tabs
  $('otab-create').addEventListener('click', () => {
    $('otab-create').classList.add('active');
    $('otab-join').classList.remove('active');
    $('opanel-create').style.display = '';
    $('opanel-join').style.display   = 'none';
    $('room-waiting').style.display  = 'none';
  });
  $('otab-join').addEventListener('click', () => {
    $('otab-join').classList.add('active');
    $('otab-create').classList.remove('active');
    $('opanel-join').style.display   = '';
    $('opanel-create').style.display = 'none';
    $('room-waiting').style.display  = 'none';
  });

  // Create room
  $('btn-create-room').addEventListener('click', () => {
    const name  = $('online-name-create').value.trim() || 'Player';
    const color = $('online-color').value;
    const timeVal = $('online-time').value; // e.g., "5+0"
    const [tMin, tInc] = timeVal.split('+').map(Number);
    State.timeMin = tMin;
    State.timeInc = tInc;

    State.onlineName  = name;
    State.onlineColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    setOnlineStatus('Creating room…', 'info');
    Multiplayer.createRoom({ playerName: name, timeMin: State.timeMin, timeInc: State.timeInc, preferColor: color });
  });

  // Join room
  $('btn-join-room').addEventListener('click', () => {
    const name = $('online-name-join').value.trim() || 'Player';
    const code = $('room-code-input').value.trim().toUpperCase();
    if (!code || code.length < 4) { setOnlineStatus('Enter a valid room code', 'err'); return; }
    State.onlineName  = name;
    State.onlineColor = null; // server assigns
    setOnlineStatus('Joining ' + code + '…', 'info');
    Multiplayer.joinRoom({ roomId: code, playerName: name });
  });

  // Copy buttons
  $('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText($('rcd-code').textContent)
      .then(() => toast('Code copied!', 'success', 1500));
  });
  $('btn-copy-link').addEventListener('click', () => {
    const link = `${window.location.origin}?room=${$('rcd-code').textContent}`;
    navigator.clipboard.writeText(link).then(() => toast('Link copied!', 'success', 1500));
  });

  // Draw modal
  $('btn-online-accept-draw').addEventListener('click', () => {
    Multiplayer.sendDrawAccept();
    closeModal('modal-online-draw');
  });
  $('btn-online-decline-draw').addEventListener('click', () => {
    Multiplayer.sendDrawDecline();
    closeModal('modal-online-draw');
  });

  // Takeback modal
  $('btn-accept-takeback').addEventListener('click', () => {
    Multiplayer.acceptTakeback();
    closeModal('modal-takeback');
  });
  $('btn-decline-takeback').addEventListener('click', () => {
    Multiplayer.declineTakeback();
    closeModal('modal-takeback');
  });

  // Intercept board controls for online mode
  $('btn-resign').addEventListener('click', () => {
    if (State.mode !== 'online' || State.gameOver) return;
    if (confirm('Resign this game?')) Multiplayer.sendResign();
  }, true);

  $('btn-draw').addEventListener('click', () => {
    if (State.mode !== 'online' || State.gameOver) return;
    Multiplayer.sendDrawOffer();
    toast('Draw offer sent!', 'info', 2000);
  }, true);

  $('btn-undo').addEventListener('click', () => {
    if (State.mode !== 'online') return;
    Multiplayer.requestTakeback();
    toast('Takeback requested…', 'info', 2000);
  }, true);

  // Chat panel
  $('btn-chat-toggle').addEventListener('click', () => {
    State.chatOpen = true;
    $('chat-panel').classList.add('open');
    State.chatUnread = 0;
    const b = $('chat-badge');
    b.textContent = ''; b.style.display = 'none';
  });
  $('close-chat').addEventListener('click', () => {
    State.chatOpen = false;
    $('chat-panel').classList.remove('open');
  });
  $('btn-send-chat').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // ========== Socket event listeners ==========

  Multiplayer.on('room-created', ({ roomId, color }) => {
    State.onlineColor  = color;
    State.onlineRoomId = roomId;
    $('opanel-create').style.display = 'none';
    $('room-waiting').style.display  = '';
    $('rcd-code').textContent = roomId;
    setOnlineStatus('Waiting for opponent…', 'info');
    toast(`Room ${roomId} created! Share the code.`, 'success', 4000);
  });

  Multiplayer.on('join-error', msg => {
    setOnlineStatus(msg, 'err');
    toast(msg, 'error', 4000);
  });

  Multiplayer.on('game-start', data => {
    // If joiner — server assigned color based on what creator didn't take
    if (!State.onlineColor) {
      // We are the joiner; the creator took some color, we get the other
      // The server sends both socket IDs — figure out which is ours
      // Simplest: onlineColor gets assigned when we joined the room
      // It was set to null, so set it now from who we aren't
      State.onlineColor = data.whiteSocketId === Multiplayer._socketId ? 'w' : 'b';
    }
    startOnlineGame(data);
  });

  Multiplayer.on('move-made',  data  => applyOnlineMove(data));
  Multiplayer.on('clock-sync', data  => handleClockSync(data));
  Multiplayer.on('game-over',  data  => handleOnlineGameOver(data));

  Multiplayer.on('draw-offered', data => {
    $('draw-offered-by').textContent = `${data.by || 'Opponent'} offers a draw.`;
    openModal('modal-online-draw');
  });
  Multiplayer.on('draw-declined', data => {
    closeModal('modal-online-draw');
    toast(`${data.by || 'Opponent'} declined the draw.`, 'info', 2000);
  });

  Multiplayer.on('takeback-requested', data => {
    $('takeback-from').textContent = `${data.by || 'Opponent'} wants to take back their last move.`;
    openModal('modal-takeback');
  });
  Multiplayer.on('takeback-done', () => {
    closeModal('modal-takeback');
    State.chess.undo();
    State.lastMove = null; State.selected = null; State.legalTargets = [];
    renderBoard();
    toast('Takeback accepted.', 'info', 2000);
  });
  Multiplayer.on('takeback-declined', () => {
    closeModal('modal-takeback');
    toast('Takeback declined.', 'info', 2000);
  });

  Multiplayer.on('opponent-disconnected', data => {
    addChatMessage('', `${data.name || 'Opponent'} disconnected. 60s to reconnect…`, false, true);
    toast('Opponent disconnected!', 'error', 5000);
  });
  Multiplayer.on('opponent-reconnected', data => {
    addChatMessage('', `${data.name || 'Opponent'} reconnected!`, false, true);
    toast('Opponent reconnected!', 'success', 2000);
  });

  Multiplayer.on('chat-message', data => {
    addChatMessage(data.name, data.message, data.name === State.onlineName);
  });

  Multiplayer.on('rejoin-ok', data => {
    const tmp = new Chess();
    try { if (data.pgn) tmp.load_pgn(data.pgn); } catch (e) {}
    State.chess        = tmp;
    State.gameOver     = data.status === 'finished';
    State.names.w      = data.whiteName;
    State.names.b      = data.blackName;
    State.onlineColor  = Multiplayer.myColor;
    State.playerColor  = State.onlineColor;
    State.flipped      = State.onlineColor === 'b';
    closeModal('modal-online');
    renderBoard();
    toast('Reconnected!', 'success', 2000);
  });

  Multiplayer.on('error', msg => {
    setOnlineStatus(msg, 'err');
    toast(msg, 'error');
  });

  // Auto-join via URL ?room=CODE
  const autoRoom = new URLSearchParams(window.location.search).get('room');
  if (autoRoom) {
    setTimeout(() => {
      document.querySelector('.mode-btn[data-mode="online"]')?.click();
      setTimeout(() => {
        $('otab-join').click();
        $('room-code-input').value = autoRoom.toUpperCase();
        toast(`Room code ${autoRoom} pre-filled — enter name & join!`, 'info', 4000);
      }, 600);
    }, 1200);
  }
}

// Also expose the socket id for the join-color determination
Object.defineProperty(Multiplayer, '_socketId', {
  get() { return this.isConnected && window._mpSocket ? window._mpSocket.id : null; }
});

// ============================================================
// BOOTSTRAP — must be last so Auth + showLandingPage are defined
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


