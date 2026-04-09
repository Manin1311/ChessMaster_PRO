/**
 * CHESSMASTER PRO — AI ENGINE
 * Minimax with Alpha-Beta Pruning + Piece-Square Tables
 * Difficulty levels 1–5 map to search depths 1–4
 */

const ChessAI = (() => {

  // Piece values (centipawns)
  const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-Square Tables (white perspective, will be mirrored for black)
  const PST = {
    p: [
       0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ],
    r: [
       0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    ],
    k: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    ]
  };

  // Endgame king table
  const PST_K_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
  ];

  function squareToIndex(square) {
    const file = square.charCodeAt(0) - 97; // a=0 .. h=7
    const rank = 8 - parseInt(square[1]);    // rank 8=0 .. rank 1=7
    return rank * 8 + file;
  }

  function getPST(piece, square, color) {
    const idx = squareToIndex(square);
    const table = PST[piece.type] || PST.p;
    return color === 'w' ? table[idx] : table[63 - idx];
  }

  // Is endgame? (queens gone or low material)
  function isEndgame(chess) {
    const board = chess.board();
    let queens = 0, rooks = 0, minors = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        if (p.type === 'q') queens++;
        if (p.type === 'r') rooks++;
        if (p.type === 'n' || p.type === 'b') minors++;
      }
    }
    return queens === 0 || (queens === 2 && rooks === 0 && minors <= 2);
  }

  // Static board evaluation
  function evaluate(chess) {
    if (chess.in_checkmate()) return chess.turn() === 'w' ? -30000 : 30000;
    if (chess.in_stalemate() || chess.in_draw()) return 0;

    const eg = isEndgame(chess);
    let score = 0;
    const board = chess.board();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const sq = String.fromCharCode(97 + c) + (8 - r);
        let val = PIECE_VALUE[piece.type];
        if (piece.type === 'k') {
          val += eg
            ? (piece.color === 'w' ? PST_K_END[r * 8 + c] : PST_K_END[(7 - r) * 8 + c])
            : getPST(piece, sq, piece.color);
        } else {
          val += getPST(piece, sq, piece.color);
        }
        score += piece.color === 'w' ? val : -val;
      }
    }
    return score;
  }

  // Order moves for better alpha-beta pruning (captures first)
  function orderMoves(chess, moves) {
    return moves.sort((a, b) => {
      const aCapture = a.includes('x') ? 1 : 0;
      const bCapture = b.includes('x') ? 1 : 0;
      const aCheck = a.includes('+') ? 1 : 0;
      const bCheck = b.includes('+') ? 1 : 0;
      return (bCapture + bCheck) - (aCapture + aCheck);
    });
  }

  // Minimax with Alpha-Beta Pruning
  function minimax(chess, depth, alpha, beta, isMax) {
    if (depth === 0 || chess.game_over()) {
      return evaluate(chess);
    }

    const moves = orderMoves(chess, chess.moves());

    if (isMax) {
      let best = -Infinity;
      for (const move of moves) {
        chess.move(move);
        best = Math.max(best, minimax(chess, depth - 1, alpha, beta, false));
        chess.undo();
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const move of moves) {
        chess.move(move);
        best = Math.min(best, minimax(chess, depth - 1, alpha, beta, true));
        chess.undo();
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  // Level → depth map
  const DEPTH_MAP = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 };

  // Level 1 randomness (partly random)
  function pickBestMove(chess, level) {
    const moves = chess.moves();
    if (!moves.length) return null;

    // Beginner: mostly random
    if (level === 1) {
      if (Math.random() < 0.75) return moves[Math.floor(Math.random() * moves.length)];
      level = 2;
    }

    // Level 2: still some randomness
    const randomChance = level === 2 ? 0.2 : level === 3 ? 0.05 : 0;

    const depth = DEPTH_MAP[level] || 2;
    const isMaximizing = chess.turn() === 'w';
    let bestMove = null;
    let bestVal = isMaximizing ? -Infinity : Infinity;

    const ordered = orderMoves(chess, [...moves]);

    for (const move of ordered) {
      if (Math.random() < randomChance) continue;
      chess.move(move);
      const val = minimax(chess, depth - 1, -Infinity, Infinity, !isMaximizing);
      chess.undo();
      const better = isMaximizing ? val > bestVal : val < bestVal;
      if (better) { bestVal = val; bestMove = move; }
    }

    return bestMove || moves[Math.floor(Math.random() * moves.length)];
  }

  return { pickBestMove, evaluate };
})();
