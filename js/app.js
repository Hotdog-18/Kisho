/* KISHO — 画面とゲーム進行 (AI対局 / 同じ画面 / 棋譜の再生と振り返り)。部屋(オンライン)は room.js */
(function () {
  'use strict';
  const S = window.Shogi, K = window.KRS, T = window.KishoThemes, AIm = window.KishoAI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 保存 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kisho.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kisho.' + k, JSON.stringify(v)); } catch (e) { /* 容量超過など */ } },
  };
  let profile = Object.assign({ name: 'あなた', krs: K.INITIAL, games: 0, wins: 0, losses: 0, draws: 0, history: [] }, store.get('profile', {}));
  let settings = Object.assign({ theme: 'auto', pieceSet: 'kaya', boardTheme: 'kaya', hints: true, coords: true, sound: true, autoFlip: true }, store.get('settings', {}));
  let records = store.get('records', []);
  const saveProfile = () => store.set('profile', profile);
  const saveSettings = () => store.set('settings', settings);
  const saveRecords = () => store.set('records', records.slice(0, 40));
  if (!store.get('cid', null)) store.set('cid', 'c' + Math.random().toString(36).slice(2, 10));
  const CID = store.get('cid', 'c0');

  const TCS = [
    { id: 'none', name: '無制限', main: 0, byo: 0, on: false },
    { id: '10-30', name: '10分 + 秒読み30秒', main: 600, byo: 30, on: true },
    { id: '5-10', name: '5分 + 秒読み10秒', main: 300, byo: 10, on: true },
    { id: '15-60', name: '15分 + 秒読み60秒', main: 900, byo: 60, on: true },
    { id: '0-30', name: '秒読み30秒のみ', main: 0, byo: 30, on: true },
    { id: '3-0', name: '3分 切れ負け', main: 180, byo: 0, on: true },
  ];
  const tcById = (id) => TCS.find((t) => t.id === id) || TCS[0];
  const LEVEL_NAMES = ['入門', '初心', '初級', '初中級', '中級', '中上級', '上級', '強豪', '達人', '棋匠'];
  const REASON = {
    checkmate: '詰み', nomove: '詰み', resign: '投了', timeout: '時間切れ', sennichite: '千日手',
    perpetual: '連続王手の千日手', impasse: '入玉宣言', maxplies: '持将棋', abort: '中断',
  };

  // ---------- AI (Worker。使えない環境ではメインスレッドで実行) ----------
  const AI = {
    w: null, id: 0, pending: new Map(), local: null,
    init() {
      try {
        this.w = new Worker('js/worker.js');
        this.w.onmessage = (e) => {
          const d = e.data, p = this.pending.get(d.id);
          if (!p) return;
          if (d.progress) { if (p.onProgress) p.onProgress(d.progress[0], d.progress[1]); return; }
          this.pending.delete(d.id);
          d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
        };
        this.w.onerror = () => {
          this.w = null;
          const old = Array.from(this.pending.entries());
          this.pending.clear();
          old.forEach(([, p]) => this.runLocal(p.msg, p));
        };
      } catch (e) { this.w = null; }
    },
    request(type, payload, onProgress) {
      return new Promise((resolve, reject) => {
        const id = ++this.id, msg = Object.assign({ id, type }, payload);
        const p = { resolve, reject, onProgress, msg };
        if (this.w) { this.pending.set(id, p); this.w.postMessage(msg); }
        else this.runLocal(msg, p);
      });
    },
    runLocal(msg, p) {
      setTimeout(() => {
        try {
          this.local = this.local || new AIm.Engine(18);
          p.resolve(AIm.runTask(this.local, msg, p.onProgress));
        } catch (e) { p.reject(e); }
      }, 30);
    },
  };
  AI.init();

  // ---------- 状態 ----------
  let G = null;
  let gidCounter = 0;
  function newState(o) {
    return Object.assign({
      gid: ++gidCounter, mode: 'local', game: null, myColor: 0, names: ['先手', '後手'], krs: [null, null], level: 1, tc: { on: false, main: 0, byo: 0 },
      clock: { main: [0, 0] }, turnStart: Date.now(), running: false, over: null, unrated: false, thinking: false,
      view: null, review: null, rec: null, flip: false, sel: null, arrowPly: 0, legalCache: null, times: [], aiSettings: null, room: null,
    }, o);
  }
  function legalList() {
    const g = G.game, c = G.legalCache;
    if (c && c.n === g.moves.length) return c.list;
    const list = g.legal();
    G.legalCache = { n: g.moves.length, list };
    return list;
  }
  const viewIdx = () => (G.view === null ? G.game.moves.length : G.view);

  // ---------- 音 ----------
  let ac = null, snd = null;
  // 駒音「パシッ!」の中身は js/sound.js
  function clack() {
    if (!settings.sound) return;
    try {
      if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); snd = window.KishoSound.create(ac); }
      if (ac.state === 'suspended') ac.resume();
      snd.play();
    } catch (e) { /* 音が出せなくても続行 */ }
  }
  // ブラウザ標準の confirm() は使えない環境があるので、画面内のダイアログで確認する。
  // askEx は押されたボタンを 'yes' / 'no' / 'extra' で返す。ask は「yes か」だけを返す。
  // o: { cancel: キャンセル側の文字, extra: 3つ目のボタンの文字, hint: 補足の文 }
  function askEx(msg, okLabel, o) {
    o = o || {};
    return new Promise((resolve) => {
      const d = $('#dlgConfirm');
      $('#confirmMsg').textContent = msg; $('#confirmOk').textContent = okLabel || 'OK';
      $('#confirmNo').textContent = o.cancel || 'やめる';
      const ex = $('#confirmExtra'); ex.hidden = !o.extra; ex.textContent = o.extra || '';
      const hint = $('#confirmHint'); hint.hidden = !o.hint; hint.textContent = o.hint || '';
      $('#confirmOk').classList.toggle('primary', !o.extra); // 3択のときは「保存して中断」を主ボタンにする
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue || 'no'), { once: true });
      d.showModal();
    });
  }
  const ask = (msg, okLabel, o) => askEx(msg, okLabel, o).then((v) => v === 'yes');
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- 盤の描画 ----------
  const board = $('#board');
  const cells = [];
  for (let k = 0; k < 81; k++) {
    const c = document.createElement('div');
    c.className = 'cell'; c.setAttribute('role', 'gridcell');
    board.appendChild(c); cells.push(c);
  }
  // 駒: 本物の将棋駒に近い五角形 (肩が低く、底が広い)。字は駒の中心に置く
  function pieceEl(p, setId) {
    const t = p > 0 ? p : -p, side = p > 0 ? 0 : 1;
    const sid = setId || settings.pieceSet;
    const g = T.glyph(t, side, sid), letters = (T.PIECE_SETS.find((x) => x.id === sid) || {}).glyph === 'letters';
    const el = document.createElement('div');
    el.className = 'piece' + (t >= 9 ? ' pro' : '');
    const size = letters ? (g.length > 1 ? 30 : 40) : 52;
    const y = letters ? 55 : 54 - size * 0.06;
    el.innerHTML = '<svg viewBox="0 0 84 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
      + '<path class="pe" d="M42 1.5 73 18.5 82.5 98.5H1.5L11 18.5Z"/>'
      + '<path class="pf" d="M42 6.2 69.6 21.2 78 94H6L14.4 21.2Z"/>'
      + '<path class="ps" d="M42 6.2 69.6 21.2 78 94H6L14.4 21.2Z"/>'
      + '<path class="pgr" d="M17 36Q42 30 74 38M14 56Q44 50 77 58M11 76Q42 71 79 78"/>'
      + '<path class="phl" d="M14.4 21.2 42 6.2 69.6 21.2"/>'
      + '<text class="pg" x="42" y="' + y.toFixed(1) + '" font-size="' + size + '" text-anchor="middle" dominant-baseline="central">' + esc(g) + '</text></svg>';
    return el;
  }
  // 画面の明るさ: auto は機種(OS/ブラウザ)の設定に従う。light/dark は固定
  function applyMode() {
    const m = settings.theme, root = document.documentElement;
    if (m === 'light' || m === 'dark') root.dataset.theme = m; else delete root.dataset.theme;
    const dark = m === 'dark' || (m !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = dark ? '#121b25' : '#e9eef1';
  }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyMode); } catch (e) { /* 古いブラウザ */ }
  function applyTheme() {
    const st = $('#stage'), set = T.PIECE_SETS.find((s) => s.id === settings.pieceSet) || T.PIECE_SETS[0];
    st.className = 'stage ps-' + settings.pieceSet + ' bt-' + settings.boardTheme + (set.glyph === 'letters' ? ' letters' : '') + (settings.coords ? '' : ' no-coords');
  }
  function krsBadge(v) { return '<span class="krs" title="KRS (独自)"><i>KRS</i><b>' + v + '</b></span>'; }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function timeInfo(side) {
    if (!G.tc.on) return null;
    const main = G.clock.main[side];
    const elapsed = G.running && !G.over && viewIsLive() && G.game.pos.side === side ? (Date.now() - G.turnStart) / 1000 : 0;
    if (main > 0) {
      if (elapsed <= main) return { left: main - elapsed, byo: false };
      return { left: G.tc.byo - (elapsed - main), byo: true };
    }
    return { left: G.tc.byo - elapsed, byo: true };
  }
  const viewIsLive = () => G.view === null || G.view === G.game.moves.length;

  function renderCards() {
    const bottom = G.flip ? 1 : 0, top = 1 - bottom;
    [['#cardTop', top], ['#cardBot', bottom]].forEach(([sel, side]) => {
      const el = $(sel);
      const you = G.mode !== 'local' && G.mode !== 'review' && side === G.myColor;
      const kv = G.krs[side];
      el.dataset.side = side;
      el.classList.toggle('turn', !G.over && G.running && G.game.pos.side === side && viewIsLive());
      el.innerHTML = '<span class="pmark" aria-hidden="true">' + (side === 0 ? '先' : '後') + '</span>' +
        '<div class="pname"><b>' + esc(G.names[side]) + '</b>' + (you && G.names[side] !== 'あなた' ? '<span class="note">(あなた)</span>' : '') + (kv != null ? krsBadge(kv) : '') +
        (G.thinking && !G.over && G.game.pos.side === side && G.mode === 'ai' ? '<span class="note">考え中…</span>' : '') + '</div>' +
        '<div class="clock" data-side="' + side + '"></div>';
    });
    updateClocks();
  }
  function updateClocks() {
    if (!G || !G.game) return;
    $$('.clock').forEach((el) => {
      const side = +el.dataset.side, ti = timeInfo(side);
      if (!ti) { el.textContent = ''; return; }
      el.className = 'clock' + (ti.byo ? ' byo' : '') + (ti.left <= 10 ? ' low' : '');
      el.innerHTML = fmtClock(ti.left) + (ti.byo && G.tc.byo ? '<small>秒読み</small>' : '');
    });
  }

  function renderHands(pos) {
    const bottom = G.flip ? 1 : 0, top = 1 - bottom;
    [['#handTop', top], ['#handBot', bottom]].forEach(([sel, side]) => {
      const el = $(sel);
      el.innerHTML = '';
      let any = false;
      for (const t of [7, 6, 5, 4, 3, 2, 1]) {
        const n = pos.hands[side * 8 + t];
        if (!n) continue;
        any = true;
        const b = document.createElement('button');
        b.className = 'hp'; b.type = 'button'; b.dataset.t = t; b.dataset.side = side;
        const piece = pieceEl(side === 0 ? t : -t);
        piece.dataset.up = side === bottom ? '1' : '0';
        b.appendChild(piece);
        if (n > 1) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = n; b.appendChild(c); }
        b.setAttribute('aria-label', S.NAMES[t] + ' ' + n + '枚');
        const can = canTouch() && pos.side === side && side === (G.mode === 'local' ? pos.side : G.myColor);
        b.disabled = !can;
        if (G.sel && G.sel.kind === 'h' && G.sel.t === t && can) b.classList.add('sel');
        el.appendChild(b);
      }
      if (!any) el.innerHTML = '<span class="none">持ち駒なし</span>';
    });
  }

  function canTouch() {
    if (!G || !G.game || G.over || G.mode === 'review') return false;
    if (!viewIsLive()) return false;
    if (G.mode === 'local') return true;
    if (G.mode === 'room' && G.room && G.room.waiting) return false;
    return G.game.pos.side === G.myColor && !G.thinking;
  }
  function destsFor(sel) {
    const out = new Map();
    for (const m of legalList()) {
      const f = S.moveFrom(m);
      if ((sel.kind === 'b' && f === sel.sq) || (sel.kind === 'h' && f === 80 + sel.t)) {
        const to = S.moveTo(m);
        if (!out.has(to)) out.set(to, []);
        out.get(to).push(m);
      }
    }
    return out;
  }

  function renderBoard() {
    const g = G.game, idx = viewIdx(), live = idx === g.moves.length;
    const pos = live ? g.pos : g.positionAt(idx);
    const last = idx > 0 ? g.moves[idx - 1] : 0;
    const bottom = G.flip ? 1 : 0;
    const dests = G.sel && canTouch() ? destsFor(G.sel) : null;
    const checkSq = pos.inCheck() ? pos.kingSq[pos.side] : -1;
    const lastTo = last ? S.moveTo(last) : -1, lastFrom = last && S.moveFrom(last) < 81 ? S.moveFrom(last) : -1;
    const touch = canTouch();
    for (let k = 0; k < 81; k++) {
      const sq = G.flip ? 80 - k : k, c = cells[k], p = pos.board[sq];
      c.dataset.sq = sq;
      c.className = 'cell';
      if (sq === lastTo || sq === lastFrom) c.classList.add('last');
      if (sq === lastTo && live) c.classList.add('just');
      if (G.sel && G.sel.kind === 'b' && G.sel.sq === sq) c.classList.add('sel');
      if (sq === checkSq) c.classList.add('check');
      if (dests && settings.hints && dests.has(sq)) { c.classList.add('dest'); if (p !== 0) c.classList.add('cap'); }
      else if (dests && dests.has(sq)) c.classList.add('can');
      if (touch) c.classList.add('can');
      const old = c.firstElementChild;
      if (p === 0) { if (old) old.remove(); }
      else {
        const el = pieceEl(p);
        el.dataset.up = (p > 0 ? 0 : 1) === bottom ? '1' : '0';
        if (old) old.replaceWith(el); else c.appendChild(el);
      }
    }
    // 座標
    const fcoords = [], rcoords = [];
    for (let i = 0; i < 9; i++) {
      fcoords.push('<span>' + (G.flip ? i + 1 : 9 - i) + '</span>');
      rcoords.push('<span>' + '一二三四五六七八九'[G.flip ? 8 - i : i] + '</span>');
    }
    $('#coordF').innerHTML = fcoords.join(''); $('#coordR').innerHTML = rcoords.join('');
    renderHands(pos);
    renderArrows(idx);
  }

  function renderArrows(idx) {
    const svg = $('#arrows');
    svg.innerHTML = '';
    if (!G.review || !G.arrowPly || idx !== G.arrowPly - 1) return;
    const ply = G.review.plies[G.arrowPly - 1];
    if (!ply) return;
    const center = (sq) => {
      const col = S.COL[sq], row = S.ROW[sq];
      return [(G.flip ? 8 - col : col) + 0.5, (G.flip ? 8 - row : row) + 0.5];
    };
    const draw = (m, color, w) => {
      if (!m) return;
      const to = center(S.moveTo(m));
      if (S.moveFrom(m) >= 81) {
        svg.insertAdjacentHTML('beforeend', '<circle cx="' + to[0] + '" cy="' + to[1] + '" r=".4" fill="none" stroke="' + color + '" stroke-width="' + w + '" opacity=".85"/>');
        return;
      }
      const fr = center(S.moveFrom(m));
      const dx = to[0] - fr[0], dy = to[1] - fr[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const hx = to[0] - ux * 0.22, hy = to[1] - uy * 0.22;
      svg.insertAdjacentHTML('beforeend',
        '<line x1="' + fr[0] + '" y1="' + fr[1] + '" x2="' + hx + '" y2="' + hy + '" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round" opacity=".85"/>' +
        '<polygon points="' + [to[0], to[1], hx - uy * 0.2, hy + ux * 0.2, hx + uy * 0.2, hy - ux * 0.2].join(' ') + '" fill="' + color + '" opacity=".9"/>');
    };
    const played = G.game.moves[G.arrowPly - 1];
    if (ply.best.move && ply.best.move !== played) draw(played, '#8a97a4', 0.12);
    draw(ply.best.move, '#17808f', 0.14);
  }

  function movesHtml() {
    const g = G.game, idx = viewIdx();
    let html = '<li class="start" data-i="0"' + (idx === 0 ? ' aria-current="true"' : '') + '>開始局面</li>';
    for (let i = 0; i < g.moves.length; i++) {
      const pl = G.review && G.review.plies[i];
      const dot = pl && !pl.forced ? '<span class="gdot g-' + pl.grade + '" title="' + pl.gradeName + '"></span>' : '';
      html += '<li data-i="' + (i + 1) + '"' + (idx === i + 1 ? ' aria-current="true"' : '') + '><span class="mn">' + (i + 1) + '</span>' + esc(g.texts[i]) + dot + '</li>';
    }
    if (G.over) html += '<li class="start" style="color:var(--ink)">' + esc(resultLine(G.over)) + '</li>';
    return html;
  }
  function renderMoves() {
    const ol = $('#moveList');
    ol.innerHTML = movesHtml();
    const cur = ol.querySelector('[aria-current="true"]');
    if (cur && !$('#paneMoves').hidden) cur.scrollIntoView({ block: 'nearest' });
    else if (G.view === null) ol.parentElement.scrollTop = ol.parentElement.scrollHeight;
  }
  function resultLine(o) {
    const why = REASON[o.reason] || o.reason;
    if (o.result === 'draw') return '引き分け (' + why + ')';
    return (o.result === 'black' ? '先手' : '後手') + 'の勝ち (' + why + ')';
  }

  function renderActions() {
    const el = $('#actions'), g = G.game;
    let h = '';
    const live = G.mode === 'ai' || G.mode === 'local' || G.mode === 'room';
    if (live && !G.over) {
      h += '<button class="btn" data-act="resign">投了</button>';
      if (G.mode === 'ai') h += '<button class="btn" data-act="undo"' + (G.thinking || g.moves.length < 1 ? ' disabled' : '') + '>待った</button><button class="btn" data-act="suspend"' + (g.moves.length < 1 ? ' disabled' : '') + '>保存して中断</button>';
      const side = G.mode === 'local' ? g.pos.side : G.myColor;
      if (g.pos.side === side && S.canDeclareImpasse(g.pos, side)) h += '<button class="btn primary" data-act="declare">入玉宣言</button>';
    }
    if (G.mode !== 'review') h += '<button class="btn" data-act="flip">盤を反転</button>';
    h += '<button class="btn" data-act="kif">棋譜をコピー</button>';
    h += '<button class="btn" data-act="kifdl">KIF保存</button>';
    if (G.over && G.mode !== 'review') h += '<button class="btn primary" data-act="review">AIで振り返る</button><button class="btn" data-act="again">もう一局</button>';
    if (G.mode === 'review') h += '<button class="btn" data-act="home">ホームへ</button>';
    el.innerHTML = h;
  }

  function renderTabs() {
    const showChat = G.mode === 'room', showRv = !!(G.over || G.mode === 'review');
    $('#tabChat').hidden = !showChat; $('#tabReview').hidden = !showRv;
    const cur = $('#tabs [aria-selected="true"]').dataset.tab;
    if ((cur === 'chat' && !showChat) || (cur === 'review' && !showRv)) selectTab('moves');
    $('#navBtns').hidden = !(G.over || G.mode === 'review' || G.game.moves.length > 0);
  }
  function selectTab(name) {
    $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    $('#paneMoves').hidden = name !== 'moves'; $('#paneChat').hidden = name !== 'chat'; $('#paneReview').hidden = name !== 'review';
    if (name === 'review') renderReview();
  }

  function render() {
    if (!G || !G.game) return;
    applyTheme();
    renderCards(); renderBoard(); renderMoves(); renderActions(); renderTabs();
    $$('#navBtns [data-nav]').forEach((b) => {
      const i = viewIdx(), n = G.game.moves.length;
      b.disabled = (b.dataset.nav === 'first' || b.dataset.nav === 'prev') ? i === 0 : i === n;
    });
    if (!$('#paneReview').hidden) renderReview();
  }

  // ---------- 時計 ----------
  function settleClock(side, used) {
    if (!G.tc.on) return false;
    const main = G.clock.main[side];
    if (main > 0) {
      if (used <= main) { G.clock.main[side] = main - used; return false; }
      G.clock.main[side] = 0;
      return used - main > G.tc.byo;
    }
    return used > G.tc.byo;
  }
  setInterval(() => {
    if (!G || !G.game || G.over || !G.running) return;
    updateClocks();
    if (G.tc.on && G.mode !== 'review') {
      const side = G.game.pos.side, ti = timeInfo(side);
      if (ti && ti.left <= -0.2 && viewIsLive()) {
        if (G.mode === 'room' && side !== G.myColor && ti.left > -3) return; // 相手側の判定は少し待つ
        finish(side === 0 ? 'white' : 'black', 'timeout');
      }
    }
  }, 250);

  // ---------- 対局の開始 ----------
  function showScreen(name) {
    $('#home').hidden = name !== 'home'; $('#game').hidden = name !== 'game';
    window.scrollTo(0, 0);
    if (name === 'home') { renderHome(); }
  }
  function startGame(o) {
    G = newState(o);
    G.game = new S.Game(o.startSfen);
    G.clock.main = [G.tc.main, G.tc.main];
    G.turnStart = Date.now(); G.running = true;
    G.flip = o.flip !== undefined ? o.flip : (settings.autoFlip && G.mode !== 'local' && G.myColor === 1);
    selectTab('moves');
    showScreen('game');
    $('#chatLog').innerHTML = '';
    render();
    return G;
  }

  function startAiGame(opts) {
    const color = opts.color === 'r' ? (Math.random() < 0.5 ? 0 : 1) : +opts.color;
    const tc = tcById(opts.tc);
    AI.request('clear', {});
    const names = color === 0 ? [profile.name, 'AI Lv' + opts.level + ' ' + LEVEL_NAMES[opts.level - 1]] : ['AI Lv' + opts.level + ' ' + LEVEL_NAMES[opts.level - 1], profile.name];
    const krs = color === 0 ? [profile.krs, K.aiRating(opts.level)] : [K.aiRating(opts.level), profile.krs];
    startGame({ mode: 'ai', myColor: color, level: opts.level, tc: { on: tc.on, main: tc.main, byo: tc.byo }, tcId: tc.id, names, krs, aiSettings: opts });
    aiTurn();
  }
  function startLocalGame(o) {
    const tc = tcById(o.tc);
    startGame({ mode: 'local', myColor: 0, tc: { on: tc.on, main: tc.main, byo: tc.byo }, tcId: tc.id, names: [o.black || '先手', o.white || '後手'], krs: [null, null], unrated: true });
  }

  async function aiTurn() {
    const gid = G.gid;
    if (G.mode !== 'ai' || G.over || G.game.pos.side === G.myColor) return;
    G.thinking = true; render();
    const t0 = Date.now();
    let res;
    try { res = await AI.request('think', { moves: G.game.moves.slice(), startSfen: G.game.startSfen, level: G.level }); }
    catch (e) { console.error(e); toast('AIの処理でエラーが起きました'); G.thinking = false; render(); return; }
    await sleep(Math.max(0, 500 - (Date.now() - t0)));
    if (!G || G.gid !== gid || G.over) return;
    G.thinking = false;
    if (res && res.declare) { finish(G.myColor === 0 ? 'white' : 'black', 'impasse'); return; }
    if (!res || !res.move) { finish(G.myColor === 0 ? 'black' : 'white', 'nomove'); return; }
    applyMove(res.move, (Date.now() - G.turnStart) / 1000, false);
  }

  // ---------- 手の適用 ----------
  function applyMove(m, used, local) {
    const g = G.game, side = g.pos.side;
    g.play(m);
    G.times.push(used);
    G.view = null; G.sel = null; G.arrowPly = 0; G.legalCache = null;
    clack();
    if (G.room && local && window.KishoRoom) window.KishoRoom.onLocalMove(m, used);
    const timedOut = settleClock(side, used);
    if (timedOut) { finish(side === 0 ? 'white' : 'black', 'timeout'); return; }
    const st = g.status();
    if (st) { finish(st.result, st.reason); return; }
    G.turnStart = Date.now();
    render();
    if (G.mode === 'ai') aiTurn();
  }

  function finish(result, reason, opts) {
    opts = opts || {};
    if (!G || G.over) return;
    G.over = { result, reason }; G.running = false; G.thinking = false;
    let delta = null;
    if (G.mode === 'ai' && !G.unrated && G.game.moves.length >= 2) {
      const me = G.myColor === 0 ? 'black' : 'white';
      const score = result === 'draw' ? 0.5 : result === me ? 1 : 0;
      const u = K.update(profile.krs, profile.games, K.aiRating(G.level), score);
      delta = { before: profile.krs, after: u.rating, d: u.delta, score };
      applyRating(delta, 'AI Lv' + G.level, score);
    } else if (G.mode === 'room' && !G.unrated && G.krs[1 - G.myColor] != null && G.game.moves.length >= 2 && !G.room.async) {
      const me = G.myColor === 0 ? 'black' : 'white';
      const score = result === 'draw' ? 0.5 : result === me ? 1 : 0;
      const u = K.update(profile.krs, profile.games, G.krs[1 - G.myColor], score);
      delta = { before: profile.krs, after: u.rating, d: u.delta, score };
      applyRating(delta, G.names[1 - G.myColor], score);
    }
    G.delta = delta;
    if (G.mode !== 'review' && G.game.moves.length > 0) saveRecord();
    if (G.room && !opts.remote && window.KishoRoom) window.KishoRoom.onFinish(result, reason);
    render();
    setTimeout(() => { if (G && G.over) showResult(); }, 450);
  }
  function applyRating(d, oppName, score) {
    profile.krs = d.after; profile.games++;
    if (score === 1) profile.wins++; else if (score === 0) profile.losses++; else profile.draws++;
    profile.history.push({ t: Date.now(), krs: d.after, opp: oppName, s: score });
    profile.history = profile.history.slice(-60);
    saveProfile(); renderMeChip();
  }
  function saveRecord() {
    const rec = {
      id: 'r' + Date.now().toString(36), date: Date.now(), mode: G.mode, names: G.names.slice(), krs: G.krs.slice(),
      result: G.over.result, reason: G.over.reason, startSfen: G.game.startSfen, moves: G.game.moves.slice(), times: G.times.slice(),
      myColor: G.mode === 'local' ? null : G.myColor, delta: G.delta ? G.delta.d : null, review: null,
    };
    G.rec = rec; records.unshift(rec); saveRecords();
  }

  function showResult() {
    const dlg = $('#dlgResult'), o = G.over, me = G.myColor === 0 ? 'black' : 'white';
    let head;
    if (G.mode === 'local') head = o.result === 'draw' ? '引き分け' : (o.result === 'black' ? G.names[0] : G.names[1]) + 'の勝ち';
    else head = o.result === 'draw' ? '引き分け' : o.result === me ? 'あなたの勝ち' : 'あなたの負け';
    let krs = '';
    if (G.delta) {
      krs = '<div class="res-delta"><span class="krs"><i>KRS</i><b>' + G.delta.before + '</b></span><span class="arrow">→</span><span class="krs"><i>KRS</i><b>' + G.delta.after + '</b></span><span class="d ' + (G.delta.d >= 0 ? 'up' : 'down') + '">' + (G.delta.d >= 0 ? '+' : '') + G.delta.d + '</span></div>';
    } else if (G.mode === 'ai' && G.unrated) krs = '<p class="note">「待った」を使ったので、この対局は KRS に反映されません。</p>';
    else if (G.mode === 'local') krs = '<p class="note">同じ画面での対局は KRS に反映されません。</p>';
    else if (G.game.moves.length < 2) krs = '<p class="note">手数が少ないので KRS に反映されません。</p>';
    $('#resultBody').innerHTML =
      '<h2 class="res-head">' + esc(head) + '</h2>' +
      '<p>' + G.game.moves.length + '手 · ' + esc(REASON[o.reason] || o.reason) + '</p>' + krs +
      '<p class="note">KRS は KISHO 独自のレーティングです。</p>' +
      '<div class="dlg-actions"><button class="btn" value="close">盤を見る</button><button class="btn" value="home">ホームへ</button><button class="btn" value="again">もう一局</button><button class="btn primary" value="review">AIで振り返る</button></div>';
    dlg.returnValue = '';
    if (!dlg.open) dlg.showModal();
  }
  $('#dlgResult').addEventListener('close', (e) => {
    const v = e.target.returnValue;
    if (v === 'review') doReview();
    else if (v === 'home') goHome();
    else if (v === 'again') rematch();
  });

  function rematch() {
    if (G.mode === 'ai') startAiGame(Object.assign({}, G.aiSettings, { color: G.aiSettings.color === 'r' ? 'r' : String(1 - G.myColor) }));
    else if (G.mode === 'local') startLocalGame({ black: G.names[1], white: G.names[0], tc: G.tcId });
    else if (G.mode === 'room' && window.KishoRoom) window.KishoRoom.rematch();
  }
  // ---------- AI対戦の中断・再開 ----------
  const MAX_SAVES = 5;
  const aiSaves = () => store.get('aiSaves', []);
  function saveAiGame() {
    const list = aiSaves();
    if (!G || G.mode !== 'ai' || G.over || list.length >= MAX_SAVES) return false;
    list.unshift({
      id: 's' + Date.now().toString(36), savedAt: Date.now(),
      myColor: G.myColor, level: G.level, tc: G.tc, tcId: G.tcId, names: G.names.slice(), krs: G.krs.slice(), aiSettings: G.aiSettings,
      unrated: !!G.unrated, flip: G.flip, startSfen: G.game.startSfen || null,
      moves: G.game.moves.slice(), times: G.times.slice(), clockMain: G.clock.main.slice(),
      turnUsed: Math.max(0, (Date.now() - G.turnStart) / 1000), // 今の手番で使った秒数
    });
    store.set('aiSaves', list);
    return true;
  }
  function resumeAiGame(id) {
    const list = aiSaves(), s = list.find((x) => x.id === id);
    if (!s) return;
    AI.request('clear', {});
    startGame({ mode: 'ai', myColor: s.myColor, level: s.level, tc: s.tc, tcId: s.tcId, names: s.names, krs: s.krs, aiSettings: s.aiSettings, startSfen: s.startSfen || undefined, flip: s.flip });
    s.moves.forEach((m) => G.game.play(m));
    G.times = s.times.slice(); G.clock.main = s.clockMain.slice(); G.unrated = !!s.unrated;
    G.turnStart = Date.now() - s.turnUsed * 1000;
    store.set('aiSaves', list.filter((x) => x.id !== id)); // 再開したら保存分は消える(また中断すれば新しく保存される)
    render(); aiTurn();
  }
  function renderSaved() {
    const list = aiSaves(), card = $('#savedCard');
    card.hidden = !list.length;
    $('#savedList').innerHTML = list.map((s) => {
      const d = new Date(s.savedAt), lab = s.myColor === 0 ? '先手' : '後手';
      return '<li><div class="rec-main">' + esc(s.names[s.myColor === 0 ? 1 : 0]) + ' と対局中 <span class="note">あなたは' + lab + '</span></div>' +
        '<div class="rec-sub">' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' に中断 · ' + s.moves.length + '手</div>' +
        '<div class="rec-acts"><button class="btn small primary" data-resume="' + s.id + '">再開</button><button class="btn small ghost" data-sdel="' + s.id + '" aria-label="削除">✕</button></div></li>';
    }).join('');
  }
  $('#savedList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.resume) resumeAiGame(b.dataset.resume);
    else if (b.dataset.sdel) ask('この中断中の対局を削除しますか？', '削除する').then((yes) => { if (yes) { store.set('aiSaves', aiSaves().filter((x) => x.id !== b.dataset.sdel)); renderSaved(); } });
  });
  function goHome() {
    if (G && G.room && window.KishoRoom) window.KishoRoom.leave();
    G = null; showScreen('home');
  }

  // ---------- 盤の操作 ----------
  board.addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (!c || !canTouch()) return;
    const sq = +c.dataset.sq, pos = G.game.pos, p = pos.board[sq];
    const mine = p !== 0 && (p > 0) === (pos.side === 0);
    if (G.sel) {
      const d = destsFor(G.sel);
      if (d.has(sq)) { chooseMove(d.get(sq)); return; }
      if (G.sel.kind === 'b' && G.sel.sq === sq) { G.sel = null; render(); return; }
    }
    G.sel = mine ? { kind: 'b', sq } : null;
    render();
  });
  const onHand = (e) => {
    const b = e.target.closest('.hp');
    if (!b || b.disabled || !canTouch()) return;
    const t = +b.dataset.t;
    G.sel = G.sel && G.sel.kind === 'h' && G.sel.t === t ? null : { kind: 'h', t };
    render();
  };
  $('#handTop').addEventListener('click', onHand); $('#handBot').addEventListener('click', onHand);

  async function chooseMove(list) {
    if (list.length === 1) { commit(list[0]); return; }
    const pos = G.game.pos, from = S.moveFrom(list[0]), piece = pos.board[from], t = piece > 0 ? piece : -piece;
    const promo = list.find((m) => S.movePromo(m)), plain = list.find((m) => !S.movePromo(m));
    const pick = await askPromote(t, pos.side);
    if (pick === null) return;
    commit(pick ? promo : plain);
  }
  function askPromote(t, side) {
    return new Promise((resolve) => {
      const dlg = $('#dlgPromote'), box = $('#promoChoices');
      box.innerHTML = '';
      box.className = 'promo-choices ps-' + settings.pieceSet + (T.PIECE_SETS.find((s) => s.id === settings.pieceSet).glyph === 'letters' ? ' letters' : '');
      [[true, S.PROMO[t], '成る'], [false, t, '成らない']].forEach(([val, tt, lab]) => {
        const b = document.createElement('button');
        b.type = 'button';
        const pe = pieceEl(side === 0 ? tt : -tt); pe.dataset.up = '1'; b.appendChild(pe);
        b.insertAdjacentHTML('beforeend', '<span class="lab">' + lab + '</span>');
        b.addEventListener('click', () => { dlg.dataset.pick = val ? '1' : '0'; dlg.close('pick'); });
        box.appendChild(b);
      });
      dlg.dataset.pick = '';
      dlg.addEventListener('close', function h() { dlg.removeEventListener('close', h); resolve(dlg.dataset.pick === '' ? null : dlg.dataset.pick === '1'); });
      dlg.showModal();
    });
  }
  function commit(m) {
    const used = (Date.now() - G.turnStart) / 1000;
    applyMove(m, used, true);
  }

  // ---------- パネル操作 ----------
  $('#moveList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) setView(+li.dataset.i);
  });
  function setView(i) {
    const n = G.game.moves.length;
    i = Math.max(0, Math.min(n, i));
    G.view = i === n ? null : i; G.sel = null;
    if (G.arrowPly && i !== G.arrowPly - 1) G.arrowPly = 0;
    render();
  }
  $('#navBtns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const i = viewIdx(), n = G.game.moves.length;
    setView(b.dataset.nav === 'first' ? 0 : b.dataset.nav === 'prev' ? i - 1 : b.dataset.nav === 'next' ? i + 1 : n);
  });
  document.addEventListener('keydown', (e) => {
    if (!G || !G.game || $('#game').hidden || e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
    const i = viewIdx(), n = G.game.moves.length;
    if (e.key === 'ArrowLeft') { setView(i - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setView(i + 1); e.preventDefault(); }
    else if (e.key === 'Home') { setView(0); e.preventDefault(); }
    else if (e.key === 'End') { setView(n); e.preventDefault(); }
  });
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) selectTab(b.dataset.tab); });

  function kifText() {
    const meta = { black: G.names[0], white: G.names[1], times: G.times, reason: G.over && G.over.reason !== 'checkmate' ? G.over.reason : (G.over ? 'checkmate' : null) };
    if (G.over && G.over.reason === 'resign') meta.reason = 'resign';
    return S.toKif(G.game, meta);
  }
  $('#actions').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !G) return;
    const act = b.dataset.act;
    if (act === 'flip') { G.flip = !G.flip; render(); }
    else if (act === 'resign') {
      if (!(await ask('投了しますか？', '投了する'))) return;
      const loser = G.mode === 'local' ? G.game.pos.side : G.myColor;
      finish(loser === 0 ? 'white' : 'black', 'resign');
    } else if (act === 'undo') {
      const g = G.game;
      let n = g.pos.side === G.myColor ? 2 : 1;
      if (g.moves.length < n) n = g.moves.length;
      for (let i = 0; i < n; i++) { g.undo(); G.times.pop(); }
      G.unrated = true; G.view = null; G.sel = null; G.legalCache = null; G.turnStart = Date.now();
      toast('待ったを使ったので、この対局は KRS に反映されません');
      render();
    } else if (act === 'declare') {
      const side = G.mode === 'local' ? G.game.pos.side : G.myColor;
      finish(side === 0 ? 'black' : 'white', 'impasse');
    } else if (act === 'kif') {
      try { await navigator.clipboard.writeText(kifText()); toast('棋譜をコピーしました'); } catch (err) { toast('コピーできませんでした。「KIF保存」を使ってください'); }
    } else if (act === 'kifdl') {
      const blob = new Blob([kifText()], { type: 'text/plain;charset=utf-8' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kisho_' + new Date().toISOString().slice(0, 10) + '.kif'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else if (act === 'review') doReview();
    else if (act === 'again') rematch();
    else if (act === 'home') goHome();
    else if (act === 'suspend') {
      if (aiSaves().length >= MAX_SAVES) { toast('保存できる対局がいっぱい(' + MAX_SAVES + '局)です。ホームで1局削除してください'); return; }
      if (saveAiGame()) { toast('保存しました。ホームの「中断中の対局」から再開できます'); goHome(); }
    }
  });

  // ---------- 振り返り ----------
  function doReview() {
    if (!G) return;
    const state = G;
    // 終局した対局を「再生モード」で開き直す (対局の状態は維持)
    G.mode = G.mode === 'room' || G.mode === 'ai' || G.mode === 'local' ? G.mode : 'review';
    selectTab('review'); render();
    if (state.room && window.KishoRoom) { /* 部屋は維持したまま閲覧 */ }
  }
  function openRecord(id, analyze) {
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    G = newState({ mode: 'review', rec });
    G.game = S.Game.fromMoves(rec.moves, rec.startSfen);
    G.names = rec.names.slice(); G.krs = rec.krs.slice(); G.times = (rec.times || []).slice();
    G.over = { result: rec.result, reason: rec.reason }; G.review = rec.review || null;
    G.flip = rec.myColor === 1; G.view = 0;
    showScreen('game'); selectTab('review'); render();
    if (analyze && !rec.review) runAnalysis(5);
  }
  let analyzing = false;
  async function runAnalysis(depthLevel) {
    if (analyzing || !G) return;
    analyzing = true;
    const state = G, depth = depthLevel === 7 ? 7 : 5, maxNodes = depthLevel === 7 ? 300000 : 80000;
    const pane = $('#paneReview');
    pane.innerHTML = '<div class="rv"><div class="rv-run"><p>AIが一手ずつ評価しています…</p><div class="progress"><div id="rvBar"></div></div><p id="rvTxt">0 / ' + state.game.moves.length + '</p></div></div>';
    try {
      const res = await AI.request('analyze', { moves: state.game.moves.slice(), startSfen: state.game.startSfen, depth, maxNodes }, (i, n) => {
        const bar = $('#rvBar'); if (bar) bar.style.width = Math.round(i / n * 100) + '%';
        const tx = $('#rvTxt'); if (tx) tx.textContent = i + ' / ' + n;
      });
      state.review = res;
      const rec = state.rec || records.find((r) => r.id === (state.rec && state.rec.id));
      if (rec) { rec.review = res; saveRecords(); }
    } catch (e) { console.error(e); toast('解析に失敗しました'); }
    analyzing = false;
    if (G === state) { render(); }
  }
  const wp = (cp) => AIm.winProb(cp);
  function renderReview() {
    const pane = $('#paneReview');
    if (analyzing) return;
    if (!G.review) {
      const n = G.game.moves.length;
      pane.innerHTML = '<div class="rv"><div class="rv-run"><p>AIが全ての手を評価して、最善手との差を「最善・好手・緩手・疑問手・悪手」で教えてくれます。</p>' +
        '<label class="note">解析の深さ<select id="rvDepth"><option value="5">ふつう (数十秒)</option><option value="7">じっくり (数分)</option></select></label>' +
        '<button class="btn primary" id="rvRun"' + (n < 2 ? ' disabled' : '') + '>解析する</button>' +
        '<p class="rv-note">評価は簡易なAIによる目安です。プロ棋士や強い将棋ソフトの判断とは違うことがあります。</p></div></div>';
      const run = $('#rvRun'); if (run) run.onclick = () => runAnalysis(+$('#rvDepth').value);
      return;
    }
    const rv = G.review, n = rv.plies.length, idx = viewIdx();
    // 勝率グラフ (先手視点)
    const W = 300, H = 96, X = (i) => (n ? (i / n) * W : 0), Y = (p) => H - p * H;
    const pts = [[0, wp(rv.plies[0].scoreBefore)]].concat(rv.plies.map((p, i) => [i + 1, wp(p.scoreAfter)]));
    const poly = pts.map(([i, v]) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    const area = '0,' + H + ' ' + poly + ' ' + W + ',' + H;
    let dots = '';
    rv.plies.forEach((p, i) => {
      if (p.forced || (p.grade !== 'doubt' && p.grade !== 'bad')) return;
      dots += '<circle cx="' + X(i + 1).toFixed(1) + '" cy="' + Y(wp(p.scoreAfter)).toFixed(1) + '" r="3.2" fill="var(--' + (p.grade === 'bad' ? 'bad' : 'doubt') + ')"/>';
    });
    const gcol = (id) => '<span class="gdot g-' + id + '"></span>';
    const sumBox = (side) => {
      const c = rv.counts[side];
      return '<div><h4>' + (side === 0 ? '先手' : '後手') + ' ' + esc(G.names[side]) + '</h4><div class="acc">' + (rv.accuracy[side] == null ? '-' : rv.accuracy[side]) + '<small> 正確度</small></div><ul>' +
        AIm.GRADES.map((g) => '<li>' + gcol(g.id) + '<span>' + g.name + '</span><span>' + c[g.id] + '</span></li>').join('') + '</ul></div>';
    };
    let now = '';
    const cardPly = G.arrowPly && idx === G.arrowPly - 1 ? G.arrowPly : idx;
    if (cardPly > 0) {
      const p = rv.plies[cardPly - 1];
      if (p) {
        const before = Math.round(wp(p.scoreBefore) * 100), after = Math.round(wp(p.scoreAfter) * 100);
        now = '<div class="rv-now"><div class="t"><span>' + esc(p.text) + '</span>' + (p.forced ? '<span class="rv-note">(ほかに指せる手がない)</span>' : '<span class="tag g-' + p.grade + '">' + p.gradeName + '</span>') + '</div>' +
          '<div>先手の勝率 ' + before + '% → ' + after + '%</div>' +
          (!p.isBest && !p.forced && p.best.text ? '<div>最善手: <b>' + esc(p.best.text) + '</b> ' + (cardPly === G.arrowPly && idx === cardPly - 1 ? '<span class="rv-note">(盤の矢印: 青緑=最善 / 灰=実戦)</span>' : '<button class="link" id="rvShow">指す前の局面で見る</button>') + '</div>' : '') + '</div>';
      }
    } else now = '<div class="rv-now"><div class="rv-note">手を選ぶと、その手の評価と最善手が表示されます。</div></div>';
    pane.innerHTML = '<div class="rv"><svg class="rv-graph" id="rvGraph" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="先手の勝率の推移">' +
      '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" stroke="currentColor" opacity=".25" stroke-dasharray="3 3"/>' +
      '<polygon points="' + area + '" fill="var(--asagi)" opacity=".16"/><polyline points="' + poly + '" fill="none" stroke="var(--asagi)" stroke-width="2" vector-effect="non-scaling-stroke"/>' + dots +
      '<line x1="' + X(idx).toFixed(1) + '" y1="0" x2="' + X(idx).toFixed(1) + '" y2="' + H + '" stroke="var(--shu)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="rv-note">上が先手有利、下が後手有利。丸は疑問手・悪手。</div>' + now +
      '<div class="rv-sum">' + sumBox(0) + sumBox(1) + '</div>' +
      '<ol class="moves rv-moves" id="rvMoves">' + movesHtml() + '</ol>' +
      '<p class="rv-note">正確度と評価は簡易AIによる目安で、公式な指標ではありません。</p></div>';
    const rvm = $('#rvMoves');
    rvm.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) setView(+li.dataset.i); });
    $('#rvGraph').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setView(Math.round(((e.clientX - r.left) / r.width) * n));
    });
    const show = $('#rvShow');
    if (show) show.onclick = () => { G.arrowPly = cardPly; G.view = cardPly - 1; render(); };
  }

  // ---------- ホーム ----------
  function renderMeChip() {
    $('#meChip').innerHTML = krsBadge(profile.krs);
    $('#meChip').setAttribute('aria-label', 'KRS ' + profile.krs + ' (独自)');
  }
  function sparkline() {
    const h = profile.history.slice(-30);
    if (h.length < 2) return '';
    const vals = h.map((x) => x.krs), mn = Math.min(...vals) - 10, mx = Math.max(...vals) + 10;
    const pts = vals.map((v, i) => (i / (vals.length - 1) * 200).toFixed(1) + ',' + (40 - (v - mn) / (mx - mn) * 38 - 1).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 200 40" width="100%" height="40" preserveAspectRatio="none" aria-label="KRSの推移"><polyline points="' + pts + '" fill="none" stroke="var(--asagi)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  function renderHome() {
    renderMeChip(); renderSaved();
    $('#krsCard').innerHTML =
      '<h2>あなたの KRS<span class="unofficial">独自</span></h2>' +
      '<div class="big"><span class="num">' + profile.krs + '</span><span class="lab">KRS</span></div>' +
      '<div class="title-line">称号「' + K.title(profile.krs) + '」</div>' +
      '<div class="rec">' + profile.games + '局 · ' + profile.wins + '勝 ' + profile.losses + '敗 ' + profile.draws + '分</div>' + sparkline() +
      '<div class="more"><button class="link" id="aboutKrs">KRS (KISHO RATING SYSTEM) とは</button></div>';
    $('#aboutKrs').onclick = showAbout;
    const list = $('#recList');
    if (!records.length) list.innerHTML = '<li class="empty">まだ対局がありません。AIや友達と1局指してみよう。</li>';
    else list.innerHTML = records.slice(0, 8).map((r) => {
      const me = r.myColor, cls = r.result === 'draw' ? 'res-draw' : me == null ? '' : ((r.result === 'black') === (me === 0)) ? 'res-win' : 'res-lose';
      const lab = r.result === 'draw' ? '引き分け' : me == null ? (r.result === 'black' ? '先手勝ち' : '後手勝ち') : ((r.result === 'black') === (me === 0)) ? '勝ち' : '負け';
      const d = new Date(r.date);
      return '<li><div class="rec-main"><span class="' + cls + '">' + lab + '</span> ' + esc(r.names[0]) + ' 対 ' + esc(r.names[1]) + (r.delta != null ? ' <span class="note">KRS ' + (r.delta >= 0 ? '+' : '') + r.delta + '</span>' : '') + '</div>' +
        '<div class="rec-sub">' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + r.moves.length + '手 · ' + esc(REASON[r.reason] || r.reason) + (r.review ? ' · 解析済み' : '') + '</div>' +
        '<div class="rec-acts"><button class="btn small" data-play="' + r.id + '">再生</button><button class="btn small" data-rv="' + r.id + '">振り返り</button><button class="btn small ghost" data-del="' + r.id + '" aria-label="削除">✕</button></div></li>';
    }).join('');
  }
  $('#recList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.play) openRecord(b.dataset.play, false);
    else if (b.dataset.rv) openRecord(b.dataset.rv, true);
    else if (b.dataset.del) { ask('この棋譜を削除しますか？', '削除する').then((yes) => { if (yes) { records = records.filter((r) => r.id !== b.dataset.del); saveRecords(); renderHome(); } }); }
  });

  function showAbout() {
    const dlg = $('#dlgAbout');
    $('#aboutBody').innerHTML =
      '<div class="about-krs">KRS<small>KISHO RATING SYSTEM · 棋匠レーティング</small></div>' +
      '<div class="about-box"><b>KISHO 独自のレーティングです。</b>KISHO が計算しているもので、日本将棋連盟などの公的な団体の段級位・レーティングとは関係ありません。</div>' +
      '<p>チェスの Elo と同じ考え方で計算します。自分より強い相手に勝つと大きく上がり、弱い相手に負けると大きく下がります。</p>' +
      '<p class="note">期待勝率 E = 1 ÷ (1 + 10^((相手 − 自分) ÷ 400))<br>新しい KRS = 今の KRS + K × (結果 − E)<br>結果は 勝ち=1 / 引き分け=0.5 / 負け=0。K は 〜19局が40、20〜59局が28、60局〜が20。最初は ' + K.INITIAL + ' からスタートします。</p>' +
      '<table class="table-lv"><tr><th>AIレベル</th><th>名前</th><th>KRS (目安)</th></tr>' +
      LEVEL_NAMES.map((n, i) => '<tr><td>Lv' + (i + 1) + '</td><td>' + n + '</td><td>' + K.aiRating(i + 1) + '</td></tr>').join('') + '</table>' +
      '<p class="note">AIの KRS は、AI同士で対戦させた結果から出した目安です。' + '「待った」を使った対局や、同じ画面での対局は KRS に反映されません。</p>' +
      '<div class="dlg-actions"><button class="btn primary" value="ok">閉じる</button></div>';
    dlg.showModal();
  }

  // ---------- 各ダイアログ ----------
  function fillTc(sel, def) {
    sel.innerHTML = TCS.map((t) => '<option value="' + t.id + '"' + (t.id === def ? ' selected' : '') + '>' + t.name + '</option>').join('');
  }
  function openAiDialog() {
    const last = store.get('aiLast', { level: Math.max(1, [1,2,3,4,5,6,7,8,9,10].filter((l) => K.aiRating(l) <= profile.krs + 50).length), color: '0', tc: 'none' });
    $('#levelList').innerHTML = LEVEL_NAMES.map((n, i) => '<label><input type="radio" name="lv" value="' + (i + 1) + '"' + (i + 1 === last.level ? ' checked' : '') + '><span><b>' + (i + 1) + '</b><small>' + n + '</small><small>' + K.aiRating(i + 1) + '</small></span></label>').join('');
    $('#aiColor').value = last.color; fillTc($('#aiTc'), last.tc);
    $('#dlgAi').showModal();
  }
  $('#dlgAi').addEventListener('close', (e) => {
    if (e.target.returnValue !== 'ok') return;
    const o = { level: +($('input[name="lv"]:checked') || { value: 3 }).value, color: $('#aiColor').value, tc: $('#aiTc').value };
    store.set('aiLast', o); startAiGame(o);
  });

  let friendMode = 'room';
  function openFriendDialog(prefillPass) {
    const last = store.get('friendLast', { style: 'live', tc: '10-30', ltc: 'none' });
    $('#fName').value = profile.name; $('#fPass').value = prefillPass || '';
    $('#fStyle').value = last.style; fillTc($('#fTc'), last.tc); fillTc($('#lTc'), last.ltc);
    $('#fMail').value = store.get('mail', '');
    $('#netNote').textContent = window.KishoNet.configured
      ? '友達と同じ合言葉を入れると、同じ部屋に入れます。'
      : 'いまは設定前なので、同じブラウザの別タブ同士でだけつながります (お試し用)。友達とつなぐには js/config.js の設定が必要です。';
    syncFriendUi(); $('#dlgFriend').showModal();
  }
  function syncFriendUi() {
    $$('#friendMode button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.fm === friendMode ? 'true' : 'false'));
    $('#roomFields').hidden = friendMode !== 'room'; $('#localFields').hidden = friendMode !== 'local';
    const async = $('#fStyle').value === 'async';
    $('#fTc').disabled = async; $('#fMailRow').hidden = !(async && window.KishoNet.configured);
  }
  $('#friendMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { friendMode = b.dataset.fm; syncFriendUi(); } });
  $('#fStyle').addEventListener('change', syncFriendUi);
  $('#friendForm').addEventListener('submit', (e) => {
    const v = e.submitter && e.submitter.value;
    if (v !== 'ok') return;
    if (friendMode === 'room' && !$('#fPass').value.trim()) { e.preventDefault(); $('#fPass').focus(); toast('合言葉を入れてください'); return; }
    if (friendMode === 'room' && !$('#fName').value.trim()) { e.preventDefault(); $('#fName').focus(); return; }
  });
  $('#dlgFriend').addEventListener('close', (e) => {
    if (e.target.returnValue !== 'ok') return;
    if (friendMode === 'local') {
      const ltc = $('#lTc').value; store.set('friendLast', Object.assign(store.get('friendLast', {}), { ltc }));
      startLocalGame({ black: $('#lBlack').value.trim() || '先手', white: $('#lWhite').value.trim() || '後手', tc: ltc });
    } else {
      const o = { name: $('#fName').value.trim().slice(0, 12), pass: $('#fPass').value.trim(), style: $('#fStyle').value, tc: $('#fTc').value, mail: $('#fMail').value.trim() };
      profile.name = o.name || profile.name; saveProfile();
      store.set('friendLast', Object.assign(store.get('friendLast', {}), { style: o.style, tc: o.tc }));
      if (o.mail) store.set('mail', o.mail);
      window.KishoRoom.join(o);
    }
  });

  function openSettings() {
    $('#sName').value = profile.name;
    const pv = $('#pieceSets'), bv = $('#boardThemes');
    pv.innerHTML = T.PIECE_SETS.map((s) => '<button type="button" class="sw" data-ps="' + s.id + '" aria-pressed="' + (s.id === settings.pieceSet) + '" title="' + esc(s.note) + '"><span class="pv ps-' + s.id + (s.glyph === 'letters' ? ' letters' : '') + ' bt-kaya"></span><span>' + s.name + '</span></button>').join('');
    $$('#pieceSets .pv').forEach((el, i) => {
      const s = T.PIECE_SETS[i], pe = pieceEl(8, s.id);
      pe.dataset.up = '1'; el.appendChild(pe);
    });
    bv.innerHTML = T.BOARD_THEMES.map((s) => '<button type="button" class="sw" data-bt="' + s.id + '" aria-pressed="' + (s.id === settings.boardTheme) + '"><span class="bv bt-' + s.id + '"></span><span>' + s.name + '</span></button>').join('');
    $$('#themeMode button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.tm === settings.theme ? 'true' : 'false'));
    $('#sHints').checked = settings.hints; $('#sCoords').checked = settings.coords; $('#sSound').checked = settings.sound; $('#sFlip').checked = settings.autoFlip;
    $('#dlgSettings').showModal();
  }
  $('#themeMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tm]'); if (!b) return;
    settings.theme = b.dataset.tm; saveSettings(); applyMode();
    $$('#themeMode button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  });
  $('#pieceSets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ps]'); if (!b) return;
    settings.pieceSet = b.dataset.ps; saveSettings();
    $$('#pieceSets .sw').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    if (G && G.game) render(); else applyTheme();
  });
  $('#boardThemes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bt]'); if (!b) return;
    settings.boardTheme = b.dataset.bt; saveSettings();
    $$('#boardThemes .sw').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    applyTheme();
  });
  [['#sHints', 'hints'], ['#sCoords', 'coords'], ['#sSound', 'sound'], ['#sFlip', 'autoFlip']].forEach(([sel, key]) => {
    $(sel).addEventListener('change', (e) => { settings[key] = e.target.checked; saveSettings(); if (G && G.game) render(); else applyTheme(); });
  });
  $('#sName').addEventListener('change', (e) => { profile.name = e.target.value.trim().slice(0, 12) || 'あなた'; saveProfile(); renderMeChip(); });
  $('#resetAll').addEventListener('click', async () => {
    if (!(await ask('KRS・棋譜・設定をすべて削除します。よろしいですか？', 'すべて削除'))) return;
    try { Object.keys(localStorage).filter((k) => k.startsWith('kisho.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* noop */ }
    location.reload();
  });

  // ---------- 入口 ----------
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'ai') openAiDialog();
    else if (go === 'friend') openFriendDialog();
    else if (go === 'records') $('#recordsCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  $('#logoBtn').addEventListener('click', async () => {
    if (G && G.mode !== 'review' && !G.over && G.game.moves.length > 0) {
      const canSave = G.mode === 'ai' && aiSaves().length < MAX_SAVES;
      const r = await askEx('対局を打ち切りしてホームへ戻りますか？', '打ち切り', G.mode !== 'ai' ? { cancel: '戻る' } : {
        cancel: '戻る', extra: canSave ? '保存して中断' : '',
        hint: canSave ? '「保存して中断」なら、ホームから続きを再開できます。' : '中断して保存できる対局がいっぱい(' + MAX_SAVES + '局)です。ホームで1局削除すると保存できます。',
      });
      if (r === 'extra') { saveAiGame(); toast('保存しました。ホームの「中断中の対局」から再開できます'); }
      else if (r !== 'yes') return;
    }
    goHome();
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#meChip').addEventListener('click', showAbout);
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'dlgPromote' && d.id !== 'dlgWait') d.close('cancel'); }));

  // 外部(room.js)向け
  window.KishoApp = {
    get G() { return G; }, set G(v) { G = v; }, S, K, T, store, esc, $, $$, toast, render, startGame, applyMove, finish, showScreen, selectTab, krsBadge,
    ask, getProfile: () => profile, saveProfile, TCS, tcById, CID, resultLine, goHome, REASON,
  };

  applyMode(); applyTheme(); renderHome();
  setTimeout(() => {
    const m = /[#&]r=([^&]+)/.exec(location.hash);
    if (m) { try { openFriendDialog(decodeURIComponent(m[1])); } catch (e) { /* noop */ } }
  }, 100);
})();
