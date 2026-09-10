-- init.sql only runs on a FRESH postgres volume. If you already have data,
-- run this instead of resetting:
--
--   docker compose exec -T postgres psql -U fg -d formgraph \
--     < db/migrate-001-extraction.sql

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS doc_type     TEXT    NOT NULL DEFAULT 'Other';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS entity_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rel_count    INTEGER NOT NULL DEFAULT 0;
