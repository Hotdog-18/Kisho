// AIの各レベルを総当たり(隣同士)で対戦させて、KRSの目安を測る
// 使い方: node tools/calibrate.js <pair開始> <pair終了> <1ペアの対局数> <出力json>
const S = require('../js/shogi.js');
const AI = require('../js/ai.js');
const fs = require('fs');

const from = +process.argv[2] || 1, to = +process.argv[3] || 9, games = +process.argv[4] || 10;
const out = process.argv[5] || 'calib.json';

function rngSeed(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function playGame(lvBlack, lvWhite, opening, rng) {
  const engB = new AI.Engine(18), engW = new AI.Engine(18);
  const game = new S.Game();
  for (const m of opening) game.play(m);
  let adjud = 0;
  while (true) {
    const st = game.status();
    if (st) return st.result === 'draw' ? 0.5 : st.result === 'black' ? 1 : 0;
    if (game.moves.length >= 220) { const ev = game.pos.ev; return ev > 500 ? 1 : ev < -500 ? 0 : 0.5; }
    const side = game.pos.side, eng = side === 0 ? engB : engW, lv = side === 0 ? lvBlack : lvWhite;
    const r = eng.chooseMove(game.pos, lv, rng);
    if (!r.move) return side === 0 ? 0 : 1;
    // 大差が続いたら打ち切り (どちらかが +1500cp 以上を維持)
    const sc = r.score * (side === 0 ? 1 : -1);
    if (Math.abs(sc) > 1800 && lv >= 3) adjud++; else adjud = 0;
    if (adjud >= 6) return sc > 0 ? 1 : 0;
    game.play(r.move);
  }
}

const results = [];
for (let lv = from; lv <= to; lv++) {
  const a = lv, b = lv + 1;
  let scoreB = 0, n = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const rng = rngSeed(1000 * lv + (g >> 1));
    // ランダム開局 (4手)
    const p = new S.Game(), opening = [];
    for (let i = 0; i < 4; i++) { const lm = p.legal(); const m = lm[Math.floor(rng() * lm.length)]; opening.push(m); p.play(m); }
    const rng2 = rngSeed(777 + g + lv * 31);
    const bLow = g % 2 === 0; // 偶数: 弱い方が先手
    const res = bLow ? playGame(a, b, opening, rng2) : playGame(b, a, opening, rng2);
    scoreB += bLow ? 1 - res : res; // 強い側(b)の得点
    n++;
  }
  const s = Math.min(0.97, Math.max(0.03, scoreB / n));
  const diff = -400 * Math.log10(1 / s - 1);
  results.push({ weak: a, strong: b, games: n, strongScore: scoreB / n, eloDiff: Math.round(diff) });
  console.log(`Lv${b} vs Lv${a}: ${scoreB}/${n}  Elo差 ${Math.round(diff)}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
}
