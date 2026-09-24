import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/60_fx.js ====
// =====================================================================
// 60_fx.js — post-processing (scene pass + depth of field, bloom, cinematic
// grade, tone mapping, anti-aliasing, film finish) and every particle effect
// (funnel smoke, steam, distress rockets, collision ice, splashes, the break,
// bubbles and surface boil, marine snow, light shafts, seabed silt, mist).
// Owner: fx agent.  Register key 'fx' (order 60).
//
// All particles are GPU instanced billboards whose positions are analytic
// functions of (t - birth). Emitters that ride on the ship read a history
// look-up texture (section matrices + story scalars sampled over the whole
// film at init), so any story time renders correctly on a cold start.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = TT.CONST.SHIP;
  const EV = () => TT.story.EV;

  // ------------------------------------------------------------------
  // small helpers
  // ------------------------------------------------------------------
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

  function makeFsQuad(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      mesh,
      get material() { return mesh.material; },
      set material(m) { mesh.material = m; },
      render(renderer) { renderer.render(mesh, cam); },
    };
  }

  // A pass object compatible with ADDONS.EffectComposer (duck-typed Pass).
  function shaderPass(material, opts = {}) {
    const q = makeFsQuad(material);
    return {
      enabled: true, needsSwap: true, clear: false, renderToScreen: false,
      material, uniforms: material.uniforms,
      setSize: opts.setSize || (() => {}),
      render(renderer, writeBuffer, readBuffer) {
        if (material.uniforms.tDiffuse) material.uniforms.tDiffuse.value = readBuffer.texture;
        if (opts.before) opts.before(renderer, writeBuffer, readBuffer);
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        q.render(renderer);
      },
      dispose() { material.dispose(); },
    };
  }

  const FS_VERT = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  // ------------------------------------------------------------------
  // module state
  // ------------------------------------------------------------------
  const fx = {
    order: 60,
    composer: null,
    stats: { sceneCalls: 0, sceneTris: 0, scenePoints: 0, sceneLines: 0 },   // the scene pass (what TT_FRAME_READY prints)
    systems: [],
    lights: [],
  };
  TT.register('fx', fx);

  // ==================================================================
  // POST-PROCESSING
  // ==================================================================

  // ---- scene pass: renders the scene into an HDR (MSAA on high) target with a depth
  // texture, then copies it into the composer chain, through a depth-of-field gather
  // when the director opens the aperture.
  const DOF_FRAG = /* glsl */`
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform vec2 uRes;       // pixels
    uniform float uNear, uFar, uFocus, uAperture, uMaxR, uDof, uSeed;
    varying vec2 vUv;
    float linDepth(vec2 uv){ float d = texture2D(tDepth, uv).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
    float cocAt(float z){
      // thin-lens style circle of confusion (pixels), stronger for the foreground
      float c = uAperture * uMaxR * abs(z - uFocus) / max(z, 0.001) * (z < uFocus ? 1.35 : 1.0);
      return clamp(c, 0.0, uMaxR);
    }
    bool badf(float x){ return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
    vec3 clean(vec3 c){
      // guard the bloom chain: a single NaN/Inf pixel would smear black blocks over the frame
      // (bit test: the D3D compiler folds isnan() away)
      if (badf(c.r) || badf(c.g) || badf(c.b)) return vec3(0.0);
      return clamp(c, vec3(0.0), vec3(4000.0));   // negatives (from any shader) would darken blurs
    }
    bool badv(vec3 c){ return badf(c.r) || badf(c.g) || badf(c.b) || min(c.r, min(c.g, c.b)) < 0.0; }
    void main(){
      vec4 base = texture2D(tColor, vUv);
      if (badv(base.rgb)) {
        // a NaN pixel (e.g. pow() of a slightly negative value extrapolated at an MSAA edge):
        // heal it from its valid neighbours instead of printing a black dot
        vec3 acc = vec3(0.0); float n = 0.0;
        for (int k = 0; k < 12; k++) {
          float a = float(k) * 0.5236;
          vec2 o = vec2(cos(a), sin(a)) * (k < 6 ? 1.5 : 3.0) / uRes;
          vec3 s = texture2D(tColor, vUv + o).rgb;
          if (!badv(s)) { acc += s; n += 1.0; }
        }
        base.rgb = n > 0.0 ? acc / n : vec3(0.0);
      }
      base.rgb = clean(base.rgb);
      if (uDof < 0.5) { gl_FragColor = base; return; }
      float zc = linDepth(vUv);
      float cc = cocAt(zc);
      vec3 acc = base.rgb; float wsum = 1.0;
      const int N = 64;
      const float GA = 2.39996323;
      // per-pixel random rotation + radial jitter of the spiral: undersampling turns into fine
      // noise (hidden by the grain) instead of rings or arcs
      vec3 p3 = fract(vec3(gl_FragCoord.xyx) * vec3(0.1031, 0.1030, 0.0973) + uSeed);
      p3 += dot(p3, p3.yzx + 33.33);
      vec2 hn = fract((p3.xx + p3.yz) * p3.zy);
      float rot0 = hn.x * 6.2831853;
      for (int i = 1; i < N; i++) {
        float fi = float(i);
        float r = sqrt((fi - 1.0 + hn.y) / float(N - 1)) * uMaxR;
        float a = fi * GA + rot0;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
        vec3 s = clean(texture2D(tColor, uv).rgb);
        float zs = linDepth(uv);
        float cs = cocAt(zs);
        // a sample behind the centre may not blur over a sharper centre
        float ce = zs > zc ? min(cs, cc * 1.5 + 0.5) : cs;
        float w = smoothstep(r - 1.5, r + 0.5, ce);
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        w *= 1.0 + 0.5 * smoothstep(1.0, 6.0, l);   // bokeh discs favour highlights
        acc += s * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`;

  function makeScenePass(ctx) {
    const samples = ctx.quality === 'high' ? 4 : 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.3 }, uFar: { value: 32000 }, uFocus: { value: 300 }, uAperture: { value: 0 },
        uMaxR: { value: 12 }, uDof: { value: 0 }, uSeed: { value: 0 },
      },
      vertexShader: FS_VERT, fragmentShader: DOF_FRAG, depthTest: false, depthWrite: false,
    });
    const q = makeFsQuad(mat);
    let rt = null;
    function build(w, h) {
      if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); }
      const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      // 4x MSAA up to ~5 MP (1080p at 1.5 DPR), 2x beyond that (4K) to bound memory and fill cost
      const s = samples > 0 ? (w * h > 5.2e6 ? 2 : samples) : 0;
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: s, depthTexture: dt, depthBuffer: true });
      rt.texture.name = 'fx.scene';
      mat.uniforms.tColor.value = rt.texture;
      mat.uniforms.tDepth.value = dt;
      mat.uniforms.uRes.value.set(w, h);
    }
    return {
      enabled: true, needsSwap: true, clear: false, renderToScreen: false,
      get rt() { return rt; },
      setSize(w, h) { w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); if (!rt || rt.width !== w || rt.height !== h) build(w, h); },
      render(r, writeBuffer) {
        const cam = ctx.camera;
        r.setRenderTarget(rt);
        r.render(ctx.scene, cam);
        const inf = r.info.render;
        fx.stats.sceneCalls = inf.calls; fx.stats.sceneTris = inf.triangles;
        fx.stats.scenePoints = inf.points; fx.stats.sceneLines = inf.lines;
        const ud = cam.userData || {};
        const ap = ud.aperture || 0;
        const u = mat.uniforms;
        u.uDof.value = ctx.quality === 'high' && ap > 0.01 ? 1 : 0;
        u.uNear.value = cam.near; u.uFar.value = cam.far;
        u.uFocus.value = Math.max(0.5, ud.focus || 300);
        u.uAperture.value = U.clamp(ap, 0, 1);
        u.uMaxR.value = 13 * (rt.height / 1080);
        u.uSeed.value = (Math.floor(ctx.realTime * 24) % 64) * 0.137;
        r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        q.render(r);
      },
      dispose() { if (rt) rt.dispose(); mat.dispose(); },
    };
  }

  // ---- the cinematic grade (scene-referred, before the ACES tone map) ----
  const GRADE_FRAG = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tHalA;   // bloom mip (1/4 res, blurred highlights)
    uniform sampler2D tHalB;   // bloom mip (1/8 res)
    uniform float uExposure, uSat, uContrast, uWarmth, uVignette, uUnder, uNight, uHalation, uDawn, uDepthDark, uStreak;
    uniform vec2 uRes;
    // the water volume (underwater): scene depth, camera rays, scattered light
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat3 uCamRot;
    uniform float uNear, uFar, uAbyss, uAbyssK, uMurkT;
    uniform vec3 uAbyssCol, uCamPos, uFogT;
    varying vec2 vUv;
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    float vnoise3(vec3 p){
      vec3 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    void main(){
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;

      // film halation: a warm red-orange glow bleeding around the brightest lamps
      vec3 h = texture2D(tHalA, uv).rgb * 0.6 + texture2D(tHalB, uv).rgb * 0.4;
      c += vec3(1.0, 0.32, 0.10) * luma(h) * uHalation;

      // a faint anamorphic streak on the very brightest sources (rocket bursts, flares)
      if (uStreak > 0.0) {
        vec3 st = vec3(0.0);
        for (int i = -7; i <= 7; i++) {
          float o = float(i) / 7.0;
          vec3 s = texture2D(tHalB, uv + vec2(o * 0.22, 0.0)).rgb;
          st += max(s - vec3(0.35), 0.0) * exp(-abs(o) * 3.5);
        }
        c += st * vec3(0.75, 0.85, 1.0) * uStreak;
      }

      c *= uExposure;

      // white balance (warmth -1 cold .. +1 warm)
      vec3 wb = uWarmth >= 0.0 ? mix(vec3(1.0), vec3(1.10, 1.0, 0.84), uWarmth) : mix(vec3(1.0), vec3(0.86, 0.97, 1.14), -uWarmth);
      c *= wb;

      // saturation (a little less in the deep shadows, like film)
      float l = luma(c);
      float satS = uSat * mix(0.8, 1.0, smoothstep(0.0005, 0.03, l));
      c = max(mix(vec3(l), c, satS), 0.0);

      // contrast about a low (night) pivot, in log space: deep, rich blacks
      float pivot = mix(0.06, 0.18, uDawn);
      c = pivot * exp2(log2(max(c, 1e-6) / pivot) * uContrast);

      // split tone: cool teal-blue shadows, warm highlights
      l = luma(c);
      float hiW = smoothstep(0.05, 1.2, l);
      c *= mix(vec3(1.0), mix(vec3(0.94, 1.0, 1.08), vec3(1.06, 1.0, 0.92), hiW), 0.65);

      // night: lift the very bottom toward blue so blacks are inky, never grey
      float shadowW = 1.0 - smoothstep(0.0, 0.012, l);
      c += vec3(0.00035, 0.0007, 0.0016) * shadowW * uNight * (1.0 - uUnder);

      // underwater: teal, red absorbed, crushed
      if (uUnder > 0.0) {
        // near the surface the water filters out red; in the deep everything seen is lamp-lit at short range
        vec3 w = c * mix(vec3(0.30, 0.85, 1.0), vec3(0.72, 0.9, 1.0), uDepthDark);
        float wl = luma(w);
        w = mix(vec3(wl), w, 0.85);
        w = max(w - 0.0004, 0.0) * 1.05;
        w += vec3(0.0, 0.0012, 0.0016) * (1.0 - uDepthDark);
        if (uAbyss > 0.0) {
          // the water itself: faint cold light scattered through the volume, brighter looking up
          // toward the far-off surface, darker toward the seabed. Whatever is solid in front hides
          // the glowing water behind it, so the black hull reads as a silhouette against it.
          vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
          vec3 vd = normalize(vp.xyz / vp.w);
          vec3 wd = uCamRot * vd;
          float dz = texture2D(tDepth, uv).x;
          float zl = uNear * uFar / (uFar - dz * (uFar - uNear));
          float range = dz >= 0.999999 ? 1e6 : zl / max(-vd.z, 1e-3);
          // the underside of the sea surface is where the light comes from, not a wall
          bool surf = uCamPos.y < -0.5 && uCamPos.y + wd.y * range > -1.2;
          if (surf) range = 1e6;
          float up = wd.y;
          float dome = 0.15 + 0.85 * smoothstep(-0.5, 0.9, up) + 0.7 * pow(max(up, 0.0), 3.0);
          // slow, drifting murk: soft swells in the scattered light, and faint streaks of it
          // falling from above (converging overhead, like shafts seen from far below)
          vec3 q = wd * 2.6 + vec3(0.0, uMurkT * 0.025, uMurkT * 0.016);
          float n = vnoise3(q) * 0.6 + vnoise3(q * 2.3 + 7.1) * 0.4;
          float sh = vnoise3(vec3(wd.x * 11.0 + uMurkT * 0.03, wd.y * 1.1, wd.z * 11.0 - uMurkT * 0.02));
          vec3 glow = uAbyssCol * dome * (0.7 + 0.6 * n) * (0.85 + 0.45 * sh * sh * smoothstep(-0.3, 0.7, up));
          w += glow * (1.0 - exp(-range * uAbyssK)) * uAbyss;
          // at grazing angles the surface mirrors the water below (total internal reflection):
          // never darker than the open water under the horizon
          if (surf) w = mix(w, max(w, uFogT + glow * uAbyss), 1.0 - smoothstep(0.1, 0.55, up));
        }
        c = mix(c, w, uUnder);
      }

      // vignette (elliptical, soft)
      vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      c *= 1.0 - uVignette * smoothstep(0.08, 0.95, dot(d, d));

      gl_FragColor = vec4(c, 1.0);
    }`;

  // ---- film finish (display-referred): chromatic aberration, grain, fade, dither ----
  const FINISH_FRAG = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uGrain, uFade, uTime, uCA, uPx;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      vec3 c;
      if (uCA > 0.0) {
        vec2 off = dc * r2 * uCA;
        c.r = texture2D(tDiffuse, uv - off).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv + off).b;
      } else c = texture2D(tDiffuse, uv).rgb;
      // grain: small clumps, animated at 24 fps, strongest in the mid tones
      vec2 gp = floor(gl_FragCoord.xy / uPx);
      float fr = floor(uTime * 24.0);
      float n = h12(gp + fr * 17.13) + h12(gp * 1.37 + fr * 3.1) - 1.0;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += n * uGrain * (0.35 + 1.6 * l * (1.0 - l)) * 0.55;
      c *= 1.0 - uFade;
      // dither against banding in the night gradients
      c += (h12(gl_FragCoord.xy + fr) - 0.5) / 255.0;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`;

  function buildPost(ctx) {
    const A = ctx.addons || TT.addons;
    const renderer = ctx.renderer;
    const w = ctx.width, h = ctx.height;
    const pr = renderer.getPixelRatio();
    const composer = new A.EffectComposer(renderer);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    const scenePass = makeScenePass(ctx);
    composer.addPass(scenePass);

    const bloom = new A.UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.8, 0.55, 1.0);
    // bright pass with a soft knee and highlight compression: rocket flashes are 50x brighter
    // than lamps, and uncompressed they would print the blur kernels' square footprints
    bloom.highPassUniforms.smoothWidth.value = 1.2;
    bloom.materialHighPassFilter.fragmentShader = /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float luminosityThreshold, smoothWidth;
      varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float k = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, l);
        c *= k;
        c *= 1.0 / (1.0 + l * k / 10.0);
        // a hard knee well above the lamps: a rocket's report or a star at 30x lamp brightness
        // must not print the blur kernels' truncated (square) tails
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (l2 > 3.0) c *= (3.0 + (l2 - 3.0) * 0.12) / l2;
        gl_FragColor = vec4(c, 1.0);
      }`;
    bloom.materialHighPassFilter.needsUpdate = true;
    // proper Gaussian blur weights: the stock sigma = kernel radius truncates at one sigma, a
    // near-box kernel whose tails print soft squares around every bright lamp (and the
    // halation reads those mips directly). Truncating at two sigma keeps every glow round.
    (bloom.separableBlurMaterials || []).forEach((m) => {
      const cu = m.uniforms && m.uniforms.gaussianCoefficients;
      const K = m.defines && m.defines.KERNEL_RADIUS;
      if (!cu || !Array.isArray(cu.value) || !K) return;
      const sg = Math.max(1, (K - 1) / 2);
      const co = [];
      for (let i = 0; i < K; i++) co.push(0.39894 * Math.exp((-0.5 * i * i) / (sg * sg)) / sg);
      cu.value = co;
    });
    bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.85, 0.6, 0.45, 0.35];
    bloom.bloomTintColors = [
      new THREE.Vector3(1.0, 1.0, 1.0), new THREE.Vector3(1.0, 0.97, 0.94), new THREE.Vector3(1.0, 0.93, 0.86),
      new THREE.Vector3(1.0, 0.88, 0.78), new THREE.Vector3(0.95, 0.85, 0.8)];
    composer.addPass(bloom);

    const gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tHalA: { value: bloom.renderTargetsVertical[1].texture }, tHalB: { value: bloom.renderTargetsVertical[2].texture },
        uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uWarmth: { value: 0 }, uVignette: { value: 0.4 },
        uUnder: { value: 0 }, uNight: { value: 1 }, uHalation: { value: 0.25 }, uDawn: { value: 0 }, uDepthDark: { value: 0 }, uStreak: { value: 0 },
        uRes: { value: new THREE.Vector2(w, h) },
        tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
        uNear: { value: 0.3 }, uFar: { value: 32000 }, uAbyss: { value: 0 }, uAbyssK: { value: 0.007 }, uMurkT: { value: 0 },
        uAbyssCol: { value: new THREE.Vector3() }, uCamPos: { value: new THREE.Vector3() }, uFogT: { value: new THREE.Vector3() },
      },
      vertexShader: FS_VERT, fragmentShader: GRADE_FRAG, depthTest: false, depthWrite: false,
    });
    const grade = shaderPass(gradeMat, { setSize: (ww, hh) => gradeMat.uniforms.uRes.value.set(ww, hh) });
    composer.addPass(grade);

    const output = new A.OutputPass();
    composer.addPass(output);

    let aa = null;
    if (ctx.quality === 'medium' && A.SMAAPass) {
      aa = new A.SMAAPass(w * pr, h * pr);
      composer.addPass(aa);
    } else if (ctx.quality === 'low' && A.FXAAShader) {
      const fm = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(A.FXAAShader.uniforms),
        vertexShader: A.FXAAShader.vertexShader,
        // sample mip 0 explicitly (the stock bias of -100 draws a compiler warning on D3D)
        fragmentShader: A.FXAAShader.fragmentShader.replace(/texture2D\(t, p, -100\.0\)/g, 'textureLod(t, p, 0.0)')
          .replace(/texture2D\(t, p \+ \(o \* r\), -100\.0\)/g, 'textureLod(t, p + (o * r), 0.0)'),
        depthTest: false, depthWrite: false,
      });
      aa = shaderPass(fm, { setSize: (ww, hh) => fm.uniforms.resolution.value.set(1 / ww, 1 / hh) });
      composer.addPass(aa);
    }

    const finMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(w, h) }, uGrain: { value: 0.05 }, uFade: { value: 0 },
        uTime: { value: 0 }, uCA: { value: 0.012 }, uPx: { value: 1.4 },
      },
      vertexShader: FS_VERT, fragmentShader: FINISH_FRAG, depthTest: false, depthWrite: false,
    });
    const finish = shaderPass(finMat, { setSize: (ww, hh) => finMat.uniforms.uRes.value.set(ww, hh) });
    composer.addPass(finish);

    return { composer, scenePass, bloom, grade, gradeMat, output, aa, finish, finMat };
  }

  // ==================================================================
  // HISTORY LOOK-UP TEXTURE
  // The story is sampled over the whole film at init; particles read the ship's
  // section matrices and story scalars at their birth time from it (seek-safe).
  //   row 0: travel.x, travel.z, speed, heading
  //   row 1: smoke, steam, lights, breakSparks
  //   row 2: bubbles, scrape, iceFall, flood
  //   rows 3-5: bow section matrix (row-major 3x4)   rows 6-8: stern section matrix
  //   row 9: iceberg pos xyz, visible     row 10: scrape contact point (world) xyz, scrape
  // ==================================================================
  const HIST_N = 2048, HIST_ROWS = 12;
  function buildHistory() {
    const dur = C.DURATION;
    const data = new Float32Array(HIST_N * HIST_ROWS * 4);
    const st = TT.story.makeState();
    const m = new THREE.Matrix4(), loc = new THREE.Vector3(), wp = new THREE.Vector3();
    const put = (row, i, a, b, c, d) => { const o = (row * HIST_N + i) * 4; data[o] = a; data[o + 1] = b; data[o + 2] = c; data[o + 3] = d; };
    for (let i = 0; i < HIST_N; i++) {
      const t = (i / (HIST_N - 1)) * dur;
      TT.story.sample(t, st);
      const s = st.ship;
      put(0, i, s.travel.x, s.travel.y, s.speed, s.heading);
      put(1, i, s.smoke, s.steam, s.lights, st.fx.breakSparks);
      put(2, i, st.fx.bubbles, st.fx.scrape, st.fx.iceFall, s.flood);
      TT.pose.matrix(s.bow, m); let e = m.elements;
      put(3, i, e[0], e[4], e[8], e[12]); put(4, i, e[1], e[5], e[9], e[13]); put(5, i, e[2], e[6], e[10], e[14]);
      TT.pose.matrix(s.stern, m); e = m.elements;
      put(6, i, e[0], e[4], e[8], e[12]); put(7, i, e[1], e[5], e[9], e[13]); put(8, i, e[2], e[6], e[10], e[14]);
      put(9, i, st.iceberg.pos.x, st.iceberg.pos.y, st.iceberg.pos.z, st.iceberg.visible);
      // where the berg grinds along the starboard side: the berg centre projected on the hull
      TT.pose.toLocal(s.intact, st.iceberg.pos, loc);
      const cx = U.clamp(loc.x - 6, -40, 124);
      loc.set(cx, 1.5, TT.hull.halfBeam(cx, 1.5) + 0.4);
      TT.pose.toWorld(s.intact, loc, wp);
      put(10, i, wp.x, wp.y, wp.z, st.fx.scrape);
    }
    const tex = new THREE.DataTexture(data, HIST_N, HIST_ROWS, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // ==================================================================
  // PROCEDURAL TEXTURES
  // ==================================================================
  function vnoise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a, b) => U.hash1((a * 374761393 + b * 668265263 + seed * 1442695041) | 0);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm2(x, y, oct, seed) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise2(x, y, seed + i * 17); n += a; x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; a *= 0.5; }
    return s / n;
  }

  // Puff atlas: 2x2 cauliflower puffs, 256 px each.
  //   R = density, G = lit-from-below shading, B = erosion noise, A = wispy density
  function makePuffAtlas() {
    const S = 256, W = S * 2;
    const dens = new Float32Array(W * W), ero = new Float32Array(W * W), wisp = new Float32Array(W * W);
    const rnd = U.rng('fx-puffs');
    for (let v = 0; v < 4; v++) {
      const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
      const blobs = [];
      const nb = 7 + Math.floor(rnd() * 5);
      for (let b = 0; b < nb; b++) {
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * 0.2;
        blobs.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 0.9, 0.13 + rnd() * 0.12]);
      }
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const x = (i + 0.5) / S, y = (j + 0.5) / S;
        let d = 0;
        for (const [bx, by, br] of blobs) {
          const dd = Math.hypot(x - bx, y - by) / br;
          d += Math.max(0, 1 - dd * dd) ** 1.6;
        }
        const n = fbm2(x * 5 + v * 10, y * 5, 5, 3 + v);
        const n2 = fbm2(x * 11 + v * 7, y * 11, 4, 29 + v);
        const rr = Math.hypot(x - 0.5, y - 0.5) / 0.5;
        const base = Math.exp(-rr * rr * 2.4) * (1 - U.smoothstep(0.62, 1.0, rr));
        const den = U.clamp(base * (0.2 + 1.5 * U.smoothstep(0.25, 0.8, n) + 0.3 * Math.min(d, 1.2)) * 0.85);
        const k = (oy + j) * W + ox + i;
        dens[k] = den;
        ero[k] = U.clamp(n2 * 1.25 - 0.1);
        wisp[k] = den * U.smoothstep(0.35, 0.75, n2 * 0.6 + n * 0.6);
      }
    }
    const px = new Uint8Array(W * W * 4);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const up = dens[Math.min(W - 1, j + 9) * W + i], dn = dens[Math.max(0, j - 9) * W + i];
      const yl = ((j % S) + 0.5) / S;
      const lit = U.clamp(0.5 + (up - dn) * 1.1 + (0.5 - yl) * 0.7);
      px[k * 4] = dens[k] * 255; px[k * 4 + 1] = lit * 255; px[k * 4 + 2] = ero[k] * 255; px[k * 4 + 3] = wisp[k] * 255;
    }
    const tex = new THREE.DataTexture(px, W, W, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    return tex;
  }

  // Foam: tileable cellular foam lines (R) + a soft mottling (G). 256 px.
  function makeFoamTexture() {
    const S = 256, CELLS = 10;
    const rnd = U.rng('fx-foam');
    const pts = [];
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) pts.push([(i + rnd()) / CELLS, (j + rnd()) / CELLS]);
    const px = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S, y = (j + 0.5) / S;
      let d1 = 9, d2 = 9;
      const ci = Math.floor(x * CELLS), cj = Math.floor(y * CELLS);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + CELLS) % CELLS, jj = (cj + dj + CELLS) % CELLS;
        const p = pts[jj * CELLS + ii];
        const dx = x - (p[0] + (ci + di - ii) / CELLS), dy = y - (p[1] + (cj + dj - jj) / CELLS);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const line = 1 - U.smoothstep(0.0, 0.05, edge);
      const mott = fbm2(x * 8, y * 8, 4, 91);
      const k = (j * S + i) * 4;
      px[k] = U.clamp(line * (0.5 + 0.8 * mott)) * 255;
      px[k + 1] = mott * 255;
      px[k + 2] = U.clamp(1 - Math.sqrt(d1) * CELLS * 0.9) * 255;
      px[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    return tex;
  }

  // ==================================================================
  // PARTICLE FRAMEWORK
  // ==================================================================
  // Uniforms shared (by reference) by every particle material.
  const SU = {
    uT: { value: 0 },
    uHist: { value: null },
    uAmb: { value: new THREE.Vector3(0.02, 0.028, 0.05) },
    uShipLight: { value: new THREE.Vector3(1, 0.6, 0.3) },
    uShipA: { value: new THREE.Vector3(-120, 12, 0) },
    uShipB: { value: new THREE.Vector3(120, 12, 0) },
    uWind: { value: new THREE.Vector3(-0.6, 0, -0.8) },
    uFlashPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1e5, 0)) },
    uFlashCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uFlashRange: { value: [600, 600, 600, 600] },
    uCamUnder: { value: 0 },
    uPxScale: { value: 1 },          // pixels per (world unit / view distance): keeps tiny particles >= ~1 px
  };

  const GLSL_COMMON = /* glsl */`
    uniform float uT;
    uniform sampler2D uHist;
    uniform vec3 uAmb, uShipLight, uShipA, uShipB, uWind;
    uniform vec3 uFlashPos[4];
    uniform vec3 uFlashCol[4];
    uniform float uFlashRange[4];
    uniform float uCamUnder, uPxScale;
    #define HIST_N ${HIST_N}.0
    #define DUR ${C.DURATION.toFixed(1)}
    const float PI = 3.14159265;
    float hu(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return float(x) / 4294967295.0; }
    float hh(float a, float b){ return hu(uint(int(a) + 7919) * 1664525u + uint(int(b) + 104729) * 1013904223u + 12345u); }
    vec4 hist(int row, float t){
      float u = clamp(t / DUR, 0.0, 1.0) * (HIST_N - 1.0);
      float i0 = floor(u);
      int x0 = int(i0); int x1 = min(x0 + 1, int(HIST_N) - 1);
      return mix(texelFetch(uHist, ivec2(x0, row), 0), texelFetch(uHist, ivec2(x1, row), 0), u - i0);
    }
    vec3 bowPt(vec3 l, float t){ vec4 p = vec4(l, 1.0); return vec3(dot(hist(3, t), p), dot(hist(4, t), p), dot(hist(5, t), p)); }
    vec3 sternPt(vec3 l, float t){ vec4 p = vec4(l, 1.0); return vec3(dot(hist(6, t), p), dot(hist(7, t), p), dot(hist(8, t), p)); }
    vec3 bowDir(vec3 d, float t){ vec4 p = vec4(d, 0.0); return vec3(dot(hist(3, t), p), dot(hist(4, t), p), dot(hist(5, t), p)); }
    vec3 sternDir(vec3 d, float t){ vec4 p = vec4(d, 0.0); return vec3(dot(hist(6, t), p), dot(hist(7, t), p), dot(hist(8, t), p)); }
    // displacement of the air/water (render frame) between tb and t: the sea streams aft
    vec3 airDrift(float tb, float t){ vec2 a = hist(0, tb).xy, b = hist(0, t).xy; return vec3(a.x - b.x, 0.0, a.y - b.y); }
    // incident light at a world point (ambient + the lit ship + transient flashes)
    vec3 lightAt(vec3 p, float fromBelow){
      vec3 ab = uShipB - uShipA;
      float k = clamp(dot(p - uShipA, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
      float d = length(p - (uShipA + ab * k));
      vec3 L = uAmb + uShipLight * (0.45 + 0.55 * fromBelow) / (1.0 + d * d / 700.0);
      for (int i = 0; i < 4; i++) {
        vec3 dp = p - uFlashPos[i];
        float r = uFlashRange[i];
        // inverse-square-like, windowed to zero by three ranges so a flash stays local
        L += uFlashCol[i] / (1.0 + dot(dp, dp) / (r * r)) * clamp(1.5 - length(dp) / (2.0 * r), 0.0, 1.0);
      }
      return L;
    }
    vec3 camRight(){ return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
    vec3 camUp(){ return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
    // camera-facing quad corner
    vec3 billboard(vec3 c, vec2 k, vec2 size, float rot){
      float cr = cos(rot), sr = sin(rot);
      vec2 q = vec2(cr * k.x - sr * k.y, sr * k.x + cr * k.y) * size;
      return c + camRight() * q.x + camUp() * q.y;
    }
    // quad stretched from a to b (k.x along, k.y across), width w, with round caps
    vec3 streak(vec3 a, vec3 b, vec2 k, float w){
      vec3 d = b - a; float L = length(d);
      vec3 m = (a + b) * 0.5;
      if (L < 1e-4) return billboard(m, k, vec2(w), 0.0);
      vec3 dn = d / L;
      vec3 toC = normalize(cameraPosition - m);
      vec3 side = cross(dn, toC);
      float sl = length(side);
      if (sl < 1e-3) return billboard(m, k, vec2(w), 0.0);
      side /= sl;
      return m + dn * k.x * (L * 0.5 + w) + side * k.y * w;
    }
    // grow a sprite so it never drops far below a pixel (fades instead of aliasing)
    float minPixel(vec3 c, float size, out float fade){
      float dist = max(length(cameraPosition - c), 0.01);
      float px = size * uPxScale / dist;
      fade = clamp(px * px, 0.0, 1.0);
      return px < 1.0 ? size / max(px, 1e-4) : size;
    }
  `;

  const FOG_UNI = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

  function particleMaterial(opt) {
    const uniforms = Object.assign({}, SU, FOG_UNI(), opt.uniforms || {});
    const add = opt.blending === 'add';
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: GLSL_COMMON + '\n#include <fog_pars_vertex>\n' + opt.vertex,
      fragmentShader: GLSL_COMMON + '\n#include <fog_pars_fragment>\n' + opt.fragment,
      transparent: true, depthWrite: false, depthTest: opt.depthTest !== false,
      blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: opt.fog !== false,
      side: THREE.DoubleSide,
    });
    return mat;
  }

  // Instanced quad geometry. attrs: { name: [itemSize, Float32Array] }
  function quadGeometry(count, attrs) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (const k in attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k][1], attrs[k][0]));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return g;
  }

  function addSystem(ctx, name, geo, mat, opts = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'fx.' + name;
    mesh.frustumCulled = false;
    mesh.renderOrder = opts.renderOrder || 10;
    mesh.visible = false;
    if (opts.noReflect) mesh.layers.set(TT.LAYERS.NO_REFLECT);
    ctx.scene.add(mesh);
    const sys = { name, mesh, mat, geo, active: opts.active || (() => true) };
    fx.systems.push(sys);
    return sys;
  }

  // shared fragment helpers for textured puffs
  const GLSL_PUFF_FRAG = /* glsl */`
    uniform sampler2D uPuff;
    vec4 puffTex(vec2 uv, float variant){
      // round: an interpolated varying can land a hair below an integer, which would jump a
      // whole atlas cell inside a pixel quad and blow up the mip selection (dotted artifacts)
      variant = floor(variant + 0.5);
      vec2 cell = vec2(mod(variant, 2.0), floor(variant * 0.5)) * 0.5;
      return texture2D(uPuff, cell + clamp(uv, 0.004, 0.996) * 0.5);
    }
  `;

  // ==================================================================
  // EMITTER POINTS (ship-local). Defaults from TT.CONST; refined from TT.ship.anchor()
  // once the ship module is up (see captureAnchors).
  // ==================================================================
  const RAKE_DX = -0.5 * (SH.FUNNEL_TOP_Y - SH.FUNNEL_BASE_Y) * Math.tan(SH.FUNNEL_RAKE);
  const ANCH = {
    funnelTop: SH.FUNNEL_X.slice(0, 3).map((x) => new THREE.Vector3(x + RAKE_DX, SH.FUNNEL_TOP_Y + 0.8, 0)),
    steamPipe: SH.FUNNEL_X.slice(0, 3).map((x) => new THREE.Vector3(x + RAKE_DX + SH.FUNNEL_RX + 0.7, SH.FUNNEL_TOP_Y + 1.2, 0)),
    rocketLauncher: SH.ROCKET_LAUNCHER.clone(),
    wellDeckFwd: new THREE.Vector3(82, SH.WELL_DECK_Y, 0),
    breakTop: new THREE.Vector3(SH.BREAK_X, SH.BOAT_DECK_Y, 0),
    funnelBase1: new THREE.Vector3(SH.FUNNEL_X[0], SH.FUNNEL_BASE_Y, 0),
    captured: false,
  };

  function captureAnchors(S) {
    if (ANCH.captured) return false;
    const ship = TT.ship;
    if (!ship || !ship._ready || typeof ship.anchor !== 'function') return false;
    if (S.t > 170 || S.ship.funnelFall.some((f) => f > 0)) return false;
    const w = new THREE.Vector3(), l = new THREE.Vector3();
    const grab = (name, target, maxDist) => {
      try {
        const r = ship.anchor(name, w);
        if (!r || !isFinite(r.x)) return;
        TT.pose.toLocal(S.ship.bow, r, l);
        if (l.distanceTo(target) < maxDist) target.copy(l);
      } catch (e) { /* keep the default */ }
    };
    for (let i = 0; i < 3; i++) {
      grab('funnel' + (i + 1) + 'Top', ANCH.funnelTop[i], 8);
      grab('steamPipe' + (i + 1), ANCH.steamPipe[i], 10);
    }
    grab('funnel1Base', ANCH.funnelBase1, 6);
    grab('rocketLauncher', ANCH.rocketLauncher, 10);
    grab('wellDeckFwd', ANCH.wellDeckFwd, 20);
    ANCH.captured = true;
    return true;
  }

  // ==================================================================
  // SPLASH EVENTS (world). 0 = the scrape (continuous; uses the history contact point),
  // 1 = funnel 1 into the sea, 2 = the stern slamming back, 3 = the final plunge.
  // ==================================================================
  const EVU = {
    uEvA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1e4, 0, -1e3)) },   // xyz, t0
    uEvB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1e4, 0, 0)) },       // xyz, size
  };
  const PLUNGE = new THREE.Vector3();
  function buildEvents() {
    const E = EV();
    const st = TT.story.makeState();
    const A = EVU.uEvA.value, B = EVU.uEvB.value;
    const sampleAt = (t) => TT.story.sample(t, st);
    const sp = st.fx.splashes || [];
    const tOf = (what, def) => { const s = sp.find((x) => x.what === what); return s ? s.t : def; };
    const sizeOf = (what, def) => { const s = sp.find((x) => x.what === what); return s ? s.size : def; };
    // 1: funnel 1 falls forward to starboard and lands along its length
    const tF = tOf('funnel1', E.funnel1Splash);
    sampleAt(tF);
    const base = TT.pose.toWorld(st.ship.bow, ANCH.funnelBase1, new THREE.Vector3());
    const tipL = ANCH.funnelBase1.clone().add(new THREE.Vector3(0.55, 0.12, 0.83).normalize().multiplyScalar(22));
    const tip = TT.pose.toWorld(st.ship.bow, tipL, new THREE.Vector3());
    const mid = base.clone().lerp(tip, 0.35);
    A[1].set(mid.x, 0, mid.z, tF);
    B[1].set(tip.x, 0, tip.z, sizeOf('funnel1', 1.0));
    // 2: the stern section slams back: water erupts along its length
    const tS = tOf('sternFallback', E.sternSplash);
    sampleAt(tS);
    const s0 = TT.pose.toWorld(st.ship.stern, new THREE.Vector3(SH.BREAK_X - 6, 0, 0), new THREE.Vector3());
    const s1 = TT.pose.toWorld(st.ship.stern, new THREE.Vector3(-110, 0, 0), new THREE.Vector3());
    A[2].set(s0.x, 0, s0.z, tS);
    B[2].set(s1.x, 0, s1.z, sizeOf('sternFallback', 1.6));
    // 3: the final plunge, where the stern slid under
    const tG = tOf('sternGone', E.sternGone);
    sampleAt(tG - 1.2);
    const pl = TT.pose.toWorld(st.ship.stern, new THREE.Vector3(-100, 0, 0), new THREE.Vector3());
    sampleAt(tG - 4);
    const pl2 = TT.pose.toWorld(st.ship.stern, new THREE.Vector3(-60, 0, 0), new THREE.Vector3());
    PLUNGE.set(pl.x * 0.6 + pl2.x * 0.4, 0, pl.z * 0.6 + pl2.z * 0.4);
    A[3].set(PLUNGE.x, 0, PLUNGE.z, tG);
    B[3].set(PLUNGE.x, 0, PLUNGE.z, sizeOf('sternGone', 1.2));
    A[0].set(0, 0, 0, E.impact);
    B[0].set(0, 0, 0, 1);
  }

  // rocket launch geometry (world), from the launcher on the starboard bridge wing
  function buildRockets() {
    const E = EV();
    const st = TT.story.makeState();
    const rnd = U.rng('fx-rockets');
    E.rockets.forEach((L, r) => {
      TT.story.sample(L, st);
      const p0 = TT.pose.toWorld(st.ship.bow, ANCH.rocketLauncher, new THREE.Vector3());
      // up, leaning a little outboard (starboard) and a touch forward, varied per rocket
      const dirL = new THREE.Vector3(0.06 + (rnd() - 0.5) * 0.12, 1, 0.16 + rnd() * 0.1).normalize();
      const q = st.ship.bow.quat;
      const dir = dirL.applyQuaternion(q);
      dir.y = Math.max(dir.y, 0.9); dir.normalize();
      RK.p0[r] = p0; RK.dir[r] = dir; RK.L[r] = L;
      RKU.uRkP0.value[r].set(p0.x, p0.y, p0.z, L);
      RKU.uRkDir.value[r].set(dir.x, dir.y, dir.z, RK_H * (0.94 + rnd() * 0.12));
    });
  }

  // ==================================================================
  // ROCKET DATA (shared by the glow system, rocket smoke and the flash light)
  // ==================================================================
  const RK_T = 2.3, RK_H = 220;
  const RK = { p0: [], dir: [], L: [] };  // world launch point, unit direction, launch time
  const RKU = {
    uRkP0: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4()) },   // xyz launch, w launch time
    uRkDir: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4()) },  // xyz dir, w height
  };
  const GLSL_ROCKET = /* glsl */`
    uniform vec4 uRkP0[5];
    uniform vec4 uRkDir[5];
    const float RK_T = ${RK_T.toFixed(2)};
    vec3 rkPath(int r, float a){
      float u = clamp(a / RK_T, 0.0, 1.0);
      return uRkP0[r].xyz + uRkDir[r].xyz * uRkDir[r].w * (1.0 - (1.0 - u) * (1.0 - u));
    }
    vec3 rkBurst(int r){ return uRkP0[r].xyz + uRkDir[r].xyz * uRkDir[r].w; }
  `;

  // ==================================================================
  // DARK PUFFS: funnel smoke, rocket smoke, coal dust and torn fragments at the
  // break, soot from the falling funnel.   (alpha blended, reflected in the sea)
  // ==================================================================
  const DARK_VERT = GLSL_ROCKET + /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;     // type, emitter, slot, slots
    uniform vec3 uFunnel[3];
    uniform vec3 uBreakL;
    uniform vec3 uFunnelBase1;
    uniform float uWindSpd;
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vHard, vLitB;
    varying vec3 vAmbCol, vShipCol, vWorld;

    void main(){
      int type = int(aInfo.x + 0.5);
      float slot = aInfo.z, slots = aInfo.w;
      vec3 c = vec3(0.0, -1e4, 0.0);
      float size = 1.0, rot = aSeed.w * 6.2832, alpha = 0.0, ero = 0.0, hard = 0.0, below = 0.5;
      vec3 alb = vec3(0.1);
      float age = 0.0;

      if (type == 0) {
        // ---------------- funnel smoke ----------------
        float L = 34.0;
        float phase = (slot + aSeed.x * 0.9) / slots * L;
        float cyc = floor((uT - phase) / L);
        age = uT - phase - cyc * L;
        float tb = uT - age;
        float r1 = hh(slot + aInfo.y * 977.0, cyc), r2 = hh(slot * 3.0 + 1.0, cyc + 17.0 + aInfo.y);
        float r3 = hh(slot * 5.0 + 2.0, cyc + 31.0 + aInfo.y), r4 = hh(slot * 7.0 + 3.0, cyc + 43.0 + aInfo.y);
        float strength = hist(1, tb).x;
        // the stokers' firing makes the smoke come in slow pulses and clumps
        float pulse = 0.72 + 0.28 * sin(tb * 0.83 + aInfo.y * 2.1) * sin(tb * 0.37 + aInfo.y);
        float live = step(r1, sqrt(strength) * 1.05 * pulse) * step(0.0, tb);
        vec3 E = bowPt(uFunnel[int(aInfo.y + 0.5)], tb);
        float rise = 13.0 * (1.0 - exp(-age / 1.6)) + 1.1 * pow(age, 0.88);
        vec3 rd = normalize(vec3(r2 - 0.5, (r3 - 0.5) * 0.5, r4 - 0.5) + 1e-4);
        vec3 spread = rd * (2.6 * sqrt(age) + 0.25 * age);
        vec3 turb = vec3(sin(age * 0.35 + r2 * 6.28), 0.6 * sin(age * 0.27 + r3 * 6.28), sin(age * 0.31 + r4 * 6.28)) * (0.5 + 0.13 * age);
        c = E + airDrift(tb, uT) + uWind * uWindSpd * age + vec3(0.0, rise, 0.0) + spread + turb;
        size = 3.2 + 2.2 * sqrt(age) + 0.8 * age + 0.5 * r3 * age;
        alpha = live * smoothstep(0.0, 0.2, age) * pow(max(1.0 - age / L, 0.0), 1.2) * pow(3.2 / size, 0.7) * (0.5 + 0.5 * sqrt(strength)) * 0.95;
        alb = vec3(0.07, 0.064, 0.058) * (0.8 + 0.4 * r2);
        ero = 0.12 + 0.5 * age / L;
        below = 1.0;
        rot += age * (r3 - 0.5) * 0.08;
      } else if (type == 2 || type == 3) {
        // ---------------- rocket smoke: trail (2) and burst (3) ----------------
        int r = int(aInfo.y + 0.5);
        float L0 = uRkP0[r].w;
        float u = slot / max(slots - 1.0, 1.0);
        // trail puffs evenly spaced in height along the (decelerating) climb
        float tb = type == 2 ? L0 + (1.0 - sqrt(max(1.0 - u * 0.985, 0.0))) * RK_T : L0 + RK_T + 0.05 * aSeed.x;
        age = uT - tb;
        float life = 30.0 + 10.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          vec3 p0 = type == 2 ? rkPath(r, tb - L0) : rkBurst(r);
          vec3 rd = normalize(vec3(aSeed.x - 0.5, aSeed.y - 0.45, aSeed.z - 0.5) + 1e-4);
          // the burst charge leaves only a thin puff that drifts off on the air
          float burstV = type == 3 ? 7.0 : 2.0;
          vec3 spread = rd * (burstV * (1.0 - exp(-age * 0.9)) / 0.9 + 0.35 * sqrt(age) * 3.0);
          c = p0 + spread + uWind * (uWindSpd * 1.6 + 1.2) * age + vec3(0.0, 0.25 * age, 0.0);
          size = type == 2 ? 1.8 + 1.4 * u + 0.8 * pow(age, 0.8) : 3.5 + 1.5 * pow(age, 0.8);
          float a0 = type == 2 ? 0.055 * (1.0 - 0.5 * u) : 0.085;
          alpha = a0 * smoothstep(0.0, 0.4, age) * pow(max(1.0 - age / life, 0.0), 1.6);
          alb = vec3(0.34, 0.33, 0.32);
          ero = 0.2 + 0.45 * age / life;
          below = 0.3;
        }
      } else if (type == 4) {
        // ---------------- coal dust boiling out of the tear ----------------
        float tb = 195.3 + slot / slots * 6.0 + aSeed.x * 0.4;
        age = uT - tb;
        float life = 9.0 + 7.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          vec3 l = uBreakL + vec3((aSeed.z - 0.5) * 3.0, -aSeed.x * 9.0, (aSeed.y - 0.5) * 22.0);
          vec3 p0 = aSeed.w > 0.5 ? bowPt(l, tb) : sternPt(l, tb);
          vec3 rd = normalize(vec3((aSeed.z - 0.5) * 1.6, 0.7 + aSeed.x, (fract(aSeed.y * 7.7) - 0.5) * 1.6));
          vec3 v = rd * (7.0 + 12.0 * aSeed.z);
          c = p0 + v * (1.0 - exp(-age * 0.6)) / 0.6 + uWind * (uWindSpd + 1.5) * age + vec3(0.0, 0.8 * age, 0.0);
          size = 3.0 + 3.2 * pow(age, 0.8);
          alpha = 0.3 * smoothstep(0.0, 0.4, age) * pow(max(1.0 - age / life, 0.0), 1.8);
          alb = vec3(0.05, 0.045, 0.04);
          ero = 0.2 + 0.6 * age / life;
          below = 0.0;
        }
      } else if (type == 5) {
        // ---------------- torn fragments (tumbling, falling into the sea) ----------------
        float tb = 195.2 + slot / slots * 5.5 + aSeed.x * 0.3;
        age = uT - tb;
        if (age > 0.0 && age < 7.0) {
          vec3 l = uBreakL + vec3((aSeed.z - 0.5) * 2.0, -aSeed.x * 6.0, (aSeed.y - 0.5) * 24.0);
          vec3 p0 = aSeed.w > 0.5 ? bowPt(l, tb) : sternPt(l, tb);
          vec3 v = vec3((aSeed.z - 0.5) * 14.0, 6.0 + 12.0 * aSeed.y, (aSeed.x - 0.5) * 14.0);
          c = p0 + v * age + vec3(0.0, -4.9 * age * age, 0.0);
          size = 0.35 + 1.4 * aSeed.y * aSeed.y;
          rot += age * (aSeed.z - 0.5) * 14.0;
          alpha = step(0.0, c.y) * smoothstep(0.0, 0.1, age);
          alb = vec3(0.05, 0.05, 0.055);
          hard = 1.0;
          below = 0.0;
        }
      } else if (type == 6) {
        // ---------------- soot as funnel 1 tears away ----------------
        float tb = 179.6 + slot / slots * 2.6;
        age = uT - tb;
        float life = 16.0 + 6.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          vec3 l = uFunnelBase1 + vec3((aSeed.z - 0.5) * 6.0, 2.0 + aSeed.x * 18.0, (aSeed.y - 0.5) * 5.0);
          vec3 p0 = bowPt(l, tb);
          vec3 v = normalize(vec3(aSeed.z - 0.5, 1.2, aSeed.y - 0.5)) * (3.0 + 5.0 * aSeed.x);
          c = p0 + v * (1.0 - exp(-age * 0.6)) / 0.6 + uWind * (uWindSpd + 0.4) * age;
          size = 3.0 + 1.6 * pow(age, 0.8);
          alpha = 0.5 * smoothstep(0.0, 0.6, age) * pow(max(1.0 - age / life, 0.0), 1.4);
          alb = vec3(0.045, 0.04, 0.036);
          ero = 0.15 + 0.45 * age / life;
          below = 0.6;
        }
      }

      float pf;
      size = minPixel(c, size, pf);
      alpha *= pf;
      if (alpha < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 wp = billboard(c, corner, vec2(size), rot);
      vWorld = wp;
      vUv = corner * 0.5 + 0.5;
      vAlpha = alpha; vVar = floor(aSeed.z * 3.999); vEro = ero; vHard = hard; vLitB = below;
      vec3 Lsh = lightAt(c, below) - uAmb;
      // lamp light on coal smoke reads warm-grey, never fiery
      Lsh = mix(Lsh, vec3(dot(Lsh, vec3(0.3333))), 0.4) * (type == 0 ? 0.55 : 1.0);
      // rocket smoke: the report's instant of glare must not turn the whole trail into a lamp
      if (type == 2 || type == 3) Lsh = Lsh / (1.0 + Lsh * 0.5);
      vAmbCol = alb * uAmb;
      vShipCol = alb * Lsh;
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;

  const DARK_FRAG = GLSL_PUFF_FRAG + /* glsl */`
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vHard, vLitB;
    varying vec3 vAmbCol, vShipCol, vWorld;
    void main(){
      vec4 tx = puffTex(vUv, vVar);
      float d;
      if (vHard > 0.5) d = smoothstep(0.40, 0.46, tx.r * 0.75 + tx.b * 0.45);
      else d = tx.r * smoothstep(vEro, vEro + 0.4, tx.b * 0.65 + tx.r * 0.6);
      float a = d * vAlpha;
      if (uCamUnder < 0.5) a *= smoothstep(0.0, 4.0, vWorld.y);
      if (a < 0.002) discard;
      vec3 col = vAmbCol * (0.8 + 0.4 * tx.g) + vShipCol * mix(0.8, 0.55 + 0.9 * tx.g, vLitB);
      gl_FragColor = vec4(col, a);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildDarkPuffs(ctx, q, puffTex) {
    const list = [];
    const rnd = U.rng('fx-dark');
    const push = (type, em, slot, slots) => list.push([type, em, slot, slots]);
    const nSmoke = Math.round(170 * q);
    for (let f = 0; f < 3; f++) for (let i = 0; i < nSmoke; i++) push(0, f, i, nSmoke);
    const nTrail = Math.round(110 * Math.max(q, 0.6)), nBurst = 16;
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i < nTrail; i++) push(2, r, i, nTrail);
      for (let i = 0; i < nBurst; i++) push(3, r, i, nBurst);
    }
    const nDust = Math.round(110 * q), nFrag = Math.round(160 * q), nSoot = Math.round(40 * q);
    for (let i = 0; i < nDust; i++) push(4, 0, i, nDust);
    for (let i = 0; i < nFrag; i++) push(5, 0, i, nFrag);
    for (let i = 0; i < nSoot; i++) push(6, 0, i, nSoot);
    const n = list.length;
    const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
    list.forEach((e, i) => { info.set(e, i * 4); for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); });
    const geo = quadGeometry(n, { aSeed: [4, seed], aInfo: [4, info] });
    const mat = particleMaterial({
      vertex: DARK_VERT, fragment: DARK_FRAG,
      uniforms: Object.assign({
        uPuff: { value: puffTex },
        uFunnel: { value: ANCH.funnelTop }, uBreakL: { value: ANCH.breakTop }, uFunnelBase1: { value: ANCH.funnelBase1 },
        uWindSpd: { value: 1 },
      }, RKU),
    });
    const E = EV();
    return addSystem(ctx, 'darkPuffs', geo, mat, {
      renderOrder: 12,
      active: (t) => t < E.breakStart + 40 || (t >= E.rockets[0] && t < E.rockets[4] + 45),
    });
  }

  // ==================================================================
  // WHITE PUFFS: roaring steam from the escape pipes, steam bursting from the
  // tear, mist rising from the big splashes and from the ice along the side.
  // ==================================================================
  const GLSL_EVENTS = /* glsl */`
    uniform vec4 uEvA[4];
    uniform vec4 uEvB[4];
  `;
  const WHITE_VERT = GLSL_EVENTS + /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;     // type, emitter, slot, slots
    uniform vec3 uPipe[3];
    uniform vec3 uBreakL;
    uniform float uWindSpd;
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vLitB, vCore;
    varying vec3 vAmbCol, vShipCol, vWorld;
    varying vec4 vHull;       // soft contact with the hull side: plane normal, offset (w = 1e6 when unused)

    void main(){
      int type = int(aInfo.x + 0.5);
      float slot = aInfo.z, slots = aInfo.w;
      vec3 c = vec3(0.0, -1e4, 0.0);
      float size = 1.0, rot = aSeed.w * 6.2832, alpha = 0.0, ero = 0.0, below = 0.5, core = 0.0;
      vHull = vec4(0.0, 1.0, 0.0, -1e6);
      vec2 stretch = vec2(1.0);
      vec3 alb = vec3(0.85);
      if (type == 1) {
        // ---------------- steam jets (safety valves lifting) ----------------
        float L = 10.0;
        float phase = (slot + aSeed.x * 0.9) / slots * L;
        float cyc = floor((uT - phase) / L);
        float age = uT - phase - cyc * L;
        float tb = uT - age;
        float r1 = hh(slot + aInfo.y * 911.0, cyc), r2 = hh(slot * 3.0 + 5.0, cyc + 3.0 + aInfo.y);
        float r3 = hh(slot * 5.0 + 7.0, cyc + 11.0 + aInfo.y), r4 = hh(slot * 7.0 + 9.0, cyc + 23.0 + aInfo.y);
        float strength = hist(1, tb).y;
        float live = step(r1, strength);
        vec3 E = bowPt(uPipe[int(aInfo.y + 0.5)], tb);
        vec3 up = normalize(bowDir(vec3(0.05, 1.0, 0.0), tb));
        vec3 jd = normalize(up + vec3(r2 - 0.5, 0.0, r3 - 0.5) * 0.16);
        float v0 = 40.0 + 16.0 * r4;
        float k = 1.0;
        float s = v0 * (1.0 - exp(-k * age)) / k;
        vec3 rd = normalize(vec3(r2 - 0.5, (r4 - 0.5) * 0.6, r3 - 0.5) + 1e-4);
        c = E + jd * s + vec3(0.0, 2.5 * age, 0.0) + rd * (1.6 * age + 1.8 * sqrt(age)) + uWind * (uWindSpd + 0.8) * age + airDrift(tb, uT);
        float v = v0 * exp(-k * age);
        size = 0.9 + 2.6 * pow(age, 0.85) + 1.0 * r3 * age;
        stretch = vec2(1.0, 1.0 + v * 0.045);
        rot = (r2 - 0.5) * 0.5 + age * (r4 - 0.5) * 0.3;
        if (v > 8.0) rot = 0.0;
        alpha = live * strength * smoothstep(0.0, 0.025, age) * pow(max(1.0 - age / L, 0.0), 1.4) * 0.34;
        ero = 0.05 + 0.55 * age / L;
        below = 1.0;
        core = exp(-age * 2.5);
        alb = vec3(0.92, 0.92, 0.9);
      } else if (type == 7) {
        // ---------------- steam bursting from the tear (boilers, pipes) ----------------
        float tb = 195.6 + slot / slots * 6.5 + aSeed.x * 0.5;
        float age = uT - tb;
        float life = 12.0 + 6.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          vec3 l = uBreakL + vec3((aSeed.z - 0.5) * 3.0, -2.0 - aSeed.x * 12.0, (aSeed.y - 0.5) * 18.0);
          vec3 p0 = aSeed.w > 0.5 ? bowPt(l, tb) : sternPt(l, tb);
          vec3 rd = normalize(vec3(aSeed.z - 0.5, 1.0 + aSeed.x, aSeed.y - 0.5));
          c = p0 + rd * (18.0 + 10.0 * aSeed.z) * (1.0 - exp(-age * 1.1)) / 1.1 + vec3(0.0, 1.2 * age, 0.0) + uWind * (uWindSpd + 0.5) * age;
          size = 1.5 + 2.2 * pow(age, 0.8);
          alpha = 0.42 * smoothstep(0.0, 0.2, age) * pow(max(1.0 - age / life, 0.0), 1.5);
          ero = 0.1 + 0.5 * age / life;
          below = 0.2;
          alb = vec3(0.8);
        }
      } else if (type == 8) {
        // ---------------- mist hanging over the big splashes ----------------
        int e = int(aInfo.y + 0.5);
        vec4 A = uEvA[e], B = uEvB[e];
        float tb = A.w + 1.0 + aSeed.x * 3.0;
        float age = uT - tb;
        float life = 18.0 + 14.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          float sz = B.w;
          vec3 p0 = mix(A.xyz, B.xyz, aSeed.z);
          vec3 off = vec3(aSeed.w - 0.5, 0.0, fract(aSeed.w * 7.3) - 0.5) * 16.0 * sz;
          float h = (2.0 + 16.0 * aSeed.y * aSeed.y) * sz;
          c = p0 + off + vec3(0.0, h * (1.0 - exp(-age * 0.5)) + 0.35 * age, 0.0) + uWind * (uWindSpd + 0.3) * age;
          size = (6.0 + 5.0 * aSeed.x) * sz + 1.3 * age;
          alpha = 0.1 * smoothstep(0.0, 2.5, age) * pow(max(1.0 - age / life, 0.0), 1.6);
          ero = 0.25 + 0.45 * age / life;
          below = 0.0;
          stretch = vec2(1.7, 0.85);
          alb = vec3(0.75, 0.78, 0.8) * 1.4;
        }
      } else if (type == 9) {
        // ---------------- ice mist and spray haze along the side during the scrape ----------------
        float tb = 74.1 + slot / slots * 10.0 + aSeed.x * 0.2;
        float age = uT - tb;
        float life = 7.0 + 5.0 * aSeed.y;
        vec4 CP = hist(10, tb);
        if (age > 0.0 && age < life && CP.w > 0.05) {
          vec3 side = normalize(bowDir(vec3(0.0, 0.0, 1.0), tb));
          vec3 fwd = normalize(bowDir(vec3(1.0, 0.0, 0.0), tb));
          c = CP.xyz + side * (2.0 + 5.0 * aSeed.z) * (1.0 - exp(-age)) + fwd * (aSeed.w - 0.5) * 10.0
            + vec3(0.0, 3.0 + 9.0 * aSeed.y * (1.0 - exp(-age * 0.8)), 0.0) + airDrift(tb, uT) * 0.85;
          size = 3.0 + 2.4 * pow(age, 0.8);
          alpha = 0.3 * CP.w * smoothstep(0.0, 0.3, age) * pow(max(1.0 - age / life, 0.0), 1.4);
          vHull = vec4(side, dot(CP.xyz, side) - 0.4);
          ero = 0.25 + 0.4 * age / life;
          below = 0.7;
          alb = vec3(0.8, 0.86, 0.92);
        }
      }
      if (alpha < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 wp = billboard(c, corner, vec2(size) * stretch, rot);
      vWorld = wp;
      vUv = corner * 0.5 + 0.5;
      vAlpha = alpha; vVar = floor(aSeed.z * 3.999); vEro = ero; vLitB = below; vCore = core;
      vAmbCol = alb * uAmb;
      vShipCol = alb * (lightAt(c, below) - uAmb);
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;

  const WHITE_FRAG = GLSL_PUFF_FRAG + /* glsl */`
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vLitB, vCore;
    varying vec3 vAmbCol, vShipCol, vWorld;
    varying vec4 vHull;
    void main(){
      vec4 tx = puffTex(vUv, vVar);
      float d = tx.r * smoothstep(vEro, vEro + 0.45, tx.b * 0.6 + tx.r * 0.65);
      float a = d * vAlpha * (1.0 + 0.5 * vCore);
      a *= smoothstep(0.0, 2.5, dot(vWorld, vHull.xyz) - vHull.w);   // no hard line where it meets the hull
      if (uCamUnder < 0.5) a *= smoothstep(0.0, 3.0, vWorld.y);
      if (a < 0.002) discard;
      // thick steam scatters: brighter where dense, lit side from below
      vec3 col = vAmbCol * (0.85 + 0.3 * tx.g) + vShipCol * mix(1.0, 0.6 + 0.8 * tx.g, vLitB);
      col *= 0.9 + 0.25 * d;
      gl_FragColor = vec4(col, min(a, 1.0));
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildWhitePuffs(ctx, q, puffTex) {
    const list = [];
    const rnd = U.rng('fx-white');
    const push = (type, em, slot, slots) => list.push([type, em, slot, slots]);
    const nSteam = Math.round(230 * q);
    for (let p = 0; p < 3; p++) for (let i = 0; i < nSteam; i++) push(1, p, i, nSteam);
    const nBS = Math.round(70 * q);
    for (let i = 0; i < nBS; i++) push(7, 0, i, nBS);
    const nMist = [0, Math.round(26 * q), Math.round(60 * q), Math.round(40 * q)];
    for (let e = 1; e < 4; e++) for (let i = 0; i < nMist[e]; i++) push(8, e, i, nMist[e]);
    const nCM = Math.round(120 * q);
    for (let i = 0; i < nCM; i++) push(9, 0, i, nCM);
    const n = list.length;
    const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
    list.forEach((e, i) => { info.set(e, i * 4); for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); });
    const geo = quadGeometry(n, { aSeed: [4, seed], aInfo: [4, info] });
    const mat = particleMaterial({
      vertex: WHITE_VERT, fragment: WHITE_FRAG,
      uniforms: Object.assign({
        uPuff: { value: puffTex }, uPipe: { value: ANCH.steamPipe }, uBreakL: { value: ANCH.breakTop }, uWindSpd: { value: 1 },
      }, EVU),
    });
    const E = EV();
    return addSystem(ctx, 'whitePuffs', geo, mat, {
      renderOrder: 13,
      active: (t) => (t >= E.impact - 1 && t < E.steamEnd + 14) || (t >= E.funnel1Splash - 1 && t < E.sternGone + 36),
    });
  }

  // ==================================================================
  // SPRAY: white water thrown up by the scrape, the big splashes and the boil.
  // ==================================================================
  const SPRAY_VERT = GLSL_EVENTS + /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;     // type, event, slot, slots
    uniform vec3 uPlunge;
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro;
    varying vec3 vCol, vWorld;
    varying vec4 vHull;

    vec3 ballistic(vec3 p0, vec3 v, float a, float k){
      float e = (1.0 - exp(-k * a)) / k;
      return p0 + v * e - vec3(0.0, 9.81 / k * (a - e), 0.0);
    }
    void main(){
      int type = int(aInfo.x + 0.5);
      float slot = aInfo.z, slots = aInfo.w;
      vec3 c = vec3(0.0, -1e4, 0.0);
      float size = 1.0, rot = aSeed.w * 6.2832, alpha = 0.0, ero = 0.0;
      vec2 stretch = vec2(1.0);
      vec3 alb = vec3(0.9, 0.93, 0.96) * 1.25;   // white water scatters the whole sky dome
      float below = 0.5;
      vec3 tail = vec3(0.0);
      float useStreak = 0.0;
      vHull = vec4(0.0, 1.0, 0.0, -1e6);
      if (type == 0) {
        // ---------------- spray and ice crystals where the berg grinds along the side ----------------
        float tb = 74.15 + slot / slots * 10.5 + aSeed.x * 0.05;
        float age = uT - tb;
        float life = 1.6 + 1.8 * aSeed.y;
        vec4 CP = hist(10, tb);
        if (age > 0.0 && age < life && CP.w > 0.03) {
          vec3 side = normalize(bowDir(vec3(0.0, 0.0, 1.0), tb));
          vec3 fwd = normalize(bowDir(vec3(1.0, 0.0, 0.0), tb));
          vec3 p0 = CP.xyz + fwd * (aSeed.z - 0.5) * 9.0 + vec3(0.0, aSeed.w * 5.0 - 1.0, 0.0);
          vec3 v = side * (2.5 + 7.0 * aSeed.z) + vec3(0.0, 4.0 + 14.0 * aSeed.y * CP.w, 0.0) - fwd * (1.0 + 3.0 * aSeed.w);
          vec3 dr = airDrift(tb, uT) * 0.9;
          c = ballistic(p0, v, age, 0.5) + dr;
          tail = ballistic(p0, v, max(age - 0.15, 0.0), 0.5) + dr;
          useStreak = step(0.5, aSeed.x);
          size = 0.5 + 1.8 * pow(age, 0.7) * (0.5 + aSeed.x);
          alpha = CP.w * 0.55 * smoothstep(0.0, 0.08, age) * pow(max(1.0 - age / life, 0.0), 1.2);
          ero = 0.2 + 0.4 * age / life;
          below = 0.8;
          vHull = vec4(side, dot(CP.xyz, side) - 0.4);
        }
      } else if (type == 1 || type == 2) {
        // ---------------- eruptions (1) and spray curtains (2) of the big splashes ----------------
        int e = int(aInfo.y + 0.5);
        vec4 A = uEvA[e], B = uEvB[e];
        float sz = B.w;
        float u = aSeed.z;
        float delay = (e == 3 ? 0.9 * aSeed.x * aSeed.x : u * 0.5 + aSeed.x * 0.35);
        float tb = A.w + delay;
        float age = uT - tb;
        float life = (type == 1 ? 3.0 + 3.5 * aSeed.y : 2.5 + 2.0 * aSeed.y) * (0.8 + 0.25 * sz);
        if (age > 0.0 && age < life) {
          vec3 p0 = mix(A.xyz, B.xyz, u);
          vec3 seg = B.xyz - A.xyz;
          vec3 nrm = length(seg) > 1.0 ? normalize(vec3(-seg.z, 0.0, seg.x)) : vec3(cos(aSeed.w * 6.2832), 0.0, sin(aSeed.w * 6.2832));
          float side = (e == 3 || fract(aSeed.w * 13.7) > 0.5) ? 1.0 : -1.0;
          vec3 out3 = nrm * side;
          if (e == 3) { p0 += out3 * (2.0 + 9.0 * aSeed.y); }
          else p0 += out3 * (0.5 + 8.0 * aSeed.y * aSeed.y) * sz;
          vec3 v;
          float up = (10.0 + 22.0 * aSeed.x * aSeed.x) * sqrt(sz) * (e == 2 ? 1.25 : 1.0);
          if (type == 1) v = out3 * (1.5 + 6.0 * aSeed.y) * sz + vec3(0.0, up, 0.0);
          else v = out3 * (6.0 + 9.0 * aSeed.x) * sz + vec3(0.0, (5.0 + 10.0 * aSeed.y) * sqrt(sz), 0.0);
          float kd = type == 1 ? 0.3 : 0.55;
          c = ballistic(p0, v, age, kd);
          tail = ballistic(p0, v, max(age - (type == 1 ? 0.22 : 0.3), 0.0), kd);
          useStreak = 1.0;
          size = (type == 1 ? 1.0 + 2.0 * aSeed.x : 1.8 + 2.8 * aSeed.x) * sqrt(sz) * (0.6 + 0.8 * min(age, 2.0));
          alpha = (type == 1 ? 0.5 : 0.3) * (e == 2 ? 1.6 : 1.0) * smoothstep(0.0, 0.08, age) * pow(max(1.0 - age / life, 0.0), 1.1);
          ero = 0.15 + 0.5 * age / life;
          below = 0.0;
        }
      } else if (type == 3) {
        // ---------------- the boil: air bursting up where she went down ----------------
        float L = 1.7;
        float phase = (slot + aSeed.x) / slots * L;
        float cyc = floor((uT - phase) / L);
        float age = uT - phase - cyc * L;
        float tb = uT - age;
        float r1 = hh(slot, cyc), r2 = hh(slot + 3.0, cyc + 7.0), r3 = hh(slot + 9.0, cyc + 13.0);
        float strength = hist(2, tb).x * step(221.6, tb) * (1.0 - smoothstep(232.0, 238.0, tb));
        if (r1 < strength) {
          float ang = r2 * 6.2832, rad = pow(r3, 0.8) * 30.0 * (0.6 + 0.4 * smoothstep(221.5, 226.0, tb));
          vec3 p0 = uPlunge + vec3(cos(ang) * rad, 0.2, sin(ang) * rad);
          vec3 v = vec3(cos(ang), 0.0, sin(ang)) * 1.5 + vec3(0.0, 3.0 + 7.0 * r1 * (1.0 - smoothstep(221.5, 230.0, tb) * 0.6), 0.0);
          c = ballistic(p0, v, age, 0.8);
          size = 0.8 + 2.4 * age * (0.6 + r2);
          alpha = 0.55 * smoothstep(0.0, 0.08, age) * pow(max(1.0 - age / L, 0.0), 1.2);
          ero = 0.2 + 0.4 * age / L;
          below = 0.0;
        }
      }
      if (alpha < 0.002 || c.y < -0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float pf;
      size = minPixel(c, size, pf);
      alpha *= pf;
      vec3 wp = useStreak > 0.5 ? streak(tail, c, corner, size * 0.6) : billboard(c, corner, vec2(size) * stretch, rot);
      vWorld = wp;
      vUv = corner * 0.5 + 0.5;
      vAlpha = alpha; vVar = floor(aSeed.y * 3.999); vEro = ero;
      vec3 Li = lightAt(c, below);
      Li = mix(Li, vec3(dot(Li, vec3(0.3, 0.5, 0.2))), 0.45);   // white water: less blue than the sky light
      vCol = alb * Li;
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;

  const SPRAY_FRAG = GLSL_PUFF_FRAG + /* glsl */`
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro;
    varying vec3 vCol, vWorld;
    varying vec4 vHull;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    // fine round droplets on a jittered grid (one soft dot per cell, kept well inside it),
    // widened to the pixel footprint so they never alias into blocks, and fading to their
    // average once a cell gets smaller than a pixel
    float drops(vec2 p, float seed){
      vec2 cell = floor(p);
      vec2 f = fract(p) - 0.5;
      float r1 = h21(cell + seed), r2 = h21(cell + seed + 17.31), r3 = h21(cell + seed + 41.73);
      vec2 dd = f - (vec2(r1, r2) - 0.5) * 0.34;
      float rad = 0.05 + 0.09 * r3;
      float fw = length(fwidth(p));
      float s2 = rad * rad + 0.3 * fw * fw;
      float dot1 = exp(-dot(dd, dd) / s2) * (rad * rad / s2);
      return mix(dot1, 3.14159 * rad * rad, smoothstep(0.35, 0.9, fw)) * step(0.5, r3 + r1 * 0.6) * (0.35 + 0.65 * r2);
    }
    void main(){
      vec4 tx = puffTex(vUv, vVar);
      vec2 k = vUv * 2.0 - 1.0;
      float win = 1.0 - smoothstep(0.5, 1.0, dot(k, k));        // round and soft: the quad never shows
      float body = mix(tx.r, tx.a, 0.5) * smoothstep(vEro, vEro + 0.35, tx.b * 0.6 + tx.r * 0.6);
      float dr = drops(vUv * 14.0, vVar * 7.1) + 0.8 * drops(vUv * 27.0 + 3.7, vVar * 3.3 + 11.0);
      // a thin mist carrying fine droplets
      float d = body * win * (0.34 + 2.2 * dr);
      float a = d * vAlpha * smoothstep(0.0, 1.2, dot(vWorld, vHull.xyz) - vHull.w);
      if (uCamUnder < 0.5) a *= smoothstep(0.0, 1.2, vWorld.y + 0.3);
      if (a < 0.002) discard;
      gl_FragColor = vec4(vCol * (0.8 + 0.5 * tx.g) * (1.0 + 0.5 * dr), min(a, 1.0));
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildSpray(ctx, q, puffTex) {
    const list = [];
    const rnd = U.rng('fx-spray');
    const push = (type, em, slot, slots) => list.push([type, em, slot, slots]);
    const nCol = Math.round(420 * q);
    for (let i = 0; i < nCol; i++) push(0, 0, i, nCol);
    const nJet = [0, Math.round(260 * q), Math.round(700 * q), Math.round(320 * q)];
    const nSheet = [0, Math.round(120 * q), Math.round(360 * q), Math.round(120 * q)];
    for (let e = 1; e < 4; e++) {
      for (let i = 0; i < nJet[e]; i++) push(1, e, i, nJet[e]);
      for (let i = 0; i < nSheet[e]; i++) push(2, e, i, nSheet[e]);
    }
    const nBoil = Math.round(160 * q);
    for (let i = 0; i < nBoil; i++) push(3, 3, i, nBoil);
    const n = list.length;
    const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
    list.forEach((e, i) => { info.set(e, i * 4); for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); });
    const geo = quadGeometry(n, { aSeed: [4, seed], aInfo: [4, info] });
    const mat = particleMaterial({
      vertex: SPRAY_VERT, fragment: SPRAY_FRAG,
      uniforms: Object.assign({ uPuff: { value: puffTex }, uPlunge: { value: PLUNGE } }, EVU),
    });
    const E = EV();
    return addSystem(ctx, 'spray', geo, mat, {
      renderOrder: 14,
      active: (t) => (t >= E.impact - 0.5 && t < E.scrapeEnd + 6) || (t >= E.funnel1Splash - 0.2 && t < E.funnel1Splash + 9)
        || (t >= E.sternSplash - 0.2 && t < E.sternSplash + 10) || (t >= E.sternGone - 0.2 && t < 240),
    });
  }

  // ==================================================================
  // GLOW (additive, HDR): the distress rockets (the climbing head and its sparks, the
  // report's sharp flash, a spherical burst of white-gold stars that hang, droop and fall
  // while they burn out, spitting sparks), the sparks torn out of the break and the ice
  // splinters glinting as the berg grinds past.
  // Every sprite is round and soft-edged: a pin-point (mode 2), a soft glow (mode 1) or a
  // capsule streak with round caps (mode 0) -- nothing ever shows its quad.
  // ==================================================================
  const NSTAR = 44;
  const STAR_K = 2.1;       // air drag on a burning star (1/s): it hangs, then sinks at g / STAR_K
  const STAR_V0 = 58;       // mean burst speed of the stars (m/s)
  const GLOW_VERT = GLSL_ROCKET + /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;     // type, rocket, slot, slots
    uniform vec3 uBreakL;
    varying vec2 vK;
    varying vec3 vCol;
    varying float vMode;
    varying vec3 vSeg;        // streak frame (m): along, across, half length
    varying vec2 vShape;      // half width (m), tail brightness (fraction of the head)
    const float NSTARF = ${NSTAR}.0;
    const float SK = ${STAR_K.toFixed(2)};

    vec3 hot(float T){
      return T > 0.5 ? mix(vec3(1.0, 0.5, 0.14), vec3(1.0, 0.93, 0.8), (T - 0.5) * 2.0) : mix(vec3(0.5, 0.07, 0.01), vec3(1.0, 0.5, 0.14), T * 2.0);
    }
    // a magnesium star as it burns (T 1 fresh .. 0 out): brilliant white, gold, a dying ember
    vec3 starCol(float T){
      return T > 0.4 ? mix(vec3(1.0, 0.84, 0.58), vec3(1.0, 0.97, 0.9), smoothstep(0.4, 0.8, T))
                     : mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.84, 0.58), T / 0.4);
    }
    // the stars leave the shell on a jittered Fibonacci sphere: evenly spread, never clumped
    vec3 starDir(float j, float r){
      float z = clamp(1.0 - 1.72 * (j + 0.5) / NSTARF + (hh(j, r * 7.0 + 1.0) - 0.5) * 0.06, -1.0, 1.0);
      float ph = j * 2.39996 + r * 1.37 + (hh(j, r * 7.0 + 2.0) - 0.5) * 0.4;
      float s = sqrt(max(1.0 - z * z, 0.0));
      return vec3(s * cos(ph), z, s * sin(ph));
    }
    float starLife(float j, float r){ return 4.2 + 2.6 * hh(j, r * 7.0 + 4.0); }
    // burst star j of rocket r, 'a' seconds after the burst
    vec3 starPos(int r, float j, float a){
      float rr = float(r);
      float v0 = ${STAR_V0.toFixed(1)} * (0.85 + 0.3 * hh(j, rr * 7.0 + 3.0));
      float e = (1.0 - exp(-SK * a)) / SK;
      return rkBurst(r) + starDir(j, rr) * v0 * e - vec3(0.0, 9.81 / SK * (a - e), 0.0) + uWind * 1.2 * a;
    }
    // HDR brightness of a star: white-hot at first, settling to a steady flickering glow,
    // sputtering as it burns out
    float starI(float j, float r, float a, float life){
      float T = 1.0 - a / life;
      float flick = 0.82 + 0.18 * sin(uT * 41.0 + j * 3.1) * sin(uT * 27.0 + j * 1.3 + r);
      float sput = mix(1.0, 0.35 + 0.65 * step(0.4, hh(floor(uT * 20.0), j + r * 64.0)), 1.0 - smoothstep(0.0, 0.3, T));
      return (4.4 + 6.0 * exp(-a * 2.4)) * flick * sput * smoothstep(0.0, 0.035, a) * smoothstep(0.0, 0.15, T);
    }
    void main(){
      int type = int(aInfo.x + 0.5);
      int r = int(aInfo.y + 0.5);
      float slot = aInfo.z, slots = aInfo.w;
      vec3 a0 = vec3(0.0, -1e4, 0.0), a1 = a0;
      float w = 0.0, tail = 0.08;
      vec3 col = vec3(0.0);
      float mode = 0.0;   // 0 streak, 1 soft glow, 2 pin-point
      if (type <= 4 || type == 7) {
        float L0 = uRkP0[r].w;
        float ra = uT - L0;             // seconds since launch
        float ba = ra - RK_T;           // seconds since the burst
        float rr = float(r);
        if (type == 0) {
          // the rocket climbing
          if (ra > 0.0 && ra < RK_T) {
            a1 = rkPath(r, ra); a0 = rkPath(r, max(ra - 0.06, 0.0));
            w = 0.45;
            col = vec3(1.0, 0.88, 0.7) * 30.0;
          }
        } else if (type == 1) {
          // its trail of sparks
          float tau = (slot + aSeed.x) / slots * RK_T;
          float age = ra - tau;
          float life = 0.4 + 1.1 * aSeed.y;
          if (age > 0.0 && age < life) {
            vec3 p = rkPath(r, tau);
            vec3 v = normalize(vec3(aSeed.z - 0.5, aSeed.w - 0.7, fract(aSeed.x * 9.1) - 0.5)) * (2.0 + 6.0 * aSeed.y);
            a1 = p + v * age - vec3(0.0, 4.9 * age * age, 0.0);
            a0 = p + v * max(age - 0.08, 0.0) - vec3(0.0, 4.9 * pow(max(age - 0.08, 0.0), 2.0), 0.0);
            float T = 1.0 - age / life;
            w = 0.16 + 0.1 * aSeed.z;
            col = hot(T) * 14.0 * T;
          }
        } else if (type == 2 || type == 7) {
          // a burst star: its white-hot head (7) and its short glowing trail (2)
          float j = slot;
          float life = starLife(j, rr);
          if (ba > 0.0 && ba < life) {
            float T = 1.0 - ba / life;
            float I = starI(j, rr, ba, life);
            a1 = starPos(r, j, ba);
            if (type == 7) {
              a0 = a1; mode = 2.0; w = 1.0;
              col = starCol(T) * I;
            } else {
              a0 = starPos(r, j, max(ba - 0.18 - 0.5 * smoothstep(0.3, 2.0, ba), 0.0));
              w = 0.4; tail = 0.0;
              col = starCol(T * 0.8) * I * 0.7;
            }
          }
        } else if (type == 3) {
          // sparks spat from the burning stars, dropping and dying fast
          float j = mod(slot, NSTARF);
          float life = starLife(j, rr);
          float ag = 0.3 + aSeed.x * (life - 0.8);
          float age = ba - ag;
          float gl = 0.3 + 0.5 * aSeed.y;
          if (age > 0.0 && age < gl) {
            vec3 p = starPos(r, j, ag);
            vec3 v = vec3(aSeed.z - 0.5, aSeed.w - 0.9, fract(aSeed.x * 17.0) - 0.5) * 5.0;
            a1 = p + v * age - vec3(0.0, 4.9 * age * age, 0.0);
            a0 = a1 - (v - vec3(0.0, 9.81 * age, 0.0)) * 0.05;
            float T = 1.0 - age / gl;
            w = 0.07; tail = 0.15;
            col = hot(0.55 + 0.45 * T) * 6.0 * T;
          }
        } else if (type == 4) {
          if (slot < 0.5) {
            if (ba > 0.0 && ba < 0.6) {
              // the report: a small, very sharp flash where the shell bursts
              a0 = a1 = rkBurst(r);
              mode = 2.0; w = 5.0;
              col = vec3(1.0, 0.97, 0.92) * 160.0 * exp(-ba * 16.0);
            } else if (ra > 0.0 && ra < 0.3) {
              // the launch flash at the socket
              a0 = a1 = rkPath(r, 0.0);
              mode = 2.0; w = 3.0;
              col = vec3(1.0, 0.8, 0.5) * 40.0 * (1.0 - ra / 0.3);
            }
          } else if (ba > 0.0 && ba < 6.5) {
            // the air around the star cloud, faintly lit (the report brightens it for an instant)
            float e = (1.0 - exp(-SK * ba)) / SK;
            a0 = a1 = rkBurst(r) + vec3(0.0, 0.125 * ${STAR_V0.toFixed(1)} * e - 9.81 / SK * (ba - e), 0.0) + uWind * 1.2 * ba;
            mode = 1.0;
            w = 32.0 + 4.0 * ba;
            float gl = smoothstep(0.0, 0.15, ba) * (1.0 - smoothstep(2.5, 6.5, ba));
            col = vec3(1.0, 0.95, 0.86) * (0.2 * exp(-ba * 10.0) + 0.006 * gl);
          }
        }
      } else if (type == 5) {
        // ---------------- sparks torn from the break ----------------
        float tb = 195.05 + pow(slot / slots, 1.6) * 7.5 + aSeed.x * 0.15;
        float age = uT - tb;
        float life = 0.7 + 1.6 * aSeed.y;
        float strength = hist(1, tb).w;
        if (age > 0.0 && age < life && strength > 0.02) {
          vec3 l = uBreakL + vec3((aSeed.z - 0.5) * 2.0, -aSeed.w * 12.0, (fract(aSeed.x * 7.7) - 0.5) * 26.0);
          vec3 p0 = aSeed.w > 0.5 ? bowPt(l, tb) : sternPt(l, tb);
          vec3 v = normalize(vec3(aSeed.z - 0.5, 0.35 + aSeed.y, fract(aSeed.w * 5.3) - 0.5)) * (6.0 + 18.0 * fract(aSeed.x * 3.3));
          float k = 0.4;
          float e1 = (1.0 - exp(-k * age)) / k;
          a1 = p0 + v * e1 - vec3(0.0, 9.81 / k * (age - e1), 0.0);
          float ag0 = max(age - 0.06, 0.0);
          float e0 = (1.0 - exp(-k * ag0)) / k;
          a0 = p0 + v * e0 - vec3(0.0, 9.81 / k * (ag0 - e0), 0.0);
          float T = 1.0 - age / life;
          w = 0.1 + 0.1 * aSeed.z;
          col = hot(T) * (6.0 + 24.0 * T) * strength * step(0.0, a1.y + 0.3);
        }
      } else if (type == 6) {
        // ---------------- ice splinters glinting in the ship's light as the berg grinds past ----------------
        float tb = 74.15 + slot / slots * 10.5 + aSeed.x * 0.05;
        float age = uT - tb;
        float life = 1.2 + 2.2 * aSeed.y;
        vec4 CP = hist(10, tb);
        if (age > 0.0 && age < life && CP.w > 0.03) {
          vec3 side = normalize(bowDir(vec3(0.0, 0.0, 1.0), tb));
          vec3 fwd = normalize(bowDir(vec3(1.0, 0.0, 0.0), tb));
          vec3 p0 = CP.xyz + fwd * (aSeed.z - 0.5) * 12.0 + vec3(0.0, aSeed.w * 14.0, 0.0);
          vec3 v = side * (fract(aSeed.x * 7.3) - 0.6) * 9.0 + vec3(0.0, 2.0 + 9.0 * aSeed.y, 0.0) - fwd * 2.0 * aSeed.w;
          vec3 c = p0 + v * age - vec3(0.0, 4.9 * age * age, 0.0) + airDrift(tb, uT) * 0.9;
          // a tiny sliver tumbling end over end; a facet flashes only now and then
          float ph = uT * (7.0 + 9.0 * aSeed.z) + slot;
          vec3 ax = normalize(vec3(sin(ph + aSeed.w * 6.0), cos(ph * 0.73 + aSeed.x * 6.0), sin(ph * 1.31 + aSeed.y * 6.0)));
          float len = 0.025 + 0.06 * fract(aSeed.w * 5.7);
          a0 = c - ax * len; a1 = c + ax * len;
          w = 0.024 + 0.02 * aSeed.z; tail = 1.0;
          float tw = pow(abs(sin(ph * 1.7 + aSeed.y * 9.0)), 24.0);
          float lit = hist(1, tb).z;
          col = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.82, 0.6), 0.6 * lit) * (0.5 + 9.0 * tw) * CP.w * (1.0 - age / life) * step(-0.2, c.y);
        }
      }
      if (w <= 0.0 || dot(col, col) < 1e-6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      // never thinner than a pixel or two: trade size for brightness instead of aliasing
      float dist = max(length(cameraPosition - a1), 0.1);
      float px = w * uPxScale / dist;
      if (mode < 0.5) { if (px < 1.5) { col *= px / 1.5; w *= 1.5 / max(px, 1e-3); } }
      else if (mode > 1.5 && px < 3.0) { col *= px * px / 9.0; w *= 3.0 / max(px, 1e-3); }
      vec3 wp;
      float halfL = 0.0;
      if (mode > 0.5) wp = billboard(a1, corner, vec2(w), 0.0);
      else { wp = streak(a0, a1, corner, w); halfL = length(a1 - a0) * 0.5; }
      vK = corner; vCol = col; vMode = mode;
      vSeg = vec3(corner.x * (halfL + w), corner.y * w, halfL);
      vShape = vec2(w, tail);
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;

  const GLOW_FRAG = /* glsl */`
    varying vec2 vK;
    varying vec3 vCol;
    varying float vMode;
    varying vec3 vSeg;
    varying vec2 vShape;
    void main(){
      float b;
      if (vMode > 1.5) {
        // pin-point: a hot core and a small corona, zero well inside the quad
        float r2 = dot(vK, vK);
        b = (exp(-r2 * 12.0) + 0.14 * exp(-r2 * 4.0)) * (1.0 - smoothstep(0.5, 1.0, r2));
      } else if (vMode > 0.5) {
        float r2 = dot(vK, vK);
        b = (exp(-r2 * 6.0) + 0.3 * exp(-r2 * 2.2)) * (1.0 - smoothstep(0.45, 1.0, r2));
      } else {
        // capsule with round caps (distance to the segment), brightest at the head
        float halfL = vSeg.z, w = vShape.x;
        float dx = max(abs(vSeg.x) - halfL, 0.0);
        float d2 = (dx * dx + vSeg.y * vSeg.y) / (w * w);
        float along = clamp((vSeg.x + halfL) / max(2.0 * halfL, 1e-4), 0.0, 1.0);
        b = exp(-d2 * 4.0) * (1.0 - smoothstep(0.35, 1.0, d2)) * mix(vShape.y, 1.0, pow(along, 2.2));
      }
      if (b < 1e-4) discard;
      gl_FragColor = vec4(vCol * b, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildGlow(ctx, q) {
    const list = [];
    const rnd = U.rng('fx-glow');
    const push = (type, em, slot, slots) => list.push([type, em, slot, slots]);
    const nTrail = Math.round(90 * Math.max(q, 0.6)), nSpit = Math.round(80 * Math.max(q, 0.5));
    for (let r = 0; r < 5; r++) {
      push(0, r, 0, 1);
      for (let i = 0; i < nTrail; i++) push(1, r, i, nTrail);
      for (let i = 0; i < NSTAR; i++) { push(2, r, i, NSTAR); push(7, r, i, NSTAR); }
      for (let i = 0; i < nSpit; i++) push(3, r, i, nSpit);
      push(4, r, 0, 2); push(4, r, 1, 2);
    }
    const nSpark = Math.round(900 * q);
    for (let i = 0; i < nSpark; i++) push(5, 0, i, nSpark);
    const nIce = Math.round(700 * q);
    for (let i = 0; i < nIce; i++) push(6, 0, i, nIce);
    const n = list.length;
    const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
    list.forEach((e, i) => { info.set(e, i * 4); for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); });
    const geo = quadGeometry(n, { aSeed: [4, seed], aInfo: [4, info] });
    const mat = particleMaterial({
      vertex: GLOW_VERT, fragment: GLOW_FRAG, blending: 'add', fog: false,
      uniforms: Object.assign({ uBreakL: { value: ANCH.breakTop } }, RKU),
    });
    const E = EV();
    return addSystem(ctx, 'glow', geo, mat, {
      renderOrder: 20,
      active: (t) => (t >= E.rockets[0] - 0.1 && t < E.rockets[E.rockets.length - 1] + 12) || (t >= E.breakStart && t < E.breakDone + 5)
        || (t >= E.impact - 0.2 && t < E.scrapeEnd + 5),
    });
  }

  // ==================================================================
  // FOAM: white water left spreading on the surface by the splashes, and the
  // boiling, foaming patch where she went down.   (flat decals, not reflected)
  // ==================================================================
  const FOAM_VERT = GLSL_EVENTS + /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;     // type (0 splash patch, 1 boil patch, 2 ring), event, slot, slots
    uniform vec3 uPlunge;
    varying vec2 vUv, vK;
    varying float vAlpha;
    varying vec3 vCol;
    void main(){
      int type = int(aInfo.x + 0.5);
      int e = int(aInfo.y + 0.5);
      float slot = aInfo.z, slots = aInfo.w;
      vec4 A = uEvA[e], B = uEvB[e];
      float sz = B.w;
      vec3 c = vec3(0.0, -1e4, 0.0);
      float size = 1.0, alpha = 0.0;
      if (type == 0) {
        float tb = A.w + 0.3 + aSeed.x * 1.2;
        float age = uT - tb;
        float life = 35.0 + 25.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          vec3 seg = B.xyz - A.xyz;
          vec3 nrm = length(seg) > 1.0 ? normalize(vec3(-seg.z, 0.0, seg.x)) : vec3(1.0, 0.0, 0.0);
          float side = fract(aSeed.w * 11.3) > 0.5 ? 1.0 : -1.0;
          c = mix(A.xyz, B.xyz, aSeed.z) + nrm * side * (3.0 + 10.0 * aSeed.y) * sz;
          size = (5.0 + 7.0 * aSeed.x) * sz * (0.5 + 0.5 * (1.0 - exp(-age * 0.25))) + 0.12 * age;
          alpha = 0.85 * smoothstep(0.0, 1.0, age) * pow(max(1.0 - age / life, 0.0), 1.3);
        }
      } else if (type == 1) {
        // the boil: patches keep appearing while air comes up
        float tb = 221.8 + slot / slots * 15.0 + aSeed.x * 0.6;
        float age = uT - tb;
        float life = 22.0 + 18.0 * aSeed.y;
        if (age > 0.0 && age < life) {
          float ang = aSeed.z * 6.2832, rad = pow(aSeed.w, 0.7) * 34.0;
          c = uPlunge + vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
          size = (4.0 + 7.0 * aSeed.x) * (0.6 + 0.4 * (1.0 - exp(-age * 0.3))) + 0.1 * age;
          alpha = 0.75 * smoothstep(0.0, 1.5, age) * pow(max(1.0 - age / life, 0.0), 1.2);
        }
      } else {
        // an expanding ring of foam around the plunge
        float tb = A.w + 0.2;
        float age = uT - tb;
        float life = 30.0;
        if (age > 0.0 && age < life) {
          float ang = (slot + aSeed.x * 0.8) / slots * 6.2832;
          float rad = (10.0 + 22.0 * (1.0 - exp(-age * 0.25))) * (0.75 + 0.5 * aSeed.y) + 4.0 * sin(ang * 3.0 + aSeed.z * 6.0);
          c = uPlunge + vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
          size = 5.0 + 4.0 * aSeed.z + 0.15 * age;
          alpha = 0.6 * smoothstep(0.0, 0.6, age) * pow(max(1.0 - age / life, 0.0), 1.5);
        }
      }
      if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      c.y = 0.14;
      float rot = aSeed.w * 6.2832;
      float cr = cos(rot), sr = sin(rot);
      vec2 q = vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y) * size;
      vec3 wp = c + vec3(q.x, 0.0, q.y);
      vUv = wp.xz / 22.0 + aSeed.xy;
      vK = corner;
      vAlpha = alpha;
      vCol = vec3(0.85, 0.9, 0.95) * lightAt(c + vec3(0.0, 1.0, 0.0), 0.0);
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;

  const FOAM_FRAG = /* glsl */`
    uniform sampler2D uFoam;
    varying vec2 vUv, vK;
    varying float vAlpha;
    varying vec3 vCol;
    void main(){
      vec4 f = texture2D(uFoam, vUv);
      vec4 f2 = texture2D(uFoam, vUv * 2.3 + 0.37);
      float r = length(vK);
      float mask = (1.0 - smoothstep(0.2, 1.0, r + (f.g - 0.5) * 0.7));
      float foam = max(f.r, f2.r * 0.8) * 0.85 + f.b * f2.b * 0.35;
      foam *= smoothstep(0.25, 0.7, f.g * 0.6 + f2.g * 0.6);
      float a = foam * mask * vAlpha * 0.8;
      if (a < 0.003) discard;
      gl_FragColor = vec4(vCol * (0.7 + 0.5 * f.g), min(a, 1.0));
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildFoam(ctx, q, foamTex) {
    const list = [];
    const rnd = U.rng('fx-foam-decals');
    const push = (type, em, slot, slots) => list.push([type, em, slot, slots]);
    const nPatch = [0, Math.round(34 * q) + 6, Math.round(70 * q) + 10, Math.round(30 * q) + 6];
    for (let e = 1; e < 4; e++) for (let i = 0; i < nPatch[e]; i++) push(0, e, i, nPatch[e]);
    const nBoil = Math.round(90 * q) + 10;
    for (let i = 0; i < nBoil; i++) push(1, 3, i, nBoil);
    const nRing = 36;
    for (let i = 0; i < nRing; i++) push(2, 3, i, nRing);
    const n = list.length;
    const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
    list.forEach((e, i) => { info.set(e, i * 4); for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); });
    const geo = quadGeometry(n, { aSeed: [4, seed], aInfo: [4, info] });
    const mat = particleMaterial({
      vertex: FOAM_VERT, fragment: FOAM_FRAG,
      uniforms: Object.assign({ uFoam: { value: foamTex }, uPlunge: { value: PLUNGE } }, EVU),
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    const E = EV();
    return addSystem(ctx, 'foam', geo, mat, {
      renderOrder: 6, noReflect: true,
      active: (t, S) => !S.env.underwater && ((t >= E.funnel1Splash && t < E.funnel1Splash + 62) || (t >= E.sternSplash && t < 262)),
    });
  }

  // ==================================================================
  // THE DEEP: bubble streams from the sinking sections, marine snow around the
  // camera, faint light shafts under the surface, the silt cloud of the impact.
  // (all additive or alpha on NO_REFLECT)
  // ==================================================================
  const BUB_PTS = [
    [-24, 4, 5], [-26, -4, -4], [-70, 14, 6], [-112, 12, -3],     // stern section
    [-22, 2, 0], [40, 22, 0], [90, 13, 3], [10, 18, -6],          // bow section
  ].map((a) => new THREE.Vector3(a[0], a[1], a[2]));

  const BUB_VERT = /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;
    uniform vec3 uBubPts[8];
    uniform float uDeepDark;
    varying vec2 vK;
    varying vec3 vCol;
    void main(){
      float slot = aInfo.z, slots = aInfo.w;
      float L = 9.0;
      float phase = (slot + aSeed.x) / slots * L;
      float cyc = floor((uT - phase) / L);
      float age = uT - phase - cyc * L;
      float tb = uT - age;
      float r1 = hh(slot, cyc), r2 = hh(slot + 11.0, cyc + 5.0), r3 = hh(slot + 23.0, cyc + 9.0), r4 = hh(slot + 37.0, cyc + 3.0);
      bool bow = tb >= 247.0;
      float live = step(240.0, tb) * step(tb, 255.6) * step(r1, hist(2, tb).x);
      int s = int(mod(slot, 4.0)) + (bow ? 4 : 0);
      vec3 l = uBubPts[s] + (vec3(r2, r3, r4) - 0.5) * vec3(6.0, 3.0, 6.0);
      vec3 p0 = bow ? bowPt(l, tb) : sternPt(l, tb);
      float rad = 0.035 + 0.28 * pow(r3, 3.0) + (r4 > 0.975 ? 0.5 * r2 : 0.0);
      float vr = 0.45 + 2.4 * sqrt(rad);
      vec3 c = p0 + vec3(sin(age * 3.1 + r2 * 6.28) * 0.35 * sqrt(age), vr * age, cos(age * 2.7 + r3 * 6.28) * 0.35 * sqrt(age));
      float alpha = live * smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(L * 0.7, L, age)) * (1.0 - smoothstep(-4.0, -0.5, c.y));
      float pf;
      float size = minPixel(c, rad, pf);
      alpha *= pf;
      if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 wp = billboard(c, corner, vec2(size), 0.0);
      vK = corner;
      vCol = vec3(0.55, 0.85, 0.9) * alpha * mix(0.16, 0.05, uDeepDark);
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const BUB_FRAG = /* glsl */`
    varying vec2 vK;
    varying vec3 vCol;
    void main(){
      float r = length(vK);
      if (r > 1.0) discard;
      float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
      vec2 sp = vK - vec2(-0.3, 0.38);
      float spec = exp(-dot(sp, sp) * 28.0);
      gl_FragColor = vec4(vCol * (rim + 1.6 * spec + 0.1), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  const SNOW_VERT = /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    uniform float uSnow, uRov;
    varying vec2 vK;
    varying vec3 vCol;
    void main(){
      const float B = 36.0;
      vec3 base = aSeed.xyz * B;
      vec3 drift = vec3(sin(uT * 0.13 + aSeed.w * 6.28) * 0.7, -0.05 * uT, cos(uT * 0.11 + aSeed.x * 6.28) * 0.7);
      vec3 c = mod(base + drift - cameraPosition, B) - B * 0.5 + cameraPosition;
      vec3 dv = c - cameraPosition;
      float d = length(dv);
      float alpha = uSnow * smoothstep(0.9, 2.6, d) * (1.0 - smoothstep(B * 0.32, B * 0.5, d));
      float pf;
      float size = minPixel(c, 0.01 + 0.035 * aSeed.w * aSeed.w, pf);
      alpha *= pf;
      if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      float cone = smoothstep(0.55, 0.95, dot(dv / max(d, 1e-3), fwd));
      // each flake catches a little of the cold light filtering down (some glint brighter)
      float gl = 0.55 + 0.9 * pow(fract(aSeed.w * 7.13 + aSeed.x * 3.1), 3.0);
      vec3 L = vec3(0.06, 0.15, 0.16) * gl + vec3(1.0, 0.92, 0.8) * uRov * cone * 2.2 / (1.0 + d * d / 40.0);
      vec3 wp = billboard(c, corner, vec2(size), 0.0);
      vK = corner;
      vCol = L * alpha * 0.6;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const SNOW_FRAG = /* glsl */`
    varying vec2 vK;
    varying vec3 vCol;
    void main(){
      float r2 = dot(vK, vK);
      if (r2 > 1.0) discard;
      gl_FragColor = vec4(vCol * exp(-r2 * 3.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  const SHAFT_VERT = /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    uniform float uShaft;
    varying vec2 vK;
    varying float vA, vSeed;
    void main(){
      float ang = aSeed.x * 6.2832 + uT * 0.01;
      float dist = 14.0 + 80.0 * aSeed.y;
      vec3 top = vec3(cameraPosition.x + cos(ang) * dist, 0.0, cameraPosition.z + sin(ang) * dist);
      vec3 bot = top + vec3(10.0 * (aSeed.z - 0.5), -170.0, 10.0 * (aSeed.w - 0.5));
      float w = 2.5 + 7.0 * aSeed.z;
      vec3 wp = streak(top, bot, vec2(corner.y, corner.x), w);
      vK = corner;
      vSeed = aSeed.w;
      vA = uShaft * (0.2 + 0.8 * aSeed.y * aSeed.y) * step(0.35, fract(aSeed.w * 13.1));
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const SHAFT_FRAG = /* glsl */`
    varying vec2 vK;
    varying float vA, vSeed;
    void main(){
      float along = 0.5 - vK.y * 0.5;          // 1 at the surface .. 0 deep
      float across = 1.0 - vK.x * vK.x;
      float band = 0.55 + 0.45 * sin(vK.x * 3.0 + uT * 0.5 + vSeed * 20.0) * sin(vK.y * 4.0 - uT * 0.3 + vSeed * 7.0);
      float b = pow(max(along, 0.0), 3.0) * smoothstep(1.0, 0.9, along) * across * across * band * vA;
      gl_FragColor = vec4(vec3(0.02, 0.065, 0.075) * b, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  // silt boiling up where the bow section ploughed into the seabed
  const SILT_VERT = /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    attribute vec4 aInfo;
    uniform mat4 uBowFinal;
    uniform float uSed, uRov;
    uniform vec3 uLampPos[2];
    uniform vec4 uLampDir[2];      // xyz dir, w cos(outer)
    uniform vec3 uLampCol[2];
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vY;
    varying vec3 vCol;
    void main(){
      float x = aInfo.y > 0.5 ? mix(100.0, 134.0, aSeed.x) : mix(-22.0, 130.0, aSeed.x);
      float side = aSeed.w > 0.5 ? 1.0 : -1.0;
      float delay = (134.0 - x) / 158.0 * 2.0 + aSeed.y * 0.4;
      float age = uSed - delay;
      vec3 c = vec3(0.0, -1e5, 0.0);
      float alpha = 0.0, size = 1.0;
      if (age > 0.0) {
        vec3 lp = vec3(x, -10.0 + aSeed.z * 6.0, side * 11.0);
        vec3 p0 = (uBowFinal * vec4(lp, 1.0)).xyz;
        vec3 outD = normalize((uBowFinal * vec4(aInfo.y > 0.5 ? 0.7 : 0.0, 0.0, side, 0.0)).xyz * vec3(1.0, 0.0, 1.0) + 1e-4);
        float v0 = 5.0 + 11.0 * aSeed.z;
        float k = 0.45;
        float rise = (6.0 + 14.0 * aSeed.y * aSeed.y) * (1.0 - exp(-age * 0.45)) + 0.35 * age;
        c = p0 + outD * v0 * (1.0 - exp(-k * age)) / k + vec3(0.0, rise, 0.0);
        c.y = max(c.y, ${C.SEABED_Y.toFixed(1)} + 1.5);
        size = 2.5 + 3.8 * pow(age, 0.72);
        alpha = 0.42 * smoothstep(0.0, 0.35, age) * exp(-age / 40.0);
      }
      if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      // ROV lamps (or a lamp at the camera when none are found)
      vec3 L = vec3(0.004, 0.012, 0.013);
      for (int i = 0; i < 2; i++) {
        vec3 dl = c - uLampPos[i];
        float d = length(dl);
        float cone = smoothstep(uLampDir[i].w, mix(uLampDir[i].w, 1.0, 0.45), dot(dl / max(d, 1e-3), uLampDir[i].xyz));
        L += uLampCol[i] * cone / (1.0 + d * d / 900.0);
      }
      vec3 wp = billboard(c, corner, vec2(size), aSeed.w * 6.28 + age * 0.03);
      vUv = corner * 0.5 + 0.5;
      vAlpha = alpha; vVar = floor(aSeed.z * 3.999); vEro = 0.1 + 0.3 * smoothstep(0.0, 30.0, age);
      vCol = vec3(0.42, 0.39, 0.33) * L / (1.0 + 0.6 * dot(L, vec3(0.3333)));   // lit, never a white wall
      vY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const SILT_FRAG = GLSL_PUFF_FRAG + /* glsl */`
    varying vec2 vUv;
    varying float vAlpha, vVar, vEro, vY;
    varying vec3 vCol;
    void main(){
      vec4 tx = puffTex(vUv, vVar);
      float d = tx.r * smoothstep(vEro, vEro + 0.45, tx.b * 0.6 + tx.r * 0.6);
      // thin out toward the silt it rose from: no hard line where the puff meets the seabed
      float a = d * vAlpha * smoothstep(${C.SEABED_Y.toFixed(1)} - 0.5, ${C.SEABED_Y.toFixed(1)} + 4.0, vY);
      if (a < 0.003) discard;
      gl_FragColor = vec4(vCol * (0.75 + 0.5 * tx.g), a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function buildDeep(ctx, q, puffTex) {
    const out = {};
    const E = EV();
    const rnd = U.rng('fx-deep');
    const mk = (n, withInfo) => {
      const seed = new Float32Array(n * 4), info = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd(); info.set([0, 0, i, n], i * 4); }
      const a = { aSeed: [4, seed] };
      if (withInfo) a.aInfo = [4, info];
      return { a, info };
    };
    // bubbles
    let g = mk(Math.round(1800 * q), true);
    out.bubbles = addSystem(ctx, 'bubbles', quadGeometry(Math.round(1800 * q), g.a),
      particleMaterial({ vertex: BUB_VERT, fragment: BUB_FRAG, blending: 'add', fog: false,
        uniforms: { uBubPts: { value: BUB_PTS }, uDeepDark: { value: 0 } } }),
      { renderOrder: 15, noReflect: true, active: (t, S) => S.env.underwater && t >= E.underwater && t < E.seabedImpact + 9 });
    // marine snow
    const nSnow = Math.round(2600 * q);
    g = mk(nSnow, false);
    out.snow = addSystem(ctx, 'marineSnow', quadGeometry(nSnow, g.a),
      particleMaterial({ vertex: SNOW_VERT, fragment: SNOW_FRAG, blending: 'add', fog: false,
        uniforms: { uSnow: { value: 0 }, uRov: { value: 0 } } }),
      { renderOrder: 16, noReflect: true, active: (t, S) => S.fx.marineSnow > 0 && S.env.underwater });
    // light shafts
    g = mk(16, false);
    out.shafts = addSystem(ctx, 'shafts', quadGeometry(16, g.a),
      particleMaterial({ vertex: SHAFT_VERT, fragment: SHAFT_FRAG, blending: 'add', fog: false, uniforms: { uShaft: { value: 0 } } }),
      { renderOrder: 7, noReflect: true, active: (t, S) => S.env.underwater && t >= E.underwater && t < E.abyss });
    // silt
    const nSilt = Math.round(240 * q) + 20;
    g = mk(nSilt, true);
    for (let i = 0; i < nSilt; i++) g.info[i * 4 + 1] = i < nSilt * 0.3 ? 1 : 0;   // 30 % burst from the buried nose
    out.silt = addSystem(ctx, 'silt', quadGeometry(nSilt, g.a),
      particleMaterial({ vertex: SILT_VERT, fragment: SILT_FRAG, fog: false,
        uniforms: {
          uPuff: { value: puffTex }, uBowFinal: { value: new THREE.Matrix4() }, uSed: { value: 0 }, uRov: { value: 0 },
          uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
          uLampDir: { value: [new THREE.Vector4(0, -1, 0, 0.9), new THREE.Vector4(0, -1, 0, 0.9)] },
          uLampCol: { value: [new THREE.Vector3(), new THREE.Vector3()] },
        } }),
      { renderOrder: 11, noReflect: true, active: (t, S) => S.fx.sediment > 0 && S.env.underwater });
    // the bow section at rest on the seabed
    const st = TT.story.makeState();
    TT.story.sample(E.seabedImpact + 5, st);
    TT.pose.matrix(st.ship.bow, out.silt.mat.uniforms.uBowFinal.value);
    return out;
  }

  // ROV lamps: props owns the SpotLights; find them once the seabed scene is on
  let _spots = null, _spotScan = -1;
  function findSpots(scene, t) {
    if (_spots && _spots.length) return _spots;
    if (Math.abs(t - _spotScan) < 1.5) return _spots;
    _spotScan = t;
    const found = [];
    scene.traverse((o) => { if (o.isSpotLight) found.push(o); });
    _spots = found.slice(0, 2);
    return _spots;
  }

  // ==================================================================
  // MIST: low banks drifting over the water (the silence, the dawn). A field of
  // wide soft sprites wrapped around the camera; upright when seen from sea level,
  // lying flat when seen from above.
  // ==================================================================
  const MIST_P = 1800.0;
  const MIST_VERT = /* glsl */`
    attribute vec2 corner;
    attribute vec4 aSeed;
    uniform float uMist, uWindSpd;
    uniform vec3 uMistCol, uSunDir, uSunCol;
    varying vec2 vUv;
    varying float vAlpha, vVar;
    varying vec3 vCol, vWorld;
    void main(){
      const float P = ${MIST_P.toFixed(1)};
      vec2 base = aSeed.xy * P;
      vec2 drift = uWind.xz * (uWindSpd * 0.9 + 0.3) * uT;
      vec2 rel = mod(base + drift - cameraPosition.xz + P * 0.5, P) - P * 0.5;
      float d = length(rel);
      float h = 2.0 + aSeed.z * 12.0;
      vec3 c = vec3(cameraPosition.x + rel.x, h, cameraPosition.z + rel.y);
      vec3 toC = cameraPosition - c;
      vec2 fh = -toC.xz / max(length(toC.xz), 1e-3);
      vec3 right = vec3(-fh.y, 0.0, fh.x);
      float e = smoothstep(0.08, 0.45, (cameraPosition.y - h) / max(d, 1.0));
      vec3 upA = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(fh.x, 0.0, fh.y), e));
      float w = 70.0 + 130.0 * aSeed.w;
      float hh_ = mix(8.0 + 10.0 * aSeed.z, w * 0.55, e);
      vec3 wp = c + right * corner.x * w + upA * corner.y * hh_;
      wp.y = max(wp.y, 0.2);
      vWorld = wp;
      vUv = corner * 0.5 + 0.5;
      vVar = floor(aSeed.z * 3.999);
      vAlpha = uMist * 0.4 * smoothstep(35.0, 160.0, d) * (1.0 - smoothstep(P * 0.32, P * 0.48, d));
      vec3 vd = normalize(c - cameraPosition);
      float fwdS = pow(max(dot(vd, uSunDir), 0.0), 5.0);
      vCol = uMistCol + uSunCol * fwdS;
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const MIST_FRAG = GLSL_PUFF_FRAG + /* glsl */`
    varying vec2 vUv;
    varying float vAlpha, vVar;
    varying vec3 vCol, vWorld;
    void main(){
      vec4 tx = puffTex(vUv, vVar);
      float a = mix(tx.r, tx.a, 0.4) * vAlpha;
      a *= smoothstep(0.0, 3.0, vWorld.y);
      if (a < 0.002) discard;
      gl_FragColor = vec4(vCol, a);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  function buildMist(ctx, q, puffTex) {
    const n = Math.round(110 * q) + 20;
    const rnd = U.rng('fx-mist');
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seed[i] = rnd();
    const mat = particleMaterial({
      vertex: MIST_VERT, fragment: MIST_FRAG,
      uniforms: {
        uPuff: { value: puffTex }, uMist: { value: 0 }, uWindSpd: { value: 1 },
        uMistCol: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(-1, 0.05, 0) }, uSunCol: { value: new THREE.Vector3() },
      },
    });
    return addSystem(ctx, 'mist', quadGeometry(n, { aSeed: [4, seed] }), mat, {
      renderOrder: 5, noReflect: true,
      active: (t, S) => S.env.mist > 0.1 && !S.env.underwater,
    });
  }

  // ==================================================================
  // ICE: chunks broken off the berg tumbling onto the forward well deck; they stay
  // there (ship-local) as she settles. MeshStandardMaterial so they catch the ship's lights.
  // ==================================================================
  function buildIce(ctx, q) {
    const n = Math.round(56 * Math.max(q, 0.6));
    const rnd = U.rng('fx-ice');
    // an irregular splinter of clear ice: the convex hull of points scattered through a
    // flattened, elongated ellipsoid (a sharp-faceted shard, not a gem)
    let g0 = null;
    const A = TT.addons || (typeof ADDONS !== 'undefined' ? ADDONS : null);
    if (A && A.ConvexGeometry) {
      const pts = [];
      for (let i = 0; i < 11; i++) {
        const u = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, rr = 0.55 + 0.45 * rnd();
        const sq = Math.sqrt(1 - u * u);
        pts.push(new THREE.Vector3(u * 1.5 * rr, sq * Math.cos(ph) * 0.45 * rr, sq * Math.sin(ph) * 0.8 * rr));
      }
      pts.push(new THREE.Vector3(1.6, 0.05, 0.1), new THREE.Vector3(-1.3, -0.08, -0.15));   // the sharp ends
      try { g0 = new A.ConvexGeometry(pts); } catch (e) { g0 = null; }
    }
    if (!g0) { g0 = new THREE.OctahedronGeometry(1, 0); g0.scale(1.5, 0.5, 0.8); }
    g0.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcfe0ec, roughness: 0.12, metalness: 0.0, flatShading: true,
      emissive: 0x1e3040, emissiveIntensity: 0.4,
    });
    const mesh = new THREE.InstancedMesh(g0, mat, n);
    mesh.name = 'fx.iceChunks';
    mesh.frustumCulled = false;
    mesh.layers.set(TT.LAYERS.NO_REFLECT);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    const E = EV();
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const r = () => rnd();
      const x0 = 69 + r() * 27;
      const c = {
        tf: E.impact + 0.5 + (97 - x0) / 31 * 3.2 + r() * 0.7,
        p0: new THREE.Vector3(x0, 23 + r() * 9, 14.5 + r() * 4),
        p1: new THREE.Vector3(x0 - 1 - r() * 3, 0, 11 - Math.pow(r(), 0.8) * 21),
        size: 0.14 + Math.pow(r(), 2.4) * 0.55,
        shape: new THREE.Vector3(0.75 + 0.5 * r(), 0.6 + 0.6 * r(), 0.7 + 0.5 * r()),
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: 3 + r() * 8,
        rest: new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)),
      };
      c.p1.y = SH.WELL_DECK_Y + c.size * 0.55;
      c.tFall = Math.sqrt((2 * (c.p0.y - c.p1.y)) / 9.81);
      chunks.push(c);
    }
    ctx.scene.add(mesh);
    const q_ = new THREE.Quaternion(), s_ = new THREE.Vector3(), p_ = new THREE.Vector3(), mL = new THREE.Matrix4(), mB = new THREE.Matrix4();
    return {
      mesh, chunks,
      update(t, S) {
        const on = t > E.impact && t < E.breakStart - 10 && S.ship.visible;
        mesh.visible = on;
        if (!on) return;
        TT.pose.matrix(S.ship.bow, mB);
        let shown = 0;
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          const a = t - c.tf;
          if (a < 0) { mL.makeScale(0, 0, 0); mesh.setMatrixAt(i, mL); continue; }
          let u;
          if (a < c.tFall) {
            u = a / c.tFall;
            p_.lerpVectors(c.p0, c.p1, u);
            p_.y = c.p0.y - 0.5 * 9.81 * a * a;
          } else {
            // slide / skid to rest with a small bounce
            const b = a - c.tFall;
            const k = 1 - Math.exp(-b * 3);
            p_.copy(c.p1);
            p_.x += (c.p1.x - c.p0.x) * 0.3 * k;
            p_.z += (c.p1.z - c.p0.z) * 0.12 * k;
            p_.y += Math.max(0, Math.sin(Math.min(b, 0.45) / 0.45 * Math.PI)) * 0.35 * c.size;
          }
          const ang = c.spin * Math.min(a, c.tFall + 0.5);
          q_.setFromAxisAngle(c.axis, ang).multiply(c.rest);
          s_.copy(c.shape).multiplyScalar(c.size);
          mL.compose(p_, q_, s_);
          mL.premultiply(mB);
          // once the flooding well deck takes them, they float off: hide
          if (mL.elements[13] < 0.15) mL.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, mL);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // ==================================================================
  // the remaining systems: build + per-frame hooks
  // ==================================================================
  const _sunDir = new THREE.Vector3(), _col = new THREE.Color();
  function buildMore(ctx, q, self) {
    const foamTex = makeFoamTexture();
    const puff = self._tex.puff;
    self._tex.foam = foamTex;
    self.sys.foam = buildFoam(ctx, q, foamTex);
    Object.assign(self.sys, buildDeep(ctx, q, puff));
    self.sys.mist = buildMist(ctx, q, puff);
    self.ice = buildIce(ctx, q);
  }

  fx.updateMore = function (t, dt, ctx) {
    const S = ctx.S, sys = this.sys;
    if (this.ice) this.ice.update(t, S);
    const E = S.env;
    const deep = U.smoothstep(20, 600, E.depth || 0);
    if (sys.bubbles) sys.bubbles.mat.uniforms.uDeepDark.value = deep;
    if (sys.snow) {
      sys.snow.mat.uniforms.uSnow.value = S.fx.marineSnow * (1 - 0.3 * deep);
      sys.snow.mat.uniforms.uRov.value = S.fx.rov;
    }
    if (sys.shafts) sys.shafts.mat.uniforms.uShaft.value = E.underwater ? (1 - U.smoothstep(15, 150, E.depth || 0)) : 0;
    if (sys.silt) {
      const u = sys.silt.mat.uniforms;
      u.uSed.value = S.fx.sediment;
      u.uRov.value = S.fx.rov;
      const spots = S.fx.sediment > 0 ? findSpots(ctx.scene, t) : null;
      for (let i = 0; i < 2; i++) {
        const sp = spots && spots[i];
        if (sp && sp.visible !== false) {
          sp.getWorldPosition(u.uLampPos.value[i]);
          sp.target.getWorldPosition(_v1);
          _v1.sub(u.uLampPos.value[i]).normalize();
          u.uLampDir.value[i].set(_v1.x, _v1.y, _v1.z, Math.cos(sp.angle || 0.6));
          const k = Math.min(3, (sp.intensity || 0) / 1500);
          u.uLampCol.value[i].set(sp.color.r, sp.color.g, sp.color.b).multiplyScalar(k);
        } else if (i === 0) {
          // no ROV lamps in the scene: a lamp at the camera, as if the ROV were filming
          u.uLampCol.value[0].set(1.0, 0.93, 0.82).multiplyScalar(2.2 * (0.15 + 0.85 * S.fx.rov));
          u.uLampDir.value[0].w = -2;   // recomputed in render (needs the director's camera)
          this._camLamp = true;
        } else u.uLampCol.value[i].set(0, 0, 0);
      }
    }
    if (sys.mist) {
      const u = sys.mist.mat.uniforms;
      u.uMist.value = E.mist;
      u.uWindSpd.value = E.wind;
      // night: a faint grey-blue veil; dawn: the horizon colour, lit rose-gold toward the sun
      const sky = TT.sky;
      const dawn = U.clamp(E.dawn);
      if (sky && sky.horizonColor && sky.horizonColor.isColor) _col.copy(sky.horizonColor);
      else _col.setRGB(0.012, 0.02, 0.035).lerp(new THREE.Color(0.55, 0.42, 0.45), dawn);
      u.uMistCol.value.set(_col.r, _col.g, _col.b).multiplyScalar(1.3).add(SU.uAmb.value.clone().multiplyScalar(1.5));
      if (sky && sky.sunDir && sky.sunDir.isVector3) _sunDir.copy(sky.sunDir); else _sunDir.set(-1, 0.04, -0.15);
      u.uSunDir.value.copy(_sunDir).normalize();
      u.uSunCol.value.set(1.0, 0.62, 0.38).multiplyScalar(0.9 * dawn);
    }
  };

  fx.renderMore = function (ctx) {
    const sys = this.sys;
    if (sys.silt && this._camLamp && sys.silt.mesh.visible) {
      const u = sys.silt.mat.uniforms;
      const cam = ctx.camera;
      cam.getWorldPosition(u.uLampPos.value[0]);
      cam.getWorldDirection(_v1);
      if (u.uLampDir.value[0].w < -1) u.uLampDir.value[0].set(_v1.x, _v1.y, _v1.z, 0.72);
    }
    this._camLamp = false;
  };

  // ==================================================================
  // LIFECYCLE
  // ==================================================================
  const FLASH_COL = new THREE.Color(1.0, 0.93, 0.8);    // magnesium white, warm (#fff5e0-ish, linear)
  const SPARK_COL = new THREE.Color(1.0, 0.45, 0.14);
  const _amb = new THREE.Vector3();

  // intensity envelope (0..1+) of rocket r at story time t, and where its light is
  function rocketFlash(r, t, outPos) {
    const L = RK.L[r];
    if (L == null) return 0;
    const ra = t - L;
    if (ra < 0 || ra > RK_T + 7.5) return 0;
    const ba = ra - RK_T;
    let I = 0;
    const p0 = RK.p0[r], dir = RK.dir[r], H = RKU.uRkDir.value[r].w;
    if (ra < RK_T) {
      const u = ra / RK_T;
      outPos.copy(p0).addScaledVector(dir, Math.max(6, H * (1 - (1 - u) * (1 - u))));
      I = 0.03 + (ra < 0.35 ? 0.05 * (1 - ra / 0.35) : 0);
    } else {
      // the report's flash, then the burning star cloud (its centroid, as the glow shader moves it)
      const e = (1 - Math.exp(-STAR_K * ba)) / STAR_K;
      outPos.copy(p0).addScaledVector(dir, H);
      outPos.x += SU.uWind.value.x * 1.2 * ba; outPos.z += SU.uWind.value.z * 1.2 * ba;
      outPos.y += 0.125 * STAR_V0 * e - (9.81 / STAR_K) * (ba - e);
      const flick = 0.86 + 0.14 * Math.sin(t * 31 + r * 1.7) * Math.sin(t * 17.3 + r);
      I = Math.exp(-ba * 14) + 0.32 * U.smoothstep(0, 0.08, ba) * (0.65 + 0.35 * Math.exp(-ba * 2.4)) * (1 - U.smoothstep(3.4, 6.8, ba)) * flick;
    }
    return I;
  }

  fx.init = async function (ctx) {
    this.ctx = ctx;
    const q = ctx.quality === 'high' ? 1 : ctx.quality === 'medium' ? 0.65 : 0.4;
    this.q = q;
    this.post = buildPost(ctx);
    ctx.onProgress && ctx.onProgress(0.9, 'fx: post');
    SU.uHist.value = buildHistory();
    buildEvents();
    buildRockets();
    const puff = makePuffAtlas();
    this._tex = { puff };
    this.sys = {
      dark: buildDarkPuffs(ctx, q, puff),
      white: buildWhitePuffs(ctx, q, puff),
      spray: buildSpray(ctx, q, puff),
      glow: buildGlow(ctx, q),
    };
    if (typeof buildMore === 'function') buildMore(ctx, q, this);
    // lights (always present, intensity 0 when idle: a constant light count avoids shader recompiles)
    const rl = new THREE.PointLight(0xfff0dc, 0, 2600, 2);
    rl.name = 'fx.rocketLight';
    const sl = new THREE.PointLight(0xff8a3a, 0, 500, 2);
    sl.name = 'fx.sparkLight';
    rl.position.set(0, -1e4, 0); sl.position.set(0, -1e4, 0);
    ctx.scene.add(rl, sl);
    this.lights = [rl, sl];
    this.rocketLight = rl; this.sparkLight = sl;
  };

  fx.update = function (t, dt, ctx) {
    const S = ctx.S;
    SU.uT.value = t;
    if (captureAnchors(S)) { buildRockets(); buildEvents(); }

    // ambient light for particles: starlight at night, the dawn sky later, dim teal underwater
    const E = S.env;
    const night = _amb.set(0.036, 0.05, 0.085);
    const dawn = E.dawn;
    if (dawn > 0) night.lerp(_v1.set(0.42, 0.36, 0.38), U.clamp(dawn));
    if (E.underwater) night.set(0.004, 0.012, 0.014);
    SU.uAmb.value.copy(night);

    // the lit ship (warm) along its length
    const lights = S.ship.visible ? S.ship.lights : 0;
    SU.uShipLight.value.set(1.0, 0.62, 0.32).multiplyScalar(1.6 * lights);
    TT.pose.toWorld(S.ship.stern, _v1.set(-110, 12, 0), SU.uShipA.value);
    TT.pose.toWorld(S.ship.bow, _v1.set(120, 12, 0), SU.uShipB.value);
    SU.uWind.value.set(-0.6, 0, -0.8);
    const wind = E.wind;
    for (const s of this.systems) if (s.mat.uniforms.uWindSpd) s.mat.uniforms.uWindSpd.value = wind;

    // ---------------- flashes (rockets 0/1, break sparks 2) and the two PointLights ----------------
    const F = TT.flashes;
    let best = -1, bestI = 0, second = -1, secondI = 0;
    const pos = [_v1, _v2];
    for (let r = 0; r < RK.L.length; r++) {
      const I = rocketFlash(r, t, _v3);
      if (I > bestI) { second = best; secondI = bestI; pos[1].copy(pos[0]); best = r; bestI = I; pos[0].copy(_v3); }
      else if (I > secondI) { second = r; secondI = I; pos[1].copy(_v3); }
    }
    const setFlash = (f, I, p, col, range) => {
      f.intensity = I; f.range = range; f.color.copy(col);
      if (I > 0) f.pos.copy(p); else f.pos.set(0, -1e5, 0);
    };
    setFlash(F[0], bestI * 6, pos[0], FLASH_COL, 700);
    setFlash(F[1], secondI * 6, pos[1], FLASH_COL, 700);
    // break sparks
    const bs = S.fx.breakSparks;
    let sparkI = 0;
    if (bs > 0.01) {
      TT.pose.toWorld(S.ship.bow, ANCH.breakTop, _v3);
      TT.pose.toWorld(S.ship.stern, ANCH.breakTop, _v1);
      _v3.add(_v1).multiplyScalar(0.5);
      _v3.y -= 3;
      const fl = 0.65 + 0.35 * U.noise1(t * 11, 3) + 0.2 * U.noise1(t * 29, 5);
      sparkI = bs * U.clamp(fl, 0.2, 1.3);
      setFlash(F[2], sparkI * 2.5, _v3, SPARK_COL, 90);
      this.sparkLight.position.copy(_v3);
    } else setFlash(F[2], 0, _v3, SPARK_COL, 90);
    this.sparkLight.intensity = sparkI * 9000;
    F[3].intensity = 0; F[3].pos.set(0, -1e5, 0);
    if (bestI > 0) {
      this.rocketLight.position.copy(F[0].pos);
      this.rocketLight.intensity = bestI * 3.2e5;
    } else this.rocketLight.intensity = 0;
    for (let i = 0; i < 4; i++) {
      SU.uFlashPos.value[i].copy(F[i].pos);
      // on particles the break sparks are a local light (steam and dust at the tear), not a
      // floodlight: dimmer and short-ranged, so distant splash mist doesn't glow
      SU.uFlashCol.value[i].set(F[i].color.r, F[i].color.g, F[i].color.b).multiplyScalar(F[i].intensity * (i < 2 ? 1 : 0.4));
      SU.uFlashRange.value[i] = F[i].range * (i < 2 ? 0.55 : 0.35);
    }

    for (const s of this.systems) {
      let on = false;
      try { on = !!s.active(t, S); } catch (e) { on = false; }
      s.mesh.visible = on;
    }
    if (this.updateMore) this.updateMore(t, dt, ctx);
  };

  // world position where distress rocket r bursts (used by the director to frame it)
  fx.rocketBurst = function (r, out) {
    out = out || new THREE.Vector3();
    const p0 = RK.p0[r], dir = RK.dir[r];
    if (!p0) return null;
    return out.copy(p0).addScaledVector(dir, RKU.uRkDir.value[r].w);
  };
  // 0..1+ brightness of rocket r's flash at story time t (and its light position in `outPos`)
  fx.rocketFlash = function (r, t, outPos) { return rocketFlash(r, t, outPos || new THREE.Vector3()); };

  fx.resize = function (w, h) {
    if (!this.post) return;
    const r = this.ctx.renderer;
    this.post.composer.setPixelRatio(r.getPixelRatio());
    this.post.composer.setSize(w, h);
  };

  fx.render = function (ctx, dt) {
    const S = ctx.S, cam = ctx.camera, r = ctx.renderer, P = this.post;
    if (!P) { r.render(ctx.scene, cam); return; }
    // keep the composer in step with the renderer's size / pixel ratio
    const pr = r.getPixelRatio();
    if (P.composer._pixelRatio !== pr || P.composer._width !== ctx.width || P.composer._height !== ctx.height) this.resize(ctx.width, ctx.height);

    SU.uCamUnder.value = cam.position.y < 0 ? 1 : 0;
    SU.uPxScale.value = (ctx.height * pr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (this.renderMore) this.renderMore(ctx, dt);

    const G = S.grade, E = S.env;
    const gu = P.gradeMat.uniforms;
    gu.uExposure.value = G.exposure;
    gu.uSat.value = G.saturation;
    gu.uContrast.value = G.contrast * 1.06;
    gu.uWarmth.value = G.warmth;
    gu.uVignette.value = G.vignette;
    gu.uUnder.value = G.underwater;
    gu.uDawn.value = U.clamp(E.dawn);
    gu.uNight.value = 1 - U.clamp(E.dawn);
    gu.uDepthDark.value = U.smoothstep(20, 400, E.depth || 0);
    gu.uHalation.value = 0.35 * (G.bloom != null ? G.bloom : 1);
    gu.uStreak.value = this.q >= 0.6 ? 0.06 * (G.bloom != null ? G.bloom : 1) : 0;
    // the water volume: cold teal light scattered through the deep (sunlit green-teal near the
    // surface, a faint blue-teal in the abyss) so the black wreck reads against it
    const under = E.underwater ? U.clamp(G.underwater) : 0;
    gu.uAbyss.value = under;
    if (under > 0) {
      const dp = E.depth || 0;
      const kd = U.smoothstep(12, 400, dp);
      gu.uAbyssCol.value.set(U.lerp(0.0065, 0.0036, kd), U.lerp(0.036, 0.0175, kd), U.lerp(0.042, 0.024, kd))
        .multiplyScalar(U.lerp(1.0, 0.82, U.smoothstep(1500, 3790, dp)));
      gu.uAbyssK.value = U.lerp(0.014, 0.0065, kd);
      gu.uMurkT.value = S.t;
      gu.tDepth.value = P.scenePass.rt ? P.scenePass.rt.depthTexture : null;
      gu.uNear.value = cam.near; gu.uFar.value = cam.far;
      cam.updateMatrixWorld();
      gu.uProjInv.value.copy(cam.projectionMatrixInverse);
      cam.getWorldPosition(gu.uCamPos.value);
      // the water colour as the grade leaves it (exposure, cold balance, the underwater filter)
      const fog = ctx.scene.fog;
      if (fog && fog.color) {
        const dd = gu.uDepthDark.value, cw = U.clamp(-G.warmth);
        gu.uFogT.value.set(fog.color.r * U.lerp(1, 0.86, cw) * U.lerp(0.30, 0.72, dd), fog.color.g * U.lerp(1, 0.97, cw) * U.lerp(0.85, 0.9, dd),
          fog.color.b * U.lerp(1, 1.14, cw)).multiplyScalar(G.exposure * 1.1);
      } else gu.uFogT.value.set(0, 0, 0);
      gu.uCamRot.value.setFromMatrix4(cam.matrixWorld);
      if (!gu.tDepth.value) gu.uAbyss.value = 0;
    }
    const b = P.bloom;
    b.strength = 0.65 * (G.bloom != null ? G.bloom : 1);
    b.radius = 0.6;
    b.threshold = 0.9;
    const fu = P.finMat.uniforms;
    fu.uGrain.value = G.grain;
    fu.uFade.value = U.clamp(Math.max(G.fade, (cam.userData && cam.userData.fade) || 0));
    fu.uTime.value = ctx.realTime;
    fu.uPx.value = Math.max(1, 1.25 * pr * (ctx.height / 1080));
    fu.uCA.value = 0.012;

    P.composer.render(dt);
    // report the scene pass (not the post quads) through renderer.info like a plain render would
    const inf = r.info.render;
    inf.calls = this.stats.sceneCalls; inf.triangles = this.stats.sceneTris;
    inf.points = this.stats.scenePoints || 0; inf.lines = this.stats.sceneLines || 0;
  };
})();
