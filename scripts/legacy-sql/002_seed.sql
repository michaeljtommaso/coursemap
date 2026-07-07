-- ============================================================
-- 002_seed.sql
-- Run this AFTER 001_schema.sql in the Supabase SQL Editor.
-- Seeds courses, programs, elective groups, slots, and edges
-- for CS, ECE, ME, and ORE (2026 catalog year).
--
-- NOTE: Course prereqs are approximations from the flowcharts.
-- Titles/credits are accurate to Cornell's public curriculum.
-- Update with real data when a Cornell API key is available.
-- ============================================================


-- ============================================================
-- 1. COURSES  (global dictionary — no duplicates)
-- ============================================================

INSERT INTO courses (id, subject, number, title, credits_min, credits_max, offered, prereq_expr, coreq_expr) VALUES

-- ── MATHEMATICS ─────────────────────────────────────────────
('MATH-1910', 'MATH', '1910', 'Calculus for Engineers', 4, 4,
  ARRAY['FA','SP'], NULL, NULL),

('MATH-1920', 'MATH', '1920', 'Multivariable Calculus for Engineers', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1910"}'::jsonb, NULL),

('MATH-2930', 'MATH', '2930', 'Differential Equations for Engineers', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1920"}'::jsonb, NULL),

('MATH-2940', 'MATH', '2940', 'Linear Algebra for Engineers', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1920"}'::jsonb, NULL),

('MATH-3040', 'MATH', '3040', 'Prove It: Logic and Proof in Mathematics', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1920"}'::jsonb, NULL),

-- ── PHYSICS ─────────────────────────────────────────────────
('PHYS-1110', 'PHYS', '1110', 'Introduction to Experimental Physics', 1, 1,
  ARRAY['FA','SP'], NULL,
  '{"type":"course","id":"PHYS-1112"}'::jsonb),

('PHYS-1112', 'PHYS', '1112', 'Physics I: Mechanics and Heat', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1910"}'::jsonb,
  '{"type":"course","id":"MATH-1920"}'::jsonb),

('PHYS-2213', 'PHYS', '2213', 'Physics II: Electromagnetism', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"PHYS-1112"},{"type":"course","id":"MATH-1920"}]}'::jsonb,
  NULL),

('PHYS-2214', 'PHYS', '2214', 'Physics III: Oscillations, Waves, and Quantum Physics', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"PHYS-2213"}'::jsonb, NULL),

('PHYS-3360', 'PHYS', '3360', 'Modern Physics', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"PHYS-2214"}'::jsonb, NULL),

-- ── CHEMISTRY ───────────────────────────────────────────────
('CHEM-2090', 'CHEM', '2090', 'General Chemistry', 3, 3,
  ARRAY['FA','SP'], NULL, NULL),

('CHEM-2091', 'CHEM', '2091', 'General Chemistry Laboratory', 1, 1,
  ARRAY['FA','SP'], NULL,
  '{"type":"course","id":"CHEM-2090"}'::jsonb),

('CHEM-2080', 'CHEM', '2080', 'Organic Chemistry I', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"course","id":"CHEM-2090"}'::jsonb, NULL),

('CHEM-2081', 'CHEM', '2081', 'Organic Chemistry I Laboratory', 1, 1,
  ARRAY['FA','SP'], NULL,
  '{"type":"course","id":"CHEM-2080"}'::jsonb),

-- ── COMPUTER SCIENCE ─────────────────────────────────────────
('CS-1110', 'CS', '1110', 'Introduction to Computing Using Python', 4, 4,
  ARRAY['FA','SP'], NULL, NULL),

('CS-1112', 'CS', '1112', 'Introduction to Computing Using MATLAB', 4, 4,
  ARRAY['FA'], NULL, NULL),

('CS-2110', 'CS', '2110', 'Object-Oriented Programming and Data Structures', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"pattern","pattern":"CS-111x"}'::jsonb, NULL),

('CS-2800', 'CS', '2800', 'Discrete Structures', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"pattern","pattern":"CS-111x"}'::jsonb, NULL),

('CS-3110', 'CS', '3110', 'Data Structures and Functional Programming', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"CS-2110"}'::jsonb, NULL),

('CS-3410', 'CS', '3410', 'Computer System Organization and Programming', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"CS-2110"},{"type":"course","id":"CS-2800"}]}'::jsonb,
  NULL),

('CS-3420', 'CS', '3420', 'Embedded Systems', 4, 4,
  ARRAY['SP'],
  '{"type":"course","id":"CS-3410"}'::jsonb, NULL),

('CS-3700', 'CS', '3700', 'Networks and Distributed Systems', 4, 4,
  ARRAY['FA'],
  '{"type":"and","children":[{"type":"course","id":"CS-3110"},{"type":"course","id":"CS-2800"}]}'::jsonb,
  NULL),

('CS-3780', 'CS', '3780', 'Introduction to Machine Learning', 4, 4,
  ARRAY['SP'],
  '{"type":"and","children":[{"type":"course","id":"CS-2110"},{"type":"course","id":"MATH-2940"}]}'::jsonb,
  NULL),

('CS-4820', 'CS', '4820', 'Introduction to Analysis of Algorithms', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"CS-3110"},{"type":"course","id":"CS-2800"},{"type":"course","id":"MATH-2940"}]}'::jsonb,
  NULL),

('CS-4410', 'CS', '4410', 'Operating Systems', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"or","children":[{"type":"course","id":"CS-3410"},{"type":"course","id":"CS-3420"}]}'::jsonb,
  NULL),

('CS-4414', 'CS', '4414', 'Systems Programming', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"or","children":[{"type":"course","id":"CS-3410"},{"type":"course","id":"CS-3420"}]}'::jsonb,
  NULL),

-- ── ENGINEERING COMMON ────────────────────────────────────────
('ENGRD-2700', 'ENGRD', '2700', 'Engineering Probability and Statistics I', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1920"}'::jsonb, NULL),

('ENGRD-2020', 'ENGRD', '2020', 'Statics and Mechanics of Solids', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"PHYS-1112"},{"type":"course","id":"MATH-1920"}]}'::jsonb,
  NULL),

('ENGRD-2210', 'ENGRD', '2210', 'Thermodynamics', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"CHEM-2090"},{"type":"course","id":"MATH-2930"}]}'::jsonb,
  NULL),

-- ── ECE ──────────────────────────────────────────────────────
('ECE-2100', 'ECE', '2100', 'Introduction to Circuits for Electrical and Computer Engineers', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"PHYS-1112"},{"type":"course","id":"MATH-1920"}]}'::jsonb,
  NULL),

('ECE-2300', 'ECE', '2300', 'Introduction to Semiconductor Devices', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"ECE-2100"},{"type":"course","id":"PHYS-2213"}]}'::jsonb,
  NULL),

('ECE-2720', 'ECE', '2720', 'Digital Logic and Computer Organization', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"pattern","pattern":"CS-111x"},{"type":"course","id":"PHYS-1112"}]}'::jsonb,
  NULL),

('ECE-3100', 'ECE', '3100', 'Introduction to Probability and Inference for Random Signals and Systems', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MATH-2930"},{"type":"course","id":"ECE-2100"}]}'::jsonb,
  NULL),

('ECE-3140', 'ECE', '3140', 'Embedded Systems', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"CS-2110"},{"type":"course","id":"ECE-2720"}]}'::jsonb,
  NULL),

-- ── MAE ──────────────────────────────────────────────────────
('MAE-2030', 'MAE', '2030', 'Dynamics', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"ENGRD-2020"},{"type":"course","id":"MATH-2930"}]}'::jsonb,
  NULL),

('MAE-2250', 'MAE', '2250', 'Mechanical Synthesis', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"course","id":"ENGRD-2020"}'::jsonb, NULL),

('MAE-3230', 'MAE', '3230', 'Introductory Fluid Mechanics', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MAE-2030"},{"type":"course","id":"MATH-2940"}]}'::jsonb,
  NULL),

('MAE-3240', 'MAE', '3240', 'Dynamics of Systems', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MAE-2030"},{"type":"course","id":"ENGRD-2210"}]}'::jsonb,
  NULL),

('MAE-3260', 'MAE', '3260', 'Material Science and Engineering for Engineers', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"CHEM-2090"},{"type":"course","id":"PHYS-1112"}]}'::jsonb,
  NULL),

('MAE-3270', 'MAE', '3270', 'Thermodynamics of Materials and Devices', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"ENGRD-2210"},{"type":"course","id":"MATH-2940"}]}'::jsonb,
  NULL),

('MAE-3780', 'MAE', '3780', 'Mechatronics', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"course","id":"ECE-2100"}'::jsonb, NULL),

('MAE-4272', 'MAE', '4272', 'Experimental Design in Mechanical and Aerospace Engineering', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MAE-3230"},{"type":"course","id":"MAE-3240"}]}'::jsonb,
  NULL),

('MAE-4300', 'MAE', '4300', 'Numerical Methods for Engineering Applications', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MATH-2940"},{"type":"course","id":"MAE-3230"}]}'::jsonb,
  NULL),

-- ── ORIE ─────────────────────────────────────────────────────
('ORIE-3120', 'ORIE', '3120', 'Probability Theory and Statistics in Engineering', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"and","children":[{"type":"course","id":"MATH-1920"},{"type":"course","id":"ENGRD-2700"}]}'::jsonb,
  NULL),

('ORIE-3150', 'ORIE', '3150', 'Financial and Managerial Accounting', 3, 3,
  ARRAY['FA','SP'],
  '{"type":"course","id":"MATH-1920"}'::jsonb, NULL),

('ORIE-3300', 'ORIE', '3300', 'Optimization I', 3, 3,
  ARRAY['FA'],
  '{"type":"course","id":"MATH-2940"}'::jsonb, NULL),

('ORIE-3310', 'ORIE', '3310', 'Optimization II', 3, 3,
  ARRAY['SP'],
  '{"type":"course","id":"ORIE-3300"}'::jsonb, NULL),

('ORIE-3500', 'ORIE', '3500', 'Engineering Probability and Statistics II', 4, 4,
  ARRAY['FA','SP'],
  '{"type":"course","id":"ENGRD-2700"}'::jsonb, NULL),

('ORIE-3510', 'ORIE', '3510', 'Stochastic Processes', 4, 4,
  ARRAY['SP'],
  '{"type":"course","id":"ORIE-3500"}'::jsonb, NULL),

('ORIE-4580', 'ORIE', '4580', 'Models and Systems Integration', 3, 3,
  ARRAY['FA'],
  '{"type":"and","children":[{"type":"course","id":"ORIE-3300"},{"type":"course","id":"ORIE-3500"}]}'::jsonb,
  NULL)

ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 2. COURSE ALIASES  (cross-listed courses)
-- ============================================================

INSERT INTO course_aliases (alias_id, canonical_id) VALUES
('ENGRD-2110', 'CS-2110'),
('ENGRD-2100', 'ECE-2100'),
('ENGRD-2300', 'ECE-2300'),
('ENGRD-2720', 'ECE-2720')
ON CONFLICT (alias_id) DO NOTHING;


-- ============================================================
-- 3. PROGRAMS
-- ============================================================

INSERT INTO programs (id, name, short_name, college, catalog_year, affiliation_text) VALUES
('cornell-cs-bs-2026',  'Computer Science, B.S.',              'CS',  'College of Engineering', 2026,
  'At least C (not C–) in all completed CS courses and critical math courses. GPA ≥2.5 in CS/ENGRD 2110/2112 and CS 2800/2802. A required supplemental application must be submitted with the College of Engineering Major Affiliation application.'),
('cornell-ece-bs-2026', 'Electrical and Computer Engineering, B.S.', 'ECE', 'College of Engineering', 2026,
  'At least C+ in MATH 2930 or MATH 2940, PHYS 2213, and one of ECE/ENGRD 2100, ECE/ENGRD 2720, or ECE/ENGRD 2300. GPA ≥2.5 in listed core courses if completed.'),
('cornell-me-bs-2026',  'Mechanical Engineering, B.S.',        'ME',  'College of Engineering', 2026,
  'At least C– in ENGRD 2020, ENGRD 2210 (if taken), and all completed required math, chemistry, physics, and CS courses. GPA ≥2.5 in MATH 2930, PHYS 2213, ENGRD 2020, and ENGRD 2210.'),
('cornell-ore-bs-2026', 'Operations Research and Engineering, B.S.', 'ORE', 'College of Engineering', 2026,
  'At least C in ENGRD 2700 and MATH 2940. GPA ≥2.2 in required math, science, engineering, and CS courses.')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 4. ELECTIVE GROUPS
-- ============================================================

INSERT INTO elective_groups (id, program_id, name, description, qualifying_rule, min_credits, advisor_approval, notes) VALUES

-- Global
('liberal-studies',       NULL, 'Liberal Studies',
  'Courses from approved liberal arts and humanities distribution list.',
  '{"type":"category","category":"liberal-studies"}'::jsonb, 3, false,
  'Any approved liberal studies course outside engineering.'),

('advisor-elective-open', NULL, 'Advisor-Approved Elective',
  'Any course approved by your faculty advisor.',
  '{"type":"open"}'::jsonb, 3, true,
  'Requires advisor approval before registering.'),

-- CS groups
('cs-engrd-dist',  'cornell-cs-bs-2026',  'Engineering Distribution (ENGRD 2xxx)',
  'Any ENGRD 2000-level course.',
  '{"type":"level","subject":"ENGRD","min_number":2000,"max_number":2999}'::jsonb, 3, false, NULL),

('cs-major-elective', 'cornell-cs-bs-2026', 'CS Major Elective',
  'CS courses at the 4000-level or above, or approved technical courses.',
  '{"type":"level","subject":"CS","min_number":4000}'::jsonb, 3, false, NULL),

('cs-networks-choice', 'cornell-cs-bs-2026', 'Networks / Systems Choice',
  'CS 3700 or CS 3780.',
  '{"type":"list"}'::jsonb, 4, false, NULL),

('cs-systems-choice', 'cornell-cs-bs-2026', 'Systems Programming Choice',
  'CS 3410, CS 3420, or ECE 3140.',
  '{"type":"list"}'::jsonb, 4, false, NULL),

('cs-os-choice', 'cornell-cs-bs-2026', 'Operating Systems Choice',
  'CS 4410 or CS 4414.',
  '{"type":"list"}'::jsonb, 4, false, NULL),

-- ECE groups
('ece-engrd-dist', 'cornell-ece-bs-2026', 'Engineering Distribution (ENGRD 2xxx)',
  'Any ENGRD 2000-level course.',
  '{"type":"level","subject":"ENGRD","min_number":2000,"max_number":2999}'::jsonb, 3, false, NULL),

('ece-foundation', 'cornell-ece-bs-2026', 'ECE Foundation',
  'Core ECE foundation courses (specific list defined by program).',
  '{"type":"list"}'::jsonb, 4, false, NULL),

('ece-elective', 'cornell-ece-bs-2026', 'ECE Elective',
  'ECE courses at 4000-level or approved 3000-level.',
  '{"type":"level","subject":"ECE","min_number":3000}'::jsonb, 3, false, NULL),

('ece-outside-tech', 'cornell-ece-bs-2026', 'Outside Technical Elective',
  'Engineering or science courses outside ECE.',
  '{"type":"outside","exclude_subjects":["ECE","ENGRD"]}'::jsonb, 3, false, NULL),

-- ME groups
('me-tech-elective',  'cornell-me-bs-2026', 'Technical Elective',
  'Engineering technical elective approved by advisor.',
  '{"type":"open"}'::jsonb, 3, true, 'Requires advisor approval.'),

('me-math-elective',  'cornell-me-bs-2026', 'Math Elective',
  'MATH 3000-level or higher, or approved quantitative course.',
  '{"type":"level","subject":"MATH","min_number":3000}'::jsonb, 3, false, NULL),

('me-major-elective', 'cornell-me-bs-2026', 'Major Approved Elective',
  'MAE 4000-level courses or approved equivalents.',
  '{"type":"level","subject":"MAE","min_number":4000}'::jsonb, 3, false, NULL),

('me-sem6-systems',   'cornell-me-bs-2026', 'Systems / Electronics Choice',
  'MAE 3780, ECE 2100, or PHYS 3360.',
  '{"type":"list"}'::jsonb, 3, false, NULL),

('me-mae4xx1',        'cornell-me-bs-2026', 'MAE Senior Design / Thesis',
  'Any MAE 4x01 senior design or thesis course.',
  '{"type":"list"}'::jsonb, 3, false, NULL),

-- ORE groups
('ore-math-choice',   'cornell-ore-bs-2026', 'Math / Structures Choice',
  'MATH 2930, MATH 3040, or CS 2800.',
  '{"type":"list"}'::jsonb, 4, false, NULL),

('ore-orie-elective', 'cornell-ore-bs-2026', 'ORIE Elective',
  'ORIE 4000-level courses.',
  '{"type":"level","subject":"ORIE","min_number":4000}'::jsonb, 3, false, NULL),

('ore-major-elective','cornell-ore-bs-2026', 'Major Approved Elective',
  'Approved upper-level technical courses for ORIE.',
  '{"type":"open"}'::jsonb, 3, true, 'Check approved elective list with advisor.')

ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 5. ELECTIVE QUALIFICATIONS  (explicit course lists for 'list' rule groups)
-- ============================================================

-- CS: Networks/Systems choice → CS 3700 or CS 3780
INSERT INTO elective_qualifications (group_id, course_id) VALUES
('cs-networks-choice', 'CS-3700'),
('cs-networks-choice', 'CS-3780'),
-- CS: Systems programming → CS 3410, CS 3420, ECE 3140
('cs-systems-choice',  'CS-3410'),
('cs-systems-choice',  'CS-3420'),
('cs-systems-choice',  'ECE-3140'),
-- CS: OS choice → CS 4410 or CS 4414
('cs-os-choice',       'CS-4410'),
('cs-os-choice',       'CS-4414'),
-- ME: sem6 systems choice → MAE 3780, ECE 2100, PHYS 3360
('me-sem6-systems',    'MAE-3780'),
('me-sem6-systems',    'ECE-2100'),
('me-sem6-systems',    'PHYS-3360'),
-- ORE: math/structures choice → MATH 2930, MATH 3040, CS 2800
('ore-math-choice',    'MATH-2930'),
('ore-math-choice',    'MATH-3040'),
('ore-math-choice',    'CS-2800')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 6. PROGRAM SLOTS  (flowchart nodes)
-- Format: (id, program_id, kind, course_id, pattern, pattern_title,
--          elective_group_id, suggested_semester, slot_row)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- CS SLOTS
-- ────────────────────────────────────────────────────────────
INSERT INTO program_slots (id, program_id, kind, course_id, pattern, pattern_title, elective_group_id, suggested_semester, slot_row) VALUES
-- Semester 1
('cs-s1-math1910',  'cornell-cs-bs-2026', 'course',   'MATH-1910', NULL, NULL, NULL, 1, 0),
('cs-s1-chem2090',  'cornell-cs-bs-2026', 'course',   'CHEM-2090', NULL, NULL, NULL, 1, 1),
('cs-s1-chem2091',  'cornell-cs-bs-2026', 'course',   'CHEM-2091', NULL, NULL, NULL, 1, 2),
('cs-s1-cs111x',    'cornell-cs-bs-2026', 'pattern',  NULL, 'CS-111x', 'Intro Programming (CS 1110/1112)', NULL, 1, 3),
('cs-s1-fwis',      'cornell-cs-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 1, 4),
('cs-s1-pe',        'cornell-cs-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 1, 5),
-- Semester 2
('cs-s2-math1920',  'cornell-cs-bs-2026', 'course',   'MATH-1920', NULL, NULL, NULL, 2, 0),
('cs-s2-phys1112',  'cornell-cs-bs-2026', 'course',   'PHYS-1112', NULL, NULL, NULL, 2, 1),
('cs-s2-phys1110',  'cornell-cs-bs-2026', 'course',   'PHYS-1110', NULL, NULL, NULL, 2, 2),
('cs-s2-engri',     'cornell-cs-bs-2026', 'pattern',  NULL, 'ENGRI-1xxx', 'Engineering Seminar (ENGRI 1xxx)', NULL, 2, 3),
('cs-s2-fwis',      'cornell-cs-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 2, 4),
('cs-s2-pe',        'cornell-cs-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 2, 5),
-- Semester 3
('cs-s3-math2940',  'cornell-cs-bs-2026', 'course',   'MATH-2940', NULL, NULL, NULL, 3, 0),
('cs-s3-phys2213',  'cornell-cs-bs-2026', 'course',   'PHYS-2213', NULL, NULL, NULL, 3, 1),
('cs-s3-cs2110',    'cornell-cs-bs-2026', 'course',   'CS-2110',   NULL, NULL, NULL, 3, 2),
('cs-s3-cs2800',    'cornell-cs-bs-2026', 'course',   'CS-2800',   NULL, NULL, NULL, 3, 3),
('cs-s3-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 3, 4),
-- Semester 4
('cs-s4-engrd2xxx', 'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-engrd-dist',     4, 0),
('cs-s4-chem2080',  'cornell-cs-bs-2026', 'course',   'CHEM-2080', NULL, NULL, NULL, 4, 1),
('cs-s4-chem2081',  'cornell-cs-bs-2026', 'course',   'CHEM-2081', NULL, NULL, NULL, 4, 2),
('cs-s4-cs3110',    'cornell-cs-bs-2026', 'course',   'CS-3110',   NULL, NULL, NULL, 4, 3),
('cs-s4-netsys',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-networks-choice', 4, 4),
('cs-s4-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   4, 5),
-- Semester 5
('cs-s5-advisor1',  'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 5, 0),
('cs-s5-major1',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 5, 1),
('cs-s5-systems',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-systems-choice', 5, 2),
('cs-s5-major2',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 5, 3),
('cs-s5-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   5, 4),
-- Semester 6
('cs-s6-advisor2',  'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 6, 0),
('cs-s6-major3',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 6, 1),
('cs-s6-cs4820',    'cornell-cs-bs-2026', 'course',   'CS-4820',   NULL, NULL, NULL, 6, 2),
('cs-s6-major4',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 6, 3),
('cs-s6-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   6, 4),
-- Semester 7
('cs-s7-major5',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 7, 0),
('cs-s7-major6',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 7, 1),
('cs-s7-os',        'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-os-choice',      7, 2),
('cs-s7-major7',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 7, 3),
('cs-s7-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   7, 4),
-- Semester 8
('cs-s8-major8',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 8, 0),
('cs-s8-major9',    'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 8, 1),
('cs-s8-major10',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'cs-major-elective', 8, 2),
('cs-s8-libstud',   'cornell-cs-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   8, 3),

-- ────────────────────────────────────────────────────────────
-- ECE SLOTS
-- ────────────────────────────────────────────────────────────
-- Semester 1
('ece-s1-chem2090',  'cornell-ece-bs-2026', 'course',   'CHEM-2090', NULL, NULL, NULL, 1, 0),
('ece-s1-math1910',  'cornell-ece-bs-2026', 'course',   'MATH-1910', NULL, NULL, NULL, 1, 1),
('ece-s1-engri',     'cornell-ece-bs-2026', 'pattern',  NULL, 'ENGRI-1xxx', 'Engineering Seminar (ENGRI 1xxx)', NULL, 1, 2),
('ece-s1-fwis',      'cornell-ece-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 1, 3),
('ece-s1-pe',        'cornell-ece-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 1, 4),
-- Semester 2
('ece-s2-phys1112',  'cornell-ece-bs-2026', 'course',   'PHYS-1112', NULL, NULL, NULL, 2, 0),
('ece-s2-phys1110',  'cornell-ece-bs-2026', 'course',   'PHYS-1110', NULL, NULL, NULL, 2, 1),
('ece-s2-math1920',  'cornell-ece-bs-2026', 'course',   'MATH-1920', NULL, NULL, NULL, 2, 2),
('ece-s2-cs111x',    'cornell-ece-bs-2026', 'pattern',  NULL, 'CS-111x', 'Intro Programming (CS 1110/1112)', NULL, 2, 3),
('ece-s2-fwis',      'cornell-ece-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 2, 4),
('ece-s2-pe',        'cornell-ece-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 2, 5),
-- Semester 3
('ece-s3-phys2213',  'cornell-ece-bs-2026', 'course',   'PHYS-2213', NULL, NULL, NULL, 3, 0),
('ece-s3-math2930',  'cornell-ece-bs-2026', 'course',   'MATH-2930', NULL, NULL, NULL, 3, 1),
('ece-s3-ece2100',   'cornell-ece-bs-2026', 'course',   'ECE-2100',  NULL, NULL, NULL, 3, 2),
('ece-s3-ece2300',   'cornell-ece-bs-2026', 'course',   'ECE-2300',  NULL, NULL, NULL, 3, 3),
('ece-s3-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 3, 4),
-- Semester 4
('ece-s4-phys2214',  'cornell-ece-bs-2026', 'course',   'PHYS-2214', NULL, NULL, NULL, 4, 0),
('ece-s4-math2940',  'cornell-ece-bs-2026', 'course',   'MATH-2940', NULL, NULL, NULL, 4, 1),
('ece-s4-engrd2xxx', 'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-engrd-dist',  4, 2),
('ece-s4-ece2720',   'cornell-ece-bs-2026', 'course',   'ECE-2720',  NULL, NULL, NULL, 4, 3),
('ece-s4-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 4, 4),
-- Semester 5
('ece-s5-found1',    'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-foundation',      5, 0),
('ece-s5-advisor1',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 5, 1),
('ece-s5-outside1',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-outside-tech',    5, 2),
('ece-s5-found2',    'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-foundation',      5, 3),
('ece-s5-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',     5, 4),
-- Semester 6
('ece-s6-found3',    'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-foundation',      6, 0),
('ece-s6-elec1',     'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        6, 1),
('ece-s6-outside2',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-outside-tech',    6, 2),
('ece-s6-advisor2',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 6, 3),
('ece-s6-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',     6, 4),
-- Semester 7
('ece-s7-elec-cde',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        7, 0),
('ece-s7-elec2',     'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        7, 1),
('ece-s7-outside3',  'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-outside-tech',    7, 2),
('ece-s7-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',     7, 3),
-- Semester 8
('ece-s8-elec3',     'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        8, 0),
('ece-s8-elec4',     'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        8, 1),
('ece-s8-elec5',     'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'ece-elective',        8, 2),
('ece-s8-libstud',   'cornell-ece-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',     8, 3),

-- ────────────────────────────────────────────────────────────
-- ME SLOTS
-- ────────────────────────────────────────────────────────────
-- Semester 1
('me-s1-math1910',   'cornell-me-bs-2026', 'course',   'MATH-1910', NULL, NULL, NULL, 1, 0),
('me-s1-chem2090',   'cornell-me-bs-2026', 'course',   'CHEM-2090', NULL, NULL, NULL, 1, 1),
('me-s1-engri',      'cornell-me-bs-2026', 'pattern',  NULL, 'ENGRI-1xxx', 'Engineering Seminar (ENGRI 1xxx)', NULL, 1, 2),
('me-s1-fwis',       'cornell-me-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 1, 3),
('me-s1-pe',         'cornell-me-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 1, 4),
-- Semester 2
('me-s2-math1920',   'cornell-me-bs-2026', 'course',   'MATH-1920', NULL, NULL, NULL, 2, 0),
('me-s2-phys1112',   'cornell-me-bs-2026', 'course',   'PHYS-1112', NULL, NULL, NULL, 2, 1),
('me-s2-phys1110',   'cornell-me-bs-2026', 'course',   'PHYS-1110', NULL, NULL, NULL, 2, 2),
('me-s2-cs111x',     'cornell-me-bs-2026', 'pattern',  NULL, 'CS-111x', 'Intro Programming (CS 1110/1112)', NULL, 2, 3),
('me-s2-fwis',       'cornell-me-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 2, 4),
('me-s2-pe',         'cornell-me-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 2, 5),
-- Semester 3
('me-s3-math2930',   'cornell-me-bs-2026', 'course',   'MATH-2930',  NULL, NULL, NULL, 3, 0),
('me-s3-phys2213',   'cornell-me-bs-2026', 'course',   'PHYS-2213',  NULL, NULL, NULL, 3, 1),
('me-s3-engrd2020',  'cornell-me-bs-2026', 'course',   'ENGRD-2020', NULL, NULL, NULL, 3, 2),
('me-s3-engrd2210',  'cornell-me-bs-2026', 'course',   'ENGRD-2210', NULL, NULL, NULL, 3, 3),
('me-s3-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 3, 4),
-- Semester 4
('me-s4-math2940',   'cornell-me-bs-2026', 'course',   'MATH-2940', NULL, NULL, NULL, 4, 0),
('me-s4-mae2030',    'cornell-me-bs-2026', 'course',   'MAE-2030',  NULL, NULL, NULL, 4, 1),
('me-s4-mae2250',    'cornell-me-bs-2026', 'course',   'MAE-2250',  NULL, NULL, NULL, 4, 2),
('me-s4-techelec',   'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-tech-elective', 4, 3),
('me-s4-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',  4, 4),
-- Semester 5
('me-s5-mae3260',    'cornell-me-bs-2026', 'course',   'MAE-3260', NULL, NULL, NULL, 5, 0),
('me-s5-mae3270',    'cornell-me-bs-2026', 'course',   'MAE-3270', NULL, NULL, NULL, 5, 1),
('me-s5-mae3230',    'cornell-me-bs-2026', 'course',   'MAE-3230', NULL, NULL, NULL, 5, 2),
('me-s5-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 5, 3),
-- Semester 6
('me-s6-systems',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-sem6-systems',  6, 0),
('me-s6-phys2214',   'cornell-me-bs-2026', 'course',   'PHYS-2214', NULL, NULL, NULL, 6, 1),
('me-s6-mae3240',    'cornell-me-bs-2026', 'course',   'MAE-3240',  NULL, NULL, NULL, 6, 2),
('me-s6-mathelec',   'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-math-elective', 6, 3),
('me-s6-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',  6, 4),
-- Semester 7
('me-s7-major1',     'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-major-elective', 7, 0),
('me-s7-mae4272',    'cornell-me-bs-2026', 'course',   'MAE-4272', NULL, NULL, NULL, 7, 1),
('me-s7-major2',     'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-major-elective', 7, 2),
('me-s7-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',   7, 3),
-- Semester 8
('me-s8-major3',     'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-major-elective',     8, 0),
('me-s8-mae4xx1',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'me-mae4xx1',             8, 1),
('me-s8-advisor1',   'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open',  8, 2),
('me-s8-advisor2',   'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open',  8, 3),
('me-s8-libstud',    'cornell-me-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',        8, 4),

-- ────────────────────────────────────────────────────────────
-- ORE SLOTS
-- ────────────────────────────────────────────────────────────
-- Semester 1
('ore-s1-chem2090',  'cornell-ore-bs-2026', 'course',   'CHEM-2090', NULL, NULL, NULL, 1, 0),
('ore-s1-chem2091',  'cornell-ore-bs-2026', 'course',   'CHEM-2091', NULL, NULL, NULL, 1, 1),
('ore-s1-math1910',  'cornell-ore-bs-2026', 'course',   'MATH-1910', NULL, NULL, NULL, 1, 2),
('ore-s1-engri',     'cornell-ore-bs-2026', 'pattern',  NULL, 'ENGRI-1xxx', 'Engineering Seminar (ENGRI 1xxx)', NULL, 1, 3),
('ore-s1-fwis',      'cornell-ore-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 1, 4),
('ore-s1-pe',        'cornell-ore-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 1, 5),
-- Semester 2
('ore-s2-phys1112',  'cornell-ore-bs-2026', 'course',   'PHYS-1112', NULL, NULL, NULL, 2, 0),
('ore-s2-phys1110',  'cornell-ore-bs-2026', 'course',   'PHYS-1110', NULL, NULL, NULL, 2, 1),
('ore-s2-math1920',  'cornell-ore-bs-2026', 'course',   'MATH-1920', NULL, NULL, NULL, 2, 2),
('ore-s2-cs111x',    'cornell-ore-bs-2026', 'pattern',  NULL, 'CS-111x', 'Intro Programming (CS 1110/1112)', NULL, 2, 3),
('ore-s2-fwis',      'cornell-ore-bs-2026', 'pattern',  NULL, 'FWIS-1xxx', 'First-Year Writing Seminar', NULL, 2, 4),
('ore-s2-pe',        'cornell-ore-bs-2026', 'pattern',  NULL, 'PE-1xxx', 'Physical Education', NULL, 2, 5),
-- Semester 3
('ore-s3-phys2213',  'cornell-ore-bs-2026', 'course',   'PHYS-2213',  NULL, NULL, NULL, 3, 0),
('ore-s3-math2940',  'cornell-ore-bs-2026', 'course',   'MATH-2940',  NULL, NULL, NULL, 3, 1),
('ore-s3-engrd2700', 'cornell-ore-bs-2026', 'course',   'ENGRD-2700', NULL, NULL, NULL, 3, 2),
('ore-s3-cs2110',    'cornell-ore-bs-2026', 'course',   'CS-2110',    NULL, NULL, NULL, 3, 3),
('ore-s3-libstud',   'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 3, 4),
-- Semester 4
('ore-s4-phys2214',  'cornell-ore-bs-2026', 'course',   'PHYS-2214', NULL, NULL, NULL, 4, 0),
('ore-s4-mathchoice','cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-math-choice', 4, 1),
('ore-s4-orie3120',  'cornell-ore-bs-2026', 'course',   'ORIE-3120', NULL, NULL, NULL, 4, 2),
('ore-s4-libstud',   'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 4, 3),
-- Semester 5
('ore-s5-orie3300',  'cornell-ore-bs-2026', 'course',   'ORIE-3300', NULL, NULL, NULL, 5, 0),
('ore-s5-orie3500',  'cornell-ore-bs-2026', 'course',   'ORIE-3500', NULL, NULL, NULL, 5, 1),
('ore-s5-orie3150',  'cornell-ore-bs-2026', 'course',   'ORIE-3150', NULL, NULL, NULL, 5, 2),
('ore-s5-libstud1',  'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 5, 3),
('ore-s5-libstud2',  'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies', 5, 4),
-- Semester 6
('ore-s6-orie3310',  'cornell-ore-bs-2026', 'course',   'ORIE-3310', NULL, NULL, NULL, 6, 0),
('ore-s6-orie3510',  'cornell-ore-bs-2026', 'course',   'ORIE-3510', NULL, NULL, NULL, 6, 1),
('ore-s6-major1',    'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-major-elective', 6, 2),
('ore-s6-advisor1',  'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 6, 3),
('ore-s6-libstud',   'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',    6, 4),
-- Semester 7
('ore-s7-major2',    'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-major-elective', 7, 0),
('ore-s7-orieelec1', 'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-orie-elective',  7, 1),
('ore-s7-orieelec2', 'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-orie-elective',  7, 2),
('ore-s7-orie4580',  'cornell-ore-bs-2026', 'course',   'ORIE-4580', NULL, NULL, NULL, 7, 3),
('ore-s7-advisor2',  'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'advisor-elective-open', 7, 4),
('ore-s7-libstud',   'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',    7, 5),
-- Semester 8
('ore-s8-orieelec3', 'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-orie-elective',  8, 0),
('ore-s8-orieelec4', 'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-orie-elective',  8, 1),
('ore-s8-major3',    'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-major-elective', 8, 2),
('ore-s8-major4',    'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'ore-major-elective', 8, 3),
('ore-s8-libstud',   'cornell-ore-bs-2026', 'elective', NULL, NULL, NULL, 'liberal-studies',    8, 4)

ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 7. SLOT EDGES  (prerequisite arrows)
-- ============================================================

INSERT INTO slot_edges (program_id, from_slot, to_slot, edge_type) VALUES

-- ── CS EDGES ─────────────────────────────────────────────────
('cornell-cs-bs-2026', 'cs-s1-math1910', 'cs-s2-math1920',  'prereq'),
('cornell-cs-bs-2026', 'cs-s2-math1920', 'cs-s3-math2940',  'prereq'),
('cornell-cs-bs-2026', 'cs-s2-phys1112', 'cs-s3-phys2213',  'prereq'),
('cornell-cs-bs-2026', 'cs-s2-math1920', 'cs-s3-phys2213',  'prereq'),
('cornell-cs-bs-2026', 'cs-s1-cs111x',   'cs-s3-cs2110',    'prereq'),
('cornell-cs-bs-2026', 'cs-s1-cs111x',   'cs-s3-cs2800',    'prereq'),
('cornell-cs-bs-2026', 'cs-s3-cs2110',   'cs-s4-cs3110',    'prereq'),
('cornell-cs-bs-2026', 'cs-s4-cs3110',   'cs-s4-netsys',    'prereq'),
('cornell-cs-bs-2026', 'cs-s3-cs2800',   'cs-s4-netsys',    'prereq'),
('cornell-cs-bs-2026', 'cs-s4-cs3110',   'cs-s5-systems',   'prereq'),
('cornell-cs-bs-2026', 'cs-s3-cs2800',   'cs-s5-systems',   'prereq'),
('cornell-cs-bs-2026', 'cs-s4-cs3110',   'cs-s6-cs4820',    'prereq'),
('cornell-cs-bs-2026', 'cs-s3-cs2800',   'cs-s6-cs4820',    'prereq'),
('cornell-cs-bs-2026', 'cs-s3-math2940', 'cs-s6-cs4820',    'prereq'),
('cornell-cs-bs-2026', 'cs-s5-systems',  'cs-s7-os',        'prereq'),
('cornell-cs-bs-2026', 'cs-s2-phys1110', 'cs-s2-phys1112',  'concurrent'),

-- ── ECE EDGES ────────────────────────────────────────────────
('cornell-ece-bs-2026', 'ece-s1-math1910', 'ece-s2-math1920',  'prereq'),
('cornell-ece-bs-2026', 'ece-s1-math1910', 'ece-s2-phys1112',  'prereq'),
('cornell-ece-bs-2026', 'ece-s2-math1920', 'ece-s3-phys2213',  'prereq'),
('cornell-ece-bs-2026', 'ece-s2-phys1112', 'ece-s3-phys2213',  'prereq'),
('cornell-ece-bs-2026', 'ece-s2-math1920', 'ece-s3-math2930',  'prereq'),
('cornell-ece-bs-2026', 'ece-s2-phys1112', 'ece-s3-ece2100',   'prereq'),
('cornell-ece-bs-2026', 'ece-s2-math1920', 'ece-s3-ece2100',   'prereq'),
('cornell-ece-bs-2026', 'ece-s3-ece2100',  'ece-s3-ece2300',   'prereq'),
('cornell-ece-bs-2026', 'ece-s3-phys2213', 'ece-s3-ece2300',   'prereq'),
('cornell-ece-bs-2026', 'ece-s3-phys2213', 'ece-s4-phys2214',  'prereq'),
('cornell-ece-bs-2026', 'ece-s3-math2930', 'ece-s4-math2940',  'prereq'),
('cornell-ece-bs-2026', 'ece-s2-cs111x',   'ece-s4-ece2720',   'prereq'),
('cornell-ece-bs-2026', 'ece-s3-ece2100',  'ece-s5-found1',    'prereq'),
('cornell-ece-bs-2026', 'ece-s3-ece2300',  'ece-s5-found2',    'prereq'),
('cornell-ece-bs-2026', 'ece-s2-phys1110', 'ece-s2-phys1112',  'concurrent'),

-- ── ME EDGES ─────────────────────────────────────────────────
('cornell-me-bs-2026', 'me-s1-math1910',  'me-s2-math1920',  'prereq'),
('cornell-me-bs-2026', 'me-s1-math1910',  'me-s2-phys1112',  'prereq'),
('cornell-me-bs-2026', 'me-s2-math1920',  'me-s3-math2930',  'prereq'),
('cornell-me-bs-2026', 'me-s2-phys1112',  'me-s3-phys2213',  'prereq'),
('cornell-me-bs-2026', 'me-s2-math1920',  'me-s3-phys2213',  'prereq'),
('cornell-me-bs-2026', 'me-s2-phys1112',  'me-s3-engrd2020', 'prereq'),
('cornell-me-bs-2026', 'me-s2-math1920',  'me-s3-engrd2020', 'prereq'),
('cornell-me-bs-2026', 'me-s3-math2930',  'me-s3-engrd2210', 'prereq'),
('cornell-me-bs-2026', 'me-s1-chem2090',  'me-s3-engrd2210', 'prereq'),
('cornell-me-bs-2026', 'me-s3-engrd2020', 'me-s4-mae2030',   'prereq'),
('cornell-me-bs-2026', 'me-s3-math2930',  'me-s4-mae2030',   'prereq'),
('cornell-me-bs-2026', 'me-s3-engrd2020', 'me-s4-mae2250',   'prereq'),
('cornell-me-bs-2026', 'me-s2-math1920',  'me-s4-math2940',  'prereq'),
('cornell-me-bs-2026', 'me-s4-mae2030',   'me-s5-mae3230',   'prereq'),
('cornell-me-bs-2026', 'me-s4-math2940',  'me-s5-mae3230',   'prereq'),
('cornell-me-bs-2026', 'me-s3-engrd2210', 'me-s5-mae3270',   'prereq'),
('cornell-me-bs-2026', 'me-s1-chem2090',  'me-s5-mae3260',   'prereq'),
('cornell-me-bs-2026', 'me-s2-phys1112',  'me-s5-mae3260',   'prereq'),
('cornell-me-bs-2026', 'me-s4-mae2030',   'me-s6-mae3240',   'prereq'),
('cornell-me-bs-2026', 'me-s3-engrd2210', 'me-s6-mae3240',   'prereq'),
('cornell-me-bs-2026', 'me-s5-mae3230',   'me-s7-mae4272',   'prereq'),
('cornell-me-bs-2026', 'me-s6-mae3240',   'me-s7-mae4272',   'prereq'),
('cornell-me-bs-2026', 'me-s2-phys1110',  'me-s2-phys1112',  'concurrent'),

-- ── ORE EDGES ────────────────────────────────────────────────
('cornell-ore-bs-2026', 'ore-s1-math1910',  'ore-s2-math1920',  'prereq'),
('cornell-ore-bs-2026', 'ore-s1-math1910',  'ore-s2-phys1112',  'prereq'),
('cornell-ore-bs-2026', 'ore-s2-phys1112',  'ore-s3-phys2213',  'prereq'),
('cornell-ore-bs-2026', 'ore-s2-math1920',  'ore-s3-phys2213',  'prereq'),
('cornell-ore-bs-2026', 'ore-s3-phys2213',  'ore-s4-phys2214',  'prereq'),
('cornell-ore-bs-2026', 'ore-s2-math1920',  'ore-s3-math2940',  'prereq'),
('cornell-ore-bs-2026', 'ore-s2-math1920',  'ore-s3-engrd2700', 'prereq'),
('cornell-ore-bs-2026', 'ore-s2-cs111x',    'ore-s3-cs2110',    'prereq'),
('cornell-ore-bs-2026', 'ore-s3-math2940',  'ore-s5-orie3300',  'prereq'),
('cornell-ore-bs-2026', 'ore-s3-engrd2700', 'ore-s4-orie3120',  'prereq'),
('cornell-ore-bs-2026', 'ore-s3-engrd2700', 'ore-s5-orie3500',  'prereq'),
('cornell-ore-bs-2026', 'ore-s5-orie3300',  'ore-s6-orie3310',  'prereq'),
('cornell-ore-bs-2026', 'ore-s5-orie3500',  'ore-s6-orie3510',  'prereq'),
('cornell-ore-bs-2026', 'ore-s5-orie3300',  'ore-s7-orie4580',  'prereq'),
('cornell-ore-bs-2026', 'ore-s5-orie3500',  'ore-s7-orie4580',  'prereq'),
('cornell-ore-bs-2026', 'ore-s2-phys1110',  'ore-s2-phys1112',  'concurrent');
