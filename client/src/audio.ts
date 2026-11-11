/**
 * Synthesized sound effects (WebAudio). No audio files, nothing to license.
 * Every effect is a short recipe of oscillators and filtered noise.
 */
const MUTE_KEY = 'relic-clash.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from the first tap. */
export function unlockAudio() {
  ac();
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* fine */
  }
  if (m) void ctx?.suspend();
  else ac();
}

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  dur?: number;
  vol?: number;
  delay?: number;
  attack?: number;
}

function tone({ freq, to, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }: ToneOpts) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

interface NoiseOpts {
  dur?: number;
  vol?: number;
  delay?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
}

function noise({ dur = 0.2, vol = 0.3, delay = 0, filter = 'lowpass', freq = 1200, to, q = 1 }: NoiseOpts) {
  const a = ac();
  if (!a || !master || !noiseBuf) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const note = (semi: number, base = 392) => base * 2 ** (semi / 12);

export const sfx = {
  select: () => tone({ freq: 660, type: 'triangle', dur: 0.05, vol: 0.12 }),
  swap: () => noise({ dur: 0.08, vol: 0.18, filter: 'bandpass', freq: 1800, q: 2 }),
  invalid: () => tone({ freq: 160, to: 110, type: 'square', dur: 0.14, vol: 0.12 }),
  /** Pitch climbs with each cascade. */
  clear: (cascade: number) => {
    const s = PENTA[Math.min(cascade * 2, PENTA.length - 1)];
    tone({ freq: note(s), type: 'triangle', dur: 0.12, vol: 0.22 });
    tone({ freq: note(s + 7), type: 'sine', dur: 0.18, vol: 0.12, delay: 0.04 });
  },
  special: () => [0, 4, 7, 12].forEach((s, i) => tone({ freq: note(s, 523), type: 'triangle', dur: 0.15, vol: 0.15, delay: i * 0.04 })),
  axe: () => noise({ dur: 0.3, vol: 0.35, filter: 'bandpass', freq: 400, to: 4000, q: 3 }),
  blast: () => {
    noise({ dur: 0.45, vol: 0.6, filter: 'lowpass', freq: 1500, to: 80 });
    tone({ freq: 90, to: 40, type: 'sine', dur: 0.4, vol: 0.5 });
  },
  drum: () => [0, 0.12, 0.24].forEach((d) => tone({ freq: 110, to: 50, type: 'sine', dur: 0.25, vol: 0.55, delay: d })),
  swordWhoosh: () => {
    noise({ dur: 0.65, vol: 0.4, filter: 'bandpass', freq: 600, to: 3500, q: 4 });
    tone({ freq: 1800, to: 2600, type: 'sine', dur: 0.6, vol: 0.05 });
  },
  swordRing: () => [2093, 3136].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.9, vol: 0.1, delay: i * 0.02 })),
  launch: () => noise({ dur: 0.35, vol: 0.25, filter: 'bandpass', freq: 300, to: 1200, q: 2 }),
  horn: () => {
    tone({ freq: 196, type: 'sawtooth', dur: 0.7, vol: 0.12, attack: 0.08 });
    tone({ freq: 294, type: 'sawtooth', dur: 0.7, vol: 0.08, attack: 0.08, delay: 0.25 });
  },
  shield: () => [0, 0.08].forEach((d) => tone({ freq: 880, to: 700, type: 'square', dur: 0.12, vol: 0.06, delay: d })),
  fire: () => noise({ dur: 0.6, vol: 0.35, filter: 'lowpass', freq: 3000, to: 300 }),
  crack: () => noise({ dur: 0.12, vol: 0.35, filter: 'highpass', freq: 2000 }),
  /** Rarity jingle: longer and higher for rarer finds. */
  reveal: (rarity: string) => {
    const n = { common: 3, rare: 4, epic: 5, legendary: 7 }[rarity] ?? 3;
    for (let i = 0; i < n; i++) tone({ freq: note(PENTA[i + 2], 523), type: 'triangle', dur: 0.25, vol: 0.18, delay: i * 0.08 });
    if (rarity === 'legendary') tone({ freq: note(24, 523), type: 'sine', dur: 1.2, vol: 0.12, delay: n * 0.08 });
  },
  shuffle: () => noise({ dur: 0.5, vol: 0.2, filter: 'bandpass', freq: 800, to: 2000, q: 1 }),
  win: () => [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => tone({ freq: note(s, 392), type: 'triangle', dur: i === 6 ? 0.6 : 0.16, vol: 0.2, delay: i * 0.11 })),
  lose: () => [7, 4, 0, -5].forEach((s, i) => tone({ freq: note(s, 330), type: 'sine', dur: 0.3, vol: 0.18, delay: i * 0.18 })),
  forgeReady: () => [0, 7, 12].forEach((s, i) => tone({ freq: note(s, 262), type: 'sawtooth', dur: 0.3, vol: 0.08, delay: i * 0.07 })),
};
