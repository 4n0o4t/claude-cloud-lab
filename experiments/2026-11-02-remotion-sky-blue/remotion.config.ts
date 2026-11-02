import {Config} from '@remotion/cli/config';

// 云端容器里预装了 Playwright 的 headless Chromium，设置 REMOTION_BROWSER 即可复用，
// 不设置时 Remotion 会自动下载自己的浏览器。
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null);
Config.setConcurrency(4);

// 3D（Three.js）和 @remotion/effects 需要 WebGL。官方 skill 建议用 'angle'，
// 但云端容器没有 GPU，'angle' 和 'swiftshader' 都建不出 WebGL 上下文，实测只有
// 'swangle'（ANGLE + SwiftShader 软件渲染）可用。有 GPU 的机器可设 REMOTION_GL=angle。
Config.setChromiumOpenGlRenderer((process.env.REMOTION_GL as 'angle' | 'swangle' | undefined) ?? 'swangle');
