/* 第二版共用组件：节拍换算、动态字、身份卡、3D 屏幕、座位桌、颗粒与冲击。 */
import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import cues from '../cues.json';

export const INK = '#0d0a09';
export const PANEL = '#1a1512';
export const BONE = '#ece3d2';
export const DIM = '#8a7f70';
export const GOLD = '#c9a24a';
export const BLOOD = '#c0392f';
export const MOONBLUE = '#7f9cc4';
export const SERIF = '"Noto Serif SC", serif';
export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const FPS = 30;
export const BEAT = Math.round((60 / cues.bpm) * FPS); // 18 帧
export const b2f = (beat: number) => Math.round(beat * BEAT);
export type SectionId = keyof typeof cues.sections;
export const SECTION = (id: SectionId) => {
  const [a, z] = cues.sections[id];
  return {from: b2f(a), dur: b2f(z - a), beat0: a};
};
export const TOTAL = b2f(cues.beats + cues.tail);
export const asset = (f: string) => staticFile(`assets/${f}`);

export const ease = Easing.bezier(0.22, 1, 0.36, 1); // 快出慢停
export const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

/** 从某帧起的弹簧（0→1）。 */
export const useSpring = (at: number, cfg: {damping?: number; stiffness?: number; mass?: number} = {}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - at, fps, config: {damping: 16, stiffness: 170, mass: 0.9, ...cfg}});
};

/** 相对当前序列：某拍（相对本幕起点）对应的帧。 */
export const lb = (beat: number) => b2f(beat);

/* ---------------- 动态字 ---------------- */

/** 遮罩上推出现的一行大字；可选整体在 out 帧收掉。 */
export const RiseText: React.FC<{
  at: number;
  out?: number;
  size: number;
  color?: string;
  weight?: number;
  spacing?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({at, out, size, color = BONE, weight = 700, spacing = '0.06em', children, style}) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [at, at + 14], [0, 1], {...clamp, easing: ease});
  const o = out === undefined ? 1 : interpolate(frame, [out, out + 8], [1, 0], clamp);
  const blur = out === undefined ? 0 : interpolate(frame, [out, out + 8], [0, 10], clamp);
  return (
    <div style={{overflow: 'hidden', lineHeight: 1.15, paddingBottom: size * 0.08, opacity: o, filter: `blur(${blur}px)`, ...style}}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: size,
          fontWeight: weight,
          color,
          letterSpacing: interpolate(k, [0, 1], [0.3, 0]) + parseFloat(spacing) + 'em',
          transform: `translateY(${(1 - k) * 110}%)`,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** 小号拉丁副标（暗金、宽字距），逐字母浮现。 */
export const Latin: React.FC<{at: number; out?: number; text: string; size?: number; color?: string; style?: React.CSSProperties}> = ({
  at,
  out,
  text,
  size = 22,
  color = GOLD,
  style,
}) => {
  const frame = useCurrentFrame();
  const o = out === undefined ? 1 : interpolate(frame, [out, out + 8], [1, 0], clamp);
  return (
    <div style={{fontFamily: SERIF, fontSize: size, letterSpacing: '0.5em', color, fontWeight: 500, opacity: o, whiteSpace: 'nowrap', ...style}}>
      {text.split('').map((ch, i) => (
        <span key={i} style={{opacity: interpolate(frame, [at + i * 0.8, at + i * 0.8 + 6], [0, 1], clamp)}}>
          {ch}
        </span>
      ))}
    </div>
  );
};

/** 逐字打出的引语，hl 区间上色。 */
export const Typed: React.FC<{
  at: number;
  text: string;
  cps?: number; // 每帧几个字
  size: number;
  hl?: [number, number, string][];
  style?: React.CSSProperties;
}> = ({at, text, cps = 1.4, size, hl = [], style}) => {
  const frame = useCurrentFrame();
  const shown = Math.max(0, Math.floor((frame - at) * cps));
  return (
    <div style={{fontFamily: SERIF, fontSize: size, color: BONE, fontWeight: 500, lineHeight: 1.55, letterSpacing: '0.04em', ...style}}>
      {text.split('').map((ch, i) => {
        const h = hl.find(([a, z]) => i >= a && i < z);
        const born = at + i / cps;
        const k = interpolate(frame, [born, born + 5], [0, 1], clamp);
        return (
          <span
            key={i}
            style={{
              opacity: i < shown ? k : 0,
              color: h ? h[2] : undefined,
              fontWeight: h ? 900 : undefined,
              textShadow: h ? `0 0 ${24 * k}px ${h[2]}88` : undefined,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};

/* ---------------- 身份卡（仿界面 role-detail 版式，美术用项目原图） ---------------- */

export type Role = {code: string; name: string; glyph: string; camp: 'wolf' | 'good' | 'mid'; desc: string};
export const ROLES: Role[] = [
  {code: 'WOLF', name: '狼人', glyph: '狼', camp: 'wolf', desc: '夜间与同伴共谋一次袭击'},
  {code: 'VILLAGER', name: '村民', glyph: '民', camp: 'good', desc: '仅有一票之权 · 无夜技'},
  {code: 'SEER', name: '预言家', glyph: '预', camp: 'good', desc: '每夜查验一人之阵营'},
  {code: 'WITCH', name: '女巫', glyph: '巫', camp: 'good', desc: '解药、毒药 · 各限一次'},
  {code: 'HUNTER', name: '猎人', glyph: '猎', camp: 'good', desc: '出局时可开枪带走一人'},
  {code: 'FOX', name: '狐狸', glyph: '狐', camp: 'good', desc: '试查狼群 · 一错即失能'},
  {code: 'ANGEL', name: '天使', glyph: '天', camp: 'mid', desc: '首日被逐 · 第三方独胜'},
  {code: 'SCAPEGOAT', name: '替罪羊', glyph: '替', camp: 'good', desc: '平票之日 · 代其受刑'},
  {code: 'MASON', name: '共济会', glyph: '砖', camp: 'good', desc: '首夜互认 · 建立信任链'},
  {code: 'SUPER_SAINT', name: '圣徒', glyph: '圣', camp: 'good', desc: '若遭放逐 · 民阵一败'},
  {code: 'GUARD', name: '守卫', glyph: '守', camp: 'good', desc: '每夜守护一人免于袭击'},
  {code: 'CUPID', name: '丘比特', glyph: '丘', camp: 'good', desc: '首夜连情 · 共生共死'},
  {code: 'IDIOT', name: '白痴', glyph: '痴', camp: 'good', desc: '免于放逐 · 但从此哑票'},
  {code: 'ELDER', name: '长老', glyph: '老', camp: 'good', desc: '一命尚可 · 赦免于袭'},
  {code: 'WILD_CHILD', name: '野孩子', glyph: '孩', camp: 'good', desc: '首夜择榜样 · 榜样死则转狼'},
  {code: 'CURSED', name: '被诅咒者', glyph: '咒', camp: 'good', desc: '一旦被杀 · 立即转狼'},
  {code: 'BLESSED', name: '受祝福者', glyph: '祝', camp: 'good', desc: '被祝福者 · 首夜免死'},
  {code: 'WOLF_KING', name: '狼王', glyph: '王', camp: 'wolf', desc: '出局时可开枪带走一人'},
  {code: 'WHITE_WOLF', name: '白狼王', glyph: '白', camp: 'wolf', desc: '白天可自爆并带走一名玩家'},
  {code: 'BEAUTY', name: '狼美人', glyph: '美', camp: 'wolf', desc: '首夜可魅惑一人 · 共赴黄泉'},
];
export const role = (code: string) => ROLES.find((r) => r.code === code)!;
const campLabel = {wolf: 'WOLF · 狼阵', good: 'GOOD · 民阵', mid: 'MID · 中立'};
const campColor = {wolf: BLOOD, good: DIM, mid: GOLD};

export const RoleCard: React.FC<{r: Role; w?: number; style?: React.CSSProperties; glow?: number}> = ({r, w = 300, style, glow = 0}) => {
  const s = w / 300;
  const idx = ROLES.indexOf(r) + 1;
  return (
    <div
      style={{
        width: w,
        height: 450 * s,
        background: PANEL,
        border: `${1.5 * s}px solid ${r.camp === 'wolf' ? BLOOD + '88' : GOLD + '40'}`,
        boxShadow: `0 ${30 * s}px ${60 * s}px rgba(0,0,0,.6)${glow ? `, 0 0 ${80 * glow * s}px ${r.camp === 'wolf' ? BLOOD : GOLD}${Math.round(glow * 140).toString(16).padStart(2, '0')}` : ''}`,
        padding: 20 * s,
        boxSizing: 'border-box',
        fontFamily: SERIF,
        ...style,
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11 * s, letterSpacing: '0.2em', color: DIM, marginBottom: 14 * s}}>
        <span>№ {String(idx).padStart(2, '0')}</span>
        <span style={{color: campColor[r.camp]}}>{campLabel[r.camp]}</span>
      </div>
      <Img src={asset(`role-${r.code}.jpg`)} style={{width: '100%', aspectRatio: '1', display: 'block'}} />
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16 * s}}>
        <span style={{fontSize: 40 * s, color: BONE, fontWeight: 500, letterSpacing: '0.12em'}}>{r.name}</span>
        <span style={{fontSize: 26 * s, color: r.camp === 'wolf' ? BLOOD : DIM}}>{r.glyph}</span>
      </div>
      <div style={{width: 30 * s, height: 1, background: GOLD + '66', margin: `${12 * s}px 0`}} />
      <div style={{fontSize: 14 * s, color: '#b9ad99', letterSpacing: '0.06em'}}>{r.desc}</div>
    </div>
  );
};

/** 卡背：墨色底 + 站标。 */
export const CardBack: React.FC<{w?: number; style?: React.CSSProperties}> = ({w = 300, style}) => {
  const s = w / 300;
  return (
    <div
      style={{
        width: w,
        height: 450 * s,
        background: `radial-gradient(circle at 50% 45%, #2a1d18, ${PANEL} 70%)`,
        border: `${1.5 * s}px solid ${GOLD}55`,
        boxShadow: `0 ${30 * s}px ${60 * s}px rgba(0,0,0,.6)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div style={{position: 'absolute', inset: 14 * s, border: `1px solid ${GOLD}30`}} />
      <Img src={asset('mark.png')} style={{width: 120 * s, borderRadius: '50%', opacity: 0.85}} />
    </div>
  );
};

/** 翻牌：k 从 0（正面）到 1（背面）。 */
export const FlipCard: React.FC<{r: Role; k: number; w?: number; glow?: number; backFirst?: boolean}> = ({r, k, w = 300, glow, backFirst}) => {
  const angle = (backFirst ? 1 - k : k) * 180;
  return (
    <div style={{width: w, height: (450 * w) / 300, position: 'relative', transformStyle: 'preserve-3d', transform: `rotateY(${angle}deg)`}}>
      <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden'}}>
        <RoleCard r={r} w={w} glow={glow} />
      </div>
      <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)'}}>
        <CardBack w={w} />
      </div>
    </div>
  );
};

/* ---------------- 3D 屏幕（真实界面截图当贴图） ---------------- */

export const Screen: React.FC<{
  src: string;
  w: number;
  rot: [number, number, number]; // rotateX / rotateY / rotateZ
  pos?: [number, number, number];
  crop?: number; // 高图只显示上面一段（宽高比）
  scroll?: number; // 高图向上滚动的比例 0~1
  style?: React.CSSProperties;
}> = ({src, w, rot, pos = [0, 0, 0], crop, scroll = 0, style}) => (
  <div
    style={{
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: w,
      height: crop ? w / crop : undefined,
      overflow: 'hidden',
      transform: `translate(-50%,-50%) translate3d(${pos[0]}px,${pos[1]}px,${pos[2]}px) rotateX(${rot[0]}deg) rotateY(${rot[1]}deg) rotateZ(${rot[2]}deg)`,
      border: `1px solid ${GOLD}55`,
      boxShadow: `0 60px 140px rgba(0,0,0,.75), 0 0 0 10px #0b0908, 0 0 0 11px ${GOLD}22`,
      borderRadius: 6,
      ...style,
    }}
  >
    <Img src={asset(src)} style={{width: '100%', display: 'block', transform: `translateY(${-scroll * 100}%)`}} />
  </div>
);

/** 从界面里抠出来的组件，浮在镜头前。 */
export const Chip: React.FC<{src: string; w: number; at: number; from?: [number, number, number]; style?: React.CSSProperties}> = ({
  src,
  w,
  at,
  from = [0, 60, -300],
  style,
}) => {
  const k = useSpring(at, {damping: 15, stiffness: 140});
  return (
    <Img
      src={asset(src)}
      style={{
        position: 'absolute',
        width: w,
        opacity: Math.min(1, k * 1.4),
        transform: `translate3d(${from[0] * (1 - k)}px,${from[1] * (1 - k)}px,${from[2] * (1 - k)}px)`,
        border: `1px solid ${GOLD}66`,
        boxShadow: '0 40px 90px rgba(0,0,0,.8)',
        ...style,
      }}
    />
  );
};

/* ---------------- 座位桌（伪 3D 投影，和界面同款圆盘） ---------------- */

export const seatPos = (seat: number, spin: number, cx = 960, cy = 610, rx = 600, ry = 220) => {
  // 界面里 1 号在正上方，顺时针排
  const a = ((seat - 1) / 6) * Math.PI * 2 - Math.PI / 2 + spin;
  const depth = (Math.sin(a) + 1) / 2; // 0 远 1 近
  return {x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), depth, scale: 0.78 + 0.34 * depth};
};

export const SeatDisc: React.FC<{seat: number; x: number; y: number; scale: number; ring?: string; dead?: number; lit?: number}> = ({
  seat,
  x,
  y,
  scale,
  ring = '#5a5045',
  dead = 0,
  lit = 0,
}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      transform: `translate(-50%,-50%) scale(${scale})`,
      textAlign: 'center',
      fontFamily: SERIF,
      zIndex: Math.round(y),
    }}
  >
    <div
      style={{
        width: 92,
        height: 92,
        borderRadius: '50%',
        border: `2px solid ${dead ? BLOOD : ring}`,
        background: dead ? '#2a0e0c' : '#1d1815',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 34,
        color: dead ? BLOOD : BONE,
        boxShadow: lit ? `0 0 ${50 * lit}px ${ring}` : '0 10px 30px rgba(0,0,0,.6)',
      }}
    >
      {String(seat).padStart(2, '0')}
    </div>
    <div style={{fontSize: 14, letterSpacing: '0.3em', color: DIM, marginTop: 8}}>座 {String(seat).padStart(2, '0')}</div>
  </div>
);

/** 两点之间的弧线（SVG），k 控制描画进度。 */
export const Arc: React.FC<{a: {x: number; y: number}; b: {x: number; y: number}; k: number; color: string; lift?: number; width?: number}> = ({
  a,
  b,
  k,
  color,
  lift = 160,
  width = 3,
}) => {
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - lift;
  const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  return (
    <svg width={1920} height={1080} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <path d={d} fill="none" stroke={color} strokeWidth={width} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} strokeLinecap="round" style={{filter: `drop-shadow(0 0 8px ${color})`}} />
    </svg>
  );
};

/* ---------------- 全局质感 ---------------- */

export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.16}}>
      <svg width="100%" height="100%">
        <filter id="g">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 12} />
        </filter>
        <rect width="100%" height="100%" filter="url(#g)" />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,.75) 100%)'}} />
);

/** 冲击：返回当前帧的抖动位移和闪白强度。 */
export const useImpact = () => {
  const frame = useCurrentFrame();
  let shake = 0;
  let flash = 0;
  for (const b of cues.impacts) {
    const t = frame - b2f(b);
    if (t >= 0 && t < 24) {
      shake += 14 * Math.exp(-t / 5);
      flash = Math.max(flash, Math.exp(-t / 3));
    }
  }
  return {dx: shake * Math.sin(frame * 2.3), dy: shake * Math.cos(frame * 3.1), flash};
};
