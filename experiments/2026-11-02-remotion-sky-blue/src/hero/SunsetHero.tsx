import {Audio} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import narration from '../../narration/zh-CN.json';
import {VOICES} from '../timeline';
import {EarthShot} from './EarthShot';
import {Birds, EndLine, Finish, HeroCaption, Hud, Title} from './Overlays';
import {SkyShot} from './SkyShot';
import {sunElevation} from './sun';

/**
 * 日落 3D 精修版：太空镜头 → 交叉淡化 → 地面天空镜头。
 * （官方 lightLeak 漏光在无 GPU 的 swangle 软件渲染下整屏发白，改用 fade。）
 * 旁白复用整片里日落那两句（Kokoro），时长决定地面镜头的节奏。
 */
const FPS = 30;
const EARTH = 165; // 太空镜头 5.5 秒
const XFADE = 24; // 交叉淡化会让两段重叠，总长相应缩短
const VOICE_DIR = VOICES.kokoro.dir;
const ms = VOICES.kokoro.manifest.lines;
const caption = (id: string) => (narration as {id: string; caption: string | null}[]).find((l) => l.id === id)?.caption ?? '';
const frames = (id: string) => Math.ceil((ms[id].durationMs / 1000) * FPS);

// 地面镜头内部节拍（相对地面镜头起点）
const S1 = {id: 'sunset-010', from: 24, dur: frames('sunset-010')};
const S2 = {id: 'sunset-020', from: S1.from + S1.dur + 12, dur: frames('sunset-020')};
const DESCENT_FROM = S2.from - 6;
const DESCENT_TO = S2.from + S2.dur + 18;
const END_LINE = DESCENT_TO + 6;
const SKY = END_LINE + 105;
export const HERO_DURATION = EARTH + SKY - XFADE;
const SKY_START = EARTH - XFADE; // 地面镜头在总时间轴上的起点

const GroundLayers: React.FC = () => {
  const frame = useCurrentFrame();
  const elevation = sunElevation(frame, DESCENT_FROM, DESCENT_TO);
  return (
    <AbsoluteFill>
      <SkyShot descentFrom={DESCENT_FROM} descentTo={DESCENT_TO} />
      <Birds from={S2.from + 40} />
      <Hud elevation={elevation} from={S1.from} to={END_LINE} />
      <HeroCaption
        lines={[
          {from: S1.from, to: S1.from + S1.dur + 6, text: caption(S1.id)},
          {from: S2.from, to: S2.from + S2.dur + 6, text: caption(S2.id)},
        ]}
      />
      <EndLine from={END_LINE} />
    </AbsoluteFill>
  );
};

/** 背景音乐：说话时压低（ducking）。 */
const bgmVolume = (f: number) => {
  const fadeIn = interpolate(f, [0, 45], [0, 1], {extrapolateRight: 'clamp'});
  const fadeOut = interpolate(f, [HERO_DURATION - 60, HERO_DURATION], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const talking = [S1, S2].some((s) => f >= SKY_START + s.from - 6 && f <= SKY_START + s.from + s.dur + 6);
  return 0.5 * fadeIn * fadeOut * (talking ? 0.4 : 1);
};

export const SunsetHero: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="太空" durationInFrames={EARTH}>
        <EarthShot />
        <Title from={18} to={EARTH} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: XFADE})} />
      <TransitionSeries.Sequence name="地面" durationInFrames={SKY}>
        <GroundLayers />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    <Finish />
    <Audio src={staticFile('bgm/ambient.wav')} volume={bgmVolume} />
    {[S1, S2].map((s) => (
      <Sequence key={s.id} name={`voice ${s.id}`} from={SKY_START + s.from} durationInFrames={s.dur + 2}>
        <Audio src={staticFile(`${VOICE_DIR}/${s.id}.wav`)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
