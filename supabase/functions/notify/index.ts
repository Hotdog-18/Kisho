// KISHO メール通知 (任意)。通信将棋で相手が指したときに、登録されたメールへ知らせます。
// 必要な環境変数: RESEND_API_KEY, NOTIFY_FROM (例: KISHO <noreply@あなたのドメイン>)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡します。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const room = String(body.room_hash || '').slice(0, 64);
    if (!room) return json({ error: 'room_hash required' }, 400);

    if (body.action === 'register') {
      const email = String(body.email || '').trim();
      const side = Number(body.side);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || ![0, 1].includes(side)) return json({ error: 'bad input' }, 400);
      const { error } = await sb.from('kisho_notify').upsert({ room_hash: room, side, email });
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }

    if (body.action === 'moved') {
      const side = Number(body.to_side);
      const { data } = await sb.from('kisho_notify').select('email,last_sent').eq('room_hash', room).eq('side', side).maybeSingle();
      if (!data) return json({ ok: true, skipped: 'no email' });
      // 迷惑メール防止: 同じ宛先には10分に1通まで
      if (data.last_sent && Date.now() - new Date(data.last_sent).getTime() < 10 * 60 * 1000) return json({ ok: true, skipped: 'rate limit' });
      const from = esc(String(body.from_name || '相手').slice(0, 20));
      const move = esc(String(body.move_text || '').slice(0, 20));
      const url = String(body.url || '');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + Deno.env.get('RESEND_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: Deno.env.get('NOTIFY_FROM'), to: [data.email],
          subject: '【KISHO】' + from + ' さんが指しました',
          html: '<p>' + from + ' さんが ' + move + ' と指しました。あなたの番です。</p>' + (url.startsWith('http') ? '<p><a href="' + esc(url) + '">対局を開く</a></p>' : ''),
        }),
      });
      if (!res.ok) return json({ error: 'mail failed' }, 502);
      await sb.from('kisho_notify').update({ last_sent: new Date().toISOString() }).eq('room_hash', room).eq('side', side);
      return json({ ok: true });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
