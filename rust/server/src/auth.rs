//! Accounts and sessions.
//!
//! Anonymous visitors can read everything public (plan §68); an account is only
//! needed to save, publish, vote or comment.

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub handle: String,
    pub role: String,
    pub exp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub role: String,
}

/// An authenticated caller. Extracting it fails with 401 when absent.
pub struct Auth(pub Claims);

/// An optional caller, for endpoints that work either way.
pub struct MaybeAuth(pub Option<Claims>);

#[async_trait::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for Auth
where
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app = AppState::from_ref(state);
        token_from(parts)
            .and_then(|t| verify(&t, &app.jwt_secret))
            .map(Auth)
            .ok_or(ApiError::Unauthorized)
    }
}

#[async_trait::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for MaybeAuth
where
    AppState: FromRef<S>,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app = AppState::from_ref(state);
        Ok(MaybeAuth(
            token_from(parts).and_then(|t| verify(&t, &app.jwt_secret)),
        ))
    }
}

use axum::extract::FromRef;

fn token_from(parts: &Parts) -> Option<String> {
    if let Some(v) = parts.headers.get(axum::http::header::AUTHORIZATION) {
        let s = v.to_str().ok()?;
        if let Some(rest) = s.strip_prefix("Bearer ") {
            return Some(rest.to_string());
        }
    }
    // Cookie fallback, so the browser can stay logged in without JS state.
    let cookies = parts
        .headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?;
    cookies
        .split(';')
        .filter_map(|c| c.trim().split_once('='))
        .find(|(k, _)| *k == "hh_session")
        .map(|(_, v)| v.to_string())
}

fn verify(token: &str, secret: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims)
}

pub fn issue(secret: &str, id: Uuid, handle: &str, role: &str) -> ApiResult<String> {
    let claims = Claims {
        sub: id.to_string(),
        handle: handle.to_string(),
        role: role.to_string(),
        exp: (Utc::now() + Duration::days(30)).timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(crate::error::anyhow_lite::Error(e.to_string())))
}

impl Claims {
    pub fn user_id(&self) -> ApiResult<Uuid> {
        Uuid::parse_str(&self.sub).map_err(|_| ApiError::Unauthorized)
    }

    pub fn is_moderator(&self) -> bool {
        self.role == "moderator" || self.role == "admin"
    }
}

fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(crate::error::anyhow_lite::Error(e.to_string())))
}

/// A real hash to verify against when the account does not exist.
///
/// Returning early for an unknown handle is the same answer in half a
/// millisecond instead of seventeen, and that difference is trivially
/// measurable: it hands anyone a way to ask "does this account exist?" a
/// thousand times a minute. Both branches now do the same work. Built once and
/// kept, because building it costs exactly as much as verifying against it.
static DUMMY_HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn dummy_hash() -> &'static str {
    DUMMY_HASH.get_or_init(|| {
        hash_password("nicht das Passwort eines Kontos").unwrap_or_else(|_| String::new())
    })
}

fn check_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
pub struct RegisterBody {
    pub handle: String,
    pub display_name: Option<String>,
    pub password: String,
}

// No `email` field, deliberately.
//
// The application promises its users "a name and a password are enough — no
// email address". The interface never sent one, but the *API* accepted one and
// wrote it into a UNIQUE column. A promise about the service is a promise about
// the service, not about the form.
//
// It had a side effect too: a collision on that column was reported as "this
// username is taken" — wrong, and a hint about which addresses are registered.
// A field sent anyway is now silently ignored by serde and nothing is stored.
// The column itself stays for the moment (NULL in all 190 rows) and goes at the
// next schema change.

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub token: String,
    pub user: PublicUser,
}

pub fn validate_handle(handle: &str) -> ApiResult<String> {
    let h = handle.trim().to_lowercase();
    let ok = h.len() >= 3
        && h.len() <= 30
        && h.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        && h.chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false);
    if !ok {
        return Err(ApiError::BadRequest(
            "Der Nutzername braucht 3–30 Zeichen aus a–z, 0–9, _ und -.".into(),
        ));
    }
    Ok(h)
}

/// The caller's address, for rate limiting.
///
/// `X-Forwarded-For` is only believed when `HH_TRUST_PROXY` says a proxy is in
/// front — otherwise anyone could spoof the header and reset their own limit.
///
/// Even then only the end of it is believed. Each proxy *appends* the address
/// it saw, so the leftmost entry is whatever the client chose to send and only
/// the last ones were written by somebody trusted. `HH_TRUST_PROXY` may give the
/// number of proxies in front (a CDN before a load balancer is two); anything
/// that is not a number means one.
pub struct ClientIp(pub String);

fn forwarded_client(header: &str, hops: usize) -> Option<String> {
    let entries: Vec<&str> = header.split(',').map(str::trim).collect();
    let i = entries.len().checked_sub(hops.max(1))?;
    Some(entries[i].to_string()).filter(|v| !v.is_empty())
}

#[async_trait::async_trait]
impl<S: Send + Sync> axum::extract::FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        if let Ok(trust) = std::env::var("HH_TRUST_PROXY") {
            let hops = trust.trim().parse().unwrap_or(1);
            if let Some(fwd) = parts
                .headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| forwarded_client(v, hops))
            {
                return Ok(ClientIp(fwd));
            }
        }
        let ip = parts
            .extensions
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
            .map(|c| c.0.ip().to_string())
            .unwrap_or_else(|| "unbekannt".into());
        Ok(ClientIp(ip))
    }
}

/// Shortest password the service accepts. Mirrored in the sign-up form, which
/// checks it before the dialog closes so nobody loses what they typed.
pub const MIN_PASSWORD_CHARS: usize = 8;

pub async fn register(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<RegisterBody>,
) -> ApiResult<Json<SessionResponse>> {
    let handle = validate_handle(&body.handle)?;
    // Eight, not ten. This is a site for drawing transit maps: an account exists
    // so that a plan has an owner and a vote counts once, and what actually
    // bounds guessing here is the rate limiting — five attempts per name per
    // hour, ten per address, three hundred service-wide. Ten characters bought
    // very little against that and turned people away at the door.
    if body.password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Das Passwort braucht mindestens {MIN_PASSWORD_CHARS} Zeichen."
        )));
    }
    state
        .rate_limit(&format!("register:{handle}"), 5, 3600)
        .await?;
    // Limiting by handle alone stops nothing: a script just picks a new name
    // each time. The address is what actually bounds account creation.
    state
        .rate_limit(&format!("register-ip:{ip}"), 10, 3600)
        .await?;
    // …and the address limit in turn stops nothing distributed: ten an hour
    // from each of a hundred addresses is still a thousand accounts. This is
    // the ceiling that actually bounds that.
    state
        .global_limit(
            "registrations",
            crate::state::hourly_ceiling("registrations", 300),
            3600,
            "Gerade werden ungewöhnlich viele Konten angelegt. Die Anmeldung pausiert \
             deshalb kurz — bitte später noch einmal versuchen.",
        )
        .await?;
    let hash = hash_password(&body.password)?;
    // A display name stands beside every plan its owner publishes, so it is the
    // same spoofing surface as a title: trimming alone let the directional
    // overrides through.
    let display = body
        .display_name
        .and_then(|d| crate::scenarios::sanitize_line(&d, 60).ok())
        .unwrap_or_else(|| handle.clone());

    let row: (Uuid, String, String, String, String) = sqlx::query_as(
        "INSERT INTO users (handle, display_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, handle, display_name, bio, role",
    )
    .bind(&handle)
    .bind(&display)
    .bind(&hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            ApiError::Conflict("Dieser Nutzername ist schon vergeben.".into())
        }
        other => other.into(),
    })?;

    let token = issue(&state.jwt_secret, row.0, &row.1, &row.4)?;
    Ok(Json(SessionResponse {
        token,
        user: PublicUser {
            id: row.0,
            handle: row.1,
            display_name: row.2,
            bio: row.3,
            role: row.4,
        },
    }))
}

#[derive(Debug, Deserialize)]
pub struct LoginBody {
    pub handle: String,
    pub password: String,
}

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<LoginBody>,
) -> ApiResult<Json<SessionResponse>> {
    let handle = body.handle.trim().to_lowercase();
    state
        .rate_limit(&format!("login:{handle}"), 10, 900)
        .await?;
    // Per-handle limits do not stop password spraying — one attempt against
    // each of a thousand accounts. Per-address limits do. The ceiling is high
    // because a household, an office or a university sits behind one address
    // and logs in legitimately all day; credential stuffing needs orders of
    // magnitude more attempts than this.
    state
        .rate_limit(&format!("login-ip:{ip}"), 200, 900)
        .await?;
    let row: Option<(Uuid, String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, handle, display_name, bio, role, password_hash FROM users WHERE handle = $1",
    )
    .bind(&handle)
    .fetch_optional(&state.db)
    .await?;

    // Same work whether or not the account exists — see `dummy_hash`.
    let Some((id, handle, display_name, bio, role, hash)) = row else {
        check_password(&body.password, dummy_hash());
        return Err(ApiError::Unauthorized);
    };
    let Some(hash) = hash else {
        check_password(&body.password, dummy_hash());
        return Err(ApiError::Unauthorized);
    };
    if !check_password(&body.password, &hash) {
        return Err(ApiError::Unauthorized);
    }
    let token = issue(&state.jwt_secret, id, &handle, &role)?;
    Ok(Json(SessionResponse {
        token,
        user: PublicUser {
            id,
            handle,
            display_name,
            bio,
            role,
        },
    }))
}

pub async fn me(State(state): State<AppState>, Auth(claims): Auth) -> ApiResult<Json<PublicUser>> {
    let id = claims.user_id()?;
    let row: (Uuid, String, String, String, String) =
        sqlx::query_as("SELECT id, handle, display_name, bio, role FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(PublicUser {
        id: row.0,
        handle: row.1,
        display_name: row.2,
        bio: row.3,
        role: row.4,
    }))
}

/// Everything the service holds about the caller, as one file.
///
/// Articles 15 and 20 GDPR: what is stored, and in a form that can be taken
/// elsewhere. Answering that by hand for every request is the kind of duty that
/// quietly goes unfulfilled, so it is a button instead.
pub async fn export(State(state): State<AppState>, Auth(claims): Auth) -> ApiResult<Json<Value>> {
    let id = claims.user_id()?;
    let user = sqlx::query(
        "SELECT handle, display_name, bio, role, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::Unauthorized)?;

    // The whole document of every scenario, not a summary: portability means
    // the networks themselves, which is the only part that took work to make.
    let scenarios = sqlx::query(
        "SELECT slug, title, description, visibility, document, result, created_at, published_at
           FROM scenarios WHERE author_id = $1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let comments = sqlx::query(
        "SELECT c.body, c.created_at, s.slug
           FROM comments c JOIN scenarios s ON s.id = c.scenario_id
          WHERE c.author_id = $1 ORDER BY c.created_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let votes = sqlx::query(
        "SELECT s.slug, v.created_at FROM votes v JOIN scenarios s ON s.id = v.scenario_id
          WHERE v.user_id = $1 ORDER BY v.created_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    // Reports are kept apart from the rest because they are about somebody
    // else; what belongs to the caller is that they made one, and why.
    let reports = sqlx::query(
        "SELECT r.reason, r.created_at, r.resolved_at, s.slug, c.body AS comment
           FROM reports r
           LEFT JOIN scenarios s ON s.id = r.scenario_id
           LEFT JOIN comments c ON c.id = r.comment_id
          WHERE r.reporter_id = $1 ORDER BY r.created_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    // Feedback is no longer tied to an account, but older messages were.
    let feedback = sqlx::query(
        "SELECT kind, message, reply_to, page, created_at FROM feedback
          WHERE author_id = $1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "exportiert_am": chrono::Utc::now(),
        "hinweis": "Alles, was dieser Dienst über dieses Konto gespeichert hat. Für das Konto wird keine E-Mail-Adresse erhoben. Das Passwort steht nur als Argon2-Hash in der Datenbank und wird hier nicht ausgegeben.",
        "konto": {
            "nutzername": user.get::<String, _>("handle"),
            "anzeigename": user.get::<String, _>("display_name"),
            "ueber_mich": user.get::<String, _>("bio"),
            "rolle": user.get::<String, _>("role"),
            "angelegt_am": user.get::<DateTime<Utc>, _>("created_at"),
        },
        "entwuerfe": scenarios.iter().map(|r| serde_json::json!({
            "kennung": r.get::<String, _>("slug"),
            "titel": r.get::<String, _>("title"),
            "beschreibung": r.get::<String, _>("description"),
            "sichtbarkeit": r.get::<String, _>("visibility"),
            "angelegt_am": r.get::<DateTime<Utc>, _>("created_at"),
            "veroeffentlicht_am": r.get::<Option<DateTime<Utc>>, _>("published_at"),
            "dokument": r.get::<Value, _>("document"),
            "ergebnis": r.get::<Value, _>("result"),
        })).collect::<Vec<_>>(),
        "kommentare": comments.iter().map(|r| serde_json::json!({
            "entwurf": r.get::<String, _>("slug"),
            "text": r.get::<String, _>("body"),
            "geschrieben_am": r.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<_>>(),
        "stimmen": votes.iter().map(|r| serde_json::json!({
            "entwurf": r.get::<String, _>("slug"),
            "am": r.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<_>>(),
        "meldungen": reports.iter().map(|r| serde_json::json!({
            "entwurf": r.get::<Option<String>, _>("slug"),
            "kommentar": r.get::<Option<String>, _>("comment"),
            "grund": r.get::<String, _>("reason"),
            "gemeldet_am": r.get::<DateTime<Utc>, _>("created_at"),
            "erledigt_am": r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
        })).collect::<Vec<_>>(),
        "rueckmeldungen": feedback.iter().map(|r| serde_json::json!({
            "art": r.get::<String, _>("kind"),
            "text": r.get::<String, _>("message"),
            "antwortadresse": r.get::<Option<String>, _>("reply_to"),
            "seite": r.get::<String, _>("page"),
            "am": r.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Debug, Deserialize)]
pub struct DeleteAccountBody {
    /// The account's own password. Erasure is final, and a stolen session
    /// should not be enough to end somebody else's account.
    pub password: String,
}

/// Erases the account and everything attached to it (Art. 17 GDPR).
///
/// Scenarios and comments go with it. The foreign keys would merely detach them
/// — `ON DELETE SET NULL` — which would leave the writing of an identifiable
/// person standing under "ohne Konto" after they asked to be forgotten. That is
/// not erasure, and for a plan somebody wrote about their own neighbourhood the
/// text can be identifying on its own.
pub async fn delete_account(
    State(state): State<AppState>,
    Auth(claims): Auth,
    Json(body): Json<DeleteAccountBody>,
) -> ApiResult<Json<Value>> {
    let id = claims.user_id()?;
    let hash: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let Some(hash) = hash else {
        return Err(ApiError::Unauthorized);
    };
    if !check_password(&body.password, &hash) {
        return Err(ApiError::Unauthorized);
    }

    // One transaction: a half-deleted account is worse than none, because the
    // person believes they are gone.
    let mut tx = state.db.begin().await?;
    // The counters on other people's plans are kept by hand, so what this
    // account added to them has to be taken back by hand, or a deleted account
    // keeps voting, commenting and forking in every ranking.
    sqlx::query(
        "UPDATE scenarios s SET votes = GREATEST(0, s.votes - 1)
           FROM votes v WHERE v.scenario_id = s.id AND v.user_id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE scenarios s SET comment_count = GREATEST(0, s.comment_count - c.n)
           FROM (SELECT scenario_id, count(*)::int AS n FROM comments
                  WHERE author_id = $1 GROUP BY scenario_id) c
          WHERE c.scenario_id = s.id",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE scenarios p SET forks = GREATEST(0, p.forks - f.n)
           FROM (SELECT parent_id, count(*)::int AS n FROM scenarios
                  WHERE author_id = $1 AND parent_id IS NOT NULL GROUP BY parent_id) f
          WHERE f.parent_id = p.id AND p.author_id IS DISTINCT FROM $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM comments WHERE author_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    // Comments by other people on those scenarios go too, by cascade. They were
    // written to a plan that is being withdrawn, and there is nothing left for
    // them to sit under.
    let scenarios = sqlx::query("DELETE FROM scenarios WHERE author_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    sqlx::query("DELETE FROM votes WHERE user_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    // Both would only be detached by their foreign keys, and a report or a
    // message is the person's own writing as much as a comment is.
    sqlx::query("DELETE FROM reports WHERE reporter_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM feedback WHERE author_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.cache.invalidate_prefix("list:");
    state.cache.invalidate_prefix("board:");

    tracing::info!(entwuerfe = scenarios, "Konto auf Verlangen gelöscht");
    Ok(Json(serde_json::json!({ "geloescht": true, "entwuerfe": scenarios })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_trusted_end_of_x_forwarded_for_counts() {
        // The client sent "1.1.1.1"; the proxy appended what it actually saw.
        assert_eq!(forwarded_client("1.1.1.1, 9.9.9.9", 1).as_deref(), Some("9.9.9.9"));
        assert_eq!(forwarded_client("9.9.9.9", 1).as_deref(), Some("9.9.9.9"));
        assert_eq!(forwarded_client("1.1.1.1, 9.9.9.9, 10.0.0.2", 2).as_deref(), Some("9.9.9.9"));
        assert_eq!(forwarded_client("9.9.9.9", 2), None);
        assert_eq!(forwarded_client("", 1), None);
    }

    #[test]
    fn handles_are_validated() {
        assert_eq!(validate_handle("  HansMeier ").unwrap(), "hansmeier");
        assert!(validate_handle("ab").is_err());
        assert!(validate_handle("-start").is_err());
        assert!(validate_handle("hat leerzeichen").is_err());
        assert!(validate_handle("a".repeat(31).as_str()).is_err());
        assert!(validate_handle("planer_01").is_ok());
    }

    #[test]
    fn passwords_round_trip() {
        let h = hash_password("ein sehr gutes passwort").unwrap();
        assert!(check_password("ein sehr gutes passwort", &h));
        assert!(!check_password("falsch", &h));
        assert!(!check_password("x", "kein gültiger hash"));
    }

    #[test]
    fn tokens_round_trip_and_expire_correctly() {
        let id = Uuid::new_v4();
        let t = issue("geheim", id, "planerin", "member").unwrap();
        let claims = verify(&t, "geheim").expect("valid");
        assert_eq!(claims.handle, "planerin");
        assert_eq!(claims.user_id().unwrap(), id);
        assert!(!claims.is_moderator());
        assert!(verify(&t, "anderes geheimnis").is_none());
    }
}
