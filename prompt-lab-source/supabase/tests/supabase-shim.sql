-- Stand-ins for what every Supabase project already has, so the migration
-- runs in local Postgres: the API roles, and Supabase's default privileges,
-- which grant everything in public to anon, authenticated and service_role.
-- (The migration must revoke what it does not want.)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
