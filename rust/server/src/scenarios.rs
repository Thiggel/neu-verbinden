//! Scenarios: saving, publishing, forking, voting, commenting and discovery
//! (plan §39–§44).
//!
//! The server never trusts a client-supplied result. It parses the network with
//! the same engine the browser uses, validates it, and recomputes the figures
//! itself; only those values are stored and ranked (plan §61, §70).

use crate::auth::{Auth, MaybeAuth};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hh_core::scenario::ScenarioDocument;
use hh_core::simulation::{self, SimulationResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct SaveBody {
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// The scenario document as produced by the engine, as a JSON string.
    pub document: String,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    /// Optional ancestry when this came from "fork".
    #[serde(default)]
    pub parent: Option<String>,
}

fn default_visibility() -> String {
    "private".into()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScenarioSummary {
    pub slug: String,
    /// Which city this plan is for — two networks look alike in a list.
    pub city: String,
    pub title: String,
    pub description: String,
    pub author: Option<String>,
    pub author_name: Option<String>,
    pub visibility: String,
    pub network_km: f64,
    pub new_km: f64,
    pub stations: i32,
    pub new_stations: i32,
    pub investment_eur: f64,
    pub annual_benefit_eur: f64,
    pub annual_fiscal_eur: f64,
    pub benefit_cost_ratio: f64,
    pub npv_eur: f64,
    pub population_served: f64,
    /// The people this plan newly reaches — see migration 0005.
    pub population_gain: f64,
    pub co2_saved_t: f64,
    pub opening_year: Option<i32>,
    pub votes: i32,
    pub views: i32,
    pub forks: i32,
    pub comment_count: i32,
    pub created_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    pub parent_slug: Option<String>,
    pub calculation_version: String,
    /// Digest of the parameter values behind these figures. Two scenarios are
    /// only comparable when this matches — the version alone does not move
    /// when a figure inside the model does.
    pub parameter_fingerprint: String,
    pub data_version: String,
}

#[derive(Debug, Serialize)]
pub struct ScenarioDetail {
    #[serde(flatten)]
    pub summary: ScenarioSummary,
    pub document: Value,
    pub result: Value,
    pub voted: bool,
    pub can_edit: bool,
}

fn summary_from_row(row: &sqlx::postgres::PgRow) -> ScenarioSummary {
    ScenarioSummary {
        slug: row.get("slug"),
        city: row.try_get("city").unwrap_or_else(|_| "hamburg".into()),
        title: row.get("title"),
        description: row.get("description"),
        author: row.try_get("author_handle").ok(),
        author_name: row.try_get("author_name").ok(),
        visibility: row.get("visibility"),
        network_km: row.get("network_km"),
        new_km: row.get("new_km"),
        stations: row.get("stations"),
        new_stations: row.get("new_stations"),
        investment_eur: row.get("investment_eur"),
        annual_benefit_eur: row.get("annual_benefit_eur"),
        annual_fiscal_eur: row.get("annual_fiscal_eur"),
        benefit_cost_ratio: row.get("benefit_cost_ratio"),
        npv_eur: row.get("npv_eur"),
        population_served: row.get("population_served"),
        population_gain: row.get("population_gain"),
        co2_saved_t: row.get("co2_saved_t"),
        opening_year: row.try_get("opening_year").ok().flatten(),
        votes: row.get("votes"),
        views: row.get("views"),
        forks: row.get("forks"),
        comment_count: row.get("comment_count"),
        created_at: row.get("created_at"),
        published_at: row.try_get("published_at").ok().flatten(),
        parent_slug: row.try_get("parent_slug").ok().flatten(),
        calculation_version: row.get("calculation_version"),
        parameter_fingerprint: row.get("parameter_fingerprint"),
        data_version: row.get("data_version"),
    }
}

const SELECT_SUMMARY: &str = r#"
SELECT s.slug, s.city, s.title, s.description, s.visibility, s.network_km, s.new_km, s.stations,
       s.new_stations, s.investment_eur, s.annual_benefit_eur, s.annual_fiscal_eur,
       s.benefit_cost_ratio, s.npv_eur, s.population_served, s.population_gain, s.co2_saved_t, s.opening_year,
       s.votes, s.views, s.forks, s.comment_count, s.created_at, s.published_at,
       s.calculation_version, s.parameter_fingerprint, s.data_version,
       u.handle AS author_handle, u.display_name AS author_name,
       CASE WHEN p.visibility = 'public' AND p.hidden_at IS NULL THEN p.slug END AS parent_slug
FROM scenarios s
LEFT JOIN users u ON u.id = s.author_id
LEFT JOIN scenarios p ON p.id = s.parent_id
"#;

/// Turn a title into a URL slug, appending a short suffix for uniqueness.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    for c in title.trim().to_lowercase().chars() {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ if !out.ends_with('-') => out.push('-'),
            _ => {}
        }
    }
    let trimmed = out.trim_matches('-');
    let base: String = trimmed.chars().take(60).collect();
    let base = base.trim_matches('-');
    if base.is_empty() {
        "entwurf".into()
    } else {
        base.to_string()
    }
}

fn short_id() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// Parse, validate and recompute a client-supplied document.
fn evaluate(state: &AppState, document: &str) -> ApiResult<(ScenarioDocument, SimulationResult)> {
    if document.len() > MAX_DOCUMENT_BYTES {
        return Err(ApiError::BadRequest("Das Szenario ist zu groß.".into()));
    }
    let doc = ScenarioDocument::from_json(document)
        .map_err(|e| ApiError::BadRequest(format!("Ungültiges Szenario: {e}")))?;
    if doc.data_version != state.data_version {
        return Err(ApiError::BadRequest(format!(
            "Das Szenario nutzt den Datenstand {}, der Server rechnet mit {}.",
            doc.data_version, state.data_version
        )));
    }
    // Recompute with the server's own parameters, never the client's, and in
    // the metric plane that belongs to the scenario's city.
    let result = state.with_city(&doc.city, |city| {
        let forged = doc.network.status_not_backed_by(&city.base);
        if let Some(first) = forged.first() {
            return Err(ApiError::BadRequest(format!("Ungültiges Szenario: {first}")));
        }
        Ok(simulation::run(&doc.network, &city.data, &city.params))
    })??;
    Ok((doc, result))
}

pub async fn create(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Json(body): Json<SaveBody>,
) -> ApiResult<Json<ScenarioSummary>> {
    let user = claims.user_id()?;
    state
        .rate_limit(&format!("create:{user}"), 40, 3600)
        .await?;
    // An hourly limit still allows a thousand a day. A ceiling on how many one
    // account may hold at once bounds the storage a single person can occupy,
    // and is far above what anyone drawing networks by hand will reach.
    const MAX_PER_USER: i64 = 200;
    let held: i64 = sqlx::query_scalar("SELECT count(*) FROM scenarios WHERE author_id = $1")
        .bind(user)
        .fetch_one(&state.db)
        .await?;
    if held >= MAX_PER_USER {
        return Err(ApiError::BadRequest(format!(
            "Du hast bereits {held} Entwürfe, mehr als {MAX_PER_USER} gehen nicht. Lösche einen, um Platz zu schaffen."
        )));
    }
    if !matches!(body.visibility.as_str(), "private" | "unlisted" | "public") {
        return Err(ApiError::BadRequest("Unbekannte Sichtbarkeit.".into()));
    }
    let title = sanitize_line(&body.title, 120)?;
    let description = sanitize_optional(&body.description, 2000);
    let (doc, result) = evaluate(&state, &body.document)?;

    // Only a plan the author could have opened may be named as the parent:
    // otherwise the slug of someone's private or hidden plan would confirm it
    // exists and earn it a fork. Forking your own plan does not count as one.
    let parent: Option<(Uuid, Option<Uuid>)> = match body.parent.as_deref() {
        Some(slug) => sqlx::query(
            "SELECT id, author_id FROM scenarios
              WHERE slug = $1
                AND ((visibility <> 'private' AND hidden_at IS NULL) OR author_id = $2)",
        )
        .bind(slug)
        .bind(user)
        .fetch_optional(&state.db)
        .await?
        .map(|r| (r.get("id"), r.get("author_id"))),
        None => None,
    };
    let parent_id = parent.map(|(id, _)| id);

    let slug = format!("{}-{}", slugify(&title), short_id());
    let h = &result.headline;
    let published = if body.visibility == "public" {
        Some(Utc::now())
    } else {
        None
    };

    let row = sqlx::query(
        r#"INSERT INTO scenarios
            (slug, author_id, parent_id, title, description, visibility, document, result,
             calculation_version, data_version, network_km, new_km, stations, new_stations,
             investment_eur, annual_benefit_eur, annual_fiscal_eur, benefit_cost_ratio, npv_eur,
             population_served, population_gain, co2_saved_t, opening_year, published_at, city,
             parameter_fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
           RETURNING id"#,
    )
    .bind(&slug)
    .bind(user)
    .bind(parent_id)
    .bind(&title)
    .bind(&description)
    .bind(&body.visibility)
    .bind(serde_json::to_value(&doc)?)
    .bind(serde_json::to_value(&result)?)
    .bind(&result.calculation_version)
    .bind(&result.data_version)
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
    .bind(h.population_gain)
    .bind(h.co2_saved_t_per_year)
    .bind(h.opening_year)
    .bind(published)
    .bind(&doc.city)
    .bind(&result.parameter_fingerprint)
    .fetch_one(&state.db)
    .await?;
    let id: Uuid = row.get("id");

    if let Some((parent, parent_author)) = parent {
        if parent_author != Some(user) {
            sqlx::query("UPDATE scenarios SET forks = forks + 1 WHERE id = $1")
                .bind(parent)
                .execute(&state.db)
                .await?;
        }
    }
    state.cache.invalidate_prefix("list:");
    state.cache.invalidate_prefix("board:");
    // Heavy follow-up analysis runs out of band (plan §60).
    enqueue(&state, "scenario_indexed", serde_json::json!({ "id": id })).await?;

    let row = sqlx::query(&format!("{SELECT_SUMMARY} WHERE s.slug = $1"))
        .bind(&slug)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(summary_from_row(&row)))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    /// Restrict to one city. Absent means all of them.
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

/// Which orderings the API offers. A single "score" would flatten very
/// different kinds of merit into one number, which the plan explicitly rejects
/// (plan §43).
pub const SORTS: &[(&str, &str, &str)] = &[
    ("neu", "s.published_at DESC NULLS LAST", "Neueste"),
    ("beliebt", "s.votes DESC, s.views DESC", "Meiste Stimmen"),
    ("gesehen", "s.views DESC", "Meistgesehen"),
    ("geforkt", "s.forks DESC", "Meistgeforkt"),
    ("nutzen", "s.annual_benefit_eur DESC", "Größter Nutzen"),
    (
        "nkv",
        "s.benefit_cost_ratio DESC",
        "Bestes Nutzen-Kosten-Verhältnis",
    ),
    ("barwert", "s.npv_eur DESC", "Höchster Barwert"),
    ("fiskal", "s.annual_fiscal_eur DESC", "Größter Fiskaleffekt"),
    ("laenge", "s.new_km DESC", "Meiste neue Kilometer"),
    (
        "erschlossen",
        "s.population_gain DESC",
        "Meiste neu erschlossene Einwohner",
    ),
    (
        "schnell",
        "s.opening_year ASC NULLS LAST",
        "Schnellste Umsetzung",
    ),
    ("co2", "s.co2_saved_t DESC", "Größte CO₂-Wirkung"),
    ("guenstig", "s.investment_eur ASC", "Geringste Investition"),
];

/// The leaderboards, which are deliberately *not* just `SORTS` again.
///
/// A sort puts everything in an order; a board hands out a prize. That
/// difference matters for the two orderings where less is better. Sorted by
/// investment, the cheapest plan is whatever is smallest — and as a board that
/// is a race to the bottom with no floor: a 190 m tram stub costs 25 million
/// and opens in 2032, so it takes first place on both "cheapest" and "fastest"
/// and cannot be beaten except by drawing something even smaller. A minimum
/// size does not fix it either, it only moves the bottom: the winner is then
/// always the smallest plan still allowed in.
///
/// So those two boards measure something scale-free instead. What a euro
/// reaches, and how much line a plan delivers per year, are questions a stub
/// answers badly — which is the point. Both remain available as plain sorts on
/// the browse page, where ordering by absolute cost is exactly what someone
/// asked for.
///
/// The fourth field is each board's own precondition, and every board has one:
/// it may only rank a plan that actually scores on the metric it is about. That
/// is not decoration. Every published plan so far has a negative net present
/// value — none of them earns back what it costs — so "highest" on that board
/// meant "loses the least", and the stub's minus 25 million beat a real plan's
/// minus 5.7 billion. The same trap waits on every board whose figure can turn
/// negative: doing nothing scores zero, and zero beats a loss.
pub const BOARDS: &[BoardSpec] = &[
    ("beliebt", "s.votes DESC, s.views DESC", "Meiste Stimmen", "s.votes > 0"),
    ("gesehen", "s.views DESC", "Meistgesehen", "s.views > 0"),
    ("geforkt", "s.forks DESC", "Meistgeforkt", "s.forks > 0"),
    (
        "nutzen",
        "s.annual_benefit_eur DESC",
        "Größter Nutzen",
        "s.annual_benefit_eur > 0",
    ),
    (
        "nkv",
        "s.benefit_cost_ratio DESC",
        "Bestes Nutzen-Kosten-Verhältnis",
        "s.benefit_cost_ratio > 0",
    ),
    (
        "barwert",
        "s.npv_eur DESC",
        "Höchster Barwert",
        "s.npv_eur > 0",
    ),
    (
        "fiskal",
        "s.annual_fiscal_eur DESC",
        "Größter Fiskaleffekt",
        "s.annual_fiscal_eur > 0",
    ),
    ("laenge", "s.new_km DESC", "Meiste neue Kilometer", "s.new_km > 0"),
    (
        "erschlossen",
        "s.population_gain DESC",
        "Meiste neu erschlossene Einwohner",
        "s.population_gain > 0",
    ),
    (
        "zuegig",
        "s.new_km / (s.opening_year - $1)::float8 DESC",
        "Schnellster Ausbau",
        "s.opening_year > $1",
    ),
    (
        "co2",
        "s.co2_saved_t DESC",
        "Größte CO₂-Wirkung",
        "s.co2_saved_t > 0",
    ),
    (
        "erschliessung",
        "s.investment_eur / s.population_gain ASC",
        "Günstigste Erschließung",
        "s.population_gain > 0",
    ),
];

pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Vec<ScenarioSummary>>> {
    let sort_key = q.sort.as_deref().unwrap_or("neu");
    let order = SORTS
        .iter()
        .find(|(k, _, _)| *k == sort_key)
        .map(|(_, o, _)| *o)
        .ok_or_else(|| ApiError::BadRequest("Unbekannte Sortierung.".into()))?;
    let limit = q.limit.unwrap_or(24).clamp(1, 100);
    let offset = q.offset.unwrap_or(0).max(0);
    let cache_key = format!(
        "list:{sort_key}:{}:{}:{}:{limit}:{offset}",
        q.author.as_deref().unwrap_or(""),
        q.search.as_deref().unwrap_or(""),
        q.city.as_deref().unwrap_or("")
    );
    if let Some(hit) = state.cache.get(&cache_key) {
        return Ok(Json(serde_json::from_str(&hit)?));
    }

    let sql = format!(
        "{SELECT_SUMMARY}
         WHERE s.visibility = 'public' AND s.hidden_at IS NULL
           AND ($1::text IS NULL OR u.handle = $1)
           AND ($2::text IS NULL OR s.title ILIKE '%' || $2 || '%' OR s.description ILIKE '%' || $2 || '%')
           AND ($5::text IS NULL OR s.city = $5)
         ORDER BY {order}
         LIMIT $3 OFFSET $4"
    );
    let rows = sqlx::query(&sql)
        .bind(q.author.as_deref())
        .bind(q.search.as_deref())
        .bind(limit)
        .bind(offset)
        .bind(q.city.as_deref())
        .fetch_all(&state.db)
        .await?;
    let out: Vec<ScenarioSummary> = rows.iter().map(summary_from_row).collect();
    state
        .cache
        .put(&cache_key, serde_json::to_string(&out)?, 30);
    Ok(Json(out))
}

pub async fn get(
    State(state): State<AppState>,
    MaybeAuth(claims): MaybeAuth,
    Path(slug): Path<String>,
) -> ApiResult<Json<ScenarioDetail>> {
    let extra = sqlx::query(
        "SELECT id, author_id, visibility, document, result FROM scenarios
          WHERE slug = $1 AND hidden_at IS NULL",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;
    let id: Uuid = extra.get("id");
    let author_id: Option<Uuid> = extra.get("author_id");
    let visibility: String = extra.get("visibility");
    let viewer = claims.as_ref().and_then(|c| c.user_id().ok());

    if visibility == "private" && viewer != author_id {
        return Err(ApiError::NotFound);
    }

    // Counted once per caller per hour rather than per request, and before the
    // summary is read so the response shows the view it just recorded.
    let viewer_key = viewer
        .map(|v| v.to_string())
        .unwrap_or_else(|| "anon".into());
    if state
        .cache
        .get(&format!("view:{id}:{viewer_key}"))
        .is_none()
    {
        state
            .cache
            .put(&format!("view:{id}:{viewer_key}"), "1".into(), 3600);
        sqlx::query("UPDATE scenarios SET views = views + 1 WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await?;
    }

    let row = sqlx::query(&format!("{SELECT_SUMMARY} WHERE s.slug = $1"))
        .bind(&slug)
        .fetch_one(&state.db)
        .await?;
    let summary = summary_from_row(&row);

    let voted = match viewer {
        Some(v) => {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM votes WHERE scenario_id = $1 AND user_id = $2",
            )
            .bind(id)
            .bind(v)
            .fetch_one(&state.db)
            .await?
                > 0
        }
        None => false,
    };

    Ok(Json(ScenarioDetail {
        can_edit: viewer.is_some() && viewer == author_id,
        voted,
        document: extra.get("document"),
        result: extra.get("result"),
        summary,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub visibility: Option<String>,
    pub document: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
    Json(body): Json<UpdateBody>,
) -> ApiResult<Json<ScenarioSummary>> {
    let user = claims.user_id()?;
    // A changed document is computed in full, like a new one, so editing is
    // limited like publishing. `recalculate` goes through here as well.
    state
        .rate_limit(&format!("update:{user}"), 120, 3600)
        .await?;
    let owner: Option<Uuid> = sqlx::query_scalar("SELECT author_id FROM scenarios WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    if owner != Some(user) && !claims.is_moderator() {
        return Err(ApiError::Forbidden);
    }

    if let Some(title) = &body.title {
        let t = sanitize_line(title, 120)?;
        sqlx::query("UPDATE scenarios SET title = $2, updated_at = now() WHERE slug = $1")
            .bind(&slug)
            .bind(&t)
            .execute(&state.db)
            .await?;
    }
    if let Some(description) = &body.description {
        let d = sanitize_optional(description, 2000);
        sqlx::query("UPDATE scenarios SET description = $2, updated_at = now() WHERE slug = $1")
            .bind(&slug)
            .bind(&d)
            .execute(&state.db)
            .await?;
    }
    if let Some(visibility) = &body.visibility {
        if !matches!(visibility.as_str(), "private" | "unlisted" | "public") {
            return Err(ApiError::BadRequest("Unbekannte Sichtbarkeit.".into()));
        }
        sqlx::query(
            "UPDATE scenarios
                SET visibility = $2,
                    published_at = CASE WHEN $2 = 'public' AND published_at IS NULL THEN now() ELSE published_at END,
                    updated_at = now()
              WHERE slug = $1",
        )
        .bind(&slug)
        .bind(visibility)
        .execute(&state.db)
        .await?;
    }
    if let Some(document) = &body.document {
        let (doc, result) = evaluate(&state, document)?;
        let h = &result.headline;
        sqlx::query(
            r#"UPDATE scenarios SET document = $2, result = $3, calculation_version = $4,
                   network_km = $5, new_km = $6, stations = $7, new_stations = $8,
                   investment_eur = $9, annual_benefit_eur = $10, annual_fiscal_eur = $11,
                   benefit_cost_ratio = $12, npv_eur = $13, population_served = $14,
                   co2_saved_t = $15, opening_year = $16, population_gain = $17,
                   city = $18, parameter_fingerprint = $19, data_version = $20,
                   updated_at = now()
               WHERE slug = $1"#,
        )
        .bind(&slug)
        .bind(serde_json::to_value(&doc)?)
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
        .bind(h.population_gain)
        .bind(&doc.city)
        .bind(&result.parameter_fingerprint)
        .bind(&result.data_version)
        .execute(&state.db)
        .await?;
    }

    state.cache.invalidate_prefix("list:");
    state.cache.invalidate_prefix("board:");
    let row = sqlx::query(&format!("{SELECT_SUMMARY} WHERE s.slug = $1"))
        .bind(&slug)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(summary_from_row(&row)))
}

pub async fn remove(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    let owner: Option<Uuid> = sqlx::query_scalar("SELECT author_id FROM scenarios WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    if owner != Some(user) && !claims.is_moderator() {
        return Err(ApiError::Forbidden);
    }
    // The parent counted this plan as a fork when it was made, so it stops
    // counting it now, under the same rule: your own forks never counted.
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE scenarios p SET forks = GREATEST(0, p.forks - 1)
           FROM scenarios s
          WHERE s.slug = $1 AND p.id = s.parent_id
            AND p.author_id IS DISTINCT FROM s.author_id",
    )
    .bind(&slug)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM scenarios WHERE slug = $1")
        .bind(&slug)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.cache.invalidate_prefix("list:");
    state.cache.invalidate_prefix("board:");
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Fork: a new scenario carrying the ancestry of the original (plan §41).
pub async fn fork(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
) -> ApiResult<Json<ScenarioSummary>> {
    let user = claims.user_id()?;
    state.rate_limit(&format!("fork:{user}"), 60, 3600).await?;
    let row = sqlx::query(
        "SELECT id, title, document, visibility FROM scenarios WHERE slug = $1 AND hidden_at IS NULL",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;
    let visibility: String = row.get("visibility");
    if visibility == "private" {
        return Err(ApiError::NotFound);
    }
    let parent_id: Uuid = row.get("id");
    let title: String = row.get("title");
    let document: Value = row.get("document");
    let doc: ScenarioDocument = serde_json::from_value(document)?;
    let forked = doc.fork(format!("{title} (Fork)"));

    let body = SaveBody {
        title: forked.title.clone(),
        description: format!("Abgeleitet von „{title}“."),
        document: forked
            .to_json()
            .map_err(|e| ApiError::BadRequest(e.to_string()))?,
        visibility: "private".into(),
        parent: Some(slug.clone()),
    };
    let _ = parent_id;
    create(State(state), Auth(claims), Json(body)).await
}

pub async fn vote(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    state.rate_limit(&format!("vote:{user}"), 200, 3600).await?;
    // One vote per account per scenario is not a defence against many accounts.
    // A service-wide ceiling is what a distributed vote flood runs into.
    state
        .global_limit(
            "votes",
            crate::state::hourly_ceiling("votes", 3000),
            3600,
            "Gerade wird ungewöhnlich viel abgestimmt. Damit die Ranglisten etwas \
             bedeuten, pausiert das Abstimmen kurz.",
        )
        .await?;
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM scenarios WHERE slug = $1 AND visibility <> 'private' AND hidden_at IS NULL",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;

    // The vote and the counter change together: a request that failed between
    // the two left a vote that the counter did not show, for ever.
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO votes (scenario_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(user)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted > 0 {
        sqlx::query("UPDATE scenarios SET votes = votes + 1 WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let votes: i32 = sqlx::query_scalar("SELECT votes FROM scenarios WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    state.cache.invalidate_prefix("board:");
    Ok(Json(serde_json::json!({ "voted": true, "votes": votes })))
}

pub async fn unvote(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    // A private plan answered "not found" to a vote but told anyone who
    // withdrew one that it exists and how many votes it has. Whoever voted
    // while it was visible can still withdraw that vote.
    let id: Uuid = sqlx::query_scalar(
        "SELECT s.id FROM scenarios s
          WHERE s.slug = $1
            AND ((s.visibility <> 'private' AND s.hidden_at IS NULL)
                 OR s.author_id = $2
                 OR EXISTS (SELECT 1 FROM votes v WHERE v.scenario_id = s.id AND v.user_id = $2))",
    )
    .bind(&slug)
    .bind(user)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;
    let mut tx = state.db.begin().await?;
    let removed = sqlx::query("DELETE FROM votes WHERE scenario_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if removed > 0 {
        sqlx::query("UPDATE scenarios SET votes = GREATEST(0, votes - 1) WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let votes: i32 = sqlx::query_scalar("SELECT votes FROM scenarios WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    state.cache.invalidate_prefix("board:");
    Ok(Json(serde_json::json!({ "voted": false, "votes": votes })))
}

// ------------------------------------------------------------- comments ----

#[derive(Debug, Serialize)]
pub struct Comment {
    pub id: Uuid,
    pub body: String,
    pub author: Option<String>,
    pub author_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn comments(
    State(state): State<AppState>,
    MaybeAuth(claims): MaybeAuth,
    Path(slug): Path<String>,
) -> ApiResult<Json<Vec<Comment>>> {
    // Guarded exactly as the scenario itself is.
    //
    // `add_comment` refuses to write on a private plan, so this read looked
    // safe: there could be nothing there to leak. But visibility is not fixed
    // at creation. Publish a plan, collect a discussion, then set it back to
    // private, and the plan answered 404 while every comment on it — the text
    // and the handle of whoever wrote it — stayed readable to anyone with the
    // slug, signed in or not.
    //
    // A hidden scenario is treated the same way: moderation that leaves the
    // conversation behind has not hidden anything.
    let scenario = sqlx::query("SELECT author_id, visibility FROM scenarios WHERE slug = $1 AND hidden_at IS NULL")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    let author_id: Option<Uuid> = scenario.get("author_id");
    let visibility: String = scenario.get("visibility");
    let viewer = claims.as_ref().and_then(|c| c.user_id().ok());
    let moderator = claims.as_ref().is_some_and(|c| c.is_moderator());
    if visibility == "private" && viewer != author_id && !moderator {
        return Err(ApiError::NotFound);
    }

    let rows = sqlx::query(
        "SELECT c.id, c.body, c.created_at, u.handle, u.display_name
           FROM comments c
           JOIN scenarios s ON s.id = c.scenario_id
           LEFT JOIN users u ON u.id = c.author_id
          WHERE s.slug = $1 AND c.hidden_at IS NULL
          ORDER BY c.created_at",
    )
    .bind(&slug)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| Comment {
                id: r.get("id"),
                body: r.get("body"),
                author: r.try_get("handle").ok(),
                author_name: r.try_get("display_name").ok(),
                created_at: r.get("created_at"),
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CommentBody {
    pub body: String,
}

pub async fn add_comment(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
    Json(body): Json<CommentBody>,
) -> ApiResult<Json<Comment>> {
    let user = claims.user_id()?;
    state
        .rate_limit(&format!("comment:{user}"), 30, 3600)
        .await?;
    let text = sanitize_text(&body.body, 4000)?;
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM scenarios WHERE slug = $1 AND visibility = 'public' AND hidden_at IS NULL",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;

    let row = sqlx::query(
        "INSERT INTO comments (scenario_id, author_id, body) VALUES ($1, $2, $3)
         RETURNING id, created_at",
    )
    .bind(id)
    .bind(user)
    .bind(&text)
    .fetch_one(&state.db)
    .await?;
    sqlx::query("UPDATE scenarios SET comment_count = comment_count + 1 WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(Comment {
        id: row.get("id"),
        body: text,
        author: Some(claims.handle.clone()),
        author_name: None,
        created_at: row.get("created_at"),
    }))
}

pub async fn hide_comment(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    let author: Option<Uuid> = sqlx::query_scalar("SELECT author_id FROM comments WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    if author != Some(user) && !claims.is_moderator() {
        return Err(ApiError::Forbidden);
    }
    sqlx::query("UPDATE comments SET hidden_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "hidden": true })))
}

#[derive(Debug, Deserialize)]
pub struct ReportBody {
    pub reason: String,
}

pub async fn report(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
    Json(body): Json<ReportBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    state
        .rate_limit(&format!("report:{user}"), 20, 3600)
        .await?;
    let reason = sanitize_text(&body.reason, 1000)?;
    // Only what others can see can be reported; for anything else the answer
    // would tell a stranger that a private plan of that name exists.
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM scenarios
          WHERE slug = $1 AND visibility <> 'private' AND hidden_at IS NULL",
    )
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    sqlx::query("INSERT INTO reports (scenario_id, reporter_id, reason) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(user)
        .bind(&reason)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "reported": true })))
}

// ---------------------------------------------------------- leaderboards ---

/// One board's definition: key, ordering, label, and the condition a plan must
/// meet to be ranked on it at all.
type BoardSpec = (&'static str, &'static str, &'static str, &'static str);

#[derive(Debug, Serialize, Deserialize)]
pub struct Board {
    pub key: String,
    pub label: String,
    pub entries: Vec<ScenarioSummary>,
}

#[derive(Debug, Deserialize)]
pub struct BoardQuery {
    /// Rank within one city. Absent mixes them, which the browse page offers as
    /// "Alle" — worth knowing that the boards measuring absolute size then
    /// mostly report which city is larger.
    #[serde(default)]
    pub city: Option<String>,
}

pub async fn leaderboards(
    State(state): State<AppState>,
    Query(q): Query<BoardQuery>,
) -> ApiResult<Json<Vec<Board>>> {
    let city = q.city.filter(|c| !c.is_empty());
    // An unknown city would otherwise come back as twelve empty boards, which
    // looks like "nobody has published anything" rather than a typo.
    if let Some(c) = &city {
        state.city(c)?;
    }
    let cache_key = format!("board:{}", city.as_deref().unwrap_or("alle"));
    if let Some(hit) = state.cache.get(&cache_key) {
        return Ok(Json(serde_json::from_str(&hit)?));
    }
    // The year the model starts planning from, which the "Schnellster Ausbau"
    // board divides by. Every city is expected to share it, and startup warns
    // if one ever stops, rather than letting the board quietly rank two cities
    // against different clocks.
    let base = state
        .cities
        .get(&state.default_city)
        .map(|c| c.params.timeline.planning_start_year)
        .unwrap_or(2026);

    let mut boards = Vec::new();
    for (key, order, label, guard) in BOARDS {
        let sql = format!(
            "{SELECT_SUMMARY}
             WHERE s.visibility = 'public' AND s.hidden_at IS NULL AND s.new_km > 0
               AND {guard}
               AND ($2::text IS NULL OR s.city = $2)
             ORDER BY {order} LIMIT 5"
        );
        // `$1` is only declared by the boards whose ordering divides by it, and
        // Postgres rejects a statement that binds a parameter it never mentions,
        // so the placeholder and the bind have to agree per board.
        let rows = if sql.contains("$1") {
            sqlx::query(&sql)
                .bind(base)
                .bind(city.as_deref())
                .fetch_all(&state.db)
                .await?
        } else {
            sqlx::query(&sql.replace("$2", "$1"))
                .bind(city.as_deref())
                .fetch_all(&state.db)
                .await?
        };
        boards.push(Board {
            key: (*key).to_string(),
            label: (*label).to_string(),
            entries: rows.iter().map(summary_from_row).collect(),
        });
    }
    state
        .cache
        .put(&cache_key, serde_json::to_string(&boards)?, 120);
    Ok(Json(boards))
}

// ------------------------------------------------------------ comparison ---

#[derive(Debug, Deserialize)]
pub struct CompareQuery {
    pub a: String,
    pub b: String,
}

pub async fn compare(
    State(state): State<AppState>,
    Query(q): Query<CompareQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let load = |slug: String| {
        let db = state.db.clone();
        async move {
            let row = sqlx::query(
                "SELECT title, result FROM scenarios WHERE slug = $1 AND visibility <> 'private' AND hidden_at IS NULL",
            )
            .bind(slug)
            .fetch_optional(&db)
            .await?
            .ok_or(ApiError::NotFound)?;
            let title: String = row.get("title");
            let result: Value = row.get("result");
            let parsed: SimulationResult = serde_json::from_value(result)?;
            Ok::<_, ApiError>((title, parsed))
        }
    };
    let (title_a, a) = load(q.a.clone()).await?;
    let (title_b, b) = load(q.b.clone()).await?;
    // The page's whole claim is that both columns come from the same
    // calculation. Usually true — but a scenario stored either side of a
    // recalibration carries the older figures until the sweep reaches it, and
    // presenting those as directly comparable would be the one dishonest thing
    // this page could do.
    let same_model = a.calculation_version == b.calculation_version
        && a.parameter_fingerprint == b.parameter_fingerprint;
    Ok(Json(serde_json::json!({
        "a": { "slug": q.a, "title": title_a, "calculationVersion": a.calculation_version },
        "b": { "slug": q.b, "title": title_b, "calculationVersion": b.calculation_version },
        "sameModel": same_model,
        "rows": simulation::compare(&a, &b),
    })))
}

/// Recompute a stored scenario with the current model (plan §38).
pub async fn recalculate(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let user = claims.user_id()?;
    let row = sqlx::query("SELECT author_id, document FROM scenarios WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    let owner: Option<Uuid> = row.get("author_id");
    if owner != Some(user) && !claims.is_moderator() {
        return Err(ApiError::Forbidden);
    }
    let document: Value = row.get("document");
    let doc: ScenarioDocument = serde_json::from_value(document)?;
    let json = doc
        .to_json()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let body = UpdateBody {
        title: None,
        description: None,
        visibility: None,
        document: Some(json),
    };
    let summary = update(State(state), Auth(claims), Path(slug), Json(body)).await?;
    Ok(Json(
        serde_json::json!({ "recalculated": true, "scenario": summary.0 }),
    ))
}

// ---------------------------------------------------------------- helpers --

/// Strip control characters and enforce a length. User text is rendered as
/// text, never as HTML, so escaping happens at the boundary — this is about
/// keeping the data clean (plan §70).
/// Characters that are invisible but change what the reader sees.
///
/// `char::is_control` covers only category Cc, so the Unicode *format*
/// characters walk straight through it — and the directional overrides among
/// them rewrite the display order of everything after them. A title submitted
/// as "Harmlos\u{202E}gnp.txt Zeile1" appeared in the list as
/// "HarmlosbaT 1elieZ txt.png": text the author never wrote. That is the
/// filename-spoofing trick, pointed at a list of proposals, and it is enough to
/// pass one plan off as another.
///
/// Dropped: the directional embeddings, overrides and isolates, plus the
/// zero-width space, byte-order mark and soft hyphen — none of which any title
/// needs. Kept: the left-to-right and right-to-left *marks*, which are weak
/// hints rather than overrides, and the zero-width joiner and non-joiner, which
/// carry meaning in Persian and Arabic and hold emoji sequences together.
fn is_invisible_formatting(c: char) -> bool {
    matches!(c,
        '\u{202A}'..='\u{202E}'   // LRE, RLE, PDF, LRO, RLO
        | '\u{2066}'..='\u{2069}' // isolates
        | '\u{200B}'              // zero-width space
        | '\u{FEFF}'              // byte-order mark
        | '\u{00AD}'              // soft hyphen
    )
}

pub fn sanitize_text(input: &str, max: usize) -> ApiResult<String> {
    let cleaned: String = input
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .filter(|c| !is_invisible_formatting(*c))
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Err(ApiError::BadRequest(
            "Der Text darf nicht leer sein.".into(),
        ));
    }
    if cleaned.chars().count() > max {
        return Err(ApiError::BadRequest(format!("Höchstens {max} Zeichen.")));
    }
    Ok(cleaned)
}

/// The same, for a field that is shown on one line.
///
/// A title with a newline in it is not a title; it breaks every card, badge and
/// page heading it appears in. Runs of whitespace collapse to a single space.
pub fn sanitize_line(input: &str, max: usize) -> ApiResult<String> {
    let joined = sanitize_text(input, max)?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if joined.is_empty() {
        return Err(ApiError::BadRequest(
            "Der Text darf nicht leer sein.".into(),
        ));
    }
    Ok(joined)
}

fn sanitize_optional(input: &str, max: usize) -> String {
    sanitize_text(input, max).unwrap_or_default()
}

pub async fn enqueue(state: &AppState, kind: &str, payload: serde_json::Value) -> ApiResult<()> {
    sqlx::query("INSERT INTO jobs (kind, payload) VALUES ($1, $2)")
        .bind(kind)
        .bind(payload)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_url_safe_and_german_aware() {
        assert_eq!(slugify("U5 nach Osdorf!"), "u5-nach-osdorf");
        assert_eq!(
            slugify("Straßenbahn für Eimsbüttel"),
            "strassenbahn-fuer-eimsbuettel"
        );
        assert_eq!(slugify("   "), "entwurf");
        assert_eq!(slugify("---"), "entwurf");
        assert!(slugify(&"a".repeat(200)).len() <= 60);
        assert!(!slugify("Ein  Titel").contains("--"));
    }

    #[test]
    fn short_ids_look_right() {
        let a = short_id();
        assert_eq!(a.len(), 6);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        // Ambiguous characters are excluded on purpose.
        assert!(!a.contains('l') && !a.contains('o') && !a.contains('0') && !a.contains('1'));
    }

    #[test]
    fn text_is_sanitised() {
        assert_eq!(
            sanitize_text("  hallo\u{0}welt  ", 100).unwrap(),
            "hallowelt"
        );
        assert_eq!(
            sanitize_text("zeile1\nzeile2", 100).unwrap(),
            "zeile1\nzeile2"
        );
        assert!(sanitize_text("   ", 100).is_err());
        assert!(sanitize_text("zu lang", 3).is_err());
    }

    /// Text that changes what the reader sees without being visible itself.
    #[test]
    fn invisible_formatting_is_removed() {
        // The exact title that displayed as "HarmlosbaT 1elieZ txt.png".
        let spoofed = sanitize_line("Harmlos\u{202E}gnp.txt\u{200B} Zeile1", 120).unwrap();
        assert_eq!(spoofed, "Harmlosgnp.txt Zeile1", "{spoofed:?}");
        // Every override and isolate, plus the invisible spacers.
        for c in [
            '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}', '\u{202E}', '\u{2066}', '\u{2067}',
            '\u{2068}', '\u{2069}', '\u{200B}', '\u{FEFF}', '\u{00AD}',
        ] {
            let out = sanitize_line(&format!("a{c}b"), 20).unwrap();
            assert_eq!(out, "ab", "U+{:04X} nicht entfernt", c as u32);
        }
        // But not the characters that carry meaning: an emoji family holds
        // together with zero-width joiners, and Persian needs the non-joiner.
        let kept = sanitize_line("\u{200D}\u{200C}\u{200E}x", 20).unwrap();
        assert!(kept.contains('\u{200D}') && kept.contains('\u{200C}'), "{kept:?}");
    }

    /// A title is shown on one line, so it has to be one line.
    #[test]
    fn a_title_is_a_single_line() {
        assert_eq!(
            sanitize_line("Zeile1\nZeile2\tTab   mehrfach", 120).unwrap(),
            "Zeile1 Zeile2 Tab mehrfach"
        );
        // The description keeps its paragraphs.
        assert_eq!(sanitize_text("a\nb", 100).unwrap(), "a\nb");
    }

    #[test]
    fn every_sort_key_is_unique_and_labelled() {
        let mut keys: Vec<&str> = SORTS.iter().map(|(k, _, _)| *k).collect();
        let n = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), n);
        assert!(SORTS.iter().all(|(_, _, label)| !label.is_empty()));
    }

    #[test]
    fn every_board_key_is_unique_and_labelled() {
        let mut keys: Vec<&str> = BOARDS.iter().map(|(k, ..)| *k).collect();
        let n = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), n);
        assert!(BOARDS.iter().all(|(_, _, label, _)| !label.is_empty()));
    }

    /// No board may rank by absolute cost or by opening year alone.
    ///
    /// Both make the smallest plan the winner, so the board stops being a prize
    /// for a good proposal and becomes one for the shortest stub someone can
    /// draw. The orderings stay available as sorts; this guards the boards.
    #[test]
    fn no_board_rewards_doing_less() {
        for (key, order, _, guard) in BOARDS {
            let asc_cost = order.contains("investment_eur") && order.contains("ASC");
            let bare_year = order.trim_start().starts_with("s.opening_year");
            assert!(
                !bare_year,
                "Brett \"{key}\" krönt den kleinsten Entwurf: nach Eröffnungsjahr allein \
                 gewinnt immer der kürzeste Stummel."
            );
            assert!(
                !asc_cost || order.contains('/'),
                "Brett \"{key}\" krönt den kleinsten Entwurf: aufsteigende Kosten ohne \
                 Bezugsgröße gewinnt, wer am wenigsten baut."
            );
            // Without a precondition, a plan that achieves nothing scores zero —
            // and zero wins any board whose figure has gone negative for every
            // real entry. That is how a 190 m stub came to lead the net present
            // value board with minus 25 million.
            assert!(
                !guard.is_empty(),
                "Brett \"{key}\" hat keine Bedingung: ein Entwurf ohne Wirkung stünde darin."
            );
            // The condition has to be about the figure the board ranks by, not
            // some unrelated column — otherwise it lets through exactly the
            // plans it was meant to keep out. "zuegig" divides by the years
            // since planning began and guards that divisor, which is why this
            // reads the guard's column rather than the ordering's first one.
            let column = guard
                .trim_start_matches("s.")
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("");
            assert!(
                !column.is_empty() && order.contains(column),
                "Brett \"{key}\" sortiert nach {order}, verlangt aber {guard} — eine Bedingung \
                 über eine andere Kennzahl lässt genau die Entwürfe zu, die sie fernhalten soll."
            );
        }
    }
}
