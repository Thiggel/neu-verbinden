-- Core schema.
--
-- Geometry lives in the scenario document as structured JSON, which is the
-- authoritative representation the engine reads. Frequently queried result
-- values are denormalised into columns so discovery and leaderboards stay fast
-- (plan §42). Where PostGIS is available a generated geometry column and a GiST
-- index are added in a later migration; the schema works without it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle        text NOT NULL UNIQUE,
    display_name  text NOT NULL,
    email         text UNIQUE,
    password_hash text,
    bio           text NOT NULL DEFAULT '',
    role          text NOT NULL DEFAULT 'member',
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT handle_shape CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
    CONSTRAINT role_known CHECK (role IN ('member', 'moderator', 'admin'))
);

CREATE TABLE IF NOT EXISTS scenarios (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text NOT NULL UNIQUE,
    author_id           uuid REFERENCES users (id) ON DELETE SET NULL,
    parent_id           uuid REFERENCES scenarios (id) ON DELETE SET NULL,
    title               text NOT NULL,
    description         text NOT NULL DEFAULT '',
    visibility          text NOT NULL DEFAULT 'private',
    -- The full network definition, exactly as the engine serialises it.
    document            jsonb NOT NULL,
    -- The authoritative result, recomputed on the server (plan §61).
    result              jsonb NOT NULL,
    calculation_version text NOT NULL,
    data_version        text NOT NULL,

    -- Denormalised headline figures for sorting and filtering.
    network_km          double precision NOT NULL DEFAULT 0,
    new_km              double precision NOT NULL DEFAULT 0,
    stations            integer NOT NULL DEFAULT 0,
    new_stations        integer NOT NULL DEFAULT 0,
    investment_eur      double precision NOT NULL DEFAULT 0,
    annual_benefit_eur  double precision NOT NULL DEFAULT 0,
    annual_fiscal_eur   double precision NOT NULL DEFAULT 0,
    benefit_cost_ratio  double precision NOT NULL DEFAULT 0,
    npv_eur             double precision NOT NULL DEFAULT 0,
    population_served   double precision NOT NULL DEFAULT 0,
    co2_saved_t         double precision NOT NULL DEFAULT 0,
    opening_year        integer,

    votes               integer NOT NULL DEFAULT 0,
    views               integer NOT NULL DEFAULT 0,
    forks               integer NOT NULL DEFAULT 0,
    comment_count       integer NOT NULL DEFAULT 0,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    published_at        timestamptz,
    hidden_at           timestamptz,
    CONSTRAINT visibility_known CHECK (visibility IN ('private', 'unlisted', 'public')),
    CONSTRAINT title_not_empty CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS scenarios_public_recent ON scenarios (published_at DESC)
    WHERE visibility = 'public' AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS scenarios_votes ON scenarios (votes DESC)
    WHERE visibility = 'public' AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS scenarios_author ON scenarios (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scenarios_parent ON scenarios (parent_id);

CREATE TABLE IF NOT EXISTS votes (
    scenario_id uuid NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scenario_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id uuid NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    author_id   uuid REFERENCES users (id) ON DELETE SET NULL,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    hidden_at   timestamptz,
    CONSTRAINT body_length CHECK (length(btrim(body)) BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS comments_scenario ON comments (scenario_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id uuid REFERENCES scenarios (id) ON DELETE CASCADE,
    comment_id  uuid REFERENCES comments (id) ON DELETE CASCADE,
    reporter_id uuid REFERENCES users (id) ON DELETE SET NULL,
    reason      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT report_target CHECK (scenario_id IS NOT NULL OR comment_id IS NOT NULL)
);

-- Background work: expensive recalculation and aggregation (plan §60).
CREATE TABLE IF NOT EXISTS jobs (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    status      text NOT NULL DEFAULT 'queued',
    attempts    integer NOT NULL DEFAULT 0,
    last_error  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz,
    CONSTRAINT job_status CHECK (status IN ('queued', 'running', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs (status, id) WHERE status = 'queued';

-- Simple sliding-window rate limiting that works without Redis.
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket     text NOT NULL,
    window_at  timestamptz NOT NULL,
    hits       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_at)
);
