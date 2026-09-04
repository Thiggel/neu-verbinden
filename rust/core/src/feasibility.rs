//! Buildability assessment (plan §26).
//!
//! The engine returns a classification with reasons, never a bare yes/no. Each
//! finding names the object it applies to so the UI can highlight it on the map.

use crate::city::CityData;
use crate::geo::{polyline_length, Point};
use crate::model::{BuildStatus, EdgeId, Infrastructure, Mode, Network, NodeId};
use crate::params::Params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Info,
    Caution,
    Warning,
    Blocking,
}

impl Severity {
    pub fn label_de(&self) -> &'static str {
        match self {
            Severity::Info => "Hinweis",
            Severity::Caution => "Zu beachten",
            Severity::Warning => "Kritisch",
            Severity::Blocking => "Nicht umsetzbar",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge: Option<EdgeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<NodeId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeasibilityClass {
    Straightforward,
    Demanding,
    Difficult,
    Critical,
}

impl FeasibilityClass {
    pub fn label_de(&self) -> &'static str {
        match self {
            FeasibilityClass::Straightforward => "Baulich unauffällig",
            FeasibilityClass::Demanding => "Anspruchsvoll",
            FeasibilityClass::Difficult => "Schwierig",
            FeasibilityClass::Critical => "Sehr kritisch",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeasibilityResult {
    pub class: FeasibilityClass,
    /// 0 = trivial, 1 = at the limit of what is buildable.
    pub score: f64,
    pub findings: Vec<Finding>,
    pub summary: String,
}

pub fn calculate(net: &Network, city: &CityData, params: &Params) -> FeasibilityResult {
    let f = &params.feasibility;
    let mut findings: Vec<Finding> = Vec::new();
    let mut score = 0.0f64;
    let mut to_build_km = 0.0;
    let mut outside_km = 0.0;
    let mut coarse_km = 0.0;

    for eid in net.active_edges() {
        let Some(e) = net.edges.get(&eid) else {
            continue;
        };
        if e.status == BuildStatus::InService {
            continue;
        }
        let pts: Vec<Point> = e.geo.iter().map(|p| p.to_metric()).collect();
        let len = polyline_length(&pts);
        to_build_km += len / 1000.0;
        let label = format!(
            "{} – {}",
            net.nodes
                .get(&e.from)
                .map(|n| n.name.as_str())
                .unwrap_or("?"),
            net.nodes.get(&e.to).map(|n| n.name.as_str()).unwrap_or("?")
        );

        // Beyond the edge of the datasets there is nothing to judge, no
        // population raster, no water, no buildings, no railways. Saying
        // "baulich unauffällig" there states that nothing is in the way, when
        // the truth is that nothing is known. A line drawn out into the North
        // Sea came back structurally unremarkable, priced to the euro.
        let (outside, coarse) = {
            let step = 500.0;
            let n = ((len / step).ceil() as usize).max(1);
            let (mut unknown, mut rough) = (0usize, 0usize);
            for i in 0..n {
                let p = crate::geo::point_at_distance(&pts, (i as f64 + 0.5) * step);
                if !city.covers(p) {
                    unknown += 1;
                } else if city.only_coarsely_covered(p) {
                    rough += 1;
                }
            }
            (unknown as f64 / n as f64, rough as f64 / n as f64)
        };
        coarse_km += len / 1000.0 * coarse;
        if outside > 0.25 {
            findings.push(Finding {
                severity: if outside > 0.75 {
                    Severity::Warning
                } else {
                    Severity::Caution
                },
                title: format!("Abschnitt {label} liegt außerhalb der Datengrundlage"),
                detail: format!(
                    "{:.0} % dieses Abschnitts liegen außerhalb der erfassten Fläche. Dort kennt \
                     das Modell weder Bebauung noch Gewässer, Bahnanlagen oder Einwohner, die \
                     Kosten- und Nutzenangaben für diesen Abschnitt sagen nichts aus.",
                    outside * 100.0
                ),
                edge: Some(e.id),
                node: None,
            });
            outside_km += len / 1000.0 * outside;
        }

        if len < f.min_segment_length_m {
            findings.push(Finding {
                severity: Severity::Warning,
                title: format!("Abschnitt {label} ist zu kurz"),
                detail: format!("{:.0} m, unterhalb einer sinnvollen Streckenlänge.", len),
                edge: Some(eid),
                node: None,
            });
            score += 0.1;
        }

        // Curve radii, measured over a chord long enough that the answer is
        // about the alignment rather than about how finely it was digitised.
        let min_r = f.min_curve_radius_m.get(e.mode);
        if let Some((r, _, ang)) = crate::geo::tightest_curve(&pts, f.curve_chord_m) {
            if r < min_r {
                // A line the user drew has a corner because they put it there.
                // A curated project's alignment is *traced* from open data —
                // its curvature says as much about how the corridor was
                // digitised as about how it would be built, so it is reported
                // but not held against the design.
                let traced = e.source != crate::model::Source::User;
                findings.push(Finding {
                    severity: if traced {
                        Severity::Info
                    } else if r < min_r * 0.5 {
                        Severity::Warning
                    } else {
                        Severity::Caution
                    },
                    title: format!("Enger Bogen bei {label}"),
                    detail: if traced {
                        format!(
                            "Rechnerischer Radius {:.0} m; für {} wären mindestens {:.0} m üblich. Die Trasse ist aus offenen Daten nachgezeichnet, nicht entworfen, der Wert sagt hier mehr über die Vorlage als über die Planung.",
                            r,
                            e.mode.label_de(),
                            min_r
                        )
                    } else {
                        format!(
                            "Rechnerischer Radius {:.0} m bei {:.0}° Richtungswechsel; für {} sind mindestens {:.0} m üblich.",
                            r,
                            180.0 - ang,
                            e.mode.label_de(),
                            min_r
                        )
                    },
                    edge: Some(eid),
                    node: None,
                });
                score += if traced { 0.02 } else { 0.12 };
            }
        }

        // Water.
        let wet = city.water_crossing_length(&pts);
        if wet > 20.0 {
            let major = city.crosses_major_water(&pts);
            let severity = if wet > f.major_water_crossing_m && major {
                Severity::Warning
            } else {
                Severity::Caution
            };
            findings.push(Finding {
                severity,
                title: format!("Gewässerquerung bei {label}"),
                detail: format!(
                    "{:.0} m über oder unter Wasser{}. {}",
                    wet,
                    if major { " (Hauptgewässer)" } else { "" },
                    match e.infrastructure {
                        Infrastructure::DeepTunnel =>
                            "Unterquerung im Schildvortrieb, Druckluft- oder Vereisungsmaßnahmen wahrscheinlich.",
                        Infrastructure::CutAndCover =>
                            "Offene Bauweise unter Wasser ist nur mit Absenktunnel oder Trockendock realistisch.",
                        Infrastructure::Bridge => "Brückenbauwerk mit eigener Genehmigung.",
                        _ => "Eigenes Bauwerk erforderlich; die Bauweise sollte geprüft werden.",
                    }
                ),
                edge: Some(eid),
                node: None,
            });
            score += if severity == Severity::Warning {
                0.22
            } else {
                0.08
            };
        }
        if matches!(e.infrastructure, Infrastructure::CutAndCover) && wet > 60.0 {
            findings.push(Finding {
                severity: Severity::Blocking,
                title: format!("Offene Bauweise im Gewässer bei {label}"),
                detail: "Ein Tunnel in offener Bauweise lässt sich hier nicht herstellen; bergmännischer Vortrieb oder eine Brücke sind erforderlich.".into(),
                edge: Some(eid),
                node: None,
            });
            score += 0.5;
        }

        // Trams need a street.
        if e.mode == Mode::Tram
            && matches!(
                e.infrastructure,
                Infrastructure::TramMixed | Infrastructure::TramReserved
            )
        {
            let samples = ((len / 250.0).ceil() as usize).max(1);
            let mut offstreet = 0.0;
            for i in 0..samples {
                let p = crate::geo::point_at_distance(&pts, (i as f64 + 0.5) * 250.0);
                let d = city.distance_to_street(p, 3, 400.0);
                if d.map_or(true, |v| v > 90.0) {
                    offstreet += 250.0;
                }
            }
            if offstreet > f.tram_offstreet_tolerance_m {
                findings.push(Finding {
                    severity: Severity::Caution,
                    title: format!("Straßenbahn ohne Straßenkorridor bei {label}"),
                    detail: format!(
                        "Rund {:.0} m verlaufen abseits erfasster Straßen. Es wäre ein eigener Bahnkörper mit Grunderwerb nötig.",
                        offstreet
                    ),
                    edge: Some(eid),
                    node: None,
                });
                score += 0.1;
            }
        }

        // A motorway-class corridor is a poor place for mixed-traffic tram.
        if e.infrastructure == Infrastructure::TramMixed {
            let mid = crate::geo::point_at_distance(&pts, len / 2.0);
            if city.distance_to_street(mid, 0, 60.0).is_some() {
                findings.push(Finding {
                    severity: Severity::Warning,
                    title: format!("Straßenbahn im Zuge einer Schnellstraße bei {label}"),
                    detail: "Straßenbahnbetrieb im Mischverkehr ist auf Autobahnen und autobahnähnlichen Straßen nicht zulässig.".into(),
                    edge: Some(eid),
                    node: None,
                });
                score += 0.25;
            }
        }

        // Surface and elevated railway needs a corridor that does not exist in
        // a fully built-up city. This is the single most common reason a line
        // has to go underground, and leaving it unsaid let the model quote a
        // surface S-Bahn straight through the Innenstadt at a quarter of the
        // real price.
        if matches!(
            e.infrastructure,
            Infrastructure::Surface | Infrastructure::Elevated
        ) && e.mode != Mode::Tram
        {
            let d = city.density_index(&pts);
            // A line laid alongside an existing railway is not cutting a new
            // swathe through the city, that is how the S4 is actually being
            // built along the Lübecker Bahn.
            let in_corridor = city.rail_corridor_share(&pts, f.rail_corridor_radius_m);
            if d > f.surface_density_limit && in_corridor < 0.6 {
                let severe = d > f.surface_density_blocking;
                findings.push(Finding {
                    severity: if severe { Severity::Warning } else { Severity::Caution },
                    title: format!(
                        "{} in bebautem Gebiet bei {label}",
                        if e.infrastructure == Infrastructure::Elevated {
                            "Hochbahn"
                        } else {
                            "Oberirdische Strecke"
                        }
                    ),
                    detail: format!(
                        "Bebauungsdichte-Index {:.2} auf {:.1} km. {}",
                        d,
                        len / 1000.0,
                        if severe {
                            "Ein eigener Bahnkörper an der Oberfläche wäre hier nur mit umfangreichen Abrissen zu haben, real würde diese Strecke im Tunnel gebaut."
                        } else {
                            "Ein eigener Bahnkörper braucht hier Grunderwerb und mindestens einzelne Abrisse."
                        }
                    ),
                    edge: Some(eid),
                    node: None,
                });
                score += if severe { 0.3 } else { 0.12 };
            }
        }

        // Very dense urban fabric makes open construction painful.
        if e.infrastructure == Infrastructure::CutAndCover {
            let d = city.density_index(&pts);
            if d > 0.7 {
                findings.push(Finding {
                    severity: Severity::Caution,
                    title: format!("Offene Bauweise in dichter Bebauung bei {label}"),
                    detail: format!(
                        "Bebauungsdichte-Index {:.2}. Offene Bauweise bedeutet hier lange Vollsperrungen und hohe Umlegungskosten; bergmännischer Vortrieb ist meist vorzuziehen.",
                        d
                    ),
                    edge: Some(eid),
                    node: None,
                });
                score += 0.08;
            }
        }
    }

    // Station spacing that is physically implausible.
    for l in net.lines.values().filter(|l| l.included) {
        let nodes = net.line_nodes(l.id);
        for (i, w) in nodes.windows(2).enumerate() {
            let (Some(a), Some(b)) = (net.nodes.get(&w[0]), net.nodes.get(&w[1])) else {
                continue;
            };
            let d = a.geo.distance_to(&b.geo);
            let min = params.stations.min_spacing_m.get(l.mode) * 0.5;
            if d < min && a.status != BuildStatus::InService {
                findings.push(Finding {
                    severity: Severity::Caution,
                    title: format!("Sehr enger Stationsabstand auf {}", l.label),
                    detail: format!("{} – {}: {:.0} m.", a.name, b.name, d),
                    edge: l.edges.get(i).copied(),
                    node: None,
                });
                score += 0.05;
            }
        }
        // A line whose edges do not form a connected path.
        if l.edges.len() > 1 {
            let n = net.line_nodes(l.id);
            if n.len() != l.edges.len() + 1 {
                findings.push(Finding {
                    severity: Severity::Warning,
                    title: format!("Linie {} ist unterbrochen", l.label),
                    detail: "Die Abschnitte der Linie bilden keinen durchgehenden Laufweg.".into(),
                    edge: None,
                    node: None,
                });
                score += 0.2;
            }
        }
    }

    // Mixing incompatible modes over one node is fine; over one edge is not.
    for e in net.edges.values() {
        let lines = net.lines_on_edge(e.id);
        for lid in lines {
            let Some(l) = net.lines.get(&lid) else {
                continue;
            };
            if !e.mode.compatible_with(l.mode) {
                findings.push(Finding {
                    severity: Severity::Blocking,
                    title: format!("{} auf {}-Gleis", l.mode.label_de(), e.mode.label_de()),
                    detail: format!(
                        "Linie {} nutzt einen Abschnitt, der für {} gebaut ist. Fahrzeugprofil, Stromsystem und Bahnsteighöhe passen nicht zusammen.",
                        l.label,
                        e.mode.label_de()
                    ),
                    edge: Some(e.id),
                    node: None,
                });
                score += 0.4;
            }
        }
    }

    findings.sort_by(|a, b| b.severity.cmp(&a.severity));
    findings.truncate(40);

    // Normalise by project size: two warnings on 40 km is not the same as two
    // warnings on 2 km.
    let normalised = if to_build_km > 0.0 {
        (score / (0.4 + to_build_km / 12.0)).min(1.0)
    } else {
        0.0
    };
    // Track outside the datasets is not a defect to be weighed against the
    // project's size, it is the part about which nothing was checked. The
    // normalisation above would make it *vanish* the longer it got, which is
    // precisely backwards: a line half of which lies beyond the data has a
    // verdict worth half as much, not one that looks half as bad.
    let unknown_share = if to_build_km > 0.0 {
        (outside_km / to_build_km).clamp(0.0, 1.0)
    } else {
        0.0
    };
    // Share *and* an absolute floor. A share alone is diluted by whatever else
    // the scenario happens to build: eighty kilometres out in the North Sea
    // came to exactly half of a plan that already contained the city's decided
    // projects, and slipped under a one-half threshold. How much of the plan
    // cannot be judged does not depend on how much else is in it.
    let unassessable = unknown_share > 0.15 || outside_km > 3.0;
    // Not a defect, and not a reason to change the verdict, but the numbers
    // out in the region rest on a one-kilometre raster of OpenStreetMap place
    // populations, where the city has two hundred metres of official
    // statistics. `docs/daten.md` claimed the application said so. It did not.
    if coarse_km > 2.0 {
        findings.push(Finding {
            severity: Severity::Info,
            title: format!("{coarse_km:.1} km liegen im Umland, wo die Daten gröber sind"),
            detail:
                "Außerhalb der Stadt stammen die Einwohnerzahlen aus den Ortsangaben von \
                 OpenStreetMap auf einem Ein-Kilometer-Raster, innerhalb aus amtlicher Statistik \
                 auf 200 m. Nachfrage, Nutzen und Nutzen-Kosten-Verhältnis sind für diesen Teil \
                 entsprechend grob."
                    .into(),
            edge: None,
            node: None,
        });
    }
    let blocking = findings.iter().any(|f| f.severity == Severity::Blocking);
    let class = if unassessable {
        // Not "difficult" — unassessable. Saying anything else would claim a
        // judgement that was never made.
        FeasibilityClass::Demanding
    } else if blocking || normalised > 0.75 {
        FeasibilityClass::Critical
    } else if normalised > 0.45 {
        FeasibilityClass::Difficult
    } else if normalised > 0.18 {
        FeasibilityClass::Demanding
    } else {
        FeasibilityClass::Straightforward
    };

    let summary = if to_build_km <= 0.0 {
        "Es ist nichts zu bauen; die Bewertung entfällt.".to_string()
    } else if unassessable {
        format!(
            "{:.0} % der neuen Strecke liegen außerhalb der erfassten Fläche. Dort kennt das \
             Modell weder Bebauung noch Gewässer, Bahnanlagen oder Einwohner, für diesen Teil \
             ist die Baubarkeit nicht geprüft, und die Zahlen sagen wenig.",
            unknown_share * 100.0
        )
    } else if findings.is_empty() {
        "Keine baulichen Auffälligkeiten erkannt. Das Modell prüft Geometrie, Gewässer, Bauweise und Netzlogik, keinen Baugrund und keine Leitungslage.".to_string()
    } else {
        format!(
            "{} Hinweis(e) auf {:.1} km neuer Infrastruktur. {}",
            findings.len(),
            to_build_km,
            if blocking {
                "Mindestens ein Punkt schließt die Umsetzung in dieser Form aus."
            } else {
                "Keiner der Punkte schließt eine Umsetzung grundsätzlich aus."
            }
        )
    };

    FeasibilityResult {
        class,
        score: normalised,
        findings,
        summary,
    }
}

#[cfg(test)]
mod tests {
    /// Outside the datasets the model must say so, not say "unauffällig".
    ///
    /// A line drawn out into the North Sea came back structurally unremarkable
    /// with a price to the euro: no population, no water, no railways, which
    /// the check read as nothing in the way, when it means nothing is known.
    #[test]
    fn track_outside_the_data_is_not_called_unremarkable() {
        use crate::model::Mode;
        let city = crate::testing::demo_city();
        let params = Params::default();

        // demo_city's raster is a few kilometres across; this runs far beyond it.
        let far = crate::testing::demo_new_line(Mode::Sbahn, Infrastructure::Surface, 8.0);
        let mut out = far.clone();
        for e in out.edges.values_mut() {
            for p in e.geo.iter_mut() {
                *p = crate::geo::Point::new(
                    p.to_metric().x + 400_000.0,
                    p.to_metric().y + 400_000.0,
                )
                .to_latlon();
            }
        }
        for n in out.nodes.values_mut() {
            n.geo = crate::geo::Point::new(
                n.geo.to_metric().x + 400_000.0,
                n.geo.to_metric().y + 400_000.0,
            )
            .to_latlon();
        }

        let inside = calculate(&far, &city, &params);
        let outside = calculate(&out, &city, &params);

        assert!(
            outside
                .findings
                .iter()
                .any(|f| f.title.contains("außerhalb der Datengrundlage")),
            "kein Hinweis auf fehlende Daten: {:?}",
            outside.findings.iter().map(|f| &f.title).collect::<Vec<_>>()
        );
        assert_ne!(
            outside.class,
            FeasibilityClass::Straightforward,
            "eine Strecke ausserhalb der Daten gilt als unauffällig"
        );
        // And a line inside the data is not dragged down by the new rule.
        assert!(!inside
            .findings
            .iter()
            .any(|f| f.title.contains("außerhalb der Datengrundlage")));
    }

    use super::*;
    use crate::testing::{demo_city, demo_network, demo_new_line};

    #[test]
    fn an_existing_network_is_unremarkable() {
        let r = calculate(&demo_network(), &demo_city(), &Params::default());
        assert_eq!(r.class, FeasibilityClass::Straightforward);
        assert!(r.findings.is_empty());
    }

    #[test]
    fn a_hairpin_is_flagged() {
        let mut net = demo_new_line(Mode::Sbahn, Infrastructure::Surface, 4.0);
        // Pick an edge of the *new* line: the fixture also carries the existing
        // network, and existing track is never assessed.
        let eid = net
            .edges
            .values()
            .find(|e| e.status != BuildStatus::InService)
            .unwrap()
            .id;
        let e = net.edges.get_mut(&eid).unwrap();
        let a = e.geo[0].to_metric();
        e.geo = crate::geo::to_geo(&[
            a,
            Point::new(a.x + 300.0, a.y),
            Point::new(a.x + 300.0, a.y + 40.0),
            Point::new(a.x, a.y + 40.0),
        ]);
        e.recompute_length();
        let r = calculate(&net, &demo_city(), &Params::default());
        assert!(
            r.findings.iter().any(|f| f.title.contains("Bogen")),
            "{:?}",
            r.findings
        );
    }

    #[test]
    fn water_crossings_are_reported() {
        let city = crate::testing::demo_city_with_river();
        let net = crate::testing::demo_line_over_river();
        let r = calculate(&net, &city, &Params::default());
        assert!(
            r.findings.iter().any(|f| f.title.contains("Gewässer")),
            "{:?}",
            r.findings
        );
        assert_ne!(r.class, FeasibilityClass::Straightforward);
    }

    #[test]
    fn cut_and_cover_through_water_is_blocking() {
        let city = crate::testing::demo_city_with_river();
        let mut net = crate::testing::demo_line_over_river();
        for e in net.edges.values_mut() {
            e.mode = Mode::Ubahn;
            e.infrastructure = Infrastructure::CutAndCover;
        }
        let r = calculate(&net, &city, &Params::default());
        assert_eq!(r.class, FeasibilityClass::Critical);
        assert!(r.findings.iter().any(|f| f.severity == Severity::Blocking));
    }

    #[test]
    fn incompatible_mode_on_shared_track_is_blocking() {
        let mut net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 4.0);
        let lid = *net.lines.keys().next().unwrap();
        net.lines.get_mut(&lid).unwrap().mode = Mode::Tram;
        let r = calculate(&net, &demo_city(), &Params::default());
        assert!(r.findings.iter().any(|f| f.severity == Severity::Blocking));
    }

    #[test]
    fn severity_is_size_normalised() {
        let p = Params::default();
        let city = crate::testing::demo_city_with_river();
        let short = calculate(&crate::testing::demo_line_over_river(), &city, &p);
        // The same finding on a much larger project weighs less.
        let mut long = crate::testing::demo_line_over_river();
        let eid = *long.edges.keys().next().unwrap();
        let e = long.edges.get_mut(&eid).unwrap();
        let last = *e.geo.last().unwrap();
        let far = Point::new(last.to_metric().x + 40_000.0, last.to_metric().y).to_latlon();
        e.geo.push(far);
        e.recompute_length();
        let long_r = calculate(&long, &city, &p);
        assert!(long_r.score < short.score);
    }

    #[test]
    fn a_surface_line_through_a_dense_city_is_flagged() {
        let (mut net, city) = (crate::testing::demo_network(), crate::testing::demo_city());
        let params = Params::default();
        // demo_city is uniformly dense, so any new surface edge qualifies.
        let ids: Vec<crate::model::NodeId> = net
            .nodes
            .values()
            .filter(|n| n.kind == crate::model::NodeKind::Station)
            .map(|n| n.id)
            .take(2)
            .collect();
        let e = net.edges.values().next().unwrap().id;
        let edge = net.edges.get_mut(&e).unwrap();
        edge.status = BuildStatus::ToBuild;
        edge.infrastructure = Infrastructure::Surface;
        let _ = ids;
        let r = calculate(&net, &city, &params);
        assert!(
            r.findings
                .iter()
                .any(|f| f.title.contains("Oberirdische Strecke in bebautem Gebiet")),
            "kein Hinweis auf oberirdische Trasse: {:?}",
            r.findings.iter().map(|f| &f.title).collect::<Vec<_>>()
        );
    }

    #[test]
    fn digitising_noise_is_not_a_tight_curve() {
        // A dead-straight alignment sampled every two metres with half a metre
        // of jitter: vertex-to-vertex this looks like a three-metre radius.
        let mut pts = Vec::new();
        for i in 0..400 {
            let x = i as f64 * 2.0;
            let y = if i % 2 == 0 { 0.4 } else { -0.4 };
            pts.push(Point::new(x, y));
        }
        let vertexwise = pts
            .windows(3)
            .map(|w| crate::geo::curve_radius(w[0], w[1], w[2]))
            .fold(f64::INFINITY, f64::min);
        assert!(vertexwise < 10.0, "Aufbau stimmt nicht: {vertexwise}");
        let chordwise = crate::geo::min_curve_radius(&pts, 55.0);
        assert!(
            chordwise > 2_000.0,
            "Sehnenmessung fällt auf Digitalisierungsrauschen herein: {chordwise}"
        );
    }
}
