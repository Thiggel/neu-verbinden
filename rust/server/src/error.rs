//! One error type for the whole API, mapped to sensible status codes and to
//! German messages, since that is the language of the product.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Anmeldung erforderlich")]
    Unauthorized,
    #[error("Dafür fehlen dir die Rechte")]
    Forbidden,
    #[error("Nicht gefunden")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("Zu viele Anfragen, bitte kurz warten")]
    TooManyRequests,
    /// Also 429, but the caller is not the one who overdid it: a service-wide
    /// ceiling has been reached. Saying "you made too many requests" to someone
    /// who has just arrived is both confusing and untrue.
    #[error("{0}")]
    ServiceBusy(String),
    #[error("Interner Fehler")]
    Internal(#[from] anyhow_lite::Error),
}

/// A tiny stand-in so the crate does not need the `anyhow` dependency.
pub mod anyhow_lite {
    #[derive(Debug)]
    pub struct Error(pub String);

    impl std::fmt::Display for Error {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.0)
        }
    }
    impl std::error::Error for Error {}

    impl From<sqlx::Error> for Error {
        fn from(e: sqlx::Error) -> Self {
            Error(e.to_string())
        }
    }
    impl From<serde_json::Error> for Error {
        fn from(e: serde_json::Error) -> Self {
            Error(e.to_string())
        }
    }
    impl From<jsonwebtoken::errors::Error> for Error {
        fn from(e: jsonwebtoken::errors::Error) -> Self {
            Error(e.to_string())
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => ApiError::NotFound,
            sqlx::Error::Database(db) if db.constraint().is_some() => {
                ApiError::Conflict(format!("Verstößt gegen {}", db.constraint().unwrap()))
            }
            _ => {
                tracing::error!(error = %e, "Datenbankfehler");
                ApiError::Internal(anyhow_lite::Error(e.to_string()))
            }
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::BadRequest(format!("Ungültige Daten: {e}"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooManyRequests | ApiError::ServiceBusy(_) => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self, "Interner Fehler");
        }
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
