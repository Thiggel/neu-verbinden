-- How many people a plan newly brings within walking distance of a station.
--
-- `population_served` is the count for the finished network, existing lines
-- included, and as a figure in the editor that is right: it answers "how many
-- people can reach a station once this is built". As a way to compare plans it
-- is close to useless, because the existing network dominates it. A 190 m tram
-- stub scores 1.39 million against 1.54 million for a 93 km rebuild — 90 % of
-- the score for 0.2 % of the work — and per euro invested the stub then looks
-- twenty times better than anything real, because it is claiming credit for
-- every station Hamburg already has.
--
-- The gain is the honest basis for any comparison, and it is already implicit
-- in the stored result, so existing rows can be backfilled exactly rather than
-- recomputed.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS population_gain double precision NOT NULL DEFAULT 0;

UPDATE scenarios
   SET population_gain = GREATEST(
           0,
           COALESCE((result::jsonb #>> '{demand,populationServedAfter}')::float8, 0)
         - COALESCE((result::jsonb #>> '{demand,populationServedBefore}')::float8, 0)
       )
 WHERE result IS NOT NULL;
