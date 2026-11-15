// ホームへ戻る確認(3択)と、AI対戦の保存・再開のテスト
const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html';
const ok = (c, m) => { if (!c) { console.log('NG:', m); process.exitCode = 1; } else console.log('OK:', m); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL); await p.waitForTimeout(400);
  ok(await p.locator('#savedCard').isHidden(), '保存が無いときは「中断中の対局」を出さない');
  await p.click('[data-go="ai"]'); await p.click('#levelList label:nth-child(1)'); await p.click('#aiStart'); await p.waitForTimeout(700);
  const sq = (s) => `.cell[data-sq="${s}"]`;
  // ロゴ: 0手のときは確認なしでホームへ
  await p.click('#logoBtn'); await p.waitForTimeout(200);
  ok(await p.locator('#home').isVisible(), '0手ならそのままホームへ戻る');
  await p.click('[data-go="ai"]'); await p.click('#aiStart'); await p.waitForTimeout(700);
  await p.click(sq(6 * 9 + 2)); await p.click(sq(5 * 9 + 2)); await p.waitForTimeout(1500); // 7六歩 → AIが応手
  const n1 = await p.evaluate(() => document.querySelectorAll('#moveList li, #moveList .mv, #moveList button').length);
  // --- 戻る(キャンセル) ---
  await p.click('#logoBtn'); await p.waitForSelector('#dlgConfirm[open]');
  ok((await p.textContent('#confirmMsg')) === '対局を打ち切りしてホームへ戻りますか？', '文言が「打ち切りしてホームへ」');
  ok((await p.textContent('#confirmNo')) === '戻る' && (await p.textContent('#confirmOk')) === '打ち切り', 'ボタンは「戻る」(キャンセル)と「打ち切り」');
  ok(await p.locator('#confirmExtra').isVisible() && (await p.textContent('#confirmExtra')) === '保存して中断', 'AI対戦では「保存して中断」も出る');
  await p.click('#confirmNo'); await p.waitForTimeout(200);
  ok(await p.locator('#game').isVisible(), '「戻る」を押すと対局に戻る');
  // --- 保存して中断 ---
  const movesBefore = await p.evaluate(() => window.__G ? 0 : 0);
  await p.click('#logoBtn'); await p.waitForSelector('#dlgConfirm[open]'); await p.click('#confirmExtra'); await p.waitForTimeout(300);
  ok(await p.locator('#home').isVisible(), '保存して中断するとホームへ');
  ok(await p.locator('#savedCard').isVisible() && (await p.locator('#savedList li').count()) === 1, 'ホームに「中断中の対局」が1件出る');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('kisho.aiSaves')));
  ok(saved.length === 1 && saved[0].moves.length >= 2 && saved[0].times.length === saved[0].moves.length, '手数と消費時間が保存されている (' + saved[0].moves.length + '手)');
  // リロードしても残る
  await p.reload(); await p.waitForTimeout(400);
  ok(await p.locator('#savedList li').count() === 1, 'リロードしても残る');
  // --- 再開 ---
  await p.click('[data-resume]'); await p.waitForTimeout(900);
  ok(await p.locator('#game').isVisible(), '再開すると対局画面へ');
  const st = await p.evaluate(() => ({ cnt: document.querySelectorAll('.cell .piece').length, txt: document.querySelector('#game').innerText }));
  ok(st.cnt === 40, '盤上の駒は40枚 (' + st.cnt + ')');
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('kisho.aiSaves'))).length === 0, '再開した保存分は消える');
  // 続きが指せる: 手数が増える
  const before = saved[0].moves.length;
  const side = saved[0].myColor; // 0=先手。2手保存なら自分の手番
  if (before % 2 === side) { // 自分の手番
    await p.click(sq(6 * 9 + 6)); await p.click(sq(5 * 9 + 6)); await p.waitForTimeout(1200);
  }
  await p.click('#logoBtn'); await p.waitForSelector('#dlgConfirm[open]'); await p.click('#confirmExtra'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem('kisho.aiSaves'))[0].moves.length);
  ok(after > before, '再開後に指して再保存できる (' + before + ' → ' + after + '手)');
  // --- 削除 ---
  await p.click('[data-sdel]'); await p.waitForSelector('#dlgConfirm[open]');
  ok((await p.textContent('#confirmNo')) === 'やめる', '他の確認では「やめる」のまま');
  await p.click('#confirmOk'); await p.waitForTimeout(200);
  ok(await p.locator('#savedCard').isHidden(), '削除すると「中断中の対局」が消える');
  // --- 打ち切り ---
  await p.click('[data-go="ai"]'); await p.click('#aiStart'); await p.waitForTimeout(700);
  await p.click(sq(6 * 9 + 2)); await p.click(sq(5 * 9 + 2)); await p.waitForTimeout(1500);
  await p.click('#logoBtn'); await p.waitForSelector('#dlgConfirm[open]'); await p.click('#confirmOk'); await p.waitForTimeout(300);
  ok(await p.locator('#home').isVisible() && await p.locator('#savedCard').isHidden(), '「打ち切り」はホームへ戻り、保存されない');
  // --- 上限5局 ---
  await p.evaluate(() => localStorage.setItem('kisho.aiSaves', JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, savedAt: Date.now(), myColor: 0, level: 1, names: ['a', 'b'], moves: [1, 2], times: [0, 0] })))));
  await p.reload(); await p.waitForTimeout(300);
  await p.click('[data-go="ai"]'); await p.click('#aiStart'); await p.waitForTimeout(700);
  await p.click(sq(6 * 9 + 2)); await p.click(sq(5 * 9 + 2)); await p.waitForTimeout(1500);
  await p.click('#logoBtn'); await p.waitForSelector('#dlgConfirm[open]');
  ok(await p.locator('#confirmExtra').isHidden() && /いっぱい/.test(await p.textContent('#confirmHint')), '5局まで。いっぱいなら「保存して中断」は出ない');
  ok(errors.length === 0, 'JSエラーなし ' + errors.join(' | '));
  await b.close();
})();
