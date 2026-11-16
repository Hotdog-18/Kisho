/* KISHO — 合言葉の部屋 (リアルタイム対局 / 通信将棋) */
(function () {
  'use strict';
  const A = window.KishoApp, N = window.KishoNet, S = A.S;
  const { $, esc } = A;
  let R = null;

  const tabId = () => A.CID + '-' + Math.random().toString(36).slice(2, 6);
  const inviteLink = (pass) => location.href.split('#')[0] + '#r=' + encodeURIComponent(pass);
  const send = (m) => { if (R && R.t) R.t.send(m); };

  function showWait(extra) {
    const dlg = $('#dlgWait');
    $('#waitBody').innerHTML =
      '<h2 class="wait-h"><span class="spin" role="status" aria-label="待機中"></span>相手方を待っています...</h2>' +
      '<p>合言葉「<b>' + esc(R.pass) + '</b>」で入室してもらうべし。</p>' +
      '<div class="copyline"><input readonly value="' + esc(inviteLink(R.pass)) + '" aria-label="招待リンク"><button type="button" class="btn" id="copyInvite">リンクをコピー</button></div>' +
      (R.fallback ? '<p class="note">いまは「同じブラウザ内モード」です。同じブラウザの別タブで同じ合言葉を入れると対局できます。友達とつなぐには js/config.js の設定が必要です。</p>' : '') +
      (extra ? '<p class="note" style="color:var(--shu)">' + esc(extra) + '</p>' : '') +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">やめる</button></div>';
    $('#copyInvite').onclick = async () => {
      try { await navigator.clipboard.writeText(inviteLink(R.pass)); A.toast('リンクをコピーしました'); } catch (e) { $('#waitBody input').select(); }
    };
    if (!dlg.open) dlg.showModal();
  }
  $('#dlgWait').addEventListener('close', () => {
    if (R && !R.started) { leave(); A.goHome(); }
  });

  async function join(o) {
    leave();
    A.toast('接続しています…');
    const conn = await N.connect(o.pass);
    R = {
      id: tabId(), cid: A.CID, name: o.name, pass: o.pass, style: o.style, tcId: o.style === 'async' ? 'none' : o.tc, mail: o.mail,
      key: conn.key, t: conn.transport, fallback: conn.fallback, peer: null, started: false, gid: null, timer: null, poll: null,
      async: o.style === 'async', rematch: { me: false, peer: false }, waiting: false,
    };
    R.t.onmessage = onNet;
    if (R.async) { await joinAsync(); return; }
    showWait();
    announce();
    R.timer = setInterval(announce, 2500);
  }
  const announce = () => send({ t: 'hello', id: R.id, cid: R.cid, name: R.name, krs: A.getProfile().krs, style: R.style, tc: R.tcId });

  function leave() {
    if (!R) return;
    clearInterval(R.timer); clearInterval(R.poll);
    try { R.t.close(); } catch (e) { /* noop */ }
    const g = A.G; if (g && g.room === R) g.room = null;
    R = null;
  }

  // ---------- 受信 ----------
  function onNet(m) {
    if (!R || !m) return;
    if (m.t === 'hello') return onHello(m);
    if (m.t === 'start') return onStart(m);
    if (m.t === 'chat') return addChat(m.name, m.text, false);
    if (!R.started || m.gid !== R.gid || !A.G || A.G.room !== R) return;
    const G = A.G;
    if (m.t === 'move') {
      const g = G.game;
      if (G.over || m.ply !== g.moves.length + 1 || g.pos.side === G.myColor) return;
      if (!g.legal().includes(m.m)) return;
      A.applyMove(m.m, +m.used || 0, false);
    } else if (m.t === 'result') {
      A.finish(m.result, m.reason, { remote: true });
    } else if (m.t === 'rematch') {
      R.rematch.peer = true;
      if (R.rematch.me) { if (R.host) startAsHost(true); }
      else A.toast('相手がもう一局を希望しています');
    }
  }

  function onHello(m) {
    if (m.id === R.id || R.async) return;
    if (R.started) {
      if (R.peer && m.id === R.peer.id) return;
      return; // すでに2人で対局中
    }
    const first = !R.peer || R.peer.id !== m.id;
    R.peer = { id: m.id, name: m.name, krs: m.krs, style: m.style, tc: m.tc };
    if (first) announce();
    if (m.style !== R.style) { showWait('相手と対局のしかた (リアルタイム/通信将棋) が違います。そろえて入り直してください。'); return; }
    R.host = R.id < m.id;
    if (R.host) setTimeout(() => { if (R && !R.started && R.peer) startAsHost(false); }, 250);
  }

  function startAsHost(swap) {
    if (!R || !R.peer) return;
    const me = { id: R.id, name: R.name, krs: A.getProfile().krs }, pe = { id: R.peer.id, name: R.peer.name, krs: R.peer.krs };
    let meBlack;
    if (swap && A.G && A.G.myColor !== undefined) meBlack = A.G.myColor === 1;
    else meBlack = Math.random() < 0.5;
    const msg = { t: 'start', gid: 'g' + Date.now().toString(36), black: meBlack ? me : pe, white: meBlack ? pe : me, tc: R.tcId, from: R.id };
    send(msg);
    begin(msg);
  }
  function onStart(m) {
    if (!R || R.async || m.from === R.id) return;
    if (R.started && A.G && !A.G.over) return;
    if (R.started && m.gid === R.gid) return;
    if (!R.peer || R.peer.id !== m.from) R.peer = { id: m.from };
    begin(m);
  }
  function begin(m) {
    R.started = true; R.gid = m.gid; R.rematch = { me: false, peer: false };
    clearInterval(R.timer);
    const dlg = $('#dlgWait'); if (dlg.open) dlg.close('started');
    const myColor = m.black.id === R.id ? 0 : 1, tc = A.tcById(m.tc);
    R.host = m.from === R.id;
    A.startGame({
      mode: 'room', myColor, room: R, names: [m.black.name, m.white.name], krs: [m.black.krs, m.white.krs],
      tc: { on: tc.on, main: tc.main, byo: tc.byo }, tcId: tc.id,
    });
    A.G.gid = A.G.gid; // 新しい対局
    addChat(null, m.black.name + ' (先手) 対 ' + m.white.name + ' (後手) の対局が始まりました', false, true);
    A.toast(myColor === 0 ? 'あなたは先手です' : 'あなたは後手です');
  }

  // ---------- 送信 ----------
  function onLocalMove(m, used) {
    if (!R) return;
    if (R.async) { saveAsync(); notifyMove(); return; }
    send({ t: 'move', gid: R.gid, m, ply: A.G.game.moves.length, used });
  }
  function onFinish(result, reason) {
    if (!R) return;
    if (R.async) { saveAsync({ result, reason }); return; }
    send({ t: 'result', gid: R.gid, result, reason });
  }
  function rematch() {
    if (!R || R.async) { A.goHome(); return; }
    R.rematch.me = true;
    send({ t: 'rematch', gid: R.gid });
    if (R.rematch.peer) { if (R.host) startAsHost(true); }
    else A.toast('相手の返事を待っています');
  }

  // ---------- チャット ----------
  function addChat(name, text, mine, sys) {
    const ul = $('#chatLog'), li = document.createElement('li');
    li.className = sys ? 'sys' : mine ? 'me' : '';
    li.innerHTML = (sys || mine ? '' : '<b>' + esc(name || '') + '</b>') + esc(text);
    ul.appendChild(li); ul.scrollTop = ul.scrollHeight;
    if (!mine && !sys && $('#paneChat').hidden) A.toast((name || '相手') + ': ' + text.slice(0, 30));
  }
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#chatInput'), text = inp.value.trim();
    if (!text || !R) return;
    send({ t: 'chat', name: R.name, text });
    addChat(R.name, text, true); inp.value = '';
  });

  // ---------- 通信将棋 (好きな時に1手ずつ) ----------
  async function joinAsync() {
    const prof = A.getProfile(), me = { cid: R.cid, name: R.name, krs: prof.krs };
    let st = await N.games.load(R.key);
    if (st && st.over) st = null; // 前の対局は終了済み。新しく始める
    if (!st) {
      st = { gid: 'g' + Date.now().toString(36), startSfen: S.START_SFEN, moves: [], times: [], black: me, white: null, over: null, updated: Date.now() };
      await N.games.save(R.key, st);
    } else if (!st.white && st.black.cid !== R.cid) {
      st.white = me; st.updated = Date.now();
      await N.games.save(R.key, st);
    }
    const color = st.black.cid === R.cid ? 0 : st.white && st.white.cid === R.cid ? 1 : null;
    if (color === null) { A.toast('この部屋はほかの2人が使っています'); leave(); A.goHome(); return; }
    if (R.mail && N.configured) N.notify({ action: 'register', room_hash: R.key, side: color, email: R.mail });
    R.started = true; R.gid = st.gid;
    A.startGame({
      mode: 'room', myColor: color, room: R, names: [st.black.name, st.white ? st.white.name : '(相手待ち)'],
      krs: [st.black.krs, st.white ? st.white.krs : null], tc: { on: false, main: 0, byo: 0 }, tcId: 'none',
    });
    const G = A.G;
    G.game = S.Game.fromMoves(st.moves, st.startSfen); G.times = (st.times || []).slice(); G.legalCache = null;
    G.flip = color === 1;
    A.render();
    addChat(null, st.white ? '通信将棋: 好きな時に1手ずつ指せます。指すと相手に知らせます。' : '通信将棋: 相手が同じ合言葉で入ると始まります。先に指しても大丈夫です。', false, true);
    R.poll = setInterval(pollAsync, 15000);
  }
  function stateNow(over) {
    const G = A.G, st = {
      gid: R.gid, startSfen: G.game.startSfen, moves: G.game.moves.slice(), times: G.times.slice(),
      black: { cid: G.myColor === 0 ? R.cid : (R.peerCid || (R.last && R.last.black.cid)), name: G.names[0], krs: G.krs[0] },
      white: { cid: G.myColor === 1 ? R.cid : (R.peerCid || (R.last && R.last.white && R.last.white.cid)), name: G.names[1], krs: G.krs[1] },
      over: over || null, updated: Date.now(),
    };
    return st;
  }
  async function saveAsync(over) {
    const prev = (await N.games.load(R.key)) || {};
    const G = A.G;
    const st = stateNow(over);
    // 相手の識別子は保存済みの状態から引き継ぐ
    if (prev.black && prev.white) { st.black.cid = prev.black.cid; st.white.cid = prev.white ? prev.white.cid : st.white.cid; }
    R.last = st;
    await N.games.save(R.key, st);
  }
  async function pollAsync() {
    if (!R || !R.async || !A.G || A.G.room !== R) return;
    const st = await N.games.load(R.key);
    if (!st || st.gid !== R.gid) return;
    const G = A.G;
    if (st.white && G.names[1] === '(相手待ち)') { G.names[1] = st.white.name; G.krs[1] = st.white.krs; A.render(); A.toast(st.white.name + ' さんが入室しました'); }
    const have = G.game.moves.length;
    if (st.moves.length > have && !G.over) {
      for (let i = have; i < st.moves.length; i++) A.applyMove(st.moves[i], (st.times && st.times[i]) || 0, false);
    }
    if (st.over && !G.over) A.finish(st.over.result, st.over.reason, { remote: true });
  }
  function notifyMove() {
    const G = A.G;
    if (!N.configured) return;
    const toSide = 1 - G.myColor, last = G.game.texts[G.game.texts.length - 1];
    N.notify({ action: 'moved', room_hash: R.key, to_side: toSide, move_text: last, from_name: R.name, url: inviteLink(R.pass) });
  }

  window.KishoRoom = { join, leave, onLocalMove, onFinish, rematch };
})();
