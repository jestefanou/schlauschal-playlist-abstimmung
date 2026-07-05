-- Schritt 7: Spotify-Owner-OAuth — Speicher für den Refresh-Token (Supabase
-- Vault) + Verbindungs-Status für die Admin-UI (/admin/spotify).
--
-- Entscheidungen (Q7.x, 2026-07-05):
--   - Q7.1: Token kommt über eine admin-gated Route in die App (Authorization-
--     Code-Flow, Callback persistiert serverseitig). Re-Auth = ein Klick.
--   - Q7.2: Refresh-Token liegt im Vault (verschlüsselt at rest), Zugriff nur
--     über die SECURITY-DEFINER-RPCs unten, EXECUTE nur für service_role —
--     dasselbe Muster wie user_id_by_email/rollover_due_cycles. PostgREST
--     exponiert das vault-Schema nicht, daher die Wrapper in public.
--   - Q7.3: Verbindungs-Status (connected/broken + letzter Fehler) liegt in
--     der Singleton-Tabelle spotify_connection; Admins lesen ihn über RLS,
--     geschrieben wird nur mit Service-Role (keine Write-Policies). Das
--     Broken-Markieren beim Refresh-Fail kommt mit dem Push-Job (Schritt 6b).

-- ============================================================================
-- 1. spotify_connection — Singleton-Status der Owner-Verbindung (kein Secret)
-- ============================================================================

create table public.spotify_connection (
  -- Singleton: Primary Key ist konstant true -> es kann nur eine Row geben.
  id boolean primary key default true constraint spotify_connection_singleton check (id),
  status text not null check (status in ('connected', 'broken')),
  spotify_user_id text not null,
  spotify_display_name text,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_error text,
  last_error_at timestamptz
);

alter table public.spotify_connection enable row level security;

create policy "spotify_connection_select_admin"
  on public.spotify_connection for select
  to authenticated
  using (public.is_admin());

-- Sichtbarkeits-Härtung analog db_lints: anon hat hier nichts zu suchen;
-- authenticated behält SELECT (RLS lässt nur Admins durch), Writes laufen
-- ausschließlich über den Service-Role-Client.
revoke all on public.spotify_connection from anon;
revoke insert, update, delete on public.spotify_connection from authenticated;

-- ============================================================================
-- 2. Vault-Wrapper für den Refresh-Token (nur service_role)
-- ============================================================================

create or replace function public.set_spotify_refresh_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'refresh token must not be empty';
  end if;

  select id into v_id
  from vault.secrets
  where name = 'spotify_owner_refresh_token';

  if v_id is null then
    perform vault.create_secret(
      p_token,
      'spotify_owner_refresh_token',
      'Spotify-Owner OAuth Refresh-Token (Schritt 7)'
    );
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

create or replace function public.get_spotify_refresh_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'spotify_owner_refresh_token';
$$;

revoke execute on function public.set_spotify_refresh_token(text) from public, anon, authenticated;
revoke execute on function public.get_spotify_refresh_token() from public, anon, authenticated;
grant execute on function public.set_spotify_refresh_token(text) to service_role;
grant execute on function public.get_spotify_refresh_token() to service_role;
