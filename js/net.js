/*
 * KISHO 通信まわり
 *  - 部屋 (リアルタイム): Supabase Realtime の Broadcast。設定が空なら同じブラウザの別タブ同士 (BroadcastChannel)。
 *  - 通信将棋 (好きな時に1手ずつ): Supabase の kisho_games テーブルに局面を保存。設定が空なら localStorage。
 *  - メール通知: Supabase Edge Function 'notify' (任意)
 */
(function (root) {
  'use strict';
  const cfg = root.KISHO_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  // 接続ライブラリ。新しい形式のキー(sb_publishable_…)に対応した新しい版を先に試し、読めなければ古い版へ切り替える。
  const SUPABASE_JS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  ];
  // 新しい形式のキー(sb_…)は apikey ヘッダーだけで送る。古い形式(JWT)は Authorization にも入れる
  const authHeaders = () => Object.assign({ apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    /^sb_/.test(cfg.supabaseAnonKey || '') ? {} : { Authorization: 'Bearer ' + cfg.supabaseAnonKey });

  async function sha(text) {
    try {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch (e) {
      let h = 5381;
      for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
      return 'x' + (h >>> 0).toString(16);
    }
  }

  function loadOne(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => (root.supabase ? res() : rej(new Error('not defined'))); s.onerror = () => rej(new Error('script load failed'));
      document.head.appendChild(s);
    });
  }
  async function loadScript(srcs) {
    if (root.supabase) return;
    let last;
    for (const src of srcs) { try { await loadOne(src); return; } catch (e) { last = e; } }
    throw last;
  }

  class LocalTransport {
    constructor(key) {
      this.kind = 'local'; this.onmessage = null;
      this.ch = new BroadcastChannel('kisho-' + key);
      this.ch.onmessage = (e) => { if (this.onmessage) this.onmessage(e.data); };
    }
    send(m) { this.ch.postMessage(m); }
    close() { this.ch.close(); }
  }

  class SupabaseTransport {
    constructor(client, key) { this.kind = 'supabase'; this.client = client; this.key = key; this.onmessage = null; this.ch = null; }
    async open() {
      this.ch = this.client.channel('kisho:' + this.key, { config: { broadcast: { self: false } } });
      this.ch.on('broadcast', { event: 'm' }, ({ payload }) => { if (this.onmessage) this.onmessage(payload); });
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 10000);
        this.ch.subscribe((st) => {
          if (st === 'SUBSCRIBED') { clearTimeout(t); res(); }
          else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); rej(new Error(st)); }
        });
      });
    }
    send(m) { this.ch.send({ type: 'broadcast', event: 'm', payload: m }); }
    close() { try { this.client.removeChannel(this.ch); } catch (e) { /* noop */ } }
  }

  // 戻り値: { transport, key, fallback(true: 同じブラウザ内モード) }
  async function connect(passphrase) {
    const key = await sha('kisho:' + passphrase.trim());
    if (configured) {
      try {
        await loadScript(SUPABASE_JS);
        const client = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        const t = new SupabaseTransport(client, key);
        await t.open();
        return { transport: t, key, fallback: false };
      } catch (e) {
        console.warn('Supabase に接続できなかったので同じブラウザ内モードにします', e);
      }
    }
    return { transport: new LocalTransport(key), key, fallback: true };
  }

  // ---- 通信将棋の保存 (supabase/schema.sql の関数を呼ぶ。表に直接は触れない) ----
  const rpc = (name, body) => fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const games = {
    async load(key) {
      if (configured) {
        try {
          const r = await rpc('kisho_get_game', { p_room: key });
          if (r.ok) return await r.json(); // 無ければ null
        } catch (e) { /* 下のローカル保存へ */ }
      }
      try { return JSON.parse(localStorage.getItem('kisho.async.' + key) || 'null'); } catch (e) { return null; }
    },
    async save(key, state) {
      try { localStorage.setItem('kisho.async.' + key, JSON.stringify(state)); } catch (e) { /* noop */ }
      if (configured) {
        try { await rpc('kisho_put_game', { p_room: key, p_state: state }); } catch (e) { console.warn('保存に失敗', e); }
      }
    },
  };

  // ---- メール通知 (Edge Function 'notify') ----
  async function notify(body) {
    if (!configured || !cfg.notifyFunction) return false;
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/notify', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  root.KishoNet = { configured, connect, sha, games, notify, _rpc: rpc };
})(window);
