/**
 * CHESSMASTER PRO — VOICE COMMAND ENGINE
 * Uses Web Speech API to accept spoken chess moves
 */

const VoiceEngine = (() => {

  let recognition = null;
  let isListening = false;
  let onResultCb = null;
  let onStatusCb = null;

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

  /**
   * Parse a spoken sentence into a chess command object.
   * Returns: { action } | { move: '<SAN or {from,to}>' } | null
   */
  function parseText(text) {
    text = text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');

    // --- Direct actions ---
    if (/\bresign\b/.test(text))                     return { action: 'resign' };
    if (/\b(offer\s*)?draw\b/.test(text))            return { action: 'draw' };
    if (/\bnew\s*game\b/.test(text))                 return { action: 'newGame' };
    if (/\bflip\b/.test(text))                       return { action: 'flip' };
    if (/\bundo\b|\btake\s*back\b/.test(text))       return { action: 'undo' };
    if (/\baccept\b/.test(text))                     return { action: 'acceptDraw' };

    // --- Castling ---
    if (/\bcastle\s*king\s*side\b|\bking\s*side\s*castle\b|\bshort\s*castle\b|\bo[\s-]o(?!\s*o)\b/.test(text))
      return { move: 'O-O' };
    if (/\bcastle\s*queen\s*side\b|\bqueen\s*side\s*castle\b|\blong\s*castle\b|\bo[\s-]o[\s-]o\b/.test(text))
      return { move: 'O-O-O' };

    // --- Extract piece ---
    let piece = '';
    let workText = text;
    for (const [name, letter] of Object.entries(PIECE_MAP)) {
      if (workText.includes(name)) {
        piece = letter;
        workText = workText.replace(new RegExp(`\\b${name}\\b`, 'g'), '').trim();
        break;
      }
    }

    // Remove filler words
    workText = workText.replace(/\b(to|from|at|takes|captures|goes|move|on|the|a)\b/g, ' ').trim();

    // --- Extract squares: look for file+rank pairs ---
    // First add file aliases
    const words = workText.split(/\s+/);
    let squares = [];

    // Try to find squares directly (e.g., e4, h6)
    const directSquare = /\b([a-h])([1-8])\b/g;
    let m;
    while ((m = directSquare.exec(workText)) !== null) {
      squares.push(m[1] + m[2]);
    }

    // If not enough, try word-pair like "echo four" → e4
    if (squares.length === 0) {
      const ranks = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
                      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8 };
      // Try consecutive word pairs
      for (let i = 0; i < words.length - 1; i++) {
        const file = normaliseFile(words[i]);
        const rank = ranks[words[i + 1]];
        if (file && rank) squares.push(file + rank);
      }
      // Also handle rank right after file word in same token like "echo4"
      for (const w of words) {
        const fPart = normaliseFile(w.replace(/\d+$/, ''));
        const rPart = parseInt(w.match(/\d+$/)?.[0]);
        if (fPart && rPart >= 1 && rPart <= 8) squares.push(fPart + rPart);
      }
    }

    if (squares.length === 0) return null;

    const toSq = squares[squares.length - 1];
    const fromSq = squares.length >= 2 ? squares[0] : null;

    // Build result
    if (fromSq) {
      return { move: { from: fromSq, to: toSq } };
    }

    // Build SAN-style hint (app.js will try it against legal moves)
    return { move: piece + toSq, piece, toSq };
  }

  function isSupported() {
    return ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  function init() {
    if (!isSupported()) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      isListening = true;
      if (onStatusCb) onStatusCb('listening');
    };

    recognition.onend = () => {
      isListening = false;
      if (onStatusCb) onStatusCb('idle');
    };

    recognition.onerror = (e) => {
      isListening = false;
      if (onStatusCb) onStatusCb('error:' + e.error);
    };

    recognition.onresult = (e) => {
      let transcript = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) { isFinal = true; break; }
      }

      // Also check alternatives for finals
      if (!isFinal && e.results.length > 0 && e.results[e.results.length - 1].isFinal) {
        const result = e.results[e.results.length - 1];
        for (let j = 0; j < result.length; j++) {
          const alt = result[j].transcript;
          const parsed = parseText(alt);
          if (parsed) { transcript = alt; isFinal = true; break; }
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

  function start() {
    if (!recognition) {
      if (!init()) return false;
    }
    if (isListening) return true;
    try { recognition.start(); return true; }
    catch (e) { return false; }
  }

  function stop() {
    if (recognition && isListening) recognition.stop();
  }

  function toggle() {
    if (isListening) { stop(); return false; }
    else { return start(); }
  }

  return {
    isSupported,
    init,
    start,
    stop,
    toggle,
    parseText,
    onResult(cb) { onResultCb = cb; },
    onStatus(cb) { onStatusCb = cb; },
    get listening() { return isListening; }
  };
})();
