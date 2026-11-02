import narration from '../narration/zh-CN.json';
import kokoroManifest from './voice-manifest.json';
import geminiManifest from './voice-manifest.gemini.json';

/**
 * 由旁白时长推导时间轴：
 * - 每句从 max(at, 上一句结束 + GAP) 开始；at 是这句“最早”出现的帧（相对本幕）。
 * - 每幕时长 = max(画面最短时长, 最后一句结束 + TAIL)。
 * 场景里的关键动画挂在 beat 上，所以旁白变长时画面会一起顺延。
 * 同一套画面可以配不同引擎的旁白，每个引擎有自己的 manifest 和音频目录。
 */
export const FPS = 30;
const GAP = 8;
const TAIL = 28;

export const SCENE_ORDER = ['Hook', 'WhiteLight', 'Scattering', 'WhyNotViolet', 'Sunset', 'Outro'] as const;
export type SceneName = (typeof SCENE_ORDER)[number];

/** 画面本身需要的最短时长（帧）。 */
const MIN_DURATION: Record<SceneName, number> = {
  Hook: 150,
  WhiteLight: 270,
  Scattering: 360,
  WhyNotViolet: 270,
  Sunset: 300,
  Outro: 150,
};

type NarrationLine = {id: string; scene: string; at?: number; speak: string; caption: string | null};
export type Beat = {id: string; from: number; dur: number; end: number; caption: string | null};
export type Beats = Record<string, Beat>;
type Manifest = {lines: Record<string, {durationMs: number}>};

const lines = narration as NarrationLine[];

/** partial: 允许旁白没生成全（如配额用完），此时只渲染到第一个旁白不全的幕之前。 */
export const VOICES = {
  kokoro: {dir: 'voice/zh-CN', manifest: kokoroManifest as Manifest, partial: false},
  gemini: {dir: 'voice/zh-CN-gemini', manifest: geminiManifest as Manifest, partial: true},
} as const;
export type VoiceName = keyof typeof VOICES;

export const buildTimeline = (voiceName: VoiceName) => {
  const {manifest, partial} = VOICES[voiceName];
  const voice = manifest.lines;
  const complete = (name: SceneName) => lines.filter((x) => x.scene === name).every((l) => voice[l.id]);
  const firstMissing = SCENE_ORDER.findIndex((name) => !complete(name));
  if (firstMissing >= 0 && !partial) {
    throw new Error(`${voiceName} 的 voice manifest 不全（${SCENE_ORDER[firstMissing]}），先运行 tools/tts.py`);
  }
  const usable = firstMissing >= 0 ? SCENE_ORDER.slice(0, firstMissing) : SCENE_ORDER;
  let cursor = 0;
  const scenes = usable.map((name) => {
    const beats: Beats = {};
    let prevEnd = -GAP;
    for (const l of lines.filter((x) => x.scene === name)) {
      const v = voice[l.id];
      const from = Math.max(l.at ?? 0, prevEnd + GAP);
      const dur = Math.ceil((v.durationMs / 1000) * FPS);
      beats[l.id] = {id: l.id, from, dur, end: from + dur, caption: l.caption};
      prevEnd = from + dur;
    }
    const duration = Math.max(MIN_DURATION[name], prevEnd + TAIL);
    const scene = {name, from: cursor, duration, beats};
    cursor += duration;
    return scene;
  });
  return {scenes, total: cursor};
};

export const ALL_CAPTIONS = lines.map((l) => l.caption ?? '').join('');

/** 取某句的 beat，写错 id 时直接报错，避免静默错位。 */
export const beat = (beats: Beats, id: string): Beat => {
  const b = beats[id];
  if (!b) throw new Error(`本幕没有旁白 ${id}`);
  return b;
};

/** 把有字幕的 beat 转成字幕行。 */
export const captionLines = (beats: Beats) =>
  Object.values(beats)
    .filter((b) => b.caption)
    .map((b) => ({from: b.from, to: b.end + 6, text: b.caption as string}));
