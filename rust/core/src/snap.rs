//! Snapping and angle constraints (plan §6, §7).
//!
//! The user never draws free-hand. Every pointer position is resolved into a
//! *snap target* — an existing node, a point on an existing edge, a landmark, a
//! street, or the invisible grid — and the resulting segment is constrained to
//! the permitted schematic angles. The UI shows exactly what the engine
//! resolved, so drawing feels like Figma's smart guides rather than a brush.

use crate::city::CityData;
use crate::geo::{angle_difference, project_on_polyline, LatLon, Point};
use crate::model::{EdgeId, Mode, Network, NodeId, NodeKind};
use crate::params::GeometryParams;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SnapTarget {
    /// An existing station or junction.
    Node {
        id: NodeId,
        name: String,
        interchange: bool,
    },
    /// A point along an existing edge — creates a junction when committed.
    Edge {
        id: EdgeId,
        along_m: f64,
        mode: Mode,
    },
    /// A landmark: gives the new station a name and a reason to exist.
    Landmark { name: String, weight: f64 },
    /// A named street corridor.
    Street { name: String },
    /// The invisible drawing grid.
    Grid,
    /// Nothing nearby; the raw position with the angle constraint applied.
    Free,
}

impl SnapTarget {
    /// Priority when several targets are in range — lower wins.
    fn rank(&self) -> u8 {
        match self {
            SnapTarget::Node { .. } => 0,
            SnapTarget::Edge { .. } => 1,
            SnapTarget::Landmark { .. } => 2,
            SnapTarget::Street { .. } => 3,
            SnapTarget::Grid => 4,
            SnapTarget::Free => 5,
        }
    }
}

/// The resolved drawing position.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapResult {
    pub geo: LatLon,
    pub point: Point,
    pub target: SnapTarget,
    /// Distance the pointer was moved by snapping, metres.
    pub offset_m: f64,
    /// Angle of the resulting segment, if an origin was given.
    pub angle_deg: Option<f64>,
    /// True when the angle constraint moved the point.
    pub angle_constrained: bool,
    /// A short German label for the on-map hint.
    pub label: String,
    /// True when committing here joins the new line to existing infrastructure.
    pub connects: bool,
    /// The services this point would connect to, for the on-map hint.
    pub connects_to: Vec<String>,
    /// Colours of those services, so the hint can show their badges.
    pub connect_colors: Vec<String>,
}

/// Snap a raw pointer position.
///
/// `origin` is the segment start when drawing; without it only the position is
/// snapped and no angle constraint applies.
#[allow(clippy::too_many_arguments)]
pub fn snap(
    raw: Point,
    origin: Option<Point>,
    mode: Mode,
    network: &Network,
    city: &CityData,
    params: &GeometryParams,
    // Ground distance one screen pixel covers, so the snap radii can be
    // expressed in pixels and feel identical at every zoom.
    metres_per_pixel: f64,
    // Touch is less precise than a mouse and gets a more generous radius.
    coarse_pointer: bool,
) -> SnapResult {
    let mpp = metres_per_pixel.max(0.05);
    let touch = if coarse_pointer { 1.7 } else { 1.0 };
    let radius = |px: f64| (px * touch * mpp).min(params.snap_max_m);

    // Real things are looked for under the *pointer*, not under the
    // angle-constrained position.
    //
    // The constraint used to be applied first, and the result was that pointing
    // straight at a station could report "Raster": the constraint moved the
    // position a couple of hundred metres along the nearest permitted bearing,
    // the station was then out of range of that displaced point, and the marker
    // sat well away from the cursor with the wrong name under it. Whichever
    // reading of "where do you mean" is right, it is not one that ignores the
    // station the pointer is on.
    //
    // So the constraint is now what it should always have been: the answer for
    // open space. Point at a station, an existing track, a landmark or a street
    // and you get it, on the spot. Point at nothing and the bearing guide takes
    // over.
    let constrained = raw;

    let mut best: Option<(SnapTarget, Point, f64)> = None;
    fn consider(
        best: &mut Option<(SnapTarget, Point, f64)>,
        target: SnapTarget,
        at: Point,
        dist: f64,
    ) {
        let better = match best.as_ref() {
            None => true,
            Some((bt, _, bd)) => {
                target.rank() < bt.rank() || (target.rank() == bt.rank() && dist < *bd)
            }
        };
        if better {
            *best = Some((target, at, dist));
        }
    }

    // 1. Existing nodes.
    for n in network.nodes.values() {
        if n.kind == NodeKind::Waypoint {
            continue;
        }
        let p = n.geo.to_metric();
        let d = constrained.distance_to(&p);
        if d <= radius(params.snap_node_px) {
            consider(
                &mut best,
                SnapTarget::Node {
                    id: n.id,
                    name: n.name.clone(),
                    interchange: n.interchange,
                },
                p,
                d,
            );
        }
    }

    // 2. Existing edges — snapping here is what produces junctions and shared
    //    track instead of lines that merely cross visually (plan §17).
    if best.is_none() {
        for e in network.edges.values() {
            let pts: Vec<Point> = e.geo.iter().map(|g| g.to_metric()).collect();
            if let Some(pr) = project_on_polyline(constrained, &pts) {
                if pr.distance <= radius(params.snap_edge_px) {
                    consider(
                        &mut best,
                        SnapTarget::Edge {
                            id: e.id,
                            along_m: pr.along,
                            mode: e.mode,
                        },
                        pr.point,
                        pr.distance,
                    );
                }
            }
        }
    }

    // 3. Landmarks — a new station belongs at a place people go to. Only ones
    //    with real drawing power: a sports club is not a reason to move a
    //    tunnel portal.
    if best.is_none() {
        for (l, d) in city
            .landmarks_near(constrained, radius(params.snap_landmark_px))
            .into_iter()
            .filter(|(l, _)| l.weight >= 0.45)
        {
            consider(
                &mut best,
                SnapTarget::Landmark {
                    name: l.name.clone(),
                    weight: l.weight,
                },
                l.geo.to_metric(),
                d,
            );
        }
    }

    // 4. Street corridors — trams run in streets, so the street is the target.
    if best.is_none() && mode == Mode::Tram {
        if let Some((s, d)) = city.nearest_street(constrained, radius(params.snap_landmark_px)) {
            let pts: Vec<Point> = s.geo.iter().map(|g| g.to_metric()).collect();
            if let Some(pr) = project_on_polyline(constrained, &pts) {
                consider(
                    &mut best,
                    SnapTarget::Street {
                        name: s.name.clone(),
                    },
                    pr.point,
                    d,
                );
            }
        }
    }

    // Nothing real under the pointer: fall back to the permitted bearings, and
    // only then to the grid along that ray.
    let mut angle_constrained = false;
    if best.is_none() {
        let free_point = match origin {
            Some(o) => {
                let (p, _, snapped) = constrain_angle(
                    o,
                    raw,
                    &params.allowed_angles_deg,
                    params.angle_snap_tolerance_deg,
                );
                angle_constrained = snapped;
                p
            }
            None => raw,
        };
        if params.grid_size_m / mpp >= params.grid_min_px {
            let g = snap_to_grid(free_point, params.grid_size_m);
            let d = g.distance_to(&free_point);
            if d <= (params.grid_size_m * 0.42).min(params.snap_max_m) {
                consider(&mut best, SnapTarget::Grid, g, d);
            }
        }
        if best.is_none() {
            consider(&mut best, SnapTarget::Free, free_point, free_point.distance_to(&raw));
        }
    }

    let (target, point, _) = best.expect("Free is always available");
    // How far snapping actually moved the pointer, which is the only offset a
    // reader can check against what they see.
    let offset = point.distance_to(&raw);
    let constrained_flag = angle_constrained;
    // Re-derive the angle after snapping so the readout matches reality.
    let final_angle = origin.map(|o| point.sub(&o).angle_deg());
    let label = describe(&target, mode, city, point);

    // What committing here would connect to. This is the most useful thing to
    // say mid-draw: whether the line joins the network or merely passes beside
    // it.
    let services = |ids: Vec<crate::model::LineId>| {
        let mut labels: Vec<String> = Vec::new();
        let mut colors: Vec<String> = Vec::new();
        for l in ids
            .iter()
            .filter_map(|l| network.lines.get(l))
            .filter(|l| l.included)
        {
            if !labels.contains(&l.label) {
                labels.push(l.label.clone());
                colors.push(l.color.clone());
            }
        }
        (labels, colors)
    };
    let (connects_to, connect_colors) = match &target {
        SnapTarget::Node { id, .. } => services(network.lines_at_node(*id)),
        SnapTarget::Edge { id, .. } => services(network.lines_on_edge(*id)),
        _ => (Vec::new(), Vec::new()),
    };

    SnapResult {
        geo: point.to_latlon(),
        point,
        target,
        offset_m: offset,
        angle_deg: final_angle,
        angle_constrained: constrained_flag,
        label,
        connects: !connects_to.is_empty(),
        connects_to,
        connect_colors,
    }
}

/// The on-map hint.
///
/// "Raster" and "frei" used to appear here. They name the two internal
/// fallbacks — the drawing grid and no snap at all — and they answer a question
/// nobody standing over a map is asking. What someone wants to know is whether
/// they are on a station, and if not, where they are. So open space says it is
/// a new stop and names the nearest thing the city data knows: a landmark, the
/// street, or failing both the district.
fn describe(t: &SnapTarget, drawing: Mode, city: &CityData, at: Point) -> String {
    match t {
        SnapTarget::Node {
            name, interchange, ..
        } => {
            if *interchange {
                format!("{name} · Umsteigepunkt")
            } else {
                name.clone()
            }
        }
        // What joining here actually means depends on what you are drawing.
        //
        // Both cases used to read "Anschluss an U-Bahn-Strecke", which for a
        // tram promises something the model will not do and could not be built:
        // a tram cannot run on U-Bahn track. What happens instead is that the
        // tram gets its own track and the two meet at a stop. Saying so is the
        // difference between a suggestion and a misstatement.
        SnapTarget::Edge { mode, .. } => {
            if drawing.compatible_with(*mode) {
                format!("Anschluss an {}-Strecke", mode.label_de())
            } else {
                format!("Umstieg zur {} · eigenes Gleis", mode.label_de())
            }
        }
        SnapTarget::Landmark { name, .. } => name.clone(),
        SnapTarget::Street { name } => name.clone(),
        SnapTarget::Grid | SnapTarget::Free => match nearby_name(city, at) {
            Some(name) => format!("Neuer Halt bei {name}"),
            None => "Neuer Halt".into(),
        },
    }
}

/// The nearest named place, for labelling a stop in open space.
///
/// The radius is deliberately wider than any snap radius: this does not move
/// the point, it only says what is around it, and "bei Diebsteich" is useful
/// well past the distance at which snapping to Diebsteich would be right.
fn nearby_name(city: &CityData, at: Point) -> Option<String> {
    const LOOK_M: f64 = 700.0;
    let landmark = city
        .landmarks_near(at, LOOK_M)
        .into_iter()
        .filter(|(l, _)| l.weight >= 0.35)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(l, _)| l.name.clone());
    landmark
        .or_else(|| city.nearest_street(at, LOOK_M).map(|(s, _)| s.name.clone()))
        .or_else(|| city.district_at(at).map(|d| d.name.clone()))
        .filter(|n| !n.trim().is_empty())
}

pub fn snap_to_grid(p: Point, size: f64) -> Point {
    if size <= 0.0 {
        return p;
    }
    Point::new((p.x / size).round() * size, (p.y / size).round() * size)
}

/// Nudge the direction from `origin` onto a preferred bearing — but only when
/// it is already close to one.
///
/// Returns the adjusted point, the resulting bearing, and whether it was
/// snapped. Snapping *near* a preferred angle is a guide; snapping *always* is
/// a cage, and the difference is the whole feel of the tool.
pub fn constrain_angle(
    origin: Point,
    raw: Point,
    allowed_deg: &[f64],
    tolerance_deg: f64,
) -> (Point, f64, bool) {
    let v = raw.sub(&origin);
    let len = v.length();
    if len < 1e-6 || allowed_deg.is_empty() {
        return (raw, 0.0, false);
    }
    let a = v.angle_deg();
    let best = allowed_deg
        .iter()
        .copied()
        .min_by(|x, y| {
            angle_difference(a, *x)
                .partial_cmp(&angle_difference(a, *y))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(0.0);
    if angle_difference(a, best) > tolerance_deg {
        return (raw, a, false);
    }
    // Rotate rather than project, so the point keeps its distance from the
    // origin and does not slide away under the pointer.
    let r = best.to_radians();
    (
        origin.add(&Point::new(r.cos() * len, r.sin() * len)),
        best,
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{demo_city, demo_network};

    #[test]
    fn grid_snapping_rounds_to_the_nearest_cell() {
        assert_eq!(
            snap_to_grid(Point::new(137.0, -80.0), 125.0),
            Point::new(125.0, -125.0)
        );
        // Just under half a cell stays in the current cell.
        assert_eq!(snap_to_grid(Point::new(137.0, -60.0), 125.0).y, 0.0);
        assert_eq!(
            snap_to_grid(Point::new(10.0, 10.0), 0.0),
            Point::new(10.0, 10.0)
        );
    }

    #[test]
    fn angles_are_constrained_to_the_allowed_set() {
        let allowed = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0];
        let o = Point::new(0.0, 0.0);
        // Close to horizontal: snapped.
        let (_, a, snapped) = constrain_angle(o, Point::new(100.0, 5.0), &allowed, 6.0);
        assert_eq!(a, 0.0);
        assert!(snapped);
        // Clearly not near any preferred angle: left alone.
        let (p, a, snapped) = constrain_angle(o, Point::new(100.0, 40.0), &allowed, 6.0);
        assert!(!snapped, "21.8° is not near a 45° step and must stay free");
        assert!((a - 21.8).abs() < 0.5, "angle {a}");
        assert_eq!(
            p,
            Point::new(100.0, 40.0),
            "a free angle must not move the point"
        );
        // Snapping preserves the distance from the origin.
        let raw = Point::new(-100.0, -96.0);
        let (p, a, snapped) = constrain_angle(o, raw, &allowed, 6.0);
        assert_eq!(a, 225.0);
        assert!(snapped);
        assert!((p.length() - raw.length()).abs() < 1e-6, "length changed");
    }

    #[test]
    fn a_snapped_point_lies_exactly_on_the_preferred_ray() {
        let o = Point::new(0.0, 0.0);
        let allowed = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0];
        let (p, a, snapped) = constrain_angle(o, Point::new(300.0, 290.0), &allowed, 6.0);
        assert_eq!(a, 45.0);
        assert!(snapped);
        assert!((p.x - p.y).abs() < 1e-6, "must lie on the 45° ray: {p:?}");
    }

    #[test]
    fn drawing_at_an_arbitrary_angle_is_left_alone() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let o = Point::new(0.0, 8000.0);
        // 30° from horizontal: between the preferred 22.5° and 45° steps.
        let raw = Point::new(o.x + 3000.0, o.y + 1732.0);
        let r = snap(raw, Some(o), Mode::Ubahn, &net, &city, &params, 3.0, false);
        assert!(!r.angle_constrained, "the direction should stay free");
        assert!(
            r.point.distance_to(&raw) < 200.0,
            "the point drifted {} m",
            r.point.distance_to(&raw)
        );
    }

    #[test]
    fn nodes_win_over_the_grid() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let node = net.nodes.values().next().unwrap();
        let near = node.geo.to_metric().add(&Point::new(40.0, 30.0));
        let r = snap(near, None, Mode::Ubahn, &net, &city, &params, 3.0, false);
        match r.target {
            SnapTarget::Node { id, .. } => assert_eq!(id, node.id),
            other => panic!("expected a node, got {other:?}"),
        }
        assert!(r.offset_m < 60.0);
    }

    #[test]
    fn snapping_never_drags_the_point_across_the_city() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let node = net.nodes.values().next().unwrap();
        let p = node.geo.to_metric();
        // Zoomed far out, one pixel covers a lot of ground.
        for mpp in [1.0, 10.0, 60.0, 300.0] {
            let raw = p.add(&Point::new(3000.0, 0.0));
            let r = snap(raw, None, Mode::Ubahn, &net, &city, &params, mpp, false);
            assert!(
                r.offset_m <= params.snap_max_m + 1.0,
                "at {mpp} m/px the point moved {:.0} m",
                r.offset_m
            );
        }
    }

    #[test]
    fn touch_snapping_reaches_further_than_a_mouse() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let p = net.nodes.values().next().unwrap().geo.to_metric();
        let raw = p.add(&Point::new(60.0, 0.0));
        let mouse = snap(raw, None, Mode::Ubahn, &net, &city, &params, 2.0, false);
        let finger = snap(raw, None, Mode::Ubahn, &net, &city, &params, 2.0, true);
        assert!(
            !matches!(mouse.target, SnapTarget::Node { .. }),
            "mouse should not reach 60 m at 2 m/px"
        );
        assert!(
            matches!(finger.target, SnapTarget::Node { .. }),
            "a finger should reach it"
        );
    }

    /// Pointing at a station finds that station, mid-draw as much as before it.
    ///
    /// The angle constraint used to run first, which moved the position a few
    /// hundred metres onto the nearest permitted bearing before anything was
    /// looked up. A pointer resting exactly on a station then reported the
    /// drawing grid, and the marker sat far from both the cursor and the
    /// station. Drawing towards a station you can see is the ordinary case; it
    /// must not depend on the bearing you happen to be coming from.
    #[test]
    fn a_station_under_the_pointer_wins_against_the_angle_guide() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let node = net.nodes.values().next().unwrap();
        let on_station = node.geo.to_metric();

        for (dx, dy) in [(-3000.0, -1700.0), (-2500.0, 400.0), (900.0, -2600.0)] {
            let origin = on_station.add(&Point::new(dx, dy));
            let r = snap(
                on_station,
                Some(origin),
                Mode::Ubahn,
                &net,
                &city,
                &params,
                5.0,
                false,
            );
            assert!(
                matches!(r.target, SnapTarget::Node { id, .. } if id == node.id),
                "aus Richtung ({dx}, {dy}) wurde {:?} statt der Station erkannt",
                r.target
            );
            assert!(
                r.point.distance_to(&on_station) < 1.0,
                "der Punkt liegt {:.0} m neben der Station, auf die gezeigt wird",
                r.point.distance_to(&on_station)
            );
        }
    }

    /// The hint must not promise track a tram cannot use.
    ///
    /// Drawing a tram along a U-Bahn line said "Anschluss an U-Bahn-Strecke",
    /// word for word what it says when drawing a U-Bahn — which reads as "your
    /// tram will join this track". It will not: modes that cannot share track
    /// get their own, and the two meet at a stop. The model was right the whole
    /// time; only the sentence was wrong, which is the harder kind to notice.
    #[test]
    fn the_hint_does_not_offer_track_the_mode_cannot_use() {
        let city = demo_city();
        let params = GeometryParams::default();
        // A long line, so the probe can sit on open track rather than next to a
        // station — a point near a stop snaps to the stop, which answers a
        // different question than the one being asked here.
        let net = crate::testing::demo_new_line(Mode::Ubahn, crate::model::Infrastructure::DeepTunnel, 8.0);
        let edge = net
            .edges
            .values()
            .max_by(|a, b| a.length_m.total_cmp(&b.length_m))
            .unwrap();
        // Halfway *along* the edge, not at a vertex: a two-point edge has no
        // middle vertex, so indexing lands on its far end — which is a stop.
        let (a_end, b_end) = (edge.geo[0].to_metric(), edge.geo[edge.geo.len() - 1].to_metric());
        let on_track = a_end.lerp(&b_end, 0.5);

        let label = |mode: Mode| {
            snap(on_track, None, mode, &net, &city, &params, 3.0, false).label
        };
        let same = label(edge.mode);
        // The precondition that matters: the probe has to be on track, not on a
        // stop. A point beside a station answers a different question.
        let hit = snap(on_track, None, edge.mode, &net, &city, &params, 3.0, false);
        assert!(
            matches!(hit.target, SnapTarget::Edge { .. }),
            "der Messpunkt trifft kein Gleis, sondern {:?}",
            hit.target
        );
        assert!(
            same.contains("Anschluss"),
            "gleiche Bauart sollte Anschluss anbieten: {same:?}"
        );
        for other in Mode::ALL {
            if other.compatible_with(edge.mode) {
                continue;
            }
            let text = label(other);
            assert!(
                !text.contains("Anschluss"),
                "{other:?} kann auf {:?}-Gleis nicht fahren, der Hinweis bietet es aber an: {text:?}",
                edge.mode
            );
            assert!(
                text.contains("Umstieg"),
                "{other:?} auf {:?}-Gleis sollte den Umstieg nennen: {text:?}",
                edge.mode
            );
        }
    }

    /// The hint never shows the names of the internal fallbacks.
    #[test]
    fn open_space_is_described_in_words_a_reader_can_use() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let r = snap(
            Point::new(60_000.0, 60_000.0),
            None,
            Mode::Ubahn,
            &net,
            &city,
            &params,
            3.0,
            false,
        );
        assert!(
            !r.label.contains("Raster") && !r.label.contains("frei"),
            "die Beschriftung nennt einen internen Begriff: {:?}",
            r.label
        );
        assert!(r.label.contains("Halt"), "unerwartete Beschriftung: {:?}", r.label);
    }

    #[test]
    fn snapping_to_a_station_reports_what_it_connects_to() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let node = net
            .nodes
            .values()
            .find(|n| !net.lines_at_node(n.id).is_empty())
            .unwrap();
        let p = node.geo.to_metric().add(&Point::new(20.0, 0.0));
        let r = snap(p, None, Mode::Ubahn, &net, &city, &params, 3.0, false);
        assert!(
            r.connects,
            "snapping to a served station must report a connection"
        );
        assert!(!r.connects_to.is_empty());
        assert_eq!(r.connects_to.len(), r.connect_colors.len());
    }

    #[test]
    fn free_space_reports_no_connection() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let r = snap(
            Point::new(60_000.0, 60_000.0),
            None,
            Mode::Ubahn,
            &net,
            &city,
            &params,
            3.0,
            false,
        );
        assert!(!r.connects);
        assert!(r.connects_to.is_empty());
    }

    #[test]
    fn far_from_everything_falls_back_to_the_grid_or_free() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let r = snap(
            Point::new(90_000.0, 90_000.0),
            None,
            Mode::Ubahn,
            &net,
            &city,
            &params,
            3.0,
            false,
        );
        assert!(matches!(r.target, SnapTarget::Grid | SnapTarget::Free));
    }

    #[test]
    fn snapping_reports_the_resulting_angle() {
        let net = demo_network();
        let city = demo_city();
        let params = GeometryParams::default();
        let o = Point::new(0.0, 0.0);
        let r = snap(
            Point::new(4000.0, 100.0),
            Some(o),
            Mode::Ubahn,
            &net,
            &city,
            &params,
            3.0,
            false,
        );
        assert!(r.angle_deg.is_some());
        assert!(r.angle_constrained);
    }
}
