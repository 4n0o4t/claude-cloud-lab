import React from 'react';
import {Composition} from 'remotion';
import {Promo} from './Promo';
import {FPS, TIMELINE} from './timeline';

export const RemotionRoot: React.FC = () => (
  <Composition id="WolfPromo" component={Promo} durationInFrames={TIMELINE.total} fps={FPS} width={1920} height={1080} />
);
