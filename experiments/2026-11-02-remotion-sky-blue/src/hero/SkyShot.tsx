import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import React, {useMemo} from 'react';
import {interpolate, interpolateColors, random, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';
import {Sky} from 'three/examples/jsm/objects/Sky.js';
import {sunElevation} from './sun';

/**
 * 地面镜头：Three.js 官方 Sky（Preetham 解析天空模型，含瑞利与 Mie 散射项）。
 * 天空颜色由散射公式随太阳高度角算出来，不是手调的渐变。
 */

const AZIMUTH = 180; // 太阳在相机正前方（-z）

const Rig: React.FC<{elevation: number}> = ({elevation}) => {
  const {camera, gl} = useThree();
  // 地平线大致落在画面下三分之一
  const pitch = interpolate(elevation, [0, 54], [11, 16], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 20 + Math.tan((pitch * Math.PI) / 180) * 1000, -1000);
  // 太阳落下后天空整体变暗，适当提高曝光，保留晚霞层次
  gl.toneMappingExposure = interpolate(elevation, [-2, 3, 12, 30, 54], [0.62, 0.5, 0.3, 0.24, 0.22], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return null;
};

const SkyDome: React.FC<{elevation: number; time: number}> = ({elevation, time}) => {
  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(450000);
    return s;
  }, []);
  const u = sky.material.uniforms;
  const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
  // 低太阳时浊度和瑞利系数略增，晚霞更浓（与官方示例的日落参数同一量级）
  // 正午：低浊度、偏高瑞利 → 通透的蓝；日落：沿用 three.js 官方 Sky 示例的日落参数（浊度 10、瑞利 3、G 0.7）
  u.turbidity.value = interpolate(elevation, [0, 15, 54], [10, 4, 1.6], clamp);
  u.rayleigh.value = interpolate(elevation, [0, 15, 54], [3, 2.4, 1.8], clamp);
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = interpolate(elevation, [0, 54], [0.7, 0.8], clamp);
  u.cloudCoverage.value = 0.32;
  u.cloudDensity.value = 0.35;
  u.time.value = time;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(AZIMUTH);
  u.sunPosition.value.setFromSphericalCoords(1, phi, theta);
  return <primitive object={sky} />;
};

/** 一条远山轮廓：几个正弦叠加加一点确定性噪声。 */
const Ridge: React.FC<{distance: number; height: number; seed: string; color: string}> = ({
  distance,
  height,
  seed,
  color,
}) => {
  const geometry = useMemo(() => {
    const halfW = distance * 1.25;
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, -distance); // 底边压到地平线以下足够深，避免漏出地下的天空
    const steps = 160;
    const ph = [random(`${seed}a`), random(`${seed}b`), random(`${seed}c`)].map((r) => r * Math.PI * 2);
    for (let i = 0; i <= steps; i++) {
      const x = -halfW + (2 * halfW * i) / steps;
      const k = x / distance;
      const y =
        height *
        (0.55 +
          0.25 * Math.sin(k * 2.1 + ph[0]) +
          0.15 * Math.sin(k * 5.3 + ph[1]) +
          0.07 * Math.sin(k * 13.7 + ph[2]) +
          0.04 * (random(`${seed}${i}`) - 0.5));
      shape.lineTo(x, y);
    }
    shape.lineTo(halfW, -distance);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [distance, height, seed]);
  return (
    <mesh geometry={geometry} position={[0, 0, -distance]}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
};

export const SkyShot: React.FC<{descentFrom: number; descentTo: number}> = ({descentFrom, descentTo}) => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const elevation = sunElevation(frame, descentFrom, descentTo);
  // 空气透视：越远越接近天空色；日落时整体压暗成剪影
  const k = interpolate(elevation, [-2, 10, 54], [1, 0.75, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const c = (noon: string, dusk: string) => interpolateColors(k, [0, 1], [noon, dusk]);
  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{fov: 52, near: 1, far: 2000000}}
      gl={{toneMapping: THREE.ACESFilmicToneMapping}}
    >
      <Rig elevation={elevation} />
      <SkyDome elevation={elevation} time={frame / fps} />
      <Ridge distance={5200} height={330} seed="r1" color={c('#93abc9', '#7c5a86')} />
      <Ridge distance={2600} height={170} seed="r2" color={c('#6d86a3', '#4a2f55')} />
      <Ridge distance={1200} height={86} seed="r3" color={c('#42566a', '#26172e')} />
      <Ridge distance={380} height={30} seed="r4" color={c('#1e2a2c', '#0c0710')} />
    </ThreeCanvas>
  );
};
