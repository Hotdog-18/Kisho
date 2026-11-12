const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html';
const errors = [];
const hook = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
};
(async () => {
  const browser = await chromium.launch();
  // ---- モバイル ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage(); hook(mp, 'mobile');
  await mp.goto(URL); await mp.waitForTimeout(400);
  await mp.screenshot({ path: 'out/shots/m-home.png' });
  await mp.evaluate(() => KishoApp.startGame({ mode: 'local', myColor: 0, names: ['先手', '後手'], krs: [null, null], tc: { on: true, main: 300, byo: 10 }, tcId: '5-10', unrated: true }));
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: 'out/shots/m-game.png', fullPage: true });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile 横スクロール:', overflow);

  // ---- PC: 成り・打つ・テーマ・振り返り ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); hook(page, 'pc');
  await page.goto(URL); await page.waitForTimeout(300);
  await page.evaluate(() => KishoApp.startGame({ mode: 'local', myColor: 0, names: ['先手', '後手'], krs: [null, null], tc: { on: false, main: 0, byo: 0 }, tcId: 'none', unrated: true, startSfen: '4k4/9/4P4/9/9/9/9/9/4K4 b - 1' }));
  await page.click('.cell[data-sq="22"]'); await page.click('.cell[data-sq="13"]');
  await page.waitForSelector('#dlgPromote[open]'); await page.waitForTimeout(150);
  await page.screenshot({ path: 'out/shots/promote.png' });
  await page.click('#promoChoices button:first-child');
  await page.waitForTimeout(200);
  console.log('成り:', await page.$$eval('#moveList li[data-i]', (e) => e.map((x) => x.textContent.trim()).join('|')));

  await page.evaluate(() => KishoApp.startGame({ mode: 'local', myColor: 0, names: ['先手', '後手'], krs: [null, null], tc: { on: false, main: 0, byo: 0 }, tcId: 'none', unrated: true, startSfen: '4k4/9/9/9/9/9/9/9/4K4 b 2P1G 1' }));
  await page.click('.hp[data-t="1"]'); await page.waitForTimeout(100);
  await page.screenshot({ path: 'out/shots/drop.png' });
  const dests = await page.$$eval('.cell.dest', (e) => e.length);
  console.log('歩を打てるマス数:', dests, '(二歩なしなら 79 - 王のマス…)');

  // テーマ切替
  await page.evaluate(() => { const g = KishoApp; });
  await page.click('#settingsBtn'); await page.waitForSelector('#dlgSettings[open]');
  await page.screenshot({ path: 'out/shots/settings.png' });
  await page.click('[data-ps="ebony"]'); await page.click('[data-bt="tatami"]');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.screenshot({ path: 'out/shots/theme-ebony.png' });
  await page.click('#settingsBtn'); await page.click('[data-ps="letters"]'); await page.click('[data-bt="sumi"]');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.screenshot({ path: 'out/shots/theme-letters.png' });
  await page.click('#settingsBtn'); await page.click('[data-ps="night"]'); await page.click('[data-bt="ai"]');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.screenshot({ path: 'out/shots/theme-night.png' });
  await page.click('#settingsBtn'); await page.click('[data-ps="kaya"]'); await page.click('[data-bt="kaya"]'); await page.keyboard.press('Escape');

  // ランダム対局 → 振り返り
  await page.evaluate(async () => {
    const A = KishoApp; A.startGame({ mode: 'local', myColor: 0, names: ['テスト先手', 'テスト後手'], krs: [null, null], tc: { on: false, main: 0, byo: 0 }, tcId: 'none', unrated: true });
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 30 && !A.G.over; i++) { const l = A.G.game.legal(); A.applyMove(l[Math.floor(rnd() * l.length)], 1, false); }
    if (!A.G.over) A.finish('black', 'resign');
  });
  await page.waitForSelector('#dlgResult[open]'); await page.click('#dlgResult button[value="review"]');
  await page.waitForSelector('#rvRun'); await page.click('#rvRun');
  await page.waitForSelector('.rv-graph', { timeout: 90000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'out/shots/review.png' });
  // 悪手っぽい手を選んで最善手を表示
  const bad = await page.evaluate(() => { const A = KishoApp; const rv = A.G.review; const i = rv.plies.findIndex((p) => p.grade === 'bad' || p.grade === 'doubt'); return i; });
  console.log('疑問手/悪手のインデックス:', bad);
  if (bad >= 0) {
    await page.click(`#rvMoves li[data-i="${bad + 1}"]`); await page.waitForTimeout(100);
    const showBtn = await page.$('#rvShow');
    if (showBtn) { await showBtn.click(); await page.waitForTimeout(200); }
    await page.screenshot({ path: 'out/shots/review-arrow.png' });
  }
  console.log('errors:', errors.length ? errors : 'なし');
  await browser.close();
})().catch((e) => { console.error(e); console.log('errors so far:', errors); process.exit(1); });
