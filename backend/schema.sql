-- Compile Daily — Neon Postgres schema
-- Run once: psql "$DATABASE_URL" -f schema.sql   (or via `npm run seed`, which also seeds data)

create table if not exists profile (
  id smallint primary key default 1,
  name text not null default 'Moushana Bharadwaj',
  role text not null default 'backend',
  goal_minutes int not null default 60,
  updated_at timestamptz not null default now(),
  constraint profile_singleton check (id = 1)
);
insert into profile (id) values (1) on conflict (id) do nothing;

create table if not exists roadmap_progress (
  task_id text primary key,      -- "{phaseIndex}-{topicIndex}-{taskIndex}"
  completed_date date not null,
  updated_at timestamptz not null default now()
);

create table if not exists daily_progress (
  day date not null,
  task_index int not null,
  primary key (day, task_index)
);

create table if not exists project_progress (
  project_id text not null,
  step_index int not null,
  completed_date date not null,
  primary key (project_id, step_index)
);

create table if not exists activity_log (
  day date primary key,
  count int not null default 0
);

create table if not exists notes (
  id smallint primary key default 1,
  content text not null default '',
  updated_at timestamptz not null default now(),
  constraint notes_singleton check (id = 1)
);
insert into notes (id) values (1) on conflict (id) do nothing;

-- Resource catalogue, seeded from backend/data/java_career_resource_seed.json via
-- import-resources.js. `id` is the catalogue's own stable ID (e.g. "R001") so
-- re-imports upsert cleanly; user-added resources get a synthetic "user-..." id.
create table if not exists resources (
  id text primary key,
  phase_index int,               -- primary module (0-based, module_no[0]-1)
  module_indexes int[],          -- all related modules (0-based), phase_index included
  title text not null,
  provider text,
  resource_type text,
  level text,
  priority text,                  -- P0 | P1 | P2 | P3 (module-agnostic; see modulePriority in the app for track-aware ranking)
  tracks text[],                  -- Shared | Automation | Backend | Advanced
  url text not null,
  access text,
  estimated_time text,
  use_desc text,
  notes text,
  resource_role text,             -- Primary | Supplementary | Practice | Reference | Optional
  topics text[],
  active boolean not null default true,
  last_reviewed date,
  added_by text not null default 'catalogue', -- catalogue | ai | user
  created_at timestamptz not null default now()
);
create index if not exists idx_resources_module_indexes on resources using gin (module_indexes);

create table if not exists assessments (
  id serial primary key,
  phase_index int,
  topic_index int,
  title text not null,
  source text not null default 'planned', -- planned | ai
  questions jsonb not null,               -- [{q, options:[...], answerIndex, explanation}]
  created_at timestamptz not null default now()
);

create table if not exists assessment_attempts (
  id serial primary key,
  assessment_id int references assessments(id) on delete cascade,
  score int not null,
  total int not null,
  answers jsonb,
  taken_at timestamptz not null default now()
);

create table if not exists github_links (
  phase_index int primary key,
  url text not null,
  submitted_at timestamptz not null default now()
);

create table if not exists project_github_links (
  project_id text primary key,
  url text not null,
  submitted_at timestamptz not null default now()
);

create table if not exists doubt_log (
  id serial primary key,
  topic text,
  question text not null,
  answer text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_resources_phase on resources (phase_index);
create index if not exists idx_assessments_phase_topic on assessments (phase_index, topic_index);
