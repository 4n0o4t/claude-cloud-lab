import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/45_props.js ====
// =====================================================================
// 45_props.js — everything in the world that is not the Titanic, the sea, the
// sky or particles: the iceberg + growlers, all sixteen lifeboats, the
// Californian's lights, RMS Carpathia, the dawn ice field, floating debris,
// the seabed and the 1985 ROV sled.
// Owner: props agent.  Public API: TT.props.iceberg, boatWorld(i, target), carpathia.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = C.SHIP, P = TT.pose;
  const clamp = U.clamp, lerp = U.lerp, sstep = U.smoothstep;
  const V3 = () => new THREE.Vector3();
  const NOREF = TT.LAYERS.NO_REFLECT;

  // ------------------------------------------------------------------
  // Fast deterministic 3D gradient noise (improved Perlin), fbm, ridged
  // ------------------------------------------------------------------
  const PERM = new Uint8Array(512);
  (() => {
    const r = U.rng('titanic-props-noise'), p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function grad(h, x, y, z) {
    const g = h & 15, u = g < 8 ? x : y, v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
  }
  function noise3(x, y, z) {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
    const l1 = (a, b, t) => a + t * (b - a);
    return l1(l1(l1(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      l1(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
      l1(l1(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
        l1(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  function fbm(x, y, z, oct) {
    let s = 0, a = 0.5;
    for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5; }
    return s;
  }
  function ridged(x, y, z, oct) {
    let s = 0, a = 0.5, w = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(noise3(x, y, z)); n *= n * w; w = clamp(n * 1.6);
      s += a * n; x = x * 2.1 + 5.3; y = y * 2.1 + 1.9; z = z * 2.1 + 7.7; a *= 0.5;
    }
    return s;
  }
  const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k); return lerp(b, a, h) + k * h * (1 - h); };

  // ocean height (the ocean module's if present, else a gentle analytic swell)
  function seaH(x, z, t) {
    const O = TT.ocean;
    if (O && O._ready && O.heightAt) { try { const h = O.heightAt(x, z, t); if (isFinite(h)) return h; } catch (e) { /* fall through */ } }
    const A = TT.S.env.waveHeight || 0.12;
    return A * (0.55 * Math.sin(0.061 * x + 0.035 * z + t * 0.77) + 0.3 * Math.sin(-0.043 * x + 0.083 * z + t * 1.07 + 1.3) + 0.15 * Math.sin(0.13 * x - 0.11 * z + t * 1.6));
  }

  // ------------------------------------------------------------------
  // Glow sprites (one draw call per group): lanterns, distant ship lights, lamps.
  // Point sprites with a soft core + halo, additive, sized in metres with a pixel floor.
  // ------------------------------------------------------------------
  function makeGlowPoints(n, opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uMinPx: { value: opts.minPx || 2.0 }, uMaxPx: { value: opts.maxPx || 160 }, uFloor: { value: opts.fadeFloor != null ? opts.fadeFloor : 0.25 } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; varying vec3 vCol; varying float vFade; varying float vSmall;
        uniform float uScale, uMinPx, uMaxPx, uFloor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float px = size * uScale / max(0.5, -mv.z);
          float c = clamp(px, uMinPx, uMaxPx);
          vFade = clamp(px / uMinPx, uFloor, 1.0);   // tiny far lights keep a pixel but dim
          vSmall = 1.0 - clamp(px / (uMinPx * 2.5), 0.0, 1.0);
          gl_PointSize = c; vCol = color;
          if (size <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vFade; varying float vSmall;
        void main(){
          vec2 d = gl_PointCoord * 2.0 - 1.0; float r2 = dot(d, d);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * mix(18.0, 3.5, vSmall)), halo = exp(-r2 * 4.0) * 0.35 + (1.0 - r2) * 0.04;
          gl_FragColor = vec4(vCol * (core * 2.2 + halo) * vFade, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }

  // ------------------------------------------------------------------
  // Soft billboard sprites (smoke). Instanced quads; per-instance offset/size/alpha.
  // ------------------------------------------------------------------
  function puffTexture() {
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), im = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * 2 - 1, v = y / S * 2 - 1, r = Math.sqrt(u * u + v * v);
      const n = 0.7 + 0.55 * fbm(u * 2.2 + 7.31, v * 2.2 + 1.73, 0.47, 4);
      const a = clamp(Math.pow(clamp(1 - r * r), 1.8) * n * 1.15);
      const i = (y * S + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function makeSprites(n, tex) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)); // size, alpha, rot, shade
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uLight: { value: new THREE.Color(0.5, 0.5, 0.55) }, uDark: { value: new THREE.Color(0.1, 0.1, 0.12) },
        fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1e9 }, fogDensity: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iData; varying vec2 vUv; varying vec2 vD;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv; vD = iData.yw;
          float c = cos(iData.z), s = sin(iData.z);
          vec2 p = mat2(c, s, -s, c) * position.xy * iData.x;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          mvPosition.xy += p;
          gl_Position = projectionMatrix * mvPosition;
          if (iData.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec3 uLight, uDark; varying vec2 vUv; varying vec2 vD;
        #include <fog_pars_fragment>
        void main(){
          vec4 tx = texture2D(uTex, vUv);
          float a = tx.a * vD.x;
          if (a < 0.003) discard;
          vec3 col = mix(uDark, uLight, clamp(vD.y + (vUv.y - 0.5) * 0.4, 0.0, 1.0));
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  // Screen-space bump (Mikkelsen) — guarded: degenerate derivatives (edge-on triangles, MSAA
  // samples outside the primitive) would otherwise normalize a zero vector into NaN = black specks.
  const TTBUMP = /* glsl */`
          vec3 ttBump(vec3 sp, vec3 sn, vec2 dH, float fd){
            vec3 sX = dFdx(sp), sY = dFdy(sp);
            vec3 R1 = cross(sY, sn), R2 = cross(sn, sX);
            float det = dot(sX, R1) * fd;
            if (abs(det) < 1e-14) return sn;
            vec3 g = sign(det) * (dH.x * R1 + dH.y * R2);
            vec3 r = abs(det) * sn - g;
            float l2 = dot(r, r);
            return l2 > 1e-28 ? r * inversesqrt(l2) : sn;
          }`;

  // ------------------------------------------------------------------
  // ICE MATERIAL (hero berg, growlers, ice field): MeshStandardMaterial + injected
  // snow / glacial-blue crevices / wet waterline band / erosion bump / ghostly
  // night rim / rocket flashes (TT.flashes).  Per-vertex aIce = (snow, cavity, var).
  // ------------------------------------------------------------------
  const ICEU = {
    uFlashPos: { value: [V3(), V3(), V3(), V3()] },
    uFlashCol: { value: [V3(), V3(), V3(), V3()] },
    uFlashRange: { value: [600, 600, 600, 600] },
    uGhost: { value: 1 },
    uDawn: { value: 0 },
    uTime: { value: 0 },
    uShipA: { value: V3() }, uShipB: { value: V3() }, uShipK: { value: 0 },
  };
  // Per-vertex aIce = (snow, cavity, fresh scrape, convexity).  In the shader: glacial white-grey to pale
  // blue ice varying in saturation, blue meltwater veins, a few stratified dirt bands and grime streaks,
  // snow on the tops and rime on the ridges and broken edges, glassy blue cracks and crevices, the clear
  // gouged face where the hull scraped, a ragged wet band at the waterline with running water; a soft
  // blue subsurface glow and the ghostly night rim; warm light and glints from the ship's lit side;
  // rocket flashes (TT.flashes).  Fine detail fades with distance so the far berg stays a calm ghost.
  function makeIceMaterial(opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, envMapIntensity: 0.8 });
    const bumpAmp = opts.bump != null ? opts.bump : 1.0;
    const objScale = opts.objScale || 1.0;
    const full = opts.lite ? '' : '-full';
    if (!opts.lite) m.defines = { TT_ICE_FULL: '' };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ICEU);
      sh.uniforms.uBump = { value: bumpAmp };
      sh.uniforms.uObjScale = { value: objScale };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uObjScale; attribute vec4 aIce; varying vec4 vIce; varying vec3 vObj; varying vec3 vWPos; varying vec3 vObjN;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vIce = aIce; vObj = position * uObjScale; vObjN = normal;
          { vec4 wp = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            #endif
            vWPos = (modelMatrix * wp).xyz; }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uFlashPos[4]; uniform vec3 uFlashCol[4]; uniform float uFlashRange[4];
          uniform float uGhost, uDawn, uTime, uShipK, uBump; uniform vec3 uShipA, uShipB;
          varying vec4 vIce; varying vec3 vObj; varying vec3 vWPos; varying vec3 vObjN;
          ${TT.glsl.noise}
          ${TTBUMP}
          float ttRidge(vec3 p){ return 1.0 - abs(snoise(p)); }
          vec3 ttHash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
          // cellular noise: x = F1, y = F2; cid = the nearest cell's random id, cr = offset to its feature point
          #ifdef TT_ICE_FULL
          vec2 ttVoronoi(vec3 p, out vec3 cid, out vec3 cr){
            vec3 ip = floor(p), fp = fract(p); float d1 = 8.0, d2 = 8.0; cid = vec3(0.5); cr = vec3(0.0);
            for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec3 g = vec3(float(i), float(j), float(k)), o = ttHash3(ip + g), r = g + o - fp; float d = dot(r, r);
              if (d < d1) { d2 = d1; d1 = d; cid = o; cr = r; } else if (d < d2) d2 = d;
            }
            return vec2(sqrt(d1), sqrt(d2));
          }
          #endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float snow = vIce.x, cav = vIce.y, fresh = vIce.z, cvx = vIce.w;
          float mpp = length(fwidth(vObj)) + 1e-4;              // metres per pixel (for anti-aliasing the detail)
          float f1 = 1.0 - smoothstep(0.35, 1.6, mpp * 0.6), f2 = 1.0 - smoothstep(0.08, 0.5, mpp), f3 = 1.0 - smoothstep(0.03, 0.18, mpp);
          float nY = vObjN.y * inversesqrt(max(dot(vObjN, vObjN), 1e-12));
          float steep = 1.0 - abs(nY);
          // shared noise fields (few calls: this shader is big enough)
          float gr = snoise(vObj * vec3(0.35, 0.9, 0.35));
          float m1 = snoise(vObj * 0.017 + 11.0), m2 = snoise(vObj * vec3(0.05, 0.1, 0.05) + 4.0);
          float w1 = snoise(vObj * 0.05), w2 = snoise(vObj * 0.05 + 9.0);
          #ifdef TT_ICE_FULL
          float vm = snoise(vObj * vec3(0.03, 0.06, 0.03) + 5.0);
          float ns = snoise(vObj * vec3(0.7, 0.03, 0.7) + 1.0);
          float nr = snoise(vObj * vec3(1.1, 0.06, 1.1) + 7.0);
          #else
          float vm = m2, ns = gr, nr = w1;                      // growlers: a lighter shader
          #endif
          // waterline: a ragged wet band up to a couple of metres, glassy blue-black below the surface
          float wetTop = 1.5 + 0.9 * snoise(vObj * vec3(0.07, 0.02, 0.07)) + 0.3 * gr;
          float wet = smoothstep(-0.7, 0.1, vWPos.y) * (1.0 - smoothstep(wetTop - 0.6, wetTop, vWPos.y));
          float below = smoothstep(-0.05, -1.4, vWPos.y);
          float riv = smoothstep(0.05, 0.6, nr) * wet;                                              // rivulets on the wet band
          float flow = 0.5 + 0.5 * sin(vObj.y * 6.0 + uTime * 5.0 + 5.0 * nr + 2.0 * ns);
          // glacial ice: bubbly white-grey to pale blue, the saturation drifting across the faces
          vec3 iceC = mix(vec3(0.7, 0.735, 0.765), vec3(0.47, 0.58, 0.68), smoothstep(-0.45, 0.7, m1 + 0.3 * m2));   // (the night light is blue already)
          iceC *= 0.93 + 0.1 * gr;
          // whole faces of old, bubble-free glacier ice: a clearer, deeper blue
          iceC = mix(iceC, vec3(0.3, 0.45, 0.58), smoothstep(0.35, 0.75, m2 - 0.5 * m1) * 0.65 * smoothstep(0.2, 0.6, steep));
          // blue veins of refrozen meltwater: thin tilted bands, broken up
          float vp = dot(vObj, vec3(0.24, 0.96, -0.14)) + 2.2 * w1;
          float vein = smoothstep(0.86, 0.985, sin(vp * 0.85)) * smoothstep(-0.1, 0.45, vm);
          vein += 0.6 * smoothstep(0.93, 0.995, sin(vp * 2.9 + 1.7)) * smoothstep(0.1, 0.5, vm + 0.3 * w2) * f1;
          vein = clamp(vein, 0.0, 1.0) * (1.0 - snow);
          // embedded dirt: a few stratified bands of dark grit, streaky and broken
          float dp = dot(vObj, vec3(0.33, 0.9, 0.28)) + 1.6 * w2 + 1.2 * m1;
          float dirt = smoothstep(0.88, 0.985, sin(dp * 0.8 + 1.3)) * smoothstep(-0.55, 0.05, -vm + 0.3 * m2);
          dirt = clamp(dirt * (0.7 + 0.5 * ns), 0.0, 1.0) * (1.0 - snow);
          // melt runnels and grime streaks down the steep faces
          iceC *= 1.0 + 0.28 * (ns + 0.4 * nr * f2) * steep;
          // snow on the tops; rime and crushed ice on exposed ridges, broken edges and the margins of the scrape
          float rime = smoothstep(0.3, 0.75, cvx + 0.3 * gr);
          rime = max(rime, smoothstep(0.12, 0.35, fresh) * (1.0 - smoothstep(0.45, 0.75, fresh)) * 0.9);
          rime *= (1.0 - wet) * (1.0 - below);
          float white = max(snow, rime * 0.85);
          vec3 snowC = vec3(0.86, 0.9, 0.95) * (0.95 + 0.05 * gr);
          vec3 alb = mix(iceC, snowC, white);
          // veins and dirt are in the ice itself: only fresh snow hides them
          alb = mix(alb, vec3(0.08, 0.26, 0.44), vein * 0.8);
          alb = mix(alb, vec3(0.09, 0.09, 0.085), dirt * 0.85);
          vec3 deepC = vec3(0.03, 0.16, 0.29);
          // relief (shared with the bump below): flutes, tilted layering, melt scallops, facets, cracks, grain
          float rFlute = mix(1.0, ttRidge(vObj * vec3(0.19, 0.025, 0.19) + vec3(w1 * 1.5, 0.0, w2 * 1.5)), clamp(0.5 + 0.8 * m2, 0.0, 1.0));
          float rFacet = ttRidge(vObj * 0.55);
          #ifdef TT_ICE_FULL
          float rimK = smoothstep(0.025, 0.12, mpp), sr = ttRidge(vObj * vec3(0.34, 0.5, 0.34) + 3.0);
          float scal = mix(sr * sr * sr * sr, sr * sr * 0.5, rimK);
          #else
          float scal = 0.0;
          #endif
          // fracture facets: patches of the cliffs (and the whole scraped face) spalled into flat, slightly tilted
          // plates, bright crushed ice along their broken edges, glassy blue in the seams
          vec3 fId = vec3(0.5), fR = vec3(0.0);
          float crack = 0.0, fEdge = 0.0, fGap = 1.0, facetM = 0.0;
          #ifdef TT_ICE_FULL
          facetM = clamp(smoothstep(-0.1, 0.45, snoise(vObj * 0.028 + 31.0)) + 0.8 * fresh, 0.0, 1.0) * smoothstep(0.1, 0.5, steep) * (1.0 - snow) * f1;
          if (facetM > 0.01) {
            vec2 fv = ttVoronoi(vObj * vec3(0.24, 0.16, 0.24) + 0.4 * vec3(w1, 0.0, w2), fId, fR);
            float gap = fv.y - fv.x, aa = mpp * 0.4; fGap = gap;
            crack = (1.0 - smoothstep(0.01, 0.045 + aa, gap)) * facetM;
            fEdge = max((1.0 - smoothstep(0.04, 0.16 + aa, gap)) * facetM - crack, 0.0);
          }
          #endif
          float iceH = 0.26 * f1 * rFlute + 0.06 * f2 * rFacet + 0.13 * f1 * scal
                     + 0.05 * f2 * sin((vObj.y + 0.2 * vObj.x) * 3.1 + gr * 1.5 + w1 * 2.0) * (0.4 + 0.6 * w2)
                     #ifdef TT_ICE_FULL
                     + (0.018 * snoise(vObj * 2.7) + 0.02 * ttRidge(vObj * 1.4)) * f3 - 0.1 * crack
                     #endif
                     + facetM * 1.5 * dot(fR, fId - 0.5) * smoothstep(0.0, 0.3, fGap);   // tilted plates, V-grooved seams (no steps: dFdx would dash them)
          // ridges catch the light as bubbly white ice, grooves and cracks run clear blue
          alb = mix(alb, alb * vec3(0.62, 0.78, 0.92), (1.0 - rFlute) * 0.25 * f1 * (1.0 - snow));
          alb = mix(alb, min(alb * 1.25, vec3(0.92)), smoothstep(0.75, 0.98, rFacet) * 0.45 * f2 * (1.0 - snow));
          alb *= mix(vec3(1.0), mix(vec3(0.74, 0.9, 1.08), vec3(1.14, 1.09, 1.04), fId.y), facetM * 0.8);   // each plate its own tone
          alb = mix(alb, vec3(0.84, 0.89, 0.93), clamp(fEdge, 0.0, 1.0) * 0.75);
          alb = mix(alb, vec3(0.06, 0.24, 0.42), crack * 0.8);
          // the scraped face: clear, glassy blue-grey ice with white crushed-ice gouges where the hull slid along it
          #ifdef TT_ICE_FULL
          float gouge = smoothstep(0.2, 0.8, snoise(vObj * vec3(0.03, 1.1, 0.25)) * 0.5 + 0.5) * smoothstep(0.45, 0.8, abs(vObjN.z) * inversesqrt(max(dot(vObjN, vObjN), 1e-12)));
          #else
          float gouge = 0.0;
          #endif
          vec3 freshC = mix(vec3(0.3, 0.41, 0.5), vec3(0.8, 0.83, 0.86), smoothstep(0.15, 0.65, gouge * (0.6 + 0.4 * gr) + 0.2 * nr));
          alb = mix(alb, freshC, fresh * 0.75);
          alb = mix(alb, deepC, smoothstep(0.1, 0.9, cav) * 0.6 * (1.0 - snow * 0.75));
          float band = sin((vObj.y + 0.22 * vObj.x - 0.1 * vObj.z) * 2.3 + gr * 2.5);
          alb *= 0.96 + 0.05 * band * (1.0 - snow) * (1.0 - smoothstep(0.3, 1.2, mpp));
          alb = mix(alb, alb * vec3(0.3, 0.4, 0.5), wet * (1.0 - below));
          alb = mix(alb, vec3(0.03, 0.14, 0.21), below);
          diffuseColor.rgb *= alb;`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(mix(0.46, 0.85, white), 0.15, fresh * 0.8);
          roughnessFactor = mix(roughnessFactor, 0.12, max(vein * 0.6, crack * 0.8));
          roughnessFactor = mix(roughnessFactor, 0.05, max(wet, below * 0.6));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float h = (iceH + 0.05 * f2 * fresh * gouge) * (1.0 - 0.7 * snow) * uBump;
            // running water on the wet band: rivulets trickling down, a shimmering film
            #ifdef TT_ICE_FULL
            h += wet * f2 * uBump * (0.012 * riv * sin(vObj.y * 17.0 + uTime * 7.0 + 3.0 * nr + 2.0 * gr)
                 + 0.006 * snoise(vec3(vObj.xz * 3.0, vObj.y * 1.5 + uTime * 1.6)));
            #endif
            normal = ttBump(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)), faceDirection);
          }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            vec3 vd = normalize(vViewPosition);
            float fres = pow(max(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 0.0), 3.0);
            vec3 wN = inverseTransformDirection(normal, viewMatrix);
            float up = 0.5 + 0.5 * wN.y;
            vec3 ghost = (vec3(0.10, 0.15, 0.215) * (0.12 + 0.07 * up) + vec3(0.12, 0.155, 0.19) * 0.75 * fres) * (1.0 - 0.65 * cav) * (0.75 + 0.5 * snow);
            ghost *= 0.15 + 1.25 * dot(diffuseColor.rgb, vec3(0.3, 0.4, 0.3));        // the material shows through the glow (dirt, wet, snow)
            // subsurface: light scattered in the ice leaks out bluer where it is clear or thin
            float sss = 0.35 * cav * (1.0 - snow) + 0.5 * vein + 0.08 * fresh + 0.3 * cvx * (1.0 - snow) + 0.4 * crack;
            ghost += vec3(0.008, 0.055, 0.11) * sss * (0.6 + 0.8 * fres);
            ghost += vec3(0.035, 0.065, 0.1) * riv * flow * (0.35 + fres);             // water running down, catching the sky
            ghost *= (1.0 - below * 0.8);
            totalEmissiveRadiance += uGhost * ghost;
            // warm light from the ship's lit side (a line of portholes along her length) and glints on wet ice
            if (uShipK > 0.0) {
              vec3 AB = uShipB - uShipA;
              float hh = clamp(dot(vWPos - uShipA, AB) / max(dot(AB, AB), 1e-3), 0.0, 1.0);
              vec3 Ls = uShipA + AB * hh - vWPos;
              float ld = length(Ls);
              vec3 Ld = Ls / max(ld, 1e-3);
              float dd = max(ld - 13.5, 0.4);
              float att = uShipK / (1.0 + dd * 0.3) * (1.0 - smoothstep(25.0, 90.0, dd)) * (1.0 - below * 0.85);
              vec3 warm = vec3(1.0, 0.55, 0.22);
              float ndl = max(dot(wN, Ld), 0.0);
              vec3 wV = inverseTransformDirection(vd, viewMatrix);
              float spec = pow(max(dot(reflect(-wV, wN), Ld), 0.0), 60.0);
              totalEmissiveRadiance += warm * att * (diffuseColor.rgb * (0.05 + 0.95 * ndl) * 0.2 + spec * (0.05 + 0.6 * wet + 0.4 * fresh + 0.3 * vein));
            }
            for (int i = 0; i < 4; i++) {
              vec3 L = uFlashPos[i] - vWPos; float d2 = max(dot(L, L), 1.0); float r = uFlashRange[i];
              float at = 1.0 / (1.0 + d2 / (r * r));
              float ndl = max(dot(wN, L * inversesqrt(d2)), 0.0);
              totalEmissiveRadiance += diffuseColor.rgb * uFlashCol[i] * at * (0.12 + 0.88 * ndl) * (1.0 - below * 0.8);
            }
          }`);
    };
    m.customProgramCacheKey = () => 'tt-ice2' + full;   // one program per variant for every ice mesh (per-material uniforms)
    return m;
  }

  // ------------------------------------------------------------------
  // BERG GENERATOR — built the way bergs are: a few calved blocks (convex
  // polytopes of leaning side planes and tilted top planes) smoothly unioned,
  // trimmed, notched at the waterline and eroded by 3D noise.  The implicit
  // field (F < 0 inside, ~metric) is polygonised with naive surface nets,
  // evaluating the expensive detail only in a narrow band around the surface.
  // ------------------------------------------------------------------
  function blockPlanes(b, rnd) {
    const planes = [];
    const k = b.sides || 8, lean = (b.lean != null ? b.lean : 8) * U.DEG, rot = (b.rot || 0) * U.DEG;
    for (let i = 0; i < k; i++) {
      const a = rot + (i + (rnd() - 0.5) * 0.55) * 2 * Math.PI / k;
      const ca = Math.cos(a), sa = Math.sin(a);
      const R = Math.sqrt(b.ax * b.ax * ca * ca + b.az * b.az * sa * sa) * (0.93 + rnd() * 0.14);
      let l = lean * (0.55 + rnd() * 0.9);
      if (b.shipLean != null && sa < -0.75) l = b.shipLean * U.DEG;
      planes.push([ca * Math.cos(l), Math.sin(l), sa * Math.cos(l), R * Math.cos(l)]);
    }
    for (const tp of b.tops || [[0, 0]]) {
      const az = tp[0] * U.DEG, ti = tp[1] * U.DEG;
      planes.push([Math.sin(ti) * Math.cos(az), Math.cos(ti), Math.sin(ti) * Math.sin(az), b.h * Math.cos(ti)]);
    }
    planes.push([0, -1, 0, -(b.base != null ? b.base : -14)]);
    return planes;
  }
  function bergField(o) {
    const rnd = U.rng('berg' + o.seed);
    const sx = o.seed * 13.7, sz = o.seed * 7.3;
    const blocks = o.blocks.map((b) => {
      const planes = blockPlanes(b, rnd);
      return { cx: b.c[0], cz: b.c[1], k: b.round || 1.1, planes, rad: Math.max(b.ax, b.az) * 1.25 + Math.abs(b.h) };
    });
    const blend = o.blend || 2.5;
    function blocksF(x, y, z) {
      let f = 1e9;
      for (let bi = 0; bi < blocks.length; bi++) {
        const B = blocks[bi], px = x - B.cx, pz = z - B.cz;
        const bound = Math.sqrt(px * px + pz * pz) - B.rad;
        if (bound > f + blend + 2) continue;                    // too far to matter
        const P = B.planes, k = B.k;
        let s = -1e9;
        for (let i = 0; i < P.length; i++) {
          const p = P[i], v = p[0] * px + p[1] * y + p[2] * pz - p[3];
          if (v > s + k) s = v;
          else if (v > s - k) { const h = 0.5 + 0.5 * (v - s) / k; s = s + (v - s) * h + k * h * (1 - h); }
        }
        if (s < f - blend) f = s;
        else if (s < f + blend) { const h = 0.5 + 0.5 * (f - s) / blend; f = f + (s - f) * h - blend * h * (1 - h); }
      }
      return f;
    }
    // the ship-facing wall; below the rail it reaches further out (shipReach) so that the hull's swept
    // path cuts into it all along the scrape and the carve leaves the ice grinding the plating
    const zS = (y) => o.shipZ - (o.shipReach || 0) * (1 - sstep(14, 22, y));
    const shipW = (y, z) => (o.shipZ != null ? sstep(zS(y) + 6, zS(y) + 1, z) : 0);
    function coarse(x, y, z) {
      const f = shape(x, y, z);
      return o.carve ? smax(f, o.carve(x, y, z), 0.5) : f;
    }
    function shape(x, y, z) {
      let f = blocksF(x, y, z);
      f += o.lumps * fbm(x * 0.045 + sx, y * 0.06, z * 0.045 + sz, 2) * (1 - 0.8 * shipW(y, z));
      if (o.shipZ != null) {
        const over = o.overhang * sstep(2.5, 14, y) * (1 - sstep(21, 28, y));
        f = smax(f, (zS(y) - over) - z, 0.8);
      }
      f += o.notch * Math.exp(-((y - 0.7) * (y - 0.7)) / 0.7);
      return f;
    }
    function F(x, y, z) { return fine(x, y, z, coarse(x, y, z)); }
    function fine(x, y, z, f) {
      const above = sstep(-1.5, 2.5, y);
      if (o.flutes) {
        // meltwater flutes: vertical grooves that come and go, bent by a slow warp so they never read as a pattern
        const wx = x + 4 * noise3(x * 0.04, y * 0.03 + 11, z * 0.04), wz = z + 4 * noise3(x * 0.04 + 7, y * 0.03, z * 0.04);
        const patch = clamp(0.5 + 0.9 * noise3(x * 0.035 + 3, y * 0.05, z * 0.035 + 5));
        f += o.flutes * patch * (ridged(wx * 0.24 + sz, y * 0.02, wz * 0.24 + sx, 3) - 0.45) * above;
      }
      if (o.strata) f += o.strata * Math.sin((y + 0.22 * x - 0.1 * z) * 1.1 + 1.8 * noise3(x * 0.04, y * 0.02, z * 0.04)) * above;
      if (o.crag) f -= o.crag * (ridged(x * 0.07 + sx, y * 0.03, z * 0.07 + sz, 3) - 0.35) * sstep(5, 14, y);
      f += o.rough * fbm(x * 0.13 + sz, y * 0.13, z * 0.13 + sx, 3);
      if (o.carve) f = smax(f, o.carve(x, y, z), 0.4);
      return f;
    }
    return { F, fine, coarse, shape };
  }

  // naive surface nets: bb = [x0, y0, z0, x1, y1, z1], cell size cs
  function surfaceNets(field, bb, cs, band) {
    const nx = Math.floor((bb[3] - bb[0]) / cs) + 1, ny = Math.floor((bb[4] - bb[1]) / cs) + 1, nz = Math.floor((bb[5] - bb[2]) / cs) + 1;
    const sxy = nx * ny, V = new Float32Array(sxy * nz);
    // two levels: the coarse field on a grid twice as sparse, interpolated; exact evaluation only
    // near the surface (the coarse field is ~1-Lipschitz, so 2 m of margin is safe)
    const mx = (nx >> 1) + 2, my = (ny >> 1) + 2, mz = (nz >> 1) + 2, mxy = mx * my;
    const Cg = new Float32Array(mxy * mz);
    for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++)
      Cg[i + j * mx + k * mxy] = field.coarse(bb[0] + i * 2 * cs, bb[1] + j * 2 * cs, bb[2] + k * 2 * cs);
    const fine = field.fine || ((x, y, z) => field.F(x, y, z));
    for (let k = 0; k < nz; k++) {
      const z = bb[2] + k * cs, k2 = k >> 1, wk = (k & 1) * 0.5;
      for (let j = 0; j < ny; j++) {
        const y = bb[1] + j * cs, j2 = j >> 1, wj = (j & 1) * 0.5;
        let idx = j * nx + k * sxy;
        for (let i = 0; i < nx; i++, idx++) {
          const x = bb[0] + i * cs, i2 = i >> 1, wi = (i & 1) * 0.5;
          const c0 = i2 + j2 * mx + k2 * mxy;
          const a00 = Cg[c0] + (Cg[c0 + 1] - Cg[c0]) * wi, a10 = Cg[c0 + mx] + (Cg[c0 + mx + 1] - Cg[c0 + mx]) * wi;
          const a01 = Cg[c0 + mxy] + (Cg[c0 + mxy + 1] - Cg[c0 + mxy]) * wi, a11 = Cg[c0 + mxy + mx] + (Cg[c0 + mxy + mx + 1] - Cg[c0 + mxy + mx]) * wi;
          const b0 = a00 + (a10 - a00) * wj, b1 = a01 + (a11 - a01) * wj;
          let f = b0 + (b1 - b0) * wk;
          if (f < band + 1.5 && f > -band - 1.5) {
            f = field.coarse(x, y, z);
            if (f < band && f > -band) f = fine(x, y, z, f);
          }
          if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) f = Math.max(f, 0.01);
          V[idx] = f;
        }
      }
    }
    const CO = [0, 1, nx, nx + 1, sxy, sxy + 1, sxy + nx, sxy + nx + 1];
    const EDG = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
    const cell = new Int32Array(cnx * cny * cnz).fill(-1);
    const pos = [];
    const val = new Float32Array(8);
    let nv = 0;
    for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
      const base = i + j * nx + k * sxy;
      let mask = 0;
      for (let c = 0; c < 8; c++) { val[c] = V[base + CO[c]]; if (val[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = EDG[e][0], b = EDG[e][1];
        if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
        const t = val[a] / (val[a] - val[b]);
        ax += (a & 1) + ((b & 1) - (a & 1)) * t;
        ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
        az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
        cnt++;
      }
      pos.push(bb[0] + (i + ax / cnt) * cs, bb[1] + (j + ay / cnt) * cs, bb[2] + (k + az / cnt) * cs);
      cell[i + j * cnx + k * cnx * cny] = nv++;
    }
    const idx = [];
    const cid = (i, j, k) => cell[i + j * cnx + k * cnx * cny];
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) { const t = b; b = d; d = t; }
      // split along the shorter diagonal
      const d1 = (pos[a * 3] - pos[c * 3]) ** 2 + (pos[a * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[c * 3 + 2]) ** 2;
      const d2 = (pos[b * 3] - pos[d * 3]) ** 2 + (pos[b * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[d * 3 + 2]) ** 2;
      if (d1 <= d2) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
    };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = i + j * nx + k * sxy, inside = V[p] < 0;
      if (i < cnx && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && inside !== (V[p + 1] < 0))
        quad(cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k), !inside);
      if (j < cny && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && inside !== (V[p + nx] < 0))
        quad(cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1), !inside);
      if (k < cnz && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && inside !== (V[p + sxy] < 0))
        quad(cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k), !inside);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(nv > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
    return geo;
  }

  function buildBerg(field, o) {
    // o: {bb, cs, band, freshAt, snowLine, aoScale}
    const geo = surfaceNets(field, o.bb, o.cs, o.band || 3.5);
    geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const Fc = field.shape || field.coarse;      // AO from the uncarved form (the carve's grid would print blocks)
    const ice = new Float32Array(n * 4);
    const aoS = o.aoScale || 1, snowLine = o.snowLine || 18;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      // ambient occlusion and (below) convexity, both measured relative to the field at the vertex: the fine
      // erosion moved the surface off Fc = 0, and the scraped face lies inside the uncarved form
      const F0 = Fc(x, y, z);
      let occ = 0;
      for (let k = 1; k <= 4; k++) {
        const d = k * 1.5 * aoS;
        occ += Math.max(0, d - (Fc(x + nx * d, y + ny * d, z + nz * d) - F0)) / d / k;
      }
      const cav = clamp(occ * 0.85 - 0.1);
      // convexity: how thin the ice is just inside the surface (ridges, edges, pinnacles)
      let thin = 0;
      for (let k = 1; k <= 3; k++) {
        const d = k * 1.1 * aoS;
        thin += Math.max(0, Fc(x - nx * d, y - ny * d, z - nz * d) - F0 + d) / d / k;
      }
      const patch = 0.5 + 0.5 * noise3(x * 0.11, y * 0.11, z * 0.11);
      const snow = clamp(sstep(0.45, 0.85, ny) * sstep(1.0, 5 * aoS, y) * (0.5 + 0.7 * patch) + 0.3 * sstep(0.15, 0.5, ny) * sstep(snowLine, snowLine + 8, y));
      const fresh = o.freshAt ? o.freshAt(x, y, z) : 0;
      ice[i * 4] = snow * (1 - fresh); ice[i * 4 + 1] = cav * (1 - 0.6 * snow); ice[i * 4 + 2] = fresh; ice[i * 4 + 3] = clamp(thin * 0.9 - 0.05);
    }
    geo.setAttribute('aIce', new THREE.BufferAttribute(ice, 4));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }

  // After the impact the ship's bow swings away to port faster than her widening side slides along the
  // ice, so a fixed berg would lose contact within a couple of seconds.  The berg is nudged a few metres
  // toward her (canonical -Z) while she scrapes past (74-83 s) and eases back before its drift begins;
  // the hull-sweep carve below includes the nudge, so the ice keeps grinding the plating all along.
  const BERG_PUSH = U.curve([[72.8, 0], [74, 1.2], [75, 1.8], [76.5, 2.4], [79, 2.8], [81, 3.1], [83, 3.4], [86, 2.9], [92, 0]]);
  const bergPush = (t) => (t <= 72.8 || t >= 92 ? 0 : BERG_PUSH(t));

  // The ship's starboard bow sweeps past the berg (story trajectory, t = 68..92).
  // Rasterise the swept hull side into canonical-frame grids at several heights and
  // distance-transform them, so the berg can be carved to just clear the hull above the
  // water (and grind it below): carve(x,y,z) > 0 means "outside" (inside the swept hull).
  function hullSweep(innerRot) {
    // Two sweeps: the hull while the bow closes on the berg (the ice must stay clear so it isn't
    // touched too early) and from then on (the ice may kiss the plating above the water and grind
    // ~0.5 m into it below).
    const EV = TT.story.EV, S2 = TT.story.makeState(), T_SPLIT = EV.impact - 0.8;
    const X0 = -50, Z0 = -56, CS = 0.5, NX = 200, NZ = 140, Y0 = -10, NB = 35;   // bands y = -10 .. 24, 1 m apart
    // flat 3D grids with a one-cell border of "far" so the distance transform needs no bounds checks
    const PX = NX + 2, PZ = NZ + 2, PB = NB + 2, SL = PX * PZ;
    const early = new Float32Array(SL * PB).fill(1e4), late = new Float32Array(SL * PB).fill(1e4);
    const m = new THREE.Matrix4();
    const SX0 = SH.SUPERSTRUCTURE_X[0], SX1 = SH.SUPERSTRUCTURE_X[1];
    for (let t = EV.impact - 6; t <= EV.impact + 18; t += 0.1) {
      TT.story.sample(t, S2);
      P.matrix(S2.ship.intact, m);
      const rot = S2.iceberg.yaw + innerRot, c = Math.cos(rot), s = Math.sin(rot), push = bergPush(t);
      const e = m.elements, bp = S2.iceberg.pos.clone().add(new THREE.Vector3(-s * push, 0, -c * push));
      const G = t < T_SPLIT ? early : late;
      for (let b = 0; b < NB; b++) {
        const y = Y0 + b, base = (b + 1) * SL;
        for (let x = SX0 - 10; x <= SH.STEM_X + 0.01; x += 0.7) {
          let hb;
          if (y <= TT.hull.sheer(x) + 1.2) hb = TT.hull.halfBeam(x, Math.min(y, 14.9));   // hull side up to the rail
          else if (x > SX0 && x < SX1 && y < 23.5) hb = 14.6;                               // superstructure, boats, davits
          else continue;
          if (hb <= 0.05) continue;
          for (let k = y < 0 ? 1 : 0; k < 10; k++) {
            const z = hb - k * 0.55;
            if (z < 0) break;
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12] - bp.x, wz = e[2] * x + e[6] * y + e[10] * z + e[14] - bp.z;
            const ix = Math.round((wx * c - wz * s - X0) / CS), iz = Math.round((wx * s + wz * c - Z0) / CS);
            if (ix >= 0 && ix < NX && iz >= 0 && iz < NZ) G[base + (iz + 1) * PX + ix + 1] = 0;
          }
        }
      }
    }
    // 3D chamfer distance transform in metres (cells 0.5 m, bands 1 m): smooth between bands
    const OI = [], OW = [];
    for (let db = -1; db <= 0; db++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (db === 0 && (dz > 0 || (dz === 0 && dx >= 0))) continue;
      OI.push(db * SL + dz * PX + dx); OW.push(Math.hypot(dx * CS, dz * CS, db));
    }
    const NO = OI.length;
    for (const A of [early, late]) {
      for (let b = 1; b <= NB; b++) for (let z = 1; z <= NZ; z++) {
        let i = b * SL + z * PX + 1;
        for (let x = 1; x <= NX; x++, i++) {
          let d = A[i];
          for (let k = 0; k < NO; k++) { const v = A[i + OI[k]] + OW[k]; if (v < d) d = v; }
          A[i] = d;
        }
      }
      for (let b = NB; b >= 1; b--) for (let z = NZ; z >= 1; z--) {
        let i = b * SL + z * PX + NX;
        for (let x = NX; x >= 1; x--, i--) {
          let d = A[i];
          for (let k = 0; k < NO; k++) { const v = A[i - OI[k]] + OW[k]; if (v < d) d = v; }
          A[i] = d;
        }
      }
    }
    function lookup(A, b, x, z) {
      const fx = (x - X0) / CS, fz = (z - Z0) / CS;
      if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return 1e3;
      const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, w = fz - iz, i = (b + 1) * SL + (iz + 1) * PX + ix + 1;
      return (A[i] * (1 - u) + A[i + 1] * u) * (1 - w) + (A[i + PX] * (1 - u) + A[i + PX + 1] * u) * w;
    }
    function dist(A, x, y, z) {
      const f = y - Y0;
      if (f <= 0) return lookup(A, 0, x, z);
      if (f >= NB - 1) return lookup(A, NB - 1, x, z) + (f - NB + 1);
      const b = Math.floor(f);
      return lerp(lookup(A, b, x, z), lookup(A, b + 1, x, z), f - b);
    }
    return {
      carve: (x, y, z) => {
        const above = sstep(-0.8, 0.8, y);
        return Math.max(lerp(0.8, 1.2, above) - dist(early, x, y, z), lerp(0.0, 0.12, above) - dist(late, x, y, z));
      },
      freshAt: (x, y, z) => (1 - sstep(0.6, 3.5, dist(late, x, y, z))) * sstep(-0.5, 0.5, y),
    };
  }

  // Hero berg (canonical frame: -Z faces the ship's starboard side at impact, +X points
  // along the ship's course at impact).  Waterline face on the ship side 21 m from the
  // centre, a sheer overhanging cliff, ~28 m peak, ~72 x 50 m, submerged skirt / ram.
  const HERO = {
    seed: 7, shipZ: -24, shipReach: 3.5, overhang: 1.6, notch: 0.9, lumps: 1.3, flutes: 0.8, strata: 0.06, rough: 0.5, crag: 2.8, blend: 1.7,
    blocks: [
      { c: [-4, 1], ax: 33, az: 30, h: 12.5, lean: 8, shipLean: -4, sides: 11, tops: [[0, 11], [150, 5], [60, 15], [250, 13], [305, 17]], rot: 10, round: 0.9 }, // massif
      { c: [-13, -6], ax: 15, az: 16, h: 28.5, lean: 9, shipLean: -3, sides: 8, tops: [[20, 55], [200, 58], [110, 42], [300, 50], [160, 47]], rot: 25, round: 0.7 }, // the tower
      { c: [22, 2], ax: 14, az: 18, h: 14.5, lean: 12, sides: 8, tops: [[0, 28], [120, 22], [250, 18], [60, 30]], rot: -5, round: 0.8 },   // east ridge
      { c: [6, 12], ax: 8, az: 8, h: 22, lean: 16, sides: 7, tops: [[60, 52], [240, 56], [150, 40], [330, 48]], rot: 40, round: 0.5 },    // back spire
      { c: [-31, 10], ax: 9, az: 12, h: 18, lean: 14, sides: 7, tops: [[180, 30], [90, 22], [300, 25]], rot: 0, round: 0.8 },             // west shoulder
      { c: [-3, 4], ax: 39, az: 30, h: -3.6, base: -12, lean: -5, sides: 10, tops: [[0, 0]], rot: 5, round: 1.5 },                        // submerged skirt
    ],
  };

  // ==================================================================
  // 1. THE ICEBERG + growlers
  // ==================================================================
  function buildIceberg(ctx) {
    const q = ctx.quality;
    const group = new THREE.Group(); group.name = 'iceberg';
    const inner = new THREE.Group(); inner.name = 'iceberg canonical';
    group.add(inner);
    const EV = TT.story.EV;
    const hImpact = TT.story.TR ? TT.story.TR.heading(EV.impact) : 0.23;
    inner.rotation.y = hImpact - 0.6;      // designed for the story's default yaw 0.6

    const cs = q === 'high' ? 0.52 : q === 'medium' ? 0.7 : 1.0;
    let sweep = null;
    try { sweep = hullSweep(inner.rotation.y); } catch (e) { TT.error('props hullSweep', e); }
    const field = bergField(Object.assign({}, HERO, sweep ? { carve: sweep.carve } : {}));
    const geo = buildBerg(field, { bb: [-46, -13, -30, 44, 32, 38], cs, band: 3.0, snowLine: 17, freshAt: sweep && sweep.freshAt });
    const mat = makeIceMaterial({ bump: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'iceberg mesh';
    inner.add(mesh);

    // growlers: small bobbing chunks around the berg (canonical frame, clear of the ship's track)
    const gField = bergField({ seed: 3, lumps: 1.2, flutes: 0.5, strata: 0, rough: 0.9, crag: 1.2, notch: 0.3, blend: 1.2,
      blocks: [{ c: [0, 0], ax: 9, az: 7, h: 6, lean: 20, sides: 7, tops: [[30, 25], [210, 20], [120, 30]], base: -6, round: 0.5 },
        { c: [4, 2], ax: 5, az: 5, h: 8.5, lean: 25, sides: 5, tops: [[100, 35], [280, 30]], base: -6, round: 0.5 },
        { c: [-5, -2], ax: 4, az: 4, h: 7, lean: 15, sides: 5, tops: [[200, 40], [20, 30]], base: -6, round: 0.5 }] });
    const gGeo = buildBerg(gField, { bb: [-14, -7, -12, 14, 11, 12], cs: 1.55, band: 3, snowLine: 6, aoScale: 0.5 });
    gGeo.scale(0.24, 0.24, 0.24);
    const gMat = makeIceMaterial({ bump: 0.25, lite: true });
    const NG = 30;
    const growlers = new THREE.InstancedMesh(gGeo, gMat, NG);
    growlers.name = 'growlers';
    growlers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    growlers.frustumCulled = false;
    inner.add(growlers);
    const r = U.rng('growlers'), G = [];
    for (let i = 0; i < NG; i++) {
      let x, z;
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, d = 30 + Math.pow(r(), 1.3) * 150;
        x = Math.cos(a) * d; z = 4 + Math.sin(a) * d * 0.8;
        if (!(z < -8 && z > -75)) break;   // keep the ship's lane clear
      }
      G.push({ x, z, s: 0.45 + Math.pow(r(), 2) * 1.5, yaw: r() * 6.28, ph: r() * 6.28, dr: 0.2 + r() * 0.5, tilt: (r() - 0.5) * 0.5 });
    }
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V3(), _s = V3();

    return {
      group, mesh, inner,
      update(t, S) {
        const I = S.iceberg;
        group.visible = I.visible > 0;
        if (!group.visible) return;
        const rot = I.yaw + inner.rotation.y, c = Math.cos(rot), s = Math.sin(rot), push = bergPush(t);
        group.position.set(I.pos.x - s * push, 0, I.pos.z - c * push);
        group.rotation.y = I.yaw;
        for (let i = 0; i < NG; i++) {
          const g = G[i];
          const wx = group.position.x + g.x * c + g.z * s, wz = group.position.z - g.x * s + g.z * c;
          const h = seaH(wx, wz, t);
          _p.set(g.x + Math.sin(t * 0.05 + g.ph) * g.dr * 3, h - 0.35 * g.s + 0.12 * Math.sin(t * 0.9 + g.ph), g.z);
          _e.set(g.tilt * 0.3 + 0.05 * Math.sin(t * 0.7 + g.ph), g.yaw + t * 0.01 * (g.dr - 0.45), g.tilt * 0.2 + 0.05 * Math.cos(t * 0.8 + g.ph));
          _q.setFromEuler(_e);
          _s.setScalar(g.s);
          growlers.setMatrixAt(i, _m.compose(_p, _q, _s));
        }
        growlers.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // ==================================================================
  // Geometry helpers (vertex-coloured merged parts)
  // ==================================================================
  function colorize(geo, col, extra) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (extra) for (const k in extra) {
      const a = new Float32Array(n).fill(extra[k]);
      geo.setAttribute(k, new THREE.BufferAttribute(a, 1));
    }
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    return geo;
  }
  function box(w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0, extra) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    return colorize(g, col, extra);
  }
  function cyl(r0, r1, h, seg, x, y, z, col, rx = 0, ry = 0, rz = 0, extra, open) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!open);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    return colorize(g, col, extra);
  }
  function merge(list) {
    const g = TT.addons.BufferGeometryUtils.mergeGeometries(list, false);
    for (const x of list) x.dispose();
    return g;
  }
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };   // sRGB hex -> linear rgb

  // ==================================================================
  // 2. LIFEBOATS — sixteen 30 ft wooden boats (instanced), falls, oars,
  //    seated passengers (one instanced mesh, per-instance variants), lanterns.
  // ==================================================================
  const BL = SH.BOAT_LEN, BB = SH.BOAT_BEAM, BD = SH.BOAT_DEPTH;
  const boatHalfBeam = (x) => { const u = clamp(Math.abs(x) / (BL / 2)); return (BB / 2) * Math.pow(Math.max(0, 1 - Math.pow(u, 2.3)), 0.62); };
  const gunwaleY = (x) => { const u = x / (BL / 2); return BD / 2 + 0.24 * u * u; };
  const KEEL_Y = -BD / 2;

  function boatHullGeometry() {
    const NS = 28, NV = 9;
    const WHITE = lin(0xe8e4da), VARN = lin(0x6a3a1c), WOOD = lin(0x9a6a40), DARK = lin(0x2a2a2a);
    const pos = [], col = [], idx = [];
    const ring = (inner) => {
      const base = pos.length / 3;
      for (let s = 0; s <= NS; s++) {
        const x = lerp(-BL / 2, BL / 2, s / NS), b = boatHalfBeam(x), gy = gunwaleY(x);
        for (let v = 0; v <= NV; v++) {
          const q = v / NV;                                         // 0 gunwale .. 1 keel
          const w = b * Math.sqrt(Math.max(0, 1 - Math.pow(q, 2.4)));
          const y = lerp(gy, KEEL_Y, Math.pow(q, 0.9));
          for (const side of [1, -1]) {
            const ins = inner ? 0.06 : 0;
            pos.push(x, y + (inner ? 0.03 : 0), side * Math.max(0, w - ins));
            const c = inner ? WOOD : (q < 0.08 ? VARN : WHITE);
            col.push(c[0], c[1], c[2]);
          }
        }
      }
      return base;
    };
    const o = ring(false), inn = ring(true);
    const R = (NV + 1) * 2;
    const vi = (b, s, v, side) => b + s * R + v * 2 + (side > 0 ? 0 : 1);
    for (let s = 0; s < NS; s++) for (let v = 0; v < NV; v++) for (const side of [1, -1]) {
      const a = vi(o, s, v, side), b = vi(o, s + 1, v, side), c = vi(o, s + 1, v + 1, side), d = vi(o, s, v + 1, side);
      if (side > 0) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
      const a2 = vi(inn, s, v, side), b2 = vi(inn, s + 1, v, side), c2 = vi(inn, s + 1, v + 1, side), d2 = vi(inn, s, v + 1, side);
      if (side > 0) idx.push(a2, b2, d2, b2, c2, d2); else idx.push(a2, d2, b2, b2, d2, c2);
    }
    // gunwale cap joining outer and inner rims
    for (let s = 0; s < NS; s++) for (const side of [1, -1]) {
      const a = vi(o, s, 0, side), b = vi(o, s + 1, 0, side), c = vi(inn, s + 1, 0, side), d = vi(inn, s, 0, side);
      if (side > 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    hull.setIndex(idx);
    hull.computeVertexNormals();
    const parts = [hull.toNonIndexed()];
    hull.dispose();
    // varnished rubbing strake, a lower strake and the gunwale capping: continuous rectangular
    // sections swept along the sheer (no stepped segments at the curved ends)
    const sweep = (yAt, zAt, hh, ww, col) => {
      const N = 24, C4 = [[0, ww / 2], [0, -ww / 2], [-hh, -ww / 2], [-hh, ww / 2]];
      for (const side of [1, -1]) {
        const pos = [], idx = [];
        for (let f = 0; f < 4; f++) {
          if (f === 2) continue;                        // underside of the strips: never seen
          const c0 = C4[f], c1 = C4[(f + 1) % 4], base = pos.length / 3;
          for (let k = 0; k <= N; k++) {
            const x = lerp(-BL / 2 + 0.16, BL / 2 - 0.16, k / N), y = yAt(x), z = zAt(x);
            pos.push(x, y + c0[0], side * (z + c0[1]), x, y + c1[0], side * (z + c1[1]));
          }
          for (let k = 0; k < N; k++) { const q = base + k * 2; if (side > 0) idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); else idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx); g.computeVertexNormals();
        parts.push(colorize(g, col));
      }
    };
    sweep((x) => gunwaleY(x) + 0.025, (x) => boatHalfBeam(x) + 0.01, 0.09, 0.07, VARN);            // rubbing strake
    sweep((x) => gunwaleY(x) - 0.29, (x) => boatHalfBeam(x) * 0.97 + 0.02, 0.06, 0.045, VARN);     // lower strake
    sweep((x) => gunwaleY(x) + 0.045, (x) => Math.max(0.03, boatHalfBeam(x) - 0.03), 0.035, 0.12, VARN);   // capping
    // thwarts, stern sheets, bottom boards, keel, stems, rudder, mast
    for (const tx of [-2.7, -1.35, 0, 1.35, 2.7]) parts.push(box(0.24, 0.05, boatHalfBeam(tx) * 2 - 0.12, tx, 0.18, 0, WOOD));
    for (let x = -3.95; x < -2.9; x += 0.15) parts.push(box(0.16, 0.05, 2 * Math.max(0.05, boatHalfBeam(x) * 0.93 - 0.1), x + 0.075, 0.18, 0, WOOD));   // stern sheets, planked to the curve
    parts.push(box(7.2, 0.04, 1.4, 0, -0.38, 0, lin(0x7a5232)));
    parts.push(box(BL - 0.4, 0.14, 0.1, 0, KEEL_Y - 0.05, 0, VARN));
    parts.push(box(0.12, 1.35, 0.1, BL / 2 - 0.05, 0.05, 0, VARN, 0, 0, -0.08), box(0.12, 1.35, 0.1, -BL / 2 + 0.05, 0.05, 0, VARN, 0, 0, 0.08));
    // rudder: a tapered varnished blade hung on the sternpost, its tiller reaching forward over the stern sheets
    { const g = new THREE.BufferGeometry(), x0 = -BL / 2 - 0.02, T = 0.025;
      const P2 = [[x0 - 0.1, 0.3], [x0 - 0.42, 0.05], [x0 - 0.5, -0.8], [x0, -0.95], [x0, 0.62]];   // counter-clockwise from +z
      const v = [];
      const tri = (a, b, c, z) => v.push(P2[a][0], P2[a][1], z, P2[b][0], P2[b][1], z, P2[c][0], P2[c][1], z);
      for (const z of [T, -T]) { if (z > 0) { tri(0, 1, 2, z); tri(0, 2, 3, z); tri(0, 3, 4, z); } else { tri(0, 2, 1, z); tri(0, 3, 2, z); tri(0, 4, 3, z); } }
      for (let k = 0; k < 5; k++) { const a = P2[k], b = P2[(k + 1) % 5]; v.push(a[0], a[1], T, a[0], a[1], -T, b[0], b[1], T, b[0], b[1], T, a[0], a[1], -T, b[0], b[1], -T); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
      parts.push(colorize(g, lin(0x7a4a26))); }
    parts.push(box(0.95, 0.05, 0.05, -BL / 2 + 0.38, 0.66, 0, VARN, 0, 0, 0.12));                 // tiller
    // side benches along the inside of the planking, between the thwarts
    for (const side of [1, -1]) for (let s = 0; s < 12; s++) {
      const x0 = lerp(-3.1, 2.9, s / 12), x1 = lerp(-3.1, 2.9, (s + 1) / 12), xm = (x0 + x1) / 2;
      const b0 = boatHalfBeam(x0) - 0.3, b1 = boatHalfBeam(x1) - 0.3, len = Math.hypot(x1 - x0, b1 - b0);
      parts.push(box(len + 0.02, 0.04, 0.3, xm, 0.13, side * (b0 + b1) / 2, WOOD, 0, -Math.atan2(b1 - b0, x1 - x0) * side, 0));
    }
    // rowlocks (brass crutches) at the four pairs of oars
    for (const ox of [-2.05, -0.7, 0.65, 2.0]) for (const side of [1, -1]) {
      const zz = side * (boatHalfBeam(ox) + 0.02), yy = gunwaleY(ox) + 0.09;
      parts.push(box(0.07, 0.09, 0.025, ox, yy, zz, lin(0x8a6a30)));
    }
    parts.push(cyl(0.045, 0.06, 3.4, 6, 0.3, 0.3, 0.42, lin(0xb08050), 0, 0, Math.PI / 2));   // the mast, unstepped, lying on the thwarts
    parts.push(cyl(0.025, 0.025, 0.75, 4, -3.98, 1.02, 0, VARN));            // lantern pole at the stern
    // name board strip, number plates (dark) near the bow
    parts.push(box(0.9, 0.12, 0.02, 3.2, gunwaleY(3.2) - 0.16, boatHalfBeam(3.2) + 0.035, DARK, 0, -0.2, 0), box(0.9, 0.12, 0.02, 3.2, gunwaleY(3.2) - 0.16, -boatHalfBeam(3.2) - 0.035, DARK, 0, 0.2, 0));
    for (const p of parts) { if (p.attributes.uv) p.deleteAttribute('uv'); if (!p.attributes.normal) p.computeVertexNormals(); }
    const g = merge(parts);
    g.computeBoundingSphere();
    return g;
  }

  function oarGeometry() {
    // pivot (rowlock) at origin, oar along +Z (outboard); handle inboard at -1.3, blade at +3.0
    const W = lin(0xb89a6e), B = lin(0xd8d2c4);
    return merge([
      cyl(0.03, 0.03, 4.1, 5, 0, 0, 0.75, W, Math.PI / 2, 0, 0),
      box(0.13, 0.025, 0.85, 0, 0, 2.75, B),
      cyl(0.035, 0.035, 0.3, 5, 0, 0, -1.25, W, Math.PI / 2, 0, 0),
    ]);
  }

  // Seated survivor, facing +X, origin on the seat (hips).  Built from smooth lathes, capsules and
  // spheres so close shots read as huddled people, not blocks.  hi = near LOD (~1600 tris) / far LOD (~250).
  // Per-vertex aSel = (instance channel, accepted-value bitmask) toggles the variant parts:
  //   iVar.x hat (0 bare, 1 bowler, 2 woman's hat, 3 flat cap)   iVar.y cork life jacket (0/1)
  //   iVar.z wrap (0 none, 1 shawl, 2 hooded shawl, 3 blanket)    iVar.w legs (0 trousers, 1 skirt)
  // aTint: 0 fixed colour, 1 coat (iCoat), 2 shawl / blanket (iAcc), 3 woman's hat, 4 hair.
  const PERSON_PROF = [[0.165, -0.03], [0.184, 0.05], [0.174, 0.16], [0.157, 0.27], [0.166, 0.37], [0.176, 0.46], [0.166, 0.525], [0.125, 0.568], [0.07, 0.598], [0.046, 0.64]];
  function personGeometry(hi) {
    const SEG = hi ? 9 : 6;
    const PROF = hi ? PERSON_PROF : [0, 2, 5, 7, 9].map((i) => PERSON_PROF[i]);
    const out = [], _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    const hunch = (y) => 0.1 * Math.pow(Math.max(0, y) / 0.6, 2);          // rounded, stooped back
    const HX = hunch(0.64) + 0.03, HY = 0.712;                               // head centre, a little bowed
    const add = (g, col, tint, sel) => {
      if (g.attributes.uv) g.deleteAttribute('uv');
      g = g.index ? g.toNonIndexed() : g;
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, n = p.count;
      const c = new Float32Array(n * 3), a = new Float32Array(n), s = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const cc = typeof col === 'function' ? col(x, y, z) : col;
        c[i * 3] = cc[0]; c[i * 3 + 1] = cc[1]; c[i * 3 + 2] = cc[2];
        a[i] = typeof tint === 'function' ? tint(x, y, z) : tint;
        s[i * 2] = sel ? sel[0] : -1; s[i * 2 + 1] = sel ? sel[1] : 0;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('aTint', new THREE.BufferAttribute(a, 1));
      g.setAttribute('aSel', new THREE.BufferAttribute(s, 2));
      out.push(g);
    };
    // smooth lathe around the body axis: profile [[r, y]], radius offset/scale, hunched, merged seam
    const shell = (prof, off, k, seg, deform, gap) => {
      let g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * k + off, y)), seg, gap ? Math.PI / 2 + gap / 2 : 0, Math.PI * 2 - (gap || 0));
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = TT.addons.BufferGeometryUtils.mergeVertices(g, 1e-4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) * 0.66, y = p.getY(i), z = p.getZ(i) * 1.1;
        if (deform) { const r = deform(x, y, z); x = r[0]; y = r[1]; z = r[2]; }
        p.setXYZ(i, x + hunch(y), y, z);
      }
      g.computeVertexNormals();
      return g;
    };
    const capsule = (a, b, r, rs) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
      const g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), 1, rs);
      g.applyQuaternion(_q.setFromUnitVectors(UP, d.normalize()));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      return g;
    };
    const ellip = (rx, ry, rz, x, y, z, ws, hs, t0, t1) => {
      const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, t0 || 0, t1 || Math.PI);
      g.scale(rx, ry, rz); g.translate(x, y, z); return g;
    };
    const W = [1, 1, 1], D7 = [0.62, 0.62, 0.62];
    const SKIN = lin(0xb48c74), BLACK = lin(0x151416), TWEED = lin(0x3a3630), CORK = lin(0xcfc8b2), STRAP = lin(0xa89f8a);
    const done = () => {
      const g = TT.addons.BufferGeometryUtils.mergeGeometries(out, false);
      for (const x of out) x.dispose();
      g.computeBoundingSphere();
      return g;
    };
    if (!hi) {
      // far LOD (~250 tris): coat, lap, head, one generic hat, one wrap shell, jacket panels
      add(shell(PROF, 0, 1, 6), W, 1);
      add(ellip(0.25, 0.1, 0.19, 0.2, 0.07, 0, 5, 2, 0, Math.PI / 2), W, 1);
      { const g = new THREE.CylinderGeometry(0.13, 0.17, 0.48, 5, 1, true); g.scale(0.7, 1, 1.05); g.translate(0.42, -0.2, 0); add(g, D7, 1); }
      const hair = (x, y) => (x - HX < 0.012 || (y - HY > 0.05 && x - HX < 0.07)) ? 4 : 0;
      add(ellip(0.093, 0.107, 0.08, HX, HY, 0, 6, 4), (x, y) => (hair(x, y) ? W : SKIN), (x, y) => hair(x, y));
      const HT = HY + 0.075;
      { const g = new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8, 1); g.translate(HX - 0.01, HT, 0); add(g, BLACK, 0, [0, 2 | 8]); }
      { const g = new THREE.CylinderGeometry(0.21, 0.21, 0.02, 8, 1); g.translate(HX - 0.02, HT + 0.005, 0); add(g, W, 3, [0, 4]); }
      { const g = new THREE.CylinderGeometry(0.09, 0.1, 0.09, 5, 1, true); g.translate(HX - 0.015, HT + 0.05, 0); add(g, BLACK, 0, [0, 2 | 4 | 8]); }
      add(shell(PROF.filter((p) => p[1] > 0.1), 0.03, 1.05, 6), W, 2, [2, 2 | 4 | 8]);
      add(ellip(0.104, 0.118, 0.095, HX - 0.012, HY + 0.008, 0, 5, 3, 0, Math.PI * 0.6), W, 2, [2, 4]);
      for (const sx of [1, -1]) { const g = new THREE.PlaneGeometry(0.3, 0.28); g.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(sx * 0.14 + hunch(0.38), 0.38, 0); add(g, CORK, 0, [1, 2]); }
      return done();
    }
    // --- body: the coat, a lap, arms hugging the body, legs ---
    add(shell(PROF, 0, 1, SEG), W, 1);
    if (hi) {
      for (const sd of [-1, 1]) {
        add(capsule([0.035, 0.475, sd * 0.19], [0.13, 0.285, sd * 0.215], 0.052, 6), W, 1);        // upper arm
        add(capsule([0.13, 0.285, sd * 0.215], [0.3, 0.225, sd * 0.07], 0.047, 6), W, 1);          // forearm across the lap
        add(ellip(0.045, 0.035, 0.04, 0.33, 0.225, sd * 0.045, 5, 3), SKIN, 0);                   // hands
      }
      // trousers: thighs forward, shins down, boots
      for (const sd of [-1, 1]) {
        add(capsule([0.0, 0.075, sd * 0.095], [0.4, 0.085, sd * 0.1], 0.078, 6), D7, 1, [3, 1]);
        { const g = new THREE.CylinderGeometry(0.06, 0.05, 0.46, 6, 1, true); g.rotateZ(0.07); g.translate(0.435, -0.17, sd * 0.1); add(g, D7, 1, [3, 1]); }
      }
      // skirt: over the lap and falling to the boards
      add(ellip(0.25, 0.1, 0.19, 0.2, 0.07, 0, 8, 4), W, 1, [3, 2]);
      { const g = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 9, 1, true); g.scale(0.65, 1, 1.05); g.translate(0.4, -0.2, 0); add(g, [0.8, 0.8, 0.8], 1, [3, 2]); }
    } else {
      add(ellip(0.25, 0.1, 0.19, 0.2, 0.07, 0, 6, 3), W, 1);                                       // lap
      { const g = new THREE.CylinderGeometry(0.13, 0.17, 0.48, 6, 1, true); g.scale(0.7, 1, 1.05); g.translate(0.42, -0.2, 0); add(g, D7, 1); }
    }
    // --- head: face forward, hair at the back and on top ---
    {
      const g = ellip(0.093, 0.107, 0.08, HX, HY, 0, hi ? 10 : 6, hi ? 7 : 4);
      const hair = (x, y) => (x - HX < 0.012 || (y - HY > 0.05 && x - HX < 0.07)) ? 4 : 0;
      add(g, (x, y) => (hair(x, y) ? W : SKIN), (x, y) => hair(x, y));
      if (hi) add(ellip(0.042, 0.042, 0.042, HX - 0.075, HY + 0.035, 0, 6, 4), W, 4, [0, 1 | 4]);   // hair gathered at the nape
    }
    // --- hats ---
    const HT = HY + 0.075;
    add(ellip(0.1, 0.092, 0.089, HX - 0.004, HT - 0.005, 0, SEG, hi ? 3 : 2, 0, Math.PI / 2), BLACK, 0, [0, 2]);            // bowler crown
    { const g = new THREE.CylinderGeometry(0.142, 0.142, 0.012, SEG + 1, 1, !hi); g.scale(1.12, 1, 0.92); g.translate(HX - 0.004, HT - 0.005, 0); add(g, BLACK, 0, [0, 2]); }
    { const g = new THREE.CylinderGeometry(0.19, 0.235, 0.035, SEG + 3, 1, !hi); g.rotateZ(-0.12); g.translate(HX - 0.02, HT + 0.005, 0); add(g, W, 3, [0, 4]); }   // woman's wide brim
    { const g = new THREE.CylinderGeometry(0.085, 0.098, 0.1, SEG, 1); g.rotateZ(-0.12); g.translate(HX - 0.028, HT + 0.06, 0); add(g, W, 3, [0, 4]); }
    if (hi) add(ellip(0.055, 0.03, 0.05, HX + 0.02, HT + 0.03, 0.07, 6, 3), lin(0xb8aea0), 0, [0, 4]);                    // a ribbon / flower
    add(ellip(0.108, 0.06, 0.1, HX - 0.01, HT - 0.02, 0, SEG, hi ? 3 : 2, 0, Math.PI / 2), TWEED, 0, [0, 8]);                // flat cap
    { const g = new THREE.CylinderGeometry(0.085, 0.085, 0.012, 8, 1, false, 0, Math.PI); g.scale(0.9, 1, 1.05); g.translate(HX + 0.075, HT - 0.03, 0); add(g, TWEED, 0, [0, 8]); }
    // --- wraps ---
    // shawl over the shoulders, its point hanging lower at the back (shawl or hooded shawl)
    const SH_PROF = PROF.filter((p) => p[1] > 0.25);
    add(shell(SH_PROF, 0.022, 1.02, SEG, (x, y, z) => {
      const back = Math.max(0, -x / 0.12), front = Math.max(0, x / 0.12);
      return [x * (1 + 0.1 * back), y > 0.3 ? y : y - 0.16 * back + 0.05 * front, z];
    }, 0.95), W, 2, [2, 2 | 4]);                                                  // open in front: a V over the coat
    if (hi) {
      // the hood: a shell around the head, open at the face
      const g = new THREE.SphereGeometry(1, 9, 6, Math.PI + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72);
      g.scale(0.108, 0.122, 0.097); g.translate(HX - 0.008, HY + 0.008, 0);
      add(g, W, 2, [2, 4]);
    } else add(ellip(0.104, 0.118, 0.095, HX - 0.012, HY + 0.008, 0, 6, 4, 0, Math.PI * 0.7), W, 2, [2, 4]);
    // blanket round the shoulders and down over the lap
    add(shell(PROF.filter((p) => p[1] < 0.58), 0.038, 1.08, SEG, (x, y, z) => [x, y, z * (1 + 0.08 * Math.max(0, 0.5 - y))]), W, 2, [2, 8]);
    add(ellip(0.3, 0.12, 0.24, 0.22, 0.085, 0, hi ? 8 : 5, hi ? 4 : 3), W, 2, [2, 8]);
    // --- cork life jacket: blocks front and back on canvas, shoulder straps ---
    const profR = (y) => {
      for (let i = 1; i < PERSON_PROF.length; i++) {
        const a = PERSON_PROF[i - 1], b = PERSON_PROF[i];
        if (y <= b[1]) return lerp(a[0], b[0], clamp((y - a[1]) / (b[1] - a[1])));
      }
      return PERSON_PROF[PERSON_PROF.length - 1][0];
    };
    // front and back panels wrapped round the chest; three rows of two cork blocks each, sewn apart
    const panel = (ac) => {
      const NI = hi ? 4 : 1, NJ = hi ? 6 : 1, pos = [], col = [], idx = [];
      for (let j = 0; j <= NJ; j++) for (let i = 0; i <= NI; i++) {
        const u = i / NI, v = j / NJ, a = ac + (u - 0.5) * 1.9, y = lerp(0.2, 0.54, v);
        const row = Math.min(1, 1.6 * Math.abs(Math.sin(v * 3 * Math.PI))), cl = Math.min(1, 1.6 * Math.abs(Math.sin(u * 2 * Math.PI)));
        const edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 8);
        const r = profR(y) + 0.012 + 0.026 * edge * (hi ? 0.5 + 0.5 * row * cl : 1);
        pos.push(Math.sin(a) * r * 0.66 + hunch(y), y, Math.cos(a) * r * 1.1);
        const sh = hi ? 0.7 + 0.3 * row * cl : 1;
        col.push(CORK[0] * sh, CORK[1] * sh, CORK[2] * sh);
      }
      for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) { const a = j * (NI + 1) + i, b = a + 1, c = a + NI + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const c3 = new Float32Array(col);
      return { g, c3 };
    };
    for (const ac of [Math.PI / 2, -Math.PI / 2]) {
      const { g, c3 } = panel(ac);
      let k = 0; const ng = g.toNonIndexed(), cols = [];
      const ix = g.index.array;
      for (let t = 0; t < ix.length; t++) cols.push(c3[ix[t] * 3], c3[ix[t] * 3 + 1], c3[ix[t] * 3 + 2]);
      add(ng, (x, y, z) => { const c = [cols[k * 3], cols[k * 3 + 1], cols[k * 3 + 2]]; k++; return c; }, 0, [1, 2]);
    }
    if (hi) for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.26, 0.03, 0.06).translate(hunch(0.55) - 0.005, 0.55, sd * 0.12), STRAP, 0, [1, 2]);
    return done();
  }
  function personMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTint; attribute vec2 aSel; attribute vec4 iVar; attribute vec3 iCoat; attribute vec4 iAcc;')
        .replace('#include <color_vertex>', `#include <color_vertex>
          {
            vec3 hairC = mix(vec3(0.028, 0.018, 0.012), vec3(0.16, 0.13, 0.1), step(0.82, iAcc.w)) * (0.8 + 0.5 * fract(iAcc.w * 5.3));
            vec3 hatC = mix(iCoat * 0.75, iAcc.rgb * 0.85, step(0.62, fract(iAcc.w * 3.7)));
            vec3 tint = aTint < 0.5 ? vec3(1.0) : aTint < 1.5 ? iCoat : aTint < 2.5 ? iAcc.rgb : aTint < 3.5 ? hatC : hairC;
            vColor.rgb *= tint;
          }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (aSel.x > -0.5) {
            int ch = int(aSel.x + 0.5);
            float v = ch == 0 ? iVar.x : ch == 1 ? iVar.y : ch == 2 ? iVar.z : iVar.w;
            if (((int(aSel.y + 0.5) >> int(v + 0.5)) & 1) == 0) transformed = vec3(0.0);
          }`);
    };
    m.customProgramCacheKey = () => 'tt-person2';
    return m;
  }

  function buildBoats(ctx, rig) {
    const group = new THREE.Group(); group.name = 'lifeboats';
    const EV = TT.story.EV, BOATS = TT.story.BOATS, NB = BOATS.length;
    const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 0.6 });
    const hulls = new THREE.InstancedMesh(boatHullGeometry(), hullMat, NB);
    hulls.name = 'lifeboat hulls'; hulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hulls.frustumCulled = false;
    group.add(hulls);
    const OPB = 8;                       // oars per boat
    const oars = new THREE.InstancedMesh(oarGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), NB * OPB);
    oars.name = 'lifeboat oars'; oars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); oars.frustumCulled = false;
    group.add(oars);

    // passengers -------------------------------------------------------
    // Two LODs share one set of per-person variants: boats close enough for a figure to span more than
    // ~16 px draw into the detailed mesh, the rest into the light one (people > 450 m away are skipped).
    let total = 0; for (const b of BOATS) total += b.people;
    const VAR = new Float32Array(total * 4), COAT = new Float32Array(total * 3), ACC = new Float32Array(total * 4);
    const pMat = personMaterial();
    const layer = (hi, name) => {
      const geo = personGeometry(hi);
      const iVar = new Float32Array(total * 4), iCoat = new Float32Array(total * 3), iAcc = new Float32Array(total * 4);
      geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(iVar, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('iCoat', new THREE.InstancedBufferAttribute(iCoat, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('iAcc', new THREE.InstancedBufferAttribute(iAcc, 4).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geo, pMat, total);
      mesh.name = name; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
      group.add(mesh);
      const srcOf = new Int32Array(total).fill(-1);
      let n = 0, dirty = false;
      return {
        mesh,
        begin() { n = 0; },
        push(m, src) {
          mesh.setMatrixAt(n, m);
          if (srcOf[n] !== src) {           // keep per-instance variants aligned with the compacted order
            srcOf[n] = src; dirty = true;
            for (let c = 0; c < 4; c++) { iVar[n * 4 + c] = VAR[src * 4 + c]; iAcc[n * 4 + c] = ACC[src * 4 + c]; }
            for (let c = 0; c < 3; c++) iCoat[n * 3 + c] = COAT[src * 3 + c];
          }
          n++;
        },
        end() {
          mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
          if (dirty) { geo.attributes.iVar.needsUpdate = geo.attributes.iCoat.needsUpdate = geo.attributes.iAcc.needsUpdate = true; dirty = false; }
        },
      };
    };
    const peopleNear = layer(true, 'lifeboat passengers (near)'), peopleFar = layer(false, 'lifeboat passengers');
    // dark overcoats (black, charcoal, navy, brown, bottle green, a few lighter tweeds and a burgundy)
    const COATS = [0x121316, 0x17181b, 0x1d1b19, 0x23201d, 0x1a1e28, 0x2b241e, 0x1f2620, 0x3a332c, 0x4a4540, 0x3c1c1e, 0x5c5246, 0x2e2e32].map(lin);
    // shawls and blankets: pale wool, cream, grey, steamship blankets, a few dark or red plaids
    const WRAPS = [0xd6cfbf, 0xe2ddd0, 0xbdb6a8, 0x9a948a, 0x7a7266, 0x5c554c, 0x2c2a28, 0x283044, 0x6a2c26, 0x3a4636, 0xc9bca0].map(lin);
    const seats = [];     // per boat: [{x, y, z, yaw, lean, roll, sx, sy, sz}] in boat-local
    let pi = 0;
    const rs = U.rng('boat-people');
    BOATS.forEach((b, bi) => {
      const cand = [];
      for (let x = -3.4; x <= 3.3; x += 0.48) {
        const onThwart = [-2.7, -1.35, 0, 1.35, 2.7].some((tx) => Math.abs(tx - x) < 0.25) || x < -3.0;
        const hb = boatHalfBeam(x + (x > 0 ? 0.4 : -0.1)) * (onThwart ? 0.92 : 0.62) - 0.3;
        if (hb < 0.05) continue;
        const n = Math.max(1, Math.floor((2 * hb) / 0.5) + 1);
        for (let k = 0; k < n; k++) {
          const z = n === 1 ? 0 : lerp(-hb, hb, k / (n - 1));
          cand.push({ x, z, y: onThwart ? 0.24 : 0.0 + 0.05 * rs(), yaw: (x > 0.2 ? Math.PI : 0) + (rs() - 0.5) * 0.45, pr: rs() + (onThwart ? 0 : 0.35) + Math.abs(z) * 0.1 });
        }
      }
      cand.sort((p, q) => p.pr - q.pr);
      // the officer / seaman at the tiller, up on the stern sheets
      cand.unshift({ x: -3.72, z: 0, y: 0.5, yaw: 0, pr: -1 });
      const list = [];
      for (let k = 0; k < b.people; k++) {
        const c = cand[k % cand.length], lay = Math.floor(k / cand.length);
        const crew = k === 0 || (k < 4 && rs() < 0.5);
        const woman = !crew && rs() < 0.64, child = !crew && rs() < 0.09;
        const s = child ? 0.68 + rs() * 0.1 : (woman ? 0.93 : 1.0) + rs() * 0.1, bulk = rs();
        list.push({ x: c.x + (rs() - 0.5) * 0.08 + lay * 0.22, y: c.y + lay * 0.12, z: c.z + (rs() - 0.5) * 0.06, yaw: c.yaw,
          lean: -(0.06 + rs() * 0.26), roll: (rs() - 0.5) * 0.18,
          sx: s * (0.92 + 0.16 * bulk), sy: s * (0.96 + 0.08 * rs()), sz: s * (0.9 + 0.22 * bulk) });
        // variants: hat, cork jacket, wrap, legs
        let hat = crew ? 3 : woman ? (rs() < 0.55 ? 2 : 0) : (rs() < 0.5 ? 1 : rs() < 0.5 ? 3 : 0);
        const jacket = rs() < (crew ? 0.7 : 0.3) ? 1 : 0;
        let wrap = 0;
        if (!jacket) { const r = rs(); wrap = woman ? (r < 0.2 ? 0 : r < 0.5 ? 1 : r < 0.7 ? 2 : 3) : (r < 0.7 ? 0 : 3); }
        if (wrap === 2) hat = 0;
        VAR[pi * 4] = hat; VAR[pi * 4 + 1] = jacket; VAR[pi * 4 + 2] = wrap; VAR[pi * 4 + 3] = woman ? 1 : 0;
        const cc = COATS[Math.floor(rs() * COATS.length)], wc = WRAPS[Math.floor(rs() * WRAPS.length)];
        COAT[pi * 3] = cc[0]; COAT[pi * 3 + 1] = cc[1]; COAT[pi * 3 + 2] = cc[2];
        ACC[pi * 4] = wc[0]; ACC[pi * 4 + 1] = wc[1]; ACC[pi * 4 + 2] = wc[2]; ACC[pi * 4 + 3] = rs();
        pi++;
      }
      seats.push(list);
    });

    // lanterns (emissive body + glow sprite) --------------------------
    const lanternIdx = []; BOATS.forEach((b, i) => { if (b.lantern) lanternIdx.push(i); });
    const lanternGeo = merge([cyl(0.06, 0.06, 0.16, 8, 0, 0, 0, [1, 1, 1]), cyl(0.085, 0.085, 0.03, 8, 0, -0.095, 0, [0.03, 0.03, 0.03]),
      cyl(0.05, 0.085, 0.06, 8, 0, 0.11, 0, [0.03, 0.03, 0.03]), cyl(0.012, 0.012, 0.18, 4, 0.07, 0, 0, [0.03, 0.03, 0.03]), cyl(0.012, 0.012, 0.18, 4, -0.07, 0, 0, [0.03, 0.03, 0.03])]);
    const lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.0, 0.6, 0.26).multiplyScalar(3.2) });
    const lanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, Math.max(1, lanternIdx.length));
    lanterns.name = 'lanterns'; lanterns.instanceMatrix.setUsage(THREE.DynamicDrawUsage); lanterns.frustumCulled = false;
    group.add(lanterns);
    const glow = makeGlowPoints(Math.max(1, lanternIdx.length), { minPx: 3.2, maxPx: 90, fadeFloor: 0.75 });
    glow.name = 'lantern glow';
    group.add(glow);
    const LANTERN_LOCAL = new THREE.Vector3(-3.98, 1.5, 0);
    const lampLight = new THREE.PointLight(0xffa04a, 0, 28, 2);
    lampLight.name = 'lantern light';
    rig.add(lampLight);

    // No. 14's lug sail: at dawn Fifth Officer Lowe set sail and took collapsible D in tow
    const sailGeo = (() => {
      const g = new THREE.BufferGeometry();
      const v = [0, 0.6, 0, 0, 3.4, 0, -2.6, 0.75, 0, 0, 3.4, 0, -2.2, 3.0, 0, -2.6, 0.75, 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      return g;
    })();
    const sailGeoAll = merge([colorize(sailGeo, lin(0xd9d0bc)), cyl(0.045, 0.06, 3.6, 6, 0, 1.7, 0, lin(0xb08050))]);
    const sail = new THREE.Mesh(sailGeoAll, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    sail.name = 'No. 14 sail';
    sail.visible = false;
    group.add(sail);
    const SAIL_BOAT = BOATS.findIndex((b) => b.slot === 13);

    // falls (ropes) ------------------------------------------------------
    const NF = NB * 6;
    const fallGeo = new THREE.BufferGeometry();
    fallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NF * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const falls = new THREE.LineSegments(fallGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.16, 0.145, 0.12) }));
    falls.name = 'lifeboat falls'; falls.frustumCulled = false;
    group.add(falls);

    // precomputed per-boat constants (pure functions of the story) ------------
    const tmpPose = P.create(), v = V3(), v2 = V3();
    const info = BOATS.map((b, i) => {
      const slot = SH.BOAT_SLOTS[b.slot], side = slot.side, lx = slot.local.x;
      // swung out under the heads of the ship's Welin davits (arm tip 16.75 m off the centreline,
      // fall blocks ~24.8 m up): ~1.3 m clear of the plating
      const outZ = side * Math.max(16.75, TT.hull.halfBeam(lx, 14.5) + 1.2 + BB / 2);
      const r = U.rng('boat' + i);
      // jerky lowering profile: monotone curve with pauses
      const keys = [[0, 0]];
      let u = 0, d = 0;
      while (u < 0.999) {
        const mv = 0.08 + r() * 0.14, pause = 0.02 + r() * 0.06;
        const du = Math.min(1 - u, mv), dd = du * (1.0 + (r() - 0.5) * 0.4);
        u += du; d = Math.min(1, d + dd); keys.push([u, u > 0.999 ? 1 : d]);
        if (u < 0.95) { u += pause; keys.push([Math.min(0.999, u), Math.min(1, d + 0.004)]); }
      }
      keys[keys.length - 1] = [1, 1];
      const drop = U.curve(keys);
      // where the boat reaches the water and how it rows away
      TT.story.intactPose(b.lowerT1, tmpPose);
      const p0 = P.toWorld(tmpPose, v.set(lx, 21.1, outZ), V3());
      const h0 = TT.story.TR.heading(b.lowerT1);
      const out = new THREE.Vector2(side * Math.sin(h0), side * Math.cos(h0));
      const ca = Math.cos(b.dir), sa = Math.sin(b.dir);
      const rowDir = new THREE.Vector2(out.x * ca + out.y * sa, -out.x * sa + out.y * ca);
      const psi = Math.atan2(-rowDir.y, rowDir.x);
      let dPsi = psi - h0; while (dPsi > Math.PI) dPsi -= 2 * Math.PI; while (dPsi < -Math.PI) dPsi += 2 * Math.PI;
      return { b, i, slot, side, lx, outZ, drop, p0, h0, psi, dPsi, rowDir, ph: r() * 10, period: 2.4 + r() * 0.5, R: 9 + r() * 4, draft: 0.12 + 0.2 * b.people / 70, rnd: r() };
    });
    // dawn layout: scattered 300-900 m around the site, a few pulling toward Carpathia
    const SITE = new THREE.Vector3(-70, 0, 20);
    const PULL = new Set([0, 3, 6, 11, 14]);   // includes No. 14 (index 11), under sail
    info.forEach((I, i) => {
      const r = U.rng('dawn' + i);
      const a = Math.atan2(I.rowDir.y, I.rowDir.x) + (r() - 0.5) * 0.9;
      const d = 300 + r() * 600;
      I.dawnPos = new THREE.Vector3(SITE.x + Math.cos(a) * d, 0, SITE.z + Math.sin(a) * d);
      I.dawnHead = r() * Math.PI * 2;
      I.pull = PULL.has(i);
    });

    const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _s = V3(), _p = V3();
    const state = info.map(() => ({ pos: V3(), quat: new THREE.Quaternion(), mode: 0, row: 0, rest: 0, visible: true, fall: 0 }));
    const slotW = V3(), slotL = V3(), offset = V3();

    // the pose of boat i at time t -> st.pos, st.quat, st.mode (0 stowed, 1 lowering, 2 water)
    function pose(I, t, S, st) {
      const b = I.b;
      st.row = 0; st.rest = 0; st.fall = 0; st.visible = true;
      if (t < b.lowerT1) {
        if (!S.ship.visible) { st.visible = false; return; }
        const intact = S.ship.intact;
        P.toWorld(intact, slotL.set(I.lx, I.slot.local.y, I.slot.local.z), v);
        offset.set(0, 0, 0);
        if (TT.ship && TT.ship._ready && TT.ship.boatSlotWorld) { try { TT.ship.boatSlotWorld(b.slot, slotW); offset.subVectors(slotW, v); if (offset.lengthSq() > 25) offset.set(0, 0, 0); } catch (e) { offset.set(0, 0, 0); } }
        const swing = sstep(b.lowerT0, b.lowerT0 + 1.8, t);
        const lift = 0.7 * Math.sin(Math.PI * swing);
        slotL.set(I.lx, I.slot.local.y + lift, lerp(I.slot.local.z, I.outZ, swing));
        P.toWorld(intact, slotL, st.pos).add(offset.multiplyScalar(1 - swing));
        st.quat.copy(intact.quat);
        st.mode = t < b.lowerT0 ? 0 : 1;
        if (t > b.lowerT0 + 1.8) {
          const u = clamp((t - b.lowerT0 - 1.8) / (b.lowerT1 - b.lowerT0 - 1.8));
          const top = st.pos.y, water = seaH(st.pos.x, st.pos.z, t) + I.draft;
          const du = I.drop(u);
          st.pos.y = lerp(top, water, du);
          st.fall = top - st.pos.y + 0.001;
          // uneven falls: the ends jerk; hang level in roll (gravity), keep the ship's trim
          const moving = Math.abs(I.drop(Math.min(1, u + 0.01)) - du) > 0.004 ? 1 : 0;
          const tilt = 0.05 * Math.sin(t * 3.1 + I.ph) * moving * (1 - u) + 0.025 * Math.sin(t * 1.3 + I.ph);
          _e.set(0, S.ship.heading, -S.ship.pitch + tilt, 'YZX');
          st.quat.setFromEuler(_e);
          _q2.setFromAxisAngle(v2.set(1, 0, 0), 0.03 * Math.sin(t * 1.7 + I.ph) * (1 - u));
          st.quat.multiply(_q2);
        }
        return;
      }
      st.mode = 2;
      let x, z, head;
      if (t < EV.dawn) {
        const tr = Math.min(t, EV.silence);
        let s = TT.story.boatRowDistance(b, tr);
        if (t > EV.silence) s += 0.3 * (t - EV.silence);
        st.row = sstep(b.lowerT1 + 4, b.lowerT1 + 9, t) * (1 - sstep(EV.silence - 3, EV.silence + 3, t));
        st.rest = sstep(b.lowerT1 + 4, b.lowerT1 + 9, t) - st.row;
        const R = I.R, sg = I.dPsi >= 0 ? 1 : -1, La = R * Math.abs(I.dPsi);
        if (s <= La) {
          head = I.h0 + sg * s / R;
          x = I.p0.x + (R / sg) * (Math.sin(head) - Math.sin(I.h0));
          z = I.p0.z + (R / sg) * (Math.cos(head) - Math.cos(I.h0));
        } else {
          const hE = I.h0 + I.dPsi;
          x = I.p0.x + (R / sg) * (Math.sin(hE) - Math.sin(I.h0)) + (s - La) * Math.cos(I.psi);
          z = I.p0.z + (R / sg) * (Math.cos(hE) - Math.cos(I.h0)) - (s - La) * Math.sin(I.psi);
          head = I.psi;
        }
        // No. 14 turns and pulls back toward the wreck site
        if (b.slot === 13 && t > 226) {
          const dx = SITE.x - x, dz = SITE.z - z;
          const back = Math.atan2(-dz, dx);
          let dh = back - head; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
          const turn = sstep(226, 232, t);
          head += dh * turn;
          const L = Math.hypot(dx, dz), go = Math.max(0, (t - 229) * 1.6 - 0.8 * (1 - Math.exp(-(Math.max(0, t - 229)) / 1.5)));
          const dd = Math.min(go, L - 30);
          x += dx / L * dd; z += dz / L * dd;
          st.row = sstep(228, 230, t); st.rest = 1 - st.row;
        }
      } else {
        const td = t - EV.dawn;
        x = I.dawnPos.x; z = I.dawnPos.z; head = I.dawnHead;
        if (I.pull) {
          const CP = S.world.carpathiaPos, dx = CP.x - x, dz = CP.z - z, L = Math.hypot(dx, dz);
          head = Math.atan2(-dz, dx);
          x += dx / L * td * 1.4; z += dz / L * td * 1.4;
          st.row = 1;
        } else {
          x += Math.cos(head) * td * 0.15; z -= Math.sin(head) * td * 0.15;
          head += 0.05 * Math.sin(td * 0.1 + I.ph);
          st.rest = 1;
        }
      }
      // bob and rock on the swell
      const cb = Math.cos(head), sb = Math.sin(head);
      const hC = seaH(x, z, t), hF = seaH(x + cb * 3.5, z - sb * 3.5, t), hA = seaH(x - cb * 3.5, z + sb * 3.5, t);
      const hS = seaH(x + sb * 1.3, z + cb * 1.3, t), hP = seaH(x - sb * 1.3, z - cb * 1.3, t);
      const surge = st.row * 0.02 * Math.sin((t / I.period + I.ph) * Math.PI * 2);
      st.pos.set(x, (hC + hF + hA) / 3 + I.draft + surge * 0.3, z);
      const pitch = Math.atan2(hA - hF, 7) + surge, roll = Math.atan2(hP - hS, 2.6) + 0.015 * Math.sin(t * 0.9 + I.ph);
      _e.set(-roll, head, -pitch, 'YZX');
      st.quat.setFromEuler(_e);
    }

    // Boats on the water never overlap: each is a capsule round its keel line (+-3.7 m) wide enough for
    // its oars; pairs that come too close are eased apart along the line between their closest points
    // (a pure function of this frame's poses, so it scrubs cleanly).  A boat just down the falls, still
    // alongside the ship, is not moved (its partner gives way instead).
    const sep1 = new THREE.Vector3(), sep2 = new THREE.Vector3(), SEP = 6.0;
    function separate(t) {
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < NB; i++) {
        const A = state[i];
        if (!A.visible || A.mode !== 2) continue;
        for (let j = i + 1; j < NB; j++) {
          const B = state[j];
          if (!B.visible || B.mode !== 2) continue;
          if ((B.pos.x - A.pos.x) ** 2 + (B.pos.z - A.pos.z) ** 2 > 196) continue;
          const wA = sstep(info[i].b.lowerT1 + 3, info[i].b.lowerT1 + 10, t), wB = sstep(info[j].b.lowerT1 + 3, info[j].b.lowerT1 + 10, t);
          if (wA + wB < 1e-3) continue;
          sep1.set(1, 0, 0).applyQuaternion(A.quat); sep2.set(1, 0, 0).applyQuaternion(B.quat);
          const d1x = sep1.x * 7.4, d1z = sep1.z * 7.4, d2x = sep2.x * 7.4, d2z = sep2.z * 7.4;
          const s1x = A.pos.x - d1x / 2, s1z = A.pos.z - d1z / 2, s2x = B.pos.x - d2x / 2, s2z = B.pos.z - d2z / 2;
          const rx = s1x - s2x, rz = s1z - s2z, a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z;
          const b = d1x * d2x + d1z * d2z, c = d1x * rx + d1z * rz, f = d2x * rx + d2z * rz, den = a * e - b * b;
          let u = den > 1e-6 ? clamp((b * f - c * e) / den) : 0, v = (b * u + f) / e;
          if (v < 0) { v = 0; u = clamp(-c / a); } else if (v > 1) { v = 1; u = clamp((b - c) / a); }
          const dx = (s2x + d2x * v) - (s1x + d1x * u), dz = (s2z + d2z * v) - (s1z + d1z * u), d = Math.hypot(dx, dz);
          if (d >= SEP) continue;
          const nx = d > 1e-3 ? dx / d : 0, nz = d > 1e-3 ? dz / d : 1, k = (SEP - d) * Math.max(wA, wB) / (wA + wB);
          A.pos.x -= nx * k * wA; A.pos.z -= nz * k * wA; B.pos.x += nx * k * wB; B.pos.z += nz * k * wB;
        }
      }
    }

    const camPos = V3();
    const NEAR_MAX = 80, lodD = new Float32Array(NB), lodN = new Uint8Array(NB), lodO = [];
    const api = {
      group, state, info,
      update(t, S, ctx) {
        group.visible = !S.env.underwater;
        if (!group.visible) { lampLight.intensity = 0; return; }
        camPos.copy(ctx.camera.position);
        const fp = fallGeo.attributes.position.array; let fi = 0;
        let li = 0, pIndex = 0;
        const pxPerM = ctx.height / (2 * Math.tan(ctx.camera.fov * U.DEG / 2));
        peopleNear.begin(); peopleFar.begin();
        let best = 1e9, best2 = 1e9, bestPos = null;
        const lanternOn = 1 - 0.85 * S.env.dawn;
        // poses first; the nearest boats whose figures are big on screen get the detailed people
        // (at most NEAR_MAX of them), everyone else the light ones
        for (let i = 0; i < NB; i++) pose(info[i], t, S, state[i]);
        separate(t);
        for (let i = 0; i < NB; i++) { lodD[i] = state[i].visible ? state[i].pos.distanceTo(camPos) : 1e9; lodO[i] = i; }
        lodO.sort((a, b) => lodD[a] - lodD[b]);
        let nearLeft = NEAR_MAX;
        for (let k = 0; k < NB; k++) {
          const i = lodO[k];
          lodN[i] = pxPerM * 0.85 / Math.max(1, lodD[i]) > 26 && nearLeft >= info[i].b.people ? 1 : 0;
          if (lodN[i]) nearLeft -= info[i].b.people;
        }
        for (let i = 0; i < NB; i++) {
          const I = info[i], st = state[i];
          if (!st.visible) {
            _m.makeScale(0, 0, 0); hulls.setMatrixAt(i, _m);
            for (let k = 0; k < OPB; k++) oars.setMatrixAt(i * OPB + k, _m);
            pIndex += I.b.people; continue;
          }
          _m.compose(st.pos, st.quat, _s.set(1, 1, 1));
          hulls.setMatrixAt(i, _m);
          // oars: stowed inside / stroking / resting feathered
          for (let k = 0; k < OPB; k++) {
            const pair = k >> 1, sd = (k & 1) ? -1 : 1;
            const ox = [-2.05, -0.7, 0.65, 2.0][pair];
            if (st.row + st.rest < 0.01) {
              _p.set(-0.4 + pair * 0.08, 0.26 + (k & 1) * 0.05, sd * (0.45 + pair * 0.1));
              _q2.setFromEuler(_e.set(0, Math.PI / 2 * sd, 0));
            } else {
              const ph = ((t / I.period + I.ph + (pair * 0.02)) % 1 + 1) % 1;
              let yaw, dep;
              if (ph < 0.42) { const u = U.easeInOutSine(ph / 0.42); yaw = lerp(0.5, -0.38, u); dep = 0.21; }
              else { const u = U.easeInOutSine((ph - 0.42) / 0.58); yaw = lerp(-0.38, 0.5, u); dep = 0.21 - 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.15)); }
              yaw = lerp(0.05, yaw, st.row); dep = lerp(0.12, dep, st.row);
              _p.set(ox, gunwaleY(ox) + 0.05, sd * (boatHalfBeam(ox) + 0.02));
              const square = st.row * (ph < 0.45 ? 1 : 0) * sstep(0, 0.05, ph) * (1 - sstep(0.4, 0.45, ph));
              _e.set(sd * dep, sd * yaw, square * Math.PI / 2, 'YXZ');
              _q2.setFromEuler(_e);
              if (sd < 0) _q2.multiply(_q.setFromAxisAngle(v2.set(0, 1, 0), Math.PI));
            }
            _m2.compose(_p, _q2, _s.set(1, 1, 1));
            oars.setMatrixAt(i * OPB + k, _m2.premultiply(_m));
          }
          // passengers board in the last seconds before lowering; near boats get the detailed figures
          const list = seats[i];
          const aboard = lodD[i] > 450 ? 0 : Math.round(list.length * sstep(I.b.lowerT0 - 6, I.b.lowerT0 - 0.5, t));
          const L = lodN[i] ? peopleNear : peopleFar;
          for (let k = 0; k < aboard; k++) {
            const pp = list[k];
            const rowLean = st.row > 0 && Math.abs(pp.z) > 0.5 ? 0.18 * Math.sin((t / I.period + I.ph) * Math.PI * 2) * st.row : 0;
            _q2.setFromEuler(_e.set(pp.roll, pp.yaw, pp.lean + rowLean, 'YXZ'));
            _m2.compose(_p.set(pp.x, pp.y, pp.z), _q2, _s.set(pp.sx, pp.sy, pp.sz));
            L.push(_m2.premultiply(_m), pIndex + k);
          }
          pIndex += list.length;
          // falls
          if (st.fall > 0.01) {
            for (const end of [-3.2, 3.2]) {
              v.set(end, gunwaleY(end) + 0.1, 0).applyQuaternion(st.quat).add(st.pos);
              P.toWorld(S.ship.intact, v2.set(I.lx + end, SH.BOAT_DECK_Y + 4.95, I.outZ), v2);
              for (const dz of [-0.12, 0.12]) {
                fp[fi++] = v.x; fp[fi++] = v.y; fp[fi++] = v.z + dz;
                fp[fi++] = v2.x; fp[fi++] = v2.y; fp[fi++] = v2.z + dz * 0.3;
              }
            }
          }
          // lantern
          if (I.b.lantern && li < lanternIdx.length) {
            const on = t >= I.b.lowerT0 - 3 ? lanternOn : 0;
            v.copy(LANTERN_LOCAL).applyQuaternion(st.quat).add(st.pos);
            _m2.compose(v, st.quat, _s.setScalar(on > 0 ? 1 : 0.0001));
            lanterns.setMatrixAt(li, _m2);
            const flick = 0.9 + 0.1 * Math.sin(ctx.realTime * 13.1 + i) * Math.sin(ctx.realTime * 7.3 + i * 2);
            glow.geometry.attributes.position.setXYZ(li, v.x, v.y, v.z);
            const gk = 1.7 * on * flick;
            glow.geometry.attributes.color.setXYZ(li, 1.0 * gk, 0.6 * gk, 0.26 * gk);
            glow.geometry.attributes.size.setX(li, on > 0 ? 0.7 : 0);
            if (on > 0) {
              const d = v.distanceTo(camPos);
              if (d < best) { best2 = best; best = d; bestPos = bestPos || V3(); bestPos.copy(v); } else if (d < best2) best2 = d;
            }
            li++;
          }
        }
        hulls.instanceMatrix.needsUpdate = true;
        oars.instanceMatrix.needsUpdate = true;
        peopleNear.end(); peopleFar.end();
        lanterns.instanceMatrix.needsUpdate = true;
        glow.geometry.attributes.position.needsUpdate = true;
        glow.geometry.attributes.color.needsUpdate = true;
        glow.geometry.attributes.size.needsUpdate = true;
        glow.material.uniforms.uScale.value = ctx.renderer.getPixelRatio() * ctx.height / (2 * Math.tan(ctx.camera.fov * U.DEG / 2));
        for (let k = fi; k < fp.length; k++) fp[k] = 0;
        fallGeo.attributes.position.needsUpdate = true;
        falls.visible = fi > 0;
        // one real light at the lantern nearest the camera, faded when two are equally near
        if (bestPos && best < 90) {
          lampLight.position.copy(bestPos);
          const k = best2 < 1e8 ? clamp((best2 - best) / Math.max(4, best * 0.3)) : 1;
          lampLight.intensity = 6 * lanternOn * k * (1 - sstep(50, 90, best));
        } else lampLight.intensity = 0;
        // the sail (dawn only)
        sail.visible = t >= EV.dawn && SAIL_BOAT >= 0;
        if (sail.visible) {
          const st = state[SAIL_BOAT];
          sail.position.copy(v.set(2.55, 0.2, 0).applyQuaternion(st.quat).add(st.pos));
          sail.quaternion.copy(st.quat).multiply(_q.setFromAxisAngle(v2.set(0, 1, 0), 0.25 + 0.05 * Math.sin(t * 0.5)));
        }
      },
    };
    return api;
  }

  // ==================================================================
  // 3. THE CALIFORNIAN — a few faint steady lights on the northern horizon
  // ==================================================================
  function buildCalifornian() {
    // ship-local offsets (x fwd, y up, z stbd): masthead, after range light, red port sidelight, deck/cabin lights
    const L = [
      [18, 23, 0, [1.0, 0.97, 0.9], 1.0], [-22, 27, 0, [1.0, 0.95, 0.86], 0.8], [22, 11, -6, [1.0, 0.12, 0.06], 0.55],
      [2, 10, -7, [1.0, 0.8, 0.5], 0.35], [-12, 9, -7, [1.0, 0.78, 0.45], 0.3], [-40, 8.5, -6, [1.0, 0.8, 0.5], 0.25],
    ];
    const glow = makeGlowPoints(L.length, { minPx: 3.0, maxPx: 14, fadeFloor: 1.0 });
    glow.name = 'Californian lights';
    const HEAD = 0.25;
    return {
      group: glow,
      update(t, S, ctx) {
        const k = S.world.californian;
        glow.visible = k > 0.001 && !S.env.underwater;
        if (!glow.visible) return;
        const P0 = S.world.californianPos, c = Math.cos(HEAD), s = Math.sin(HEAD);
        const pa = glow.geometry.attributes.position, ca = glow.geometry.attributes.color, sa = glow.geometry.attributes.size;
        for (let i = 0; i < L.length; i++) {
          const l = L[i];
          pa.setXYZ(i, P0.x + l[0] * c + l[2] * s, l[1], P0.z - l[0] * s + l[2] * c);
          const tw = 0.8 + 0.2 * Math.sin(ctx.realTime * (2.1 + i * 0.7) + i) * Math.sin(ctx.realTime * 3.3 + i * 1.9);
          const e = k * l[4] * tw * 3.2;
          ca.setXYZ(i, l[3][0] * e, l[3][1] * e, l[3][2] * e);
          sa.setX(i, 2.5);
        }
        pa.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
        glow.material.uniforms.uScale.value = ctx.renderer.getPixelRatio() * ctx.height / (2 * Math.tan(ctx.camera.fov * U.DEG / 2));
      },
    };
  }

  // ==================================================================
  // 4. RMS CARPATHIA (Cunard, 1903) at dawn
  // ==================================================================
  function carpathiaHull() {
    const L = 164, HBm = 9.75, SX = 269 / L;
    const hb = (x, y) => TT.hull.halfBeam(clamp(x * SX, -134.4, 133.9), Math.max(-10.45, y * 1.25)) * (HBm / 14.1);
    const sheer = (x) => 11.2 + 2.9 * Math.pow(sstep(40, 82, x), 1.6) + 1.3 * Math.pow(sstep(-40, -82, x), 1.4);
    const NS = 110, NV = 14;
    const BLACK = lin(0x0c0d0f), RED = lin(0x5e1a14), WHITE = lin(0xcfccc2), DECK = lin(0x6e5a44);
    const pos = [], col = [], idx = [];
    const xs = [];
    for (let s = 0; s <= NS; s++) {
      const u = s / NS;
      xs.push(lerp(-81.6, 81.8, u));
    }
    for (const x of xs) {
      const top = sheer(x);
      for (let side = -1; side <= 1; side += 2) {
        for (let v = 0; v <= NV; v++) {
          const q = v / NV, y = lerp(top, -8.4, Math.pow(q, 1.1));
          let w = hb(x, y);
          if (y > 0) w = Math.max(w, hb(x, Math.min(y, 9)) * 0.98);
          pos.push(x, y, side * Math.max(0.05, w));
          const c = y < -0.35 ? RED : (y > top - 0.45 ? WHITE : BLACK);
          col.push(c[0], c[1], c[2]);
        }
      }
    }
    const R = 2 * (NV + 1);
    for (let s = 0; s < NS; s++) for (let v = 0; v < NV; v++) {
      for (let sd = 0; sd < 2; sd++) {
        const a = s * R + sd * (NV + 1) + v, b = a + R, c = b + 1, d = a + 1;
        if (sd === 1) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
      }
    }
    // deck
    const d0 = pos.length / 3;
    for (const x of xs) { const top = sheer(x) - 0.3, w = Math.max(0.05, hb(x, 9) * 0.97); pos.push(x, top, -w, x, top, w); col.push(...DECK, ...DECK); }
    for (let s = 0; s < NS; s++) { const a = d0 + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const out = g.toNonIndexed(); g.dispose();
    return { geo: out, hb, sheer };
  }

  function buildCarpathia(ctx) {
    const group = new THREE.Group(); group.name = 'RMS Carpathia';
    const { geo: hullGeo, hb, sheer } = carpathiaHull();
    const WHITE = lin(0xd6d3c9), BUFF = lin(0xb9a27a), BLACK = lin(0x0d0d0e), CUNARD = lin(0xc4501f), WOOD = lin(0x6b5238), MAST = lin(0x9a7a50), GREY = lin(0x55524c);
    const parts = [hullGeo];
    const win = [];
    const addWin = (x, y, z, w, h, side) => { const g = new THREE.PlaneGeometry(w, h); g.rotateY(side > 0 ? 0 : Math.PI); g.translate(x, y, z + side * 0.03); win.push(colorize(g, [1, 1, 1])); };
    // superstructure: midship houses, bridge, wheelhouse, aft house
    parts.push(box(58, 2.8, 15, 7, 12.6, 0, WHITE), box(52, 2.7, 13.6, 7, 15.35, 0, WHITE));
    parts.push(box(58.6, 0.25, 15.8, 7, 14.1, 0, WHITE), box(52.6, 0.25, 14.4, 7, 16.8, 0, WOOD));
    parts.push(box(6, 3.2, 12, 33, 18.5, 0, WHITE), box(2.2, 0.35, 19.6, 34.5, 19.9, 0, WHITE), box(3.4, 2.3, 6, 32.6, 21.2, 0, WHITE));
    parts.push(box(3.6, 0.2, 6.4, 32.6, 22.45, 0, WOOD));
    parts.push(box(14, 2.6, 10, -65, 13.4, 0, WHITE), box(8, 2.4, 7, 70, 15.2, 0, WHITE));
    parts.push(box(6, 2.2, 5, -10, 18.1, 0, WHITE), box(5, 2.0, 4, 20, 18.0, 0, WHITE));
    // windows on the houses, portholes along the hull
    for (let x = -20; x <= 34; x += 2.1) for (const sd of [-1, 1]) { addWin(x, 12.8, sd * 7.5, 0.9, 1.0, sd); if (x < 31) addWin(x + 0.9, 15.5, sd * 6.8, 0.8, 0.9, sd); }
    for (const sd of [-1, 1]) {
      for (let x = -76; x <= 76; x += 2.6) {
        if (Math.abs(x - 50) < 5 || Math.abs(x + 37) < 5) continue;
        const w8 = hb(x, 8.2), w55 = hb(x, 5.6);
        if (w8 > 1.5) addWin(x, 8.2, sd * w8, 0.45, 0.45, sd);
        if (w55 > 1.5 && Math.abs(x) < 64 && (Math.round(x / 2.6) % 2 === 0)) addWin(x + 1.3, 5.6, sd * w55, 0.4, 0.4, sd);
      }
    }
    // funnel: tall and thin, Cunard red with a black top and two thin black bands
    const FX = 1, FB = 17, FT = 41, RX = 3.1, RZ = 2.55, RAKE = 6 * U.DEG;
    const bands = [[FB, 26.8, CUNARD], [26.8, 27.5, BLACK], [27.5, 30.0, CUNARD], [30.0, 30.7, BLACK], [30.7, 35.5, CUNARD], [35.5, FT, BLACK]];
    for (const bnd of bands) {
      const h = bnd[1] - bnd[0];
      const g = new THREE.CylinderGeometry(1, 1, h, 28, 1, true);
      g.scale(RX, 1, RZ);
      g.translate(0, (bnd[0] + bnd[1]) / 2 - FB, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(RAKE));
      g.translate(FX, FB, 0);
      parts.push(colorize(g, bnd[2]));
    }
    { const g = new THREE.CylinderGeometry(1, 1, 0.6, 28, 1, true); g.scale(RX * 0.93, 1, RZ * 0.93); g.translate(0, FT - FB - 0.3, 0); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(RAKE)); g.translate(FX, FB, 0); g.index && g.setIndex(g.index); parts.push(colorize(g, [0.01, 0.01, 0.01])); }
    parts.push(cyl(0.25, 0.25, 21, 6, FX + 3.4 - 1.2, 28, 0, BUFF, 0, 0, RAKE));   // steam pipe
    const funnelTopLocal = new THREE.Vector3(FX - Math.sin(RAKE) * (FT - FB), FT, 0);
    // cowl ventilators around the funnel
    for (const [vx, vz] of [[-6, 4], [-6, -4], [8, 4.5], [8, -4.5], [14, 3], [14, -3], [-14, 5], [-14, -5]]) {
      parts.push(cyl(0.45, 0.45, 3.2, 8, vx, 18.4, vz, BUFF));
      parts.push(cyl(0.7, 0.5, 1.1, 8, vx + 0.35, 20.3, vz, BUFF, 0, 0, 1.1));
    }
    // four masts with cross-trees and derricks
    const MASTS = [[66, 44], [45, 45], [-38, 42], [-60, 40]];
    for (const [mx, top] of MASTS) {
      const base = sheer(mx) - 0.3;
      parts.push(cyl(0.18, 0.42, top - base, 7, mx, (top + base) / 2, 0, MAST, 0, 0, 4 * U.DEG));
      const ct = base + (top - base) * 0.72;
      parts.push(box(0.3, 0.25, 4.2, mx - Math.sin(4 * U.DEG) * (ct - base), ct, 0, MAST));
      for (const sd of [-1, 1]) parts.push(cyl(0.1, 0.16, 8, 5, mx + sd * 2.6, base + 4.3, 0, MAST, 0, 0, sd * -0.62));
    }
    // lifeboats on the boat deck
    for (const sd of [-1, 1]) for (let k = 0; k < 8; k++) {
      const bx = -18 + k * 6.6;
      if (Math.abs(bx - FX) < 4) continue;
      const g = new THREE.CylinderGeometry(0.75, 0.75, 7.2, 8, 1);
      g.rotateZ(Math.PI / 2); g.scale(1, 0.7, 1);
      g.translate(bx, 18.0, sd * 6.1);
      parts.push(colorize(g, WHITE));
      parts.push(box(0.2, 1.8, 0.2, bx - 3, 17.9, sd * 6.9, GREY), box(0.2, 1.8, 0.2, bx + 3, 17.9, sd * 6.9, GREY));
    }
    // rails (thin white strips) along the houses and the forecastle / poop edges
    for (const sd of [-1, 1]) {
      parts.push(box(58, 0.9, 0.06, 7, 17.3, sd * 7.3, WHITE));
      parts.push(box(24, 0.9, 0.06, 70, sheer(70) + 0.45, sd * (hb(70, 12) - 0.1), WHITE, 0, sd * 0.08, 0));
      parts.push(box(30, 0.9, 0.06, -66, sheer(-66) + 0.45, sd * (hb(-66, 11) - 0.1), WHITE));
    }
    for (const p of parts) { if (p.attributes.uv) p.deleteAttribute('uv'); if (!p.attributes.normal) p.computeVertexNormals(); }
    const bodyGeo = merge(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.7 }));
    body.name = 'Carpathia body';
    const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.4), side: THREE.DoubleSide });
    const windows = new THREE.Mesh(merge(win), winMat);
    windows.name = 'Carpathia windows';
    const ship = new THREE.Group(); ship.name = 'Carpathia hull';
    ship.add(body, windows);
    group.add(ship);

    // rigging: stays, shrouds, the Marconi aerial
    const rig = [];
    const mt = MASTS.map(([mx, top]) => new THREE.Vector3(mx - Math.sin(4 * U.DEG) * (top - sheer(mx)), top, 0));
    const seg = (a, b) => rig.push(a.x, a.y, a.z, b.x, b.y, b.z);
    seg(mt[0], new THREE.Vector3(81.5, sheer(81.5) + 0.5, 0));
    seg(mt[0], mt[1]); seg(mt[2], mt[3]);
    seg(mt[3], new THREE.Vector3(-81, sheer(-81) + 0.5, 0));
    for (const m of mt) for (const sd of [-1, 1]) for (const dx of [-2.5, 0, 2.5]) seg(m.clone().setY(m.y - 1), new THREE.Vector3(m.x + dx - 1.5, sheer(m.x) + 0.2, sd * hb(m.x + dx - 1.5, 10)));
    for (const dz of [-0.8, 0.8]) seg(mt[1].clone().setZ(dz).setY(mt[1].y - 0.5), mt[2].clone().setZ(dz).setY(mt[2].y - 0.5));
    const rigGeo = new THREE.BufferGeometry(); rigGeo.setAttribute('position', new THREE.Float32BufferAttribute(rig, 3));
    const rigMat = new THREE.LineBasicMaterial({ color: 0x3a3836, transparent: true, opacity: 0.5, depthWrite: false });
    const rigging = new THREE.LineSegments(rigGeo, rigMat);
    rigging.name = 'Carpathia rigging';
    ship.add(rigging);

    // bow wave and wake: foam on the water, V-shaped from the stem, a long streak astern
    const foamGeo = (() => {
      const pos = [], uv = [];
      const quad = (a, b, c, d, ua, ub) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(ua[0], ua[1], ub[0], ua[1], ub[0], ub[1], ua[0], ua[1], ub[0], ub[1], ua[0], ub[1]); };
      const N = 16;
      for (const sd of [-1, 1]) for (let i = 0; i < N; i++) {
        const u0 = i / N, u1 = (i + 1) / N;
        const x0 = 82 - u0 * 150, x1 = 82 - u1 * 150;
        const hw0 = (x) => hb(Math.min(81.5, Math.max(-81.5, x)), 0) + 0.3;
        const o0 = sd * (hw0(x0) + u0 * 32), o1 = sd * (hw0(x1) + u1 * 32);
        const w0 = 1.5 + u0 * 14, w1 = 1.5 + u1 * 14;
        quad([x0, 0.3, o0 - sd * 0.4], [x1, 0.3, o1 - sd * 0.4], [x1, 0.3, o1 + sd * w1], [x0, 0.3, o0 + sd * w0], [u0, 0], [u1, 1]);
      }
      for (let i = 0; i < N; i++) {           // wake astern (u offset by 2 marks it as wake)
        const u0 = i / N, u1 = (i + 1) / N, x0 = -80 - u0 * 420, x1 = -80 - u1 * 420, w0 = 8 + u0 * 30, w1 = 8 + u1 * 30;
        quad([x0, 0.22, -w0], [x1, 0.22, -w1], [x1, 0.22, w1], [x0, 0.22, w0], [2 + u0, 0], [2 + u1, 1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    })();
    const foamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0.7, 0.68, 0.7) }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1e9 }, fogDensity: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vP;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vP = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uCol; varying vec2 vUv; varying vec3 vP;
        ${TT.glsl.noise}
        #include <fog_pars_fragment>
        void main(){
          bool wake = vUv.x >= 2.0; float u = wake ? vUv.x - 2.0 : vUv.x;
          float n = snoise(vec3(vP.x * 0.12 + uTime * 1.5, vP.z * 0.25, uTime * 0.3)) * 0.5 + 0.5;
          float n2 = snoise(vec3(vP.x * 0.5, vP.z * 0.7, uTime * 0.6)) * 0.5 + 0.5;
          float across = clamp(wake ? 1.0 - abs(vUv.y * 2.0 - 1.0) : (1.0 - vUv.y), 0.0, 1.0);
          float along = clamp(1.0 - u, 0.0, 1.0);
          float a = wake ? 0.3 * pow(max(across, 0.0), 1.5) * along * smoothstep(0.0, 0.05, u)
                         : 0.95 * pow(max(across, 0.0), 0.6) * pow(max(along, 0.0), 1.2) * smoothstep(0.0, 0.02, u);
          a *= smoothstep(0.25, 0.75, n * 0.7 + n2 * 0.5);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uCol, a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    const foam = new THREE.Mesh(foamGeo, foamMat);
    foam.name = 'Carpathia bow wave';
    ship.add(foam);

    // navigation + deck lights (glow sprites)
    const LIGHTS = [
      [mt[0].x, mt[0].y - 6, 0, [1, 0.96, 0.88], 1.0], [mt[1].x, mt[1].y - 3, 0, [1, 0.96, 0.88], 0.9],
      [34.5, 20.4, -9.6, [1, 0.1, 0.05], 0.8], [34.5, 20.4, 9.6, [0.1, 1, 0.35], 0.8],
      [-81, 13, 0, [1, 0.95, 0.85], 0.6], [7, 17.8, 7.6, [1, 0.8, 0.5], 0.5], [7, 17.8, -7.6, [1, 0.8, 0.5], 0.5], [70, 16.8, 0, [1, 0.8, 0.5], 0.4],
    ];
    const glow = makeGlowPoints(LIGHTS.length, { minPx: 1.6, maxPx: 40, fadeFloor: 0.8 });
    glow.name = 'Carpathia lights';
    group.add(glow);

    // funnel smoke: soft billboards trailing downwind (pure function of t)
    const NSM = 120;
    const smoke = makeSprites(NSM, puffTexture());
    smoke.name = 'Carpathia smoke';
    group.add(smoke);

    const _v = V3(), _w = V3(), fwd = V3(), side = V3(), top = V3(), wind = V3();
    const api = {
      group, ship,
      update(t, S, ctx) {
        const on = S.world.carpathia > 0 && !S.env.underwater;
        group.visible = on;
        if (!on) return;
        const pos = S.world.carpathiaPos;
        const ch = S.world.carpathiaHeading, head = isFinite(ch) ? ch : Math.atan2(pos.z, -pos.x);   // bow toward the lifeboats (story)
        const c = Math.cos(head), s = Math.sin(head);
        const hF = seaH(pos.x + c * 70, pos.z - s * 70, t), hA = seaH(pos.x - c * 70, pos.z + s * 70, t);
        ship.position.set(pos.x, 0.08 * Math.sin(t * 0.4), pos.z);
        ship.rotation.set(0, 0, 0);
        ship.rotation.order = 'YZX';
        ship.rotation.y = head;
        ship.rotation.z = Math.atan2(hF - hA, 140) + 0.004 * Math.sin(t * 0.33);
        ship.rotation.x = 0.012 * Math.sin(t * 0.27 + 1.0);
        ship.updateMatrixWorld(true);
        const dawn = S.env.dawn;
        const lightK = 1 - 0.55 * sstep(0.5, 1.0, dawn);
        foamMat.uniforms.uTime.value = t;
        foamMat.uniforms.uCol.value.setRGB(0.55, 0.52, 0.56).multiplyScalar(0.6 + 0.8 * dawn);
        winMat.color.setRGB(1.0, 0.7, 0.38).multiplyScalar(2.2 * lightK);
        const dist = ctx.camera.position.distanceTo(ship.position);
        rigMat.opacity = clamp(110 / Math.max(1, dist), 0.04, 0.6);
        // lights
        const pa = glow.geometry.attributes.position, ca = glow.geometry.attributes.color, sa = glow.geometry.attributes.size;
        for (let i = 0; i < LIGHTS.length; i++) {
          const l = LIGHTS[i];
          _v.set(l[0], l[1], l[2]).applyMatrix4(ship.matrixWorld);
          pa.setXYZ(i, _v.x, _v.y, _v.z);
          const e = l[4] * 1.5 * lightK;
          ca.setXYZ(i, l[3][0] * e, l[3][1] * e, l[3][2] * e);
          sa.setX(i, 1.4);
        }
        pa.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
        glow.material.uniforms.uScale.value = ctx.renderer.getPixelRatio() * ctx.height / (2 * Math.tan(ctx.camera.fov * U.DEG / 2));
        // smoke trail
        top.copy(funnelTopLocal).applyMatrix4(ship.matrixWorld);
        fwd.set(c, 0, -s); side.set(s, 0, c);
        const ws = Math.max(2.5, S.env.wind);
        wind.set(-0.55, 0, -0.83).multiplyScalar(ws);
        const ip = smoke.geometry.attributes.iPos, id = smoke.geometry.attributes.iData;
        const DT = 0.42, ph = ((t % DT) + DT) % DT;
        const sunK = sstep(0.2, 0.9, dawn);
        smoke.material.uniforms.uLight.value.setRGB(lerp(0.12, 0.42, sunK), lerp(0.11, 0.33, sunK), lerp(0.13, 0.33, sunK));
        smoke.material.uniforms.uDark.value.setRGB(lerp(0.012, 0.03, sunK), lerp(0.011, 0.025, sunK), lerp(0.012, 0.024, sunK));
        for (let k = 0; k < NSM; k++) {
          const a = ph + k * DT, n = Math.floor((t - a) / DT);
          const r1 = U.hash1(n * 3 + 1) - 0.5, r2 = U.hash1(n * 3 + 2) - 0.5;
          const rise = 5.5 * Math.pow(a, 0.62);
          _w.copy(top).addScaledVector(fwd, -7.5 * a).addScaledVector(wind, a).addScaledVector(side, r1 * 0.6 * a);
          _w.y += rise + r2 * 0.25 * a;
          ip.setXYZ(k, _w.x, _w.y, _w.z);
          const alpha = 0.5 * sstep(0, 0.6, a) * Math.pow(1 - a / (NSM * DT), 2.6);
          id.setXYZW(k, 5.5 + 1.5 * a + r1 * 2.5, alpha, n * 1.7, clamp(0.05 + a / 60 + 0.2 * U.hash1(n * 3 + 3)));
        }
        ip.needsUpdate = id.needsUpdate = true;
      },
    };
    return api;
  }

  // ==================================================================
  // 5. DAWN ICE FIELD — 20 bergs of six shapes 1-8 km away, growlers and a
  //    band of pack ice on the north-western horizon (merged, lit by the dawn light)
  // ==================================================================
  const FIELD_VARIANTS = [
    { seed: 11, lumps: 4.5, flutes: 1.3, strata: 0.3, rough: 0.8, crag: 2.4, notch: 0.8, blend: 3,              // tabular, weathered
      blocks: [{ c: [0, 0], ax: 44, az: 28, h: 21, lean: 7, sides: 12, tops: [[20, 5], [200, 3], [110, 6], [290, 4]], base: -5, rot: 12 },
        { c: [-30, 10], ax: 16, az: 14, h: 15, lean: 12, sides: 7, tops: [[180, 12]], base: -5 },
        { c: [18, -8], ax: 12, az: 12, h: 25, lean: 10, sides: 6, tops: [[40, 25], [250, 18]], base: -5 }] },
    { seed: 12, lumps: 3, flutes: 1.3, strata: 0.2, rough: 0.8, crag: 2.2, notch: 0.8, blend: 3,              // pinnacle
      blocks: [{ c: [0, 0], ax: 26, az: 22, h: 14, lean: 12, sides: 8, tops: [[0, 12]], base: -5 },
        { c: [-4, 2], ax: 12, az: 11, h: 48, lean: 10, sides: 6, tops: [[30, 58], [210, 55], [120, 50], [300, 52]], base: -5, round: 0.8 }] },
    { seed: 13, lumps: 4, flutes: 0.6, strata: 0.1, rough: 0.5, crag: 0.8, notch: 0.6, blend: 6,              // dome
      blocks: [{ c: [0, 0], ax: 30, az: 26, h: 20, lean: 26, sides: 9, tops: [[0, 22], [120, 25], [240, 20]], base: -5, round: 3 }] },
    { seed: 14, lumps: 2.2, flutes: 1.3, strata: 0.2, rough: 0.8, crag: 2.6, notch: 0.8, blend: 1.8,          // dry dock: twin towers
      blocks: [{ c: [0, 0], ax: 38, az: 20, h: 7, lean: 6, sides: 8, tops: [[0, 3]], base: -5 },
        { c: [-24, 0], ax: 12, az: 17, h: 38, lean: 8, sides: 7, tops: [[0, 58], [180, 32], [90, 42], [270, 38], [320, 50]], base: -5, round: 0.6 },
        { c: [-18, 5], ax: 6, az: 7, h: 30, lean: 12, sides: 6, tops: [[40, 55], [220, 45]], base: -5, round: 0.6 },
        { c: [22, 2], ax: 11, az: 16, h: 31, lean: 8, sides: 7, tops: [[180, 60], [0, 30], [270, 36], [100, 44]], base: -5, round: 0.6 }] },
    { seed: 15, lumps: 3, flutes: 1.1, strata: 0.25, rough: 0.7, crag: 1.8, notch: 0.8, blend: 2.5,           // wedge
      blocks: [{ c: [0, 0], ax: 40, az: 22, h: 16, lean: 8, sides: 8, tops: [[180, 22], [90, 6]], base: -5, rot: 5 }] },
    { seed: 16, lumps: 3.5, flutes: 1.1, strata: 0.2, rough: 0.8, crag: 2.4, notch: 0.8, blend: 3,            // irregular massif
      blocks: [{ c: [0, 0], ax: 30, az: 24, h: 17, lean: 10, sides: 8, tops: [[40, 12], [220, 8]], base: -5 },
        { c: [14, -6], ax: 13, az: 12, h: 29, lean: 14, sides: 6, tops: [[0, 45], [150, 40], [260, 42]], base: -5 },
        { c: [-18, 8], ax: 10, az: 12, h: 22, lean: 16, sides: 6, tops: [[100, 40], [280, 35]], base: -5 }] },
  ];
  function bergBounds(v) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, h = 0;
    for (const b of v.blocks) { const r = Math.max(b.ax, b.az) * 1.15 + 6; x0 = Math.min(x0, b.c[0] - r); x1 = Math.max(x1, b.c[0] + r); z0 = Math.min(z0, b.c[1] - r); z1 = Math.max(z1, b.c[1] + r); h = Math.max(h, b.h); }
    return [x0, -4, z0, x1, h + 6, z1];
  }
  function buildIceField(ctx) {
    const group = new THREE.Group(); group.name = 'ice field';
    const q = ctx.quality;
    const csK = q === 'high' ? 1 : q === 'medium' ? 1.3 : 1.7;
    const fields = FIELD_VARIANTS.map((v) => bergField(v));
    const variants = FIELD_VARIANTS.map((v, i) => buildBerg(fields[i], { bb: bergBounds(v), cs: 1.5 * csK, band: 3, snowLine: 14, aoScale: 1.3 }));
    const variantsFar = FIELD_VARIANTS.map((v, i) => buildBerg(fields[i], { bb: bergBounds(v), cs: 2.7 * csK, band: 3.5, snowLine: 14, aoScale: 1.3 }));
    // placement: all around, 1-8 km, clear of Carpathia's track (from the south-east)
    const r = U.rng('ice-field'), list = [];
    const carpDir = new THREE.Vector2(-4600, -3000).normalize();
    const PLACED = [[1100, 0.6, 0, 0.9], [2300, 2.3, 1, 1.3], [1500, 3.75, 3, 0.8], [950, 5.2, 5, 0.7], [1700, 1.45, 4, 0.9]];   // chosen for composition [dist, angle, variant, scale]
    for (const p of PLACED) list.push({ d: p[0], a: p[1], v: p[2], s: p[3] });
    let guard = 0;
    while (list.length < 20 && guard++ < 500) {
      const a = r() * Math.PI * 2, d = 1000 + Math.pow(r(), 0.8) * 7000;
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      if (dir.dot(carpDir) > 0.93 && d < 6000) continue;
      if (list.some((o) => Math.hypot(Math.cos(o.a) * o.d - dir.x * d, Math.sin(o.a) * o.d - dir.y * d) < 500)) continue;
      list.push({ d, a, v: Math.floor(r() * variants.length), s: 0.45 + Math.pow(r(), 1.5) * 1.3 });
    }
    const geos = [], m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = V3(), pp = V3();
    for (const o of list) {
      const g = (o.d < 2600 ? variants : variantsFar)[o.v].clone();
      pp.set(-70 + Math.cos(o.a) * o.d, 0, 20 + Math.sin(o.a) * o.d);
      qq.setFromAxisAngle(sc.set(0, 1, 0), r() * Math.PI * 2);
      sc.set(o.s, o.s * (0.85 + r() * 0.3), o.s);
      g.applyMatrix4(m.compose(pp, qq, sc));
      geos.push(g);
    }
    for (const v of variants) v.dispose();
    for (const v of variantsFar) v.dispose();
    const bergs = new THREE.Mesh(TT.addons.BufferGeometryUtils.mergeGeometries(geos, false), makeIceMaterial({ bump: 1.6, objScale: 1 }));
    for (const g of geos) g.dispose();
    bergs.name = 'ice field bergs';
    bergs.frustumCulled = false;
    group.add(bergs);

    // pack ice: a band of flat floes low on the north-western horizon
    const floes = [];
    const fr = U.rng('pack-ice');
    const NFLOE = q === 'low' ? 500 : q === 'medium' ? 1000 : 1400;
    for (let i = 0; i < NFLOE; i++) {
      const a = (45 + (fr() - 0.5) * 95) * U.DEG, d = 3300 + fr() * 1800 + 350 * Math.sin(a * 5);
      const rad = 7 + Math.pow(fr(), 2.2) * 42, sides = 5 + Math.floor(fr() * 4), hgt = 0.7 + Math.pow(fr(), 3) * 3.6;
      const shape = new THREE.Shape();
      for (let k = 0; k < sides; k++) {
        const aa = k / sides * Math.PI * 2 + fr() * 0.5, rr = rad * (0.6 + fr() * 0.5);
        if (k === 0) shape.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr); else shape.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
      }
      const g = new THREE.ExtrudeGeometry(shape, { depth: hgt + 1.2, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(-70 + Math.cos(a) * d, -1.2, 20 + Math.sin(a) * d);
      g.deleteAttribute('uv');
      floes.push(g);
    }
    const floeGeo = TT.addons.BufferGeometryUtils.mergeGeometries(floes, false);
    for (const g of floes) g.dispose();
    { const n = floeGeo.attributes.position.count, ice = new Float32Array(n * 4), nn = floeGeo.attributes.normal;
      for (let i = 0; i < n; i++) { ice[i * 4] = nn.getY(i) > 0.5 ? 0.9 : 0.2; ice[i * 4 + 1] = 0.1; ice[i * 4 + 2] = 0; ice[i * 4 + 3] = 0.3; }
      floeGeo.setAttribute('aIce', new THREE.BufferAttribute(ice, 4)); }
    const pack = new THREE.Mesh(floeGeo, makeIceMaterial({ bump: 0 }));
    pack.name = 'pack ice'; pack.frustumCulled = false;
    group.add(pack);

    // growlers scattered among the lifeboats and around the bergs
    const gField = bergField({ seed: 21, lumps: 1.5, flutes: 0.4, strata: 0, rough: 0.6, notch: 0.3, blend: 2,
      blocks: [{ c: [0, 0], ax: 8, az: 7, h: 5, lean: 22, sides: 7, tops: [[60, 25], [230, 18]], base: -6 },
        { c: [-3, 1], ax: 5, az: 4, h: 7.5, lean: 25, sides: 5, tops: [[10, 35], [190, 30]], base: -6 }] });
    const gGeo = buildBerg(gField, { bb: [-13, -7, -11, 13, 10, 11], cs: 1.9, band: 3, snowLine: 5, aoScale: 0.5 });
    gGeo.scale(0.3, 0.3, 0.3);
    const NG = 70;
    const growl = new THREE.InstancedMesh(gGeo, makeIceMaterial({ bump: 0.3, lite: true }), NG);
    growl.name = 'ice field growlers'; growl.instanceMatrix.setUsage(THREE.DynamicDrawUsage); growl.frustumCulled = false;
    group.add(growl);
    const G = [];
    const gr = U.rng('field-growlers');
    for (let i = 0; i < NG; i++) {
      const near = i < 40;
      const a = gr() * Math.PI * 2, d = near ? 120 + gr() * 900 : 1000 + gr() * 3000;
      G.push({ x: -70 + Math.cos(a) * d, z: 20 + Math.sin(a) * d, s: (near ? 0.5 : 1.2) + Math.pow(gr(), 2) * (near ? 2.2 : 4), yaw: gr() * 6.28, ph: gr() * 6.28 });
    }
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V3(), _s = V3();
    return {
      group,
      update(t, S) {
        group.visible = S.world.iceField > 0 && !S.env.underwater;
        if (!group.visible) return;
        for (let i = 0; i < NG; i++) {
          const g = G[i];
          const h = seaH(g.x, g.z, t);
          _p.set(g.x, h - 0.3 * g.s, g.z);
          _e.set(0.06 * Math.sin(t * 0.6 + g.ph), g.yaw, 0.06 * Math.cos(t * 0.7 + g.ph));
          growl.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s.setScalar(g.s)));
        }
        growl.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // ==================================================================
  // 6. FLOATING DEBRIS — deck chairs, planks, doors, crates, cork life jackets
  //    (no bodies), surfacing from the break and the plunge, spreading on the current
  // ==================================================================
  function deckChairGeometry() {
    const W = lin(0x8a5a34), D = lin(0x5a3a22);
    return merge([
      box(0.62, 0.04, 0.55, 0, 0.36, 0, W), box(0.62, 0.04, 0.72, 0, 0.62, -0.5, W, -1.0, 0, 0),
      box(0.62, 0.04, 0.55, 0, 0.26, 0.5, W, 0.35, 0, 0),
      box(0.05, 0.05, 1.1, 0.33, 0.3, 0, D, 0.25, 0, 0), box(0.05, 0.05, 1.1, -0.33, 0.3, 0, D, 0.25, 0, 0),
      box(0.05, 0.05, 1.3, 0.33, 0.4, -0.2, D, -0.6, 0, 0), box(0.05, 0.05, 1.3, -0.33, 0.4, -0.2, D, -0.6, 0, 0),
      box(0.06, 0.05, 0.6, 0.34, 0.5, -0.05, D), box(0.06, 0.05, 0.6, -0.34, 0.5, -0.05, D),
    ]);
  }
  function lifeJacketGeometry() {
    const C = lin(0xe6e1d2), S = lin(0x8a8070);
    const parts = [];
    for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) parts.push(box(0.17, 0.09, 0.3, sd * 0.1, 0, -0.34 + i * 0.32, C));
    parts.push(box(0.36, 0.1, 0.03, 0, 0.01, 0.0, S), box(0.03, 0.1, 0.95, 0.0, 0.0, 0, S));
    return merge(parts);
  }
  function buildDebris() {
    const group = new THREE.Group(); group.name = 'floating debris';
    const r = U.rng('debris');
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
    const NW = 190, NC = 46, NJ = 70;
    const wood = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), woodMat, NW);
    wood.name = 'debris timber'; wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage); wood.frustumCulled = false;
    const chairs = new THREE.InstancedMesh(deckChairGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), NC);
    chairs.name = 'debris deck chairs'; chairs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chairs.frustumCulled = false;
    const jackets = new THREE.InstancedMesh(lifeJacketGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), NJ);
    jackets.name = 'debris life jackets'; jackets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); jackets.frustumCulled = false;
    group.add(wood, chairs, jackets);
    const EV = TT.story.EV;
    const BREAK = new THREE.Vector3(-18, 0, 6), PLUNGE = new THREE.Vector3(-70, 0, 22);
    const items = [];
    const col = new THREE.Color();
    const WOODS = [0x6a4a2c, 0x7a5634, 0x4e3420, 0xb09a78, 0xd8d2c2, 0x8c6a44, 0x3e2a1a].map((h) => new THREE.Color(h));
    const mk = (kind, idx) => {
      // birth: a first wave at the break, a second as the stern goes, stragglers after
      const w = r();
      const tb = w < 0.35 ? lerp(EV.breakStart + 1, EV.breakDone + 4, r()) : w < 0.85 ? lerp(EV.sternPlunge, EV.sternGone + 2, r()) : lerp(EV.sternGone, EV.sternGone + 12, r());
      const src = tb < EV.sternRise ? BREAK : PLUNGE;
      const a = r() * Math.PI * 2, d0 = Math.pow(r(), 0.7) * (tb < EV.sternRise ? 30 : 18);
      const it = { kind, idx, tb, x0: src.x + Math.cos(a) * d0, z0: src.z + Math.sin(a) * d0, a: a + (r() - 0.5) * 0.8, k: 0.6 + r() * 0.9,
        yaw: r() * 6.28, spin: (r() - 0.5) * 0.02, ph: r() * 6.28, tilt: (r() - 0.5) * 0.3, flip: r() < 0.5, far: 20 + 160 * Math.sqrt(r()) };
      if (kind === 0) {
        const t = r();
        if (t < 0.55) it.scale = [0.22 + r() * 0.12, 0.06 + r() * 0.03, 1.8 + r() * 3.4];              // planks
        else if (t < 0.75) it.scale = [0.82, 0.05, 2.0];                                                 // doors
        else if (t < 0.92) { const s = 0.45 + r() * 0.5; it.scale = [s, s * (0.6 + r() * 0.5), s * (0.8 + r() * 0.6)]; } // crates
        else it.scale = [0.9 + r() * 1.2, 0.08, 1.2 + r() * 1.6];                                       // panelling
        col.copy(WOODS[Math.floor(r() * WOODS.length)]);
        wood.setColorAt(idx, col);
      }
      items.push(it);
    };
    for (let i = 0; i < NW; i++) mk(0, i);
    for (let i = 0; i < NC; i++) mk(1, i);
    for (let i = 0; i < NJ; i++) mk(2, i);
    if (wood.instanceColor) wood.instanceColor.needsUpdate = true;
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V3(), _s = V3();
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const _q2 = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _n = V3();
    return {
      group,
      update(t, S) {
        const k = S.fx.debris;
        group.visible = k > 0.001 && !S.env.underwater;
        if (!group.visible) return;
        const dawn = t >= EV.dawn, wave = S.env.waveHeight || 0.12;
        for (const it of items) {
          const mesh = it.kind === 0 ? wood : it.kind === 1 ? chairs : jackets;
          if (!dawn && t < it.tb) { mesh.setMatrixAt(it.idx, ZERO); continue; }
          const age = dawn ? 7200 : t - it.tb;
          const spread = dawn ? it.far : Math.min(it.far, it.k * (7 * Math.sqrt(age) + 0.03 * age));
          const x = it.x0 + Math.cos(it.a) * spread + (dawn ? 0.4 * (t - EV.dawn) : 0), z = it.z0 + Math.sin(it.a) * spread;
          // ride the swell: height and slope from the sea surface (flat pieces would drown in the dawn waves)
          const h = seaH(x, z, t), hx = seaH(x + 1, z, t), hz = seaH(x, z + 1, t);
          const rise = dawn ? 1 : U.easeOutCubic(clamp(age / 2.5));
          const lift = 0.03 + 0.12 * wave;
          const sub = it.kind === 1 ? 0.24 : it.kind === 2 ? -lift : -lift + (it.scale[1] > 0.2 ? it.scale[1] * 0.35 : 0);
          _p.set(x, h - sub - (1 - rise) * 3, z);
          const wob = 0.06 * Math.sin(t * 0.9 + it.ph);
          const yaw = it.yaw + it.spin * age;
          if (it.kind === 1) _e.set(it.flip ? 1.9 : -0.3 + wob, yaw, it.tilt + wob, 'YXZ');
          else _e.set(it.tilt * 0.3 + wob, yaw, 0.05 * Math.cos(t * 0.7 + it.ph), 'YXZ');
          _q.setFromEuler(_e);
          // tilt with the local wave slope
          _q2.setFromUnitVectors(_up, _n.set(h - hx, 1, h - hz).normalize());
          _q.premultiply(_q2);
          if (it.kind === 0) _s.set(it.scale[0], it.scale[1], it.scale[2]); else _s.set(1, 1, 1);
          mesh.setMatrixAt(it.idx, _m.compose(_p, _q, _s));
        }
        wood.instanceMatrix.needsUpdate = chairs.instanceMatrix.needsUpdate = jackets.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // ==================================================================
  // 7. SEABED + the 1985 ROV sled — grey silt, ripples, the mud pushed up
  //    around the buried bow, rocks and wreckage; two lamps (the only light)
  // ==================================================================
  function boilerGeometry() {
    const R = lin(0x3a1c10), R2 = lin(0x57301c), D = lin(0x140c08);
    const parts = [cyl(2.4, 2.4, 6.1, 24, 0, 0, 0, R, 0, 0, Math.PI / 2)];
    for (const [fz, fy] of [[-1.25, -0.6], [0, -0.9], [1.25, -0.6]]) parts.push(cyl(0.55, 0.55, 0.3, 12, 3.1, fy, fz, D, 0, 0, Math.PI / 2));
    parts.push(cyl(2.45, 2.45, 0.25, 24, 3.0, 0, 0, R2, 0, 0, Math.PI / 2), cyl(2.45, 2.45, 0.25, 24, -3.0, 0, 0, R2, 0, 0, Math.PI / 2));
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; parts.push(box(0.15, 0.5 + (i % 3) * 0.3, 0.15, 3.1, Math.sin(a) * 1.9 - 0.3, Math.cos(a) * 1.9, R2)); } // rusticles
    return merge(parts);
  }
  function buildSeabed(ctx, rig) {
    const group = new THREE.Group(); group.name = 'seabed';
    const EV = TT.story.EV, Y0 = C.SEABED_Y;
    const rest = TT.story.makeState();
    TT.story.sample(EV.seabedImpact + 5, rest);
    const bowPose = P.create(); P.copy(bowPose, rest.ship.bow);
    const center = P.toWorld(bowPose, V3().set(60, 0, 0), V3());
    const q = ctx.quality;
    const SEG = q === 'high' ? 220 : q === 'medium' ? 160 : 110, SIZE = 1400;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    const pos = geo.attributes.position, n = pos.count;
    const berm = new Float32Array(n);
    const loc = V3(), w = V3();
    for (let i = 0; i < n; i++) {
      // denser near the wreck: pull the grid toward the centre
      let x = pos.getX(i), z = pos.getZ(i);
      const rr = Math.hypot(x, z) / (SIZE / 2), k = 0.35 + 0.65 * rr * rr;
      x *= k; z *= k;
      const wx = center.x + x, wz = center.z + z;
      let y = 2.2 * fbm(wx * 0.006, 0.3, wz * 0.006, 3) + 0.5 * fbm(wx * 0.04, 1.3, wz * 0.04, 2);
      // the bow ploughed in: mud heaped along her sides and in a mound ahead of the stem
      P.toLocal(bowPose, w.set(wx, Y0, wz), loc);
      let b = 0;
      if (loc.x > SH.BREAK_X - 6 && loc.x < SH.STEM_X + 30) {
        const hb = TT.hull.halfBeam(clamp(loc.x, SH.BREAK_X, SH.STEM_X - 0.5), clamp(loc.y, -10, 0)) + 0.3;
        const d = Math.abs(loc.z) - hb;
        const along = sstep(SH.BREAK_X - 4, SH.BREAK_X + 10, loc.x) * (0.45 + 0.55 * sstep(0, 120, loc.x));
        if (d > 0) b = 4.2 * along * Math.exp(-Math.pow(d / 7, 1.4)) * (0.8 + 0.4 * noise3(loc.x * 0.08, 0.5, loc.z * 0.08));
        else b = -2;
        const ahead = loc.x - SH.STEM_X;
        if (ahead > -4) b = Math.max(b, 3.0 * Math.exp(-Math.pow(Math.max(0, ahead) / 6, 2) - Math.pow(loc.z / 9, 2)));
      }
      berm[i] = b;
      pos.setXYZ(i, wx, Y0 + y, wz);
    }
    geo.setAttribute('aBerm', new THREE.BufferAttribute(berm, 1));
    geo.computeVertexNormals();
    const n0 = geo.attributes.normal.array.slice();
    for (let i = 0; i < n; i++) pos.setY(i, pos.getY(i) + berm[i]);
    geo.computeVertexNormals();
    geo.setAttribute('aNormal0', new THREE.BufferAttribute(n0, 3));
    for (let i = 0; i < n; i++) pos.setY(i, pos.getY(i) - berm[i]);
    geo.computeBoundingSphere();
    const U_IMP = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.34, 0.33, 0.3), roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uImpact = U_IMP;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aBerm; attribute vec3 aNormal0; uniform float uImpact; varying vec3 vSeaW; varying float vBerm;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(aNormal0, normal, uImpact));')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += aBerm * uImpact; vSeaW = transformed; vBerm = abs(aBerm) * uImpact;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSeaW; varying float vBerm;
          ${TT.glsl.noise}
          ${TTBUMP}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float gN = snoise(vSeaW * 0.08);
          diffuseColor.rgb *= 0.82 + 0.22 * gN + 0.1 * snoise(vSeaW * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.72, 0.6), smoothstep(0.3, 0.9, snoise(vSeaW * 0.02 + 3.0)));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float mpp = length(fwidth(vSeaW)) + 1e-4;
            vec2 dir = normalize(vec2(0.8, 0.6) + 0.3 * vec2(snoise(vSeaW * 0.01), snoise(vSeaW * 0.01 + 7.0)));
            float ph = dot(vSeaW.xz, dir) * 4.5 + snoise(vSeaW * 0.12) * 3.0;
            float disturbed = smoothstep(0.2, 1.5, vBerm);                      // churned mud: no ripples, clods
            float h = 0.022 * (0.5 + 0.5 * sin(ph)) * (1.0 - smoothstep(0.04, 0.3, mpp)) * (1.0 - disturbed);
            h += 0.03 * snoise(vSeaW * 1.3) * (1.0 - smoothstep(0.05, 0.3, mpp));
            h += (0.2 + 0.25 * disturbed) * snoise(vSeaW * vec3(0.25, 0.4, 0.25)) * (1.0 - smoothstep(0.5, 3.0, mpp));
            normal = ttBump(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)), faceDirection);
          }`);
    };
    mat.customProgramCacheKey = () => 'tt-seabed';
    const terrain = new THREE.Mesh(geo, mat);
    terrain.name = 'seabed terrain';
    terrain.frustumCulled = false;
    group.add(terrain);

    // rocks (dropstones), coal, hull plates, a boiler
    const rr = U.rng('seabed-items');
    const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.35 * noise3(x * 1.7, y * 1.7, z * 1.7); p.setXYZ(i, x * k, y * k * 0.7, z * k); }
      g.deleteAttribute('uv'); g.computeVertexNormals(); return g; })();
    const NR = 90, NCO = 260, NPL = 30;
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9 }), NR);
    const coal = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.55 }), NCO);
    const plateGeo = (() => { const g = new THREE.CylinderGeometry(6, 6, 1, 6, 1, true, 0, 0.9); g.deleteAttribute('uv'); return g; })();
    const plates = new THREE.InstancedMesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0x3b1a0e, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide }), NPL);
    rocks.name = 'seabed rocks'; coal.name = 'seabed coal'; plates.name = 'seabed hull plates';
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V3(), _s = V3();
    const groundY = (x, z) => Y0 + 2.2 * fbm(x * 0.006, 0.3, z * 0.006, 3) + 0.5 * fbm(x * 0.04, 1.3, z * 0.04, 2);
    const inHull = (lx, lz) => lx > SH.BREAK_X - 3 && lx < SH.STEM_X + 8 && Math.abs(lz) < 16;
    const place = (mesh, i, lx, lz, s, sy, flat) => {
      P.toWorld(bowPose, w.set(lx, 0, lz), _p);
      _p.y = groundY(_p.x, _p.z) - s * sy * 0.35;
      _e.set(flat ? (rr() - 0.5) * 0.3 : rr() * 6, rr() * 6.28, flat ? (rr() - 0.5) * 0.3 : rr() * 6);
      mesh.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s.set(s, s * sy, s)));
    };
    for (let i = 0; i < NR; i++) {
      let lx, lz; do { lx = -120 + rr() * 330; lz = (rr() - 0.5) * 260; } while (inHull(lx, lz));
      place(rocks, i, lx, lz, 0.25 + Math.pow(rr(), 3) * 1.8, 0.8, false);
    }
    for (let i = 0; i < NCO; i++) {
      let lx, lz; do {
        if (i < 170) { lx = SH.BREAK_X - 8 - Math.pow(rr(), 0.8) * 70; lz = (rr() - 0.5) * 60; }
        else { lx = SH.BREAK_X + rr() * 170; lz = (rr() < 0.5 ? -1 : 1) * (14 + Math.pow(rr(), 1.5) * 26); }
      } while (inHull(lx, lz));
      place(coal, i, lx, lz, 0.08 + rr() * 0.16, 0.8, false);
    }
    for (let i = 0; i < NPL; i++) {
      let lx, lz; do { lx = SH.BREAK_X - 5 - rr() * 60 + (i > 18 ? 90 + rr() * 60 : 0); lz = (rr() - 0.5) * (i > 18 ? 70 : 50); } while (inHull(lx, lz));
      const s = 0.5 + rr() * 0.8;
      P.toWorld(bowPose, w.set(lx, 0, lz), _p);
      _p.y = groundY(_p.x, _p.z) + 0.2;
      _e.set(Math.PI / 2 + (rr() - 0.5) * 0.4, rr() * 6.28, (rr() - 0.5) * 0.3);
      plates.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s.set(s, s * 1.4, s)));
    }
    const boiler = new THREE.Mesh(boilerGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.15 }));
    boiler.name = 'seabed boiler';
    P.toWorld(bowPose, w.set(SH.BREAK_X - 38, 0, 12), boiler.position);
    boiler.position.y = groundY(boiler.position.x, boiler.position.z) + 1.3;
    boiler.rotation.set(0.1, 0.9, 0.06);
    group.add(rocks, coal, plates, boiler);

    // ---- the ROV: a 1985 towed camera sled ----
    const rov = new THREE.Group(); rov.name = 'ROV sled';
    const AL = lin(0x9a9a92), DK = lin(0x202020), YEL = lin(0xc8a030), GL = [1, 1, 1];
    const frame = [];
    for (const [y, z] of [[-0.55, -0.55], [-0.55, 0.55], [0.55, -0.55], [0.55, 0.55]]) frame.push(cyl(0.05, 0.05, 4.6, 6, 0, y, z, AL, 0, 0, Math.PI / 2));
    for (const x of [-2.2, -0.7, 0.7, 2.2]) for (const [y, z, rx] of [[-0.55, 0, Math.PI / 2], [0.55, 0, Math.PI / 2]]) frame.push(cyl(0.04, 0.04, 1.1, 5, x, y, z, AL, rx, 0, 0));
    for (const x of [-2.2, 2.2]) for (const z of [-0.55, 0.55]) frame.push(cyl(0.04, 0.04, 1.1, 5, x, 0, z, AL));
    frame.push(box(1.4, 0.5, 0.6, -0.9, 0.05, 0, YEL), cyl(0.18, 0.18, 0.9, 10, 0.9, -0.1, 0.25, DK, 0, 0, Math.PI / 2), cyl(0.18, 0.18, 0.9, 10, 0.9, -0.1, -0.25, DK, 0, 0, Math.PI / 2));
    frame.push(cyl(0.12, 0.12, 0.6, 8, 0.4, 0.35, 0, DK), box(0.3, 0.6, 1.4, -2.2, 0.9, 0, AL), cyl(0.03, 0.03, 1.2, 4, 0, 1.15, 0, DK));
    // lamp housings, aimed forward and down (35 deg), lenses flush with their front rims
    for (const z of [-0.45, 0.45]) frame.push(cyl(0.2, 0.15, 0.42, 12, 2.16, -0.6, z, DK, 0, 0, -Math.PI / 2 - 0.6), box(0.36, 0.06, 0.06, 2.1, -0.52, z, AL));
    const sled = new THREE.Mesh(merge(frame), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
    sled.name = 'ROV frame';
    rov.add(sled);
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.94, 0.85).multiplyScalar(12) });
    const lensGeo = merge([cyl(0.17, 0.17, 0.03, 12, 0, 0, 0, GL)]);
    const LAMPS = [new THREE.Vector3(2.35, -0.73, -0.45), new THREE.Vector3(2.35, -0.73, 0.45)];
    for (const L of LAMPS) {
      const m = new THREE.Mesh(lensGeo, lensMat); m.position.copy(L); m.rotation.z = -Math.PI / 2 - 0.6; rov.add(m);
    }
    const spots = LAMPS.map((L, i) => {
      const sp = new THREE.SpotLight(0xfff0dc, 0, 140, 0.42, 0.65, 2);
      sp.name = 'ROV lamp ' + (i + 1);
      rig.add(sp); rig.add(sp.target);
      return sp;
    });
    // volumetric-looking beams: additive cones with soft edges and falloff
    const BEAM_L = 42;
    const coneGeo = new THREE.CylinderGeometry(0.2, BEAM_L * Math.tan(0.42), BEAM_L, 32, 12, true);
    coneGeo.translate(0, -BEAM_L / 2, 0);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          vAlong = -position.y / ${BEAM_L.toFixed(1)};
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uI, uTime; varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        ${TT.glsl.noise}
        void main(){
          // (MSAA evaluates varyings off the primitive: keep every pow() base >= 0 and never normalize zero)
          float edge = pow(max(abs(dot(vN, vV)) * inversesqrt(max(dot(vN, vN) * dot(vV, vV), 1e-12)), 0.0), 1.6);
          float fall = pow(max(1.0 - vAlong, 0.0), 2.2) * smoothstep(0.0, 0.04, vAlong) * step(vAlong, 1.0);
          float grain = 0.75 + 0.25 * snoise(vP * 0.35 + vec3(0.0, uTime * 0.3, 0.0));
          float a = uI * edge * fall * grain * 0.16;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beams = LAMPS.map((L) => { const b = new THREE.Mesh(coneGeo, beamMat); b.position.copy(L); b.name = 'ROV beam'; b.frustumCulled = false; rov.add(b); return b; });
    const glow = makeGlowPoints(2, { minPx: 3, maxPx: 120, fadeFloor: 1 });
    glow.name = 'ROV lamp glow';
    rov.add(glow);
    // tow cable rising into the dark
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 400, 4, 1, true).translate(0, 200, 0), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }));
    cable.position.set(-0.3, 1.1, 0); cable.rotation.z = 0.25; cable.name = 'ROV tow cable';
    rov.add(cable);
    group.add(rov);
    group.traverse((o) => o.layers.set(NOREF));

    const tgt = V3(), dir = V3(), up = new THREE.Vector3(0, 1, 0), _qq = new THREE.Quaternion(), mtx = new THREE.Matrix4();
    return {
      group, rov, spots,
      update(t, S, ctx) {
        const on = S.env.seabed > 0;
        group.visible = on;
        for (const s of spots) s.intensity = 0;
        if (!on) return;
        U_IMP.value = U.easeOutCubic(clamp((t - EV.seabedImpact) / 2.2));
        const k = S.fx.rov;
        rov.visible = t >= EV.rov;
        if (!rov.visible) {
          // before the sled arrives: a dim lamp riding with the camera, as if the sled were filming the impact
          const cl = sstep(EV.seabedImpact - 3, EV.seabedImpact - 1.5, t);
          if (cl > 0) {
            const cam = ctx.camera;
            cam.getWorldDirection(dir);
            for (let i = 0; i < 2; i++) {
              spots[i].position.copy(cam.position).addScaledVector(w.set(i ? 1 : -1, 0.6, 0).applyQuaternion(cam.quaternion), 1.5);
              spots[i].target.position.copy(spots[i].position).addScaledVector(dir, 40);
              spots[i].intensity = 5000 * cl;
            }
          }
          return;
        }
        const u = clamp((t - EV.rov) / (EV.dawn - EV.rov));
        // glide slowly aft over the bow railing, ~6 m above the forecastle deck, nose down a little
        P.toWorld(bowPose, w.set(lerp(137, 127, u), 23.8 + 0.3 * Math.sin(t * 0.8), lerp(3.2, 2.2, u)), rov.position);
        P.toWorld(bowPose, w.set(lerp(127, 117, u), 20.5, 0.5), tgt);
        mtx.lookAt(tgt, rov.position, up);
        _qq.setFromRotationMatrix(mtx);
        rov.quaternion.copy(_qq).multiply(_q.setFromAxisAngle(w.set(0, 1, 0), -Math.PI / 2));
        rov.quaternion.multiply(_q.setFromAxisAngle(w.set(1, 0, 0), 0.04 * Math.sin(t * 0.6)));
        rov.updateMatrixWorld(true);
        // lamps: aim at the railing and the deck just aft of it
        const aims = [[116, 17.6, -2.5], [121, 18.2, 3.5]];
        for (let i = 0; i < 2; i++) {
          P.toWorld(bowPose, w.set(aims[i][0] - 3 * u, aims[i][1], aims[i][2]), tgt);
          spots[i].position.copy(LAMPS[i]).applyMatrix4(rov.matrixWorld);
          spots[i].target.position.copy(tgt);
          spots[i].intensity = 3800 * k;
          dir.copy(rov.worldToLocal(tgt.clone())).sub(LAMPS[i]).normalize();
          beams[i].quaternion.setFromUnitVectors(w.set(0, -1, 0), dir);
        }
        beamMat.uniforms.uI.value = k;
        beamMat.uniforms.uTime.value = ctx.realTime;
        lensMat.color.setRGB(1, 0.94, 0.85).multiplyScalar(0.3 + 5 * k);
        const pa = glow.geometry.attributes.position, ca = glow.geometry.attributes.color, sa = glow.geometry.attributes.size;
        for (let i = 0; i < 2; i++) { pa.setXYZ(i, LAMPS[i].x + 0.05, LAMPS[i].y, LAMPS[i].z); ca.setXYZ(i, 0.9 * k, 0.85 * k, 0.76 * k); sa.setX(i, k > 0.01 ? 1.0 : 0); }
        pa.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
        glow.material.uniforms.uScale.value = ctx.renderer.getPixelRatio() * ctx.height / (2 * Math.tan(ctx.camera.fov * U.DEG / 2));
      },
    };
  }

  // ==================================================================
  // Module
  // ==================================================================
  const parts = [];
  const _sv = V3();
  TT.register('props', {
    order: 40,
    iceberg: null,
    carpathia: null,
    root: null,
    async init(ctx) {
      const root = new THREE.Group(); root.name = 'props';
      ctx.scene.add(root);
      this.root = root;
      const yieldUI = () => new Promise((res) => setTimeout(res, 0));
      // all props lights live here, always in the scene (intensity 0 when unused) so the scene's
      // light count never changes and no material has to recompile mid-film
      const rig = new THREE.Group(); rig.name = 'props lights';
      root.add(rig);
      // each piece is independent: one failing never takes the others down
      const build = (name, fn) => {
        try { const p = fn(); root.add(p.group); parts.push(p); return p; } catch (e) { TT.error('props init ' + name, e); return null; }
      };
      const berg = build('iceberg', () => buildIceberg(ctx));
      this.iceberg = berg ? berg.group : null;
      await yieldUI();
      this._boats = build('lifeboats', () => buildBoats(ctx, rig));
      await yieldUI();
      build('californian', () => buildCalifornian());
      const carp = build('carpathia', () => buildCarpathia(ctx));
      this.carpathia = carp ? carp.group : null;
      await yieldUI();
      build('ice field', () => buildIceField(ctx));
      await yieldUI();
      build('debris', () => buildDebris());
      build('seabed', () => buildSeabed(ctx, rig));
      this._needCompile = true;
    },
    boatWorld(i, target) {
      const out = target || new THREE.Vector3();
      const b = this._boats;
      if (!b || !b.state[i]) return out.set(0, 0, 0);
      return out.copy(b.state[i].pos);
    },
    update(t, dt, ctx) {
      const S = ctx.S;
      // once every module is up: compile all props materials now (hidden pieces included), so the
      // cut to dawn or to the seabed doesn't stall on shader compilation
      if (this._needCompile) {
        this._needCompile = false;
        const hidden = [];
        this.root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
        try { ctx.renderer.compile(ctx.scene, ctx.camera); } catch (e) { TT.error('props compile', e); }
        for (const o of hidden) o.visible = false;
      }
      // shared ice uniforms: ghostly night glow, rocket flashes
      ICEU.uGhost.value = (1 - S.env.dawn) * (1 - S.env.underwater);
      ICEU.uDawn.value = S.env.dawn;
      ICEU.uTime.value = t;
      // the ship's lit side as a line light for the ice (while she is whole and lit)
      const shipK = S.ship.visible && S.ship.broken < 0.01 ? 0.8 * S.ship.lights : 0;
      ICEU.uShipK.value = shipK;
      if (shipK > 0) { P.toWorld(S.ship.intact, _sv.set(-110, 8, 0), ICEU.uShipA.value); P.toWorld(S.ship.intact, _sv.set(122, 8, 0), ICEU.uShipB.value); }
      for (let i = 0; i < 4; i++) {
        const f = TT.flashes[i];
        ICEU.uFlashPos.value[i].copy(f.pos);
        ICEU.uFlashCol.value[i].set(f.color.r, f.color.g, f.color.b).multiplyScalar(f.intensity * 0.1);
        ICEU.uFlashRange.value[i] = f.range;
      }
      for (const p of parts) {
        try { p.update(t, S, ctx, dt); } catch (e) {
          p._err = (p._err || 0) + 1;
          if (p._err < 3) TT.error('props update ' + (p.group && p.group.name), e);
        }
      }
    },
  });
})();
