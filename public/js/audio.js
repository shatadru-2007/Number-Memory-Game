/**
 * Web Audio API Sound Synthesizer for (DS) OpenCV Memory Game
 * Produces clean, zero-latency cybernetic audio cues without external assets.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // Cues
  playDigitBeep() {
    this.playTone(587.33, 'sine', 0.12, 0.15); // D5
  }

  playCountdownTick() {
    this.playTone(440, 'triangle', 0.08, 0.08); // A4
  }

  playGoBeep() {
    this.playTone(880, 'sine', 0.3, 0.2); // A5
  }

  playLockIn() {
    // Quick rising pitch
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    } catch (e) {}
  }

  playSuccess() {
    setTimeout(() => this.playTone(523.25, 'triangle', 0.1, 0.12), 0);
    setTimeout(() => this.playTone(659.25, 'triangle', 0.1, 0.12), 100);
    setTimeout(() => this.playTone(783.99, 'triangle', 0.25, 0.15), 200);
  }

  playError() {
    this.playTone(180, 'sawtooth', 0.2, 0.12);
  }
}

window.soundEngine = new SoundEngine();
