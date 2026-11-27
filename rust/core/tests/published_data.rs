//! The published networks have to pass the same checks as a saved scenario,
//! because every scenario starts from them and the server refuses a document
//! that fails `Network::validate`.

use hh_core::model::Network;
use std::path::PathBuf;

fn dist(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/dist")
        .join(rel)
}

fn check(rel: &str) {
    let path = dist(rel);
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("{} fehlt, Test übersprungen", path.display());
        return;
    };
    let net: Network = serde_json::from_str(&text).expect("network parses");
    let problems = net.validate();
    assert!(
        problems.is_empty(),
        "{rel}: {} Probleme, etwa {:?}",
        problems.len(),
        &problems[..problems.len().min(5)]
    );
}

#[test]
fn hamburg_network_is_valid() {
    check("network-2026-09.json");
}

#[test]
fn berlin_network_is_valid() {
    check("berlin/network-2026-09.json");
}

/// The server refuses a plan whose "in service" or "under construction" track
/// does not lie on the published network. The published network itself, with
/// its curves sampled at a coarser step than the reference, must pass.
fn backed_by_itself(city_rel: &str, net_rel: &str) {
    let (Ok(city), Ok(net)) = (
        std::fs::read_to_string(dist(city_rel)),
        std::fs::read_to_string(dist(net_rel)),
    ) else {
        eprintln!("{net_rel} fehlt, Test übersprungen");
        return;
    };
    let city: serde_json::Value = serde_json::from_str(&city).expect("city parses");
    let o = &city["projectionOrigin"];
    let origin = (
        o["lat"].as_f64().expect("origin lat"),
        o["lon"].as_f64().expect("origin lon"),
    );
    let net: Network = serde_json::from_str(&net).expect("network parses");
    let problems =
        hh_core::geo::with_origin(origin.0, origin.1, || net.status_not_backed_by(&net));
    assert!(problems.is_empty(), "{net_rel}: {:?}", &problems[..problems.len().min(5)]);
}

#[test]
fn hamburg_network_backs_itself() {
    backed_by_itself("city-2026-09.json", "network-2026-09.json");
}

#[test]
fn berlin_network_backs_itself() {
    backed_by_itself("berlin/city-2026-09.json", "berlin/network-2026-09.json");
}

/// Two tram stops between Holstenwall and Neustadt, 190 m apart, in streets the
/// U-Bahn already serves, reach no one new. Each station counts its catchment
/// as if no other were near, so before new riders were bounded by the choice
/// model the stub gained 8 200 boardings a day and a benefit-cost ratio near
/// four, and led the leaderboard for it.
#[test]
fn a_stub_in_a_served_area_gains_no_riders() {
    use hh_core::city::CityData;
    use hh_core::editor::{Command, Editor};
    use hh_core::geo::LatLon;
    use hh_core::params::Params;
    use hh_core::scenario::ScenarioTemplate;

    let read = |rel: &str| std::fs::read_to_string(dist(rel));
    let (Ok(city), Ok(net), Ok(templates), Ok(params)) = (
        read("city-2026-09.json"),
        read("network-2026-09.json"),
        read("scenarios-2026-09.json"),
        read("params-2026-09.json"),
    ) else {
        eprintln!("Hamburger Daten fehlen, Test übersprungen");
        return;
    };
    let mut city: CityData = serde_json::from_str(&city).expect("city parses");
    city.prepare();
    let mut net: Network = serde_json::from_str(&net).expect("network parses");
    let templates: Vec<ScenarioTemplate> = serde_json::from_str(&templates).expect("templates parse");
    let params: Params = serde_json::from_str(&params).expect("params parse");
    let bestand = templates.iter().find(|t| t.id == "bestand").expect("bestand");
    for l in net.lines.values_mut() {
        l.included = l
            .external_id
            .as_ref()
            .is_some_and(|e| bestand.included_lines.contains(e));
    }

    let mut ed = Editor::new(net, city, params);
    let a = LatLon { lat: 53.553, lon: 9.975 };
    let b = LatLon { lat: 53.5535, lon: 9.979 };
    ed.apply(Command::DrawLine {
        mode: hh_core::model::Mode::Tram,
        infrastructure: None,
        points: vec![a, b],
        label: None,
        color: None,
        auto_stations: true,
        anchors: Some(vec![a, b]),
    })
    .expect("stub draws");
    let r = hh_core::simulation::run(&ed.network, &ed.city, &ed.params);
    assert!(
        r.demand.new_boardings_per_day < 100.0,
        "der Stummel gewinnt {:.0} neue Einsteiger am Tag",
        r.demand.new_boardings_per_day
    );
    assert!(
        r.appraisal.benefit_cost_ratio < 1.0,
        "der Stummel kommt auf ein Nutzen-Kosten-Verhältnis von {:.2}",
        r.appraisal.benefit_cost_ratio
    );
}
