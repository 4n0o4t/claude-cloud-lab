import {Easing, interpolate} from 'remotion';

/**
 * 地面镜头的太阳高度角（度），由帧号决定。
 * descentFrom/descentTo：太阳开始和结束下落的帧（挂在“傍晚”那句旁白上）。
 */
export const sunElevation = (frame: number, descentFrom: number, descentTo: number) =>
  frame < descentFrom
    ? interpolate(frame, [0, descentFrom], [60, 54])
    : interpolate(frame, [descentFrom, descentTo], [54, 0.8], { // 停在刚贴地平线、晚霞最浓的时刻
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.45, 0, 0.35, 1),
      });

/**
 * 相对大气质量（阳光穿过的大气厚度，正午天顶为 1）。
 * Kasten & Young (1989)：AM = 1 / (cos z + 0.50572 · (96.07995° − z)^−1.6364)，z 为天顶角。
 * 地平线处约 38。
 */
export const airMass = (elevationDeg: number) => {
  const z = 90 - Math.max(elevationDeg, 0);
  return 1 / (Math.cos((z * Math.PI) / 180) + 0.50572 * (96.07995 - z) ** -1.6364);
};
