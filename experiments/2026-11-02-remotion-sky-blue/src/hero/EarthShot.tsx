import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import React, {useMemo} from 'react';
import {Easing, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';

/** 太阳方向（世界坐标）：从右侧照来，晨昏线落在画面中部偏右。 */
const SUN_DIR = new THREE.Vector3(1, 0.12, -0.25).normalize();

// 程序化地球：值噪声 fbm 生成大陆、云层和夜面城市灯光，不依赖任何贴图。
const NOISE = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

const earthVertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const earthFragment = /* glsl */ `
uniform vec3 sunDir;
uniform float cloudShift;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main() {
  vec3 p = vObj;
  vec3 n = normalize(vNormalW);
  float h = fbm(p * 2.2 + 3.1);
  float land = smoothstep(0.555, 0.575, h);
  float lat = abs(p.y);
  vec3 ocean = mix(vec3(0.004, 0.03, 0.10), vec3(0.01, 0.09, 0.24), fbm(p * 7.0));
  vec3 landCol = mix(vec3(0.07, 0.16, 0.05), vec3(0.32, 0.26, 0.15), smoothstep(0.58, 0.7, h));
  landCol = mix(landCol, vec3(0.85), smoothstep(0.78, 0.9, lat));
  vec3 base = mix(ocean, landCol, land);
  float clouds = smoothstep(0.56, 0.82, fbm(p * 3.6 + vec3(cloudShift, 10.0, 0.0)));
  base = mix(base, vec3(0.92), clouds * 0.85);

  float ndl = dot(n, sunDir);
  float day = smoothstep(-0.12, 0.2, ndl);
  vec3 col = base * (0.015 + 1.15 * max(ndl, 0.0));
  // 晨昏线附近的暖色：阳光在那里斜穿大气，蓝光被散射掉
  float term = exp(-pow((ndl - 0.02) / 0.05, 2.0));
  col += vec3(1.0, 0.38, 0.1) * term * 0.07 * (0.4 + 0.6 * clouds);
  // 夜面城市灯光
  // 城市灯光：只在陆地夜面，小而稀疏的亮点
  float city = land * (1.0 - clouds) * smoothstep(0.78, 0.86, fbm(p * 90.0)) * smoothstep(0.62, 0.75, fbm(p * 9.0)) * (1.0 - day);
  col += vec3(1.0, 0.7, 0.32) * city * 1.2;
  // 海面高光
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 hv = normalize(sunDir + v);
  col += (1.0 - land) * (1.0 - clouds) * pow(max(dot(n, hv), 0.0), 80.0) * 0.8 * day;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const atmoVertex = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// 大气辉光：背面球壳，边缘亮；受光面偏蓝（瑞利散射），晨昏线偏橙
const atmoFragment = /* glsl */ `
uniform vec3 sunDir;
uniform float power;
uniform float strength;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), power);
  float ndl = dot(n, sunDir);
  float lit = smoothstep(-0.35, 0.25, ndl);
  vec3 blue = vec3(0.25, 0.55, 1.0);
  vec3 orange = vec3(1.0, 0.45, 0.18);
  vec3 c = mix(orange, blue, smoothstep(-0.05, 0.45, ndl));
  gl_FragColor = vec4(c * rim * lit * strength, 1.0);
  #include <colorspace_fragment>
}
`;

const Camera: React.FC<{t: number}> = ({t}) => {
  const camera = useThree((s) => s.camera);
  // 在渲染阶段直接设置相机，保证每一帧只由帧号决定
  camera.position.set(
    interpolate(t, [0, 1], [-0.4, 0.55]),
    interpolate(t, [0, 1], [0.5, 0.3]),
    interpolate(t, [0, 1], [5.6, 3.3]),
  );
  // 起始时地球偏右给标题留位置，随后镜头推向晨昏线
  camera.lookAt(interpolate(t, [0, 1], [-1.15, 0.25]), interpolate(t, [0, 1], [0.15, 0]), 0);
  return null;
};

const Stars: React.FC = () => {
  const geometry = useMemo(() => {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = random(`su${i}`) * 2 - 1;
      const th = random(`st${i}`) * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([60 * r * Math.cos(th), 60 * u, 60 * r * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#cfd8ff" size={1.6} sizeAttenuation={false} transparent opacity={0.75} />
    </points>
  );
};

export const EarthShot: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  });
  const earthUniforms = useMemo(
    () => ({sunDir: {value: SUN_DIR}, cloudShift: {value: 0}}),
    [],
  );
  earthUniforms.cloudShift.value = frame * 0.0015;
  const outerUniforms = useMemo(() => ({sunDir: {value: SUN_DIR}, power: {value: 3.2}, strength: {value: 1.6}}), []);
  const innerUniforms = useMemo(() => ({sunDir: {value: SUN_DIR}, power: {value: 2.2}, strength: {value: 0.55}}), []);

  return (
    <ThreeCanvas width={width} height={height} camera={{fov: 38, near: 0.1, far: 200}} style={{background: '#02030a'}}>
      <Camera t={t} />
      <Stars />
      <group rotation={[0.35, frame * 0.0012 - 0.6, 0.08]}>
        <mesh>
          <sphereGeometry args={[1, 160, 160]} />
          <shaderMaterial vertexShader={earthVertex} fragmentShader={earthFragment} uniforms={earthUniforms} />
        </mesh>
      </group>
      {/* 贴着地表的一层薄雾，让地球边缘发蓝 */}
      <mesh>
        <sphereGeometry args={[1.012, 128, 128]} />
        <shaderMaterial
          vertexShader={atmoVertex}
          fragmentShader={atmoFragment}
          uniforms={innerUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 外层辉光 */}
      <mesh>
        <sphereGeometry args={[1.07, 128, 128]} />
        <shaderMaterial
          vertexShader={atmoVertex}
          fragmentShader={atmoFragment}
          uniforms={outerUniforms}
          side={THREE.BackSide}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </ThreeCanvas>
  );
};
