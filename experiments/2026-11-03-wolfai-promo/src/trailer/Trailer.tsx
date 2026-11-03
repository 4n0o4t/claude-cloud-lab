import '@fontsource/noto-serif-sc/500.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/noto-serif-sc/900.css';
import {Audio} from '@remotion/media';
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Grain, INK, SECTION, SectionId, TOTAL, Vignette, clamp, useImpact} from './kit';
import {Archive, Day, Hook, Night, Outro, Roles, Setup, Verdict, Vote} from './scenes';

const XIN = 9; // 进场缩放模糊帧数
const XOUT = 9; // 出场

/** 每幕进出场：出场时推近 + 模糊 + 变暗，进场时从略小、模糊里落定（zoom-blur 转场）。 */
const Cut: React.FC<{dur: number; children: React.ReactNode; first?: boolean; last?: boolean}> = ({dur, children, first, last}) => {
  const frame = useCurrentFrame();
  const kin = first ? 1 : interpolate(frame, [0, XIN], [0, 1], clamp);
  const kout = last ? 0 : interpolate(frame, [dur - XOUT, dur], [0, 1], clamp);
  const scale = (1 - kin) * -0.08 + 1 + kout * 0.18;
  const blur = (1 - kin) * 16 + kout * 22;
  return (
    <AbsoluteFill style={{transform: `scale(${scale})`, filter: blur > 0.1 ? `blur(${blur}px)` : undefined, opacity: Math.min(kin * 1.5, 1 - kout * 0.6)}}>
      {children}
    </AbsoluteFill>
  );
};

const ORDER: [SectionId, React.FC][] = [
  ['hook', Hook],
  ['roles', Roles],
  ['setup', Setup],
  ['night', Night],
  ['day', Day],
  ['vote', Vote],
  ['verdict', Verdict],
  ['archive', Archive],
  ['outro', Outro],
];

const FontGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    document.fonts.ready.then(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
};

export const Trailer: React.FC = () => {
  const {dx, dy, flash} = useImpact();
  return (
    <FontGate>
      <AbsoluteFill style={{background: INK}}>
        <AbsoluteFill style={{transform: `translate(${dx}px,${dy}px)`}}>
          {ORDER.map(([id, Scene], i) => {
            const s = SECTION(id);
            const last = i === ORDER.length - 1;
            const dur = last ? TOTAL - s.from : s.dur; // 片尾一直放到配乐结束
            return (
              <Sequence key={id} from={s.from} durationInFrames={dur} name={id}>
                <Cut dur={dur} first={i === 0} last={last}>
                  <Scene />
                </Cut>
              </Sequence>
            );
          })}
        </AbsoluteFill>
        <AbsoluteFill style={{background: '#fff3e0', opacity: flash * 0.28, mixBlendMode: 'screen', pointerEvents: 'none'}} />
        <Vignette />
        <Grain />
        <Audio src={staticFile('bgm/score.wav')} />
      </AbsoluteFill>
    </FontGate>
  );
};
