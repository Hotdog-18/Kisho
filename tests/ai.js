const S = require('../js/shogi.js');
const AI = require('../js/ai.js');
const K = require('../js/krs.js');
let fail = 0;
const ok = (name, cond, extra) => { if (!cond) fail++; console.log((cond ? 'OK ' : 'NG ') + name + (extra ? '  ' + extra : '')); };

const eng = new AI.Engine(18);

// 1手詰めを見つける: 後手玉1一、先手の金を2二に打てば詰み(香が1二を塞ぐ形)
let pos = S.fromSfen('8k/9/7PP/9/9/9/9/9/K8 b G 1');
let r = eng.think(pos, { maxDepth: 4 });
const g = new S.Game('8k/9/7PP/9/9/9/9/9/K8 b G 1'); g.play(r.move);
ok('1手詰めを発見', g.status() && g.status().reason === 'checkmate', S.describeMove(pos, r.move, 0));

// 駒得: タダで取れる飛車を取る
pos = S.fromSfen('4k4/9/9/9/4r4/9/4R4/9/4K4 b - 1'); // 5五の飛を5七の飛で取れる(相手の飛は取り返せない形ではない)
r = eng.think(pos, { maxDepth: 3 });
ok('駒を取れる', S.moveTo(r.move) === S.sq(5, 5), S.describeMove(pos, r.move, 0));

// 王手放置はしない
pos = S.fromSfen('4k4/9/9/9/9/9/9/4r4/4K4 b - 1'.replace('4r4/4K4', '9/4K4'));
ok('合法手のみ返す', S.legalMoves(pos).includes(eng.think(pos, { maxDepth: 3 }).move));

// 各レベルが合法手を返す
for (let lv = 1; lv <= 10; lv++) {
  const p = S.fromSfen(S.START_SFEN), t0 = Date.now();
  const res = eng.chooseMove(p, lv);
  ok(`Lv${lv} 初手が合法 (${Date.now() - t0}ms, depth ${res.depth}, nodes ${res.nodes})`, S.legalMoves(p).includes(res.move));
}

// KRS計算
ok('期待勝率(同格=0.5)', Math.abs(K.expected(1000, 1000) - 0.5) < 1e-9);
const u = K.update(1000, 0, 1000, 1);
ok('同格に勝つと+20 (K=40)', u.rating === 1020, JSON.stringify(u));
ok('称号', K.title(1000) === '桂' && K.title(2100) === '棋匠' && K.title(500) === '見習い');

// 振り返り解析
const game = new S.Game();
const seq = [['77', '76'], ['33', '34'], ['88', '22', 1], ['31', '22'], ['24', '25']];
const legalNow = () => game.legal();
for (const [f, t, pr] of seq.slice(0, 4)) game.play(S.mk(S.sq(+f[0], +f[1]), S.sq(+t[0], +t[1]), pr));
const t0 = Date.now();
const rev = AI.analyzeGame(game, eng, { depth: 4, maxNodes: 30000 });
ok(`振り返り解析 (${Date.now() - t0}ms)`, rev.plies.length === 4 && rev.plies.every((x) => x.gradeName), rev.plies.map((x) => x.text + ':' + x.gradeName).join(' '));
ok('正確度が算出される', rev.accuracy[0] !== null, JSON.stringify(rev.accuracy));

console.log(fail ? `\n${fail} 件失敗` : '\nすべて成功');
process.exit(fail ? 1 : 0);
