import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/55_score.js ====
// =====================================================================
// 55_score.js — COMPOSER (module 'score', order 3).
// The film's original orchestral score as data: TT.score = { events, automation, sections }.
// Built synchronously when this file loads. Pure data; the audio engine (50_audio.js) plays it.
//
// Musical material
//  * MAIN THEME (original): a noble, yearning 3/4 melody in D major — a sighing descent that
//    rises by a sixth (F#-E-D, A-B), stated by solo cello in the intro, in full during the voyage,
//    in D minor on solo cello while the ship lies stopped, and on solo piano at the very end.
//  * BETHANY ("Nearer, My God, to Thee", Lowell Mason 1856, public domain): played by the band on
//    deck in D major (a simple four-part harmonisation), carried by the orchestra into a D-minor
//    tragic climax as she breaks, sung by one lonely violin in the silence, and reborn in D major
//    at dawn with a full plagal "Amen" at the close.
//  Nothing here quotes or imitates any copyrighted film music.
//
// Conventions: t = story seconds, midi = sounding pitch, dur = seconds, vel 0..1.
// Hits that must land on story events (EV.*) are placed with {exact:1} (no humanisation).
// =====================================================================
(() => {
  const U = TT.util;
  const EV = TT.story.EV;
  const DUR = TT.CONST.DURATION;

  // ------------------------------------------------------------------
  // Instruments: [default pan, lowest, highest (sounding MIDI), timing humanisation (s)]
  // ------------------------------------------------------------------
  const INST = {
    strings_hi: [-0.38, 55, 100, 0.012], strings_mid: [0.12, 48, 88, 0.012], strings_lo: [0.34, 36, 81, 0.012],
    basses: [0.5, 24, 67, 0.012], solo_violin: [-0.12, 55, 100, 0.01], solo_cello: [0.12, 36, 81, 0.01],
    harp: [-0.55, 24, 103, 0.006], piano: [-0.18, 21, 108, 0.006], horns: [-0.22, 34, 77, 0.01],
    trumpet: [0.18, 54, 82, 0.008], brass_lo: [0.32, 26, 72, 0.008], flute: [-0.08, 60, 96, 0.008],
    clarinet: [0.1, 50, 91, 0.008], oboe: [0.04, 58, 91, 0.008], bassoon: [0.2, 34, 75, 0.008],
    timpani: [0.0, 36, 57, 0.004], bass_drum: [0.05, 0, 127, 0.003], cymbal: [0.2, 0, 127, 0.003],
    tamtam: [-0.2, 0, 127, 0.003], choir: [0.0, 38, 81, 0.015], choir_ooh: [0.0, 38, 81, 0.015],
    celesta: [0.32, 60, 108, 0.006], bells: [0.28, 60, 77, 0.004], organ: [0.0, 24, 96, 0.004],
    drone: [0.0, 21, 62, 0.0],
    band_violin: [-0.1, 55, 93, 0.014], band_violin2: [0.02, 55, 90, 0.014], band_cello: [0.12, 36, 76, 0.014],
    band_bass: [0.18, 28, 55, 0.014], band_piano: [-0.16, 21, 108, 0.01],
  };

  // ------------------------------------------------------------------
  // Pitch helpers: 'F#4' -> 66, 'Bb2' -> 46; PS('D3 A3 F#4') -> [50, 57, 66]
  // ------------------------------------------------------------------
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function P(n) {
    if (typeof n === 'number') return n;
    const r = /^([A-G])([#b]*)(-?\d)$/.exec(n);
    if (!r) throw new Error('bad pitch ' + n);
    let v = PC[r[1]] + 12 * (+r[3] + 1);
    for (const c of r[2]) v += c === '#' ? 1 : -1;
    return v;
  }
  const PS = (s) => (Array.isArray(s) ? s.map(P) : String(s).trim().split(/\s+/).filter(Boolean).map(P));
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  // scale degree (1..7, 8 = octave; negative = the octave below) -> midi
  function deg(d, tonic, scale) {
    const neg = d < 0; d = Math.abs(d);
    return tonic + scale[(d - 1) % 7] + 12 * Math.floor((d - 1) / 7) - (neg ? 12 : 0);
  }

  // ------------------------------------------------------------------
  // Event store
  // ------------------------------------------------------------------
  const EVS = [], AUTO = [];
  function N(t, inst, pitch, dur, vel, art, o) {
    EVS.push({ t, inst, midi: P(pitch), dur, vel, art: art || null, pan: o && o.pan != null ? o.pan : null, x: o && o.exact ? 1 : 0 });
  }
  const chord = (t, inst, pitches, dur, vel, art, o) => { for (const p of PS(pitches)) N(t, inst, p, dur, vel, art, o); };
  const X = { exact: 1 };
  function A(t, target, value, ramp) { AUTO.push({ t, target, value, ramp: ramp || 'lin' }); }
  const velAt = (v, u) => (typeof v === 'function' ? v(u) : Array.isArray(v) ? U.lerp(v[0], v[1], u) : v == null ? 0.5 : v);

  // ------------------------------------------------------------------
  // Tempo maps. TM(t0, [[beats, bpm0, bpm1?], ...]) -> tm(beat) = seconds (linear tempo change
  // within a segment = accelerando / ritardando). fit(beats, secs, r) makes a segment that lasts
  // exactly `secs` with end/start tempo ratio r — used to land bar lines on story hit points.
  // ------------------------------------------------------------------
  function segT(a, z, n, x) {
    if (Math.abs(z - a) < 1e-9) return (60 * x) / a;
    const k = (z - a) / n;
    return (60 / k) * Math.log((a + k * x) / a);
  }
  function TM(t0, segs) {
    const S = []; let b = 0, t = t0;
    for (const s of segs) {
      const n = s[0], a = s[1], z = s[2] == null ? s[1] : s[2];
      S.push({ b, t, n, a, z }); t += segT(a, z, n, n); b += n;
    }
    const f = (x) => { let s = S[0]; for (const q of S) if (x >= q.b - 1e-9) s = q; return s.t + segT(s.a, s.z, s.n, x - s.b); };
    f.t1 = t; f.beats = b;
    return f;
  }
  function fit(beats, secs, r = 1) {
    if (Math.abs(r - 1) < 1e-6) return [beats, (60 * beats) / secs];
    const a = (60 * beats * Math.log(r)) / ((r - 1) * secs);
    return [beats, a, a * r];
  }

  // ------------------------------------------------------------------
  // Writers
  // ------------------------------------------------------------------
  // tokens: 'F#4:2 E4:1 r:1 D4:1:stacc' or [[pitch, beats, art?], ...]
  function toks(spec) {
    if (Array.isArray(spec)) return spec.map((k) => ({ n: k[0], d: k[1], a: k[2] }));
    return String(spec).trim().split(/\s+/).map((s) => { const p = s.split(':'); return { n: p[0], d: parseFloat(p[1]), a: p[2] }; });
  }
  // A melodic line from beat b of tempo map tm. o: {vel (num | [v0,v1] | fn(u)), leg, tail, art, tr, pan, exact, lean}
  function line(tm, b, inst, spec, o = {}) {
    const L = toks(spec);
    const tot = L.reduce((s, k) => s + k.d, 0);
    let acc = 0;
    for (const k of L) {
      if (k.n !== 'r') {
        const t0 = tm(b), t1 = tm(b + k.d);
        let v = velAt(o.vel, tot > 0 ? acc / tot : 0);
        if (o.lean) v *= 1 + o.lean * Math.min(2, k.d - 1);   // long notes lean in a little
        N(t0, inst, P(k.n) + (o.tr || 0), (t1 - t0) * (o.leg == null ? 1 : o.leg) + (o.tail == null ? 0.06 : o.tail), v, k.a || o.art, o);
      }
      b += k.d; acc += k.d;
    }
    return b;
  }
  // Sustained harmony; common tones are tied across chord changes. prog: [[beats, 'D3 A3', vel?], ...]
  function pad(tm, b, inst, prog, o = {}) {
    const open = new Map();
    const tot = prog.reduce((s, p) => s + p[0], 0);
    const flush = (m, tEnd) => { const q = open.get(m); N(q.t0, inst, m, tEnd - q.t0 + (o.tail == null ? 0.18 : o.tail), q.v, o.art, o); open.delete(m); };
    let acc = 0;
    for (const [d, notes, vv] of prog) {
      const t = tm(b);
      const ms = notes ? PS(notes).map((x) => x + (o.tr || 0)) : [];
      const v = vv != null ? vv : velAt(o.vel, acc / tot);
      for (const m of [...open.keys()]) if (!ms.includes(m) || o.retrig) flush(m, t);
      for (const m of ms) if (!open.has(m)) open.set(m, { t0: t, v });
      b += d; acc += d;
    }
    const tEnd = tm(b);
    for (const m of [...open.keys()]) flush(m, tEnd);
    return b;
  }
  // Broken chords. prog: [[beats, 'D3 A3 D4 F#4', vel?], ...]; one note every `step` beats following
  // `pat` (indices into the sorted chord; index >= size wraps up an octave). o.ring = steps each note rings
  // (damped o.over s after the chord changes).
  function arp(tm, b, inst, prog, step, pat, o = {}) {
    const tot = prog.reduce((s, p) => s + p[0], 0);
    let acc = 0;
    for (const [d, notes, vv] of prog) {
      const ms = PS(notes).sort((x, y) => x - y), L = ms.length;
      let k = 0;
      for (let x = 0; x < d - 1e-6; x += step, k++) {
        const idx = pat[k % pat.length];
        if (idx == null || idx < 0) continue;
        const m = ms[idx % L] + 12 * Math.floor(idx / L);
        const t0 = tm(b + x), tEnd = tm(b + d) + (o.over == null ? 0.12 : o.over);   // damped at the chord change
        const v = (vv != null ? vv : velAt(o.vel, (acc + x) / tot)) * (k === 0 ? 1.08 : 1);
        N(t0, inst, m + (o.tr || 0), Math.min(tm(b + x + step * (o.ring || 2)), tEnd) - t0, v, o.art, o);
      }
      b += d; acc += d;
    }
    return b;
  }
  // Timpani / bass-drum roll from t0 to t1, velocity v0 -> v1. A crescendo is one 'swell' roll
  // (the engine ramps it up to vel at the end); steady or dying rolls are chained 'roll' segments.
  function roll(t0, t1, inst, pitch, v0, v1) {
    const d = t1 - t0;
    if (v1 >= v0 * 1.25) { N(t0, inst, pitch, d, v1, 'swell', X); return; }
    const n = Math.abs(v1 - v0) < 0.08 ? 1 : 3;
    for (let i = 0; i < n; i++) N(t0 + (d * i) / n, inst, pitch, d / n + (i < n - 1 ? 0.03 : 0), U.lerp(v0, v1, (i + 0.5) / n), 'roll', X);
  }
  // cymbal / tam-tam swell peaking exactly at tPeak
  const swellInto = (tPeak, len, inst, vel, pitch) => N(tPeak - len, inst, pitch || (inst === 'tamtam' ? 52 : 49), len, vel, 'swell', X);

  // ------------------------------------------------------------------
  // Themes
  // ------------------------------------------------------------------
  // MAIN THEME (3/4, D major, 16 bars). Bars as line specs; octave = violins' lower octave.
  const THEME = [
    'F#4:2 E4:1', 'D4:2 A4:1', 'B4:3', 'A4:1 F#4:1 E4:1',
    'F#4:2 D5:1', 'C#5:2 B4:1', 'A4:1.5 G4:0.5 F#4:1', 'E4:3',
    'F#4:2 E4:1', 'D4:2 A4:1', 'B4:2 D5:1', 'F#5:3',
    'E5:2 D5:1', 'D5:1.5 C#5:0.5 B4:1', 'E5:2 C#5:1', 'D5:3',
  ];
  const themeBars = (i0, i1, tr = 0) => THEME.slice(i0 - 1, i1).join(' ').split(' ').map((s) => { const p = s.split(':'); return [P(p[0]) + tr, parseFloat(p[1])]; });
  // Main theme harmony per bar: [[beats, bass, cellos, violas/inner], ...]
  const THEME_H = [
    [[3, 'D2', 'D3', 'F#3 A3']], [[3, 'B1', 'D3', 'F#3 A3']], [[3, 'G1', 'D3', 'G3 B3']], [[2, 'A1', 'D3', 'F#3 A3'], [1, 'A1', 'C#3', 'G3 A3']],
    [[3, 'B1', 'D3', 'F#3 B3']], [[2, 'F#1', 'C#3', 'F#3 A3'], [1, 'G1', 'D3', 'G3 B3']], [[3, 'A1', 'D3', 'F#3 A3']], [[1, 'A1', 'D3', 'E3 A3'], [2, 'A1', 'C#3', 'E3 A3']],
    [[3, 'D2', 'D3', 'F#3 A3']], [[3, 'B1', 'D3', 'F#3 A3']], [[2, 'G1', 'D3', 'G3 B3'], [1, 'F#1', 'D3', 'F#3 A3']], [[2, 'B1', 'D3', 'F#3 B3'], [1, 'A1', 'D3', 'F#3 B3']],
    [[3, 'G1', 'E3', 'G3 B3']], [[2, 'F#1', 'D3', 'F#3 A3'], [1, 'G1', 'D3', 'G3 B3']], [[1, 'A1', 'D3', 'E3 A3'], [2, 'A1', 'C#3', 'E3 G3']], [[3, 'D2', 'D3', 'F#3 A3']],
  ];

  // BETHANY — Lowell Mason (1856), 6/4, sixteen bars as [scale degree : beats] (−6 / −5 = below the tonic).
  // "Nearer, my God, to Thee, nearer to Thee! / E'en though it be a cross that raiseth me;
  //  still all my song shall be, nearer, my God, to Thee, / nearer, my God, to Thee, nearer to Thee!"
  const BETHANY = [
    '3:2 2:1 1:2 1:1', '-6:2 1:1 -5:3', '3:2 2:1 1:2 1:1', '2:6',
    '3:2 2:1 1:2 1:1', '-6:2 1:1 -5:3', '1:2 2:1 3:2 2:1', '1:6',
    '5:3 3:2 5:1', '4:2 3:1 2:3', '4:3 2:2 4:1', '3:2 2:1 1:3',
    '3:2 2:1 1:2 1:1', '-6:2 1:1 -5:3', '1:2 2:1 3:2 2:1', '1:6',
  ];
  // Bethany bars (1-based list) -> [[midi, beats], ...] in a key
  function hymn(bars, tonic, scale) {
    const out = [];
    for (const bi of bars) for (const s of BETHANY[bi - 1].split(' ')) { const p = s.split(':'); out.push([deg(+p[0], tonic, scale), parseFloat(p[1])]); }
    return out;
  }
  // Four-part harmonisation in D major (soprano = the tune an octave above written D4 tonic).
  // Per bar: [[beat in bar, 'alto tenor bass'], ...]
  const HB = {
    1: [[0, 'A4 D4 D3'], [2, 'A4 E4 C#3'], [3, 'F#4 D4 B2'], [5, 'F#4 D4 A2']],
    2: [[0, 'G4 D4 G2'], [2, 'F#4 A3 F#2'], [3, 'F#4 D4 D3']],
    3: [[0, 'A4 D4 D3'], [2, 'A4 E4 C#3'], [3, 'F#4 D4 B2'], [5, 'G4 B3 G2']],
    4: [[0, 'G#4 D4 E2'], [3, 'A4 C#4 A2']],
    7: [[0, 'G4 B3 G2'], [3, 'A4 D4 A2'], [5, 'G4 C#4 A2']],
    8: [[0, 'F#4 D4 D3']],
    9: [[0, 'D5 F#4 D3'], [3, 'D5 F#4 B2'], [5, 'D5 A4 F#2']],
    10: [[0, 'D5 B4 G2'], [2, 'D5 A4 F#2'], [3, 'D5 A4 A2'], [4, 'C#5 A4 A2']],
    11: [[0, 'D5 B4 G2'], [3, 'B4 G4 E2'], [5, 'C#5 E4 A2']],
    12: [[0, 'D5 A4 D3'], [2, 'C#5 G4 A2'], [3, 'A4 F#4 D3']],
  };
  HB[5] = HB[1]; HB[6] = HB[2]; HB[13] = HB[1]; HB[14] = HB[2]; HB[15] = HB[7]; HB[16] = HB[8];
  // harmony slots of a list of bars as [[beats, [alto, tenor, bass]], ...]
  function hymnHarm(bars) {
    const out = [];
    for (const bi of bars) {
      const sl = HB[bi];
      sl.forEach((s, i) => out.push([(i + 1 < sl.length ? sl[i + 1][0] : 6) - s[0], PS(s[1])]));
    }
    return out;
  }

  const SEC = (x) => x;   // identity "tempo map": beats are seconds

  // ==================================================================
  // INTRO 0–18 — low D pedal, violin harmonics, harp shimmer; solo cello states the main theme;
  // choir swells into the title at 6 s.
  // ==================================================================
  function intro() {
    A(0, 'drone', 0, 'set'); A(4.5, 'drone', 0.5, 'lin'); A(12.8, 'drone', 0.5, 'set'); A(14.0, 'drone', 0.001, 'lin');
    N(0.0, 'drone', 'D1', 14.1, 0.3);
    N(0.3, 'basses', 'D2', 9.0, 0.3, 'swell');
    N(9.0, 'basses', 'D2', 5.1, 0.32);
    N(14.0, 'basses', 'A1', 4.4, 0.3);
    // divisi harmonics, entering one by one
    N(0.8, 'strings_hi', 'A5', 17.6, 0.2, 'harm');
    N(1.6, 'strings_hi', 'D6', 12.6, 0.17, 'harm');
    N(2.6, 'strings_hi', 'E6', 9.6, 0.14, 'harm');
    N(12.0, 'strings_hi', 'F#6', 2.3, 0.13, 'harm');
    N(14.2, 'strings_hi', 'E6', 4.2, 0.12, 'harm');
    // harp shimmer
    const h = (t, notes, gap, v) => PS(notes).forEach((m, i) => N(t + i * gap, 'harp', m, 2.4, v * (1 - i * 0.04)));
    h(2.0, 'D5 A5 E6', 0.14, 0.16);
    h(3.7, 'F#5 A5 D6', 0.13, 0.15);
    // rising sweep into the title (D major scale, D4 -> D6)
    const sweep = PS('D4 E4 F#4 A4 D5 E5 F#5 A5 D6 E6 F#6');
    sweep.forEach((m, i) => N(5.3 + i * 0.066, 'harp', m, 1.8, 0.12 + i * 0.012));
    chord(6.0, 'harp', 'D2 A2 D3', 5, 0.28, null, X);
    h(9.15, 'B5 D6 G6', 0.15, 0.14);
    h(12.15, 'A5 D6 F#6', 0.15, 0.12);
    PS('A3 C#4 E4 A4 C#5 E5 A5').forEach((m, i) => N(16.1 + i * 0.24, 'harp', m, Math.min(2.5, EV.voyage + 0.1 - (16.1 + i * 0.24)), 0.17 + i * 0.012));
    // the title: choir swell, cymbal swell, a soft timpani roll landing on 6.0
    chord(3.85, 'choir_ooh', 'D3 A3 D4 F#4', 2.4, 0.44, 'swell');
    pad(SEC, 6.0, 'choir_ooh', [[3, 'D3 A3 D4 F#4', 0.4], [3, 'D3 G3 B3 D4', 0.34], [2, 'D3 F#3 A3 D4', 0.3], [3.9, 'C#3 E3 A3 C#4', 0.27]], { tail: 0.15 });
    swellInto(6.0, 2.3, 'cymbal', 0.3);
    roll(4.9, 5.97, 'timpani', 'D2', 0.08, 0.26, { rate: 14 });
    N(6.0, 'timpani', 'D2', 2.5, 0.34, null, X);
    // solo cello: the main theme (q = 60)
    const tc = TM(3.0, [[12, 60], [4, 60, 50]]);
    line(tc, 0, 'solo_cello', 'F#4:2 E4:1 D4:2 A4:1 B4:3 A4:1 F#4:1 E4:3.4', { vel: (u) => 0.46 + 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.15)), lean: 0.05, tail: 0.12 });
    // bridge to the voyage: dominant colour over the pedal
    pad(SEC, 12.0, 'strings_lo', [[2, 'D3 A3', 0.2], [4.0, 'C#3 E3', 0.22]], { tail: 0.12 });
    chord(15.6, 'horns', 'A3 C#4', 2.6, 0.2, 'swell');
  }

  // ==================================================================
  // VOYAGE 18–56 — the main theme in full: warm strings, horns, harp, piano. Broad climax at
  // bar 12 (44 s), thinning, and a darkened chord (Bb/D) at 54 s.
  // ==================================================================
  function voyage() {
    const tm = TM(EV.voyage, [fit(33, 44.0 - EV.voyage), fit(12, 10.0, 0.86), [3, 64, 50]]);
    const bar = (i) => (i - 1) * 3;   // beat of bar i (1-based)
    // --- melody
    line(tm, bar(1), 'strings_hi', themeBars(1, 8), { vel: (u) => 0.56 + 0.12 * Math.sin(Math.PI * u), lean: 0.04, tail: 0.1 });
    line(tm, bar(5), 'strings_lo', themeBars(5, 8, -12), { vel: [0.4, 0.46], tail: 0.1 });
    const climax = (u) => (u < 0.375 ? U.lerp(0.6, 0.86, u / 0.375) : u < 0.6 ? U.lerp(0.86, 0.74, (u - 0.375) / 0.225) : U.lerp(0.74, 0.4, (u - 0.6) / 0.4));
    line(tm, bar(9), 'strings_hi', themeBars(9, 15, 12), { vel: (u) => climax(u * 21 / 24), lean: 0.04, tail: 0.12 });
    line(tm, bar(9), 'strings_mid', themeBars(9, 15), { vel: (u) => 0.9 * climax(u * 21 / 24), tail: 0.1 });
    // horns: a singing countermelody against the theme (its last note darkens to F in bar 16)
    line(tm, bar(9), 'horns', 'A4:3 F#4:2 A4:1 G4:2 A4:1 B4:3 B4:1 D5:2 A4:2 B4:1 A4:1 G4:2', { vel: (u) => 0.4 + 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.2)), lean: 0.04, tail: 0.1 });
    line(tm, bar(11), 'flute', themeBars(11, 13, 12), { vel: [0.22, 0.27], tail: 0.08 });
    // --- harmony
    const slots = (i0, i1) => { const o = []; for (let i = i0; i <= i1; i++) for (const s of THEME_H[i - 1]) o.push(s); return o; };
    const S1 = slots(1, 15);
    pad(tm, 0, 'basses', S1.map((s) => [s[0], s[1]]), { vel: (u) => 0.34 + 0.24 * Math.sin(Math.PI * Math.min(1, u * 1.25)) });
    pad(tm, 0, 'strings_lo', slots(1, 4).map((s) => [s[0], s[2]]), { vel: 0.3 });
    pad(tm, bar(9), 'strings_lo', slots(9, 15).map((s) => [s[0], s[2] + ' ' + s[3].split(' ')[0]]), { vel: (u) => 0.4 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.4)) });
    pad(tm, 0, 'strings_mid', slots(1, 8).map((s) => [s[0], s[3]]), { vel: [0.26, 0.34] });
    pad(tm, 0, 'horns', slots(1, 8).map((s) => [s[0], s[3]]), { vel: [0.16, 0.22] });
    pad(tm, bar(12), 'choir_ooh', slots(12, 14).map((s) => [s[0], s[3].split(' ').map((n) => P(n) + 12).concat(P(s[2]) + 12)]), { vel: [0.3, 0.22], tail: 0.2 });
    // harp arpeggios (bars 1–4, 9–15); piano broken chords (bars 5–8)
    const hc = (s, o) => [s[0], [P(s[2]) + 12, ...PS(s[3]).map((m) => m + 12), P(s[2]) + 24].map((m) => m + (o || 0))];
    arp(tm, 0, 'harp', slots(1, 4).map((s) => hc(s)), 0.5, [0, 1, 2, 3, 2, 1], { vel: 0.19, ring: 1.6 });
    arp(tm, bar(5), 'harp', slots(5, 8).map((s) => [s[0], s[1]]), 3, [0], { vel: 0.24, ring: 0.95 });
    arp(tm, bar(5), 'piano', slots(5, 8).map((s) => hc(s, 12)), 0.5, [0, 2, 1, 3, 2, 1], { vel: [0.13, 0.16], ring: 2 });
    arp(tm, bar(9), 'harp', slots(9, 15).map((s) => hc(s)), 0.5, [0, 1, 2, 3, 4, 3], { vel: (u) => 0.24 - 0.08 * u, ring: 1.6 });
    // climax: timpani roll + cymbal swell into bar 12
    roll(tm(bar(12)) - 1.4, tm(bar(12)) - 0.03, 'timpani', 'F#2', 0.1, 0.36, { rate: 14 });
    N(tm(bar(12)), 'timpani', 'B2', 2.2, 0.42, null, X);
    swellInto(tm(bar(12)), 2.0, 'cymbal', 0.34);
    // --- bar 16: the melody's D held over a darkened Bb/D — a hint of unease
    const t16 = tm(bar(16));
    const d16 = EV.lookout + 0.15 - t16;
    N(t16, 'strings_hi', 'D6', d16 + 0.3, 0.2);
    N(t16, 'basses', 'D2', d16 + 0.3, 0.22);
    chord(t16, 'strings_lo', 'D3 F3', d16, 0.22);
    chord(t16, 'strings_mid', 'Bb3 D4', d16, 0.2);
    N(t16 + 0.05, 'clarinet', 'F4', d16 - 0.1, 0.2);
    N(t16 + 0.05, 'bassoon', 'Bb2', d16 - 0.1, 0.22);
    N(t16, 'harp', 'Bb2', d16, 0.2);
    N(t16, 'horns', 'F4', d16 - 0.1, 0.2);
  }

  // ==================================================================
  // LOOKOUT 56–72 — suspense. High harmonics, a slowing-then-quickening heartbeat, space for the
  // crow's-nest bell (61.6/62.3/63.0) and the phone (63.8), a held stab at 63.8, then a tense
  // 3+3+2 ostinato from the helm order (65.0) that climbs to the impact.
  // ==================================================================
  function lookout() {
    const b1 = EV.bells[0];
    N(EV.lookout + 0.1, 'strings_hi', 'E6', EV.phone + 1.1 - EV.lookout, 0.14, 'harm');
    N(56.3, 'strings_hi', 'A6', EV.phone + 1.2 - 56.3, 0.12, 'harm');
    N(56.0, 'basses', 'D2', b1 - 0.4 - 56.0, 0.12);
    // heartbeat: lub-dub, quickening, stopping clear of the bells
    for (const t of [56.4, 57.9, 59.25, 60.45]) {
      const k = (t - 56) / 5;
      N(t, 'timpani', 'D2', 0.9, 0.15 + 0.08 * k); N(t + 0.27, 'timpani', 'D2', 0.8, 0.1 + 0.05 * k);
      N(t, 'basses', 'D2', 0.4, 0.14 + 0.06 * k, 'pizz');
    }
    // the berg sighted: a low semitone rub that swells and is gone before the first bell
    chord(EV.bergSighted, 'strings_lo', 'D3 Eb3', b1 - 0.35 - EV.bergSighted, 0.18, 'swell');
    N(EV.bergSighted + 0.4, 'bassoon', 'Eb2', b1 - 0.8 - EV.bergSighted, 0.18, 'swell');
    // "Iceberg, right ahead!" — the stab, held as a tremolo that fades toward the helm order
    const ts = EV.phone;
    chord(ts, 'brass_lo', 'D2 A2', 0.9, 0.6, 'marc', X);
    chord(ts, 'horns', 'D4 Eb4', 0.8, 0.66, 'marc', X);
    chord(ts, 'strings_lo', 'D2 D3', 0.5, 0.72, 'marc', X);
    chord(ts, 'strings_mid', 'A3 Eb4', 1.25, 0.46, 'trem', X);
    chord(ts, 'strings_hi', 'D5 Eb5', 1.25, 0.4, 'trem', X);
    N(ts, 'timpani', 'D2', 1.4, 0.66, null, X);
    N(ts, 'bass_drum', 36, 1.6, 0.4, null, X);
    chord(ts, 'piano', 'D1 D2', 1.8, 0.34, null, X);
    // ostinato: 5 bars of 4/4 (q = 133) from the helm order to the impact
    const tm = TM(EV.helm, [fit(20, EV.impact - EV.helm)]);
    const lo = ['D3', 'D3', 'Eb3', 'E3 F3', 'F#3 G3 G#3 A3'];
    for (let i = 0; i < 40; i++) {
      const b = Math.floor(i / 8), j = i % 8, acc = j === 0 || j === 3 || j === 6;
      const choices = lo[b].split(' '), p = choices[Math.min(choices.length - 1, Math.floor((j / 8) * choices.length))];
      const base = U.lerp(0.2, 0.64, Math.pow(i / 39, 1.3));
      const t = tm(i * 0.5);
      if (t > EV.impact - 0.14) break;
      N(t, 'strings_lo', p, acc ? 0.2 : 0.14, base * (acc ? 1.15 : 0.8), acc ? 'marc' : 'stacc');
      if (b >= 2) N(t, 'strings_mid', P(p) + 12, 0.13, base * (acc ? 0.95 : 0.65), acc ? 'marc' : 'stacc');
      if (acc) {
        N(t, 'basses', P(p) - 12, b < 2 ? 0.4 : 0.22, base * 0.85, b < 2 ? 'pizz' : 'marc');
        if (b >= 2) N(t, 'timpani', b < 4 ? 'D2' : 'A2', 0.5, base * 0.6);
      }
    }
    // above it: minor thirds and hollow fifths climbing with the bass, under a high dominant pedal (A)
    line(tm, 4, 'strings_mid', 'F3:4 Gb3:4 G3:2 Ab3:2 A3:1 Bb3:1 B3:1 C4:0.7', { art: 'trem', vel: [0.18, 0.46], tail: 0.02 });
    N(tm(8), 'strings_hi', 'A5', EV.impact - 0.13 - tm(8), 0.4, 'trem');
    N(tm(16), 'strings_hi', 'A4', EV.impact - 0.13 - tm(16), 0.5, 'trem');
    [['Bb3 Eb4', 8, 4], ['B3 E4', 12, 2], ['C4 F4', 14, 2], ['C#4 F#4', 16, 1], ['D4 G4', 17, 1], ['D#4 G#4', 18, 1], ['E4 A4', 19, 0.7]]
      .forEach(([c, b, d], k) => chord(tm(b), 'horns', c, tm(b + d) - tm(b) + 0.03, 0.24 + 0.05 * k, k < 2 ? 'swell' : 'marc'));
    N(tm(12), 'brass_lo', 'A1', EV.impact - 0.12 - tm(12), 0.52, 'swell');
    N(tm(12), 'bass_drum', 36, 1.2, 0.26);
    N(tm(16), 'bass_drum', 36, 1.2, 0.36);
    roll(tm(16), EV.impact - 0.12, 'timpani', 'D2', 0.12, 0.72, { rate: 16, shape: 1.6 });
    swellInto(EV.impact, 2.0, 'cymbal', 0.46);
  }

  // ==================================================================
  // COLLISION 72–92 — a massive dissonant tutti exactly at the impact; descending string clusters
  // through the scrape; then a decaying low drone as the engines stop.
  // ==================================================================
  function collision() {
    const T = EV.impact;
    chord(T, 'basses', 'D1 D2', 1.2, 0.95, 'marc', X);
    chord(T, 'brass_lo', 'D2 A2 Eb3', 2.4, 0.95, 'marc', X);
    chord(T, 'horns', 'D4 Eb4 A4', 2.0, 0.9, 'marc', X);
    chord(T, 'trumpet', 'D5 Eb5', 1.4, 0.84, 'marc', X);
    chord(T, 'strings_lo', 'D2 A2 Eb3', 0.8, 0.95, 'marc', X);
    chord(T, 'strings_mid', 'G#3 D4 Eb4', 3.0, 0.82, 'trem', X);
    chord(T, 'strings_hi', 'A4 Eb5 D6', 3.2, 0.8, 'trem', X);
    N(T, 'timpani', 'D2', 2.6, 1.0, null, X);
    N(T, 'bass_drum', 36, 3.0, 1.0, null, X);
    N(T, 'cymbal', 49, 4.0, 0.88, 'crash', X);
    N(T, 'tamtam', 52, 8.0, 0.92, null, X);
    chord(T, 'piano', 'D1 D2 Eb2 A2', 4.0, 0.6, null, X);
    roll(T + 0.15, T + 2.8, 'timpani', 'D2', 0.55, 0.14, { rate: 15, shape: 0.7 });
    N(T + 0.05, 'basses', 'D1', 4.6, 0.5, 'trem');
    chord(T + 0.1, 'strings_lo', 'D2 Eb3', 4.8, 0.46, 'trem');
    // the scrape: high clusters grinding downward in three waves
    const waves = [[74.9, 3.1, [85, 86, 87, 88], 0.4], [77.6, 3.1, [83, 84, 85, 86], 0.36], [80.3, 3.0, [81, 82, 83, 84], 0.3]];
    for (const [t, d, ms, v] of waves) {
      ms.forEach((m, i) => N(t + i * 0.09, 'strings_hi', m, d, v * (1 - i * 0.06), 'trem'));
      chord(t + 0.3, 'strings_mid', [ms[0] - 22, ms[0] - 21], d - 0.2, v * 0.75, 'swell');
    }
    chord(78.8, 'strings_lo', 'C#2 D2', 4.3, 0.32, 'trem');
    [[76.2, 'D2 Eb2', 2.3, 0.54], [78.8, 'C#2 D2', 2.2, 0.48], [81.2, 'C2 C#2', 1.9, 0.42]].forEach(([t, c, d, v]) => chord(t, 'brass_lo', c, d, v, 'swell'));
    chord(77.0, 'horns', 'A3 Bb3', 2.0, 0.34, 'swell');
    roll(77.4, 79.4, 'timpani', 'D2', 0.12, 0.44, { rate: 14 });
    roll(80.2, 82.2, 'timpani', 'D2', 0.1, 0.36, { rate: 14 });
    N(79.5, 'tamtam', 52, 6, 0.46);
    N(79.5, 'bass_drum', 36, 2, 0.42);
    // scrape ends: a slow chromatic descent to the engines' last breath
    const td = TM(EV.scrapeEnd, [fit(6, EV.engineStop - EV.scrapeEnd)]);
    line(td, 0, 'strings_lo', 'D3:1 C#3:1 C3:1 B2:1 Bb2:1 A2:1', { vel: [0.4, 0.24], tail: 0.08 });
    line(td, 0, 'bassoon', 'D3:1 C#3:1 C3:1 B2:1 Bb2:1 A2:1', { vel: [0.3, 0.2], tail: 0.08 });
    line(td, 2, 'basses', 'C2:1 B1:1 Bb1:1 A1:1', { vel: [0.3, 0.22], tail: 0.08 });
    // engines stop: a low drone decays into the stillness
    const E = EV.engineStop;
    N(E, 'drone', 'D1', 11.5, 0.22);
    A(E, 'drone', 0.7, 'set'); A(E + 11.2, 'drone', 0.15, 'exp');
    chord(E, 'basses', 'D1 A1', 7.5, 0.24);
    N(E, 'timpani', 'D2', 2.5, 0.3, null, X);
    chord(E, 'harp', 'D1 A1', 5, 0.22, null, X);
    chord(E + 0.2, 'strings_lo', 'D2 A2', 6.0, 0.14);
    N(89.4, 'strings_hi', 'A5', 14.6, 0.1, 'harm');
  }

  // ==================================================================
  // STILLNESS 92–118 — eerie calm under the steam roar and the CQD. Very quiet sustained chords,
  // isolated piano notes, then the main theme in D minor on solo cello (104–117.6), resolving to D
  // just as the safety valves fall silent.
  // ==================================================================
  function stillness() {
    pad(SEC, 92.0, 'basses', [[6, 'D2'], [6, 'D2'], [3, 'D2'], [3, 'Bb1'], [3, 'G1'], [3, 'A1'], [1.6, 'A1'], [2.2, 'D2']], { vel: 0.2, tail: 0.3 });
    pad(SEC, 92.0, 'strings_lo', [[6, 'D3 A3'], [6, 'Bb2 F3'], [3, 'D3 A3'], [3, 'D3 F3'], [3, 'D3 G3'], [2, 'D3 F3'], [2.6, 'C#3 E3 G3'], [2.2, 'D3 A3']], { vel: 0.19, tail: 0.3 });
    pad(SEC, 92.0, 'strings_mid', [[6, 'E4 F4'], [6, 'A3 D4'], [3, 'F3'], [3, 'A3'], [3, 'Bb3'], [4.6, 'A3'], [2.2, 'F3']], { vel: 0.16, tail: 0.4 });
    [[93.3, 'A4'], [96.1, 'F4'], [99.7, 'E5'], [101.9, 'D4'], [103.3, 'A3'], [109.6, 'F5'], [115.3, 'E5']].forEach(([t, n], i) => N(t, 'piano', n, Math.min(4.5, 117.5 - t), 0.22 - i * 0.008));
    const tc = TM(104.0, [[20, 60]]);
    line(tc, 0, 'solo_cello', 'F4:2 E4:1 D4:2 A4:1 Bb4:3 A4:1 F4:1 E4:2.6 D4:2.3', { vel: (u) => 0.55 + 0.1 * Math.sin(Math.PI * Math.min(1, u * 1.3)), lean: 0.05, tail: 0.15 });
  }

  // ==================================================================
  // EVACUATION 118–156 — a slowly building D-minor ostinato (harp, pizzicato basses, spiccato
  // strings) in a 3+3+2 lilt, horn calls, rising intensity; the bar grid is fitted so that every
  // rocket burst (launch + 2.3 s) falls on a downbeat and gets an accent. The texture drops low and
  // sustained under the SOS Morse (140.5–~152), then surges to the last burst and stops for the band.
  // ==================================================================
  function evacuation() {
    const B = EV.rockets.map((r) => r + 2.3);
    const beat = (B[3] - B[0]) / 48;
    const tm = TM(B[0] - 8 * beat, [[56, 60 / beat], fit(12, B[4] - B[3], 0.93)]);
    const END = 68;   // beat of the last burst
    // harmony slots [beats, bass, mids]
    const H = [
      [4, 'D2', 'D3 F3 A3'], [4, 'D2', 'D3 F3 A3'], [4, 'D2', 'D3 F3 A3'], [4, 'Bb1', 'D3 F3 Bb3'],
      [4, 'G1', 'D3 G3 Bb3'], [4, 'A1', 'C#3 E3 A3'], [4, 'D2', 'D3 F3 A3'], [4, 'C2', 'C3 F3 A3'],
      [4, 'Bb1', 'D3 F3 Bb3'], [4, 'A1', 'C#3 E3 G3'], [4, 'G1', 'D3 G3 Bb3'], [4, 'F1', 'D3 F3 A3'],
      [4, 'Eb2', 'Eb3 G3 Bb3'], [4, 'A1', 'C#3 E3 G3'], [4, 'D2', 'D3 F3 A3'], [4, 'Bb1', 'D3 F3 Bb3'],
      [2, 'G1', 'D3 G3 Bb3'], [2, 'A1', 'C#3 G3 Bb3'],
    ];
    const starts = []; { let b = 0; for (const h of H) { starts.push(b); b += h[0]; } }
    const slotAt = (b) => { let i = 0; for (let k = 0; k < H.length; k++) if (b >= starts[k] - 1e-9) i = k; return H[i]; };
    const TIMP = { 2: 38, 10: 46, 7: 43, 9: 45, 0: 48, 5: 41, 3: 39, 4: 40, 1: 49, 11: 47, 6: 42, 8: 44 };
    const g = (b) => Math.pow(U.clamp(b / END), 1.15);
    for (let e = 0; e < END * 2; e++) {
      const b = e * 0.5, bar = Math.floor(b / 4) + 1, j = e % 8, acc = j === 0 || j === 3 || j === 6;
      const [, bassN, midsN] = slotAt(b);
      const t = tm(b), gg = g(b), root = P(bassN), fifth = root + 7, mids = PS(midsN).sort((x, y) => x - y);
      // harp
      const hn = mids.map((m) => m + 12).concat(mids[0] + 24);
      N(t, 'harp', hn[[0, 2, 3, 0, 2, 3, 0, 1][j]], 0.9, (0.2 + 0.24 * gg) * (acc ? 1.15 : 0.88));
      // basses: pizzicato, then arco from bar 11
      if (acc) N(t, 'basses', j === 6 ? fifth : root, bar <= 10 ? 0.5 : 0.24, 0.3 + 0.36 * gg, bar <= 10 ? 'pizz' : 'marc');
      // violas spiccato from bar 3
      if (bar >= 3) { const p = mids[[2, 1, 2, 2, 1, 2, 2, 1][j]]; N(t, 'strings_mid', p < 48 ? p + 12 : p, 0.14, (0.22 + 0.4 * gg) * (acc ? 1.2 : 0.84), 'stacc'); }
      // cellos from bar 7
      if (bar >= 7) N(t, 'strings_lo', ([0, 0, 1, 0, 0, 1, 0, 1][j] ? fifth : root) + 12, 0.15, (0.26 + 0.4 * gg) * (acc ? 1.2 : 0.84), 'stacc');
      // violins spiccato bars 7–10 (above the Morse register they leave alone later)
      if (bar >= 7 && bar <= 10) N(t, 'strings_hi', mids[[2, 1, 0, 2, 1, 0, 2, 1][j]] + 24, 0.12, (0.2 + 0.24 * gg) * (acc ? 1.15 : 0.85), 'stacc');
      // timpani on the lilt from bar 11
      if (bar >= 11 && acc && Math.abs(b - 40) > 0.1 && Math.abs(b - 56) > 0.1) N(t, 'timpani', TIMP[root % 12], 0.6, 0.18 + 0.3 * gg);
    }
    // horn calls (bars 3–10)
    line(tm, 8, 'horns', 'D4:1.5 A4:0.5 D5:2 r:0.5 Bb3:1 F4:0.5 Bb4:2', { vel: 0.42, tail: 0.05 });
    line(tm, 24, 'horns', 'A4:1.5 D5:0.5 F5:2 r:0.5 F4:1 C5:0.5 F5:2 F4:1 D5:1 Bb4:2 E4:1 C#5:1 A4:2', { vel: [0.5, 0.56], tail: 0.05 });
    line(tm, 24, 'clarinet', 'F4:1.5 A4:0.5 D5:2 r:0.5 C4:1 F4:0.5 A4:2 D4:1 Bb4:1 F4:2 C#4:1 A4:1 E4:2', { vel: 0.3, tail: 0.05 });
    // under the SOS (bars 11–14): low, sustained, dark
    pad(tm, 40, 'strings_hi', [[4, 'D4 G4'], [4, 'D4 F4'], [4, 'Eb4 G4'], [4, 'E4 G4']], { vel: 0.22 });
    pad(tm, 40, 'choir_ooh', [[4, 'G3 Bb3 D4'], [4, 'F3 A3 D4'], [4, 'G3 Bb3 Eb4'], [4, 'G3 A3 C#4 E4']], { vel: [0.2, 0.28], tail: 0.3 });
    [['G2', 40], ['F2', 44], ['Eb2', 48], ['A1', 52]].forEach(([n, b], k) => N(tm(b), 'brass_lo', n, tm(b + 4) - tm(b), 0.28 + 0.06 * k, 'swell'));
    // the surge (bars 15–17)
    line(tm, 56, 'trumpet', 'A4:1.5 D5:0.5 F5:1 E5:1 D5:1.5 Bb4:0.5 F5:2 G5:1 F5:1 E5:2', { vel: [0.55, 0.8], tail: 0.05 });
    line(tm, 56, 'horns', 'F4:1.5 A4:0.5 D5:1 C#5:1 Bb4:1.5 F4:0.5 D5:2 D5:1 D5:1 C#5:2', { vel: [0.52, 0.76], tail: 0.05 });
    pad(tm, 56, 'strings_hi', [[4, 'D5 A5'], [4, 'D5 F5 Bb5'], [2, 'D5 G5 Bb5'], [2, 'C#5 G5 Bb5']], { art: 'trem', vel: [0.4, 0.66], retrig: true, tail: 0.02 });
    pad(tm, 56, 'choir', [[4, 'D4 F4 A4'], [4, 'D4 F4 Bb4'], [2, 'D4 G4 Bb4'], [2, 'C#4 E4 G4 Bb4']], { vel: [0.36, 0.56], retrig: true, tail: 0.05 });
    [['D2', 56], ['Bb1', 60], ['G1', 64], ['A1', 66]].forEach(([n, b]) => chord(tm(b), 'brass_lo', [P(n), P(n) + 12], tm(b + (b < 64 ? 4 : 2)) - tm(b), 0.5, 'swell'));
    roll(tm(66), B[4] - 0.03, 'timpani', 'A2', 0.2, 0.7, { rate: 16, shape: 1.4 });
    swellInto(B[4], 1.8, 'cymbal', 0.5);
    // accents on the bursts
    const acc = [[0.42, 'D2', 'D2 A2', 'D4 A4'], [0.52, 'D2', 'D2 A2', 'D4 F4 A4'], [0.58, 'G2', 'G1 D2', 'D4 G4 Bb4'], [0.76, 'D2', 'D2 A2 D3', 'D4 F4 A4'], [0.95, 'D2', 'D1 D2 A2', 'D4 F4 A4 D5']];
    B.forEach((t, i) => {
      const [s, tp, low, mid] = acc[i], last = i === B.length - 1;
      N(t, 'timpani', tp, last ? 1.6 : 2, 0.45 + 0.5 * s, null, X);
      N(t, 'bass_drum', 36, last ? 1.6 : 2, 0.28 + 0.6 * s, null, X);
      N(t, 'cymbal', 49, last ? 1.7 : 3, 0.26 + 0.55 * s, 'crash', X);
      chord(t, 'brass_lo', low, 0.7, 0.38 + 0.5 * s, 'marc', X);
      chord(t, 'horns', mid, 0.7, 0.34 + 0.5 * s, 'marc', X);
      chord(t, 'strings_lo', low.split(' ').map((n) => P(n) + 12), 0.3, 0.4 + 0.5 * s, 'marc', X);
      if (s > 0.7) N(t, 'tamtam', 52, last ? 1.8 : 5, 0.5 * s, null, X);
    });
    // the last burst: a D-minor tutti that dies away, leaving the air clear for the band at 158
    const T = B[4];
    chord(T, 'strings_hi', 'D5 F5 A5 D6', 1.8, 0.66);
    chord(T, 'strings_mid', 'F4 A4', 1.8, 0.6);
    chord(T, 'strings_lo', 'D3 A3', 1.9, 0.62);
    N(T, 'basses', 'D2', 1.9, 0.62);
    chord(T, 'choir', 'D4 F4 A4', 1.8, 0.5);
    chord(T, 'trumpet', 'D5', 1.2, 0.66, 'marc');
  }

  // ==================================================================
  // FINAL 156–190 — the band on deck plays "Nearer, My God, to Thee" (D major, q ≈ 100, 6/4):
  // violin melody, second violin alto, cello and bass on the bass line, piano chords. From the held
  // half-cadence of bar 4 the orchestra (non-diegetic) creeps in underneath, swells with funnel 1's
  // fall (bar 7 lands on EV.funnel1Fall, the tonic just after the splash), and as the lights begin
  // to fail the band starts the refrain and falters.
  // ==================================================================
  function finale() {
    const T0 = EV.bandStart;
    const tb = TM(T0, [fit(24, EV.funnel1Fall - 7.2 - T0), fit(12, 7.2), fit(6, EV.funnel1Splash + 0.15 - EV.funnel1Fall), fit(6, 3.9, 0.88), [6, 92]]);
    const bars = [1, 2, 3, 4, 5, 6, 7, 8];
    A(T0 - 1, 'band', 0.95, 'set');
    // the band
    const phr = (u) => { const f = (u * 4) % 1; return 0.44 + 0.08 * Math.sin(Math.PI * f) + 0.05 * u; };
    line(tb, 0, 'band_violin', hymn(bars, 74, MAJ), { vel: phr, lean: 0.03, tail: 0.04 });
    const HS = hymnHarm(bars);
    pad(tb, 0, 'band_violin2', HS.map((s) => [s[0], [s[1][0]]]), { vel: (u) => 0.8 * phr(u), tail: 0.04 });
    pad(tb, 0, 'band_cello', HS.map((s) => [s[0], [s[1][2]]]), { vel: (u) => 0.85 * phr(u), tail: 0.04 });
    pad(tb, 0, 'band_bass', HS.map((s) => [s[0], [s[1][2] - 12 >= 28 ? s[1][2] - 12 : s[1][2]]]), { vel: (u) => 0.8 * phr(u), tail: 0.04 });
    pad(tb, 0, 'band_piano', HS.map((s) => [s[0], [s[1][2], s[1][1], s[1][0]]]), { vel: 0.26, tail: 0.1 });
    // bar 9: "Still all..." — and they falter
    const t9 = tb(48), t9b = tb(51);
    N(t9, 'band_violin', 'A5', t9b - t9 + 0.04, 0.46);
    N(t9b, 'band_violin', 'F#5', 0.42, 0.24);
    N(t9, 'band_violin2', 'D5', tb(50.3) - t9, 0.32);
    N(t9, 'band_cello', 'D3', tb(50.8) - t9, 0.34);
    N(t9, 'band_bass', 'D2', tb(50.5) - t9, 0.32);
    chord(t9, 'band_piano', 'D2 A3 F#4 D5', 1.5, 0.25);
    A(t9b + 0.3, 'band', 0.95, 'set'); A(t9b + 1.4, 'band', 0.001, 'exp');
    // the orchestra joins underneath from the held "Thee" of bar 4
    const HO = hymnHarm([4, 5, 6, 7, 8]);
    let b = 18; const vo = [];
    for (const s of HO) { const u = (b - 18) / 30; vo.push(u < 0.6 ? U.lerp(0.13, 0.32, u / 0.6) : u < 0.8 ? U.lerp(0.32, 0.6, (u - 0.6) / 0.2) : U.lerp(0.58, 0.3, (u - 0.8) / 0.2)); b += s[0]; }
    pad(tb, 18, 'strings_lo', HO.map((s, i) => [s[0], [s[1][2]], vo[i]]), { tail: 0.25 });
    pad(tb, 24, 'basses', HO.slice(2).map((s, i) => [s[0], [s[1][2] - 12], vo[i + 2]]), { tail: 0.25 });
    pad(tb, 18, 'strings_mid', HO.map((s, i) => [s[0], [s[1][1]], vo[i] * 0.95]), { tail: 0.25 });
    const i6 = HO.findIndex((_, i) => HO.slice(0, i).reduce((a, s) => a + s[0], 18) >= 30);
    pad(tb, 30, 'strings_hi', HO.slice(i6).map((s, i) => [s[0], [s[1][0]], vo[i + i6] * 0.9]), { tail: 0.25 });
    pad(tb, 27, 'choir_ooh', HO.slice(4).map((s, i) => [s[0], [s[1][0], s[1][1]], vo[i + 4] * 0.8]), { tail: 0.12 });
    // the surge: funnel 1 falls (bar 7) and hits the water just before the tonic of bar 8
    const tS = EV.funnel1Splash;
    line(tb, 36, 'strings_hi', 'D6:2 E6:1 F#6:2 E6:1 D6:5', { vel: [0.42, 0.56], tail: 0.2 });
    line(tb, 36, 'horns', 'D4:2 E4:1 F#4:2 E4:1 D4:5', { vel: [0.44, 0.5], tail: 0.2 });
    pad(tb, 36, 'brass_lo', [[3, 'G2 D3', 0.28], [2, 'A2 D3', 0.36], [1, 'A2 C#3', 0.42], [5, 'D2 A2', 0.4]], { tail: 0.2 });
    roll(tb(37.5), tS - 0.03, 'timpani', 'A2', 0.1, 0.52, { rate: 15, shape: 1.3 });
    N(tS, 'timpani', 'D2', 2.4, 0.6, null, X);
    swellInto(tS, 2.2, 'cymbal', 0.5);
    PS('D3 E3 F#3 A3 D4 E4 F#4 A4 D5 E5 F#5 A5 D6').forEach((m, i) => N(tS - 0.6 + i * 0.046, 'harp', m, 1.5, 0.2 + i * 0.012));
    // as the lights fail: D major darkens to D minor, low tremolo gathering toward the break
    const t10 = tb(48);
    chord(t10, 'strings_lo', 'D3 A3', 190.1 - t10, 0.22);
    N(t10, 'basses', 'D2', 190.1 - t10, 0.2);
    N(t10, 'strings_mid', 'F#4', 188.3 - t10, 0.2);
    N(188.3, 'strings_mid', 'F4', 1.8, 0.42, 'trem');
    chord(t10, 'strings_hi', 'A4 D5', 190.1 - t10, 0.2);
    chord(t10, 'choir_ooh', 'D4 A4', 188.9 - t10, 0.18);
    N(188.4, 'basses', 'D1', 1.65, 0.45, 'swell');
    roll(188.9, 189.97, 'timpani', 'D2', 0.08, 0.42, { rate: 15 });
    swellInto(190.0, 1.6, 'cymbal', 0.34);
  }

  // ==================================================================
  // BREAK 190–222 — the orchestra takes up the hymn's refrain in D minor as a brass chorale:
  // "Still all my | song shall be" with massive hits on "song" (195, Eb over a D pedal) and "be"
  // (198, A7b9); falling chromatic lines as the bow dives; the stern slam (203.2); a rising
  // sequence on "Nearer, my God" over a climbing bass (205–214); a blazing D-major apex at the
  // vertical (214–216.5); a descending 3-2-1 through the plunge; cut to silence at 221.5.
  // ==================================================================
  function brk() {
    const tk = TM(190, [fit(6, EV.breakStart - 190, 0.9), [6, 60]]);
    const mel = 'A4:3 F4:2 A4:1 G4:2:marc F4:1 E4:3:marc';
    const cres = (u) => (u < 0.5 ? U.lerp(0.55, 0.8, u / 0.5) : U.lerp(0.95, 0.8, (u - 0.5) / 0.5));
    line(tk, 0, 'trumpet', mel, { vel: cres, tail: 0.05 });
    line(tk, 0, 'horns', mel, { vel: (u) => 0.95 * cres(u), tail: 0.05 });
    line(tk, 0, 'strings_hi', mel, { tr: 12, vel: cres, tail: 0.08 });
    line(tk, 0, 'choir', mel, { vel: (u) => 0.85 * cres(u), tail: 0.1 });
    // chorale voices [beats, alto, tenor, bass]
    const CH = [[3, 'F4', 'D4', 'D3'], [2, 'D4', 'Bb3', 'D3'], [1, 'F4', 'D4', 'D3'], [2, 'Eb4', 'Bb3', 'Eb3'], [1, 'D4', 'Bb3', 'D3'], [3, 'C#4', 'G3', 'A2']];
    const cv = [0.5, 0.6, 0.7, 0.9, 0.75, 0.85];
    pad(tk, 0, 'horns', CH.map((c, i) => [c[0], c[1], cv[i] * 0.85]), { tail: 0.05 });
    pad(tk, 0, 'brass_lo', CH.map((c, i) => [c[0], c[2] + ' ' + c[3], cv[i]]), { tail: 0.05 });
    pad(tk, 0, 'strings_mid', CH.map((c, i) => [c[0], c[1] + ' ' + c[2], cv[i] * 0.9]), { tail: 0.1 });
    pad(tk, 0, 'strings_hi', CH.map((c, i) => [c[0], [P(c[1]) + 12], cv[i] * 0.85]), { tail: 0.1 });
    pad(tk, 0, 'strings_lo', CH.map((c, i) => [c[0], [P(c[3]) - 12, P(c[3])].filter((m) => m >= 36), cv[i]]), { tail: 0.1 });
    pad(tk, 0, 'choir', CH.map((c, i) => [c[0], [P(c[1]), P(c[2]), P(c[3])], cv[i] * 0.75]), { tail: 0.15 });
    pad(tk, 0, 'basses', [[9, 'D1 D2', 0.7], [3, 'A1 A2', 0.8]], { tail: 0.1 });
    roll(190.05, 194.95, 'timpani', 'D2', 0.12, 0.62, { rate: 14, shape: 1.3 });
    swellInto(EV.breakStart, 2.4, 'cymbal', 0.6);
    N(EV.breakStart, 'organ', 'D1', 3.0, 0.7, null, X); N(EV.breakStart, 'organ', 'D2', 3.0, 0.62, null, X);
    // hit 1 — she tears open (Eb major over the D pedal)
    const h1 = EV.breakStart;
    N(h1, 'timpani', 'D2', 2, 1.0, null, X); N(h1, 'bass_drum', 36, 2.5, 1.0, null, X);
    N(h1, 'cymbal', 49, 4, 0.95, 'crash', X); N(h1, 'tamtam', 52, 6, 0.9, null, X);
    chord(h1, 'brass_lo', 'D2 Bb2 Eb3 G3', 1.2, 0.95, 'marc', X);
    chord(h1, 'horns', 'Bb3 Eb4 G4', 1.2, 0.9, 'marc', X);
    chord(h1, 'piano', 'D1 D2 Eb2', 3, 0.8, null, X);
    chord(h1, 'strings_lo', 'D2 Eb3', 0.6, 0.95, 'marc', X);
    // hit 2 — the tearing continues
    const h2 = h1 + 1.6;
    N(h2, 'timpani', 'D2', 1.5, 0.78, null, X); N(h2, 'bass_drum', 36, 2, 0.72, null, X);
    chord(h2, 'brass_lo', 'D2 Eb2', 0.7, 0.78, 'marc', X);
    chord(h2, 'strings_lo', 'D2 Eb3', 0.5, 0.72, 'marc', X);
    // hit 3 — the sections part (A7b9)
    const h3 = EV.breakApart;
    N(h3, 'timpani', 'A2', 2, 1.0, null, X); N(h3, 'bass_drum', 36, 2.5, 1.0, null, X);
    N(h3, 'cymbal', 49, 4, 0.9, 'crash', X); N(h3, 'tamtam', 52, 5, 0.85, null, X);
    chord(h3, 'brass_lo', 'A1 E2 G2 C#3', 1.3, 0.95, 'marc', X);
    chord(h3, 'horns', 'C#4 G4 Bb4', 1.2, 0.88, 'marc', X);
    chord(h3, 'piano', 'A0 A1 Bb2', 3, 0.78, null, X);
    chord(h3, 'organ', 'A1 A2', 3.0, 0.62, null, X);
    // the bow dives: trembling A7b9, falling chromatic lines
    chord(h3 + 0.05, 'strings_mid', 'C#4 G4', 3.0, 0.58, 'trem');
    chord(h3 + 0.05, 'strings_hi', 'E5 Bb5', 2.9, 0.55, 'trem');
    line(SEC, h3 + 0.4, 'brass_lo', 'A2:0.7 G#2:0.6 G2:0.6 F#2:0.5 F2:0.6', { vel: [0.62, 0.44], tail: 0.05 });
    line(SEC, h3 + 0.4, 'bassoon', 'A2:0.7 G#2:0.6 G2:0.6 F#2:0.5 F2:0.6', { vel: [0.5, 0.36], tail: 0.05 });
    line(SEC, h3 + 0.6, 'strings_hi', 'Bb5:0.6 A5:0.5 G#5:0.45 G5:0.45 F#5:0.45 F5:0.5', { vel: [0.56, 0.4], tail: 0.05 });
    roll(h3 + 0.2, h3 + 2.8, 'timpani', 'A2', 0.5, 0.14, { rate: 14, shape: 0.7 });
    // the stern falls back: a gathering tremolo into the slam
    const sl = EV.sternSplash;
    chord(201.0, 'strings_lo', 'D2 A2', sl - 0.05 - 201.0, 0.5, 'trem');
    N(201.0, 'basses', 'D1', sl - 0.05 - 201.0, 0.55, 'swell');
    chord(201.4, 'brass_lo', 'D2 A2', sl - 0.05 - 201.4, 0.6, 'swell');
    chord(201.3, 'strings_hi', 'D5 F5', sl - 0.05 - 201.3, 0.5, 'trem');
    chord(201.6, 'choir', 'D4 F4 A4', sl - 0.05 - 201.6, 0.55, 'swell');
    roll(201.6, sl - 0.03, 'timpani', 'D2', 0.1, 0.85, { rate: 16, shape: 1.6 });
    swellInto(sl, 2.0, 'cymbal', 0.7);
    // the slam
    chord(sl, 'basses', 'D1 D2', 2.0, 0.95, 'marc', X);
    chord(sl, 'brass_lo', 'D2 A2 D3 F3', 2.2, 0.95, 'marc', X);
    chord(sl, 'horns', 'D4 F4 A4', 2.0, 0.9, 'marc', X);
    chord(sl, 'trumpet', 'D5 F5', 1.6, 0.88, 'marc', X);
    chord(sl, 'strings_lo', 'D2 A2 D3', 1.9, 0.92, 'marc', X);
    chord(sl, 'strings_mid', 'F3 A3 D4 F4', 1.9, 0.88, null, X);
    chord(sl, 'strings_hi', 'D5 F5 A5 D6', 1.9, 0.88, null, X);
    chord(sl, 'choir', 'A3 D4 F4 A4', 1.9, 0.82, null, X);
    chord(sl, 'organ', 'D1 D2 A2', 1.9, 0.7, null, X);
    chord(sl, 'piano', 'D1 D2', 3, 0.85, null, X);
    N(sl, 'timpani', 'D2', 2.2, 1.0, null, X); N(sl, 'bass_drum', 36, 3, 1.0, null, X);
    N(sl, 'cymbal', 49, 4, 1.0, 'crash', X); N(sl, 'tamtam', 52, 6.5, 1.0, null, X);
    N(sl + 0.1, 'basses', 'D1', 205.3 - sl, 0.34);
    // the stern rises: "Nearer, my God" climbing in sequence over a rising bass
    const ST = [
      [205.0, 2.1, 'D2', 'F4 E4 D4 D4', 'D3 A3 F4', 0.46, ['horns', 'clarinet']],
      [207.1, 2.0, 'F2', 'A4 G4 F4 F4', 'F3 C4 A4', 0.56, ['horns', 'strings_hi']],
      [209.1, 1.9, 'G2', 'Bb4 A4 G4 G4', 'G3 D4 Bb4', 0.66, ['trumpet', 'horns', 'strings_hi']],
      [211.0, 1.8, 'A2', 'C#5 B4 A4 A4', 'A3 E4 C#5', 0.76, ['trumpet', 'horns', 'strings_hi', 'choir']],
    ];
    for (const [t, len, bass, motif, chd, v, insts] of ST) {
      const tt = TM(t, [fit(6, len)]);
      const mm = motif.split(' ');
      for (const inst of insts) line(tt, 0, inst, [[mm[0], 2], [mm[1], 1], [mm[2], 2], [mm[3], 1]], { vel: v, tr: inst === 'strings_hi' ? 12 : 0, tail: 0.05 });
      const end = t + len + (t > 210 ? 0 : 0.05);
      chord(t, 'strings_mid', chd, end - t + 0.1, v * 0.8);
      chord(t, 'strings_lo', [P(bass) + 12], end - t + 0.1, v * 0.85);
      chord(t, 'basses', [P(bass), P(bass) - 12].filter((m) => m >= 24), end - t + 0.1, v * 0.85);
      if (t > 207) { chord(t, 'brass_lo', [P(bass), P(bass) + 12], end - t + 0.1, v * 0.8, 'swell'); N(t, 'bass_drum', 36, 1.5, 0.2 + 0.4 * v, null, X); }
      if (t > 209) chord(t, 'choir', chd, end - t + 0.1, v * 0.7);
    }
    // the last surge: Bb -> C, a rising run into the apex
    chord(212.8, 'strings_mid', 'Bb3 F4 D5', 0.62, 0.84); chord(213.42, 'strings_mid', 'C4 G4 E5', 0.62, 0.9);
    chord(212.8, 'basses', 'Bb1 Bb2', 0.62, 0.84); chord(213.42, 'basses', 'C2 C3', 0.62, 0.9);
    chord(212.8, 'brass_lo', 'Bb1 Bb2 F3', 0.62, 0.84); chord(213.42, 'brass_lo', 'C2 C3 G3', 0.62, 0.9);
    chord(212.8, 'choir', 'Bb3 D4 F4 Bb4', 0.62, 0.7); chord(213.42, 'choir', 'C4 E4 G4 C5', 0.62, 0.76);
    chord(212.8, 'horns', 'F4 Bb4 D5', 0.62, 0.8); chord(213.42, 'horns', 'G4 C5 E5', 0.62, 0.86);
    PS('D5 E5 F5 G5 A5 B5 C#6').forEach((m, i) => { N(212.8 + i * 0.172, 'strings_hi', m, 0.2, 0.7 + 0.03 * i); N(212.8 + i * 0.172, 'flute', m, 0.2, 0.5 + 0.03 * i); });
    line(SEC, 212.8, 'trumpet', 'D5:0.62 E5:0.58', { vel: [0.78, 0.86], tail: 0.02 });
    roll(209.1, 213.97, 'timpani', 'A2', 0.1, 0.82, { rate: 16, shape: 1.5 });
    swellInto(EV.sternVertical, 2.2, 'cymbal', 0.75);
    // the apex: she stands vertical against the stars — D major, full organ, bells
    const V = EV.sternVertical, VP = EV.sternPlunge, VL = VP - V + 0.12;
    chord(V, 'basses', 'D1 D2', VL, 0.95, null, X);
    chord(V, 'brass_lo', 'D2 A2 D3 F#3', VL, 0.95, null, X);
    chord(V, 'horns', 'D4 F#4 A4 D5', VL, 0.9, null, X);
    chord(V, 'trumpet', 'F#5 A5', VL, 0.9, null, X);
    chord(V, 'strings_hi', 'D5 A5 D6 F#6', VL, 0.92, null, X);
    chord(V, 'strings_mid', 'F#4 A4 D5', VL, 0.9, null, X);
    chord(V, 'strings_lo', 'D3 A3 F#4', VL, 0.9, null, X);
    chord(V, 'choir', 'D4 F#4 A4 D5', VL, 0.9, null, X);
    chord(V, 'organ', 'D1 D2 A2 D3 F#3', VL - 0.05, 0.74, null, X);
    chord(V, 'bells', 'A4 D5', VL - 0.1, 0.7, null, X);
    N(V, 'timpani', 'D2', 1.5, 1.0, null, X); roll(V + 0.1, VP - 0.05, 'timpani', 'D2', 0.55, 0.72, { rate: 15 });
    N(V, 'cymbal', 49, 3, 1.0, 'crash', X); N(V + 0.3, 'cymbal', 49, VP - V - 0.3, 0.42, 'roll');
    N(V, 'tamtam', 52, EV.sternGone - V - 0.05, 1.0, null, X); N(V, 'bass_drum', 36, 3, 1.0, null, X);
    // the plunge: 3-2-1 descending over Bb - A7 - Dm, gathering to a cut at sternGone
    const G = EV.sternGone, pA = VP + 1.8, pD = VP + 3.3;
    line(SEC, VP, 'trumpet', `F5:${pA - VP} E5:${pD - pA} D5:${G - pD}`, { vel: [0.82, 0.9], tail: -0.02 });
    line(SEC, VP, 'strings_hi', `F6:${pA - VP} E6:${pD - pA} D6:${G - pD}`, { vel: [0.82, 0.9], tail: -0.02 });
    line(SEC, VP, 'choir', `F5:${pA - VP} E5:${pD - pA} D5:${G - pD}`, { vel: [0.75, 0.85], tail: -0.02 });
    line(SEC, VP, 'strings_mid', 'D5:0.55 C#5:0.55 C5:0.55 B4:0.55 Bb4:0.55 A4:' + (G - VP - 2.75).toFixed(2), { vel: [0.8, 0.86], tail: -0.02 });
    pad(SEC, VP, 'basses', [[pA - VP, 'Bb1 Bb0', 0.82], [pD - pA, 'A1 A0', 0.84], [G - pD, 'D1 D2', 0.92]].map((s) => [s[0], PS(s[1]).filter((m) => m >= 24), s[2]]), { tail: -0.02 });
    pad(SEC, VP, 'brass_lo', [[pA - VP, 'Bb1 F2 Bb2 D3', 0.82], [pD - pA, 'A1 E2 G2 C#3', 0.84], [G - pD, 'D2 A2 D3 F3', 0.92]], { tail: -0.02 });
    pad(SEC, VP, 'horns', [[pA - VP, 'D4 F4 Bb4', 0.8], [pD - pA, 'C#4 G4 A4', 0.82], [G - pD, 'D4 F4 A4', 0.9]], { tail: -0.02 });
    pad(SEC, VP, 'strings_lo', [[pA - VP, 'Bb2 F3 D4', 0.82], [pD - pA, 'A2 E3 C#4', 0.84], [G - pD, 'D3 A3 F4', 0.92]], { tail: -0.02 });
    pad(SEC, VP, 'choir', [[pA - VP, 'Bb3 D4 F4', 0.7], [pD - pA, 'A3 C#4 G4', 0.72], [G - pD, 'A3 D4 F4', 0.8]], { tail: -0.02 });
    chord(pD, 'organ', 'D1 D2 A2', G - pD - 0.02, 0.7);
    N(VP, 'bells', 'D5', pA - VP - 0.05, 0.5, null, X);
    N(pD, 'bass_drum', 36, 1.6, 0.8);
    roll(pD + 0.05, G - 0.06, 'timpani', 'D2', 0.4, 0.92, { rate: 17, shape: 1.3 });
    N(pD + 0.2, 'cymbal', 49, G - pD - 0.25, 0.62, 'swell');
    A(G - 0.2, 'music', 1, 'set'); A(G + 0.12, 'music', 0.001, 'exp'); A(EV.silence + 3.3, 'music', 1, 'set');
    // …and the hall's tail with it: true silence until the lone violin
    A(G - 0.2, 'reverb', 1, 'set'); A(G + 0.3, 'reverb', 0.001, 'exp'); A(EV.silence + 3.3, 'reverb', 1, 'set');
  }

  // ==================================================================
  // SILENCE 222–240 — nothing for four seconds; then one violin, very high and very slow, sings
  // "Nearer, my God, to Thee" over a faint open-fifth pedal, and is left hanging on the dominant.
  // ==================================================================
  function silence() {
    const t0 = EV.silence + 4.3;
    A(t0 - 1.0, 'drone', 0.001, 'set'); A(t0 + 3.0, 'drone', 0.14, 'lin');
    chord(t0 - 0.8, 'drone', 'D2 A2', EV.underwater - 0.4 - (t0 - 0.8), 0.2);
    const ts = TM(t0, [[6, 56, 54], [6, 54, 48]]);
    line(ts, 0, 'solo_violin', hymn([1, 2], 86, MAJ), { vel: (u) => 0.4 + 0.1 * Math.sin(Math.PI * u), lean: 0.04, tail: 0.3 });
  }

  // ==================================================================
  // DEEP 240–262 — drones, low choir clusters, celesta/harp droplets like marine snow, a pressure
  // crescendo into the seabed impact (255.5), and hushed wonder when the ROV lights come on.
  // ==================================================================
  function deep() {
    const U0 = EV.underwater, AB = EV.abyss, SB = EV.seabedImpact, RV = EV.rov;
    A(U0 - 0.3, 'drone', 0.3, 'set'); A(SB - 0.2, 'drone', 0.8, 'lin'); A(SB + 3, 'drone', 0.35, 'lin'); A(EV.dawn - 0.5, 'drone', 0.03, 'lin');
    N(U0, 'drone', 'D1', SB - U0 + 4, 0.5);
    N(U0 + 0.3, 'basses', 'D1', SB - 0.1 - U0 - 0.3, 0.15);
    chord(U0 + 0.8, 'choir_ooh', 'D3 E3 F3', AB + 0.4 - U0 - 0.8, 0.2);
    chord(AB, 'choir_ooh', 'C3 D3 Eb3 A3', SB - 0.08 - AB, 0.26, 'swell');
    // marine snow
    const SNOW = PS('D6 E6 F6 A6 C7 D7 E7 A5');
    for (let t = U0 + 1.0, k = 0; t < SB - 1.5; k++) {
      const inst = k % 3 === 2 ? 'harp' : 'celesta';
      const m = SNOW[Math.floor(U.hash1(k * 31 + 7) * SNOW.length)] - (inst === 'harp' ? 12 : 0);
      N(t, inst, m, 2.4, 0.1 + 0.12 * U.hash1(k * 17 + 3));
      t += 0.5 + 1.0 * U.hash1(k * 13 + 1);
    }
    // pressure
    chord(248.0, 'strings_lo', 'D2 Eb2', SB - 0.08 - 248.0, 0.5, 'swell');
    chord(249.0, 'strings_mid', 'A3 Bb3', SB - 0.08 - 249.0, 0.4, 'trem');
    chord(250.0, 'brass_lo', 'D1 A1', SB - 0.08 - 250.0, 0.55, 'swell');
    chord(249.5, 'organ', 'D1 A1', SB - 0.08 - 249.5, 0.4, 'swell');
    roll(251.0, SB - 0.04, 'timpani', 'D2', 0.06, 0.72, { rate: 15, shape: 2 });
    roll(253.6, SB - 0.05, 'bass_drum', 36, 0.06, 0.4, { rate: 12, shape: 2 });
    swellInto(SB, 2.4, 'cymbal', 0.45);
    // the bow ploughs into the seabed
    N(SB, 'timpani', 'D2', 3, 1.0, null, X);
    chord(SB, 'basses', 'D1 D2', 3.2, 0.95, 'marc', X);
    N(SB, 'tamtam', 52, 6, 1.0, null, X); N(SB, 'bass_drum', 36, 3, 1.0, null, X);
    chord(SB, 'brass_lo', 'D1 D2', 2.6, 0.9, 'marc', X);
    chord(SB, 'organ', 'D1 D2 A2', 3.4, 0.7, null, X);
    chord(SB, 'piano', 'D1 A1', 4, 0.7, null, X);
    N(SB + 0.2, 'strings_lo', 'D2', RV + 4.5 - SB, 0.2);
    // ROV lights: hushed wonder (D major, harmonics, a celesta memory of the main theme)
    const e = EV.dawn + 0.3 - RV;
    chord(RV, 'strings_hi', 'D6 A6', e, 0.16, 'harm'); N(RV + 0.6, 'strings_hi', 'E6', e - 0.6, 0.12, 'harm');
    chord(RV + 0.2, 'choir_ooh', 'A4 D5 E5 F#5', e, 0.2);
    chord(RV, 'strings_lo', 'D3 A3', e + 0.2, 0.15);
    PS('D4 A4 E5 F#5 A5').forEach((m, i) => N(RV + 0.1 + i * 0.22, 'harp', m, 3, 0.18));
    line(TM(RV + 0.6, [[6.5, 70, 64]]), 0, 'celesta', 'F#6:2 E6:1 D6:2 A6:1.5', { vel: 0.26, tail: 0.6 });
  }

  // ==================================================================
  // DAWN 262–292 — the hymn reborn in D major: horns, then violins and choir, a noble full cadence
  // (~285.5). Bars 1–2, 9–10, 15–16 of Bethany: "Nearer, my God, to Thee… still all my song shall
  // be… nearer to Thee".
  // ==================================================================
  function dawn() {
    const D0 = EV.dawn;
    PS('D3 F#3 A3 D4 F#4 A4 D5 F#5 A5 D6').forEach((m, i) => N(D0 + 0.1 + i * 0.17, 'harp', m, 3, 0.2 + 0.015 * i));
    chord(D0, 'strings_lo', 'D3 A3', 2.2, 0.3, 'swell'); N(D0, 'basses', 'D2', 2.2, 0.28, 'swell');
    chord(D0 + 0.2, 'strings_mid', 'F#4 A4', 2.0, 0.26, 'swell'); N(D0 + 0.4, 'strings_hi', 'D5', 1.9, 0.24, 'swell');
    const td = TM(D0 + 2.0, [[12, 86], [12, 84], fit(6, 4.6, 0.84)]);
    // melody
    line(td, 0, 'horns', hymn([1, 2], 62, MAJ), { vel: [0.42, 0.5], lean: 0.04, tail: 0.1 });
    line(td, 0, 'strings_mid', hymn([1, 2], 62, MAJ), { vel: 0.28, tail: 0.1 });
    line(td, 12, 'strings_hi', hymn([9, 10], 74, MAJ), { vel: [0.48, 0.62], lean: 0.04, tail: 0.12 });
    line(td, 12, 'horns', hymn([9, 10], 62, MAJ), { vel: [0.46, 0.56], tail: 0.1 });
    line(td, 24, 'strings_hi', hymn([15], 74, MAJ), { vel: [0.64, 0.7], lean: 0.04, tail: 0.1 });
    line(td, 24, 'flute', hymn([15], 86, MAJ), { vel: 0.34, tail: 0.1 });
    line(td, 24, 'horns', hymn([15], 62, MAJ), { vel: [0.58, 0.62], tail: 0.1 });
    line(td, 24, 'trumpet', hymn([15], 74, MAJ), { vel: [0.38, 0.44], tail: 0.1 });
    line(td, 24, 'choir', hymn([15], 74, MAJ), { vel: [0.48, 0.54], tail: 0.1 });
    // harmony (four-part, voiced for the orchestra)
    const HS = hymnHarm([1, 2, 9, 10, 15]);
    let bb = 0;
    const SL = HS.map((s) => { const v = bb < 12 ? 0.27 : bb < 24 ? U.lerp(0.32, 0.46, (bb - 12) / 12) : U.lerp(0.5, 0.62, (bb - 24) / 6); const r = { b: bb, d: s[0], v: s[1], vel: v }; bb += s[0]; return r; });
    const from = (b0, b1) => SL.filter((s) => s.b >= b0 && s.b < b1);
    const pp = (arr, f, k = 1) => arr.map((s) => [s.d, f(s.v), s.vel * k]);
    pad(td, 0, 'basses', pp(SL, (v) => [v[2] - 12]), { tail: 0.3 });
    pad(td, 0, 'strings_lo', pp(SL, (v) => [v[2]]), { tail: 0.3 });
    pad(td, 0, 'strings_hi', pp(from(0, 12), (v) => [v[0]], 0.8), { tail: 0.3 });
    pad(td, 12, 'strings_hi', pp(from(12, 30), (v) => [v[0]], 0.85), { tail: 0.3 });
    pad(td, 12, 'strings_mid', pp(from(12, 30), (v) => [v[1]], 0.95), { tail: 0.3 });
    pad(td, 12, 'choir_ooh', pp(from(12, 24), (v) => [v[0], v[1]], 0.75), { tail: 0.4 });
    pad(td, 24, 'choir', pp(from(24, 30), (v) => [v[0], v[1], v[2] + 12], 0.8), { tail: 0.3 });
    pad(td, 24, 'brass_lo', pp(from(24, 30), (v) => [v[2], v[1] - 12], 0.6), { tail: 0.2 });
    arp(td, 0, 'harp', SL.map((s) => [s.d, [...new Set([s.v[2] + 12, s.v[1], s.v[0], s.v[0] + 12])], 0.2 + s.vel * 0.25]), 0.5, [0, 1, 2, 3, 2, 1], { ring: 3 });
    // the cadence
    const tC = td(30);
    roll(td(28.5), tC - 0.03, 'timpani', 'A2', 0.12, 0.48, { rate: 15, shape: 1.3 });
    swellInto(tC, 2.2, 'cymbal', 0.4);
    const L = 2.8;
    N(tC, 'timpani', 'D2', 2.5, 0.52, null, X);
    chord(tC, 'basses', 'D1 D2', L, 0.6, null, X);
    chord(tC, 'strings_lo', 'D3 A3', L, 0.6, null, X);
    chord(tC, 'strings_mid', 'F#4 A4 D5', L, 0.58, null, X);
    chord(tC, 'strings_hi', 'D5 F#5 A5 D6', L, 0.62, null, X);
    chord(tC, 'horns', 'D4 F#4 A4', L, 0.56, null, X);
    N(tC, 'trumpet', 'D5', L, 0.44, null, X);
    chord(tC, 'brass_lo', 'D2 A2 D3', L, 0.46, null, X);
    chord(tC, 'choir', 'D4 F#4 A4 D5', L, 0.52, null, X);
    N(tC, 'flute', 'D6', L, 0.34, null, X);
    N(tC, 'cymbal', 49, 3, 0.3, 'crash', X);
    PS('D2 A2 D3 F#3 A3 D4 F#4 A4 D5').forEach((m, i) => N(tC + i * 0.09, 'harp', m, 3.5, 0.3));
    // …and settles, very quietly, under the piano
    const tq = tC + L - 0.1;
    N(tq, 'basses', 'D2', 3.0, 0.14); chord(tq, 'strings_lo', 'D3 A3', 3.0, 0.15);
    chord(tq, 'strings_mid', 'F#4 A4', 2.9, 0.13); N(tq, 'strings_hi', 'D5', 2.8, 0.12);
  }

  // ==================================================================
  // END 288.6–304.5 — solo piano: the main theme's opening (F# E | D A | B) turning into a plagal
  // "Amen" (G -> D); a last D-major chord with a high string harmonic; silence by 304.5.
  // ==================================================================
  function ending() {
    const tp = TM(288.6, [[9, 58], [6, 52, 40]]);
    line(tp, 0, 'piano', 'F#5:2 E5:1 D5:2 A5:1 B5:3 A5:6', { vel: (u) => 0.46 - 0.12 * u, lean: 0.04, tail: 0.4 });
    pad(tp, 0, 'piano', [[3, 'D3 A3'], [3, 'B2 F#3 A3'], [3, 'G2 D3 B3 D4'], [6, 'D2 A2 F#3 D4']], { vel: [0.29, 0.22], tail: 0.12 });
    const tB = tp(3), tG = tp(6), tD = tp(9);
    chord(tB + 0.1, 'strings_lo', 'B2 F#3', tG - tB + 0.2, 0.11); chord(tB + 0.2, 'strings_mid', 'A3 D4', tG - tB + 0.1, 0.09);
    chord(tG, 'strings_lo', 'G2 D3', tD - tG + 0.4, 0.12); chord(tG, 'strings_mid', 'B3 D4', tD - tG + 0.4, 0.1);
    N(tD, 'basses', 'D2', 6.3, 0.12); chord(tD, 'strings_lo', 'D3 A3', 6.3, 0.13); chord(tD, 'strings_mid', 'F#3 D4', 6.2, 0.1);
    chord(tD + 0.4, 'strings_hi', 'A6 D7', 5.9, 0.12, 'harm');
    A(DUR - 1.6, 'music', 1, 'set'); A(DUR - 0.55, 'music', 0.001, 'exp');
    A(DUR - 1.6, 'reverb', 1, 'set'); A(DUR - 0.3, 'reverb', 0.001, 'exp');
  }

  // ------------------------------------------------------------------
  // Assembly
  // ------------------------------------------------------------------
  const SECTIONS = [
    { t0: 0, t1: 18, name: 'Prelude', desc: 'Low D pedal, divisi violin harmonics, harp shimmer; solo cello states the main theme; choir and cymbal swell into the title.' },
    { t0: 18, t1: 56, name: 'Maiden Voyage', desc: 'The main theme in full (3/4, D major): warm strings, horns, harp and piano; broad climax at 44 s, thinning to a darkened Bb/D at 54 s.' },
    { t0: 56, t1: 72, name: 'The Lookout', desc: 'High harmonics and a heartbeat; space for the bells and the phone; a held stab at 63.8; a 3+3+2 ostinato climbing from the helm order.' },
    { t0: 72, t1: 92, name: 'Collision', desc: 'Dissonant tutti exactly at 74.0 (tam-tam, timpani, low brass); descending tremolo clusters through the scrape; a decaying drone as the engines stop.' },
    { t0: 92, t1: 118, name: 'Engines Stopped', desc: 'Eerie pianissimo chords and isolated piano notes under the steam and CQD; the main theme in D minor on solo cello, resolving as the valves fall silent.' },
    { t0: 118, t1: 156, name: 'Lifeboats and Rockets', desc: 'A building D-minor ostinato (harp, pizzicato, spiccato), horn calls, accents on every rocket burst; low and dark under the SOS; a surge to the last burst.' },
    { t0: 156, t1: 190, name: 'The Band Plays On', desc: 'The band plays "Nearer, My God, to Thee" in D major; the orchestra creeps in beneath, swells with funnel 1; the band falters as the lights fail.' },
    { t0: 190, t1: 222, name: 'The Final Plunge', desc: 'The hymn refrain in D minor as a brass chorale; hits at 195/196.6/198 and the stern slam 203.2; a rising sequence to a D-major apex at the vertical; 3-2-1 down; cut at 221.5.' },
    { t0: 222, t1: 240, name: 'Silence', desc: 'Four seconds of nothing, then one high solo violin sings "Nearer, my God, to Thee" over a faint open fifth.' },
    { t0: 240, t1: 262, name: 'The Deep', desc: 'Drones, low choir clusters, celesta and harp droplets; a pressure crescendo to the seabed impact (255.5); hushed D-major wonder for the ROV lights.' },
    { t0: 262, t1: 292, name: 'Carpathia', desc: 'The hymn reborn in D major — horns, violins, choir, harp — to a noble full cadence at ~285.5.' },
    { t0: 292, t1: 305, name: 'In Memoriam', desc: 'Solo piano: the main theme’s opening becomes a plagal "Amen"; a last D-major chord with a high harmonic; silence by 304.5.' },
  ];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  function finalize() {
    const END_T = DUR - 0.7;
    const out = [];
    EVS.forEach((e, i) => {
      const I = INST[e.inst];
      if (!I) throw new Error('unknown instrument ' + e.inst);
      const t = Math.max(0, e.t + (e.x ? 0 : (U.hash1(i * 7919 + 13) * 2 - 1) * I[3]));
      if (t >= END_T - 0.05) return;
      const dur = Math.max(0.03, Math.min(e.dur, END_T - t));
      const vel = U.clamp(e.vel * (e.x ? 1 : 1 + (U.hash1(i * 104729 + 7) * 2 - 1) * 0.04), 0.01, 1);
      const pan = e.pan != null ? e.pan : U.clamp(I[0] + (U.hash1(e.midi * 131 + 17) - 0.5) * 0.12, -1, 1);
      const ev = { t: r3(t), inst: e.inst, midi: e.midi, dur: r3(dur), vel: r3(vel), pan: Math.round(pan * 100) / 100 };
      if (e.art) ev.art = e.art;
      out.push(ev);
    });
    out.sort((a, b) => a.t - b.t || a.midi - b.midi);
    return out;
  }

  const score = { order: 3, events: [], automation: [], sections: SECTIONS, key: 'D', instruments: INST };
  try {
    A(0, 'band', 1, 'set'); A(0, 'reverb', 1, 'set');
    // music level shaping (mix): a hushed prelude, a broad, majestic voyage, then back to unity
    A(0, 'music', 0.62, 'set'); A(16.5, 'music', 0.62, 'set'); A(19.5, 'music', 1.1, 'lin');
    A(36, 'music', 1.1, 'set'); A(41.5, 'music', 1.35, 'lin'); A(47, 'music', 1.35, 'set'); A(52.5, 'music', 1, 'lin');
    intro(); voyage(); lookout(); collision(); stillness(); evacuation(); finale(); brk(); silence(); deep(); dawn(); ending();
    score.events = finalize();
    score.automation = AUTO.map((a, i) => ({ ...a, i })).sort((a, b) => a.t - b.t || a.i - b.i).map(({ t, target, value, ramp }) => ({ t: r3(t), target, value, ramp }));
  } catch (e) { TT.error('score', e); }
  TT.register('score', score);
})();
