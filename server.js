/**
 * CHESSMASTER PRO — SERVER
 * Express + Socket.io + Neon PostgreSQL
 * Handles real-time multiplayer chess games
 */

require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const db        = require('./server/db');

// chess.js 0.10.3 CommonJS require
const ChessLib  = require('chess.js');
const Chess     = ChessLib.Chess || ChessLib;

// ============================================================
// EXPRESS + SOCKET.IO SETUP
// ============================================================
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json());

// Serve the entire Chess_App folder as static files
app.use(express.static(path.join(__dirname)));

// Fallback — serve index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// REST ENDPOINTS
// ============================================================
app.get('/api/game/:roomId', async (req, res) => {
  try {
    const game = await db.getGame(req.params.roomId.toUpperCase());
    res.json(game || { error: 'Not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recent', async (req, res) => {
  try { res.json(await db.getRecentGames()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// IN-MEMORY ROOM STORE
// ============================================================
const rooms = new Map(); // roomId → Room object

function makeRoom(id, timeMin, timeInc) {
  return {
    id,
    chess:      new Chess(),
    white:      null,      // { socketId, name, sessionId }
    black:      null,
    timeMin:    timeMin || 10,
    timeInc:    timeInc || 0,
    whiteMs:    (timeMin || 10) * 60 * 1000,
    blackMs:    (timeMin || 10) * 60 * 1000,
    status:     'waiting', // 'waiting' | 'active' | 'finished'
    lastTick:   null,
    clockTimer: null,
    reconnectTimers: {},
    drawOfferedBy: null,
    takebackRequestedBy: null,
    moveCount: 0,
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit confusables
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ============================================================
// CLOCK MANAGEMENT
// ============================================================
function startClock(room) {
  stopClock(room);
  room.lastTick = Date.now();
  room.clockTimer = setInterval(() => tickClock(room), 500);
}

function stopClock(room) {
  if (room.clockTimer) { clearInterval(room.clockTimer); room.clockTimer = null; }
}

function tickClock(room) {
  if (room.status !== 'active') { stopClock(room); return; }
  const now = Date.now();
  const elapsed = now - (room.lastTick || now);
  room.lastTick = now;

  const turn = room.chess.turn();
  if (turn === 'w') room.whiteMs -= elapsed;
  else              room.blackMs -= elapsed;

  // Clamp to 0
  if (room.whiteMs < 0) room.whiteMs = 0;
  if (room.blackMs < 0) room.blackMs = 0;

  // Broadcast clock state
  io.to(room.id).emit('clock-sync', { white: room.whiteMs, black: room.blackMs, turn });

  // Timeout?
  if (room.whiteMs <= 0 || room.blackMs <= 0) {
    const loser  = room.whiteMs <= 0 ? 'w' : 'b';
    const winner = loser === 'w' ? 'black' : 'white';
    endGame(room, winner, 'timeout');
  }
}

function addIncrement(room, color) {
  if (room.timeInc <= 0) return;
  const ms = room.timeInc * 1000;
  if (color === 'w') room.whiteMs += ms;
  else               room.blackMs += ms;
}

// ============================================================
// GAME END HELPER
// ============================================================
async function endGame(room, result, reason) {
  if (room.status === 'finished') return;
  room.status = 'finished';
  stopClock(room);
  io.to(room.id).emit('game-over', { result, reason });
  try {
    await db.finishGame(room.id, result, room.chess.pgn(), room.chess.fen());
  } catch (e) { /* non-critical */ }
}

// ============================================================
// SOCKET.IO EVENTS
// ============================================================
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ----------------------------------------------------------
  // CREATE ROOM
  // ----------------------------------------------------------
  socket.on('create-room', async ({ playerName, timeMin, timeInc, preferColor }) => {
    const roomId   = generateRoomCode();
    const room     = makeRoom(roomId, timeMin, timeInc);
    const myColor  = preferColor === 'random'
      ? (Math.random() < 0.5 ? 'w' : 'b')
      : (preferColor || 'w');

    const playerInfo = { socketId: socket.id, name: (playerName || 'Player').trim().slice(0, 30) };
    if (myColor === 'w') room.white = playerInfo;
    else                 room.black = playerInfo;

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data = { roomId, color: myColor, name: playerInfo.name };

    try {
      await db.createGame({
        id: roomId, timeMin, timeInc,
        whiteSession: myColor === 'w' ? socket.id : null,
        blackSession: myColor === 'b' ? socket.id : null,
        whiteName: myColor === 'w' ? playerInfo.name : 'TBD',
        blackName: myColor === 'b' ? playerInfo.name : 'TBD',
      });
    } catch (e) { console.error('[DB] createGame:', e.message); }

    socket.emit('room-created', { roomId, color: myColor });
    console.log(`[Room] ${roomId} created by ${playerInfo.name} as ${myColor}`);
  });

  // ----------------------------------------------------------
  // JOIN ROOM
  // ----------------------------------------------------------
  socket.on('join-room', async ({ roomId, playerName }) => {
    roomId = (roomId || '').toUpperCase().trim();
    const room = rooms.get(roomId);

    if (!room)                        { socket.emit('join-error', 'Room not found. Check the code.'); return; }
    if (room.status !== 'waiting')    { socket.emit('join-error', 'This game has already started.'); return; }
    if (room.white && room.black)     { socket.emit('join-error', 'Room is full.'); return; }

    const myColor    = room.white ? 'b' : 'w';
    const playerInfo = { socketId: socket.id, name: (playerName || 'Player').trim().slice(0, 30) };
    if (myColor === 'w') room.white = playerInfo;
    else                 room.black = playerInfo;

    socket.join(roomId);
    socket.data = { roomId, color: myColor, name: playerInfo.name };
    room.status = 'active';

    try {
      await db.updateGamePlayers(roomId, {
        whiteSession: room.white?.socketId,
        blackSession: room.black?.socketId,
        whiteName:    room.white?.name,
        blackName:    room.black?.name,
        status:       'active',
      });
    } catch (e) { console.error('[DB] updateGamePlayers:', e.message); }

    // Notify both players: game is starting
    io.to(roomId).emit('game-start', {
      roomId,
      whiteName:     room.white.name,
      blackName:     room.black.name,
      fen:           room.chess.fen(),
      timeMin:       room.timeMin,
      timeInc:       room.timeInc,
      whiteSocketId: room.white.socketId,
      blackSocketId: room.black.socketId,
    });

    startClock(room);
    console.log(`[Room] ${roomId}: ${room.white.name} vs ${room.black.name}`);
  });

  // ----------------------------------------------------------
  // MOVE
  // ----------------------------------------------------------
  socket.on('move', async ({ roomId, from, to, promotion }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;

    const turn        = room.chess.turn();
    const playerColor = socket.data?.color;
    if (turn !== playerColor) { socket.emit('invalid-move', { reason: 'not your turn' }); return; }

    const moveObj = { from, to };
    if (promotion) moveObj.promotion = promotion;

    const result = room.chess.move(moveObj);
    if (!result) { socket.emit('invalid-move', { reason: 'illegal move', from, to }); return; }

    // Update clock: add increment AFTER move
    addIncrement(room, turn);
    room.lastTick = Date.now(); // reset tick
    room.moveCount++;

    const payload = {
      from:      result.from,
      to:        result.to,
      san:       result.san,
      flags:     result.flags,
      captured:  result.captured || null,
      promotion: result.promotion || null,
      fen:       room.chess.fen(),
      pgn:       room.chess.pgn(),
      whiteMs:   room.whiteMs,
      blackMs:   room.blackMs,
      moveNum:   room.moveCount,
    };

    io.to(roomId).emit('move-made', payload);

    // Persist move
    try {
      await db.recordMove(roomId, room.moveCount, turn, result.san, from, to, room.chess.fen());
      if (room.moveCount % 5 === 0) {
        await db.updateGameState(roomId, room.chess.fen(), room.chess.pgn(), room.whiteMs, room.blackMs);
      }
    } catch (e) { /* non-critical */ }

    // Check game over
    if (room.chess.game_over()) {
      let gameResult = 'draw';
      if (room.chess.in_checkmate()) gameResult = turn === 'w' ? 'black' : 'white';
      const reason = room.chess.in_checkmate()      ? 'checkmate'
                   : room.chess.in_stalemate()      ? 'stalemate'
                   : room.chess.insufficient_material() ? 'insufficient_material'
                   : room.chess.in_threefold_repetition() ? 'threefold_repetition'
                   : 'fifty_move_rule';
      await endGame(room, gameResult, reason);
    }
  });

  // ----------------------------------------------------------
  // RESIGN
  // ----------------------------------------------------------
  socket.on('resign', async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;
    const loser  = socket.data?.color;
    const winner = loser === 'w' ? 'black' : 'white';
    await endGame(room, winner, 'resignation');
  });

  // ----------------------------------------------------------
  // DRAW OFFER / ACCEPT / DECLINE
  // ----------------------------------------------------------
  socket.on('offer-draw', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;
    room.drawOfferedBy = socket.data?.color;
    socket.to(roomId).emit('draw-offered', { by: socket.data?.name });
  });

  socket.on('accept-draw', async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;
    await endGame(room, 'draw', 'agreement');
  });

  socket.on('decline-draw', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.drawOfferedBy = null;
    socket.to(roomId).emit('draw-declined', { by: socket.data?.name });
  });

  // ----------------------------------------------------------
  // TAKEBACK
  // ----------------------------------------------------------
  socket.on('request-takeback', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;
    room.takebackRequestedBy = socket.data?.color;
    socket.to(roomId).emit('takeback-requested', { by: socket.data?.name });
  });

  socket.on('accept-takeback', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;
    room.chess.undo();
    if (room.moveCount > 0) room.moveCount--;
    room.takebackRequestedBy = null;
    io.to(roomId).emit('takeback-done', {
      fen: room.chess.fen(),
      pgn: room.chess.pgn(),
    });
  });

  socket.on('decline-takeback', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) room.takebackRequestedBy = null;
    socket.to(roomId).emit('takeback-declined');
  });

  // ----------------------------------------------------------
  // CHAT
  // ----------------------------------------------------------
  socket.on('chat', ({ roomId, message }) => {
    if (!message || message.trim().length === 0) return;
    io.to(roomId).emit('chat-message', {
      name:    socket.data?.name || 'Player',
      color:   socket.data?.color,
      message: message.trim().slice(0, 200),
      ts:      Date.now(),
    });
  });

  // ----------------------------------------------------------
  // RECONNECT
  // ----------------------------------------------------------
  socket.on('rejoin-room', ({ roomId, color, name }) => {
    const room = rooms.get(roomId);
    if (!room)                  { socket.emit('join-error', 'Room expired.'); return; }
    if (room.status === 'finished') { socket.emit('join-error', 'Game is already over.'); return; }

    // Clear any pending disconnect timer
    if (room.reconnectTimers[color]) {
      clearTimeout(room.reconnectTimers[color]);
      delete room.reconnectTimers[color];
    }

    // Re-assign socket ID
    if (color === 'w' && room.white) room.white.socketId = socket.id;
    if (color === 'b' && room.black) room.black.socketId = socket.id;

    socket.join(roomId);
    socket.data = { roomId, color, name };

    socket.emit('rejoin-ok', {
      fen:     room.chess.fen(),
      pgn:     room.chess.pgn(),
      timeMin: room.timeMin,
      timeInc: room.timeInc,
      whiteMs: room.whiteMs,
      blackMs: room.blackMs,
      whiteName: room.white?.name,
      blackName: room.black?.name,
      status:  room.status,
    });

    socket.to(roomId).emit('opponent-reconnected', { name });
  });

  // ----------------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const { roomId, color, name } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'active') return;

    socket.to(roomId).emit('opponent-disconnected', { name });

    // Allow 60 seconds to reconnect
    room.reconnectTimers[color] = setTimeout(async () => {
      if (room.status === 'active') {
        const winner = color === 'w' ? 'black' : 'white';
        await endGame(room, winner, 'disconnect');
      }
    }, 60000);
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n♟  ChessMaster Pro running on port ${PORT}`);
      console.log(`   http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('[DB] Init error (continuing without DB):', err.message);
    server.listen(PORT, () => {
      console.log(`\n♟  ChessMaster Pro running on port ${PORT} (no DB)\n`);
    });
  });
