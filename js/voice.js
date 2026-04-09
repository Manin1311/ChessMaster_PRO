/**
 * CHESSMASTER PRO — VOICE COMMAND ENGINE
 * Supports continuous always-on mode so players speak moves hands-free.
 */

const VoiceEngine = (() => {

  let recognition  = null;
  let isListening  = false;
  let alwaysOn     = false;   // hands-free mode
  let restartTimer = null;
  let onResultCb   = null;
  let onStatusCb   = null;

  // ---- Piece name → SAN letter ----
  const PIECE_MAP = {
    'king': 'K', 'queen': 'Q', 'rook': 'R', 'bishop': 'B',
    'knight': 'N', 'horse': 'N', 'pawn': '', 'castle': 'R'
  };

  // ---- Spoken file letter variants ----
  const FILE_ALIASES = {
    'alpha': 'a', 'bravo': 'b', 'charlie': 'c', 'delta': 'd',
    'echo': 'e', 'foxtrot': 'f', 'golf': 'g', 'hotel': 'h',
    'ay': 'a', 'bee': 'b', 'sea': 'c', 'see': 'c', 'dee': 'd',
    'he': 'h', 'aitch': 'h', 'aye': 'a'
  };

  function normaliseFile(word) {
    if (/^[a-h]$/.test(word)) return word;
    return FILE_ALIASES[word] || null;
  }

  function parseText(text) {
    text = text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');

    if (/\bresign\b/.test(text))                     return { action: 'resign' };
    if (/\b(offer\s*)?draw\b/.test(text))            return { action: 'draw' };
    if (/\bnew\s*game\b/.test(text))                 return { action: 'newGame' };
    if (/\bflip\b/.test(text))                       return { action: 'flip' };
    if (/\bundo\b|\btake\s*back\b/.test(text))       return { action: 'undo' };
    if (/\baccept\b/.test(text))                     return { action: 'acceptDraw' };

    if (/\bcastle\s*king\s*side\b|\bking\s*side\s*castle\b|\bshort\s*castle\b|\bo[\s-]o(?!\s*o)\b/.test(text))
      return { move: 'O-O' };
    if (/\bcastle\s*queen\s*side\b|\bqueen\s*side\s*castle\b|\blong\s*castle\b|\bo[\s-]o[\s-]o\b/.test(text))
      return { move: 'O-O-O' };

    let piece = '';
    let workText = text;
    for (const [name, letter] of Object.entries(PIECE_MAP)) {
      if (workText.includes(name)) {
        piece = letter;
        workText = workText.replace(new RegExp(`\\b${name}\\b`, 'g'), '').trim();
        break;
      }
    }

    workText = workText.replace(/\b(to|from|at|takes|captures|goes|move|on|the|a)\b/g, ' ').trim();

    const words = workText.split(/\s+/);
    let squares = [];

    const directSquare = /\b([a-h])([1-8])\b/g;
    let m;
    while ((m = directSquare.exec(workText)) !== null) squares.push(m[1] + m[2]);

    if (squares.length === 0) {
      const ranks = {
        'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,
        '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8
      };
      for (let i = 0; i < words.length - 1; i++) {
        const file = normaliseFile(words[i]);
        const rank = ranks[words[i + 1]];
        if (file && rank) squares.push(file + rank);
      }
      for (const w of words) {
        const fPart = normaliseFile(w.replace(/\d+$/, ''));
        const rPart = parseInt(w.match(/\d+$/)?.[0]);
        if (fPart && rPart >= 1 && rPart <= 8) squares.push(fPart + rPart);
      }
    }

    if (squares.length === 0) return null;
    const toSq   = squares[squares.length - 1];
    const fromSq = squares.length >= 2 ? squares[0] : null;
    if (fromSq) return { move: { from: fromSq, to: toSq } };
    return { move: piece + toSq, piece, toSq };
  }

  function isSupported() {
    return ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  // ---- Debounced restart helper ----
  function scheduleRestart(delay = 150) {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (alwaysOn && !isListening) {
        try { recognition.start(); } catch(e) { /* already started */ }
      }
    }, delay);
  }

  function init() {
    if (!isSupported()) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous    = false;  // we manage restarts ourselves
    recognition.interimResults = true;
    recognition.lang           = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      isListening = true;
      if (onStatusCb) onStatusCb(alwaysOn ? 'always-on' : 'listening');
    };

    recognition.onend = () => {
      isListening = false;
      if (alwaysOn) {
        scheduleRestart(120);
        // Keep status as "listening" visually — just a brief gap
        if (onStatusCb) onStatusCb('always-on');
      } else {
        if (onStatusCb) onStatusCb('idle');
      }
    };

    recognition.onerror = (e) => {
      isListening = false;
      if (alwaysOn && (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network')) {
        scheduleRestart(300);
        return;
      }
      if (!alwaysOn && onStatusCb) onStatusCb('error:' + e.error);
    };

    recognition.onresult = (e) => {
      let transcript = '';
      let isFinal    = false;

      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) { isFinal = true; break; }
      }

      // Try alternatives to find a parseable result
      if (!isFinal && e.results.length > 0 && e.results[e.results.length - 1].isFinal) {
        const last = e.results[e.results.length - 1];
        for (let j = 0; j < last.length; j++) {
          const alt = last[j].transcript;
          if (parseText(alt)) { transcript = alt; isFinal = true; break; }
        }
      }

      if (onStatusCb) onStatusCb('heard:' + transcript);

      if (isFinal && onResultCb) {
        const parsed = parseText(transcript);
        onResultCb(transcript, parsed);
      }
    };

    return true;
  }

  // ---- Single shot start ----
  function start() {
    if (!recognition && !init()) return false;
    if (isListening) return true;
    try { recognition.start(); return true; }
    catch (e) { return false; }
  }

  // ---- Stop everything ----
  function stop() {
    alwaysOn = false;
    clearTimeout(restartTimer);
    if (recognition && isListening) {
      try { recognition.stop(); } catch(e) {}
    }
    isListening = false;
    if (onStatusCb) onStatusCb('idle');
  }

  // ---- Single utterance toggle (old behaviour) ----
  function toggle() {
    if (alwaysOn || isListening) { stop(); return false; }
    return start();
  }

  // ---- Hands-free continuous toggle ----
  function toggleAlwaysOn() {
    if (alwaysOn) {
      stop();
      return false;
    }
    if (!recognition && !init()) return false;
    alwaysOn = true;
    if (!isListening) {
      try { recognition.start(); } catch(e) {}
    }
    return true;
  }

  return {
    isSupported,
    init,
    start,
    stop,
    toggle,
    toggleAlwaysOn,
    parseText,
    onResult(cb) { onResultCb = cb; },
    onStatus(cb) { onStatusCb = cb; },
    get listening()  { return isListening; },
    get isAlwaysOn() { return alwaysOn;    }
  };
})();
