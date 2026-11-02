import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

export const FONT = '"Noto Sans SC", sans-serif';

export const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

/** 在 [a, b] 帧之间从 from 平滑过渡到 to，区间外保持端点值。 */
export const ease = (
  f: number,
  a: number,
  b: number,
  from = 0,
  to = 1,
  easing: (t: number) => number = Easing.inOut(Easing.cubic),
) => interpolate(f, [a, b], [from, to], {...clamp, easing});

/** 每一幕首尾淡入淡出。 */
export const SceneFade: React.FC<{duration: number; children: React.ReactNode}> = ({
  duration,
  children,
}) => {
  const f = useCurrentFrame();
  const opacity = Math.min(ease(f, 0, 8), 1 - ease(f, duration - 8, duration));
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

export type CaptionLine = {from: number; to: number; text: string};

/** 底部字幕：替代旁白，按帧区间显示。 */
export const Captions: React.FC<{lines: CaptionLine[]}> = ({lines}) => {
  const f = useCurrentFrame();
  const line = lines.find((l) => f >= l.from && f < l.to);
  if (!line) return null;
  const opacity = Math.min(ease(f, line.from, line.from + 8), 1 - ease(f, line.to - 8, line.to));
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 64}}>
      <div
        style={{
          opacity,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 44,
          color: '#fff',
          background: 'rgba(8, 18, 40, 0.62)',
          padding: '14px 36px',
          borderRadius: 14,
          letterSpacing: 1,
          maxWidth: 1600,
          textAlign: 'center',
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
};

export const Heading: React.FC<{
  children: React.ReactNode;
  top?: number;
  size?: number;
  opacity?: number;
  color?: string;
}> = ({children, top = 90, size = 64, opacity = 1, color = '#fff'}) => (
  <div
    style={{
      position: 'absolute',
      top,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontFamily: FONT,
      fontWeight: 900,
      fontSize: size,
      color,
      opacity,
      textShadow: '0 4px 24px rgba(0,0,0,0.35)',
    }}
  >
    {children}
  </div>
);

/** 一条正弦波，波头位于 xHead，相位随帧推进。ampAfter 用于“穿过分子后”的振幅。 */
export const wavePath = (opts: {
  x0: number;
  xHead: number;
  y: number;
  amp: number;
  lambda: number;
  phase: number;
  splitX?: number;
  ampAfter?: number;
}) => {
  const {x0, xHead, y, amp, lambda, phase, splitX = Infinity, ampAfter = amp} = opts;
  const pts: string[] = [];
  for (let x = x0; x <= xHead; x += 4) {
    const a = x < splitX ? amp : ampAfter;
    pts.push(`${x.toFixed(1)},${(y + a * Math.sin((2 * Math.PI * x) / lambda - phase)).toFixed(1)}`);
  }
  return pts.length > 1 ? `M${pts.join(' L')}` : '';
};
