//! Data import, model calibration and benchmarking.
//!
//! `hh import`     — turn the importer output into the domain network
//! `hh calibrate`  — check the models against published reference figures
//! `hh bench`      — timing on small, medium and city-scale networks
//! `hh simulate`   — run a scenario and print the analysis

mod dataset;
mod import;

use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("help");
    let root = env::var("HH_ROOT").unwrap_or_else(|_| "..".into());
    // Which city to work on. `--city=berlin` anywhere in the arguments, or
    // HH_CITY; Hamburg by default, whose files sit at the top of data/dist.
    let city = args
        .iter()
        .find_map(|a| a.strip_prefix("--city=").map(|c| c.to_lowercase()))
        .or_else(|| env::var("HH_CITY").ok().map(|c| c.to_lowercase()))
        .unwrap_or_else(|| "hamburg".into());
    import::set_city(&city);
    let result = match cmd {
        "import" => import::run(&root),
        "calibrate" => import::calibrate(&root),
        "bench" => import::bench(&root),
        "simulate" => import::simulate(
            &root,
            args.get(2)
                .map(String::as_str)
                .filter(|a| !a.starts_with("--")),
        ),
        "audit" => import::audit(
            &root,
            args.get(2)
                .map(String::as_str)
                .filter(|a| !a.starts_with("--")),
        ),
        _ => {
            eprintln!(
                "hh <command>\n\n  import     Domänennetz aus den Importdaten erzeugen\n  calibrate  Modelle gegen veröffentlichte Referenzwerte prüfen\n  bench      Laufzeiten messen\n  simulate [szenario]  Szenario rechnen und ausgeben\n  audit [linie]        Kostenherleitung einer Linie Position für Position"
            );
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Fehler: {e}");
            ExitCode::FAILURE
        }
    }
}
