import React from 'react';
import {AbsoluteFill, Easing, interpolate, random, useCurrentFrame} from 'remotion';
import {FONT} from '../lib';
import {airMass} from './sun';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** 太空镜头标题：字距收拢 + 上浮淡入。 */
export const Title: React.FC<{from: number; to: number}> = ({from, to}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 150}}>
      <div
        style={{
          fontFamily: FONT,
          color: '#fff',
          opacity: interpolate(frame, [from, from + 25, to - 20, to], [0, 1, 1, 0], clamp),
          translate: `0 ${interpolate(frame, [from, from + 40], [24, 0], {...clamp, easing: OUT})}px`,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 400,
            letterSpacing: interpolate(frame, [from, from + 60], [14, 8], {...clamp, easing: OUT}),
            color: 'rgba(200,220,255,0.75)',
            marginBottom: 18,
          }}
        >
          RAYLEIGH SCATTERING
        </div>
        <div style={{fontSize: 88, fontWeight: 700, letterSpacing: 4, textShadow: '0 6px 40px rgba(0,0,0,0.6)'}}>
          日落，为什么是红色的？
        </div>
        <div
          style={{
            width: interpolate(frame, [from + 15, from + 60], [0, 420], {...clamp, easing: OUT}),
            height: 3,
            marginTop: 26,
            background: 'linear-gradient(90deg, #6fa8ff, #ff8a4c)',
            borderRadius: 2,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/** 地面镜头的数据面板：太阳高度角 + 阳光穿过的大气厚度（相对正午天顶）。 */
export const Hud: React.FC<{elevation: number; from: number; to: number}> = ({elevation, from, to}) => {
  const frame = useCurrentFrame();
  const am = airMass(elevation);
  const bar = Math.log(am) / Math.log(38); // 对数刻度：1 → 0，38 → 1
  const row = (label: string, value: string) => (
    <div style={{display: 'flex', justifyContent: 'space-between', gap: 40, alignItems: 'baseline'}}>
      <span style={{fontSize: 24, color: 'rgba(255,255,255,0.72)', letterSpacing: 2}}>{label}</span>
      <span style={{fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>{value}</span>
    </div>
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        left: 90,
        width: 470,
        padding: '26px 30px',
        borderRadius: 18,
        background: 'rgba(10,14,30,0.28)',
        border: '1px solid rgba(255,255,255,0.18)',
        backdropFilter: 'blur(14px)',
        fontFamily: FONT,
        color: '#fff',
        opacity: interpolate(frame, [from, from + 20, to - 15, to], [0, 1, 1, 0], clamp),
        translate: `${interpolate(frame, [from, from + 30], [-30, 0], {...clamp, easing: OUT})}px 0`,
      }}
    >
      {row('太阳高度角', `${Math.max(elevation, 0).toFixed(1)}°`)}
      <div style={{height: 14}} />
      {row('阳光穿过的大气', `×${am < 10 ? am.toFixed(1) : Math.round(am)}`)}
      <div style={{marginTop: 14, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.15)', overflow: 'hidden'}}>
        <div
          style={{
            width: `${Math.max(bar, 0.02) * 100}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #7fb2ff, #ffb36b, #ff5a3c)',
            backgroundSize: '470px 100%',
          }}
        />
      </div>
      <div style={{marginTop: 10, fontSize: 18, color: 'rgba(255,255,255,0.5)'}}>以正午头顶为 1 · Kasten–Young 公式</div>
    </div>
  );
};

/** 底部字幕：无底框，靠渐变压暗和投影保证可读。 */
export const HeroCaption: React.FC<{lines: {from: number; to: number; text: string}[]}> = ({lines}) => {
  const frame = useCurrentFrame();
  const line = lines.find((l) => frame >= l.from && frame < l.to);
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center'}}>
      <div style={{position: 'absolute', inset: 'auto 0 0 0', height: 260, background: 'linear-gradient(transparent, rgba(0,0,0,0.45))'}} />
      {line ? (
        <div
          style={{
            position: 'relative',
            marginBottom: 70,
            fontFamily: FONT,
            fontWeight: 500,
            fontSize: 42,
            letterSpacing: 2,
            color: '#fff',
            textShadow: '0 2px 18px rgba(0,0,0,0.7)',
            opacity: interpolate(frame, [line.from, line.from + 8, line.to - 8, line.to], [0, 1, 1, 0], clamp),
            translate: `0 ${interpolate(frame, [line.from, line.from + 14], [10, 0], {...clamp, easing: OUT})}px`,
          }}
        >
          {line.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** 结尾一句话。 */
export const EndLine: React.FC<{from: number}> = ({from}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 54,
          fontWeight: 700,
          letterSpacing: 4,
          color: '#fff',
          textShadow: '0 4px 30px rgba(0,0,0,0.55)',
          translate: `0 ${interpolate(frame, [from, from + 40], [-100, -130], {...clamp, easing: OUT})}px`,
          opacity: interpolate(frame, [from, from + 25], [0, 1], clamp),
        }}
      >
        晚霞，是蓝光被一路散射后剩下的颜色
      </div>
    </AbsoluteFill>
  );
};

/** 几只飞鸟剪影，增加生活感。路径与翅膀扇动都只由帧号决定。 */
export const Birds: React.FC<{from: number}> = ({from}) => {
  const frame = useCurrentFrame();
  const f = frame - from;
  if (f < 0) return null;
  return (
    <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
      {[0, 1, 2, 3, 4].map((i) => {
        const x = 1980 - f * (2.4 + i * 0.25) - i * 70;
        const y = 330 + i * 22 + Math.sin(f / 30 + i) * 10 - f * 0.18;
        const flap = Math.sin(f * 0.45 + i * 1.7) * 7;
        const s = 1 - i * 0.08;
        return (
          <path
            key={i}
            d={`M${x - 16 * s},${y - flap} Q${x - 7 * s},${y - 4} ${x},${y + 2} Q${x + 7 * s},${y - 4} ${x + 16 * s},${y - flap}`}
            stroke="rgba(10,6,14,0.85)"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};

/** 暗角 + 胶片颗粒（颗粒的随机种子随帧变化，但仍是确定性的）。 */
export const Finish: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = Math.floor(random(`grain${frame % 24}`) * 1000);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)'}} />
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0, opacity: 0.07, mixBlendMode: 'overlay'}}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};
