/**
 * CHESSMASTER PRO — CHESS CLOCK
 * Dual countdown clock with increment support
 */

const ChessClock = (() => {

  let timeWhite = 0;   // ms remaining
  let timeBlack = 0;
  let increment = 0;   // seconds added after each move
  let active = null;   // 'w' | 'b' | null
  let timer = null;
  let lastTick = null;
  let onExpireCb = null;
  let onTickCb = null;
  const LOW_TIME = 10000; // 10s warning threshold

  // -- Helpers --
  function fmt(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function tick() {
    if (active === null || lastTick === null) return;
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;

    if (active === 'w') {
      timeWhite -= elapsed;
      if (timeWhite <= 0) { timeWhite = 0; expire('w'); return; }
    } else {
      timeBlack -= elapsed;
      if (timeBlack <= 0) { timeBlack = 0; expire('b'); return; }
    }

    if (onTickCb) onTickCb(getState());
  }

  function expire(color) {
    clearInterval(timer);
    timer = null; active = null;
    if (onExpireCb) onExpireCb(color);
  }

  // -- Public API --
  function setup(minutes, incrementSec) {
    clearInterval(timer);
    timer = null;
    active = null;
    lastTick = null;
    increment = (incrementSec || 0) * 1000;
    const ms = (minutes || 5) * 60 * 1000;
    timeWhite = ms;
    timeBlack = ms;
  }

  function start(color) {
    if (timer) { clearInterval(timer); }
    active = color;
    lastTick = Date.now();
    timer = setInterval(tick, 100);
  }

  function switchTurn() {
    if (active === null) return;
    // Add increment to the player who just moved
    if (active === 'w') timeWhite += increment;
    else timeBlack += increment;
    active = active === 'w' ? 'b' : 'w';
    lastTick = Date.now();
  }

  function pause() {
    clearInterval(timer);
    timer = null;
    active = null;
  }

  function resume(color) {
    if (!color) return;
    active = color;
    lastTick = Date.now();
    timer = setInterval(tick, 100);
  }

  function stop() {
    clearInterval(timer);
    timer = null; active = null; lastTick = null;
  }

  function setTime(color, ms) {
    if (color === 'w') timeWhite = ms;
    else timeBlack = ms;
  }

  function getState() {
    return {
      white: timeWhite,
      black: timeBlack,
      whiteStr: fmt(timeWhite),
      blackStr: fmt(timeBlack),
      active,
      whiteLow: timeWhite < LOW_TIME,
      blackLow: timeBlack < LOW_TIME
    };
  }

  function onExpire(cb) { onExpireCb = cb; }
  function onTick(cb)   { onTickCb = cb; }

  return { setup, start, switchTurn, pause, resume, stop, setTime, getState, onExpire, onTick, fmt };
})();
