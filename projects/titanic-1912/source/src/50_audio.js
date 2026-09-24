import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/50_audio.js ====
// =====================================================================
// 50_audio.js — AUDIO ENGINE (module 'audio', order 5).
// The film's entire sound: sampled + synthesized instruments that play TT.score,
// the mix (buses, generated convolution reverbs, glue compression, limiter), and all
// procedural sound design timed from TT.story (EV, TR, TELEGRAPH, BOATS).
//
// Everything is scheduled ahead on the AudioContext clock from story time
// (TT.clock.toAudioTime), so it is sample-accurate and survives seeking: on a seek all
// voices fade out and the engine reschedules from the new time (sustained notes and
// long beds restart mid-way). Pause suspends the context.
//
// Instruments: recordings (tonejs-instruments MP3s on jsdelivr, only the notes the score
// needs) played by a layered sampler. One probe request goes first; if the recordings can't be
// fetched (offline, CSP-blocked, stalled > 6 s, synth=1), the synthesized instruments are
// rendered once into buffers ("baked") and played by the same sampler; live synthesis covers
// the first seconds until then. Choir, drone, harmonics and percussion are always synthesized
// (percussion one-shots pre-rendered).
//
// Score automation targets: 'music', 'band', 'reverb' (the hall's return; without it the hall
// follows the music's cuts), 'sfx', 'ambience' and instrument ids. The cut to silence at
// EV.sternGone also gates the effects and the sea (sfxGate / ambGate).
//
// Test hooks (URL): wav=t0,t1 renders that story range offline and prints it as
//   TT_WAV_BEGIN/CHUNK/END lines (wavsr=8000..48000, wavch=1|2, wavsolo=music,band,sfx,amb,uw,morse
//   or instrument ids / cue names); wavstat=1 prints only RMS/peak; wavrt=1 schedules incrementally
//   like the live scheduler (render_ms then approximates the realtime load); synth=1 forces synthesis.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, PRM = TT.params;
  const STORY = TT.story, EV = STORY.EV, TR = STORY.TR;
  const DUR = C.DURATION;
  const clamp = U.clamp, lerp = U.lerp, sstep = U.smoothstep, noise1 = U.noise1, hash1 = U.hash1;
  const dB = (d) => Math.pow(10, d / 20);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOOK = 1.2;            // scheduler lookahead (s of story time)
  const TSTEP = 0.05;          // automation sampling step (s)
  const MAXV = 50;             // global note-voice cap (the one ending soonest, usually a release tail, is stolen)
  let LQ = false;              // low quality: fewer layers / singers (mobile)
  const SYNTH_ONLY = PRM.synth === '1';

  // ------------------------------------------------------------------
  // Noise / modulation buffers (per sample rate). Normalised to RMS 0.25.
  // ------------------------------------------------------------------
  const BUFS = {};
  function normRms(d, target) {
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    const k = target / Math.sqrt(s / d.length + 1e-12);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  function smoothNoise(d, sr, bw, r) {
    const a = Math.exp(-2 * Math.PI * bw / sr);
    let y1 = 0, y2 = 0, m = 1e-9;
    for (let i = 0; i < d.length; i++) { y1 = a * y1 + (1 - a) * (r() * 2 - 1); y2 = a * y2 + (1 - a) * y1; d[i] = y2; }
    // remove the start-up transient by crossfading the loop seam
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    for (let i = 0; i < d.length; i++) d[i] /= m;
  }
  function getBufs(sr) {
    if (BUFS[sr]) return BUFS[sr];
    const r = U.rng(9173);
    const mk = (secs, ch, fill) => {
      const b = new AudioBuffer({ length: Math.floor(secs * sr), numberOfChannels: ch, sampleRate: sr });
      for (let c = 0; c < ch; c++) fill(b.getChannelData(c), c);
      return b;
    };
    const white = mk(4, 2, (d) => { for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; normRms(d, 0.25); });
    const pink = mk(5, 2, (d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
      normRms(d, 0.25);
    });
    const brown = mk(6, 2, (d) => {
      let l = 0;
      for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = l; }
      let mean = 0; for (let i = 0; i < d.length; i++) mean += d[i]; mean /= d.length;
      for (let i = 0; i < d.length; i++) d[i] -= mean;
      normRms(d, 0.25);
    });
    const slow = mk(20, 1, (d) => smoothNoise(d, sr, 1.2, r));   // smooth ±1, ~1 Hz
    const jit = mk(10, 1, (d) => smoothNoise(d, sr, 7, r));      // ±1, ~7 Hz
    const rough = mk(8, 1, (d) => {                               // 0..1, crackly grinding AM
      smoothNoise(d, sr, 30, r);
      for (let i = 0; i < d.length; i++) d[i] = Math.pow(Math.abs(d[i]), 1.6);
      let m = 1e-9; for (let i = 0; i < d.length; i++) m = Math.max(m, d[i]);
      for (let i = 0; i < d.length; i++) d[i] /= m;
    });
    const crackle = mk(6, 2, (d) => {                             // sparse sharp impulses
      d.fill(0);
      const n = 6 * 55;
      for (let k = 0; k < n; k++) {
        const p = Math.floor(r() * (d.length - 200)), a = (r() < 0.5 ? -1 : 1) * (0.15 + 0.85 * Math.pow(r(), 2.5));
        const L = 8 + Math.floor(r() * 60);
        for (let i = 0; i < L; i++) d[p + i] += a * Math.exp(-i / (L * 0.25)) * (i % 2 ? -1 : 1);
      }
    });
    return (BUFS[sr] = { white, pink, brown, slow, jit, rough, crackle });
  }

  // ------------------------------------------------------------------
  // Generated impulse responses: exponentially decaying noise that darkens with time,
  // a soft onset ("bloom"), pre-delay and a few early reflections.
  // ------------------------------------------------------------------
  function makeIR(sr, o) {
    const len = Math.floor(o.len * sr);
    const b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    for (let c = 0; c < 2; c++) {
      const r = U.rng(o.seed + c * 101);
      const d = b.getChannelData(c);
      const pre = Math.floor(o.pre * sr);
      let y = 0, y2 = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp(-6.91 * t / o.rt) * (1 - Math.exp(-t / o.bloom)) * (o.tail == null ? 1 : o.tail);
        const fc = o.f0 * Math.pow(o.f1 / o.f0, Math.min(1, t / o.rt));
        const a = Math.exp(-2 * Math.PI * fc / sr);
        y = a * y + (1 - a) * (r() * 2 - 1);
        y2 = a * y2 + (1 - a) * y;
        d[i] = (o.steep ? y2 : y) * env;
      }
      for (const [tt, g] of o.er || []) {
        const i0 = Math.floor((tt + (c ? 0.0031 : 0) + (r() - 0.5) * 0.002) * sr);
        const L = Math.floor(0.0015 * sr);
        for (let i = 0; i < L && i0 + i < len; i++) d[i0 + i] += g * (r() * 2 - 1) * (1 - i / L);
      }
      const fade = Math.floor(0.05 * sr);
      for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    }
    return b;
  }
  const IR_HALL = { len: 4.6, rt: 4.5, pre: 0.026, bloom: 0.075, f0: 7500, f1: 700, seed: 11, tail: 1,
    er: [[0.013, 0.9], [0.021, 0.7], [0.029, 0.6], [0.037, 0.55], [0.049, 0.45], [0.063, 0.35], [0.079, 0.3], [0.097, 0.2]] };
  const IR_OPEN = { len: 1.8, rt: 1.2, pre: 0.008, bloom: 0.012, f0: 6000, f1: 1200, seed: 23, tail: 0.45,
    er: [[0.041, 1.4], [0.093, 1.0], [0.19, 0.75], [0.33, 0.45], [0.52, 0.25]] };
  const IR_CAVE = { len: 6.2, rt: 6.0, pre: 0.06, bloom: 0.3, f0: 1300, f1: 140, seed: 37, tail: 1, steep: true,
    er: [[0.09, 0.6], [0.21, 0.5], [0.37, 0.35]] };

  // ------------------------------------------------------------------
  // Sample library (tonejs-instruments on jsdelivr; CORS *)
  // ------------------------------------------------------------------
  const CDN = 'https://cdn.jsdelivr.net/npm/tonejs-instrument-';
  const SETS = {
    violin: { pkg: 'violin', ver: '1.1.1', notes: 'G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7', maxLen: 6, sustain: true },
    cello: { pkg: 'cello', ver: '1.1.1', notes: 'C2 D2 Ds2 E2 F2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5', maxLen: 6, sustain: true },
    contrabass: { pkg: 'contrabass', ver: '1.1.2', notes: 'G1 As1 C2 D2 E2 Fs1 Fs2 Gs2 A2 Cs3 E3 Gs3 B3', maxLen: 6, sustain: true },
    horn: { pkg: 'french-horn', ver: '1.1.2', notes: 'A1 C2 Ds2 G2 D3 F3 A3 C4 D5 F5', maxLen: 6, sustain: true },
    trombone: { pkg: 'trombone', ver: '1.1.2', notes: 'As1 Cs2 Ds2 F2 Gs2 As2 C3 D3 Ds3 F3 Gs3 As3 C4 Cs4 D4 Ds4 F4', maxLen: 6, sustain: true },
    tuba: { pkg: 'tuba', ver: '1.1.2', notes: 'F1 As1 Ds2 F2 As2 D3 F3 As3 D4', maxLen: 6, sustain: true },
    trumpet: { pkg: 'trumpet', ver: '1.1.2', notes: 'C3 F3 A3 As3 Ds4 F4 G4 D5 F5 A5 C6', maxLen: 6, sustain: true },
    flute: { pkg: 'flute', ver: '1.1.2', notes: 'C4 E4 A4 C5 E5 A5 C6 E6 A6 C7', maxLen: 6, sustain: true },
    clarinet: { pkg: 'clarinet', ver: '1.1.2', notes: 'D3 F3 As3 D4 F4 As4 D5 F5 As5 D6 Fs6', maxLen: 6, sustain: true },
    bassoon: { pkg: 'bassoon', ver: '1.1.2', notes: 'G2 A2 C3 G3 A3 C4 E4 G4 A4 C5', maxLen: 6, sustain: true },
    harp: { pkg: 'harp', ver: '1.1.1', notes: 'E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 B6 D7 F7', maxLen: 6, sustain: false },
    piano: { pkg: 'piano', ver: '1.1.2', notes: 'A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6 Ds6 Fs6 A6 C7 Ds7 Fs7 A7 C8', maxLen: 8, sustain: false },
    organ: { pkg: 'organ', ver: '1.1.1', notes: 'C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6', maxLen: 6, sustain: true },
  };
  const PC = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
  const n2m = (n) => { const m = /^([A-G]s?)(-?\d)$/.exec(n); return m ? PC[m[1]] + 12 * (parseInt(m[2], 10) + 1) : null; };
  for (const k in SETS) {
    const s = SETS[k];
    s.name = k;
    s.cands = s.notes.split(/\s+/).map((n) => ({ n, m: n2m(n) })).sort((a, b) => a.m - b.m);
  }

  // LIB[set] = { map: Map(midi -> entry), keys: sorted midis, planned, resolved, ready }
  const LIB = {};
  const LOAD = { total: 0, done: 0, ok: 0, failed: 0, finished: false, promise: null, started: false };

  function nearestCand(set, midi) {
    let best = null, bd = 1e9;
    for (const c of set.cands) { const d = Math.abs(c.m - midi) + (c.m < midi ? 0.1 : 0); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function secondCand(set, midi, first) {
    let best = null, bd = 1e9;
    for (const c of set.cands) { if (c === first) continue; const d = Math.abs(c.m - midi); if (d < bd) { bd = d; best = c; } }
    return bd <= 3 ? best : null;
  }

  // Decoded sample preparation: trim leading silence (onset at 4 ms), cap the length,
  // loudness-normalise, and find a stable loop region for sustaining instruments.
  function prepSample(buf, set) {
    const sr = buf.sampleRate, d0 = buf.getChannelData(0);
    let pk = 0; for (let i = 0; i < d0.length; i++) { const a = Math.abs(d0[i]); if (a > pk) pk = a; }
    if (pk < 1e-4) return null;
    let on = 0; const th = pk * 0.04;
    while (on < d0.length && Math.abs(d0[on]) < th) on++;
    const s0 = Math.max(0, on - Math.floor(0.004 * sr));
    const maxN = Math.floor(set.maxLen * sr);
    const n = Math.min(d0.length - s0, maxN);
    const out = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr });
    const d = out.getChannelData(0);
    d.set(d0.subarray(s0, s0 + n));
    const fi = Math.floor(0.002 * sr); for (let i = 0; i < fi; i++) d[i] *= i / fi;
    if (n === maxN) { const fn = Math.floor(0.35 * sr); for (let i = 0; i < fn; i++) d[n - fn + i] *= 1 - i / fn; }
    // loudness normalisation (RMS over the body of the note)
    const w0 = Math.floor(0.03 * sr), w1 = Math.min(n, Math.floor((set.sustain ? 1.0 : 0.35) * sr));
    let s = 0; for (let i = w0; i < w1; i++) s += d[i] * d[i];
    const rms = Math.sqrt(s / Math.max(1, w1 - w0));
    const norm = clamp(0.2 / (rms + 1e-6), dB(-10), dB(10));
    for (let i = 0; i < n; i++) d[i] *= norm;   // bake the level in: no per-voice gain node needed
    const e = { buf: out, len: n / sr, norm: 1, ls: 0, le: 0, loopBuf: null };
    if (set.sustain) {
      const W = Math.floor(0.05 * sr), env = [];
      for (let i = 0; i + W <= n; i += W) { let q = 0; for (let j = i; j < i + W; j++) q += d[j] * d[j]; env.push(Math.sqrt(q / W)); }
      const lo = Math.ceil(0.3 / 0.05), hi = Math.floor((n / sr - 0.45) / 0.05);
      if (hi - lo > 12) {
        const mid = env.slice(lo, hi).sort((a, b) => a - b), med = mid[mid.length >> 1];
        let a = lo; while (a < hi && Math.abs(env[a] - med) > 0.3 * med) a++;
        let b = hi; while (b > a && env[b] < 0.6 * med) b--;
        const ls = Math.max(0.35, a * 0.05 + 0.05), le = b * 0.05;
        if (le - ls >= 0.5) { e.ls = ls; e.le = le; }
      }
    }
    return e;
  }
  // Seamless loop buffer (built lazily): the loop end is moved to the point (within one
  // pitch period) whose waveform best matches the audio just before the loop start, then the
  // seam is crossfaded — so the waveform stays in phase through the join.
  function loopBuf(e, midi) {
    if (e.loopBuf) return e.loopBuf;
    const sr = e.buf.sampleRate, d0 = e.buf.getChannelData(0);
    const ls = Math.floor(e.ls * sr);
    let le = Math.floor(e.le * sr);
    const P = Math.max(8, Math.round(sr / mtof(midi || 60))), W = Math.min(1024, ls - 1);
    let best = le, bc = -2;
    for (let c = le - P; c <= le; c++) {
      let xy = 0, xx = 0, yy = 0;
      for (let i = 1; i <= W; i += 2) { const a = d0[c - i], b = d0[ls - i]; xy += a * b; xx += a * a; yy += b * b; }
      const r = xy / Math.sqrt(xx * yy + 1e-12);
      if (r > bc) { bc = r; best = c; }
    }
    le = best;
    const X = Math.min(Math.floor(0.2 * sr), Math.floor((le - ls) * 0.4), ls);
    const out = new AudioBuffer({ length: le, numberOfChannels: 1, sampleRate: sr });
    const d = out.getChannelData(0);
    d.set(d0.subarray(0, le));
    const eq = bc > 0.6;   // in phase: equal-gain fade; otherwise equal-power
    for (let i = 0; i < X; i++) {
      const w = (i + 1) / X, a = eq ? 1 - w : Math.cos(w * Math.PI / 2), b = eq ? w : Math.sin(w * Math.PI / 2);
      d[le - X + i] = d0[le - X + i] * a + d0[ls - X + i] * b;
    }
    e.le = le / sr;
    e.loopBuf = out;
    return out;
  }
  function libPick(lib, midi, k) {
    const ks = lib.keys; if (!ks.length) return null;
    let best = null, bd = 1e9, second = null, sd = 1e9;
    for (const m of ks) {
      const d = Math.abs(m - midi) + (m < midi ? 0.1 : 0);
      if (d < bd) { second = best; sd = bd; best = m; bd = d; } else if (d < sd) { second = m; sd = d; }
    }
    let m = best;
    if (k % 2 === 1 && second != null && sd <= 3.2 && sd - bd <= 2.2) m = second;
    return { midi: m, e: lib.map.get(m) };
  }
  const setReady = (name) => !!(name && LIB[name] && LIB[name].ready);

  // ------------------------------------------------------------------
  // Instruments. set: sample set (name or fn(midi)); synth: synthesis fallback.
  // kind: section (layered ensemble) | solo | band (diegetic single player) | pluck | keys | perc
  // gain: base level; lp: [soft, loud] brightness cutoff; wet: extra hall send; poly: note cap
  // ------------------------------------------------------------------
  const INST = {
    strings_hi: { fam: 'str', kind: 'section', set: (m) => (m >= 55 ? 'violin' : 'cello'), synth: 'strings', pan: -0.42, width: 0.55, layers: 4, gain: dB(-11), atk: 0.09, rel: 0.42, lp: [1800, 12000], air: 0.22, wet: 0.22, poly: 8 },
    strings_mid: { fam: 'str', kind: 'section', set: (m) => (m >= 67 ? 'violin' : 'cello'), synth: 'strings', pan: 0.18, width: 0.45, layers: 4, gain: dB(-11), atk: 0.09, rel: 0.42, lp: [1400, 9000], air: 0.2, wet: 0.2, poly: 8 },
    strings_lo: { fam: 'str', kind: 'section', set: (m) => (m > 72 ? 'violin' : 'cello'), synth: 'strings', pan: 0.36, width: 0.4, layers: 4, gain: dB(-10), atk: 0.08, rel: 0.42, lp: [1100, 8000], air: 0.18, wet: 0.16, poly: 7 },
    basses: { fam: 'str', kind: 'section', set: (m) => (m > 59 ? 'cello' : 'contrabass'), synth: 'strings', pan: 0.5, width: 0.3, layers: 3, gain: dB(-9), atk: 0.08, rel: 0.4, lp: [650, 5000], air: 0.12, wet: 0.1, poly: 6 },
    solo_violin: { fam: 'str', kind: 'solo', set: 'violin', synth: 'strings', pan: -0.1, layers: 1, gain: dB(-9), atk: 0.03, rel: 0.45, lp: [2500, 14000], wet: 0.34, poly: 4 },
    solo_cello: { fam: 'str', kind: 'solo', set: 'cello', synth: 'strings', pan: 0.12, layers: 1, gain: dB(-8), atk: 0.03, rel: 0.45, lp: [1600, 10000], wet: 0.3, poly: 4 },
    harp: { fam: 'harp', kind: 'pluck', set: 'harp', synth: 'harp', pan: -0.55, layers: 1, gain: dB(-7), atk: 0.002, rel: 0.9, lp: [2600, 15000], wet: 0.38, poly: 24 },
    piano: { fam: 'piano', kind: 'keys', set: 'piano', synth: 'piano', pan: -0.22, layers: 1, gain: dB(-10), atk: 0.002, rel: 0.25, lp: [2200, 15000], wet: 0.3, poly: 24 },
    horns: { fam: 'horn', kind: 'section', set: 'horn', synth: 'brass', pan: -0.3, width: 0.3, layers: 3, gain: dB(-6), atk: 0.06, rel: 0.4, lp: [900, 7500], air: 0, wet: 0.3, poly: 8 },
    trumpet: { fam: 'brass', kind: 'solo', set: 'trumpet', synth: 'brass', pan: 0.1, layers: 1, gain: dB(-14), atk: 0.02, rel: 0.3, lp: [1400, 12000], wet: 0.32, poly: 4 },
    brass_lo: { fam: 'brass', kind: 'section', set: (m) => (m < 46 ? 'tuba' : 'trombone'), synth: 'brass', pan: 0.3, width: 0.25, layers: 2, gain: dB(-12), atk: 0.05, rel: 0.35, lp: [700, 6500], wet: 0.24, poly: 6 },
    flute: { fam: 'wind', kind: 'solo', set: 'flute', synth: 'flute', pan: -0.08, layers: 1, gain: dB(-7), atk: 0.04, rel: 0.3, lp: [3000, 14000], wet: 0.3, poly: 4 },
    clarinet: { fam: 'wind', kind: 'solo', set: 'clarinet', synth: 'clarinet', pan: -0.18, layers: 1, gain: dB(-9), atk: 0.04, rel: 0.3, lp: [2000, 11000], wet: 0.28, poly: 4 },
    oboe: { fam: 'wind', kind: 'solo', synth: 'oboe', pan: 0.06, layers: 1, gain: dB(-20), atk: 0.03, rel: 0.25, lp: [2500, 10000], wet: 0.28, poly: 3 },
    bassoon: { fam: 'wind', kind: 'solo', set: 'bassoon', synth: 'bassoon', pan: 0.16, layers: 1, gain: dB(-7), atk: 0.04, rel: 0.3, lp: [1500, 8000], wet: 0.24, poly: 4 },
    organ: { fam: 'organ', kind: 'solo', set: 'organ', synth: 'organ', pan: 0, layers: 1, gain: dB(-11), atk: 0.06, rel: 0.4, lp: [1800, 10000], wet: 0.34, poly: 12 },
    timpani: { fam: 'perc', kind: 'perc', synth: 'timpani', pan: 0.15, gain: dB(-13), wet: 0.18, poly: 6 },
    bass_drum: { fam: 'perc', kind: 'perc', synth: 'bassdrum', pan: -0.08, gain: dB(-11), wet: 0.2, poly: 4 },
    cymbal: { fam: 'perc', kind: 'perc', synth: 'cymbal', pan: 0.25, gain: dB(-12), wet: 0.22, poly: 4, defArt: 'crash' },
    tamtam: { fam: 'perc', kind: 'perc', synth: 'tamtam', pan: -0.2, gain: dB(-15), wet: 0.3, poly: 3 },
    choir: { fam: 'voice', kind: 'section', synth: 'choir', vowel: 'a', pan: 0, width: 0.7, gain: dB(-14), atk: 0.35, rel: 0.55, wet: 0.36, poly: 8 },
    choir_ooh: { fam: 'voice', kind: 'section', synth: 'choir', vowel: 'u', pan: 0, width: 0.7, gain: dB(-14), atk: 0.4, rel: 0.6, wet: 0.38, poly: 8 },
    celesta: { fam: 'mallet', kind: 'pluck', synth: 'celesta', pan: -0.32, gain: dB(-12), rel: 0.4, wet: 0.36, poly: 12 },
    bells: { fam: 'mallet', kind: 'perc', synth: 'bells', pan: 0.26, gain: dB(-14), rel: 1.5, wet: 0.34, poly: 8 },
    drone: { fam: 'pad', kind: 'solo', synth: 'drone', pan: 0, gain: dB(-18), atk: 2.0, rel: 3.0, wet: 0.2, poly: 6 },
    band_violin: { fam: 'str', kind: 'band', bus: 'band', set: 'violin', synth: 'strings', pan: -0.2, layers: 1, gain: dB(-9), atk: 0.025, rel: 0.3, lp: [2500, 10000], poly: 4 },
    band_violin2: { fam: 'str', kind: 'band', bus: 'band', set: 'violin', synth: 'strings', pan: -0.06, layers: 1, gain: dB(-10), atk: 0.025, rel: 0.3, lp: [2300, 9000], poly: 4 },
    band_cello: { fam: 'str', kind: 'band', bus: 'band', set: 'cello', synth: 'strings', pan: 0.12, layers: 1, gain: dB(-8), atk: 0.03, rel: 0.3, lp: [1600, 8000], poly: 4 },
    band_bass: { fam: 'str', kind: 'band', bus: 'band', set: (m) => (m > 59 ? 'cello' : 'contrabass'), synth: 'strings', pan: 0.22, layers: 1, gain: dB(-7), atk: 0.03, rel: 0.25, lp: [900, 5000], poly: 3 },
    band_piano: { fam: 'piano', kind: 'keys', bus: 'band', set: 'piano', synth: 'piano', pan: 0.03, layers: 1, gain: dB(-12), atk: 0.002, rel: 0.2, lp: [1800, 8000], poly: 16, detuned: true },
  };
  for (const k in INST) INST[k].id = k;
  // synthesis fallbacks, calibrated (whole-film RMS) to sit where the sampled versions sit
  const SYN_TRIM = { strings_hi: -2.8, strings_mid: -4.4, strings_lo: -4.9, basses: -4.9, solo_cello: -4.6, solo_violin: -5.7,
    harp: -15.5, piano: -18.7, horns: -11.2, organ: -8.3, trumpet: -2.9, brass_lo: -3.4, flute: -16.2, clarinet: -11.9, bassoon: -8.8,
    band_violin: -6.5, band_cello: -5.4, band_bass: -6.9, band_piano: -13.2 };
  const synInst = {};
  const synOf = (I) => synInst[I.id] || (synInst[I.id] = SYN_TRIM[I.id] ? Object.assign({}, I, { gain: I.gain * dB(SYN_TRIM[I.id]) }) : I);
  const ALIAS = [
    [/viola/, 'strings_mid'], [/violin|vln|strings?$/, 'strings_hi'], [/cello|vc/, 'strings_lo'], [/contra|bass(?!oon)/, 'basses'],
    [/horn/, 'horns'], [/trump|cornet/, 'trumpet'], [/tromb|tuba|brass/, 'brass_lo'], [/flute|picc/, 'flute'],
    [/oboe|anglais/, 'oboe'], [/clar/, 'clarinet'], [/bassoon|fag/, 'bassoon'], [/timp/, 'timpani'], [/drum/, 'bass_drum'],
    [/cym/, 'cymbal'], [/gong|tam/, 'tamtam'], [/ooh/, 'choir_ooh'], [/choir|voice|vox|chor/, 'choir'], [/bell|chime/, 'bells'],
    [/cel/, 'celesta'], [/organ|harmonium/, 'organ'], [/piano/, 'piano'], [/harp/, 'harp'], [/drone|pad|sub/, 'drone'],
  ];
  const instCache = {};
  function instOf(id) {
    if (INST[id]) return INST[id];
    if (instCache[id]) return instCache[id];
    const s = String(id).toLowerCase();
    let base = INST.strings_mid;
    for (const [re, k] of ALIAS) if (re.test(s)) { base = INST[k]; break; }
    if (/^band/.test(s)) base = /piano/.test(s) ? INST.band_piano : /cello/.test(s) ? INST.band_cello : /bass/.test(s) ? INST.band_bass : INST.band_violin;
    return (instCache[id] = Object.assign({}, base, { id }));
  }
  const setOf = (I, midi) => (typeof I.set === 'function' ? I.set(midi) : I.set || null);
  const isStr = (I) => I.fam === 'str';
  const velAmp = (v) => 0.05 + 0.95 * Math.pow(clamp(v), 1.6);

  // ------------------------------------------------------------------
  // Score normalisation. Automation ramps end at their t, starting from the previous
  // point of the same target (Web Audio semantics); 'set' jumps at t.
  // ------------------------------------------------------------------
  let SCORE = { events: [], maxDur: 0, auto: {} };
  function loadScore() {
    const sc = TT.score;
    const out = { events: [], maxDur: 0, auto: {} };
    if (!sc || !Array.isArray(sc.events)) return out;
    for (const e of sc.events) {
      if (!e || !isFinite(e.t) || !isFinite(e.midi) || !(e.dur > 0) || e.t > DUR + 5) continue;
      out.events.push(e);
      out.maxDur = Math.max(out.maxDur, Math.min(60, e.dur));
    }
    out.events.sort((a, b) => a.t - b.t);
    const by = {};
    for (const a of sc.automation || []) {
      if (!a || !isFinite(a.t) || !isFinite(a.value) || !a.target) continue;
      (by[a.target] = by[a.target] || []).push(a);
    }
    for (const k in by) {
      const pts = by[k].sort((a, b) => a.t - b.t);
      out.auto[k] = (t) => {
        if (t < pts[0].t) {
          if (pts[0].ramp !== 'set' && pts[0].t > 0) return lerp(1, pts[0].value, clamp(t / pts[0].t));
          return 1;
        }
        const i = U.bsearch(pts, t);
        if (i >= pts.length - 1) return pts[pts.length - 1].value;
        const a = pts[i], b = pts[i + 1];
        if (b.ramp === 'set') return a.value;
        const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
        if (b.ramp === 'exp' && a.value > 1e-4 && b.value > 1e-4) return a.value * Math.pow(b.value / a.value, u);
        return a.value + (b.value - a.value) * u;
      };
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Sample loading plan: only the notes the score needs (nearest sample per used
  // pitch), ordered by first use; a second neighbour per pitch for ensemble sections
  // while the budget allows.
  // ------------------------------------------------------------------
  const MAX_FILES = 100;
  function planLoads() {
    // used pitches per sample set (with the time each is first needed)
    const use = {};
    const secUse = {};
    for (const ev of SCORE.events) {
      const I = instOf(ev.inst);
      let sn = null;
      if (ev.art === 'pizz' && isStr(I)) sn = 'harp';
      else if (ev.art === 'harm' && isStr(I)) sn = null;
      else sn = setOf(I, ev.midi);
      if (!sn || !SETS[sn]) continue;
      const m = use[sn] || (use[sn] = new Map());
      if (!m.has(ev.midi) || m.get(ev.midi) > ev.t) m.set(ev.midi, ev.t);
      if (I.kind === 'section') (secUse[sn] || (secUse[sn] = new Set())).add(ev.midi);
    }
    // greedy interval cover: fewest recordings such that every used pitch is within D semitones
    const first = [], extra = [];
    for (const sn in use) {
      const set = SETS[sn], D = set.sustain ? 2 : 3;
      const ps = [...use[sn].keys()].sort((a, b) => a - b), chosen = [];
      let i = 0;
      while (i < ps.length) {
        const p = ps[i];
        let c = null;
        for (const cd of set.cands) if (cd.m >= p - D && cd.m <= p + D) c = cd;   // highest in reach
        if (!c) c = nearestCand(set, p);
        let t = Infinity, j = i;
        while (j < ps.length && Math.abs(ps[j] - c.m) <= D) { t = Math.min(t, use[sn].get(ps[j])); j++; }
        if (j === i) { t = use[sn].get(p); j = i + 1; }
        chosen.push(c.m);
        first.push({ set: sn, n: c.n, m: c.m, t });
        i = j;
      }
      // a second recording near each section pitch gives the layers different performances
      for (const p of secUse[sn] || []) {
        const c1 = nearestCand(set, p), c2 = secondCand(set, p, c1);
        if (c2 && !chosen.includes(c2.m)) { chosen.push(c2.m); extra.push({ set: sn, n: c2.n, m: c2.m, t: use[sn].get(p) + 40 }); }
      }
    }
    const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.set + x.n; if (seen.has(k)) return false; seen.add(k); return true; }); };
    let list = uniq(first).sort((a, b) => a.t - b.t);
    LOAD.wanted = list.length;
    if (list.length > MAX_FILES) list = list.slice(0, MAX_FILES);
    const have = new Set(list.map((x) => x.set + x.n));
    for (const x of uniq(extra).sort((a, b) => a.t - b.t)) {
      if (list.length >= MAX_FILES) break;
      if (!have.has(x.set + x.n)) { have.add(x.set + x.n); list.push(x); }
    }
    return list;
  }
  function progress(ctx, label) {
    const f = LOAD.total ? LOAD.done / LOAD.total : 1;
    TT.emit('audioProgress', { f, label, loaded: LOAD.ok, total: LOAD.total });
    if (LOAD.inInit && ctx && ctx.onProgress) { try { ctx.onProgress(f, label); } catch (e) { /* ignore */ } }
  }
  function startLoading(ctx) {
    if (LOAD.started) return LOAD.promise;
    LOAD.started = true;
    const list = planLoads();
    LOAD.total = list.length;
    for (const x of list) {
      const L = LIB[x.set] || (LIB[x.set] = { map: new Map(), keys: [], planned: 0, resolved: 0, ready: false, firstT: 1e9 });
      L.firstT = Math.min(L.firstT, x.t);
      L.planned++;
    }
    if (SYNTH_ONLY) {
      LOAD.promise = bakeSynth(list, ctx).then(() => { LOAD.finished = true; });
      return LOAD.promise;
    }
    let dec = null;
    try { dec = new OfflineAudioContext(1, 1, 32000); } catch (e) { dec = MOD.ac; }
    const q = list.slice();
    let fails = 0, blocked = false;
    const ctls = new Set();
    // no network, a blocking policy (CSP) or a stalled connection: stop asking, synthesize instead
    const block = () => { blocked = true; for (const c of ctls) { try { c.abort(); } catch (e) { /* ignore */ } } };
    const loadOne = async (x) => {
      if (blocked) throw new Error('blocked');
      const set = SETS[x.set];
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctl) ctls.add(ctl);
      const to = setTimeout(() => ctl && ctl.abort(), 25000);
      try {
        const r = await fetch(CDN + set.pkg + '-mp3@' + set.ver + '/' + x.n + '.mp3', ctl ? { signal: ctl.signal, mode: 'cors' } : { mode: 'cors' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ab = await r.arrayBuffer();
        const buf = await new Promise((res, rej) => { const p = dec.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
        const e = prepSample(buf, set);
        if (!e) throw new Error('silent sample');
        addSample(x.set, x.m, e);
        LOAD.ok++;
      } finally { clearTimeout(to); if (ctl) ctls.delete(ctl); }
    };
    const loadItem = async (x) => {
      const L = LIB[x.set];
      let ok = false;
      for (let a = 0; a < 2 && !ok && !blocked; a++) {
        try { await loadOne(x); ok = true; } catch (e) { if (a === 0 && !blocked) await sleep(LOAD.ok ? 1200 : 350); }
      }
      if (!ok) { LOAD.failed++; fails++; if (fails >= 4 && LOAD.ok === 0) block(); }
      LOAD.done++;
      L.resolved++;
      if (L.resolved >= L.planned && L.map.size > 0) L.ready = true;
      updateMode();
      progress(ctx, 'Tuning the orchestra');
    };
    const worker = async () => { while (q.length) await loadItem(q.shift()); };
    const watchdog = setTimeout(() => { if (LOAD.ok === 0) block(); }, 6000);
    // one probe request first: if fetching is blocked it fails at once and the whole orchestra is
    // synthesized, instead of a failed request per sample; then eight loaders in parallel
    const probe = q.shift();
    LOAD.promise = (probe ? loadItem(probe) : Promise.resolve()).then(() => {
      if (LOAD.ok === 0) block();
      return Promise.all(Array.from({ length: 8 }, worker));
    }).then(async () => {
      clearTimeout(watchdog);
      // any set that could not be fetched (offline, blocked) is synthesized and baked instead
      const missing = list.filter((x) => LIB[x.set].map.size === 0);
      if (missing.length) await bakeSynth(missing, ctx);
      LOAD.finished = true;
      for (const k in LIB) if (LIB[k].map.size > 0) LIB[k].ready = true;
      updateMode();
      TT.log('audio samples: ' + LOAD.ok + '/' + LOAD.total + ' loaded, ' + LOAD.failed + ' failed, ' + (LOAD.baked || 0) + ' baked');
    });
    return LOAD.promise;
  }
  function addSample(set, m, e) {
    const L = LIB[set];
    L.map.set(m, e);
    L.keys = [...L.map.keys()].sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------
  // Baked synthesis: when recordings are unavailable, the synthesized instruments are rendered
  // once (OfflineAudioContext, same voice code) into sample buffers and then played through the
  // sampler: the same layered ensembles at a fraction of the realtime cost of live synthesis.
  // ------------------------------------------------------------------
  const BAKE_INST = {
    violin: ['solo_violin'], cello: ['solo_cello'], contrabass: ['basses', { kind: 'solo' }], horn: ['horns', { kind: 'solo' }],
    trombone: ['brass_lo', { kind: 'solo' }], tuba: ['brass_lo', { kind: 'solo' }], trumpet: ['trumpet'], flute: ['flute'],
    clarinet: ['clarinet'], bassoon: ['bassoon'], harp: ['harp'], piano: ['piano'], organ: ['organ'],
  };
  async function bakeSynth(list, ctx) {
    const tb = performance.now();
    const by = {};
    for (const x of list) (by[x.set] || (by[x.set] = [])).push(x);
    const sets = Object.keys(by).sort((a, b) => LIB[a].firstT - LIB[b].firstT);
    const bakeSet = async (sn) => {
      try {
        const set = SETS[sn], items = by[sn], spec = BAKE_INST[sn];
        const I = Object.assign({}, INST[spec[0]], spec[1] || {}, { pan: 0, gain: 0.3, rel: 0.08, id: 'bake_' + sn });
        const len = set.sustain ? 4.2 : sn === 'piano' ? 5.5 : 4, slot = len + 0.35, sr = 32000;
        const oac = new OfflineAudioContext(1, Math.ceil(slot * items.length * sr) + 128, sr);
        const A = { ac: oac, sr, B: getBufs(sr), waves: {}, epoch: new Map(), voices: [], offline: true };
        const inp = oac.createGain();
        synthEQ(oac, I, sr, inp).connect(oac.destination);
        const ch = { I, input: inp, post: inp, synthIn: inp };
        const dur = set.sustain ? len - 0.25 : 1.2;
        items.forEach((x, i) => {
          const ev = { t: 0, inst: I.id, midi: x.m, dur, vel: 0.78, art: null, pan: null };
          (SYN[I.synth] || SYN.strings)(A, I, ev, i * 7 + 3, 0.02 + i * slot, 0, 'legato', ch);
        });
        const buf = await oac.startRendering();
        const d = buf.getChannelData(0);
        items.forEach((x, i) => {
          const a = Math.floor((0.02 + i * slot) * sr), n = Math.floor((slot - 0.05) * sr);
          const b = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr });
          b.getChannelData(0).set(d.subarray(a, a + n));
          const e = prepSample(b, set);
          if (e) { addSample(sn, x.m, e); LOAD.baked = (LOAD.baked || 0) + 1; }
        });
        LIB[sn].ready = LIB[sn].map.size > 0;
        LIB[sn].baked = true;
        progress(ctx, 'Tuning the orchestra');
      } catch (e) { errOnce('bake ' + sn, e); }
    };
    // offline renders run on their own threads: bake a few sets at once, earliest-needed first
    const q = sets.slice();
    await Promise.all([0, 1, 2, 3].map(async () => { while (q.length) await bakeSet(q.shift()); }));
    TT.log('audio: baked ' + (LOAD.baked || 0) + ' synthesized notes in ' + (performance.now() - tb).toFixed(0) + ' ms');
  }
  function updateMode() {
    const core = ['violin', 'cello', 'contrabass'].filter((k) => LIB[k] && LIB[k].planned);
    const ok = core.length ? core.every((k) => LIB[k].ready && !LIB[k].baked) : LOAD.ok > 0 && LOAD.ok >= LOAD.total * 0.5;
    MOD.sampleMode = ok ? 'samples' : 'synth';
  }

  // ------------------------------------------------------------------
  // Envelope helpers. Points are [x, value, kind?] with x relative to the sound's start;
  // kind 'x' = exponential ramp, 's' = step. `off` is how much of the sound has already
  // elapsed (mid-way starts after a seek): earlier points are folded into the start value.
  // ------------------------------------------------------------------
  function valAt(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (x <= p[0]) {
        const q = pts[i - 1];
        if (p[2] === 's') return q[1];
        const u = (x - q[0]) / Math.max(1e-9, p[0] - q[0]);
        if (p[2] === 'x') { const a = Math.max(q[1], 1e-5), b = Math.max(p[1], 1e-5); return a * Math.pow(b / a, u); }
        return q[1] + (p[1] - q[1]) * u;
      }
    }
    return pts[pts.length - 1][1];
  }
  function envp(param, when, off, pts) {
    param.setValueAtTime(valAt(pts, off), when);
    for (const p of pts) {
      if (p[0] <= off) continue;
      const at = when + (p[0] - off);
      if (p[2] === 's') param.setValueAtTime(p[1], at);
      else if (p[2] === 'x') param.exponentialRampToValueAtTime(Math.max(p[1], 1e-5), at);
      else param.linearRampToValueAtTime(p[1], at);
    }
  }
  let _nzSeed = 1;
  const kRate = (p) => { try { p.automationRate = 'k-rate'; } catch (e) { /* older browsers */ } };

  // A sound under construction: owns its sources, maps relative time x -> audio time.
  class Vx {
    constructor(A, when, off, dest, t0 = 0, fadeIn = true) {
      this.A = A; this.ac = A.ac; this.when = when; this.off = off; this.t0 = t0;
      this.srcs = []; this.endX = 0;
      if (off > 0.02 && fadeIn) {
        const fg = A.ac.createGain();
        fg.gain.setValueAtTime(0, when); fg.gain.linearRampToValueAtTime(1, when + 0.12);
        fg.connect(dest); dest = fg;
      }
      this.out = dest;
    }
    T(x) { return this.when + x - this.off; }
    g(v = 1) { const n = this.ac.createGain(); n.gain.value = v; return n; }
    f(type, freq, q, gain) {
      const n = this.ac.createBiquadFilter(); n.type = type; n.frequency.value = Math.min(freq, this.A.sr * 0.48);
      kRate(n.frequency); kRate(n.Q); kRate(n.gain);
      if (q != null) n.Q.value = q; if (gain != null) n.gain.value = gain; return n;
    }
    pan(p) { const n = this.ac.createStereoPanner(); n.pan.value = clamp(p, -1, 1); return n; }
    osc(type, freq, x0, x1) {
      const o = this.ac.createOscillator();
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.value = freq;
      kRate(o.frequency); kRate(o.detune);   // per-quantum modulation: far cheaper than a-rate detune
      o.start(this.T(Math.max(x0, this.off)));
      o.stop(this.T(Math.max(x1, this.off + 0.01)));
      this.srcs.push(o); if (x1 > this.endX) this.endX = x1;
      return o;
    }
    nz(kind, x0, x1, rate = 1) {
      const s = this.ac.createBufferSource();
      s.buffer = this.A.B[kind]; s.loop = true; s.playbackRate.value = rate;
      _nzSeed = (_nzSeed * 16807) % 2147483647;
      s.start(this.T(Math.max(x0, this.off)), (_nzSeed / 2147483647) * s.buffer.duration * 0.9);
      s.stop(this.T(Math.max(x1, this.off + 0.01)));
      this.srcs.push(s); if (x1 > this.endX) this.endX = x1;
      return s;
    }
    cst(v, x0, x1) {
      const s = this.ac.createConstantSource(); s.offset.value = v;
      s.start(this.T(Math.max(x0, this.off))); s.stop(this.T(Math.max(x1, this.off + 0.01)));
      this.srcs.push(s); if (x1 > this.endX) this.endX = x1;
      return s;
    }
    env(param, pts) { envp(param, this.when, this.off, pts); }
    // param follows fn(story time) from x0 to x1 (sampled at `rate` Hz)
    curve(param, x0, x1, fn, rate = 20) {
      const xs = Math.max(x0, this.off);
      if (x1 - xs < 0.02) { param.value = fn(this.t0 + x1); return; }
      const n = Math.max(2, Math.ceil((x1 - xs) * rate) + 1);
      const arr = new Float32Array(n);
      for (let i = 0; i < n; i++) arr[i] = fn(this.t0 + xs + (x1 - xs) * i / (n - 1));
      param.setValueAtTime(arr[0], this.T(xs));
      param.setValueCurveAtTime(arr, this.T(xs) + 1e-4, x1 - xs - 1e-4);
    }
    chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }
    voice(inst, g, endX) { return { inst, start: this.when, end: this.T(Math.max(endX, this.endX)), g, srcs: this.srcs }; }
  }

  // ------------------------------------------------------------------
  // The graph: buses -> reverbs -> master (glue compressor, limiter, soft ceiling).
  // Built identically for the realtime context and for offline test renders.
  // ------------------------------------------------------------------
  function clipCurve() {
    // input pre-scaled by 0.5 -> covers ±2.0; unity below 0.7, soft ceiling at 0.89 (-1 dBFS)
    const n = 4097, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) * 2 - 1) * 2, s = Math.sign(a), m = Math.abs(a);
      c[i] = m <= 0.7 ? a : s * (0.7 + 0.19 * Math.tanh((m - 0.7) / 0.19));
    }
    return c;
  }
  function buildGraph(ac, opt = {}) {
    const A = {
      ac, offline: !!opt.offline, t0: opt.t0 || 0, sr: ac.sampleRate, voices: [], tracks: [], chans: {},
      epoch: new Map(), waves: {}, evIdx: 0, cueIdx: 0, tSched: 0, mapOff: 0, solo: opt.solo || null,
    };
    // realtime: schedule 14 ms early to cancel the master chain's look-ahead (2 compressors + oversampling)
    A.when = A.offline ? (t) => t - A.t0 : (t) => TT.clock.toAudioTime(t) - 0.014;
    A.B = getBufs(A.sr);
    const G = (v = 1) => { const g = ac.createGain(); g.gain.value = v; return g; };
    const F = (type, f, q, gain) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (gain != null) n.gain.value = gain; return n; };
    const conv = (o) => { const c = ac.createConvolver(); c.normalize = true; c.buffer = makeIR(A.sr, o); return c; };

    // master
    const sum = G(dB(5)), endFade = G(1);
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.025; glue.release.value = 0.3;
    // cancel the compressors' automatic make-up gain (Blink: 0.6 x the curve's loss at 0 dBFS):
    // glue (-18, 10, 2) = +3.88 dB, limiter (-3, 0, 20) = +1.71 dB
    const makeup = G(dB(-3.88)), trim = G(dB(-1.71));
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    const pre = G(0.5), clip = ac.createWaveShaper(); clip.curve = clipCurve(); clip.oversample = '2x';
    const vol = G(1), mute = G(1);
    sum.connect(endFade); endFade.connect(glue); glue.connect(makeup); makeup.connect(lim); lim.connect(trim); trim.connect(pre);
    pre.connect(clip); clip.connect(vol); vol.connect(mute); mute.connect(ac.destination);
    const an = ac.createAnalyser(); an.fftSize = 2048; mute.connect(an);
    Object.assign(A, { sum, vol, mute, an, anBuf: new Float32Array(2048) });

    // reverbs
    const hall = conv(IR_HALL), open = conv(IR_OPEN), cave = conv(IR_CAVE);
    const hallRet = G(0.85), hallHp = F('highpass', 75, 0);
    hall.connect(hallHp); hallHp.connect(hallRet); hallRet.connect(sum);
    const openRet = G(0.7); open.connect(openRet); openRet.connect(sum);
    const caveRet = G(0.55); cave.connect(caveRet); caveRet.connect(sum);
    const send = (from, to, v) => { const g = G(v); from.connect(g); g.connect(to); return g; };

    // buses
    const bus = {};
    bus.music = G(1); const musicDuck = G(1); bus.music.connect(musicDuck); musicDuck.connect(sum); send(musicDuck, hall, 0.2);
    bus.musicWet = G(1); const wetDuck = G(1); bus.musicWet.connect(wetDuck); wetDuck.connect(hall);
    bus.band = G(1);
    const bandOut = G(1), bandPersp = G(1);
    bus.band.connect(bandPersp); bandPersp.connect(F('highpass', 170, 0)).connect(F('peaking', 1700, 0.8, 3)).connect(F('highshelf', 5200, 0.7, -5.5)).connect(bandOut);
    bandOut.connect(sum); send(bandOut, open, 0.34); send(bandOut, hall, 0.12);
    bus.sfx = G(1); const sfxLp = F('lowpass', A.sr * 0.45, 0); const sfxOut = G(1);
    bus.sfx.connect(sfxLp); sfxLp.connect(sfxOut); sfxOut.connect(sum); send(sfxOut, open, 0.32);
    const sfxCave = send(sfxOut, cave, 0);
    bus.amb = G(1); const ambLp = F('lowpass', A.sr * 0.45, 0); const ambOut = G(1);
    bus.amb.connect(ambLp); ambLp.connect(ambOut); ambOut.connect(sum); send(ambOut, open, 0.18);
    const ambCave = send(ambOut, cave, 0);
    bus.uw = G(1); const uwLp = F('lowpass', 2600, 0); const uwOut = G(1);
    bus.uw.connect(uwLp); uwLp.connect(uwOut); uwOut.connect(sum); send(uwOut, cave, 0.4);
    bus.morse = G(1); bus.morse.connect(sum); send(bus.morse, open, 0.1);
    bus.hall = hall; bus.open = open; bus.cave = cave;
    A.bus = bus;

    // tracks (pure functions of story time, scheduled ahead)
    const auto = SCORE.auto;
    const track = (params, f) => A.tracks.push({ params, f, lastV: NaN, lastT: -1e9 });
    track([bus.music.gain, bus.musicWet.gain], auto.music || (() => 1));
    // the hall's return follows the score's 'reverb' target, or else the music's cuts (a music
    // gain below 0.25 gates it), so a cut to silence also cuts the tail already in the hall
    const revGate = auto.reverb || (auto.music ? (t) => clamp(auto.music(t) * 4) : () => 1);
    track([hallRet.gain], (t) => 0.85 * revGate(t));
    if (auto.band) track([bus.band.gain], auto.band);
    if (auto.sfx) track([bus.sfx.gain], auto.sfx);
    if (auto.ambience) track([bus.amb.gain], auto.ambience);
    track([musicDuck.gain, wetDuck.gain], duckAt);
    track([bandPersp.gain], (t) => 0.72 + 0.28 * inSpan(t, spans().band));
    track([sfxLp.frequency, ambLp.frequency], (t) => (t >= EV.underwater && t < EV.dawn ? 320 : A.sr * 0.45));
    track([sfxCave.gain, ambCave.gain], (t) => (t >= EV.underwater && t < EV.dawn ? 0.5 : 0));
    track([sfxOut.gain], sfxGate);
    track([ambOut.gain], ambGate);
    track([endFade.gain], (t) => 1 - sstep(DUR - 1.8, DUR + 0.3, t));
    for (const k in auto) if (!['music', 'band', 'sfx', 'ambience', 'reverb'].includes(k)) track([chan(A, k).gain.gain], auto[k]);
    return A;
  }

  // Shot-aware perspective (the director's shot list, when present; fallbacks otherwise).
  let SPANS = null;
  function spans() {
    if (SPANS) return SPANS;
    const out = { steam: [100.5, 107.5], band: [163, 171] };
    const sh = TT.director && Array.isArray(TT.director.shots) ? TT.director.shots : [];
    if (!sh.length) return out;   // the director initialises after us: look again later
    const find = (re) => sh.find((x) => re.test(x.name));
    const st = find(/steam/), bd = find(/band/);
    if (st) out.steam = [st.t0, st.t1];
    if (bd) out.band = [bd.t0, bd.t1];
    return (SPANS = out);
  }
  const inSpan = (t, sp, e = 0.2) => sstep(sp[0] - e, sp[0] + e, t) * (1 - sstep(sp[1] - e, sp[1] + e, t));

  // The cut to silence: when the stern is gone the effects stop with the picture cut (EV.silence)
  // and the sea drops to a whisper; it returns, softly, once the lone violin sings.
  function sfxGate(t) {
    return 1 - 0.997 * sstep(EV.sternGone + 0.3, EV.silence + 0.2, t) * (1 - sstep(EV.underwater - 1.5, EV.underwater - 0.5, t));
  }
  function ambGate(t) {
    const quiet = sstep(EV.sternGone + 0.2, EV.silence + 0.2, t) * (1 - sstep(EV.underwater, EV.underwater + 1, t));
    return 1 - quiet * (0.92 - 0.42 * sstep(EV.silence + 3.8, EV.silence + 8.5, t));
  }

  // Music ducking under the biggest sound effects (gentle).
  function duckAt(t) {
    const E = U.envelope;
    const stH = spans().steam[1];   // the valves are loudest until the camera pulls back from them
    let d = 0.34 * E(t, EV.impact - 0.05, EV.scrapeEnd + 1, 0.25, 4.5)
      + 0.22 * E(t, EV.steamStart, stH + 1, 0.8, 2.5) + 0.07 * E(t, stH, EV.steamEnd, 2.5, 3)
      + 0.2 * E(t, EV.funnel1Splash - 0.05, EV.funnel1Splash + 2.2, 0.05, 1.8)
      + 0.3 * E(t, EV.breakStart, EV.breakDone + 1.5, 0.4, 3)
      + 0.3 * E(t, EV.sternSplash - 0.05, EV.sternSplash + 2.5, 0.05, 2)
      + 0.2 * E(t, EV.sternPlunge, EV.sternGone + 0.5, 1, 1.5)
      + 0.28 * E(t, EV.seabedImpact - 0.05, EV.seabedImpact + 2.5, 0.05, 2);
    for (const r of EV.rockets) d += 0.12 * E(t, r + 2.25, r + 3.6, 0.05, 1);
    return clamp(1 - d, 0.45, 1);
  }

  // Instrument channel: voices -> [synth body EQ] -> channel gain (automation) -> bus (+hall send)
  function chan(A, id) {
    if (A.chans[id]) return A.chans[id];
    const ac = A.ac, I = instOf(id);
    const gain = ac.createGain();
    const dest = I.bus === 'band' ? A.bus.band : A.bus.music;
    gain.connect(dest);
    if (I.wet && I.bus !== 'band') { const w = ac.createGain(); w.gain.value = I.wet; gain.connect(w); w.connect(A.bus.musicWet); }
    // sampled voices arrive mono at `input`: the channel pans them and spreads ensembles wide;
    // voices that pan themselves (synths, per-note pan) go to `post` / `synthIn`
    const sec = I.kind === 'section' || I.fam === 'voice';
    const post = sec ? widen(A, gain, I.fam === 'voice' ? 1 : 0.75) : gain;
    const input = ac.createGain();
    if (I.pan) { const pn = ac.createStereoPanner(); pn.pan.value = I.pan; input.connect(pn); pn.connect(post); } else input.connect(post);
    const synthIn = ac.createGain();
    synthEQ(ac, I, A.sr, synthIn).connect(post);
    const ch = { id, I, gain, input, post, synthIn };
    if (I.synth === 'choir') ch.parts = choirBanks(A, I, post);
    return (A.chans[id] = ch);
  }
  // gentle body EQ for synthesized voices so they sit like acoustic instruments; returns the chain's end
  function synthEQ(ac, I, sr, n) {
    const eq = [];
    if (I.synth === 'strings') eq.push(['highpass', 65, 0], ['peaking', 320, 1.0, 2.5], ['peaking', 1250, 1.2, 2], ['peaking', 2900, 1.5, -2.5], ['highshelf', 6000, 0.7, -6]);
    else if (I.synth === 'brass') eq.push(['highpass', 55, 0], ['peaking', 1100, 0.9, 2], ['highshelf', 7000, 0.7, -5]);
    else if (I.fam === 'wind' || I.synth === 'organ') eq.push(['highpass', 90, 0], ['highshelf', 8000, 0.7, -4]);
    for (const [type, f, q, g] of eq) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, sr * 0.45); b.Q.value = q; if (g != null) b.gain.value = g; n.connect(b); n = b; }
    return n;
  }
  // stereo chorus-widener (two slowly modulated short delays panned apart); returns its input
  function widen(A, dest, amt) {
    const ac = A.ac, inp = ac.createGain();
    inp.connect(dest);
    [[-0.85, 0.011, 0.21, 0.0016], [0.85, 0.017, 0.27, 0.0021]].forEach(([p, d, rate, depth]) => {
      const dl = ac.createDelay(0.05); dl.delayTime.value = d;
      const lfo = ac.createOscillator(); lfo.frequency.value = rate;
      const lg = ac.createGain(); lg.gain.value = depth; lfo.connect(lg); lg.connect(dl.delayTime); lfo.start();
      const pn = ac.createStereoPanner(); pn.pan.value = p;
      const g = ac.createGain(); g.gain.value = 0.42 * amt;
      inp.connect(dl); dl.connect(g); g.connect(pn); pn.connect(dest);
    });
    return inp;
  }

  // Epoch inputs: every voice connects through a per-epoch gain so a seek can fade
  // everything that was scheduled at once.
  function ep(A, node) {
    let g = A.epoch.get(node);
    if (!g) { g = A.ac.createGain(); g.connect(node); A.epoch.set(node, g); }
    return g;
  }
  function resetEpoch(A, fade = 0.06) {
    const ac = A.ac, now = ac.currentTime;
    const old = A.epoch;
    for (const g of old.values()) {
      try { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + fade); } catch (e) { /* ignore */ }
    }
    for (const v of A.voices) for (const s of v.srcs) { try { s.stop(now + fade + 0.02); } catch (e) { /* ignore */ } }
    A.voices = [];
    A.epoch = new Map();
    if (!A.offline) setTimeout(() => { for (const g of old.values()) { try { g.disconnect(); } catch (e) { /* ignore */ } } }, (fade + 0.4) * 1000);
  }
  function killVoice(A, v, at) {
    if (v.killed) return;
    v.killed = true;
    at = Math.max(at, A.ac.currentTime);
    if (v.g) {
      try {
        if (v.g.cancelAndHoldAtTime) v.g.cancelAndHoldAtTime(at); else v.g.cancelScheduledValues(at);
        v.g.setTargetAtTime(0, at, 0.025);
      } catch (e) { /* ignore */ }
    }
    for (const s of v.srcs) { try { s.stop(at + 0.16); } catch (e) { /* ignore */ } }
    v.end = at + 0.16;
  }
  function activeNotes(A, when) {
    let n = 0;
    for (const v of A.voices) if (v.g && !v.killed && v.end > when && v.start <= when + 0.05) n++;
    return n;
  }
  // Voice stealing: the voice that would end soonest goes (usually a release tail), never a long
  // pedal that merely started first.
  function limitVoices(A, inst, poly, when) {
    let n = 0, mine = null, total = 0, any = null;
    for (const v of A.voices) {
      if (v.killed || v.end <= when || !v.g) continue;
      total++;
      if (!any || v.end < any.end) any = v;
      if (v.inst === inst) { n++; if (!mine || v.end < mine.end) mine = v; }
    }
    if (n >= poly && mine) killVoice(A, mine, when);
    else if (total >= MAXV && any) killVoice(A, any, when);
  }
  function wave(A, name, amps) {
    if (A.waves[name]) return A.waves[name];
    const n = amps.length + 1, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 0; i < amps.length; i++) im[i + 1] = amps[i];
    return (A.waves[name] = A.ac.createPeriodicWave(re, im));
  }

  // ------------------------------------------------------------------
  // Note players. Signature: (A, I, ev, ix, when, off, art, ch) -> voice | null
  // ------------------------------------------------------------------
  function noteEnv(V, g, amp, dur, art, atk, rel) {
    let pts;
    if (art === 'swell') pts = [[0, amp * 0.1], [Math.max(atk, dur * 0.88), amp, 'x'], [dur, amp]];
    else if (art === 'marc') pts = [[0, 0], [0.01, amp * 1.4], [Math.min(0.35, dur), amp * 0.75], [Math.max(dur, 0.36), amp * 0.75]];
    else if (art === 'stacc') pts = [[0, 0], [0.006, amp], [Math.max(dur, 0.01), amp * 0.55]];
    else pts = [[0, 0], [Math.min(atk, dur * 0.5), amp], [Math.max(dur, atk), amp * 0.97]];
    V.env(g, pts);
    g.setTargetAtTime(0, V.T(Math.max(dur, V.off)), Math.max(0.01, rel / 3));
  }
  const vv = (ev) => clamp(ev.vel == null ? 0.7 : ev.vel);
  const cutoffOf = (I, vel) => I.lp[0] * Math.pow(I.lp[1] / I.lp[0], Math.pow(vel, 0.85));
  const basePan = (I, ev) => (ev.pan == null ? I.pan || 0 : clamp(ev.pan, -1, 1));
  function trem(V, target, depth, rate, x1) {
    const l = V.osc('sine', rate, 0, x1), lg = V.g(depth);
    l.connect(lg); lg.connect(target);
  }

  // Sampled instruments: nearest-sample pitch shifting, velocity = gain + brightness,
  // ensemble sections = detuned, micro-delayed, panned layers + a soft saw "air" pad,
  // notes longer than the recording loop a crossfaded sustain region.
  function playSampled(A, I, ev, ix, when, off, art, ch) {
    const lib = LIB[setOf(I, ev.midi)];
    const midi = ev.midi, vel = vv(ev);
    const stacc = art === 'stacc';
    let dur = ev.dur;
    if (stacc) dur = Math.min(dur, 0.28);
    const plucky = I.kind === 'pluck' || I.kind === 'keys';
    if (I.fam === 'harp') dur = Math.max(dur, 2.2);
    if (dur <= off) return null;
    const rel = stacc ? 0.12 : I.rel;
    // level of detail: fewer layers when the orchestra is dense (keeps the audio thread light)
    const busy = activeNotes(A, when);
    let L = I.layers || 1;
    if (L > 1) L = busy > 44 ? 1 : LQ || stacc || dur < 0.35 || busy > 26 ? 2 : Math.min(L, 3);
    const amp = I.gain * velAmp(vel) * (I.layers > 1 ? 0.45 : 1);   // sections: calibrated for the layered sum
    const own = ev.pan != null;   // explicit per-note pan: bypass the channel panner
    const V = new Vx(A, when, off, ep(A, own ? ch.post : ch.input));
    const out = V.g(0);
    const lp = V.f('lowpass', cutoffOf(I, vel), 0);
    const stopX = dur + rel * 2.1 + 0.05;
    let head = lp;
    if (art === 'trem' && !plucky) {
      const tg = V.g(0.55); lp.connect(tg); head = tg;
      trem(V, tg.gain, 0.45, 12.5 + 2 * hash1(ix), stopX);
    }
    head.connect(out);
    if (own) out.connect(V.pan(ev.pan)).connect(V.out); else out.connect(V.out);
    if (plucky) {
      V.env(out.gain, [[0, amp], [Math.max(dur, 0.01), amp]]);
      out.gain.setTargetAtTime(0, V.T(Math.max(dur, off)), rel / 3);
      if (vel < 0.6) V.env(lp.frequency, [[0, cutoffOf(I, vel) * 1.4], [1.2, cutoffOf(I, vel) * 0.6, 'x']]);
    } else noteEnv(V, out.gain, amp, dur, art, I.atk, rel);
    let any = false;
    const used = [];
    // extra layers are high-passed so the fundamental comes from one player only (no comb
    // filtering in the low end); the ensemble shimmer lives in the upper harmonics
    let hpx = null;
    if (L > 1) { hpx = V.f('highpass', clamp(mtof(midi) * 2.2, 120, 900), 0); const hg = V.g(0.6); hpx.connect(hg); hg.connect(lp); }
    for (let k = 0; k < L; k++) {
      const pk = libPick(lib, midi, k);
      if (!pk || !pk.e) continue;
      const e = pk.e, rate = Math.pow(2, (midi - pk.midi) / 12);
      const delay = k > 0 ? 0.006 + 0.018 * hash1(ix * 13 + k) : 0;
      // a layer that reuses another layer's recording starts further in (different bow / breath
      // phase) so the copies don't comb-filter against each other
      const reuse = used.includes(pk.midi) && !plucky;
      used.push(pk.midi);
      let so = (k > 0 ? 0.035 * k : 0) + (reuse ? 0.3 + 0.25 * k : 0) + (vel < 0.35 && I.kind === 'section' ? 0.03 : 0) + off * rate;
      const src = A.ac.createBufferSource();
      if (!plucky && e.le > 0 && so + (stopX - off) * rate > e.le - 0.05) {
        src.buffer = loopBuf(e, pk.midi); src.loop = true; src.loopStart = e.ls; src.loopEnd = e.le;
        if (so > e.le - 0.02) so = e.ls + ((so - e.ls) % (e.le - e.ls));
      } else {
        src.buffer = e.buf;
        if (so > e.len - 0.05) continue;
      }
      src.playbackRate.value = rate;
      if (k > 0) src.detune.value = (k % 2 ? 1 : -1) * (I.fam === 'str' ? 5 + 7 * hash1(ix * 7 + k * 3) : 2.5 + 3.5 * hash1(ix * 7 + k * 3));
      else if (I.detuned) src.detune.value = 4;
      if (k > 0 && hpx) {
        // the extra players sit left and right of the first: a wide section when the texture allows
        if (busy < 26 && I.width) { const pn = V.pan((k % 2 ? -1 : 1) * I.width * (0.35 + 0.15 * k)); src.connect(pn); pn.connect(hpx); } else src.connect(hpx);
      } else src.connect(lp);
      const t0 = V.T(off) + delay;
      src.start(t0, so);
      src.stop(V.T(stopX) + delay);
      V.srcs.push(src);
      any = true;
      if (I.detuned && k === 0) {   // a second, slightly out-of-tune string: an old ship's piano
        const s2 = A.ac.createBufferSource(); s2.buffer = src.buffer; s2.playbackRate.value = rate; s2.detune.value = -5;
        const g2 = V.g(0.55); s2.connect(g2); g2.connect(lp); s2.start(t0 + 0.004, so); s2.stop(V.T(stopX)); V.srcs.push(s2);
      }
    }
    if (!any) return null;
    // "air": a soft filtered saw under ensemble sections — lushness and a seamless sustain
    if (I.air && dur > 1.0 && !stacc && busy < 28) {
      const f = mtof(midi), ag = V.g(0), alp = V.f('lowpass', clamp(f * 2.6, 600, 3800), -3);
      alp.connect(ag); ag.connect(lp);
      const a = amp * I.air * 1.3 * (0.6 + 0.4 * vel);
      V.env(ag.gain, [[0, 0], [Math.min(0.5, dur * 0.5), a], [dur, a * 0.9]]);
      ag.gain.setTargetAtTime(0, V.T(Math.max(dur, off)), rel / 3);
      const o = V.osc('sawtooth', f, 0, stopX); o.detune.value = 6 * (hash1(ix) > 0.5 ? 1 : -1);
      o.connect(alp);
    }
    return V.voice(ev.inst, out.gain, stopX);
  }

  // Pizzicato: plucked string from the harp samples (or synthesis), short body decay.
  function playPizz(A, I, ev, ix, when, off, art, ch) {
    const midi = ev.midi, vel = vv(ev), f = mtof(midi);
    const tau = clamp(0.75 - (midi - 36) * 0.011, 0.14, 0.75);
    const len = tau * 5;
    if (off > 0.3) return null;
    const V = new Vx(A, when, off, ep(A, ch.input));
    const out = V.g(0), lp = V.f('lowpass', 900 + 2600 * vel, 0);
    lp.connect(out); out.connect(V.out);
    const amp = I.gain * velAmp(vel) * 1.6;
    V.env(out.gain, [[0, 0], [0.003, amp], [len, amp * 0.001, 'x']]);
    const n = I.kind === 'section' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const pn = lp;
      const dl = k * (0.008 + 0.012 * hash1(ix + k));
      if (setReady('harp')) {
        const pk = libPick(LIB.harp, midi, k); if (!pk) continue;
        const s = A.ac.createBufferSource(); s.buffer = pk.e.buf; s.playbackRate.value = Math.pow(2, (midi - pk.midi) / 12);
        s.detune.value = k ? 8 : 0;
        s.connect(pn);
        s.start(V.T(0) + dl); s.stop(V.T(len) + dl); V.srcs.push(s);
      } else {
        for (let h = 1; h <= 4; h++) {
          const o = V.osc(h === 1 ? 'triangle' : 'sine', f * h, 0, len), g = V.g(0);
          V.env(g.gain, [[0, 0], [0.002, 0.8 / h], [tau * 4 / h, 0.001, 'x']]);
          o.detune.value = k ? 8 : 0; o.connect(g); g.connect(pn);
        }
      }
    }
    return V.voice(ev.inst, out.gain, len);
  }

  // String harmonics: glassy, airy sine tones with a whisper of bow.
  function playHarm(A, I, ev, ix, when, off, art, ch) {
    const f = mtof(ev.midi), vel = vv(ev), dur = ev.dur;
    if (dur <= off) return null;
    const V = new Vx(A, when, off, ep(A, ch.input));
    const out = V.g(0), hp = V.f('highpass', 400, 0);
    hp.connect(out); out.connect(V.out);
    const stopX = dur + 1.5;
    const amp = I.gain * velAmp(vel) * 0.5;
    noteEnv(V, out.gain, amp, dur, art === 'harm' ? 'legato' : art, 0.3, 0.6);
    const vib = V.osc('sine', 5.4, 0, stopX), vg = V.g(4); vib.connect(vg);
    [[1, 1], [2, 0.18], [3, 0.05]].forEach(([h, a]) => {
      const o = V.osc('sine', f * h, 0, stopX), g = V.g(a); vg.connect(o.detune); o.connect(g); g.connect(hp);
    });
    const nz = V.nz('white', 0, stopX), bp = V.f('bandpass', Math.min(f * 2, 9000), 2.5), ng = V.g(0.05);
    V.chain(nz, bp, ng, hp);
    return V.voice(ev.inst, out.gain, stopX);
  }

  // ---------------------------- synthesis ----------------------------
  const SYN = {};
  const synV = (A, when, off, ch) => new Vx(A, when, off, ep(A, ch.synthIn));

  // Strings: detuned saws, slow bow attack, filter bloom, delayed vibrato.
  SYN.strings = (A, I, ev, ix, when, off, art, ch) => {
    const f = mtof(ev.midi), vel = vv(ev);
    const dur = art === 'stacc' ? Math.min(ev.dur, 0.25) : ev.dur;
    if (dur <= off) return null;
    const sec = I.kind === 'section';
    const V = synV(A, when, off, ch);
    const rel = art === 'stacc' ? 0.1 : I.rel || 0.4;
    const amp = I.gain * velAmp(vel) * (sec ? 0.62 : 0.75);
    const out = V.g(0), lp = V.f('lowpass', 1000, 0);
    lp.connect(out); out.connect(V.out);
    const fc = clamp(f * (2.2 + 7 * vel), 800, 9000) * (I.kind === 'band' ? 0.7 : 1);
    const atk = art === 'marc' || art === 'stacc' ? 0.02 : (I.atk || 0.05) * (sec ? 1.8 : 1.3);
    V.env(lp.frequency, [[0, fc * 0.4], [atk * 2 + 0.05, fc], [Math.max(dur, atk * 2 + 0.1), fc * 0.9]]);
    const stopX = dur + rel * 3;
    const n = sec ? (LQ ? 2 : 3) : 1;
    const vib = V.osc('sine', 5.2 + 0.8 * hash1(ix), 0, stopX), vg = V.g(0);
    vib.connect(vg);
    V.env(vg.gain, [[0, 0], [0.22, 0], [0.8, sec ? 7 : 17]]);
    const pan0 = basePan(I, ev);
    for (let k = 0; k < n; k++) {
      const o = V.osc('sawtooth', f, 0, stopX);
      o.detune.value = sec ? (k - (n - 1) / 2) * 9 + (hash1(ix * 3 + k) - 0.5) * 4 : 0;
      vg.connect(o.detune);
      const og = V.g(1 / n), p = V.pan(pan0 + (sec ? (k - (n - 1) / 2) * (I.width || 0.4) * 0.7 : 0));
      o.connect(og); og.connect(p); p.connect(lp);
    }
    if (!sec) {
      const nz = V.nz('white', 0, stopX), bp = V.f('bandpass', Math.min(f * 3.5, 8000), 1.4), ng = V.g(0.05);
      V.chain(nz, bp, ng, lp);
    }
    if (art === 'trem') {
      const tg = V.g(0.55); lp.disconnect(); lp.connect(tg); tg.connect(out);
      trem(V, tg.gain, 0.45, 13 + hash1(ix) * 2, stopX);
    }
    noteEnv(V, out.gain, amp, dur, art, atk, rel);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Brass: saws through a "blatty" filter envelope with a lip scoop; horns darker.
  SYN.brass = (A, I, ev, ix, when, off, art, ch) => {
    const f = mtof(ev.midi), vel = vv(ev);
    const dur = art === 'stacc' ? Math.min(ev.dur, 0.25) : ev.dur;
    if (dur <= off) return null;
    const horn = I.fam === 'horn', V = synV(A, when, off, ch);
    const rel = I.rel || 0.3, stopX = dur + rel * 3;
    const amp = I.gain * velAmp(vel) * 0.8;
    const out = V.g(0), lp = V.f('lowpass', 1000, 1);
    lp.connect(out); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const k = horn ? 0.5 : 1;
    const fpk = clamp(f * (2 + 11 * Math.pow(vel, 1.4)) * k, 500, 11000), fs = fpk * 0.72;
    V.env(lp.frequency, [[0, f * 1.2], [horn ? 0.1 : 0.06, fpk], [0.4, fs], [Math.max(dur, 0.41), fs]]);
    const n = I.kind === 'section' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const o = V.osc('sawtooth', f, 0, stopX);
      V.env(o.detune, [[0, -35 + (i - 1) * 5], [0.07, (i - (n - 1) / 2) * 6]]);
      const g = V.g(1 / n); o.connect(g); g.connect(lp);
    }
    if (horn) { const o = V.osc('triangle', f, 0, stopX), g = V.g(0.5); o.connect(g); g.connect(lp); }
    noteEnv(V, out.gain, amp, dur, art, horn ? 0.07 : 0.035, rel);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Woodwinds
  function windCore(A, I, ev, ix, when, off, art, ch, build) {
    const f = mtof(ev.midi), vel = vv(ev);
    const dur = art === 'stacc' ? Math.min(ev.dur, 0.22) : ev.dur;
    if (dur <= off) return null;
    const V = synV(A, when, off, ch);
    const rel = I.rel || 0.25, stopX = dur + rel * 3;
    const amp = I.gain * velAmp(vel);
    const out = V.g(0); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const vib = V.osc('sine', 4.9 + 0.6 * hash1(ix), 0, stopX), vg = V.g(0);
    vib.connect(vg); V.env(vg.gain, [[0, 0], [0.3, 0], [0.9, build.vib || 0]]);
    build(V, f, vel, out, vg, stopX);
    noteEnv(V, out.gain, amp, dur, art, I.atk || 0.04, rel);
    return V.voice(ev.inst, out.gain, stopX);
  }
  const bFlute = (V, f, vel, out, vg, x1) => {
    const lp = V.f('lowpass', clamp(f * 4 + 3000 * vel, 1500, 10000), 0); lp.connect(out);
    [['sine', 1, 1], ['triangle', 1, 0.3], ['sine', 2, 0.12 + 0.1 * vel]].forEach(([ty, h, a]) => {
      const o = V.osc(ty, f * h, 0, x1), g = V.g(a); vg.connect(o.detune); o.connect(g); g.connect(lp);
    });
    const nz = V.nz('white', 0, x1), bp = V.f('bandpass', Math.min(f * 2, 9000), 0.9), ng = V.g(0);
    V.env(ng.gain, [[0, 0.35], [0.08, 0.08]]);
    V.chain(nz, bp, ng, lp);
  };
  bFlute.vib = 14;
  const bClar = (V, f, vel, out, vg, x1) => {
    const w = wave(V.A, 'clar', [1, 0.02, 0.36, 0.02, 0.2, 0.02, 0.12, 0.01, 0.08, 0.01, 0.05, 0.01, 0.03]);
    const o = V.osc(w, f, 0, x1), lp = V.f('lowpass', clamp(f * (3 + 5 * vel), 900, 7000), 0);
    vg.connect(o.detune); o.connect(lp); lp.connect(out);
  };
  bClar.vib = 3;
  const bOboe = (V, f, vel, out, vg, x1) => {
    const w = wave(V.A, 'oboe', [0.55, 0.9, 1.0, 0.8, 0.55, 0.42, 0.32, 0.25, 0.18, 0.12, 0.09, 0.06]);
    const o = V.osc(w, f, 0, x1);
    const hp = V.f('highpass', 260, 0), p1 = V.f('peaking', 1150, 1.4, 5), p2 = V.f('peaking', 2900, 2, 3), lp = V.f('lowpass', 6500 + 2000 * vel, 0);
    vg.connect(o.detune); V.chain(o, hp, p1, p2, lp, out);
    const nz = V.nz('white', 0, x1), bp = V.f('bandpass', 2600, 1.2), ng = V.g(0.03); V.chain(nz, bp, ng, out);
  };
  bOboe.vib = 11;
  const bBassoon = (V, f, vel, out, vg, x1) => {
    const w = wave(V.A, 'bsn', [0.55, 1, 0.85, 0.7, 0.45, 0.32, 0.2, 0.12, 0.08, 0.05]);
    const o = V.osc(w, f, 0, x1), pk = V.f('peaking', 480, 1.2, 5), lp = V.f('lowpass', clamp(f * 6, 900, 3500), 0);
    vg.connect(o.detune); V.chain(o, pk, lp, out);
  };
  bBassoon.vib = 5;
  SYN.flute = (...a) => windCore(...a, bFlute);
  SYN.clarinet = (...a) => windCore(...a, bClar);
  SYN.oboe = (...a) => windCore(...a, bOboe);
  SYN.bassoon = (...a) => windCore(...a, bBassoon);

  // Piano: inharmonic partials with per-partial decay, hammer noise, damper on release.
  SYN.piano = (A, I, ev, ix, when, off, art, ch) => {
    if (off > 1.5) return null;
    const f = mtof(ev.midi), vel = vv(ev), dur = art === 'stacc' ? Math.min(ev.dur, 0.2) : ev.dur;
    const V = synV(A, when, off, ch);
    const out = V.g(1), lp = V.f('lowpass', clamp(f * (4 + 10 * vel), 1500, 12000), 0);
    lp.connect(out); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel) * 1.3;
    const tau1 = clamp(5.5 * 261 / f, 0.5, 6);
    const np = f < 200 ? 7 : f < 700 ? 5 : 3, B = f < 150 ? 0.0006 : 0.0003;
    const stopX = Math.min(dur + 0.6, tau1 * 3 + 0.2);
    const bright = 0.5 + 0.4 * vel;
    for (let n = 1; n <= np; n++) {
      const fn = n * f * Math.sqrt(1 + B * n * n);
      if (fn > 16000) break;
      const a = amp * Math.pow(bright, n - 1) / Math.pow(n, 0.9);
      const uni = I.detuned && n <= 2 ? [-4, 4] : [0];
      for (const dt of uni) {
        const o = V.osc('sine', fn, 0, stopX), g = V.g(0);
        o.detune.value = dt;
        V.env(g.gain, [[0, 0], [0.003, a / uni.length]]);
        g.gain.setTargetAtTime(0, V.T(Math.max(0.003 + 0.01 * n, off)), tau1 / (1 + 0.45 * (n - 1)));
        g.gain.setTargetAtTime(0, V.T(Math.max(dur, off)), 0.09);
        o.connect(g); g.connect(lp);
      }
    }
    const nz = V.nz('white', 0, 0.06), bp = V.f('bandpass', clamp(f * 4, 800, 5000), 0.8), ng = V.g(0);
    V.env(ng.gain, [[0, 0], [0.001, amp * 0.35 * vel], [0.04, 0]]);
    V.chain(nz, bp, ng, lp);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Harp: plucked partials, bright-to-dark filter.
  SYN.harp = (A, I, ev, ix, when, off, art, ch) => {
    if (off > 1.5) return null;
    const f = mtof(ev.midi), vel = vv(ev);
    const V = synV(A, when, off, ch);
    const out = V.g(1), lp = V.f('lowpass', f * 10, 0);
    lp.connect(out); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    V.env(lp.frequency, [[0, clamp(f * 12, 2000, 14000)], [0.5, clamp(f * 4, 800, 8000), 'x']]);
    const tau = clamp(3.2 * 220 / f, 0.5, 4.5), stopX = tau * 4;
    const amp = I.gain * velAmp(vel) * 1.4;
    for (let n = 1; n <= 6; n++) {
      const o = V.osc('sine', f * n * (1 + 0.0004 * n * n), 0, stopX), g = V.g(0);
      V.env(g.gain, [[0, 0], [0.002, amp / Math.pow(n, 1.4)], [stopX / (1 + 0.5 * (n - 1)), 0.0001, 'x']]);
      o.connect(g); g.connect(lp);
    }
    const nz = V.nz('white', 0, 0.05), bp = V.f('bandpass', Math.min(f * 3, 6000), 1), ng = V.g(0);
    V.env(ng.gain, [[0, 0], [0.001, amp * 0.25], [0.03, 0]]); V.chain(nz, bp, ng, lp);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Organ: principal + octave + mixture ranks, a little chiff, slight celeste detune.
  SYN.organ = (A, I, ev, ix, when, off, art, ch) => {
    const f = mtof(ev.midi), vel = vv(ev), dur = ev.dur;
    if (dur <= off) return null;
    const V = synV(A, when, off, ch), rel = I.rel || 0.35, stopX = dur + rel * 3;
    const out = V.g(0), lp = V.f('lowpass', clamp(f * 8, 1500, 9000), 0);
    lp.connect(out); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const w = wave(A, 'organ', [1, 0.55, 0.22, 0.32, 0.06, 0.14, 0.02, 0.1, 0.02, 0.04]);
    [0, 2.5].forEach((dt, i) => { const o = V.osc(w, f, 0, stopX), g = V.g(i ? 0.45 : 0.6); o.detune.value = dt; o.connect(g); g.connect(lp); });
    const nz = V.nz('white', 0, 0.12), bp = V.f('bandpass', Math.min(f * 3, 7000), 2), ng = V.g(0);
    V.env(ng.gain, [[0, 0], [0.01, 0.25], [0.08, 0]]); V.chain(nz, bp, ng, lp);
    noteEnv(V, out.gain, I.gain * (0.35 + 0.65 * vel), dur, art, 0.06, rel);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Celesta: sine bars with a felt-hammer click.
  SYN.celesta = (A, I, ev, ix, when, off, art, ch) => {
    if (off > 0.8) return null;
    const f = mtof(ev.midi), vel = vv(ev);
    const V = synV(A, when, off, ch);
    const out = V.g(1); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel) * 1.4, tau = clamp(1.3 * 523 / f, 0.35, 1.6);
    const ring = Math.max(ev.dur, 0.6) + 0.5, stopX = Math.min(ring, tau * 5) + 0.3;
    [[1, 1, tau], [2, 0.2, tau * 0.4], [3.98, 0.1, tau * 0.12]].forEach(([h, a, tt]) => {
      const o = V.osc('sine', f * h, 0, stopX), g = V.g(0);
      V.env(g.gain, [[0, 0], [0.002, amp * a]]);
      g.gain.setTargetAtTime(0, V.T(Math.max(0.003, off)), tt);
      g.gain.setTargetAtTime(0, V.T(Math.max(ring - 0.5, off)), 0.12);
      o.connect(g); g.connect(out);
    });
    const nz = V.nz('white', 0, 0.03), bp = V.f('bandpass', 5000, 1.5), ng = V.g(0);
    V.env(ng.gain, [[0, 0], [0.001, amp * 0.12], [0.012, 0]]); V.chain(nz, bp, ng, out);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Tubular bells: inharmonic additive partials with long, staggered decays.
  const BELL = [[0.5, 0.3, 7], [1, 1, 5.5], [1.19, 0.45, 3.2], [1.5, 0.4, 3.4], [2.0, 0.65, 2.6], [2.52, 0.3, 1.9], [2.99, 0.25, 1.4], [4.07, 0.14, 0.8], [5.4, 0.08, 0.45]];
  SYN.bells = (A, I, ev, ix, when, off, art, ch) => {
    if (off > 2) return null;
    const f = mtof(ev.midi), vel = vv(ev);
    const V = synV(A, when, off, ch);
    const out = V.g(1); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel), sc = clamp(440 / f, 0.5, 1.6), stopX = 7 * sc + 0.5;
    for (const [r, a, tau] of BELL) {
      if (f * r > 12000) continue;
      const o = V.osc('sine', f * r, 0, stopX), g = V.g(0);
      V.env(g.gain, [[0, 0], [0.002, amp * a], [tau * sc * 1.2, amp * a * 0.3, 'x'], [stopX, 0.0001, 'x']]);
      o.connect(g); g.connect(out);
    }
    const nz = V.nz('white', 0, 0.04), bp = V.f('bandpass', 3200, 1.2), ng = V.g(0);
    V.env(ng.gain, [[0, 0], [0.001, amp * 0.3], [0.02, 0]]); V.chain(nz, bp, ng, out);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // ------------------------------------------------------------------
  // Pre-rendered percussion one-shots (additive synthesis done once in JS, then played
  // as buffers: identical sound, a fraction of the realtime cost).
  // ------------------------------------------------------------------
  const PRE = {};
  function preBuf(sr, key, secs, fill) {
    const m = PRE[sr] || (PRE[sr] = {});
    if (m[key]) return m[key];
    const b = new AudioBuffer({ length: Math.floor(secs * sr), numberOfChannels: 1, sampleRate: sr });
    const d = b.getChannelData(0);
    fill(d, sr);
    let pk = 1e-9; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
    return (m[key] = b);
  }
  // decaying sinusoid via a rotating phasor (no per-sample sin/exp)
  function addPartial(d, sr, f, a, decay, bloom, ph) {
    const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w), m = Math.exp(-6.91 / (decay * sr));
    let s1 = Math.sin(ph), s0 = Math.sin(ph - w), e = a;
    const nb = Math.max(1, Math.floor(bloom * sr));
    for (let i = 0; i < d.length; i++) {
      const s = c * s1 - s0; s0 = s1; s1 = s;
      d[i] += e * s * (i < nb ? 0.1 + 0.9 * i / nb : 1);
      e *= m;
      if (e < 1e-5 * a) break;
    }
  }
  function addNoise(d, sr, r, o) {   // one-pole band-limited noise burst: o = {lo, hi, a, att, decay}
    const al = Math.exp(-2 * Math.PI * o.hi / sr), ah = Math.exp(-2 * Math.PI * (o.lo || 1) / sr);
    const m = Math.exp(-6.91 / (o.decay * sr)), na = Math.max(1, Math.floor((o.att || 0.001) * sr));
    let y = 0, z = 0, e = o.a;
    for (let i = 0; i < d.length; i++) {
      y = al * y + (1 - al) * (r() * 2 - 1); z = ah * z + (1 - ah) * y;
      d[i] += (y - z) * e * (i < na ? i / na : 1) * 3;
      if (i >= na) e *= m;
      if (e < 1e-5 * o.a) break;
    }
  }
  const TAM = [1, 1.41, 1.73, 2.12, 2.53, 2.91, 3.4, 3.97, 4.62, 5.3, 6.1, 7.2, 8.4, 9.9, 11.7, 13.6];
  const bufTam = (sr) => preBuf(sr, 'tam', 10, (d) => {
    const r = U.rng(77);
    TAM.forEach((rt, k) => {
      const f = 55 * rt * (1 + (r() - 0.5) * 0.03);
      if (f > sr * 0.45) return;
      addPartial(d, sr, f, (k === 0 ? 0.9 : 0.55 / Math.pow(k, 0.35)) * (0.7 + 0.6 * r()), k < 2 ? 8.5 : Math.max(2.5, 8 - k * 0.35), k < 2 ? 0 : 0.25 + k * 0.09, r() * 6.28);
    });
    addNoise(d, sr, r, { lo: 1500, hi: 4200, a: 0.28, att: 0.9, decay: 6 });
    addNoise(d, sr, r, { lo: 20, hi: 280, a: 1.2, att: 0.004, decay: 0.35 });
  });
  const TIMP = [[1, 1, 1], [1.5, 0.5, 0.75], [1.98, 0.32, 0.55], [2.44, 0.18, 0.42], [2.9, 0.1, 0.3]];
  const bufTimp = (sr) => preBuf(sr, 'timp', 4.2, (d) => {
    const r = U.rng(78), f = 98, tau = 2.0 * 100 / f;
    for (const [rt, a, tf] of TIMP) {    // pitch settles from +3 % over the first 90 ms
      let ph = 0, e = a;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += 2 * Math.PI * f * rt * (1 + 0.03 * Math.exp(-t / 0.03)) / sr;
        d[i] += e * Math.sin(ph) * Math.min(1, i / (0.002 * sr));
        e *= Math.exp(-1 / (tau * tf * 0.6 * sr));
        if (e < 1e-5) break;
      }
    }
    addNoise(d, sr, r, { lo: 30, hi: 1100, a: 1.4, att: 0.001, decay: 0.12 });
    addNoise(d, sr, r, { lo: 1500, hi: 3500, a: 0.2, att: 0.001, decay: 0.02 });
  });
  const bufBD = (sr) => preBuf(sr, 'bd', 4, (d) => {
    const r = U.rng(79);
    for (const [f, a, tau] of [[48, 1, 2.2], [48 * 1.47, 0.4, 1.0], [48 * 2.09, 0.18, 0.5]]) {
      let ph = 0, e = a;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += 2 * Math.PI * f * (1 + 0.18 * Math.exp(-t / 0.08)) / sr;
        d[i] += e * Math.sin(ph) * Math.min(1, i / (0.004 * sr));
        e *= Math.exp(-6.91 / (tau * 1.8 * sr));
      }
    }
    addNoise(d, sr, r, { lo: 20, hi: 260, a: 1.2, att: 0.003, decay: 0.3 });
  });
  function metal(d, sr, r) {
    const fs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.73), ph = fs.map(() => r());
    let h1 = 0, h2 = 0, x1 = 0, x2 = 0;
    const a = Math.exp(-2 * Math.PI * 3200 / sr);
    for (let i = 0; i < d.length; i++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += ((fs[k] * i / sr + ph[k]) % 1) < 0.5 ? 1 : -1;
      const v = s * 0.09 + (r() * 2 - 1) * 0.5;
      h1 = a * (h1 + v - x1); x1 = v;           // two one-pole high-passes
      h2 = a * (h2 + h1 - x2); x2 = h1;
      d[i] = h2;
    }
  }
  const bufCymLoop = (sr) => preBuf(sr, 'cymloop', 2, (d) => metal(d, sr, U.rng(80)));
  const bufCrash = (sr) => preBuf(sr, 'crash', 6, (d) => {
    const r = U.rng(81);
    metal(d, sr, r);
    let y = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const env = (t < 0.002 ? t / 0.002 * 1.3 : t < 0.14 ? lerp(1.3, 0.55, (t - 0.002) / 0.138) : 0.55 * Math.exp(-6.91 * (t - 0.14) / 5.3));
      const fc = 16000 * Math.pow(5000 / 16000, Math.min(1, t / 3.5)), al = Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr);
      y = al * y + (1 - al) * d[i];
      d[i] = y * env;
    }
    addNoise(d, sr, r, { lo: 500, hi: 1300, a: 0.12, att: 0.002, decay: 0.35 });
  });

  // Percussion helpers: a roll = many strokes written as automation on one gain.
  function rollPts(dur, rate, lvl, seed, tail) {
    const r = U.rng(seed), pts = [[0, 0]];
    const n = Math.max(1, Math.floor(dur * rate));
    for (let i = 0; i < n; i++) {
      const x = Math.max(0.001, (i + (r() - 0.5) * 0.35) / rate);
      if (x <= pts[pts.length - 1][0] + 0.004) continue;
      const v = Math.max(1e-4, lvl(x / dur) * (0.8 + 0.35 * r()));
      pts.push([x, v * 0.6, 'x'], [x + 0.004, v], [x + 0.9 / rate, v * 0.55, 'x']);
    }
    const last = pts[pts.length - 1];
    pts.push([Math.max(dur, last[0] + 0.01), last[1]], [Math.max(dur, last[0] + 0.01) + tail, 0.0001, 'x']);
    return pts;
  }
  const isRoll = (art) => art === 'roll' || art === 'trem' || art === 'swell';

  // Timpani: tuned membrane modes with a pitch-settling attack; rolls.
  SYN.timpani = (A, I, ev, ix, when, off, art, ch) => {
    const roll = isRoll(art), f = mtof(ev.midi), vel = vv(ev);
    if (!roll && off > 0.05) return null;
    const V = synV(A, when, off, ch);
    const out = V.g(1); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel), tau = clamp(2.0 * 100 / f, 0.8, 2.4);
    if (!roll) {
      const src = A.ac.createBufferSource(); src.buffer = bufTimp(A.sr); src.playbackRate.value = f / 98;
      const lp = V.f('lowpass', 900 + 5500 * vel * vel, 0), g = V.g(amp);
      V.chain(src, lp, g, out);
      src.start(V.when); V.srcs.push(src);
      return V.voice(ev.inst, out.gain, 4.2 * 98 / f);
    }
    const dur = ev.dur, stopX = dur + tau * 4;
    const lvl = art === 'swell' ? (u) => amp * (0.12 + 0.88 * Math.pow(u, 1.6)) : (u) => amp * 0.7 * (1 + 0.1 * Math.sin(u * 9));
    const pts = rollPts(dur, 15.5, lvl, ix * 31 + 7, tau * 3);
    const rg = V.g(0); V.env(rg.gain, pts); rg.connect(out);
    for (const [r, a] of TIMP) { const o = V.osc('sine', f * r, 0, stopX), g = V.g(a * 0.55); o.connect(g); g.connect(rg); }
    const nz = V.nz('pink', 0, stopX), bp = V.f('bandpass', 900, 0.7), ng = V.g(0.45); V.chain(nz, bp, ng, rg);
    return V.voice(ev.inst, rg.gain, stopX);
  };

  // Gran cassa: soft, huge, felt-mallet thud with a long low bloom.
  SYN.bassdrum = (A, I, ev, ix, when, off, art, ch) => {
    const roll = isRoll(art), vel = vv(ev);
    if (!roll && off > 0.05) return null;
    const V = synV(A, when, off, ch);
    const out = V.g(1); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel);
    const modes = [[48, 1, 2.2], [48 * 1.47, 0.4, 1.0], [48 * 2.09, 0.18, 0.5]];
    if (!roll) {
      const src = A.ac.createBufferSource(); src.buffer = bufBD(A.sr);
      const lp = V.f('lowpass', 300 + 900 * vel, 0), g = V.g(amp * 0.9);
      V.chain(src, lp, g, out);
      src.start(V.when); V.srcs.push(src);
      return V.voice(ev.inst, out.gain, 4);
    }
    const dur = ev.dur, stopX = dur + 3.5;
    const lvl = art === 'swell' ? (u) => amp * (0.1 + 0.9 * u * u) : (u) => amp * 0.6;
    const rg = V.g(0); V.env(rg.gain, rollPts(dur, 11, lvl, ix * 17 + 3, 2.5)); rg.connect(out);
    for (const [f, a] of modes) { const o = V.osc('sine', f, 0, stopX), g = V.g(a * 0.6); o.connect(g); g.connect(rg); }
    const nz = V.nz('brown', 0, stopX), lp = V.f('lowpass', 320, 0), ng = V.g(0.8); V.chain(nz, lp, ng, rg);
    return V.voice(ev.inst, rg.gain, stopX);
  };

  // Suspended / clash cymbal (pre-rendered metallic cluster + noise). art crash|roll|swell
  SYN.cymbal = (A, I, ev, ix, when, off, art, ch) => {
    const vel = vv(ev), dur = ev.dur;
    const crash = art !== 'roll' && art !== 'swell' && art !== 'trem';
    if (crash && off > 0.3) return null;
    const V = synV(A, when, off, ch);
    const out = V.g(0), lp = V.f('lowpass', 7000 + 9000 * vel, 0);
    lp.connect(out); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel) * 1.6;
    const src = A.ac.createBufferSource();
    if (crash) {
      src.buffer = bufCrash(A.sr); src.connect(lp);
      V.env(out.gain, [[0, amp]]);
      src.start(V.when, off); V.srcs.push(src);
      return V.voice(ev.inst, out.gain, 6);
    }
    const stopX = dur + 4.5;
    src.buffer = bufCymLoop(A.sr); src.loop = true;
    const amg = V.g(0.75), m = V.nz('rough', 0, stopX, 1.8), mg = V.g(0.35);
    m.connect(mg); mg.connect(amg.gain); src.connect(amg); amg.connect(lp);
    src.start(V.when, (hash1(ix) * 1.9)); src.stop(V.T(stopX)); V.srcs.push(src);
    V.env(out.gain, art === 'swell'
      ? [[0, amp * 0.012], [Math.max(0.1, dur), amp * 0.9, 'x'], [dur + 0.05, amp * 0.9], [dur + 4.2, 0.0001, 'x']]
      : [[0, 0], [0.4, amp * 0.4], [Math.max(0.41, dur), amp * 0.45], [dur + 2.5, 0.0001, 'x']]);
    V.env(lp.frequency, [[0, 6000], [Math.max(0.1, dur), 7000 + 9000 * vel], [dur + 3, 5000]]);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Tam-tam: pre-rendered blooming strike (pitched by playback rate); rolled swells synthesized.
  SYN.tamtam = (A, I, ev, ix, when, off, art, ch) => {
    const swell = art === 'swell' || art === 'roll' || art === 'trem';
    if (!swell && off > 4) return null;
    const vel = vv(ev), f0 = clamp(mtof(ev.midi), 42, 90);
    const V = synV(A, when, off, ch);
    const out = V.g(1); out.connect(V.pan(basePan(I, ev))).connect(V.out);
    const amp = I.gain * velAmp(vel) * 1.4;
    if (!swell) {
      const src = A.ac.createBufferSource(); src.buffer = bufTam(A.sr); src.playbackRate.value = f0 / 55;
      const g = V.g(amp); src.connect(g); g.connect(out);
      src.start(V.when, off * f0 / 55); V.srcs.push(src);
      return V.voice(ev.inst, null, 10 * 55 / f0);
    }
    const pre = Math.max(0.2, ev.dur), stopX = pre + 8, r = U.rng(ix * 91 + 5);
    TAM.slice(0, 9).forEach((rt, k) => {
      const f = f0 * rt * (1 + (r() - 0.5) * 0.03), o = V.osc('sine', f, 0, stopX), g = V.g(0);
      const a = amp * (k === 0 ? 0.9 : 0.55 / Math.pow(k, 0.35)) * (0.7 + 0.6 * r());
      V.env(g.gain, [[0, a * 0.01], [pre, a * 0.8, 'x'], [pre + 0.3 + k * 0.05, a], [pre + Math.max(2.5, 8 - k * 0.4), 0.0001, 'x']]);
      o.connect(g); g.connect(out);
    });
    const nz = V.nz('pink', 0, stopX), bp = V.f('bandpass', 2600, 0.6), ng = V.g(0);
    V.env(ng.gain, [[0, 0.0001], [pre, amp * 0.3, 'x'], [pre + 6, 0.0001, 'x']]);
    V.chain(nz, bp, ng, out);
    return V.voice(ev.inst, null, stopX);
  };

  // Choir: each note is a small group of singers (detuned glottal-ish saws with their own
  // vibrato and jitter), breath noise, shaped by a vowel formant bank for the voice part.
  const FORM = {
    a: {
      sop: [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130], [4950, -50, 140]],
      alto: [[800, 0, 80], [1150, -4, 90], [2800, -20, 120], [3500, -36, 130], [4950, -60, 140]],
      ten: [[650, 0, 80], [1080, -6, 90], [2650, -7, 120], [2900, -8, 130], [3250, -22, 140]],
      bass: [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]],
    },
    u: {
      sop: [[350, 0, 50], [600, -20, 60], [2700, -17, 170], [2900, -14, 180], [3300, -26, 200]],
      alto: [[325, 0, 50], [700, -12, 60], [2530, -30, 170], [3500, -40, 180], [4950, -64, 200]],
      ten: [[350, 0, 40], [600, -20, 60], [2700, -17, 100], [2900, -14, 120], [3300, -26, 120]],
      bass: [[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]],
    },
  };
  // One persistent vowel filter bank per voice part and channel; notes feed their part's bank.
  function choirBanks(A, I, dest) {
    const ac = A.ac, vowel = FORM[I.vowel] ? I.vowel : 'a', parts = {};
    const PAN = { sop: -0.28, alto: -0.1, ten: 0.12, bass: 0.28 };
    for (const part of ['sop', 'alto', 'ten', 'bass']) {
      const F = FORM[vowel][part];
      const inp = ac.createGain(), mix = ac.createGain(), hs = ac.createBiquadFilter(), pn = ac.createStereoPanner();
      hs.type = 'highshelf'; hs.frequency.value = Math.min(6000, A.sr * 0.45); hs.gain.value = -8;
      pn.pan.value = PAN[part];
      F.forEach(([ff, adb, bw], k) => {
        const fr = k === 0 && part === 'sop' ? ff * 1.08 : ff;
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(fr, A.sr * 0.45); bp.Q.value = fr / (bw * 1.8);
        const g = ac.createGain(); g.gain.value = dB(adb) * (k === 0 ? 1.6 : 2.2);
        inp.connect(bp); bp.connect(g); g.connect(mix);
      });
      const body = ac.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = F[0][0]; body.Q.value = 0;
      const bg = ac.createGain(); bg.gain.value = vowel === 'u' ? 0.35 : 0.22;
      inp.connect(body); body.connect(bg); bg.connect(mix);
      mix.connect(hs); hs.connect(pn); pn.connect(dest);
      parts[part] = { inp };
    }
    return parts;
  }
  SYN.choir = (A, I, ev, ix, when, off, art, ch) => {
    const midi = ev.midi, f = mtof(midi), vel = vv(ev), dur = ev.dur;
    if (dur <= off || !ch.parts) return null;
    const part = midi < 50 ? 'bass' : midi < 58 ? 'ten' : midi < 65 ? 'alto' : 'sop';
    const V = new Vx(A, when, off, ep(A, ch.parts[part].inp));
    const rel = I.rel || 0.7, stopX = dur + rel * 3;
    const out = V.g(0); out.connect(V.out);
    const nS = LQ || activeNotes(A, when) > 36 ? 1 : 2;
    const spread = nS === 1 ? [0] : [-8, 8];
    const depth = clamp(22 + (midi - 55) * 0.6, 14, 38);
    for (let s = 0; s < nS; s++) {
      const o = V.osc('sawtooth', f, 0, stopX);
      o.detune.value = spread[s] + (hash1(ix * 5 + s) - 0.5) * 6;
      const lfo = V.osc('sine', 4.6 + 1.2 * hash1(ix * 11 + s), 0, stopX), lg = V.g(0);
      V.env(lg.gain, [[0, 0], [0.25 + 0.3 * hash1(s + ix), 0], [0.9 + 0.3 * hash1(s * 3 + ix), depth]]);
      lfo.connect(lg); lg.connect(o.detune);
      o.connect(out);
    }
    const br = V.nz('pink', 0, stopX), bhp = V.f('highpass', 500, 0), bg = V.g((I.vowel === 'u' ? 0.05 : 0.08) * nS);
    V.chain(br, bhp, bg, out);
    noteEnv(V, out.gain, I.gain * velAmp(vel) / nS, dur, art, art === 'marc' ? 0.06 : I.atk || 0.35, rel);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Drone: a sub-bass pad with slowly breathing filter.
  SYN.drone = (A, I, ev, ix, when, off, art, ch) => {
    const f = mtof(ev.midi), vel = vv(ev), dur = ev.dur;
    if (dur <= off) return null;
    const V = new Vx(A, when, off, ep(A, ch.input));
    const rel = I.rel || 3, stopX = dur + rel * 2;
    const out = V.g(0); out.connect(V.out);
    [[1, 0.6], [2, 0.26], [3, 0.08]].forEach(([h, a]) => { const o = V.osc('sine', f * h, 0, stopX), g = V.g(a); o.connect(g); g.connect(out); });
    const lp = V.f('lowpass', f * 3 + 140, 2), lg = V.g(0.22);
    const lfo = V.osc('sine', 0.07 + 0.05 * hash1(ix), 0, stopX), lfg = V.g(f * 1.2 + 60); lfo.connect(lfg); lfg.connect(lp.frequency);
    [-6, 6].forEach((dt, i) => { const o = V.osc('sawtooth', f, 0, stopX); o.detune.value = dt; const p = V.pan(i ? 0.5 : -0.5); o.connect(p); p.connect(lp); });
    lp.connect(lg); lg.connect(out);
    noteEnv(V, out.gain, I.gain * (0.3 + 0.7 * vel), dur, art === 'marc' ? 'legato' : art, Math.min(I.atk || 2, dur * 0.35), rel);
    return V.voice(ev.inst, out.gain, stopX);
  };

  // Dispatch one score event (off = seconds already elapsed when starting mid-way).
  let errCount = 0;
  function errOnce(where, e) { if (errCount++ < 6) TT.error('audio ' + where, e); }
  function playEvent(A, ev, ix, off) {
    const I = instOf(ev.inst);
    const art = ev.art || I.defArt || 'legato';
    let when = A.when(ev.t) + off;
    if (!A.offline) {
      const now = A.ac.currentTime;
      if (when < now + 0.01) {
        const late = now + 0.01 - when;
        const hold = !(I.kind === 'perc' || I.kind === 'pluck' || I.kind === 'keys') || isRoll(art);
        if (!hold && off + late > 0.12) return;
        off += late; when = now + 0.01;
      }
    }
    const ch = chan(A, ev.inst);
    limitVoices(A, ev.inst, LQ ? Math.ceil(I.poly * 0.6) : I.poly || 8, when);
    let v = null;
    try {
      if (art === 'harm' && isStr(I)) v = playHarm(A, I, ev, ix, when, off, art, ch);
      else if (art === 'pizz' && isStr(I)) v = playPizz(A, I, ev, ix, when, off, art, ch);
      else {
        const sn = setOf(I, ev.midi);
        if (sn && setReady(sn)) v = playSampled(A, I, ev, ix, when, off, art, ch);
        else v = (SYN[I.synth] || SYN.strings)(A, synOf(I), ev, ix, when, off, art, ch);
      }
    } catch (e) { errOnce('note ' + ev.inst, e); }
    if (v) A.voices.push(v);
  }

  // ==================================================================
  // SOUND DESIGN — building blocks. x = time relative to the cue start.
  // ==================================================================
  function outTo(V, node, pan, dest) {
    if (pan) { const p = V.pan(pan); node.connect(p); p.connect(dest || V.out); } else node.connect(dest || V.out);
  }
  // filtered noise burst
  function burst(V, x, o, dest) {
    const a = o.a || 0.002, d = o.d || 0.2, end = x + a + d;
    if (end <= V.off) return null;
    const n = V.nz(o.kind || 'white', x, end + 0.01, o.rate || 1);
    const fl = V.f(o.type || 'bandpass', o.f || 1000, o.q == null ? 0.8 : o.q);
    const g = V.g(0);
    V.env(g.gain, [[x, 0], [x + a, o.lvl], [end, o.lvl * 0.001, 'x']]);
    if (o.f1) V.env(fl.frequency, [[x, o.f], [end, o.f1, 'x']]);
    n.connect(fl); fl.connect(g); outTo(V, g, o.pan, dest);
    return g;
  }
  // pitched tone with glide and exponential decay
  function tone(V, x, o, dest) {
    const a = o.a || 0.003, d = o.d || 0.5, end = x + a + d;
    if (end <= V.off) return null;
    const os = V.osc(o.type || 'sine', o.f0, x, end + 0.01);
    if (o.f1) V.env(os.frequency, [[x, o.f0], [x + (o.glide || d), o.f1, 'x']]);
    const g = V.g(0);
    V.env(g.gain, o.pts || [[x, 0], [x + a, o.lvl], [end, o.lvl * 0.0005, 'x']]);
    os.connect(g);
    if (o.lp) { const l = V.f('lowpass', o.lp, 0); g.connect(l); outTo(V, l, o.pan, dest); } else outTo(V, g, o.pan, dest);
    return g;
  }
  // deep impact: falling sine pair + low noise
  function boom(V, x, lvl, o = {}, dest) {
    const tau = o.tau || 0.8, f0 = o.f0 || 62, f1 = o.f1 || 32;
    tone(V, x, { f0, f1, glide: 0.35, lvl, a: 0.004, d: tau * 5 }, dest);
    tone(V, x, { f0: f0 * 1.52, f1: f1 * 1.5, glide: 0.3, lvl: lvl * 0.35, a: 0.004, d: tau * 2.5 }, dest);
    burst(V, x, { kind: 'brown', type: 'lowpass', f: o.nf || 220, q: 0, lvl: lvl * (o.noise == null ? 1.3 : o.noise), a: 0.005, d: tau * 2.5, pan: o.pan }, dest);
  }
  // one shared panner for a compound sound
  function panned(V, pan, dest) {
    if (!pan) return dest || V.out;
    const p = V.pan(pan); p.connect(dest || V.out); return p;
  }
  // sharp crack (rivet / plate / ice snapping)
  function crack(V, x, lvl, pan, f, dest) {
    if (x + 0.2 <= V.off) return;
    const o = panned(V, pan, dest);
    burst(V, x, { kind: 'white', type: 'highpass', f: 1400, q: 0, lvl, a: 0.0006, d: 0.035 + 0.03 * hash1(Math.floor(x * 997) + (f | 0)) }, o);
    tone(V, x, { f0: f || 3200, f1: (f || 3200) * 0.8, lvl: lvl * 0.28, a: 0.001, d: 0.09 }, o);
  }
  // water: slap, body, thump, spray falling back, wash
  function splash(V, x, size, lvl, pan, dest) {
    const s = size, o = panned(V, pan, dest);
    burst(V, x, { kind: 'white', type: 'lowpass', f: 3800, q: 0, lvl: lvl * 0.6, a: 0.004, d: 0.14 + 0.1 * s }, o);
    burst(V, x, { kind: 'pink', type: 'bandpass', f: 650 / Math.sqrt(s), q: 0.5, lvl: lvl * 0.8, a: 0.02, d: 0.5 + 0.9 * s }, o);
    if (s > 0.6) tone(V, x, { f0: 58, f1: 30, glide: 0.4, lvl: lvl * Math.min(1, s) * 0.9, a: 0.005, d: 0.5 * s }, dest);
    const sp = x + 0.08 * s, spe = sp + 1.2 + 2.2 * s;
    if (spe > V.off) {
      const n = V.nz('white', sp, spe), hp = V.f('highpass', 1700, 0), am = V.g(0.45), g = V.g(0);
      const m = V.nz('rough', sp, spe, 1.4), mg = V.g(0.55);
      m.connect(mg); mg.connect(am.gain);
      V.env(g.gain, [[sp, 0], [sp + 0.2 * s + 0.05, lvl * 0.42], [spe, 0.0001, 'x']]);
      V.chain(n, hp, am, g); g.connect(o);
    }
    burst(V, x + 0.15, { kind: 'brown', type: 'lowpass', f: 650, q: 0, lvl: lvl * 0.5, a: 0.35 * s, d: 2.5 * s + 0.5 }, o);
  }
  // stressed steel groan: detuned saws wandering in pitch through hull resonances
  function groan(V, x, len, f, lvl, pan, o = {}, dest) {
    if (x + len <= V.off) return;
    const out = V.g(0);
    V.env(out.gain, [[x, 0], [x + len * 0.35, lvl], [x + len * 0.7, lvl * 0.8], [x + len, 0]]);
    const bend = o.bend == null ? -3 : o.bend;
    const mix = V.g(0.6);
    const sl = V.nz('slow', x, x + len, 1.5);
    [[1, 0, 60], [1.498, 30, -80]].forEach(([r, dc, w]) => {
      const os = V.osc('sawtooth', f * r, x, x + len);
      V.env(os.detune, [[x, dc], [x + len, dc + bend * 100]]);
      const sg = V.g(w); sl.connect(sg); sg.connect(os.detune);
      os.connect(mix);
    });
    [[o.r1 || 180, 5, 1.3], [o.r2 || 330, 7, 0.9]].forEach(([fr, q, a]) => {
      const bp = V.f('bandpass', fr, q), g = V.g(a * 2.2); mix.connect(bp); bp.connect(g); g.connect(out);
    });
    const lp = V.f('lowpass', 260, 0), lg = V.g(0.5); mix.connect(lp); lp.connect(lg); lg.connect(out);
    const am = V.nz('rough', x, x + len, 0.6), amg = V.g(0.5), ag = V.g(0.6);
    am.connect(amg); amg.connect(ag.gain); out.connect(ag);
    ag.connect(panned(V, pan, dest));
  }
  // stick-slip creak (rope, wood, steel): a pulse train through resonances
  function creak(V, x, len, rate, lvl, pan, res, dest) {
    if (x + len <= V.off) return;
    const os = V.osc('sawtooth', rate, x, x + len);
    V.env(os.frequency, [[x, rate], [x + len * 0.45, rate * 1.7], [x + len, rate * 0.8]]);
    const j = V.nz('jit', x, x + len, 2), jg = V.g(rate * 0.35); j.connect(jg); jg.connect(os.frequency);
    const g = V.g(0);
    V.env(g.gain, [[x, 0], [x + 0.03, lvl], [x + len * 0.75, lvl * 0.7], [x + len, 0]]);
    const b1 = V.f('bandpass', res, 6), b2 = V.f('bandpass', res * 2.3, 5), g2 = V.g(0.5), hp = V.f('highpass', 250, 0);
    os.connect(hp); hp.connect(b1); hp.connect(b2); b1.connect(g); b2.connect(g2); g2.connect(g);
    outTo(V, g, pan, dest);
  }
  // a single bubble: sine chirping upward as it forms
  function bubble(V, x, f, lvl, pan, len, dest) {
    tone(V, x, { f0: f, f1: f * (1.5 + 0.6 * ((f * 7) % 1)), glide: len, lvl, a: 0.002, d: len, pan }, dest);
  }
  // objects crashing: a thud and a scatter of bright fragments
  function clatter(V, x, lvl, pan, seed, dest) {
    if (x + 0.6 <= V.off) return;
    const r = U.rng(seed), o = panned(V, pan, dest);
    tone(V, x, { f0: 90 + 60 * r(), f1: 55, glide: 0.1, lvl: lvl * 0.7, a: 0.003, d: 0.25 }, o);
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      burst(V, x + r() * 0.3 * i / n + 0.01 * i, { kind: 'white', type: 'bandpass', f: 700 + r() * 3000, q: 1.5 + r() * 4, lvl: lvl * (0.35 + 0.6 * r()), a: 0.001, d: 0.05 + 0.14 * r() }, o);
    }
  }
  // struck bell: inharmonic partials
  function bellStrike(V, x, f0, lvl, pan, parts, dest) {
    for (const [r, a, tau] of parts) {
      tone(V, x, { f0: f0 * r, lvl: lvl * a, a: 0.0015, d: tau * 6.9, pan }, dest);
    }
    burst(V, x, { kind: 'white', type: 'bandpass', f: 4200, q: 1.2, lvl: lvl * 0.5, a: 0.0008, d: 0.012, pan }, dest);
  }
  const SHIPBELL = [[0.5, 0.2, 1.1], [1, 0.8, 0.95], [1.183, 0.45, 0.65], [1.506, 0.32, 0.55], [2.0, 0.55, 0.45], [2.514, 0.22, 0.32], [2.662, 0.18, 0.28], [3.011, 0.15, 0.22], [4.166, 0.1, 0.14], [5.433, 0.06, 0.1]];

  // ------------------------------------------------------------------
  // Beds (continuous layers). Their gains follow pure functions of story time.
  // ------------------------------------------------------------------
  const fadeIn0 = (t) => sstep(0.3, 7, t);
  function bedOcean(V, c) {
    const end = c.dur;
    // flat calm; the sea grows as the ship settles, then steps back for the band (158-190)
    const lvl = (t) => fadeIn0(t) * (t < 74 ? 0.5 : t < 92 ? lerp(0.5, 1, (t - 74) / 18) : t < 222 ? lerp(1, 0.72, sstep(155, 159, t)) : lerp(0.72, 0.5, clamp((t - 222) / 10))) * (1 - sstep(238.6, 239.9, t));
    const lap = (t) => clamp(0.3 + 0.45 * noise1(t * 0.83, 11) + 0.25 * noise1(t * 2.1, 12) + 0.2 * noise1(t * 0.29, 13), 0.03, 1.3);
    const n1 = V.nz('pink', 0, end), g1 = V.g(0);
    V.chain(n1, V.f('highpass', 160, 0), V.f('bandpass', 620, 0.6), g1); g1.connect(V.out);
    V.curve(g1.gain, 0, end, (t) => dB(-16) * lvl(t) * lap(t));
    const n2 = V.nz('white', 0, end, 0.9), g2 = V.g(0);
    V.chain(n2, V.f('bandpass', 1900, 0.9), g2); outTo(V, g2, 0.2);
    V.curve(g2.gain, 0, end, (t) => dB(-28) * lvl(t) * Math.max(0, lap(t + 0.35) - 0.45) * 2);
    const n3 = V.nz('brown', 0, end), g3 = V.g(0);
    V.chain(n3, V.f('lowpass', 260, 0), g3); g3.connect(V.out);
    V.curve(g3.gain, 0, end, (t) => dB(-19) * lvl(t) * (0.7 + 0.3 * noise1(t * 0.13, 14)));
  }
  function bedEngine(V, c) {
    const end = c.dur;
    const rev = (t) => Math.abs(TR.prop(t));
    const lvl = (t) => sstep(9, 21, t) * Math.pow(clamp(rev(t) / 1.25), 0.7) * (1 - sstep(84.5, 87, t)) * (1 + 0.25 * U.envelope(t, 70.5, 84, 1, 2));
    const pulse = wave(V.A, 'pulse', [1, 0.65, 0.4, 0.22, 0.12]);
    const lfo = V.osc(pulse, 2.5, 0, end);
    V.curve(lfo.frequency, 0, end, (t) => Math.max(0.3, 2 * rev(t)), 10);
    const am = V.g(0.5), lg = V.g(0.3); lfo.connect(lg); lg.connect(am.gain);
    const lv = V.g(0); am.connect(lv); lv.connect(V.out);
    V.curve(lv.gain, 0, end, (t) => dB(-27) * lvl(t));
    [[41, 0.9], [82, 0.35], [123, 0.1]].forEach(([f, a]) => { const o = V.osc('sine', f, 0, end), g = V.g(a); o.connect(g); g.connect(am); });
    const mech = V.nz('brown', 0, end), mg = V.g(1.2); V.chain(mech, V.f('bandpass', 95, 1.2), mg, am);
    const chug = V.nz('pink', 0, end), cg = V.g(0.28); V.chain(chug, V.f('bandpass', 420, 2), cg, am);
    // low-pressure turbine whine: spins down after the astern order
    const turb = (t) => (t < EV.engineAstern ? 1 : Math.max(0, 1 - (t - EV.engineAstern) / 9));
    const tg = V.g(0); tg.connect(V.out);
    V.curve(tg.gain, 0, end, (t) => dB(-48) * sstep(9, 21, t) * turb(t));
    [[1, 1], [2, 0.35], [3.02, 0.12]].forEach(([h, a]) => {
      const o = V.osc('sine', 186 * h, 0, end), g = V.g(a);
      V.curve(o.frequency, 0, end, (t) => 186 * h * Math.max(0.15, turb(t)), 10);
      o.connect(g); g.connect(tg);
    });
  }
  function bedWake(V, c) {
    const end = c.dur;
    const sp = (t) => Math.pow(clamp(TR.speed(t) / 11.6), 2);
    const n = V.nz('pink', 0, end), g = V.g(0);
    V.chain(n, V.f('highpass', 220, 0), V.f('lowpass', 2600, 0), V.f('peaking', 800, 0.8, 3), g); g.connect(V.out);
    V.curve(g.gain, 0, end, (t) => dB(-19) * sstep(6, 19, t) * sp(t) * (1 + 0.18 * noise1(t * 0.45, 21)));
    const n2 = V.nz('white', 0, end), g2 = V.g(0);
    V.chain(n2, V.f('bandpass', 3400, 0.7), g2); outTo(V, g2, 0.35);
    V.curve(g2.gain, 0, end, (t) => dB(-33) * sstep(6, 19, t) * sp(t) * sp(t) * (1 + 0.3 * noise1(t * 1.3, 22)));
  }
  // Safety valves lifting: a deafening roar, then fading.
  function bedSteam(V, c) {
    const end = c.dur;
    // wide shot: loud; close on the valves: deafening; then pulled back and fading well under the
    // cello's D-minor theme (104-117.6)
    const lvl = (t) => { const sp = spans().steam; return TR.steam(t) * (t < sp[1] ? lerp(0.7, 1, inSpan(t, sp)) : lerp(1, 0.25, sstep(sp[1] - 0.2, sp[1] + 2.2, t))); };
    const n = V.nz('white', 0, end), g = V.g(0);
    const am = V.g(0.8), m = V.nz('rough', 0, end, 0.5), mg = V.g(0.2); m.connect(mg); mg.connect(am.gain);
    V.chain(n, V.f('lowpass', 7000, 0), V.f('peaking', 2200, 0.8, 6), V.f('peaking', 4500, 1, 3), V.f('peaking', 640, 1.2, -9), am, g);
    g.connect(V.out);
    V.curve(g.gain, 0, end, (t) => dB(-9.5) * lvl(t));
    const r = V.nz('brown', 0, end), rg = V.g(0);
    V.chain(r, V.f('lowpass', 180, 0), rg); rg.connect(V.out);
    V.curve(rg.gain, 0, end, (t) => dB(-11) * lvl(t));
    [[1850, 14, -4, -0.3], [3100, 12, -8, 0.3]].forEach(([f, q, d, p], i) => {
      const hn = V.nz('white', 0, end), bp = V.f('bandpass', f, q), hg = V.g(0);
      const w = V.nz('slow', 0, end, 0.6 + i * 0.3), wg = V.g(45); w.connect(wg); wg.connect(bp.frequency);
      V.chain(hn, bp, hg); outTo(V, hg, p);
      V.curve(hg.gain, 0, end, (t) => dB(d - 0.5) * lvl(t));
    });
    burst(V, 0, { kind: 'white', type: 'lowpass', f: 5000, q: 0, lvl: dB(-6), a: 0.01, d: 0.8 });
    boom(V, 0, dB(-10), { f0: 70, f1: 40, tau: 0.4 });
  }

  // ------------------------------------------------------------------
  // Event sounds
  // ------------------------------------------------------------------
  // The collision: grinding scrape along the starboard bow (continuous layers only; the
  // impacts, shudders, rivets, ice and groans are separate cues so seeking lands cleanly).
  function cCollision(V, c) {
    const end = c.dur;
    const E = (pts) => pts;
    const rum = V.nz('brown', 0, end), rg = V.g(0), am1 = V.g(0.6), m1 = V.nz('rough', 0, end, 0.35), mg1 = V.g(0.5);
    m1.connect(mg1); mg1.connect(am1.gain);
    V.chain(rum, V.f('lowpass', 170, 0), am1, rg); rg.connect(V.out);
    V.env(rg.gain, E([[0, 0], [0.25, dB(-5)], [5.5, dB(-7)], [8, dB(-12)], [9.4, 0.0001, 'x'], [end, 0]]));
    // grinding: stick-slip friction of steel on ice
    const gr = V.nz('white', 0, end), am2 = V.g(0.25), m2 = V.nz('rough', 0, end, 1.1), mg2 = V.g(0.9), grg = V.g(0);
    m2.connect(mg2); mg2.connect(am2.gain);
    gr.connect(am2);
    [[190, 4, 1], [430, 5, 0.8], [1100, 3, 0.5], [2600, 2.5, 0.25]].forEach(([f, q, a]) => { const bp = V.f('bandpass', f, q), g = V.g(a * 3); am2.connect(bp); bp.connect(g); g.connect(grg); });
    outTo(V, grg, 0.3);
    V.env(grg.gain, E([[0, 0], [0.3, dB(0)], [3, dB(-1)], [6.5, dB(-3)], [8.6, dB(-10)], [9.5, 0.0001, 'x'], [end, 0]]));
    // plates screeching: low saws wandering in pitch
    const sc = V.g(0); outTo(V, sc, 0.15);
    V.env(sc.gain, E([[0, 0], [0.6, dB(-16)], [4, dB(-13)], [7, dB(-18)], [9, 0.0001, 'x'], [end, 0]]));
    [[96, 0], [143, 1], [201, 2]].forEach(([f, i]) => {
      const o = V.osc('sawtooth', f, 0, end), s = V.nz('slow', 0, end, 1.2 + i * 0.5), sg = V.g(90 + 40 * i);
      s.connect(sg); sg.connect(o.detune);
      const bp = V.f('bandpass', 620 + 300 * i, 2.5); o.connect(bp); bp.connect(sc);
    });
    // ice rattling onto the forward well deck
    const ice = V.nz('white', 0, end), ia = V.g(0.2), im = V.nz('rough', 0, end, 2.3), img = V.g(1), ig = V.g(0);
    im.connect(img); img.connect(ia.gain);
    V.chain(ice, V.f('highpass', 1400, 0), V.f('peaking', 3200, 1, 4), ia, ig); outTo(V, ig, -0.2);
    V.env(ig.gain, E([[0, 0], [1.2, 0], [2.2, dB(-12)], [5.3, dB(-10)], [8.8, dB(-9)], [9.8, 0.0001, 'x'], [end, 0]]));
  }

  // Marconi spark transmitter: a raspy rotary-spark note keyed exactly on the Morse timings,
  // with the heavy key's clicks. Pitched on D5 (587.3 Hz) so it sits in the score's key.
  function cMorse(V, c) {
    const m = c.p.m, tones = m.timing.tones, end = c.dur;
    const f = 587.33;
    const o1 = V.osc('sawtooth', f, 0, end), o2 = V.osc('square', f * 2.003, 0, end), g2 = V.g(0.22);
    o2.connect(g2);
    const nz = V.nz('white', 0, end), nbp = V.f('bandpass', 2600, 0.7), rm = V.g(0), rg = V.g(0.5);
    o1.connect(rg); rg.connect(rm.gain); V.chain(nz, nbp, rm);
    const mix = V.g(0.8); o1.connect(mix); g2.connect(mix); rm.connect(mix);
    const sh = A_shaper(V.ac);
    const gate = V.g(0), lvl = V.g(dB(-22));
    V.chain(mix, sh, V.f('bandpass', 950, 0.9), V.f('highpass', 320, 0), gate, lvl); outTo(V, lvl, -0.1);
    const cs = V.cst(1, 0, end), cg = V.g(0);
    cs.connect(cg);
    const clk = V.g(dB(-12)); V.chain(cg, V.f('highpass', 1800, 0), V.f('bandpass', 3300, 3), clk); outTo(V, clk, -0.1);
    const keyOn = [gate.gain, cg.gain];
    for (const p of keyOn) p.setValueAtTime(0, V.when);
    for (const tn of tones) {
      const x = tn.t - c.t, x1 = x + tn.d;
      if (x1 <= V.off) continue;
      const a = V.T(Math.max(x, V.off)), b = V.T(x1);
      for (const p of keyOn) {
        p.setValueAtTime(0, Math.max(V.when, a - 0.003)); p.linearRampToValueAtTime(1, a + 0.002);
        p.setValueAtTime(1, b - 0.002); p.linearRampToValueAtTime(0, b + 0.003);
      }
    }
  }
  let _shaperCurve = null;
  function A_shaper(ac) {
    const w = ac.createWaveShaper();
    if (!_shaperCurve) { _shaperCurve = new Float32Array(1025); for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; _shaperCurve[i] = Math.tanh(2.6 * x) / Math.tanh(2.6); } }
    w.curve = _shaperCurve;
    return w;
  }

  // Distress rocket: mortar thump + rising whoosh; burst: sharp report, crackling stars,
  // echoes rolling back off the sea.
  function sRocketLaunch(V, c) {
    boom(V, 0, dB(-12), { f0: 95, f1: 45, tau: 0.22, noise: 0.8 });
    burst(V, 0, { kind: 'white', type: 'bandpass', f: 1300, q: 0.7, lvl: dB(-12), a: 0.002, d: 0.16, pan: 0.2 });
    const n = V.nz('white', 0, 2.5), bp = V.f('bandpass', 700, 1.3), g = V.g(0), p = V.pan(0.15);
    V.env(bp.frequency, [[0.05, 700], [2.3, 3400, 'x']]);
    V.env(g.gain, [[0, 0], [0.09, dB(-10)], [0.7, dB(-14)], [2.3, dB(-26)], [2.45, 0]]);
    V.env(p.pan, [[0, 0.15], [2.3, 0.3]]);
    V.chain(n, bp, g, p); p.connect(V.out);
    const fz = V.nz('crackle', 0.05, 2.3, 1.7), fg = V.g(0); V.chain(fz, V.f('highpass', 3000, 0), fg); outTo(V, fg, 0.2);
    V.env(fg.gain, [[0.05, 0], [0.2, dB(-10)], [2.3, dB(-22)]]);
  }
  function sRocketBurst(V, c) {
    burst(V, 0, { kind: 'white', type: 'highpass', f: 500, q: 0, lvl: dB(-2), a: 0.0008, d: 0.08 });
    boom(V, 0, dB(-6), { f0: 75, f1: 36, tau: 0.45, noise: 1.2, nf: 350 });
    burst(V, 0.002, { kind: 'pink', type: 'lowpass', f: 1600, q: 0, lvl: dB(-7), a: 0.003, d: 0.9 });
    [[-0.5, 1.9], [0.45, 2.3]].forEach(([p, r]) => {
      const cz = V.nz('crackle', 0.06, 2.8, r), g = V.g(0);
      V.chain(cz, V.f('highpass', 1700, 0), g); outTo(V, g, p);
      V.env(g.gain, [[0.06, 0], [0.18, dB(-6)], [1.6, dB(-16)], [2.8, 0.0001, 'x']]);
    });
    [[0.46, -9, 2000], [1.08, -15, 1300], [1.95, -21, 800]].forEach(([dx, l, f]) => {
      burst(V, dx, { kind: 'white', type: 'lowpass', f, q: 0, lvl: dB(l), a: 0.004, d: 0.25 });
      boom(V, dx, dB(l - 3), { f0: 60, f1: 34, tau: 0.35 });
    });
    burst(V, 0.05, { kind: 'brown', type: 'lowpass', f: 300, q: 0, lvl: dB(-8), a: 0.25, d: 3.2 });
  }

  // Crow's-nest bell, bridge telephone, helm and engine telegraph
  function sCrowBell(V, c) { bellStrike(V, 0, 1040, dB(-16), -0.15, SHIPBELL); }
  function sPhone(V, c) {
    const rings = [[0, 1.0], [1.35, 0.8]];
    for (const [x0, len] of rings) {
      [[1450, 0], [1630, 1 / 34]].forEach(([f, ph]) => {
        const out = V.g(0); outTo(V, out, 0.1);
        [[1, 1], [2.71, 0.35], [5.1, 0.12]].forEach(([r, a]) => { const o = V.osc('sine', f * r, x0, x0 + len + 0.4), g = V.g(a); o.connect(g); g.connect(out); });
        const pts = [[x0, 0]];
        for (let x = x0 + ph; x < x0 + len; x += 1 / 17) pts.push([x, 0.0001, 's'], [x + 0.001, dB(-18)], [x + 1 / 17 - 0.002, dB(-32), 'x']);
        pts.push([x0 + len + 0.3, 0.0001, 'x']);
        V.env(out.gain, pts);
      });
    }
    burst(V, 2.9, { kind: 'white', type: 'bandpass', f: 1800, q: 2, lvl: dB(-22), a: 0.001, d: 0.05, pan: 0.1 });
    burst(V, 2.95, { kind: 'pink', type: 'bandpass', f: 400, q: 1, lvl: dB(-24), a: 0.002, d: 0.08, pan: 0.1 });
  }
  function sHelm(V, c) {
    // the quartermaster spins the wheel hard over: ratcheting telemotor
    for (let i = 0, x = 0; i < 26; i++) { burst(V, x, { kind: 'white', type: 'bandpass', f: 2300 + 400 * ((i * 7) % 3), q: 3, lvl: dB(-24 - (i % 3) * 2), a: 0.0008, d: 0.025, pan: -0.1 }); x += 0.045 + i * 0.004; }
    tone(V, 0.05, { f0: 110, f1: 80, lvl: dB(-26), a: 0.01, d: 0.4 });
  }
  function sTelegraph(V, c) {
    // "Full astern": the handle is swung round and back, the telegraph gong rings, the engine room answers
    const clank = (x) => { burst(V, x, { kind: 'white', type: 'bandpass', f: 1500, q: 2.5, lvl: dB(-18), a: 0.001, d: 0.06, pan: 0.05 }); tone(V, x, { f0: 420, f1: 380, lvl: dB(-26), a: 0.001, d: 0.12, pan: 0.05 }); };
    const PART = [[1, 1, 0.35], [2.76, 0.5, 0.2], [5.4, 0.25, 0.1]];
    [0, 0.12, 0.62, 0.74].forEach(clank);
    [0.18, 0.3, 0.42, 0.8, 0.92, 1.04].forEach((x) => bellStrike(V, x, 1860, dB(-19), 0.05, PART));
    [1.9, 2.05, 2.2].forEach((x) => bellStrike(V, x, 1420, dB(-30), 0.05, PART));
  }

  // Lifeboat lowered from the davits: falls creaking through the blocks, the boat
  // knocking the hull, then the splash as she takes the water.
  function cDavit(V, c) {
    const b = c.p.b, side = C.SHIP.BOAT_SLOTS[b.slot] ? C.SHIP.BOAT_SLOTS[b.slot].side : 1;
    const r = U.rng(b.slot * 131 + 7), pan = side * 0.38, len = b.lowerT1 - b.lowerT0;
    for (let x = 0.2 + r() * 0.3; x < len - 0.2; x += 0.45 + r() * 0.8) {
      creak(V, x, 0.14 + r() * 0.3, 18 + r() * 26, dB(-26 - r() * 6), pan + (r() - 0.5) * 0.1, 800 + r() * 900);
      if (r() < 0.25) tone(V, x + 0.05, { f0: 1500 + r() * 900, f1: 1300 + r() * 600, lvl: dB(-40), a: 0.03, d: 0.18, pan });
    }
    [0.3 + r() * 2, 3 + r() * 2.5].forEach((x) => {
      tone(V, x, { f0: 120 + r() * 40, f1: 90, lvl: dB(-26), a: 0.003, d: 0.18, pan });
      burst(V, x, { kind: 'pink', type: 'bandpass', f: 420, q: 1, lvl: dB(-26), a: 0.002, d: 0.1, pan });
    });
  }
  function sBoatSplash(V, c) {
    const side = C.SHIP.BOAT_SLOTS[c.p.b.slot] ? C.SHIP.BOAT_SLOTS[c.p.b.slot].side : 1;
    splash(V, 0, 0.45, dB(-17), side * 0.4);
  }
  function sGroan(V, c) { groan(V, 0, c.dur, c.p.f, c.p.lvl, c.p.pan, c.p); }
  function sCreak(V, c) { creak(V, 0, c.dur, c.p.rate, c.p.lvl, c.p.pan, c.p.res); }
  function sBoom(V, c) { boom(V, 0, c.p.lvl, c.p); }
  function sCrack(V, c) { crack(V, 0, c.p.lvl, c.p.pan, c.p.f); }
  function sClatter(V, c) { clatter(V, 0, c.p.lvl, c.p.pan, c.p.seed); }
  function sSplash(V, c) { splash(V, 0, c.p.size, c.p.lvl, c.p.pan || 0); }
  function sBubble(V, c) { bubble(V, 0, c.p.f, c.p.lvl, c.p.pan, c.p.len); }
  function sIce(V, c) {
    const p = c.p, o = panned(V, p.pan), l = p.lvl * 2.4;
    burst(V, 0, { kind: 'white', type: 'bandpass', f: p.f, q: 0.9, lvl: l, a: 0.002, d: p.d }, o);
    burst(V, 0.004, { kind: 'white', type: 'highpass', f: 2600, q: 0, lvl: l * 0.7, a: 0.001, d: 0.03 + p.d * 0.25 }, o);
    tone(V, 0, { f0: 80 + p.f * 0.02, f1: 50, lvl: l * 0.35, a: 0.003, d: 0.14 }, o);
    if (p.d > 0.25) burst(V, 0.05 + p.d * 0.3, { kind: 'white', type: 'bandpass', f: p.f * 1.6, q: 1.4, lvl: l * 0.5, a: 0.001, d: p.d * 0.6 }, o);
  }
  function sPlip(V, c) { tone(V, 0, { f0: c.p.f, f1: c.p.f * 1.6, glide: 0.05, lvl: c.p.lvl, a: 0.001, d: 0.06, pan: c.p.pan }); }
  // The hull strikes the ice: a colossal metallic crunch — the mid-range weight the sub boom lacks.
  function sImpact(V, c) {
    const o = panned(V, 0.25);
    burst(V, 0, { kind: 'white', type: 'bandpass', f: 1700, f1: 650, q: 0.7, lvl: dB(-1), a: 0.0015, d: 0.45 }, o);
    burst(V, 0.008, { kind: 'pink', type: 'bandpass', f: 480, q: 0.8, lvl: dB(0), a: 0.004, d: 0.85 }, o);
    // struck plating: inharmonic partials sagging in pitch
    [[93, 1, 1.5], [157, 0.75, 1.15], [226, 0.6, 0.85], [307, 0.45, 0.65], [461, 0.32, 0.45], [619, 0.22, 0.32], [877, 0.14, 0.22]]
      .forEach(([f, a, d]) => tone(V, 0.004, { type: 'triangle', f0: f * 1.05, f1: f, glide: 0.25, lvl: dB(-9) * a, a: 0.002, d }, o));
    crack(V, 0.02, dB(-4), 0.3, 2600);
    crack(V, 0.09, dB(-8), 0.1, 3400);
  }

  // Funnel 1 collapses: stays snap and shriek, the base tears, it falls and hits the sea.
  function cFunnel(V, c) {
    const T0 = 0, TS = EV.funnel1Splash - EV.funnel1Fall;
    [0, 0.38, 0.8, 1.35].forEach((x, i) => {
      tone(V, x, { f0: 1500 - i * 180, f1: 900 - i * 100, glide: 0.25, lvl: dB(-14), a: 0.001, d: 0.5, pan: 0.3 - i * 0.1 });
      burst(V, x, { kind: 'white', type: 'bandpass', f: 2600, f1: 700, q: 1.5, lvl: dB(-12), a: 0.001, d: 0.45, pan: 0.3 - i * 0.1 });
    });
    // shriek of tearing steel at the funnel base
    const sh = V.g(0); outTo(V, sh, 0.2);
    V.env(sh.gain, [[T0, 0], [0.5, dB(-18)], [1.6, dB(-12)], [2.6, dB(-16)], [3.2, 0.0001, 'x']]);
    [[520, 0], [690, 1], [880, 2]].forEach(([f, i]) => {
      const o = V.osc('sawtooth', f, 0, 3.3), s = V.nz('jit', 0, 3.3, 0.7 + i * 0.3), sg = V.g(60);
      V.env(o.detune, [[0, 0], [3.2, -900 - 200 * i]]);
      s.connect(sg); sg.connect(o.detune);
      const bp = V.f('bandpass', 1200 + 500 * i, 4); o.connect(bp); bp.connect(sh);
    });
    groan(V, 0.2, 3.0, 52, dB(-8), 0.1, { bend: -4 });
    // it falls: air rushing past
    burst(V, TS - 1.4, { kind: 'pink', type: 'bandpass', f: 400, f1: 1400, q: 0.6, lvl: dB(-16), a: 1.3, d: 0.2 });
    // the splash
    splash(V, TS, 1.25, dB(-2), 0.15);
    boom(V, TS, dB(-5), { f0: 55, f1: 28, tau: 0.9 });
  }

  // The lights fail: arcing buzz and pops as they flicker, dynamos dying.
  let LIGHTS = null;
  function lightsCurve() {
    if (LIGHTS) return LIGHTS;
    const st = STORY.makeState(), t0 = EV.lightsFlicker - 0.5, n = Math.ceil((EV.lightsGone + 1 - t0) / 0.02);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) { STORY.sample(t0 + i * 0.02, st); a[i] = st.ship.lights; }
    return (LIGHTS = { t0, a, at(t) { const i = clamp(Math.round((t - t0) / 0.02), 0, n - 1); return a[i]; } });
  }
  function cElectric(V, c) {
    const L = lightsCurve(), end = c.dur;
    const act = (t) => { const l = L.at(t), d = Math.abs(l - L.at(t - 0.04)); return clamp(d * 4 + (l > 0.05 && l < 0.7 ? 0.25 : 0.06) + (t > EV.lightsBlink && t < EV.lightsGone ? 0.45 : 0)); };
    const bz = V.g(0); outTo(V, bz, 0.1);
    V.curve(bz.gain, 0, end, (t) => dB(-17) * act(t), 50);
    const o1 = V.osc('sawtooth', 100, 0, end), o2 = V.osc('square', 200.5, 0, end), g2 = V.g(0.3);
    o2.connect(g2);
    const bp = V.f('bandpass', 1400, 0.8), hp = V.f('highpass', 260, 0);
    o1.connect(bp); g2.connect(bp); V.chain(bp, hp, bz);
    const hum = V.g(0); hum.connect(V.out);
    V.curve(hum.gain, 0, end, (t) => dB(-26) * clamp(L.at(t) * 1.2 + (t < EV.lightsGone + 1.3 ? 0.15 : 0)) * (1 - sstep(EV.lightsGone + 0.6, EV.lightsGone + 1.4, t)), 50);
    const hf = (t) => 100 * (t < EV.lightsOut ? 1 : t < EV.lightsBlink ? lerp(1, 0.55, (t - EV.lightsOut) / 0.4) : t < EV.lightsGone ? 0.75 : lerp(0.75, 0.2, clamp((t - EV.lightsGone) / 1.3)));
    [[1, 1], [2, 0.4], [3, 0.2]].forEach(([h, a]) => {
      const o = V.osc(h === 1 ? 'sine' : 'triangle', 100 * h, 0, end), g = V.g(a);
      V.curve(o.frequency, 0, end, (t) => hf(t) * h, 50);
      o.connect(g); g.connect(hum);
    });
  }
  function sPop(V, c) {
    burst(V, 0, { kind: 'white', type: 'highpass', f: 1500, q: 0, lvl: c.p.lvl, a: 0.0005, d: 0.03, pan: c.p.pan });
    const cz = V.nz('crackle', 0, 0.25, 2.5), g = V.g(0); V.chain(cz, V.f('highpass', 2000, 0), g); outTo(V, g, c.p.pan);
    V.env(g.gain, [[0, 0], [0.005, c.p.lvl * 0.8], [0.22, 0.0001, 'x']]);
  }

  // The break-up: colossal tearing steel.
  function cBreak(V, c) {
    const end = c.dur, x = (t) => t - c.t;
    const dest = V.out; V.out = V.g(dB(-1.5)); V.out.connect(dest);   // mix trim: leave room for the chorale
    const tear = V.nz('white', 0, end), am = V.g(0.3), m = V.nz('rough', 0, end, 1.3), mg = V.g(1.1), tg = V.g(0);
    m.connect(mg); mg.connect(am.gain); tear.connect(am);
    [[620, 300, 3], [1500, 850, 3.5], [3000, 2000, 2.5]].forEach(([f0, f1, q], i) => {
      const bp = V.f('bandpass', f0, q), g = V.g((2.4 - i * 0.5) * (i ? 2.2 : 1.3));
      V.env(bp.frequency, [[0, f0], [x(EV.breakApart), f0 * 0.8], [x(EV.breakDone), f1, 'x']]);
      am.connect(bp); bp.connect(g); g.connect(tg);
    });
    outTo(V, tg, 0.1);
    V.env(tg.gain, [[0, 0], [0.3, dB(-12)], [x(EV.breakApart) - 0.3, dB(-8)], [x(EV.breakApart), dB(-4)], [x(EV.breakApart) + 1.5, dB(-10)], [x(EV.breakDone), dB(-17)], [x(EV.breakDone) + 1.2, 0.0001, 'x'], [end, 0]]);
    const gr = V.g(0); gr.connect(V.out);
    V.env(gr.gain, [[0, 0], [1, dB(-9)], [x(EV.breakApart), dB(-6)], [x(EV.breakDone), dB(-13)], [x(EV.breakDone) + 1.5, 0.0001, 'x'], [end, 0]]);
    [[32, 0], [47, 1], [23, 2]].forEach(([f, i]) => {
      const o = V.osc('sawtooth', f, 0, end), s = V.nz('slow', 0, end, 1 + i * 0.4), sg = V.g(70);
      V.env(o.detune, [[0, 0], [x(EV.breakDone), -500]]);
      s.connect(sg); sg.connect(o.detune);
      const lp = V.f('lowpass', 420, 2); o.connect(lp); lp.connect(gr);
    });
    // plates and frames shrieking as they tear
    const sh = V.g(0); outTo(V, sh, -0.15);
    V.env(sh.gain, [[0, 0], [0.8, dB(-20)], [x(EV.breakApart) - 0.2, dB(-13)], [x(EV.breakApart) + 0.4, dB(-10)], [x(EV.breakDone), dB(-20)], [x(EV.breakDone) + 1, 0.0001, 'x'], [end, 0]]);
    [[430, 0.4], [610, 1.3], [880, 2.1], [1270, 0.9]].forEach(([f, ph], i) => {
      const o = V.osc('sawtooth', f, 0, end), j = V.nz('jit', 0, end, 0.5 + i * 0.35), jg = V.g(70 + 30 * i);
      V.env(o.detune, [[0, 0], [ph, 250], [x(EV.breakApart), -300 - 150 * i], [x(EV.breakDone), -1100]]);
      j.connect(jg); jg.connect(o.detune);
      const bp = V.f('bandpass', 1100 + 700 * i, 5); o.connect(bp); bp.connect(sh);
    });
    const rb = V.nz('brown', 0, end), rbg = V.g(0); V.chain(rb, V.f('lowpass', 110, 0), rbg); rbg.connect(V.out);
    V.env(rbg.gain, [[0, 0], [0.5, dB(-6)], [x(EV.breakDone) + 1, dB(-9)], [end, 0.0001, 'x']]);
    // water pouring into the torn hull
    const w = V.nz('pink', 0, end), wg = V.g(0); V.chain(w, V.f('lowpass', 1300, 0), wg); outTo(V, wg, -0.15);
    V.env(wg.gain, [[0, 0], [x(EV.breakApart), 0.0001], [x(EV.breakApart) + 1, dB(-9)], [x(EV.sternSplash) - 0.5, dB(-11)], [end, 0.0001, 'x']]);
  }
  // The stern rises: rumble of everything inside falling, water streaming off the decks.
  function cRise(V, c) {
    const end = c.dur, x = (t) => t - c.t;
    const rum = V.nz('brown', 0, end), am = V.g(0.5), m = V.nz('rough', 0, end, 0.4), mg = V.g(0.6), rg = V.g(0);
    m.connect(mg); mg.connect(am.gain); V.chain(rum, V.f('lowpass', 260, 0), am, rg); rg.connect(V.out);
    V.env(rg.gain, [[0, 0], [2, dB(-9)], [x(EV.sternVertical) - 1, dB(-3)], [x(EV.sternPlunge), dB(-6)], [end, 0.0001, 'x']]);
    const cl = V.nz('white', 0, end), ca = V.g(0.1), cm = V.nz('rough', 0, end, 1.7), cmg = V.g(1), cg = V.g(0);
    cm.connect(cmg); cmg.connect(ca.gain); V.chain(cl, V.f('bandpass', 1500, 0.6), ca, cg); outTo(V, cg, -0.1);
    V.env(cg.gain, [[0, 0], [3, dB(-18)], [x(EV.sternVertical), dB(-11)], [x(EV.sternPlunge) + 1, dB(-16)], [end, 0.0001, 'x']]);
    const wf = V.nz('pink', 0, end), wg = V.g(0); V.chain(wf, V.f('highpass', 380, 0), V.f('lowpass', 4200, 0), wg); outTo(V, wg, 0.2);
    V.env(wg.gain, [[0, 0], [1.5, dB(-12)], [x(EV.sternVertical) - 2, dB(-14)], [x(EV.sternVertical) + 1, dB(-24)], [end, 0.0001, 'x']]);
  }
  // The final plunge: rushing water, the vortex, and a last gulp of air.
  function cPlunge(V, c) {
    const end = c.dur, x = (t) => t - c.t, xg = x(EV.sternGone);
    const r = V.nz('pink', 0, end), lp = V.f('lowpass', 800, 0), g = V.g(0);
    V.env(lp.frequency, [[0, 800], [xg - 1, 3200, 'x'], [xg + 1.5, 500, 'x']]);
    V.chain(r, lp, g); g.connect(V.out);
    V.env(g.gain, [[0, 0], [1.5, dB(-12)], [xg - 1.2, dB(-3)], [xg + 0.2, dB(-4)], [xg + 2.2, dB(-26)], [end, 0.0001, 'x']]);
    const v = V.nz('brown', 0, end), vg = V.g(0); V.chain(v, V.f('lowpass', 140, 0), vg); vg.connect(V.out);
    V.env(vg.gain, [[0, 0], [2, dB(-6)], [xg, dB(-1)], [xg + 3, dB(-18)], [end, 0.0001, 'x']]);
    burst(V, xg - 0.3, { kind: 'pink', type: 'bandpass', f: 1600, f1: 180, q: 0.8, lvl: dB(-4), a: 0.25, d: 1.1 });
    boom(V, xg, dB(-6), { f0: 48, f1: 26, tau: 1.0 });
    splash(V, xg + 0.1, 1.0, dB(-6), 0);
  }

  // ------------------------------------------------------------------
  // The deep
  // ------------------------------------------------------------------
  function bedUnder(V, c) {
    const end = c.dur;
    const lv = (t) => sstep(EV.underwater, EV.underwater + 0.6, t) * (t < EV.abyss ? dB(-19) : t < EV.seabedImpact ? dB(-16) : dB(-20)) * (1 - sstep(EV.dawn - 0.4, EV.dawn - 0.05, t));
    const n = V.nz('brown', 0, end), g = V.g(0);
    V.chain(n, V.f('lowpass', 75, 0), g); g.connect(V.out);
    V.curve(g.gain, 0, end, lv);
    const s = V.osc('sine', 27, 0, end), sa = V.g(0.5), sl = V.osc('sine', 0.11, 0, end), slg = V.g(0.5), sg = V.g(0);
    sl.connect(slg); slg.connect(sa.gain); s.connect(sa); sa.connect(sg); sg.connect(V.out);
    V.curve(sg.gain, 0, end, (t) => lv(t) * 0.6);
    const hi = V.nz('pink', 0, end), hg = V.g(0); V.chain(hi, V.f('bandpass', 380, 0.5), hg); hg.connect(V.out);
    V.curve(hg.gain, 0, end, (t) => lv(t) * dB(-18) * (t < EV.abyss ? 1 : 0.4));
  }
  function bedFlow(V, c) {
    const end = c.dur;
    const n = V.nz('pink', 0, end), bp = V.f('bandpass', 260, 0.6), g = V.g(0);
    V.chain(n, bp, g); g.connect(V.out);
    V.curve(g.gain, 0, end, (t) => dB(-19) * sstep(EV.abyss, EV.abyss + 1.5, t) * lerp(0.35, 1, clamp((t - EV.abyss) / (EV.seabedImpact - EV.abyss))) * (1 - sstep(EV.seabedImpact - 0.05, EV.seabedImpact + 0.4, t)));
    const w = V.nz('white', 0, end), wb = V.f('bandpass', 900, 1.2), wg = V.g(0), s = V.nz('slow', 0, end, 0.8), sg = V.g(250);
    s.connect(sg); sg.connect(wb.frequency); V.chain(w, wb, wg); wg.connect(V.out);
    V.curve(wg.gain, 0, end, (t) => dB(-32) * sstep(EV.abyss, EV.seabedImpact, t) * (1 - sstep(EV.seabedImpact - 0.05, EV.seabedImpact + 0.3, t)));
  }
  function cSeabed(V, c) {
    boom(V, 0, dB(0), { f0: 42, f1: 21, tau: 1.6, noise: 1.5, nf: 260 });
    tone(V, 0, { f0: 22, lvl: dB(-4), a: 0.01, d: 3.5 });
    burst(V, 0.01, { kind: 'brown', type: 'lowpass', f: 700, q: 0, lvl: dB(-4), a: 0.01, d: 0.9 });
    // the sediment cloud rushing outward
    const n = V.nz('brown', 0, c.dur), lp = V.f('lowpass', 500, 0), g = V.g(0);
    V.env(lp.frequency, [[0, 520], [c.dur, 150, 'x']]);
    V.chain(n, lp, g); g.connect(V.out);
    V.env(g.gain, [[0, 0], [0.9, dB(-2)], [2.5, dB(-8)], [4.6, dB(-20), 'x'], [c.dur, 0.0001, 'x']]);
    const h = V.nz('pink', 0, c.dur), hg = V.g(0); V.chain(h, V.f('bandpass', 240, 0.5), hg); hg.connect(V.out);
    V.env(hg.gain, [[0, 0], [1.2, dB(-12)], [c.dur, 0.0001, 'x']]);
  }
  function cROV(V, c) {
    const end = c.dur;
    const lv = (t) => sstep(EV.rov, EV.rov + 2.2, t) * (1 - sstep(EV.dawn - 0.4, EV.dawn - 0.05, t));
    const g = V.g(0); outTo(V, g, 0.2);
    V.curve(g.gain, 0, end, (t) => dB(-29) * lv(t));
    const o = V.osc('sawtooth', 118, 0, end), lp = V.f('lowpass', 800, 0); o.connect(lp); lp.connect(g);
    const w = V.osc('sine', 1480, 0, end), wl = V.osc('sine', 0.8, 0, end), wlg = V.g(12), wg = V.g(0.12);
    wl.connect(wlg); wlg.connect(w.detune); w.connect(wg); wg.connect(g);
    const pr = V.nz('pink', 0, end), pb = V.f('bandpass', 700, 1), pa = V.g(0.6), sl = V.nz('slow', 0, end, 2), slg = V.g(0.4);
    sl.connect(slg); slg.connect(pa.gain); V.chain(pr, pb, pa, g);
  }
  function sPing(V, c) { tone(V, 0, { f0: 2080, lvl: dB(-18), a: 0.004, d: 0.09 }); }

  // ------------------------------------------------------------------
  // Dawn
  // ------------------------------------------------------------------
  const dawnFade = (t) => sstep(EV.dawn, EV.dawn + 1.2, t) * (1 - sstep(DUR - 9, DUR - 0.5, t));
  function bedDawn(V, c) {
    const end = c.dur;
    const gust = (t) => clamp(0.55 + 0.35 * noise1(t * 0.23, 31) + 0.2 * noise1(t * 0.71, 32), 0.1, 1.2);
    const wind = V.nz('white', 0, end), bp = V.f('bandpass', 700, 0.5), wg = V.g(0);
    V.curve(bp.frequency, 0, end, (t) => 520 + 380 * gust(t), 10);
    V.chain(wind, bp, wg); outTo(V, wg, -0.2);
    V.curve(wg.gain, 0, end, (t) => dB(-21) * dawnFade(t) * (TR.wind(t) / 5.5) * gust(t));
    const air = V.nz('pink', 0, end), ag = V.g(0); V.chain(air, V.f('highpass', 2600, 0), ag); outTo(V, ag, 0.3);
    V.curve(ag.gain, 0, end, (t) => dB(-32) * dawnFade(t) * gust(t + 1.7));
    const sw = V.nz('brown', 0, end), sg = V.g(0); V.chain(sw, V.f('lowpass', 200, 0), sg); sg.connect(V.out);
    V.curve(sg.gain, 0, end, (t) => dB(-21) * dawnFade(t) * (0.7 + 0.3 * noise1(t * 0.19, 33)));
    const lap = (t) => clamp(0.3 + 0.5 * noise1(t * 1.3, 34) + 0.3 * noise1(t * 3.1, 35), 0, 1.4);
    const lw = V.nz('pink', 0, end), lg = V.g(0); V.chain(lw, V.f('bandpass', 850, 0.7), lg); outTo(V, lg, 0.1);
    V.curve(lg.gain, 0, end, (t) => dB(-15) * dawnFade(t) * lap(t));
    const sl = V.nz('white', 0, end), slg = V.g(0); V.chain(sl, V.f('bandpass', 2300, 1), slg); outTo(V, slg, -0.3);
    V.curve(slg.gain, 0, end, (t) => dB(-24) * dawnFade(t) * Math.max(0, lap(t + 0.2) - 0.6) * 2.5);
  }
  function sOar(V, c) {
    const p = c.p;
    creak(V, 0, 0.16, 32 + p.k * 5, p.lvl * dB(-4), p.pan, 1050 + p.k * 90);
    burst(V, 0.42, { kind: 'pink', type: 'bandpass', f: 1250, q: 0.8, lvl: p.lvl, a: 0.03, d: 0.3, pan: p.pan });
    burst(V, 1.2, { kind: 'white', type: 'highpass', f: 3000, q: 0, lvl: p.lvl * 0.35, a: 0.02, d: 0.5, pan: p.pan });
  }
  // Carpathia's steam whistle across the water: a breathy three-note chord, distant.
  function sWhistle(V, c) {
    const len = c.p.len, lvl = c.p.lvl, out = V.g(0), lp = V.f('lowpass', 1900, 0), pn = V.pan(-0.35);
    V.chain(out, lp, pn); pn.connect(V.out);
    const echo = V.ac.createDelay(2); echo.delayTime.value = 1.15;
    const eg = V.g(0.28), elp = V.f('lowpass', 900, 0); V.chain(lp, echo, elp, eg); eg.connect(V.out);
    V.env(out.gain, [[0, 0], [0.3, lvl], [len - 0.45, lvl * 0.9], [len, 0]]);
    [146.8, 185.0, 220.0].forEach((f, i) => {
      [[1, 0.55], [2, 0.22], [3, 0.08]].forEach(([h, a]) => {
        const o = V.osc('sine', f * h, 0, len + 0.1), g = V.g(a / 3);
        V.env(o.detune, [[0, -70 + i * 10], [0.35, 0]]);
        o.connect(g); g.connect(out);
      });
      const n = V.nz('white', 0, len + 0.1), bp = V.f('bandpass', f * 2, 6), g = V.g(0.12); V.chain(n, bp, g, out);
    });
    V.endX = len + 2.5;
  }

  // ------------------------------------------------------------------
  // The sound-design cue sheet (deterministic; sorted by time)
  // ------------------------------------------------------------------
  function buildCues() {
    const L = [], r = U.rng(4242);
    const add = (t, dur, bus, fn, p, mid) => L.push({ t, dur, bus, fn, p: p || {}, mid: !!mid });
    const rp = (s = 0.8) => (r() - 0.5) * s;
    // night ambience, engines, wake
    add(0, EV.underwater, 'amb', bedOcean, {}, true);
    add(0, EV.engineStop + 2, 'amb', bedEngine, {}, true);
    add(0, 114, 'amb', bedWake, {}, true);
    // lookout
    EV.bells.forEach((t) => add(t, 3.5, 'sfx', sCrowBell));
    add(EV.phone, 3.2, 'sfx', sPhone);
    add(EV.helm, 1.8, 'sfx', sHelm);
    add(EV.engineAstern, 3, 'sfx', sTelegraph);
    // collision
    add(EV.impact - 0.05, EV.scrapeEnd - EV.impact + 2, 'sfx', cCollision, {}, true);
    add(EV.impact, 5, 'sfx', sBoom, { lvl: dB(-4.5), f0: 58, f1: 29, tau: 0.9, noise: 1.1 });
    add(EV.impact, 2, 'sfx', sImpact);
    add(EV.impact + 0.02, 1.5, 'sfx', sIce, { f: 1300, lvl: dB(-5), d: 0.5, pan: 0.3 });
    [74.85, 75.7, 76.9, 77.6, 79.0, 80.3, 81.2, 82.3].forEach((t, i) => add(t, 3, 'sfx', sBoom, { lvl: dB(-6 - i * 0.9), f0: 50, f1: 30, tau: 0.5, noise: 1 }));
    for (let i = 0; i < 44; i++) add(EV.impact + 0.4 + 8.2 * Math.pow(r(), 1.4), 0.3, 'sfx', sCrack, { lvl: dB(-4 - r() * 10), pan: 0.15 + rp(0.8), f: 2200 + r() * 3000 });
    // ice tumbling onto the forward well deck: a first spill, then the main fall (the ice-fall shot)
    for (let i = 0; i < 12; i++) add(EV.impact + 1.1 + 4.2 * r(), 0.8, 'sfx', sIce, { f: 900 + r() * 2200, lvl: dB(-10 - r() * 9), d: 0.1 + r() * 0.35, pan: -0.15 + rp(0.8) });
    for (let i = 0; i < 26; i++) add(79.4 + 3.6 * Math.pow(r(), 0.8), 0.8, 'sfx', sIce, { f: 700 + r() * 2400, lvl: dB(-6 - r() * 9), d: 0.1 + r() * 0.4, pan: rp(1) });
    add(76.1, 3.6, 'sfx', sGroan, { f: 48, lvl: dB(-9), pan: 0.2, bend: -2 });
    add(79.3, 4.2, 'sfx', sGroan, { f: 41, lvl: dB(-10), pan: 0.1, bend: -3 });
    // the safety valves roar
    add(EV.steamStart, EV.steamEnd - EV.steamStart + 0.3, 'sfx', bedSteam, {}, true);
    // wireless
    for (const m of STORY.TELEGRAPH) add(m.t0 - 0.2, m.t1 - m.t0 + 0.5, 'morse', cMorse, { m }, true);
    // hull groans and creaks through the final hour, intensifying
    for (let t = 97; t < EV.breakStart - 1;) {
      const u = clamp((t - 92) / (EV.breakStart - 92));
      if (r() < 0.62) add(t, 2.5 + r() * 3, 'sfx', sGroan, { f: 36 + r() * 50, lvl: dB(-24 + 13 * u - r() * 4), pan: rp(), bend: -1 - r() * 4, r1: 150 + r() * 80, r2: 280 + r() * 120 }, true);
      else add(t, 0.4 + r() * 1.2, 'sfx', sCreak, { rate: 25 + r() * 60, lvl: dB(-30 + 11 * u), pan: rp(0.9), res: 250 + r() * 500 });
      t += lerp(8, 2.2, u) * (0.6 + 0.8 * r());
    }
    for (let t = 166; t < EV.breakStart - 0.5; t += 2 + r() * 4) add(t, 1, 'sfx', sClatter, { lvl: dB(-28 + (t - 166) * 0.3), pan: rp(), seed: Math.floor(t * 100) });
    // lifeboats
    for (const b of STORY.BOATS) { add(b.lowerT0, b.lowerT1 - b.lowerT0, 'sfx', cDavit, { b }, true); add(b.lowerT1, 3, 'sfx', sBoatSplash, { b }); }
    // rockets
    for (const t of EV.rockets) { add(t, 2.6, 'sfx', sRocketLaunch); add(t + 2.3, 5, 'sfx', sRocketBurst); }
    // funnel 1 collapses
    add(EV.funnel1Fall, EV.funnel1Splash - EV.funnel1Fall + 5, 'sfx', cFunnel, {}, true);
    // lights fail
    add(EV.lightsFlicker - 0.3, EV.lightsGone - EV.lightsFlicker + 2.5, 'sfx', cElectric, {}, true);
    const LC = lightsCurve();
    let lastPop = -1;
    for (let t = EV.lightsFlicker; t < EV.lightsGone + 0.1; t += 0.02) {
      if (LC.at(t - 0.02) - LC.at(t) > 0.2 && t - lastPop > 0.18) { add(t, 0.3, 'sfx', sPop, { lvl: dB(-15 - r() * 6), pan: rp(0.9) }); lastPop = t; }
    }
    add(EV.lightsOut, 2, 'sfx', sBoom, { lvl: dB(-14), f0: 95, f1: 50, tau: 0.22 });
    add(EV.lightsGone, 2, 'sfx', sBoom, { lvl: dB(-16), f0: 80, f1: 45, tau: 0.3 });
    // the break
    add(EV.breakStart, EV.sternSplash - EV.breakStart + 2, 'sfx', cBreak, {}, true);
    [[EV.breakStart, -4.5], [196.2, -8.5], [197.1, -6.5], [EV.breakApart, -1.5], [199.0, -5.5], [200.3, -8.5], [201.4, -10.5]].forEach(([t, l]) => add(t, 5, 'sfx', sBoom, { lvl: dB(l), f0: 52, f1: 25, tau: 1.0, noise: 1.6 }));
    for (let i = 0; i < 34; i++) add(EV.breakStart + 6.5 * Math.pow(r(), 0.9), 0.3, 'sfx', sCrack, { lvl: dB(-8 - r() * 10), pan: rp(1.2), f: 1500 + r() * 3000 });
    for (let i = 0; i < 14; i++) add(EV.breakApart + 0.5 + 6 * r(), 1, 'sfx', sClatter, { lvl: dB(-9 - r() * 8), pan: rp(), seed: 700 + i });
    [[195.6, 3.5, 34], [197.8, 4, 28], [200.2, 4.5, 38], [202.4, 4, 31]].forEach(([t, d, f]) => add(t, d, 'sfx', sGroan, { f, lvl: dB(-6), pan: rp(0.5), bend: -5 }, true));
    // the stern slams back
    add(EV.sternSplash, 6.5, 'sfx', sSplash, { size: 1.6, lvl: dB(0) }, true);
    add(EV.sternSplash, 5, 'sfx', sBoom, { lvl: dB(-1), f0: 45, f1: 24, tau: 1.1, noise: 1.4 });
    // the stern rises to vertical
    add(EV.sternRise, EV.sternPlunge - EV.sternRise + 1.5, 'sfx', cRise, {}, true);
    for (let i = 0; i < 18; i++) { const u = Math.pow(r(), 0.7); add(EV.sternRise + 1 + u * (EV.sternPlunge - EV.sternRise), 1, 'sfx', sClatter, { lvl: dB(-16 + 8 * u - r() * 6), pan: rp(), seed: 900 + i }); }
    for (let i = 0; i < 9; i++) add(EV.sternRise + 1.5 + i * 1.2 + r() * 0.8, 0.8, 'sfx', sBoom, { lvl: dB(-16 + i), f0: 70, f1: 35, tau: 0.4 });
    [[205.8, 4, 44], [208.6, 4.5, 36], [211.2, 4, 40], [213.4, 3.5, 30]].forEach(([t, d, f]) => add(t, d, 'sfx', sGroan, { f, lvl: dB(-9), pan: rp(0.5), bend: -2 }, true));
    // the plunge
    add(EV.sternPlunge, EV.silence - EV.sternPlunge + 3, 'sfx', cPlunge, {}, true);
    for (let i = 0; i < 42; i++) { const t = 218.5 + 5.5 * r(); add(t, 0.5, 'sfx', sBubble, { f: 90 + 260 * r(), lvl: dB(-18 - r() * 8), pan: rp(0.9), len: 0.12 + 0.28 * r() }); }
    // silence: only water
    [227.9, 229.6, 231.2, 234.8, 237.1].forEach((t) => add(t, 0.2, 'amb', sPlip, { f: 700 + r() * 900, lvl: dB(-40), pan: rp() }));
    // the deep
    add(EV.underwater, EV.dawn - EV.underwater, 'uw', bedUnder, {}, true);
    for (let i = 0; i < 90; i++) { const t = EV.underwater + 0.2 + 6.6 * Math.pow(r(), 1.3); add(t, 0.2, 'uw', sBubble, { f: 450 + r() * 1500, lvl: dB(-26 - r() * 10), pan: rp(1.4), len: 0.02 + 0.06 * r() }); }
    for (let i = 0; i < 26; i++) { const t = EV.underwater + 0.3 + 6.5 * r(); add(t, 0.5, 'uw', sBubble, { f: 110 + r() * 250, lvl: dB(-20 - r() * 8), pan: rp(1), len: 0.12 + 0.25 * r() }); }
    for (let i = 0; i < 14; i++) { const t = EV.abyss + 0.5 + 7.5 * r(); add(t, 0.3, 'uw', sBubble, { f: 300 + r() * 900, lvl: dB(-32 - r() * 6), pan: rp(1), len: 0.03 + 0.08 * r() }); }
    [[240.6, 4, 38], [243.1, 3.5, 46], [245.4, 4.2, 33]].forEach(([t, d, f]) => add(t, d, 'uw', sGroan, { f, lvl: dB(-19), pan: rp(0.6), bend: -3, r1: 120, r2: 220, r3: 380 }, true));
    [[242.3, -15], [244.7, -18], [246.2, -16]].forEach(([t, l]) => add(t, 4, 'uw', sBoom, { lvl: dB(l), f0: 46, f1: 24, tau: 1.2, noise: 1.4, nf: 300 }));
    add(EV.abyss, EV.seabedImpact - EV.abyss + 0.5, 'uw', bedFlow, {}, true);
    add(EV.seabedImpact, 6.4, 'uw', cSeabed, {}, true);
    [[256.8, 3.5, 30], [258.6, 3, 36]].forEach(([t, d, f]) => add(t, d, 'uw', sGroan, { f, lvl: dB(-20), pan: rp(0.6), bend: -1.5, r1: 110, r2: 200, r3: 330 }, true));
    add(EV.rov, EV.dawn - EV.rov, 'uw', cROV, {}, true);
    [258.6, 260.9].forEach((t) => add(t, 0.2, 'uw', sPing));
    // dawn: breeze, small waves on the boats, oars, Carpathia's whistle
    add(EV.dawn, DUR - EV.dawn, 'amb', bedDawn, {}, true);
    [[2.9, 0.3, dB(-20), -0.3], [3.4, 1.4, dB(-25), 0.25], [2.6, 0.9, dB(-30), 0.55]].forEach(([per, ph, lvl, pan], k) => {
      for (let t = EV.dawn + 1.5 + ph; t < DUR - 6; t += per * (0.93 + 0.14 * r())) add(t, 1.8, 'amb', sOar, { k, lvl: lvl * (1 - sstep(DUR - 14, DUR - 6, t)), pan });
    });
    add(266.0, 6, 'amb', sWhistle, { len: 3.4, lvl: dB(-21.5) });
    add(284.0, 5.5, 'amb', sWhistle, { len: 2.6, lvl: dB(-18.5) });
    L.sort((a, b) => a.t - b.t);
    return L;
  }

  // ------------------------------------------------------------------
  // Scheduler
  // ------------------------------------------------------------------
  let CUES = [];
  function lowerBound(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m; } return lo; }
  const busOfEvent = (ev) => (instOf(ev.inst).bus === 'band' ? 'band' : 'music');
  const soloEv = (A, ev) => !A.solo || A.solo.includes(busOfEvent(ev)) || A.solo.includes(ev.inst);
  function playCue(A, c, off) {
    if (A.solo && !A.solo.includes(c.bus) && !A.solo.includes(c.fn.name)) return;
    let when = A.when(c.t) + off;
    if (!A.offline) {
      const now = A.ac.currentTime;
      if (when < now + 0.01) { const late = now + 0.01 - when; if (!c.mid && off + late > 0.1) return; off += late; when = now + 0.01; }
    }
    if (off >= c.dur) return;
    const V = new Vx(A, when, off, ep(A, A.bus[c.bus]), c.t, c.mid);
    try { c.fn(V, c); } catch (e) { errOnce('cue ' + (c.fn && c.fn.name), e); }
    A.voices.push({ inst: 'cue', start: when, end: V.T(Math.max(c.dur, V.endX)) + 0.5, g: null, srcs: V.srcs });
  }
  function schedTracks(A, tA, tB) {
    for (const tr of A.tracks) {
      let k = Math.max(Math.floor(tr.lastT / TSTEP) + 1, Math.ceil(tA / TSTEP));
      for (; k * TSTEP <= tB + 1e-9; k++) {
        const ts = k * TSTEP, v = tr.f(ts);
        if (Math.abs(v - tr.lastV) <= 1e-5 * (1 + Math.abs(v))) continue;
        const gap = ts - tr.lastT > TSTEP * 1.5;
        for (const p of tr.params) {
          if (gap) p.setValueAtTime(tr.lastV, A.when(ts - TSTEP));
          p.linearRampToValueAtTime(v, A.when(ts));
        }
        tr.lastV = v; tr.lastT = ts;
      }
    }
  }
  function startFrom(A, t) {
    const now = A.ac.currentTime, at = Math.max(now, A.when(t));
    for (const tr of A.tracks) {
      const v = tr.f(t);
      for (const p of tr.params) {
        try { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else p.cancelScheduledValues(now); } catch (e) { /* ignore */ }
        p.linearRampToValueAtTime(v, at + 0.03);
      }
      tr.lastV = v; tr.lastT = t + 0.03;
    }
    const evs = SCORE.events, i0 = lowerBound(evs, t);
    for (let i = i0 - 1; i >= 0 && evs[i].t > t - SCORE.maxDur - 3.5; i--) {
      const ev = evs[i], off = t - ev.t;
      if (!soloEv(A, ev)) continue;
      const I = instOf(ev.inst);
      const ring = I.kind === 'pluck' || I.kind === 'keys' ? 1.5 : I.synth === 'tamtam' || I.synth === 'bells' ? 3 : 0;
      if (ev.t + ev.dur > t + 0.15 || off < ring) playEvent(A, ev, i, off);
    }
    A.evIdx = i0;
    for (const c of CUES) {
      if (c.t >= t) break;
      if (c.t + c.dur > t && (c.mid || t - c.t < 0.05)) playCue(A, c, t - c.t);
    }
    A.cueIdx = lowerBound(CUES, t);
    A.tSched = t;
  }
  function scheduleWindow(A, tA, tB) {
    schedTracks(A, tA, tB);
    const evs = SCORE.events;
    while (A.evIdx < evs.length && evs[A.evIdx].t < tB) {
      const ev = evs[A.evIdx];
      if (soloEv(A, ev)) playEvent(A, ev, A.evIdx, 0);
      A.evIdx++;
    }
    while (A.cueIdx < CUES.length && CUES[A.cueIdx].t < tB) { playCue(A, CUES[A.cueIdx], 0); A.cueIdx++; }
  }

  // ------------------------------------------------------------------
  // Realtime control
  // ------------------------------------------------------------------
  const ST = { ac: null, A: null, started: false, pending: null, pendingAt: 0, level: 0, muted: false, volume: 1, timer: null, lastTick: 0 };
  const mapOff = () => { const t = TT.clock.now(); return TT.clock.toAudioTime(t) - t; };
  function tick() {
    const A = ST.A;
    if (!A || !ST.started || !TT.clock.playing || A.ac.state !== 'running') return;
    ST.lastTick = performance.now();
    try {
      const ac = A.ac, mo = mapOff();
      if (ST.pending != null) {
        if (performance.now() - ST.pendingAt < 90) return;
        ST.pending = null;
        resetEpoch(A);
        A.mapOff = mo;
        startFrom(A, clamp(ac.currentTime + 0.03 - mo, 0, DUR + 3));
      } else if (Math.abs(mo - A.mapOff) > 0.05) {
        // the clock was re-anchored (resume after a pause, mode switch): resync gently
        resetEpoch(A, 0.12);
        A.mapOff = mo;
        startFrom(A, clamp(ac.currentTime + 0.03 - mo, 0, DUR + 3));
      }
      const hz = Math.min(DUR + 3, ac.currentTime - mo + LOOK);
      if (hz > A.tSched + 0.02) { scheduleWindow(A, A.tSched, hz); A.tSched = hz; }
      if (A.voices.length > 30) { const now = ac.currentTime; A.voices = A.voices.filter((v) => v.end > now); }
    } catch (e) { errOnce('scheduler', e); }
  }

  // ------------------------------------------------------------------
  // Offline render test hook: wav=t0,t1
  // ------------------------------------------------------------------
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function renderWav(spec) {
    try {
      const [a, b] = String(spec).split(',').map(parseFloat);
      const t0 = clamp(a || 0, 0, DUR), t1 = clamp(isFinite(b) ? b : t0 + 10, t0 + 0.5, Math.min(DUR + 4, t0 + (PRM.wavstat ? 320 : 60)));
      if (LOAD.promise) await Promise.race([LOAD.promise, sleep(90000)]);
      for (let i = 0; i < 40 && TT.director && !TT.director._ready; i++) await sleep(100);
      const sr = clamp(parseInt(PRM.wavsr, 10) || 22050, 8000, 48000), nch = PRM.wavch === '2' ? 2 : 1;
      const oac = new OfflineAudioContext(2, Math.ceil((t1 - t0) * sr), sr);
      const A = buildGraph(oac, { offline: true, t0, solo: PRM.wavsolo ? PRM.wavsolo.split(',') : null });
      const tm = performance.now();
      startFrom(A, t0);
      let nv = 0, maxc = 0, nodes = 0;
      const census = (vs, a, b) => {
        // live notes (voices being stolen fade out within ~0.16 s and are not counted)
        for (let t = a; t < b; t += 0.25) { let c = 0, sc = 0; for (const v of vs) if (v.g && !v.killed && v.start <= t && v.end > t) { c++; sc += v.srcs.length; } if (c > maxc) { maxc = c; nodes = sc; } }
      };
      if (PRM.wavrt) {
        // realtime emulation: schedule incrementally (LOOK ahead, 0.1 s steps) like the live
        // scheduler, so render_ms approximates the realtime audio-thread load
        const sched = () => {
          const now = oac.currentTime, hz = Math.min(t1, t0 + now + LOOK);
          if (hz > A.tSched + 0.02) { scheduleWindow(A, A.tSched, hz); A.tSched = hz; }
          census(A.voices, now, now + 0.1);
          nv = Math.max(nv, A.voices.length);
          if (A.voices.length > 30) A.voices = A.voices.filter((v) => v.end > now);
        };
        sched();
        for (let x = 0.1; x < t1 - t0 - 0.05; x += 0.1) oac.suspend(x).then(() => { sched(); oac.resume(); });
      } else {
        scheduleWindow(A, t0, t1);
        nv = A.voices.length;
        census(A.voices, 0, t1 - t0);
      }
      const tb = performance.now() - tm;
      const buf = await oac.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
      if (PRM.wavstat) {   // numbers only: overall RMS / peak (dBFS) of the rendered range
        let ss = 0, pk = 0;
        for (let i = 0; i < n; i++) { const v = (L[i] + R[i]) * 0.5; ss += v * v; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
        console.log('TT_WAV_STAT rms=' + (10 * Math.log10(ss / n + 1e-20)).toFixed(1) + ' peak=' + (20 * Math.log10(pk + 1e-10)).toFixed(1) + ' render_ms=' + (performance.now() - tm).toFixed(0));
        console.log('TT_WAV_END');
        return;
      }
      const pcm = new Int16Array(n * nch);
      const s16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      for (let i = 0; i < n; i++) {
        if (nch === 1) pcm[i] = s16((L[i] + R[i]) * 0.5);
        else { pcm[2 * i] = s16(L[i]); pcm[2 * i + 1] = s16(R[i]); }
      }
      const bytes = new Uint8Array(pcm.buffer), CH = 44000, nc = Math.ceil(bytes.length / CH);
      console.log('TT_WAV_INFO t0=' + t0 + ' t1=' + t1 + ' mode=' + MOD.sampleMode + ' samples=' + LOAD.ok + '/' + LOAD.total +
        ' voices=' + nv + ' maxNotes=' + maxc + ' (srcs ' + nodes + ') build_ms=' + tb.toFixed(0) + ' render_ms=' + (performance.now() - tm).toFixed(0) + ' events=' + SCORE.events.length + ' cues=' + CUES.length);
      console.log('TT_WAV_BEGIN ' + sr + ' ' + nch + ' ' + nc);
      for (let i = 0; i < nc; i++) console.log('TT_WAV_CHUNK ' + i + ' ' + b64(bytes.subarray(i * CH, Math.min(bytes.length, (i + 1) * CH))));
      console.log('TT_WAV_END');
    } catch (e) { TT.error('audio wav', e); }
  }

  // ------------------------------------------------------------------
  // Module
  // ------------------------------------------------------------------
  const MOD = TT.register('audio', {
    order: 5,
    sampleMode: 'synth',
    ac: null,
    async init(ctx) {
      LQ = ctx.quality === 'low' || !!ctx.isMobile;
      SCORE = loadScore();
      CUES = buildCues();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.disabled = true; return; }
      const freeze = PRM.freeze === '1';
      if (!freeze) {
        try { ST.ac = new AC({ latencyHint: 'playback' }); } catch (e) { ST.ac = new AC(); }
        this.ac = ST.ac;
        ST.A = buildGraph(ST.ac);
      }
      TT.on('seek', () => { if (ST.A && ST.started) { resetEpoch(ST.A); ST.pending = 1; ST.pendingAt = performance.now(); } });
      TT.on('pause', () => { if (ST.started && ST.ac && ST.ac.state === 'running') ST.ac.suspend().catch(() => {}); });
      TT.on('play', () => { if (ST.started && ST.ac && ST.ac.state !== 'running') ST.ac.resume().then(tick).catch(() => {}); });
      const wantSamples = (!freeze || !!PRM.wav) && SCORE.events.length > 0;
      if (wantSamples) {
        LOAD.inInit = true;
        startLoading(ctx);
        const early = () => Object.keys(LIB).every((k) => LIB[k].ready || LIB[k].firstT > 45);
        const t0 = performance.now();
        while (performance.now() - t0 < 4500 && !LOAD.finished && !early()) await sleep(80);
        LOAD.inInit = false;
      }
      if (PRM.wav) renderWav(PRM.wav);
    },
    // Called inside the user gesture: resume the context, hand it to the clock, schedule from t.
    async start(t) {
      if (this.disabled) return;
      if (!ST.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        try { ST.ac = new AC({ latencyHint: 'playback' }); } catch (e) { ST.ac = new AC(); }
        this.ac = ST.ac;
      }
      if (!SCORE.events.length && TT.score) {
        SCORE = loadScore();
        if (SCORE.events.length && !LOAD.started) startLoading(TT.ctx);
        ST.A = null;
      }
      if (!ST.A) ST.A = buildGraph(ST.ac);
      ST.A.vol.gain.value = ST.volume;
      ST.A.mute.gain.value = ST.muted ? 0 : 1;
      try { await ST.ac.resume(); } catch (e) { /* ignore */ }
      TT.clock.attachAudio(ST.ac);
      ST.started = true;
      ST.pending = t == null ? 0 : t;
      ST.pendingAt = 0;
      if (!ST.timer) ST.timer = setInterval(tick, 100);
    },
    pause() { if (ST.ac && ST.ac.state === 'running') ST.ac.suspend().catch(() => {}); },
    resume() { if (ST.ac && ST.ac.state !== 'running') ST.ac.resume().then(tick).catch(() => {}); },
    setMuted(b) {
      ST.muted = !!b;
      if (ST.A) ST.A.mute.gain.setTargetAtTime(ST.muted ? 0 : 1, ST.A.ac.currentTime, 0.03);
    },
    setVolume(v) {
      ST.volume = clamp(v);
      if (ST.A) ST.A.vol.gain.setTargetAtTime(ST.volume, ST.A.ac.currentTime, 0.03);
    },
    isRunning() { return !!(ST.started && ST.ac && ST.ac.state === 'running'); },
    getLevel() { return ST.level; },
    loadStatus() { return { loaded: LOAD.ok, total: LOAD.total, wanted: LOAD.wanted || 0, baked: LOAD.baked || 0, failed: LOAD.failed, finished: LOAD.finished }; },
    update(t, dt, ctx) {
      if (ST.started && performance.now() - ST.lastTick > 40) tick();
      const A = ST.A;
      let target = 0;
      if (A && ST.started && A.ac.state === 'running') {
        A.an.getFloatTimeDomainData(A.anBuf);
        let s = 0; const d = A.anBuf;
        for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        target = clamp(Math.sqrt(s / d.length) * 3.2);
      }
      ST.level = U.damp(ST.level, target, target > ST.level ? 18 : 5, dt || 0.016);
    },
  });
})();
