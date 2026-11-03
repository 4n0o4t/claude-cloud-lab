import {Config} from '@remotion/cli/config';

// 云端容器里预装了 Playwright 的 headless Chromium，设置 REMOTION_BROWSER 即可复用。
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null);
Config.setConcurrency(4);
