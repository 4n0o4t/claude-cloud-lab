// 玩家视角检查：6 人局、真人坐 3 号。拍夜晚的 3D 圆桌（3 号应转到正前方），再点“平面”验证能切回 2D。
// 前提同 shoot.mjs。用法（实验目录下）：node tools/shoot-player.mjs <输出目录>
import fs from 'node:fs';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node tools/shoot-player.mjs <输出目录>');
fs.mkdirSync(OUT, {recursive: true});
const API = 'http://127.0.0.1:8101';
const WEB = 'http://127.0.0.1:3000';
const MOCK = 'http://127.0.0.1:8900';
const post = async (u, b) =>
  (await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: b && JSON.stringify(b)})).json();

const SEAT = 3;
const g = await post(`${API}/api/game/create`, {
  preset_id: 'standard_6p',
  total_players: 6,
  num_wolves: 2,
  human_seats: [SEAT],
  god_mode: {enabled: true, password: 'demo-god-pass'},
});
await post(`${MOCK}/director`, {game_id: g.game_id, password: 'demo-god-pass'});

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 1920, height: 1080}});
const page = await ctx.newPage();
await page.goto(`${WEB}/`);
// 和开局页一样把座位密钥存进 localStorage，否则私密视角会 401
await page.evaluate(async ([id, secrets]) => {
  const m = await import('/src/gameSeatAccess.js');
  m.storeSeatSecrets(id, secrets);
}, [g.game_id, g.seat_secrets]);
await page.goto(`${WEB}/game/${g.game_id}/${SEAT}`);
await page.waitForTimeout(2500);
await post(`${API}/api/game/${g.game_id}/start`);
await page.waitForTimeout(6000);

const front = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.arena .seat-node')];
  const lowest = nodes.reduce((a, b) => (parseFloat(b.style.top) > parseFloat(a.style.top) ? b : a));
  return {is3d: document.querySelector('.arena')?.classList.contains('is-3d'), frontLabel: lowest.textContent.trim()};
});
await page.locator('.stage').screenshot({path: `${OUT}/player-night-3d.png`});
await page.getByRole('button', {name: '平 面'}).click();
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  is3d: document.querySelector('.arena')?.classList.contains('is-3d'),
  saved: localStorage.getItem('wk.arena.mode'),
}));
await page.locator('.stage').screenshot({path: `${OUT}/player-night-2d.png`});
await browser.close();
await post(`${API}/api/game/${g.game_id}/terminate`).catch(() => {});
console.log(JSON.stringify({game: g.game_id, front, after}));
