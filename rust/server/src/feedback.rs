//! Bug reports and wishes, without a third party in the middle.
//!
//! The problem a captcha solves is that a form on the open internet is a gift to
//! anyone with a script. The usual answer sends every visitor's address and
//! browser to Google before they may speak, which for a service that collects no
//! address and loads nothing from anybody else would be a strange thing to start
//! with.
//!
//! So the cost is paid in arithmetic instead. The server hands out a challenge
//! it has signed; the browser looks for a nonce whose hash begins with enough
//! zero bits; the server checks the signature, the age and the work. It takes
//! about a second of one visitor's processor and nothing of their privacy, and
//! it makes a flood expensive in exactly the way a flood needs to be. The
//! signature means no challenge has to be stored, so a restart forgets nothing
//! and there is no table to fill up.

use crate::auth::{ClientIp, MaybeAuth};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Leading zero bits demanded of the hash. Eighteen is roughly a quarter of a
/// million tries: a moment in a browser, and real money at scale.
const DIFFICULTY: u32 = 18;
/// How long a challenge stays usable. Long enough to write a paragraph.
const VALID_SECS: u64 = 1800;

type HmacSha256 = Hmac<Sha256>;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sign(secret: &str, challenge: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac accepts any key");
    mac.update(challenge.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time comparison, so the signature cannot be guessed a byte at a time.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn leading_zero_bits(bytes: &[u8]) -> u32 {
    let mut n = 0;
    for b in bytes {
        n += b.leading_zeros();
        if *b != 0 {
            break;
        }
    }
    n
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    challenge: String,
    signature: String,
    difficulty: u32,
}

pub async fn challenge(State(state): State<AppState>) -> ApiResult<Json<Challenge>> {
    // The issued-at time is part of the challenge, so its age can be checked
    // without keeping a list of what was handed out.
    let nonce: u128 = rand::random();
    let challenge = format!("{}:{:032x}", now(), nonce);
    let signature = sign(&state.jwt_secret, &challenge);
    Ok(Json(Challenge {
        signature,
        challenge,
        difficulty: DIFFICULTY,
    }))
}

#[derive(Debug, Deserialize)]
pub struct FeedbackBody {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub page: Option<String>,
    pub challenge: String,
    pub signature: String,
    pub nonce: String,
}

fn check_work(state: &AppState, body: &FeedbackBody) -> ApiResult<()> {
    if !same(&sign(&state.jwt_secret, &body.challenge), &body.signature) {
        return Err(ApiError::BadRequest(
            "Die Aufgabe stammt nicht von hier.".into(),
        ));
    }
    let issued: u64 = body
        .challenge
        .split(':')
        .next()
        .and_then(|t| t.parse().ok())
        .ok_or_else(|| ApiError::BadRequest("Die Aufgabe ist unlesbar.".into()))?;
    let age = now().saturating_sub(issued);
    if age > VALID_SECS {
        return Err(ApiError::BadRequest(
            "Die Aufgabe ist abgelaufen. Bitte noch einmal absenden.".into(),
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(body.challenge.as_bytes());
    hasher.update(body.nonce.as_bytes());
    if leading_zero_bits(&hasher.finalize()) < DIFFICULTY {
        return Err(ApiError::BadRequest("Die Aufgabe ist nicht gelöst.".into()));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct Sent {
    pub received: bool,
    /// Whether it also went out by mail. False means it is stored and waiting,
    /// which is worth knowing but not worth troubling the sender with.
    pub mailed: bool,
}

pub async fn submit(
    State(state): State<AppState>,
    MaybeAuth(claims): MaybeAuth,
    ClientIp(ip): ClientIp,
    Json(body): Json<FeedbackBody>,
) -> ApiResult<Json<Sent>> {
    // The work is checked before the limit is spent, so a genuine sender whose
    // browser was slow is not punished for someone else's flood.
    check_work(&state, &body)?;
    state.rate_limit(&format!("feedback:{ip}"), 10, 3600).await?;

    let kind = match body.kind.as_str() {
        "fehler" | "wunsch" | "sonstiges" => body.kind.as_str(),
        _ => "sonstiges",
    };
    let message = body.message.trim();
    if message.len() < 5 {
        return Err(ApiError::BadRequest(
            "Bitte schreib einen Satz mehr, sonst lässt sich nichts damit anfangen.".into(),
        ));
    }
    if message.len() > 4000 {
        return Err(ApiError::BadRequest("Das ist zu lang.".into()));
    }
    let reply_to = body
        .reply_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 200)
        .map(str::to_string);

    let author = claims.as_ref().and_then(|c| c.user_id().ok());
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO feedback (kind, message, reply_to, page, author_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(kind)
    .bind(message)
    .bind(&reply_to)
    .bind(body.page.as_deref().unwrap_or("").chars().take(300).collect::<String>())
    .bind(author)
    .fetch_one(&state.db)
    .await?;

    let mailed = deliver(&state, kind, message, reply_to.as_deref()).await;
    if mailed {
        let _ = sqlx::query("UPDATE feedback SET mailed_at = now() WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await;
    } else {
        tracing::warn!(%id, "Rückmeldung gespeichert, aber nicht versandt");
    }
    Ok(Json(Sent {
        received: true,
        mailed,
    }))
}

/// Hands the message to the local mail transfer agent, where one is configured.
///
/// Deliberately not an SMTP client with credentials in the environment: that
/// means a password for the operator's own mailbox sitting in a container's
/// settings, which is a poor trade for a contact form. `HH_SENDMAIL` names a
/// program that takes the message on standard input, which is what a mail relay
/// on the host, `msmtp`, or a platform's own mail command all provide.
async fn deliver(state: &AppState, kind: &str, message: &str, reply_to: Option<&str>) -> bool {
    let (Ok(program), Ok(to)) = (
        std::env::var("HH_SENDMAIL"),
        std::env::var("HH_FEEDBACK_TO"),
    ) else {
        return false;
    };
    let _ = state;
    let subject = match kind {
        "fehler" => "Fehlermeldung",
        "wunsch" => "Wunsch",
        _ => "Rückmeldung",
    };
    let mail = format!(
        "To: {to}\nSubject: [Verkehrsnetz-Designer] {subject}\n{}Content-Type: text/plain; charset=utf-8\n\n{message}\n",
        reply_to
            .map(|r| format!("Reply-To: {r}\n"))
            .unwrap_or_default()
    );
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut parts = program.split_whitespace();
        let Some(bin) = parts.next() else {
            return false;
        };
        let Ok(mut child) = Command::new(bin)
            .args(parts)
            .arg("-t")
            .stdin(Stdio::piped())
            .spawn()
        else {
            return false;
        };
        if let Some(stdin) = child.stdin.as_mut() {
            if stdin.write_all(mail.as_bytes()).is_err() {
                return false;
            }
        }
        child.wait().map(|s| s.success()).unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_challenge_only_counts_with_its_own_signature() {
        let c = "1700000000:abcdef";
        assert!(same(&sign("geheim", c), &sign("geheim", c)));
        assert!(!same(&sign("geheim", c), &sign("anderes", c)));
        assert!(!same(&sign("geheim", c), &sign("geheim", "1700000000:abcdee")));
    }

    #[test]
    fn the_work_has_to_be_done() {
        // A hash of all zero bytes has every leading bit clear; a hash starting
        // with 0x80 has none.
        assert_eq!(leading_zero_bits(&[0x00, 0x00, 0xff]), 16);
        assert_eq!(leading_zero_bits(&[0x80]), 0);
        assert_eq!(leading_zero_bits(&[0x00, 0x3f]), 10);
        assert!(leading_zero_bits(&[0x00, 0x00, 0x00, 0x01]) >= DIFFICULTY);
    }
}
