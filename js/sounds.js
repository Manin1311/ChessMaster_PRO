/**
 * CHESSMASTER PRO — SOUND ENGINE
 * Uses Web Audio API to synthesize all chess sounds (no audio files needed)
 */

const SoundEngine = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function playTone(frequency, duration, type = 'sine', gain = 0.3, decay = 0.8) {
    if (!enabled) return;
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gainNode = ac.createGain();
      osc.connect(gainNode);
      gainNode.connect(ac.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, ac.currentTime + duration);
      gainNode.gain.setValueAtTime(gain, ac.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration * decay);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration);
    } catch (e) { /* silently fail */ }
  }

  function playNoise(duration = 0.06, gain = 0.15) {
    if (!enabled) return;
    try {
      const ac = getCtx();
      const bufferSize = ac.sampleRate * duration;
      const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
      const source = ac.createBufferSource();
      source.buffer = buffer;
      const gainNode = ac.createGain();
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ac.destination);
      gainNode.gain.setValueAtTime(gain, ac.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      source.start();
      source.stop(ac.currentTime + duration);
    } catch (e) { /* silently fail */ }
  }

  return {
    setEnabled(val) { enabled = val; },

    move() {
      playNoise(0.08, 0.12);
      playTone(800, 0.08, 'sine', 0.08, 0.7);
    },

    capture() {
      playNoise(0.12, 0.25);
      playTone(320, 0.15, 'sawtooth', 0.1, 0.6);
    },

    check() {
      playTone(880, 0.12, 'sine', 0.2, 0.7);
      setTimeout(() => playTone(1100, 0.1, 'sine', 0.15, 0.7), 120);
    },

    castle() {
      playTone(600, 0.08, 'sine', 0.12, 0.6);
      setTimeout(() => playTone(800, 0.08, 'sine', 0.1, 0.6), 90);
    },

    promote() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.18, 'sine', 0.2, 0.8), i * 100);
      });
    },

    gameOver(win = true) {
      if (win) {
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          setTimeout(() => playTone(f, 0.3, 'sine', 0.25, 0.9), i * 120)
        );
      } else {
        [523, 466, 440, 392].forEach((f, i) =>
          setTimeout(() => playTone(f, 0.35, 'sine', 0.2, 0.9), i * 130)
        );
      }
    },

    draw() {
      [523, 523, 659].forEach((f, i) =>
        setTimeout(() => playTone(f, 0.25, 'sine', 0.15, 0.85), i * 120)
      );
    },

    clockWarning() {
      playTone(880, 0.06, 'square', 0.08, 0.5);
    },

    illegal() {
      playTone(200, 0.15, 'sawtooth', 0.1, 0.4);
    },

    // Resume audio context on first user gesture
    unlock() {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }
  };
})();
