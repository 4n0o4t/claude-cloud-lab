import React from 'react';
import {AbsoluteFill, interpolateColors, random, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Captions, FONT, Heading, ease, wavePath} from './lib';
import {Beats, beat, captionLines} from './timeline';

type SceneProps = {beats: Beats};

const SKY_TOP = '#2f7fd6';
const SKY_BOTTOM = '#9fd3f5';
const NIGHT = '#0b1630';

const Sky: React.FC<{top?: string; bottom?: string}> = ({top = SKY_TOP, bottom = SKY_BOTTOM}) => (
  <AbsoluteFill style={{background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`}} />
);

/* ---------- 1. 开场 ---------- */
export const Hook: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - 10, fps, config: {damping: 14}});
  const sub = ease(f, 45, 65);
  const clouds = [
    {x: 260, y: 230, w: 360},
    {x: 1500, y: 170, w: 300},
    {x: 1180, y: 760, w: 420},
    {x: 380, y: 820, w: 280},
  ];
  return (
    <AbsoluteFill>
      <Sky />
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        {clouds.map((c, i) => (
          <g key={i} opacity={0.85} transform={`translate(${c.x + f * (0.4 + i * 0.15)}, ${c.y})`}>
            <ellipse cx={0} cy={0} rx={c.w / 2} ry={c.w / 7} fill="#fff" />
            <ellipse cx={-c.w / 6} cy={-c.w / 10} rx={c.w / 4} ry={c.w / 7} fill="#fff" />
            <ellipse cx={c.w / 7} cy={-c.w / 8} rx={c.w / 5} ry={c.w / 6.5} fill="#fff" />
          </g>
        ))}
      </svg>
      <Heading top={380} size={120} opacity={s}>
        <span style={{display: 'inline-block', transform: `translateY(${(1 - s) * 40}px)`}}>
          天空为什么是蓝色的？
        </span>
      </Heading>
      <Heading top={560} size={44} opacity={sub}>
        带你看懂“瑞利散射”
      </Heading>
    </AbsoluteFill>
  );
};

/* ---------- 2. 白光是七彩光 ---------- */
const SPECTRUM = [
  {name: '红', nm: 700, color: '#ff3b30'},
  {name: '橙', nm: 610, color: '#ff8c1a'},
  {name: '黄', nm: 580, color: '#ffd60a'},
  {name: '绿', nm: 530, color: '#34c759'},
  {name: '青', nm: 490, color: '#2ad4d4'},
  {name: '蓝', nm: 450, color: '#2f6bff'},
  {name: '紫', nm: 400, color: '#9b4dff'},
];

export const WhiteLight: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const beam = ease(f, 10, 50);
  const prism = ease(f, 0, 20);
  const w2 = beat(beats, 'white-020').from;
  const labels = ease(f, w2, w2 + 30);
  const px = 900;
  return (
    <AbsoluteFill>
      <Sky top={NIGHT} bottom="#1b2a52" />
      <Heading top={70}>阳光看起来是白色的</Heading>
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <line x1={0} y1={540} x2={px * beam} y2={540} stroke="#fff" strokeWidth={14} strokeLinecap="round" />
        <polygon
          points={`${px},400 ${px - 130},640 ${px + 130},640`}
          fill="rgba(200,230,255,0.25)"
          stroke="#cfe8ff"
          strokeWidth={4}
          opacity={prism}
        />
        {SPECTRUM.map((c, i) => {
          const g = ease(f, 55 + i * 6, 105 + i * 6);
          const y2 = 300 + i * 80;
          const x1 = px + 40;
          const x2 = x1 + (1540 - x1) * g;
          const y = 540 + (y2 - 540) * g;
          return (
            <g key={c.name}>
              <line x1={x1} y1={540} x2={x2} y2={y} stroke={c.color} strokeWidth={12} strokeLinecap="round" />
              <text
                x={1640}
                y={y2 + 14}
                fill={c.color}
                opacity={labels}
                style={{fontFamily: FONT, fontWeight: 700, fontSize: 38}}
              >
                {c.name} {c.nm}nm
              </text>
            </g>
          );
        })}
        <g opacity={labels}>
          <line x1={1590} y1={300} x2={1590} y2={790} stroke="#fff" strokeWidth={3} markerEnd="url(#arr)" />
          <text x={1590} y={270} fill="#fff" textAnchor="middle" style={{fontFamily: FONT, fontSize: 30}}>
            波长变短 ↓
          </text>
        </g>
        <defs>
          <marker id="arr" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto">
            <path d="M0,0 L12,6 L0,12 z" fill="#fff" />
          </marker>
        </defs>
      </svg>
      <Captions lines={captionLines(beats)} />
    </AbsoluteFill>
  );
};

/* ---------- 3. 瑞利散射 ---------- */
export const Scattering: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const L = beat(beats, 'scatter-020').from; // 说到“蓝光/红光”时出标签
  const B = beat(beats, 'scatter-030').from; // 说到“瑞利散射”时切到柱状图
  const partA = 1 - ease(f, B - 20, B);
  const partB = ease(f, B - 5, B + 20);
  const head = ease(f, 0, 70, 0, 1920);
  const mx = 960;
  const lanes = [
    {y: 330, color: '#4d8dff', lambda: 56, amp: 34, ampAfter: 14, scatter: 1, label: '蓝光：大量被散射到四面八方'},
    {y: 720, color: '#ff4d3d', lambda: 120, amp: 34, ampAfter: 31, scatter: 0.17, label: '红光：大多直接穿过'},
  ];
  const dots = new Array(70).fill(0).map((_, i) => ({
    x: random(`x${i}`) * 1920,
    y: random(`y${i}`) * 1080,
    r: 4 + random(`r${i}`) * 4,
  }));
  const ratio = (700 / 450) ** 4; // ≈ 5.85
  const grow = ease(f, B + 25, B + 85);
  return (
    <AbsoluteFill>
      <Sky top={NIGHT} bottom="#1b2a52" />
      <AbsoluteFill style={{opacity: partA}}>
        <Heading top={60} size={52}>
          阳光撞上空气分子
        </Heading>
        <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
          {dots.map((d, i) => (
            <circle
              key={i}
              cx={d.x + 6 * Math.sin(f / 20 + i)}
              cy={d.y + 6 * Math.cos(f / 25 + i)}
              r={d.r}
              fill="rgba(255,255,255,0.18)"
            />
          ))}
          {lanes.map((l) => {
            const rings = [0, 1, 2, 3, 4, 5].map((k) => {
              const t = (f - 55 - k * 16) % 96;
              if (f - 55 - k * 16 < 0) return null;
              const r = t * 4.5;
              return (
                <circle
                  key={k}
                  cx={mx}
                  cy={l.y}
                  r={r}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={5}
                  opacity={l.scatter * Math.max(0, 1 - t / 96)}
                />
              );
            });
            return (
              <g key={l.y}>
                {rings}
                <path
                  d={wavePath({
                    x0: 0,
                    xHead: head,
                    y: l.y,
                    amp: l.amp,
                    lambda: l.lambda,
                    phase: f * 0.35,
                    splitX: mx,
                    ampAfter: l.ampAfter,
                  })}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={7}
                  strokeLinecap="round"
                />
                <circle cx={mx} cy={l.y} r={20} fill="#e8f1ff" />
                <text
                  x={mx}
                  y={l.y + 110}
                  fill="#fff"
                  textAnchor="middle"
                  opacity={ease(f, L, L + 20)}
                  style={{fontFamily: FONT, fontWeight: 700, fontSize: 40}}
                >
                  {l.label}
                </text>
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{opacity: partB}}>
        <Heading top={90} size={56}>
          散射强度 ∝ 1 / 波长⁴
        </Heading>
        <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
          <line x1={560} y1={820} x2={1360} y2={820} stroke="#fff" strokeWidth={3} />
          {[
            {x: 700, v: 1, color: '#ff4d3d', label: '红光 700nm'},
            {x: 1100, v: ratio, color: '#4d8dff', label: '蓝光 450nm'},
          ].map((b) => {
            const h = (b.v / ratio) * 520 * grow;
            return (
              <g key={b.x}>
                <rect x={b.x - 90} y={820 - h} width={180} height={h} rx={10} fill={b.color} />
                <text x={b.x} y={870} fill="#fff" textAnchor="middle" style={{fontFamily: FONT, fontSize: 36}}>
                  {b.label}
                </text>
              </g>
            );
          })}
          <text
            x={1100}
            y={820 - 520 * grow - 24}
            fill="#fff"
            textAnchor="middle"
            opacity={ease(f, B + 75, B + 95)}
            style={{fontFamily: FONT, fontWeight: 900, fontSize: 56}}
          >
            ≈ {(ratio * grow).toFixed(1)} 倍
          </text>
        </svg>
      </AbsoluteFill>
      <Captions lines={captionLines(beats)} />
    </AbsoluteFill>
  );
};

/* ---------- 4. 为什么不是紫色 ---------- */
export const WhyNotViolet: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const q = spring({frame: f - 5, fps, config: {damping: 13}});
  const cards = [
    {n: '1', text: '阳光里的紫光，本来就比蓝光少', color: '#9b4dff', id: 'violet-020'},
    {n: '2', text: '人眼对紫光不太敏感', color: '#6f6bff', id: 'violet-030'},
    {n: '3', text: '各色散射光混在一起，看起来就是天蓝色', color: '#2f8bff', id: 'violet-040'},
  ];
  return (
    <AbsoluteFill>
      <Sky top="#3a2a7a" bottom="#2f7fd6" />
      <Heading top={110} size={84} opacity={q}>
        紫光散射更强，为什么天不是紫的？
      </Heading>
      <div style={{position: 'absolute', top: 330, left: 260, right: 260}}>
        {cards.map((c) => {
          const a = spring({frame: f - beat(beats, c.id).from, fps, config: {damping: 16}});
          return (
            <div
              key={c.n}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 32,
                marginBottom: 36,
                padding: '26px 40px',
                borderRadius: 22,
                background: 'rgba(255,255,255,0.14)',
                border: '2px solid rgba(255,255,255,0.3)',
                opacity: a,
                transform: `translateX(${(1 - a) * -80}px)`,
                fontFamily: FONT,
                color: '#fff',
              }}
            >
              <div
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  background: c.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 42,
                  flexShrink: 0,
                }}
              >
                {c.n}
              </div>
              <div style={{fontWeight: 700, fontSize: 48}}>{c.text}</div>
            </div>
          );
        })}
      </div>
      <Captions lines={captionLines(beats)} />
    </AbsoluteFill>
  );
};

/* ---------- 5. 日落 ---------- */
export const Sunset: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const K = beat(beats, 'sunset-020').from; // 说到“傍晚”时太阳开始下落
  const k = ease(f, K, K + 150); // 0 = 正午，1 = 傍晚
  const theta = ((12 + 72 * k) * Math.PI) / 180; // 太阳偏离天顶的角度
  const C = {x: 960, y: 2500};
  const R = 1800; // 地面半径，地表顶点在 y=700
  const Ra = R + 200; // 大气外缘
  const O = {x: 960, y: C.y - R};
  const d = {x: -Math.sin(theta), y: -Math.cos(theta)};
  // 从观察者沿 d 方向射出，求与大气外缘的交点：|O + t d - C| = Ra
  const ox = O.x - C.x;
  const oy = O.y - C.y;
  const b = ox * d.x + oy * d.y;
  const c = ox * ox + oy * oy - Ra * Ra;
  const t = -b + Math.sqrt(b * b - c);
  const E = {x: O.x + t * d.x, y: O.y + t * d.y};
  const S = {x: O.x + d.x * (t + 150), y: O.y + d.y * (t + 150)}; // 太阳始终在大气层外
  const sunColor = interpolateColors(k, [0, 1], ['#fff4c2', '#ff5a1f']);
  const skyTop = interpolateColors(k, [0, 1], [SKY_TOP, '#3b2a6b']);
  const skyBottom = interpolateColors(k, [0, 1], [SKY_BOTTOM, '#ff9a4d']);
  const beamColor = interpolateColors(k, [0, 1], ['#fff7d6', '#ff7a33']);
  const particles = new Array(26).fill(0).map((_, i) => {
    const life = (f + i * 11) % 60;
    const along = random(`p${i}`) * 0.9 + 0.05;
    const px = E.x + (O.x - E.x) * along;
    const py = E.y + (O.y - E.y) * along;
    const side = random(`s${i}`) > 0.5 ? 1 : -1;
    // 垂直于光路方向飘散
    const nx = -d.y * side;
    const ny = d.x * side;
    return {x: px + nx * life * 2.2, y: py + ny * life * 2.2, o: Math.max(0, 1 - life / 60)};
  });
  return (
    <AbsoluteFill>
      <Sky top={skyTop} bottom={skyBottom} />
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <circle cx={C.x} cy={C.y} r={Ra} fill="rgba(120,180,255,0.18)" stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeDasharray="10 10" />
        <circle cx={C.x} cy={C.y} r={R} fill="#1d3b2a" />
        <text x={1600} y={C.y - Ra + 60} fill="rgba(255,255,255,0.8)" style={{fontFamily: FONT, fontSize: 32}}>
          大气层
        </text>
        <line x1={S.x} y1={S.y} x2={E.x} y2={E.y} stroke={beamColor} strokeWidth={4} strokeDasharray="8 10" opacity={0.6} />
        <line x1={E.x} y1={E.y} x2={O.x} y2={O.y} stroke={beamColor} strokeWidth={14} strokeLinecap="round" />
        {particles.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={7} fill="#5b9dff" opacity={p.o * (0.35 + 0.65 * k)} />
        ))}
        <circle cx={S.x} cy={S.y} r={70} fill={sunColor} />
        <circle cx={S.x} cy={S.y} r={110} fill={sunColor} opacity={0.25} />
        <circle cx={O.x} cy={O.y - 18} r={14} fill="#fff" />
        <rect x={O.x - 5} y={O.y - 6} width={10} height={6} fill="#fff" />
        <text x={O.x + 30} y={O.y - 30} fill="#fff" style={{fontFamily: FONT, fontSize: 30}}>
          你
        </text>
      </svg>
      <Heading top={70} size={60}>
        {k < 0.5 ? '正午：阳光穿过的大气很薄' : '傍晚：阳光斜穿厚厚的大气'}
      </Heading>
      <Captions lines={captionLines(beats)} />
    </AbsoluteFill>
  );
};

/* ---------- 6. 总结 ---------- */
export const Outro: React.FC<SceneProps> = ({beats}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const o1 = beat(beats, 'outro-010').from;
  const o2 = beat(beats, 'outro-020').from;
  const a = spring({frame: f - o1, fps, config: {damping: 14}});
  const b = ease(f, o2, o2 + 20);
  const c = ease(f, o2 + 30, o2 + 50);
  return (
    <AbsoluteFill>
      <Sky top="#1f5fb8" bottom="#ff9a4d" />
      <Heading top={300} size={92} opacity={a}>
        波长越短，散射越强
      </Heading>
      <Heading top={470} size={46} opacity={b}>
        白天，我们看到被散射的蓝光；傍晚，看到穿透过来的红光
      </Heading>
      <Heading top={900} size={30} opacity={c} color="rgba(255,255,255,0.85)">
        由 Claude 用 Remotion 编写 · 画面全部由代码生成
      </Heading>
    </AbsoluteFill>
  );
};
