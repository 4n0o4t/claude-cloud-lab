import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
const ADDONS = { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, BokehPass, SMAAPass, FXAAShader,
  BufferGeometryUtils, ImprovedNoise, SimplexNoise, RoundedBoxGeometry, ConvexGeometry, Reflector, Lensflare, LensflareElement };

// ==== FILE: src/00_core.js ====
// =====================================================================
// 00_core.js — namespace, constants, hull form, utilities, GLSL chunks,
// Morse timing, master clock.
// Owner: integration (shared by every module). Do not redeclare `TT`.
// =====================================================================
const TT = (window.TT = window.TT || {});
TT.THREE = THREE;
TT.addons = ADDONS; // provided by the template's import block
TT.modules = [];
TT.errors = [];

// ---------------------------------------------------------------------
// URL parameters (debug + testing)
//   t=SECONDS      start (or freeze) at story time
//   freeze=1       hold story time at `t` (ambient motion still animates via ctx.realTime)
//   autoplay=1     skip the start screen and run the visual timeline (no audio)
//   cam=px,py,pz,tx,ty,tz[,fov]   override the director camera (world coords)
//   q=low|medium|high             quality tier
//   nofx=1         bypass post-processing
//   hideui=1       hide the overlay UI
//   synth=1        force synthesized instruments (skip sample loading)
//   debug=1        verbose logging + on-screen error panel
//   warm=SECONDS   (freeze mode) simulate this many seconds of time before `t` so stateful
//                  effects are warmed up (default 0; modules should be time-pure anyway)
// ---------------------------------------------------------------------
TT.params = (() => {
  const out = {};
  try {
    const sp = new URLSearchParams(location.search);
    for (const [k, v] of sp.entries()) out[k] = v;
  } catch (e) { /* ignore */ }
  return out;
})();
TT.debug = TT.params.debug === '1';

TT.log = (...a) => { if (TT.debug) console.log('[TT]', ...a); };
TT.warn = (...a) => console.warn('[TT]', ...a);
TT.error = (where, err) => {
  TT.errors.push({ where, message: String((err && err.stack) || err) });
  console.error('[TT] ' + where + ':', err);
};

// Module registry. Every module file calls TT.register(name, obj).
// obj may implement: order (number), async init(ctx), update(t, dt, ctx), resize(w, h, ctx)
TT.register = function (name, mod) {
  mod.name = name;
  if (mod.order == null) mod.order = 50;
  TT[name] = mod;
  TT.modules.push(mod);
  return mod;
};

// Tiny event bus: 'play', 'pause', 'seek', 'start', 'end', 'ready', 'progress'
TT._listeners = {};
TT.on = (evt, fn) => { (TT._listeners[evt] = TT._listeners[evt] || []).push(fn); };
TT.emit = (evt, data) => {
  for (const fn of TT._listeners[evt] || []) {
    try { fn(data); } catch (e) { TT.error('event ' + evt, e); }
  }
};

// ---------------------------------------------------------------------
// World constants — 1 unit = 1 metre, +Y up, sea level y = 0.
//
// RENDER FRAME: the ship's midship origin sits at x = z = 0 while it steams; the sea
// scrolls past it (S.ship.travel). Heading 0 = bow toward +X. Positive heading turns
// the bow toward -Z (to port). Compass: +X = WEST (she was bound for New York),
// -X = EAST (dawn), +Z = NORTH (aurora, the Californian), -Z = SOUTH.
//
// SHIP-LOCAL FRAME: +X = bow (forward), +Y = up, +Z = STARBOARD, -Z = PORT.
// Waterline y = 0 at the design draft, keel y = -10.5.
// ---------------------------------------------------------------------
TT.V3 = (x, y, z) => new THREE.Vector3(x, y, z);
TT.CONST = ((V3) => {
  const SHIP = {
    LENGTH: 269.0,
    STEM_X: 134.0,          // vertical stem (waterline and deck)
    STERN_X: -134.5,        // after end of the counter stern at deck level
    STERN_WL_X: -128.5,     // where the counter meets the waterline
    STERNPOST_X: -124.0,    // keel ends / sternpost
    HALF_BEAM: 14.1,
    KEEL_Y: -10.5,
    // Deck levels (y above waterline)
    WELL_DECK_Y: 12.2,      // forward & aft well decks (C deck)
    HULL_TOP_Y: 15.0,       // top of the black hull amidships = A-deck (promenade) floor
    FORECASTLE_Y: 16.6,     // forecastle deck at its after end (rises to 17.8 at the stem)
    POOP_Y: 15.8,           // poop deck at its fore end (rises to 16.6 at the stern)
    BOAT_DECK_Y: 19.8,      // boat deck (top of the white superstructure side)
    DECKHOUSE_TOP_Y: 22.6,  // roofs of the boat-deck houses / funnel casings
    // Longitudinal layout (ship-local x)
    FORECASTLE_X: [97, 134.0],
    FWD_WELL_X: [66, 97],
    SUPERSTRUCTURE_X: [-62, 66], // boat deck / white superstructure extent
    AFT_WELL_X: [-104, -80],
    POOP_X: [-134.5, -104],
    BRIDGE_X: 64.0,              // front of the wheelhouse / bridge wings
    FUNNEL_X: [40.5, 16.2, -8.1, -32.4],
    FUNNEL_BASE_Y: 22.6,
    FUNNEL_TOP_Y: 43.5,
    FUNNEL_RX: 3.75,             // half-length of the elliptical funnel section (along x)
    FUNNEL_RZ: 2.9,              // half-width (along z)
    FUNNEL_RAKE: 4.5 * Math.PI / 180, // funnels and masts rake aft
    FOREMAST_X: 88.0,
    MAINMAST_X: -80.0,
    FOREMAST_TOP_Y: 60.0,
    MAINMAST_TOP_Y: 57.0,
    CROWS_NEST: V3(88.6, 29.0, 0),
    BREAK_X: -24.0,              // she breaks between funnels 3 and 4
    // Propellers: two 3-bladed wing screws + one 4-bladed centre screw, rudder behind
    PROP_WING: [V3(-117.5, -5.6, 7.2), V3(-117.5, -5.6, -7.2)],
    PROP_WING_R: 3.6,
    PROP_CENTER: V3(-122.5, -6.4, 0),
    PROP_CENTER_R: 2.6,
    RUDDER_X: -126.0,
    // Lifeboat slots (boat centre when stowed on the boat deck). 16 wooden boats,
    // odd numbers starboard (+Z), even numbers port (-Z). Index i = boat number - 1.
    BOAT_LEN: 9.1, BOAT_BEAM: 2.8, BOAT_DEPTH: 1.2,
    BOAT_SLOTS: (() => {
      const xs = [62, 55, 48, 41, -40, -47, -54, -61];
      const out = [];
      for (let n = 1; n <= 16; n++) {
        const pair = Math.floor((n - 1) / 2); // boats 1&2, 3&4 ...
        const side = n % 2 === 1 ? 1 : -1;
        out.push({ number: n, side, local: V3(xs[pair], 21.1, side * 12.6) });
      }
      return out;
    })(),
    ROCKET_LAUNCHER: V3(63.5, 21.6, 13.6), // starboard bridge wing rail
  };
  return {
    DURATION: 305,
    SHIP,
    SEABED_Y: -3800,
    CAMERA: { near: 0.3, far: 32000, fov: 38 },
    // Baseline night lighting (the sky module owns the actual lights; main creates these
    // as a fallback when sky is absent so every module can be tuned against the same light).
    LIGHT: {
      starKey: { color: 0x8fa6d6, intensity: 0.55, dir: V3(0.35, 0.8, 0.45) },   // cold starlight "key"
      hemi: { sky: 0x2a3a5c, ground: 0x05080d, intensity: 0.55 },
      exposure: 1.0,
    },
    COMPASS: { WEST: V3(1, 0, 0), EAST: V3(-1, 0, 0), NORTH: V3(0, 0, 1), SOUTH: V3(0, 0, -1) },
  };
})(TT.V3);

// ---------------------------------------------------------------------
// Render layers. The main camera sees layers 0 and NO_REFLECT; the ocean's reflection
// camera sees only layer 0, so put things that must not appear in the mirror on NO_REFLECT.
// ---------------------------------------------------------------------
TT.LAYERS = { DEFAULT: 0, NO_REFLECT: 2 };

// ---------------------------------------------------------------------
// Shared dynamic lighting for custom shaders: bright transient light sources (distress
// rockets, sparks, lamps) that ShaderMaterials (ocean, iceberg, sky glow) can't get from
// three.js lights. fx writes up to 4 each frame (intensity 0 = unused); readers add
// intensity * color / (1 + d^2 / range^2) style glints.
// ---------------------------------------------------------------------
TT.flashes = [0, 1, 2, 3].map(() => ({ pos: new THREE.Vector3(0, -1e5, 0), color: new THREE.Color(1, 1, 1), intensity: 0, range: 600 }));

// ---------------------------------------------------------------------
// Canonical hull form (ship-local metres). The ship module builds its hull to match
// this closely; ocean foam, collision spray and camera framing use it too.
//   TT.hull.halfBeam(x, y)  -> half breadth at station x, height y (0 outside the hull)
//   TT.hull.sheer(x)        -> height of the top edge of the black hull side (incl. well-deck dips)
//   TT.hull.ends(y)         -> {aft, fwd} x-extent of the hull at height y
// ---------------------------------------------------------------------
TT.hull = (() => {
  const S = TT.CONST.SHIP;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function ends(y) {
    // vertical stem with a rounded forefoot
    let fwd = S.STEM_X;
    if (y < -7.5) { const k = (-7.5 - y) / 3.0; fwd -= k * k * 5.0; }
    // counter stern overhang above water, fine run to the sternpost below
    let aft;
    if (y >= 0) aft = lerp(S.STERN_WL_X, S.STERN_X, sstep(0, 7, y));
    else aft = lerp(S.STERN_WL_X, S.STERNPOST_X, sstep(0, -9, y));
    return { aft, fwd };
  }
  function halfBeam(x, y) {
    if (y < S.KEEL_Y) return 0;
    const e = ends(y);
    if (x > e.fwd || x < e.aft) return 0;
    let f = 1;
    const SHOULDER_F = 42, SHOULDER_A = -52;
    if (x > SHOULDER_F) {
      const u = clamp((x - SHOULDER_F) / (e.fwd - SHOULDER_F), 0, 1);
      f = Math.pow(1 - Math.pow(u, 2.15), 0.62);
      // a little flare above the waterline near the bow
      f *= 1 + 0.06 * sstep(0, 14, y) * sstep(0.35, 0.9, u) * (1 - u);
    } else if (x < SHOULDER_A) {
      const u = clamp((SHOULDER_A - x) / (SHOULDER_A - e.aft), 0, 1);
      const counter = Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.6)));   // rounded stern above water
      const run = Math.pow(Math.max(0, 1 - Math.pow(u, 1.7)), 0.95);  // fine run below
      f = lerp(run, counter, sstep(-3, 3, y));
    }
    // bilge radius 2.8 m on a flat bottom
    const R = 2.8, yb = S.KEEL_Y + R;
    let bilge = S.HALF_BEAM;
    if (y < yb) { const d = yb - y; bilge = S.HALF_BEAM - R + Math.sqrt(Math.max(0, R * R - d * d)); }
    return Math.max(0, bilge * f);
  }
  function sheer(x) {
    if (x >= 97) return 16.6 + 1.2 * Math.pow((x - 97) / 37, 2);           // forecastle
    if (x >= 66) {                                                           // forward well deck bulwark
      let y = lerp(13.6, 16.6, sstep(95.5, 97, x));
      return lerp(15.0, y, sstep(66, 67.5, x));
    }
    if (x >= -80) return 15.0;                                               // hull top under the superstructure
    if (x >= -104) {                                                         // aft well deck bulwark
      let y = lerp(13.4, 15.0, sstep(-81.5, -80, x));
      return lerp(15.8, y, sstep(-104, -102.5, x));
    }
    return 15.8 + 0.8 * Math.pow((-104 - x) / 30.5, 2);                      // poop
  }
  return { halfBeam, sheer, ends };
})();

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
TT.util = (() => {
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
  const remap = (x, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, x)));
  const smoothstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * (3 - 2 * t); };
  const smootherstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;
  const easeInQuad = (t) => t * t;
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  // pulse: 0 before a, ramps to 1 over `rise`, holds, falls to 0 over `fall` ending at b
  const envelope = (x, a, b, rise = 0.5, fall = 0.5) => smoothstep(a, a + rise, x) * (1 - smoothstep(b - fall, b, x));
  // frame-rate independent exponential smoothing
  const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
  // Deterministic PRNG (mulberry32); seed may be a number or a string
  function rng(seed) {
    let a = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // integer hash -> [0,1)
  function hash1(n) {
    n = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // smooth 1D value noise in [-1,1]
  function noise1(x, seed = 0) {
    const i = Math.floor(x), f = x - i;
    const a = hash1(i * 7919 + seed * 104729) * 2 - 1;
    const b = hash1((i + 1) * 7919 + seed * 104729) * 2 - 1;
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  // binary search: index of last element with key(el) <= x (or -1)
  function bsearch(arr, x, key = (e) => e.t) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (key(arr[mid]) <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  // Piecewise keyframe sampling. keys: [[t, value], ...] sorted by t.
  // Values may be numbers or arrays of numbers. ease: 'linear'|'smooth'|'step'
  function sampleKeys(keys, t, ease = 'smooth') {
    if (!keys || keys.length === 0) return 0;
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last[1];
    const i = bsearch(keys, t, (k) => k[0]);
    const k0 = keys[i], k1 = keys[i + 1];
    let u = (t - k0[0]) / Math.max(1e-9, k1[0] - k0[0]);
    if (ease === 'step') return k0[1];
    if (ease === 'smooth') u = u * u * (3 - 2 * u);
    const v0 = k0[1], v1 = k1[1];
    if (Array.isArray(v0)) return v0.map((a, j) => a + (v1[j] - a) * u);
    return v0 + (v1 - v0) * u;
  }
  // Monotone cubic (Fritsch–Carlson) curve through [[t, v], ...]: smooth motion without
  // overshoot and without stopping at every key. Returns f(t). Clamped outside the range.
  function curve(keys) {
    const n = keys.length;
    const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
    const m = new Array(n).fill(0);
    if (n > 1) {
      const d = [];
      for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
      m[0] = d[0]; m[n - 1] = d[n - 2];
      for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
        if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
      }
    }
    const f = (t) => {
      if (n === 0) return 0;
      if (t <= xs[0]) return ys[0];
      if (t >= xs[n - 1]) return ys[n - 1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= t) lo = mid; else hi = mid; }
      const h = xs[hi] - xs[lo], u = (t - xs[lo]) / h;
      const h00 = (1 + 2 * u) * (1 - u) * (1 - u), h10 = u * (1 - u) * (1 - u), h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
      return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi];
    };
    f.keys = keys;
    return f;
  }
  return {
    clamp, lerp, invLerp, remap, smoothstep, smootherstep, easeInOutCubic, easeOutCubic, easeInCubic,
    easeInQuad, easeOutQuad, easeInOutSine, envelope, damp, rng, hashStr, hash1, noise1, bsearch, sampleKeys, curve,
    DEG: Math.PI / 180,
  };
})();

// ---------------------------------------------------------------------
// Pose helpers. A "pose" places a rigid ship section in the world:
//   { pivotLocal: Vector3 (ship-local point), pivotWorld: Vector3, quat: Quaternion }
// meaning: world = pivotWorld + quat * (local - pivotLocal).
// ---------------------------------------------------------------------
TT.pose = (() => {
  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _qi = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  return {
    create() { return { pivotLocal: new THREE.Vector3(), pivotWorld: new THREE.Vector3(), quat: new THREE.Quaternion() }; },
    copy(dst, src) { dst.pivotLocal.copy(src.pivotLocal); dst.pivotWorld.copy(src.pivotWorld); dst.quat.copy(src.quat); return dst; },
    // Put an Object3D (whose children are modelled in ship-local coords) at this pose.
    apply(obj, pose) {
      obj.quaternion.copy(pose.quat);
      _v.copy(pose.pivotLocal).applyQuaternion(pose.quat);
      obj.position.copy(pose.pivotWorld).sub(_v);
    },
    // ship-local point -> world
    toWorld(pose, local, target) {
      return (target || new THREE.Vector3()).copy(local).sub(pose.pivotLocal).applyQuaternion(pose.quat).add(pose.pivotWorld);
    },
    // world point -> ship-local
    toLocal(pose, world, target) {
      const q = pose.quat;
      return (target || new THREE.Vector3()).copy(world).sub(pose.pivotWorld).applyQuaternion(_qi.copy(q).invert()).add(pose.pivotLocal);
    },
    // yaw (heading, + toward port/-Z), pitch (bow-down +), roll (list to port +), radians
    quatFromHPR(heading, pitch, roll, target) {
      _e.set(-roll, heading, -pitch, 'YZX');
      return (target || new THREE.Quaternion()).setFromEuler(_e);
    },
    matrix(pose, target) {
      const m = target || new THREE.Matrix4();
      _v.copy(pose.pivotLocal).applyQuaternion(pose.quat);
      m.compose(_p.copy(pose.pivotWorld).sub(_v), pose.quat, _one);
      return m;
    },
  };
})();

// ---------------------------------------------------------------------
// Shared GLSL snippets (paste into shaders with string concatenation).
//   TT.glsl.noise: float hash12(vec2), float hash13(vec3), float vnoise(vec3),
//                  float snoise(vec3) (simplex, -1..1), float fbm3(vec3, int octaves)
// ---------------------------------------------------------------------
TT.glsl = {
  noise: /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y), f.z); }
vec3 _m289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _m289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _perm(vec4 x){ return _m289(((x*34.0)+1.0)*x); }
vec4 _tis(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = _m289(i);
  vec4 p = _perm(_perm(_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = _tis(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm3(vec3 p, int oct){ float a = 0.5, s = 0.0; for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * snoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; } return s; }
`,
};

// ---------------------------------------------------------------------
// Morse code timing — shared by audio (tones) and ui (typed text) so they match exactly.
//   TT.morse.timeline(text, t0, wpm) -> { tones: [{t, d}], chars: [{ch, t0, t1}], t1 }
// Standard PARIS timing: unit = 1.2 / wpm s; dot 1u, dash 3u, gaps 1u / 3u (letters) / 7u (words).
// '—' and '·' in text are shown but not keyed; spaces are word gaps.
// ---------------------------------------------------------------------
TT.morse = (() => {
  const CODE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-',
    L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-',
    W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.',
  };
  function timeline(text, t0, wpm = 22) {
    const u = 1.2 / wpm;
    const tones = [], chars = [];
    let t = t0;
    for (const raw of text) {
      const ch = raw.toUpperCase();
      if (ch === ' ') { chars.push({ ch: raw, t0: t, t1: t + 4 * u }); t += 4 * u; continue; } // +3 already after previous letter = 7
      const code = CODE[ch];
      if (!code) { chars.push({ ch: raw, t0: t, t1: t }); continue; }
      const c0 = t;
      for (let i = 0; i < code.length; i++) {
        const d = code[i] === '.' ? u : 3 * u;
        tones.push({ t, d });
        t += d + (i < code.length - 1 ? u : 0);
      }
      chars.push({ ch: raw, t0: c0, t1: t });
      t += 3 * u;
    }
    return { tones, chars, t1: t, unit: u };
  }
  return { CODE, timeline };
})();

// ---------------------------------------------------------------------
// Master clock — story time in seconds.
// When the audio engine attaches its AudioContext, time is derived from
// ctx.currentTime (sample-accurate sync); otherwise from performance.now().
// ---------------------------------------------------------------------
TT.clock = {
  playing: false,
  frozen: null,        // number => time is pinned (debug stills)
  latency: 0,          // seconds; visuals are delayed by this to match what is heard
  rate: 1,
  _t0: 0, _perf0: 0, _audio: null, _audio0: 0, _mode: 'perf',
  _currentMode() { return this._audio && this._audio.state === 'running' ? 'audio' : 'perf'; },
  _raw() {
    if (this._mode === 'audio') return this._t0 + (this._audio.currentTime - this._audio0);
    return this._t0 + ((performance.now() - this._perf0) / 1000) * this.rate;
  },
  _anchor(t) {
    this._t0 = t;
    this._perf0 = performance.now();
    if (this._audio) this._audio0 = this._audio.currentTime;
  },
  now() {
    if (this.frozen != null) return this.frozen;
    if (!this.playing) return this._t0;
    const m = this._currentMode();
    if (m !== this._mode) { const t = this._raw(); this._mode = m; this._anchor(t); }
    return this._raw() - (this._mode === 'audio' ? this.latency : 0);
  },
  // Audio-context time at which story time `t` should be *scheduled*
  toAudioTime(t) {
    if (!this._audio) return 0;
    if (this._mode !== 'audio' || !this.playing) return this._audio.currentTime + (t - this.now());
    return this._audio0 + (t - this._t0);
  },
  attachAudio(ctx) {
    const t = this.now();
    this._audio = ctx;
    this._mode = this._currentMode();
    this._anchor(t);
    this.latency = (ctx.outputLatency || ctx.baseLatency || 0);
  },
  play(from) {
    const t = from != null ? from : this.now();
    this._mode = this._currentMode();
    this._anchor(t);
    this.playing = true;
    TT.emit('play', t);
  },
  pause() {
    const t = this.now();
    this._anchor(t);
    this.playing = false;
    TT.emit('pause', t);
  },
  seek(t) {
    t = Math.max(0, Math.min(t, TT.CONST.DURATION));
    this._mode = this._currentMode();
    this._anchor(t);
    if (this.frozen != null) this.frozen = t;
    TT.emit('seek', t);
  },
};

export { TT, THREE, ADDONS };
