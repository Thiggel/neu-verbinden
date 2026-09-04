-- Which city a scenario belongs to.
--
-- Everything published before this column existed was Hamburg, so that is the
-- default and the backfill in one.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT 'hamburg';
CREATE INDEX IF NOT EXISTS scenarios_city ON scenarios (city, visibility, published_at DESC);
