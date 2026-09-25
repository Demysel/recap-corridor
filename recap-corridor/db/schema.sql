-- Récap Corridor — schéma Postgres (Supabase)
-- À exécuter une fois, en tant que « postgres », dans l'éditeur SQL de Supabase.
-- Remplacez MOT_DE_PASSE par un mot de passe long et aléatoire.

create role recap_app with login password 'MOT_DE_PASSE' noinherit;
grant recap_app to postgres;
create schema if not exists recap authorization recap_app;

set role recap_app;
create table if not exists recap.semaines (
  week_id text primary key,               -- ex. 2026-S39
  resume  jsonb not null,                 -- métadonnées de la semaine et du fichier importé
  maj     timestamptz not null default now()
);
create table if not exists recap.details (
  week_id     text not null references recap.semaines(week_id) on delete cascade,
  agence_slug text not null,
  data        jsonb not null,             -- lecture brute des lignes de l'agence
  primary key (week_id, agence_slug)
);
create table if not exists recap.config (
  cle    text primary key,                -- 'regles'
  valeur jsonb not null,
  maj    timestamptz not null default now()
);
-- Aucune politique : les rôles de l'API Supabase (anon, authenticated) n'ont aucun accès.
-- Seul recap_app, propriétaire des tables, lit et écrit (via le serveur Render).
alter table recap.semaines enable row level security;
alter table recap.details  enable row level security;
alter table recap.config   enable row level security;
reset role;
revoke all on schema recap from public, anon, authenticated;

-- Chaîne de connexion à mettre dans DATABASE_URL (pooler Supavisor, mode session) :
-- postgresql://recap_app.<ref-projet>:MOT_DE_PASSE@aws-0-<region>.pooler.supabase.com:5432/postgres
