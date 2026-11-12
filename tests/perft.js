// 初期局面の perft (公開されている正解値と比較)
const S = require('../js/shogi.js');
const expected = [1, 30, 900, 25470, 719731, 19861490];
const maxDepth = +(process.argv[2] || 4);
let ok = true;
for (let d = 1; d <= maxDepth; d++) {
  const pos = S.fromSfen(S.START_SFEN);
  const t0 = Date.now();
  const n = S.perft(pos, d);
  const ms = Date.now() - t0;
  const pass = n === expected[d];
  if (!pass) ok = false;
  console.log(`depth ${d}: ${n} (${expected[d]}) ${pass ? 'OK' : 'NG'}  ${ms}ms  ${Math.round(n / Math.max(ms, 1))}k nps`);
}
process.exit(ok ? 0 : 1);
