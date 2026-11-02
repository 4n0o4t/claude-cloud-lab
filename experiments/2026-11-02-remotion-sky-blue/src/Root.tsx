import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-sc/900.css';
import React, {useEffect, useState} from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, staticFile} from 'remotion';
import {SceneFade} from './lib';
import {Hook, Outro, Scattering, Sunset, WhiteLight, WhyNotViolet} from './scenes';
import {ALL_CAPTIONS, FPS, VOICES, VoiceName, buildTimeline} from './timeline';

const COMPONENTS = {Hook, WhiteLight, Scattering, WhyNotViolet, Sunset, Outro};

/** Noto Sans SC 按 unicode-range 分片加载；渲染前把页面上所有文字的字形都加载好，避免首帧掉字。 */
const useFonts = () => {
  const [handle] = useState(() => delayRender('load Noto Sans SC'));
  useEffect(() => {
    document.fonts.ready
      .then(() => {
        const text = document.body.innerText + '0123456789≈∝⁴nm';
        return Promise.all(
          [400, 700, 900].map((w) => document.fonts.load(`${w} 40px "Noto Sans SC"`, text)),
        );
      })
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
};

const ALL_TEXT =
  '天空为什么是蓝色的？带你看懂“瑞利散射”阳光看起来是白色的其实是各种颜色的光混在一起不同颜色波长不同：红光波长长，蓝光、紫光波长短红橙黄绿青蓝紫波长变短' +
  '阳光撞上空气分子蓝光：大量被散射到四面八方红光：大多直接穿过散射强度 ∝ 1 / 波长⁴红光 700nm蓝光 450nm≈ 倍空气分子比光的波长小得多，会把光散射到四面八方这叫瑞利散射：波长越短，散射越强，蓝光被散射得约是红光的 6 倍' +
  '紫光散射更强，为什么天不是紫的？阳光里的紫光，本来就比蓝光少人眼对紫光不太敏感各色散射光混在一起，看起来就是天蓝色紫光波长更短，按理说散射得更厉害但阳光中紫光较少、人眼又不敏感，最终我们看到的是蓝色' +
  '大气层你正午：阳光穿过的大气很薄傍晚：阳光斜穿厚厚的大气正午，阳光穿过的大气路程短，散射出的蓝光铺满天空傍晚光路变长，蓝光沿途几乎被散射殆尽，剩下的红橙光染红了晚霞' +
  '波长越短，散射越强白天，我们看到被散射的蓝光；傍晚，看到穿透过来的红光由 Claude 用 Remotion 编写 · 画面全部由代码生成' +
  ALL_CAPTIONS;

export const SkyBlue: React.FC<{voice: VoiceName}> = ({voice}) => {
  useFonts();
  const {scenes} = buildTimeline(voice);
  const dir = VOICES[voice].dir;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* 隐藏的全文本，确保所有字形分片都被字体加载器请求到 */}
      <div style={{position: 'absolute', opacity: 0, fontFamily: '"Noto Sans SC"'}}>
        <span style={{fontWeight: 400}}>{ALL_TEXT}</span>
        <span style={{fontWeight: 700}}>{ALL_TEXT}</span>
        <span style={{fontWeight: 900}}>{ALL_TEXT}</span>
      </div>
      {scenes.map(({name, from, duration, beats}) => {
        const C = COMPONENTS[name];
        return (
          <Sequence key={name} name={name} from={from} durationInFrames={duration}>
            <SceneFade duration={duration}>
              <C beats={beats} />
            </SceneFade>
            {Object.values(beats).map((b) => (
              <Sequence key={b.id} name={`voice ${b.id}`} from={b.from} durationInFrames={b.dur + 2}>
                <Audio src={staticFile(`${dir}/${b.id}.wav`)} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const VARIANTS: {id: string; voice: VoiceName}[] = [
  {id: 'SkyBlue', voice: 'kokoro'},
  {id: 'SkyBlueGemini', voice: 'gemini'},
];

export const Root: React.FC = () => (
  <>
    {VARIANTS.map(({id, voice}) => (
      <Composition
        key={id}
        id={id}
        component={SkyBlue}
        defaultProps={{voice}}
        durationInFrames={buildTimeline(voice).total}
        fps={FPS}
        width={1920}
        height={1080}
      />
    ))}
  </>
);
