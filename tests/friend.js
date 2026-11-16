// 「友達と指す」: Enterで開始 / 待機表示
const { chromium } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('NG:', m); process.exitCode = 1; } else console.log('OK:', m); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(400);
  await p.click('[data-go="friend"]'); await p.waitForSelector('#dlgFriend[open]');
  await p.fill('#fPass', 'ためし'); await p.press('#fPass', 'Enter'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => document.querySelector('#dlgWait').open), '合言葉でEnter → 待機画面が開く(消えない)');
  ok((await p.textContent('#waitBody h2')) === '相手方を待っています...', '見出し「相手方を待っています...」');
  ok(/合言葉「ためし」で入室してもらうべし。/.test(await p.textContent('#waitBody')), '「入室してもらうべし。」');
  const a1 = await p.evaluate(() => getComputedStyle(document.querySelector('.spin')).animationName + '|' + getComputedStyle(document.querySelector('.spin')).transform);
  await p.waitForTimeout(250);
  const a2 = await p.evaluate(() => getComputedStyle(document.querySelector('.spin')).transform);
  ok(a1.startsWith('spin|') && a1.split('|')[1] !== a2, '丸いスピナーが回っている');
  await p.press('#waitBody input', 'Enter'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#dlgWait').open), '招待リンク欄でEnterしても閉じない');
  await p.screenshot({ path: 'out/shots/wait.png' });
  await p.click('#dlgWait .btn.ghost'); await p.waitForTimeout(300);
  ok(await p.locator('#home').isVisible(), '「やめる」でホームへ戻る');
  // 合言葉が空のままEnter → 閉じずに案内
  await p.click('[data-go="friend"]'); await p.waitForSelector('#dlgFriend[open]'); await p.fill('#fPass', ''); await p.press('#fName', 'Enter'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#dlgFriend').open), '合言葉が空のEnterでは閉じない');
  // AI設定でもEnterで開始
  await p.keyboard.press('Escape'); await p.click('[data-go="ai"]'); await p.waitForSelector('#dlgAi[open]'); await p.focus('#levelList input'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  ok(await p.locator('#game').isVisible(), 'AI設定でEnter → 対局開始');
  ok(errors.length === 0, 'JSエラーなし ' + errors.join('|'));
  await b.close();
})();
