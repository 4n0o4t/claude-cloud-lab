import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/40_ship.js ====
// =====================================================================
// 40_ship.js — RMS Titanic herself. Owner: ship agent.
//
// Everything is procedural, modelled in ship-local metres (TT.CONST.SHIP, TT.hull):
// +X bow, +Y up, +Z starboard, waterline y = 0. Static geometry is merged per material
// into two rigid sections — bow (x >= BREAK_X) and stern (x < BREAK_X) — posed every frame
// from S.ship.bow / S.ship.stern. A shared shader patch gives every ship material the torn
// break edges (jagged discard revealed with S.ship.broken), dark interiors, the hull paint
// (black / gold line / antifouling red), the wreck look (rust, silt), the window lights
// (warm amber HDR, exposed down in close-ups, green-blue under water, dying with depth) and the
// night look (cool starlight rim, dark fill, the stern streaming wet, the abyss's edge glimmer).
//
// API: TT.ship.group, sections {bow, stern}, anchor(name, target), localToWorld(local, target),
//      boatSlotWorld(i, target), sectionMatrix('bow'|'stern').
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = C.SHIP, DEG = U.DEG;
  const clamp = U.clamp, lerp = U.lerp, sstep = U.smoothstep;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const BX = SH.BREAK_X;
  const HB = (x, y) => TT.hull.halfBeam(x, y);
  const SHEER = (x) => TT.hull.sheer(x);
  const ENDS = (y) => TT.hull.ends(y);
  const TAN_RAKE = Math.tan(SH.FUNNEL_RAKE);
  const BOAT_Y = SH.BOAT_DECK_Y, TOP_Y = SH.DECKHOUSE_TOP_Y, HULL_TOP = SH.HULL_TOP_Y, WELL_Y = SH.WELL_DECK_Y;
  const F_H = SH.FUNNEL_TOP_Y - SH.FUNNEL_BASE_Y;           // funnel height above its casing
  const F_BASE_DX = 0.5 * F_H * TAN_RAKE;                   // FUNNEL_X is the mid-height centre
  const FM_BASE = V3(SH.FOREMAST_X, WELL_Y, 0), MM_BASE = V3(SH.MAINMAST_X - 0.5, WELL_Y, 0);
  const FM_TOP = V3(FM_BASE.x - (SH.FOREMAST_TOP_Y - FM_BASE.y) * TAN_RAKE, SH.FOREMAST_TOP_Y, 0);
  const MM_TOP = V3(MM_BASE.x - (SH.MAINMAST_TOP_Y - MM_BASE.y) * TAN_RAKE, SH.MAINMAST_TOP_Y, 0);
  const RUDDER_POST_X = -126.2;       // hull ends at the rudder post below the counter
  const PROP_POST_X = -119.8;         // aperture for the centre screw (-9.4 < y < -3.2)
  const WIN_HDR = 2.6;                // lit windows are authored at ~1..2 luminance and scaled into HDR
  let Q = 'high';
  const q3 =(lo, mid, hi) => (Q === 'low' ? lo : Q === 'medium' ? mid : hi);

  // aft end of the hull at height y, with the rudder post and the centre-screw aperture
  function aftEnd(y) {
    const e = ENDS(y).aft;
    if (y > 0.2) return e;
    let a = y > -3.6 ? Math.max(e, lerp(RUDDER_POST_X, e, sstep(-0.1, 0.2, y))) : e;
    const ap = sstep(-9.9, -9.3, y) * (1 - sstep(-3.5, -2.9, y));
    return lerp(a, PROP_POST_X, ap);
  }

  // ------------------------------------------------------------------
  // Geometry batches: triangles accumulated per section (0 = bow, 1 = stern), split by
  // triangle centroid x at BREAK_X (primitives that span the break are cut at BX first).
  // Attributes: position, normal, uv (+ extras {name: itemSize}). UVs are either kept from
  // the source geometry or projected from ship-local coordinates (box mapping, 1/uvScale m).
  // ------------------------------------------------------------------
  const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vn = new THREE.Vector3();
  const _nm = new THREE.Matrix3();
  class Batch {
    constructor(extras, uvScale) {
      this.extras = extras || {};
      this.uvScale = uvScale || 1 / 6;
      this.d = [0, 1].map(() => { const o = { p: [], n: [], uv: [] }; for (const k in this.extras) o[k] = []; return o; });
    }
    // opts: { m: Matrix4, sec: 0|1 (force section), keepUV: bool, ex: {name: number|array|fn(x,y,z)} }
    add(geo, opts) {
      opts = opts || {};
      const m = opts.m || null;
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const uva = opts.keepUV ? geo.attributes.uv : null;
      const idx = geo.index, n = idx ? idx.count : pos.count;
      if (m) _nm.getNormalMatrix(m);
      const flip = !!m && m.determinant() < 0;
      const vp = new Array(9), vn = new Array(9), vt = new Array(6);
      const ord = flip ? [0, 2, 1] : [0, 1, 2];
      const sc = this.uvScale, ex = opts.ex, X = this.extras;
      for (let t = 0; t + 2 < n; t += 3) {
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(t + k) : t + k;
          _va.fromBufferAttribute(pos, i); if (m) _va.applyMatrix4(m);
          _vn.fromBufferAttribute(nor, i); if (m) _vn.applyMatrix3(_nm).normalize();
          vp[k * 3] = _va.x; vp[k * 3 + 1] = _va.y; vp[k * 3 + 2] = _va.z;
          vn[k * 3] = _vn.x; vn[k * 3 + 1] = _vn.y; vn[k * 3 + 2] = _vn.z;
          if (uva) { vt[k * 2] = uva.getX(i); vt[k * 2 + 1] = uva.getY(i); }
        }
        _va.set(vp[3] - vp[0], vp[4] - vp[1], vp[5] - vp[2]);
        _vb.set(vp[6] - vp[0], vp[7] - vp[1], vp[8] - vp[2]);
        _vc.crossVectors(_va, _vb);
        const a2 = _vc.length();
        if (!(a2 > 1e-8)) continue;             // degenerate (collapsed hull ends etc.)
        const cx = (vp[0] + vp[3] + vp[6]) / 3;
        const D = this.d[opts.sec != null ? opts.sec : cx >= BX ? 0 : 1];
        let ax = 1;
        if (!uva) { const x = Math.abs(_vc.x), y = Math.abs(_vc.y), z = Math.abs(_vc.z); ax = y >= x && y >= z ? 1 : x >= z ? 0 : 2; }
        for (const k of ord) {
          const x = vp[k * 3], y = vp[k * 3 + 1], z = vp[k * 3 + 2];
          D.p.push(x, y, z); D.n.push(vn[k * 3], vn[k * 3 + 1], vn[k * 3 + 2]);
          if (uva) D.uv.push(vt[k * 2], vt[k * 2 + 1]);
          else if (ax === 1) D.uv.push(x * sc, z * sc);
          else if (ax === 0) D.uv.push(z * sc, y * sc);
          else D.uv.push(x * sc, y * sc);
          for (const key in X) {
            const sz = X[key];
            let v = ex ? ex[key] : 0;
            if (typeof v === 'function') v = v(x, y, z);
            if (sz === 1) D[key].push(v == null ? 0 : Array.isArray(v) ? v[0] : +v);
            else for (let c = 0; c < sz; c++) D[key].push(v && v.length ? v[c] : +(v || 0));
          }
        }
      }
      return this;
    }
    // fast path: one quad p0..p3 (CCW seen from the front), flat normal n, uv rect [u0, v0, u1, v1], extras ex
    pushQuad(P, n, r, ex, sec) {
      const cx = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4;
      const D = this.d[sec != null ? sec : cx >= BX ? 0 : 1];
      const uv = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        D.p.push(P[k][0], P[k][1], P[k][2]); D.n.push(n[0], n[1], n[2]); D.uv.push(uv[k][0], uv[k][1]);
        for (const key in this.extras) { const v = ex[key], sz = this.extras[key]; if (sz === 1) D[key].push(+v); else for (let c = 0; c < sz; c++) D[key].push(v[c]); }
      }
    }
    geometry(s) {
      const D = this.d[s];
      if (!D.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(D.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(D.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(D.uv, 2));
      for (const k in this.extras) g.setAttribute(k, new THREE.Float32BufferAttribute(D[k], this.extras[k]));
      g.computeBoundingSphere();
      return g;
    }
  }

  // ------------------------------------------------------------------
  // Primitive helpers (ship-local)
  // ------------------------------------------------------------------
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
  function MX(px, py, pz, rx, ry, rz, sx, sy, sz, order) {
    return new THREE.Matrix4().compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0, order || 'XYZ')),
      _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }
  const GEO = {};
  function unitGeos() {
    GEO.box = new THREE.BoxGeometry(1, 1, 1);
    GEO.cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    GEO.cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    GEO.cyl12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    GEO.cyl20 = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
    GEO.sph = new THREE.SphereGeometry(1, 10, 7);
  }
  const withM = (opts, m) => Object.assign({}, opts || {}, { m });
  // axis-aligned box; spans across the break are cut in two so each half lands in its section
  function box(b, x0, x1, y0, y1, z0, z1, opts) {
    if (x0 < BX - 1e-4 && x1 > BX + 1e-4) { box(b, x0, BX, y0, y1, z0, z1, opts); box(b, BX, x1, y0, y1, z0, z1, opts); return; }
    b.add(GEO.box, withM(opts, MX((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, x1 - x0, y1 - y0, z1 - z0)));
  }
  // basis with local X along a->c, local Y as close to world up as possible
  function basisAlong(ax, ay, az, cx, cy, cz, out) {
    _bx.set(cx - ax, cy - ay, cz - az);
    const L = _bx.length(); _bx.divideScalar(L || 1);
    _by.set(0, 1, 0);
    if (Math.abs(_bx.y) > 0.97) _by.set(1, 0, 0);
    _bz.crossVectors(_bx, _by).normalize(); _by.crossVectors(_bz, _bx).normalize();
    out.makeBasis(_bx, _by, _bz);
    return L;
  }
  // rectangular beam from a to c, section w (horizontal) x h (vertical)
  function beam(b, ax, ay, az, cx, cy, cz, w, h, opts) {
    const m = new THREE.Matrix4();
    const L = basisAlong(ax, ay, az, cx, cy, cz, m);
    m.multiply(new THREE.Matrix4().makeScale(L, h, w));
    m.setPosition((ax + cx) / 2, (ay + cy) / 2, (az + cz) / 2);
    b.add(GEO.box, withM(opts, m));
  }
  // round rod from a to c, radius r (seg sides)
  function rod(b, ax, ay, az, cx, cy, cz, r, seg, opts) {
    const m = new THREE.Matrix4();
    const L = basisAlong(ax, ay, az, cx, cy, cz, m);
    // cylinder axis is Y: rotate so Y maps onto the beam direction (X of the basis)
    m.multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(r, L, r));
    m.setPosition((ax + cx) / 2, (ay + cy) / 2, (az + cz) / 2);
    b.add(seg <= 6 ? GEO.cyl6 : seg <= 8 ? GEO.cyl8 : seg <= 12 ? GEO.cyl12 : GEO.cyl20, withM(opts, m));
  }
  // vertical cylinder / tapered cone
  function vcyl(b, x, y0, z, r, h, seg, opts, rTop) {
    if (rTop != null && rTop !== r) {
      const g = new THREE.CylinderGeometry(rTop, r, h, seg || 12, 1);
      b.add(g, withM(opts, MX(x, y0 + h / 2, z)));
    } else b.add(seg <= 6 ? GEO.cyl6 : seg <= 8 ? GEO.cyl8 : seg <= 12 ? GEO.cyl12 : GEO.cyl20, withM(opts, MX(x, y0 + h / 2, z, 0, 0, 0, r, h, r)));
  }
  // a quad given 4 corners (counter-clockwise seen from the front)
  function quad(b, p0, p1, p2, p3, opts, uvs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute([uvs[0], uvs[1], uvs[2], uvs[1], uvs[2], uvs[3], uvs[0], uvs[1], uvs[2], uvs[3], uvs[0], uvs[3]], 2));
    g.computeVertexNormals();
    b.add(g, Object.assign({}, opts || {}, uvs ? { keepUV: true } : {}));
  }
  // grid surface from a function f(u, v) -> [x, y, z], nu x nv cells; returns geometry
  function gridGeo(nu, nv, f, uvf) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv); pos.push(p[0], p[1], p[2]);
      if (uvf) { const t = uvf(i / nu, j / nv, p); uv.push(t[0], t[1]); } else uv.push(i / nu, j / nv);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b2 = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b2, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // x stations from a to b, always including the break line
  function stations(a, b, step) {
    const xs = [];
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let i = 0; i <= n; i++) xs.push(a + (b - a) * i / n);
    if (a < BX && b > BX) { xs.push(BX); xs.sort((p, q) => p - q); }
    return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-3);
  }

  // Rigging: line segments [ax, ay, az, bx, by, bz, id] (id: 0 static, 1-4 funnel guys, 5 aerial)
  let RIG = [];
  function rig(a, c, id) {
    id = id || 0;
    if ((a[0] - BX) * (c[0] - BX) < 0) {
      const u = (BX - a[0]) / (c[0] - a[0]);
      const m = [BX, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
      RIG.push([...a, ...m, id], [...m, ...c, id]);
    } else RIG.push([...a, ...c, id]);
  }

  // ------------------------------------------------------------------
  // Shared uniforms & the ship shader patch
  // ------------------------------------------------------------------
  // uRimCol: cool grazing rim (starlight behind the silhouette, the abyss's last glimmer), uFill: a
  // faint albedo-weighted fill so painted colour (antifouling red, bronze) reads in the dark, uWet: the
  // stern streaming with water after she rises, uRimTint: how much the rim takes the surface's hue,
  // uWinHDR: window gain (x far, y close-up) — HDR at a distance so bloom and the sea's reflection
  // streak them, softer when a porthole fills many pixels so its glass and rim still read.
  const SU = {
    uBroken: { value: 0 }, uWreck: { value: 0 }, uTime: { value: 0 }, uLights: { value: 1 },
    uFall: { value: new THREE.Vector4() },
    uWet: { value: 0 }, uRimCol: { value: new THREE.Vector3() }, uFill: { value: new THREE.Vector3() }, uRimTint: { value: 0 },
    uWinHDR: { value: new THREE.Vector2(1.0, 0.22) }, uEdge: { value: new THREE.Vector2() },
  };
  const GLSL_VERT_HEAD = /* glsl */`
varying vec3 vShip; varying vec3 vShipN; varying vec3 vWP;
#ifdef TT_HULL
attribute float aSheer; varying float vSheer;
#endif
#ifdef TT_WIN
attribute vec3 aEmis; attribute float aSeed; varying vec3 vEmis; varying float vSeed;
#endif
`;
  const GLSL_VERT_BODY = /* glsl */`
{
  vec4 ttP = vec4(transformed, 1.0);
  vec3 ttN = objectNormal;
#ifdef USE_INSTANCING
  ttP = instanceMatrix * ttP; ttN = mat3(instanceMatrix) * ttN;
#endif
  vShip = ttP.xyz; vShipN = ttN; vWP = (modelMatrix * ttP).xyz;
#ifdef TT_HULL
  vSheer = aSheer;
#endif
#ifdef TT_WIN
  vEmis = aEmis; vSeed = aSeed;
#endif
}
`;
  const GLSL_FRAG_HEAD = /* glsl */`
uniform float uBroken; uniform float uSide; uniform float uWreck; uniform float uTime; uniform float uLights;
uniform float uWet; uniform vec3 uRimCol; uniform vec3 uFill; uniform float uRimTint; uniform vec2 uWinHDR; uniform vec2 uEdge;
varying vec3 vShip; varying vec3 vShipN; varying vec3 vWP;
#ifdef TT_HULL
varying float vSheer;
#endif
#ifdef TT_WIN
varying vec3 vEmis; varying float vSeed;
#endif
` + TT.glsl.noise + /* glsl */`
// ragged tear depth (m) at a point of the break face; the top tore open first
float ttJag(vec3 p, float side) {
  float h = clamp((p.y + 10.5) / 34.0, 0.0, 1.0);
  float amp = mix(0.8, 8.5, pow(h, 1.6));
  vec3 q = vec3(p.y, p.z, side * 13.7);
  float big = vnoise(vec3(p.z * 0.16, p.y * 0.11, side * 5.3));
  float n1 = vnoise(q * 0.45);
  float n2 = vnoise(q * 1.9 + 3.1);
  float saw = abs(fract(p.y * 0.23 + p.z * 0.17 + n1 * 1.7) - 0.5) * 2.0;
  return 0.1 + amp * (0.4 * big + 0.28 * n1 + 0.2 * saw + 0.12 * n2) * 1.15;
}
`;
  const GLSL_FRAG_DISCARD = /* glsl */`
  float ttTorn = 0.0, ttGold = 0.0;
#ifdef TT_BREAK
  if (uBroken > 0.0005) {
    float ttd = (vShip.x - (${BX.toFixed(3)})) * uSide;
    if (ttd < 10.0) {
      float ttj = ttJag(vShip, uSide) * uBroken;
      if (ttd < ttj) discard;
      ttTorn = 1.0 - smoothstep(0.0, 0.45, ttd - ttj);
    }
  }
#endif
`;
  const GLSL_FRAG_COLOR = /* glsl */`
#ifdef TT_HULL
  {
    float y = vShip.y;
    float aa = max(fwidth(y), 0.003);
    vec3 paint = mix(vec3(0.11, 0.013, 0.010), vec3(0.0036, 0.0040, 0.0047), smoothstep(-aa, aa, y - 0.15));
    ttGold = smoothstep(-aa, aa, y - (vSheer - 0.66)) * (1.0 - smoothstep(-aa, aa, y - (vSheer - 0.52)));
    paint = mix(paint, vec3(0.62, 0.42, 0.13), ttGold);
    diffuseColor.rgb *= paint;
  }
#endif
#ifdef TT_BACKDARK
  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.018, 0.016, 0.014);
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.03, 0.026), ttTorn);
#ifdef TT_WRECK
  if (uWreck > 0.001) {
    vec3 wp = vShip;
    float wn = vnoise(wp * 0.7) * 0.55 + vnoise(wp * 2.9) * 0.3 + vnoise(wp * 11.0) * 0.15;
    float streak = vnoise(vec3(wp.x * 1.8, wp.y * 0.12, wp.z * 1.8));
    vec3 rust = mix(vec3(0.03, 0.014, 0.008), vec3(0.15, 0.056, 0.022), smoothstep(0.25, 0.85, wn));
    rust = mix(rust, vec3(0.3, 0.11, 0.035), smoothstep(0.66, 0.9, streak) * 0.5);
    float up = smoothstep(0.45, 0.85, normalize(vShipN).y);
    vec3 silt = vec3(0.19, 0.18, 0.16) * (0.7 + 0.5 * wn);
    vec3 base = mix(diffuseColor.rgb * 0.5, rust, 0.55 + 0.45 * smoothstep(0.2, 0.6, wn));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(base, silt, up * 0.85), uWreck);
  }
#endif
`;
  const GLSL_FRAG_ROUGH = /* glsl */`
#ifdef TT_HULL
  roughnessFactor = mix(roughnessFactor, 0.32, ttGold);
#endif
  roughnessFactor = mix(roughnessFactor, 0.8, ttTorn);
#ifdef TT_WRECK
  roughnessFactor = mix(roughnessFactor, 0.96, uWreck);
#endif
  // streaming wet: rivulets running down (world space) over everything the sea has just let go of
  float ttRiv = 0.0, ttR0 = roughnessFactor;
  if (uWet > 0.001 && vWP.y > -0.3) {
    float r1 = vnoise(vec3(vWP.x * 1.3, vWP.y * 0.09 + uTime * 0.8, vWP.z * 1.3));
    float r2 = vnoise(vec3(vWP.x * 5.3 + 7.1, vWP.y * 0.3 + uTime * 2.4, vWP.z * 5.3 + 2.3));
    ttRiv = smoothstep(0.52, 0.86, r1 * 0.62 + r2 * 0.38) * uWet;
    roughnessFactor = mix(roughnessFactor, mix(0.2, 0.05, ttRiv), uWet * 0.9);
  }
`;
  const GLSL_FRAG_METAL = /* glsl */`
#ifdef TT_HULL
  metalnessFactor = mix(metalnessFactor, 0.35, ttGold);
#endif
#ifdef TT_WRECK
  metalnessFactor *= 1.0 - uWreck;
#endif
`;
  const GLSL_FRAG_EMIS = /* glsl */`
#ifdef TT_WIN
  {
    vec3 e = vEmis;
    float lv = uLights * smoothstep(vSeed * 0.3, vSeed * 0.3 + 0.12, uLights);
    // pixels across the window (its atlas cell): one resolved over many pixels is exposed down so its
    // glass, curtains and rim still read; a few-pixel window keeps the full HDR (bloom, sea streaks)
    // (its longer extent on screen: the smaller singular value of the uv Jacobian, so a window seen
    // edge-on but tall still counts as close)
    vec2 ttJx = dFdx(vEmissiveMapUv), ttJy = dFdy(vEmissiveMapUv);
    float ttA = dot(ttJx, ttJx), ttB = dot(ttJy, ttJy), ttC = dot(ttJx, ttJy);
    float ttDuv = sqrt(max(0.5 * (ttA + ttB) - sqrt(0.25 * (ttA - ttB) * (ttA - ttB) + ttC * ttC), 0.0));
    float ttPx = ttDuv > 1e-7 ? 0.25 / ttDuv : 0.0;       // lamps (constant uv) stay at full strength
    if (vWP.y >= 0.0) e *= mix(uWinHDR.x, uWinHDR.y, smoothstep(6.0, 44.0, ttPx));
    else {                      // under water: an eerie green-blue that dies with depth
      float dep = -vWP.y;
      float life = 1.0 - smoothstep(1.0 + vSeed * 8.0, 3.0 + vSeed * 16.0, dep);
      float fl = 0.8 + 0.2 * sin(uTime * (5.0 + 9.0 * vSeed) + vSeed * 50.0);
      float lum = dot(e, vec3(0.3, 0.55, 0.15)) * ${(1 / WIN_HDR).toFixed(4)};
      e = vec3(0.09, 0.9, 0.62) * lum * 0.6 * life * fl * exp(-dep / 12.0);
    }
    totalEmissiveRadiance *= e * lv * (1.0 - ttTorn);
    if (!gl_FrontFacing) totalEmissiveRadiance = vec3(0.0);
  }
#endif
  // cool grazing rim (brightest on upward-facing edges; the normal map's rivets and plate laps catch it),
  // stronger along running water, and a faint albedo fill so paint colours survive the dark
  if (uRimCol.b + uFill.b > 0.0) {
    vec3 ttV = normalize(vViewPosition);
    float ttNV = clamp(dot(normal, ttV), 0.0, 1.0);
    vec3 ttNW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float ttUp = 0.3 + 0.7 * smoothstep(-0.35, 0.85, ttNW.y);
    vec3 ttAlb = max(diffuseColor.rgb, vec3(0.0));
    float ttMx = max(max(ttAlb.r, ttAlb.g), max(ttAlb.b, 0.004));
    vec3 ttTint = mix(vec3(1.0), ttAlb / ttMx, uRimTint);
    float ttFr = pow(1.0 - ttNV, 3.0);
    // fill: patchy (weathering, plate to plate), a touch brighter on the smoother plates and wet runs
    float ttPatch = 0.7 + 0.6 * vnoise(vShip * vec3(0.07, 0.3, 0.3) + 11.0) - 0.25 * smoothstep(0.3, 0.55, ttR0);
    // light from far above on the upper edges: up-facing surfaces, and the hull's sheer strake / gunwale
    float ttEdge = uEdge.y * smoothstep(0.1, 0.9, ttNW.y);
#ifdef TT_HULL
    ttEdge += uEdge.x * (0.2 * smoothstep(vSheer - 9.0, vSheer, vShip.y) + smoothstep(vSheer - 1.0, vSheer - 0.2, vShip.y));
#endif
    ttEdge *= 0.25 + 0.75 * smoothstep(15.0, 70.0, length(vViewPosition));   // a cheat for the far silhouette
    vec3 ttAdd = uRimCol * ttTint * (ttFr * ttUp * (1.0 + 3.0 * ttRiv) + 0.22 * ttRiv * ttRiv + ttEdge)
               + uFill * (ttAlb / (ttAlb + 0.25)) * (0.5 + 0.5 * ttUp) * ttPatch * (1.0 + 0.6 * ttRiv);
#ifdef TT_WIN
    // glass (dark or lit) mirrors the sky: dead portholes read as faint cool dots on the black hull
    ttAdd += uRimCol * 1.5 * (1.0 - smoothstep(0.08, 0.2, ttR0)) * (0.35 + 0.65 * ttFr) * float(gl_FrontFacing);
#endif
    totalEmissiveRadiance += ttAdd * (1.0 - 0.7 * ttTorn);
  }
`;
  // flags: { brk, hull, back, win, wreck }. side: +1 bow, -1 stern, 0 = no break discard
  function patchMaterial(mat, side, flags) {
    const defs = [];
    if (flags.brk !== false && side !== 0) defs.push('TT_BREAK');
    if (flags.hull) defs.push('TT_HULL');
    if (flags.back) defs.push('TT_BACKDARK');
    if (flags.win) defs.push('TT_WIN');
    if (flags.wreck !== false) defs.push('TT_WRECK');
    const head = defs.map((d) => '#define ' + d + '\n').join('');
    const key = 'ttship:' + defs.join(',');
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, SU);
      sh.uniforms.uSide = { value: side };
      sh.vertexShader = head + GLSL_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GLSL_VERT_BODY);
      sh.fragmentShader = head + GLSL_FRAG_HEAD + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GLSL_FRAG_DISCARD)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + GLSL_FRAG_ROUGH)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + GLSL_FRAG_METAL)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + GLSL_FRAG_EMIS);
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  }
  // three variants of a material: [bow, stern, no-break]
  function matSet(make, flags) {
    return [1, -1, 0].map((side) => patchMaterial(make(), side, flags));
  }

  // ------------------------------------------------------------------
  // Module state
  // ------------------------------------------------------------------
  const ST = {
    root: null, secs: [null, null], tex: {}, mats: {}, B: null,
    funnels: [], foremast: null, screws: [], rudder: null,
    davits: [null, null], davitInfo: [], people: [null, null], spots: [],
    breakObjs: [[], []], wreckOnly: [], liveOnly: [], lights: [], rigMat: null,
    propT0: 0, propStep: 1 / 60, propAng: null, lastDyn: -1e9, lastSig: '',
  };
  let B = null;   // batches while building

  // =====================================================================
  // TEXTURES
  // =====================================================================
  // periodic value noise in [0,1] (period px, py lattice cells)
  function pnoise(x, y, px, py, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a, b) => U.hash1(((((a % px) + px) % px) * 73856093) ^ ((((b % py) + py) % py) * 19349663) ^ (seed * 83492791));
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  }
  function makeTextures(renderer) {
    const T = ST.tex;
    const aniso = Math.min(8, renderer && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    function dataTex(w, h, data, srgb) {
      const tx = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true;
      tx.anisotropy = aniso;
      if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      tx.needsUpdate = true;
      return tx;
    }
    function normalFromHeight(hf, w, h, strength) {
      const out = new Uint8Array(w * h * 4);
      for (let j = 0; j < h; j++) {
        const jm = ((j - 1 + h) % h) * w, jp = ((j + 1) % h) * w, jr = j * w;
        for (let i = 0; i < w; i++) {
          const im = (i - 1 + w) % w, ip = (i + 1) % w;
          const dx = (hf[jr + ip] - hf[jr + im]) * strength, dy = (hf[jp + i] - hf[jm + i]) * strength;
          const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (jr + i) * 4;
          out[o] = (-dx * l * 0.5 + 0.5) * 255; out[o + 1] = (-dy * l * 0.5 + 0.5) * 255; out[o + 2] = (l * 0.5 + 0.5) * 255; out[o + 3] = 255;
        }
      }
      return out;
    }
    const rivet = (d, r) => (d < r ? Math.sqrt(1 - (d * d) / (r * r)) : 0);

    // ---- hull plating: lapped strakes, staggered butts, rivet rows, frames (tile 18 m x 10.8 m)
    {
      const w = q3(512, 1024, 2048), h = w / 2, HX = 18, HY = 10.8;
      const hf = new Float32Array(w * h), ro = new Uint8Array(w * h * 4);
      const RS = 0.085, RR = 0.0115;
      for (let j = 0; j < h; j++) {
        const Y = (j + 0.5) / h * HY, k = Math.floor(Y / 1.8), yy = Y - k * 1.8, outer = k % 2 === 1;
        for (let i = 0; i < w; i++) {
          const X = (i + 0.5) / w * HX;
          let v = outer ? 1 : 0;
          if (outer) v *= Math.min(1, Math.min(yy, 1.8 - yy) / 0.014 + 0.15);
          const bp = (((X + k * 3.7) % 9) + 9) % 9, eb = Math.min(bp, 9 - bp);
          if (eb < 0.007) v -= 0.4;
          v -= 0.12 * (0.5 - 0.5 * Math.cos(2 * Math.PI * X / 0.915));
          // rivet rows along the laps of the outer strakes and along every butt
          if (outer) {
            for (const ry of [0.045, 0.115, 1.8 - 0.045, 1.8 - 0.115]) {
              const dy = yy - ry;
              if (Math.abs(dy) < RR) { const off = ry < 0.08 || ry > 1.72 ? 0 : RS / 2; const dx = X - off - Math.round((X - off) / RS) * RS; v += 0.7 * rivet(Math.hypot(dx, dy), RR); }
            }
          }
          for (const rx of [0.045, 0.115]) {
            const dx = eb - rx;
            if (Math.abs(dx) < RR) { const dy = yy - Math.round(yy / RS) * RS; v += 0.7 * rivet(Math.hypot(dx, dy), RR); }
          }
          hf[j * w + i] = v;
          const n = pnoise(X / 1.5, Y / 1.2, 12, 9, 3) * 0.6 + pnoise(X / 0.3, Y / 0.3, 60, 36, 5) * 0.4;
          const streak = pnoise(X / 0.6, Y / 6, 30, 2, 9);
          const r = 0.26 + 0.16 * n + 0.12 * streak * streak - (eb < 0.02 ? 0.04 : 0);
          const o = (j * w + i) * 4;
          ro[o] = 255; ro[o + 1] = clamp(r, 0.05, 1) * 255; ro[o + 2] = 0; ro[o + 3] = 255;
        }
      }
      T.hullN = dataTex(w, h, normalFromHeight(hf, w, h, 0.55));
      T.hullR = dataTex(w, h, ro);
      T.hullTile = [HX, HY];
    }
    // ---- painted steel panels (superstructure, funnels): seams + faint rivets, grime streaks (tile 6 m)
    {
      const w = q3(256, 512, 512), h = w, S6 = 6;
      const hf = new Float32Array(w * h), ro = new Uint8Array(w * h * 4);
      for (let j = 0; j < h; j++) {
        const Y = (j + 0.5) / h * S6;
        for (let i = 0; i < w; i++) {
          const X = (i + 0.5) / w * S6;
          const sy = Y % 1.5, sx = (X + (Math.floor(Y / 1.5) % 2) * 0.9) % 1.8;
          let v = 0;
          if (Math.min(sy, 1.5 - sy) < 0.012) v -= 0.6;
          if (Math.min(sx, 1.8 - sx) < 0.012) v -= 0.6;
          const dy = Math.min(sy, 1.5 - sy) - 0.04;
          if (Math.abs(dy) < 0.012) { const dx = X - Math.round(X / 0.1) * 0.1; v += 0.4 * rivet(Math.hypot(dx, dy), 0.012); }
          v += 0.25 * pnoise(X / 0.6, Y / 0.6, 10, 10, 11);
          hf[j * w + i] = v;
          const streak = pnoise(X / 0.25, Y / 2.5, 24, 2.4, 13);
          const o = (j * w + i) * 4;
          ro[o] = 255; ro[o + 1] = clamp(0.5 + 0.25 * streak + 0.1 * pnoise(X, Y, 6, 6, 17), 0, 1) * 255; ro[o + 2] = 0; ro[o + 3] = 255;
        }
      }
      T.panelN = dataTex(w, h, normalFromHeight(hf, w, h, 0.6));
      T.panelR = dataTex(w, h, ro);
    }
    // ---- deck planking along X (tile 6 m): caulked seams, staggered butts, grain
    {
      const w = q3(512, 1024, 1024), h = w, S6 = 6, PW = 0.15;
      const hf = new Float32Array(w * h), col = new Uint8Array(w * h * 4);
      for (let j = 0; j < h; j++) {
        const Z = (j + 0.5) / h * S6, k = Math.floor(Z / PW), zz = Z - k * PW;
        const plank = U.hash1(k * 7 + 1), off = U.hash1(k * 13 + 5) * 6;
        for (let i = 0; i < w; i++) {
          const X = (i + 0.5) / w * S6;
          const bp = (X + off) % 6, seg = Math.floor((X + off) / 6);
          const seam = Math.min(zz, PW - zz) < 0.006 || Math.min(bp, 6 - bp) < 0.004;
          const tone = 0.85 + 0.3 * U.hash1(k * 31 + seg * 17);
          const grain = 0.9 + 0.1 * Math.sin(X * 40 + pnoise(X / 0.5, Z / 0.05, 12, 120, 21) * 8) + 0.08 * (pnoise(X / 0.2, Z / 0.02, 30, 300, 23) - 0.5);
          let r = 128 * tone * grain, g = 112 * tone * grain, b = 92 * tone * grain;
          if (seam) { r = 26; g = 22; b = 19; }
          const o = (j * w + i) * 4;
          col[o] = clamp(r, 0, 255); col[o + 1] = clamp(g, 0, 255); col[o + 2] = clamp(b, 0, 255); col[o + 3] = 255;
          hf[j * w + i] = seam ? -1 : 0.05 * grain + 0.02 * plank;
        }
      }
      T.wood = dataTex(w, h, col, true);
      T.woodN = dataTex(w, h, normalFromHeight(hf, w, h, 0.5));
    }
    // ---- window atlas (4 x 4 cells of 128 px): albedo (map), roughness (G), emissive mask
    {
      const N = 512, CS = 128;
      const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
      const cm = mk(), cr = mk(), ce = mk();
      const gm = cm.getContext('2d'), gr = cr.getContext('2d'), ge = ce.getContext('2d');
      gm.fillStyle = '#0b0c0e'; gm.fillRect(0, 0, N, N);
      gr.fillStyle = 'rgb(0,110,0)'; gr.fillRect(0, 0, N, N);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, N, N);
      const cell = (c, fn) => { const x = (c % 4) * CS, y = Math.floor(c / 4) * CS; for (const g of [gm, gr, ge]) { g.save(); g.translate(x, y); } fn(); for (const g of [gm, gr, ge]) g.restore(); };
      const HULLC = '#0b0c0e', WHITEC = '#d9d6cc', GLASS = '#0b0e12', FRAME = '#2a2016';
      const rr = (g, x, y, w2, h2, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w2, y, x + w2, y + h2, r); g.arcTo(x + w2, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w2, y, r); g.closePath(); };
      const surround = (c) => { gm.fillStyle = c; gm.fillRect(0, 0, CS, CS); gr.fillStyle = c === HULLC ? 'rgb(0,95,0)' : 'rgb(0,150,0)'; gr.fillRect(0, 0, CS, CS); };
      const glow = (x, y, w2, h2, hot) => { const g = ge.createRadialGradient(x + w2 / 2, y + h2 / 2, 0, x + w2 / 2, y + h2 / 2, Math.max(w2, h2) * 0.7); g.addColorStop(0, '#fff'); g.addColorStop(1, hot || '#b0b0b0'); ge.fillStyle = g; };
      // porthole: brass rim with its clamping dogs, the inner lip catching the cabin light, the glass
      // glowing brighter toward the lamp (upper middle); `curtain` draws a half-drawn curtain with folds
      const port = (rimC, lipC, curtain) => {
        gm.fillStyle = rimC; gm.beginPath(); gm.arc(64, 64, 58, 0, 7); gm.fill();
        gm.fillStyle = lipC; gm.beginPath(); gm.arc(64, 64, 50, 0, 7); gm.fill();
        gm.fillStyle = GLASS; gm.beginPath(); gm.arc(64, 64, 45, 0, 7); gm.fill();
        gm.fillStyle = '#15110b'; for (const a of [0.5, 2.6, 4.7]) { gm.beginPath(); gm.arc(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54, 4.5, 0, 7); gm.fill(); }
        gr.fillStyle = 'rgb(0,70,0)'; gr.beginPath(); gr.arc(64, 64, 58, 0, 7); gr.fill();
        gr.fillStyle = 'rgb(0,40,0)'; gr.beginPath(); gr.arc(64, 64, 50, 0, 7); gr.fill();
        gr.fillStyle = 'rgb(0,14,0)'; gr.beginPath(); gr.arc(64, 64, 45, 0, 7); gr.fill();
        ge.fillStyle = '#101010'; ge.beginPath(); ge.arc(64, 64, 57, 0, 7); ge.fill();               // glow on the brass rim
        ge.fillStyle = '#303030'; ge.beginPath(); ge.arc(64, 64, 49.5, 0, 7); ge.fill();             // lit inner lip
        ge.fillStyle = '#161616'; ge.beginPath(); ge.arc(64, 64, 47, 0, 7); ge.fill();               // shadowed seat of the glass
        const g = ge.createRadialGradient(62, 52, 0, 64, 64, 46); g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#c4c4c4'); g.addColorStop(1, '#7a7a7a');
        ge.fillStyle = g; ge.beginPath(); ge.arc(64, 64, 45, 0, 7); ge.fill();
        if (curtain) {
          ge.save(); ge.beginPath(); ge.arc(64, 64, 45, 0, 7); ge.clip(); ge.globalCompositeOperation = 'multiply';
          const cg = ge.createLinearGradient(19, 0, 82, 0);
          for (let k = 0; k <= 8; k++) cg.addColorStop(k / 8, k % 2 ? '#6a6a6a' : '#3a3a3a');
          ge.fillStyle = cg; ge.beginPath(); ge.moveTo(19, 19); ge.lineTo(80, 19); ge.quadraticCurveTo(66, 70, 74, 110); ge.lineTo(19, 110); ge.fill();
          ge.restore();
        }
      };
      // 0: porthole on the black hull
      cell(0, () => { surround(HULLC); port(FRAME, '#4a3a22', false); });
      // 12: the same with a half-drawn curtain
      cell(12, () => { surround(HULLC); port(FRAME, '#4a3a22', true); });
      // 1: rectangular window on black (B deck)
      cell(1, () => { surround(HULLC); gm.fillStyle = FRAME; rr(gm, 14, 8, 100, 112, 14); gm.fill(); gm.fillStyle = GLASS; rr(gm, 22, 16, 84, 96, 9); gm.fill(); gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(22, 16, 84, 96); glow(22, 16, 84, 96); rr(ge, 22, 16, 84, 96, 9); ge.fill(); gm.fillStyle = FRAME; gm.fillRect(61, 16, 6, 96); ge.fillStyle = '#000'; ge.fillRect(61, 16, 6, 96); });
      // 2: promenade window on white (sash with two lights)
      cell(2, () => { surround(WHITEC); gm.fillStyle = '#6e6a60'; gm.fillRect(6, 14, 116, 100); gm.fillStyle = GLASS; gm.fillRect(12, 20, 104, 88); gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(12, 20, 104, 88); glow(12, 20, 104, 88, '#9a9a9a'); ge.fillRect(12, 20, 104, 88); gm.fillStyle = WHITEC; gm.fillRect(12, 60, 104, 6); ge.fillStyle = '#000'; ge.fillRect(12, 60, 104, 6); });
      // 3: deckhouse window on white (cross bar)
      cell(3, () => { surround(WHITEC); gm.fillStyle = '#5c584f'; gm.fillRect(16, 10, 96, 108); gm.fillStyle = GLASS; gm.fillRect(22, 16, 84, 96); gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(22, 16, 84, 96); glow(22, 16, 84, 96); ge.fillRect(22, 16, 84, 96); gm.fillStyle = WHITEC; gm.fillRect(22, 58, 84, 6); gm.fillRect(61, 16, 6, 96); ge.fillStyle = '#000'; ge.fillRect(22, 58, 84, 6); ge.fillRect(61, 16, 6, 96); });
      // 4: open promenade bay: shadowed deck, the lit inner wall with a window, a lamp overhead
      cell(4, () => {
        surround(WHITEC); gm.fillStyle = '#141416'; gm.fillRect(4, 10, 120, 118); gr.fillStyle = 'rgb(0,200,0)'; gr.fillRect(4, 10, 120, 118);
        gm.fillStyle = '#26221e'; gm.fillRect(4, 104, 120, 24);                       // deck planks in shadow
        let g = ge.createLinearGradient(0, 10, 0, 128); g.addColorStop(0, '#2c2c2c'); g.addColorStop(0.75, '#181818'); g.addColorStop(1, '#101010'); ge.fillStyle = g; ge.fillRect(4, 10, 120, 118);
        gm.fillStyle = '#2e2924'; gm.fillRect(30, 30, 68, 74); gm.fillStyle = '#3a3226'; gm.fillRect(40, 40, 48, 44);
        ge.fillStyle = '#e8e8e8'; ge.fillRect(42, 42, 44, 40); ge.fillStyle = '#000'; ge.fillRect(62, 42, 4, 40);   // the lit inner window
        ge.fillStyle = '#fff'; ge.beginPath(); ge.arc(64, 17, 5, 0, 7); ge.fill();
      });
      // 5: glass pane with lattice (domes, skylights)
      cell(5, () => { surround('#23252a'); gm.fillStyle = '#1a2026'; gm.fillRect(8, 8, 112, 112); gr.fillStyle = 'rgb(0,25,0)'; gr.fillRect(8, 8, 112, 112); glow(8, 8, 112, 112, '#c8c8c8'); ge.fillRect(8, 8, 112, 112); gm.fillStyle = '#23252a'; ge.fillStyle = '#000'; for (const p of [38, 62, 86]) { gm.fillRect(p - 2, 8, 4, 112); ge.fillRect(p - 2, 8, 4, 112); gm.fillRect(8, p - 2, 112, 4); ge.fillRect(8, p - 2, 112, 4); } });
      // 6: lamp globe
      cell(6, () => { surround('#e8e2d0'); const g = ge.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#d0d0d0'); g.addColorStop(1, '#707070'); ge.fillStyle = g; ge.fillRect(0, 0, CS, CS); });
      // 7: flat full emissive (navigation lights)
      cell(7, () => { surround('#ffffff'); ge.fillStyle = '#fff'; ge.fillRect(0, 0, CS, CS); });
      // 8: porthole on white
      cell(8, () => { surround(WHITEC); port('#6a5a40', '#8a7650', false); });
      // 9: door on white with a small light
      cell(9, () => { surround(WHITEC); gm.fillStyle = '#8d8474'; gm.fillRect(22, 4, 84, 124); gm.fillStyle = '#b9b3a5'; gm.fillRect(28, 60, 72, 64); gm.fillStyle = GLASS; gm.fillRect(34, 14, 60, 38); gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(34, 14, 60, 38); ge.fillStyle = '#d0d0d0'; ge.fillRect(34, 14, 60, 38); });
      // 10: bridge / wheelhouse window (large, dim)
      cell(10, () => { surround(WHITEC); gm.fillStyle = '#4b463d'; gm.fillRect(8, 8, 112, 112); gm.fillStyle = GLASS; gm.fillRect(14, 14, 100, 100); gr.fillStyle = 'rgb(0,12,0)'; gr.fillRect(14, 14, 100, 100); glow(14, 14, 100, 100, '#606060'); ge.fillRect(14, 14, 100, 100); });
      // 11: arched window on white (verandah cafe, lounge clerestory)
      cell(11, () => { surround(WHITEC); gm.fillStyle = '#5c584f'; gm.beginPath(); gm.moveTo(16, 124); gm.lineTo(16, 56); gm.arc(64, 56, 48, Math.PI, 0); gm.lineTo(112, 124); gm.fill(); gm.fillStyle = GLASS; gm.beginPath(); gm.moveTo(22, 120); gm.lineTo(22, 58); gm.arc(64, 58, 42, Math.PI, 0); gm.lineTo(106, 120); gm.fill(); gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(22, 16, 84, 104); glow(22, 16, 84, 104); ge.beginPath(); ge.moveTo(22, 120); ge.lineTo(22, 58); ge.arc(64, 58, 42, Math.PI, 0); ge.lineTo(106, 120); ge.fill(); gm.fillStyle = WHITEC; ge.fillStyle = '#000'; for (const p of [49, 77]) { gm.fillRect(p, 16, 4, 104); ge.fillRect(p, 16, 4, 104); } gm.fillRect(22, 70, 84, 4); ge.fillRect(22, 70, 84, 4); });
      // 13: rectangular window on black with curtains drawn to the sides
      cell(13, () => {
        surround(HULLC); gm.fillStyle = FRAME; rr(gm, 14, 8, 100, 112, 14); gm.fill(); gm.fillStyle = GLASS; rr(gm, 22, 16, 84, 96, 9); gm.fill();
        gr.fillStyle = 'rgb(0,18,0)'; gr.fillRect(22, 16, 84, 96); glow(22, 16, 84, 96); rr(ge, 22, 16, 84, 96, 9); ge.fill();
        ge.save(); ge.globalCompositeOperation = 'multiply';
        for (const [x0, x1] of [[22, 44], [84, 106]]) {
          const cg = ge.createLinearGradient(x0, 0, x1, 0);
          for (let k = 0; k <= 5; k++) cg.addColorStop(k / 5, k % 2 ? '#5a5a5a' : '#2e2e2e');
          ge.fillStyle = cg; ge.fillRect(x0, 16, x1 - x0, 96);
        }
        ge.restore();
        gm.fillStyle = FRAME; gm.fillRect(61, 16, 6, 96); ge.fillStyle = '#000'; ge.fillRect(61, 16, 6, 96);
      });
      const ctex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
      T.winMap = ctex(cm, true); T.winRough = ctex(cr, false); T.winEmis = ctex(ce, false);
    }
    // ---- names (gilt letters): bow "TITANIC", stern "TITANIC / LIVERPOOL"
    {
      const mkName = (lines, w, h) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        lines.forEach(([txt, size, y]) => {
          g.font = 'bold ' + size + 'px "Times New Roman", Georgia, serif';
          const spaced = txt.split('').join(String.fromCharCode(8202));
          const gr2 = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
          gr2.addColorStop(0, '#f6dc8c'); gr2.addColorStop(0.5, '#c9973c'); gr2.addColorStop(1, '#8a5f1e');
          g.fillStyle = gr2; g.fillText(spaced, w / 2, y);
        });
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
        return t;
      };
      T.nameBow = mkName([['TITANIC', 190, 128]], 1024, 256);
      T.nameStern = mkName([['TITANIC', 170, 110], ['LIVERPOOL', 120, 270]], 1024, 384);
    }
  }

  // =====================================================================
  // MATERIALS
  // =====================================================================
  function makeMaterials() {
    const T = ST.tex, M = ST.mats;
    const DS = THREE.DoubleSide;
    M.hull = matSet(() => new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, roughnessMap: T.hullR, normalMap: T.hullN, normalScale: new THREE.Vector2(0.9, 0.9),
      metalness: 0.0, side: DS, envMapIntensity: 2.2,
    }), { hull: true, back: true });
    M.white = matSet(() => new THREE.MeshStandardMaterial({
      color: 0xd9d6cc, roughness: 1, roughnessMap: T.panelR, normalMap: T.panelN, normalScale: new THREE.Vector2(0.45, 0.45),
      metalness: 0, side: DS, envMapIntensity: 0.6,
    }), { back: true });
    M.wood = matSet(() => new THREE.MeshStandardMaterial({
      color: 0xffffff, map: T.wood, normalMap: T.woodN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82, metalness: 0,
      side: DS, envMapIntensity: 0.6,
    }), { back: true });
    M.dark = matSet(() => new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.55, metalness: 0.35, side: DS, envMapIntensity: 0.9 }), {});
    M.buff = matSet(() => new THREE.MeshStandardMaterial({
      color: 0xc8923f, roughness: 0.6, normalMap: T.panelN, normalScale: new THREE.Vector2(0.3, 0.3), metalness: 0, side: DS,
    }), { back: true });
    M.win = matSet(() => new THREE.MeshStandardMaterial({
      color: 0xffffff, map: T.winMap, roughness: 1, roughnessMap: T.winRough, metalness: 0,
      emissive: 0xffffff, emissiveMap: T.winEmis, emissiveIntensity: 1, envMapIntensity: 1.4,
    }), { win: true });
    M.funnel = patchMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.62, normalMap: T.panelN, normalScale: new THREE.Vector2(0.35, 0.35),
      metalness: 0, side: DS, envMapIntensity: 0.8,
    }), 0, { back: true });
    M.bronze = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xb8803e, metalness: 1, roughness: 0.3, envMapIntensity: 1.6 }), 0, {});
    M.hullNB = M.hull[2]; M.buffNB = M.buff[2]; M.whiteNB = M.white[2]; M.darkNB = M.dark[2];
    M.nameBow = patchMaterial(new THREE.MeshStandardMaterial({ map: T.nameBow, alphaTest: 0.35, metalness: 0.35, roughness: 0.38, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0, {});
    M.nameStern = patchMaterial(new THREE.MeshStandardMaterial({ map: T.nameStern, alphaTest: 0.35, metalness: 0.35, roughness: 0.38, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0, {});
    M.people = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    M.rust = new THREE.MeshStandardMaterial({ color: 0x5a2a10, roughness: 1, metalness: 0 });
    // rigging lines: guys vanish as their funnel falls, the aerial goes with funnel 1, all gone on the wreck
    const rm = new THREE.LineBasicMaterial({ color: 0x2a2d33 });
    rm.onBeforeCompile = (sh) => {
      sh.uniforms.uFall = SU.uFall; sh.uniforms.uWreck = SU.uWreck;
      sh.vertexShader = 'attribute float aId; uniform vec4 uFall; uniform float uWreck;\n' + sh.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
  float ttf = aId < 0.5 ? 0.0 : aId < 1.5 ? uFall.x : aId < 2.5 ? uFall.y : aId < 3.5 ? uFall.z : aId < 4.5 ? uFall.w : step(0.3, uFall.x);
  if (ttf > 0.01 || uWreck > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`);
    };
    rm.customProgramCacheKey = () => 'ttship-rig';
    ST.rigMat = rm;
  }

  // =====================================================================
  // BUILD — hull, decks, superstructure, fittings, lights, break faces
  // =====================================================================
  function buildHull() {
    const K = SH.KEEL_Y, R = 2.8;
    const HX = ST.tex.hullTile ? ST.tex.hullTile[0] : 18, HY = ST.tex.hullTile ? ST.tex.hullTile[1] : 10.8;
    // stations: dense at the ends and around every sheer transition, always one at the break
    let xs = [];
    const rng = (a, b, st) => { for (let x = a; x < b - 1e-6; x += st) xs.push(x); };
    rng(-134.8, -118, 0.4); rng(-118, -100, 1); rng(-100, 96, 2); rng(96, 122, 1); rng(122, 134, 0.35);
    xs.push(134.0, BX, 66, 66.4, 66.8, 67.2, 67.5, 95.5, 95.9, 96.3, 96.7, 97, -80, -80.4, -80.8, -81.2, -81.5, -102.5, -102.9, -103.3, -103.7, -104);
    xs.sort((a, b) => a - b);
    xs = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.05);
    // girth rows from the keel centreline up to the sheer
    const rows = [];
    for (const f of [0, 0.3, 0.6, 0.85, 1.0]) rows.push({ t: 'bot', f });
    for (const a of [0.14, 0.3, 0.46, 0.62, 0.78, 0.92]) rows.push({ t: 'y', y: K + R * (1 - Math.cos(a * Math.PI / 2)) });
    for (const y of [K + R, -6.4, -5.0, -3.5, -2.0, -0.8, 0.0, 0.15, 0.9, 2.5, 4.4, 6.3, 8.3, 10.3, 12.0]) rows.push({ t: 'y', y });
    for (const d of [0.95, 0.66, 0.52, 0.22, 0.0]) rows.push({ t: 'top', d });
    const nu = xs.length, nv = rows.length;
    const pos = new Float32Array(nu * nv * 3), uv = new Float32Array(nu * nv * 2);
    for (let i = 0; i < nu; i++) {
      const x = xs[i], sh = SHEER(clamp(x, SH.STERN_X, SH.STEM_X));
      const zb = HB(clamp(x, aftEnd(K), ENDS(K).fwd), K + 1e-3);
      for (let j = 0; j < nv; j++) {
        const r = rows[j];
        let y = r.t === 'bot' ? K : r.t === 'top' ? sh - r.d : Math.min(r.y, sh - 1.0);
        const e = ENDS(y), a = aftEnd(y);
        let xx = x, z;
        if (x >= e.fwd) { xx = e.fwd; z = 0; }
        else if (x <= a) { xx = a; z = 0; }
        else {
          z = r.t === 'bot' ? r.f * HB(x, K + 1e-3) : HB(x, y);
          if (a > e.aft + 0.01) z *= sstep(a, a + 2.6, x);   // fair the rudder post / screw aperture
        }
        const o = (i * nv + j) * 3;
        pos[o] = xx; pos[o + 1] = y; pos[o + 2] = z;
        uv[(i * nv + j) * 2] = xx / HX;
        uv[(i * nv + j) * 2 + 1] = (r.t === 'bot' ? K - (zb - z) : y) / HY;
      }
    }
    const idxS = [], idxP = [];
    for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
      const a = i * nv + j, b2 = (i + 1) * nv + j, c = a + 1, d = b2 + 1;
      idxS.push(a, b2, d, a, d, c);      // starboard (+z) faces outward
      idxP.push(a, d, b2, a, c, d);
    }
    const mk = (mirror, idx) => {
      const g = new THREE.BufferGeometry();
      const p = mirror ? pos.map((v, k) => (k % 3 === 2 ? -v : v)) : pos;
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const ex = { aSheer: (x) => SHEER(clamp(x, SH.STERN_X, SH.STEM_X)) };
    B.hull.add(mk(false, idxS), { keepUV: true, ex });
    B.hull.add(mk(true, idxP), { keepUV: true, ex });

    // bulwarks of the well decks: inner face (white) and the capping rail on top
    for (const [x0, x1] of [[SH.FWD_WELL_X[0] + 0.6, SH.FWD_WELL_X[1] - 0.4], [SH.AFT_WELL_X[0] + 0.4, SH.AFT_WELL_X[1] - 0.6]]) {
      for (const side of [1, -1]) {
        const xsw = stations(x0, x1, 1.0);
        const inner = gridGeo(xsw.length - 1, 1, (u, v) => {
          const x = xsw[Math.round(u * (xsw.length - 1))];
          const top = SHEER(x) - 0.02, y = lerp(WELL_Y, top, v);
          return [x, y, side * (HB(x, y) - 0.2)];
        });
        if (side > 0) inner.index.array.reverse();
        inner.computeVertexNormals();
        B.white.add(inner);
        const cap = gridGeo(xsw.length - 1, 1, (u, v) => {
          const x = xsw[Math.round(u * (xsw.length - 1))], y = SHEER(x) + 0.03;
          return [x, y, side * (HB(x, y - 0.1) - 0.24 + v * 0.3)];
        });
        if (side > 0) cap.index.array.reverse();
        cap.computeVertexNormals();
        B.wood.add(cap);
      }
    }
    // closing plate at the very top of the counter and the stem head (rail caps)
    for (const side of [1, -1]) {
      const xsw = stations(SH.STERN_X + 0.02, SH.POOP_X[1] - 0.2, 0.6).concat(stations(SH.FORECASTLE_X[0] + 0.3, SH.STEM_X - 0.05, 0.6));
      for (let i = 0; i < xsw.length - 1; i++) {
        const xa = xsw[i], xb = xsw[i + 1];
        if (xb - xa > 3) continue;
        const ya = SHEER(xa), yb = SHEER(xb);
        const za = HB(xa, ya - 0.05), zb2 = HB(xb, yb - 0.05);
        if (za < 0.05 && zb2 < 0.05) continue;
        const P0 = [xa, ya + 0.02, side * za], P1 = [xb, yb + 0.02, side * zb2], P2 = [xb, yb + 0.02, side * Math.max(0, zb2 - 0.25)], P3 = [xa, ya + 0.02, side * Math.max(0, za - 0.25)];
        if (side > 0) quad(B.dark, P0, P1, P2, P3); else quad(B.dark, P0, P3, P2, P1);
      }
    }
  }
  // a cambered deck strip along x: y = yFn(x) + crown, half-width wFn(x); planks run along x
  function deckStrip(batch, x0, x1, yFn, wFn, step, camber) {
    const xs = stations(x0, x1, step);
    const nz = 8, n = xs.length - 1;
    const g = gridGeo(n, nz, (u, v) => {
      const x = xs[Math.round(u * n)], w = Math.max(0, wFn(x)), z = (v * 2 - 1) * w;
      return [x, yFn(x) + camber * (1 - (w > 0.01 ? (z / w) * (z / w) : 1)), z];
    }, (u, v, p) => [p[0] / 6, p[2] / 6]);
    g.index.array.reverse(); g.computeVertexNormals();
    batch.add(g, { keepUV: true });
  }
  // vertical wall following the hull plan: z = side * zFn(x), from y0(x) to y1(x); faces outward
  function sideWall(batch, x0, x1, zFn, y0Fn, y1Fn, side, step) {
    const xs = stations(x0, x1, step || 1.0), n = xs.length - 1;
    const g = gridGeo(n, 1, (u, v) => { const x = xs[Math.round(u * n)]; return [x, lerp(y0Fn(x), y1Fn(x), v), side * zFn(x)]; });
    if (side < 0) g.index.array.reverse();
    g.computeVertexNormals();
    batch.add(g);
  }
  // flat transverse bulkhead at x from y0 to y1, spanning +-w, facing +x (dir 1) or -x (dir -1)
  function endWall(batch, x, y0, y1, w, dir) {
    const p0 = [x, y0, -w], p1 = [x, y0, w], p2 = [x, y1, w], p3 = [x, y1, -w];
    if (dir > 0) quad(batch, p1, p0, p3, p2); else quad(batch, p0, p1, p2, p3);
  }
  function buildDecks() {
    const inner = (y) => (x) => HB(x, y) - 0.2;
    deckStrip(B.wood, SH.FORECASTLE_X[0], SH.STEM_X - 0.02, (x) => SHEER(x), (x) => HB(x, SHEER(x) - 0.05) - 0.02, 0.8, 0.22);
    deckStrip(B.wood, SH.FWD_WELL_X[0], SH.FWD_WELL_X[1], () => WELL_Y, inner(WELL_Y + 0.2), 1.0, 0.12);
    deckStrip(B.wood, SH.SUPERSTRUCTURE_X[0], SH.SUPERSTRUCTURE_X[1], () => BOAT_Y, (x) => HB(x, HULL_TOP), 1.5, 0.18);
    deckStrip(B.wood, SH.AFT_WELL_X[1], SH.SUPERSTRUCTURE_X[0], () => HULL_TOP, (x) => HB(x, HULL_TOP) - 0.02, 1.0, 0.12);
    deckStrip(B.wood, SH.AFT_WELL_X[0], SH.AFT_WELL_X[1], () => WELL_Y, inner(WELL_Y + 0.2), 1.0, 0.12);
    deckStrip(B.wood, SH.STERN_X + 0.02, SH.POOP_X[1], (x) => SHEER(x), (x) => HB(x, SHEER(x) - 0.05) - 0.02, 0.6, 0.2);
    // transverse fronts facing into the well decks
    const wIn = (x, y) => HB(x, y) - 0.2;
    endWall(B.white, SH.FORECASTLE_X[0], WELL_Y, SHEER(SH.FORECASTLE_X[0]), wIn(SH.FORECASTLE_X[0], 14), -1);
    endWall(B.white, SH.FWD_WELL_X[0], WELL_Y, BOAT_Y, HB(SH.FWD_WELL_X[0], HULL_TOP) - 0.01, 1);
    endWall(B.white, SH.AFT_WELL_X[1], WELL_Y, HULL_TOP, wIn(SH.AFT_WELL_X[1], 13), -1);
    endWall(B.white, SH.POOP_X[1], WELL_Y, SHEER(SH.POOP_X[1]), wIn(SH.POOP_X[1], 14), 1);
    // deck edge stringers where the decks meet the hull (dark steel margins)
    for (const side of [1, -1]) {
      for (const [x0, x1, yF, wF] of [
        [SH.FWD_WELL_X[0], SH.FWD_WELL_X[1], () => WELL_Y + 0.015, inner(WELL_Y + 0.2)],
        [SH.AFT_WELL_X[0], SH.AFT_WELL_X[1], () => WELL_Y + 0.015, inner(WELL_Y + 0.2)],
      ]) {
        const xs = stations(x0, x1, 1.0);
        for (let i = 0; i < xs.length - 1; i++) {
          const a = xs[i], b2 = xs[i + 1];
          const P = [[a, yF(a), side * wF(a)], [b2, yF(b2), side * wF(b2)], [b2, yF(b2), side * (wF(b2) - 0.3)], [a, yF(a), side * (wF(a) - 0.3)]];
          if (side > 0) quad(B.dark, P[0], P[1], P[2], P[3]); else quad(B.dark, P[0], P[3], P[2], P[1]);
        }
      }
    }
  }

  // Boat-deck houses: [x0, x1, z0, z1, height above the boat deck, kind]
  const HOUSES = [
    [60.0, 64.0, -4.3, 4.3, 2.7, 'wheel'],
    [45.6, 60.0, -7.2, 7.2, 2.8, 'officers'],
    [35.2, 45.6, -5.4, 5.4, 2.8, 'casing'],
    [24.5, 35.2, -7.4, 7.4, 2.8, 'entrance'],
    [21.4, 30.0, 7.4, 10.4, 3.1, 'gym'],
    [11.2, 21.4, -5.4, 5.4, 2.8, 'casing'],
    [-3.4, 11.2, -4.4, 4.4, 1.3, 'skylight'],
    [-13.2, -3.4, -5.4, 5.4, 2.8, 'casing'],
    [-19.4, -13.2, -6.8, 6.8, 3.5, 'lounge'],
    [-24.6, -19.4, -4.2, 4.2, 1.1, 'domebase'],
    [-38.2, -26.6, -5.4, 5.4, 2.8, 'casing'],
    [-57.5, -42.0, -6.6, 6.6, 2.8, 'second'],
  ];
  const DOMES = [
    { x: 30.0, y: BOAT_Y + 2.8, rx: 3.4, rz: 2.8, h: 1.9 },   // first-class grand staircase
    { x: -22.0, y: BOAT_Y + 1.1, rx: 2.3, rz: 2.0, h: 1.4 },  // aft staircase (the break runs through it)
  ];
  function buildSuperstructure() {
    const S0 = SH.SUPERSTRUCTURE_X[0], S1 = SH.SUPERSTRUCTURE_X[1];
    const wA = (x) => HB(x, HULL_TOP);
    // A-deck walls (flush with the hull side), the boat-deck fascia
    for (const side of [1, -1]) {
      sideWall(B.white, S0, S1, wA, () => HULL_TOP, () => BOAT_Y, side, 1.0);
      sideWall(B.white, S0, S1, (x) => wA(x) + 0.1, () => BOAT_Y - 0.28, () => BOAT_Y + 0.02, side, 2.0);
      // expansion joints: thin dark seams through the superstructure
      for (const xj of [34.6, -28.4]) { const zc = side * wA(xj); box(B.dark, xj - 0.04, xj + 0.04, HULL_TOP, BOAT_Y, zc - 0.08, zc + 0.08); }
    }
    endWall(B.white, S0, HULL_TOP, BOAT_Y, wA(S0) - 0.01, -1);
    // aft end of A deck: the verandah cafes and the second-class house on the after B deck
    box(B.white, -77.0, S0, HULL_TOP, HULL_TOP + 3.2, -9.6, 9.6);
    box(B.white, -77.2, S0 + 0.1, HULL_TOP + 3.2, HULL_TOP + 3.35, -9.8, 9.8);
    // boat-deck houses
    for (const [x0, x1, z0, z1, h, kind] of HOUSES) {
      box(B.white, x0, x1, BOAT_Y, BOAT_Y + h, z0, z1);
      box(B.white, x0 - 0.12, x1 + 0.12, BOAT_Y + h - 0.02, BOAT_Y + h + 0.14, z0 - 0.12, z1 + 0.12);   // roof edge
      box(B.wood, x0 + 0.05, x1 - 0.05, BOAT_Y + h + 0.14, BOAT_Y + h + 0.17, z0 + 0.05, z1 - 0.05);    // planked roof
      if (kind === 'lounge') {  // raised roof of the first-class lounge with a clerestory
        box(B.white, x0 + 0.8, x1 - 0.8, BOAT_Y + h, BOAT_Y + h + 0.9, z0 + 1.6, z1 - 1.6);
        box(B.white, x0 + 0.65, x1 - 0.65, BOAT_Y + h + 0.9, BOAT_Y + h + 1.0, z0 + 1.45, z1 - 1.45);
      }
    }
    // standard compass platform between funnels 2 and 3
    vcyl(B.white, 5.2, BOAT_Y + 1.3, 0, 0.45, 2.4, 12);
    vcyl(B.white, 5.2, BOAT_Y + 3.7, 0, 1.5, 0.18, 20);
    vcyl(B.dark, 5.2, BOAT_Y + 3.88, 0, 0.28, 1.1, 12);
    vcyl(B.buff, 5.2, BOAT_Y + 4.98, 0, 0.36, 0.3, 12);
    // dome drums (the glazing itself is built with the windows)
    for (const d of DOMES) {
      const g = new THREE.CylinderGeometry(1, 1, 0.45, 32, 1, true);
      B.white.add(g, { m: MX(d.x, d.y + 0.22, 0, 0, 0, 0, d.rx + 0.25, 1, d.rz + 0.25) });
      const ring = new THREE.TorusGeometry(1, 0.06, 5, 40);
      B.dark.add(ring, { m: MX(d.x, d.y + 0.46, 0, Math.PI / 2, 0, 0, d.rx + 0.12, d.rz + 0.12, 1) });
    }
  }
  // railing along a polyline of deck points [[x, y, z], ...]: top rail, middle rail, stanchions
  const RAILSEG = [];   // top-rail segments (for rusticles on the wreck)
  function railLine(b, pts, h, sp) {
    h = h || 1.07; sp = sp || 1.6;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      if (L < 0.02) continue;
      beam(b, a[0], a[1] + h, a[2], c[0], c[1] + h, c[2], 0.075, 0.06);
      beam(b, a[0], a[1] + h * 0.52, a[2], c[0], c[1] + h * 0.52, c[2], 0.035, 0.035);
      RAILSEG.push([a[0], a[1] + h, a[2], c[0], c[1] + h, c[2]]);
      const n = Math.max(1, Math.round(L / sp));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const u = k / n, x = lerp(a[0], c[0], u), y = lerp(a[1], c[1], u), z = lerp(a[2], c[2], u);
        box(b, x - 0.028, x + 0.028, y, y + h, z - 0.028, z + 0.028);
      }
    }
  }
  // deck-edge railing path from x0 to x1 at y(x), z = side * (w(x))
  function edgePath(x0, x1, yF, wF, side, step) {
    return stations(x0, x1, step || 2.0).map((x) => [x, yF(x), side * wF(x)]);
  }
  function buildBridge() {
    const X0 = 61.0, X1 = 65.85, WY = BOAT_Y;
    const zin = HB(63, HULL_TOP) - 0.35;
    for (const s of [1, -1]) {
      box(B.wood, X0, 64.2, WY - 0.24, WY + 0.02, s > 0 ? zin : -15.0, s > 0 ? 15.0 : -zin);
      box(B.white, X0, 64.2, WY - 0.36, WY - 0.24, s > 0 ? zin : -15.0, s > 0 ? 15.0 : -zin);
      for (const x of [X0 + 0.3, 63.9]) beam(B.white, x, WY - 1.9, s * (zin - 0.1), x, WY - 0.3, s * 14.7, 0.14, 0.14);
      // wing cab at the end of the wing
      box(B.white, 64.2, X1, WY - 0.36, WY + 2.2, s > 0 ? 13.75 : -15.0, s > 0 ? 15.0 : -13.75);
      box(B.white, 64.1, X1 + 0.08, WY + 2.2, WY + 2.34, s > 0 ? 13.65 : -15.1, s > 0 ? 15.1 : -13.65);
      railLine(B.white, [[64.2, WY, s * 15.0], [X0, WY, s * 15.0], [X0, WY, s * zin]], 1.05, 1.2);
    }
    // the bridge front screen across the ship, teak capping
    box(B.white, X1 - 0.14, X1, WY, WY + 1.2, -13.75, 13.75);
    box(B.wood, X1 - 0.22, X1 + 0.05, WY + 1.2, WY + 1.28, -13.75, 13.75);
    // engine telegraphs and the docking telephone on the open bridge
    for (const z of [-2.4, 2.4, -7.5, 7.5]) {
      vcyl(B.buff, 64.9, WY, z, 0.13, 1.0, 8);
      B.buff.add(GEO.sph, { m: MX(64.9, WY + 1.12, z, 0, 0, 0, 0.27, 0.27, 0.13) });
    }
    // rocket launcher (a socket on the starboard wing rail)
    const RL = SH.ROCKET_LAUNCHER;
    rod(B.dark, RL.x, RL.y - 0.65, RL.z, RL.x + 0.12, RL.y + 0.2, RL.z + 0.18, 0.08, 8);
    // searchlight-less 1912 bridge: a pair of lamp brackets on the wheelhouse front
    for (const z of [-3.6, 3.6]) beam(B.dark, 64.0, WY + 2.2, z, 64.5, WY + 2.2, z, 0.06, 0.06);
  }

  // ---- reusable fittings ----
  let COWL = null;
  function cowlGeo() {
    if (COWL) return COWL;
    const r = 1, R = 1.35, h = 3.0;
    const pipe = new THREE.CylinderGeometry(r, r * 1.06, h, 14, 1, true).translate(0, h / 2, 0);
    const elbow = new THREE.TorusGeometry(R, r, 10, 12, Math.PI / 2).rotateZ(Math.PI / 2).translate(R, h, 0);
    const mouth = new THREE.CylinderGeometry(r * 1.85, r * 1.02, r * 1.3, 16, 1, true).rotateZ(-Math.PI / 2).translate(R + r * 0.65, h + R, 0);
    const lip = new THREE.TorusGeometry(r * 1.85, r * 0.08, 5, 16).rotateY(Math.PI / 2).translate(R + r * 1.3, h + R, 0);
    [pipe, elbow, mouth, lip].forEach((g) => { g.deleteAttribute('uv'); });
    COWL = { outer: ADDONS.BufferGeometryUtils.mergeGeometries([pipe.toNonIndexed(), elbow.toNonIndexed(), mouth.toNonIndexed(), lip.toNonIndexed()]),
      inner: new THREE.CircleGeometry(r * 1.8, 16).rotateY(Math.PI / 2).translate(R + r * 1.05, h + R, 0), R, h };
    return COWL;
  }
  // cowl ventilator: mouth facing yaw (0 = forward), pipe radius r, total height ~ (h + R + r) * r
  function cowl(x, y, z, yaw, r) {
    const c = cowlGeo();
    const m = MX(x, y, z, 0, yaw, 0, r, r, r);
    B.buff.add(c.outer, { m });
    B.dark.add(c.inner, { m });
  }
  function mushroom(x, y, z, r) {
    vcyl(B.white, x, y, z, r * 0.55, r * 1.4, 10);
    B.white.add(new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), { m: MX(x, y + r * 1.35, z, 0, 0, 0, 1, 0.55, 1) });
  }
  function bollard(x, y, z, alongX) {
    box(B.dark, x - (alongX ? 0.7 : 0.25), x + (alongX ? 0.7 : 0.25), y, y + 0.08, z - (alongX ? 0.25 : 0.7), z + (alongX ? 0.25 : 0.7));
    for (const d of [-0.42, 0.42]) {
      const px = alongX ? x + d : x, pz = alongX ? z : z + d;
      vcyl(B.dark, px, y, pz, 0.17, 0.62, 10);
      vcyl(B.dark, px, y + 0.6, pz, 0.22, 0.07, 10);
    }
  }
  function capstan(x, y, z) {
    vcyl(B.dark, x, y, z, 0.62, 0.12, 16);
    vcyl(B.dark, x, y + 0.12, z, 0.42, 0.68, 16, null, 0.5);
    vcyl(B.dark, x, y + 0.8, z, 0.62, 0.14, 16);
    vcyl(B.dark, x, y + 0.94, z, 0.3, 0.1, 12);
  }
  function hatch(x0, x1, zw, y) {
    box(B.dark, x0, x1, y, y + 0.85, -zw, zw);
    box(B.wood, x0 + 0.1, x1 - 0.1, y + 0.85, y + 0.95, -zw + 0.1, zw - 0.1);
    for (let x = x0 + 0.8; x < x1 - 0.4; x += 1.2) box(B.dark, x - 0.04, x + 0.04, y + 0.95, y + 1.0, -zw + 0.1, zw - 0.1);
  }
  // electric deck crane: pedestal, cab, lattice-ish jib raised toward `yaw`
  function crane(x, y, z, yaw) {
    vcyl(B.buff, x, y, z, 0.42, 2.6, 12, null, 0.34);
    const m = MX(x, y + 2.6, z, 0, yaw, 0);
    const cab = new THREE.BoxGeometry(1.7, 1.5, 1.4).translate(-0.2, 0.75, 0);
    B.buff.add(cab, { m });
    const roof = new THREE.BoxGeometry(1.85, 0.1, 1.55).translate(-0.2, 1.55, 0);
    B.buff.add(roof, { m });
    // jib: two booms and a head
    const a = new THREE.Vector3(0.6, 0.6, 0), c = new THREE.Vector3(7.2, 5.4, 0);
    for (const dz of [-0.28, 0.28]) {
      const p = a.clone().setZ(dz).applyMatrix4(m), q = c.clone().setZ(dz * 0.3).applyMatrix4(m);
      beam(B.buff, p.x, p.y, p.z, q.x, q.y, q.z, 0.14, 0.2);
    }
    const hd = c.clone().applyMatrix4(m);
    B.dark.add(GEO.sph, { m: MX(hd.x, hd.y, hd.z, 0, 0, 0, 0.25, 0.25, 0.25) });
    const back = new THREE.Vector3(-1.0, 1.6, 0).applyMatrix4(m);
    rig([back.x, back.y, back.z], [hd.x, hd.y, hd.z], 0);
    rig([hd.x, hd.y, hd.z], [hd.x, y + 1.2, hd.z], 0);
  }

  function buildDeckGear() {
    const FC = (x) => SHEER(x);
    // ---- forecastle: capstans, anchor crane, the centre anchor, bollards, hatch, vents, jackstaff
    capstan(119.5, FC(119.5), 3.1); capstan(119.5, FC(119.5), -3.1); capstan(112.5, FC(112.5), 0);
    for (const z of [3.1, -3.1]) { box(B.dark, 121.0, 126.5, FC(123), FC(123) + 0.3, z - 0.18, z + 0.18); }   // chain troughs to the hawse pipes
    // anchor crane: a stout post with its jib stowed fore-and-aft, the purchase block hanging
    const acY = FC(128.6);
    vcyl(B.dark, 128.6, acY, 0, 0.36, 3.3, 12, null, 0.28);
    vcyl(B.dark, 128.6, acY, 0, 0.6, 0.35, 14);
    beam(B.dark, 129.4, acY + 3.05, 0, 123.6, acY + 2.75, 0, 0.24, 0.36);
    beam(B.dark, 128.6, acY + 2.2, 0, 126.6, acY + 2.85, 0, 0.14, 0.14);
    box(B.dark, 123.45, 123.85, acY + 1.7, acY + 2.2, -0.15, 0.15);
    rig([123.65, acY + 2.7, 0], [123.65, acY + 2.2, 0], 0);
    // the 15.8-ton centre anchor lying on the forecastle
    box(B.dark, 124.6, 127.6, FC(126) + 0.05, FC(126) + 0.4, -0.22, 0.22);
    box(B.dark, 124.3, 125.0, FC(126) + 0.05, FC(126) + 0.5, -1.2, 1.2);
    for (const x of [100.5, 107, 114, 124.5]) for (const s of [1, -1]) bollard(x, FC(x), s * (HB(x, FC(x) - 0.1) - 0.9), true);
    hatch(102.5, 105.5, 1.9, FC(104));
    for (const s of [1, -1]) { cowl(99.2, FC(99.2), s * 5.2, 0, 0.32); mushroom(109.5, FC(109.5), s * 3.8, 0.35); }
    rod(B.dark, 133.55, 17.75, 0, 134.2, 23.2, 0, 0.07, 6);   // jackstaff
    // hawse pipes and the side anchors housed in them
    for (const s of [1, -1]) {
      const x = 125.6, y = 12.9, z = HB(x, y);
      B.dark.add(GEO.cyl20, { m: MX(x, y, s * (z - 0.1), Math.PI / 2, 0, -0.28 * s, 0.62, 0.5, 0.5) });
      box(B.dark, x - 1.0, x + 1.0, y - 3.2, y - 0.6, s > 0 ? z - 0.15 : -z - 0.2, s > 0 ? z + 0.2 : -z + 0.15);  // flukes
      box(B.dark, x - 0.25, x + 0.25, y - 1.2, y + 0.2, s > 0 ? z - 0.1 : -z - 0.25, s > 0 ? z + 0.25 : -z + 0.1); // shank
    }
    // ---- forward well deck: hatches, cranes, ladders
    hatch(90.5, 94.5, 2.3, WELL_Y); hatch(75.5, 80.5, 2.6, WELL_Y);
    crane(95.3, WELL_Y, 4.6, Math.PI - 0.12); crane(95.3, WELL_Y, -4.6, -Math.PI + 0.12);
    crane(69.0, WELL_Y, 4.6, -0.12); crane(69.0, WELL_Y, -4.6, 0.12);
    for (const s of [1, -1]) {
      ladder(96.95, WELL_Y, s * 8.5, SHEER(97), 1); ladder(66.05, WELL_Y, s * 9.5, HULL_TOP, -1);
      ladder(-80.05, WELL_Y, s * 9.5, HULL_TOP, 1); ladder(-103.95, WELL_Y, s * 8.5, SHEER(-104), -1);
      cowl(71.5, WELL_Y, s * 9.8, 0, 0.3); cowl(-100.5, WELL_Y, s * 9.4, Math.PI, 0.3);
    }
    // ---- aft well deck
    hatch(-88.5, -84.5, 2.4, WELL_Y); hatch(-100.5, -96.5, 2.4, WELL_Y);
    crane(-82.8, WELL_Y, 5.2, Math.PI - 0.12); crane(-82.8, WELL_Y, -5.2, -Math.PI + 0.12);
    crane(-102.2, WELL_Y, 4.4, -0.12); crane(-102.2, WELL_Y, -4.4, 0.12);
    // ---- poop: docking bridge, capstans, bollards, house, flagstaff, vents
    const PY = (x) => SHEER(x);
    for (const s of [1, -1]) { capstan(-121.5, PY(-121.5), s * 3.6); bollard(-116, PY(-116), s * (HB(-116, 15.5) - 0.9), true); bollard(-109, PY(-109), s * (HB(-109, 15.5) - 0.9), true); bollard(-129.5, PY(-129.5), s * (HB(-129.5, 16) - 1.1), false); }
    box(B.white, -114.5, -107.5, PY(-110), PY(-110) + 2.5, -3.2, 3.2);
    box(B.white, -114.62, -107.38, PY(-110) + 2.5, PY(-110) + 2.62, -3.32, 3.32);
    const DBX0 = -127.9, DBX1 = -126.1, DBY = PY(-127) + 3.2, DBW = HB(-127, 16.2) + 0.5;
    box(B.wood, DBX0, DBX1, DBY - 0.2, DBY, -DBW, DBW);
    box(B.white, DBX0 + 0.3, DBX1 - 0.3, DBY - 1.1, DBY - 0.2, -2.0, 2.0);
    for (const z of [-DBW + 0.4, -3, 3, DBW - 0.4]) for (const x of [DBX0 + 0.15, DBX1 - 0.15]) box(B.white, x - 0.08, x + 0.08, PY(x), DBY - 0.2, z - 0.08, z + 0.08);
    railLine(B.white, [[DBX1, DBY, -DBW], [DBX1, DBY, DBW]], 1.0, 1.2);
    railLine(B.white, [[DBX0, DBY, -DBW], [DBX0, DBY, DBW]], 1.0, 1.2);
    for (const z of [-1.2, 1.2]) { vcyl(B.buff, -126.9, DBY, z, 0.12, 1.0, 8); B.buff.add(GEO.sph, { m: MX(-126.9, DBY + 1.1, z, 0, 0, 0, 0.25, 0.25, 0.12) }); }
    rod(B.dark, SH.STERN_X + 1.3, 16.6, 0, SH.STERN_X - 0.4, 24.5, 0, 0.08, 6);   // ensign staff
    for (const s of [1, -1]) cowl(-106.5, PY(-106.5), s * 6.0, Math.PI, 0.34);
    // ---- after B deck: vents and bollards around the second-class house
    for (const s of [1, -1]) { cowl(-78.5, HULL_TOP, s * 11.2, Math.PI, 0.32); mushroom(-66, HULL_TOP + 3.35, s * 5, 0.35); }
    // ---- boat deck: big boiler-room cowls around the funnel casings, mushroom vents
    const casings = HOUSES.filter((h) => h[5] === 'casing');
    for (const [x0, x1, z0, z1] of casings) {
      for (const s of [1, -1]) {
        cowl(x1 + 1.0, BOAT_Y, s * (z1 + 0.2), 0, 0.5);
        cowl(x0 - 1.1, BOAT_Y, s * (z1 - 0.8), Math.PI, 0.46);
        mushroom((x0 + x1) / 2, BOAT_Y + 2.8, s * (z1 - 1.2), 0.42);
      }
    }
    for (const s of [1, -1]) { cowl(-60.0, BOAT_Y, s * 7.6, Math.PI, 0.4); cowl(9.2, BOAT_Y, s * 6.2, 0, 0.42); cowl(-1.2, BOAT_Y, s * 6.2, Math.PI, 0.42); }
    // benches along the deckhouse walls (dark teak)
    for (const [x0, x1, z0, z1, h, kind] of HOUSES) {
      if (kind === 'skylight' || kind === 'domebase' || kind === 'wheel' || x1 - x0 < 5) continue;
      for (const s of [1, -1]) { const zz = s > 0 ? z1 + 0.35 : z0 - 0.35; if (kind === 'gym' && s < 0) continue; box(B.wood, x0 + 1.2, x1 - 1.2, BOAT_Y + 0.42, BOAT_Y + 0.48, zz - 0.22, zz + 0.22); }
      void h;
    }
  }
  // steep ladder from a lower deck up to y1 at a transverse face (dir +1 = climbs toward +x)
  function ladder(x, y0, z, y1, dir) {
    const run = (y1 - y0) * 0.55;
    const xa = x - dir * run, xb = x;
    for (const dz of [-0.45, 0.45]) beam(B.dark, xa, y0, z + dz, xb, y1, z + dz, 0.06, 0.2);
    const n = Math.round((y1 - y0) / 0.25);
    for (let k = 1; k < n; k++) { const u = k / n; box(B.dark, lerp(xa, xb, u) - 0.1, lerp(xa, xb, u) + 0.1, lerp(y0, y1, u) - 0.02, lerp(y0, y1, u) + 0.02, z - 0.45, z + 0.45); }
  }

  function buildRails() {
    const edge = (y) => (x) => HB(x, y) - 0.14;
    const FC = (x) => SHEER(x);
    for (const s of [1, -1]) {
      // forecastle, meeting at the stem
      const fc = edgePath(SH.FORECASTLE_X[0] + 0.2, SH.STEM_X - 0.3, FC, (x) => HB(x, FC(x) - 0.05) - 0.14, s, 1.6);
      fc.push([SH.STEM_X - 0.35, FC(SH.STEM_X), 0]);
      railLine(B.white, fc, 1.07, 1.5);
      // boat deck edges (the davits stand at the edge)
      railLine(B.white, edgePath(SH.SUPERSTRUCTURE_X[0] + 0.2, 60.9, () => BOAT_Y, edge(HULL_TOP), s, 2.4), 1.05, 1.6);
      // after B deck
      railLine(B.white, edgePath(SH.AFT_WELL_X[1] + 0.1, SH.SUPERSTRUCTURE_X[0], () => HULL_TOP, edge(HULL_TOP), s, 2.0), 1.07, 1.5);
      // poop, meeting at the stern
      const pp = edgePath(SH.STERN_X + 0.35, SH.POOP_X[1] - 0.2, FC, (x) => HB(x, FC(x) - 0.05) - 0.14, s, 1.2);
      pp.unshift([SH.STERN_X + 0.3, FC(SH.STERN_X), 0]);
      railLine(B.white, pp, 1.07, 1.5);
      // A-deck house roof on the after B deck
      railLine(B.white, [[-76.9, HULL_TOP + 3.35, s * 9.5], [SH.SUPERSTRUCTURE_X[0], HULL_TOP + 3.35, s * 9.5]], 0.9, 2.0);
    }
    // transverse rails looking down into the well decks
    const tw = (x, y) => HB(x, y) - 0.2;
    railLine(B.white, [[SH.FORECASTLE_X[0] + 0.12, FC(97), -tw(97, 16)], [SH.FORECASTLE_X[0] + 0.12, FC(97), tw(97, 16)]], 1.07, 1.5);
    railLine(B.white, [[SH.POOP_X[1] - 0.12, FC(-104), -tw(-104, 15.5)], [SH.POOP_X[1] - 0.12, FC(-104), tw(-104, 15.5)]], 1.07, 1.5);
    railLine(B.white, [[SH.AFT_WELL_X[1] + 0.12, HULL_TOP, -tw(-80, 14.5)], [SH.AFT_WELL_X[1] + 0.12, HULL_TOP, tw(-80, 14.5)]], 1.07, 1.5);
    railLine(B.white, [[SH.SUPERSTRUCTURE_X[0] + 0.12, BOAT_Y, -tw(-62, 15)], [SH.SUPERSTRUCTURE_X[0] + 0.12, BOAT_Y, tw(-62, 15)]], 1.05, 1.6);
  }
  // ---- window atlas cells ----
  const CELL = { PORT_B: 0, RECT_B: 1, PROM: 2, HOUSE: 3, OPEN: 4, PANE: 5, LAMP: 6, FULL: 7, PORT_W: 8, DOOR: 9, BRIDGE: 10, ARCH: 11, PORT_BC: 12, RECT_BC: 13 };
  function cellRect(c) { const col = c % 4, row = Math.floor(c / 4), e = 3 / 512; return [col / 4 + e, 1 - (row + 1) / 4 + e, (col + 1) / 4 - e, 1 - row / 4 - e]; }
  let WR = Math.random;
  // warm ~2700 K light of intensity k with a little per-window colour-temperature scatter
  function warm(k) { const t = WR(); k *= WIN_HDR; return [k, k * (0.4 + 0.13 * t), k * (0.08 + 0.07 * t)]; }
  // a cabin: dark (curtains drawn / nobody in), dim, or lit
  function cabin(k, pDark) { const r = WR(); if (r < (pDark == null ? 0.2 : pDark)) return [0, 0, 0]; return warm(r < 0.35 ? k * 0.45 : k * (0.75 + 0.5 * WR())); }
  // window quad centred at c on a surface with outward unit normal n, size w x h
  function win(c, n, w, h, cell, emis, seed) {
    let tx = n[2], tz = -n[0], tl = Math.hypot(tx, tz);
    if (tl < 1e-4) { tx = 1; tz = 0; tl = 1; }
    tx /= tl; tz /= tl;
    const T = [tx, 0, tz];
    const Bv = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]];
    const o = 0.035;
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [0, 1, 2].map((k) => c[k] + n[k] * o + T[k] * a * w / 2 + Bv[k] * b * h / 2));
    B.win.pushQuad(P, n, cellRect(cell), { aEmis: emis, aSeed: seed == null ? WR() : seed });
  }
  function hullN(x, y, side) {
    const e = 0.08;
    const fx = (HB(x + e, y) - HB(x - e, y)) / (2 * e), fy = (HB(x, y + e) - HB(x, y - e)) / (2 * e);
    const l = Math.hypot(fx, fy, 1);
    return [-fx / l, -fy / l, side / l];
  }
  function planN(x, zF, side) { const e = 0.1, d = (zF(x + e) - zF(x - e)) / (2 * e), l = Math.hypot(d, 1); return [-d / l, 0, side / l]; }
  // small emissive globe (lamps, navigation lights)
  let GLOBE = null;
  function globe(x, y, z, r, emis, cell) {
    if (!GLOBE) GLOBE = {};
    const c = cell == null ? CELL.LAMP : cell;
    if (!GLOBE[c]) {
      const g = new THREE.OctahedronGeometry(1, 1), rc = cellRect(c), n = g.attributes.position.count, uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = (rc[0] + rc[2]) / 2; uv[i * 2 + 1] = (rc[1] + rc[3]) / 2; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      GLOBE[c] = g;
    }
    B.win.add(GLOBE[c], { m: MX(x, y, z, 0, 0, 0, r, r, r), keepUV: true, ex: { aEmis: emis, aSeed: 0.02 } });
  }
  const LAMP = (k) => [k, k * 0.72, k * 0.42];

  function buildWindows() {
    WR = U.rng('titanic-windows');
    const VR = U.rng('titanic-window-curtains');   // separate stream: the lit pattern stays as it was
    // ---- the hull: rows of portholes (C, D, E, F decks, forecastle and poop)
    const rows = [
      { y: 14.0, x0: 98.5, x1: 123.0, skip: 0.12, k: 3.0 },
      { y: 13.5, x0: -133.6, x1: -105.5, skip: 0.12, k: 3.0 },
      { y: 10.3, x0: -133.6, x1: 127.0, skip: 0.08, k: 3.2 },
      { y: 7.5, x0: -132.0, x1: 126.0, skip: 0.1, k: 3.2 },
      { y: 4.7, x0: -129.0, x1: 124.0, skip: 0.22, k: 3.0, mid: 0.45 },
      { y: 1.9, x0: -124.0, x1: 120.0, skip: 0.45, k: 2.8, mid: 0.93 },
    ];
    for (const side of [1, -1]) {
      for (const r of rows) {
        let x = r.x0 + WR() * 0.8;
        while (x < r.x1) {
          const inWell = (x > SH.FWD_WELL_X[0] - 1 && x < SH.FWD_WELL_X[1] + 1) || (x > SH.AFT_WELL_X[0] - 1 && x < SH.AFT_WELL_X[1] + 1);
          const ok = HB(x, r.y) > 1.3 && r.y < SHEER(x) - 0.9 && !(x > 121.5 && r.y > 9) && (!inWell || r.y < WELL_Y - 0.7);
          const midSkip = r.mid && x > -48 && x < 52 ? r.mid : 0;
          if (ok && WR() > Math.max(r.skip, midSkip)) {
            const saloon = r.y === 7.5 && x > 2 && x < 36;   // the first-class dining saloon on D deck
            const n = hullN(x, r.y, side);
            win([x, r.y, side * HB(x, r.y)], n, 0.56, 0.56, !saloon && VR() < 0.3 ? CELL.PORT_BC : CELL.PORT_B, saloon ? warm(5.2) : cabin(r.k));
            if (saloon && WR() < 0.8) { const x2 = x + 0.62; win([x2, r.y, side * HB(x2, r.y)], hullN(x2, r.y, side), 0.56, 0.56, CELL.PORT_B, warm(5.2)); x += 0.62; }
          }
          x += WR() < 0.58 ? 0.95 : 1.6 + WR() * 1.3;
        }
      }
      // ---- B deck: the grouped windows of the suites, the restaurant, the second-class promenade
      let x = -43;
      while (x < 61) {
        const n = 2 + Math.floor(WR() * 3), k = 3.4;
        for (let i = 0; i < n && x < 61; i++, x += 1.35) win([x, 13.1, side * HB(x, 13.1)], hullN(x, 13.1, side), 0.9, 1.05, VR() < 0.35 ? CELL.RECT_BC : CELL.RECT_B, cabin(k, 0.15));
        x += 1.6 + WR() * 2.2;
      }
      for (let xr = -61; xr < -44.5; xr += 1.5) win([xr, 13.1, side * HB(xr, 13.1)], hullN(xr, 13.1, side), 1.0, 1.1, CELL.RECT_B, warm(4.6));   // a la carte restaurant
      for (let xr = -78.5; xr < -62.5; xr += 1.9) win([xr, 13.2, side * HB(xr, 13.2)], hullN(xr, 13.2, side), 1.25, 1.05, CELL.RECT_B, cabin(3.0, 0.1));
      // ---- A deck: enclosed promenade forward, open aft, verandah cafes at the after end
      const wA = (xx) => HB(xx, HULL_TOP);
      for (let xa = 64.2; xa > 8.5; xa -= 2.05) win([xa, 16.95, side * wA(xa)], planN(xa, wA, side), 1.55, 1.32, CELL.PROM, warm(WR() < 0.15 ? 0.6 : 1.2 + WR() * 0.9));
      for (let xa = 6.6; xa > -57.5; xa -= 3.25) win([xa, 17.3, side * wA(xa)], planN(xa, wA, side), 2.85, 2.7, CELL.OPEN, warm(1.4 + WR() * 0.5));
      for (const xa of [-59.2, -61.0]) win([xa, 17.0, side * wA(xa)], planN(xa, wA, side), 1.4, 1.9, CELL.ARCH, warm(3.4));
      // ---- after B-deck house
      for (let xh = -76.0; xh < -63; xh += 1.8) win([xh, 16.6, side * 9.6], [0, 0, side], 0.9, 1.0, CELL.HOUSE, cabin(3.0, 0.1));
      // ---- boat-deck houses
      for (const [x0, x1, z0, z1, h, kind] of HOUSES) {
        const zs = side > 0 ? z1 : z0, n = [0, 0, side], wy = BOAT_Y + 1.6;
        if (kind === 'gym' && side < 0) continue;
        if (kind === 'officers' || kind === 'second') {
          for (let xh = x0 + 1.2; xh < x1 - 0.8; xh += 2.0) win([xh, wy, zs], n, 0.75, 0.85, CELL.HOUSE, cabin(2.8, 0.25));
        } else if (kind === 'entrance') {
          win([(x0 + x1) / 2, BOAT_Y + 1.1, zs], n, 1.2, 2.2, CELL.DOOR, warm(2.5));
          for (const xh of [x0 + 1.6, x0 + 3.4, x1 - 3.4, x1 - 1.6]) win([xh, wy, zs], n, 0.9, 1.0, CELL.HOUSE, warm(3.2));
        } else if (kind === 'gym') {
          for (let xh = x0 + 1.0; xh < x1 - 0.6; xh += 1.7) win([xh, BOAT_Y + 1.75, zs], n, 1.3, 1.55, CELL.HOUSE, warm(3.6));
        } else if (kind === 'lounge') {
          for (let xh = x0 + 1.0; xh < x1 - 0.5; xh += 1.25) win([xh, BOAT_Y + h + 0.45, side * (z1 - 1.6)], n, 0.7, 0.7, CELL.ARCH, warm(3.6));
          for (let xh = x0 + 1.0; xh < x1 - 0.6; xh += 1.6) win([xh, BOAT_Y + 1.8, zs], n, 1.0, 1.6, CELL.ARCH, warm(3.0));
        } else if (kind === 'casing') {
          win([x0 + 1.6, BOAT_Y + 1.05, zs], n, 0.9, 2.0, CELL.DOOR, warm(0.8));
        } else if (kind === 'wheel') {
          win([(x0 + x1) / 2, wy, zs], n, 0.8, 0.9, CELL.BRIDGE, warm(0.3));
        }
        // deck lamps on the house walls
        if (kind !== 'skylight' && kind !== 'domebase' && x1 - x0 > 5) for (let xl = x0 + 2.5; xl < x1 - 1; xl += 6.5) globe(xl, BOAT_Y + 2.35, zs + side * 0.12, 0.12, LAMP(14));
      }
      // bridge-wing lamps, poop and well-deck lamps
      globe(62.0, BOAT_Y + 2.0, side * 13.6, 0.1, LAMP(10));
      for (const xl of [-110, -120]) globe(xl, SHEER(xl) + 2.2, side * 3.3, 0.12, LAMP(12));
      for (const [xl, yl] of [[96.9, WELL_Y + 2.6], [66.1, WELL_Y + 2.4], [-80.1, WELL_Y + 2.4], [-103.9, WELL_Y + 2.5]]) globe(xl, yl, side * 6.0, 0.12, LAMP(12));
      // ---- skylights
      const sk = HOUSES.find((hh) => hh[5] === 'skylight');
      for (let xs = sk[0] + 0.6; xs < sk[1] - 0.6; xs += 1.45) {
        const y0 = BOAT_Y + sk[4], z0 = side * 4.0, y1 = y0 + 0.9, z1 = side * 0.25, len = 1.35;
        const nn = [0, 3.75, side * 0.9], l = Math.hypot(nn[1], nn[2]); nn[1] /= l; nn[2] /= l;
        const P = side > 0 ? [[xs, y0, z0], [xs + len, y0, z0], [xs + len, y1, z1], [xs, y1, z1]] : [[xs + len, y0, z0], [xs, y0, z0], [xs, y1, z1], [xs + len, y1, z1]];
        B.win.pushQuad(P, nn, cellRect(CELL.PANE), { aEmis: warm(1.3), aSeed: WR() });
      }
    }
    // ---- transverse faces: superstructure front & after end, well-deck bulkheads
    const fx = SH.FWD_WELL_X[0];
    for (let z = -12.2; z <= 12.3; z += 2.2) if (Math.abs(z) > 1.0) win([fx, 16.95, z], [1, 0, 0], 1.5, 1.3, CELL.PROM, warm(2.0 + WR()));
    for (const z of [-11.5, -9, -6.5, -1.5, 1.5, 6.5, 9, 11.5]) win([fx, 13.8, z], [1, 0, 0], 0.8, 0.9, CELL.HOUSE, cabin(2.6, 0.2));
    for (const z of [-3.8, 3.8]) win([fx, WELL_Y + 1.1, z], [1, 0, 0], 1.1, 2.1, CELL.DOOR, warm(0.9));
    for (const z of [-12, -9.5, -7, -4.5, -2, 2, 4.5, 7, 9.5, 12]) win([SH.SUPERSTRUCTURE_X[0], 17.0, z], [-1, 0, 0], 1.3, 1.9, CELL.ARCH, warm(3.2));
    for (const z of [-8.5, -6, -3.5, -1.2, 1.2, 3.5, 6, 8.5]) win([-77.0, 16.8, z], [-1, 0, 0], 1.2, 1.8, CELL.ARCH, warm(3.3));
    for (const z of [-9.5, -7, -4.5, -2, 2, 4.5, 7, 9.5]) win([SH.AFT_WELL_X[1], 13.6, z], [-1, 0, 0], 0.8, 0.9, CELL.HOUSE, cabin(2.6, 0.2));
    for (const z of [-7.5, -5, -2, 2, 5, 7.5]) { win([SH.FORECASTLE_X[0], 14.3, z], [-1, 0, 0], 0.5, 0.5, CELL.PORT_W, cabin(2.4, 0.3)); win([SH.POOP_X[1], 14.0, z], [1, 0, 0], 0.5, 0.5, CELL.PORT_W, cabin(2.4, 0.3)); }
    for (const z of [-3.6, 3.6]) { win([SH.FORECASTLE_X[0], WELL_Y + 1.05, z], [-1, 0, 0], 1.0, 2.0, CELL.DOOR, warm(0.6)); win([SH.POOP_X[1], WELL_Y + 1.05, z], [1, 0, 0], 1.0, 2.0, CELL.DOOR, warm(0.6)); }
    // bridge-wing cabs: windows on three sides, dark but for the telegraph lamps
    for (const s of [1, -1]) {
      win([65.87, BOAT_Y + 1.5, s * 14.4], [1, 0, 0], 0.9, 0.8, CELL.BRIDGE, warm(0.35));
      win([64.18, BOAT_Y + 1.5, s * 14.4], [-1, 0, 0], 0.9, 0.8, CELL.BRIDGE, warm(0.35));
    }
    // wheelhouse front: dark bridge (night vision), the faint glow of the binnacle
    for (const z of [-2.8, -1.4, 0, 1.4, 2.8]) win([64.0, BOAT_Y + 1.65, z], [1, 0, 0], 1.0, 1.0, CELL.BRIDGE, warm(0.22));
    for (const z of [-5.8, 5.8]) win([60.0, BOAT_Y + 1.6, z], [1, 0, 0], 0.75, 0.85, CELL.HOUSE, warm(1.8));
    // lounge roof skylight
    for (let xs = -18.4; xs < -14.5; xs += 1.4) for (const zs of [-2.4, -0.8, 0.8, 2.4]) win([xs + 0.7, BOAT_Y + 3.5 + 1.0, zs], [0, 1, 0], 1.3, 1.5, CELL.PANE, warm(2.0));
    // ---- the glass domes over the grand staircases
    for (const d of DOMES) {
      const NT = 20, NP = 4, y0 = d.y + 0.47;
      const P = (i, j) => { const th = (i / NT) * Math.PI * 2, ph = (j / NP) * Math.PI / 2; return [d.x + d.rx * Math.cos(th) * Math.cos(ph), y0 + d.h * Math.sin(ph), d.rz * Math.sin(th) * Math.cos(ph)]; };
      for (let j = 0; j < NP; j++) for (let i = 0; i < NT; i++) {
        const a = P(i, j), b2 = P(i + 1, j), c = P(i + 1, j + 1), e = P(i, j + 1);
        const th = ((i + 0.5) / NT) * Math.PI * 2, ph = ((j + 0.5) / NP) * Math.PI / 2;
        const nn = [Math.cos(th) * Math.cos(ph) / d.rx, Math.sin(ph) / d.h, Math.sin(th) * Math.cos(ph) / d.rz], l = Math.hypot(...nn);
        // CCW from outside: th increases toward +z, so order a, e, c, b2
        B.win.pushQuad([a, e, c, b2], nn.map((v) => v / l), cellRect(CELL.PANE), { aEmis: warm(d.x > 0 ? 4.8 : 4.0), aSeed: 0.05 + WR() * 0.1 });
      }
    }
    // ---- navigation lights: masthead (white), sidelights (green starboard, red port), stern light
    for (const s of [1, -1]) {
      box(B.dark, 64.6, 65.5, BOAT_Y + 1.05, BOAT_Y + 1.75, s > 0 ? 15.0 : -15.35, s > 0 ? 15.35 : -15.0);
      globe(65.25, BOAT_Y + 1.4, s * 15.42, 0.17, s > 0 ? [1.0, 22, 6] : [24, 0.9, 0.5], CELL.FULL);
    }
    globe(SH.STERN_X + 0.05, 17.9, 0, 0.17, [20, 19, 17], CELL.FULL);
  }
  // The torn faces at the break: internal decks and a bulkhead set back inside each section
  // (cut ragged by the shared discard), exposed frames and plating teeth (not cut).
  function buildBreakFaces() {
    const R = U.rng('titanic-break'), K = SH.KEEL_Y;
    const decks = [-7.6, -4.8, -2.0, 0.8, 3.6, 6.4, 9.2, WELL_Y, HULL_TOP];
    for (let s = 0; s < 2; s++) {
      const dir = s === 0 ? 1 : -1;
      // internal decks, with a sagging lip where they were torn
      for (const y of decks) {
        const g = gridGeo(6, 6, (u, v) => {
          const x = BX + dir * u * 9.0, w = Math.max(0.2, HB(x, y) - 0.08), z = (v * 2 - 1) * w;
          const sag = (1 - u) * (1 - u) * (0.6 + 0.4 * Math.sin(z * 1.3 + y)) * 0.9;
          return [x, y - sag, z];
        });
        if (dir > 0) g.index.array.reverse();
        g.computeVertexNormals();
        B.brk.add(g, { sec: s });
      }
      // transverse bulkhead closing the section
      const xb = BX + dir * 9.2;
      const gb = gridGeo(8, 12, (u, v) => {
        const y = lerp(K + 0.1, BOAT_Y - 0.05, v), w = y > HULL_TOP ? HB(xb, HULL_TOP) - 0.05 : Math.max(0.05, HB(xb, y) - 0.05);
        return [xb, y, (u * 2 - 1) * w];
      });
      if (dir < 0) gb.index.array.reverse();
      gb.computeVertexNormals();
      B.brk.add(gb, { sec: s });
      // longitudinal cabin partitions between the decks
      for (let i = 0; i < decks.length - 1; i++) for (const z of [-7.5, -3, 3, 7.5]) {
        if (R() < 0.35) continue;
        const y0 = decks[i], y1 = decks[i + 1];
        if (Math.abs(z) > HB(BX, y0) - 0.8) continue;
        box(B.brk, s === 0 ? BX : BX - 8.5, s === 0 ? BX + 8.5 : BX, y0, y1, z - 0.04, z + 0.04, { sec: s });
      }
      // exposed frames following the hull girth, the first ones bent open
      for (let k = 1; k <= 7; k++) {
        const x = BX + dir * (0.45 + k * 0.9), bend = Math.max(0, 1 - k / 4);
        for (const side of [1, -1]) {
          let prev = null;
          for (let j = 0; j <= 14; j++) {
            const y = lerp(K + 0.3, BOAT_Y - 0.1, j / 14);
            const u = j / 14, z0 = y > HULL_TOP ? HB(x, HULL_TOP) - 0.18 : Math.max(0.3, HB(x, y) - 0.18);
            const p = [x - dir * bend * 1.6 * u * u * (0.5 + R()), y, side * (z0 + bend * 0.9 * u * u * (0.4 + R()))];
            if (prev) beam(B.teeth, prev[0], prev[1], prev[2], p[0], p[1], p[2], 0.12, 0.26, { sec: s });
            prev = p;
          }
        }
      }
      // torn plating teeth hanging off the hull and the decks
      for (let i = 0; i < 44; i++) {
        const side = R() < 0.5 ? 1 : -1, y = lerp(K + 1, BOAT_Y - 0.4, Math.pow(R(), 0.7));
        const h = clamp((y - K) / 34, 0, 1), amp = lerp(0.8, 8.5, Math.pow(h, 1.6));
        const xr = BX + dir * (0.3 + amp * (0.3 + 0.4 * R()));
        const zs = y > HULL_TOP ? HB(xr, HULL_TOP) : HB(xr, y);
        const L = 1.5 + R() * 3.5 * (0.5 + h), W = 0.7 + R() * 1.8, curl = (0.4 + R() * 1.4) * (R() < 0.3 ? -0.5 : 1), droop = (R() - 0.35) * 2.2;
        // a strip of torn plate peeled outward from the hull, in four bent segments
        let pa = [xr, y - W / 2, side * zs], pb = [xr, y + W / 2, side * zs];
        for (let k = 1; k <= 4; k++) {
          const u = k / 4, taper = 1 - 0.8 * u;
          const cx = xr - dir * L * u, cy = y + droop * u * u, cz = side * (zs + curl * u * u);
          const qa = [cx, cy - W / 2 * taper, cz], qb = [cx + dir * 0.2 * u, cy + W / 2 * taper, cz + side * 0.15 * u];
          B.teeth.pushQuad([pa, qa, qb, pb], [0, 0, side], [0, 0, 1, 1], {}, s);
          pa = qa; pb = qb;
        }
      }
      // splintered deck planking and beams jutting out of the torn decks
      for (const y of decks.concat([BOAT_Y])) for (let k = 0; k < 5; k++) {
        const z = (R() * 2 - 1) * (HB(BX, Math.min(y, HULL_TOP)) - 1.2), h = clamp((y - K) / 34, 0, 1);
        const x0 = BX + dir * (0.4 + lerp(0.8, 8.5, Math.pow(h, 1.6)) * (0.35 + 0.4 * R())), L = 1 + R() * 2.5;
        beam(B.teeth, x0, y - 0.1, z, x0 - dir * L, y - 0.1 - R() * 1.2, z + (R() - 0.5) * 1.5, 0.18, 0.3, { sec: s });
      }
    }
    // welded davit pedestals on the boat deck (static; the arms are instanced)
    for (const slot of SH.BOAT_SLOTS) for (const e of [-3.2, 3.2]) {
      const x = slot.local.x + e, z = slot.side * DAVIT_Z;
      box(B.white, x - 0.3, x + 0.3, BOAT_Y, BOAT_Y + 0.55, z - 0.35, z + 0.35);
    }
  }
  const DAVIT_Z = 13.3, DAVIT_Y = BOAT_Y + 0.3;

  // Gilt names: "TITANIC" on each bow, "TITANIC / LIVERPOOL" on the counter
  function buildNames() {
    const bb = new Batch(null), sb = new Batch(null);
    const xc = 121.5, yc = 15.35, W = 3.6, H = 0.9;
    for (const side of [1, -1]) {
      const g = gridGeo(16, 2, (u, v) => {
        const x = side > 0 ? xc - W / 2 + u * W : xc + W / 2 - u * W, y = yc - H / 2 + v * H;
        return [x, y, side * (HB(x, y) + 0.025)];
      });
      bb.add(g, { keepUV: true, sec: 0 });
    }
    const W2 = 6.2, H2 = 2.33, ys = 12.3;
    const sternX = (y, z) => {   // solve HB(x, y) = |z| on the counter
      let lo = ENDS(y).aft, hi = -60;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (HB(m, y) < Math.abs(z)) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const gs = gridGeo(24, 4, (u, v) => {
      const z = (u - 0.5) * W2, y = ys - H2 / 2 + v * H2, x = sternX(y, z);
      const n = hullN(x, y, z >= 0 ? 1 : -1);
      return [x + n[0] * 0.03, y + n[1] * 0.03, z + n[2] * 0.03];
    });
    sb.add(gs, { keepUV: true, sec: 1 });
    const mb = new THREE.Mesh(bb.geometry(0), ST.mats.nameBow), ms = new THREE.Mesh(sb.geometry(1), ST.mats.nameStern);
    mb.name = 'name bow'; ms.name = 'name stern';
    ST.secs[0].add(mb); ST.secs[1].add(ms);
  }

  // objects with their own transforms
  // ---------------- funnels ----------------
  const SHEAR = new THREE.Matrix4().set(1, -TAN_RAKE, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const funnelBase = (i) => V3(SH.FUNNEL_X[i] + F_BASE_DX, SH.FUNNEL_BASE_Y, 0);
  // fall directions (ship-local, horizontal): funnel 1 forward & to starboard (history), the others as they went
  const FALL = [
    { d: V3(0.55, 0, 0.83), max: 86 * DEG, t1: TT.story.EV.funnel1Splash, slide: 1.8 },
    { d: V3(0.85, 0, -0.5), max: 80 * DEG, t1: 204.7, slide: 2.5 },
    { d: V3(0.8, 0, 0.55), max: 84 * DEG, t1: 203.5, slide: 2.5 },
    { d: V3(0.62, 0, -0.78), max: 92 * DEG, t1: 205.6, slide: 3.0 },
  ].map((f) => { f.d.normalize(); f.axis = V3(f.d.z, 0, -f.d.x).normalize(); return f; });

  function buildFunnelsStatic() {
    for (let i = 0; i < 4; i++) {
      const b = funnelBase(i);
      // the open uptake left on the casing roof once a funnel has gone
      const disc = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
      B.dark.add(disc, { m: MX(b.x, TOP_Y + 0.17, 0, 0, 0, 0, SH.FUNNEL_RX * 0.97, 1, SH.FUNNEL_RZ * 0.97) });
      // guy wires: three a side from a band two-thirds up to the deck edge
      for (const s of [1, -1]) for (const [th, dx] of [[60, 6.0], [90, 0], [120, -6.0]]) {
        const a = th * DEG, yl = 13.2;
        const px = SH.FUNNEL_RX * Math.cos(a) - yl * TAN_RAKE, pz = s * SH.FUNNEL_RZ * Math.sin(a);
        const xd = b.x + dx, zd = s * (HB(xd, HULL_TOP) - 0.5);
        rig([b.x + px, b.y + yl, pz], [xd, BOAT_Y + 0.25, zd], i + 1);
      }
    }
  }
  function buildFunnels() {
    const RX = SH.FUNNEL_RX, RZ = SH.FUNNEL_RZ, H = F_H, NB = H - 4.5, NS = 48;
    const C_BUFF = new THREE.Color(0xc8923f), C_BLACK = new THREE.Color(0x0c0c0d), C_BRASS = new THREE.Color(0x8c6a2c), C_IN = new THREE.Color(0x050505);
    const col = (c) => [c.r, c.g, c.b];
    const perim = Math.PI * (3 * (RX + RZ) - Math.sqrt((3 * RX + RZ) * (RX + 3 * RZ)));
    for (let i = 0; i < 4; i++) {
      const b = new Batch({ color: 3 }, 1 / 6);
      const tube = (y0, y1, k, c, inward, rows) => {
        const g = gridGeo(NS, rows || 2, (u, v) => { const th = u * Math.PI * 2, y = lerp(y0, y1, v); return [RX * k * Math.cos(th) - y * TAN_RAKE, y, RZ * k * Math.sin(th)]; },
          (u, v) => [u * perim / 6, lerp(y0, y1, v) / 6]);
        if (!inward) { g.index.array.reverse(); g.computeVertexNormals(); }
        b.add(g, { keepUV: true, ex: { color: typeof c === 'function' ? c : col(c) } });
      };
      // buff, weathering darker toward the black band (soot), a little grime at the foot
      const sootBuff = (x, y) => { const k = 1 - 0.28 * sstep(NB - 5.5, NB, y) - 0.1 * (1 - sstep(-0.8, 1.5, y)); return [C_BUFF.r * k, C_BUFF.g * k, C_BUFF.b * k * 0.96]; };
      tube(-0.8, NB, 1, sootBuff, false, 10);
      tube(NB, H, 1, C_BLACK);
      tube(H - 2.6, H, 0.965, C_IN, true);
      tube(-0.1, 0.35, 1.035, C_BUFF);                       // base flange
      // hoops and the rolled rim
      for (const [y, k, r, c] of [[5.2, 1.0, 0.05, C_BUFF], [10.4, 1.0, 0.05, C_BUFF], [NB - 0.02, 1.0, 0.06, C_BLACK], [H, 0.985, 0.11, C_BLACK]]) {
        const g = new THREE.TorusGeometry(1, r / RX, 6, NS).rotateX(Math.PI / 2);
        const m = SHEAR.clone().multiply(MX(0, y, 0, 0, 0, 0, RX * k, RX, RZ * k));
        b.add(g, { m, ex: { color: col(c) } });
      }
      // the soot floor inside the top and the annular lip
      b.add(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), { m: SHEAR.clone().multiply(MX(0, H - 2.6, 0, 0, 0, 0, RX * 0.965, 1, RZ * 0.965)), ex: { color: col(C_IN) } });
      // steam escape pipes and whistles on the forward face (funnels 1-3)
      if (i < 3) {
        for (const [dz, r] of [[0.42, 0.27], [-0.42, 0.17]]) {
          const x = RX + 0.52;
          for (const [y0, y1, c] of [[0, NB, C_BUFF], [NB, H + 1.6, C_BLACK]]) {
            const g = new THREE.CylinderGeometry(r, r, y1 - y0, 12, 1, false);
            b.add(g, { m: SHEAR.clone().multiply(MX(x, (y0 + y1) / 2, dz)), ex: { color: col(c) } });
          }
          for (const yb of [2.5, 8, 13.5]) b.add(GEO.box, { m: SHEAR.clone().multiply(MX(x - 0.3, yb, dz, 0, 0, 0, 0.6, 0.12, 0.12)), ex: { color: col(C_BUFF) } });
        }
        for (const [dy, r, h] of [[0, 0.26, 1.4], [-0.3, 0.2, 1.0], [0.25, 0.16, 0.8]]) {
          b.add(new THREE.CylinderGeometry(r, r * 1.05, h, 14), { m: SHEAR.clone().multiply(MX(RX + 1.02, H - 3.2 + dy, 0.0)), ex: { color: col(C_BRASS) } });
        }
        b.add(GEO.box, { m: SHEAR.clone().multiply(MX(RX + 0.75, H - 3.2, 0.42, 0, 0, 0, 0.5, 0.15, 0.15)), ex: { color: col(C_BRASS) } });
      }
      const g = b.geometry(0);
      const mesh = new THREE.Mesh(g, ST.mats.funnel);
      mesh.name = 'funnel ' + (i + 1);
      const pivot = new THREE.Group();
      pivot.name = 'funnel pivot ' + (i + 1);
      pivot.position.copy(funnelBase(i));
      pivot.add(mesh);
      ST.secs[SH.FUNNEL_X[i] >= BX ? 0 : 1].add(pivot);
      ST.funnels.push({ pivot, mesh, base: funnelBase(i) });
    }
  }
  function updateFunnels(t, S) {
    const sh = S.ship, wreck = sh.wreck > 0.5;
    for (let i = 0; i < ST.funnels.length; i++) {
      const F = ST.funnels[i], f = FALL[i], k = clamp(sh.funnelFall[i]);
      const after = Math.max(0, t - f.t1);
      F.pivot.visible = !wreck && !(k >= 1 && after > 2.5);
      if (!F.pivot.visible) continue;
      const ang = k * f.max + Math.min(after, 2.5) * 4 * DEG;
      F.pivot.quaternion.setFromAxisAngle(f.axis, ang);
      F.pivot.position.copy(F.base).addScaledVector(f.d, f.slide * k * k);
      F.pivot.position.y -= 1.2 * k * k + 3.5 * Math.min(after, 2.5);
    }
  }
  // tapered round rod from a to c (radius r0 at a, r1 at c)
  function taperRod(b, a, c, r0, r1, seg, opts) {
    const m = new THREE.Matrix4();
    const L = basisAlong(a.x, a.y, a.z, c.x, c.y, c.z, m);
    m.multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    m.setPosition((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
    b.add(new THREE.CylinderGeometry(r1, r0, L, seg || 12, 1), withM(opts, m));
  }
  // point on a raked mast at height y
  const mastAt = (base, top, y) => V3(lerp(base.x, top.x, (y - base.y) / (top.y - base.y)), y, 0);
  const AER_F = 58.6, AER_M = 55.4;   // aerial spreader heights on the fore and main masts

  // ---------------- masts, rigging and the wireless aerial ----------------
  function buildMastsStatic() {
    // mainmast (stern section, static)
    taperRod(B.buff, MM_BASE, MM_TOP, 0.46, 0.2, 14);
    vcyl(B.buff, MM_BASE.x, WELL_Y, 0, 0.66, 0.55, 16);
    const ms = mastAt(MM_BASE, MM_TOP, AER_M);
    box(B.dark, ms.x + 0.2, ms.x + 0.36, AER_M - 0.08, AER_M + 0.08, -2.6, 2.6);
    for (const s of [1, -1]) {
      const p = mastAt(MM_BASE, MM_TOP, 40.5);
      for (const x of [-82.0, -84.6, -87.2]) rig([p.x, p.y, s * 0.3], [x, SHEER(x) + 0.05, s * (HB(x, 13.3) - 0.15)], 0);
      const q = mastAt(MM_BASE, MM_TOP, 54.5);
      for (const x of [-105.5, -108.5]) rig([q.x, q.y, s * 0.2], [x, SHEER(x) + 0.05, s * (HB(x, 15.6) - 0.2)], 0);
      rig([ms.x + 0.3, AER_M, s * 2.6], [MM_TOP.x, MM_TOP.y, 0], 0);
    }
    // foremast rigging (the pole itself moves with the wreck, see buildMasts)
    const fTop = FM_TOP;
    rig([fTop.x + 0.2, fTop.y - 0.3, 0], [133.4, 18.5, 0], 0);           // forestay to the stem
    const n2 = mastAt(FM_BASE, FM_TOP, 31.4);
    rig([n2.x + 0.3, 31.4, 0], [124.5, SHEER(124.5) + 0.1, 0], 0);         // lower forestay
    for (const s of [1, -1]) {
      for (const x of [85.4, 87.8, 90.2]) rig([n2.x, 31.4, s * 0.3], [x, SHEER(x) + 0.05, s * (HB(x, 13.5) - 0.15)], 0);
      const u = mastAt(FM_BASE, FM_TOP, 45.0);
      for (const x of [83.2, 92.4]) rig([u.x, 45, s * 0.22], [x, SHEER(x) + 0.05, s * (HB(x, 13.5) - 0.15)], 0);
      rig([fTop.x - 0.3, AER_F, s * 2.6], [fTop.x, fTop.y, 0], 0);
    }
    // the Marconi aerial: four wires between the spreaders, and the lead-in to the wireless room
    const fs = mastAt(FM_BASE, FM_TOP, AER_F);
    const A = V3(fs.x - 0.3, AER_F, 0), Bm = V3(ms.x + 0.3, AER_M, 0), SAG = 1.6, NSEG = 14;
    const wire = (z, u) => [lerp(A.x, Bm.x, u), lerp(A.y, Bm.y, u) - 4 * SAG * u * (1 - u), z];
    for (const z of [-2.2, -0.75, 0.75, 2.2]) for (let k = 0; k < NSEG; k++) rig(wire(z, k / NSEG), wire(z, (k + 1) / NSEG), 5);
    const uL = (A.x - 50) / (A.x - Bm.x);
    for (const z of [-2.2, -0.75, 0.75, 2.2]) {
      const w = wire(z, uL);
      rig(w, [lerp(w[0], 47.0, 0.5), lerp(w[1], TOP_Y + 0.3, 0.5), z * 0.4], 5);
      rig([lerp(w[0], 47.0, 0.5), lerp(w[1], TOP_Y + 0.3, 0.5), z * 0.4], [47.0, TOP_Y + 0.3, z * 0.1], 5);
    }
  }
  function buildMasts() {
    // the foremast is its own object: on the wreck it lies collapsed back over the bridge
    const b = new Batch(null, 1 / 3), w = new Batch({ aEmis: 3, aSeed: 1 });
    const O = FM_BASE, L = (v) => V3(v.x - O.x, v.y - O.y, v.z - O.z);
    taperRod(b, V3(0, 0, 0), L(FM_TOP), 0.46, 0.2, 14);
    vcyl(b, 0, 0, 0, 0.66, 0.55, 16);
    // crow's nest: a steel barrel on the forward side of the mast, the bell above it
    const N = L(SH.CROWS_NEST), NR = 1.3, NH = 1.15;
    b.add(new THREE.CylinderGeometry(NR, NR * 0.96, NH, 24, 1, true), { m: MX(N.x, N.y + NH / 2, 0) });
    b.add(new THREE.CylinderGeometry(NR * 0.96, NR * 0.9, 0.35, 24, 1, false), { m: MX(N.x, N.y - 0.17, 0) });
    b.add(new THREE.TorusGeometry(NR, 0.06, 6, 28).rotateX(Math.PI / 2), { m: MX(N.x, N.y + NH, 0) });
    const mN = mastAt(V3(0, 0, 0), L(FM_TOP), N.y);
    for (const dy of [-0.1, 0.9]) for (const dz of [-0.35, 0.35]) beam(b, mN.x, N.y + dy, dz, N.x - NR + 0.1, N.y + dy, dz * 0.8, 0.12, 0.12);
    const mB = mastAt(V3(0, 0, 0), L(FM_TOP), N.y + 2.3);
    beam(b, mB.x, mB.y, 0, mB.x + 0.8, mB.y, 0, 0.08, 0.08);
    b.add(new THREE.CylinderGeometry(0.08, 0.2, 0.32, 14), { m: MX(mB.x + 0.8, mB.y - 0.22, 0) });
    // aerial spreader and the masthead light
    const fs = mastAt(V3(0, 0, 0), L(FM_TOP), AER_F - O.y);
    box(b, fs.x - 0.38, fs.x - 0.22, fs.y - 0.08, fs.y + 0.08, -2.6, 2.6);
    const mh = mastAt(V3(0, 0, 0), L(FM_TOP), 44.0 - O.y);
    box(b, mh.x + 0.2, mh.x + 0.62, mh.y - 0.38, mh.y + 0.42, -0.3, 0.3);
    beam(b, mh.x, mh.y - 0.45, 0, mh.x + 0.5, mh.y - 0.45, 0, 0.1, 0.1);
    const g = b.geometry(0);
    const mast = new THREE.Mesh(g, ST.mats.buff[2]);
    mast.name = 'foremast';
    const pivot = new THREE.Group(); pivot.name = 'foremast pivot';
    pivot.position.copy(O);
    pivot.add(mast);
    // masthead light (its own tiny emissive mesh so it falls with the mast)
    B = { win: w };
    globe(mh.x + 0.72, mh.y, 0, 0.2, [26, 25, 23], CELL.FULL);
    B = null;
    const lamp = new THREE.Mesh(w.geometry(0), ST.mats.win[2]);
    lamp.name = 'masthead light';
    pivot.add(lamp);
    ST.secs[0].add(pivot);
    ST.foremast = pivot;
  }

  // ---------------- propellers and rudder ----------------
  function buildScrewsStatic() {
    const exH = { aSheer: 100 };
    for (const s of [1, -1]) {
      const P = SH.PROP_WING[s > 0 ? 0 : 1];
      taperRod(B.hull, V3(-97, P.y + 0.3, s * (P.z - 0.35)), V3(-116.55, P.y, P.z), 1.1, 0.72, 18, { ex: exH });
      B.hull.add(GEO.sph, { m: MX(-97, P.y + 0.3, s * (P.z - 0.35), 0, 0, 0, 1.5, 1.1, 1.1), ex: exH });
      rod(B.dark, -116.4, P.y, P.z, -116.9, P.y, P.z, 0.36, 12);
    }
    rod(B.dark, PROP_POST_X + 0.3, SH.PROP_CENTER.y, 0, SH.PROP_CENTER.x + 0.7, SH.PROP_CENTER.y, 0, 0.3, 12);
    box(B.hull, -127.1, -123.6, SH.KEEL_Y, SH.KEEL_Y + 0.55, -0.34, 0.34, { ex: exH });   // sole piece under the rudder
  }
  function propGeometry(nb, R, hand) {
    const b = new Batch(null, 1 / 2);
    const prof = [[0.001, -1.35], [0.3, -1.2], [0.52, -0.85], [0.66, -0.35], [0.7, 0.2], [0.66, 0.65], [0.5, 0.9], [0.001, 0.95]]
      .map(([r, y]) => new THREE.Vector2(r * R / 3.6 + (R < 3 ? 0.08 : 0), y * (R < 3 ? 0.85 : 1)));
    b.add(new THREE.LatheGeometry(prof, 18).rotateZ(-Math.PI / 2));
    const P = 2.3 * R, Cmax = (nb === 3 ? 0.9 : 0.72) * R, r0 = 0.55 * R / 3.6;
    for (let k = 0; k < nb; k++) {
      const phi0 = (k / nb) * Math.PI * 2;
      const g = gridGeo(8, 12, (u, v) => {
        const r = lerp(r0, R, v), s = v;
        const chord = Cmax * Math.sqrt(Math.max(0, 1 - Math.pow(s, 4))) * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1))) + 0.02;
        const beta = Math.atan(P / (2 * Math.PI * r));
        const c = (u - 0.5 + 0.22 * s * s) * chord;
        const th = phi0 + hand * (c * Math.cos(beta)) / r;
        return [c * Math.sin(beta) * 0.9, r * Math.cos(th), r * Math.sin(th)];
      });
      b.add(g);
    }
    return b.geometry(0);
  }
  function buildScrews() {
    const mat = ST.mats.bronze;
    mat.side = THREE.DoubleSide;
    const defs = [[SH.PROP_WING[0], SH.PROP_WING_R, 3, 1], [SH.PROP_WING[1], SH.PROP_WING_R, 3, -1], [SH.PROP_CENTER, SH.PROP_CENTER_R, 4, 1]];
    for (const [p, R, nb, hand] of defs) {
      const obj = new THREE.Group();
      obj.position.copy(p);
      const mesh = new THREE.Mesh(propGeometry(nb, R, hand), mat);
      mesh.name = 'propeller';
      obj.add(mesh);
      ST.secs[1].add(obj);
      ST.screws.push({ obj, dir: hand });
    }
    // the rudder (a single plate on its stock at the rudder post)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9); shape.lineTo(0, -10.0); shape.lineTo(-3.5, -10.0); shape.quadraticCurveTo(-4.45, -10.0, -4.45, -9.1);
    shape.lineTo(-4.55, -0.3); shape.quadraticCurveTo(-4.45, 0.9, -3.4, 0.9); shape.lineTo(0, 0.9);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, curveSegments: 6 });
    rg.translate(0, 0, -0.21);
    const rb = new Batch({ aSheer: 1 }, 1 / 18);
    rb.add(rg, { ex: { aSheer: 100 } });
    rb.add(new THREE.CylinderGeometry(0.38, 0.38, 5.2, 14), { m: MX(0, 3.4, 0), ex: { aSheer: 100 } });
    for (let y = -8.5; y < 0; y += 2.1) rb.add(GEO.box, { m: MX(-2.2, y, 0, 0, 0, 0, 4.2, 0.12, 0.72), ex: { aSheer: 100 } });
    const rudder = new THREE.Mesh(rb.geometry(0), ST.mats.hull[2]);
    rudder.name = 'rudder';
    const piv = new THREE.Group();
    piv.position.set(RUDDER_POST_X - 0.32, 0, 0);
    piv.add(rudder);
    ST.secs[1].add(piv);
    ST.rudder = piv;
  }
  // ---------------- Welin davits (instanced arms; swung out as each boat goes) ----------------
  const DAVIT_IN = -40 * DEG;
  function buildDavits() {
    const b = new Batch(null, 1 / 2);
    const path = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0, 2.3, 0.2), V3(0, 4.1, 1.0), V3(0, 5.05, 2.3), V3(0, 5.05, 3.45)]);
    b.add(new THREE.TubeGeometry(path, 18, 0.12, 8, false));
    b.add(new THREE.CircleGeometry(0.95, 10, Math.PI / 2, Math.PI / 2).rotateY(Math.PI / 2), { m: MX(0.09, 0, 0) });   // toothed quadrant
    b.add(new THREE.CircleGeometry(0.95, 10, Math.PI / 2, Math.PI / 2).rotateY(-Math.PI / 2), { m: MX(-0.09, 0, 0) });
    b.add(GEO.box, { m: MX(0, 4.82, 3.45, 0, 0, 0, 0.22, 0.42, 0.22) });                                                 // fall block
    const geo = b.geometry(0);
    for (let s = 0; s < 2; s++) {
      const list = [];
      SH.BOAT_SLOTS.forEach((slot, i) => {
        if ((slot.local.x >= BX ? 0 : 1) !== s) return;
        const boat = TT.story.BOATS.find((bb) => bb.slot === i);
        for (const e of [-3.2, 3.2]) list.push({ x: slot.local.x + e, side: slot.side, t0: boat ? boat.lowerT0 : 1e9 });
      });
      const im = new THREE.InstancedMesh(geo, ST.mats.white[s], list.length);
      im.name = 'davits ' + s;
      im.frustumCulled = false;
      ST.secs[s].add(im);
      ST.davits[s] = im;
      ST.davitInfo[s] = list;
    }
  }
  const _m1 = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e1 = new THREE.Euler(), _v1 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  function updateDavits(t) {
    for (let s = 0; s < 2; s++) {
      const im = ST.davits[s], list = ST.davitInfo[s];
      if (!im) continue;
      list.forEach((d, k) => {
        const ang = lerp(DAVIT_IN, 0, sstep(d.t0, d.t0 + 1.8, t));
        _q1.setFromEuler(_e1.set(ang, d.side < 0 ? Math.PI : 0, 0, 'YXZ'));
        _m1.compose(_v1.set(d.x, DAVIT_Y, d.side * DAVIT_Z), _q1, _one);
        im.setMatrixAt(k, _m1);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------- people on deck: small dark figures along the rails ----------------
  function personGeometry() {
    // ~1.75 m in a long overcoat and a hat: legs, coat, shoulders, arms, head, hat
    const coat = new THREE.CylinderGeometry(0.19, 0.23, 0.95, 7, 2, true).translate(0, 0.98, 0);
    const cp = coat.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setZ(i, cp.getZ(i) * 0.7);   // flatter front-to-back
    const parts = [
      new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(-0.08, 0.28, 0),
      new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(0.08, 0.28, 0),
      coat,
      new THREE.CylinderGeometry(0.08, 0.2, 0.13, 7, 1, true).scale(1, 1, 0.75).translate(0, 1.51, 0),
      new THREE.CylinderGeometry(0.05, 0.045, 0.66, 4, 1, true).rotateZ(0.08).translate(-0.235, 1.15, 0),
      new THREE.CylinderGeometry(0.05, 0.045, 0.66, 4, 1, true).rotateZ(-0.08).translate(0.235, 1.15, 0),
      new THREE.SphereGeometry(0.1, 6, 4).scale(0.9, 1.1, 1).translate(0, 1.66, 0),
      new THREE.CylinderGeometry(0.155, 0.155, 0.015, 7, 1, true).translate(0, 1.74, 0),
      new THREE.CircleGeometry(0.155, 7).rotateX(-Math.PI / 2).translate(0, 1.748, 0),
      new THREE.CylinderGeometry(0.085, 0.095, 0.1, 6, 1).translate(0, 1.79, 0),
    ].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; });
    const m = ADDONS.BufferGeometryUtils.mergeGeometries(parts);
    m.computeVertexNormals();
    return m;
  }
  function buildPeople() {
    const R = U.rng('titanic-people');
    const N = q3(600, 1200, 2000);
    const spots = [];
    const add = (x, y, z, tIn, tOut, yaw) => spots.push({ x, y, z, tIn, tOut, yaw: yaw == null ? R() * 6.28 : yaw, ph: R() * 6.28, sc: 0.92 + R() * 0.16 });
    const houses = HOUSES.map((h) => [h[0] - 0.6, h[1] + 0.6, h[2] - 0.6, h[3] + 0.6]);
    const freeBoat = (x, z) => !houses.some((h) => x > h[0] && x < h[1] && z > h[2] && z < h[3]);
    let guard = 0;
    while (spots.length < N && guard++ < N * 20) {
      const r = R();
      if (r < 0.46) {                           // boat deck: small groups inboard of the boats and at the rails
        const gx = lerp(-60, 60, R()), side = R() < 0.5 ? 1 : -1;
        const gz = side * lerp(8.4, HB(gx, HULL_TOP) - 0.8, Math.pow(R(), 0.8));
        const tIn = lerp(96, 150, R());
        const tOut = gx > 20 ? lerp(165, 192, R()) : gx > -10 ? lerp(178, 200, R()) : 1e9;
        const face = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const ng = 1 + Math.floor(R() * 5);
        for (let k = 0; k < ng; k++) {
          const x = gx + (R() - 0.5) * 2.2, z = gz + (R() - 0.5) * 1.4;
          if (!freeBoat(x, z) || Math.abs(z) > HB(x, HULL_TOP) - 0.5) continue;
          if (x > -1 && x < 19 && z > 7.5) continue;           // keep the final_band camera path clear
          add(x, BOAT_Y, z, tIn + R() * 6, tOut + R() * 4, face + (R() - 0.5) * 2.4);
        }
      } else if (r < 0.74) {                    // poop deck: crowding to the rails as she goes down
        const x = lerp(-133, -105.5, Math.pow(R(), 0.8)), w = HB(x, SHEER(x) - 0.05) - 0.75;
        if (w < 1) continue;
        const atRail = R() < 0.6, side = R() < 0.5 ? 1 : -1;
        const z = atRail ? side * w : (R() * 2 - 1) * (w - 0.5);
        if (x > -128.4 && x < -125.6) continue;    // docking-bridge posts
        add(x, SHEER(x), z, lerp(118, 198, Math.pow(R(), 0.6)), 1e9);
      } else if (r < 0.88) {                    // aft well deck (third class)
        const x = lerp(-103, -81, R()), w = HB(x, WELL_Y) - 1.0;
        if (Math.abs(x + 86.5) < 2.6 || Math.abs(x + 98.5) < 2.6) continue;   // hatches
        add(x, WELL_Y, (R() * 2 - 1) * w, lerp(104, 160, R()), lerp(196, 230, R()));
      } else if (r < 0.95) {                    // after B deck and the forward well deck
        if (R() < 0.6) { const x = lerp(-79, -63, R()), w = HB(x, HULL_TOP) - 0.8; const z = (R() < 0.5 ? 1 : -1) * lerp(9.9, w, R()); add(x, HULL_TOP, z, lerp(100, 170, R()), 1e9); }
        else { const x = lerp(68, 95, R()), w = HB(x, WELL_Y) - 1.0; if (Math.abs(x - 78) < 3.2 || Math.abs(x - 92.5) < 2.6) continue; add(x, WELL_Y, (R() * 2 - 1) * w, lerp(84, 120, R()), lerp(140, 165, R())); }
      } else {                                  // a few night walkers during the voyage
        const x = lerp(-55, 55, R()), side = R() < 0.5 ? 1 : -1, z = side * lerp(8.4, 12.5, R());
        if (!freeBoat(x, z)) continue;
        add(x, BOAT_Y, z, 0, lerp(80, 200, R()));
      }
    }
    // on the stern section, where each one holds on once she stands up: most make for the nearest rail
    // or bulwark (hands on the capping rail), the rest grip whatever is at hand; some let go on the way up
    const RC = U.rng('titanic-people-cling');
    for (const p of spots) {
      if (p.x >= BX) continue;
      const r = RC(), side = p.z >= 0 ? 1 : -1;
      if (p.x < SH.POOP_X[1] && r < 0.3) {
        // the after rail round the counter: the highest place on her once she stands up
        const x = lerp(SH.STERN_X + 0.5, -128.5, Math.pow(RC(), 1.5));
        p.cl = [x, SHEER(x), side * Math.max(0.2, HB(x, SHEER(x) - 0.05) - 0.35), 0.8];
      } else if (r < 0.7) {
        const top = p.y > HULL_TOP - 0.1 && p.x > SH.AFT_WELL_X[1] ? p.y : SHEER(p.x);
        const x = p.x + (RC() - 0.5) * 1.4;
        p.cl = [x, top, side * (HB(x, top - 0.05) - 0.3), 0.85];
      } else p.cl = [p.x, p.y, p.z, 0.35];
      p.go = RC() < 0.35 ? lerp(0.08, 0.5, RC()) : -1;
    }
    const geo = personGeometry();
    for (let s = 0; s < 2; s++) {
      const list = spots.filter((p) => (p.x >= BX ? 0 : 1) === s);
      const im = new THREE.InstancedMesh(geo, ST.mats.people, Math.max(1, list.length));
      im.name = 'people ' + s; im.count = 0; im.frustumCulled = false;
      const pc = new THREE.Color();
      list.forEach((p, k) => {   // dark coats, a few lighter ones and white cork life-jackets
        const r = R();
        if (r < 0.1) pc.setRGB(0.55, 0.53, 0.48); else if (r < 0.22) pc.setRGB(0.22, 0.18, 0.14); else pc.setRGB(0.07 + R() * 0.07, 0.07 + R() * 0.06, 0.075 + R() * 0.06);
        p.col = pc.clone();
      });
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3), 3);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ST.secs[s].add(im);
      ST.people[s] = im;
      ST.spots[s] = list;
    }
  }
  const _pw = new THREE.Vector3(), _up = new THREE.Vector3(), _qi = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
  const _wu = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _qc = new THREE.Quaternion();
  function updatePeople(t, S) {
    const sh = S.ship, show = sh.visible && sh.wreck < 0.5;
    for (let s = 0; s < 2; s++) {
      const im = ST.people[s], list = ST.spots[s];
      if (!im) continue;
      const pose = s === 0 ? sh.bow : sh.stern;
      if (!show || !(s === 0 ? sh.bowVisible : sh.sternVisible)) { im.count = 0; continue; }
      // people keep their feet: lean the figures part-way back toward the world vertical
      _qi.copy(pose.quat).invert();
      _wu.copy(_Y).applyQuaternion(_qi);                  // world up in section space
      _up.copy(_wu).lerp(_Y, 0.35).normalize();
      _q2.setFromUnitVectors(_Y, _up);
      // as the stern stands up they hang from the rails, bodies plumb below their hands
      const upY = _v2.copy(_Y).applyQuaternion(pose.quat).y;
      const cling = s === 1 ? 1 - sstep(0.3, 0.74, upY) : 0;
      if (cling > 0) _q3.setFromUnitVectors(_Y, _wu);
      let n = 0;
      for (const p of list) {
        if (t < p.tIn || t >= p.tOut) continue;
        if (sh.broken > 0 && Math.abs(p.x - BX) < 12) continue;
        if (cling > 0 && p.go > 0 && upY < p.go) continue;   // let go
        _pw.set(p.x, p.y, p.z);
        if (cling > 0 && p.cl) {
          // hands on the rail (or a fitting) ~1 m above the deck, the body plumb below them against it
          _v2.set(p.cl[0], p.cl[1] + p.cl[3], p.cl[2]).addScaledVector(_wu, -1.9);
          _pw.lerp(_v2, cling);
        }
        TT.pose.toWorld(pose, _pw, _v1);
        if (_v1.y < 0.4) continue;                       // the sea has reached them
        const sway = Math.sin(t * 0.9 + p.ph) * 0.05 * (1 - 0.6 * cling);
        _q1.setFromEuler(_e1.set(sway * 0.4, p.yaw + sway, 0, 'YXZ'));
        if (cling > 0) _q1.premultiply(_qc.copy(_q2).slerp(_q3, cling)); else _q1.premultiply(_q2);
        _m1.compose(_pw, _q1, _s.set(p.sc, p.sc, p.sc));
        im.setColorAt(n, p.col);
        im.setMatrixAt(n++, _m1);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ---------------- the wreck: rusticles along rails and edges of the bow section ----------------
  function buildWreckExtras() {
    const R = U.rng('titanic-rusticles');
    const pts = [];
    for (const sg of RAILSEG) {
      if ((sg[0] + sg[3]) / 2 < BX + 8) continue;
      const L = Math.hypot(sg[3] - sg[0], sg[4] - sg[1], sg[5] - sg[2]), n = Math.floor(L / 0.9);
      for (let k = 0; k < n; k++) if (R() < 0.55) { const u = (k + R()) / Math.max(1, n); pts.push([lerp(sg[0], sg[3], u), lerp(sg[1], sg[4], u), lerp(sg[2], sg[5], u), 0.25 + R() * 0.7]); }
    }
    for (let x = BX + 8; x < SH.STEM_X - 1; x += 1.3) for (const side of [1, -1]) {
      const y = x > 66 && x < 97 ? SHEER(x) : x >= 97 ? SHEER(x) : HULL_TOP;
      if (R() < 0.6) pts.push([x + R() * 0.8, y - 0.02, side * (HB(x, y - 0.3) + 0.04), 0.4 + R() * 1.3]);
      if (x < 66 && R() < 0.5) pts.push([x, BOAT_Y - 0.25, side * (HB(x, HULL_TOP) + 0.12), 0.3 + R() * 0.9]);
    }
    const g = new THREE.ConeGeometry(0.07, 1, 5, 1).rotateX(Math.PI).translate(0, -0.5, 0);
    const im = new THREE.InstancedMesh(g, ST.mats.rust, pts.length);
    pts.forEach((p, i) => {
      _q1.setFromEuler(_e1.set((R() - 0.5) * 0.2, 0, (R() - 0.5) * 0.2));
      _m1.compose(_v1.set(p[0], p[1], p[2]), _q1, _s.set(0.7 + R(), p[3], 0.7 + R()));
      im.setMatrixAt(i, _m1);
    });
    im.name = 'rusticles'; im.visible = false;
    ST.secs[0].add(im);
    ST.wreckOnly.push(im);
  }

  // ---------------- deck glow: up to four warm point lights ----------------
  const LIGHT_SPOTS = [[0, 47.0, 24.3, 0], [0, 3.0, 23.6, 0], [1, -46.0, 23.6, 0], [1, -117.0, 20.8, 0]];
  const WARM = new THREE.Color(0xffb070), TEAL = new THREE.Color(0x3fe0b0);
  // (kept in their own always-visible group: a light dropping out of the scene would force every
  // material in the film to recompile at that moment)
  function buildLights() {
    ST.lightGroup = new THREE.Group();
    ST.lightGroup.name = 'ship deck lights';
    for (const [s, x, y, z] of LIGHT_SPOTS) {
      const l = new THREE.PointLight(WARM, 0, 70, 2);
      l.name = 'deck glow';
      ST.lightGroup.add(l);
      ST.lights.push({ l, s, local: V3(x, y, z), k: s === 1 && x < -100 ? 30 : 42 });
    }
  }
  function updateLights(t, S) {
    const sh = S.ship, lv = sh.lights * (sh.wreck > 0.5 ? 0 : 1);
    for (const L of ST.lights) {
      const pose = L.s === 0 ? sh.bow : sh.stern;
      TT.pose.toWorld(pose, L.local, _v1);
      const under = _v1.y < 0;
      L.l.color.copy(under ? TEAL : WARM);
      L.l.position.copy(_v1);
      const vis = sh.visible && (L.s === 0 ? sh.bowVisible : sh.sternVisible);
      L.l.intensity = vis ? lv * L.k * (under ? 0.25 * Math.exp(_v1.y / 8) : 1) : 0;
    }
    // the foremast lies back over the bridge on the wreck
    if (ST.foremast) ST.foremast.rotation.z = sh.wreck > 0.5 ? 76 * DEG : 0;
  }

  // ---------------- night look: starlight rim, dark fill, the streaming-wet stern, the abyss glimmer ----------------
  const RIM_NIGHT = new THREE.Color(0x8fa6d6), RIM_DEEP = new THREE.Color(0x3a9aa6), FILL_DEEP = new THREE.Color(0x4a6a70);
  function updateLook(t, S) {
    const EV = TT.story.EV, sh = S.ship, E = S.env;
    let rim = 0, fill = 0, wet = 0, tint = 0.25, rc = RIM_NIGHT, fc = RIM_NIGHT, eb = 0, eu = 0;
    if (sh.wreck > 0.5) {
      // the abyss and the seabed: a last cool glimmer on her edges, a hint of rust in it
      // strongest while she falls through the dark; once she is on the seabed the lamps take over
      const k = 1 - 0.72 * sstep(EV.seabedImpact - 0.5, EV.seabedImpact + 1.0, t);
      rim = 0.15 * k; fill = 0.12 * k; tint = 0.5; rc = RIM_DEEP; fc = FILL_DEEP; eb = 2.2 * k; eu = 0.3 * k;
    } else if (E.underwater > 0.5) {
      rim = 0.035; fill = 0.0; tint = 0.2; rc = RIM_DEEP;
    } else {
      const dark = sstep(EV.lightsFlicker, EV.lightsGone, t);
      rim = lerp(0.035, 0.13, dark);
      fill = 0.065 * dark * sstep(EV.breakStart, EV.sternSplash, t);
      wet = sstep(EV.breakApart, EV.sternSplash + 0.6, t) * (1 - sstep(EV.sternGone, EV.sternGone + 1, t));
      tint = lerp(0.25, 0.45, dark);
    }
    SU.uRimCol.value.set(rc.r * rim, rc.g * rim, rc.b * rim);
    SU.uFill.value.set(fc.r * fill, fc.g * fill, fc.b * fill);
    SU.uWet.value = wet;
    SU.uRimTint.value = tint;
    SU.uEdge.value.set(eb, eu);
  }

  // per-frame updaters for the dynamic parts

  // =====================================================================
  // ASSEMBLY: batches -> one mesh per material per section
  // =====================================================================
  function assemble() {
    const M = ST.mats;
    const plan = [
      ['hull', B.hull, M.hull], ['white', B.white, M.white], ['wood', B.wood, M.wood], ['dark', B.dark, M.dark],
      ['buff', B.buff, M.buff], ['win', B.win, M.win],
    ];
    for (let s = 0; s < 2; s++) {
      for (const [name, batch, mats] of plan) {
        const g = batch.geometry(s);
        if (!g) continue;
        const mesh = new THREE.Mesh(g, mats[s]);
        mesh.name = 'ship ' + name + (s ? ' stern' : ' bow');
        mesh.matrixAutoUpdate = false;
        ST.secs[s].add(mesh);
      }
      // torn break faces (hidden until she breaks)
      const gb = B.brk.geometry(s);
      if (gb) { const m = new THREE.Mesh(gb, M.dark[s]); m.name = 'ship break ' + s; m.matrixAutoUpdate = false; m.visible = false; ST.secs[s].add(m); ST.breakObjs[s].push(m); }
      const gt = B.teeth.geometry(s);
      if (gt) { const m = new THREE.Mesh(gt, M.dark[2]); m.name = 'ship torn plating ' + s; m.matrixAutoUpdate = false; m.visible = false; ST.secs[s].add(m); ST.breakObjs[s].push(m); }
    }
    // rigging (thin lines), split per section
    for (let s = 0; s < 2; s++) {
      const pos = [], ids = [];
      for (const r of RIG) {
        const cx = (r[0] + r[3]) / 2;
        if ((cx >= BX ? 0 : 1) !== s) continue;
        pos.push(r[0], r[1], r[2], r[3], r[4], r[5]); ids.push(r[6], r[6]);
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aId', new THREE.Float32BufferAttribute(ids, 1));
      g.computeBoundingSphere();
      const l = new THREE.LineSegments(g, ST.rigMat);
      l.name = 'ship rigging ' + s; l.matrixAutoUpdate = false;
      ST.secs[s].add(l);
    }
  }

  // =====================================================================
  // ANCHORS
  // =====================================================================
  const ANCH = {
    stemTop: [0, V3(SH.STEM_X, 17.8, 0)],
    bow: [0, V3(127, 14, 0)],
    bridge: [0, V3(62.2, 21.4, 0)],
    crowsNest: [0, SH.CROWS_NEST.clone()],
    foremastTop: [0, FM_TOP.clone()],
    mainmastTop: [1, MM_TOP.clone()],
    sternTop: [1, V3(SH.STERN_X + 0.3, 16.6, 0)],
    stern: [1, V3(SH.STERN_WL_X, 1.0, 0)],
    propellers: [1, SH.PROP_CENTER.clone()],
    rudder: [1, V3(-128.2, -4.5, 0)],
    wellDeckFwd: [0, V3(82, WELL_Y, 0)],
    boatDeckStbd: [0, V3(50, BOAT_Y + 1.7, 10.5)],
    boatDeckPort: [0, V3(50, BOAT_Y + 1.7, -10.5)],
    rocketLauncher: [0, SH.ROCKET_LAUNCHER.clone()],
    midship: [0, V3(0, 10, 0)],
    starboardBowWaterline: [0, V3(100, 0, HB(100, 0))],
  };
  const _aw = new THREE.Vector3(), _aw2 = new THREE.Vector3(), _al = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);
  const poseOf = (s) => (s === 0 ? TT.S.ship.bow : TT.S.ship.stern);

  TT.register('ship', {
    order: 30,
    group: null,
    sections: null,

    async init(ctx) {
      const t0 = performance.now();
      Q = ctx.quality || 'high';
      const yieldUI = () => new Promise((r) => setTimeout(r, 0));
      unitGeos();
      makeTextures(ctx.renderer);
      makeMaterials();
      await yieldUI();
      ST.root = new THREE.Group(); ST.root.name = 'RMS Titanic';
      ST.secs = [new THREE.Group(), new THREE.Group()];
      ST.secs[0].name = 'Titanic bow section'; ST.secs[1].name = 'Titanic stern section';
      ST.root.add(ST.secs[0], ST.secs[1]);
      B = {
        hull: new Batch({ aSheer: 1 }), white: new Batch(null, 1 / 6), wood: new Batch(null, 1 / 6), dark: new Batch(null, 1 / 4),
        buff: new Batch(null, 1 / 6), win: new Batch({ aEmis: 3, aSeed: 1 }), brk: new Batch(null, 1 / 4), teeth: new Batch(null, 1 / 4),
      };
      RIG = [];
      const steps = [buildHull, buildDecks, buildSuperstructure, buildBridge, buildDeckGear, buildRails, buildWindows, buildFunnelsStatic, buildMastsStatic, buildScrewsStatic, buildBreakFaces];
      for (const f of steps) { try { f(); } catch (e) { TT.error('ship ' + f.name, e); } }
      await yieldUI();
      assemble();
      B = null;
      const dyn = [buildNames, buildFunnels, buildMasts, buildScrews, buildDavits, buildPeople, buildWreckExtras, buildLights];
      for (const f of dyn) { try { f(); } catch (e) { TT.error('ship ' + f.name, e); } }
      // propeller angle table: integrate the story's shaft speed once (time-pure)
      const TR = TT.story.TR, n = Math.ceil(C.DURATION / ST.propStep) + 2;
      ST.propAng = new Float64Array(n);
      for (let i = 1; i < n; i++) ST.propAng[i] = ST.propAng[i - 1] + 2 * Math.PI * TR.prop((i - 0.5) * ST.propStep) * ST.propStep;
      ctx.scene.add(ST.root);
      if (ST.lightGroup) ctx.scene.add(ST.lightGroup);
      this.group = ST.root;
      this.sections = { bow: ST.secs[0], stern: ST.secs[1] };
      this.update(ctx.S ? ctx.S.t : 0, 0, ctx);
      let tris = 0;
      ST.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
      TT.log('ship init ' + (performance.now() - t0).toFixed(0) + ' ms, ~' + Math.round(tris / 1000) + 'k tris');
    },

    update(t, dt, ctx) {
      const S = ctx.S, sh = S.ship;
      const root = ST.root;
      if (!root) return;
      // first frame (every module is up and every light exists): compile all ship programs now, including
      // the torn plating and the wreck's rusticles, so nothing compiles mid-film
      if (!ST.compiled && dt > 0 && ctx.renderer && ctx.camera) {
        ST.compiled = true;
        try { ctx.renderer.compile(root, ctx.camera, ctx.scene); } catch (e) { /* the first render compiles instead */ }
      }
      root.visible = !!sh.visible;
      ST.secs[0].visible = sh.visible && sh.bowVisible;
      ST.secs[1].visible = sh.visible && sh.sternVisible;
      TT.pose.apply(ST.secs[0], sh.bow);
      TT.pose.apply(ST.secs[1], sh.stern);
      SU.uBroken.value = sh.broken;
      SU.uWreck.value = sh.wreck;
      SU.uTime.value = t;
      SU.uLights.value = sh.lights;
      SU.uFall.value.set(sh.funnelFall[0], sh.funnelFall[1], sh.funnelFall[2], sh.funnelFall[3]);
      try { updateLook(t, S); } catch (e) { if (!ST._e5) { ST._e5 = 1; TT.error('ship look', e); } }
      const brk = sh.broken > 0.0005;
      for (let s = 0; s < 2; s++) for (const o of ST.breakObjs[s]) o.visible = brk;
      const wreck = sh.wreck > 0.5;
      for (const o of ST.wreckOnly) o.visible = wreck;
      for (const o of ST.liveOnly) o.visible = !wreck;
      // screws & rudder
      if (ST.propAng) {
        const f = clamp(t / ST.propStep, 0, ST.propAng.length - 1.001), i = Math.floor(f), u = f - i;
        const a = ST.propAng[i] + (ST.propAng[i + 1] - ST.propAng[i]) * u;
        for (const s of ST.screws) s.obj.rotation.x = a * s.dir;
      }
      if (ST.rudder) ST.rudder.rotation.y = -sh.rudder;
      try { updateFunnels(t, S); } catch (e) { if (!ST._e1) { ST._e1 = 1; TT.error('ship funnels', e); } }
      try { updateLights(t, S); } catch (e) { if (!ST._e2) { ST._e2 = 1; TT.error('ship lights', e); } }
      // davits & people: only when story time moved (cheap in freeze mode)
      if (S.seek || Math.abs(t - ST.lastDyn) > 1 / 45) {
        ST.lastDyn = t;
        try { updateDavits(t, S); } catch (e) { if (!ST._e3) { ST._e3 = 1; TT.error('ship davits', e); } }
        try { updatePeople(t, S); } catch (e) { if (!ST._e4) { ST._e4 = 1; TT.error('ship people', e); } }
      }
    },

    // ---------------- public API ----------------
    anchor(name, target) {
      const out = target || new THREE.Vector3();
      const S = TT.S.ship;
      const a = ANCH[name];
      if (a) {
        if ((name === 'foremastTop' || name === 'crowsNest') && ST.foremast && ST.foremast.rotation.z !== 0) {
          _al.copy(a[1]).sub(FM_BASE).applyAxisAngle(_Z, ST.foremast.rotation.z).add(FM_BASE);
          return TT.pose.toWorld(S.bow, _al, out);
        }
        return TT.pose.toWorld(poseOf(a[0]), a[1], out);
      }
      let m = /^funnel([1-4])(Top|Base)$/.exec(name);
      if (m) return funnelPoint(+m[1] - 1, m[2] === 'Top' ? 'top' : 'base', out);
      m = /^steamPipe([1-4])$/.exec(name);
      if (m) return funnelPoint(+m[1] - 1, 'pipe', out);
      if (name === 'breakTop' || name === 'breakKeel') {
        _al.set(BX, name === 'breakTop' ? BOAT_Y : SH.KEEL_Y, 0);
        TT.pose.toWorld(S.stern, _al, out);
        if (S.bowVisible) { TT.pose.toWorld(S.bow, _al, _aw2); out.add(_aw2).multiplyScalar(0.5); }
        return out;
      }
      return TT.pose.toWorld(S.intact, _al.set(0, 10, 0), out);
    },
    localToWorld(local, target) {
      return TT.pose.toWorld(local.x >= BX ? TT.S.ship.bow : TT.S.ship.stern, local, target || new THREE.Vector3());
    },
    boatSlotWorld(i, target) {
      const slot = SH.BOAT_SLOTS[clamp(i | 0, 0, SH.BOAT_SLOTS.length - 1)];
      return this.localToWorld(slot.local, target);
    },
    sectionMatrix(which, target) {
      return TT.pose.matrix(which === 'stern' ? TT.S.ship.stern : TT.S.ship.bow, target || new THREE.Matrix4());
    },
  });

  // funnel reference points, following the falling funnels
  function funnelPoint(i, what, out) {
    const f = ST.funnels[i];
    const x = SH.FUNNEL_X[i];
    const sec = x >= BX ? 0 : 1;
    if (what === 'base') _al.set(0, 0, 0);
    else if (what === 'top') _al.set(-F_H * TAN_RAKE, F_H, 0);
    else _al.set(SH.FUNNEL_RX + 0.62 - (F_H + 1.6) * TAN_RAKE, F_H + 1.6, 0);
    if (f && f.pivot) { f.pivot.updateMatrix(); _al.applyMatrix4(f.pivot.matrix); }
    else _al.add(_aw.set(x + F_BASE_DX, SH.FUNNEL_BASE_Y, 0));
    return TT.pose.toWorld(poseOf(sec), _al, out);
  }
})();
