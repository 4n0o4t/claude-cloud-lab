import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/10_story.js ====
// =====================================================================
// 10_story.js — the master timeline. Scenes, named events, captions, wireless
// messages, lifeboat schedule, rockets, and the per-frame story state TT.S.
// Owner: integration. Every other module reads TT.S (also ctx.S) each frame.
//
// TT.S is a pure function of story time t (TT.story.sample(t, S)), so seeking works.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST, SH = C.SHIP, DEG = U.DEG;
  const curve = U.curve;

  // ------------------------------------------------------------------
  // Named event times (seconds). Audio, fx, ui and director sync to these.
  // ------------------------------------------------------------------
  const EV = {
    titleIn: 6.0, titleOut: 15.5,
    voyage: 18.0,
    lookout: 56.0,
    bergSighted: 58.5,          // a dark shape on the horizon from the crow's nest
    bells: [61.6, 62.3, 63.0],  // Fleet strikes the crow's-nest bell three times
    phone: 63.8,                // "Iceberg, right ahead!"
    helm: 65.0,                 // "Hard-a-starboard!" — bow starts swinging to port
    engineAstern: 66.5,         // telegraph to full astern
    impact: 74.0,               // contact on the starboard bow
    scrapeEnd: 83.0,
    engineStop: 86.0,
    steamStart: 95.0, steamEnd: 117.5, // safety valves roar
    firstBoat: 119.5,
    rockets: [121.5, 130.0, 138.5, 147.0, 153.5],
    bandStart: 158.0,           // "Nearer, My God, to Thee"
    funnel1Fall: 179.5, funnel1Splash: 182.8,
    lightsFlicker: 188.0, lightsOut: 193.0, lightsBlink: 193.4, lightsGone: 194.0,
    breakStart: 195.0, breakApart: 198.0, breakDone: 201.0,
    sternFallback: 199.0, sternSplash: 203.2,
    sternRise: 205.0, sternVertical: 214.0, sternPlunge: 216.5, sternGone: 221.5,
    silence: 222.0,
    underwater: 240.0, abyss: 247.0, seabedImpact: 255.5, rov: 257.5,
    dawn: 262.0,
    rescue: 271.0,
    endCard: 292.0,
    end: 305.0,
  };

  // ------------------------------------------------------------------
  // Scenes (chapters). `label` is shown on the scrubber.
  // ------------------------------------------------------------------
  const SCENES = [
    { id: 'intro', t0: 0, t1: 18, label: 'North Atlantic' },
    { id: 'voyage', t0: 18, t1: 56, label: 'Maiden Voyage' },
    { id: 'lookout', t0: 56, t1: 72, label: 'Iceberg, Right Ahead' },
    { id: 'collision', t0: 72, t1: 92, label: 'Collision' },
    { id: 'stillness', t0: 92, t1: 118, label: 'Engines Stopped' },
    { id: 'evacuation', t0: 118, t1: 156, label: 'Lifeboats and Rockets' },
    { id: 'final', t0: 156, t1: 190, label: 'The Band Plays On' },
    { id: 'break', t0: 190, t1: 222, label: 'The Final Plunge' },
    { id: 'silence', t0: 222, t1: 240, label: 'Silence' },
    { id: 'deep', t0: 240, t1: 262, label: 'The Deep' },
    { id: 'dawn', t0: 262, t1: 292, label: 'Carpathia' },
    { id: 'end', t0: 292, t1: 305, label: 'In Memoriam' },
  ];

  // ------------------------------------------------------------------
  // On-screen text. kind: 'title' | 'place' (time/place slug) | 'caption' | 'quote' | 'end'
  // ------------------------------------------------------------------
  const CAPTIONS = [
    { t0: 6.0, t1: 15.5, kind: 'title', text: 'TITANIC', sub: 'The night of 14 – 15 April 1912' },
    { t0: 20.0, t1: 27.0, kind: 'place', text: 'North Atlantic Ocean', sub: 'Sunday, 14 April 1912 · 11:20 p.m.' },
    { t0: 28.5, t1: 36.5, kind: 'caption', text: 'Four days into her maiden voyage from Southampton to New York, RMS Titanic is the largest ship afloat.' },
    { t0: 38.0, t1: 45.0, kind: 'caption', text: '2,224 passengers and crew are aboard.' },
    { t0: 46.5, t1: 54.0, kind: 'caption', text: 'The sea is flat calm. There is no moon.' },
    { t0: 57.0, t1: 62.0, kind: 'place', text: '11:39 p.m.', sub: 'The crow’s nest' },
    { t0: 63.8, t1: 69.8, kind: 'quote', text: '“Iceberg, right ahead!”', sub: 'Lookout Frederick Fleet' },
    { t0: 74.4, t1: 79.5, kind: 'place', text: '11:40 p.m.' },
    { t0: 83.5, t1: 90.5, kind: 'caption', text: 'The iceberg scrapes along the starboard side, opening the hull below the waterline.' },
    { t0: 94.0, t1: 99.0, kind: 'place', text: 'Midnight' },
    { t0: 105.0, t1: 111.0, kind: 'caption', text: 'Five watertight compartments are flooding. She can stay afloat with four.' },
    { t0: 111.8, t1: 117.2, kind: 'caption', text: 'Her designer, Thomas Andrews, gives her an hour and a half.' },
    { t0: 119.0, t1: 124.0, kind: 'place', text: '12:45 a.m.' },
    { t0: 124.5, t1: 131.0, kind: 'caption', text: 'The first lifeboat is lowered with 28 people aboard. It was built for 65.' },
    { t0: 132.0, t1: 139.5, kind: 'caption', text: 'Distress rockets burst over the ship. The lights of another vessel are seen on the horizon. She never comes.' },
    { t0: 148.5, t1: 155.5, kind: 'caption', text: 'There are lifeboats for barely half of those aboard.' },
    { t0: 157.0, t1: 162.0, kind: 'place', text: '2:05 a.m.', sub: 'The last lifeboat leaves' },
    { t0: 163.5, t1: 170.0, kind: 'caption', text: 'On deck, the band plays on.' },
    { t0: 171.0, t1: 177.5, kind: 'caption', text: 'More than 1,500 people are still aboard.' },
    { t0: 179.0, t1: 184.0, kind: 'place', text: '2:17 a.m.' },
    { t0: 223.5, t1: 228.5, kind: 'place', text: '2:20 a.m.' },
    { t0: 229.0, t1: 234.5, kind: 'caption', text: 'Titanic is gone. The water is −2 °C.' },
    { t0: 235.0, t1: 239.5, kind: 'caption', text: 'Of the twenty lifeboats, one goes back.' },
    { t0: 243.0, t1: 249.0, kind: 'caption', text: 'She falls nearly four kilometres to the floor of the Atlantic.' },
    { t0: 257.0, t1: 261.5, kind: 'caption', text: 'She will lie undisturbed for 73 years.' },
    { t0: 264.0, t1: 270.0, kind: 'place', text: '4:10 a.m.', sub: 'RMS Carpathia arrives' },
    { t0: 271.0, t1: 278.5, kind: 'caption', text: 'Carpathia steams through the ice to the lifeboats. 705 people are saved.' },
    { t0: 280.0, t1: 288.5, kind: 'caption', text: 'More than 1,500 lives are lost.' },
    { t0: 293.0, t1: 304.0, kind: 'end', text: 'In memory of all who were lost', sub: 'RMS Titanic · 15 April 1912' },
  ];

  // ------------------------------------------------------------------
  // Wireless (Marconi) messages. MGY is Titanic's call sign. The keyed text is sent as
  // Morse at `wpm` starting at t0; m.timing = TT.morse.timeline(key, t0, wpm) gives the
  // exact tone times (audio) and per-character times (ui types the text in sync).
  // ------------------------------------------------------------------
  const TELEGRAPH = [
    { t0: 97.0, wpm: 24, from: 'MGY · Titanic', key: 'CQD CQD MGY HAVE STRUCK ICEBERG 41.46N 50.14W' },
    { t0: 140.5, wpm: 26, from: 'MGY · Titanic', key: 'SOS SOS MGY SINKING FAST' },
  ];
  for (const m of TELEGRAPH) { m.timing = TT.morse.timeline(m.key, m.t0, m.wpm); m.t1 = m.timing.t1; }

  // ------------------------------------------------------------------
  // Lifeboats: slot = index into SHIP.BOAT_SLOTS (boat number - 1).
  // lowerT0..lowerT1 the boat descends the ship's side; afterwards it rows away.
  // dir: extra heading offset of the rowing course (radians, relative to straight out
  // from the ship's side); speed m/s (time-compressed); lantern: carries a lantern.
  // ------------------------------------------------------------------
  const BOATS = [
    { slot: 6, lowerT0: 119.5, lowerT1: 126.5, dir: 0.35, speed: 2.4, lantern: true, people: 28 },   // No. 7 first away
    { slot: 4, lowerT0: 122.0, lowerT1: 129.0, dir: -0.2, speed: 2.2, lantern: false, people: 36 },  // No. 5
    { slot: 5, lowerT0: 124.5, lowerT1: 131.5, dir: 0.25, speed: 2.1, lantern: true, people: 24 },   // No. 6
    { slot: 2, lowerT0: 127.5, lowerT1: 134.5, dir: -0.4, speed: 2.5, lantern: false, people: 40 },  // No. 3
    { slot: 0, lowerT0: 130.5, lowerT1: 137.0, dir: 0.5, speed: 2.8, lantern: false, people: 12 },   // No. 1
    { slot: 7, lowerT0: 133.0, lowerT1: 140.0, dir: -0.3, speed: 2.0, lantern: true, people: 39 },   // No. 8
    { slot: 8, lowerT0: 136.0, lowerT1: 143.0, dir: 0.2, speed: 2.3, lantern: false, people: 56 },   // No. 9
    { slot: 9, lowerT0: 139.0, lowerT1: 146.0, dir: -0.15, speed: 2.1, lantern: false, people: 57 }, // No. 10
    { slot: 10, lowerT0: 142.0, lowerT1: 149.0, dir: 0.4, speed: 2.4, lantern: true, people: 70 },   // No. 11
    { slot: 11, lowerT0: 145.0, lowerT1: 152.0, dir: -0.45, speed: 2.2, lantern: false, people: 42 },// No. 12
    { slot: 12, lowerT0: 147.5, lowerT1: 154.5, dir: 0.1, speed: 2.6, lantern: false, people: 64 },  // No. 13
    { slot: 13, lowerT0: 150.0, lowerT1: 157.0, dir: -0.25, speed: 2.0, lantern: true, people: 60 }, // No. 14 (goes back)
    { slot: 14, lowerT0: 152.5, lowerT1: 159.5, dir: 0.3, speed: 2.3, lantern: false, people: 70 },  // No. 15
    { slot: 15, lowerT0: 155.0, lowerT1: 162.0, dir: -0.35, speed: 2.1, lantern: false, people: 53 },// No. 16
    { slot: 3, lowerT0: 157.5, lowerT1: 164.5, dir: 0.15, speed: 2.2, lantern: true, people: 30 },   // No. 4
    { slot: 1, lowerT0: 160.0, lowerT1: 167.0, dir: -0.5, speed: 2.6, lantern: true, people: 25 },   // No. 2
  ];

  // ------------------------------------------------------------------
  // Tracks (monotone cubic curves of story time)
  // ------------------------------------------------------------------
  const TR = {
    // speed through the water, m/s (22.5 knots = 11.6 m/s)
    speed: curve([[0, 11.6], [66.5, 11.6], [74, 10.7], [83, 8.9], [92, 5.4], [104, 1.0], [114, 0]]),
    // heading (rad): the bow swings to port after "hard-a-starboard"
    heading: curve([[0, 0], [65.0, 0], [69, 0.05], [74, 0.23], [79, 0.30], [90, 0.355], [104, 0.38], [120, 0.385]]),
    rudder: curve([[0, 0], [65, 0], [67, 0.6], [75, 0.6], [77.5, -0.35], [83, -0.35], [86, 0]]),
    // propeller speed, revolutions per second (negative = astern)
    prop: curve([[0, 1.25], [66.5, 1.25], [68.5, 0], [70.5, -0.7], [84, -0.7], [86.5, 0]]),
    // trim (deg, bow down +) and depth of the bow stem below the waterline (m)
    pitch: curve([[0, 0], [74, 0], [92, 0.05], [104, 0.6], [118, 1.2], [140, 2.5], [156, 3.8], [170, 6.0], [180, 8.5], [190, 11.0], [195, 13.0]]),
    bowDepth: curve([[0, 0], [74, 0], [92, 0.3], [104, 2.5], [118, 5.0], [140, 9.0], [156, 13.0], [170, 21.0], [180, 32.0], [190, 42.0], [195, 47.0]]),
    // list (deg, to port +). She heels to starboard in the turn, then lists to port late.
    roll: curve([[0, 0], [66, 0], [71, -1.3], [80, -0.6], [100, -0.9], [130, 0.8], [160, 3.0], [185, 5.0], [195, 6.0]]),
    smoke: curve([[0, 1], [86, 1], [95, 0.35], [150, 0.12], [185, 0.03], [192, 0]]),
    steam: curve([[0, 0], [95, 0], [96.2, 1], [112, 1], [117.5, 0]]),
    // after the break (relative to the pose at breakStart)
    sternPitch: curve([[195, 13], [198, 12], [201, 8], [204, 3], [206, 6], [209, 30], [212, 62], [214, 82], [217, 86], [222, 88]]),
    sternDY: curve([[195, 0], [198, -0.8], [201, -2.3], [204, -4.3], [206, -5.0], [214, -5.4], [216.5, -6.0], [219, -17], [221, -38], [222, -60]]),
    sternYaw: curve([[195, 0], [205, 0], [216, 0.55], [222, 0.7]]),
    sternRoll: curve([[195, 6], [201, 4], [206, 2], [214, -3], [222, -4]]),
    bowPitch: curve([[195, 13], [198, 17], [201, 24], [204, 36], [208, 52], [214, 62], [222, 64]]),
    bowDY: curve([[198, 0], [201, -5], [204, -16], [208, -42], [214, -100], [222, -200]]),
    bowDX: curve([[198, 0], [222, 25]]),
    bowRoll: curve([[195, 6], [210, 12], [222, 14]]),
    // environment
    stars: curve([[0, 1], [239, 1], [240, 0], [262, 0], [262.1, 0.75], [280, 0.25], [292, 0.1]]),
    aurora: curve([[0, 0.12], [190, 0.12], [222, 0.25], [226, 0.55], [239, 0.55], [240, 0], [262, 0], [262.1, 0.2], [272, 0]]),
    dawn: curve([[0, 0], [261.9, 0], [262, 0.3], [276, 0.7], [292, 1.0]]),
    haze: curve([[0, 0.25], [52, 0.25], [57, 0.65], [72, 0.65], [80, 0.3], [222, 0.3], [226, 0.5], [240, 0.5], [262, 0.5], [292, 0.35]]),
    waveHeight: curve([[0, 0.12], [261.9, 0.12], [262, 0.3], [292, 0.55]]),
    wind: curve([[0, 1.0], [261.9, 1.0], [262, 3.0], [292, 5.5]]),
    mist: curve([[0, 0.05], [222, 0.05], [228, 0.45], [240, 0.45], [262, 0.35], [292, 0.25]]),
    // camera depth used for underwater darkness (m below the surface)
    depth: curve([[240, 12], [247, 160], [247.01, 1500], [255.5, 3790], [262, 3790]]),
    // grading
    fade: curve([[0, 1], [2.5, 1], [7.0, 0], [238.8, 0], [240, 1], [240.6, 0], [260.5, 0], [262, 1], [263.2, 0], [296, 0], [300, 0.55], [305, 1]]),
    saturation: curve([[0, 0.8], [18, 0.85], [92, 0.8], [190, 0.75], [222, 0.6], [240, 0.7], [262, 0.95], [292, 1.0]]),
    warmth: curve([[0, -0.25], [18, -0.1], [56, -0.3], [92, -0.35], [190, -0.4], [222, -0.5], [262, 0.2], [292, 0.45]]),
    exposure: curve([[0, 1.0], [240, 1.0], [262, 1.0], [292, 1.0]]),
  };

  // Ocean travel (virtual displacement of the ship through the water), integrated once.
  const STEP = 0.02;
  const NT = Math.ceil(C.DURATION / STEP) + 2;
  const TRX = new Float64Array(NT), TRZ = new Float64Array(NT);
  for (let i = 1; i < NT; i++) {
    const t = (i - 0.5) * STEP;
    const v = TR.speed(t), h = TR.heading(t);
    TRX[i] = TRX[i - 1] + v * Math.cos(h) * STEP;
    TRZ[i] = TRZ[i - 1] - v * Math.sin(h) * STEP;
  }
  function travelAt(t, out) {
    const f = U.clamp(t / STEP, 0, NT - 1.001), i = Math.floor(f), u = f - i;
    out.x = TRX[i] + (TRX[i + 1] - TRX[i]) * u;
    out.y = TRZ[i] + (TRZ[i + 1] - TRZ[i]) * u;
    return out;
  }

  // Iceberg: fixed in the water. At impact its centre lies abeam the starboard bow
  // (ship-local x = 96, z = +32.5; its carved ship-facing flank grinds the starboard bow).
  const BERG_LOCAL_AT_IMPACT = new THREE.Vector3(96, 0, 32.5);
  const _tv = new THREE.Vector2();
  const bergVirtual = (() => {
    const h = TR.heading(EV.impact);
    travelAt(EV.impact, _tv);
    const lx = BERG_LOCAL_AT_IMPACT.x, lz = BERG_LOCAL_AT_IMPACT.z;
    // rotate ship-local (lx, lz) by heading h about Y: x' = x cos h + z sin h, z' = -x sin h + z cos h
    return new THREE.Vector2(_tv.x + lx * Math.cos(h) + lz * Math.sin(h), _tv.y - lx * Math.sin(h) + lz * Math.cos(h));
  })();

  // ------------------------------------------------------------------
  // State object
  // ------------------------------------------------------------------
  const P = TT.pose;
  function makeState() {
    return {
      t: 0, dt: 0,
      scene: 'intro', sceneIndex: 0, sceneT: 0, sceneP: 0,
      seek: false,                 // true on a frame after a time discontinuity (seek / jump)
      ship: {
        visible: true,             // false once both sections are gone (silence, dawn)
        bowVisible: true, sternVisible: true,
        speed: 11.6,               // m/s through the water
        travel: new THREE.Vector2(), // (x, z) distance steamed through the water (sea texture offset)
        heading: 0,                // rad, intact heading (+ = bow toward -Z / port)
        pitch: 0,                  // rad, intact trim, bow down +
        roll: 0,                   // rad, list to port +
        rudder: 0,                 // rad, + = rudder over to turn the bow to port
        propRev: 1.25,             // propeller revolutions per second (negative astern)
        intact: P.create(),        // pose of the whole ship (pivotLocal = origin)
        bow: P.create(),           // pose of the bow section   (ship-local x >= BREAK_X)
        stern: P.create(),         // pose of the stern section (ship-local x <  BREAK_X)
        broken: 0,                 // 0 intact .. 1 torn through; > 0 => show the torn edges
        separated: false,          // the two sections move independently
        lights: 1,                 // electric light level with flicker baked in (0..1)
        smoke: 1,                  // funnel smoke (funnels 1-3; the 4th was a ventilator)
        steam: 0,                  // steam roaring from the pipes on the funnels' fore sides
        funnelFall: [0, 0, 0, 0],  // collapse progress per funnel (0 upright .. 1 fallen)
        wreck: 0,                  // seabed look: rust, silt, dark (0..1)
        flood: 0,                  // general flooding progress 0..1 (for interior darkness etc.)
      },
      iceberg: { visible: 0, pos: new THREE.Vector3(), yaw: 0.6, approach: 0 },
      boats: BOATS,                // schedule (props computes positions)
      rockets: EV.rockets,         // launch times (fx computes trajectories)
      telegraph: TELEGRAPH,
      env: {
        stars: 1, milkyWay: 1, aurora: 0.12, dawn: 0, haze: 0.25, mist: 0.05,
        waveHeight: 0.12, wind: 1.0,
        underwater: 0,            // 1 while the camera is under the sea (deep scene)
        depth: 0,                 // camera depth below the surface for darkness (m)
        depthGauge: 0,            // depth shown on screen (m), 0 = hidden
        seabed: 0,                // seabed & wreck visible
        exposure: 1,
      },
      fx: {
        shake: 0,                 // camera shake 0..1 (director applies)
        scrape: 0,                // ice/hull contact spray & fragments along the starboard side
        iceFall: 0,               // ice chunks tumbling onto the forward well deck
        bubbles: 0,               // bubbles / boiling water where the ship went down
        debris: 0,                // floating wreckage field (deck chairs, planks) 0..1
        breakSparks: 0,           // sparks, torn steel, debris during the break
        marineSnow: 0,            // underwater particles
        sediment: 0,              // seabed impact cloud age (s since impact), 0 = none
        splashes: [               // big splash events (fx renders; audio plays)
          { t: EV.funnel1Splash, what: 'funnel1', size: 1.0 },
          { t: EV.sternSplash, what: 'sternFallback', size: 1.6 },
          { t: EV.sternGone, what: 'sternGone', size: 1.2 },
        ],
        rov: 0,                   // 1985 camera-sled lights on the wreck (seabed scene)
      },
      world: {
        californian: 0,           // distant lights of another ship on the northern horizon
        californianPos: new THREE.Vector3(5200, 0, 14500),
        carpathia: 0,             // RMS Carpathia at dawn (0..1 visibility)
        carpathiaPos: new THREE.Vector3(-4600, 0, -3000),
        carpathiaHeading: 0,
        iceField: 0,              // icebergs and growlers around at dawn
      },
      grade: { fade: 1, exposure: 1, saturation: 0.85, contrast: 1.0, warmth: 0, vignette: 0.42, grain: 0.05, letterbox: 1, bloom: 1, underwater: 0 },
    };
  }

  // scratch
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _poseBreak = P.create();
  const L_STERN = new THREE.Vector3(-85, 0, 0);
  const H_BREAK = new THREE.Vector3(SH.BREAK_X, SH.KEEL_Y, 0);
  const H_BOW_TIP_KEEL = new THREE.Vector3(SH.STEM_X, SH.KEEL_Y, 0);
  const _hinge0 = new THREE.Vector3(), _tipW0 = new THREE.Vector3();
  const _sternApart = P.create();

  function intactPose(t, pose) {
    const heading = TR.heading(t), pitch = TR.pitch(t) * DEG, roll = TR.roll(t) * DEG, D = TR.bowDepth(t);
    P.quatFromHPR(heading, pitch, roll, pose.quat);
    pose.pivotLocal.set(0, 0, 0);
    _v.set(SH.STEM_X, 0, 0).applyQuaternion(pose.quat);
    // gentle heave on the calm swell
    const heave = 0.06 * Math.sin(t * 0.55) + 0.03 * Math.sin(t * 1.31 + 1.7);
    pose.pivotWorld.set(0, -D - _v.y + heave, 0);
    return pose;
  }

  // lights with flicker baked in (deterministic)
  function lightsAt(t) {
    if (t < EV.lightsFlicker) return 1;
    if (t >= EV.lightsGone) return 0;
    if (t >= EV.lightsBlink && t < EV.lightsGone - 0.1) return 0.55 + 0.25 * Math.sin(t * 40);
    if (t >= EV.lightsOut) return 0;
    const u = (t - EV.lightsFlicker) / (EV.lightsOut - EV.lightsFlicker);
    const n = U.hash1(Math.floor(t * 14)) ; // dropouts get more frequent
    const drop = n < 0.15 + 0.6 * u ? U.lerp(0.15, 0.5, U.hash1(Math.floor(t * 14) + 7)) : 1;
    return U.lerp(1, 0.75, u) * drop;
  }

  function sampleShip(t, S) {
    const sh = S.ship;
    sh.speed = TR.speed(t);
    travelAt(t, _tv); sh.travel.set(_tv.x, _tv.y);
    sh.heading = TR.heading(t);
    sh.pitch = TR.pitch(Math.min(t, EV.breakStart)) * DEG;
    sh.roll = TR.roll(Math.min(t, EV.breakStart)) * DEG;
    sh.rudder = TR.rudder(t);
    sh.propRev = t < EV.breakStart ? TR.prop(t) : 0;
    sh.smoke = TR.smoke(t);
    sh.steam = TR.steam(t);
    sh.lights = lightsAt(t);
    sh.flood = U.smoothstep(EV.impact, EV.breakStart, t);
    sh.funnelFall[0] = U.easeInQuad(U.clamp((t - EV.funnel1Fall) / (EV.funnel1Splash - EV.funnel1Fall)));
    sh.funnelFall[1] = U.easeInQuad(U.clamp((t - 201.5) / 3.2));   // wrenched off as the bow section dives
    sh.funnelFall[2] = U.easeInQuad(U.clamp((t - 200.5) / 3.0));
    sh.funnelFall[3] = U.easeInQuad(U.clamp((t - 202.0) / 3.6));   // topples as the stern slams back
    sh.wreck = t >= EV.abyss ? 1 : 0;
    sh.broken = U.smoothstep(EV.breakStart, EV.breakDone, t);
    sh.separated = t >= EV.breakApart;
    sh.visible = true; sh.bowVisible = true; sh.sternVisible = true;

    intactPose(Math.min(t, EV.breakStart), sh.intact);

    if (t < EV.breakStart) {
      P.copy(sh.bow, sh.intact);
      P.copy(sh.stern, sh.intact);
      return;
    }

    if (t < EV.silence) {
      // ---------------- the break-up and the final plunge ----------------
      intactPose(EV.breakStart, _poseBreak);
      const h0 = TR.heading(EV.breakStart);
      // stern: pivots about a point on its waterline 61 m aft of the break
      P.toWorld(_poseBreak, L_STERN, _v);
      sh.stern.pivotLocal.copy(L_STERN);
      sh.stern.pivotWorld.set(_v.x, _v.y + TR.sternDY(t), _v.z);
      P.quatFromHPR(h0 + TR.sternYaw(t), TR.sternPitch(t) * DEG, TR.sternRoll(t) * DEG, sh.stern.quat);
      // bow: hinged at the keel of the break until it tears free, then dives
      sh.bow.pivotLocal.copy(H_BREAK);
      P.quatFromHPR(h0, TR.bowPitch(t) * DEG, TR.bowRoll(t) * DEG, sh.bow.quat);
      const hingeNow = P.toWorld(sh.stern, H_BREAK, _v2);
      if (t < EV.breakApart) {
        sh.bow.pivotWorld.copy(hingeNow);
      } else {
        // free trajectory from the hinge position at the moment of separation
        P.toWorld(_poseBreak, L_STERN, _v);
        _sternApart.pivotLocal.copy(L_STERN);
        _sternApart.pivotWorld.set(_v.x, _v.y + TR.sternDY(EV.breakApart), _v.z);
        P.quatFromHPR(h0 + TR.sternYaw(EV.breakApart), TR.sternPitch(EV.breakApart) * DEG, TR.sternRoll(EV.breakApart) * DEG, _sternApart.quat);
        const base = P.toWorld(_sternApart, H_BREAK, _v);
        const dx = TR.bowDX(t);
        sh.bow.pivotWorld.set(base.x + dx * Math.cos(h0), base.y + TR.bowDY(t), base.z - dx * Math.sin(h0));
      }
      sh.bowVisible = t < 214;
      sh.sternVisible = t < EV.sternGone + 0.8;
      return;
    }

    if (t < EV.underwater || t >= EV.dawn) {
      sh.visible = false; sh.bowVisible = false; sh.sternVisible = false;
      return;
    }

    // ---------------- the deep ----------------
    if (t < EV.abyss) {
      // just beneath the surface: the stern section, screws uppermost, sinks away into the dark
      const u = (t - EV.underwater) / (EV.abyss - EV.underwater);
      sh.stern.pivotLocal.copy(L_STERN);
      sh.stern.pivotWorld.set(-6 - 10 * u, -70 - 150 * u - 40 * u * u, 8 + 4 * u);
      P.quatFromHPR(0.9 + 0.12 * u, (78 - 6 * u) * DEG, (-3 + 5 * u) * DEG, sh.stern.quat);
      sh.bowVisible = false; sh.sternVisible = true;
      return;
    }
    // the abyss: the bow section planes down and ploughs into the seabed
    sh.sternVisible = false; sh.bowVisible = true;
    sh.bow.pivotLocal.copy(H_BREAK);
    const heading = 0.38, glide = (tt) => (40 + 2.5 * Math.sin(tt * 0.7)) * DEG;
    // hinge position at the moment of impact: bow keel tip 2 m into the mud
    P.quatFromHPR(heading, glide(EV.seabedImpact), 4 * DEG, _q);
    const tip0 = _v2.copy(H_BOW_TIP_KEEL).sub(H_BREAK).applyQuaternion(_q);
    const hinge0 = _hinge0.set(30, C.SEABED_Y - 2 - tip0.y, 0);
    const tipW0 = _tipW0.copy(hinge0).add(tip0);
    if (t < EV.seabedImpact) {
      P.quatFromHPR(heading, glide(t), 4 * DEG, sh.bow.quat);
      const dirBow = _v.set(1, 0, 0).applyQuaternion(sh.bow.quat);   // forward-down
      const s = (EV.seabedImpact - t) * 21.0;                         // metres still to travel
      const tipNow = _v2.copy(H_BOW_TIP_KEEL).sub(H_BREAK).applyQuaternion(sh.bow.quat);
      // glide along the bow direction toward the impact point of the tip
      sh.bow.pivotWorld.copy(tipW0).sub(tipNow).addScaledVector(dirBow, -s);
    } else {
      // slam: the nose digs in 13 m, the after end pancakes down, then she settles at 3.6°
      const e = U.easeOutCubic(U.clamp((t - EV.seabedImpact) / 2.2));
      P.quatFromHPR(heading, U.lerp(glide(EV.seabedImpact) / DEG, 3.6, e) * DEG, U.lerp(4, 1.5, e) * DEG, sh.bow.quat);
      const tipNow = _v2.copy(H_BOW_TIP_KEEL).sub(H_BREAK).applyQuaternion(sh.bow.quat);
      sh.bow.pivotWorld.copy(tipW0);
      sh.bow.pivotWorld.y -= 13 * e;
      sh.bow.pivotWorld.sub(tipNow);
    }
  }

  // Lifeboat stowed/lowering/rowing positions are computed by props; this helper gives
  // the rowing progress for a boat (metres rowed away from the side) at time t.
  function boatRowDistance(b, t) {
    if (t <= b.lowerT1) return 0;
    const dt = t - b.lowerT1;
    // accelerate over ~20 s, then slow as they tire; saturate ~ 900 m by dawn
    return Math.min(900, b.speed * (dt - 10 * (1 - Math.exp(-dt / 10))) * (1 - 0.25 * U.smoothstep(60, 180, dt)));
  }

  function sample(t, S) {
    S.t = t;
    let si = 0;
    for (let i = 0; i < SCENES.length; i++) if (t >= SCENES[i].t0) si = i;
    const sc = SCENES[si];
    S.scene = sc.id; S.sceneIndex = si; S.sceneT = t - sc.t0; S.sceneP = U.clamp((t - sc.t0) / (sc.t1 - sc.t0));

    sampleShip(t, S);

    // iceberg (render frame = virtual frame minus ship travel; extra distance before
    // impact compresses the approach so she is seen far off from the crow's nest)
    const ib = S.iceberg;
    const tau = Math.max(0, Math.min(20, EV.impact - t));
    const extra = 1.53 * tau * tau;
    const h = TR.heading(Math.min(t, EV.impact));
    ib.pos.set(bergVirtual.x - S.ship.travel.x + extra * Math.cos(h), 0, bergVirtual.y - S.ship.travel.y - extra * Math.sin(h));
    // after the collision the berg drifts off on the current, looming on the starboard quarter
    const drift = Math.max(0, Math.min(t, 190) - 86);
    ib.pos.x -= 2.6 * drift; ib.pos.z += 2.9 * drift;
    ib.visible = t >= 50 && t < 196 ? 1 : 0;
    ib.approach = U.clamp(1 - tau / 20);

    // environment
    const E = S.env;
    E.stars = TR.stars(t); E.milkyWay = E.stars; E.aurora = TR.aurora(t); E.dawn = TR.dawn(t);
    E.haze = TR.haze(t); E.mist = TR.mist(t); E.waveHeight = TR.waveHeight(t); E.wind = TR.wind(t);
    E.underwater = t >= EV.underwater && t < EV.dawn ? 1 : 0;
    E.depth = E.underwater ? TR.depth(t) : 0;
    E.depthGauge = t >= EV.abyss - 0.5 && t < EV.seabedImpact + 5 ? Math.round(E.depth) : 0;
    E.seabed = t >= EV.abyss && t < EV.dawn ? 1 : 0;
    E.exposure = TR.exposure(t);

    // effects
    const F = S.fx;
    F.scrape = U.envelope(t, EV.impact - 0.2, EV.scrapeEnd, 0.4, 2.0);
    F.iceFall = U.envelope(t, EV.impact + 0.8, EV.scrapeEnd + 2.5, 0.5, 2.5);
    F.shake = Math.max(
      0.75 * U.envelope(t, EV.impact - 0.1, EV.scrapeEnd + 1.5, 0.2, 5),
      0.25 * U.envelope(t, EV.funnel1Splash - 0.3, EV.funnel1Splash + 2.5, 0.2, 2),
      0.9 * U.envelope(t, EV.breakStart, EV.breakDone + 1, 0.4, 2.5),
      0.6 * U.envelope(t, EV.sternSplash - 0.3, EV.sternSplash + 3, 0.1, 2.5),
      0.35 * U.envelope(t, EV.sternPlunge, EV.sternGone, 1.0, 1.0),
      0.6 * U.envelope(t, EV.seabedImpact - 0.1, EV.seabedImpact + 3, 0.1, 2.5));
    F.breakSparks = U.envelope(t, EV.breakStart, EV.breakDone + 2, 0.3, 2);
    F.bubbles = Math.max(U.envelope(t, EV.sternGone - 1, 236, 0.5, 6), t >= EV.underwater && t < EV.abyss ? 1 : 0, U.envelope(t, EV.abyss, EV.seabedImpact, 0.3, 1) * 0.6);
    F.debris = U.smoothstep(EV.breakStart + 2, EV.sternGone, t) * (t < EV.underwater || t >= EV.dawn ? 1 : 0);
    F.marineSnow = E.underwater;
    F.sediment = t >= EV.seabedImpact && t < EV.dawn ? t - EV.seabedImpact : 0;
    F.rov = U.envelope(t, EV.rov, EV.dawn - 0.3, 2.0, 1.0);

    const W = S.world;
    W.californian = U.envelope(t, 110, 200, 4, 6) * 0.85;
    W.carpathia = t >= EV.dawn ? 1 : 0;
    const cu = U.clamp((t - EV.dawn) / (EV.endCard - EV.dawn));
    W.carpathiaPos.set(U.lerp(-4600, -2400, cu), 0, U.lerp(-3000, -1500, cu));
    W.carpathiaHeading = Math.atan2(W.carpathiaPos.z, -W.carpathiaPos.x); // bow toward the lifeboats (origin)
    W.iceField = t >= EV.dawn ? 1 : 0;

    const G = S.grade;
    G.fade = U.clamp(TR.fade(t));
    G.saturation = TR.saturation(t);
    G.warmth = TR.warmth(t);
    G.exposure = E.exposure;
    G.underwater = E.underwater;
    G.contrast = 1.0 + 0.08 * (S.scene === 'break' ? 1 : 0);
    G.vignette = E.underwater ? 0.6 : 0.42;
    G.grain = 0.05 + 0.02 * E.underwater;
    G.letterbox = 1;
    G.bloom = 1;
    return S;
  }

  const S = makeState();
  TT.S = S;

  TT.register('story', {
    order: 0,
    EV, SCENES, CAPTIONS, TELEGRAPH, BOATS, TR,
    duration: C.DURATION,
    makeState, sample, intactPose, travelAt, boatRowDistance,
    bergLocalAtImpact: BERG_LOCAL_AT_IMPACT,
    sceneAt(t) { let s = SCENES[0]; for (const sc of SCENES) if (t >= sc.t0) s = sc; return s; },
    captionsAt(t) { return CAPTIONS.filter((c) => t >= c.t0 - 1 && t < c.t1 + 1); },
    init(ctx) { ctx.S = S; sample(0, S); },
    _lastT: null,
    update(t, dt, ctx) {
      S.seek = this._lastT == null || t < this._lastT - 1e-4 || t - this._lastT > 0.5;
      S.dt = dt;
      this._lastT = t;
      sample(t, S);
      ctx.S = S;
    },
  });
})();
