-- Auth: User-Lookup per E-Mail über RPC statt admin.listUsers().
--
-- listUsers({ perPage: 1000 }) bricht ab >1000 Mitgliedern: ein bestehender
-- User jenseits der ersten Seite wird als unbekannt eingestuft → fälschlicher
-- Invite-Code-Fehler beim Re-Login. Diese SECURITY-DEFINER-Funktion schaut
-- direkt in auth.users nach und ist nur für service_role ausführbar (REST/rpc
-- bleibt für anon & authenticated zu — analog zu den Trigger-Funktionen aus
-- Migration #4).

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where email = lower(p_email) limit 1;
$$;

revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
