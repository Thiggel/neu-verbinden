//! Background worker (plan §60).
//!
//! Expensive or bursty work is taken off the request path: recomputing stored
//! scenarios after a model change, refreshing derived counters, and cleaning up
//! the rate-limit table. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so
//! several worker processes can run side by side.

use crate::state::AppState;
use hh_core::scenario::ScenarioDocument;
use hh_core::simulation;
use serde_json::Value;
use sqlx::Row;
use std::time::Duration;
use uuid::Uuid;

/// How long the worker waits before asking for work again, once it has found
/// none. It doubles from `POLL_BUSY` up to this, and drops back the moment
/// there is something to do.
///
/// Two seconds, forever, is what this used to be. On a machine of one's own
/// that is merely wasteful — forty-three thousand queries a day to be told
/// there is nothing to do. On a database that bills by the hour and sleeps when
/// idle it is fatal: the polling alone keeps the database awake around the
/// clock, and a free allowance meant to cover a hundred hours a month is spent
/// in four days. Nothing about the application needs that pace; a queued
/// recomputation is not something anybody is watching.
fn idle_interval() -> Duration {
    Duration::from_secs(
        std::env::var("HH_WORKER_IDLE_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60)
            .clamp(1, 3600),
    )
}

/// The pause while work is still arriving: fast, because a queue that is moving
/// is a queue someone is waiting on.
const POLL_BUSY: Duration = Duration::from_secs(2);

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let ceiling = idle_interval();
        let mut wait = POLL_BUSY;
        loop {
            match run_once(&state).await {
                Ok(true) => {
                    // More work waiting: keep going at full speed.
                    wait = POLL_BUSY;
                    continue;
                }
                Ok(false) => {
                    // Nothing to do. Back off, so an idle service is quiet.
                    wait = (wait * 2).min(ceiling);
                }
                Err(e) => {
                    tracing::error!(error = %e, "Worker-Durchlauf fehlgeschlagen");
                    // A failing database is the worst thing to hammer.
                    wait = (wait * 2).min(ceiling);
                }
            }
            tokio::time::sleep(wait).await;
        }
    });
}

async fn run_once(state: &AppState) -> Result<bool, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let job = sqlx::query(
        "SELECT id, kind, payload, attempts FROM jobs
          WHERE status = 'queued'
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(job) = job else {
        tx.commit().await?;
        return Ok(false);
    };
    let id: i64 = job.get("id");
    let kind: String = job.get("kind");
    let payload: Value = job.get("payload");
    let attempts: i32 = job.get("attempts");
    sqlx::query("UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let outcome = handle(state, &kind, &payload).await;
    match outcome {
        Ok(()) => {
            sqlx::query("UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1")
                .bind(id)
                .execute(&state.db)
                .await?;
        }
        Err(e) => {
            let status = if attempts >= 4 { "failed" } else { "queued" };
            tracing::warn!(job = id, kind = %kind, error = %e, "Job fehlgeschlagen");
            sqlx::query("UPDATE jobs SET status = $2, last_error = $3 WHERE id = $1")
                .bind(id)
                .bind(status)
                .bind(e.to_string())
                .execute(&state.db)
                .await?;
        }
    }
    Ok(true)
}

async fn handle(
    state: &AppState,
    kind: &str,
    payload: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match kind {
        // Nothing heavy yet beyond confirming the stored result matches the
        // engine — but the hook is where ridership or accessibility analysis
        // would go once it is too slow for a request.
        "scenario_indexed" => {
            let Some(id) = payload.get("id").and_then(|v| v.as_str()) else {
                return Ok(());
            };
            let id: Uuid = id.parse()?;
            let row = sqlx::query("SELECT document FROM scenarios WHERE id = $1")
                .bind(id)
                .fetch_optional(&state.db)
                .await?;
            let Some(row) = row else { return Ok(()) };
            let document: Value = row.get("document");
            let doc: ScenarioDocument = serde_json::from_value(document)?;
            let result = state.with_city(&doc.city, |city| {
                simulation::run(&doc.network, &city.data, &city.params)
            })?;
            // The summary columns are what the lists, the rankings and the
            // cards read. Refreshing the stored result without them left the
            // card saying one investment and the detail page another.
            let h = &result.headline;
            sqlx::query(
                "UPDATE scenarios SET result = $2, calculation_version = $3, network_km = $4,
                    new_km = $5, stations = $6, new_stations = $7, investment_eur = $8,
                    annual_benefit_eur = $9, annual_fiscal_eur = $10, benefit_cost_ratio = $11,
                    npv_eur = $12, population_served = $13, co2_saved_t = $14, opening_year = $15,
                    parameter_fingerprint = $16
                 WHERE id = $1",
            )
            .bind(id)
            .bind(serde_json::to_value(&result)?)
            .bind(&result.calculation_version)
            .bind(h.network_km)
            .bind(h.new_km)
            .bind(h.stations as i32)
            .bind(h.new_stations as i32)
            .bind(h.investment_eur)
            .bind(h.annual_benefit_eur)
            .bind(h.annual_fiscal_eur)
            .bind(h.benefit_cost_ratio)
            .bind(result.appraisal.npv_eur)
            .bind(h.population_served)
            .bind(h.co2_saved_t_per_year)
            .bind(h.opening_year)
            .bind(&result.parameter_fingerprint)
            .execute(&state.db)
            .await?;
            state.cache.invalidate_prefix("list:");
            Ok(())
        }
        // Recompute every stored scenario with the current model. Old published
        // results stay reproducible because the document keeps its own version
        // stamps; this only refreshes what the ranking uses (plan §38).
        "recalculate_all" => {
            let rows = sqlx::query("SELECT id FROM scenarios ORDER BY created_at")
                .fetch_all(&state.db)
                .await?;
            for row in rows {
                let id: Uuid = row.get("id");
                sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('scenario_indexed', $1)")
                    .bind(serde_json::json!({ "id": id }))
                    .execute(&state.db)
                    .await?;
            }
            Ok(())
        }
        // Find results that were produced by a model or a parameter set that is
        // no longer the current one, and queue them.
        //
        // Without this, a recalibration silently split the corpus in two: the
        // scenarios published before it kept their old figures for ever, while
        // an identical plan published after it got different ones. The
        // comparison page meanwhile told people both sides came from the same
        // calculation. Whether a stored result is current is a question the
        // server can answer, so it should not be left to someone remembering.
        "requeue_stale" => {
            let mut queued = 0usize;
            for (key, city) in state.cities.iter() {
                let rows = sqlx::query(
                    "SELECT id FROM scenarios
                      WHERE city = $1 AND (calculation_version <> $2 OR parameter_fingerprint <> $3)
                      ORDER BY created_at
                      LIMIT $4",
                )
                .bind(key)
                .bind(&city.params.version)
                .bind(city.params.fingerprint())
                .bind(REQUEUE_BATCH)
                .fetch_all(&state.db)
                .await?;
                for row in rows {
                    let id: Uuid = row.get("id");
                    sqlx::query("INSERT INTO jobs (kind, payload) VALUES ('scenario_indexed', $1)")
                        .bind(serde_json::json!({ "id": id }))
                        .execute(&state.db)
                        .await?;
                    queued += 1;
                }
            }
            if queued > 0 {
                tracing::info!(queued, "Veraltete Ergebnisse zur Neuberechnung eingereiht");
            }
            Ok(())
        }
        "cleanup" => {
            sqlx::query("DELETE FROM rate_limits WHERE window_at < now() - interval '1 day'")
                .execute(&state.db)
                .await?;
            sqlx::query("DELETE FROM jobs WHERE status IN ('done','failed') AND finished_at < now() - interval '7 days'")
                .execute(&state.db)
                .await?;
            Ok(())
        }
        other => {
            tracing::warn!(kind = other, "Unbekannter Job-Typ");
            Ok(())
        }
    }
}

/// How many stale scenarios one sweep queues.
///
/// A model change makes every stored result stale at once. Queued in one go
/// that is a burst the worker chews through while nobody can publish; a few
/// hundred at a time, every few minutes, gets through a large corpus in
/// minutes without ever being the reason a request waits.
const REQUEUE_BATCH: i64 = 200;

/// Queue the periodic housekeeping jobs.
pub fn spawn_housekeeping(state: AppState) {
    let stale = state.clone();
    tokio::spawn(async move {
        loop {
            let _ = sqlx::query("INSERT INTO jobs (kind) VALUES ('cleanup')")
                .execute(&state.db)
                .await;
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
    // Sooner, and starting immediately: after a deployment that changes the
    // model, the figures on every page are wrong until this has run.
    tokio::spawn(async move {
        loop {
            let _ = sqlx::query("INSERT INTO jobs (kind) VALUES ('requeue_stale')")
                .execute(&stale.db)
                .await;
            // Tied to the same setting: a sweep every three minutes would keep
            // a sleeping database awake no matter how patient the worker is.
            tokio::time::sleep(Duration::from_secs(180).max(idle_interval() * 3)).await;
        }
    });
}
