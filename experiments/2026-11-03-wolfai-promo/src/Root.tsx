import React from 'react';
import {Composition} from 'remotion';
import {Promo} from './Promo';
import {FPS, TIMELINE} from './timeline';
import {Trailer} from './trailer/Trailer';
import {TOTAL} from './trailer/kit';

export const RemotionRoot: React.FC = () => (
  <>
    {/* 第二版：拆组件 + 3D + 卡点（默认看这个） */}
    <Composition id="WolfTrailer" component={Trailer} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    {/* 第一版：录屏推镜 + 旁白，留作对照 */}
    <Composition id="WolfPromo" component={Promo} durationInFrames={TIMELINE.total} fps={FPS} width={1920} height={1080} />
  </>
);
