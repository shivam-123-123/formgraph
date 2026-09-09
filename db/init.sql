-- Runs automatically the first time the postgres volume is created.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  submitter     TEXT NOT NULL,
  vendor        TEXT NOT NULL,
  department    TEXT NOT NULL,
  notes         TEXT,
  filename      TEXT,
  document_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id            SERIAL PRIMARY KEY,
  document_id   TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  -- 768 = nomic-embed-text. Change the model, change this number, re-embed.
  embedding     vector(768)
);

CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);

-- IVFFlat only pays off with volume; at POC scale a seq scan is fine.
-- Uncomment once you have a few thousand rows:
-- CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
