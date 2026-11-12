// 時計(秒読み・切れ負け)と通信将棋の保存・再開を確認
const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html';
const errors = [];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL); await page.waitForTimeout(300);

  // 1) 切れ負け: 持ち時間2秒・秒読み0
  await page.evaluate(() => KishoApp.startGame({ mode: 'local', myColor: 0, names: ['先手', '後手'], krs: [null, null], tc: { on: true, main: 2, byo: 0 }, tcId: '3-0', unrated: true }));
  await page.waitForSelector('#dlgResult[open]', { timeout: 6000 });
  console.log('切れ負け:', (await page.textContent('#resultBody')).replace(/\s+/g, ' ').slice(0, 40));
  await page.keyboard.press('Escape');

  // 2) 秒読み: 持ち時間0・秒読み3秒。2秒で指せば続行、4秒放置なら負け
  await page.evaluate(() => KishoApp.startGame({ mode: 'local', myColor: 0, names: ['先手', '後手'], krs: [null, null], tc: { on: true, main: 0, byo: 3 }, tcId: '0-30', unrated: true }));
  await page.waitForTimeout(1200);
  console.log('秒読み表示:', await page.$$eval('.clock', (e) => e.map((x) => x.textContent.replace(/\s+/g, ''))));
  await page.click(`.cell[data-sq="${6 * 9 + 2}"]`); await page.click(`.cell[data-sq="${5 * 9 + 2}"]`);
  await page.waitForTimeout(300);
  const over1 = await page.evaluate(() => !!KishoApp.G.over);
  console.log('1.2秒で指した後は続行:', !over1 ? 'OK' : 'NG', '/ 手番:', await page.evaluate(() => KishoApp.G.game.pos.side));
  await page.waitForSelector('#dlgResult[open]', { timeout: 6000 });
  console.log('放置で時間切れ:', (await page.textContent('#resultBody')).replace(/\s+/g, ' ').slice(0, 40));
  await page.keyboard.press('Escape');

  // 3) 通信将棋: 1人目が指して離脱 → 再入室で続きから
  const join = async (p, name, pass) => {
    await p.evaluate(() => KishoApp.goHome());
    await p.click('[data-go="friend"]'); await p.waitForSelector('#dlgFriend[open]');
    await p.fill('#fName', name); await p.fill('#fPass', pass); await p.selectOption('#fStyle', 'async');
    await p.click('#friendStart');
  };
  await join(page, 'アリス', 'つうしん');
  await page.waitForSelector('#game:not([hidden])');
  await page.click(`.cell[data-sq="${6 * 9 + 2}"]`); await page.click(`.cell[data-sq="${5 * 9 + 2}"]`);
  await page.waitForTimeout(300);
  await page.evaluate(() => KishoApp.goHome());
  await join(page, 'アリス', 'つうしん');
  await page.waitForSelector('#game:not([hidden])');
  await page.waitForTimeout(300);
  console.log('再入室で復元:', await page.$$eval('#moveList li[data-i]', (e) => e.map((x) => x.textContent.trim()).join('|')));
  console.log('errors:', errors.length ? errors : 'なし');
  await browser.close();
})().catch((e) => { console.error(e); console.log('errors so far:', errors); process.exit(1); });
