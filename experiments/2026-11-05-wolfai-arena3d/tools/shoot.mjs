// 给 wolfai-killer 对局页的圆桌拍对照截图：6 人局白天发言中、投票中 + 12/16 人局待开局，三种视口宽度。
// 前提：wolfai-killer 后端 :8101、前端 :3000、宣传片实验的 tools/mock_llm.py :8900 都已启动。
// 用法（实验目录下）：node tools/shoot.mjs <输出目录> [--mode 2d|3d]
//   --mode 写进 localStorage 的 wk.arena.mode，用来切换原型补丁里的 2D / 3D；原版前端没有这个开关，忽略即可。
import fs from 'node:fs';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : null;
if (!OUT) throw new Error('用法：node tools/shoot.mjs <输出目录> [--mode 2d|3d]');
fs.mkdirSync(OUT, {recursive: true});

const API = 'http://127.0.0.1:8101';
const WEB = 'http://127.0.0.1:3000';
const MOCK = 'http://127.0.0.1:8900';
const GOD = 'demo-god-pass';
const json = async (u, i) => (await fetch(u, i)).json();
const post = (u, b) => json(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: b && JSON.stringify(b)});
const create = (body) => post(`${API}/api/game/create`, {...body, god_mode: {enabled: true, password: GOD}});

/** 开一局 6 人剧本局，跑到 done(phase, logs) 为真时暂停定格。假接口一次只导演一局，所以顺序跑。 */
async function sixUntil(done) {
  const g = await create({preset_id: 'standard_6p', total_players: 6, num_wolves: 2});
  await post(`${MOCK}/director`, {game_id: g.game_id, password: GOD});
  await post(`${API}/api/game/${g.game_id}/start`);
  for (const t0 = Date.now(); Date.now() - t0 < 240000; ) {
    await new Promise((r) => setTimeout(r, 400));
    const st = await json(`${API}/api/game/${g.game_id}/status`);
    const {logs = []} = await json(`${API}/api/game/${g.game_id}/log?offset=0&limit=500`);
    if (done(st.phase, logs)) break;
  }
  await post(`${API}/api/game/${g.game_id}/pause`).catch(() => {});
  return g;
}
const count = (logs, type) => logs.filter((l) => l.type === type).length;
// 白天发言中（已有 2 条发言）；投票中（至少 3 票，前端票数也是从 vote 日志推出来的）
const day = await sixUntil((phase, logs) => phase === 'day' && count(logs, 'speech') >= 2);
const six = await sixUntil((phase, logs) => phase === 'vote' && count(logs, 'vote') >= 3);
const twelve = await create({total_players: 12, num_wolves: 3});
const sixteen = await create({total_players: 16, num_wolves: 4});

const VIEWS = [
  ['desk', {width: 1920, height: 1080}],
  ['laptop', {width: 1366, height: 768}],
  ['phone', {width: 390, height: 844}],
];
const browser = await chromium.launch();
for (const [vname, viewport] of VIEWS) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: 1});
  if (mode) await ctx.addInitScript((m) => localStorage.setItem('wk.arena.mode', m), mode);
  const page = await ctx.newPage();
  for (const [gname, g] of [['6p-day', day], ['6p-vote', six], ['12p', twelve], ['16p', sixteen]]) {
    await page.goto(`${WEB}/game/${g.game_id}`);
    await page.waitForTimeout(3200); // 旁观页 2.5 秒轮询一次
    const stage = page.locator('.stage');
    await stage.scrollIntoViewIfNeeded();
    await stage.screenshot({path: `${OUT}/${gname}-${vname}.png`});
  }
  await ctx.close();
}
await browser.close();
console.log('截图写到', OUT);
