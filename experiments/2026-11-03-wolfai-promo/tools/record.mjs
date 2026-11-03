// 录制宣传片素材：一整局剧本对局（旁观视角）+ 首页 / 开局页 / 卷宗页。
// 前提：wolfai-killer 后端（:8101）、前端（:3000）和 tools/mock_llm.py（:8900）都已启动，见 README。
// 用法（实验目录下）：node tools/record.mjs [输出目录，默认 ../../temp/wolf-rec]
import fs from 'node:fs';
import {createRequire} from 'node:module';

// 云端容器的 Playwright 是全局预装的，只能走 require 解析（ESM import 不读 NODE_PATH）；
// 本机没装的话先 npm i -g playwright。
const {chromium} = createRequire(import.meta.url)('playwright');

const OUT = process.argv[2] ?? '../../temp/wolf-rec';
const API = 'http://127.0.0.1:8101';
const WEB = 'http://127.0.0.1:3000';
const MOCK = 'http://127.0.0.1:8900';
const GOD = 'demo-god-pass'; // 只是本地演示局的上帝密码
fs.mkdirSync(OUT, {recursive: true});

const json = async (url, init) => (await fetch(url, init)).json();
const post = (url, body) =>
  json(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: body && JSON.stringify(body)});

/** 页面内平滑滚动（ease-in-out），录出来像真人在滑。 */
const smooth = (p, y, ms) =>
  p.evaluate(
    ([y, ms]) =>
      new Promise((r) => {
        const s = scrollY;
        const t0 = performance.now();
        const f = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          scrollTo(0, s + (y - s) * e);
          k < 1 ? requestAnimationFrame(f) : r();
        };
        requestAnimationFrame(f);
      }),
    [y, ms],
  );

const browser = await chromium.launch();

async function clip(name, fn) {
  const ctx = await browser.newContext({
    viewport: {width: 1920, height: 1080},
    recordVideo: {dir: `${OUT}/${name}`, size: {width: 1920, height: 1080}},
  });
  const page = await ctx.newPage();
  const result = await fn(page);
  const video = page.video();
  await ctx.close();
  fs.renameSync(await video.path(), `${OUT}/${name}.webm`);
  fs.rmdirSync(`${OUT}/${name}`);
  console.log('录好', `${OUT}/${name}.webm`);
  return result;
}

// 1. 剧本对局：建局 → 告诉假接口对局 ID → 打开旁观页 → 开局，记录每条日志出现的时间
const {game_id: gid} = await post(`${API}/api/game/create`, {
  preset_id: 'standard_6p',
  total_players: 6,
  num_wolves: 2,
  god_mode: {enabled: true, password: GOD},
});
await post(`${MOCK}/director`, {game_id: gid, password: GOD});

const marks = await clip('game', async (p) => {
  const t0 = Date.now();
  const at = () => +((Date.now() - t0) / 1000).toFixed(2);
  await p.goto(`${WEB}/game/${gid}`);
  await p.waitForTimeout(2500);
  await post(`${API}/api/game/${gid}/start`);
  const out = [];
  for (let seen = 0; at() < 240; ) {
    await p.waitForTimeout(400);
    const {logs = []} = await json(`${API}/api/game/${gid}/log?offset=${seen}&limit=200`);
    logs.forEach((l) => out.push({t: at(), type: l.type, seat: l.seat, content: l.content}));
    seen += logs.length;
    if ((await json(`${API}/api/game/${gid}/status`)).phase === 'ended') {
      await p.waitForTimeout(5000);
      break;
    }
  }
  return out;
});
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify({gid, marks}, null, 1));

// 2. 首页：首屏 → 滑到“二十种身份”
await clip('home', async (p) => {
  await p.goto(`${WEB}/`);
  await p.waitForTimeout(4000);
  await smooth(p, 900, 2500);
  await p.waitForTimeout(1500);
  await smooth(p, 1900, 2500);
  await p.waitForTimeout(1500);
});

// 3. 开局页：选“标准六人局”，往下滑过角色配置和模型池
await clip('setup', async (p) => {
  await p.goto(`${WEB}/setup`);
  await p.waitForTimeout(2500);
  await p.getByText('标准六人局').first().click();
  await p.waitForTimeout(1500);
  for (const y of [700, 1400, 2200]) {
    await smooth(p, y, 2500);
    await p.waitForTimeout(1500);
  }
});

// 4. 卷宗复盘页
await clip('detail', async (p) => {
  await p.goto(`${WEB}/history/${gid}`);
  await p.waitForTimeout(3500);
  await smooth(p, 800, 3000);
  await p.waitForTimeout(1500);
  await smooth(p, 1600, 3000);
  await p.waitForTimeout(1500);
});

await browser.close();
console.log('对局', gid, '日志', marks.length, '条');
