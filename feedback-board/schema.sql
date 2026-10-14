-- Feedback database. No foreign keys to any user table; no identity stored.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL CHECK (category IN ('idea','issue','praise','question')),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author_hash   CHAR(64) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  vote_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now()),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS feedback_list_idx ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_top_idx  ON feedback (status, vote_count DESC);

CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  author_hash CHAR(64) NOT NULL,
  is_op       BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  vote_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now()),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_thread_idx ON comments (feedback_id, created_at);

CREATE TABLE IF NOT EXISTS votes (
  feedback_id UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  voter_key   CHAR(64) NOT NULL,
  PRIMARY KEY (feedback_id, voter_key)
);

CREATE TABLE IF NOT EXISTS comment_votes (
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  voter_key  CHAR(64) NOT NULL,
  PRIMARY KEY (comment_id, voter_key)
);

CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  TEXT NOT NULL CHECK (target_type IN ('feedback','comment')),
  target_id    UUID NOT NULL,
  reason       TEXT NOT NULL,
  reporter_key CHAR(64) NOT NULL,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now()),
  UNIQUE (target_id, reporter_key)
);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);

-- Server fallback for similar-comment search on very large threads.
-- (Needs privilege to create the extension; the app tolerates its absence.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS comments_body_trgm_idx ON comments USING gin (body gin_trgm_ops);

-- Quick survey (anonymous). One response per browser via an HMAC key, like votes.
CREATE TABLE IF NOT EXISTS survey_responses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  respondent_key CHAR(64) NOT NULL UNIQUE,
  usefulness     SMALLINT NOT NULL CHECK (usefulness BETWEEN 1 AND 5),
  nps            SMALLINT NOT NULL CHECK (nps BETWEEN 0 AND 10),
  features       TEXT[] NOT NULL DEFAULT '{}',
  barriers       TEXT[] NOT NULL DEFAULT '{}',
  languages      TEXT[] NOT NULL DEFAULT '{}',
  role           TEXT,
  pilot          TEXT,
  missing        TEXT CHECK (char_length(missing) <= 1000),
  build_next     TEXT CHECK (char_length(build_next) <= 1000),
  other          TEXT CHECK (char_length(other) <= 1000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now())
);

-- One-tap quick question on the board. One answer per browser (HMAC key); can be changed.
CREATE TABLE IF NOT EXISTS quick_answers (
  respondent_key CHAR(64) PRIMARY KEY,
  answer         TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now())
);

-- Editable survey (admin can add / edit / reorder / archive questions).
CREATE TABLE IF NOT EXISTS survey_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position    INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL CHECK (kind IN ('scale','single','multi','text')),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  options     TEXT[] NOT NULL DEFAULT '{}',
  scale_min   SMALLINT,
  scale_max   SMALLINT,
  low_label   TEXT,
  high_label  TEXT,
  required    BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per answered question. Responses keep only id, respondent_key and created_at;
-- the original fixed columns on survey_responses are kept nullable for compatibility.
CREATE TABLE IF NOT EXISTS survey_answers (
  response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  num         SMALLINT,
  txt         TEXT CHECK (char_length(txt) <= 1000),
  picks       TEXT[],
  PRIMARY KEY (response_id, question_id)
);
ALTER TABLE survey_responses ALTER COLUMN usefulness DROP NOT NULL;
ALTER TABLE survey_responses ALTER COLUMN nps DROP NOT NULL;

-- Default questions (only when the table is empty).
INSERT INTO survey_questions (position, kind, title, options, scale_min, scale_max, low_label, high_label, required)
SELECT * FROM (VALUES
  (1, 'scale',  'How useful does STAAD look for therapy practice?', '{}'::text[], 1::smallint, 5::smallint, 'Not useful', 'Very useful', true),
  (2, 'multi',  'Which features stood out?', ARRAY['AI session summaries','Voice transcription','Progress tracking & reports','WhatsApp reminders & doctor chatbot','Scheduling & booking','Client portal','Other'], NULL, NULL, NULL, NULL, false),
  (3, 'text',   'What felt confusing, slow or missing?', '{}'::text[], NULL, NULL, NULL, NULL, false),
  (4, 'multi',  'What would stop you from using it?', ARRAY['Data privacy & security','AI accuracy','Cost','Ease of use','Language support','Doesn''t fit my workflow','Nothing'], NULL, NULL, NULL, NULL, false),
  (5, 'multi',  'Which languages do you need?', ARRAY['English','Hindi','Kannada','Telugu','Tamil','Other'], NULL, NULL, NULL, NULL, false),
  (6, 'scale',  'How likely are you to recommend STAAD to a colleague?', '{}'::text[], 0::smallint, 10::smallint, 'Not likely', 'Very likely', true),
  (7, 'text',   'What''s one thing we should build next?', '{}'::text[], NULL, NULL, NULL, NULL, false),
  (8, 'single', 'Your role', ARRAY['Therapist / psychologist','Psychiatrist','Clinic owner / admin','Student','Investor / partner','Other'], NULL, NULL, NULL, NULL, false),
  (9, 'single', 'Would you try a pilot?', ARRAY['Yes','Maybe','No'], NULL, NULL, NULL, NULL, false),
  (10, 'text',  'Anything else?', '{}'::text[], NULL, NULL, NULL, NULL, false)
) AS v(position, kind, title, options, scale_min, scale_max, low_label, high_label, required)
WHERE NOT EXISTS (SELECT 1 FROM survey_questions);

-- Small key/value settings (the quick question lives here so admins can edit it).
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
INSERT INTO app_settings (key, value)
VALUES ('quick', '{"question": "Overall, how was the demo?", "options": ["Loved it", "Good", "Okay", "Not for me"], "version": 1}')
ON CONFLICT (key) DO NOTHING;

-- Multiple quick questions (replaces the single quick question in app_settings).
CREATE TABLE IF NOT EXISTS quick_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position   INTEGER NOT NULL DEFAULT 0,
  question   TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 150),
  options    TEXT[] NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,   -- bumped when the text/options change; old answers are cleared
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quick_answers ADD COLUMN IF NOT EXISTS question_id UUID REFERENCES quick_questions(id) ON DELETE CASCADE;
DELETE FROM quick_answers WHERE question_id IS NULL;
INSERT INTO quick_questions (position, question, options)
SELECT * FROM (VALUES
  (1, 'Overall, how was the demo?', ARRAY['Loved it','Good','Okay','Not for me']),
  (2, 'Would you use STAAD in your practice?', ARRAY['Yes','Maybe','No'])
) AS v(position, question, options)
WHERE NOT EXISTS (SELECT 1 FROM quick_questions);
DELETE FROM app_settings WHERE key = 'quick';
