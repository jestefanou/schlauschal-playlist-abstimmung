-- Selbst-kontrollierte Test-Helfer im `tests`-Schema (kein Fremd-Dependency).
-- Liegt NUR unter supabase/tests/ -> wird nie nach Prod migriert.
--
-- Wird von `supabase test db` (pg_prove) als erste Datei geladen (numerisches
-- 000-Prefix sortiert vor Buchstaben). Erstellt pgTAP + die Helfer dauerhaft
-- (autocommit, KEIN Rollback), damit 010/020 sie nutzen können, und gibt am Ende
-- ein minimales TAP aus, damit pg_prove die Datei nicht als "no plan" ablehnt.

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Legt einen auth.users-Eintrag an. Feuert den on_auth_user_created-Trigger,
-- der automatisch ein public.profiles-Profil erzeugt (Admin-Bootstrap inklusive).
-- `identifier` ist ein Test-Label (in raw_user_meta_data.test_identifier), über
-- das authenticate_as/get_supabase_uid den User wiederfinden.
create or replace function tests.create_supabase_user(
  identifier text,
  email text default null
) returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values (
    uid,
    coalesce(email, identifier || '@test.local'),
    jsonb_build_object('test_identifier', identifier),
    '{}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  );
  return uid;
end;
$$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid
language sql
stable
as $$
  select id
  from auth.users
  where raw_user_meta_data->>'test_identifier' = identifier
  order by created_at desc
  limit 1;
$$;

-- Simuliert "als dieser User eingeloggt": Rolle authenticated + JWT-Claims (sub,
-- role, email), sodass auth.uid()/is_admin()/RLS sich verhalten wie im echten
-- PostgREST-Request. transaktions-lokal (is_local=true) -> gilt bis zum rollback
-- der Test-Datei. reset role zuerst, damit der Rollenwechsel aus jedem Zustand geht.
create or replace function tests.authenticate_as(identifier text)
returns void
language plpgsql
as $$
declare
  uid uuid;
  mail text;
begin
  -- Erst zurück zu session_user (postgres), DANN auth.users lesen: bei einem
  -- Folgeaufruf läuft die Funktion sonst schon als authenticated und darf nicht.
  execute 'reset role';

  select id, email into uid, mail
  from auth.users
  where raw_user_meta_data->>'test_identifier' = identifier
  order by created_at desc
  limit 1;

  if uid is null then
    raise exception 'Test-User % nicht gefunden — erst tests.create_supabase_user aufrufen', identifier;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'email', mail)::text,
    true
  );
  execute 'set role authenticated';
end;
$$;

-- Service-Role (bypassrls) — zum Seeden admin-only Tabellen im Test-Setup.
create or replace function tests.authenticate_as_service_role()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role')::text,
    true
  );
  execute 'set role service_role';
end;
$$;

-- Zurück zu anon/unauthentifiziert.
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set role anon';
end;
$$;

-- Die Helfer müssen auch aufrufbar sein, wenn die Session schon auf eine Test-Rolle
-- umgeschaltet ist (z.B. authenticate_as('bob') nach authenticate_as('alice')).
-- Darum USAGE/EXECUTE auf das (reine Test-)Schema für die Supabase-Rollen.
grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Minimaler TAP-Smoke, damit pg_prove diese Setup-Datei akzeptiert.
set search_path = extensions, tests, public;
select plan(1);
select ok(true, 'Test-Helfer installiert');
select * from finish();
