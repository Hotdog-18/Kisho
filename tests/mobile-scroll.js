// 縦長(iPhone)で指しても、ページが棋譜へスクロールされず盤が見えたままか
const { chromium, devices } = require('playwright');
const ok = (c, m) => { if (!c) { console.log('NG:', m); process.exitCode = 1; } else console.log('OK:', m); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(400);
  await p.tap('[data-go="ai"]'); await p.tap('#levelList label:nth-child(1)'); await p.tap('#aiStart'); await p.waitForTimeout(800);
  const y0 = await p.evaluate(() => scrollY);
  const boardVisible = () => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; });
  ok(await boardVisible(), '開始直後は盤が画面に収まっている');
  // 数手指す(自分→AI の応手を待つ)
  const moves = [[6 * 9 + 2, 5 * 9 + 2], [6 * 9 + 6, 5 * 9 + 6], [6 * 9 + 0, 5 * 9 + 0], [6 * 9 + 8, 5 * 9 + 8]];
  for (const [f, t] of moves) {
    await p.tap(`.cell[data-sq="${f}"]`); await p.tap(`.cell[data-sq="${t}"]`); await p.waitForTimeout(1400);
    const y = await p.evaluate(() => scrollY);
    ok(Math.abs(y - y0) < 2 && await boardVisible(), '指した後もページが動かず盤が見える (scrollY=' + y + ')');
  }
  const n = await p.evaluate(() => document.querySelectorAll('#moveList li[data-i]').length);
  ok(n >= 8, '棋譜には手が追加されている (' + n + '行)');
  ok(errors.length === 0, 'JSエラーなし ' + errors.join('|'));
  await b.close();
})();
