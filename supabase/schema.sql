-- KISHO 用の Supabase 設定。SQL Editor に貼って Run してください。
-- 表には直接さわれないようにして (RLS 有効・ポリシーなし)、下の2つの関数だけを公開します。
-- 合言葉そのものは保存せず、そのハッシュ(room_hash)だけを使います。

create table if not exists public.kisho_games (
  room_hash  text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kisho_games enable row level security;

create or replace function public.kisho_get_game(p_room text)
returns jsonb language sql security definer set search_path = public as $$
  select state from public.kisho_games where room_hash = p_room
$$;

create or replace function public.kisho_put_game(p_room text, p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_room) > 64 or length(p_state::text) > 200000 then
    raise exception 'too large';
  end if;
  insert into public.kisho_games (room_hash, state, updated_at)
  values (p_room, p_state, now())
  on conflict (room_hash) do update set state = excluded.state, updated_at = now();
end
$$;

revoke all on function public.kisho_get_game(text) from public;
revoke all on function public.kisho_put_game(text, jsonb) from public;
grant execute on function public.kisho_get_game(text) to anon;
grant execute on function public.kisho_put_game(text, jsonb) to anon;

-- メール通知用 (任意)。メールアドレスは Edge Function だけが読めます (anon からは見えません)。
create table if not exists public.kisho_notify (
  room_hash text not null,
  side      int  not null,
  email     text not null,
  last_sent timestamptz,
  primary key (room_hash, side)
);
alter table public.kisho_notify enable row level security;
