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

use crate::auth::ClientIp;
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
#[serde(rename_all = "camelCase")]
pub struct FeedbackBody {
    pub kind: String,
    pub message: String,
    // The form has always sent `replyTo`; without the rename it was dropped on
    // the floor, and every "Du hörst von mir" was a promise nobody could keep.
    #[serde(default, alias = "reply_to")]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub page: Option<String>,
    pub challenge: String,
    pub signature: String,
    pub nonce: String,
}

/// Whether a reply address is plainly an address and nothing else.
///
/// It ends up in a mail header, so anything that could end a header line or
/// start a new one has to be out, and with it anything an address does not
/// need: no spaces, no angle brackets, no second `@`, no display name. That
/// refuses some addresses the RFC allows, none that a person types.
fn plain_address(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    let local_ok = !local.is_empty()
        && local.len() <= 64
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".!#$%&'*+/=?^_`{|}~-".contains(c));
    let domain_ok = domain.len() >= 3
        && domain.contains('.')
        && !domain.starts_with(['.', '-'])
        && !domain.ends_with(['.', '-'])
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    s.len() <= 200 && local_ok && domain_ok
}

/// A header value outside ASCII, written the way mail headers allow (RFC 2047),
/// so "Rückmeldung" arrives as itself rather than as whatever the relay makes of
/// raw UTF-8.
fn encoded_word(s: &str) -> String {
    if s.is_ascii() {
        return s.to_string();
    }
    let mut out = String::from("=?utf-8?Q?");
    for b in s.bytes() {
        match b {
            b' ' => out.push('_'),
            // The only characters RFC 2047 lets stand for themselves here.
            b if b.is_ascii_alphanumeric() || b"!*+-/".contains(&b) => out.push(b as char),
            b => out.push_str(&format!("={b:02X}")),
        }
    }
    out.push_str("?=");
    out
}

fn check_work(state: &AppState, body: &FeedbackBody) -> ApiResult<u64> {
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
    Ok(issued)
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
    ClientIp(ip): ClientIp,
    Json(body): Json<FeedbackBody>,
) -> ApiResult<Json<Sent>> {
    // The message is looked at first, so a sentence too short costs the sender
    // a correction rather than a second round of arithmetic.
    let kind = match body.kind.as_str() {
        "fehler" | "wunsch" | "sonstiges" => body.kind.as_str(),
        _ => "sonstiges",
    };
    // Counted in characters, as the database counts them: in bytes, four
    // thousand umlauts were "too long" at two thousand.
    let message = body.message.trim();
    let chars = message.chars().count();
    if chars < 5 {
        return Err(ApiError::BadRequest(
            "Bitte schreib einen Satz mehr, sonst lässt sich nichts damit anfangen.".into(),
        ));
    }
    if chars > 4000 {
        return Err(ApiError::BadRequest("Das ist zu lang.".into()));
    }
    let reply_to = body
        .reply_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(r) = reply_to {
        if !plain_address(r) {
            return Err(ApiError::BadRequest(
                "Die Antwortadresse sieht nicht wie eine E-Mail-Adresse aus.".into(),
            ));
        }
    }
    let reply_to = reply_to.map(str::to_string);

    // The work is checked before the limit is spent, so a genuine sender whose
    // browser was slow is not punished for someone else's flood.
    let issued = check_work(&state, &body)?;
    // A solved challenge is good for one message. The signature means nothing
    // is stored when it is handed out, so the spending has to be: one row, keyed
    // on the challenge and dated by its issue, which the hourly cleanup drops
    // long after the challenge itself has expired.
    let fresh: Option<i32> = sqlx::query_scalar(
        "INSERT INTO rate_limits (bucket, window_at, hits) VALUES ($1, to_timestamp($2), 1)
         ON CONFLICT (bucket, window_at) DO NOTHING RETURNING hits",
    )
    .bind(format!("feedback-work:{}", body.challenge))
    .bind(issued as f64)
    .fetch_optional(&state.db)
    .await?;
    if fresh.is_none() {
        return Err(ApiError::BadRequest(
            "Diese Aufgabe wurde schon verwendet. Bitte noch einmal absenden.".into(),
        ));
    }
    state.rate_limit(&format!("feedback:{ip}"), 10, 3600).await?;
    state
        .global_limit(
            "feedback",
            crate::state::hourly_ceiling("feedback", 300),
            3600,
            "Gerade kommen ungewöhnlich viele Rückmeldungen an. Bitte versuch es später noch einmal.",
        )
        .await?;

    // No account is attached, even for someone signed in: the form says it
    // needs none and tells nobody who is writing, and that should be true of
    // what is stored as well as of what is asked.
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO feedback (kind, message, reply_to, page)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(kind)
    .bind(message)
    .bind(&reply_to)
    .bind(body.page.as_deref().unwrap_or("").chars().take(300).collect::<String>())
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
    // Every header value here is either fixed, the operator's own setting, or
    // an address `plain_address` has already vouched for; the sender's text only
    // ever goes in the body.
    let mail = format!(
        "To: {to}\nSubject: {}\n{}MIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n{message}\n",
        encoded_word(&format!("[Verkehrsnetz-Designer] {subject}")),
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
        // The recipient is passed as an argument instead of read from the
        // headers with `-t`, so nothing in the message can add one. `-i` keeps a
        // line holding a single dot from ending the message early.
        let Ok(mut child) = Command::new(bin)
            .args(parts)
            .arg("-i")
            .arg("--")
            .arg(&to)
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
    fn only_a_plain_address_gets_into_a_header() {
        assert!(plain_address("anna@example.org"));
        assert!(plain_address("a.b+tag@sub.example.de"));
        assert!(!plain_address("anna@example.org\nBcc: x@y.z"));
        assert!(!plain_address("anna@example.org\r\nBcc: x@y.z"));
        assert!(!plain_address("Anna <anna@example.org>"));
        assert!(!plain_address("anna @example.org"));
        assert!(!plain_address("anna@localhost"));
        assert!(!plain_address("a@b@example.org"));
        assert!(!plain_address("@example.org"));
    }

    #[test]
    fn a_subject_with_umlauts_is_encoded() {
        assert_eq!(encoded_word("Wunsch"), "Wunsch");
        assert_eq!(
            encoded_word("[V] Rückmeldung"),
            "=?utf-8?Q?=5BV=5D_R=C3=BCckmeldung?="
        );
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
