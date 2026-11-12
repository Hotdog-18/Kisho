const S = require('../js/shogi.js');
let fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log((ok ? 'OK ' : 'NG ') + name + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)); };
const mv = (g, f, t, p) => S.mk(S.sq(+f[0], +f[1]), S.sq(+t[0], +t[1]), p);
const dr = (ty, t) => S.dropMove(ty, S.sq(+t[0], +t[1]));

// 初期局面
let g = new S.Game();
eq('初期合法手数', g.legal().length, 30);
eq('▲7六歩', g.play(mv(g, '77', '76')), '▲７六歩');
eq('△3四歩', g.play(mv(g, '33', '34')), '△３四歩');
eq('▲2二角成', g.play(mv(g, '88', '22', 1)), '▲２二角成');
eq('△同銀', g.play(mv(g, '31', '22')), '△同　銀');
eq('KIF先頭', S.toKif(g).split('\n')[6].trim().startsWith('1 ７六歩(77)'), true);

// 二歩
let p = S.fromSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
eq('二歩は不可', S.legalMoves(p).some((m) => S.moveFrom(m) === 81 && S.moveTo(m) % 9 === 4), false);
eq('他の筋には歩を打てる', S.legalMoves(p).some((m) => S.moveFrom(m) === 81 && S.moveTo(m) % 9 === 3), true);

// 行き所のない駒
p = S.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b PLN 1');
const dropsOnRank1 = S.legalMoves(p).filter((m) => S.moveFrom(m) >= 81 && S.moveTo(m) < 9).map((m) => S.moveFrom(m) - 80);
eq('一段目に打てるのは無し(歩香桂)', dropsOnRank1, []);

// 打ち歩詰め: 後手玉1一、▲2三に金・▲1三... 典型例
p = S.fromSfen('7nk/9/7GP/9/9/9/9/9/K8 b P 1'); // 1二に歩を打つと詰みに見えるが…
const pawnDrop = S.legalMoves(p).some((m) => S.moveFrom(m) === 81 && S.moveTo(m) === S.sq(1, 2));
eq('打ち歩詰め禁止', pawnDrop, false);

// 詰み判定
p = S.fromSfen('7nk/9/7GP/9/9/9/9/9/K8 b - 1');
g = new S.Game('7nk/9/7GP/9/9/9/9/9/K8 b - 1');
g.play(S.mk(S.sq(1, 3), S.sq(1, 2))); // 歩を進めて詰み(玉の逃げ場無し/桂は動けない)
eq('歩で詰み', g.status() && g.status().reason, 'checkmate');

// 成り: 3段目から成れる/不成可、1段目は強制成り
p = S.fromSfen('4k4/9/4P4/9/9/9/9/9/4K4 b - 1');
const pm = S.legalMoves(p).filter((m) => S.moveFrom(m) === S.sq(5, 3));
eq('歩が2段目へ: 成りのみ/不成も可', pm.length, 2);
p = S.fromSfen('9/4P4/9/9/9/9/9/k8/4K4 b - 1');
eq('歩が1段目へ: 成り強制', S.legalMoves(p).filter((m) => S.moveFrom(m) === S.sq(5, 2)).every((m) => S.movePromo(m) === 1), true);

// 「右・左・直」の区別
p = S.fromSfen('4k4/9/9/9/9/9/9/9/3GKG3 b - 1'.replace('3GKG3', '2GGKG3'));
g = new S.Game('4k4/9/9/9/9/9/9/9/3G1G1K1 b - 1');
const t1 = g.legal().map((m) => S.describeMove(g.pos, m, 0, g.legal())).filter((t) => t.includes('金') && t.includes('５八'));
eq('金の左右区別', t1.sort(), ['▲５八金右', '▲５八金左'].sort());

// 千日手
g = new S.Game('4k4/9/9/9/9/9/9/9/4K4 b R 1'.replace(' b R ', ' b - '));
const a = mv(g, '59', '58'), b2 = mv(g, '51', '52'), a2 = mv(g, '58', '59'), b3 = mv(g, '52', '51');
for (let i = 0; i < 3; i++) { g.play(a); g.play(b2); g.play(a2); g.play(b3); }
eq('千日手(引き分け)', g.status() && g.status().reason, 'sennichite');

// 入玉宣言
p = S.fromSfen('4K4/PPPPPPPPP/9/9/9/9/9/PPP6/k8 b 2R2B 1'.replace('PPP6', '9'));
eq('入玉宣言(27点法)', S.canDeclareImpasse(p, 0), false);

// SFEN往復
const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
eq('SFEN往復', S.toSfen(S.fromSfen(sfen)), sfen);
const sfen2 = '4k4/9/9/9/9/9/9/9/4K4 w 2Pb3p 7';
eq('SFEN往復(持ち駒)', S.toSfen(S.fromSfen(sfen2), 7), sfen2);

console.log(fail ? `\n${fail} 件失敗` : '\nすべて成功');
process.exit(fail ? 1 : 0);
