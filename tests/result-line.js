// 投了したとき、棋譜の末尾が「先手（名前）の勝ち」になるか
const { chromium } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('NG:', m); process.exitCode = 1; } else console.log('OK:', m); };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(400);
  await p.click('[data-go="ai"]'); await p.click('#levelList label:nth-child(1)'); await p.click('#aiStart'); await p.waitForTimeout(700);
  await p.click('.cell[data-sq="56"]'); await p.click('.cell[data-sq="47"]'); await p.waitForTimeout(1400);
  await p.click('[data-act="resign"]'); await p.waitForSelector('#dlgConfirm[open]'); await p.click('#confirmOk'); await p.waitForTimeout(500);
  const name = await p.evaluate(() => JSON.parse(localStorage.getItem('kisho.profile') || '{}').name);
  const last = await p.evaluate(() => [...document.querySelectorAll('#moveList li')].pop().innerText);
  console.log('末尾の行:', last, '/ 名前:', name);
  ok(/^後手（.+）の勝ち \(投了\)/.test(last), '「後手（名前）の勝ち (投了)」と出る(AIの名前入り)');
  ok(errors.length === 0, 'JSエラーなし ' + errors.join('|'));
  await b.close();
})();
