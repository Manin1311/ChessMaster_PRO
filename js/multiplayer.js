/**
 * CHESSMASTER PRO — CLIENT MULTIPLAYER MODULE
 * Socket.io client wrapper for online games
 */

const Multiplayer = (() => {
  let socket       = null;
  let roomId       = null;
  let myColor      = null;  // 'w' | 'b'
  let myName       = null;
  let connected    = false;
  let callbacks    = {};
  let stored       = {};    // saved room info for reconnect

  // ---- Server URL ----
  // When served by Node.js server, origin = server. Works locally and on Render.
  const SERVER_URL = window.location.origin;

  // ---- Internal emit ----
  function emit(event, data) {
    if (socket && connected) socket.emit(event, data);
  }

  // ---- Connect / Disconnect ----
  function connect() {
    return new Promise((resolve, reject) => {
      if (socket && connected) { resolve(); return; }

      // Load socket.io client dynamically if not already loaded
      if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = `${SERVER_URL}/socket.io/socket.io.js`;
        script.onload = () => initSocket(resolve, reject);
        script.onerror = () => reject(new Error('Could not load Socket.io client'));
        document.head.appendChild(script);
      } else {
        initSocket(resolve, reject);
      }
    });
  }

  function initSocket(resolve, reject) {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      connected = true;
      console.log('[MP] Connected:', socket.id);
      trigger('connected');
      resolve();
    });

    socket.on('connect_error', (err) => {
      console.error('[MP] Connection error:', err.message);
      trigger('error', 'Cannot connect to server: ' + err.message);
      if (!connected) reject(err);
    });

    socket.on('disconnect', (reason) => {
      connected = false;
      console.log('[MP] Disconnected:', reason);
      trigger('disconnected', reason);
    });

    socket.on('reconnect', () => {
      connected = true;
      // Try to rejoin the room
      if (roomId && myColor) {
        socket.emit('rejoin-room', { roomId, color: myColor, name: myName });
      }
    });

    // ---- Room events ----
    socket.on('room-created', ({ roomId: rid, color }) => {
      roomId  = rid;
      myColor = color;
      storeSession({ roomId: rid, color });
      trigger('room-created', { roomId: rid, color });
    });

    socket.on('join-error', (msg) => trigger('join-error', msg));

    socket.on('game-start', (data) => {
      roomId  = data.roomId;
      // Determine our color from socket IDs sent by server
      if (!myColor) {
        myColor = data.whiteSocketId === socket.id ? 'w' : 'b';
      }
      storeSession({ roomId: data.roomId, color: myColor });
      trigger('game-start', data);
    });

    socket.on('opponent-joined', (data) => trigger('opponent-joined', data));

    // ---- Move events ----
    socket.on('move-made', (data) => trigger('move-made', data));
    socket.on('invalid-move', (data) => trigger('invalid-move', data));

    // ---- Game flow ----
    socket.on('game-over',           (data) => trigger('game-over',           data));
    socket.on('draw-offered',        (data) => trigger('draw-offered',        data));
    socket.on('draw-declined',       (data) => trigger('draw-declined',       data));
    socket.on('takeback-requested',  (data) => trigger('takeback-requested',  data));
    socket.on('takeback-done',       (data) => trigger('takeback-done',       data));
    socket.on('takeback-declined',   ()     => trigger('takeback-declined',   {}));

    // ---- Connection status ----
    socket.on('opponent-disconnected', (data) => trigger('opponent-disconnected', data));
    socket.on('opponent-reconnected',  (data) => trigger('opponent-reconnected',  data));

    // ---- Reconnect ----
    socket.on('rejoin-ok', (data) => trigger('rejoin-ok', data));

    // ---- Clock sync ----
    socket.on('clock-sync', (data) => trigger('clock-sync', data));

    // ---- Chat ----
    socket.on('chat-message', (data) => trigger('chat-message', data));
  }

  // ---- Session persistence (for reconnect) ----
  function storeSession(data) {
    stored = { ...stored, ...data };
    try { localStorage.setItem('cm_session', JSON.stringify(stored)); } catch (e) {}
  }

  function loadSession() {
    try {
      const s = localStorage.getItem('cm_session');
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    stored = {};
    try { localStorage.removeItem('cm_session'); } catch (e) {}
  }

  // ---- Event bus ----
  function on(event, fn) {
    if (!callbacks[event]) callbacks[event] = [];
    callbacks[event].push(fn);
  }
  function off(event) { delete callbacks[event]; }
  function trigger(event, data) {
    (callbacks[event] || []).forEach(fn => fn(data));
  }

  // ---- Public actions ----
  function createRoom({ playerName, timeMin, timeInc, preferColor }) {
    myName = playerName;
    storeSession({ myName: playerName, timeMin, timeInc });
    emit('create-room', { playerName, timeMin, timeInc, preferColor });
  }

  function joinRoom({ roomId: rid, playerName }) {
    myName = playerName;
    myColor = null; // will be assigned by server via game-start
    emit('join-room', { roomId: rid, playerName });
  }

  function sendMove(from, to, promotion) {
    emit('move', { roomId, from, to, promotion });
  }

  function sendResign() {
    emit('resign', { roomId });
  }

  function sendDrawOffer() {
    emit('offer-draw', { roomId });
  }

  function sendDrawAccept() {
    emit('accept-draw', { roomId });
  }

  function sendDrawDecline() {
    emit('decline-draw', { roomId });
  }

  function requestTakeback() {
    emit('request-takeback', { roomId });
  }

  function acceptTakeback() {
    emit('accept-takeback', { roomId });
  }

  function declineTakeback() {
    emit('decline-takeback', { roomId });
  }

  function sendChat(message) {
    emit('chat', { roomId, message });
  }

  function rejoin() {
    const sess = loadSession();
    if (!sess || !sess.roomId) return false;
    roomId  = sess.roomId;
    myColor = sess.color;
    myName  = sess.myName;
    emit('rejoin-room', { roomId, color: myColor, name: myName });
    return true;
  }

  function disconnect() {
    clearSession();
    if (socket) { socket.disconnect(); socket = null; }
    connected = false; roomId = null; myColor = null;
  }

  return {
    connect,
    createRoom,
    joinRoom,
    sendMove,
    sendResign,
    sendDrawOffer,
    sendDrawAccept,
    sendDrawDecline,
    requestTakeback,
    acceptTakeback,
    declineTakeback,
    sendChat,
    rejoin,
    disconnect,
    loadSession,
    clearSession,
    on, off,
    get isConnected() { return connected; },
    get socketId()    { return socket ? socket.id : null; },
    get roomId()      { return roomId; },
    get myColor()     { return myColor; },
    get myName()      { return myName; },
  };
})();
