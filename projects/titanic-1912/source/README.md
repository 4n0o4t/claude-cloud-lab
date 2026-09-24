# Titanic, April 1912 — restored source project

This project restores the supplied single HTML film into an ordinary Vite + Three.js source tree. The original `// ==== FILE: src/... ====` markers define each module boundary. The shader strings, film timeline, camera direction, procedural ship and ocean, props, original score, sound engine, post processing, and UI remain in their original modules. Three.js is pinned to the original import map version, `0.160.0`.

## Start

Requirements: Node.js 18 or newer and npm.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite (normally <http://127.0.0.1:5173/>). Click the opening screen to enable sound. To build a deployable static site:

```bash
npm run build
npm run preview
```

The `dist/` directory in the delivered archive is an already built version. You may also serve it directly with `python3 -m http.server 8080 --directory dist` and open <http://127.0.0.1:8080/>. Serving over HTTP is important for JavaScript modules; opening `index.html` as a `file://` URL is not supported.

## Layout

| Path | Role |
| --- | --- |
| `index.html`, `src/style.css` | Document shell, web fonts, root element, global style |
| `src/main.js` | Imports modules in their original evaluation order |
| `src/00_core.js` | Shared namespace, Three.js imports, constants, clock, utilities |
| `src/10_story.js` | Timeline, events, captions, per-frame story state |
| `src/20_sky.js` | Night sky, light and atmospheric environment |
| `src/30_ocean.js` | Water geometry, shaders, wake and reflections |
| `src/40_ship.js` | Titanic geometry, hull, fittings, poses |
| `src/45_props.js` | Iceberg, lifeboats, other vessels, debris, seabed |
| `src/50_audio.js` | Audio engine, instruments and sound effects |
| `src/55_score.js` | Original score data and orchestration |
| `src/60_fx.js` | Particles and post processing |
| `src/70_director.js` | Camera shots and framing |
| `src/80_ui.js` | Start screen, subtitles and player controls |
| `src/90_main.js` | Renderer initialization, lifecycle and render loop |

Each feature module imports the shared `TT` namespace, `THREE` and `ADDONS` from `00_core.js`; registrations, initialization order and story state otherwise retain the original behavior. The static build bundles Three.js locally. The instrument samples and Google fonts are optional network assets; if samples cannot load, the audio engine falls back to synthesized instruments, and fonts have local fallbacks. Add `?synth=1` to use synthesized instruments immediately.

## Useful URL parameters

| Example | Effect |
| --- | --- |
| `?debug=1` | Display diagnostics and print frame readiness |
| `?q=low` | Lower graphics quality for slower devices |
| `?nofx=1` | Disable the post processing chain |
| `?nowarm=1` | Skip the all-shots shader rehearsal before Begin on a slow software renderer |
| `?autoplay=1&synth=1` | Run visuals without waiting at the start screen |
| `?t=95&freeze=1` | Hold a particular story frame |
| `?hideui=1` | Hide interface overlays |

The film uses WebGL and Web Audio. A browser with hardware or software WebGL support is required; sound starts after a user gesture due to browser audio policy. Shader compilation and GPU memory needs depend on the browser and device. The repository is a restoration of the supplied file, not a claim to recover unavailable development history or assets.

## Verification performed

`npm run build` completed. The development server served the entry point and JavaScript modules over HTTP. In headless Chromium with software WebGL at 960 × 540, low quality, all ten feature modules initialized without `TT.errors`. The film rendered both the star-field introduction (`t=5`) and a ship-hull shot (`t=30`), including a pass with post processing enabled. With `?synth=1&nowarm=1`, clicking **Begin** started the Web Audio context and synthesized the instrument notes. Google Fonts was unavailable in the test browser; the font fallback worked. This smoke check covers representative scenes and audio startup, rather than a full five-minute playback on every GPU.
