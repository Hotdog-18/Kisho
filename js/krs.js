/*
 * KRS — KISHO RATING SYSTEM (棋匠レーティング)
 * ※ KISHO が計算する独自のレーティングです。
 *   日本将棋連盟など、公的な団体の段級位・レーティングとは一切関係ありません。
 *
 * 計算方法: チェスの Elo レーティングと同じ考え方。
 *   期待勝率 E = 1 / (1 + 10^((相手 - 自分) / 400))
 *   更新     R' = R + K × (結果 - E)   (勝ち=1 / 引き分け=0.5 / 負け=0)
 *   K値は対局数が少ないほど大きい (暫定期間): 〜19局 K=40 / 20〜59局 K=28 / 60局〜 K=20
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KRS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAME = 'KRS', FULL_NAME = 'KISHO RATING SYSTEM', KANJI = '棋匠レーティング';
  const INITIAL = 1000;
  const DISCLAIMER = 'KRSは KISHO が独自に計算するレーティングです。日本将棋連盟などの公的な段級位・レーティングとは関係ありません。';

  // AIレベルごとのKRS (AI同士の隣り合うレベルの対戦結果から算出した目安。tools/calibrate.js で測定。最上位は全勝だったため控えめな値)
  let AI_RATINGS = [400, 700, 890, 1120, 1280, 1370, 1560, 1840, 2120, 2570];

  function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
  function kFactor(games) { return games < 20 ? 40 : games < 60 ? 28 : 20; }
  function update(rating, games, oppRating, score) {
    const next = rating + kFactor(games) * (score - expected(rating, oppRating));
    return { rating: Math.round(next), delta: Math.round(next) - Math.round(rating) };
  }
  function aiRating(level) { return AI_RATINGS[Math.min(Math.max(level, 1), AI_RATINGS.length) - 1]; }
  function setAiRatings(arr) { AI_RATINGS = arr.slice(); }

  // 称号 (駒の格付け風)。公式の段級位とは無関係な、KISHO だけの呼び名
  const TITLES = [
    [0, '見習い'], [700, '歩'], [850, '香'], [1000, '桂'], [1150, '銀'], [1300, '金'],
    [1450, '角'], [1600, '飛'], [1750, '玉'], [1900, '龍'], [2050, '棋匠'],
  ];
  function title(rating) {
    let t = TITLES[0][1];
    for (const [min, name] of TITLES) if (rating >= min) t = name;
    return t;
  }

  return { NAME, FULL_NAME, KANJI, INITIAL, DISCLAIMER, expected, kFactor, update, aiRating, setAiRatings, title, TITLES };
});
