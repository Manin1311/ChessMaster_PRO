/**
 * CHESSMASTER PRO — NEON DATABASE LAYER
 * All PostgreSQL interactions via pg Pool
 */

const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS games (
    id               VARCHAR(10)  PRIMARY KEY,
    white_session    VARCHAR(200),
    black_session    VARCHAR(200),
    white_name       VARCHAR(100) DEFAULT 'White',
    black_name       VARCHAR(100) DEFAULT 'Black',
    fen              TEXT         DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn              TEXT         DEFAULT '',
    status           VARCHAR(20)  DEFAULT 'waiting',
    result           VARCHAR(20),
    time_minutes     INTEGER      DEFAULT 10,
    time_increment   INTEGER      DEFAULT 0,
    white_time_ms    BIGINT,
    black_time_ms    BIGINT,
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS game_moves (
    id         SERIAL       PRIMARY KEY,
    game_id    VARCHAR(10)  REFERENCES games(id) ON DELETE CASCADE,
    move_num   INTEGER,
    color      CHAR(1),
    san        VARCHAR(20),
    from_sq    VARCHAR(2),
    to_sq      VARCHAR(2),
    fen_after  TEXT,
    created_at TIMESTAMPTZ  DEFAULT NOW()
  );
`;

async function init() {
  if (!pool) {
    console.log('[DB] No DATABASE_URL — running without persistence (in-memory only)');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    console.log('[DB] Schema ready ✓');
  } finally {
    client.release();
  }
}

async function query(sql, params) {
  if (!pool) return { rows: [] };
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ---- Game CRUD ----

async function createGame({ id, timeMin, timeInc, whiteSession, blackSession, whiteName, blackName }) {
  await query(
    `INSERT INTO games (id, white_session, black_session, white_name, black_name, time_minutes, time_increment, white_time_ms, black_time_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (id) DO NOTHING`,
    [id, whiteSession, blackSession, whiteName, blackName, timeMin, timeInc, timeMin * 60 * 1000]
  );
}

async function updateGamePlayers(id, { whiteSession, blackSession, whiteName, blackName, status }) {
  await query(
    `UPDATE games SET white_session=$2, black_session=$3, white_name=$4, black_name=$5, status=$6, updated_at=NOW()
     WHERE id=$1`,
    [id, whiteSession, blackSession, whiteName, blackName, status]
  );
}

async function updateGameState(id, fen, pgn, whiteTimeMs, blackTimeMs) {
  await query(
    `UPDATE games SET fen=$2, pgn=$3, white_time_ms=$4, black_time_ms=$5, updated_at=NOW() WHERE id=$1`,
    [id, fen, pgn, whiteTimeMs, blackTimeMs]
  );
}

async function recordMove(gameId, moveNum, color, san, from, to, fenAfter) {
  await query(
    `INSERT INTO game_moves (game_id, move_num, color, san, from_sq, to_sq, fen_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [gameId, moveNum, color, san, from, to, fenAfter]
  );
}

async function finishGame(id, result, pgn, fen) {
  await query(
    `UPDATE games SET status='finished', result=$2, pgn=$3, fen=$4, updated_at=NOW() WHERE id=$1`,
    [id, result, pgn, fen]
  );
}

async function getGame(id) {
  const res = await query('SELECT * FROM games WHERE id=$1', [id]);
  return res.rows[0] || null;
}

async function getRecentGames(limit = 20) {
  const res = await query(
    `SELECT id, white_name, black_name, status, result, time_minutes, created_at
     FROM games ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = { init, createGame, updateGamePlayers, updateGameState, recordMove, finishGame, getGame, getRecentGames };
