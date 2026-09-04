//! The size limits exist to bound the cost of one analysis. If the limits or
//! the models change, this is what notices.
//!
//! Run with `--release`: the numbers only mean something optimised.

use hh_core::geo::Point;
use hh_core::model::*;
use hh_core::params::Params;
use hh_core::testing::demo_city;

/// A chain of `n` stations — the cheapest topology, so the timing here is a
/// lower bound on the worst case, not an average.
fn chain(n: usize) -> Network {
    let mut net = Network::new();
    let mut prev: Option<NodeId> = None;
    let mut edges = Vec::new();
    let cols = (n as f64).sqrt().ceil() as usize;
    for i in 0..n {
        let p = Point::new(
            (i % cols) as f64 * 700.0 - 8000.0,
            (i / cols) as f64 * 700.0 - 8000.0,
        );
        let id = NodeId(net.fresh_id());
        net.nodes.insert(
            id,
            Node {
                id,
                kind: NodeKind::Station,
                name: format!("S{i}"),
                geo: p.to_latlon(),
                schematic: p,
                source: Source::User,
                status: BuildStatus::ToBuild,
                interchange: false,
                accessible: true,
                depth: StationDepth::Surface,
                external_id: None,
            },
        );
        if let Some(a) = prev {
            let eid = EdgeId(net.fresh_id());
            let (ga, gb) = (net.nodes[&a].geo, net.nodes[&id].geo);
            let mut e = Edge {
                id: eid,
                from: a,
                to: id,
                mode: Mode::Ubahn,
                infrastructure: Infrastructure::Surface,
                source: Source::User,
                status: BuildStatus::ToBuild,
                geo: vec![ga, gb],
                schematic: vec![ga.to_metric(), gb.to_metric()],
                length_m: 0.0,
                tracks: 2,
                design_speed_kmh: 80.0,
                external_id: None,
            };
            e.recompute_length();
            net.edges.insert(eid, e);
            edges.push(eid);
        }
        prev = Some(id);
    }
    let lid = LineId(net.fresh_id());
    net.lines.insert(
        lid,
        Line {
            id: lid,
            label: "X".into(),
            name: "X".into(),
            mode: Mode::Ubahn,
            color: "#000000".into(),
            edges,
            service: ServicePattern::default_for(Mode::Ubahn),
            source: Source::User,
            included: true,
            note: String::new(),
            official_opening_year: None,
        construction_started_year: None,
            official_cost_eur: None,
            external_id: None,
        },
    );
    net
}

#[test]
fn a_network_at_the_limit_is_still_cheap_to_analyse() {
    let city = demo_city();
    let params = Params::default();
    let net = chain(3_000);
    net.check_size()
        .expect("3 000 Stationen müssen zulässig sein");
    let t = std::time::Instant::now();
    let _ = hh_core::simulation::run(&net, &city, &params);
    let ms = t.elapsed().as_millis();
    eprintln!("  3 000 Stationen: {ms} ms");
    // Only meaningful optimised — an unoptimised build is an order of
    // magnitude slower and would fail for no useful reason.
    if !cfg!(debug_assertions) {
        assert!(
            ms < 2_000,
            "Eine Analyse am Größenlimit dauert {ms} ms — das ist ein DoS-Vektor"
        );
    }
}

/// Asking how much of a line follows an existing railway must stay cheap.
///
/// It is asked for every section of every new line, and — since the timeline
/// started using it to decide how many work sites can be open at once — it is
/// asked on the path that answers while someone is still drawing. It used to
/// walk every corridor in the city and re-project each of its vertices from
/// degrees on every sampled point: for Hamburg that took the quick estimate
/// from well under a millisecond to 35 ms. The corridors are indexed now.
///
/// A generous bound rather than a tight one: this is here to catch a linear
/// scan coming back, not to police milliseconds.
#[test]
fn the_rail_corridor_query_is_indexed() {
    let mut city = demo_city();
    // Roughly a real city's railways: a couple of hundred corridors of a few
    // hundred points, spread across the map rather than stacked on top of one
    // another. A dense stack would make every cell hold every corridor and
    // measure the fixture instead of the index.
    city.rail = (0..200)
        .map(|c| hh_core::city::RailCorridor {
            name: String::new(),
            geo: (0..400)
                .map(|i| {
                    hh_core::geo::Point::new(
                        -9_000.0 + i as f64 * 45.0,
                        (c as f64 - 100.0) * 400.0,
                    )
                    .to_latlon()
                })
                .collect(),
        })
        .collect();
    city.prepare();

    let line: Vec<hh_core::geo::Point> = (0..40)
        .map(|i| hh_core::geo::Point::new(-9_000.0 + i as f64 * 450.0, 120.0))
        .collect();
    let _ = city.rail_corridor_share(&line, 70.0); // warm the index

    let t = std::time::Instant::now();
    for _ in 0..20 {
        let _ = city.rail_corridor_share(&line, 70.0);
    }
    let ms = t.elapsed().as_secs_f64() * 1e3 / 20.0;
    eprintln!("  Korridoranteil über 18 km: {ms:.2} ms");
    if !cfg!(debug_assertions) {
        assert!(
            ms < 20.0,
            "Der Korridoranteil dauert {ms:.1} ms — läuft die Abfrage wieder linear über alle Gleise?"
        );
    }
}

#[test]
fn an_oversized_network_is_rejected() {
    let net = chain(3_500);
    let err = net
        .check_size()
        .expect_err("zu groß, muss abgelehnt werden");
    assert!(err.0.contains("Knoten"), "{err}");
}
