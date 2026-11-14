const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html';
const errors = [];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mk = async (tag) => {
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(300); return p;
  };
  const join = async (p, name, pass) => {
    await p.click('[data-go="friend"]'); await p.waitForSelector('#dlgFriend[open]');
    await p.fill('#fName', name); await p.fill('#fPass', pass);
    await p.selectOption('#fTc', '5-10');
    await p.click('#friendStart');
  };
  const A = await mk('A'), B = await mk('B');
  await join(A, 'アリス', 'ひみつ');
  await A.waitForSelector('#dlgWait[open]'); await A.screenshot({ path: 'out/shots/wait.png' });
  await join(B, 'ボブ', 'ひみつ');
  await A.waitForSelector('#game:not([hidden])', { timeout: 8000 });
  await B.waitForSelector('#game:not([hidden])', { timeout: 8000 });
  const colA = await A.evaluate(() => KishoApp.G.myColor), colB = await B.evaluate(() => KishoApp.G.myColor);
  console.log('A色', colA, 'B色', colB, colA !== colB ? 'OK' : 'NG');
  const [blk, wht] = colA === 0 ? [A, B] : [B, A];
  // 先手: 7六歩
  await blk.click('.cell[data-sq="velo"]'.replace('velo', String(6 * 9 + 2))); await blk.click(`.cell[data-sq="${5 * 9 + 2}"]`);
  await wht.waitForFunction(() => KishoApp.G.game.moves.length === 1, null, { timeout: 5000 });
  // 後手: 3四歩 (3三=row2,col6 → 3四=row3,col6)
  await wht.click(`.cell[data-sq="${2 * 9 + 6}"]`); await wht.click(`.cell[data-sq="${3 * 9 + 6}"]`);
  await blk.waitForFunction(() => KishoApp.G.game.moves.length === 2, null, { timeout: 5000 });
  console.log('同期した手:', await blk.$$eval('#moveList li[data-i]', (e) => e.map((x) => x.textContent.trim()).join('|')));
  // 手番でない側は動かせない
  await blk.click(`.cell[data-sq="${6 * 9 + 3}"]`); await blk.click(`.cell[data-sq="${5 * 9 + 3}"]`); // 先手が7六歩→3四歩の後、先手番: これは指せる
  await wht.waitForFunction(() => KishoApp.G.game.moves.length === 3, null, { timeout: 5000 });
  // 後手が先手の駒を動かそうとしても動かない
  await wht.click(`.cell[data-sq="${6 * 9 + 5}"]`);
  console.log('後手が後手番でなく選択できてしまった?', await wht.evaluate(() => !!KishoApp.G.sel));
  // チャット
  await wht.click('#tabChat'); await wht.fill('#chatInput', 'よろしく！'); await wht.press('#chatInput', 'Enter');
  await blk.waitForFunction(() => document.querySelector('#chatLog').textContent.includes('よろしく'), null, { timeout: 5000 });
  console.log('チャット届いた: OK');
  // 時計
  console.log('時計表示:', await blk.$$eval('.clock', (e) => e.map((x) => x.textContent)));
  // 投了 → 相手側にも結果
  await blk.click('[data-act="resign"]'); await blk.click('#confirmOk');
  await wht.waitForSelector('#dlgResult[open]', { timeout: 5000 });
  console.log('相手側の結果:', (await wht.textContent('#resultBody')).replace(/\s+/g, ' ').slice(0, 80));
  await wht.screenshot({ path: 'out/shots/room-result.png' });
  // もう一局 (両方押す)
  const origW = await wht.evaluate(() => KishoApp.G.myColor);
  await wht.click('#dlgResult button[value="again"]');
  await blk.waitForSelector('#dlgResult[open]');
  await blk.click('#dlgResult button[value="again"]');
  await wht.waitForFunction(() => KishoApp.G && !KishoApp.G.over && KishoApp.G.game.moves.length === 0, null, { timeout: 8000 });
  const c2 = await wht.evaluate(() => KishoApp.G.myColor);
  console.log('再戦で色が入れ替わった:', c2 !== origW ? 'OK' : 'NG', '(前', origW, '→', c2, ')');
  console.log('errors:', errors.length ? errors : 'なし');
  await browser.close();
})().catch((e) => { console.error(e); console.log('errors so far:', errors); process.exit(1); });
