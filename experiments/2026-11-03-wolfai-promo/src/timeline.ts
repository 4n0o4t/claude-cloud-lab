import narration from '../narration/zh-CN.json';
import manifest from './voice-manifest.json';

/** 旁白驱动的时间轴：每幕时长 = 旁白时长 + 前后留白，相邻两幕交叉淡化 XF 帧。 */
export const FPS = 30;
export const XF = 10; // 交叉淡化帧数
const LEAD = 8; // 每幕开始后多少帧开口
const TAIL = 14; // 旁白结束后留多少帧

export type SceneId = 'hook' | 'home' | 'roles' | 'setup' | 'night' | 'day' | 'vote' | 'end' | 'outro';
const ORDER: SceneId[] = ['hook', 'home', 'roles', 'setup', 'night', 'day', 'vote', 'end', 'outro'];
const MIN: Partial<Record<SceneId, number>> = {outro: 120};

type Line = {id: string; scene: SceneId; speak: string; caption: string | null};
const LINES = narration as Line[];
const ms = (manifest as {lines: Record<string, {durationMs: number}>}).lines;

export type Scene = {id: SceneId; from: number; dur: number; voice: {id: string; at: number; dur: number}; caption: string | null};

const build = () => {
  let cursor = 0;
  const scenes: Scene[] = ORDER.map((id) => {
    const line = LINES.find((l) => l.scene === id)!;
    const vDur = Math.ceil((ms[line.id].durationMs / 1000) * FPS);
    const dur = Math.max(LEAD + vDur + TAIL, MIN[id] ?? 0);
    const s: Scene = {id, from: cursor, dur, voice: {id: line.id, at: LEAD, dur: vDur}, caption: line.caption};
    cursor += dur - XF;
    return s;
  });
  const last = scenes[scenes.length - 1];
  return {scenes, total: last.from + last.dur};
};

export const TIMELINE = build();
