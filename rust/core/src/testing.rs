//! Deterministic fixtures shared by the unit tests.
//!
//! They are small synthetic networks and a small synthetic city, so the tests
//! stay fast and independent of the imported Hamburg dataset.

use crate::city::{
    Catchment as _Catchment, Centre, CityData, DataSource, DataVersion, DemographicGrid, Landmark,
    LandmarkKind, Street, WaterBody,
};
use crate::geo::Point;
use crate::model::*;

fn node(net: &mut Network, name: &str, p: Point, status: BuildStatus) -> NodeId {
    let id = NodeId(net.fresh_id());
    net.nodes.insert(
        id,
        Node {
            id,
            kind: NodeKind::Station,
            name: name.into(),
            geo: p.to_latlon(),
            schematic: p,
            source: if status == BuildStatus::InService {
                Source::Existing
            } else {
                Source::User
            },
            status,
            interchange: false,
            accessible: true,
            depth: StationDepth::Surface,
            external_id: None,
        },
    );
    id
}

fn edge(
    net: &mut Network,
    a: NodeId,
    b: NodeId,
    mode: Mode,
    infra: Infrastructure,
    status: BuildStatus,
) -> EdgeId {
    let id = EdgeId(net.fresh_id());
    let ga = net.nodes[&a].geo;
    let gb = net.nodes[&b].geo;
    let mut e = Edge {
        id,
        from: a,
        to: b,
        mode,
        infrastructure: infra,
        source: if status == BuildStatus::InService {
            Source::Existing
        } else {
            Source::User
        },
        status,
        geo: vec![ga, gb],
        schematic: vec![ga.to_metric(), gb.to_metric()],
        length_m: 0.0,
        tracks: 2,
        design_speed_kmh: 80.0,
        external_id: None,
        rebuilt: false,
    };
    e.recompute_length();
    net.edges.insert(id, e);
    id
}

fn line(net: &mut Network, label: &str, mode: Mode, edges: Vec<EdgeId>, source: Source) -> LineId {
    let id = LineId(net.fresh_id());
    net.lines.insert(
        id,
        Line {
            id,
            label: label.into(),
            name: label.into(),
            mode,
            color: "#2563EB".into(),
            source,
            edges,
            service: ServicePattern::default_for(mode),
            included: true,
            extends: None,
            note: String::new(),
            official_opening_year: None,
            construction_started_year: None,
            official_cost_eur: None,
            external_id: None,
        },
    );
    id
}

/// Two crossing in-service lines with five stations each.
pub fn demo_network() -> Network {
    let mut net = Network::new();
    let mut ns = Vec::new();
    for i in 0..6 {
        ns.push(node(
            &mut net,
            &format!("Halt {i}"),
            Point::new(-6000.0 + i as f64 * 2400.0, 0.0),
            BuildStatus::InService,
        ));
    }
    let mut es = Vec::new();
    for i in 0..5 {
        es.push(edge(
            &mut net,
            ns[i],
            ns[i + 1],
            Mode::Ubahn,
            Infrastructure::DeepTunnel,
            BuildStatus::InService,
        ));
    }
    line(&mut net, "U1", Mode::Ubahn, es, Source::Existing);

    let mut ms = Vec::new();
    for i in 0..5 {
        ms.push(node(
            &mut net,
            &format!("Nord {i}"),
            Point::new(1200.0, -4800.0 + i as f64 * 2400.0),
            BuildStatus::InService,
        ));
    }
    let mut fs = Vec::new();
    for i in 0..4 {
        fs.push(edge(
            &mut net,
            ms[i],
            ms[i + 1],
            Mode::Sbahn,
            Infrastructure::Surface,
            BuildStatus::InService,
        ));
    }
    line(&mut net, "S1", Mode::Sbahn, fs, Source::Existing);
    net
}

/// Two lines sharing a central node, so transfers can be tested.
pub fn demo_crossing_network() -> Network {
    let mut net = Network::new();
    let hub = node(
        &mut net,
        "Kreuz",
        Point::new(0.0, 0.0),
        BuildStatus::InService,
    );
    let w = node(
        &mut net,
        "West",
        Point::new(-3000.0, 0.0),
        BuildStatus::InService,
    );
    let e = node(
        &mut net,
        "Ost",
        Point::new(3000.0, 0.0),
        BuildStatus::InService,
    );
    let n = node(
        &mut net,
        "Nord",
        Point::new(0.0, 3000.0),
        BuildStatus::InService,
    );
    let s = node(
        &mut net,
        "Sued",
        Point::new(0.0, -3000.0),
        BuildStatus::InService,
    );
    let e1 = edge(
        &mut net,
        w,
        hub,
        Mode::Ubahn,
        Infrastructure::DeepTunnel,
        BuildStatus::InService,
    );
    let e2 = edge(
        &mut net,
        hub,
        e,
        Mode::Ubahn,
        Infrastructure::DeepTunnel,
        BuildStatus::InService,
    );
    let e3 = edge(
        &mut net,
        s,
        hub,
        Mode::Sbahn,
        Infrastructure::Surface,
        BuildStatus::InService,
    );
    let e4 = edge(
        &mut net,
        hub,
        n,
        Mode::Sbahn,
        Infrastructure::Surface,
        BuildStatus::InService,
    );
    line(&mut net, "U1", Mode::Ubahn, vec![e1, e2], Source::Existing);
    line(&mut net, "S1", Mode::Sbahn, vec![e3, e4], Source::Existing);
    net
}

/// A single brand-new line of the requested length, laid out east-west.
pub fn demo_new_line(mode: Mode, infra: Infrastructure, km: f64) -> Network {
    let mut net = demo_network();
    let spacing = match mode {
        Mode::Tram => 500.0,
        Mode::Sbahn => 1800.0,
        _ => 1000.0,
    };
    let count = ((km * 1000.0 / spacing).round() as usize).max(2);
    let step = km * 1000.0 / count as f64;
    let mut ns = Vec::new();
    for i in 0..=count {
        ns.push(node(
            &mut net,
            &format!("Neu {i}"),
            Point::new(-km * 500.0 + i as f64 * step, 3500.0),
            BuildStatus::ToBuild,
        ));
    }
    for n in &ns {
        net.nodes.get_mut(n).unwrap().depth = StationDepth::for_infrastructure(infra);
    }
    let mut es = Vec::new();
    for i in 0..count {
        es.push(edge(
            &mut net,
            ns[i],
            ns[i + 1],
            mode,
            infra,
            BuildStatus::ToBuild,
        ));
    }
    line(&mut net, "N1", mode, es, Source::User);
    net
}

/// A city with a uniform population field, no water, a few landmarks.
pub fn demo_city() -> CityData {
    let mut city = CityData::empty();
    city.version = DataVersion {
        id: "test".into(),
        city: "Teststadt".into(),
        sources: vec![DataSource {
            name: "synthetisch".into(),
            url: String::new(),
            licence: "n/a".into(),
            retrieved: "2026-09-01".into(),
            note: String::new(),
        }],
    };
    let cell = 250.0;
    let cols = 160;
    let rows = 160;
    let origin = -(cols as f64) * cell / 2.0;
    city.grid = DemographicGrid {
        cell_m: cell,
        origin_x: origin,
        origin_y: origin,
        cols,
        rows,
        // 500 residents per cell = 8000/km², a normal inner-city density.
        population: vec![500.0; cols * rows],
        jobs: vec![160.0; cols * rows],
    };
    for (i, (name, x, y, w)) in [
        ("Rathaus", 0.0, 0.0, 0.9),
        ("Universität", -2500.0, 1500.0, 0.8),
        ("Klinikum", 3000.0, 2000.0, 0.7),
        ("Stadion", -4000.0, -3000.0, 0.65),
        ("Nordpark", 500.0, 4200.0, 0.5),
        ("Messe", 2200.0, 3600.0, 0.55),
    ]
    .into_iter()
    .enumerate()
    {
        city.landmarks.push(Landmark {
            id: format!("lm{i}"),
            name: name.into(),
            kind: LandmarkKind::Poi,
            geo: Point::new(x, y).to_latlon(),
            weight: w,
            modes: vec![],
            category: "Test".into(),
        });
    }
    for i in 0..40 {
        let y = -6000.0 + i as f64 * 320.0;
        city.streets.push(Street {
            name: format!("Straße {i}"),
            class: 3,
            geo: vec![
                Point::new(-9000.0, y).to_latlon(),
                Point::new(9000.0, y).to_latlon(),
            ],
        });
    }
    city.centres = vec![
        Centre {
            name: "Zentrum".into(),
            geo: Point::new(0.0, 0.0).to_latlon(),
            jobs: 120_000.0,
            primary: true,
        },
        Centre {
            name: "Nord".into(),
            geo: Point::new(0.0, 4800.0).to_latlon(),
            jobs: 40_000.0,
            primary: false,
        },
    ];
    city.prepare();
    city
}

/// The same city with a 400 m wide river running north–south at x ≈ 2000 m.
pub fn demo_city_with_river() -> CityData {
    let mut city = demo_city();
    city.water.push(WaterBody {
        name: "Teststrom".into(),
        ring: vec![
            Point::new(1800.0, -12000.0).to_latlon(),
            Point::new(2200.0, -12000.0).to_latlon(),
            Point::new(2200.0, 12000.0).to_latlon(),
            Point::new(1800.0, 12000.0).to_latlon(),
        ],
        major: true,
    });
    city.prepare();
    city
}

/// A new S-Bahn segment that crosses the test river.
pub fn demo_line_over_river() -> Network {
    let mut net = Network::new();
    let a = node(
        &mut net,
        "Westufer",
        Point::new(0.0, 6000.0),
        BuildStatus::ToBuild,
    );
    let b = node(
        &mut net,
        "Ostufer",
        Point::new(5000.0, 6000.0),
        BuildStatus::ToBuild,
    );
    let e = edge(
        &mut net,
        a,
        b,
        Mode::Sbahn,
        Infrastructure::Surface,
        BuildStatus::ToBuild,
    );
    line(&mut net, "N1", Mode::Sbahn, vec![e], Source::User);
    net
}

#[allow(unused)]
type Unused = _Catchment;
