-- Optional spatial acceleration.
--
-- PostGIS is genuinely useful here (nearest-station queries, catchment
-- analysis, "scenarios near me"), but the application must also run on a plain
-- PostgreSQL. The extension is therefore attempted, and the spatial column and
-- index are only created when it is present.

DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS postgis;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'PostGIS nicht verfügbar — räumliche Indizes werden übersprungen (%).', SQLERRM;
    END;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        -- Bounding box of the scenario network, for map-based discovery.
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scenarios' AND column_name = 'extent'
        ) THEN
            EXECUTE 'ALTER TABLE scenarios ADD COLUMN extent geometry(Polygon, 4326)';
            EXECUTE 'CREATE INDEX scenarios_extent_gist ON scenarios USING GIST (extent)';
        END IF;

        -- Imported reference geography, versioned alongside the datasets.
        EXECUTE $ddl$
            CREATE TABLE IF NOT EXISTS geo_features (
                id           bigserial PRIMARY KEY,
                data_version text NOT NULL,
                layer        text NOT NULL,
                name         text,
                properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
                geom         geometry(Geometry, 4326) NOT NULL
            )
        $ddl$;
        EXECUTE 'CREATE INDEX IF NOT EXISTS geo_features_gist ON geo_features USING GIST (geom)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS geo_features_layer ON geo_features (data_version, layer)';
    END IF;
END
$$;
