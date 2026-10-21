//! API server for the Hamburg Transit Network Designer.
//!
//! It owns three things the browser cannot: durable storage, the social graph,
//! and the authoritative recomputation of every published result. It runs the
//! same `hh-core` engine as the browser, so a published figure is exactly the
//! figure the model produces — not whatever the client claimed (plan §61).

mod auth;
mod error;
mod feedback;
mod heatmap;
mod preflight;
mod scenarios;
mod state;
mod worker;

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, Method};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use error::ApiResult;
use hh_core::city::CityData;
use hh_core::params::Params;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hh_server=info,tower_http=warn".into()),
        )
        .init();

    // Before anything is opened or bound: a deployment that is missing a
    // signing key or an origin should fail to start, loudly, rather than run
    // for months on a warning nobody was looking for.
    {
        let read = |k: &str| env::var(k).ok();
        for problem in preflight::check(&read) {
            tracing::error!("{}", problem.0);
        }
        if !preflight::check(&read).is_empty() {
            return Err("Die Konfiguration taugt nicht für den Betrieb (HH_ENV=production).".into());
        }
        for note in preflight::warnings(&read) {
            tracing::warn!("{note}");
        }
    }

    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost/hamburg_transit".to_string());
    let data_dir = env::var("HH_DATA_DIR").unwrap_or_else(|_| "../data/dist".to_string());
    let data_version = env::var("HH_DATA_VERSION").unwrap_or_else(|_| "2026-09".to_string());
    let jwt_secret = env::var("HH_JWT_SECRET").unwrap_or_else(|_| {
        tracing::warn!("HH_JWT_SECRET nicht gesetzt: es wird ein flüchtiges Geheimnis benutzt.");
        uuid::Uuid::new_v4().to_string()
    });
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    // Which cities to serve. `HH_CITIES=hamburg,berlin`; by default whichever
    // datasets are actually present.
    let wanted: Vec<String> = match env::var("HH_CITIES") {
        Ok(v) => v
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect(),
        Err(_) => discover_cities(&data_dir, &data_version),
    };
    if wanted.is_empty() {
        return Err(format!("Keine Stadtdaten in {data_dir} gefunden").into());
    }

    let mut cities: std::collections::HashMap<String, state::City> =
        std::collections::HashMap::new();
    for key in &wanted {
        let path = if key == "hamburg" {
            format!("{data_dir}/city-{data_version}.json")
        } else {
            format!("{data_dir}/{key}/city-{data_version}.json")
        };
        tracing::info!("Stadtdaten werden geladen ({path})");
        let mut data: CityData = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
        // The origin has to be in force while the spatial index is built, and
        // it must not leak into the next city loaded after it.
        let origin = data
            .projection_origin
            .map(|o| (o.lat, o.lon))
            .unwrap_or((hh_core::geo::ORIGIN_LAT, hh_core::geo::ORIGIN_LON));
        let problems = hh_core::geo::with_origin(origin.0, origin.1, || {
            data.prepare();
            data.validate()
        });
        if !problems.is_empty() {
            for p in &problems {
                tracing::error!("Stadtdaten {key}: {p}");
            }
            return Err(format!(
                "Stadtdaten {key} sind fehlerhaft ({} Probleme)",
                problems.len()
            )
            .into());
        }
        tracing::info!(
            city = %key,
            landmarks = data.landmarks.len(),
            districts = data.districts.len(),
            "Stadtdaten geladen"
        );
        // Each city's own parameters, beside its data. Missing, the defaults
        // stand in — but that is worth saying out loud rather than assuming.
        let params_path = if key == "hamburg" {
            format!("{data_dir}/params-{data_version}.json")
        } else {
            format!("{data_dir}/{key}/params-{data_version}.json")
        };
        let params = match std::fs::read_to_string(&params_path) {
            Ok(json) => serde_json::from_str::<Params>(&json)
                .map_err(|e| format!("Parameter {key} ({params_path}): {e}"))?,
            Err(_) => {
                tracing::warn!("Parameter {key}: {params_path} fehlt, es gelten die Vorgaben");
                Params::default()
            }
        };
        tracing::info!(city = %key, version = %params.version, "Parameter geladen");
        cities.insert(
            key.clone(),
            state::City {
                key: key.clone(),
                name: data.version.city.clone(),
                data,
                origin,
                params: Arc::new(params),
            },
        );
    }
    // The "Schnellster Ausbau" board divides by the years since planning began,
    // using one shared base year for every city. That is only meaningful while
    // the cities agree on it, so say so at startup rather than let the board
    // rank two cities against different clocks in silence.
    {
        let mut starts: Vec<i32> = cities
            .values()
            .map(|c| c.params.timeline.planning_start_year)
            .collect();
        starts.sort_unstable();
        starts.dedup();
        if starts.len() > 1 {
            tracing::warn!(
                "Die Städte starten die Planung in verschiedenen Jahren ({starts:?}); \
                 das Brett \"Schnellster Ausbau\" vergleicht sie dann ungleich."
            );
        }
    }

    let default_city = if cities.contains_key("hamburg") {
        "hamburg".to_string()
    } else {
        wanted[0].clone()
    };

    let db = PgPoolOptions::new()
        .max_connections(
            env::var("HH_DB_POOL")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
        )
        .acquire_timeout(Duration::from_secs(10))
        // Idle connections are closed, so a database that scales to zero can
        // actually get there. sqlx holds them for ten minutes by default, and a
        // pool that never lets go keeps a sleeping database awake for nothing.
        .min_connections(0)
        .idle_timeout(Duration::from_secs(
            env::var("HH_DB_IDLE_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
        ))
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("Datenbank bereit");

    let state = AppState {
        db,
        jwt_secret,
        cities: Arc::new(cities),
        default_city,
        data_version,
        cache: Default::default(),
    };

    worker::spawn(state.clone());
    worker::spawn_housekeeping(state.clone());

    // Falling back to "any origin" when the variable is missing is the wrong
    // default: a forgotten environment variable should not quietly open the
    // API to every site on the web. Unset means localhost; anything wider has
    // to be asked for.
    let cors = match env::var("HH_ALLOWED_ORIGIN") {
        Ok(origin) if origin.trim() == "*" => {
            tracing::warn!("HH_ALLOWED_ORIGIN=*: die API nimmt Anfragen von jeder Seite an.");
            CorsLayer::permissive()
        }
        Ok(origin) => CorsLayer::new()
            .allow_origin(origin.parse::<HeaderValue>()?)
            .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
            ])
            .allow_credentials(true),
        Err(_) => {
            tracing::warn!(
                "HH_ALLOWED_ORIGIN nicht gesetzt — es gilt http://localhost:3000. \
                 Im Betrieb muss die eigene Adresse gesetzt werden."
            );
            CorsLayer::new()
                .allow_origin("http://localhost:3000".parse::<HeaderValue>()?)
                .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                ])
                .allow_credentials(true)
        }
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/meta", get(meta))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/me", get(auth::me).delete(auth::delete_account))
        .route("/api/auth/export", get(auth::export))
        .route("/api/feedback/challenge", get(feedback::challenge))
        .route("/api/feedback", post(feedback::submit))
        .route(
            "/api/scenarios",
            get(scenarios::list).post(scenarios::create),
        )
        .route(
            "/api/scenarios/:slug",
            get(scenarios::get)
                .patch(scenarios::update)
                .delete(scenarios::remove),
        )
        .route("/api/scenarios/:slug/fork", post(scenarios::fork))
        .route(
            "/api/scenarios/:slug/vote",
            post(scenarios::vote).delete(scenarios::unvote),
        )
        .route(
            "/api/scenarios/:slug/comments",
            get(scenarios::comments).post(scenarios::add_comment),
        )
        .route("/api/scenarios/:slug/report", post(scenarios::report))
        .route(
            "/api/scenarios/:slug/recalculate",
            post(scenarios::recalculate),
        )
        .route("/api/comments/:id", delete(scenarios::hide_comment))
        .route("/api/leaderboards", get(scenarios::leaderboards))
        .route("/api/wuensche/:city", get(heatmap::heatmap))
        .route("/api/compare", get(scenarios::compare))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("API läuft auf http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    // `into_make_service_with_connect_info` is what puts the peer address into
    // the request extensions, which the rate limiter needs.
    let app = app.into_make_service_with_connect_info::<std::net::SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

/// Which cities have a dataset on disk for this version.
fn discover_cities(data_dir: &str, version: &str) -> Vec<String> {
    let mut out = Vec::new();
    if std::path::Path::new(&format!("{data_dir}/city-{version}.json")).exists() {
        out.push("hamburg".to_string());
    }
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for e in entries.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let key = e.file_name().to_string_lossy().to_lowercase();
            if key == "hamburg" {
                continue;
            }
            if e.path().join(format!("city-{version}.json")).exists() {
                out.push(key);
            }
        }
    }
    out.sort();
    out
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("Wird beendet");
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> ApiResult<Json<serde_json::Value>> {
    let one: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&state.db).await?;
    Ok(Json(
        serde_json::json!({ "ok": one == 1, "dataVersion": state.data_version }),
    ))
}

async fn meta(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "calculationVersion": hh_core::CALCULATION_VERSION,
        "dataVersion": state.data_version,
        "cities": state.cities.values()
            .map(|c| serde_json::json!({ "id": c.key, "name": c.name }))
            .collect::<Vec<_>>(),
        "defaultCity": state.default_city,
        "sources": state.cities.get(&state.default_city).map(|c| c.data.version.sources.clone()).unwrap_or_default(),
        "sorts": scenarios::SORTS
            .iter()
            .map(|(k, _, label)| serde_json::json!({ "key": k, "label": label }))
            .collect::<Vec<_>>(),
        "disclaimer": hh_core::simulation::DISCLAIMER,
    }))
}
