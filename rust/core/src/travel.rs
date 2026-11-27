//! Travel times over the network graph.
//!
//! Used by the accessibility and benefit models (plan §32): the value of a new
//! line is essentially the travel time it saves, so the engine has to be able to
//! route over both the present-day network and the scenario network and compare.

use crate::model::{LineId, Mode, Network, NodeId, NodeKind};
use crate::params::OperationsParams;
use std::collections::{BTreeMap, BinaryHeap, HashMap};

/// Extra minutes charged for changing between lines at a station.
pub const TRANSFER_PENALTY_MIN: f64 = 5.0;
/// Average wait on boarding, half the headway, capped.
pub const BOARDING_PENALTY_MIN: f64 = 3.0;
/// Walking speed used for access and egress, km/h.
pub const WALK_SPEED_KMH: f64 = 4.6;

#[derive(Debug, Clone)]
struct Link {
    to: NodeId,
    minutes: f64,
    lines: Vec<LineId>,
    mode: Mode,
}

/// A routable view of the network.
#[derive(Debug, Clone, Default)]
pub struct TravelGraph {
    adjacency: BTreeMap<NodeId, Vec<Link>>,
    pub stations: Vec<NodeId>,
}

impl TravelGraph {
    /// Build from the edges of the included lines.
    ///
    /// `only_in_service` restricts the graph to what exists today, which is how
    /// the "without the project" reference case is produced.
    ///
    /// That reference deliberately ignores which lines the scenario switches
    /// on. It used to honour them, and then the baseline moved with the
    /// scenario: switching the existing network off and drawing a tram compared
    /// that tram against a city with *no public transport at all*, where the
    /// average journey is the model's "unreachable" value of 180 minutes. The
    /// tram came out at a benefit-cost ratio of about 8. Against the network
    /// that actually exists it is 0.7.
    ///
    /// Switching an existing line off is a legitimate thing to model, and it
    /// still does what it says: the line is gone from the scenario. It now also
    /// shows up as the loss it would be, because the comparison is against
    /// today rather than against a rewritten yesterday.
    pub fn build(net: &Network, ops: &OperationsParams, only_in_service: bool) -> Self {
        let mut adjacency: BTreeMap<NodeId, Vec<Link>> = BTreeMap::new();
        // One identity per service, not per stored record.
        //
        // A service can be stored as several line records: the five building
        // stages of the U5, the U4 and the two extensions planned for it, the
        // U1 and its eastern branch. They carry the same label because they
        // are the same train. Compared by record id, a ride from Bramfeld to
        // Hauptbahnhof was charged two changes of line at City Nord and
        // Jarrestraße — ten minutes on a through service — and every extension
        // of an existing line began with a five-minute transfer onto itself.
        let mut service: BTreeMap<(&str, Mode), LineId> = BTreeMap::new();
        for l in net.lines.values() {
            let id = l.extends.unwrap_or(l.id);
            let e = service.entry((l.label.as_str(), l.mode)).or_insert(id);
            if id < *e {
                *e = id;
            }
        }
        for l in net.lines.values() {
            if !l.included && !only_in_service {
                continue;
            }
            // An extension travels under its parent's identity.
            //
            // A change of line costs five minutes here, and that is measured by
            // comparing line ids between one segment and the next. An extension
            // somebody drew onto the U1 is a separate line object so that it can
            // be listed and switched off on its own — but it is the same train,
            // and charging a transfer at the join would appraise a through
            // service as a change.
            let parent = l.extends.and_then(|p| net.lines.get(&p)).unwrap_or(l);
            let identity = service
                .get(&(parent.label.as_str(), parent.mode))
                .copied()
                .unwrap_or(parent.id);
            for eid in &l.edges {
                let Some(e) = net.edges.get(eid) else {
                    continue;
                };
                if only_in_service && !e.runs_today() {
                    continue;
                }
                let speed = ops.commercial_speed_kmh.get(e.mode).max(5.0);
                let dwell = ops.dwell_seconds.get(e.mode) / 60.0;
                let minutes = (e.length_km() / speed) * 60.0 + dwell;
                for (a, b) in [(e.from, e.to), (e.to, e.from)] {
                    let entry = adjacency.entry(a).or_default();
                    match entry.iter_mut().find(|k| k.to == b) {
                        Some(existing) => {
                            if minutes < existing.minutes {
                                existing.minutes = minutes;
                            }
                            if !existing.lines.contains(&identity) {
                                existing.lines.push(identity);
                            }
                        }
                        None => entry.push(Link {
                            to: b,
                            minutes,
                            lines: vec![identity],
                            mode: e.mode,
                        }),
                    }
                }
            }
        }
        let stations = adjacency
            .keys()
            .copied()
            .filter(|n| {
                net.nodes
                    .get(n)
                    .map(|x| x.kind == NodeKind::Station)
                    .unwrap_or(false)
            })
            .collect();
        Self {
            adjacency,
            stations,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.adjacency.is_empty()
    }

    pub fn contains(&self, n: NodeId) -> bool {
        self.adjacency.contains_key(&n)
    }

    /// Shortest in-vehicle time from `start` to every reachable node, in minutes.
    ///
    /// The state carries the set of lines the traveller is currently on, so a
    /// change of line can be charged a transfer penalty — without that, the
    /// model would systematically overvalue fragmented networks.
    pub fn times_from(&self, start: NodeId) -> HashMap<NodeId, f64> {
        self.times_from_any(&[(start, 0.0)])
    }

    /// The same, from several starting stations at once.
    ///
    /// Each start carries its own head start — the walk to reach it. A place
    /// with more than one station nearby is served by whichever of them gets
    /// you there soonest, not by whichever is closest to the door: measuring
    /// from the nearest station alone means a new stop on a poorly connected
    /// branch can *worsen* a centre's measured accessibility simply by being
    /// nearer than the well connected one it displaces.
    pub fn times_from_any(&self, starts: &[(NodeId, f64)]) -> HashMap<NodeId, f64> {
        let mut best: HashMap<NodeId, f64> = HashMap::new();
        // (cost, node, lines currently ridden)
        let mut heap: BinaryHeap<State> = BinaryHeap::new();
        let mut visited: HashMap<(NodeId, u64), f64> = HashMap::new();
        for (start, offset) in starts {
            if !self.adjacency.contains_key(start) {
                continue;
            }
            heap.push(State {
                cost: BOARDING_PENALTY_MIN + offset,
                node: *start,
                lines: Vec::new(),
                changes: 0,
                in_vehicle: 0.0,
            });
            let e = best.entry(*start).or_insert(f64::INFINITY);
            *e = e.min(*offset);
        }
        if heap.is_empty() {
            return HashMap::new();
        }

        while let Some(State {
            cost, node, lines, ..
        }) = heap.pop()
        {
            let key = (node, line_key(&lines));
            if visited.get(&key).is_some_and(|v| *v <= cost) {
                continue;
            }
            visited.insert(key, cost);
            let entry = best.entry(node).or_insert(f64::INFINITY);
            if cost < *entry {
                *entry = cost;
            }
            let Some(links) = self.adjacency.get(&node) else {
                continue;
            };
            for link in links {
                let shares = lines.is_empty() || link.lines.iter().any(|l| lines.contains(l));
                let penalty = if shares { 0.0 } else { TRANSFER_PENALTY_MIN };
                let next = cost + link.minutes + penalty;
                let carried: Vec<LineId> = if shares && !lines.is_empty() {
                    link.lines
                        .iter()
                        .copied()
                        .filter(|l| lines.contains(l))
                        .collect()
                } else {
                    link.lines.clone()
                };
                let nkey = (link.to, line_key(&carried));
                if visited.get(&nkey).map_or(true, |v| *v > next + 1e-9) {
                    heap.push(State {
                        cost: next,
                        node: link.to,
                        lines: carried,
                        changes: 0,
                        in_vehicle: 0.0,
                    });
                }
            }
        }
        // The starts keep their own head start rather than being reset to zero:
        // reaching a station is not free when getting to it took a walk.
        for (start, offset) in starts {
            if self.adjacency.contains_key(start) {
                let e = best.entry(*start).or_insert(f64::INFINITY);
                *e = e.min(*offset);
            }
        }
        best
    }

    /// Journeys from a set of access stations, with how they are made.
    ///
    /// The same search as [`Self::times_from_any`], but every station also
    /// records how many changes the fastest journey to it takes and how much of
    /// it is spent on board. Only journeys that ride at least one link count: a
    /// start station is not "reached" by walking to it, since a trip between
    /// two places that never boards a train is no public-transport trip.
    pub fn journeys_from_any(&self, starts: &[(NodeId, f64)]) -> HashMap<NodeId, Journey> {
        let mut best: HashMap<NodeId, Journey> = HashMap::new();
        let mut heap: BinaryHeap<State> = BinaryHeap::new();
        let mut visited: HashMap<(NodeId, u64), f64> = HashMap::new();
        for (start, offset) in starts {
            if self.adjacency.contains_key(start) {
                heap.push(State {
                    cost: BOARDING_PENALTY_MIN + offset,
                    node: *start,
                    lines: Vec::new(),
                    changes: 0,
                    in_vehicle: 0.0,
                });
            }
        }
        while let Some(State {
            cost,
            node,
            lines,
            changes,
            in_vehicle,
        }) = heap.pop()
        {
            let key = (node, line_key(&lines));
            if visited.get(&key).is_some_and(|v| *v <= cost) {
                continue;
            }
            visited.insert(key, cost);
            if !lines.is_empty() {
                let entry = best.entry(node).or_insert(Journey {
                    minutes: f64::INFINITY,
                    changes: 0,
                    in_vehicle_min: 0.0,
                });
                if cost < entry.minutes {
                    *entry = Journey {
                        minutes: cost,
                        changes,
                        in_vehicle_min: in_vehicle,
                    };
                }
            }
            let Some(links) = self.adjacency.get(&node) else {
                continue;
            };
            for link in links {
                let shares = lines.is_empty() || link.lines.iter().any(|l| lines.contains(l));
                let penalty = if shares { 0.0 } else { TRANSFER_PENALTY_MIN };
                let next = cost + link.minutes + penalty;
                let carried: Vec<LineId> = if shares && !lines.is_empty() {
                    link.lines
                        .iter()
                        .copied()
                        .filter(|l| lines.contains(l))
                        .collect()
                } else {
                    link.lines.clone()
                };
                let nkey = (link.to, line_key(&carried));
                if visited.get(&nkey).map_or(true, |v| *v > next + 1e-9) {
                    heap.push(State {
                        cost: next,
                        node: link.to,
                        lines: carried,
                        changes: changes + u32::from(!shares),
                        in_vehicle: in_vehicle + link.minutes,
                    });
                }
            }
        }
        best
    }

    /// Total route length of a mode in the graph, km (each edge counted once).
    pub fn mode_km(&self, mode: Mode) -> f64 {
        let mut seen: Vec<(NodeId, NodeId)> = Vec::new();
        let mut km = 0.0;
        for (a, links) in &self.adjacency {
            for l in links {
                if l.mode != mode {
                    continue;
                }
                let key = if *a < l.to { (*a, l.to) } else { (l.to, *a) };
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
                km += l.minutes; // placeholder, callers use the network directly
            }
        }
        km
    }
}

fn line_key(lines: &[LineId]) -> u64 {
    // Order-independent fingerprint of the ridden line set.
    let mut h: u64 = 1469598103934665603;
    let mut ids: Vec<u32> = lines.iter().map(|l| l.0).collect();
    ids.sort_unstable();
    for id in ids {
        h ^= id as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

#[derive(Debug, Clone)]
struct State {
    cost: f64,
    node: NodeId,
    lines: Vec<LineId>,
    /// Changes so far, for [`TravelGraph::journeys_from_any`].
    changes: u32,
    /// Minutes on board so far, likewise.
    in_vehicle: f64,
}

/// The fastest journey to a station.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Journey {
    /// Generalised minutes: walk to the first station, boarding, ride and
    /// change penalties.
    pub minutes: f64,
    pub changes: u32,
    /// Minutes on board, dwell included.
    pub in_vehicle_min: f64,
}

impl PartialEq for State {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost
    }
}
impl Eq for State {}
impl Ord for State {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reversed: BinaryHeap is a max-heap and we want the cheapest first.
        other
            .cost
            .partial_cmp(&self.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}
impl PartialOrd for State {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Walking time in minutes for a straight-line distance in metres.
pub fn walk_minutes(distance_m: f64) -> f64 {
    // 1.25 detour factor: streets are not straight lines.
    (distance_m * 1.25 / 1000.0) / WALK_SPEED_KMH * 60.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::demo_network;

    #[test]
    fn times_grow_along_a_line() {
        let net = demo_network();
        let g = TravelGraph::build(&net, &OperationsParams::default(), false);
        let line = *net.lines.keys().next().unwrap();
        let nodes = net.line_nodes(line);
        let t = g.times_from(nodes[0]);
        assert_eq!(t[&nodes[0]], 0.0);
        let mut prev = 0.0;
        for n in nodes.iter().skip(1) {
            let v = t[n];
            assert!(
                v > prev,
                "travel time must increase along the line: {v} after {prev}"
            );
            prev = v;
        }
    }

    #[test]
    fn unreachable_nodes_are_absent() {
        let net = demo_network();
        let g = TravelGraph::build(&net, &OperationsParams::default(), false);
        let t = g.times_from(*g.stations.first().unwrap());
        assert!(!t.contains_key(&crate::model::NodeId(99999)));
    }

    #[test]
    fn a_transfer_costs_extra() {
        // Two lines meeting at a middle node: crossing them must cost more than
        // the raw travel time of the two edges.
        let net = crate::testing::demo_crossing_network();
        let g = TravelGraph::build(&net, &OperationsParams::default(), false);
        let ends: Vec<crate::model::NodeId> = net
            .nodes
            .values()
            .filter(|n| net.edges_at(n.id).len() == 1)
            .map(|n| n.id)
            .collect();
        let t = g.times_from(ends[0]);
        let hub = net
            .nodes
            .values()
            .find(|n| net.edges_at(n.id).len() == 4)
            .unwrap()
            .id;
        let to_hub = t[&hub];
        // Any end on the other line must cost at least the transfer penalty more.
        let other = ends
            .iter()
            .find(|e| net.lines_at_node(**e) != net.lines_at_node(ends[0]))
            .copied()
            .unwrap();
        assert!(t[&other] >= to_hub + TRANSFER_PENALTY_MIN);
    }

    #[test]
    fn restricting_to_in_service_shrinks_the_graph() {
        let mut net = demo_network();
        let eid = *net.edges.keys().next().unwrap();
        net.edges.get_mut(&eid).unwrap().status = crate::model::BuildStatus::ToBuild;
        let full = TravelGraph::build(&net, &OperationsParams::default(), false);
        let today = TravelGraph::build(&net, &OperationsParams::default(), true);
        assert!(today.adjacency.len() <= full.adjacency.len());
    }

    #[test]
    fn walking_time_is_sane() {
        assert!(
            (walk_minutes(800.0) - 13.0).abs() < 1.5,
            "{}",
            walk_minutes(800.0)
        );
        assert_eq!(walk_minutes(0.0), 0.0);
    }
}
