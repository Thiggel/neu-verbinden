//! Building track must never make the modelled city harder to get around.
//!
//! This runs against the real Hamburg dataset rather than a fixture, because
//! the failure it guards against only appears at real density: an employment
//! centre's accessibility used to be measured from the single *nearest*
//! station, so a new stop that landed closer to a centre than the interchange
//! it displaced moved that centre onto whatever branch the new stop was on.
//! Drawing one line could then wipe out the travel-time benefit of an entire
//! scenario — the largest item in any appraisal — and turn it into zero.
//!
//! Skipped when the dataset has not been built — set `HH_REQUIRE_DATA=1` to
//! make that skip an error instead.

use hh_core::city::CityData;
use hh_core::editor::{Command, Editor};
use hh_core::geo::with_origin;
use hh_core::model::{Mode, Network};
use hh_core::params::Params;

fn load() -> Option<(CityData, Network)> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/dist");
    let city = std::fs::read_to_string(format!("{root}/city-2026-09.json")).ok()?;
    let net = std::fs::read_to_string(format!("{root}/network-2026-09.json")).ok()?;
    Some((
        serde_json::from_str(&city).expect("Stadtdaten"),
        serde_json::from_str(&net).expect("Netz"),
    ))
}

#[test]
fn drawing_a_line_never_makes_the_city_slower() {
    // Skipping when the dataset has not been built keeps `cargo test` usable on
    // a fresh clone — but a skip that reports "ok" is a green tick for a check
    // that never ran. `HH_REQUIRE_DATA=1` turns it into a failure, which is what
    // a build that has just produced the datasets should set.
    let Some((mut city, net)) = load() else {
        assert!(
            std::env::var("HH_REQUIRE_DATA").is_err(),
            "HH_REQUIRE_DATA ist gesetzt, aber data/dist fehlt — dieser Test hat nichts geprüft"
        );
        eprintln!("Datensatz nicht gebaut — übersprungen");
        return;
    };
    let origin = city
        .projection_origin
        .map(|o| (o.lat, o.lon))
        .unwrap_or((hh_core::geo::ORIGIN_LAT, hh_core::geo::ORIGIN_LON));
    with_origin(origin.0, origin.1, || {
        city.prepare();
        let params = Params::default();
        let base = hh_core::demand::calculate(&net, &city, &params);

        // Four lines in different parts of the city, drawn one after another.
        // Each is short, and none is meant to be a good idea — the point is
        // that none of them may make the average journey longer.
        let corridors: [(Mode, [(f64, f64); 3]); 4] = [
            // Wilhelmsburg, south of the Elbe: sparse, poorly connected.
            (Mode::Ubahn, [(9.98, 53.49), (10.01, 53.47), (10.03, 53.46)]),
            // Along the harbour, beside the centre itself.
            (Mode::Tram, [(9.94, 53.55), (9.96, 53.545), (9.98, 53.544)]),
            // Out into the north-east.
            (Mode::Sbahn, [(10.09, 53.60), (10.13, 53.62), (10.17, 53.63)]),
            // A stub in the west that connects to little.
            (Mode::Tram, [(9.85, 53.58), (9.87, 53.585), (9.89, 53.59)]),
        ];

        let mut ed = Editor::new(net.clone(), city.clone(), params.clone());
        let mut previous = base.access_time_after_min;
        for (i, (mode, pts)) in corridors.iter().enumerate() {
            ed.apply(Command::DrawLine {
                mode: *mode,
                infrastructure: None,
                points: pts
                    .iter()
                    .map(|(lon, lat)| hh_core::geo::LatLon::new(*lat, *lon))
                    .collect(),
                label: Some(format!("Prüfstrecke {}", i + 1)),
                color: None,
                auto_stations: true,
                anchors: None,
            })
            .expect("Linie zeichnen");
            let r = hh_core::demand::calculate(&ed.network, &city, &params);
            assert!(
                r.access_time_after_min <= previous + 1e-6,
                "Strecke {} hat die mittlere Erreichbarkeit verschlechtert: \
                 {:.3} min statt {:.3} min",
                i + 1,
                r.access_time_after_min,
                previous
            );
            assert!(
                r.access_time_after_min <= r.access_time_before_min + 1e-6,
                "Strecke {}: Szenarionetz langsamer als der Bestand ({:.3} statt {:.3})",
                i + 1,
                r.access_time_after_min,
                r.access_time_before_min
            );
            assert!(
                r.hours_saved_per_day >= 0.0,
                "Strecke {}: negative Zeitersparnis",
                i + 1
            );
            previous = r.access_time_after_min;
        }
    });
}
