-- Which parameter values a stored result was produced with.
--
-- `calculation_version` names the shape of the calculation. It does not move
-- when a figure inside it does — and two cities now run the same version with
-- different numbers. Without this column a scenario computed before a
-- recalibration is indistinguishable from a current one, so nothing ever
-- re-queues it and the comparison page presents two incomparable results as
-- "derselbe Rechnung".
--
-- Empty on existing rows, which is exactly right: it matches no current
-- fingerprint, so every one of them is queued for recomputation once.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS parameter_fingerprint text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS scenarios_stale_idx
    ON scenarios (city, calculation_version, parameter_fingerprint);
