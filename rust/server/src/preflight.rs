//! What must be true before this server is allowed to face the internet.
//!
//! Every setting here already had a safe default and a warning in the log. That
//! is the right behaviour on a laptop and the wrong one on a deployment: a
//! warning scrolls past during boot, and the service then runs for months with
//! an ephemeral signing key or a wide-open origin. Nobody reads a warning they
//! were not looking for.
//!
//! So `HH_ENV=production` turns those warnings into refusals. Development is
//! untouched: unset, everything behaves exactly as before.

/// A reason the process must not start.
#[derive(Debug, PartialEq, Eq)]
pub struct Fatal(pub String);

/// Reads one environment variable. Injected so the rules can be tested without
/// a process-wide environment, which no two tests can share.
pub type Env<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Whether this process considers itself deployed.
pub fn is_production(env: Env<'_>) -> bool {
    matches!(env("HH_ENV").as_deref(), Some("production" | "prod"))
}

/// Everything wrong with a production configuration, in the order it is worth
/// fixing. Empty means the process may start.
pub fn check(env: Env<'_>) -> Vec<Fatal> {
    let mut out = Vec::new();
    if !is_production(env) {
        return out;
    }
    // An ephemeral key is not weak, it is *forgotten*: every restart signs out
    // every user, and a platform restarts containers whenever it likes. A short
    // one is simply weak.
    match env("HH_JWT_SECRET") {
        None => out.push(Fatal(
            "HH_JWT_SECRET fehlt. Ohne festes Geheimnis wird bei jedem Neustart \
             ein neues erzeugt und alle Anmeldungen gelten nur bis dahin."
                .into(),
        )),
        Some(s) if s.trim().len() < 32 => out.push(Fatal(format!(
            "HH_JWT_SECRET ist mit {} Zeichen zu kurz; mindestens 32 werden verlangt.",
            s.trim().len()
        ))),
        Some(s) if s.contains("bitte-ersetzen") => out.push(Fatal(
            "HH_JWT_SECRET steht noch auf dem Beispielwert aus .env.example.".into(),
        )),
        Some(_) => {}
    }
    // The browser talks to this API directly, so the origin list is the whole
    // of its cross-site protection.
    match env("HH_ALLOWED_ORIGIN") {
        None => out.push(Fatal(
            "HH_ALLOWED_ORIGIN fehlt. Es gälte http://localhost:3000, und die \
             veröffentlichte Oberfläche käme nicht an die API."
                .into(),
        )),
        Some(o) if o.trim() == "*" => out.push(Fatal(
            "HH_ALLOWED_ORIGIN=* nimmt Anfragen von jeder Seite im Netz an, \
             mitsamt der Anmeldedaten der Besucher."
                .into(),
        )),
        Some(o) if o.starts_with("http://") && !o.contains("localhost") => out.push(Fatal(
            format!("HH_ALLOWED_ORIGIN={o} ist unverschlüsselt; Tokens gingen im Klartext."),
        )),
        Some(_) => {}
    }
    if env("DATABASE_URL").is_none() {
        out.push(Fatal(
            "DATABASE_URL fehlt. Es gälte die lokale Entwicklungsdatenbank.".into(),
        ));
    }
    out
}

/// Configuration that is allowed but worth saying out loud.
pub fn warnings(env: Env<'_>) -> Vec<String> {
    let mut out = Vec::new();
    if is_production(env) && env("HH_TRUST_PROXY").is_none() {
        // Every managed platform terminates TLS in front of the container. With
        // the header untrusted, every request carries the proxy's address, all
        // callers share one rate-limit bucket, and the first person to reach a
        // limit locks out everybody else.
        out.push(
            "HH_TRUST_PROXY ist nicht gesetzt. Hinter einem Proxy sieht der Server \
             nur dessen Adresse, alle Aufrufer teilen sich dann ein Limit."
                .into(),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| (*v).to_string())
        }
    }

    #[test]
    fn development_is_left_alone() {
        assert!(check(&env_of(&[])).is_empty());
        assert!(check(&env_of(&[("HH_ENV", "development")])).is_empty());
    }

    #[test]
    fn production_refuses_an_incomplete_configuration() {
        let problems = check(&env_of(&[("HH_ENV", "production")]));
        assert_eq!(problems.len(), 3, "{problems:?}");
    }

    #[test]
    fn a_complete_configuration_starts() {
        let ok = env_of(&[
            ("HH_ENV", "production"),
            ("HH_JWT_SECRET", "ein-wirklich-langes-zufaelliges-geheimnis"),
            ("HH_ALLOWED_ORIGIN", "https://netz.example"),
            ("DATABASE_URL", "postgres://host/db"),
        ]);
        assert!(check(&ok).is_empty(), "{:?}", check(&ok));
        assert_eq!(warnings(&ok).len(), 1, "der Proxy-Hinweis fehlt");
    }

    #[test]
    fn the_example_secret_does_not_count_as_one() {
        let problems = check(&env_of(&[
            ("HH_ENV", "production"),
            ("HH_JWT_SECRET", "bitte-ersetzen-durch-ein-langes-zufaelliges-geheimnis"),
            ("HH_ALLOWED_ORIGIN", "https://netz.example"),
            ("DATABASE_URL", "postgres://host/db"),
        ]));
        assert_eq!(problems.len(), 1, "{problems:?}");
    }

    #[test]
    fn a_wide_open_origin_is_fatal_in_production() {
        let problems = check(&env_of(&[
            ("HH_ENV", "production"),
            ("HH_JWT_SECRET", "ein-wirklich-langes-zufaelliges-geheimnis"),
            ("HH_ALLOWED_ORIGIN", "*"),
            ("DATABASE_URL", "postgres://host/db"),
        ]));
        assert_eq!(problems.len(), 1, "{problems:?}");
        // And plain http for a real host is refused too: the token travels on it.
        let insecure = check(&env_of(&[
            ("HH_ENV", "production"),
            ("HH_JWT_SECRET", "ein-wirklich-langes-zufaelliges-geheimnis"),
            ("HH_ALLOWED_ORIGIN", "http://netz.example"),
            ("DATABASE_URL", "postgres://host/db"),
        ]));
        assert_eq!(insecure.len(), 1, "{insecure:?}");
    }
}
