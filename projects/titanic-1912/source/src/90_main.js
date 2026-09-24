import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/90_main.js ====
// =====================================================================
// 90_main.js — bootstrap, renderer, module lifecycle, render loop, and
// stand-in proxies for modules that are absent from a dev build.
// Owner: integration.
// =====================================================================
(async function boot() {
  const P = TT.params;
  const C = TT.CONST;
  const U = TT.util;

  // ---------- quality ----------
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  let quality = P.q || (isMobile ? 'low' : 'high');
  if (!['low', 'medium', 'high'].includes(quality)) quality = 'high';

  // ---------- renderer ----------
  const root = document.getElementById('tt-root') || document.body;
  const renderer = new THREE.WebGLRenderer({
    antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false,
    preserveDrawingBuffer: P.freeze === '1',
  });
  const baseDpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1);
  renderer.setPixelRatio(baseDpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = C.LIGHT.exposure;
  renderer.shadowMap.enabled = false;           // night scene: no shadow-casting lights by default
  renderer.domElement.id = 'tt-canvas';
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);
  const camera = new THREE.PerspectiveCamera(C.CAMERA.fov, window.innerWidth / window.innerHeight, C.CAMERA.near, C.CAMERA.far);
  camera.position.set(260, 45, 330);
  camera.lookAt(0, 15, 0);
  // Camera hints set by the director and read by fx / ocean / ui:
  camera.userData.fade = 0;        // 0 picture .. 1 black (combined with S.grade.fade)
  camera.userData.focus = 300;     // focus distance (m) for depth of field
  camera.userData.aperture = 0;    // 0 = sharp .. 1 = strong cinematic bokeh
  camera.userData.shot = 'default';
  camera.userData.letterbox = null; // null = use S.grade.letterbox
  camera.layers.enable(TT.LAYERS.NO_REFLECT);
  scene.add(camera);

  const ctx = {
    THREE, addons: TT.addons, renderer, scene, camera,
    quality, isMobile, params: P, debug: TT.debug,
    S: TT.S, story: TT.story, CONST: C,
    width: window.innerWidth, height: window.innerHeight,
    time: 0, dt: 0, realTime: 0, preshow: true,
    onProgress: (f, label) => TT.emit('progress', { f, label }),
  };
  TT.ctx = ctx;

  // ---------- init modules ----------
  const mods = TT.modules.slice().sort((a, b) => a.order - b.order);
  const ui = mods.find((m) => m.name === 'ui');
  if (ui && ui.init) { try { await ui.init(ctx); ui._ready = true; } catch (e) { TT.error('init ui', e); } }
  let done = 0;
  for (const m of mods) {
    if (m === ui) continue;
    if (m.init) {
      try {
        const t0 = performance.now();
        await m.init(ctx);
        m._ready = true;
        TT.log('init ' + m.name + ' ' + (performance.now() - t0).toFixed(0) + 'ms');
      } catch (e) { TT.error('init ' + m.name, e); m._failed = true; }
    } else m._ready = true;
    done++;
    ctx.onProgress(0.72 * done / mods.length, m.name);
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------- stand-ins for absent modules (dev builds) ----------
  const proxies = [];
  if (!TT.sky || TT.sky._failed) {
    const L = C.LIGHT;
    const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    const key = new THREE.DirectionalLight(L.starKey.color, L.starKey.intensity);
    key.position.copy(L.starKey.dir).multiplyScalar(1000);
    scene.add(hemi, key);
    scene.background = new THREE.Color(0x060b16);
  }
  if (!TT.ocean || TT.ocean._failed) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x03070d, roughness: 0.15, metalness: 0.0 }));
    sea.name = 'proxy sea';
    scene.add(sea);
    proxies.push({ update() { sea.visible = !TT.S.env.underwater; } });
  }
  if (!TT.ship || TT.ship._failed) proxies.push(makeProxyShip(scene));
  if (!TT.props || TT.props._failed) proxies.push(makeProxyBerg(scene));

  // ---------- probe=t1,t2,...: print story poses (numeric debugging) ----------
  if (P.probe) {
    const SH = C.SHIP, tmp = TT.story.makeState(), v = new THREE.Vector3();
    const r = (x) => Math.round(x * 10) / 10;
    const w = (pose, x, y) => { TT.pose.toWorld(pose, v.set(x, y, 0), v); return [r(v.x), r(v.y), r(v.z)]; };
    for (const tp of P.probe.split(',').map(Number)) {
      TT.story.sample(tp, tmp);
      const s = tmp.ship;
      console.log('TT_PROBE t=' + tp + ' ' + JSON.stringify({
        scene: tmp.scene, speed: r(s.speed), heading: r(s.heading / U.DEG), pitch: r(s.pitch / U.DEG), broken: r(s.broken), lights: r(s.lights),
        stemTop: w(s.bow, SH.STEM_X, 17.8), stemKeel: w(s.bow, SH.STEM_X, SH.KEEL_Y), f1Top: w(s.bow, SH.FUNNEL_X[0], SH.FUNNEL_TOP_Y),
        breakTopBow: w(s.bow, SH.BREAK_X, SH.BOAT_DECK_Y), breakTopStern: w(s.stern, SH.BREAK_X, SH.BOAT_DECK_Y),
        sternTop: w(s.stern, SH.STERN_X, 16.6), props: w(s.stern, SH.PROP_CENTER.x, SH.PROP_CENTER.y),
        vis: [s.visible, s.bowVisible, s.sternVisible], berg: [r(tmp.iceberg.pos.x), r(tmp.iceberg.pos.z), tmp.iceberg.visible],
      }));
    }
  }

  // ---------- clock / start ----------
  const startT = P.t != null ? parseFloat(P.t) || 0 : 0;
  if (P.freeze === '1') TT.clock.frozen = startT;
  TT.clock.seek(startT);
  TT.start = async function (fromT) {
    const t = fromT != null ? fromT : TT.clock.now();
    ctx.preshow = false;
    if (TT.audio && TT.audio._ready) {
      try { await TT.audio.start(t); } catch (e) { TT.error('audio start', e); }
    }
    TT.clock.play(t);
    TT.emit('start', t);
  };
  TT.seek = function (t) { TT.clock.seek(t); };
  if (P.autoplay === '1' || P.freeze === '1') { ctx.preshow = false; TT.clock.play(startT); }

  // ---------- resize ----------
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    ctx.width = w; ctx.height = h;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const m of mods) if (m._ready && m.resize) { try { m.resize(w, h, ctx); } catch (e) { TT.error('resize ' + m.name, e); } }
  }
  window.addEventListener('resize', onResize);

  // ---------- debug camera override ----------
  let camOverride = null;
  if (P.cam) {
    const v = P.cam.split(',').map(Number);
    if (v.length >= 6 && v.every((x) => !isNaN(x))) camOverride = v;
  }

  // ---------- adaptive resolution ----------
  let frameAcc = 0, frameCount = 0, dpr = baseDpr;
  function adapt(dt) {
    if (P.freeze === '1' || P.q) return;
    frameAcc += dt; frameCount++;
    if (frameAcc < 2.0) return;
    const fps = frameCount / frameAcc;
    frameAcc = 0; frameCount = 0;
    let next = dpr;
    if (fps < 42 && dpr > 0.55) next = Math.max(0.55, dpr * 0.85);
    else if (fps > 58 && dpr < baseDpr) next = Math.min(baseDpr, dpr * 1.08);
    if (Math.abs(next - dpr) > 0.01) { dpr = next; renderer.setPixelRatio(dpr); onResize(); }
  }

  function updateAll(t, dt) {
    ctx.time = t; ctx.dt = dt;
    for (const m of mods) {
      if (!m._ready || !m.update) continue;
      try { m.update(t, dt, ctx); } catch (e) {
        m._errCount = (m._errCount || 0) + 1;
        if (m._errCount < 4) TT.error('update ' + m.name, e);
      }
    }
    for (const p of proxies) p.update(t, dt, ctx);
    if (!TT.director || !TT.director._ready) defaultCamera(t);
    if (camOverride) {
      camera.position.set(camOverride[0], camOverride[1], camOverride[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(camOverride[3], camOverride[4], camOverride[5]);
      if (camOverride[6]) { camera.fov = camOverride[6]; camera.updateProjectionMatrix(); }
      camera.userData.focus = camera.position.distanceTo(new THREE.Vector3(camOverride[3], camOverride[4], camOverride[5]));
    }
  }

  // Default camera when there is no director: a slow three-quarter view of the ship.
  function defaultCamera(t) {
    const S = TT.S;
    if (S.env.underwater) {
      const tgt = S.ship.bowVisible ? S.ship.bow.pivotWorld : S.ship.stern.pivotWorld;
      camera.position.set(tgt.x + 120, tgt.y + 30, tgt.z + 160);
      camera.lookAt(tgt);
    } else {
      const a = 0.9 + t * 0.004;
      camera.position.set(Math.cos(a) * 380, 55, Math.sin(a) * 380);
      camera.lookAt(0, 12, 0);
    }
  }

  // Warm-up for stills: simulate a few seconds before t so stateful effects settle
  if (P.freeze === '1' && P.warm) {
    const w = Math.max(0, parseFloat(P.warm) || 0), step = 1 / 30;
    for (let tt = Math.max(0, startT - w); tt < startT; tt += step) updateAll(tt, step);
  }

  // ---------- rehearsal: compile every shader and upload every texture before Begin ----------
  // Shaders compile lazily the first time an object is drawn; on D3D/ANGLE that froze the film for
  // seconds at the title and at new scenes. Visit one moment of every shot (plus transient effects)
  // with the canvas hidden, compiling and rendering each, while the start screen shows progress.
  if (P.freeze !== '1' && P.nowarm !== '1') {
    const EV = TT.story.EV, times = [];
    const shots = (TT.director && TT.director._ready && TT.director.shots) || [];
    for (const sh of shots) times.push(Math.min(sh.t1 - 0.05, sh.t0 + Math.min(1.5, (sh.t1 - sh.t0) / 2)));
    if (!shots.length) for (let tt = 4; tt < C.DURATION; tt += 10) times.push(tt);
    times.push(...EV.rockets.map((r) => r + 2.6), EV.impact + 2, EV.funnel1Splash + 0.5, EV.breakApart, EV.sternSplash + 0.4,
      EV.sternGone + 1.5, EV.seabedImpact + 1, EV.rov + 1, EV.dawn + 2, 290);
    times.sort((a, b) => a - b);
    const cv = renderer.domElement, prevVis = cv.style.visibility;
    cv.style.visibility = 'hidden';
    const hasAsync = typeof renderer.compileAsync === 'function';
    const t0w = performance.now();
    for (let i = 0; i < times.length; i++) {
      try {
        updateAll(times[i], 1 / 30);
        TT.S.grade.fade = 0; camera.userData.fade = 0;
        if (hasAsync) await renderer.compileAsync(scene, camera);
        if (TT.fx && TT.fx._ready && TT.fx.render && P.nofx !== '1') TT.fx.render(ctx, 1 / 30);
        else renderer.render(scene, camera);
      } catch (e) { TT.error('rehearsal t=' + times[i], e); }
      TT.emit('progress', { f: 0.72 + 0.28 * (i + 1) / times.length, label: 'Rehearsing the night', abs: true });
      await new Promise((r) => setTimeout(r, 0));
    }
    cv.style.visibility = prevVis;
    TT.log('rehearsal ' + times.length + ' moments in ' + (performance.now() - t0w).toFixed(0) + 'ms');
  }
  TT.clock.seek(startT);
  updateAll(startT, 0);
  TT.emit('ready', ctx);

  // ---------- loop ----------
  let lastPerf = performance.now();
  let ended = false;
  let frames = 0;
  function frame() {
    const nowPerf = performance.now();
    const dt = Math.min(0.1, (nowPerf - lastPerf) / 1000);
    lastPerf = nowPerf;
    let t = TT.clock.now();
    const dur = C.DURATION;
    if (t >= dur && !ended && TT.clock.playing && TT.clock.frozen == null) { ended = true; TT.emit('end', t); }
    if (t < dur) ended = false;
    t = Math.min(t, dur);
    ctx.realTime += dt;
    updateAll(t, dt);
    try {
      if (TT.fx && TT.fx._ready && TT.fx.render && P.nofx !== '1') TT.fx.render(ctx, dt);
      else renderer.render(scene, camera);
    } catch (e) {
      TT._renderErr = (TT._renderErr || 0) + 1;
      if (TT._renderErr < 4) TT.error('render', e);
      if (TT._renderErr === 3) { try { renderer.render(scene, camera); } catch (e2) { /* ignore */ } }
    }
    adapt(dt);
    frames++;
    if (P.freeze === '1' && frames === 4) {
      const info = renderer.info.render;
      console.log('TT_FRAME_READY t=' + t.toFixed(2) + ' shot=' + camera.userData.shot + ' calls=' + info.calls + ' tris=' + info.triangles + ' errors=' + TT.errors.length);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- visible error panel in debug mode ----------
  if (TT.debug) {
    const panel = document.createElement('pre');
    panel.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:60vw;max-height:40vh;overflow:auto;margin:0;padding:8px;background:rgba(40,0,0,.85);color:#fdd;font:11px/1.35 monospace;z-index:99999;white-space:pre-wrap';
    panel.hidden = true;
    document.body.appendChild(panel);
    setInterval(() => {
      if (!TT.errors.length) return;
      panel.hidden = false;
      panel.textContent = TT.errors.slice(-8).map((e) => e.where + ': ' + e.message).join('\n\n');
    }, 1000);
  }
  window.addEventListener('error', (e) => TT.error('window', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => TT.error('promise', e.reason));

  // ================================================================
  // Proxies
  // ================================================================
  function makeProxyShip(scene) {
    const SH = C.SHIP;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7 });
    const buffMat = new THREE.MeshStandardMaterial({ color: 0xc58a3e, roughness: 0.6 });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    function section(x0, x1) {
      const g = new THREE.Group();
      // hull as a lofted box approximation using TT.hull
      const n = 40, geo = new THREE.BufferGeometry(), pos = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const x = U.lerp(x0, x1, i / n);
        const top = TT.hull.sheer(x);
        const hb = Math.max(0.3, TT.hull.halfBeam(x, 2));
        const hk = Math.max(0.3, TT.hull.halfBeam(x, -8));
        pos.push(x, top, -hb, x, SH.KEEL_Y + 1, -hk, x, SH.KEEL_Y + 1, hk, x, top, hb);
      }
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        const a = i * 4 + k, b = a + 1, c = a + 4, d = a + 5;
        idx.push(a, c, b, b, c, d);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const hull = new THREE.Mesh(geo, hullMat); hull.material.side = THREE.DoubleSide;
      g.add(hull);
      const sx0 = Math.max(x0, SH.SUPERSTRUCTURE_X[0]), sx1 = Math.min(x1, SH.SUPERSTRUCTURE_X[1]);
      if (sx1 > sx0) {
        const sup = new THREE.Mesh(new THREE.BoxGeometry(sx1 - sx0, SH.BOAT_DECK_Y - SH.HULL_TOP_Y, 26), whiteMat);
        sup.position.set((sx0 + sx1) / 2, (SH.BOAT_DECK_Y + SH.HULL_TOP_Y) / 2, 0);
        g.add(sup);
        for (let r = 0; r < 3; r++) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(sx1 - sx0 - 2, 0.35, 28.3), winMat);
          w.position.set((sx0 + sx1) / 2, 6 + r * 3.2, 0);
          g.add(w);
        }
      }
      SH.FUNNEL_X.forEach((fx) => {
        if (fx < x0 || fx > x1) return;
        const f = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, SH.FUNNEL_TOP_Y - SH.FUNNEL_BASE_Y, 20), buffMat);
        f.scale.set(SH.FUNNEL_RX, 1, SH.FUNNEL_RZ);
        f.position.set(fx, (SH.FUNNEL_TOP_Y + SH.FUNNEL_BASE_Y) / 2, 0);
        f.rotation.z = SH.FUNNEL_RAKE;
        g.add(f);
      });
      return g;
    }
    const bow = section(SH.BREAK_X, SH.STEM_X), stern = section(SH.STERN_X, SH.BREAK_X);
    bow.name = 'proxy bow'; stern.name = 'proxy stern';
    scene.add(bow, stern);
    return {
      update() {
        const S = TT.S.ship;
        TT.pose.apply(bow, S.bow); TT.pose.apply(stern, S.stern);
        bow.visible = S.visible && S.bowVisible; stern.visible = S.visible && S.sternVisible;
        winMat.color.setRGB(1 * S.lights, 0.75 * S.lights, 0.44 * S.lights);
      },
    };
  }
  function makeProxyBerg(scene) {
    const g = new THREE.IcosahedronGeometry(28, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.25 * Math.sin(x * 0.2) * Math.cos(z * 0.17) + 0.15 * Math.sin(y * 0.3);
      p.setXYZ(i, x * n * 1.1, y * n * (y > 0 ? 1.0 : 2.2), z * n * 0.9);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.8 }));
    m.name = 'proxy iceberg';
    scene.add(m);
    return { update() { const I = TT.S.iceberg; m.visible = I.visible > 0; m.position.copy(I.pos); m.rotation.y = I.yaw; } };
  }
})();
