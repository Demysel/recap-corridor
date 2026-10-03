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

-- ---------------------------------------------------------------------------
-- Site de test : même base, schéma distinct « recap_dev » (copie de « recap » au départ).
-- Le service Render de test utilise DB_SCHEMA=recap_dev ; le site principal reste sur « recap ».
-- create schema if not exists recap_dev authorization recap_app;
-- set role recap_app;
-- create table recap_dev.semaines (like recap.semaines including all);
-- create table recap_dev.details  (like recap.details  including all);
-- create table recap_dev.config   (like recap.config   including all);
-- alter table recap_dev.details add foreign key (week_id) references recap_dev.semaines(week_id) on delete cascade;
-- insert into recap_dev.semaines select * from recap.semaines;
-- insert into recap_dev.details  select * from recap.details;
-- insert into recap_dev.config   select * from recap.config;
-- alter table recap_dev.semaines enable row level security;
-- alter table recap_dev.details  enable row level security;
-- alter table recap_dev.config   enable row level security;
-- reset role;
-- revoke all on schema recap_dev from public, anon, authenticated;
-- Rôle dédié (aucun droit sur « recap ») : create role recap_dev_app with login password '…' noinherit;
-- grant recap_dev_app to postgres; alter schema recap_dev owner to recap_dev_app; puis alter table … owner to recap_dev_app;
-- DATABASE_URL du site de test : postgresql://recap_dev_app.<ref-projet>:…@aws-1-<region>.pooler.supabase.com:5432/postgres

-- ---------------------------------------------------------------------------
-- Comptes e-mail + mot de passe (créées aussi automatiquement par le serveur au premier appel).
-- Mots de passe : empreinte scrypt seulement ; sessions et liens de réinitialisation : empreinte SHA-256 du jeton.
-- Aucun e-mail ni mot de passe dans ce fichier : le premier administrateur est ajouté à la main dans Supabase
-- (empreinte calculée hors du dépôt), les suivants depuis Administration → Utilisateurs.
-- Remplacer « recap » par « recap_dev » (et recap_app par recap_dev_app) pour le site de test.
-- set role recap_app;
-- create table if not exists recap.utilisateurs (email text primary key, nom text not null default '', hash text not null,
--   droits jsonb not null default '{}'::jsonb,          -- {vitrine, coco, lecture, modif, admin}
--   valide boolean not null default false, cree timestamptz not null default now(), maj timestamptz not null default now(), derniere timestamptz);
-- create table if not exists recap.sessions (jeton text primary key,
--   email text not null references recap.utilisateurs(email) on delete cascade on update cascade, expire timestamptz not null);
-- create table if not exists recap.jetons_mdp (jeton text primary key,
--   email text not null references recap.utilisateurs(email) on delete cascade on update cascade, expire timestamptz not null);
-- alter table recap.utilisateurs add column if not exists demande timestamptz;
-- alter table recap.utilisateurs add column if not exists agent jsonb;   -- agent rattaché ({pk, nom}) pour le récap de la semaine
-- alter table recap.utilisateurs add column if not exists cal text;     -- empreinte du jeton du lien d'abonnement à l'agenda (/cal/<jeton>.ics)
-- alter table recap.utilisateurs enable row level security;
-- alter table recap.sessions     enable row level security;
-- alter table recap.jetons_mdp   enable row level security;
-- reset role;
