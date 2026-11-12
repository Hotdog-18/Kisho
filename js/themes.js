/* 駒と盤のデザイン一覧。見た目そのものは css/style.css の .ps-* / .bt-* で定義 */
(function (root) {
  'use strict';
  const PIECE_SETS = [
    { id: 'kaya', name: '榧木', note: '明るい木地に墨の字', glyph: 'kanji' },
    { id: 'ebony', name: '黒檀', note: '黒い駒に金の字', glyph: 'kanji' },
    { id: 'shu', name: '朱漆', note: '朱塗りに白い字', glyph: 'kanji' },
    { id: 'paper', name: '白磁', note: '白地に細い藍の字', glyph: 'kanji' },
    { id: 'night', name: '夜光', note: '暗い盤向けの淡い光', glyph: 'kanji' },
    { id: 'letters', name: '英字', note: 'P L N S G B R K で表示', glyph: 'letters' },
  ];
  const BOARD_THEMES = [
    { id: 'kaya', name: '榧' },
    { id: 'sumi', name: '墨' },
    { id: 'tatami', name: '畳' },
    { id: 'ai', name: '藍' },
    { id: 'paper', name: '和紙' },
    { id: 'sakura', name: '桜' },
  ];
  // 駒の種類 (1歩 2香 3桂 4銀 5金 6角 7飛 8玉 9と 10成香 11成桂 12成銀 13馬 14龍)
  const KANJI = ['', '歩', '香', '桂', '銀', '金', '角', '飛', '玉', 'と', '杏', '圭', '全', '馬', '龍'];
  const LETTERS = ['', 'P', 'L', 'N', 'S', 'G', 'B', 'R', 'K', '+P', '+L', '+N', '+S', '+B', '+R'];
  function glyph(type, side, setId) {
    const set = PIECE_SETS.find((s) => s.id === setId) || PIECE_SETS[0];
    if (set.glyph === 'letters') return LETTERS[type];
    if (type === 8) return side === 0 ? '玉' : '王';
    return KANJI[type];
  }
  root.KishoThemes = { PIECE_SETS, BOARD_THEMES, glyph, KANJI };
})(window);
