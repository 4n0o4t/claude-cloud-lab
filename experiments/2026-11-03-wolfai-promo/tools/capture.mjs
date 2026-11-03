// 第二版素材：deviceScaleFactor 2 的高清截图，供 Remotion 拆成组件做层叠/3D 镜头。
// 前提同 record.mjs（后端 :8101、前端 :3000、tools/mock_llm.py :8900 都已启动）。
// 用法（实验目录下）：node tools/capture.mjs [输出目录，默认 ../../temp/wolf-cap]
// 产出：
//   game/NNN.png  对局每出现新日志就截一张整屏（旁观视角），index.json 记日志内容
//   home-hero.png / role-*.png / setup-*.png / detail-full.png  页面与元素截图
import fs from 'node:fs';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)('playwright');

const OUT = process.argv[2] ?? '../../temp/wolf-cap';
const API = 'http://127.0.0.1:8101';
const WEB = 'http://127.0.0.1:3000';
const MOCK = 'http://127.0.0.1:8900';
const GOD = 'demo-god-pass';
fs.mkdirSync(`${OUT}/game`, {recursive: true});

const json = async (url, init) => (await fetch(url, init)).json();
const post = (url, body) =>
  json(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: body && JSON.stringify(body)});

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 2});
const page = await ctx.newPage();

// 1. 对局
const {game_id: gid} = await post(`${API}/api/game/create`, {
  preset_id: 'standard_6p',
  total_players: 6,
  num_wolves: 2,
  god_mode: {enabled: true, password: GOD},
});
await post(`${MOCK}/director`, {game_id: gid, password: GOD});
await page.goto(`${WEB}/game/${gid}`);
await page.waitForTimeout(2500);
await post(`${API}/api/game/${gid}/start`);

const index = [];
let seen = 0;
let n = 0;
const shot = async (note) => {
  const f = `game/${String(n++).padStart(3, '0')}.png`;
  await page.screenshot({path: `${OUT}/${f}`});
  index.push({file: f, note});
};
for (const t0 = Date.now(); Date.now() - t0 < 300000; ) {
  await page.waitForTimeout(500);
  const {logs = []} = await json(`${API}/api/game/${gid}/log?offset=${seen}&limit=200`);
  seen += logs.length;
  const ended = (await json(`${API}/api/game/${gid}/status`)).phase === 'ended';
  if (logs.length) {
    await page.waitForTimeout(2700); // 等旁观页 2.5 秒一次的轮询把新状态画出来
    await shot(logs.map((l) => `${l.seat ?? '-'}|${l.type}|${l.content}`).join(' // '));
  }
  if (ended) {
    await page.waitForTimeout(3000);
    await shot('ended');
    break;
  }
}
// 卷宗栏（左侧实录）整列
await page.locator('.log-col').screenshot({path: `${OUT}/log-col.png`});
const players = await (
  await fetch(`${API}/api/game/${gid}/god-mode/players`, {headers: {'X-God-Password': GOD}})
).json();
fs.writeFileSync(`${OUT}/game/index.json`, JSON.stringify({gid, players, index}, null, 1));

// 2. 首页：首屏 + 身份墙
await page.goto(`${WEB}/`);
await page.waitForTimeout(3500);
await page.screenshot({path: `${OUT}/home-hero.png`});
const stage = page.locator('.role-stage').first();
await stage.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await stage.screenshot({path: `${OUT}/role-stage.png`});
await page.locator('.role-mini-grid').first().screenshot({path: `${OUT}/role-grid.png`});
const cells = page.locator('.role-cell');
const count = await cells.count();
for (let i = 0; i < count; i++) {
  await cells.nth(i).click();
  await page.waitForTimeout(450);
  await page.locator('.role-detail').first().screenshot({path: `${OUT}/role-${String(i).padStart(2, '0')}.png`});
}

// 3. 开局页
await page.goto(`${WEB}/setup`);
await page.waitForTimeout(2500);
await page.screenshot({path: `${OUT}/setup-top.png`});
await page.getByText('标准六人局').first().click();
await page.waitForTimeout(1200);
await page.screenshot({path: `${OUT}/setup-picked.png`});
await page.screenshot({path: `${OUT}/setup-full.png`, fullPage: true});

// 4. 卷宗页整页
await page.goto(`${WEB}/history/${gid}`);
await page.waitForTimeout(3500);
await page.screenshot({path: `${OUT}/detail-full.png`, fullPage: true});

await browser.close();
console.log('对局', gid, '截图', n, '张，身份卡', count, '张');
