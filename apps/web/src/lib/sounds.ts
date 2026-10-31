'use client';

/**
 * Tiny Web-Audio notification chimes — synthesized, so there are no audio files
 * to ship and they work offline. Two distinct sounds: a soft two-note "ding" for
 * general notifications and a light "blip" for mentions.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Browsers suspend audio until a user gesture — resume the context on first interaction. */
export function initAudioUnlock() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Per-viewer mute switch (default on), so it can be turned off from the bell menu. */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem('astro.sound') !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem('astro.sound', on ? 'on' : 'off');
  } catch {
    /* private mode — ignore */
  }
}

function tone(
  c: AudioContext,
  opts: { freq: number; freqTo?: number; type?: OscillatorType; start: number; dur: number; gain?: number },
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, opts.start);
  if (opts.freqTo) osc.frequency.exponentialRampToValueAtTime(opts.freqTo, opts.start + opts.dur);
  const peak = opts.gain ?? 0.12;
  g.gain.setValueAtTime(0.0001, opts.start);
  g.gain.linearRampToValueAtTime(peak, opts.start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur);
  osc.connect(g).connect(c.destination);
  osc.start(opts.start);
  osc.stop(opts.start + opts.dur + 0.03);
}

function play(build: (c: AudioContext, t: number) => void) {
  if (!soundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  build(c, c.currentTime);
}

/** General notification: a gentle rising two-note ding. */
export function playNotificationSound() {
  play((c, t) => {
    tone(c, { freq: 660, start: t, dur: 0.13, gain: 0.11 });
    tone(c, { freq: 988, start: t + 0.1, dur: 0.2, gain: 0.09 });
  });
}

/** Mention: a short, brighter blip. */
export function playMessageSound() {
  play((c, t) => {
    tone(c, { type: 'triangle', freq: 540, freqTo: 820, start: t, dur: 0.14, gain: 0.1 });
  });
}
