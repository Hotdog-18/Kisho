/*
 * KISHO AI — 探索エンジン (アルファベータ + 反復深化 + 置換表) と、強さレベル・棋譜の振り返り解析
 * 評価は「駒の価値 + 位置」のみのシンプルなもの。プロ棋士のような強さはなく、練習相手向け。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.KishoAI = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  const MATE = 30000, INF = 32000;
  const VAL = S.VAL, BASE = S.BASE;
  const absT = (p) => (p > 0 ? p : -p);

  // AIレベル (1〜10)。noise: 手を選ぶ時に足す乱数の大きさ(cp)。大きいほど「うっかり」が増える
  const LEVELS = [
    { depth: 1, nodes: 3000, time: 300, noise: 400 },
    { depth: 1, nodes: 5000, time: 300, noise: 170 },
    { depth: 2, nodes: 12000, time: 400, noise: 200 },
    { depth: 2, nodes: 20000, time: 500, noise: 120 },
    { depth: 3, nodes: 40000, time: 600, noise: 150 },
    { depth: 3, nodes: 60000, time: 800, noise: 70 },
    { depth: 4, nodes: 100000, time: 1000, noise: 40 },
    { depth: 5, nodes: 220000, time: 1500, noise: 0 },
    { depth: 7, nodes: 600000, time: 2500, noise: 0 },
    { depth: 14, nodes: 2000000, time: 5000, noise: 0 },
  ];

  class Engine {
    constructor(bits) {
      bits = bits || 19;
      this.size = 1 << bits; this.mask = this.size - 1;
      this.tk = new Int32Array(this.size); this.ts = new Int32Array(this.size);
      this.td = new Int8Array(this.size); this.tf = new Int8Array(this.size);
      this.tm = new Int32Array(this.size);
      this.hist = new Int32Array(88 * 81);
      this.killers = new Int32Array(130 * 2);
      this.bufs = []; this.scs = [];
      for (let i = 0; i < 130; i++) { this.bufs.push(new Int32Array(700)); this.scs.push(new Int32Array(700)); }
      this.nodes = 0; this.stop = false; this.nodeLimit = Infinity; this.deadline = Infinity;
    }

    clear() { this.tk.fill(0); this.hist.fill(0); this.killers.fill(0); }

    checkStop() {
      if (this.nodes >= this.nodeLimit || Date.now() >= this.deadline) this.stop = true;
    }

    evaluate(pos) { return (pos.side === 0 ? pos.ev : -pos.ev) + 10; }

    orderScore(pos, m, ttMove, ply) {
      if (m === ttMove) return 10000000;
      const from = m & 127, to = (m >> 7) & 127;
      const victim = pos.board[to];
      let s;
      const att = from >= 81 ? VAL[from - 80] : VAL[absT(pos.board[from])];
      if (victim !== 0) s = 100000 + VAL[absT(victim)] * 10 - att;
      else if (m === this.killers[ply * 2]) s = 90000;
      else if (m === this.killers[ply * 2 + 1]) s = 80000;
      else s = Math.min(this.hist[from * 81 + to], 70000);
      if ((m >> 14) & 1) s += 50000;
      return s;
    }

    qsearch(pos, alpha, beta, ply, qd) {
      if ((++this.nodes & 2047) === 0) this.checkStop();
      if (this.stop) return 0;
      const stand = this.evaluate(pos);
      if (qd >= 6 || ply >= 120) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const buf = this.bufs[ply], sc = this.scs[ply];
      const n = S.generate(pos, buf, true, true);
      for (let i = 0; i < n; i++) {
        const m = buf[i];
        sc[i] = VAL[absT(pos.board[(m >> 7) & 127])] * 10 - VAL[absT(pos.board[m & 127])] + (((m >> 14) & 1) ? 300 : 0);
      }
      let best = stand;
      for (let i = 0; i < n; i++) {
        let bi = i;
        for (let j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
        if (bi !== i) { const tm = buf[i]; buf[i] = buf[bi]; buf[bi] = tm; const ts = sc[i]; sc[i] = sc[bi]; sc[bi] = ts; }
        const m = buf[i];
        const victim = VAL[absT(pos.board[(m >> 7) & 127])];
        if (stand + victim + 250 < alpha) continue;
        if (!pos.makeLegal(m)) continue;
        const s = -this.qsearch(pos, -beta, -alpha, ply + 1, qd + 1);
        pos.unmakeMove();
        if (this.stop) return 0;
        if (s > best) { best = s; if (s > alpha) { alpha = s; if (alpha >= beta) break; } }
      }
      return best;
    }

    negamax(pos, depth, alpha, beta, ply, nullOk) {
      if ((++this.nodes & 2047) === 0) this.checkStop();
      if (this.stop) return 0;
      const inChk = pos.inCheck();
      if (ply > 0) {
        const sp = pos.sp, h1 = pos.h1, h2 = pos.h2;
        for (let i = sp - 2; i >= 0 && i >= sp - 24; i -= 2) if (pos.stH1[i] === h1 && pos.stH2[i] === h2) return 0;
      }
      if (ply >= 100) return this.evaluate(pos);
      if (inChk) depth++;
      if (depth <= 0) return this.qsearch(pos, alpha, beta, ply, 0);

      const idx = pos.h1 & this.mask;
      let ttMove = 0;
      if (this.tk[idx] === pos.h2) {
        ttMove = this.tm[idx];
        if (this.td[idx] >= depth && ply > 0) {
          let s = this.ts[idx];
          if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
          const f = this.tf[idx];
          if (f === 0) return s;
          if (f === 1 && s >= beta) return s;
          if (f === 2 && s <= alpha) return s;
        }
      }

      if (nullOk && !inChk && depth >= 3 && beta < MATE - 200 && this.evaluate(pos) >= beta) {
        pos.makeNull();
        const s = -this.negamax(pos, depth - 3, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (this.stop) return 0;
        if (s >= beta) return beta;
      }

      const buf = this.bufs[ply], sc = this.scs[ply];
      const n = S.generate(pos, buf, false, true);
      for (let i = 0; i < n; i++) sc[i] = this.orderScore(pos, buf[i], ttMove, ply);
      const origAlpha = alpha;
      let best = -INF, bestMove = 0, legal = 0;
      for (let i = 0; i < n; i++) {
        let bi = i;
        for (let j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
        if (bi !== i) { const tm = buf[i]; buf[i] = buf[bi]; buf[bi] = tm; const ts = sc[i]; sc[i] = sc[bi]; sc[bi] = ts; }
        const m = buf[i];
        if (!pos.makeLegal(m)) continue;
        legal++;
        const cap = pos.stCap[pos.sp - 1] !== 0;
        const chk = pos.inCheck();
        const d1 = depth - 1;
        let s;
        if (legal === 1) {
          s = -this.negamax(pos, d1, -beta, -alpha, ply + 1, true);
        } else {
          let r = 0;
          if (depth >= 3 && legal > 4 && !cap && !chk && !inChk && !((m >> 14) & 1)) r = legal > 10 ? 2 : 1;
          s = -this.negamax(pos, d1 - r, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && r > 0) s = -this.negamax(pos, d1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta) s = -this.negamax(pos, d1, -beta, -alpha, ply + 1, true);
        }
        pos.unmakeMove();
        if (this.stop) return 0;
        if (s > best) {
          best = s; bestMove = m;
          if (s > alpha) {
            alpha = s;
            if (alpha >= beta) {
              if (!cap) {
                const from = m & 127, to = (m >> 7) & 127;
                if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
                this.hist[from * 81 + to] += depth * depth;
              }
              break;
            }
          }
        }
      }
      if (legal === 0) return -MATE + ply; // 将棋では動かせる手が無い = 負け
      let store = best;
      if (store > MATE - 200) store += ply; else if (store < -MATE + 200) store -= ply;
      this.tk[idx] = pos.h2; this.ts[idx] = store; this.td[idx] = depth; this.tm[idx] = bestMove;
      this.tf[idx] = best >= beta ? 1 : best > origAlpha ? 0 : 2;
      return best;
    }

    // 局面を探索する。戻り値: { move, score(手番側から見たcp), depth, nodes, list:[{m,s}] }
    think(posIn, o) {
      o = o || {};
      const pos = posIn.clone();
      const maxDepth = o.maxDepth || 8;
      this.nodes = 0; this.stop = false;
      this.nodeLimit = o.maxNodes || Infinity;
      this.deadline = Date.now() + (o.maxTime || 1e9);
      this.killers.fill(0); this.hist.fill(0);
      const moves = S.legalMoves(pos);
      if (!moves.length) return { move: 0, score: -MATE, depth: 0, nodes: 0, list: [] };
      const list = moves.map((m) => ({ m, s: -INF }));
      if (list.length === 1) { list[0].s = this.evaluate(pos); return { move: list[0].m, score: list[0].s, depth: 0, nodes: 0, list }; }
      // 初期並び: 取る手・成る手を先に
      list.forEach((e) => { e.o = this.orderScore(pos, e.m, 0, 0); });
      list.sort((a, b) => b.o - a.o);
      let best = list[0], doneDepth = 0;
      for (let d = 1; d <= maxDepth; d++) {
        if (Date.now() >= this.deadline && d > 1) break;
        let alpha = -INF, iterBest = null;
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          pos.makeMove(e.m);
          let s;
          if (o.fullRoot) s = -this.negamax(pos, d - 1, -INF, INF, 1, true);
          else if (k === 0) s = -this.negamax(pos, d - 1, -INF, -alpha, 1, true);
          else {
            s = -this.negamax(pos, d - 1, -alpha - 1, -alpha, 1, true);
            if (!this.stop && s > alpha) s = -this.negamax(pos, d - 1, -INF, -alpha, 1, true);
          }
          pos.unmakeMove();
          if (this.stop) break;
          e.s = s;
          if (s > alpha) { alpha = s; iterBest = e; }
        }
        if (this.stop) {
          if (iterBest && !o.fullRoot) { best = iterBest; }
          break;
        }
        list.sort((a, b) => b.s - a.s);
        best = list[0]; doneDepth = d;
        if (o.onInfo) o.onInfo({ depth: d, score: best.s, move: best.m, nodes: this.nodes });
        if (Math.abs(best.s) > MATE - 100) break;
      }
      return { move: best.m, score: best.s, depth: doneDepth, nodes: this.nodes, list };
    }

    // 指定した手を指した後の評価値 (手を指した側から見たcp)
    scoreMove(posIn, m, depth, maxNodes) {
      const pos = posIn.clone();
      this.nodes = 0; this.stop = false;
      this.nodeLimit = maxNodes || Infinity; this.deadline = Infinity;
      this.killers.fill(0); this.hist.fill(0);
      pos.makeMove(m);
      return -this.negamax(pos, Math.max(depth - 1, 0), -INF, INF, 1, true);
    }

    chooseMove(pos, level, rng) {
      rng = rng || Math.random;
      const L = LEVELS[Math.min(Math.max(level, 1), LEVELS.length) - 1];
      const r = this.think(pos, { maxDepth: L.depth, maxNodes: L.nodes, maxTime: L.time, fullRoot: L.noise > 0 });
      if (L.noise > 0 && r.list.length > 1) {
        let bestV = -Infinity, pick = r.move;
        for (const e of r.list) {
          if (e.s <= -INF) continue;
          const g = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
          const v = e.s + g * L.noise;
          if (v > bestV) { bestV = v; pick = e.m; }
        }
        r.move = pick;
      }
      return r;
    }
  }

  // ---------- 振り返り (棋譜解析) ----------
  const winProb = (cp) => 1 / (1 + Math.exp(-cp / 600));
  const GRADES = [
    { id: 'best', name: '最善', max: 0.012 },
    { id: 'good', name: '好手', max: 0.04 },
    { id: 'slow', name: '緩手', max: 0.10 },
    { id: 'doubt', name: '疑問手', max: 0.22 },
    { id: 'bad', name: '悪手', max: 1.01 },
  ];
  function gradeOf(loss, isBest) {
    if (isBest) return GRADES[0];
    for (const g of GRADES) if (loss <= g.max) return g;
    return GRADES[4];
  }

  /*
   * game: Shogi.Game (終局後のもの)
   * opts: { depth, maxNodes, onProgress(i, n) }
   * 戻り値: { plies:[{ n, side, text, best:{move,text}, scoreBefore(先手視点), scoreAfter, loss, grade, isBest }], accuracy:[先手,後手] }
   */
  function analyzeGame(game, engine, opts) {
    opts = opts || {};
    const depth = opts.depth || 5, maxNodes = opts.maxNodes || 80000;
    const p = S.fromSfen(game.startSfen);
    const out = [];
    const sums = [0, 0], cnt = [0, 0];
    for (let i = 0; i < game.moves.length; i++) {
      const played = game.moves[i], side = p.side;
      const prev = i ? game.moves[i - 1] : 0;
      const legal = S.legalMoves(p);
      const res = engine.think(p, { maxDepth: depth, maxNodes });
      const bestScore = res.score;
      let playedScore, isBest = played === res.move;
      if (isBest) playedScore = bestScore;
      else {
        playedScore = engine.scoreMove(p, played, Math.max(res.depth, 1), maxNodes);
        if (playedScore > bestScore) playedScore = bestScore; // 探索の揺らぎ対策
      }
      const loss = Math.max(0, winProb(bestScore) - winProb(playedScore));
      const grade = gradeOf(loss, isBest || loss < 0.004);
      const sg = side === 0 ? 1 : -1;
      out.push({
        n: i + 1, side,
        text: game.texts[i],
        best: { move: res.move, text: res.move ? S.describeMove(p, res.move, prev, legal) : '' },
        scoreBefore: bestScore * sg, scoreAfter: playedScore * sg,
        loss, grade: grade.id, gradeName: grade.name, isBest: isBest || loss < 0.004,
        forced: legal.length === 1,
      });
      if (legal.length > 1) { sums[side] += loss; cnt[side]++; }
      p.makeMove(played);
      if (opts.onProgress) opts.onProgress(i + 1, game.moves.length);
    }
    const accuracy = [0, 1].map((s) => {
      if (!cnt[s]) return null;
      const mean = sums[s] / cnt[s];
      return Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-mean * 9))) * 10) / 10;
    });
    return { plies: out, accuracy, counts: [0, 1].map((s) => countGrades(out.filter((x) => x.side === s && !x.forced))) };
  }
  function countGrades(arr) {
    const c = { best: 0, good: 0, slow: 0, doubt: 0, bad: 0 };
    arr.forEach((x) => { c[x.grade]++; });
    return c;
  }

  // Worker / メインスレッド共通のタスク実行口
  function runTask(engine, msg, progress) {
    if (msg.type === 'clear') { engine.clear(); return { ok: true }; }
    const game = S.Game.fromMoves(msg.moves || [], msg.startSfen);
    if (msg.type === 'think') {
      const side = game.pos.side;
      if (msg.level >= 7 && S.canDeclareImpasse(game.pos, side)) return { declare: true };
      const r = engine.chooseMove(game.pos, msg.level);
      return { move: r.move, depth: r.depth, score: r.score, nodes: r.nodes };
    }
    if (msg.type === 'analyze') {
      return analyzeGame(game, engine, { depth: msg.depth, maxNodes: msg.maxNodes, onProgress: progress });
    }
    return null;
  }

  return { Engine, LEVELS, MATE, winProb, GRADES, analyzeGame, runTask };
});
