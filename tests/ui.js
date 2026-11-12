const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'out/shots/home.png' });

  // AI対局開始 (Lv1, 先手, 無制限)
  await page.click('[data-go="ai"]');
  await page.waitForSelector('#dlgAi[open]');
  await page.screenshot({ path: 'out/shots/dlg-ai.png' });
  await page.click('#levelList label:nth-child(1)');
  await page.click('#aiStart');
  await page.waitForSelector('#game:not([hidden])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'out/shots/game0.png' });

  // 7六歩: 7七(col=2,row=6)をクリック → 7六
  const clickSq = async (sq) => page.click(`.cell[data-sq="${sq}"]`);
  await clickSq(6 * 9 + 2); await page.waitForTimeout(100);
  await page.screenshot({ path: 'out/shots/game-sel.png' });
  await clickSq(5 * 9 + 2);
  await page.waitForTimeout(1500);
  const moves = await page.$$eval('#moveList li[data-i]', (els) => els.map((e) => e.textContent.trim()));
  console.log('moves:', moves.join(' | '));
  await page.screenshot({ path: 'out/shots/game1.png' });

  // 投了 → 結果
  page.once('dialog', (d) => d.accept());
  await page.click('[data-act="resign"]');
  await page.waitForSelector('#dlgResult[open]');
  await page.waitForTimeout(200);
  console.log('result:', (await page.textContent('#resultBody')).replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: 'out/shots/result.png' });

  console.log('errors:', errors.length ? errors : 'なし');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
