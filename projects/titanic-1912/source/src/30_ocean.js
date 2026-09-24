import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/30_ocean.js ====
// =====================================================================
// 30_ocean.js — the North Atlantic, 14–15 April 1912.
// Owner: ocean agent.
//
// One camera-following radial grid (dense near the camera, reaching the horizon) displaced
// by a sum of Gerstner waves evaluated in the *water* frame (world.xz + S.ship.travel), so the
// sea streams past the steaming ship. The fragment shader adds filtered analytic ripples,
// "cat's-paw" wind patches, a real Kelvin wake that follows the ship's curved track, bow wave,
// propeller wash, hull foam, sinking turbulence, splash rings and the boil where she went down,
// warm light spill and green underwater glow from the lit hull, rocket glints, and a planar
// reflection (mirrored camera, oblique clip plane, half-float with mips) distorted by the ripple
// normals so every lamp, star and rocket becomes a long rippling streak. Underwater the surface
// is seen from below (Snell's window, total internal reflection, caustic shimmer).
//
// API: TT.ocean.heightAt(x, z, t), normalAt(x, z, t, target), mesh, reflectionTarget.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = C.SHIP;
  const G = 9.81, TAU = Math.PI * 2;
  const NW = 12;       // Gerstner waves (geometry + per-pixel normal)
  const NR = 24;       // ripple waves (per-pixel normal only)
  const NT = 24;       // wake track points
  const NB = 32;       // iceberg waterline radius samples

  // ------------------------------------------------------------------
  // Wave spectrum. A long low swell from the north-west (the famous flat calm) plus wind chop
  // that only builds with the dawn breeze. Directions are in world xz.
  // ------------------------------------------------------------------
  const SWELL_ANG = Math.atan2(-0.55, -0.8);   // travelling toward the south-east
  const WIND_ANG = SWELL_ANG + 0.42;
  const GW = [
    // lambda (m), direction offset (rad), weight, horizontal steepness, group (0 swell, 1 chop)
    [142, 0.00, 0.46, 0.7, 0], [97, 0.33, 0.30, 0.7, 0], [71, -0.29, 0.20, 0.8, 0], [55, 0.62, 0.13, 0.8, 0],
    [21, -0.85, 0.22, 0.8, 1], [16.5, 0.12, 0.27, 1.0, 1], [13.1, 0.92, 0.2, 1.0, 1], [10.4, -0.41, 0.22, 1.0, 1],
    [8.1, 0.55, 0.17, 1.0, 1], [6.3, -1.15, 0.13, 1.0, 1], [4.9, -0.12, 0.12, 1.0, 1], [3.7, 0.33, 0.09, 1.0, 1],
  ].map(([lambda, off, w, q, grp], i) => {
    const a = (grp === 0 ? SWELL_ANG : WIND_ANG) + off;
    const k = TAU / lambda;
    return { lambda, k, dx: Math.cos(a), dz: Math.sin(a), w, q, grp, omega: Math.sqrt(G * k), phi: U.hash1(i * 31 + 7) * TAU };
  });

  // Ripples: log-spaced capillary/gravity wavelets, mostly down-wind with a wide spread.
  const RW = (() => {
    const rnd = U.rng('ocean-ripples-1912');
    const out = [];
    let sum2 = 0;
    for (let i = 0; i < NR; i++) {
      const u = (i + rnd() * 0.8) / NR;
      const lambda = 0.07 * Math.pow(5.2 / 0.07, u);
      const k = TAU / lambda;
      const spread = (rnd() * 2 - 1) * (rnd() < 0.25 ? Math.PI : 1.25);
      const a = WIND_ANG + spread;
      const slope = 0.55 + 0.6 * rnd();
      sum2 += slope * slope * 0.5;
      out.push({ k, dx: Math.cos(a), dz: Math.sin(a), slope, omega: Math.sqrt(G * k + 7.4e-5 * k * k * k), phi: rnd() * TAU });
    }
    const norm = 1 / Math.sqrt(sum2);            // RMS slope of the whole set = 1 (scaled by uRipple)
    for (const r of out) r.amp = (r.slope * norm) / r.k;
    return out;
  })();

  const TR = () => TT.story.TR;
  // Wave amplitudes (m) for story time t (pure function of t).
  function waveAmps(t, out) {
    const H = TR().waveHeight(t), wind = TR().wind(t);
    const wf = U.smoothstep(1.0, 5.5, wind);
    for (let i = 0; i < NW; i++) {
      const g = GW[i];
      out[i] = g.grp === 0 ? g.w * H * 0.5 * (1 - 0.35 * wf) : g.w * H * 0.5 * (0.12 + 0.88 * wf) * 0.9;
    }
    return out;
  }

  // Radial grid: r(u) = A (e^(B u) - 1), u in [0,1] over NRING rings. Vertex spacing at radius r
  // is B (r + A) / NRING; each Gerstner wave fades out where it would be under-sampled (the
  // per-pixel normal carries it from there). heightAt() applies exactly the same fade.
  const grid = { cx: 0, cz: 0, A: 20, B: 7, nring: 640, nseg: 512, rmax: 28000, near: 0.15 };
  function solveGrid(camY, far) {
    const h = Math.abs(camY);
    const near = U.clamp(0.035 * (h + 2.5), 0.12, 7.0);
    const rmax = Math.min(28000, far * 0.92);
    const K = rmax / (near * grid.nring);
    let lo = 0.01, hi = 30;
    for (let i = 0; i < 48; i++) {
      const m = (lo + hi) * 0.5;
      if ((Math.exp(m) - 1) / m > K) hi = m; else lo = m;
    }
    grid.B = (lo + hi) * 0.5;
    grid.A = (near * grid.nring) / grid.B;
    grid.rmax = rmax; grid.near = near;
  }
  const waveFade = (lambda, r) => {
    const sp = (grid.B * (r + grid.A)) / grid.nring;
    return U.clamp((lambda / sp) * 0.25 - 1, 0, 1);
  };

  // JS Gerstner — mirrors the vertex shader. (qx, qz) = undisplaced world position.
  const _amps = new Float64Array(NW);
  const _trav = new THREE.Vector2();
  let _cacheT = NaN;
  function prepTime(t) {
    if (t === _cacheT) return;
    _cacheT = t;
    waveAmps(t, _amps);
    TT.story.travelAt(t, _trav);
  }
  function displace(qx, qz, t, out) {
    let dx = 0, dy = 0, dz = 0;
    const r = Math.hypot(qx - grid.cx, qz - grid.cz);
    const wx = qx + _trav.x, wz = qz + _trav.y;
    for (let i = 0; i < NW; i++) {
      const g = GW[i];
      const f = waveFade(g.lambda, r);
      if (f <= 0) continue;
      const th = g.k * (g.dx * wx + g.dz * wz) - g.omega * t + g.phi;
      const a = _amps[i] * f, s = Math.sin(th), c = Math.cos(th);
      dy += a * c;
      dx -= g.dx * g.q * a * s;
      dz -= g.dz * g.q * a * s;
    }
    out[0] = dx; out[1] = dy; out[2] = dz;
    return out;
  }
  const _d = [0, 0, 0];
  // Surface height at world (x, z) and story time t: invert the horizontal Gerstner displacement.
  function heightAt(x, z, t) {
    if (t == null) t = TT.S.t;
    prepTime(t);
    let qx = x, qz = z;
    for (let it = 0; it < 4; it++) {
      displace(qx, qz, t, _d);
      qx = x - _d[0]; qz = z - _d[2];
    }
    return displace(qx, qz, t, _d)[1];
  }
  function normalAt(x, z, t, target) {
    const e = 0.6;
    const hx0 = heightAt(x - e, z, t), hx1 = heightAt(x + e, z, t);
    const hz0 = heightAt(x, z - e, t), hz1 = heightAt(x, z + e, t);
    return (target || new THREE.Vector3()).set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
  }

  // ==================================================================
  // GLSL
  // ==================================================================
  const GLSL_WAVES = /* glsl */`
#define NW ${NW}
uniform vec2 uCenter;       // grid centre (world xz, snapped camera position)
uniform float uGA, uGB, uNRing;
uniform vec4 uGw[NW];       // kx, kz, amplitude (m), phase at the grid centre
uniform vec4 uGq[NW];       // horizontal amplitude (Q*A), wavelength, group (0 swell, 1 chop), 0
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`;

  const VERT = GLSL_WAVES + /* glsl */`
varying vec3 vWorld;
varying vec2 vGrid;
void main() {
  float r = uGA * (exp(uGB * position.y) - 1.0);
  vec2 gl = position.xz * r;
  float sp = uGB * (r + uGA) / uNRing;
  vec3 d = vec3(0.0);
  for (int i = 0; i < NW; i++) {
    vec4 w = uGw[i]; vec4 q = uGq[i];
    float f = clamp(q.y / sp * 0.25 - 1.0, 0.0, 1.0);
    float th = dot(w.xy, gl) + w.w;
    float s = sin(th);
    d.y += w.z * f * cos(th);
    d.xz -= normalize(w.xy) * (q.x * f * s);
  }
  vec2 xz = uCenter + gl;
  vGrid = xz;
  vWorld = vec3(xz.x + d.x, d.y, xz.y + d.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

  const GLSL_HULL = /* glsl */`
// ---- port of TT.hull (ship-local metres) ----
vec2 hullEnds(float y) {
  float fwd = 134.0;
  if (y < -7.5) { float k = (-7.5 - y) / 3.0; fwd -= k * k * 5.0; }
  float aft = y >= 0.0 ? mix(-128.5, -134.5, sstep(0.0, 7.0, y)) : mix(-128.5, -124.0, sstep(0.0, -9.0, y));
  return vec2(aft, fwd);
}
float hullHB(float x, float y) {
  if (y < -10.5) return 0.0;
  vec2 e = hullEnds(y);
  if (x > e.y || x < e.x) return 0.0;
  float f = 1.0;
  if (x > 42.0) {
    float u = clamp((x - 42.0) / (e.y - 42.0), 0.0, 1.0);
    f = pow(max(1.0 - pow(u, 2.15), 0.0), 0.62);
    f *= 1.0 + 0.06 * sstep(0.0, 14.0, y) * sstep(0.35, 0.9, u) * (1.0 - u);
  } else if (x < -52.0) {
    float u = clamp((-52.0 - x) / (-52.0 - e.x), 0.0, 1.0);
    float counter = sqrt(max(0.0, 1.0 - pow(u, 2.6)));
    float run = pow(max(0.0, 1.0 - pow(u, 1.7)), 0.95);
    f = mix(run, counter, sstep(-3.0, 3.0, y));
  }
  float bilge = 14.1;
  if (y < -7.7) { float d = -7.7 - y; bilge = 11.3 + sqrt(max(0.0, 7.84 - d * d)); }
  return max(0.0, bilge * f);
}
// signed horizontal distance from the hull side (negative inside) for a section clipped to [xmin, xmax]
float hullSD(vec3 l, float xmin, float xmax) {
  if (l.y < -10.4) return 1e4;
  float y = min(l.y, 12.0);
  vec2 e = hullEnds(y);
  float x0 = max(e.x, xmin), x1 = min(e.y, xmax);
  float xc = clamp(l.x, x0, x1);
  float dz = abs(l.z) - hullHB(xc, y);
  float dx = abs(l.x - xc);
  return dx > 0.0 ? length(vec2(dx, max(dz, 0.0))) : dz;
}
// top of the hull / superstructure side at station x
float hullTop(float x) {
  if (x > -62.0 && x < 66.0) return 22.6;
  if (x >= 97.0) return 16.6 + 1.2 * pow((x - 97.0) / 37.0, 2.0);
  if (x >= 66.0) return 13.6;
  if (x >= -80.0) return 15.0;
  if (x >= -104.0) return 13.4;
  return 15.8 + 0.8 * pow(max(-104.0 - x, 0.0) / 30.5, 2.0);
}
`;

  const GLSL_KELVIN = /* glsl */`
// Kelvin ship-wave pattern (stationary phase), point x m behind the source, y m abeam (y >= 0).
// k0 = g / U^2. Returns height (unit amplitude); g = gradient (d/dx along track, d/dy abeam).
float kelvin(float x, float y, float k0, float fp, out vec2 g) {
  g = vec2(0.0);
  if (x < 1.0) return 0.0;
  float rho = y / x;
  float inside = 1.0 - sstep(0.345, 0.40, rho);
  if (inside <= 0.0) return 0.0;
  float r = min(rho, 0.3535);
  float disc = sqrt(max(1.0 - 8.0 * r * r, 0.0));
  float caus = min(inversesqrt(max(disc, 0.02)), 2.6);
  float env = inside * caus / sqrt(1.0 + k0 * length(vec2(x, y)) * 0.06) * sstep(1.0, 40.0, x);
  float h = 0.0;
  // transverse waves
  float s = 2.0 * r / (1.0 + disc);
  float q = 1.0 + s * s, k = k0 * q, ci = inversesqrt(q);
  float ph = k0 * (x + y * s) * sqrt(q);
  float a = env * 0.55 * (1.0 - sstep(0.5, 1.3, k * fp));
  h += a * cos(ph);
  g -= a * sin(ph) * k * vec2(ci, s * ci);
  // diverging waves (the feathered arms)
  s = (1.0 + disc) / (4.0 * max(r, 1e-3));
  q = 1.0 + s * s; k = k0 * q; ci = inversesqrt(q);
  ph = k0 * (x + y * s) * sqrt(q);
  a = env * (1.0 - sstep(0.5, 1.3, k * fp)) * sstep(0.03, 0.2, rho);
  h += a * cos(ph + 0.785);
  g -= a * sin(ph + 0.785) * k * vec2(ci, s * ci);
  return h;
}
`;

  const GLSL_FOAM = /* glsl */`
// procedural foam texture in the water frame (0..1), animated
// Worley F1: distance to the nearest jittered feature point (bubbles / holes in the lace)
float worley(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 h = vec2(hash12(i + g), hash12(i + g + 17.31));
    vec2 o = 0.5 + 0.42 * sin(t * (0.3 + 0.4 * h.yx) + h * 6.2831);
    d = min(d, length(g + o - f));
  }
  return d;
}
float foamTex(vec2 p, float t, float fp) {
  float n = snoise(vec3(p * 0.11, t * 0.07)) * 0.42 + snoise(vec3(p * 0.33 + 11.0, t * 0.15)) * 0.33;
  n += snoise(vec3(p * 1.0 - 7.0, t * 0.3)) * 0.25 * (1.0 - sstep(0.5, 1.5, fp));
  float tex = n * 0.5 + 0.5;
  // lace: foam sheets pierced by rounded holes, at two scales
  float l1 = 1.0 - sstep(0.2, 0.7, fp);
  if (l1 > 0.0) tex *= mix(1.0, (0.3 + 0.7 * sstep(0.1, 0.55, worley(p * 0.42, t * 0.7))) * 1.22, l1);
  float l2 = 1.0 - sstep(0.04, 0.22, fp);
  if (l2 > 0.0) tex *= mix(1.0, (0.45 + 0.55 * sstep(0.08, 0.6, worley(p * 2.1 + 5.7, t * 1.3))) * 1.18, l2);
  return tex;
}
float foamCoverage(float amt, float tex, float fp) {
  float thr = 1.0 - 0.62 * clamp(amt, 0.0, 1.3);
  float soft = 0.07 + 0.18 * sstep(0.2, 2.0, fp);
  return sstep(thr - soft, thr + soft, tex) * min(amt * 5.0, 1.0);
}
`;

  const FRAG_HEAD = /* glsl */`
#define NR ${NR}
#define NT ${NT}
#define NB ${NB}
varying vec3 vWorld;
varying vec2 vGrid;
uniform float uTime;
uniform vec2 uWaterOff;     // uCenter + travel: water-frame coordinates of the grid centre
uniform vec4 uRw[NR];       // ripples: kx, kz, amplitude, phase
uniform vec4 uRip;          // x RMS ripple slope, y cat's-paw coverage, z glassy level, w turbulence normal gain
uniform vec2 uWindDrift;
uniform mat4 uBowInv, uSternInv;
uniform vec4 uShip;         // x bow visible, y stern visible, z separated, w electric lights (0..1)
uniform vec4 uShipC;        // xz centre, effect radius, on
uniform vec4 uShipMove;     // x speed factor, y k0, z astern churn, w bow-wave amount
uniform vec4 uSink;         // x hull turbulence, y deck wash, z green glow gain, w cos(pitch)
uniform vec4 uWakeC;        // xz centre, radius, on
uniform vec4 uTrA[NT];      // x, z, s (m from the bow), age (s)
uniform vec4 uTrB[NT];      // wash, kelvin amplitude (m), k0 = g/U^2, 0
uniform vec4 uBreak;        // x, z, amount, radius
uniform vec4 uBoil;         // x, z, amount, age
uniform vec4 uRings[3];     // x, z, age, size
uniform vec4 uScrape;       // berg centre x (intact ship frame), intact heading, amount, 0
uniform mat4 uBergInv;
uniform vec4 uBergR[NB / 4];
uniform float uBergOn;
uniform vec4 uBoats[16];    // lifeboats: x, z, heading, 0 = hidden / 1 + rowing (in the water)
uniform vec4 uFlashP[4];    // xyz, range
uniform vec4 uFlashC[4];    // rgb * intensity
uniform vec3 uAmb;          // irradiance reaching foam (sky + key light)
uniform vec3 uSunDir, uSunCol;
uniform vec3 uDeep, uScatter;
uniform vec3 uSkyZen, uSkyHor;
uniform vec3 uFog[6];       // sky fog colour at view dirY = 0, -.02, -.05, -.1, -.2, -.4
uniform float uFogDen, uRmax;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform vec4 uReflInfo;     // x on, y width px, z height px, w uv per radian (vertical)
uniform float uUnder;
uniform vec3 uAbyss;
uniform float uGlint;       // artistic scale of the analytic flash / lamp glints
const vec3 AMBER = vec3(1.0, 0.456, 0.111);
const float PI2 = 6.2831853;

vec3 fogColor(float dy) {
  float a = clamp(-dy, 0.0, 0.4);
  if (a < 0.02) return mix(uFog[0], uFog[1], a / 0.02);
  if (a < 0.05) return mix(uFog[1], uFog[2], (a - 0.02) / 0.03);
  if (a < 0.1) return mix(uFog[2], uFog[3], (a - 0.05) / 0.05);
  if (a < 0.2) return mix(uFog[3], uFog[4], (a - 0.1) / 0.1);
  return mix(uFog[4], uFog[5], (a - 0.2) / 0.2);
}
vec3 skyEnv(vec3 R) { float e = clamp(R.y, 0.0, 1.0); return mix(uSkyHor, uSkyZen, pow(e, 0.4)); }
float bergR(int i) {
  vec4 v = uBergR[i / 4]; int c = i - (i / 4) * 4;
  return c == 0 ? v.x : (c == 1 ? v.y : (c == 2 ? v.z : v.w));
}
vec3 trackCoord(vec2 p, out vec2 tdir, out vec4 trb) {
  float best = 1e12;
  vec3 res = vec3(-1.0, 0.0, 0.0);
  tdir = vec2(1.0, 0.0); trb = vec4(0.0, 0.0, 0.07, 0.0);
  for (int i = 0; i < NT - 1; i++) {
    vec4 a = uTrA[i], b = uTrA[i + 1];
    vec2 ab = b.xy - a.xy;
    float L2 = dot(ab, ab);
    if (L2 < 1e-3) continue;
    vec2 ap = p - a.xy;
    float h = clamp(dot(ap, ab) / L2, 0.0, 1.0);
    vec2 dv = ap - ab * h;
    float dd = dot(dv, dv);
    if (dd < best) {
      best = dd;
      vec2 dir = ab * inversesqrt(L2);
      res = vec3(a.z + dot(ap, dir), dir.x * ap.y - dir.y * ap.x, mix(a.w, b.w, h));
      tdir = dir;
      trb = mix(uTrB[i], uTrB[i + 1], h);
    }
  }
  return res;
}
// One rigid ship section: waterline foam, deck wash, light spill, green underwater glow,
// and the direction to the nearest lit windows (for amber sparkle on the ripples).
void shipSection(mat4 inv, float xmin, float xmax, vec3 P, bool primary,
                 inout float foam, inout float spill, inout float glow, inout float aer, inout vec3 sDir, inout float sW,
                 inout float churn, inout float grind) {
  vec3 l = (inv * vec4(P, 1.0)).xyz;
  if (l.x < xmin - 300.0 || l.x > xmax + 300.0 || abs(l.z) > 300.0) return;
  float d = hullSD(l, xmin, xmax);
  float xs = clamp(l.x, max(xmin, -134.5), min(xmax, 134.0));
  float top = hullTop(xs);
  float pierce = step(-10.4, l.y) * step(l.y, top);
  float ring = exp(-max(d, 0.0) / (0.7 + 3.5 * uSink.x)) * sstep(-1.0, -0.2, d) * pierce;
  foam += ring * (0.8 + 0.9 * uSink.x);
  aer += ring * (0.3 + uSink.x);
  // sinking: a broad apron of churned water where the hull goes under, torn into patches
  if (uSink.x > 0.01) {
    float apron = exp(-max(d, 0.0) / 14.0) * sstep(-1.0, 0.0, d) * step(-10.4, l.y) * step(l.y, top + 4.0) * uSink.x;
    float pat = snoise(vec3(P.xz * 0.06, uTime * 0.25)) * 0.5 + 0.5;
    foam += apron * (0.25 + 0.75 * pat) * 0.8;
    aer += apron * 0.8;
  }
  // water pouring over the deck edge as she settles
  float over = step(d, 0.5) * sstep(top - 2.5, top, l.y) * (1.0 - sstep(top + 0.5, top + 6.0, l.y));
  foam += over * uSink.y;
  aer += over * uSink.y;
  // the lit hull: warm spill on the water, green glow above submerged lit decks
  vec3 lc = vec3(l.x, clamp(l.y, -10.0, 12.0), l.z);
  float d2 = hullSD(lc, xmin, xmax);
  float above = sstep(-45.0, -6.0, l.y) * (1.0 - sstep(6.0, 17.0, l.y));
  float superS = sstep(-66.0, -58.0, l.x) * (1.0 - sstep(62.0, 70.0, l.x));
  float sp = exp(-max(d2, 0.0) / 11.0) * above * uShip.w * (0.45 + 0.55 * superS);
  spill += sp;
  float wdepth = max(l.y - 12.0, 0.0) * uSink.w;
  glow += uShip.w * exp(-wdepth / 5.0) * sstep(0.5, 6.0, l.y) * (exp(-max(d2, 0.0) / 4.0) * 0.7 + exp(-max(d2, 0.0) / 14.0) * 0.3);
  if (sp > 0.01) {
    float xh = clamp(l.x, max(xmin, -118.0), min(xmax, 122.0));
    vec3 hp = vec3(xh, 8.0, (l.z >= 0.0 ? 1.0 : -1.0) * max(hullHB(xh, 2.0), 1.0));
    sDir += transpose(mat3(inv)) * normalize(hp - l) * sp;
    sW += sp;
  }
  if (!primary) return;
  // underway: bow wave hugging the forward hull, boundary-layer foam, stern wave
  float mv = uShipMove.w;
  if (mv > 0.001) {
    float fwd = sstep(20.0, 125.0, l.x);
    float w = 0.7 + 6.0 * sstep(80.0, 134.0, l.x) * mv;
    float bw = exp(-max(d, 0.0) / w) * pierce * sstep(-1.0, -0.2, d);
    foam += bw * mv * (0.3 + 1.2 * fwd);
    aer += bw * mv * (0.4 + fwd);
    float sw = exp(-max(d, 0.0) / 3.5) * pierce * (1.0 - sstep(-125.0, -85.0, l.x));
    foam += sw * mv * 0.6;
    aer += sw * mv;
  }
  // engines full astern: the screws churn water forward along the quarters
  float ast = uShipMove.z;
  if (ast > 0.001) {
    float along = sstep(-165.0, -128.0, l.x) * (1.0 - sstep(-95.0, -35.0, l.x));
    float ch = exp(-max(d, 0.0) / 16.0) * along * ast * step(-10.4, l.y) * sstep(-1.0, 0.0, d);
    foam += ch * 1.2;
    aer += ch * 1.4;
  }
  // collision: the water squeezed between the ice and the starboard bow is churned black and
  // lumpy (main() streaks it with torn foam and bubbles); it whitens only where the ice grinds.
  if (uScrape.z > 0.001) {
    float cx = uScrape.x;
    float band = exp(-pow((l.x - cx) / 30.0, 2.0)) + 0.7 * sstep(cx - 110.0, cx - 10.0, l.x) * (1.0 - sstep(cx - 10.0, cx + 4.0, l.x));
    float side = step(0.0, l.z) * sstep(-1.0, 0.0, d);
    float g = band * side * exp(-max(d, 0.0) / 12.0) * uScrape.z;
    churn += g;
    aer += g * 0.3;
    float gc = exp(-pow((l.x - cx + 3.0) / 13.0, 2.0)) + 0.35 * exp(-pow((l.x - cx + 26.0) / 16.0, 2.0));
    grind += gc * side * exp(-max(d, 0.0) / 2.5) * uScrape.z;
  }
}
// Low quality (no planar reflection): trace the reflected ray to the near side of the lit hull and
// return the porthole / window rows it sees, smeared vertically by the unresolved ripple slope.
vec3 hullLampRefl(mat4 inv, float xmin, float xmax, vec3 P, vec3 R, float sig) {
  vec3 l = (inv * vec4(P, 1.0)).xyz;
  vec3 r = mat3(inv) * R;
  float side = l.z >= 0.0 ? 1.0 : -1.0;
  float zs = side * 13.8;
  if (r.z * side >= -1e-4 || abs(l.z) < 14.0) return vec3(0.0);
  float th = (zs - l.z) / r.z;
  vec3 h = l + r * th;
  if (h.x < max(xmin, -122.0) || h.x > min(xmax, 126.0) || h.y < -8.0 || h.y > 26.0) return vec3(0.0);
  float w = 0.35 + 2.0 * sig * th;                         // vertical smear (m on the hull)
  float xi = floor(h.x / 2.6 + 0.5);
  float cols = pow(0.5 + 0.5 * cos(h.x * 2.4166), 6.0);
  float rows = 0.0;
  for (int i = 0; i < 5; i++) {
    float yr = 3.4 + 2.9 * float(i);
    float lit = step(0.38, hash12(vec2(xi, float(i) + side * 7.0)));
    rows += exp(-pow((h.y - yr) / w, 2.0)) * (0.4 / w) * lit;
  }
  float sup = sstep(-62.0, -58.0, h.x) * (1.0 - sstep(62.0, 66.0, h.x));
  rows += sup * exp(-pow((h.y - 17.3) / (w + 0.6), 2.0)) * 0.7 * step(0.3, hash12(vec2(xi, 9.0 + side)));
  float fadeX = sstep(xmin - 1.0, xmin + 3.0, h.x) * (1.0 - sstep(xmax - 3.0, xmax + 1.0, h.x));
  return AMBER * rows * (cols * 0.85 + 0.15) * fadeX * 1.8;
}
`;

  const FRAG_MAIN = /* glsl */`
void main() {
  vec3 P = vWorld;
  vec3 toP = P - cameraPosition;
  float dist = max(length(toP), 1e-3);
  vec3 rd = toP / dist;
  vec2 pl = vGrid - uCenter;
  vec2 pw = pl + uWaterOff;
  float t = uTime;
  float fp = max(max(length(dFdx(vGrid)), length(dFdy(vGrid))), 1e-3);
  vec4 rc0 = uReflMat * vec4(P.x, 0.0, P.z, 1.0);
  vec2 ruv0 = rc0.xy / rc0.w;
  vec2 rdx = dFdx(ruv0) * uReflInfo.yz, rdy = dFdy(ruv0) * uReflInfo.yz;
  float rfp = max(length(rdx), length(rdy));
  bool below = uUnder > 0.5;

  // wind patches (cat's paws) and wave groups: slow noise in the water frame
  vec2 wp = pw + uWindDrift;
  float pn = snoise(vec3(wp * 0.0095, t * 0.015)) * 0.65 + snoise(vec3(wp * 0.031 + 5.0, t * 0.04)) * 0.35;
  float grp = mix(0.5, 1.4, sstep(-0.45, 0.45, pn + 0.3 * snoise(vec3(pw * 0.021 + 3.0, t * 0.05))));

  // ---------------- swell + chop, analytic per pixel, footprint filtered ----------------
  vec2 grad = vec2(0.0);
  float sig2 = 0.0;
  for (int i = 0; i < NW; i++) {
    vec4 w = uGw[i];
    float k = length(w.xy);
    float f = 1.0 - sstep(0.4, 1.2, k * fp);
    float th = dot(w.xy, pl) + w.w;
    float a = w.z * mix(1.0, grp, uGq[i].z);
    grad -= w.xy * (a * f * sin(th));
    sig2 += (a * k) * (a * k) * 0.5 * (1.0 - f);
  }

  // ---------------- the ship ----------------
  float foam = 0.0, spill = 0.0, glow = 0.0, aer = 0.0, slick = 0.0, sW = 0.0, churn = 0.0, grind = 0.0;
  vec3 sDir = vec3(0.0);
  float dShip = length(P.xz - uShipC.xy);
  if (uShipC.w > 0.5 && dShip < uShipC.z) {
    if (uShip.x > 0.5) shipSection(uBowInv, uShip.z > 0.5 ? -24.0 : -300.0, 300.0, P, uShip.z < 0.5, foam, spill, glow, aer, sDir, sW, churn, grind);
    if (uShip.y > 0.5 && uShip.z > 0.5) shipSection(uSternInv, -300.0, -24.0, P, false, foam, spill, glow, aer, sDir, sW, churn, grind);
  }

  // ---------------- wake: Kelvin waves along the curved track + propeller wash ----------------
  vec2 kg = vec2(0.0);
  if (uWakeC.w > 0.5 && length(P.xz - uWakeC.xy) < uWakeC.z) {
    vec2 tdir; vec4 trb;
    vec3 tc = trackCoord(P.xz, tdir, trb);
    float s = tc.x, y = abs(tc.y), age = tc.z, trW = trb.x, trK = trb.y, k0 = trb.z;
    if (trK > 1e-4) {
      vec2 g1, g2;
      float hk = kelvin(s, y, k0, fp, g1) + 0.55 * kelvin(s - 262.0, y, k0, fp, g2);
      vec2 gk = (g1 + 0.55 * g2) * trK;
      vec2 nrm = vec2(-tdir.y, tdir.x) * (tc.y >= 0.0 ? 1.0 : -1.0);
      kg = tdir * gk.x + nrm * gk.y;
      float brk = max(hk * trK - 0.3, 0.0) * (1.0 - sstep(60.0, 160.0, s));
      // faint foam lines along the cusps of the Kelvin wedge (the classic V)
      float rho1 = y / max(s, 1.0), rho2 = y / max(s - 262.0, 1.0);
      float cusp = exp(-pow((rho1 - 0.335) / 0.022, 2.0)) * sstep(20.0, 80.0, s) + 0.7 * exp(-pow((rho2 - 0.335) / 0.022, 2.0)) * sstep(20.0, 80.0, s - 262.0);
      foam += brk * 1.5 + cusp * trK * 1.6 * exp(-s / 900.0) * (0.6 + 0.6 * snoise(vec3(pw * 0.05, t * 0.1)));
      aer += brk;
    }
    if (trW > 1e-4) {
      float ws = s - 250.0;
      float wW = 11.0 + 0.012 * max(ws, 0.0) + 0.3 * age;
      float cen = exp(-(y * y) / (wW * wW));
      // streaks parallel to the track (screw races, then long foam lanes breaking up)
      float sn = snoise(vec3(s * 0.011, tc.y * 0.075, 0.3)) * 0.55 + snoise(vec3(s * 0.045, tc.y * 0.26, 1.7)) * 0.3
               + snoise(vec3(s * 0.16, tc.y * 0.7, 4.1)) * 0.15 * (1.0 - sstep(0.4, 2.0, fp));
      float lanes = 0.6 + 0.4 * cos(tc.y / (4.5 + 0.08 * age) * 1.5708 + sn * 1.5);
      float fresh = exp(-age / 14.0);
      float wsh = trW * cen * sstep(-30.0, 15.0, ws);
      foam += wsh * (fresh * 1.6 * lanes + (1.0 - fresh) * max(sn * 1.2 + 0.35, 0.0) * (0.55 + 0.45 * lanes));
      aer += wsh * (0.35 + fresh) * (0.6 + 0.6 * sn);
      slick = max(slick, min(wsh * 1.5, 1.0));
    }
  }

  // ---------------- break-up churn, splash rings, the boil, the lap of water on the berg ----------------
  vec2 fOff = vec2(0.0);      // displacement of the foam texture (shear / swirl in churned water)
  if (uBreak.z > 0.001) {
    float db = length(P.xz - uBreak.xy);
    float b = uBreak.z * exp(-pow(db / uBreak.w, 2.0));
    foam += b * 1.4; aer += b * 1.5;
  }
  for (int i = 0; i < 3; i++) {
    vec4 r = uRings[i];
    if (r.w <= 0.0 || r.z < 0.0 || r.z > 16.0) continue;
    float dr = length(P.xz - r.xy);
    float rad = r.w * (12.0 + 10.0 * pow(r.z, 0.8));
    float wd = 3.0 + 1.6 * r.z;
    float ringF = exp(-pow((dr - rad) / wd, 2.0)) * exp(-r.z / 5.0);
    float inner = (1.0 - sstep(rad * 0.5, rad, dr)) * exp(-r.z / 3.0);
    foam += (ringF * 1.2 + inner) * min(r.w, 1.5);
    aer += (ringF + inner * 1.5) * r.w;
  }
  if (uBoil.z > 0.001) {
    float db = length(P.xz - uBoil.xy);
    float R0 = 24.0 + 1.3 * uBoil.w;
    float bn = snoise(vec3(pw * 0.085, t * 0.5)) * 0.6 + snoise(vec3(pw * 0.21 + 9.0, t * 0.9)) * 0.4;
    // a ragged, slowly spreading outline rather than a disc
    float edgeN = snoise(vec3(pw * 0.03, t * 0.04)) * 0.65 + bn * 0.35;
    float rN = db / (R0 * (1.0 + 0.4 * edgeN));
    float core = 1.0 - sstep(0.3, 1.05, rN);
    float b = uBoil.z * core;
    // rising domes of air-laden water push out glassy and dark; foam gathers in torn lanes between them
    float dome = snoise(vec3(pw * 0.11 - 4.0, t * 0.6));
    float lane = pow(1.0 - abs(snoise(vec3(pw * 0.06 + 8.0, t * 0.25))), 3.0);
    float fl = lane * (0.55 + 0.45 * bn) + max(-dome, 0.0) * 0.7;
    foam += b * (0.2 + 1.3 * fl) + uBoil.z * 0.5 * sstep(0.55, 1.0, rN) * (1.0 - sstep(1.0, 2.2, rN)) * max(bn + 0.15, 0.0);
    aer += b * (0.5 + 1.4 * fl);
    slick = max(slick, b * sstep(0.15, 0.6, dome));
    // the foam is dragged round in slow eddies
    vec2 rv = (P.xz - uBoil.xy) / max(db, 1.0);
    fOff += vec2(-rv.y, rv.x) * (b * 5.0 * snoise(vec3(db * 0.12, t * 0.15, 2.0))) + rv * (b * 2.0 * bn);
  }
  if (uBergOn > 0.5) {
    vec3 bl = (uBergInv * vec4(P, 1.0)).xyz;
    float rr = length(bl.xz);
    if (rr < 140.0) {
      float a = (atan(bl.z, bl.x) / PI2 + 0.5) * float(NB);
      int i0 = int(floor(a)); float u = fract(a);
      if (i0 >= NB) i0 = 0;
      int i1 = i0 + 1; if (i1 >= NB) i1 = 0;
      float br = mix(bergR(i0), bergR(i1), u);
      float db = rr - br;
      float lap = exp(-max(db, 0.0) / 1.8) * sstep(-3.0, -0.5, db);
      float pulse = 0.6 + 0.4 * sin(t * 1.1 - rr * 0.5 + snoise(vec3(bl.xz * 0.08, t * 0.1)) * 3.0);
      // in the grinding gap the lap becomes broken grinding patches (see below), not a white collar
      float inGap = min(churn * 1.6, 1.0);
      foam += lap * pulse * 1.05 * (1.0 - 0.75 * inGap) + exp(-max(db, 0.0) / 7.0) * 0.18 * (1.0 - inGap);
      grind += inGap * lap * (0.35 + 0.45 * pulse);
      aer += lap * 0.5;
      slick = max(slick, exp(-max(db, 0.0) / 12.0) * 0.5 * (1.0 - inGap));
    }
  }

  // ---------------- the grinding gap: black water torn by foam streaks, bubbles, white only at the ice ----------------
  float bub = 0.0, gcov = 0.0, glane = 0.0;
  if (churn > 0.01) {
    vec2 hd = vec2(cos(uScrape.y), -sin(uScrape.y));
    vec2 sc = vec2(dot(pw, hd), dot(pw, vec2(-hd.y, hd.x)));       // along / across the hull (water frame)
    sc.y += 2.4 * snoise(vec3(sc * vec2(0.017, 0.07), t * 0.12));    // the shear makes the lanes meander
    float c = min(churn, 1.2), cc = min(c * 1.4, 1.0);
    float tear = snoise(vec3(pw * 0.2 + 2.0, t * 0.35));
    float torn = sstep(-0.55, 0.15, tear);
    // thin torn filaments (ridged noise stretched along the shear) and broader lacy lanes
    float r1 = 1.0 - abs(snoise(vec3(sc * vec2(0.025, 0.3), t * 0.2)));
    float r2 = 1.0 - abs(snoise(vec3(sc * vec2(0.07, 0.85) + 5.0, t * 0.45)));
    float n1 = snoise(vec3(sc * vec2(0.03, 0.35) + 9.0, t * 0.22));
    float fil = pow(r1, 8.0) * (0.1 + 0.9 * torn) + pow(r2, 12.0) * 0.6 * torn * (1.0 - sstep(0.15, 0.5, fp));
    gcov = min(fil, 1.0) * cc;
    glane = sstep(0.35, 0.85, n1) * torn * cc;
    // shear the foam lace into streaks and swirl it (bounded displacement, fades out with the churn)
    fOff += cc * (hd * 4.0 * snoise(vec3(sc.y * 0.9, sc.x * 0.04, t * 0.3))
         + 1.3 * vec2(snoise(vec3(pw * 0.3, t * 0.4)), snoise(vec3(pw * 0.3 + 7.7, t * 0.4))));
    // the white water hugging the hull is torn up by the shear as well
    foam *= mix(1.0, 0.15 + 0.85 * max(pow(r1, 3.0) * torn, glane), cc);
    foam += min(grind, 1.5) * (0.8 + 0.6 * r2) * sstep(-0.7, 0.0, tear + 0.3 * n1) * 1.5;
    aer += c * 0.3 * torn;
    // bubbles boiling up through the black water (resolved only up close)
    if (fp < 0.3) {
      float w1 = worley(pw * 1.7, t * 3.0), w2 = worley(pw * 4.1 + 3.3, t * 4.0);
      bub = (1.0 - sstep(0.07, 0.2, w1)) * sstep(0.2, 0.8, r2 + 0.3 * tear)
          + (1.0 - sstep(0.08, 0.2, w2)) * 0.7 * sstep(0.3, 0.9, r1 - 0.2 * tear);
      bub *= cc * (1.0 - sstep(0.1, 0.3, fp));
    }
  }

  // ---------------- lifeboats: a lap of foam round each hull, a faint wake while they row ----------------
  for (int i = 0; i < 16; i++) {
    vec4 b = uBoats[i];
    if (b.w < 0.5) continue;
    vec2 d = P.xz - b.xy;
    if (dot(d, d) > 1600.0) continue;
    vec2 fw = vec2(cos(b.z), -sin(b.z));
    float al = dot(d, fw), la = dot(d, vec2(-fw.y, fw.x));
    float e = length(vec2(al / 4.7, la / 1.5)) - 1.0;
    float row = b.w - 1.0;
    float lapF = exp(-max(e, 0.0) * 2.8) * sstep(-0.35, 0.0, e);
    foam += lapF * (0.5 + 0.35 * row);
    aer += lapF * 0.3;
    if (row > 0.01 && al < -3.5) {
      float x = -al - 3.5;
      float arm = exp(-pow((abs(la) - 1.3 - x * 0.34) / (0.45 + x * 0.05), 2.0)) * exp(-x / 16.0);
      float cen = exp(-pow(la / (1.1 + x * 0.06), 2.0)) * exp(-x / 9.0);
      foam += (arm * 0.45 + cen * 0.55) * row;
      slick = max(slick, cen * row * 0.8);
    }
  }

  // ---------------- ripples, with cat-paw wind patches ----------------
  float cat = mix(uRip.z, 1.0, sstep(-0.15, 0.3, pn + uRip.y * 1.6 - 0.8));
  float ramp = uRip.x * cat * (1.0 - 0.7 * clamp(slick, 0.0, 1.0));
  vec2 rg = vec2(0.0);
  for (int i = 0; i < NR; i++) {
    vec4 w = uRw[i];
    float k2 = dot(w.xy, w.xy);
    float f = 1.0 - sstep(0.35, 1.1, sqrt(k2) * fp);
    float a = w.z * ramp;
    if (f > 0.001) rg += w.xy * (a * f * cos(dot(w.xy, pl) + w.w));
    sig2 += a * a * k2 * 0.5 * (1.0 - f);
  }
  // churned water: lumpy turbulent normals
  vec2 tg = vec2(0.0);
  float turb = clamp(max(aer, churn), 0.0, 1.5);
  if (turb > 0.01) {
    // two octaves of boiling, lumpy water (finite-difference gradients of simplex noise)
    vec3 q = vec3(pw * 0.8, t * 0.7);
    float n0 = snoise(q), nx = snoise(q + vec3(0.1, 0.0, 0.0)), nz = snoise(q + vec3(0.0, 0.1, 0.0));
    float tf = 1.0 - sstep(0.4, 1.6, fp);
    tg = vec2(nx - n0, nz - n0) * (0.8 / 0.1) * 0.09;
    if (fp < 0.25) {
      vec3 q2 = vec3(pw * 2.4 + 3.1, t * 1.1);
      float m0 = snoise(q2), mx = snoise(q2 + vec3(0.1, 0.0, 0.0)), mz = snoise(q2 + vec3(0.0, 0.1, 0.0));
      tg += vec2(mx - m0, mz - m0) * (2.4 / 0.1) * 0.035 * (1.0 - sstep(0.08, 0.25, fp));
    }
    tg *= uRip.w * min(turb, 1.0) * tf * (1.0 + 1.4 * min(churn, 1.0));
    sig2 += min(turb, 1.0) * 0.0025 * (1.0 - tf);
  }
  float ftex = foam > 0.004 || churn > 0.01 ? foamTex(pw + fOff, t, fp) : 0.0;
  // far away the lace is unresolved: blend to its expected coverage (matches foamCoverage's statistics)
  float fcov = mix(foamCoverage(foam, ftex, fp), sstep(0.3, 1.25, foam) * 0.92, sstep(0.25, 1.2, fp));
  if (churn > 0.01) fcov = max(max(fcov, bub * 0.8), max(gcov * 0.8, foamCoverage(glane * 0.85, ftex, fp) * 0.85));

  vec2 gs = grad + rg + kg + tg;
  vec3 N = normalize(vec3(-gs.x, 1.0, -gs.y));
  vec3 col;

  if (!below) {
    vec3 V = -rd;
    float NdV = dot(N, V);
    if (NdV < 0.03) { N = normalize(N + V * (0.03 - NdV)); NdV = dot(N, V); }
    float F = 0.02 + 0.98 * pow(1.0 - clamp(NdV, 0.0, 1.0), 5.0);
    vec3 R = reflect(rd, N);
    R.y = max(R.y, 0.003);
    R = normalize(R);
    float sig = sqrt(sig2);
    vec3 refl = skyEnv(R);
    // glitter: unresolved facets tilt the mirror at random. A water-frame noise sized to the pixel
    // footprint shifts the reflection kernel (each lamp streak breaks into stacked, shimmering dashes)
    // and turns the analytic glints into sparkles.
    float gsc = 1.0 / max(fp * 1.6, 0.18);
    float gj = snoise(vec3(pw * gsc, t * 0.9)) * 0.75 + snoise(vec3(pw * gsc * 2.7 + 7.3, t * 1.7)) * 0.25;
    float sparkle = mix(1.0, 6.0 * pow(max(gj + 0.1, 0.0), 2.5), 0.85);
    if (uReflInfo.x > 0.5) {
      float Dd = uShipC.w > 0.5 ? clamp(dShip * 0.85 + 40.0, 60.0, 2500.0) : 1500.0;
      vec4 c1 = uReflMat * vec4(P + R * Dd, 1.0);
      vec2 uv = c1.w > 1e-3 ? c1.xy / c1.w : ruv0;
      float spread = min(2.0 * sig * uReflInfo.w, 0.22);
      vec2 uvj = uv + vec2(0.0, gj * spread * 0.6);
      float k = spread * 0.45;
      // three anisotropic taps (the target has anisotropic filtering): sharp across, smeared down the
      // vertical by the unresolved ripple slopes (a tent over +-k), so each lamp keeps its own narrow streak
      vec2 gxR = rdx / uReflInfo.yz, gyR = rdy / uReflInfo.yz;
      vec3 acc = textureGrad(uRefl, clamp(uvj, 0.001, 0.999), gxR, gyR + vec2(0.0, k * 0.8)).rgb * 0.5;
      gyR.y += k * 0.6;
      acc += textureGrad(uRefl, clamp(uvj + vec2(0.0, k * 0.7), 0.001, 0.999), gxR, gyR).rgb * 0.25;
      acc += textureGrad(uRefl, clamp(uvj - vec2(0.0, k * 0.7), 0.001, 0.999), gxR, gyR).rgb * 0.25;
      // the lamps' streaks reach further than the sky's blur: two far taps add only light above the sky level
      gyR.y += k * 0.5;
      vec3 f1 = textureGrad(uRefl, clamp(uvj + vec2(0.0, k * 1.7), 0.001, 0.999), gxR, gyR).rgb;
      vec3 f2 = textureGrad(uRefl, clamp(uvj - vec2(0.0, k * 1.7), 0.001, 0.999), gxR, gyR).rgb;
      acc += (max(f1 - 0.2, 0.0) + max(f2 - 0.2, 0.0)) * 0.16;
      // mean-preserving glitter on bright reflected lamps: the streak's light gathers into dashes
      float gx = clamp(gj * 0.5 + 0.5, 0.0, 1.0);
      float glit = sstep(0.02, 0.4, dot(acc, vec3(0.2126, 0.7152, 0.0722))) * 0.55 * (1.0 - sstep(0.25, 1.8, fp));
      acc *= mix(1.0, gx * gx * gx / 0.185, glit);
      float edge = sstep(-0.03, 0.02, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
      refl = mix(refl, acc, edge);
    } else if (uShipC.w > 0.5 && dShip < uShipC.z && uShip.w > 0.001) {
      vec3 lamp = vec3(0.0);
      if (uShip.x > 0.5) lamp += hullLampRefl(uBowInv, uShip.z > 0.5 ? -24.0 : -300.0, 300.0, P, R, sig);
      if (uShip.y > 0.5 && uShip.z > 0.5) lamp += hullLampRefl(uSternInv, -300.0, -24.0, P, R, sig);
      refl += lamp * uShip.w * (0.4 + 0.6 * sparkle);
    }
    col = uDeep * (1.0 - F) + refl * F;
    // light scattered up out of churned, aerated water
    vec3 E = uAmb + AMBER * spill * 0.35;
    vec3 flashE = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec3 fc = uFlashC[i].rgb;
      if (dot(fc, fc) < 1e-8) continue;
      vec3 Lv = uFlashP[i].xyz - P;
      float dl = length(Lv); Lv /= dl;
      float att = 1.0 / (1.0 + dl * dl / (uFlashP[i].w * uFlashP[i].w));
      vec3 H = normalize(Lv + V);
      float nh = max(dot(N, H), 1e-3), nh2 = nh * nh;
      float m2 = sig2 + 0.00025;
      float D = exp(-(1.0 - nh2) / (nh2 * m2)) / (3.14159 * m2 * nh2 * nh2);
      col += fc * att * F * D * uGlint * sparkle / max(NdV, 0.08);
      flashE += fc * att * max(Lv.y, 0.0);
    }
    E += flashE;
    col += (1.0 - F) * uScatter * min(aer, 1.5) * E;
    // the churned gap: black-green, glassy lumps full of air
    col += (1.0 - F) * vec3(0.005, 0.028, 0.02) * min(churn, 1.0) * dot(E, vec3(0.2126, 0.7152, 0.0722));
    // warm spill and amber sparkle from the lit hull
    col += AMBER * spill * 0.014 * (1.0 - 0.7 * min(churn, 1.0));
    if (sW > 0.001) {
      vec3 Ld = normalize(sDir);
      float rl = max(dot(R, Ld), 0.0);
      col += AMBER * F * (pow(rl, 260.0) * 6.0 * sparkle + pow(rl, 30.0) * 0.12) * min(spill, 1.0);
    }
    // light from submerged lit decks, scattered up through the water and broken by the ripples
    col += vec3(0.06, 0.55, 0.34) * glow * uSink.z * (1.0 - F) * (0.55 + 0.9 * clamp(0.5 + dot(gs, vec2(0.7, 0.5)) * 6.0, 0.0, 1.0));
    // low sun at dawn
    float sr = max(dot(R, uSunDir), 0.0);
    col += uSunCol * F * (pow(sr, 600.0) * 40.0 * sparkle + pow(sr, 40.0) * 0.3) * sstep(-0.03, 0.03, uSunDir.y);
    // foam
    float fshade = (0.45 + 0.75 * clamp(ftex, 0.0, 1.0)) * (0.55 + 0.45 * pow(clamp(N.y, 0.0, 1.0), 12.0));
    vec3 foamCol = vec3(0.8, 0.87, 0.88) * E * 0.56 * fshade * (1.0 + 0.5 * min(grind, 1.0));
    col = mix(col, foamCol + col * 0.25, fcov * 0.94);
    // horizon: fade into the sky haze colour (hides the grid edge completely)
    float fogF = 1.0 - exp(-pow(dist * uFogDen, 2.0));
    fogF = max(fogF, sstep(uRmax * 0.3, uRmax * 0.8, length(pl)));
    col = mix(col, fogColor(rd.y), fogF);
  } else {
    // ---------------- from below: Snell window, total internal reflection ----------------
    float ci = clamp(dot(rd, N), 0.0, 1.0);
    float st2 = 1.7778 * (1.0 - ci * ci);
    vec3 deep = uAbyss * 0.85;           // total internal reflection mirrors the water below
    if (st2 < 1.0) {
      float ct = sqrt(1.0 - st2);
      float rs = (1.333 * ci - ct) / (1.333 * ci + ct);
      float rp = (ci - 1.333 * ct) / (ci + 1.333 * ct);
      float Fr = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
      vec3 tdir = refract(rd, -N, 1.333);
      vec3 skyc = skyEnv(tdir) * 2.5 + uSkyZen * 2.0 + uAmb * 0.2;
      col = mix(skyc, deep, Fr);
      float cz = snoise(vec3(pw * 0.45, t * 0.35)) + 0.5 * snoise(vec3(pw * 1.1 + 3.0, t * 0.6));
      col *= 1.0 + 0.3 * cz * sstep(1.0, 0.6, st2);
    } else {
      col = deep * (0.8 + 0.2 * N.y);
    }
    col = mix(col, uAmb * 0.25 + uAbyss, fcov * 0.7);
    col = mix(uAbyss, col, exp(-pow(dist * uFogDen, 2.0)));   // the same water haze as everything else down here
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  // ==================================================================
  // Geometry: rings of (cos a, u, sin a); the radius is computed in the vertex shader.
  // ==================================================================
  function buildGeometry(nring, nseg) {
    const nv = (nring + 1) * nseg;
    const pos = new Float32Array(nv * 3);
    let o = 0;
    for (let i = 0; i <= nring; i++) {
      const u = i / nring;
      for (let j = 0; j < nseg; j++) {
        const a = (j / nseg) * TAU;
        pos[o++] = Math.cos(a); pos[o++] = u; pos[o++] = Math.sin(a);
      }
    }
    const idx = new Uint32Array(nring * nseg * 6);
    o = 0;
    for (let i = 0; i < nring; i++) {
      for (let j = 0; j < nseg; j++) {
        const a = i * nseg + j, b = i * nseg + ((j + 1) % nseg), c = a + nseg, d = b + nseg;
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }

  // ==================================================================
  // Uniforms
  // ==================================================================
  const v2 = () => new THREE.Vector2(), v3 = () => new THREE.Vector3(), v4 = () => new THREE.Vector4();
  const arr = (n, f) => Array.from({ length: n }, f);
  const uniforms = {
    uCenter: { value: v2() }, uGA: { value: 20 }, uGB: { value: 7 }, uNRing: { value: 640 },
    uGw: { value: arr(NW, v4) }, uGq: { value: arr(NW, v4) },
    uTime: { value: 0 }, uWaterOff: { value: v2() }, uRw: { value: arr(NR, v4) },
    uRip: { value: v4() }, uWindDrift: { value: v2() },
    uBowInv: { value: new THREE.Matrix4() }, uSternInv: { value: new THREE.Matrix4() },
    uShip: { value: v4() }, uShipC: { value: v4() }, uShipMove: { value: v4() }, uSink: { value: v4() },
    uWakeC: { value: v4() }, uTrA: { value: arr(NT, v4) }, uTrB: { value: arr(NT, v4) },
    uBreak: { value: v4() }, uBoil: { value: v4() }, uRings: { value: arr(3, v4) }, uScrape: { value: v4() },
    uBergInv: { value: new THREE.Matrix4() }, uBergR: { value: arr(NB / 4, () => new THREE.Vector4(30, 30, 30, 30)) }, uBergOn: { value: 0 }, uBoats: { value: arr(16, v4) },
    uFlashP: { value: arr(4, v4) }, uFlashC: { value: arr(4, v4) },
    uAmb: { value: v3() }, uSunDir: { value: new THREE.Vector3(-1, -0.2, 0).normalize() }, uSunCol: { value: v3() },
    uDeep: { value: v3() }, uScatter: { value: new THREE.Vector3(0.022, 0.055, 0.05) },
    uSkyZen: { value: v3() }, uSkyHor: { value: v3() }, uFog: { value: arr(6, v3) },
    uFogDen: { value: 0.000035 }, uRmax: { value: 28000 },
    uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflInfo: { value: v4() },
    uUnder: { value: 0 }, uAbyss: { value: v3() }, uGlint: { value: 0.02 },
  };
  const U_ = uniforms;

  const COL = {
    deepNight: new THREE.Color(0x01070c), deepDawn: new THREE.Color(0x0b2636),
    zenith: new THREE.Color(0x02040b), horizon: new THREE.Color(0x0d1a2e), abyss: new THREE.Color(0x01141c),
    proxyBg: new THREE.Color(0x060b16),
  };
  const setV3 = (v, c, s = 1) => v.set(c.r * s, c.g * s, c.b * s);

  // ==================================================================
  // State
  // ==================================================================
  let mesh = null, material = null, ctxRef = null, quality = 'high';
  const amps = new Float64Array(NW);
  const _m4 = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Color();
  const _cp = new THREE.Vector3(), _vec2 = new THREE.Vector2();
  const splashPos = [];                 // world xz of the splash events (pure: sampled from the story)
  const boilPos = new THREE.Vector2();
  let lights = null, lightScanFrame = 0, frameNo = 0;
  const berg = { obj: null, ok: false, tries: 0 };

  // ------------------------------------------------------------------
  // Planar reflection (as ADDONS.Reflector, for the y = 0 plane, rendered once per frame)
  // ------------------------------------------------------------------
  const refl = {
    rt: null, scale: 0.5, need: false, done: false,
    cam: new THREE.PerspectiveCamera(),
    texMat: new THREE.Matrix4(),
  };
  refl.cam.layers.set(TT.LAYERS.DEFAULT);
  const _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3();
  const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
  const _n = new THREE.Vector3(0, 1, 0), _p0 = new THREE.Vector3(0, -0.04, 0), _dbs = new THREE.Vector2();

  function ensureRT(renderer) {
    renderer.getDrawingBufferSize(_dbs);
    const w = Math.max(64, Math.round(_dbs.x * refl.scale)), h = Math.max(64, Math.round(_dbs.y * refl.scale));
    if (!refl.rt) {
      refl.rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
      });
      refl.rt.texture.name = 'ocean reflection';
      refl.rt.texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      mod.reflectionTarget = refl.rt;
      U_.uRefl.value = refl.rt.texture;
    } else if (refl.rt.width !== w || refl.rt.height !== h) refl.rt.setSize(w, h);
  }

  function renderReflection(renderer, scene, camera) {
    ensureRT(renderer);
    const vc = refl.cam;
    _cp.setFromMatrixPosition(camera.matrixWorld);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cp);
    vc.position.set(_cp.x, -_cp.y, _cp.z);
    _tgt.set(_look.x, -_look.y, _look.z);
    vc.up.set(0, 1, 0).applyMatrix4(_rot);
    vc.up.y = -vc.up.y;
    vc.lookAt(_tgt);
    vc.near = camera.near; vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    refl.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    refl.texMat.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane = the sea surface (Lengyel), so nothing below the water is mirrored
    _plane.setFromNormalAndCoplanarPoint(_n, _p0).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pe = vc.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + pe[8]) / pe[0];
    _q.y = (Math.sign(_clip.y) + pe[9]) / pe[5];
    _q.z = -1.0;
    _q.w = (1.0 + pe[10]) / pe[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    pe[2] = _clip.x; pe[6] = _clip.y; pe[10] = _clip.z + 1.0; pe[14] = _clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const info = renderer.info.render, calls0 = info.calls, tris0 = info.triangles;
    const prevRT = renderer.getRenderTarget(), prevXR = renderer.xr.enabled, prevSh = renderer.shadowMap.autoUpdate;
    mesh.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(refl.rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    renderer.xr.enabled = prevXR;
    renderer.shadowMap.autoUpdate = prevSh;
    renderer.setRenderTarget(prevRT);
    if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
    mesh.visible = true;
    if (renderer.info.autoReset) { info.calls += calls0; info.triangles += tris0; }

    U_.uReflMat.value.copy(refl.texMat);
    U_.uReflInfo.value.set(1, refl.rt.width, refl.rt.height, 0.5 * camera.projectionMatrix.elements[5]);
    return true;
  }

  // ------------------------------------------------------------------
  // Camera-dependent uniforms: grid placement and wave phases (computed in float64 relative to
  // the grid centre, so the shader keeps full precision anywhere in the world).
  // ------------------------------------------------------------------
  function setupCamera(camera) {
    const S = TT.S;
    _cp.setFromMatrixPosition(camera.matrixWorld);
    solveGrid(_cp.y, camera.far || C.CAMERA.far);
    const snap = grid.near * 2;
    grid.cx = Math.round(_cp.x / snap) * snap;
    grid.cz = Math.round(_cp.z / snap) * snap;
    U_.uCenter.value.set(grid.cx, grid.cz);
    U_.uGA.value = grid.A; U_.uGB.value = grid.B; U_.uRmax.value = grid.rmax;
    const t = S.t, trav = S.ship.travel;
    const ox = grid.cx + trav.x, oz = grid.cz + trav.y;
    U_.uWaterOff.value.set(ox, oz);
    for (let i = 0; i < NW; i++) {
      const g = GW[i];
      const ph = (g.k * (g.dx * ox + g.dz * oz) - g.omega * t + g.phi) % TAU;
      U_.uGw.value[i].set(g.k * g.dx, g.k * g.dz, amps[i], ph);
      U_.uGq.value[i].set(g.q * amps[i], g.lambda, g.grp, 0);
    }
    for (let i = 0; i < NR; i++) {
      const r = RW[i];
      const ph = (r.k * (r.dx * ox + r.dz * oz) - r.omega * t + r.phi) % TAU;
      U_.uRw.value[i].set(r.k * r.dx, r.k * r.dz, r.amp, ph);
    }
    U_.uUnder.value = _cp.y < 0 ? 1 : 0;
  }

  // ------------------------------------------------------------------
  // Iceberg waterline: scan the berg's triangles for edges crossing y = 0 and build a polar radius
  // table in the berg's own (unscaled) frame, so the lap/foam ring hugs the real ice.
  // ------------------------------------------------------------------
  const _bp = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  function bergFrame(obj, target) {
    obj.matrixWorld.decompose(_bp, _bq, _bs);
    return target.compose(_bp, _bq, _one).invert();
  }
  function scanBerg(obj) {
    obj.updateMatrixWorld(true);
    const inv = bergFrame(obj, new THREE.Matrix4());
    const radii = new Float32Array(NB);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Cv = new THREE.Vector3(), P = new THREE.Vector3();
    const tri = [A, B, Cv];
    let hits = 0;
    const addEdge = (p, q) => {
      if ((p.y > 0) === (q.y > 0)) return;
      const u = p.y / (p.y - q.y);
      P.copy(p).lerp(q, u).applyMatrix4(inv);
      const a = (Math.atan2(P.z, P.x) / TAU + 0.5) * NB;
      const i = Math.min(NB - 1, Math.max(0, Math.round(a) % NB));
      const r = Math.hypot(P.x, P.z);
      if (r > radii[i]) radii[i] = r;
      hits++;
    };
    obj.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || !m.geometry || !m.geometry.attributes.position) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const n = idx ? idx.count : pos.count;
      const mw = m.matrixWorld;
      for (let k = 0; k + 2 < n; k += 3) {
        for (let j = 0; j < 3; j++) {
          const vi = idx ? idx.getX(k + j) : k + j;
          tri[j].fromBufferAttribute(pos, vi).applyMatrix4(mw);
        }
        addEdge(A, B); addEdge(B, Cv); addEdge(Cv, A);
      }
    });
    if (hits < 6) return null;
    // fill empty bins from their neighbours, then smooth lightly
    for (let pass = 0; pass < NB; pass++) {
      let empty = 0;
      for (let i = 0; i < NB; i++) {
        if (radii[i] > 0) continue;
        empty++;
        const a = radii[(i + NB - 1) % NB], b = radii[(i + 1) % NB];
        if (a > 0 || b > 0) radii[i] = a > 0 && b > 0 ? (a + b) / 2 : Math.max(a, b);
      }
      if (!empty) break;
    }
    const out = new Float32Array(NB);
    for (let i = 0; i < NB; i++) out[i] = 0.25 * radii[(i + NB - 1) % NB] + 0.5 * radii[i] + 0.25 * radii[(i + 1) % NB];
    return out;
  }

  function findBerg(scene) {
    const p = TT.props;
    if (p && p.iceberg && p.iceberg.isObject3D) return p.iceberg;
    return scene.getObjectByName('proxy iceberg') || null;
  }

  // ------------------------------------------------------------------
  // Lights: irradiance on an up-facing surface from the scene's own lights (foam, aerated water).
  // ------------------------------------------------------------------
  function gatherLights(scene) {
    lights = [];
    scene.traverse((o) => { if (o.isLight) lights.push(o); });
  }
  const _ld = new THREE.Vector3();
  function lightIrradiance(target) {
    target.set(0, 0, 0);
    let any = false;
    for (const l of lights || []) {
      if (!l.visible || l.intensity <= 0) continue;
      if (l.isHemisphereLight) { target.x += l.color.r * l.intensity; target.y += l.color.g * l.intensity; target.z += l.color.b * l.intensity; any = true; }
      else if (l.isAmbientLight) { target.x += l.color.r * l.intensity; target.y += l.color.g * l.intensity; target.z += l.color.b * l.intensity; any = true; }
      else if (l.isDirectionalLight) {
        _ld.setFromMatrixPosition(l.matrixWorld).sub(_v.setFromMatrixPosition(l.target.matrixWorld)).normalize();
        const k = Math.max(_ld.y, 0) * l.intensity;
        target.x += l.color.r * k; target.y += l.color.g * k; target.z += l.color.b * k; any = true;
      }
    }
    if (!any) {
      const L = C.LIGHT;
      _c.set(L.hemi.sky); target.set(_c.r, _c.g, _c.b).multiplyScalar(L.hemi.intensity);
      _c.set(L.starKey.color); target.addScaledVector(_v.set(_c.r, _c.g, _c.b), L.starKey.intensity * L.starKey.dir.clone().normalize().y);
    }
    return target;
  }

  // ==================================================================
  // Story-driven state (pure functions of t)
  // ==================================================================
  const TAU_TRACK = arr(NT, (_, j) => (j < 2 ? 0 : 1.2 * Math.pow(j - 1, 1.5)));
  const _tv = new THREE.Vector2(), _tv0 = new THREE.Vector2();
  function travelSafe(t, out) {
    if (t >= 0) return TT.story.travelAt(t, out);
    return out.set(TR().speed(0) * t, 0);
  }

  // Wake track: the bow and stern now, then where the stern was tau seconds ago (render frame).
  function updateWake(t) {
    const tr = TR();
    const A = U_.uTrA.value, B = U_.uTrB.value;
    const fadeAll = 1 - U.smoothstep(175, 200, t);
    const kel = (tt, tau) => 0.3 * Math.pow(tr.speed(Math.max(tt, 0)) / 11.6, 2) * Math.exp(-tau / 160) * fadeAll;
    const wash = (tt, tau) => U.clamp(tr.prop(Math.max(tt, 0)) / 1.25, 0, 1) * Math.exp(-tau / 55) * fadeAll;
    const k0 = (tt) => G / Math.pow(Math.max(tr.speed(Math.max(tt, 0)), 3.5), 2);
    travelSafe(t, _tv0);
    const h = tr.heading(t);
    const halfBow = SH.STEM_X, halfStern = -SH.STERN_WL_X;
    A[0].set(halfBow * Math.cos(h), -halfBow * Math.sin(h), 0, 0);
    B[0].set(0, kel(t, 0), k0(t), 0);
    A[1].set(-halfStern * Math.cos(h), halfStern * Math.sin(h), halfBow + halfStern, 0);
    B[1].set(wash(t, 0), kel(t, 0), k0(t), 0);
    let s = halfBow + halfStern, any = B[0].y > 0.003 || B[1].x > 0.003;
    let minx = Math.min(A[0].x, A[1].x), maxx = Math.max(A[0].x, A[1].x), minz = Math.min(A[0].y, A[1].y), maxz = Math.max(A[0].y, A[1].y);
    for (let j = 2; j < NT; j++) {
      const tau = TAU_TRACK[j], tt = t - tau;
      travelSafe(tt, _tv);
      const hh = tr.heading(Math.max(tt, 0));
      const x = _tv.x - _tv0.x - halfStern * Math.cos(hh), z = _tv.y - _tv0.y + halfStern * Math.sin(hh);
      s += Math.hypot(x - A[j - 1].x, z - A[j - 1].y);
      A[j].set(x, z, s, tau);
      const w = wash(tt, tau), k = kel(tt, tau);
      B[j].set(w, k, k0(tt), 0);
      if (w > 0.003 || k > 0.003) {
        any = true;
        minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
      }
    }
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    const rad = Math.hypot(maxx - minx, maxz - minz) / 2 + 0.36 * Math.min(s, 2000) + 150;
    U_.uWakeC.value.set(cx, cz, rad, any ? 1 : 0);
    const sp = tr.speed(t);
    U_.uShipMove.value.set(sp / 11.6, G / Math.pow(Math.max(sp, 3.5), 2), U.clamp(-tr.prop(t) / 0.7, 0, 1), Math.pow(sp / 11.6, 1.5));
  }

  function updateShip(t, S) {
    const EV = TT.story.EV, sh = S.ship;
    TT.pose.matrix(sh.bow, U_.uBowInv.value).invert();
    TT.pose.matrix(sh.stern, U_.uSternInv.value).invert();
    const two = sh.broken > 0.001 || sh.separated;
    const on = sh.visible && (sh.bowVisible || sh.sternVisible) && t < EV.sternGone + 1.5 && !S.env.underwater;
    U_.uShip.value.set(sh.bowVisible ? 1 : 0, sh.sternVisible ? 1 : 0, two ? 1 : 0, U.clamp(sh.lights, 0, 1));
    const a = TT.pose.toWorld(sh.bow, _v.set(50, 0, 0), _v), b = TT.pose.toWorld(sh.stern, _v2.set(-80, 0, 0), _v2);
    U_.uShipC.value.set((a.x + b.x) / 2, (a.z + b.z) / 2, 450 + Math.hypot(a.x - b.x, a.z - b.z) / 2, on ? 1 : 0);
    const turb = U.smoothstep(125, 178, t) * 0.75 + 0.5 * U.envelope(t, EV.breakStart - 1, EV.sternGone + 1, 1, 1);
    const wash = U.smoothstep(135, 160, t) * (1 - U.smoothstep(EV.sternGone, EV.sternGone + 1, t));
    U_.uSink.value.set(Math.min(turb, 1.2), wash, 0.3, Math.cos(sh.pitch));
    // collision
    const bl = TT.pose.toLocal(sh.intact, S.iceberg.pos, _v);
    U_.uScrape.value.set(bl.x, sh.heading, S.fx.scrape || 0, 0);
    // break-up: churn where the stern section's torn end meets the water
    const br = U_.uBreak.value;
    br.set(0, 0, 0, 1);
    if (t >= EV.breakStart && t < EV.sternGone + 1) {
      const top = TT.pose.toWorld(sh.stern, _v.set(SH.BREAK_X, SH.BOAT_DECK_Y, 0), _v);
      const keel = TT.pose.toWorld(sh.stern, _v2.set(SH.BREAK_X, SH.KEEL_Y, 0), _v2);
      let x, z, near;
      if ((top.y > 0) !== (keel.y > 0)) {
        const u = top.y / (top.y - keel.y);
        x = top.x + (keel.x - top.x) * u; z = top.z + (keel.z - top.z) * u; near = 1;
      } else {
        const p = Math.abs(top.y) < Math.abs(keel.y) ? top : keel;
        x = p.x; z = p.z; near = Math.exp(-Math.min(Math.abs(top.y), Math.abs(keel.y)) / 12);
      }
      br.set(x, z, U.envelope(t, EV.breakStart, EV.sternGone, 1.0, 2.0) * near * (sh.sternVisible ? 1 : 0), 16 + 14 * sh.broken);
    }
    // splash rings and the boil
    const sp = S.fx.splashes || [];
    for (let i = 0; i < 3; i++) {
      const r = U_.uRings.value[i], e = sp[i], p = splashPos[i];
      if (!e || !p) { r.set(0, 0, -1, 0); continue; }
      const age = t - e.t;
      r.set(p.x, p.y, age, age >= 0 && age < 16 ? e.size : 0);
    }
    const boilAmt = t < EV.abyss ? Math.max(U.envelope(t, EV.sternGone - 0.6, 238, 0.8, 8), 0.3 * U.smoothstep(EV.sternGone, EV.sternGone + 3, t) * (1 - U.smoothstep(EV.abyss - 2, EV.abyss, t))) : 0;
    U_.uBoil.value.set(boilPos.x, boilPos.y, boilAmt, Math.max(0, t - EV.sternGone));
  }

  // Splash / plunge centres, computed exactly as fx places its splash decals so the two line up.
  function computeSplashPositions() {
    const tmp = TT.story.makeState(), EV = TT.story.EV;
    const at = (t) => TT.story.sample(t, tmp);
    splashPos.length = 0;
    for (const e of TT.S.fx.splashes || []) {
      let x, z;
      if (e.what === 'funnel1') {
        at(e.t);
        const base = new THREE.Vector3(SH.FUNNEL_X[0], SH.FUNNEL_BASE_Y, 0);
        const mid = base.clone().add(new THREE.Vector3(0.55, 0.12, 0.83).normalize().multiplyScalar(11));
        const p = TT.pose.toWorld(tmp.ship.bow, mid, _v);
        x = p.x; z = p.z;
      } else if (e.what === 'sternFallback') {
        at(e.t);
        const p = TT.pose.toWorld(tmp.ship.stern, _v.set((SH.BREAK_X - 6 - 110) / 2, 0, 0), _v);
        x = p.x; z = p.z;
      } else {
        at(e.t - 1.2);
        const p1 = TT.pose.toWorld(tmp.ship.stern, _v.set(-100, 0, 0), _v).clone();
        at(e.t - 4);
        const p2 = TT.pose.toWorld(tmp.ship.stern, _v.set(-60, 0, 0), _v);
        x = p1.x * 0.6 + p2.x * 0.4; z = p1.z * 0.6 + p2.z * 0.4;
      }
      splashPos.push(new THREE.Vector2(x, z));
    }
    at(EV.sternGone - 1.2);
    const q1 = TT.pose.toWorld(tmp.ship.stern, _v.set(-100, 0, 0), _v).clone();
    at(EV.sternGone - 4);
    const q2 = TT.pose.toWorld(tmp.ship.stern, _v.set(-60, 0, 0), _v);
    boilPos.set(q1.x * 0.6 + q2.x * 0.4, q1.z * 0.6 + q2.z * 0.4);
  }

  const FOG_DY = [0, -0.02, -0.05, -0.1, -0.2, -0.4];
  function updateEnv(t, S, scene) {
    const E = S.env, sky = TT.sky && TT.sky._ready ? TT.sky : null;
    const wf = U.smoothstep(1.0, 5.5, E.wind);
    U_.uRip.value.set(0.032 + 0.07 * wf, 0.35 + 0.45 * wf, 0.3 + 0.25 * wf, 1.0);
    U_.uWindDrift.value.set(-Math.cos(WIND_ANG) * 0.7 * t, -Math.sin(WIND_ANG) * 0.7 * t);
    // sky colours (linear)
    if (sky && sky.zenithColor && sky.horizonColor) { setV3(U_.uSkyZen.value, sky.zenithColor); setV3(U_.uSkyHor.value, sky.horizonColor); }
    else if (sky) { setV3(U_.uSkyZen.value, COL.zenith); setV3(U_.uSkyHor.value, COL.horizon); }
    else {
      const bg = scene.background && scene.background.isColor ? scene.background : COL.proxyBg;
      setV3(U_.uSkyZen.value, bg, 0.6); setV3(U_.uSkyHor.value, bg);
    }
    for (let i = 0; i < 6; i++) {
      let ok = false;
      if (sky && typeof sky.fogColor === 'function') {
        try { const c = sky.fogColor(FOG_DY[i], _c); if (c && c.isColor) { setV3(U_.uFog.value[i], c); ok = true; } } catch (e) { ok = false; }
      }
      if (!ok) U_.uFog.value[i].copy(U_.uSkyHor.value);
    }
    // same squared-exponential haze as the sky's scene.fog, so the sea fades with the ship and the ice
    U_.uFogDen.value = scene.fog && scene.fog.isFogExp2 ? scene.fog.density : 0.00002 + 0.00006 * E.haze + 0.00003 * E.dawn;
    // water body
    _c.copy(COL.deepNight).lerp(COL.deepDawn, U.clamp(E.dawn));
    setV3(U_.uDeep.value, _c);
    // underwater the far surface melts into the same water colour as the scene fog (and the sky's backdrop)
    setV3(U_.uAbyss.value, E.underwater && scene.fog && scene.fog.color ? scene.fog.color : COL.abyss);
    // light
    if (!lights || frameNo - lightScanFrame > 150) { gatherLights(scene); lightScanFrame = frameNo; }
    lightIrradiance(U_.uAmb.value);
    if (sky && sky.sunDir) U_.uSunDir.value.copy(sky.sunDir).normalize();
    U_.uSunCol.value.set(1.0, 0.64, 0.4).multiplyScalar(3.0 * U.clamp(E.dawn));
    // distress rockets and other bright transients
    const F = TT.flashes || [];
    for (let i = 0; i < 4; i++) {
      const f = F[i], P = U_.uFlashP.value[i], Cc = U_.uFlashC.value[i];
      if (f && f.intensity > 0 && f.pos) {
        P.set(f.pos.x, f.pos.y, f.pos.z, f.range || 600);
        Cc.set(f.color.r * f.intensity, f.color.g * f.intensity, f.color.b * f.intensity, 0);
      } else { P.set(0, -1e5, 0, 1); Cc.set(0, 0, 0, 0); }
    }
  }

  function updateBerg(S, scene) {
    const bo = findBerg(scene);
    if (bo !== berg.obj) { berg.obj = bo; berg.ok = false; berg.tries = 0; }
    if (bo && !berg.ok && S.iceberg.visible && berg.tries < 12 && (berg.tries === 0 || frameNo % 20 === 0)) {
      berg.tries++;
      const r = scanBerg(bo);
      if (r) {
        for (let i = 0; i < NB; i++) U_.uBergR.value[i >> 2].setComponent(i & 3, r[i]);
        berg.ok = true;
      }
    }
    U_.uBergOn.value = bo && berg.ok && S.iceberg.visible && bo.visible ? 1 : 0;
  }

  // Lifeboats (props): position, heading and rowing from its per-boat state when available.
  const _bf = new THREE.Vector3();
  function updateBoats() {
    const B = U_.uBoats.value, P = TT.props;
    const st = P && P._ready && P._boats && P._boats.state;
    for (let i = 0; i < 16; i++) {
      const s = st && st[i];
      if (!s || !s.visible || s.mode !== 2 || !s.pos || !s.quat || TT.S.env.underwater) { B[i].set(0, 0, 0, 0); continue; }
      _bf.set(1, 0, 0).applyQuaternion(s.quat);
      B[i].set(s.pos.x, s.pos.z, Math.atan2(-_bf.z, _bf.x), 1 + U.clamp(s.row || 0, 0, 1));
    }
  }

  let renderErr = 0;
  function onBeforeRender(renderer, scene, camera) {
    if (camera === refl.cam) return;
    try {
      setupCamera(camera);
      if (berg.obj && U_.uBergOn.value > 0) bergFrame(berg.obj, U_.uBergInv.value);
      updateBoats();
      if (refl.need && !scene.overrideMaterial && camera.isPerspectiveCamera && _cp.y > 0.05) {
        refl.need = false;
        renderReflection(renderer, scene, camera);
      }
    } catch (e) {
      if (renderErr++ < 3) TT.error('ocean render', e);
    }
  }

  // ==================================================================
  // Module
  // ==================================================================
  const FRAG = GLSL_WAVES + TT.glsl.noise + GLSL_HULL + GLSL_KELVIN + GLSL_FOAM + FRAG_HEAD + FRAG_MAIN;
  const QUALITY = { low: [300, 256, 0], medium: [480, 384, 0.35], high: [640, 512, 0.5] };

  const mod = TT.register('ocean', {
    order: 20,
    mesh: null,
    reflectionTarget: null,
    uniforms,
    heightAt,
    normalAt,
    async init(ctx) {
      ctxRef = ctx;
      quality = QUALITY[ctx.quality] ? ctx.quality : 'high';
      const q = QUALITY[quality];
      grid.nring = q[0]; grid.nseg = q[1]; refl.scale = q[2];
      U_.uNRing.value = grid.nring;
      material = new THREE.ShaderMaterial({
        name: 'ocean', uniforms, vertexShader: VERT, fragmentShader: FRAG,
        side: THREE.DoubleSide, fog: false, lights: false,
      });
      mesh = new THREE.Mesh(buildGeometry(grid.nring, grid.nseg), material);
      mesh.name = 'ocean';
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;           // after the other opaques: early-z saves the expensive water shader
      mesh.onBeforeRender = onBeforeRender;
      this.mesh = mesh;
      computeSplashPositions();
      if (quality !== 'low') ensureRT(ctx.renderer);
      ctx.scene.add(mesh);
      setupCamera(ctx.camera);
    },
    update(t, dt, ctx) {
      const S = ctx.S;
      frameNo++;
      U_.uTime.value = t;
      waveAmps(t, amps);
      updateEnv(t, S, ctx.scene);
      updateShip(t, S);
      updateWake(t);
      updateBerg(S, ctx.scene);
      const E = S.env;
      mesh.visible = !(E.underwater && E.depth > 450);
      refl.need = quality !== 'low' && !E.underwater && mesh.visible;
      U_.uReflInfo.value.x = 0;
    },
  });
})();
