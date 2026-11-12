/*
 * KISHO — 将棋ルールエンジン (依存ライブラリなし / ブラウザ・Worker・Node 共通)
 *
 * 盤面: 81マスの配列。sq = row*9 + col (row 0 = 一段目 / col 0 = 9筋)
 * 駒: 先手は +type / 後手は -type
 * 手 (整数): from | to<<7 | promote<<14   (from 81〜87 は持ち駒打ち: 80+駒種)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shogi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLACK = 0, WHITE = 1;
  const PAWN = 1, LANCE = 2, KNIGHT = 3, SILVER = 4, GOLD = 5, BISHOP = 6, ROOK = 7, KING = 8,
    TOKIN = 9, PLANCE = 10, PKNIGHT = 11, PSILVER = 12, HORSE = 13, DRAGON = 14;
  // 成り駒 → 元の駒 / 取った駒が持ち駒になる時の種類
  const BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 6, 7];
  const PROMO = [0, 9, 10, 11, 12, 0, 13, 14, 0, 0, 0, 0, 0, 0, 0];
  const NAMES = ['', '歩', '香', '桂', '銀', '金', '角', '飛', '玉', 'と', '成香', '成桂', '成銀', '馬', '龍'];
  const FILE_ZEN = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
  const RANK_KAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const START_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

  const ROW = new Uint8Array(81), COL = new Uint8Array(81);
  for (let i = 0; i < 81; i++) { ROW[i] = (i / 9) | 0; COL[i] = i % 9; }
  // 敵陣 (成れるゾーン)
  const ZONE = [new Uint8Array(81), new Uint8Array(81)];
  for (let i = 0; i < 81; i++) { ZONE[0][i] = ROW[i] <= 2 ? 1 : 0; ZONE[1][i] = ROW[i] >= 6 ? 1 : 0; }

  // ---------- 駒の動き ----------
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const STEP_G = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
  const MOVES = [];
  MOVES[1] = { steps: [[-1, 0]], slides: [] };
  MOVES[2] = { steps: [], slides: [[-1, 0]] };
  MOVES[3] = { steps: [[-2, -1], [-2, 1]], slides: [] };
  MOVES[4] = { steps: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], slides: [] };
  MOVES[5] = MOVES[9] = MOVES[10] = MOVES[11] = MOVES[12] = { steps: STEP_G, slides: [] };
  MOVES[6] = { steps: [], slides: DIAG };
  MOVES[7] = { steps: [], slides: ORTH };
  MOVES[8] = { steps: DIAG.concat(ORTH), slides: [] };
  MOVES[13] = { steps: ORTH, slides: DIAG };
  MOVES[14] = { steps: DIAG, slides: ORTH };

  // RAYS[side][type][sq] = [[sq, sq, ...], ...]  (先に進める順)
  const RAYS = [[], []];
  for (let s = 0; s < 2; s++) {
    const sg = s === 0 ? 1 : -1;
    for (let t = 1; t <= 14; t++) {
      RAYS[s][t] = [];
      for (let sq = 0; sq < 81; sq++) {
        const r0 = ROW[sq], c0 = COL[sq], rays = [];
        for (const [dr, dc] of MOVES[t].steps) {
          const r = r0 + dr * sg, c = c0 + dc * sg;
          if (r >= 0 && r < 9 && c >= 0 && c < 9) rays.push([r * 9 + c]);
        }
        for (const [dr, dc] of MOVES[t].slides) {
          const ray = [];
          let r = r0 + dr * sg, c = c0 + dc * sg;
          while (r >= 0 && r < 9 && c >= 0 && c < 9) { ray.push(r * 9 + c); r += dr * sg; c += dc * sg; }
          if (ray.length) rays.push(ray);
        }
        RAYS[s][t][sq] = rays;
      }
    }
  }
  // ATT[bySide][sq] = [{ray, mask}] : sq から見て攻撃駒がいるかもしれない線
  const ATT = [[], []];
  for (let s = 0; s < 2; s++) {
    const sg = s === 0 ? 1 : -1;
    const map = new Map();
    for (let t = 1; t <= 14; t++) {
      for (const [dr, dc] of MOVES[t].steps) {
        const k = (-dr * sg) + ',' + (-dc * sg) + ',s';
        map.set(k, (map.get(k) || 0) | (1 << t));
      }
      for (const [dr, dc] of MOVES[t].slides) {
        const k = (-dr * sg) + ',' + (-dc * sg) + ',r';
        map.set(k, (map.get(k) || 0) | (1 << t));
      }
    }
    for (let sq = 0; sq < 81; sq++) {
      const arr = [];
      for (const [k, mask] of map) {
        const [dr, dc, kind] = k.split(',');
        const ddr = +dr, ddc = +dc, ray = [];
        let r = ROW[sq] + ddr, c = COL[sq] + ddc;
        while (r >= 0 && r < 9 && c >= 0 && c < 9) {
          ray.push(r * 9 + c);
          if (kind === 's') break;
          r += ddr; c += ddc;
        }
        if (ray.length) arr.push({ ray, mask });
      }
      ATT[s][sq] = arr;
    }
  }

  // ---------- Zobrist ----------
  function mulberry(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) | 0;
    };
  }
  const r1 = mulberry(0x4B15), r2 = mulberry(0x5A0C);
  const ZB1 = new Int32Array(81 * 29), ZB2 = new Int32Array(81 * 29);
  const HZ1 = new Int32Array(16 * 20), HZ2 = new Int32Array(16 * 20);
  for (let i = 0; i < ZB1.length; i++) { ZB1[i] = r1(); ZB2[i] = r2(); }
  for (let i = 0; i < HZ1.length; i++) { HZ1[i] = r1(); HZ2[i] = r2(); }
  const SIDE1 = r1(), SIDE2 = r2();
  const pidx = (p) => (p > 0 ? p : 14 - p);

  // ---------- 評価テーブル (駒の価値 + 位置) : 先手視点で正 ----------
  const VAL = [0, 90, 315, 405, 495, 540, 855, 990, 0, 540, 540, 540, 540, 945, 1085];
  function pst(t, r, c) {
    const a = 8 - r, cen = 4 - Math.abs(c - 4);
    switch (t) {
      case 1: return a * 2 + (cen > 0 ? 2 : 0);
      case 2: return a;
      case 3: return a * 2 + cen;
      case 4: return a * 2 + cen * 2;
      case 6: return cen * 3 + (4 - Math.abs(r - 4)) * 2;
      case 7: return a * 3 + (a >= 6 ? 15 : 0);
      case 8: return Math.abs(c - 4) * 10 - a * 8;
      case 13: return cen * 2 + (4 - Math.abs(r - 4)) * 2;
      case 14: return a * 2;
      default: return 0;
    }
  }
  const BV = new Int16Array(29 * 81);
  for (let t = 1; t <= 14; t++) {
    for (let sq = 0; sq < 81; sq++) {
      const r = ROW[sq], c = COL[sq];
      BV[t * 81 + sq] = VAL[t] + pst(t, r, c);
      BV[(14 + t) * 81 + sq] = -(VAL[t] + pst(t, 8 - r, 8 - c));
    }
  }
  const HV = new Int16Array(16);
  for (let t = 1; t <= 7; t++) { HV[t] = Math.round(VAL[t] * 1.07); HV[8 + t] = -HV[t]; }

  // ---------- 盤面 ----------
  const MAXSTACK = 1100;

  class Position {
    constructor() {
      this.board = new Int8Array(81);
      this.hands = new Int8Array(16); // [side*8 + type]
      this.side = 0;
      this.kingSq = [-1, -1];
      this.h1 = 0; this.h2 = 0; this.ev = 0;
      this.sp = 0;
      this.stMove = new Int32Array(MAXSTACK);
      this.stCap = new Int8Array(MAXSTACK);
      this.stH1 = new Int32Array(MAXSTACK);
      this.stH2 = new Int32Array(MAXSTACK);
      this.stEv = new Int32Array(MAXSTACK);
    }

    clone() {
      const p = new Position();
      p.board.set(this.board); p.hands.set(this.hands);
      p.side = this.side; p.kingSq = this.kingSq.slice();
      p.h1 = this.h1; p.h2 = this.h2; p.ev = this.ev; p.sp = this.sp;
      p.stMove.set(this.stMove.subarray(0, this.sp));
      p.stCap.set(this.stCap.subarray(0, this.sp));
      p.stH1.set(this.stH1.subarray(0, this.sp));
      p.stH2.set(this.stH2.subarray(0, this.sp));
      p.stEv.set(this.stEv.subarray(0, this.sp));
      return p;
    }

    computeHash() {
      let h1 = 0, h2 = 0, ev = 0;
      for (let sq = 0; sq < 81; sq++) {
        const p = this.board[sq];
        if (p !== 0) {
          h1 ^= ZB1[sq * 29 + pidx(p)]; h2 ^= ZB2[sq * 29 + pidx(p)];
          ev += BV[pidx(p) * 81 + sq];
          if (p === KING) this.kingSq[0] = sq; else if (p === -KING) this.kingSq[1] = sq;
        }
      }
      for (let i = 0; i < 16; i++) {
        const c = this.hands[i];
        if (c > 0) { h1 ^= HZ1[i * 20 + c]; h2 ^= HZ2[i * 20 + c]; ev += HV[i] * c; }
      }
      if (this.side === 1) { h1 ^= SIDE1; h2 ^= SIDE2; }
      this.h1 = h1; this.h2 = h2; this.ev = ev;
    }

    isAttacked(sq, by) {
      const att = ATT[by][sq], b = this.board, black = by === 0;
      for (let i = 0; i < att.length; i++) {
        const e = att[i], ray = e.ray;
        for (let k = 0; k < ray.length; k++) {
          const p = b[ray[k]];
          if (p !== 0) {
            if ((p > 0) === black && ((e.mask >> (p > 0 ? p : -p)) & 1)) return true;
            break;
          }
        }
      }
      return false;
    }

    inCheck(side) {
      if (side === undefined) side = this.side;
      return this.isAttacked(this.kingSq[side], 1 - side);
    }

    makeMove(m) {
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 1;
      const s = this.side, sp = this.sp++, b = this.board;
      this.stMove[sp] = m; this.stH1[sp] = this.h1; this.stH2[sp] = this.h2; this.stEv[sp] = this.ev;
      let h1 = this.h1, h2 = this.h2, ev = this.ev, cap = 0;
      if (from >= 81) {
        const t = from - 80, piece = s === 0 ? t : -t, hi = s * 8 + t, c = this.hands[hi];
        h1 ^= HZ1[hi * 20 + c] ^ (c > 1 ? HZ1[hi * 20 + c - 1] : 0);
        h2 ^= HZ2[hi * 20 + c] ^ (c > 1 ? HZ2[hi * 20 + c - 1] : 0);
        this.hands[hi] = c - 1;
        b[to] = piece;
        h1 ^= ZB1[to * 29 + pidx(piece)]; h2 ^= ZB2[to * 29 + pidx(piece)];
        ev += BV[pidx(piece) * 81 + to] - HV[hi];
      } else {
        const piece = b[from];
        cap = b[to];
        b[from] = 0;
        h1 ^= ZB1[from * 29 + pidx(piece)]; h2 ^= ZB2[from * 29 + pidx(piece)];
        ev -= BV[pidx(piece) * 81 + from];
        if (cap !== 0) {
          const ct = cap > 0 ? cap : -cap, hi = s * 8 + BASE[ct], c = this.hands[hi];
          h1 ^= ZB1[to * 29 + pidx(cap)] ^ (c > 0 ? HZ1[hi * 20 + c] : 0) ^ HZ1[hi * 20 + c + 1];
          h2 ^= ZB2[to * 29 + pidx(cap)] ^ (c > 0 ? HZ2[hi * 20 + c] : 0) ^ HZ2[hi * 20 + c + 1];
          this.hands[hi] = c + 1;
          ev -= BV[pidx(cap) * 81 + to];
          ev += HV[hi];
        }
        let np = piece;
        if (promo) np = piece > 0 ? PROMO[piece] : -PROMO[-piece];
        b[to] = np;
        h1 ^= ZB1[to * 29 + pidx(np)]; h2 ^= ZB2[to * 29 + pidx(np)];
        ev += BV[pidx(np) * 81 + to];
        if (piece === KING || piece === -KING) this.kingSq[s] = to;
      }
      this.stCap[sp] = cap;
      this.side = 1 - s;
      this.h1 = h1 ^ SIDE1; this.h2 = h2 ^ SIDE2; this.ev = ev;
    }

    unmakeMove() {
      const sp = --this.sp, m = this.stMove[sp];
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 1;
      const s = 1 - this.side, b = this.board;
      this.side = s;
      this.h1 = this.stH1[sp]; this.h2 = this.stH2[sp]; this.ev = this.stEv[sp];
      if (from >= 81) {
        b[to] = 0;
        this.hands[s * 8 + from - 80]++;
      } else {
        let piece = b[to];
        if (promo) piece = piece > 0 ? BASE[piece] : -BASE[-piece];
        b[from] = piece;
        const cap = this.stCap[sp];
        b[to] = cap;
        if (cap !== 0) this.hands[s * 8 + BASE[cap > 0 ? cap : -cap]]--;
        if (piece === KING || piece === -KING) this.kingSq[s] = from;
      }
    }

    makeNull() {
      const sp = this.sp++;
      this.stMove[sp] = 0; this.stCap[sp] = 0;
      this.stH1[sp] = this.h1; this.stH2[sp] = this.h2; this.stEv[sp] = this.ev;
      this.side = 1 - this.side;
      this.h1 ^= SIDE1; this.h2 ^= SIDE2;
    }
    unmakeNull() {
      const sp = --this.sp;
      this.side = 1 - this.side;
      this.h1 = this.stH1[sp]; this.h2 = this.stH2[sp];
    }

    // 合法手ならそのまま指して true / 非合法なら盤面を変えず false
    makeLegal(m) {
      this.makeMove(m);
      const s = 1 - this.side;
      if (this.isAttacked(this.kingSq[s], this.side)) { this.unmakeMove(); return false; }
      if ((m & 127) === 81) { // 歩打ち → 打ち歩詰め?
        const to = (m >> 7) & 127;
        if (this.kingSq[this.side] === to + (s === 0 ? -9 : 9) && !hasLegalMove(this)) {
          this.unmakeMove(); return false;
        }
      }
      return true;
    }
  }

  // ---------- 指し手生成 ----------
  function pushPiece(buf, n, from, to, t, s, forSearch) {
    if (PROMO[t] === 0 || !(ZONE[s][from] || ZONE[s][to])) { buf[n++] = from | (to << 7); return n; }
    const r = ROW[to];
    let forced = false;
    if (s === 0) { if ((t === PAWN || t === LANCE) && r === 0) forced = true; else if (t === KNIGHT && r <= 1) forced = true; }
    else { if ((t === PAWN || t === LANCE) && r === 8) forced = true; else if (t === KNIGHT && r >= 7) forced = true; }
    buf[n++] = from | (to << 7) | (1 << 14);
    if (!forced && !(forSearch && (t === PAWN || t === BISHOP || t === ROOK))) buf[n++] = from | (to << 7);
    return n;
  }

  // 疑似合法手を buf に詰めて個数を返す (王手放置・打ち歩詰めは未チェック)
  function generate(pos, buf, capOnly, forSearch) {
    const b = pos.board, s = pos.side, black = s === 0, rays = RAYS[s];
    let n = 0;
    for (let sq = 0; sq < 81; sq++) {
      const p = b[sq];
      if (p === 0 || (p > 0) !== black) continue;
      const t = p > 0 ? p : -p, rl = rays[t][sq];
      for (let i = 0; i < rl.length; i++) {
        const ray = rl[i];
        for (let k = 0; k < ray.length; k++) {
          const to = ray[k], q = b[to];
          if (q === 0) {
            if (!capOnly) n = pushPiece(buf, n, sq, to, t, s, forSearch);
          } else {
            if ((q > 0) !== black) n = pushPiece(buf, n, sq, to, t, s, forSearch);
            break;
          }
        }
      }
    }
    if (!capOnly) {
      let pawnMask = 0;
      if (pos.hands[s * 8 + 1] > 0) {
        const pc = black ? 1 : -1;
        for (let sq = 0; sq < 81; sq++) if (b[sq] === pc) pawnMask |= 1 << COL[sq];
      }
      for (let t = 1; t <= 7; t++) {
        if (pos.hands[s * 8 + t] === 0) continue;
        const dropCode = 80 + t;
        for (let sq = 0; sq < 81; sq++) {
          if (b[sq] !== 0) continue;
          const r = ROW[sq];
          if (black) {
            if ((t === 1 || t === 2) && r === 0) continue;
            if (t === 3 && r <= 1) continue;
          } else {
            if ((t === 1 || t === 2) && r === 8) continue;
            if (t === 3 && r >= 7) continue;
          }
          if (t === 1 && (pawnMask >> COL[sq]) & 1) continue;
          buf[n++] = dropCode | (sq << 7);
        }
      }
    }
    return n;
  }

  function hasLegalMove(pos) {
    const buf = new Int32Array(700), n = generate(pos, buf, false, false);
    for (let i = 0; i < n; i++) {
      if (pos.makeLegal(buf[i])) { pos.unmakeMove(); return true; }
    }
    return false;
  }

  function legalMoves(pos) {
    const buf = new Int32Array(700), n = generate(pos, buf, false, false), out = [];
    for (let i = 0; i < n; i++) {
      if (pos.makeLegal(buf[i])) { pos.unmakeMove(); out.push(buf[i]); }
    }
    return out;
  }

  const perftBufs = [];
  function perft(pos, depth) {
    if (depth === 0) return 1;
    if (!perftBufs[depth]) perftBufs[depth] = new Int32Array(700);
    const buf = perftBufs[depth], n = generate(pos, buf, false, false);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!pos.makeLegal(buf[i])) continue;
      total += depth === 1 ? 1 : perft(pos, depth - 1);
      pos.unmakeMove();
    }
    return total;
  }

  // ---------- SFEN ----------
  const LETTERS = { P: 1, L: 2, N: 3, S: 4, G: 5, B: 6, R: 7, K: 8 };
  const LETTER_OF = ['', 'P', 'L', 'N', 'S', 'G', 'B', 'R', 'K'];

  function fromSfen(sfen) {
    const parts = sfen.trim().split(/\s+/), pos = new Position();
    const rows = parts[0].split('/');
    if (rows.length !== 9) throw new Error('bad sfen');
    for (let r = 0; r < 9; r++) {
      let c = 0, promoted = false;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '9') { c += +ch; continue; }
        if (ch === '+') { promoted = true; continue; }
        const up = ch.toUpperCase();
        let t = LETTERS[up];
        if (!t) throw new Error('bad sfen piece ' + ch);
        if (promoted) t = PROMO[t];
        promoted = false;
        pos.board[r * 9 + c] = ch === up ? t : -t;
        c++;
      }
    }
    pos.side = parts[1] === 'w' ? 1 : 0;
    if (parts[2] && parts[2] !== '-') {
      let num = '';
      for (const ch of parts[2]) {
        if (ch >= '0' && ch <= '9') { num += ch; continue; }
        const up = ch.toUpperCase(), cnt = num ? +num : 1;
        num = '';
        pos.hands[(ch === up ? 0 : 8) + LETTERS[up]] += cnt;
      }
    }
    pos.computeHash();
    return pos;
  }

  function toSfen(pos, moveNumber) {
    const rows = [];
    for (let r = 0; r < 9; r++) {
      let s = '', empty = 0;
      for (let c = 0; c < 9; c++) {
        const p = pos.board[r * 9 + c];
        if (p === 0) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        const t = p > 0 ? p : -p, promoted = t >= 9, base = BASE[t];
        let ch = LETTER_OF[base];
        if (p < 0) ch = ch.toLowerCase();
        s += (promoted ? '+' : '') + ch;
      }
      if (empty) s += empty;
      rows.push(s);
    }
    let hand = '';
    for (const side of [0, 1]) {
      for (const t of [7, 6, 5, 4, 3, 2, 1]) {
        const c = pos.hands[side * 8 + t];
        if (c > 0) hand += (c > 1 ? c : '') + (side === 0 ? LETTER_OF[t] : LETTER_OF[t].toLowerCase());
      }
    }
    return rows.join('/') + ' ' + (pos.side === 0 ? 'b' : 'w') + ' ' + (hand || '-') + ' ' + (moveNumber || 1);
  }

  // ---------- 指し手の表記 ----------
  const mFrom = (m) => m & 127;
  const mTo = (m) => (m >> 7) & 127;
  const mPromo = (m) => (m >> 14) & 1;
  const sqName = (sq) => FILE_ZEN[8 - COL[sq]] + RANK_KAN[ROW[sq]];

  // pos は指す前の局面。prevMove は直前の手 (同 の判定用)
  function describeMove(pos, m, prevMove, legal) {
    const from = mFrom(m), to = mTo(m), s = pos.side;
    const mark = s === 0 ? '▲' : '△';
    const dest = prevMove && mTo(prevMove) === to ? '同　' : sqName(to);
    legal = legal || legalMoves(pos);
    if (from >= 81) {
      const t = from - 80;
      const alt = legal.some((x) => mFrom(x) < 81 && mTo(x) === to && pos.board[mFrom(x)] === (s === 0 ? t : -t));
      return mark + dest + NAMES[t] + (alt ? '打' : '');
    }
    const piece = pos.board[from], t = piece > 0 ? piece : -piece;
    const others = legal.filter((x) => mFrom(x) < 81 && mFrom(x) !== from && mTo(x) === to && pos.board[mFrom(x)] === piece);
    let qual = '';
    if (others.length) {
      const sg = s === 0 ? 1 : -1;
      const froms = [from].concat([...new Set(others.map(mFrom))]);
      const infos = froms.map((f) => {
        const fw = (ROW[f] - ROW[to]) * sg; // >0: 前に進む手
        return { x: COL[f] * sg, vert: fw > 0 ? '上' : fw < 0 ? '引' : '寄', straight: COL[f] === COL[to] && fw > 0 };
      });
      infos.forEach((i, idx) => {
        const xs = infos.filter((_, j) => j !== idx).map((o) => o.x);
        i.lat = xs.every((x) => i.x > x) ? '右' : xs.every((x) => i.x < x) ? '左' : '';
      });
      const labelsOf = (i) => {
        const l = [];
        if (i.straight) l.push('直');
        if (i.lat) l.push(i.lat);
        l.push(i.vert);
        if (i.lat) l.push(i.lat + i.vert);
        return l;
      };
      const order = ['直', '右', '左', '上', '引', '寄', '右上', '右引', '右寄', '左上', '左引', '左寄'];
      const mine = labelsOf(infos[0]), theirs = infos.slice(1).map(labelsOf);
      qual = order.find((l) => mine.includes(l) && theirs.every((t) => !t.includes(l))) || '';
    }
    let promoText = '';
    if (mPromo(m)) promoText = '成';
    else if (PROMO[t] !== 0 && (ZONE[s][from] || ZONE[s][to])) promoText = '不成';
    return mark + dest + NAMES[t] + qual + promoText;
  }

  // ---------- 入玉宣言 (27点法) ----------
  function impassePoints(pos, side) {
    const sgn = side === 0 ? 1 : -1;
    let inZone = 0, points = 0;
    for (let sq = 0; sq < 81; sq++) {
      const p = pos.board[sq] * sgn;
      if (p <= 0 || p === KING || !ZONE[side][sq]) continue;
      inZone++;
      points += (p === BISHOP || p === ROOK || p === HORSE || p === DRAGON) ? 5 : 1;
    }
    for (let t = 1; t <= 7; t++) points += pos.hands[side * 8 + t] * ((t === BISHOP || t === ROOK) ? 5 : 1);
    return { inZone, points };
  }
  function canDeclareImpasse(pos, side) {
    if (pos.side !== side) return false;
    const k = pos.kingSq[side];
    if (k < 0 || !ZONE[side][k] || pos.inCheck(side)) return false;
    const { inZone, points } = impassePoints(pos, side);
    return inZone >= 10 && points >= (side === 0 ? 28 : 27);
  }

  // ---------- 対局 (履歴・千日手・終局判定) ----------
  const MAX_PLIES = 512;
  class Game {
    constructor(startSfen) {
      this.startSfen = startSfen || START_SFEN;
      this.pos = fromSfen(this.startSfen);
      this.startSide = this.pos.side;
      this.moves = []; this.texts = []; this.checks = [];
      this.hashes = [[this.pos.h1, this.pos.h2]];
      this.declared = null; // 入玉宣言した側
    }
    static fromMoves(moves, startSfen) {
      const g = new Game(startSfen);
      for (const m of moves) g.play(m);
      return g;
    }
    legal() { return legalMoves(this.pos); }
    play(m) {
      const prev = this.moves.length ? this.moves[this.moves.length - 1] : 0;
      const text = describeMove(this.pos, m, prev);
      this.pos.makeMove(m);
      this.moves.push(m); this.texts.push(text);
      this.checks.push(this.pos.inCheck(this.pos.side) ? 1 : 0);
      this.hashes.push([this.pos.h1, this.pos.h2]);
      return text;
    }
    undo() {
      if (!this.moves.length) return false;
      this.pos.unmakeMove();
      this.moves.pop(); this.texts.pop(); this.checks.pop(); this.hashes.pop();
      return true;
    }
    positionAt(i) {
      const p = fromSfen(this.startSfen);
      for (let k = 0; k < i; k++) p.makeMove(this.moves[k]);
      return p;
    }
    // 終局していれば { result: 'black'|'white'|'draw', reason } / していなければ null
    status() {
      const pos = this.pos;
      if (this.declared !== null) return { result: this.declared === 0 ? 'black' : 'white', reason: 'impasse' };
      if (!hasLegalMove(pos)) {
        return { result: pos.side === 0 ? 'white' : 'black', reason: pos.inCheck() ? 'checkmate' : 'nomove' };
      }
      const n = this.hashes.length - 1, cur = this.hashes[n];
      const idx = [];
      for (let i = 0; i <= n; i++) if (this.hashes[i][0] === cur[0] && this.hashes[i][1] === cur[1]) idx.push(i);
      if (idx.length >= 4) {
        const first = idx[idx.length - 4];
        for (const side of [0, 1]) {
          let all = true, any = false;
          for (let j = first + 1; j <= n; j++) {
            const mover = (this.startSide + j - 1) % 2;
            if (mover !== side) continue;
            any = true;
            if (!this.checks[j - 1]) { all = false; break; }
          }
          if (any && all) return { result: side === 0 ? 'white' : 'black', reason: 'perpetual' };
        }
        return { result: 'draw', reason: 'sennichite' };
      }
      if (this.moves.length >= MAX_PLIES) return { result: 'draw', reason: 'maxplies' };
      return null;
    }
  }

  // ---------- KIF 出力 ----------
  const REASON_TEXT = {
    resign: '投了', checkmate: '詰み', nomove: '詰み', timeout: '切れ負け', sennichite: '千日手',
    perpetual: '反則負け(連続王手の千日手)', impasse: '入玉宣言勝ち', maxplies: '持将棋',
  };
  function pad(n, w) { return String(n).padStart(w, ' '); }
  function toKif(game, meta) {
    meta = meta || {};
    const lines = [];
    lines.push('# KISHO 棋譜');
    lines.push('開始日時：' + (meta.date || new Date().toLocaleString('ja-JP')));
    lines.push('手合割：平手');
    lines.push('先手：' + (meta.black || '先手'));
    lines.push('後手：' + (meta.white || '後手'));
    lines.push('手数----指手---------消費時間--');
    let total = [0, 0];
    const p = fromSfen(game.startSfen);
    for (let i = 0; i < game.moves.length; i++) {
      const m = game.moves[i], from = mFrom(m), to = mTo(m);
      const prev = i ? game.moves[i - 1] : 0;
      let txt = (prev && mTo(prev) === to) ? '同　' : sqName(to);
      if (from >= 81) txt += NAMES[from - 80] + '打';
      else {
        const piece = p.board[from], t = piece > 0 ? piece : -piece;
        txt += NAMES[t];
        if (mPromo(m)) txt += '成';
        else if (PROMO[t] !== 0 && (ZONE[p.side][from] || ZONE[p.side][to])) txt += '不成';
        txt += '(' + (9 - COL[from]) + (ROW[from] + 1) + ')';
      }
      const sec = meta.times && meta.times[i] ? Math.round(meta.times[i]) : 0;
      const side = (game.startSide + i) % 2;
      total[side] += sec;
      const f = (x) => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
      const ft = (x) => String(Math.floor(x / 3600)).padStart(2, '0') + ':' + String(Math.floor(x / 60) % 60).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
      lines.push(pad(i + 1, 4) + ' ' + txt.padEnd(12, '　').slice(0, 14) + '( ' + f(sec) + '/' + ft(total[side]) + ')');
      p.makeMove(m);
    }
    if (meta.reason) lines.push(pad(game.moves.length + 1, 4) + ' ' + (REASON_TEXT[meta.reason] || meta.reason));
    return lines.join('\n') + '\n';
  }

  return {
    BLACK, WHITE, PAWN, LANCE, KNIGHT, SILVER, GOLD, BISHOP, ROOK, KING, TOKIN, PLANCE, PKNIGHT, PSILVER, HORSE, DRAGON,
    BASE, PROMO, NAMES, ROW, COL, ZONE, VAL, START_SFEN, MAX_PLIES, REASON_TEXT,
    Position, Game, generate, legalMoves, hasLegalMove, perft, fromSfen, toSfen,
    describeMove, canDeclareImpasse, impassePoints, toKif, sqName,
    moveFrom: mFrom, moveTo: mTo, movePromo: mPromo,
    mk: (from, to, promo) => from | (to << 7) | ((promo ? 1 : 0) << 14),
    dropMove: (t, to) => (80 + t) | (to << 7),
    sq: (file, rank) => (rank - 1) * 9 + (9 - file),
  };
});
