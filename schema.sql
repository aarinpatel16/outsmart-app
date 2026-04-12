-- ============================================================
-- schema.sql  —  run once to set up all tables
-- psql $DATABASE_URL -f schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'parent', 'admin')),
  approved      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Lesson logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT        NOT NULL CHECK (category IN (
               'Financial Literacy',
               'Emotional Intelligence',
               'Leadership',
               'Dinner Talk'
             )),
  title      TEXT        NOT NULL,
  notes      TEXT        NOT NULL DEFAULT '',
  mood       TEXT        NOT NULL DEFAULT '',
  lesson_id  INTEGER     REFERENCES lessons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_user ON lesson_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_category ON lesson_logs(category);

-- ── Parent ↔ Student relationships ──────────────────────────
CREATE TABLE IF NOT EXISTS parent_children (
  parent_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, student_id)
);
