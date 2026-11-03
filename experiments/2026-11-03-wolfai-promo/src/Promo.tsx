import '@fontsource/noto-serif-sc/500.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/noto-serif-sc/900.css';
import {Audio, Video} from '@remotion/media';
import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {FPS, Scene, SceneId, TIMELINE, XF} from './timeline';

/* 配色取自月夜狼人杀界面本身：墨黑底、骨白字、暗金点缀、血红强调 */
const INK = '#0d0a09';
const BONE = '#ece3d2';
const GOLD = '#c9a24a';
const BLOOD = '#b8312f';
const SERIF = '"Noto Serif SC", serif';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/* ---------------- 录屏镜头 ---------------- */

type Shot = {
  src: string; // public/rec 下的文件
  at: number; // 从录屏第几秒开始（秒）
  rate?: number; // 播放速度
  zoom: [number, number]; // 镜头起止缩放
  focus: [number, number]; // 缩放中心（画面比例 0~1）
  drift?: [number, number]; // 镜头平移（像素，起→止的水平/垂直位移）
};

/** 一个录屏镜头：真实界面录像 + 缓慢推镜（Ken Burns）。 */
const Clip: React.FC<{shot: Shot; dur: number}> = ({shot, dur}) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, dur], [0, 1], {...clamp, easing: Easing.bezier(0.33, 0, 0.25, 1)});
  const scale = interpolate(k, [0, 1], shot.zoom);
  const [dx, dy] = shot.drift ?? [0, 0];
  return (
    <AbsoluteFill style={{overflow: 'hidden', background: INK}}>
      <AbsoluteFill
        style={{
          transformOrigin: `${shot.focus[0] * 100}% ${shot.focus[1] * 100}%`,
          scale: String(scale),
          translate: `${dx * k}px ${dy * k}px`,
        }}
      >
        <Video
          src={staticFile(`rec/${shot.src}`)}
          trimBefore={Math.round(shot.at * FPS)}
          playbackRate={shot.rate ?? 1}
          muted
          style={{width: '100%', height: '100%'}}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 把一幕切成几个等长镜头，镜头之间硬切（像剪辑节奏）。 */
const Cuts: React.FC<{shots: Shot[]; dur: number}> = ({shots, dur}) => {
  const each = Math.ceil(dur / shots.length);
  return (
    <>
      {shots.map((s, i) => (
        <Sequence key={i} from={i * each} durationInFrames={i === shots.length - 1 ? dur - i * each : each}>
          <Clip shot={s} dur={each} />
        </Sequence>
      ))}
    </>
  );
};

/* ---------------- 文字层 ---------------- */

/** 暗角 + 底部压暗，让字幕在任何画面上都读得清。 */
const Grade: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgba(5,3,3,0.75) 100%),' +
        'linear-gradient(to top, rgba(8,5,4,0.97) 0%, rgba(8,5,4,0.88) 16%, rgba(8,5,4,0.4) 30%, transparent 42%)',
    }}
  />
);

/** 章节式字幕：左下角暗金编号 + 骨白标题，样式呼应界面里的“CHAPTER · I”。 */
const Chapter: React.FC<{n: string; kicker: string; text: string; dur: number}> = ({n, kicker, text, dur}) => {
  const frame = useCurrentFrame();
  // 在下一幕淡入前先收掉，避免交叉淡化时两行字幕叠在一起
  const o = interpolate(frame, [4, 16, dur - XF - 8, dur - XF], [0, 1, 1, 0], clamp);
  const x = interpolate(frame, [4, 22], [-24, 0], {...clamp, easing: Easing.bezier(0.2, 0, 0, 1)});
  const line = interpolate(frame, [10, 30], [0, 1], {...clamp, easing: Easing.bezier(0.2, 0, 0, 1)});
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', padding: '0 120px 96px'}}>
      <div style={{opacity: o, translate: `${x}px 0`}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18}}>
          <span style={{fontFamily: SERIF, fontSize: 30, color: GOLD, fontWeight: 700}}>{n}</span>
          <span style={{width: 120 * line, height: 1, background: GOLD, opacity: 0.8}} />
          <span style={{fontFamily: SERIF, fontSize: 20, letterSpacing: '0.42em', color: GOLD}}>{kicker}</span>
        </div>
        <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 64, color: BONE, letterSpacing: '0.06em'}}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- 各幕 ---------------- */

const Hook: React.FC<{dur: number; text: string}> = ({dur, text}) => {
  const frame = useCurrentFrame();
  const blur = interpolate(frame, [0, dur], [14, 6], clamp);
  const scale = interpolate(frame, [0, dur], [1.12, 1.04], clamp);
  // 逐字浮现，“狼人杀”三个字标血红
  const chars = [...text];
  const hot = text.indexOf('狼人杀');
  return (
    <AbsoluteFill style={{background: INK}}>
      <AbsoluteFill style={{filter: `blur(${blur}px) brightness(0.45)`, scale: String(scale)}}>
        <Img src={staticFile('rec/hook.png')} style={{width: '100%', height: '100%'}} />
      </AbsoluteFill>
      <Grade />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 104, color: BONE, letterSpacing: '0.04em'}}>
          {chars.map((c, i) => {
            const t = 6 + i * 2.6;
            const o = interpolate(frame, [t, t + 10], [0, 1], clamp);
            const y = interpolate(frame, [t, t + 14], [18, 0], {...clamp, easing: Easing.bezier(0.2, 0, 0, 1)});
            const red = hot >= 0 && i >= hot && i < hot + 3;
            return (
              <span key={i} style={{display: 'inline-block', opacity: o, translate: `0 ${y}px`, color: red ? BLOOD : BONE}}>
                {c}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const o = (a: number) => interpolate(frame, [a, a + 14], [0, 1], clamp);
  const glow = interpolate(frame, [0, dur], [0.6, 1], clamp);
  const ring = interpolate(frame, [0, 40], [0, 1], {...clamp, easing: Easing.bezier(0.2, 0, 0, 1)});
  return (
    <AbsoluteFill style={{background: INK, alignItems: 'center', justifyContent: 'center'}}>
      {/* 血月 */}
      <div
        style={{
          position: 'absolute',
          width: 520,
          height: 520,
          borderRadius: '50%',
          top: 120,
          background: `radial-gradient(circle at 40% 38%, rgba(184,49,47,${0.32 * glow}) 0%, rgba(120,24,22,${0.18 * glow}) 45%, transparent 70%)`,
          scale: String(0.8 + 0.2 * ring),
          opacity: ring,
        }}
      />
      <div style={{textAlign: 'center', marginTop: -40}}>
        <div style={{fontFamily: SERIF, fontSize: 22, letterSpacing: '0.6em', color: GOLD, opacity: o(4)}}>
          MOONLIT · INQUEST
        </div>
        <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 150, color: BONE, letterSpacing: '0.1em', marginTop: 24, opacity: o(10)}}>
          月夜狼人杀
        </div>
        <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 54, letterSpacing: '0.3em', marginTop: 18, opacity: o(28)}}>
          <span style={{color: BLOOD}}>谁</span>
          <span style={{color: BONE}}>人为狼</span>
        </div>
        <div style={{fontFamily: SERIF, fontSize: 26, color: 'rgba(236,227,210,0.7)', marginTop: 64, letterSpacing: '0.08em', opacity: o(46)}}>
          github.com/Dr-Ai-0018/wolfai-killer
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          fontFamily: SERIF,
          fontSize: 18,
          color: 'rgba(236,227,210,0.42)',
          letterSpacing: '0.12em',
          opacity: o(60),
        }}
      >
        界面为真实运行录屏 · 演示对局台词由预设剧本驱动
      </div>
    </AbsoluteFill>
  );
};

/* 每一幕用哪些录屏镜头（秒数对应 public/rec 里的录像，见 README 的“素材时间点”） */
const SHOTS: Partial<Record<SceneId, Shot[]>> = {
  home: [{src: 'home.mp4', at: 0.7, rate: 0.85, zoom: [1.0, 1.08], focus: [0.28, 0.42]}],
  roles: [{src: 'home.mp4', at: 9.8, rate: 0.85, zoom: [1.16, 1.24], focus: [0.5, 0.28]}],
  setup: [{src: 'setup.mp4', at: 1.2, zoom: [1.06, 1.16], focus: [0.36, 0.3]}],
  night: [
    {src: 'game.mp4', at: 6.2, zoom: [1.3, 1.38], focus: [0.5, 0.52]},
    {src: 'game.mp4', at: 11.8, zoom: [1.3, 1.38], focus: [0.5, 0.52]},
    {src: 'game.mp4', at: 19.2, zoom: [1.3, 1.38], focus: [0.5, 0.52]},
    {src: 'game.mp4', at: 23.6, zoom: [1.3, 1.38], focus: [0.5, 0.52]},
  ],
  day: [
    {src: 'game.mp4', at: 43.0, zoom: [1.5, 1.6], focus: [0.49, 0.56]},
    {src: 'game.mp4', at: 51.0, zoom: [1.5, 1.6], focus: [0.49, 0.56]},
  ],
  vote: [{src: 'game.mp4', at: 61.6, rate: 1.4, zoom: [1.12, 1.22], focus: [0.5, 0.5]}],
  end: [
    {src: 'game.mp4', at: 94.2, zoom: [1.15, 1.22], focus: [0.5, 0.48]},
    {src: 'detail.mp4', at: 3.2, zoom: [1.0, 1.06], focus: [0.4, 0.4]},
  ],
};

const CHAPTERS: Partial<Record<SceneId, [string, string]>> = {
  home: ['I', 'MOONLIT INQUEST'],
  roles: ['II', 'ROLES · TEMPERS'],
  setup: ['III', 'SET THE BOARD'],
  night: ['IV', 'NOX · 夜'],
  day: ['V', 'DIES · 昼'],
  vote: ['VI', 'SUFFRAGIUM · 票'],
  end: ['VII', 'CASE FILE · 卷宗'],
};

const SceneBody: React.FC<{s: Scene}> = ({s}) => {
  if (s.id === 'hook') return <Hook dur={s.dur} text={s.caption ?? ''} />;
  if (s.id === 'outro') return <Outro dur={s.dur} />;
  const [n, kicker] = CHAPTERS[s.id]!;
  return (
    <>
      <Cuts shots={SHOTS[s.id]!} dur={s.dur} />
      <Grade />
      <Chapter n={n} kicker={kicker} text={s.caption ?? ''} dur={s.dur} />
    </>
  );
};

/** 每幕淡入（第一幕除外）+ 最后一幕淡出到黑。 */
const Fade: React.FC<{s: Scene; first: boolean; last: boolean; children: React.ReactNode}> = ({s, first, last, children}) => {
  const frame = useCurrentFrame();
  const fadeIn = first ? 1 : interpolate(frame, [0, XF], [0, 1], clamp);
  const fadeOut = last ? interpolate(frame, [s.dur - 20, s.dur], [1, 0], clamp) : 1;
  return <AbsoluteFill style={{opacity: fadeIn * fadeOut}}>{children}</AbsoluteFill>;
};

/* ---------------- 声音 ---------------- */

const talkingAt = (f: number) =>
  TIMELINE.scenes.some((s) => f >= s.from + s.voice.at - 4 && f <= s.from + s.voice.at + s.voice.dur + 4);

const bgmVolume = (f: number) => {
  const fadeIn = interpolate(f, [0, 30], [0, 1], clamp);
  const fadeOut = interpolate(f, [TIMELINE.total - 45, TIMELINE.total], [1, 0], clamp);
  return 0.55 * fadeIn * fadeOut * (talkingAt(f) ? 0.45 : 1);
};

/* ---------------- 字体 ---------------- */

const ALL_TEXT =
  TIMELINE.scenes.map((s) => s.caption ?? '').join('') +
  Object.values(CHAPTERS).map((c) => c!.join('')).join('') +
  'MOONLIT·INQUEST月夜狼人杀谁人为狼github.com/Dr-Ai-0018/wolfai-killer界面为真实运行录屏 · 演示对局台词由预设剧本驱动';

/** Noto Serif SC 按 unicode-range 分片；渲染前把所有用到的字形都加载好，避免首帧掉字。 */
const FontGate: React.FC = () => {
  const [handle] = useState(() => delayRender('load Noto Serif SC'));
  useEffect(() => {
    document.fonts.ready
      .then(() => Promise.all([500, 700, 900].map((w) => document.fonts.load(`${w} 40px "Noto Serif SC"`, ALL_TEXT))))
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
  return (
    <div style={{position: 'absolute', opacity: 0, fontFamily: SERIF}}>
      {[500, 700, 900].map((w) => (
        <span key={w} style={{fontWeight: w}}>
          {ALL_TEXT}
        </span>
      ))}
    </div>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: INK}}>
    {TIMELINE.scenes.map((s, i) => (
      <Sequence key={s.id} name={s.id} from={s.from} durationInFrames={s.dur}>
        <Fade s={s} first={i === 0} last={i === TIMELINE.scenes.length - 1}>
          <SceneBody s={s} />
        </Fade>
      </Sequence>
    ))}
    <Audio src={staticFile('bgm/ambient.wav')} volume={bgmVolume} />
    {TIMELINE.scenes.map((s) => (
      <Sequence key={s.voice.id} name={`voice ${s.voice.id}`} from={s.from + s.voice.at} durationInFrames={s.voice.dur + 2}>
        <Audio src={staticFile(`voice/zh-CN/${s.voice.id}.wav`)} />
      </Sequence>
    ))}
    <FontGate />
  </AbsoluteFill>
);
