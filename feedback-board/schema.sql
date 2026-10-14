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
