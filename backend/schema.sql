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

-- ---- Shared learning-event / XP foundation (Compile Daily Product Spec, Phase 1-3) ----
-- Every meaningful learner action is recorded here first. event_id is a client- or
-- server-generated stable string so the same action replayed (e.g. an offline retry,
-- or a re-toggled checkbox) never gets recorded twice.
create table if not exists learning_events (
  event_id text primary key,
  event_type text not null,
  event_timestamp timestamptz not null default now(),
  source_type text,
  source_id text,
  module_index int,
  topic_index int,
  task_id text,
  duration_minutes int,
  score int,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Singleton row holding the learner's total XP and derived level, following the same
-- pattern as `profile`/`notes` above.
create table if not exists user_progression (
  id smallint primary key default 1,
  total_xp int not null default 0,
  current_level int not null default 1,
  current_level_xp int not null default 0,
  updated_at timestamptz not null default now(),
  constraint user_progression_singleton check (id = 1)
);
insert into user_progression (id) values (1) on conflict (id) do nothing;

-- Append-only XP ledger. `event_id` is unique so `on conflict (event_id) do nothing`
-- in xpService.js is the single choke point that prevents duplicate/gamed XP awards.
create table if not exists xp_transactions (
  id serial primary key,
  event_id text not null unique,
  event_type text not null,
  source_type text,
  source_id text,
  xp_amount int not null,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Focus Timer sessions. `id` is a client-generated id (not serial) so a session
-- started offline can be completed later using the same id even if the initial
-- "create" call never reached the server.
create table if not exists focus_sessions (
  id text primary key,
  source_type text,
  source_id text,
  module_index int,
  topic_index int,
  title text,
  intention text,
  planned_minutes int not null,
  completed_minutes int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paused_at timestamptz,
  pause_seconds int not null default 0,
  status text not null default 'running', -- idle | running | paused | completed | abandoned | interrupted
  difficulty_rating text,
  reflection text,
  xp_awarded int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_focus_sessions_status on focus_sessions (status);
