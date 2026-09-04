//! Shared application state: the database pool, the engine's city dataset, and
//! a cache that uses Redis when it is configured and an in-process map when it
//! is not (plan §59 — Redis is a cache, never the source of truth).

use crate::error::{ApiError, ApiResult};
use chrono::{DateTime, Duration, Utc};
use hh_core::city::CityData;
use hh_core::params::Params;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// One city the server can validate and recompute against.
pub struct City {
    pub key: String,
    pub name: String,
    pub data: CityData,
    /// The metric plane this city's calculations run in.
    pub origin: (f64, f64),
    /// This city's own parameter set. A few figures in it are statements about
    /// the city rather than about railways — its share of the VAT pot, what
    /// its subsoil costs to dig — so one shared default gets them wrong for
    /// every city but the one they were calibrated on.
    pub params: Arc<Params>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_secret: String,
    /// Every city dataset the server holds, keyed by its identifier.
    pub cities: Arc<HashMap<String, City>>,
    /// Which city a request without an explicit one belongs to.
    pub default_city: String,
    pub data_version: String,
    pub cache: Cache,
}

impl AppState {
    /// The dataset for a scenario, or an error naming what is available.
    pub fn city(&self, key: &str) -> ApiResult<&City> {
        self.cities.get(key).ok_or_else(|| {
            let known = self.cities.keys().cloned().collect::<Vec<_>>().join(", ");
            ApiError::BadRequest(format!(
                "Für \u{201e}{key}\u{201c} liegen keine Daten vor. Verfügbar: {known}."
            ))
        })
    }

    /// Run a calculation with the projection pinned to that city.
    ///
    /// Two cities in one process cannot share one metric plane — Berlin's
    /// east-west distances would come out three per cent short on Hamburg's.
    pub fn with_city<T>(&self, key: &str, f: impl FnOnce(&City) -> T) -> ApiResult<T> {
        let city = self.city(key)?;
        Ok(hh_core::geo::with_origin(
            city.origin.0,
            city.origin.1,
            || f(city),
        ))
    }
}

/// A small TTL cache. Deliberately in-process: it holds derived values only, so
/// losing it costs a recomputation and nothing else.
/// Value plus the moment it stops being valid.
type Entry = (DateTime<Utc>, String);

#[derive(Clone, Default)]
pub struct Cache {
    inner: Arc<Mutex<HashMap<String, Entry>>>,
}

impl Cache {
    pub fn get(&self, key: &str) -> Option<String> {
        let mut m = self.inner.lock().ok()?;
        match m.get(key) {
            Some((expires, value)) if *expires > Utc::now() => Some(value.clone()),
            Some(_) => {
                m.remove(key);
                None
            }
            None => None,
        }
    }

    pub fn put(&self, key: &str, value: String, ttl_seconds: i64) {
        if let Ok(mut m) = self.inner.lock() {
            // Keep the cache from growing without bound.
            if m.len() > 2_000 {
                let now = Utc::now();
                m.retain(|_, (expires, _)| *expires > now);
                if m.len() > 2_000 {
                    m.clear();
                }
            }
            m.insert(
                key.to_string(),
                (Utc::now() + Duration::seconds(ttl_seconds), value),
            );
        }
    }

    pub fn invalidate_prefix(&self, prefix: &str) {
        if let Ok(mut m) = self.inner.lock() {
            m.retain(|k, _| !k.starts_with(prefix));
        }
    }
}

impl AppState {
    /// Sliding-window rate limit backed by the database, so it also holds
    /// across several server processes (plan §69, §70).
    pub async fn rate_limit(&self, bucket: &str, max: i32, window_seconds: i64) -> ApiResult<()> {
        // The window has to be the *same value* for every request inside it,
        // or each one gets its own row and nothing is ever limited. Subtracting
        // the seconds-into-the-window from `now` left the sub-second part in
        // place, so every single call was a fresh bucket — the limiter counted
        // to one, forever.
        let secs = Utc::now().timestamp();
        let window = DateTime::from_timestamp(secs - secs.rem_euclid(window_seconds), 0)
            .unwrap_or_else(Utc::now);
        let hits: (i32,) = sqlx::query_as(
            "INSERT INTO rate_limits (bucket, window_at, hits) VALUES ($1, $2, 1)
             ON CONFLICT (bucket, window_at) DO UPDATE SET hits = rate_limits.hits + 1
             RETURNING hits",
        )
        .bind(bucket)
        .bind(window)
        .fetch_one(&self.db)
        .await?;
        if hits.0 > max {
            return Err(ApiError::TooManyRequests);
        }
        Ok(())
    }

    /// A ceiling on how often something may happen across the whole service.
    ///
    /// Per-address limits bound one attacker on one connection. They do nothing
    /// about the same script run from a hundred addresses, which is the shape
    /// mass account creation and vote stuffing actually take — ten accounts an
    /// hour per address is a hundred addresses away from a thousand.
    ///
    /// The ceiling is set far above any plausible honest hour, so in normal use
    /// nobody meets it; it exists so that abuse hits a wall instead of a
    /// gradient. Tripping it does block honest people for the rest of the hour,
    /// which is the trade: a service that briefly refuses new accounts is
    /// recoverable, a ranking quietly filled with sock puppets is not. It logs
    /// loudly, because someone should look.
    pub async fn global_limit(
        &self,
        what: &str,
        max: i32,
        window_seconds: i64,
        message: &str,
    ) -> ApiResult<()> {
        match self
            .rate_limit(&format!("global:{what}"), max, window_seconds)
            .await
        {
            Err(ApiError::TooManyRequests) => {
                tracing::warn!(
                    what,
                    max,
                    window_seconds,
                    "Dienstweites Limit erreicht, sieht nach automatisiertem Zugriff aus"
                );
                Err(ApiError::ServiceBusy(message.to_string()))
            }
            other => other,
        }
    }
}

/// How many of a thing the whole service accepts per hour.
///
/// Deliberately generous: for a civic tool about one city's transit network,
/// each of these is an extraordinary hour. Raise them with `HH_MAX_*` when a
/// deployment is genuinely bigger than that.
pub fn hourly_ceiling(name: &str, fallback: i32) -> i32 {
    std::env::var(format!("HH_MAX_{}", name.to_uppercase()))
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(fallback)
}
