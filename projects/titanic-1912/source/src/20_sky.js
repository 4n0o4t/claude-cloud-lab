import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/20_sky.js ====
// =====================================================================
// 20_sky.js — the night sky over 41°46′N 50°14′W, 14–15 April 1912:
// sky dome (gradient, airglow, horizon haze, Milky Way, aurora, faint
// hashed stars, shooting stars, dawn twilight + cirrus), ~9000 catalogue +
// procedural point stars, the global lights (hemisphere, starlight, dawn),
// scene.environment (PMREM of the sky) and scene.fog.
// Owner: sky agent. Module key 'sky', order 10.
//
// The real sky: the bright stars below are the actual naked-eye stars placed
// for the ship's position at ~2:20 a.m. ship's time (local sidereal time
// ~15.9 h) — the Big Dipper high in the north-west, Vega high in the east,
// Arcturus in the south-west, Scorpius low in the south, and the Milky Way
// rising from the north-east horizon through Cassiopeia, Cygnus and Aquila
// down to the star clouds of Sagittarius low in the south-south-east, with
// Jupiter shining steadily a few degrees east of Antares.
//
// Public API (TT.sky):
//   horizonColor, zenithColor   THREE.Color, scene-linear HDR, current frame (horizon incl. haze)
//   fogColor(dirY, target)      azimuth-averaged sky colour for a view elevation (dirY <= 0 -> horizon)
//   colorAt(dir, target)        sky colour for a full direction (same model as the GLSL below, no stars)
//   sunDir                      Vector3, dawn sun (below the horizon: -12° .. -1° as S.env.dawn 0 .. 1)
//   uniforms                    shared uniform objects: uHorizon, uZenith, uDawn, uStars, uHaze, uHazeCol,
//                               uSunDir, uGlowCol, uRoseCol, uBeltCol, uShadowCol, uBeltH (+ internal ones)
//   glsl                        uniform declarations + `vec3 ttSkyGradient(vec3 worldDir)` for other shaders
//                               (pass TT.sky.uniforms entries into the material); glslFunctions = function only
//   dome, stars, hemi, starLight, dawnLight, fog, raDecToWorld(raH, decDeg, target)
// Colours are authored as display colours and converted through an inverse of three's ACES Filmic
// curve, so the tone-mapped frame shows the palette anchors (zenith #02040b, horizon #0d1a2e).
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST;
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------
  // Observer / sky orientation
  // ------------------------------------------------------------------
  const LAT = 41.77 * DEG;          // 41°46′N
  const LST_H = 15.9;               // local sidereal time (hours) at the sinking
  const DOME_R = 25000;             // geometry radius (only matters for override-material passes)
  const STAR_R = 20000;

  // Bright stars: [RA hours, Dec degrees, V magnitude, B-V colour index] (J2000; precession to
  // 1912 is ~1.2°, below what the eye can tell here).
  const BRIGHT = [
    [6.752, -16.72, -1.46, 0.00], [6.399, -52.70, -0.74, 0.15], [14.261, 19.18, -0.05, 1.23], [18.616, 38.78, 0.03, 0.00],
    [5.278, 45.99, 0.08, 0.80], [5.242, -8.20, 0.13, -0.03], [7.655, 5.22, 0.34, 0.42], [5.919, 7.41, 0.50, 1.85],
    [14.660, -60.83, -0.27, 0.71], [14.064, -60.37, 0.61, -0.23], [19.846, 8.87, 0.77, 0.22], [4.599, 16.51, 0.85, 1.54],
    [16.490, -26.43, 0.96, 1.83], [13.420, -11.16, 0.97, -0.23], [7.755, 28.03, 1.14, 1.00], [22.961, -29.62, 1.16, 0.09],
    [20.690, 45.28, 1.25, 0.09], [10.140, 11.97, 1.35, -0.11], [6.977, -28.97, 1.50, -0.21], [7.577, 31.89, 1.58, 0.03],
    [17.560, -37.10, 1.62, -0.22], [5.419, 6.35, 1.64, -0.22], [5.438, 28.61, 1.65, -0.13], [5.604, -1.20, 1.69, -0.18],
    [22.137, -46.96, 1.74, -0.13], [5.679, -1.94, 1.77, -0.21], [12.900, 55.96, 1.77, -0.02], [11.062, 61.75, 1.79, 1.07],
    [3.405, 49.86, 1.79, 0.48], [7.140, -26.39, 1.83, 0.68], [17.622, -43.00, 1.86, 0.40], [18.403, -34.38, 1.85, -0.03],
    [13.792, 49.31, 1.86, -0.19], [5.992, 44.95, 1.90, 0.08], [6.629, 16.40, 1.93, 0.00], [2.530, 89.26, 1.98, 0.60],
    [6.378, -17.96, 1.98, -0.23], [9.460, -8.66, 1.98, 1.44], [2.120, 23.46, 2.00, 1.15], [18.921, -26.30, 2.05, -0.13],
    [0.727, -17.99, 2.04, 1.02], [0.140, 29.09, 2.06, -0.11], [1.162, 35.62, 2.05, 1.58], [14.845, 74.16, 2.08, 1.47],
    [17.582, 12.56, 2.08, 0.15], [3.136, 40.96, 2.12, -0.05], [2.065, 42.33, 2.10, 1.37], [11.818, 14.57, 2.14, 0.09],
    [0.945, 60.72, 2.15, -0.15], [15.578, 26.71, 2.23, -0.02], [13.399, 54.93, 2.23, 0.02], [20.370, 40.26, 2.23, 0.67],
    [0.675, 56.54, 2.24, 1.17], [17.943, 51.49, 2.24, 1.52], [0.153, 59.15, 2.28, 0.34], [16.006, -22.62, 2.29, -0.12],
    [11.031, 56.38, 2.37, -0.02], [14.750, 27.07, 2.37, 0.97], [21.736, 9.88, 2.39, 1.52], [11.897, 53.69, 2.44, 0.04],
    [23.063, 28.08, 2.42, 1.67], [21.310, 62.59, 2.45, 0.22], [23.079, 15.21, 2.49, -0.04], [12.257, 57.03, 3.31, 0.08],
    [20.770, 33.97, 2.48, 1.03], [19.512, 27.96, 3.05, 1.13], [19.750, 45.13, 2.87, -0.03], [18.835, 33.36, 3.52, 0.00],
    [18.982, 32.69, 3.25, -0.05], [19.771, 10.61, 2.72, 1.51], [19.922, 6.41, 3.71, 0.86],
    // Scorpius
    [16.091, -19.81, 2.62, -0.07], [15.981, -26.11, 2.89, -0.19], [16.353, -25.59, 2.89, 0.13], [16.598, -28.22, 2.82, -0.25],
    [16.836, -34.29, 2.29, 1.15], [16.864, -38.05, 3.00, -0.20], [16.910, -42.36, 3.62, 1.37], [17.203, -43.24, 3.33, 0.41],
    [17.793, -40.13, 3.03, 0.51], [17.708, -39.03, 2.41, -0.22], [17.513, -37.30, 2.70, -0.22],
    // Sagittarius (the Teapot)
    [19.044, -29.88, 2.60, 0.08], [18.350, -29.83, 2.70, 1.38], [18.466, -25.42, 2.81, 1.04], [18.761, -26.99, 3.17, -0.11],
    [19.116, -27.67, 3.32, 1.19], [18.097, -30.42, 2.99, 1.00],
    // Corona Borealis, Boötes, Hercules
    [15.464, 29.11, 3.68, 0.28], [15.713, 26.30, 3.84, 0.00], [15.960, 26.88, 4.15, 1.23], [15.549, 31.36, 4.14, -0.13],
    [13.911, 18.40, 2.68, 0.58], [14.535, 38.31, 3.03, 0.19], [15.032, 40.39, 3.50, 0.97], [15.258, 33.31, 3.47, 0.95],
    [14.531, 30.37, 3.58, 1.30], [16.688, 31.60, 2.81, 0.65], [16.715, 38.92, 3.48, 0.92], [17.251, 36.81, 3.16, 1.44],
    [17.005, 30.93, 3.92, -0.01], [16.504, 21.49, 2.77, 0.94], [17.244, 14.39, 3.10, 1.44],
    // Cassiopeia, Ophiuchus, Virgo, Leo, Libra, Serpens, Corvus, Draco, Ursa Minor, Pegasus, Centaurus, Lupus
    [1.430, 60.24, 2.68, 0.13], [1.907, 63.67, 3.37, -0.15],
    [17.173, -15.72, 2.43, 0.06], [16.619, -10.57, 2.56, 0.02], [16.239, -3.69, 2.73, 1.58], [17.725, 4.57, 2.77, 1.16],
    [12.694, -1.45, 2.74, 0.36], [13.036, 10.96, 2.83, 0.94], [10.333, 19.84, 2.08, 1.13], [11.235, 20.52, 2.56, 0.12],
    [15.283, -9.38, 2.61, -0.11], [14.848, -16.04, 2.75, 0.15], [15.738, 6.43, 2.63, 1.17],
    [12.263, -17.54, 2.59, -0.11], [12.573, -23.40, 2.65, 0.89], [12.498, -16.52, 2.95, -0.05], [12.169, -22.62, 3.00, 1.33],
    [17.507, 52.30, 2.79, 0.98], [14.073, 64.38, 3.65, -0.05], [16.400, 61.51, 2.73, 0.91], [15.345, 71.83, 3.00, 0.05],
    [0.220, 15.18, 2.83, -0.23], [14.111, -36.37, 2.06, 1.01], [14.699, -47.39, 2.30, -0.15], [14.976, -43.13, 2.68, -0.18],
    [13.926, -47.29, 2.55, -0.18],
    // Aquila, Lyra, Cygnus fainter members; Delphinus; Sagitta; Vulpecula region
    [19.425, 3.11, 3.36, 0.32], [19.104, 13.86, 2.99, 0.01], [19.090, -4.88, 3.43, -0.10], [20.188, -0.82, 3.24, -0.07],
    [20.626, 14.60, 3.64, -0.06], [20.554, 11.30, 3.77, 1.03], [20.661, 15.91, 3.87, -0.02], [19.979, 19.49, 3.47, 1.57],
    [21.216, 30.23, 3.21, 0.99], [19.495, 51.73, 3.76, -0.03], [20.953, 41.17, 3.72, 0.40],
    // Perseus / Auriga / Andromeda / Triangulum stragglers near the northern horizon
    [3.964, 40.01, 2.89, -0.20], [3.715, 47.79, 3.01, -0.12], [3.080, 53.51, 2.93, 0.70], [4.950, 33.17, 2.69, 1.53],
    [5.109, 41.23, 3.17, -0.18], [0.656, 30.86, 3.27, 1.28], [2.159, 34.99, 3.00, 0.14],
  ];
  // Jupiter in April 1912: a few degrees east of Antares, in Scorpius / Ophiuchus (steady, no twinkle)
  const PLANETS = [[16.92, -22.1, -2.0, 0.83]];

  // Equatorial (x→RA 0h, y→RA 6h, z→NCP) to world (+X west, +Y up, +Z north).
  // A star at hour angle H, dec δ: r = cosδ cosH·Q + cosδ sinH·W + sinδ·P with
  // Q = meridian equator point (up & south), W = west point, P = celestial pole.
  function eqToWorldMatrix(lat, lstH) {
    const L = (lstH / 24) * Math.PI * 2;
    const sL = Math.sin(L), cL = Math.cos(L), sp = Math.sin(lat), cp = Math.cos(lat);
    const Q = new THREE.Vector3(0, cp, -sp), W = new THREE.Vector3(1, 0, 0), P = new THREE.Vector3(0, sp, cp);
    const cx = Q.clone().multiplyScalar(cL).addScaledVector(W, sL);
    const cy = Q.clone().multiplyScalar(sL).addScaledVector(W, -cL);
    const m = new THREE.Matrix3();
    m.set(cx.x, cy.x, P.x, cx.y, cy.y, P.y, cx.z, cy.z, P.z);
    return m;
  }
  // Equatorial -> galactic (x→galactic centre, y→l=90°, z→north galactic pole)
  const EQ2GAL = new THREE.Matrix3().set(
    -0.0548755604, -0.8734370902, -0.4838350155,
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762);
  const M_E2W = eqToWorldMatrix(LAT, LST_H);
  const M_W2E = M_E2W.clone().transpose();
  const M_W2G = EQ2GAL.clone().multiply(M_W2E);
  const M_G2W = M_W2G.clone().transpose();
  const raDecToWorld = (raH, decD, out) => {
    const a = raH / 24 * Math.PI * 2, d = decD * DEG;
    return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)).applyMatrix3(M_E2W);
  };

  // ------------------------------------------------------------------
  // Colour helpers. three's ACES Filmic (as used by the renderer / OutputPass) crushes very
  // dark values, so palette anchors given as *display* colours are converted to the scene-linear
  // HDR values that display as that colour after tone mapping (exposure 1).
  // ------------------------------------------------------------------
  function acesFwd(r, g, b, out) {
    r /= 0.6; g /= 0.6; b /= 0.6;
    const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
    const ig = 0.07600 * r + 0.90834 * g + 0.01566 * b;
    const ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
    const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    const fr = f(ir), fg = f(ig), fb = f(ib);
    out[0] = U.clamp(1.60475 * fr - 0.53108 * fg - 0.07367 * fb);
    out[1] = U.clamp(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb);
    out[2] = U.clamp(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb);
    return out;
  }
  const _a3 = [0, 0, 0];
  // display colour (hex or THREE.Color in linear display space) -> scene-linear HDR THREE.Color
  function sceneFromDisplay(hex, out) {
    const tgt = new THREE.Color(hex); // sRGB hex -> linear
    const T = [Math.max(tgt.r, 1e-5), Math.max(tgt.g, 1e-5), Math.max(tgt.b, 1e-5)];
    const v = [T[0] * 1.2 + 0.004, T[1] * 1.2 + 0.004, T[2] * 1.2 + 0.004];
    for (let it = 0; it < 60; it++) {
      acesFwd(v[0], v[1], v[2], _a3);
      for (let c = 0; c < 3; c++) {
        const o = Math.max(_a3[c], 1e-6);
        v[c] = Math.max(1e-5, Math.min(40, v[c] * Math.pow(T[c] / o, 0.6)));
      }
    }
    return (out || new THREE.Color()).setRGB(v[0], v[1], v[2]);
  }
  // B-V colour index -> normalised linear RGB (Ballesteros temperature + Planck locus fit)
  function bvToRGB(bv, out) {
    const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    // Tanner Helland style blackbody fit (sRGB-ish), then linearise
    const t = T / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
    if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const c = out || new THREE.Color();
    c.setRGB(U.clamp(r / 255), U.clamp(g / 255), U.clamp(b / 255), THREE.SRGBColorSpace);
    const m = Math.max(c.r, c.g, c.b);
    return c.multiplyScalar(1 / m);
  }

  // ------------------------------------------------------------------
  // GLSL. SKY_GRADIENT_GLSL is also published as TT.sky.glsl so other shaders (the ocean)
  // can evaluate exactly the same horizon / twilight colours with the shared uniforms.
  // ------------------------------------------------------------------
  const SKY_UNIFORMS_GLSL = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHazeCol; uniform float uHaze;
uniform float uDawn; uniform float uStars; uniform vec3 uSunDir;
uniform vec3 uGlowCol; uniform vec3 uRoseCol; uniform vec3 uBeltCol; uniform vec3 uShadowCol; uniform float uBeltH;
`;
  const SKY_GRADIENT_GLSL = /* glsl */`
// Sky colour (scene-linear HDR) for a world direction, without stars / Milky Way / aurora.
vec3 ttSkyGradient(vec3 d){
  float hp = clamp(d.y, 0.0, 1.0);
  float w = pow(1.0 - hp, 3.5);
  vec3 c = mix(uZenith, uHorizon, w);
  c = mix(c, uHazeCol, clamp(uHaze * 0.9 * exp(-hp / 0.045), 0.0, 1.0));
  if (uDawn > 0.0) {
    vec2 dh = d.xz; float lh = length(dh); dh = lh > 1e-5 ? dh / lh : vec2(1.0, 0.0);
    vec2 sh = normalize(uSunDir.xz + vec2(1e-6));
    float az = acos(clamp(dot(dh, sh), -1.0, 1.0));
    float sunSide = exp(-az * az / 0.9), core = exp(-az * az / 0.12);
    float anti = exp(-(az - 3.14159265) * (az - 3.14159265) / 1.2);
    float shadow = anti * (1.0 - smoothstep(uBeltH - 0.06, uBeltH - 0.015, hp));
    float tw = clamp(uDawn * 4.0, 0.0, 1.0);
    c = mix(c, uShadowCol, shadow * 0.85 * tw);
    float rr = (hp - 0.16) / 0.14, rb = (hp - uBeltH) / 0.055;
    c = mix(c, uRoseCol, clamp(exp(-rr * rr) * exp(-az * az / 0.6) * 0.75, 0.0, 1.0) * tw);
    c = mix(c, uBeltCol, clamp(anti * exp(-rb * rb) * 0.85, 0.0, 1.0) * tw);
    c = mix(c, uGlowCol, clamp(0.35 * sunSide * exp(-hp / 0.09) + 0.9 * core * exp(-hp / 0.05), 0.0, 1.0) * tw);
  }
  return c;
}
`;

  const MW_BMAX = 0.45, MW_ENC = 6.0;
  const MW_DEFS = `#define MW_BMAX ${MW_BMAX.toFixed(3)}
#define MW_ENC ${MW_ENC.toFixed(1)}
#define MW_CLUMP_NORM 12.75
#define AURORA_GAIN 1.25
`;
  const MW_COMMON_GLSL = /* glsl */`
// Milky Way helpers shared by the bake and the dome (l = galactic longitude, b = latitude, radians)
float mwLon(float l){   // brightness along the band: Sagittarius > Scutum/Aquila > Cygnus > Cassiopeia > anticentre
  return 0.3 + 0.45 * (0.5 + 0.5 * cos(l)) + 0.4 * exp(-sq((l - 1.36) / 0.3)) + 0.35 * exp(-sq((l - 0.47) / 0.2)) + 0.2 * exp(-sq((l + 0.45) / 0.3))
       + 0.18 * exp(-sq((l - 2.1) / 0.35));   // Cassiopeia / Perseus
}
float mwWarp(float l){ return 0.03 * sin(l * 2.0 + 0.6) + 0.012 * sin(l * 5.0); }
float mwHalo(float l, float bb){ return exp(-bb * bb / (2.0 * 0.26 * 0.26)) * 0.085 * (0.6 + 0.4 * cos(l * 0.5)); }
`;
  // Full-detail Milky Way, rendered once at init into the (l, b) map.
  const MW_BAKE_FS = /* glsl */`
precision highp float;
${MW_DEFS}varying vec2 vUv;
${TT.glsl.noise}
float sq(float x){ return x * x; }
${MW_COMMON_GLSL}
// Sparse-convolution clump noise: one soft round knot per jittered cell with a random size and
// weight. Isotropic on purpose: star clouds are knots and clumps, never streaks. Mean ~1.
float mwClumps(vec3 p, float seed){
  vec3 i = floor(p), f = fract(p);
  float s = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 c = i + o + seed;
    vec3 dv = o + vec3(hash13(c), hash13(c + 17.31), hash13(c + 41.73)) - f;
    float hr = hash13(c + 63.9), ha = hash13(c + 89.7);
    float r = 0.2 + 0.25 * hr;
    s += ha * ha * (0.4 + hr) * exp(-dot(dv, dv) / (r * r));
  }
  return s * MW_CLUMP_NORM;
}

// The Milky Way in galactic coordinates (x: galactic centre, y: l = 90°, z: north galactic pole).
// Built like a long photograph from a dark ocean: a soft diffuse glow, mottled star clouds made of
// knots on several scales, dark nebulae with crisp ragged edges carving the band (the Great Rift,
// the Ophiuchus streamers, scattered globules), and a granular texture of countless faint stars.
vec3 milkyWay(vec3 g, vec2 fc, out float density){
  density = 0.0;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  float l2 = l * l;
  // brightness along the band: Sagittarius > Scutum/Aquila > Cygnus > Cassiopeia > anticentre
  float lon = mwLon(l);
  float width = 0.07 + 0.06 * exp(-l2 / 0.45) + 0.02 * exp(-sq((l - 1.4) / 0.4));
  float bb = b - mwWarp(l);
  float disk = exp(-bb * bb / (2.0 * width * width));
  float halo = mwHalo(l, bb);
  float bulge = exp(-l2 / (2.0 * 0.27 * 0.27) - (b + 0.03) * (b + 0.03) / (2.0 * 0.15 * 0.15));
  vec3 colArm = vec3(0.8, 0.87, 1.0);
  vec3 colBulge = vec3(1.0, 0.9, 0.76);
  // isotropic coordinates on the sphere with a small organic warp
  vec3 wq = g * 11.0;
  vec3 p = g + vec3(snoise(wq), snoise(wq + 7.7), snoise(wq + 3.1)) * 0.012;
  // ---- star clouds: gentle large-scale variation, clumpier toward small scales ----
  float n1 = fbm3(p * 4.0 + 3.0, 2);                  // broad (~10°), low contrast
  float n2 = fbm3(p * 22.0 + 5.0, 3);                 // cloud-to-cloud (~2°)
  float n3 = fbm3(p * 110.0 + 9.0, 2);                // mottling (~0.3°)
  vec3 wk = g * 30.0 + 5.0;                           // knots get lumpy, irregular outlines
  vec3 pk = p + vec3(snoise(wk), snoise(wk + 3.3), snoise(wk + 9.1)) * 0.022;
  float k1 = min(mwClumps(pk * 14.0, 0.0), 2.5);      // star-cloud knots (1–2°)
  float k2 = min(mwClumps(pk * 40.0, 19.0), 2.5);     // small knots (0.3–0.7°)
  float clouds = exp(0.6 * n1 + 0.9 * n2 + 0.7 * n3) * (0.78 + 0.22 * k1) * (0.8 + 0.2 * k2) * 0.56;
  // ---- dust: dark nebulae with crisp, ragged edges ----
  float zone = exp(-sq(bb / 0.1));                    // dust hugs the plane
  float oph = exp(-sq((l - 0.05) / 0.17) - sq((b - 0.13) / 0.1));   // Ophiuchus / Pipe streamers
  float dA = fbm3(p * 8.0 + 31.0, 3);                 // large dark clouds
  float dB = fbm3(p * 24.0 + 47.0, 3);                // smaller clouds, ragged edges
  float dC = snoise(p * 75.0 + 13.0);                 // fine edge detail
  float dn = dA + 0.5 * dB + 0.12 * dC;
  float thr = 0.42 - 0.2 * zone - 0.16 * oph;
  float dark = smoothstep(thr, thr + 0.03, dn);       // the crisp edge
  float dcore = smoothstep(thr + 0.03, thr + 0.2, dn);
  // Great Rift: a ragged dark lane splitting the band from Cygnus down to Ophiuchus
  float riftC = 0.012 + 0.014 * sin(l * 3.3 + 0.4) + 0.014 * dA;
  float riftW = (0.02 + 0.009 * sin(l * 5.1 + 1.3)) * (1.0 + 0.5 * dB);
  float riftD = abs(b - riftC) / max(riftW, 0.004) - 0.6 * dB - 0.25 * dC;
  float rift = (1.0 - smoothstep(0.85, 1.0, riftD)) * smoothstep(-0.35, -0.08, l) * smoothstep(1.6, 1.28, l)
             * smoothstep(-0.55, -0.25, dA + 0.4 * dB);   // a few bright bridges break it
  // thin dust lanes: tendrils trailing off the dark clouds (zero-crossings of a noise, only near the clouds)
  float rq = 1.0 - abs(snoise(p * 9.0 + 71.0) + 0.2 * snoise(p * 27.0 + 5.0));
  float lanes = smoothstep(0.9, 0.97, rq) * smoothstep(thr - 0.2, thr - 0.02, dn);
  float hiLat = 1.0 - smoothstep(0.26, 0.4, abs(b));  // keep the bake edge clean
  float tau = (dark * (0.3 + 0.7 * dcore) * (0.25 + 0.6 * zone + 0.7 * oph) + rift * (0.55 + 0.6 * dcore)
             + lanes * (0.25 + 0.45 * zone + 0.4 * oph)) * hiLat;
  float ext = exp(-tau);
  // ---- granular texture: countless faint stars, following the brightness ----
  float gA = hash12(fc), gB = hash12(fc + 91.7), gC = hash12(fc + 7.3);
  float grain = mix(1.063, 0.8 + 0.4 * gA + step(0.97, gB) * (0.8 + 2.6 * gC), MW_GRAIN);   // (coarser maps: less)
  float bulgeClouds = exp(0.5 * n1 + 0.8 * n2 + 0.15 * n3) * (0.7 + 0.3 * k1);   // bright and dense: gentler mottling
  float I0 = disk * lon * clouds + bulge * 1.6 * bulgeClouds;
  float I = (halo * lon * (0.9 + 0.2 * gA) + I0 * grain) * ext;
  density = clamp((disk * clouds + bulge) * ext, 0.0, 2.0);
  vec3 col = mix(colArm, colBulge, clamp(bulge * 1.3 + 0.3 * exp(-l2 / 0.25), 0.0, 1.0));
  col *= mix(vec3(1.0), vec3(1.0, 0.86, 0.72), clamp(tau * 0.5, 0.0, 0.8));    // reddening at dust edges
  return col * I;
}


void main(){
  float l = (vUv.x - 0.5) * 6.2831853;
  float b = (vUv.y - 0.5) * 2.0 * MW_BMAX;
  vec3 g = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
  float dens;
  vec3 c = milkyWay(g, gl_FragCoord.xy, dens);
  gl_FragColor = vec4(sqrt(max(c, 0.0) / MW_ENC), clamp(dens * 0.5, 0.0, 1.0));
}
`;
  const MW_BAKE_VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

  const DOME_VS = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec3 v = mat3(viewMatrix) * normalize(position);   // rotation only: centred on any camera
  gl_Position = projectionMatrix * vec4(v, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;           // on the far plane
}
`;

  const DOME_FS = /* glsl */`
precision highp float;
${MW_DEFS}${SKY_UNIFORMS_GLSL}
uniform float uMilky; uniform float uAurora; uniform float uTime; uniform float uRT; uniform float uUnder;
uniform vec3 uUnderCol; uniform mat3 uW2E; uniform mat3 uW2G; uniform vec3 uExtK;
uniform vec3 uMA; uniform vec3 uMB; uniform vec4 uMP;
uniform vec3 uFlashPos[4]; uniform vec3 uFlashCol[4];
uniform float uGain; uniform float uCirrus; uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform vec3 uAirglow; uniform float uResScale; uniform float uMWGain; uniform float uStarGain;
varying vec3 vDir;
${TT.glsl.noise}
float sq(float x){ return x * x; }
${SKY_GRADIENT_GLSL}
${MW_COMMON_GLSL}

#ifndef ENV_MODE
// Faint background stars on a cube-face grid in equatorial coordinates (fixed to the sky).
vec3 starLayer(vec3 e, float N, float dens, float f0, float f1, float px, float seed){
  vec3 a = abs(e); vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = e.yz / a.x; face = e.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = e.xz / a.y; face = e.y > 0.0 ? 2.0 : 3.0; }
  else { uv = e.xy / a.z; face = e.z > 0.0 ? 4.0 : 5.0; }
  float cellAng = 2.0 / N / (1.0 + 0.5 * dot(uv, uv));
  vec2 g = (uv * 0.5 + 0.5) * N;
  vec2 cell = floor(g); vec2 f = g - cell;
  vec2 key = cell + vec2(face * 1013.17 + seed, face * 71.3 - seed * 3.1);
  float h1 = hash12(key);
  if (h1 > dens) return vec3(0.0);
  vec2 pos = 0.22 + 0.56 * vec2(hash12(key + 17.3), hash12(key + 41.9));
  float r = length(f - pos) * cellAng / max(px, 1e-6);   // distance in pixels
  float h2 = hash12(key + 5.7);
  float flux = mix(f0, f1, h2 * h2 * h2);
  float lod = smoothstep(2.2, 4.5, cellAng / max(px, 1e-6));   // fade out when cells shrink below ~3 px
  float I = flux * exp(-r * r / (2.0 * 0.62 * 0.62)) * lod;
  float bv = hash12(key + 93.1);
  vec3 tint = bv < 0.3 ? vec3(0.8, 0.88, 1.0) : bv < 0.75 ? vec3(1.0, 0.97, 0.92) : vec3(1.0, 0.85, 0.68);
  return tint * I;
}
#endif

// The Milky Way: baked once (full detail, see MW_BAKE_FS) into a (longitude, latitude) map for |b| < MW_BMAX;
// only the faint outer halo is evaluated analytically beyond it.
uniform sampler2D uMWTex;
vec3 milkyWay(vec3 g, out float density){
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  vec2 uv = vec2(l * 0.15915494 + 0.5, clamp(b / (2.0 * MW_BMAX) + 0.5, 0.0, 1.0));
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);     // no mip seam where longitude wraps
  vec4 tx = textureGrad(uMWTex, uv, gx, gy);
  float inside = step(abs(b), MW_BMAX);
  density = tx.a * 2.0 * inside;
  return mix(vec3(0.8, 0.87, 1.0) * mwHalo(l, b - mwWarp(l)) * mwLon(l), tx.rgb * tx.rgb * MW_ENC, inside);
}

// Aurora borealis, low over the northern horizon (+Z): a quiet, pale-green glow arc that witnesses
// half-noticed, not a light show. A soft lower border that folds gently, a few irregular rays (one per
// jittered azimuth cell, many cells empty, random width / strength / height, gathered into slowly
// changing active patches), a gentle fade upward into faint rose-magenta tops. Drifts with story time.
// cheap smooth 2D value noise (-1..1): the aurora only needs (azimuth, time) patterns
float vn2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), e = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y) * 2.0 - 1.0;
}
float auroraFold(float a, float t){
  return vn2(vec2(a * 2.3, t * 0.015)) * 0.6 + vn2(vec2(a * 5.7 + 1.7, t * 0.028 + 4.0)) * 0.3;
}
// sparse rays along u (azimuth in cells): x = brightness, y = relative ray height (0..1)
vec2 auroraRays(float u, float t, float seed){
  float i = floor(u), f = fract(u);
  float s = 0.0, hs = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = i + float(k);
    float h1 = hash12(vec2(c, seed)), h2 = hash12(vec2(c, seed + 7.13)), h3 = hash12(vec2(c, seed + 13.7));
    float pos = float(k) + 0.2 + 0.6 * h1 + 0.1 * sin(t * (0.04 + 0.05 * h2) + h3 * 6.28);   // slow sway
    float w = 0.12 + 0.22 * h2 * h2;                                                       // ray width (cells)
    float a = smoothstep(0.35, 0.9, h3) * (0.65 + 0.35 * sin(t * (0.07 + 0.08 * h1) + h2 * 9.0)); // many cells empty; slow pulse
    float g = a * exp(-sq((f - pos) / w));
    s += g; hs += g * h1;
  }
  return vec2(s, hs / max(s, 1e-4));
}
vec3 aurora(vec3 d){
  float az = atan(d.x, d.z);           // 0 = north
  float el = d.y;
  float span = exp(-sq(az / 1.0));
  if (span < 0.01 || el < -0.01 || el > 0.3) return vec3(0.0);
  float t = uTime;
  float f0 = auroraFold(az, t);
  float df = (auroraFold(az + 0.01, t) - f0) / 0.01;
  float edgeOn = 0.8 + 0.35 * exp(-abs(df) * 0.9);                  // folds seen edge-on glow a little brighter
  float base = -0.006 + 0.014 * cos(az * 1.3) + 0.008 * f0;        // lower border within ~0.5° of the horizon: rises out of the haze
  float x = el - base;
  float act = smoothstep(-0.5, 0.6, 0.75 * vn2(vec2(az * 2.4 + 2.0, 1.0 + t * 0.0015)) + 0.35 * vn2(vec2(az * 6.5, t * 0.012 + 7.0)));   // active / quiet stretches
  float aw = az + 0.025 * f0 + 0.012 * vn2(vec2(az * 8.0, t * 0.02 + 3.0));           // uneven ray spacing
  vec2 R1 = auroraRays(aw * 11.0, t, 1.0);
  vec2 R2 = auroraRays(aw * 29.0 + 5.0, t, 2.0);
  float rays = R1.x * 0.6 + R2.x * 0.25;
  float rh = (R1.x * 0.6 * R1.y + R2.x * 0.25 * R2.y * 0.5) / max(rays, 1e-4);
  float H = 0.026 + 0.018 * act + 0.005 * f0;                        // glow scale height (rad)
  float Hr = H * (1.1 + 0.8 * rh);                                   // rays reach a little higher, unevenly
  float xp = max(x, 0.0);
  float lower = smoothstep(-0.016, 0.01, x);                          // soft lower border
  float glow = exp(-xp / H);
  float rayV = exp(-xp / Hr) * (1.0 - 0.5 * exp(-xp / 0.006));      // rays grow out of the glow just above the border
  float I = lower * (glow * (0.25 + 0.6 * act) + rays * rayV * (0.1 + 0.45 * act)) * edgeOn;
  vec3 green = vec3(0.5, 1.0, 0.66);
  vec3 top = vec3(0.82, 0.46, 0.74);
  vec3 col = mix(green, top, smoothstep(1.0, 3.0, xp / H) * 0.55);
  vec3 acc = col * I;
  acc += vec3(0.32, 0.8, 0.52) * 0.06 * exp(-max(el - 0.01, 0.0) / 0.06) * smoothstep(-0.01, 0.01, el);
  return acc * span * AURORA_GAIN;
}

#ifndef ENV_MODE
// Shooting star: a short great-circle streak from uMA toward uMB; uMP = (head 0..1, intensity, trail length, 0)
vec3 meteor(vec3 d, float px){
  vec3 n = normalize(cross(uMA, uMB));
  float perp = dot(d, n);
  float sig = max(px * 0.75, 0.00018);
  if (abs(perp) > sig * 6.0 + 0.004) return vec3(0.0);
  float ang = acos(clamp(dot(uMA, uMB), -1.0, 1.0));
  vec3 dp = normalize(d - n * perp);
  vec3 T = cross(n, uMA);
  float s = atan(dot(dp, T), dot(dp, uMA)) / ang;
  float along = (uMP.x - s) / uMP.z;                     // 0 at the head, 1 at the end of the trail
  if (along < -0.1 || along > 1.0) return vec3(0.0);
  float trail = pow(clamp(1.0 - along, 0.0, 1.0), 1.6) * smoothstep(-0.02, 0.02, along);
  float headG = exp(-sq((s - uMP.x) * ang / (sig * 2.5)));
  float w = exp(-perp * perp / (2.0 * sig * sig * (1.0 + along * 1.5)));
  vec3 col = mix(vec3(0.8, 1.0, 0.9), vec3(1.0, 0.72, 0.45), clamp(along, 0.0, 1.0));
  return col * (trail * 1.6 + headG * 3.0) * w * uMP.y;
}
#endif

void main(){
  vec3 d = normalize(vDir);
  float px = max(length(dFdx(d)), length(dFdy(d)));
  if (uUnder > 0.5) { gl_FragColor = vec4(uUnderCol * uGain, 1.0);
#ifndef ENV_MODE
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
#endif
    return; }
  float h = d.y;
  float hp = clamp(h, 0.0, 1.0);
  vec3 sky = ttSkyGradient(d);
  vec3 col = sky;
  // airglow: faint band ~5–15° up, with slow wave structure
  float ag = exp(-sq((hp - 0.14) / 0.1)) * (0.75 + 0.25 * vn2(d.xz * 3.0 + 0.5));
  col += uAirglow * ag * (1.0 - uDawn);
  // extinction toward the horizon (dimmer, redder), stronger in haze
  float X = min(1.0 / (hp + 0.025 * exp(-11.0 * hp)), 12.0);
  vec3 ext = pow(vec3(10.0), -0.4 * uExtK * (X - 1.0));
  float above = smoothstep(-0.002, 0.006, h);
  float skyLum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  float contrast = 1.0 / (1.0 + skyLum * 6.0);          // sky brightness washes out faint light
  vec3 e = uW2E * d;
  vec3 g = uW2G * d;
  float dens;
  vec3 mw = milkyWay(g, dens);
  col += mw * uMilky * uMWGain * ext * above * contrast;
#ifndef ENV_MODE
  float sd = 0.55 + 0.9 * dens;
  vec3 st = starLayer(e, 110.0, 0.30 * sd, 0.022, 0.075, px, 0.0) + starLayer(e, 230.0, 0.2 * sd, 0.012, 0.045, px, 57.0);
  if (dens > 0.05) st += (starLayer(e, 470.0, 0.55 * min(dens, 1.2), 0.015, 0.08, px, 113.0)
                        + starLayer(e, 900.0, 0.6 * min(dens, 1.2), 0.012, 0.05, px, 171.0)) * uMilky;
  col += st * uStars * uStarGain * ext * above * contrast * uResScale * uResScale;
  if (uMP.y > 0.0) col += meteor(d, px) * ext * above;
#else
  col += vec3(0.8, 0.85, 1.0) * 0.004 * uStars * (0.6 + dens) * above;   // integrated starlight
#endif
  float hazeOcc = 1.0 - 0.75 * clamp(uHaze * 1.4 * exp(-hp / 0.04), 0.0, 1.0);   // the horizon haze swallows low light
  if (uAurora > 0.0) col += aurora(d) * uAurora * sqrt(ext) * above * hazeOcc;
  // thin high cirrus lit from below by the dawn
  if (uCirrus > 0.0 && h > 0.015) {
    vec2 uv = d.xz / (h + 0.06);
    vec2 q = mat2(0.82, 0.57, -0.57, 0.82) * uv;
    float band = smoothstep(-0.1, 0.55, snoise(vec3(q.x * 0.1, q.y * 0.3, 5.0)));     // a few broad sheets
    float n = fbm3(vec3(q.x * 0.3, q.y * 2.0, uTime * 0.002), 4);                        // streaks along the wind
    float fib = 0.55 + 0.45 * snoise(vec3(q.x * 0.5, q.y * 16.0, 2.0));                  // fine fibres (mares' tails)
    float dc = smoothstep(0.02, 0.5, n) * fib * band * smoothstep(0.015, 0.14, h) * uCirrus;
    vec2 sh = normalize(uSunDir.xz + vec2(1e-6));
    float cs = clamp(dot(normalize(d.xz + vec2(1e-6)), sh) * 0.5 + 0.5, 0.0, 1.0);
    vec3 lit = mix(uCloudDark, uCloudLit, pow(cs, 2.2)) * (0.7 + 0.3 * smoothstep(0.0, 0.3, n));
    col = mix(col, lit, clamp(dc, 0.0, 0.85));
  }
#ifndef ENV_MODE
  // distress rockets light up the haze around them
  for (int i = 0; i < 4; i++) {
    if (dot(uFlashCol[i], vec3(1.0)) <= 0.0) continue;
    vec3 fd = normalize(uFlashPos[i] - cameraPosition);
    float c = clamp(dot(d, fd), -1.0, 1.0);
    float a = acos(c);
    col += uFlashCol[i] * (exp(-a / 0.04) * 0.45 + exp(-a / 0.3) * 0.2 + 0.03) * (0.4 + 0.6 * exp(-hp / 0.25));
  }
#endif
  gl_FragColor = vec4(col * uGain, 1.0);
#ifndef ENV_MODE
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;

  const STAR_VS = /* glsl */`
${SKY_UNIFORMS_GLSL}
uniform float uRT; uniform vec3 uExtK; uniform float uResScale; uniform float uStarGain; uniform float uTwinkle;
attribute vec3 aCol;
attribute vec3 aInfo;     // x: peak flux, y: seed, z: halo 0..1
varying vec3 vCol; varying float vSize; varying float vHalo; varying float vSig;
${SKY_GRADIENT_GLSL}
void main(){
  vec3 d = normalize(position);
  vec3 v = mat3(viewMatrix) * d;
  gl_Position = projectionMatrix * vec4(v, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
  float h = d.y;
  float vis = smoothstep(-0.002, 0.006, h) * uStars;
  if (vis <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vSize = 1.0; vHalo = 0.0; vSig = 1.0; return; }
  float hp = clamp(h, 0.0, 1.0);
  float X = min(1.0 / (hp + 0.025 * exp(-11.0 * hp)), 12.0);
  vec3 ext = pow(vec3(10.0), -0.4 * uExtK * (X - 1.0));
  vec3 sky = ttSkyGradient(d);
  float skyLum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  vis /= 1.0 + skyLum * 6.0;
  // scintillation: gentle overhead, strong (and chromatic) near the horizon
  float s = aInfo.y * 97.0;
  float amp = uTwinkle * (0.06 + 0.05 * (X - 1.0)) * (aInfo.y < 0.0 ? 0.15 : 1.0);
  float tw = 0.55 * sin(uRT * (2.7 + 2.3 * fract(s)) + s) + 0.3 * sin(uRT * (6.1 + 3.7 * fract(s * 1.7)) + s * 2.3)
           + 0.15 * sin(uRT * (13.3 + 5.0 * fract(s * 3.1)) + s * 5.1);
  float twk = max(0.05, 1.0 + amp * tw);
  vec3 ctw = vec3(1.0 + 0.35 * amp * sin(uRT * 5.3 + s * 1.9), 1.0, 1.0 + 0.35 * amp * sin(uRT * 4.1 + s * 2.9));
  vCol = aCol * ext * ctw * (aInfo.x * twk * vis * uStarGain * uResScale * uResScale);
  // brighter stars image as larger disks (as on film / in the eye), the brightest get a soft glow
  float mag = -log2(aInfo.x / 6.0) / (0.34 * 3.321928);
  vSig = (0.62 + 0.27 * max(0.0, 3.6 - mag)) * max(uResScale, 0.5);
  vHalo = aInfo.z;
  vSize = max(ceil(vSig * 7.0), mix(5.0, 34.0, aInfo.z) * max(uResScale, 0.5));
  gl_PointSize = vSize;
}
`;
  const STAR_FS = /* glsl */`
varying vec3 vCol; varying float vSize; varying float vHalo; varying float vSig;
void main(){
  vec2 p = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(p, p);
  float core = exp(-r2 / (2.0 * vSig * vSig)) * (0.66 * 0.66) / (vSig * vSig) * (1.0 + 0.6 * (vSig - 0.62));
  float r = sqrt(r2);
  float halo = vHalo * (0.05 * exp(-r / 1.6) + 0.012 * exp(-r / 5.0)) * (1.0 - smoothstep(vSize * 0.36, vSize * 0.5, r));
  gl_FragColor = vec4(vCol * (core + halo), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  // ------------------------------------------------------------------
  // Palettes (display colours -> scene-linear at init)
  // ------------------------------------------------------------------
  // Twilight keyframes by S.env.dawn (display colours). glow = the horizon under the (hidden) sun,
  // rose = the band ~9° up on the sun side, belt = the Belt of Venus in the west, shadow = the
  // Earth's shadow beneath it. The shader mixes toward these.
  const DAWN_KEYS = [
    { d: 0.0, zenith: '#02040b', horizon: '#0d1a2e', haze: '#122036', glow: '#0d1a2e', rose: '#0b1628', belt: '#0d1a2e', shadow: '#0d1a2e', beltH: 0.1, cloudLit: '#000000', cloudDark: '#000000', cirrus: 0 },
    { d: 0.3, zenith: '#0a1530', horizon: '#223052', haze: '#2c3656', glow: '#6c4a5c', rose: '#39365a', belt: '#2a3052', shadow: '#1a2440', beltH: 0.13, cloudLit: '#6a4a62', cloudDark: '#1e2238', cirrus: 0.55 },
    { d: 0.55, zenith: '#1d3060', horizon: '#56608a', haze: '#6a6c90', glow: '#d8865e', rose: '#8a6e8c', belt: '#6e6488', shadow: '#384470', beltH: 0.12, cloudLit: '#e0948c', cloudDark: '#4a4a70', cirrus: 0.8 },
    { d: 0.8, zenith: '#3e5090', horizon: '#8a8cb4', haze: '#9e9ab8', glow: '#f4ac62', rose: '#d8a0a0', belt: '#ae90aa', shadow: '#58648e', beltH: 0.1, cloudLit: '#f6c09a', cloudDark: '#7a7494', cirrus: 0.9 },
    { d: 1.0, zenith: '#5664a2', horizon: '#a2a2c6', haze: '#b4aec8', glow: '#f9c06a', rose: '#e8aca0', belt: '#bea0b4', shadow: '#6a76a0', beltH: 0.085, cloudLit: '#fbd2a4', cloudDark: '#8e86a6', cirrus: 0.9 },
  ];
  const UNDER = { shallow: '#02161e', deep: '#010a0f' };

  // ------------------------------------------------------------------
  // Module
  // ------------------------------------------------------------------
  const _c1 = new THREE.Color();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHazeCol: { value: new THREE.Color() },
    uHaze: { value: 0.25 }, uDawn: { value: 0 }, uStars: { value: 1 }, uSunDir: { value: new THREE.Vector3(-0.98, -0.15, 0.17).normalize() },
    uGlowCol: { value: new THREE.Color(0, 0, 0) }, uRoseCol: { value: new THREE.Color(0, 0, 0) }, uBeltCol: { value: new THREE.Color(0, 0, 0) },
    uShadowCol: { value: new THREE.Color() }, uBeltH: { value: 0.1 },
    uMilky: { value: 1 }, uAurora: { value: 0.12 }, uTime: { value: 0 }, uRT: { value: 0 }, uUnder: { value: 0 },
    uUnderCol: { value: new THREE.Color() }, uW2E: { value: M_W2E.clone() }, uW2G: { value: M_W2G.clone() },
    uExtK: { value: new THREE.Vector3(0.07, 0.11, 0.2) },
    uMA: { value: new THREE.Vector3(1, 0, 0) }, uMB: { value: new THREE.Vector3(0, 1, 0) }, uMP: { value: new THREE.Vector4(0, 0, 0.3, 0) },
    uFlashPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uFlashCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uGain: { value: 1 }, uCirrus: { value: 0 }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
    uAirglow: { value: new THREE.Color() }, uResScale: { value: 1 }, uMWGain: { value: 0.038 }, uStarGain: { value: 1 }, uTwinkle: { value: 1 },
    uMWTex: { value: null },
  };

  // Shooting stars: story time, duration, side of frame (-1 left .. 1 right), travel direction
  const METEORS = [
    { t: 33.5, dur: 0.85, side: 0.42, up: 0.62, dx: -0.55, dy: -0.32, len: 0.55 },
    { t: 224.0, dur: 1.05, side: -0.5, up: 0.7, dx: 0.6, dy: -0.3, len: 0.5 },
    { t: 231.5, dur: 0.7, side: 0.18, up: 0.8, dx: 0.35, dy: -0.4, len: 0.6 },
  ];

  const sky = {
    order: 10,
    uniforms,
    horizonColor: new THREE.Color(),
    zenithColor: new THREE.Color(),
    sunDir: new THREE.Vector3(-0.98, -0.15, 0.17).normalize(),
    glsl: SKY_UNIFORMS_GLSL + SKY_GRADIENT_GLSL,     // declare + ttSkyGradient(dir) (share TT.sky.uniforms)
    glslFunctions: SKY_GRADIENT_GLSL,                // just the function (if the uniforms are declared elsewhere)
    raDecToWorld(raH, decD, target) { return raDecToWorld(raH, decD, target || new THREE.Vector3()); },
    worldToGalactic: M_W2G,
    meteors: METEORS,

    // Sky colour for a view direction's elevation (azimuth-averaged, incl. haze): what the far sea fades to.
    fogColor(dirY, target) {
      const out = target || new THREE.Color();
      const u = this.uniforms;
      const hp = Math.max(dirY || 0, 0);
      const w = Math.pow(1 - hp, 3.5);
      out.copy(u.uZenith.value).lerp(u.uHorizon.value, w);
      out.lerp(u.uHazeCol.value, U.clamp(u.uHaze.value * 0.9 * Math.exp(-hp / 0.045)));
      if (u.uDawn.value > 0) {
        // azimuth averages of the twilight terms (sunSide ≈ .27, core ≈ .1, anti ≈ .31)
        const bh = u.uBeltH.value, tw = U.clamp(u.uDawn.value * 4);
        out.lerp(u.uShadowCol.value, 0.31 * (1 - U.smoothstep(bh - 0.06, bh - 0.015, hp)) * 0.85 * tw);
        out.lerp(u.uRoseCol.value, U.clamp(Math.exp(-Math.pow((hp - 0.16) / 0.14, 2)) * 0.22 * 0.75) * tw);
        out.lerp(u.uBeltCol.value, U.clamp(0.31 * Math.exp(-Math.pow((hp - bh) / 0.055, 2)) * 0.85) * tw);
        out.lerp(u.uGlowCol.value, U.clamp(0.35 * 0.27 * Math.exp(-hp / 0.09) + 0.9 * 0.1 * Math.exp(-hp / 0.05)) * tw);
      }
      return out;
    },
    // Sky colour for a full direction (same model as the ttSkyGradient GLSL; no stars).
    colorAt(dir, target) {
      const out = target || new THREE.Color();
      const u = this.uniforms;
      const hp = Math.max(dir.y, 0);
      out.copy(u.uZenith.value).lerp(u.uHorizon.value, Math.pow(1 - hp, 3.5));
      out.lerp(u.uHazeCol.value, U.clamp(u.uHaze.value * 0.9 * Math.exp(-hp / 0.045)));
      if (u.uDawn.value > 0) {
        let lh = Math.hypot(dir.x, dir.z); const dx = lh > 1e-5 ? dir.x / lh : 1, dz = lh > 1e-5 ? dir.z / lh : 0;
        const sd = u.uSunDir.value; lh = Math.hypot(sd.x, sd.z) || 1;
        const az = Math.acos(U.clamp(dx * sd.x / lh + dz * sd.z / lh, -1, 1));
        const sunSide = Math.exp(-az * az / 0.9), core = Math.exp(-az * az / 0.12), anti = Math.exp(-(az - Math.PI) * (az - Math.PI) / 1.2);
        const bh = u.uBeltH.value, tw = U.clamp(u.uDawn.value * 4);
        out.lerp(u.uShadowCol.value, anti * (1 - U.smoothstep(bh - 0.06, bh - 0.015, hp)) * 0.85 * tw);
        out.lerp(u.uRoseCol.value, U.clamp(Math.exp(-Math.pow((hp - 0.16) / 0.14, 2)) * Math.exp(-az * az / 0.6) * 0.75) * tw);
        out.lerp(u.uBeltCol.value, U.clamp(anti * Math.exp(-Math.pow((hp - bh) / 0.055, 2)) * 0.85) * tw);
        out.lerp(u.uGlowCol.value, U.clamp(0.35 * sunSide * Math.exp(-hp / 0.09) + 0.9 * core * Math.exp(-hp / 0.05)) * tw);
      }
      return out;
    },

    async init(ctx) {
      const { scene, renderer, quality } = ctx;
      this._ctx = ctx;
      this._buildPalettes();
      this._bakeMilkyWay(renderer, quality);

      // ---- dome ----
      const domeGeo = new THREE.SphereGeometry(DOME_R, 96, 48);
      const domeMat = new THREE.ShaderMaterial({
        uniforms, vertexShader: DOME_VS, fragmentShader: DOME_FS,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false,
      });
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.name = 'sky dome';
      dome.frustumCulled = false;
      dome.renderOrder = -1000;
      dome.matrixAutoUpdate = false;
      dome.onBeforeRender = (r, sc, cam) => { this._beforeRender(r, cam); };
      scene.add(dome);
      this.dome = dome;

      // ---- stars ----
      this._buildStars(quality);
      scene.add(this.stars);

      // ---- lights ----
      const L = C.LIGHT;
      this.hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
      this.hemi.name = 'sky hemisphere';
      this.starLight = new THREE.DirectionalLight(L.starKey.color, L.starKey.intensity);
      this.starLight.name = 'starlight';
      this.starLight.position.copy(L.starKey.dir).normalize().multiplyScalar(1000);
      this.dawnLight = new THREE.DirectionalLight(0xf3c77b, 0);
      this.dawnLight.name = 'dawn light';
      this.dawnLight.visible = false;
      scene.add(this.hemi, this.starLight, this.dawnLight);
      this._hemiNightSky = new THREE.Color(L.hemi.sky); this._hemiNightGround = new THREE.Color(L.hemi.ground);
      this._keyNight = new THREE.Color(L.starKey.color);
      this._hemiDawnSky = new THREE.Color('#9a94c4'); this._hemiDawnGround = new THREE.Color('#1c2232');
      this._keyDawn = new THREE.Color('#aab4d8');
      this._uwHemiSky = new THREE.Color('#1d6f80'); this._uwHemiGround = new THREE.Color('#010608');
      this._uwKey = new THREE.Color('#3a8d9c');
      this._dawnRose = new THREE.Color('#e6a39a'); this._dawnGold = new THREE.Color('#f3c77b');

      // ---- fog / background ----
      this.fog = new THREE.FogExp2(0x0d1a2e, 0.00004);
      scene.fog = this.fog;
      this._bg = new THREE.Color(0x02040a);
      scene.background = this._bg;

      // ---- environment (PMREM of a copy of the dome) ----
      const envMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, uniforms, { uGain: { value: 0.35 }, uResScale: { value: 1 } }),
        vertexShader: DOME_VS, fragmentShader: DOME_FS, defines: { ENV_MODE: 1 },
        depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false, toneMapped: false,
      });
      this._envMat = envMat;
      const envDome = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), envMat);
      envDome.frustumCulled = false;
      this._envScene = new THREE.Scene();
      this._envScene.add(envDome);
      this._pmrem = new THREE.PMREMGenerator(renderer);
      this._envKey = null;
      this._envRT = null;
      this._sample(TT.S, ctx);
      this._regenEnv(renderer, scene, 'init');

      this._meteorCache = METEORS.map(() => null);
      this._meteorI = 0;
      this._activeMeteor = null;
      this._drawSize = new THREE.Vector2();
    },

    // Render the full-detail Milky Way once into a (galactic longitude, latitude) map.
    _bakeMilkyWay(renderer, quality) {
      // ~1 texel per screen pixel at 1080p for the director's lenses (the granular texture lives in the map);
      // mipmapped + anisotropic so wide views and the grazing band near the horizon don't sparkle
      const W = Math.min(quality === 'low' ? 2048 : quality === 'medium' ? 4096 : 8192, renderer.capabilities.maxTextureSize || 4096);
      const H = Math.round(W * (2 * MW_BMAX) / (2 * Math.PI) * 1.1);
      const rt = new THREE.WebGLRenderTarget(W, H, {
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
        anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1),
      });
      const mat = new THREE.ShaderMaterial({
        vertexShader: MW_BAKE_VS, fragmentShader: MW_BAKE_FS, depthTest: false, depthWrite: false,
        defines: { MW_GRAIN: U.clamp(W / 8192, 0.3, 1).toFixed(3) },
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      quad.frustumCulled = false;
      const sc = new THREE.Scene(); sc.add(quad);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(sc, cam);
      renderer.setRenderTarget(prev);
      mat.dispose(); quad.geometry.dispose();
      this._mwRT = rt;
      uniforms.uMWTex.value = rt.texture;
    },

    _buildPalettes() {
      this._keys = DAWN_KEYS.map((k) => {
        const o = { d: k.d, beltH: k.beltH, cirrus: k.cirrus };
        o.zenith = sceneFromDisplay(k.zenith); o.horizon = sceneFromDisplay(k.horizon); o.haze = sceneFromDisplay(k.haze);
        o.shadow = sceneFromDisplay(k.shadow);
        o.glow = sceneFromDisplay(k.glow); o.rose = sceneFromDisplay(k.rose); o.belt = sceneFromDisplay(k.belt);
        o.cloudLit = sceneFromDisplay(k.cloudLit); o.cloudDark = sceneFromDisplay(k.cloudDark);
        return o;
      });
      this._uwShallow = sceneFromDisplay(UNDER.shallow);
      this._uwDeep = sceneFromDisplay(UNDER.deep);
      this._airglow = sceneFromDisplay('#0f1d22').sub(sceneFromDisplay('#0d1a2e')).multiplyScalar(1);
      this._airglow.setRGB(Math.max(0.004, this._airglow.r), Math.max(0.006, this._airglow.g), Math.max(0.001, this._airglow.b));
    },

    _buildStars(quality) {
      const nFill = quality === 'low' ? 4000 : quality === 'medium' ? 6500 : 8800;   // above the horizon
      const rnd = U.rng('titanic-stars-1912');
      const pos = [], col = [], info = [];
      const c = new THREE.Color(), v = new THREE.Vector3();
      const flux = (m) => 6.0 * Math.pow(10, -0.34 * m);
      const push = (dir, mag, bv, seed) => {
        v.copy(dir).normalize().multiplyScalar(STAR_R);
        pos.push(v.x, v.y, v.z);
        bvToRGB(bv, c);
        c.lerp(_c1.setRGB(1, 1, 1), 0.3);
        col.push(c.r, c.g, c.b);
        const halo = U.clamp((1.6 - mag) / 2.2);
        info.push(flux(mag), seed, halo);
      };
      for (const s of BRIGHT) push(raDecToWorld(s[0], s[1], _v), s[2], s[3], rnd());
      for (const s of PLANETS) push(raDecToWorld(s[0], s[1], _v), s[2], s[3], -1);   // seed < 0: steady
      // procedural fill: magnitudes 3.4 .. 7.2 with the real count law (x3.1 per magnitude),
      // concentrated toward the galactic plane for the fainter ones
      const m0 = 3.4, m1 = 7.2, k = 0.49;
      const uMin = Math.pow(10, k * (m0 - m1));
      let made = 0, guard = 0;
      while (made < nFill && guard++ < nFill * 40) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
        v.set(rr * Math.cos(a), rr * Math.sin(a), z);          // galactic frame
        const mag = m1 + Math.log10(uMin + (1 - uMin) * rnd()) / k;
        const b = Math.asin(z);
        const faint = U.smoothstep(4.5, 6.5, mag);
        const p = (1 + faint * 2.2 * Math.exp(-(b * b) / (2 * 0.2 * 0.2))) / (1 + faint * 2.2);
        if (rnd() > p) continue;
        v.applyMatrix3(M_G2W);
        if (v.y < -0.02) continue;                              // below the horizon: never visible (the sky is fixed)
        const bvR = rnd();
        const bv = bvR < 0.25 ? -0.2 + rnd() * 0.3 : bvR < 0.7 ? 0.1 + rnd() * 0.6 : 0.7 + rnd() * 0.9;
        push(v, mag, bv, rnd());
        made++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), STAR_R * 1.01);
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: STAR_VS, fragmentShader: STAR_FS,
        depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, transparent: false, fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.name = 'sky stars';
      pts.frustumCulled = false;
      pts.renderOrder = -999;
      pts.matrixAutoUpdate = false;
      pts.onBeforeRender = (r, sc, cam) => { this._beforeRender(r, cam); };
      this.stars = pts;
      this.starCount = pos.length / 3;
    },

    // Per-render: resolution scale (main frame vs the ocean's half-res mirror) and meteor placement.
    _beforeRender(renderer, cam) {
      const rt = renderer.getRenderTarget();
      renderer.getDrawingBufferSize(this._drawSize);
      const h = rt ? rt.height : this._drawSize.y;
      uniforms.uResScale.value = U.clamp(h / Math.max(1, this._drawSize.y), 0.25, 2);
      const ctx = this._ctx;
      // the meteor is placed from the main (film) camera, which is final only at render time
      if (ctx && this._activeMeteor != null && (cam === ctx.camera || (cam.isPerspectiveCamera && cam.layers.isEnabled(TT.LAYERS.NO_REFLECT)))) {
        this._placeMeteor(this._activeMeteor, cam);
        uniforms.uMP.value.y = this._meteorI;
      }
    },

    _placeMeteor(i, cam) {
      const m = METEORS[i];
      let pl = this._meteorCache[i];
      if (!pl) {
        // pick a patch of sky in the upper part of the current frame, above the horizon
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements;
        const right = _v.set(e[0], e[1], e[2]).normalize();
        const up = _v2.set(e[4], e[5], e[6]).normalize();
        const fwd = _v3.set(-e[8], -e[9], -e[10]).normalize();
        const th = Math.tan(((cam.fov || 38) * DEG) / 2), tw = th * (cam.aspect || 1.78);
        const A = new THREE.Vector3().copy(fwd).addScaledVector(up, m.up * th).addScaledVector(right, m.side * tw).normalize();
        if (A.y < 0.12) { A.y = 0.12 + 0.3 * Math.max(0, m.up - 0.5); A.normalize(); }
        const span = 0.55 * th;
        const B = new THREE.Vector3().copy(A).addScaledVector(right, m.dx * span).addScaledVector(up, m.dy * span).normalize();
        if (B.y < 0.05) { B.y = 0.05; B.normalize(); }
        pl = this._meteorCache[i] = { A, B };
      }
      uniforms.uMA.value.copy(pl.A); uniforms.uMB.value.copy(pl.B);
    },

    // Sample all sky state from S (pure function of story time).
    _sample(S, ctx) {
      const E = S.env, u = uniforms;
      const dawn = E.dawn;
      // twilight palette
      const keys = this._keys;
      let i = 0;
      while (i < keys.length - 2 && dawn > keys[i + 1].d) i++;
      const k0 = keys[i], k1 = keys[i + 1];
      const f = U.clamp((dawn - k0.d) / (k1.d - k0.d));
      const lc = (name, out) => out.copy(k0[name]).lerp(k1[name], f);
      lc('zenith', u.uZenith.value); lc('horizon', u.uHorizon.value); lc('haze', u.uHazeCol.value);
      lc('glow', u.uGlowCol.value); lc('rose', u.uRoseCol.value); lc('belt', u.uBeltCol.value); lc('shadow', u.uShadowCol.value);
      lc('cloudLit', u.uCloudLit.value); lc('cloudDark', u.uCloudDark.value);
      u.uBeltH.value = U.lerp(k0.beltH, k1.beltH, f);
      u.uCirrus.value = U.lerp(k0.cirrus, k1.cirrus, f);
      u.uDawn.value = dawn;
      u.uHaze.value = E.haze;
      u.uStars.value = E.stars;
      u.uMilky.value = E.milkyWay;
      // the story's baseline (0.12) should be barely there; the silence level (0.55) is the reference
      u.uAurora.value = E.aurora > 0 ? 0.55 * Math.pow(E.aurora / 0.55, 1.35) : 0;
      u.uTime.value = S.t;
      u.uRT.value = ctx ? ctx.realTime : 0;
      u.uAirglow.value.copy(this._airglow);
      const hz = E.haze;
      u.uExtK.value.set(0.07, 0.11, 0.2).multiplyScalar(0.55 + 1.8 * hz);
      // sun: elevation -12° .. -1° across the dawn, rising a little north of east
      const el = U.lerp(-12, -1, U.clamp(dawn)) * DEG, az = 80 * DEG;
      this.sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      u.uSunDir.value.copy(this.sunDir);
      // public colours
      this.zenithColor.copy(u.uZenith.value);
      this.fogColor(0.0, this.horizonColor);
      u.uUnder.value = E.underwater ? 1 : 0;
    },

    _regenEnv(renderer, scene, key) {
      try {
        const u = this._envMat.uniforms;
        const E = TT.S.env;
        u.uGain.value = E.underwater ? 1 : U.lerp(0.35, 1.0, U.smoothstep(0.2, 0.9, E.dawn));
        const rt = this._pmrem.fromScene(this._envScene, 0, 0.1, 100);
        if (this._envRT) this._envRT.dispose();
        this._envRT = rt;
        scene.environment = rt.texture;
        this._envKey = key;
      } catch (e) { TT.error('sky env', e); }
    },

    update(t, dt, ctx) {
      const S = ctx.S, E = S.env, u = uniforms;
      this._sample(S, ctx);
      const under = E.underwater > 0.5;
      this.dome.visible = !under;
      this.stars.visible = !under && E.stars > 0.001;

      // ---- shooting stars ----
      if (S.seek) this._meteorCache.fill(null);
      this._activeMeteor = null;
      u.uMP.value.set(0, 0, 0.3, 0);
      if (!under) {
        for (let i = 0; i < METEORS.length; i++) {
          const m = METEORS[i];
          const p = (t - m.t) / m.dur;
          if (p < 0 || p > 1.35) { if (p < 0 || p > 3) this._meteorCache[i] = null; continue; }
          this._activeMeteor = i;
          const head = U.clamp(p, 0, 1);
          const inten = U.smoothstep(0, 0.12, p) * (1 - U.smoothstep(0.8, 1.35, p)) * (0.8 + 0.4 * Math.sin(p * 40) * Math.sin(p * 17));
          this._meteorI = inten * E.stars;
          const pl = this._meteorCache[i];   // until placed by a main-camera render, keep it dark (e.g. in the mirror)
          u.uMP.value.set(head, pl ? this._meteorI : 0, m.len, 0);
          if (pl) { u.uMA.value.copy(pl.A); u.uMB.value.copy(pl.B); }
          break;
        }
      }

      // ---- rocket glow in the haze ----
      for (let i = 0; i < 4; i++) {
        const F = TT.flashes && TT.flashes[i];
        const pc = u.uFlashCol.value[i];
        if (F && F.intensity > 0 && !under) {
          u.uFlashPos.value[i].copy(F.pos);
          const k = 0.005 * Math.min(F.intensity, 60) * U.clamp((F.range || 600) / 700, 0.05, 1);   // local sparks barely reach the sky
          pc.set(F.color.r * k, F.color.g * k, F.color.b * k);
        } else pc.set(0, 0, 0);
      }

      // ---- lights ----
      const L = C.LIGHT, dawn = E.dawn;
      const dw = U.smoothstep(0.25, 1.0, dawn);
      if (!under) {
        this.hemi.color.copy(this._hemiNightSky).lerp(this._hemiDawnSky, dw);
        this.hemi.groundColor.copy(this._hemiNightGround).lerp(this._hemiDawnGround, dw);
        this.hemi.intensity = U.lerp(L.hemi.intensity, 1.05, dw);
        this.starLight.color.copy(this._keyNight).lerp(this._keyDawn, dw);
        this.starLight.intensity = U.lerp(L.starKey.intensity, 0.3, dw);
        this.starLight.position.copy(L.starKey.dir).normalize().multiplyScalar(1000);
        // dawn key: the bright eastern sky, low, rose turning gold
        const del = Math.max(this.sunDir.y, -0.2) + 0.13;
        _v.set(this.sunDir.x, Math.max(0.07, del), this.sunDir.z).normalize();
        this.dawnLight.position.copy(_v).multiplyScalar(1000);
        this.dawnLight.color.copy(this._dawnRose).lerp(this._dawnGold, U.smoothstep(0.4, 1.0, dawn));
        this.dawnLight.intensity = 2.0 * dw;
        this.dawnLight.visible = dw > 0.001;
      } else {
        const abyss = TT.story && t >= TT.story.EV.abyss;
        this.hemi.color.copy(this._uwHemiSky);
        this.hemi.groundColor.copy(this._uwHemiGround);
        this.hemi.intensity = abyss ? 0.06 : 0.25;
        this.starLight.color.copy(this._uwKey);
        this.starLight.intensity = abyss ? 0.02 : 0.14;
        this.starLight.position.set(0.1, 1, 0.2).multiplyScalar(1000);
        this.dawnLight.intensity = 0; this.dawnLight.visible = false;
      }

      // ---- fog + background ----
      if (!under) {
        this.fog.color.copy(this.horizonColor);
        this.fog.density = 0.00002 + 0.00006 * E.haze + 0.00003 * dawn;
        this._bg.copy(this.horizonColor);
      } else {
        const depth = E.depth || 0;
        const abyss = depth > 800;
        if (abyss) {
          this.fog.color.copy(this._uwDeep).multiplyScalar(U.lerp(1.0, 0.75, U.smoothstep(1500, 3790, depth)));
          this.fog.density = 0.0105;
        } else {
          this.fog.color.copy(this._uwShallow).lerp(this._uwDeep, U.smoothstep(12, 200, depth));
          this.fog.density = U.lerp(0.012, 0.0115, U.smoothstep(12, 160, depth));
        }
        this._bg.copy(this.fog.color);
        u.uUnderCol.value.copy(this.fog.color);
      }

      // ---- environment map: regenerate only when the sky has changed enough ----
      let key;
      if (under) key = 'u' + (E.depth > 800 ? 1 : 0);
      else if (dawn <= 0.001) key = 'n';
      else key = 'd' + Math.min(5, Math.floor(U.clamp((dawn - 0.3) / 0.7, 0, 0.999) * 5 + 1));
      if (key !== this._envKey) this._regenEnv(ctx.renderer, ctx.scene, key);
    },
  };

  TT.register('sky', sky);
})();
