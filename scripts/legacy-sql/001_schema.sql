-- ============================================================
-- 001_schema.sql
-- Run this first in the Supabase SQL Editor.
-- Creates all tables, enables RLS, and adds public-read policies.
-- ============================================================

-- ─────────────────────────────────────────────
-- COURSES  (global dictionary — one row per course)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id           TEXT PRIMARY KEY,          -- 'CS-1110', 'MATH-1910'
  subject      TEXT NOT NULL,             -- 'CS', 'MATH'
  number       TEXT NOT NULL,             -- '1110', '1910'
  title        TEXT NOT NULL,
  credits_min  INT  NOT NULL DEFAULT 3,
  credits_max  INT  NOT NULL DEFAULT 3,   -- same as min when fixed
  description  TEXT,
  offered      TEXT[]        DEFAULT '{}', -- e.g. ARRAY['FA','SP']
  prereq_expr  JSONB,                     -- parsed prerequisite tree
  coreq_expr   JSONB,                     -- corequisite tree
  roster_id    TEXT,                      -- Cornell crseId, for future API sync
  updated_at   TIMESTAMPTZ  DEFAULT now()
);

-- ─────────────────────────────────────────────
-- COURSE ALIASES  (cross-listed courses)
-- e.g. ENGRD-2110 → CS-2110
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_aliases (
  alias_id      TEXT PRIMARY KEY,         -- 'ENGRD-2110'
  canonical_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- PROGRAMS  (majors)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
  id                TEXT PRIMARY KEY,     -- 'cornell-cs-bs-2026'
  name              TEXT NOT NULL,        -- 'Computer Science, B.S.'
  short_name        TEXT NOT NULL,        -- 'CS'
  college           TEXT NOT NULL,
  catalog_year      INT  NOT NULL,
  total_credits     INT,
  affiliation_text  TEXT,                 -- GPA/grade requirement paragraph, display only
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- ELECTIVE GROUPS
-- A named category of courses that can fill an elective slot.
-- program_id = NULL means the group is global (e.g. liberal-studies).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elective_groups (
  id               TEXT PRIMARY KEY,      -- 'cs-major-elective', 'liberal-studies'
  program_id       TEXT REFERENCES programs(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,         -- 'CS Major Elective'
  description      TEXT,
  qualifying_rule  JSONB NOT NULL,
  -- rule shapes:
  --   { "type": "level",    "subject": "CS", "min_number": 4000 }
  --   { "type": "category", "category": "liberal-studies" }
  --   { "type": "outside",  "exclude_subjects": ["CS","ECE"] }
  --   { "type": "list" }   <- courses stored in elective_qualifications
  --   { "type": "open" }   <- advisor-approved, anything goes
  min_credits      INT  DEFAULT 3,
  advisor_approval BOOLEAN DEFAULT false,
  notes            TEXT                   -- e.g. 'Requires advisor approval'
);

-- ─────────────────────────────────────────────
-- ELECTIVE QUALIFICATIONS
-- Which courses satisfy a given elective group (when rule type = 'list').
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elective_qualifications (
  group_id   TEXT NOT NULL REFERENCES elective_groups(id) ON DELETE CASCADE,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, course_id)
);

-- ─────────────────────────────────────────────
-- PROGRAM SLOTS  (nodes on the flowchart)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_slots (
  id                 TEXT PRIMARY KEY,    -- 'cs-s1-math1910'
  program_id         TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,       -- 'course' | 'pattern' | 'elective'
  -- for kind = 'course':
  course_id          TEXT REFERENCES courses(id),
  -- for kind = 'pattern' (e.g. CS 111x, ENGRI 1xxx):
  pattern            TEXT,               -- 'CS-111x'
  pattern_title      TEXT,               -- 'Intro Programming'
  -- for kind = 'elective':
  elective_group_id  TEXT REFERENCES elective_groups(id),
  -- placement in the flowchart grid
  suggested_semester INT  NOT NULL,       -- 1–8
  slot_row           INT  NOT NULL DEFAULT 0, -- vertical order within a semester column
  CONSTRAINT kind_check CHECK (kind IN ('course', 'pattern', 'elective')),
  CONSTRAINT course_slot_has_id   CHECK (kind != 'course'   OR course_id IS NOT NULL),
  CONSTRAINT pattern_slot_has_pat CHECK (kind != 'pattern'  OR pattern   IS NOT NULL),
  CONSTRAINT elective_slot_has_grp CHECK (kind != 'elective' OR elective_group_id IS NOT NULL)
);

-- ─────────────────────────────────────────────
-- SLOT EDGES  (prerequisite arrows on the flowchart)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slot_edges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  from_slot   TEXT NOT NULL REFERENCES program_slots(id) ON DELETE CASCADE,
  to_slot     TEXT NOT NULL REFERENCES program_slots(id) ON DELETE CASCADE,
  edge_type   TEXT NOT NULL DEFAULT 'prereq',
  -- 'prereq' | 'coreq' | 'concurrent'
  CONSTRAINT edge_type_check CHECK (edge_type IN ('prereq', 'coreq', 'concurrent'))
);

-- ─────────────────────────────────────────────
-- FUTURE: USER ACCOUNT TABLES (planned, not built yet)
-- These will be added when we implement Supabase Auth.
--
-- CREATE TABLE user_plans (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
--   program_id  TEXT REFERENCES programs(id),
--   name        TEXT NOT NULL DEFAULT 'My Plan',
--   created_at  TIMESTAMPTZ DEFAULT now()
-- );
--
-- CREATE TABLE user_plan_courses (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   plan_id     UUID REFERENCES user_plans(id) ON DELETE CASCADE,
--   course_id   TEXT REFERENCES courses(id),
--   slot_id     TEXT REFERENCES program_slots(id),  -- null = free-placed
--   semester    INT NOT NULL,
--   status      TEXT DEFAULT 'planned'
--   -- 'planned' | 'completed' | 'waived'
-- );
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- All program/course data is public-read.
-- No writes are permitted from the client (data is seeded via migrations).
-- ─────────────────────────────────────────────
ALTER TABLE courses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_aliases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE elective_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE elective_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_slots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_edges              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read courses"     ON courses                 FOR SELECT USING (true);
CREATE POLICY "public read aliases"     ON course_aliases          FOR SELECT USING (true);
CREATE POLICY "public read programs"    ON programs                FOR SELECT USING (true);
CREATE POLICY "public read elec groups" ON elective_groups        FOR SELECT USING (true);
CREATE POLICY "public read elec quals"  ON elective_qualifications FOR SELECT USING (true);
CREATE POLICY "public read slots"       ON program_slots           FOR SELECT USING (true);
CREATE POLICY "public read edges"       ON slot_edges              FOR SELECT USING (true);

-- ─────────────────────────────────────────────
-- INDEXES  (for query performance)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_slots_program    ON program_slots(program_id);
CREATE INDEX IF NOT EXISTS idx_slots_course     ON program_slots(course_id);
CREATE INDEX IF NOT EXISTS idx_edges_program    ON slot_edges(program_id);
CREATE INDEX IF NOT EXISTS idx_edges_from       ON slot_edges(from_slot);
CREATE INDEX IF NOT EXISTS idx_edges_to         ON slot_edges(to_slot);
CREATE INDEX IF NOT EXISTS idx_elec_quals_group ON elective_qualifications(group_id);
CREATE INDEX IF NOT EXISTS idx_aliases_canonical ON course_aliases(canonical_id);
