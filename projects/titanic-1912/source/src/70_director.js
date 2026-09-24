import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/70_director.js ====
// =====================================================================
// 70_director.js — cinematography and editing. Owns ctx.camera for the whole film.
// Owner: director agent.
//
// The film is a list of shots, each a pure function of story time t (reads TT.S only).
// A shot fills a "rig" (position, look-at target, roll, lens, focus, aperture, fade);
// the director then adds handheld drift and shake (procedural noise of t), keeps the
// camera out of the water / hull / berg, and converts the lens to a camera fov that
// frames the 2.39:1 letterbox band identically on any window aspect.
//
// Lens convention: rig.lens = vertical field of view (deg) of the 2.39:1 band.
// World/ship conventions: see CONTRACT.md (ship-local +X bow, +Z starboard).
//
// Film grammar: majestic and elegiac; long takes; low angles near the mirror-calm water;
// the starboard (north) side is "our" side for most of the night (she steams left to
// right, the berg strikes on our side); handheld only in the chaos; the Milky Way (high in
// the east, its core low in the south-south-east) and the aurora (north) are framed
// deliberately. Fades: dips to black at 92, 156.7, 222 and inside the deep (247); the
// story's own fades cover the opening, 240, 262 and the end.
// Two cameras ride with lifeboats (TT.props.boatWorld, evaluated after props each frame):
// the long hold on the vertical stern (behind No. 13) and No. 14 going back (235-240).
// The wireless form (upper left, 95.5-125 / 139-157 s) and the depth gauge (right edge,
// 246.5-260.5 s) are kept clear of the key action.
//
// API: TT.director.shots [{name, t0, t1}], shotAt(t), boatPos(i, out).
// Camera hints written every frame: userData.fade, focus, aperture, shot, letterbox (null),
// cut (true on the first frame of a new shot).
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = C.SHIP, DEG = U.DEG;
  const ST = TT.story, EV = ST.EV, TR = ST.TR;
  const BAND = 2.39;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const clamp = U.clamp, lerp = U.lerp, sstep = U.smoothstep, ease = U.easeInOutSine;
  const H_FINAL = TR.heading(130); // settled heading after the collision (~22 deg)

  // -------------------------------------------------------------------
  // scratch (no allocation per frame)
  // -------------------------------------------------------------------
  const _l = V3(), _a = V3(), _b = V3(), _c = V3(), _d = V3();
  const _tv = new THREE.Vector2();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qe = new THREE.Euler();
  const UP = V3(0, 1, 0);
  const _poseTmp = TT.pose.create();

  // current frame state (set in update)
  let S = TT.S;

  // -------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------
  // Level, yaw-only ship frame about the midship origin (external cameras on the water).
  function yawW(x, y, z, h, out) {
    const c = Math.cos(h), s = Math.sin(h);
    return out.set(x * c + z * s, y, -x * s + z * c);
  }
  // Ship-local point through a pose (cameras riding the ship; subjects on the ship).
  function poseW(pose, x, y, z, out) { return TT.pose.toWorld(pose, _l.set(x, y, z), out); }
  const shipW = (x, y, z, out) => poseW(S.ship.intact, x, y, z, out);
  const bowW = (x, y, z, out) => poseW(S.ship.bow, x, y, z, out);
  const sternW = (x, y, z, out) => poseW(S.ship.stern, x, y, z, out);
  // A point fixed in the water: defined in the level ship frame at time t0 (heading and
  // travel at t0), rendered at the current time (the sea scrolls by -travel).
  function pinW(x, y, z, t0, out) {
    yawW(x, y, z, TR.heading(t0), out);
    ST.travelAt(t0, _tv);
    out.x += _tv.x - S.ship.travel.x;
    out.z += _tv.y - S.ship.travel.y;
    return out;
  }
  function anchor(name, fallbackLocal, section, out) {
    const sh = TT.ship;
    if (sh && sh._ready && sh.anchor) {
      try { const r = sh.anchor(name, out); if (r && isFinite(r.x)) return out; } catch (e) { /* fall back */ }
    }
    const pose = section === 'stern' ? S.ship.stern : section === 'intact' ? S.ship.intact : S.ship.bow;
    return poseW(pose, fallbackLocal.x, fallbackLocal.y, fallbackLocal.z, out);
  }

  // Lifeboat world position (props when present, else a matching estimate).
  function boatPos(i, out) {
    const P = TT.props;
    if (P && P._ready && P.boatWorld) {
      try { const r = P.boatWorld(i, out); if (r && isFinite(r.x)) return out; } catch (e) { /* fall back */ }
    }
    const b = ST.BOATS[i], slot = SH.BOAT_SLOTS[b.slot];
    const t = S.t;
    const tl = Math.min(t, b.lowerT1);
    ST.intactPose(Math.min(tl, EV.breakStart), _poseTmp);
    const side = slot.side;
    const k = clamp((t - b.lowerT0) / (b.lowerT1 - b.lowerT0));
    TT.pose.toWorld(_poseTmp, _l.set(slot.local.x, slot.local.y, slot.local.z + side * 2.4 * sstep(0, 0.12, k)), out);
    out.y = lerp(out.y, 0.3, U.easeInOutSine(sstep(0.1, 1, k)));
    if (t > b.lowerT1) {
      const d = ST.boatRowDistance(b, t);
      const h = TR.heading(b.lowerT1) + (side > 0 ? 0 : Math.PI) + b.dir * side;
      out.x += Math.sin(h) * d * 1.0;
      out.z += Math.cos(h) * d * 1.0;
      out.y = 0.3;
    }
    return out;
  }
  // Where distress rocket r bursts (world). fx's own value when it offers one; otherwise the same
  // geometry fx uses: from the starboard bridge-wing launcher, ~220 m up, leaning ~12 deg outboard.
  const _rkPose = TT.pose.create();
  function rocketBurst(r, out) {
    const F = TT.fx;
    if (F && F._ready && F.rocketBurst) {
      try { const v = F.rocketBurst(r, out); if (v && isFinite(v.x)) return out; } catch (e) { /* fall back */ }
    }
    ST.intactPose(EV.rockets[r], _rkPose);
    return TT.pose.toWorld(_rkPose, _l.set(SH.ROCKET_LAUNCHER.x + 13, SH.ROCKET_LAUNCHER.y + 212, SH.ROCKET_LAUNCHER.z + 44), out);
  }
  function seaY(x, z) {
    const O = TT.ocean;
    if (O && O._ready && O.heightAt && !S.env.underwater) {
      try { const h = O.heightAt(x, z, S.t); if (isFinite(h)) return h; } catch (e) { /* ignore */ }
    }
    return 0;
  }

  // Smooth multi-key vector path: keys [[t, [x,y,z]], ...] -> f(t, out)
  function vpath(keys) {
    const cx = U.curve(keys.map((k) => [k[0], k[1][0]]));
    const cy = U.curve(keys.map((k) => [k[0], k[1][1]]));
    const cz = U.curve(keys.map((k) => [k[0], k[1][2]]));
    return (t, out) => out.set(cx(t), cy(t), cz(t));
  }
  // Aim the rig so that world point `subj` lands at (fx, fy) in the 2.39:1 band
  // (-1..1, x right, y up) for the rig's current lens. Rule of thirds: fx = +-1/3.
  function placeAt(R, subj, fx, fy) {
    const d = _d.copy(subj).sub(R.pos);
    const yaw = Math.atan2(d.x, d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const tv = Math.tan(R.lens * DEG / 2);
    const cy = yaw + Math.atan(fx * tv * BAND), cp = pitch - Math.atan(fy * tv);
    R.tgt.set(Math.sin(cy) * Math.cos(cp), Math.sin(cp), Math.cos(cy) * Math.cos(cp)).multiplyScalar(100).add(R.pos);
    return R;
  }
  // focus pull between two distances, even in dioptres (how a focus puller's hand moves)
  const rack = (a, b, k) => 1 / lerp(1 / a, 1 / b, clamp(k));
  // gentle procedural noise in [-1, 1] (pure function of time)
  const nz = (t, f, seed) => 0.62 * U.noise1(t * f, seed) + 0.38 * U.noise1(t * f * 2.17 + 13.7, seed + 31);

  // -------------------------------------------------------------------
  // Shot list
  // -------------------------------------------------------------------
  const SHOTS = [];
  // opts: shake (multiplier of S.fx.shake), hand (handheld drift 0..1), fadeIn/fadeOut (s), under (underwater)
  function shot(name, t0, t1, fn, opts) { SHOTS.push(Object.assign({ name, t0, t1, fn, shake: 1, hand: 0, fadeIn: 0, fadeOut: 0, under: false }, opts || {})); }

  // ================= INTRO 0–18: the stars, then the sea, then her lights =================
  shot('intro_stars', 0, 18, (s, R) => {
    // fixed in the water ~2.4 km north of her track; she steams left to right
    pinW(110, 3.0, lerp(2350, 2250, s.u), 0, R.pos);
    const tilt = ease(clamp(s.d / 13.5));
    const el = lerp(34, 3.4, tilt) - 0.3 * sstep(13.5, 18, s.d);   // elevation of the gaze (deg)
    const az = lerp(-34, -2.0, U.easeInOutCubic(clamp(s.d / 14))) * DEG; // bearing: 0 = due south, - = east (the galactic core)
    const ce = Math.cos(el * DEG);
    R.tgt.set(R.pos.x + Math.sin(az) * ce * 1000, R.pos.y + Math.sin(el * DEG) * 1000, R.pos.z - Math.cos(az) * ce * 1000);
    R.lens = lerp(30, 24, tilt);
    R.focus = 2400; R.aperture = 0;
    R.near = 1.0;
  });

  // ================= VOYAGE 18–56 =================
  const voyAerialP = vpath([[0, [470, 128, 440]], [4.5, [318, 64, 288]], [9, [205, 19, 150]]]);
  const voyAerialT = vpath([[0, [20, 0, 0]], [9, [10, 13, 0]]]);
  shot('voyage_aerial', 18, 27, (s, R) => {
    const u = s.d;
    voyAerialP(u, _a); yawW(_a.x, _a.y, _a.z, S.ship.heading, R.pos);
    voyAerialT(u, _b); yawW(_b.x, _b.y, _b.z, S.ship.heading, R.tgt);
    R.lens = lerp(26, 22, ease(s.u));
    R.roll = lerp(-3.5, 0, ease(s.u)) * DEG; // banking in
    R.near = 1.0;
  }, { hand: 0.15 });

  shot('voyage_hull', 27, 35.5, (s, R) => {
    const x = lerp(-55, 20, ease(s.u));
    yawW(x, 2.3, 27, S.ship.heading, R.pos);
    yawW(x + 95, 9.5, 11, S.ship.heading, R.tgt);
    R.lens = 22; R.roll = -1.2 * DEG;
    R.aperture = 0.15;
  }, { hand: 0.12 });

  shot('voyage_crane', 35.5, 43.5, (s, R) => {
    const u = ease(s.u);
    // forward of the funnels (clear of the smoke, which streams aft), rising and looking aft into the Milky Way
    yawW(lerp(44, 36, u), lerp(20, 51, u), lerp(40, 54, u), S.ship.heading, R.pos);
    yawW(lerp(12, -40, u), lerp(28, 36, u), lerp(0, -10, u), S.ship.heading, R.tgt);
    R.lens = 27;
  }, { hand: 0.1 });

  shot('voyage_passby', 43.5, 51, (s, R) => {
    pinW(205, 5.0, 92, 43.5, R.pos); // locked off in the water; she steams past
    // pan with the bow
    shipW(lerp(118, 55, ease(s.u)), 14, 0, R.tgt);
    R.lens = 23;
  });

  shot('voyage_bow', 51, 56, (s, R) => {
    const u = ease(s.u);
    yawW(lerp(182, 170, s.u), 3.2, lerp(16, 12, s.u), S.ship.heading, R.pos);
    // tilt from the stem up to the crow's nest
    _a.set(134, 5, 0).lerp(_b.set(90, 28, 0), sstep(0.3, 1, s.u));
    shipW(_a.x, _a.y, _a.z, R.tgt);
    R.lens = lerp(24, 26, u);
  }, { hand: 0.2 });

  // ================= LOOKOUT 56–72 =================
  const NEST = SH.CROWS_NEST;
  function nestPOV(s, R, lens) {
    const sway = nz(s.t, 0.22, 3) * 0.35;
    shipW(NEST.x + 0.9, NEST.y + 1.75, 0.55, R.pos);
    shipW(NEST.x + 320, NEST.y - 25 + sway * 4, 1.5 + sway * 6, R.tgt);
    R.lens = lens; R.near = 0.1;
    R.roll = nz(s.t, 0.18, 7) * 0.5 * DEG;
  }
  shot('lookout_nest', 56, 61.6, (s, R) => {
    nestPOV(s, R, 28);
    // rack focus from her forecastle below to the shape ahead
    R.focus = rack(42, 520, sstep(58.2, 60.4, s.t));
    R.aperture = 0.3;
  }, { hand: 0.35 });

  shot('lookout_bells', 61.6, 63.8, (s, R) => {
    // low angle from the forecastle deck up the foremast to the nest, stars beyond
    shipW(lerp(106, 104, s.u), 18.6, -6.5, R.pos);
    shipW(NEST.x, NEST.y + 2, 0, R.tgt);
    R.lens = 24; R.near = 0.2;
  }, { hand: 0.3 });

  shot('lookout_ahead', 63.8, 66.5, (s, R) => {
    // "Iceberg, right ahead!" — from beyond the berg, low: her lights coming straight at it
    const I = S.iceberg.pos;
    yawW(135, 8.0, lerp(-50, -48, s.u), S.ship.heading, _a);
    R.pos.copy(I).add(_a);
    R.lens = 21; R.near = 1.0;
    shipW(110, 14, 0, _b);
    placeAt(R, _b, 0.26, -0.1);
    R.focus = R.pos.distanceTo(_b); R.aperture = 0.1;
  }, { hand: 0.2 });

  shot('lookout_bridge', 66.5, 72, (s, R) => {
    // at the bridge front, starboard side: the berg looms and slides to starboard as she swings to port
    shipW(66.35, lerp(21.9, 22.1, s.u), lerp(9.6, 10.2, s.u), R.pos);
    const I = S.iceberg.pos;
    R.lens = lerp(27, 31, ease(s.u));
    _b.set(I.x, 12, I.z);
    // the berg on the right third; her forecastle and foremast fill the left
    placeAt(R, _b, lerp(0.22, 0.42, ease(s.u)), lerp(0.05, 0.12, s.u));
    R.near = 0.2; R.focus = R.pos.distanceTo(_b); R.aperture = 0.15;
  }, { hand: 0.4 });

  // ================= COLLISION 72–92 =================
  shot('collision_impact', 72, 74.8, (s, R) => {
    // high, fixed in the water dead ahead: the bow swings away but the berg slides in on her starboard side
    pinW(255, 58, -10, 72, R.pos);
    shipW(112, 4, 12, R.tgt);
    R.lens = 22;
  }, { shake: 0.4 });

  // the berg's heading frame at impact (it is fixed in the water until the drift begins)
  const H_IMPACT = TR.heading(EV.impact);
  shot('collision_gap', 74.8, 79.5, (s, R) => {
    // low in the water just aft of the berg, looking forward into the grinding gap
    const I = S.iceberg.pos;
    yawW(-46, 2.6, -15, H_IMPACT, _a);
    R.pos.copy(I).add(_a);
    yawW(20, 7, -24, H_IMPACT, _b);
    R.tgt.copy(I).add(_b);
    R.lens = 24; R.roll = -1.5 * DEG;
    // the berg's flank grinds along the plating: focus pulls from her nearest portholes to the contact
    R.focus = rack(17, 45, sstep(75.5, 77.3, s.t)); R.aperture = 0.12;
  }, { shake: 1.0, hand: 0.35 });

  shot('collision_icefall', 79.5, 82.8, (s, R) => {
    // from the forecastle, looking aft over the well deck; the berg slides away along her side
    shipW(106, 20.4, -7, R.pos);
    shipW(lerp(58, 50, s.u), 21, 16, R.tgt);
    R.lens = 27; R.near = 0.2;
  }, { shake: 0.9, hand: 0.45 });

  shot('collision_high', 82.8, 87, (s, R) => {
    // high wide, fixed in the water off the starboard bow; she slides past the berg
    pinW(150, lerp(105, 96, s.u), 175, 82.8, R.pos);
    const I = S.iceberg.pos;
    _a.set(I.x, 0, I.z);
    shipW(10, 5, 0, _b);
    R.tgt.copy(_a).lerp(_b, 0.55);
    R.lens = 26;
  }, { shake: 0.3 });

  shot('collision_astern', 87, 92, (s, R) => {
    // low, near the berg: the lit ship slows and moves on past it
    const I = S.iceberg.pos;
    R.pos.set(I.x + lerp(-95, -88, s.u), 4.5, I.z + 55);
    shipW(-10, 10, 0, _a);
    _b.set(I.x, 10, I.z);
    R.tgt.copy(_a).lerp(_b, 0.35);
    R.lens = 24;
  }, { shake: 0.2, fadeOut: 0.8 });

  // ================= STILLNESS 92–118 =================
  shot('still_wide', 92, 100.5, (s, R) => {
    // "Midnight": wide and still from the north, the berg drifting off to the left; steam begins at 95
    yawW(lerp(10, 0, s.u), 6.5, lerp(440, 405, ease(s.u)), H_FINAL, R.pos);
    yawW(-15, 14, 0, H_FINAL, R.tgt);
    R.lens = 17;
  }, { fadeIn: 1.2 });

  shot('still_steam', 100.5, 107.5, (s, R) => {
    // off the starboard side at boat-deck height, looking up at the roaring steam pipes
    yawW(lerp(58, 52, ease(s.u)), lerp(27, 30, s.u), 30, H_FINAL, R.pos);
    shipW(23, 47, 0, R.tgt); // (the plumes kept clear of the wireless form, upper left)
    R.lens = 25;
  }, { hand: 0.2 });

  shot('still_reflection', 107.5, 118, (s, R) => {
    // far and low on the port side: the whole ship and her reflection; slow push in
    yawW(30, 1.7, lerp(-820, -730, ease(s.u)), H_FINAL, R.pos);
    yawW(0, 9, 0, H_FINAL, R.tgt);
    R.lens = 10.5; R.near = 2;
  });

  // ================= EVACUATION 118–156 =================
  shot('evac_lowering', 118, 125, (s, R) => {
    // off the starboard side, craning down from the boat deck: No. 7 goes down past the lit windows
    yawW(lerp(26, 29, s.u), lerp(15, 7, ease(s.u)), 36, H_FINAL, R.pos);
    boatPos(0, _a);
    shipW(41, 24, 10, _b);
    R.tgt.copy(_b).lerp(_a, 0.55);
    R.lens = 26;
  }, { hand: 0.25 });

  shot('evac_low_up', 125, 131, (s, R) => {
    // low on the water well aft, looking forward along her lit side: the boats going down the falls
    // and No. 7 already on the water; at the far end, rocket 2 goes up from the bridge wing at 130
    yawW(lerp(-24, -17, s.u), 2.0, 34, H_FINAL, R.pos);
    R.lens = 24; R.roll = -1.5 * DEG;
    shipW(52, 18, 13, _a);
    placeAt(R, _a, 0.1, 0.1);
  }, { hand: 0.3 });

  shot('evac_rocket', 131, 137.5, (s, R) => {
    // wide from off her port bow, looking north: rocket 2 bursts high over her (~220 m up, over the
    // starboard side) and, clear of her bow on the northern horizon, the lights of the Californian.
    // (She lies almost exactly abeam to starboard, so from the port beam she hides behind the funnels.)
    R.pos.set(lerp(84, 74, ease(s.u)), lerp(21, 24, s.u), lerp(-332, -326, s.u));
    R.lens = 44; R.near = 1.5;
    _a.copy(S.world.californianPos).setY(14);
    placeAt(R, _a, -0.5, -0.56);
  }, { hand: 0.15 });

  shot('evac_lifeboat', 137.5, 145, (s, R) => {
    // from a boat pulling away: the lit ship towers over the boats already in the water
    // (tilted up enough that the funnel tops sit below the wireless form, upper left)
    yawW(lerp(12, 16, s.u), 1.8 + nz(s.t, 0.3, 11) * 0.12, lerp(66, 78, s.u), H_FINAL, R.pos);
    yawW(19, 32, 0, H_FINAL, R.tgt);
    R.lens = 28; R.roll = nz(s.t, 0.25, 12) * 1.6 * DEG;
    R.focus = 60; R.aperture = 0.2;
  }, { hand: 0.6 });

  shot('evac_berg', 145, 151, (s, R) => {
    // wide: the berg on her starboard quarter, lit by rocket 4 (burst ~149)
    const I = S.iceberg.pos;
    R.pos.set(I.x + lerp(-40, -30, s.u), 8, I.z + 165);
    R.lens = 30; R.near = 1.5;
    shipW(-10, 10, 0, _a);
    placeAt(R, _a, 0.22, -0.6); // her low right, the berg left, the sky open for rocket 4
  });

  shot('evac_boats', 151, 156.7, (s, R) => {
    // high over her starboard quarter: her lit length on the diagonal, and off her bow the boats
    // pulling away, so few, so small on the black water; rocket 5 lights them
    yawW(lerp(-120, -112, s.u), lerp(95, 88, s.u), lerp(150, 142, s.u), H_FINAL, R.pos);
    R.lens = 30; R.near = 1.5;
    yawW(lerp(-8, 0, s.u), 4, 28, H_FINAL, _a);
    placeAt(R, _a, 0.08, -0.1);
  }, { hand: 0.1, fadeOut: 0.6 });

  // ================= FINAL 156–190 =================
  shot('final_bow_under', 156.7, 163, (s, R) => {
    // ahead and to port of the bow: the sea climbs the forecastle
    yawW(lerp(190, 180, s.u), 3.0, lerp(-66, -60, s.u), H_FINAL, R.pos);
    R.lens = 24;
    shipW(100, 6, 0, _a);
    placeAt(R, _a, -0.12, -0.42); // the drowning forecastle low, her lit decks and funnels whole above
  }, { fadeIn: 0.9 });

  shot('final_band', 163, 171, (s, R) => {
    // just outboard of the starboard boat deck, near the first-class entrance (the dome glowing): the
    // band plays here, unseen among them; the people crowd the rail as the bow goes down and the sea,
    // lit green by her portholes, climbs toward the bridge
    shipW(lerp(10, 15, ease(s.u)), 22.6, 20, R.pos);
    shipW(lerp(36, 38, s.u), 20.6, 8.5, R.tgt);
    R.lens = 27; R.near = 0.15;
  }, { hand: 0.35 });

  shot('final_stern_lift', 171, 179, (s, R) => {
    // low off the starboard quarter: the stern lifts, the screws break the surface
    yawW(lerp(-205, -195, s.u), 2.1, lerp(52, 46, s.u), H_FINAL, R.pos);
    shipW(-118, 6, 0, R.tgt);
    R.lens = 22;
  }, { hand: 0.2 });

  shot('final_funnel', 179, 185, (s, R) => {
    // funnel 1 falls forward to starboard, toward us
    yawW(lerp(84, 80, s.u), 4.0, 118, H_FINAL, R.pos);
    anchor('funnel1Top', _a.set(SH.FUNNEL_X[0], SH.FUNNEL_TOP_Y, 0), 'bow', _b);
    _b.y = Math.max(_b.y, 2);
    shipW(36, 20, 4, _c);
    R.tgt.copy(_c).lerp(_b, 0.25);
    R.lens = 26;
  }, { shake: 0.5, hand: 0.25 });

  shot('final_wide', 185, 190, (s, R) => {
    // wide from the boats' distance: bow down, lights still burning (they begin to fail at 188)
    yawW(lerp(-40, -48, s.u), 3.0, 430, H_FINAL, R.pos);
    yawW(-20, 10, 0, H_FINAL, R.tgt);
    R.lens = 18; R.near = 1.5;
  }, { hand: 0.2 });

  // ================= BREAK 190–222 =================
  shot('break_lights', 190, 193.2, (s, R) => {
    // close along the starboard side as the lights stutter
    shipW(lerp(-62, -54, s.u), 17, 31, R.pos);
    shipW(18, 19.5, 14, R.tgt);
    R.lens = 23;
  }, { hand: 0.3 });

  shot('break_wide', 193.2, 201, (s, R) => {
    // one long wide take: the lights go out, then she tears open between funnels 3 and 4
    yawW(-15, 3.2, lerp(430, 420, s.u), H_FINAL, R.pos);
    yawW(-15, 10, 0, H_FINAL, R.tgt);
    R.lens = 14.5; R.near = 1.5;
  }, { shake: 0.35, hand: 0.2 });

  shot('break_slam', 201, 205, (s, R) => {
    // closer on the stern section as it slams back onto the sea (203.2)
    yawW(lerp(-165, -160, s.u), 3.0, 205, H_FINAL, R.pos);
    sternW(-80, 6, 0, R.tgt);
    R.lens = 22;
  }, { shake: 0.6, hand: 0.3 });

  // The stern section stands against the Milky Way, which arcs from high in the east down to its
  // bright core low in the south-south-east: these cameras sit north of her and look south.
  const STERN_W = V3(-75, 0, 30); // where the stern section stands (world)
  // camera `dist` metres from the stern, looking along compass bearing `b` (deg, 0 = N, 90 = E)
  function sternBearing(b, dist, y, out) {
    const r = b * DEG;
    return out.set(STERN_W.x - dist * -Math.sin(r), y, STERN_W.z - dist * Math.cos(r));
  }
  shot('break_rise', 205, 210.5, (s, R) => {
    // from a lifeboat ~250 m off: she swings up, black against the galactic core
    sternBearing(lerp(158, 162, s.u), lerp(250, 238, s.u), 2.2 + nz(s.t, 0.3, 21) * 0.15, R.pos);
    R.lens = 25; R.near = 1.5;
    sternW(-85, 20, 0, _a);
    _a.y = lerp(10, 22, ease(s.u));
    placeAt(R, _a, 0.3, -0.36); // her on the right third, low; the core of the Milky Way on the left
    R.roll = nz(s.t, 0.2, 22) * 1.0 * DEG;
  }, { shake: 0.25, hand: 0.45 });

  shot('break_vertical', 210.5, 218, (s, R) => {
    // the long hold: low on the water ~190 m off her starboard side, from behind lifeboat No. 13
    // pulling away; she swings up and stands straight, a black profile (counter, rudder, screws)
    // against the Milky Way, which arches over her from its core low in the south-south-east;
    // other boats' lanterns lie scattered along the horizon. She begins to slide at 216.5.
    boatPos(10, _a);
    _b.set(_a.x - STERN_W.x, 0, _a.z - STERN_W.z).normalize();           // from the stern out to the boat
    R.pos.copy(_a).addScaledVector(_b, lerp(38, 31, ease(s.u))).addScaledVector(_c.set(-_b.z, 0, _b.x), 7.5);
    R.pos.y = 1.75 + nz(s.t, 0.35, 23) * 0.12;
    R.lens = 32; R.near = 1.0;
    _d.set(STERN_W.x, 20, STERN_W.z);
    placeAt(R, _d, -0.13, -0.12);
    R.focus = R.pos.distanceTo(_d); R.aperture = 0.04;
    R.roll = nz(s.t, 0.2, 24) * 0.8 * DEG;
  }, { shake: 0.3, hand: 0.3 });

  shot('break_plunge', 218, 222, (s, R) => {
    // in close and low, from the north-north-west: she slides straight down in front of the galactic core,
    // into her own reflection; the counter, the rudder and the screws go last (under by 221.5)
    sternBearing(lerp(152, 156, s.u), lerp(96, 88, s.u), 1.6 + nz(s.t, 0.33, 25) * 0.1, R.pos);
    R.lens = 31; R.near = 1.0;
    _a.set(STERN_W.x, lerp(25, 4, ease(clamp((s.t - 218) / 3.6))), STERN_W.z - 4);
    placeAt(R, _a, 0.04, 0.02);
    R.focus = R.pos.distanceTo(_a); R.aperture = 0.05;
    R.roll = nz(s.t, 0.2, 26) * 0.9 * DEG;
  }, { shake: 0.35, hand: 0.35, fadeOut: 0.9 });

  // ================= SILENCE 222–240 =================
  const SITE = V3(-70, 0, 20); // where she went down (the boats' reference point, TT.props)
  shot('silence_wide', 222, 229.5, (s, R) => {
    // low over the empty sea where she went down, looking north: the aurora, the boats' lanterns, mist
    R.pos.set(lerp(-40, -2, s.u), 3.0, -280);
    R.tgt.set(lerp(-40, -2, s.u) + 60, 62, 800);
    R.lens = 26; R.near = 1.0;
  }, { fadeIn: 1.8, hand: 0.15 });

  shot('silence_descend', 229.5, 235, (s, R) => {
    // "Titanic is gone": from the south, a slow crane down over the black water where she went down —
    // wreckage, the last bubbles, the mist — until the horizon and the aurora come down into the frame
    const u = ease(s.u);
    R.pos.set(lerp(-56, -64, u), lerp(14, 3.4, u), lerp(-70, -32, u));
    R.tgt.set(lerp(-72, -73, u), -2, lerp(40, 24, u));
    R.lens = 25;
  }, { hand: 0.1 });

  // the lifeboat that goes back (TT.story.BOATS index 11 = No. 14, lantern lit): she turns at 226-232
  // and pulls back toward the site through the mist (fade to the deep at 238.8)
  shot('silence_boat', 235, 240, (s, R) => {
    // "Of the twenty lifeboats, one goes back": low astern of No. 14 and off her starboard quarter
    // (clear of No. 16, which stays), riding with her; her lantern hangs at her stern; ahead of her
    // only the wreckage, the mist, the aurora and the stars
    boatPos(11, _a);
    _b.set(SITE.x - _a.x, 0, SITE.z - _a.z).normalize();                 // her course
    R.pos.copy(_a).addScaledVector(_b, -lerp(11.5, 10, s.u)).addScaledVector(_c.set(_b.z, 0, -_b.x), -3.4);
    R.pos.y = 1.9 + nz(s.t, 0.4, 27) * 0.1;
    R.lens = 30; R.near = 0.3;
    _d.copy(_a).setY(1.1);
    placeAt(R, _d, -0.3, -0.42);
    R.focus = R.pos.distanceTo(_d); R.aperture = 0.08;
    R.roll = nz(s.t, 0.3, 28) * 1.2 * DEG;
  }, { hand: 0.4 });

  // ================= DEEP 240–262 =================
  shot('deep_stern', 240, EV.abyss, (s, R) => {
    // under the surface, ~35 m off her starboard side: looking up at the sinking stern, screws and
    // rudder uppermost, black against the light from the surface (the shafts converge on Snell's
    // window above) and trailing her bubbles; she falls past us and the camera tilts down after her
    // as she recedes into the dark
    // (the camera sinks a little after her as she passes, which also eases the tilt)
    R.pos.set(-1.6 + 0.78 * 36, -72 - 8 * ease(s.u) - 16 * sstep(240.8, 243.6, s.t), 3.9 + 0.62 * 36);
    sternW(-128, -2, 0, _a);                                   // her screws and rudder
    R.lens = 36; R.near = 0.3;
    placeAt(R, _a, 0.12, lerp(-0.25, -0.05, sstep(240.5, 243, s.t)));
  }, { under: true, fadeOut: 0.6, hand: 0.2 });

  shot('deep_abyss', EV.abyss, 253.3, (s, R) => {
    // the abyss: held ~60 m beside her glide path, off her starboard side, looking up it — the bow
    // comes down at us out of the dark, stem first, a black knife-edged silhouette against the faint
    // light scattered through the water above, and planes past (marine snow drifts by)
    R.pos.set(97.5, lerp(-3750, -3762, ease(s.u)), 34);
    bowW(134, 12, 0, _a);                                       // her stem
    R.lens = 38; R.near = 0.5;
    placeAt(R, _a, 0.28, -0.15);
  }, { under: true, fadeIn: 0.7, hand: 0.25 });

  shot('deep_seabed', 253.3, 257.5, (s, R) => {
    // on the seabed ahead of her: she comes out of the dark and ploughs in
    const hd = 0.38;
    yawW(212, C.SEABED_Y + 6, 30, hd, R.pos);
    yawW(lerp(122, 140, s.u), C.SEABED_Y + lerp(44, 16, sstep(0, 0.6, s.u)), -4, hd, R.tgt);
    R.lens = 27; R.near = 0.5;
  }, { under: true, shake: 1.6 });

  shot('deep_rov', 257.5, 262, (s, R) => {
    // the camera sled's lamps find the bow railing: head-on, a little above and to port of her prow,
    // the rails converging on the stem, the silt she ploughed up banked either side
    bowW(lerp(150, 145, ease(s.u)), lerp(25.5, 24.5, s.u), lerp(-6.5, -5, s.u), R.pos);
    bowW(124, 17, 0, R.tgt);
    R.lens = 29; R.near = 0.2;
    bowW(134, 18, 0, _a);
    R.focus = R.pos.distanceTo(_a); R.aperture = 0.2;
  }, { under: true, hand: 0.4 });

  // ================= DAWN 262–292 =================
  shot('dawn_boat', 262, 271, (s, R) => {
    // No. 2 (the first boat Carpathia picked up) in the foreground; Carpathia on the horizon
    boatPos(15, _a);
    const cp = S.world.carpathiaPos;
    _b.copy(cp).sub(_a).setY(0).normalize();
    R.pos.copy(_a).addScaledVector(_b, -16).add(_c.set(-_b.z * 3.4, 2.6, _b.x * 3.4));
    R.tgt.copy(R.pos).addScaledVector(_b, 1000); R.tgt.y = R.pos.y - 1000 * Math.tan(2.0 * DEG);
    R.lens = 22; R.near = 0.5;
    R.focus = rack(16, 4000, sstep(0.3, 0.7, s.u)); R.aperture = 0.25;
  }, { hand: 0.5 });

  shot('dawn_carpathia', 271, 281, (s, R) => {
    // long lens, low, sliding sideways: Carpathia on the horizon, a tabular berg passing in front (parallax)
    const cp = S.world.carpathiaPos;
    _b.set(cp.x + 70, 0, cp.z - 20).normalize();          // from the wreck site toward Carpathia
    const off = lerp(95, 205, s.u);                          // sideways dolly
    R.pos.set(-70 - _b.x * 160 - _b.z * off, 3.2, 20 - _b.z * 160 + _b.x * off);
    R.lens = 6; R.near = 2;
    _d.set(cp.x, 11, cp.z);
    placeAt(R, _d, lerp(-0.02, -0.12, s.u), 0.1);
    R.focus = R.pos.distanceTo(_d); R.aperture = 0.05;
  }, { hand: 0.2 });

  // high and rising over the scattered boats, looking east into the dawn; then up into the sky (end card)
  function dawnHigh(t, R) {
    const u = clamp((t - 281) / 24);
    const e = ease(u);
    R.pos.set(lerp(760, 600, e), lerp(38, 300, e), lerp(330, 240, e));
    R.tgt.set(-1600, lerp(-175, 1400, sstep(0.3, 1, u)), -700);
    R.lens = lerp(22, 28, e); R.near = 1.5;
  }
  shot('dawn_high', 281, 292, (s, R) => dawnHigh(s.t, R));
  // ================= END 292–305 =================
  shot('end_sky', 292, 305, (s, R) => dawnHigh(s.t, R), { cont: true }); // the same move continues (no cut)

  // -------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------
  const rig = { pos: V3(), tgt: V3(), roll: 0, lens: 24, focus: null, aperture: 0, near: 0.5, fade: 0 };
  const sctx = { t: 0, d: 0, u: 0 };
  function shotIndexAt(t) {
    let lo = 0, hi = SHOTS.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (SHOTS[mid].t0 <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  // keep the camera out of the berg: an ellipse ~70 x 50 m aligned with her course at impact, plus margin
  const BERG_A = 43, BERG_B = 33, BERG_ROT = TR.heading(EV.impact) - 0.6;
  function bergAvoid(p) {
    const I = S.iceberg;
    if (!I.visible || p.y > 40) return;
    const rot = I.yaw + BERG_ROT, c = Math.cos(rot), sn = Math.sin(rot);
    const dx = p.x - I.pos.x, dz = p.z - I.pos.z;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;          // berg-canonical frame
    const e = Math.hypot(lx / BERG_A, lz / BERG_B);
    if (e >= 1 || e < 1e-4) return;
    const k = 1 / e;                                              // push radially onto the ellipse
    const nx = lx * k, nz = lz * k;
    p.x = I.pos.x + nx * c + nz * sn; p.z = I.pos.z - nx * sn + nz * c;
  }

  let lastIdx = -1, reported = false;
  const finite = (v) => isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  const api = {
    order: 70,
    shots: [],
    shotAt(t) { const s = SHOTS[shotIndexAt(t)]; return { name: s.name, t0: s.t0, t1: s.t1 }; },
    // world position of lifeboat i (TT.props when present, else the director's estimate)
    boatPos(i, out) { return boatPos(i, out || new THREE.Vector3()); },
    init(ctx) {
      this.shots = SHOTS.map((s) => ({ name: s.name, t0: s.t0, t1: s.t1 }));
      this.update(0, 0, ctx);
    },
    update(t, dt, ctx) {
      S = ctx.S || TT.S;
      const cam = ctx.camera;
      const idx = shotIndexAt(t);
      const sh = SHOTS[idx];
      sctx.t = t; sctx.d = t - sh.t0; sctx.u = clamp((t - sh.t0) / (sh.t1 - sh.t0));
      rig.roll = 0; rig.lens = 24; rig.focus = null; rig.aperture = 0; rig.near = 0.5; rig.fade = 0;
      try { sh.fn(sctx, rig); } catch (e) {
        if (!reported) { reported = true; TT.error('director ' + sh.name, e); }
        return; // keep last frame's camera
      }
      if (!finite(rig.pos) || !finite(rig.tgt) || rig.pos.distanceToSquared(rig.tgt) < 1e-6) return;

      // ---- handheld drift + shake (pure functions of t) ----
      const shake = (S.fx.shake || 0) * sh.shake;
      const hand = sh.hand;
      const yawN = (nz(t, 0.31, 1) * 0.55 * hand + nz(t, 6.5, 4) * 0.9 * shake) * DEG;
      const pitN = (nz(t, 0.27, 2) * 0.4 * hand + nz(t, 7.7, 5) * 0.8 * shake) * DEG;
      const rolN = (nz(t, 0.21, 3) * 0.6 * hand + nz(t, 4.9, 6) * 0.7 * shake) * DEG;
      cam.position.copy(rig.pos);
      if (shake > 0) {
        cam.position.x += nz(t, 5.3, 7) * 0.22 * shake;
        cam.position.y += nz(t, 6.1, 8) * 0.18 * shake;
        cam.position.z += nz(t, 5.7, 9) * 0.22 * shake;
      }
      // ---- keep out of the water, the berg ----
      if (!sh.under) {
        bergAvoid(cam.position);
        const floor = Math.max(1.5, seaY(cam.position.x, cam.position.z) + 1.0);
        if (cam.position.y < floor) cam.position.y = floor;
      } else if (cam.position.y > -2) cam.position.y = -2;

      // ---- orientation ----
      _m.lookAt(cam.position, rig.tgt, UP);
      cam.quaternion.setFromRotationMatrix(_m);
      _qe.set(pitN, yawN, rig.roll + rolN, 'YXZ');
      cam.quaternion.multiply(_q.setFromEuler(_qe));
      cam.up.set(0, 1, 0);

      // ---- lens: frame the 2.39:1 band identically on any aspect ----
      const w = ctx.width || window.innerWidth, h = ctx.height || window.innerHeight;
      const bandH = Math.min(h, w / BAND);
      const k = h / Math.max(1, bandH);
      const fov = 2 * Math.atan(Math.tan(rig.lens * DEG / 2) * k) / DEG;
      cam.fov = Math.min(100, fov); // very tall (portrait) windows: stop widening, crop the sides instead
      cam.near = Math.max(0.1, rig.near);
      cam.far = C.CAMERA.far;
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      // ---- hints ----
      const ud = cam.userData;
      ud.focus = rig.focus != null ? rig.focus : cam.position.distanceTo(rig.tgt);
      ud.aperture = rig.aperture;
      let fade = rig.fade;
      if (sh.fadeIn > 0) fade = Math.max(fade, 1 - sstep(sh.t0, sh.t0 + sh.fadeIn, t));
      if (sh.fadeOut > 0) fade = Math.max(fade, sstep(sh.t1 - sh.fadeOut, sh.t1, t));
      ud.fade = fade;
      ud.shot = sh.name;
      ud.letterbox = null;
      ud.cut = idx !== lastIdx && !(sh.cont && idx === lastIdx + 1); // first frame of a new shot (motion blur / TAA resets)
      lastIdx = idx;
    },
  };
  TT.register('director', api);
})();
