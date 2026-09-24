import { TT, THREE, ADDONS } from './00_core.js';

// ==== FILE: src/80_ui.js ====
// =====================================================================
// 80_ui.js — the overlay: start / loading screen, letterbox, captions,
// wireless typewriter (Marconigram), depth gauge, player controls, end state.
// Owner: ui agent. Pure DOM (no canvas). Every visible element is a pure
// function of story time t, so seeking and freeze-frame stills look right.
// =====================================================================
(() => {
  const U = TT.util, C = TT.CONST;
  const PRM = TT.params || {};
  const DUR = C.DURATION;
  const clamp = U.clamp, sstep = U.smoothstep;

  const HIDE = PRM.hideui === '1';
  const NOSTART = PRM.autoplay === '1' || PRM.freeze === '1';
  const FORCE_CTL = PRM.showcontrols === '1';
  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ helpers
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s + 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];
  // cached style writes: touch the DOM only when a value really changes
  function css(node, prop, val) {
    const k = '_c_' + prop;
    if (node[k] === val) return;
    node[k] = val;
    if (prop.charCodeAt(0) === 45) node.style.setProperty(prop, val); else node.style[prop] = val;
  }
  function cls(node, name, on) {
    const k = '_k_' + name;
    if (node[k] === on) return;
    node[k] = on;
    node.classList.toggle(name, on);
  }
  function text(node, s) { if (node._txt !== s) { node._txt = s; node.textContent = s; } }
  function store(k, v) {
    try { if (v === undefined) return window.localStorage.getItem('tt.' + k); window.localStorage.setItem('tt.' + k, String(v)); } catch (e) { /* private mode */ }
    return null;
  }

  // Ship's clock (minutes after 23:00 on 14 April) from the story's own time slugs — used to
  // stamp the Marconigrams when a message has no explicit time.
  function parseClock(s) {
    if (/midnight/i.test(s)) return 60;
    const m = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i.exec(s || '');
    if (!m) return null;
    let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
    let min = h * 60 + +m[2];
    if (min < 12 * 60) min += 24 * 60;
    return min - 23 * 60;
  }
  function fmtClock(min) {
    let tot = (Math.round(min / 5) * 5 + 23 * 60) % (24 * 60);
    const h24 = Math.floor(tot / 60), mm = tot % 60;
    if (h24 === 0 && mm === 0) return 'Midnight';
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return h + ':' + String(mm).padStart(2, '0') + (h24 < 12 ? ' a.m.' : ' p.m.');
  }
  // Historical times for the two wireless calls (ship's time): first CQD ~12:15 a.m.,
  // "sinking fast" traffic ~1:40 a.m.
  const WIRE_TIME = { CQD: '12:15 a.m.', SOS: '1:40 a.m.' };

  // ------------------------------------------------------------------ styles
  const STYLE = `
#tt-ui{position:fixed;inset:0;z-index:10;pointer-events:none;color:var(--frost);font-family:var(--font-body);
  --bar:0px;--lift:0px;--gut:max(16px,4.2vw);--anchor:max(calc(var(--bar) * .5),calc(8vh + env(safe-area-inset-bottom)));
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;font-kerning:normal;text-rendering:optimizeLegibility;overflow:hidden}
#tt-ui *,#tt-ui *::before,#tt-ui *::after{box-sizing:border-box}
:where(#tt-ui) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none;border-radius:0}
:where(#tt-ui) :focus{outline:none}
:where(#tt-ui) :focus-visible{outline:1px solid var(--buff);outline-offset:4px}
.tt-stage{position:absolute;inset:0;pointer-events:auto}
#tt-ui.idle .tt-stage{cursor:none}
.tt-lb{position:absolute;left:0;right:0;height:var(--bar);background:#000}
.tt-lb.t{top:0}.tt-lb.b{bottom:0}

/* ---------------- captions ---------------- */
.tt-low,.tt-slug{position:absolute;bottom:var(--anchor);display:grid;align-items:center;transform:translateY(calc(50% - var(--lift)));
  transition:transform .55s cubic-bezier(.2,.7,.2,1)}
.tt-low{left:var(--gut);right:var(--gut);justify-items:center}
.tt-slug{left:max(var(--gut),calc(env(safe-area-inset-left) + 16px));justify-items:start}
.tt-cap,.tt-place,.tt-quote{grid-area:1/1;opacity:0;visibility:hidden;will-change:opacity,filter,transform}
.tt-cap{max-width:min(60ch,100%);text-align:center;font-size:clamp(15px,calc(.82vw + 9.5px),25px);line-height:1.45;letter-spacing:.012em;
  color:#e6e8e6;text-wrap:balance;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 24px rgba(0,0,0,.75)}
.tt-quote{text-align:center;max-width:100%;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 30px rgba(0,0,0,.8)}
.tt-quote .q{display:block;font-family:var(--font-display);font-style:italic;font-weight:400;font-size:clamp(21px,calc(1.35vw + 12px),42px);
  line-height:1.15;letter-spacing:.005em;color:#f3f1ea}
.tt-quote .a{display:block;margin-top:.7em;font-size:clamp(10px,calc(.3vw + 8px),13.5px);letter-spacing:.3em;text-transform:uppercase;color:#a9b6c0}
.tt-place{text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 18px rgba(0,0,0,.8)}
.tt-place .r{display:block;width:clamp(28px,3.4vw,48px);height:1px;margin-bottom:clamp(7px,1.1vh,11px);background:var(--buff);opacity:.85;transform-origin:0 50%}
.tt-place .m{display:block;font-family:var(--font-display);font-weight:500;font-size:clamp(11px,calc(.36vw + 8.4px),15.5px);letter-spacing:.3em;
  text-transform:uppercase;color:#eeece5;white-space:nowrap}
.tt-place .s{display:block;margin-top:.45em;font-style:italic;font-size:clamp(12px,calc(.32vw + 9.4px),16.5px);letter-spacing:.025em;color:#a4b1bc}
.tt-title{position:absolute;left:0;right:0;top:50%;transform:translateY(-56%);text-align:center;opacity:0;visibility:hidden;will-change:opacity,filter}
.tt-title .w{display:block;font-family:var(--font-display);font-weight:400;font-size:clamp(36px,7vw,136px);line-height:1;color:#f4f3ee;white-space:nowrap;
  text-shadow:0 0 50px rgba(0,0,0,.55)}
.tt-title .r{display:block;width:min(24vw,280px);height:1px;margin:clamp(16px,2.6vh,30px) auto;
  background:linear-gradient(90deg,transparent,rgba(212,154,76,.9) 30%,rgba(212,154,76,.9) 70%,transparent)}
.tt-title .s{display:block;font-style:italic;font-size:clamp(14px,calc(.55vw + 10.5px),22px);letter-spacing:.07em;color:#c9d2d8}
.tt-end{position:absolute;left:50%;top:50%;width:min(600px,calc(100vw - 32px));padding:clamp(30px,5.4vh,56px) clamp(18px,4vw,52px);
  transform:translate(-50%,-50%);text-align:center;opacity:0;visibility:hidden;will-change:opacity,filter}
.tt-end::before,.tt-end::after{content:"";position:absolute;inset:0;border:1px solid rgba(233,238,241,.16);pointer-events:none}
.tt-end::before{background:radial-gradient(90% 120% at 50% 45%,rgba(6,7,16,.6),rgba(6,7,16,.36));box-shadow:0 0 160px 70px rgba(4,6,14,.26),0 0 40px 10px rgba(4,6,14,.2)}
.tt-end > *{position:relative}
.tt-end::after{inset:5px;border-color:rgba(212,154,76,.2)}
.tt-orn{display:flex;align-items:center;justify-content:center;gap:12px}
.tt-orn i{display:block;width:clamp(34px,6vw,90px);height:1px;background:linear-gradient(90deg,transparent,rgba(212,154,76,.85))}
.tt-orn i:last-child{transform:scaleX(-1)}
.tt-orn b{display:block;width:6px;height:6px;border:1px solid rgba(212,154,76,.95);transform:rotate(45deg)}
.tt-end .m{margin-top:clamp(16px,2.6vh,26px);font-family:var(--font-display);font-style:italic;font-size:clamp(23px,calc(1.3vw + 14px),40px);line-height:1.22;color:#f3f1ea}
.tt-end .s{margin-top:1.15em;font-size:clamp(10px,calc(.3vw + 8.3px),13.5px);letter-spacing:.34em;text-transform:uppercase;color:#cfd6da}
.tt-end .n{margin-top:clamp(18px,3vh,30px);font-style:italic;font-size:clamp(12px,calc(.25vw + 10px),15px);letter-spacing:.02em;color:#94a2ae;font-variant-numeric:lining-nums}
.tt-again{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:18px;
  opacity:0;visibility:hidden;transition:opacity 1.4s ease,visibility 0s linear 1.4s}
#tt-ui.ended .tt-again{opacity:1;visibility:visible;transition:opacity 2s ease 1s,visibility 0s}
.tt-again .w{font-family:var(--font-display);font-size:clamp(13px,1.1vw,16px);letter-spacing:.62em;padding-left:.62em;color:rgba(233,238,241,.42)}
.tt-ghost{pointer-events:auto;min-height:46px;padding:0 30px 0 calc(30px + .42em);border:1px solid rgba(233,238,241,.22);font-family:var(--font-display);
  font-size:11.5px;letter-spacing:.42em;text-transform:uppercase;color:rgba(233,238,241,.78);transition:border-color .4s,color .4s,background .4s}
.tt-ghost:hover{border-color:rgba(212,154,76,.8);color:#f4f1e9;background:rgba(212,154,76,.06)}

/* ---------------- wireless: the Marconigram ---------------- */
.tt-wire{position:absolute;top:max(calc(var(--bar) + clamp(12px,3.2vh,34px)),calc(env(safe-area-inset-top) + 16px));
  left:max(var(--gut),calc(env(safe-area-inset-left) + 16px));width:min(356px,calc(100vw - 32px));padding:15px 18px 12px;color:#2a1f16;
  background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .33 0 0 0 0 .24 0 0 0 0 .14 0 0 0 .22 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"),
  radial-gradient(120% 80% at 28% 12%,rgba(255,251,236,.34),transparent 62%),radial-gradient(90% 110% at 100% 100%,rgba(112,82,44,.3),transparent 58%),
  radial-gradient(60% 50% at 0% 100%,rgba(112,82,44,.18),transparent 70%),linear-gradient(172deg,#cfc2a1,#bdac89);
  box-shadow:0 22px 44px -10px rgba(0,0,0,.75),0 2px 7px rgba(0,0,0,.55),inset 0 0 26px rgba(104,74,38,.28);
  opacity:0;visibility:hidden;transform-origin:0 0;will-change:opacity,transform,filter}
.tt-wire::before{content:"";position:absolute;inset:5px;border:1px solid rgba(110,40,28,.42);pointer-events:none}
.tt-wire .hd{text-align:center;font-family:var(--font-display);font-weight:700;font-size:10.5px;letter-spacing:.19em;color:#7a261b;white-space:nowrap}
.tt-wire .hd2{margin-top:3px;text-align:center;font-family:var(--font-display);font-size:7.5px;letter-spacing:.34em;color:#7a261b;white-space:nowrap}
.tt-wire .kv{display:grid;grid-template-columns:auto 1fr auto auto;column-gap:8px;row-gap:3px;align-items:baseline;margin-top:9px;padding:6px 0 5px;
  border-top:1px solid rgba(110,40,28,.4);border-bottom:1px solid rgba(110,40,28,.4)}
.tt-wire .kv i{font-size:10px;color:#6f5a42}
.tt-wire .kv b{font-family:var(--font-wire);font-weight:400;font-size:12px;color:#1f1812;white-space:nowrap}
.tt-wire .msg{margin-top:9px;min-height:3em;font-family:var(--font-wire);font-size:clamp(14.5px,calc(.4vw + 11px),17px);line-height:1.5;letter-spacing:.035em;
  color:#16100b;text-shadow:0 0 .6px rgba(22,16,11,.55)}
.tt-wire .msg span{position:relative;visibility:hidden}
.tt-wire .msg span.on{visibility:visible}
.tt-wire .msg span.cur::after{content:"";position:absolute;left:100%;bottom:.16em;width:.56em;height:.11em;margin-left:.06em;background:#16100b;visibility:visible;
  animation:ttBlink 1.06s steps(1,end) infinite}
.tt-wire.keying .msg span.cur::after{animation:none}
.tt-wire .ft{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#6f5a42}
.tt-wire .ft .k{display:flex;align-items:center;gap:8px}
.tt-wire .code{font-family:var(--font-wire);font-size:13px;letter-spacing:.14em;text-transform:none;color:#241a12;min-width:4.5em;text-align:right}
.tt-wire .lamp{width:8px;height:8px;border-radius:50%;background:#5b3b27;box-shadow:inset 0 0 2px rgba(0,0,0,.8)}
.tt-wire .lamp.on{background:#ffd48a;box-shadow:0 0 5px 1px rgba(255,196,96,.95),0 0 14px 4px rgba(255,170,70,.45)}
@keyframes ttBlink{0%{opacity:1}50%{opacity:0}}

/* ---------------- depth gauge ---------------- */
.tt-depth{position:absolute;right:max(var(--gut),calc(env(safe-area-inset-right) + 16px));top:50%;width:190px;height:min(46vh,380px);
  transform:translateY(-50%);opacity:0;visibility:hidden;font-variant-numeric:tabular-nums lining-nums;will-change:opacity}
.tt-depth .sc{position:absolute;right:34px;top:0;bottom:0;width:1px;background:rgba(233,238,241,.28)}
.tt-depth .gone{position:absolute;right:34px;top:0;width:1px;height:100%;background:linear-gradient(rgba(233,238,241,.25),rgba(233,238,241,.85));transform-origin:50% 0;transform:scaleY(0)}
.tt-depth .tk{position:absolute;right:34px;width:5px;height:1px;background:rgba(233,238,241,.32)}
.tt-depth .tk.M{width:11px;background:rgba(233,238,241,.55)}
.tt-depth .tl{position:absolute;right:0;width:28px;transform:translateY(-50%);font-size:9px;letter-spacing:.06em;color:rgba(233,238,241,.5);text-align:left}
.tt-depth .mk{position:absolute;left:0;right:34px;top:0;height:0;will-change:transform}
.tt-depth .mk .ln{position:absolute;right:-5px;top:0;width:24px;height:1px;background:#f2f4f4;box-shadow:0 0 6px rgba(200,230,240,.5)}
.tt-depth .mk .dot{position:absolute;right:-3.5px;top:-3px;width:7px;height:7px;border-radius:50%;background:#f2f4f4;box-shadow:0 0 8px rgba(190,230,245,.7)}
.tt-depth .rd{position:absolute;right:30px;top:0;transform:translateY(-50%);text-align:right;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.tt-depth .rd .k{font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:#8fa1ad}
.tt-depth .rd .v{margin-top:2px;font-family:var(--font-display);font-size:clamp(22px,calc(.9vw + 13px),34px);line-height:1;letter-spacing:.01em;color:#eef3f5}
.tt-depth .rd .v small{font-size:.5em;letter-spacing:.08em;margin-left:.25em;color:#b6c4cc}
.tt-depth .rd .f{margin-top:4px;font-style:italic;font-size:11px;color:#7f929e}

/* ---------------- controls ---------------- */
.tt-ctl{position:absolute;left:0;right:0;bottom:0;padding:40px max(14px,2.6vw,calc(env(safe-area-inset-right) + 10px)) calc(8px + env(safe-area-inset-bottom)) max(14px,2.6vw,calc(env(safe-area-inset-left) + 10px));
  background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,.5) 50%,rgba(0,0,0,0));opacity:0;visibility:hidden;transform:translateY(10px);
  transition:opacity .4s ease,transform .4s ease,visibility 0s linear .4s}
#tt-ui.ctl .tt-ctl{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .25s ease,transform .25s ease,visibility 0s}
.tt-ctl .meta{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:0 6px 0 8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#98a7b3;white-space:nowrap}
.tt-ctl .chap{overflow:hidden;text-overflow:ellipsis}
.tt-ctl .chap b{font-family:var(--font-display);font-weight:500;color:var(--buff);margin-right:.8em;letter-spacing:.12em}
.tt-ctl .time{font-family:var(--font-display);font-size:13px;letter-spacing:.05em;text-transform:none;color:#e9eef1;font-variant-numeric:tabular-nums lining-nums}
.tt-ctl .time span{color:#8797a3}
.tt-ctl .row{display:flex;align-items:center;gap:4px}
.tt-btn{flex:none;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:#e9eef1;opacity:.82;transition:opacity .2s,background-color .2s}
.tt-btn:hover{opacity:1;background:rgba(233,238,241,.08)}
.tt-btn svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
.tt-btn .fillg{fill:currentColor;stroke:none}
.tt-btn .alt{display:none}
.tt-btn.on .alt{display:inline}.tt-btn.on .std{display:none}
.tt-scrub{position:relative;flex:1;min-width:0;height:40px;margin:0 10px;display:flex;align-items:center;gap:3px;cursor:pointer;touch-action:none}
.tt-seg{position:relative;flex:1 1 0;height:3px;background:rgba(233,238,241,.2);overflow:hidden;transition:height .18s ease,background-color .18s}
.tt-scrub:hover .tt-seg,.tt-scrub.drag .tt-seg,.tt-scrub:focus-visible .tt-seg{height:5px}
.tt-seg.hv{background:rgba(233,238,241,.34)}
.tt-seg i{position:absolute;inset:0;background:linear-gradient(90deg,#dfe6ea,#f4ead6);transform-origin:0 50%;transform:scaleX(0)}
.tt-head{position:absolute;left:0;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#f5f1e8;
  box-shadow:0 0 0 3px rgba(0,0,0,.3),0 0 10px rgba(255,236,200,.35);transition:width .15s,height .15s,margin .15s}
.tt-scrub:hover .tt-head,.tt-scrub.drag .tt-head{width:13px;height:13px;margin:-6.5px 0 0 -6.5px}
.tt-scrub:focus-visible{outline-offset:2px}
.tt-tip{position:absolute;bottom:calc(100% + 2px);left:0;padding:7px 12px 8px;transform:translateX(-50%);white-space:nowrap;text-align:center;
  background:rgba(6,10,16,.94);border:1px solid rgba(233,238,241,.14);opacity:0;visibility:hidden;transition:opacity .15s,visibility 0s linear .15s;pointer-events:none}
.tt-scrub.hov .tt-tip{opacity:1;visibility:visible;transition:opacity .15s,visibility 0s}
.tt-tip b{display:block;font-family:var(--font-display);font-weight:500;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#f1efe8}
.tt-tip span{display:block;margin-top:2px;font-size:11.5px;color:#93a3b1;font-variant-numeric:tabular-nums lining-nums}
.tt-vol{-webkit-appearance:none;appearance:none;flex:none;width:78px;height:30px;margin:0 6px 0 0;background:transparent;cursor:pointer;--v:100%}
.tt-vol::-webkit-slider-runnable-track{height:2px;background:linear-gradient(90deg,#e9eef1 var(--v),rgba(233,238,241,.24) var(--v))}
.tt-vol::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;margin-top:-4.5px;border-radius:50%;background:#f5f1e8;border:0}
.tt-vol::-moz-range-track{height:2px;background:rgba(233,238,241,.24)}
.tt-vol::-moz-range-progress{height:2px;background:#e9eef1}
.tt-vol::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:50%;background:#f5f1e8}
.tt-vol:focus-visible{outline-offset:2px}

/* ---------------- start screen ---------------- */
.tt-start{position:absolute;inset:0;z-index:5;pointer-events:auto;display:grid;place-items:center;text-align:center;overflow:hidden;
  background:radial-gradient(110% 75% at 50% 42%,rgba(11,20,35,.9),rgba(3,6,11,.97) 62%,#020409);transition:opacity 2.2s ease}
.tt-start.out{opacity:0;pointer-events:none}
.tt-start .sky{position:absolute;left:0;right:0;top:0;height:76%;overflow:hidden;-webkit-mask-image:linear-gradient(#000 55%,transparent);mask-image:linear-gradient(#000 55%,transparent)}
.tt-start .mw{position:absolute;left:-20%;top:8%;width:140%;height:44%;transform:rotate(-17deg);
  background:radial-gradient(50% 50% at 50% 50%,rgba(143,166,214,.075),rgba(143,166,214,.03) 45%,transparent 70%)}
.tt-star{position:absolute;left:0;top:0;border-radius:50%}
.tt-start .tw1{animation:ttTw 5.5s ease-in-out infinite}
.tt-start .tw2{animation:ttTw 7.3s ease-in-out -3s infinite}
@keyframes ttTw{0%,100%{opacity:1}50%{opacity:.45}}
.tt-start .sea{position:absolute;left:0;right:0;top:76%;bottom:0;background:linear-gradient(rgba(13,26,46,.42),rgba(3,6,11,0) 60%)}
.tt-start .hz{position:absolute;left:0;right:0;top:76%;height:1px;background:linear-gradient(90deg,transparent,rgba(143,166,214,.24) 22%,rgba(143,166,214,.24) 78%,transparent)}
.tt-start .ship{position:absolute;top:76%;left:min(67%,calc(100% - var(--sw) - 12px));width:var(--sw);--sw:clamp(130px,15vw,250px);transform:translateY(-69.57%);overflow:visible;opacity:.95}
.tt-start .ship .refl{animation:ttShim 3.1s ease-in-out infinite}
@keyframes ttShim{0%,100%{opacity:.85}35%{opacity:.55}70%{opacity:1}}
.tt-start .in{position:relative;padding:24px 16px;max-width:100%;transform:translateY(-7vh)}
.tt-start .ov{font-family:var(--font-display);font-size:clamp(10px,calc(.35vw + 8px),13px);letter-spacing:.7em;padding-left:.7em;color:#8d9daa}
.tt-start h1{margin:.5em 0 0;font-family:var(--font-display);font-weight:400;font-size:clamp(38px,8.6vw,150px);line-height:1;letter-spacing:.42em;padding-left:.42em;
  color:#f4f3ee;white-space:nowrap;text-shadow:0 0 60px rgba(120,150,200,.12)}
.tt-start .tt-orn{margin:clamp(18px,3.4vh,34px) auto}
.tt-start .sub{margin:0;font-style:italic;font-size:clamp(15px,calc(.6vw + 11px),22px);letter-spacing:.05em;color:#cdd5da}
.tt-begin{position:relative;margin-top:clamp(30px,6.4vh,60px);min-width:230px;min-height:54px;padding:0 40px 0 calc(40px + .5em);border:1px solid rgba(233,238,241,.3);
  font-family:var(--font-display);font-size:12.5px;letter-spacing:.5em;text-transform:uppercase;color:#f1efe8;transition:border-color .5s,background-color .5s,color .5s,letter-spacing .8s}
.tt-begin[disabled]{cursor:progress;color:rgba(233,238,241,.5);letter-spacing:.34em}
.tt-begin:not([disabled]):hover{border-color:rgba(212,154,76,.85);background:rgba(212,154,76,.07)}
.tt-begin .pb{position:absolute;left:-1px;right:-1px;bottom:-1px;height:1px;background:var(--buff);transform-origin:0 50%;transform:scaleX(0);transition:transform .6s ease,opacity 1s ease .4s}
.tt-begin .pb.done{opacity:0}
.tt-start .note{margin:20px 0 0;font-size:clamp(12px,calc(.2vw + 10.5px),14px);letter-spacing:.16em;color:#95a4b0}
.tt-start .st{margin:8px 0 0;min-height:1.5em;font-style:italic;font-size:12.5px;letter-spacing:.03em;color:rgba(149,164,176,.72);transition:opacity .8s}
.tt-start .ft{position:absolute;left:0;right:0;bottom:calc(20px + env(safe-area-inset-bottom));font-size:10.5px;letter-spacing:.32em;padding-left:.32em;color:rgba(149,164,176,.5)}
.tt-start .in > *{animation:ttRise 1.8s cubic-bezier(.2,.7,.2,1) both}
.tt-start .in > :nth-child(2){animation-delay:.15s}.tt-start .in > :nth-child(3){animation-delay:.5s}.tt-start .in > :nth-child(4){animation-delay:.7s}
.tt-start .in > :nth-child(5){animation-delay:1s}.tt-start .in > :nth-child(6),.tt-start .in > :nth-child(7){animation-delay:1.2s}
@keyframes ttRise{from{opacity:0;transform:translateY(10px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.tt-catch{position:absolute;inset:0;pointer-events:auto;cursor:pointer}
.tt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}

/* ---------------- narrow screens ---------------- */
@media (max-width:640px){
  .tt-vol{display:none}
  .tt-ctl .row{flex-wrap:wrap}
  .tt-scrub{order:-1;flex:1 1 100%;margin:0 4px;height:34px}
  .tt-ctl .row .sp{flex:1}
  .tt-ctl .meta{font-size:10px;letter-spacing:.16em}
  .tt-depth{width:150px;height:34vh}
  .tt-wire{padding:12px 14px 10px}
  .tt-wire .hd{font-size:9px;letter-spacing:.14em}
  .tt-wire .hd2{font-size:6.5px;letter-spacing:.26em}
  .tt-start .ov{letter-spacing:.5em;padding-left:.5em}
  .tt-start h1{letter-spacing:.32em;padding-left:.32em}
}
@media (min-width:641px){.tt-ctl .row .sp{display:none}}
#tt-ui.still *,#tt-ui.still *::before,#tt-ui.still *::after{animation:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){
  #tt-ui *,#tt-ui *::before,#tt-ui *::after{animation:none!important;transition-duration:.01s!important;transition-delay:0s!important}
}
`;

  // ------------------------------------------------------------------ state
  let root = null;
  let started = false;        // the film has begun (start screen dismissed or skipped)
  let ready = false;          // every module initialised
  const R = {};               // element references
  let caps = [], wires = [];
  let barPx = -1, liftPx = -1, anchorPx = 0, ctlH = 96;
  let lastAct = -1e9, ctlHover = false, focusIn = false, dragging = false, dragT = null, lastSeekAt = 0;
  let ctlOn = false, touchHide = false, ptrType = 'mouse';
  let muted = false, volume = 1;
  let segGeo = null, depthH = 0, depthA = 0, depthVal = 0;
  let loadBase = 0, loadShown = 0, lastSec = -1;
  const SC = (TT.story && TT.story.SCENES) || [{ id: 'all', t0: 0, t1: DUR, label: 'Titanic' }];
  const EV = (TT.story && TT.story.EV) || {};

  const SVG = {
    play: '<svg class="std" viewBox="0 0 24 24" aria-hidden="true"><path class="fillg" d="M8.2 5.4v13.2L18.6 12z"/></svg>' +
      '<svg class="alt" viewBox="0 0 24 24" aria-hidden="true"><path class="fillg" d="M7 5.5h3.1v13H7zM13.9 5.5H17v13h-3.1z"/></svg>',
    vol: '<svg class="std" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.8 9.4h3.4L11.6 5.6v12.8L7.2 14.6H3.8z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>' +
      '<svg class="alt" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.8 9.4h3.4L11.6 5.6v12.8L7.2 14.6H3.8z"/><path d="M15.4 9.6l4.8 4.8M20.2 9.6l-4.8 4.8"/></svg>',
    fs: '<svg class="std" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2V4h5.2M14.8 4H20v5.2M20 14.8V20h-5.2M9.2 20H4v-5.2"/></svg>' +
      '<svg class="alt" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 4v5.2H4M20 9.2h-5.2V4M14.8 20v-5.2H20M4 14.8h5.2V20"/></svg>',
  };
  const LOAD_LABEL = {
    story: 'The log of the voyage', score: 'The score', audio: 'The orchestra', sky: 'The night sky', ocean: 'The North Atlantic',
    ship: 'The ship', props: 'The ice, the lifeboats', fx: 'Light and film', director: 'The camera',
  };
  const FADE = { title: [2.4, 2.0], end: [2.8, 2.2], place: [1.0, 1.1], quote: [0.45, 1.3], caption: [0.9, 1.1] };
  const fsOK = !!(document.documentElement && (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  // ------------------------------------------------------------------ builders
  function starShadows(n, seed, a0, a1, blur, band) {
    const r = U.rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      let x = r() * 100, y;
      if (band) { // clustered along the Milky Way, which climbs from lower left to upper right
        const g = (r() + r() + r() - 1.5) * 9;
        y = 44 - 0.34 * (x - 50) + g;
        if (y < 0 || y > 76) y = r() * 76;
      } else y = Math.pow(r(), 1.15) * 76;
      const a = a0 + (a1 - a0) * Math.pow(r(), 2.2);
      const k = r();
      const col = k < 0.1 ? '255,224,190' : k < 0.42 ? '196,212,255' : '238,242,255';
      out.push(x.toFixed(2) + 'vw ' + y.toFixed(2) + 'vh ' + blur + 'px rgba(' + col + ',' + a.toFixed(2) + ')');
    }
    return out.join(',');
  }

  // A distant, lit Titanic on the horizon, drawn from the canonical hull numbers (metres,
  // bow to the right, seen from starboard). Waterline y = 0 sits at 64/92 of the height.
  function shipSVG() {
    const SH = C.SHIP, r = U.rng('tt-start-ship'), f = (v) => v.toFixed(2);
    const rake = Math.tan(SH.FUNNEL_RAKE);
    let hull = 'M' + f(SH.STERN_WL_X) + ' 0 L' + f(SH.STERN_X) + ' -7';
    for (let x = SH.STERN_X; x <= SH.STEM_X; x += 2) hull += ' L' + f(x) + ' ' + f(-TT.hull.sheer(x));
    hull += ' L' + f(SH.STEM_X) + ' ' + f(-TT.hull.sheer(SH.STEM_X)) + ' L' + f(SH.STEM_X) + ' 0 Z';
    const sx0 = SH.SUPERSTRUCTURE_X[0], sx1 = SH.SUPERSTRUCTURE_X[1];
    const top = '<rect x="' + sx0 + '" y="-19.8" width="' + (sx1 - sx0) + '" height="4.9" fill="#161b24"/>' +
      '<rect x="-58" y="-22.6" width="116" height="2.9" fill="#12161e"/>' +
      '<rect x="' + (SH.BRIDGE_X - 8) + '" y="-23.2" width="8" height="3.5" fill="#141922"/>';
    let fun = '';
    for (const x of SH.FUNNEL_X) {
      const bt = SH.FUNNEL_BASE_Y, tp = SH.FUNNEL_TOP_Y, rx = SH.FUNNEL_RX, dx = (tp - bt) * rake, bk = tp - 3.8, dk = (bk - bt) * rake;
      fun += '<path d="M' + f(x - rx) + ' ' + -bt + 'L' + f(x + rx) + ' ' + -bt + 'L' + f(x + rx - dx) + ' ' + -tp + 'L' + f(x - rx - dx) + ' ' + -tp + 'Z" fill="#2c2217"/>' +
        '<path d="M' + f(x - rx - dk) + ' ' + f(-bk) + 'L' + f(x + rx - dk) + ' ' + f(-bk) + 'L' + f(x + rx - dx) + ' ' + -tp + 'L' + f(x - rx - dx) + ' ' + -tp + 'Z" fill="#07080a"/>';
    }
    const fm = [SH.FOREMAST_X, SH.FOREMAST_TOP_Y], mm = [SH.MAINMAST_X, SH.MAINMAST_TOP_Y];
    const mtop = (m, y0) => f(m[0] - (m[1] - y0) * rake);
    const rig = '<g stroke="#232935" stroke-width=".45" fill="none" opacity=".75">' +
      '<path d="M' + fm[0] + ' -16L' + mtop(fm, 16) + ' ' + -fm[1] + '"/>' +
      '<path d="M' + mm[0] + ' -15.8L' + mtop(mm, 15.8) + ' ' + -mm[1] + '"/>' +
      '<path d="M' + mtop(fm, 16) + ' ' + -fm[1] + 'L' + mtop(mm, 15.8) + ' ' + -mm[1] + '" stroke-width=".22" opacity=".45"/></g>';
    // lights: portholes on the hull decks, brighter promenade and saloon windows above
    let lights = '', refl = '';
    const rows = [[-3.4, 0.55, 0.62], [-6.3, 0.6, 0.66], [-9.2, 0.62, 0.7], [-12.1, 0.66, 0.74], [-17.3, 0.72, 0.9], [-21.2, 0.3, 0.8]];
    for (const [y, keep, br] of rows) {
      const e = TT.hull.ends(-y);
      let x0 = e.aft + 5, x1 = e.fwd - 6;
      if (y < -15) { x0 = sx0 + 2; x1 = sx1 - 2; }
      if (y < -20) { x0 = -56; x1 = 58; }
      for (let x = x0; x <= x1; x += 2.6 + r() * 0.8) {
        if (r() > keep) continue;
        if (y < -11 && y > -15 && ((x > 66 && x < 96) || (x < -80 && x > -104))) continue; // the well decks
        const a = br * (0.55 + 0.45 * r());
        lights += '<circle cx="' + f(x) + '" cy="' + f(y + (r() - 0.5) * 0.3) + '" r="' + (y < -15 ? '.62' : '.5') + '" fill-opacity="' + f(a) + '"/>';
        if (r() < 0.22) {
          const len = 6 + r() * 20, w = 0.5 + r() * 0.7;
          refl += '<rect x="' + f(x - w / 2) + '" y="' + f(0.8 + r() * 1.5) + '" width="' + f(w) + '" height="' + f(len) + '" fill-opacity="' + f(0.1 + 0.3 * a) + '"/>';
        }
      }
    }
    lights += '<circle cx="' + f(fm[0] - 32 * rake) + '" cy="-48" r=".8" fill="#fff4e0"/><circle cx="-133" cy="-14" r=".6" fill="#fff4e0" fill-opacity=".7"/>';
    return '<svg class="ship" viewBox="-140 -64 280 92" aria-hidden="true" focusable="false">' +
      '<defs><filter id="ttGlow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation=".75" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="ttRefl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".5 2.2"/></filter>' +
      '<linearGradient id="ttReflG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb45e"/><stop offset="1" stop-color="#ffb45e" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="refl" fill="url(#ttReflG)" filter="url(#ttRefl)">' + refl + '</g>' +
      '<path d="' + hull + '" fill="#0a0b0e"/>' + top + fun + rig +
      '<g fill="#ffb45e" filter="url(#ttGlow)">' + lights + '</g></svg>';
  }

  function buildStart() {
    const s = el('div', 'tt-start', root);
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    s.setAttribute('aria-labelledby', 'tt-start-title');
    const sky = el('div', 'sky', s);
    el('div', 'mw', sky);
    [[300, 1, 0.16, 0.6, 0, '', 0], [220, 1, 0.12, 0.42, 0, '', 1], [80, 1.5, 0.3, 0.85, 0, 'tw1', 0], [22, 2, 0.55, 1, 1, 'tw2', 0]].forEach((L, i) => {
      const st = el('div', 'tt-star ' + L[5], sky);
      st.style.width = st.style.height = L[1] + 'px';
      st.style.boxShadow = starShadows(L[0], 'tt-stars-' + i, L[2], L[3], L[4], L[6]);
    });
    el('div', 'sea', s);
    el('div', 'hz', s);
    s.insertAdjacentHTML('beforeend', shipSVG());
    const inner = el('div', 'in', s);
    el('div', 'ov', inner, 'R&thinsp;&middot;&thinsp;M&thinsp;&middot;&thinsp;S');
    const h = el('h1', '', inner, 'TITANIC');
    h.id = 'tt-start-title';
    el('div', 'tt-orn', inner, '<i></i><b></b><i></i>');
    el('p', 'sub', inner, 'The night of 14&thinsp;&ndash;&thinsp;15 April 1912');
    const b = el('button', 'tt-begin', inner, '<span class="lb">Preparing</span><i class="pb"></i>');
    b.type = 'button';
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    b.setAttribute('aria-describedby', 'tt-start-note');
    b.addEventListener('click', begin);
    const note = el('p', 'note', inner, 'Sound on &nbsp;&middot;&nbsp; ' + Math.round(DUR / 60) + ' minutes');
    note.id = 'tt-start-note';
    const st = el('p', 'st', inner);
    st.setAttribute('aria-live', 'polite');
    el('div', 'ft', s, '41&deg;&thinsp;46&prime;&thinsp;N &nbsp;&middot;&nbsp; 50&deg;&thinsp;14&prime;&thinsp;W');
    R.start = s; R.begin = b; R.beginLbl = b.querySelector('.lb'); R.pb = b.querySelector('.pb'); R.status = st;
  }

  function buildCaption(c) {
    let node;
    const sub = c.sub ? esc(c.sub) : '';
    switch (c.kind) {
      case 'title':
        node = el('div', 'tt-title', R.caps, '<span class="w">' + esc(c.text) + '</span><span class="r"></span>' + (sub ? '<span class="s">' + sub + '</span>' : ''));
        break;
      case 'place':
        node = el('div', 'tt-place', R.slug, '<span class="r"></span><span class="m">' + esc(c.text) + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : ''));
        break;
      case 'quote':
        node = el('div', 'tt-quote', R.low, '<span class="q">' + esc(c.text) + '</span>' + (sub ? '<span class="a">&mdash;&ensp;' + sub + '</span>' : ''));
        break;
      case 'end':
        node = el('div', 'tt-end', R.caps, '<div class="tt-orn"><i></i><b></b><i></i></div><div class="m">' + esc(c.text) + '</div>' +
          (sub ? '<div class="s">' + sub + '</div>' : '') +
          '<div class="n">2,224 aboard &ensp;&middot;&ensp; more than 1,500 lost &ensp;&middot;&ensp; 705 saved</div>');
        break;
      default:
        node = el('div', 'tt-cap', R.low, esc(c.text));
    }
    node.setAttribute('aria-hidden', 'true');
    return { c, node, vis: false, w: node.querySelector('.w'), w2: node.querySelector('.m'), r: node.querySelector('.r'), s: node.querySelector('.s'), n: node.querySelector('.n'), orn: node.querySelector('.tt-orn') };
  }

  function wireTime(m) {
    if (m.time) return m.time;
    const k = String(m.key || '').slice(0, 3).toUpperCase();
    if (WIRE_TIME[k]) return WIRE_TIME[k];
    const anchors = [];
    for (const c of (TT.story && TT.story.CAPTIONS) || []) {
      if (c.kind !== 'place') continue;
      const v = parseClock(c.text);
      if (v != null) anchors.push([c.t0, v]);
    }
    if (!anchors.length) return '';
    return fmtClock(U.sampleKeys(anchors, m.t0, 'linear'));
  }

  function buildWire(m, idx) {
    const p = el('div', 'tt-wire', root);
    p.setAttribute('aria-hidden', 'true');
    el('div', 'hd', p, 'MARCONI INTERNATIONAL MARINE');
    el('div', 'hd2', p, 'COMMUNICATION COMPANY, LIMITED');
    const time = wireTime(m);
    const pc = parseClock(time);
    const date = pc != null && pc >= 60 ? '15 April 1912' : '14 April 1912';
    el('div', 'kv', p, '<i>Office</i><b>' + esc(m.from || 'MGY') + '</b><i>Time</i><b>' + esc(time) + '</b>' +
      '<i>To</i><b>All stations</b><i>Date</i><b>' + date + '</b>');
    const msg = el('div', 'msg', p);
    const lead = el('span', 'on cur', msg);
    lead.textContent = '​';
    const rnd = U.rng('tt-wire-' + idx);
    const chars = (m.timing && m.timing.chars) || [];
    const spans = chars.map((c) => {
      const s = el('span', '', msg);
      s.textContent = c.ch;
      // a typewriter's uneven strike: tiny baseline and ink-density variation per character
      s.style.top = ((rnd() - 0.5) * 1.1).toFixed(2) + 'px';
      s.style.opacity = (0.76 + 0.24 * rnd()).toFixed(2);
      return s;
    });
    const ft = el('div', 'ft', p);
    el('span', '', ft, 'Keyed at ' + (m.wpm || 22) + ' w.p.m.');
    const k = el('span', 'k', ft);
    const code = el('span', 'code', k);
    const lamp = el('i', 'lamp', k);
    // index of each character's first Morse element in m.timing.tones
    let ti = 0;
    const toneIdx = chars.map((c) => {
      const cd = c.ch !== ' ' ? TT.morse.CODE[c.ch.toUpperCase()] : null;
      const s = ti;
      if (cd) ti += cd.length;
      return s;
    });
    return { m, p, lead, spans, code, lamp, toneIdx, n: 0, vis: false, announced: false };
  }

  function buildDepth() {
    const d = el('div', 'tt-depth', root);
    d.setAttribute('aria-hidden', 'true');
    const MAXD = 3800;
    el('div', 'sc', d);
    R.dGone = el('div', 'gone', d);
    const marks = [];
    for (let m = 0; m < MAXD; m += 250) marks.push(m);
    marks.push(MAXD);
    for (const m of marks) {
      const major = m % 1000 === 0 || m === MAXD;
      const tk = el('div', 'tk' + (major ? ' M' : ''), d);
      tk.style.top = (m / MAXD * 100).toFixed(3) + '%';
      if (major && MAXD - m > 400 || m === MAXD) {
        const l = el('div', 'tl', d, m === 0 ? '0' : fmtInt(m));
        l.style.top = (m / MAXD * 100).toFixed(3) + '%';
      }
    }
    R.dMk = el('div', 'mk', d);
    el('div', 'ln', R.dMk);
    el('div', 'dot', R.dMk);
    const rd = el('div', 'rd', R.dMk);
    el('div', 'k', rd, 'Depth');
    R.dVal = el('div', 'v', rd);
    R.dSub = el('div', 'f', rd);
    R.depth = d;
  }

  function button(parent, cls_, label, html) {
    const b = el('button', 'tt-btn ' + cls_, parent, html);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  function buildControls() {
    const c = el('div', 'tt-ctl', root);
    c.setAttribute('role', 'group');
    c.setAttribute('aria-label', 'Playback controls');
    const meta = el('div', 'meta', c);
    R.chap = el('div', 'chap', meta);
    R.time = el('div', 'time', meta, '<b class="e">0:00</b><span> / ' + fmtTime(DUR) + '</span>');
    R.timeE = R.time.querySelector('.e');
    R.timeE.style.fontWeight = '400';
    const row = el('div', 'row', c);
    R.play = button(row, 'play', 'Play (Space)', SVG.play);
    R.play.addEventListener('click', () => togglePlay());
    const sc = el('div', 'tt-scrub', row);
    sc.tabIndex = 0;
    sc.setAttribute('role', 'slider');
    sc.setAttribute('aria-label', 'Seek');
    sc.setAttribute('aria-valuemin', '0');
    sc.setAttribute('aria-valuemax', String(DUR));
    R.segs = SC.map((s, i) => {
      const d = el('div', 'tt-seg', sc);
      d.style.flexGrow = String(Math.max(0.1, s.t1 - s.t0));
      return { s, d, f: el('i', '', d), i };
    });
    R.head = el('div', 'tt-head', sc);
    R.tip = el('div', 'tt-tip', sc, '<b></b><span></span>');
    R.tipB = R.tip.querySelector('b'); R.tipS = R.tip.querySelector('span');
    R.scrub = sc;
    el('div', 'sp', row);
    R.mute = button(row, 'mute', 'Mute (M)', SVG.vol);
    R.mute.addEventListener('click', () => setMute(!muted));
    const v = el('input', 'tt-vol', row);
    v.type = 'range'; v.min = '0'; v.max = '1'; v.step = '0.01';
    v.setAttribute('aria-label', 'Volume');
    v.addEventListener('input', () => setVol(parseFloat(v.value)));
    R.vol = v;
    R.fs = button(row, 'fs', 'Full screen (F)', SVG.fs);
    R.fs.addEventListener('click', toggleFullscreen);
    if (!fsOK) R.fs.style.display = 'none';
    R.ctl = c; R.ctlRow = row;

    c.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') ctlHover = true; });
    c.addEventListener('pointerleave', () => { ctlHover = false; });
    c.addEventListener('focusin', () => { focusIn = true; });
    c.addEventListener('focusout', () => { setTimeout(() => { focusIn = !!(R.ctl && R.ctl.contains(document.activeElement)); }, 0); });
    bindScrub();
  }

  function buildAgain() {
    const a = el('div', 'tt-again', root);
    el('div', 'w', a, 'TITANIC');
    const b = el('button', 'tt-ghost', a, 'Watch again');
    b.type = 'button';
    b.addEventListener('click', () => { restart(); poke(); });
    R.again = a;
  }

  // ------------------------------------------------------------------ actions
  function poke() { lastAct = performance.now(); touchHide = false; }
  function nowT() { return clamp(TT.clock.now(), 0, DUR); }

  function begin() {
    if (started || !ready) return;
    started = true;
    const t0 = PRM.t != null ? clamp(parseFloat(PRM.t) || 0, 0, DUR) : 0;
    try {
      if (TT.start) {
        const p = TT.start(t0); // inside the user gesture: the audio context resumes here
        if (p && p.then) p.then(applyAudioPrefs, applyAudioPrefs);
      } else TT.clock.play(t0);
    } catch (e) { TT.error('ui start', e); }
    applyAudioPrefs();
    if (R.start) {
      const s = R.start;
      s.classList.add('out');
      s.setAttribute('aria-hidden', 'true');
      if (s.contains(document.activeElement)) document.activeElement.blur();
      setTimeout(() => { s.remove(); }, reduced ? 50 : 2400);
      R.start = null;
    }
    if (R.catcher) { R.catcher.remove(); R.catcher = null; }
    lastAct = -1e9;
  }

  function applyAudioPrefs() {
    const A = TT.audio;
    if (!A) return;
    try { if (A.setVolume) A.setVolume(volume); if (A.setMuted) A.setMuted(muted); } catch (e) { TT.error('ui audio prefs', e); }
  }

  function restart() {
    TT.seek(0);
    if (!TT.clock.playing) TT.clock.play(0);
  }

  function togglePlay() {
    if (!started) { begin(); return; }
    const t = TT.clock.now();
    if (t >= DUR - 0.05) restart();
    else if (TT.clock.playing) TT.clock.pause();
    else TT.clock.play();
    poke();
  }

  function seekTo(t) { TT.seek(clamp(t, 0, DUR - 0.01)); lastSeekAt = performance.now(); }
  function seekBy(d) { seekTo(nowT() + d); }
  function sceneIndexAt(t) { let i = 0; for (let k = 0; k < SC.length; k++) if (t >= SC[k].t0) i = k; return i; }

  function setMute(m) {
    muted = !!m;
    try { if (TT.audio && TT.audio.setMuted) TT.audio.setMuted(muted); } catch (e) { TT.error('ui mute', e); }
    syncAudioUI();
  }
  function setVol(v) {
    volume = clamp(isNaN(v) ? 1 : v);
    try { if (TT.audio && TT.audio.setVolume) TT.audio.setVolume(volume); } catch (e) { TT.error('ui volume', e); }
    store('vol', volume.toFixed(2));
    if (volume > 0 && muted) setMute(false); else syncAudioUI();
  }
  function syncAudioUI() {
    if (!R.mute) return;
    const off = muted || volume <= 0.001;
    cls(R.mute, 'on', off);
    R.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    R.mute.setAttribute('aria-label', muted ? 'Unmute (M)' : 'Mute (M)');
    R.mute.title = muted ? 'Unmute (M)' : 'Mute (M)';
    R.vol.value = String(volume);
    R.vol.style.setProperty('--v', (off ? 0 : volume * 100).toFixed(1) + '%');
  }

  function toggleFullscreen() {
    try {
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const d = document.documentElement;
        const p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* not permitted here */ }
  }
  function onFsChange() {
    if (!R.fs) return;
    const on = !!fsEl();
    cls(R.fs, 'on', on);
    R.fs.setAttribute('aria-label', on ? 'Exit full screen (F)' : 'Full screen (F)');
    R.fs.title = R.fs.getAttribute('aria-label');
  }

  // ------------------------------------------------------------------ scrubber
  function measure() {
    if (R.scrub) {
      segGeo = R.segs.map((g) => ({ x: g.d.offsetLeft, w: Math.max(1, g.d.offsetWidth) }));
    }
    if (R.depth) depthH = R.depth.offsetHeight;
    if (R.ctl) ctlH = Math.max(40, R.ctl.offsetHeight - 40);
    liftPx = -1;
  }
  function timeAtX(x) {
    if (!segGeo) measure();
    const g = segGeo;
    for (let i = 0; i < g.length; i++) {
      const s = g[i], sc = SC[i];
      const edge = i + 1 < g.length ? (s.x + s.w + g[i + 1].x) / 2 : Infinity;
      if (x < edge) return sc.t0 + clamp((x - s.x) / s.w) * (sc.t1 - sc.t0);
    }
    return DUR;
  }
  function headX(t) {
    if (!segGeo) measure();
    const i = sceneIndexAt(t), s = segGeo[i], sc = SC[i];
    return s.x + clamp((t - sc.t0) / Math.max(1e-6, sc.t1 - sc.t0)) * s.w;
  }
  function showTip(clientX) {
    const r = R.scrub.getBoundingClientRect();
    const x = clamp(clientX - r.left, 0, r.width);
    const t = timeAtX(x), i = sceneIndexAt(t);
    text(R.tipB, ROMAN[i] + ' ' + SC[i].label);
    text(R.tipS, fmtTime(t));
    // keep the tooltip inside the screen
    const half = (R.tip.offsetWidth || 160) / 2;
    const px = clamp(x, half - r.left + 8, window.innerWidth - r.left - half - 8);
    css(R.tip, 'left', px.toFixed(1) + 'px');
    R.segs.forEach((g) => cls(g.d, 'hv', g.i === i));
    return t;
  }
  function bindScrub() {
    const sc = R.scrub;
    const hoverOff = () => { cls(sc, 'hov', false); R.segs.forEach((g) => cls(g.d, 'hv', false)); };
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !started) return;
      e.preventDefault();
      dragging = true;
      try { sc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      cls(sc, 'drag', true);
      measure();
      dragT = showTip(e.clientX);
      cls(sc, 'hov', true);
      seekTo(dragT);
      poke();
    });
    sc.addEventListener('pointermove', (e) => {
      if (!dragging && e.pointerType !== 'mouse') return;
      const t = showTip(e.clientX);
      cls(sc, 'hov', true);
      if (dragging) {
        dragT = t;
        if (performance.now() - lastSeekAt > 90) seekTo(t);
      }
      poke();
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      cls(sc, 'drag', false);
      if (dragT != null) seekTo(dragT);
      dragT = null;
      if (e.pointerType !== 'mouse') hoverOff();
    };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    sc.addEventListener('pointerleave', () => { if (!dragging) hoverOff(); });
    sc.addEventListener('keydown', (e) => {
      const t = nowT(), i = sceneIndexAt(t);
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        if (e.key === 'PageUp') seekTo(i + 1 < SC.length ? SC[i + 1].t0 : DUR - 0.01);
        else seekTo(t - SC[i].t0 > 2 || i === 0 ? SC[i].t0 : SC[i - 1].t0);
        poke();
      } else if (e.key === 'End') { e.preventDefault(); seekTo(DUR - 0.01); poke(); }
    });
  }

  // ------------------------------------------------------------------ input
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key, tag = e.target && e.target.tagName;
    const isBtn = tag === 'BUTTON', isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!started) {
      if ((k === 'Enter' || k === ' ' || k === 'Spacebar') && !isBtn && ready) { e.preventDefault(); begin(); }
      return;
    }
    poke();
    switch (k) {
      case ' ': case 'Spacebar':
        if (isBtn || isInput) return;
        e.preventDefault(); togglePlay(); break;
      case 'k': case 'K': togglePlay(); break;
      case 'ArrowLeft': if (isInput) return; e.preventDefault(); seekBy(-5); break;
      case 'ArrowRight': if (isInput) return; e.preventDefault(); seekBy(5); break;
      case 'm': case 'M': setMute(!muted); break;
      case 'f': case 'F': if (fsOK) toggleFullscreen(); break;
      case 'Home': if (isInput) return; e.preventDefault(); restart(); break;
      default: break;
    }
  }

  function bindGlobal() {
    document.addEventListener('keydown', onKey);
    let lx = -1, ly = -1;
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) < 2) return;
      lx = e.clientX; ly = e.clientY;
      poke();
    }, { passive: true });
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    if (R.stage) {
      const st = R.stage;
      st.addEventListener('pointerdown', (e) => { ptrType = e.pointerType || 'mouse'; });
      st.addEventListener('click', () => {
        if (!started) return;
        if (ptrType === 'mouse') {
          if (TT.clock.now() < DUR - 0.05) togglePlay(); // at the end, restarting takes the "Watch again" button
          return;
        }
        // touch: first tap reveals the controls, a second tap hides them again
        if (ctlOn) { touchHide = true; lastAct = -1e9; } else poke();
      });
      st.addEventListener('dblclick', () => { if (ptrType === 'mouse' && fsOK && started) toggleFullscreen(); });
    }
    if (typeof ResizeObserver !== 'undefined' && R.scrub) {
      try { new ResizeObserver(() => { segGeo = null; liftPx = -1; }).observe(R.scrub); } catch (e) { /* ignore */ }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { segGeo = null; measure(); });
  }

  // ------------------------------------------------------------------ loading
  function onProgress(d) {
    if (!d || ready) return;
    const n = Math.max(1, TT.modules.length);
    let f = +d.f || 0;
    if (d.abs || (d.label && TT[d.label] && TT[d.label].name === d.label)) loadBase = Math.max(loadBase, f); // a module finished / absolute progress
    else f = loadBase + clamp(f) / n;                                                           // a module's own progress
    loadShown = Math.max(loadShown, clamp(f));
    if (R.pb) css(R.pb, 'transform', 'scaleX(' + loadShown.toFixed(3) + ')');
    if (R.status && d.label) text(R.status, LOAD_LABEL[d.label] || String(d.label).slice(0, 48));
  }
  function onReady() {
    ready = true;
    if (R.begin) {
      css(R.pb, 'transform', 'scaleX(1)');
      R.pb.classList.add('done');
      R.begin.disabled = false;
      R.begin.removeAttribute('aria-busy');
      text(R.beginLbl, 'Begin');
      text(R.status, TT.errors && TT.errors.length ? '' : ' ');
    }
    measure();
  }

  // ------------------------------------------------------------------ per-frame
  function announce(c) {
    if (R.live && started) text(R.live, c.text + (c.sub ? '. ' + c.sub : ''));
  }

  function updateCap(o, t) {
    const c = o.c, k = c.kind, f = FADE[k] || FADE.caption;
    const ain = sstep(c.t0, c.t0 + f[0], t), aout = 1 - sstep(c.t1 - f[1], c.t1, t);
    const a = ain * aout;
    if (a <= 0.002) {
      if (o.vis) { o.vis = false; css(o.node, 'visibility', 'hidden'); css(o.node, 'opacity', '0'); }
      return;
    }
    if (!o.vis) { o.vis = true; css(o.node, 'visibility', 'visible'); announce(c); }
    const u = 1 - ain, v = 1 - aout;
    css(o.node, 'opacity', (k === 'title' ? Math.pow(a, 1.3) : a).toFixed(3));
    if (!reduced) {
      const blur = k === 'title' ? 14 * u * u + 7 * v * v : k === 'end' ? 8 * u * u + 3 * v : k === 'quote' ? 4 * u + 3 * v : 3.2 * u + 2.4 * v;
      css(o.node, 'filter', blur > 0.04 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none');
    }
    const grow = (d, dur) => (reduced ? 1 : U.easeOutCubic(clamp((t - c.t0 - d) / dur))).toFixed(4);
    if (k === 'title') {
      // the letters drift apart slowly while the title holds
      const p = clamp((t - c.t0) / Math.max(1, c.t1 - c.t0));
      const narrow = window.innerWidth < 641;
      const ls = reduced ? (narrow ? 0.33 : 0.47) : narrow ? U.lerp(0.27, 0.38, p) : U.lerp(0.4, 0.54, p);
      const s = ls.toFixed(4) + 'em';
      css(o.w, 'letterSpacing', s);
      css(o.w, 'paddingLeft', s);
      if (o.r) css(o.r, 'transform', 'scaleX(' + grow(0.9, 3.0) + ')');
      if (o.s) css(o.s, 'opacity', sstep(c.t0 + 1.7, c.t0 + 3.6, t).toFixed(3));
    } else if (k === 'place') {
      // the slug settles: tracking tightens a little as it arrives
      if (o.w2 && !reduced) css(o.w2, 'letterSpacing', (0.3 + 0.08 * u * u + 0.03 * v).toFixed(4) + 'em');
      if (o.r) css(o.r, 'transform', 'scaleX(' + grow(0, 1.8) + ')');
      if (o.s) css(o.s, 'opacity', sstep(c.t0 + 0.5, c.t0 + 1.7, t).toFixed(3));
    } else if (k === 'end') {
      if (o.orn) css(o.orn, 'transform', 'scaleX(' + grow(0, 3.4) + ')');
      if (o.s) css(o.s, 'opacity', sstep(c.t0 + 1.4, c.t0 + 3.2, t).toFixed(3));
      if (o.n) css(o.n, 'opacity', sstep(c.t0 + 2.8, c.t0 + 4.8, t).toFixed(3));
    } else if (!reduced) {
      // captions rise a few pixels as they arrive
      css(o.node, 'transform', 'translateY(' + (5 * u * u - 2 * v).toFixed(2) + 'px)');
    }
  }

  function updateWire(w, t) {
    const m = w.m, chars = m.timing.chars, tones = m.timing.tones;
    const ain = sstep(m.t0 - 1.5, m.t0 - 0.3, t), aout = 1 - sstep(m.t1 + 3.0, m.t1 + 3.9, t);
    const a = ain * aout;
    if (a <= 0.002) {
      if (w.vis) { w.vis = false; css(w.p, 'visibility', 'hidden'); css(w.p, 'opacity', '0'); }
      return;
    }
    if (!w.vis) { w.vis = true; css(w.p, 'visibility', 'visible'); }
    css(w.p, 'opacity', a.toFixed(3));
    if (!reduced) {
      const u = 1 - ain, v = 1 - aout;
      css(w.p, 'transform', 'translateY(' + (-10 * u * u - 4 * v).toFixed(2) + 'px)');
      const b = 4 * u * u + 2.5 * v;
      css(w.p, 'filter', b > 0.04 ? 'blur(' + b.toFixed(2) + 'px)' : 'none');
    }
    if (!w.announced && t >= m.t0 && t < m.t1) { w.announced = true; if (R.live && started) text(R.live, 'Wireless from ' + (m.from || 'MGY') + ': ' + m.key); }
    if (t < m.t0 - 2) w.announced = false;
    // characters appear exactly when their Morse letter starts being keyed
    const n = U.bsearch(chars, t, (c) => c.t0) + 1;
    if (n !== w.n) {
      const lo = Math.min(n, w.n), hi = Math.max(n, w.n);
      for (let i = lo; i < hi; i++) w.spans[i].classList.toggle('on', i < n);
      (w.n > 0 ? w.spans[w.n - 1] : w.lead).classList.remove('cur');
      (n > 0 ? w.spans[n - 1] : w.lead).classList.add('cur');
      w.n = n;
    }
    cls(w.p, 'keying', t >= m.t0 && t < m.t1);
    // the key lamp follows every dot and dash
    const ti = U.bsearch(tones, t, (x) => x.t);
    cls(w.lamp, 'on', ti >= 0 && t < tones[ti].t + tones[ti].d);
    let code = '';
    const ci = n - 1;
    if (ci >= 0 && t < m.t1 + 0.25) {
      const ch = chars[ci].ch, cd = ch !== ' ' ? TT.morse.CODE[ch.toUpperCase()] : null;
      if (cd) {
        const shown = clamp(ti - w.toneIdx[ci] + 1, 0, cd.length);
        code = ch.toUpperCase() + ' ' + cd.slice(0, shown).replace(/\./g, '·').replace(/-/g, '–').split('').join(' ');
      }
    }
    text(w.code, code);
  }

  function updateDepth(S, t, dt) {
    if (!R.depth) return;
    const g = (S.env && S.env.depthGauge) || 0;
    const target = g > 0 ? 1 : 0;
    depthA = S.seek || reduced ? target : U.damp(depthA, target, target ? 2.6 : 1.8, dt);
    if (g > 0) depthVal = g;
    if (depthA < 0.003) {
      if (R.depth._vis) { R.depth._vis = false; css(R.depth, 'visibility', 'hidden'); css(R.depth, 'opacity', '0'); }
      return;
    }
    if (!R.depth._vis) { R.depth._vis = true; css(R.depth, 'visibility', 'visible'); depthH = R.depth.offsetHeight; }
    css(R.depth, 'opacity', depthA.toFixed(3));
    const f = clamp(depthVal / 3800);
    css(R.dMk, 'transform', 'translateY(' + (f * depthH).toFixed(1) + 'px)');
    css(R.dGone, 'transform', 'scaleY(' + f.toFixed(4) + ')');
    const v = Math.round(depthVal);
    if (R.dVal._v !== v) {
      R.dVal._v = v;
      R.dVal.innerHTML = fmtInt(v) + '<small>m</small>';
      text(R.dSub, fmtInt(v / 1.8288) + ' fathoms');
    }
  }

  function updateControls(t) {
    if (!R.ctl) return;
    const now = performance.now();
    const playing = TT.clock.playing && t < DUR - 0.05;
    const want = started && (FORCE_CTL || dragging || ctlHover || focusIn || !TT.clock.playing || (!touchHide && now - lastAct < 2500));
    if (want !== ctlOn) { ctlOn = want; cls(root, 'ctl', want); if (want) measure(); }
    cls(root, 'idle', started && !want && TT.clock.playing);
    const lift = ctlOn ? Math.max(0, Math.round(ctlH + 34 - anchorPx)) : 0;
    if (lift !== liftPx) { liftPx = lift; css(root, '--lift', lift + 'px'); }

    const tt = dragging && dragT != null ? dragT : t;
    const si = sceneIndexAt(tt);
    for (const g of R.segs) {
      const f = g.i < si ? 1 : g.i > si ? 0 : clamp((tt - g.s.t0) / Math.max(1e-6, g.s.t1 - g.s.t0));
      css(g.f, 'transform', 'scaleX(' + f.toFixed(4) + ')');
    }
    css(R.head, 'transform', 'translateX(' + headX(tt).toFixed(1) + 'px)');
    const sec = Math.floor(tt + 1e-6);
    if (sec !== lastSec) {
      lastSec = sec;
      text(R.timeE, fmtTime(tt));
      R.scrub.setAttribute('aria-valuenow', String(sec));
      R.scrub.setAttribute('aria-valuetext', fmtTime(tt) + ', ' + SC[si].label);
    }
    if (R.chap._si !== si) { R.chap._si = si; R.chap.innerHTML = '<b>' + ROMAN[si] + '</b>' + esc(SC[si].label); }
    cls(R.play, 'on', playing);
    if (R.play._pl !== playing) {
      R.play._pl = playing;
      const l = playing ? 'Pause (Space)' : 'Play (Space)';
      R.play.setAttribute('aria-label', l);
      R.play.title = l;
    }
  }

  function update(t, dt, ctx) {
    if (!root) return;
    if (!started && ctx && !ctx.preshow) { // started elsewhere (e.g. TT.start from the console)
      started = true;
      if (R.start) { R.start.remove(); R.start = null; }
      if (R.catcher) { R.catcher.remove(); R.catcher = null; }
    }
    if (HIDE) return;
    const S = (ctx && ctx.S) || TT.S;
    const w = window.innerWidth, h = window.innerHeight;

    // letterbox: 2.39:1, eased in as the film opens; capped on narrow / portrait screens
    const cam = ctx && ctx.camera;
    let L = cam && cam.userData && cam.userData.letterbox != null ? cam.userData.letterbox : S.grade.letterbox;
    L = clamp(+L || 0) * (started ? (reduced ? 1 : sstep(1.5, 6.0, t)) : 0);
    const full = Math.max(0, (h - w / 2.39) / 2);
    const capB = h * U.lerp(0.12, 0.25, sstep(1.2, 1.6, w / Math.max(1, h)));
    const bar = Math.round(Math.min(full, capB) * L);
    if (bar !== barPx) { barPx = bar; css(root, '--bar', bar + 'px'); }
    anchorPx = Math.max(bar * 0.5, 0.08 * h);

    for (const o of caps) if (o.vis || (t >= o.c.t0 && t <= o.c.t1)) updateCap(o, t);
    for (const wv of wires) if (wv.vis || (t >= wv.m.t0 - 1.6 && t <= wv.m.t1 + 4)) updateWire(wv, t);
    updateDepth(S, t, dt);
    updateControls(t);
    cls(root, 'ended', started && t >= DUR - 0.05);
  }

  // ------------------------------------------------------------------ module
  TT.register('ui', {
    order: 80,
    async init(ctx) {
      TT.on('progress', onProgress);
      TT.on('ready', onReady);
      TT.on('end', () => poke());
      if (!document.body) return;
      const st = document.createElement('style');
      st.id = 'tt-ui-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
      root = el('div', '', document.body);
      root.id = 'tt-ui';
      if (PRM.freeze === '1') root.classList.add('still');
      started = NOSTART || !ctx.preshow;
      const v = parseFloat(store('vol'));
      if (!isNaN(v)) volume = clamp(v);
      if (HIDE) {
        // no overlay at all; an invisible surface still lets a click or Enter start the film
        if (!started) {
          R.catcher = el('div', 'tt-catch', root);
          R.catcher.addEventListener('click', begin);
        }
        document.addEventListener('keydown', onKey);
        return;
      }
      R.stage = el('div', 'tt-stage', root);
      el('div', 'tt-lb t', root);
      el('div', 'tt-lb b', root);
      R.caps = el('div', '', root);
      R.low = el('div', 'tt-low', root);
      R.slug = el('div', 'tt-slug', root);
      caps = ((TT.story && TT.story.CAPTIONS) || []).map(buildCaption);
      wires = ((TT.story && TT.story.TELEGRAPH) || []).filter((m) => m.timing).map(buildWire);
      buildDepth();
      buildAgain();
      buildControls();
      R.live = el('div', 'tt-sr', root);
      R.live.setAttribute('aria-live', 'polite');
      if (!started) buildStart();
      bindGlobal();
      syncAudioUI();
      onFsChange();
      measure();
    },
    update,
    resize() { segGeo = null; barPx = -1; measure(); },
    // public helpers
    begin, togglePlay, restart,
    isStarted: () => started,
  });
})();
