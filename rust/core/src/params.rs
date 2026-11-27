//! Every number the models use lives here (plan §15, §27, §30, §32, §33).
//!
//! Nothing in the engine hard-codes a cost, a duration or a benefit rate: the
//! whole parameter set is data, is versioned, and travels with a scenario so
//! that a published result stays reproducible when the model later improves
//! (plan §37, §38).
//!
//! ## Calibration
//!
//! The construction-cost parameters are calibrated against two published
//! Hamburg reference points:
//!
//! * U5 City Nord – Jarrestraße: ~2.6 km, 2 deep stations, presented at about
//!   €1.5 bn (HOCHBAHN, 2024/25 communication).
//! * U5 overall concept quoted at about €16.5 bn versus about €1.5 bn for the
//!   ~44 km / 91-stop tram alternative put forward by Die Linke in August 2026.
//!
//! `cargo test --package hh-core calibration` re-checks both.

use crate::model::{Infrastructure, Mode, StationDepth};
use serde::{Deserialize, Serialize};

/// Bump this whenever a change moves the numbers.
///
/// 0.17.0: travel-time benefit follows from a destination- and mode-choice
/// model instead of a fixed induced share. Residents are grouped into the
/// city's districts and five-kilometre tiles of the region, each district pair
/// is timed door to door with walks, waits and changes, and a logit over
/// destinations and against the other modes — calibrated on today's boardings
/// and an in-vehicle-time elasticity of −0.5 (TRL593) — turns the faster
/// journeys into consumer surplus. Trips per resident: 3.0 in Hamburg
/// (MiD 2023), 3.3 in Berlin (SrV 2023). Residents of the towns inside the
/// Hamburg raster's square but outside the city — Pinneberg, Norderstedt,
/// Ahrensburg — had been dropped from the travel-time appraisal and now count.
///
/// 0.16.0: the valuation and calibration figures are re-based on published
/// sources. The value of time (6.60 €/h), accident cost (8.5 ct/car-km), car
/// emissions (168 g/km) and the price of CO2 (670 €/t) now come from the
/// Standardisierte Bewertung 2016+ and are scaled from 2016 to 2026 prices with
/// the consumer price index; before, the value of time was 11.20 €/h and CO2
/// was priced at 300 €/t. Boardings per catchment are calibrated on the rides
/// the operators report for 2025 (Hamburg 571 M, Berlin 1 249 M a year) instead
/// of on a weekday range that turned out to be a third too low, and the
/// operating cost rates on HOCHBAHN's published cost recovery of 75 %. Both
/// cities' VAT shares follow the current population key (2.24 % and 4.43 %).
/// And the appraisal charges a project only with the *change* in the operating
/// result against today's network; it used to charge the deficit of the whole
/// network, existing lines included, to whatever was built.
///
/// 0.15.0: the comparison case is today's network, and losses count.
///
/// Two faults that flattered any scenario built on a cleared map. The "without
/// the project" reference was assembled from the lines the scenario had
/// switched *on*, so switching the existing network off compared a plan against
/// a city with no public transport at all, where the average journey is the
/// unreachable value of 180 minutes. Four tram lines in place of Hamburg's
/// whole network scored a benefit-cost ratio near eight. The reference is now
/// what exists today, whatever the scenario includes.
///
/// And the travel-time term was floored at zero, so a scenario that lengthened
/// journeys was charged nothing for it while still collecting the benefits of
/// what it built. The same tram scenario made the average journey twenty
/// minutes longer and still scored close to three. The term is signed now: it
/// only turns negative when something existing was taken away, because building
/// cannot make the measure worse. That scenario now reads minus 3.8.
///
/// 0.14.0 — the appraisal counts the region. Travel-time savings, the largest
/// item, were computed only over the city's own 200-metre raster, which stops
/// 21 km from the centre: everyone outside it contributed nothing, so a
/// regional S-Bahn to Lüneburg scored one saved hour a day against twenty
/// thousand new boardings. Both rasters are now walked, each cell counted from
/// whichever is finer where it lies. The placeholder for "no rail service at
/// all" rises from 75 to 180 minutes, because 75 is less than a real journey
/// from the edge of the region and connecting a town that had none therefore
/// *raised* the modelled average access time. Stations no longer stack: where a
/// corridor doubles back, spacing measured along the line let two stops sit 91 m
/// apart on the ground. The headline gains `populationGain`, the people a plan
/// newly brings within walking distance, because the absolute count is
/// dominated by the existing network and cannot compare plans.
///
/// 0.13.0 — accessibility is measured monotonically. Two faults made building
/// track able to make the modelled city *slower*, which set travel-time savings
/// and the agglomeration benefit — the two largest items in any appraisal — to
/// exactly zero for a scenario that added lines in the periphery. First, an
/// employment centre was measured from the single *nearest* station, so a new
/// stop that landed closer than the interchange it displaced moved the centre
/// onto that stop's branch; now every station within walking distance is a way
/// in, each with its own walk. Second, the set of centres in the average was
/// built from the stations that existed, so a scenario reaching a new centre
/// added a term to every cell's average — at the unreachable penalty for
/// everyone far away — and the mean got worse for having built something; the
/// average now runs over all of the city's centres, always.
///
/// 0.12.0 — construction type is chosen per section from water, density and
/// existing rail corridors instead of one type for a whole line; the
/// agglomeration benefit no longer applies an elasticity to a *level* (which
/// credited every newly served resident with four per cent of their annual
/// output for ever, 45 % of the whole benefit); the share of new trips that
/// replace a car falls from 0.42 to 0.28, in line with post-opening surveys.
///
/// 0.11.0 — station spacing follows the local population instead of a fixed
/// city interval, so a line through open country stops at the villages rather
/// than every 1.9 km; a station has to be worth building at all; a stop drawn
/// on top of an existing station keeps that station's identity.
///
/// 0.10.0 — junctions are only charged where track actually branches;
/// construction stages of one line no longer count as an interchange or buy
/// their own fleet; planning phases are scaled by the share not already under
/// construction; corners are filleted, so alignments are slightly shorter.
pub const CALCULATION_VERSION: &str = "0.17.0";

/// Reference price level of all monetary parameters.
pub const PRICE_BASE_YEAR: i32 = 2026;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Params {
    pub version: String,
    pub price_base_year: i32,
    /// The city whose published project costs these rates were fitted to.
    ///
    /// Worth saying out loud rather than leaving implicit: Berlin runs on rates
    /// fitted to Hamburg's projects, with two figures of its own, and no Berlin
    /// reference currently verifies them. A reader of a Berlin estimate should
    /// know that.
    pub calibrated_on: String,
    pub geometry: GeometryParams,
    pub stations: StationParams,
    pub cost: CostParams,
    pub timeline: TimelineParams,
    pub feasibility: FeasibilityParams,
    pub demand: DemandParams,
    pub economics: EconomicsParams,
    pub fiscal: FiscalParams,
    pub operations: OperationsParams,
}

impl Params {
    /// A short digest of the actual parameter *values*.
    ///
    /// `version` names the shape of the calculation; it does not move when a
    /// figure inside it does. Two cities now run the same version with
    /// different numbers, and a recalibration changes numbers without changing
    /// the version — so a stored result cannot be told apart from a current one
    /// by version alone. This can. FNV-1a over the canonical JSON: not a
    /// cryptographic hash, but deterministic across builds and machines, which
    /// is what a value written into a database has to be.
    pub fn fingerprint(&self) -> String {
        // serde_json's object map is a BTreeMap, so the encoding is key-sorted
        // and the same parameter set always produces the same bytes.
        let json = serde_json::to_string(self).unwrap_or_default();
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in json.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x1000_0000_01b3);
        }
        format!("{h:016x}")[..12].to_string()
    }

    /// Every figure a parameter set may hold is a non-negative, finite amount
    /// of something — euros, years, shares, minutes. A set that comes from a
    /// saved document is not under our control, and one negative build cost or
    /// zero-length year would quietly turn every result upside down, so it is
    /// checked before it replaces the city's own set. Returns the offending
    /// paths, empty when the set is usable.
    pub fn validate(&self) -> Vec<String> {
        fn walk(v: &serde_json::Value, path: &str, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Object(m) => {
                    for (k, x) in m {
                        walk(x, &format!("{path}.{k}"), out);
                    }
                }
                serde_json::Value::Array(a) => {
                    for (i, x) in a.iter().enumerate() {
                        walk(x, &format!("{path}[{i}]"), out);
                    }
                }
                serde_json::Value::Number(n) => match n.as_f64() {
                    Some(f) if f.is_finite() && (0.0..=1e13).contains(&f) => {}
                    _ => out.push(format!("{} hat den unzulässigen Wert {n}", &path[1..])),
                },
                // serde_json writes a non-finite float as null.
                serde_json::Value::Null => out.push(format!("{} fehlt", &path[1..])),
                _ => {}
            }
        }
        let mut out = Vec::new();
        match serde_json::to_value(self) {
            Ok(v) => walk(&v, "", &mut out),
            Err(e) => out.push(e.to_string()),
        }
        out
    }
}

impl Default for Params {
    fn default() -> Self {
        Self {
            version: CALCULATION_VERSION.to_string(),
            price_base_year: PRICE_BASE_YEAR,
            calibrated_on: "Hamburg".to_string(),
            geometry: GeometryParams::default(),
            stations: StationParams::default(),
            cost: CostParams::default(),
            timeline: TimelineParams::default(),
            feasibility: FeasibilityParams::default(),
            demand: DemandParams::default(),
            economics: EconomicsParams::default(),
            fiscal: FiscalParams::default(),
            operations: OperationsParams::default(),
        }
    }
}

// ---------------------------------------------------------------- geometry --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GeometryParams {
    /// Invisible schematic grid, metres (plan §6).
    pub grid_size_m: f64,
    /// Angles the alignment is nudged onto when it is already close to one.
    pub allowed_angles_deg: Vec<f64>,
    /// How close to a preferred angle the drawn direction has to be before it
    /// is snapped. Beyond this the user draws freely: a hard constraint turns
    /// "draw the line you want" into "fight the grid".
    pub angle_snap_tolerance_deg: f64,
    /// Snap radius for stations/junctions, in screen pixels.
    ///
    /// Pixels rather than metres: a snap that reaches 25 px feels the same at
    /// every zoom, whereas a fixed metric radius silently becomes a kilometre
    /// when you zoom out and the cursor jumps somewhere you never pointed.
    pub snap_node_px: f64,
    /// Snap radius for existing edges, in screen pixels.
    pub snap_edge_px: f64,
    /// Snap radius for landmarks and streets, in screen pixels.
    pub snap_landmark_px: f64,
    /// Whatever the zoom, snapping never moves the point further than this on
    /// the ground.
    pub snap_max_m: f64,
    /// The grid is only worth snapping to once a cell is this many pixels.
    pub grid_min_px: f64,
    /// Below this distance a new node is merged into an existing one.
    pub merge_node_radius_m: f64,
    /// Simplification tolerance for rendering geometry, metres.
    pub render_tolerance_m: f64,
    /// Corners are filleted to this multiple of the mode's minimum radius, so
    /// a drawn line curves like track instead of turning on a point.
    pub corner_radius_factor: f64,
    /// How far a fillet may pull the alignment away from the drawn corner.
    /// Keeps a station that sits on a corner still sitting on the track.
    pub corner_deviation_m: f64,
    /// How far a fillet may move the track at a station. A platform is about
    /// 120 m long, so a few metres keeps the station on its own alignment
    /// while still giving the corner a usable radius.
    pub station_corner_deviation_m: f64,
}

impl Default for GeometryParams {
    fn default() -> Self {
        Self {
            grid_size_m: 125.0,
            // The classic transit-map family. Sixteen directions would leave
            // almost nothing unsnapped; eight with a tight tolerance means the
            // guide helps you find a clean angle without ever taking the pen
            // out of your hand.
            allowed_angles_deg: vec![0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0],
            angle_snap_tolerance_deg: 5.0,
            snap_node_px: 26.0,
            snap_edge_px: 18.0,
            snap_landmark_px: 16.0,
            snap_max_m: 420.0,
            grid_min_px: 14.0,
            merge_node_radius_m: 45.0,
            render_tolerance_m: 6.0,
            corner_radius_factor: 1.6,
            corner_deviation_m: 90.0,
            station_corner_deviation_m: 12.0,
        }
    }
}

// ---------------------------------------------------------------- stations --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StationParams {
    /// Target spacing per mode, metres (plan §15).
    pub target_spacing_m: ModeValues,
    pub min_spacing_m: ModeValues,
    pub max_spacing_m: ModeValues,
    /// Radius within which landmarks may name and attract a station (plan §14).
    pub landmark_search_radius_m: f64,
    /// A new line closer than this to an existing station offers an interchange
    /// (plan §16).
    pub interchange_offer_radius_m: f64,
    /// Below this, the interchange is treated as an in-station connection.
    pub interchange_direct_radius_m: f64,
    /// Weight of the catchment score against the spacing penalty.
    pub catchment_weight: f64,
    pub interchange_bonus: f64,
    pub landmark_bonus: f64,
    /// A landmark only lends a station its name above this importance. Below
    /// it, the landmark still justifies a stop but the name comes from the
    /// street or the neighbourhood, as German stop names normally do.
    pub landmark_naming_weight: f64,
    /// Population within the walking catchment needed for a "full" score.
    pub catchment_reference_population: f64,
    /// How far the spacing may stretch where almost nobody lives.
    ///
    /// The target spacings are city values. A line crossing open country would
    /// otherwise still collect a stop every 1.9 km; in reality regional
    /// services skip the empty stretches and stop at the villages. The factor
    /// is derived from the catchment along each gap, so it is continuous
    /// rather than a town/country switch. A U-Bahn or tram barely stretches —
    /// those modes only exist where the city is dense — while an S-Bahn or a
    /// regional line crossing open country stretches a long way.
    pub rural_spacing_stretch: ModeValues,
    /// A stop only counts as rural naming territory beyond the normal landmark
    /// radius; this is how far out a village may still lend its name, metres.
    pub rural_naming_radius_m: f64,
    /// What a station has to be worth before it is built at all.
    ///
    /// Without this every extra stop is free as long as the spacing fits, so a
    /// line through open country would collect a stop every target interval.
    /// Charging each station a fixed value makes the solver stretch the
    /// spacing where nobody lives and tighten it where people do — which is
    /// what real S-Bahn extensions look like.
    pub station_marginal_value: f64,
}

impl Default for StationParams {
    fn default() -> Self {
        Self {
            target_spacing_m: ModeValues {
                ubahn: 1000.0,
                sbahn: 1900.0,
                tram: 450.0,
                regional: 4500.0,
            },
            min_spacing_m: ModeValues {
                ubahn: 550.0,
                sbahn: 900.0,
                tram: 300.0,
                regional: 2000.0,
            },
            max_spacing_m: ModeValues {
                ubahn: 2200.0,
                sbahn: 4200.0,
                tram: 900.0,
                regional: 9000.0,
            },
            landmark_search_radius_m: 500.0,
            interchange_offer_radius_m: 300.0,
            interchange_direct_radius_m: 120.0,
            catchment_weight: 1.0,
            interchange_bonus: 1.4,
            landmark_bonus: 0.45,
            landmark_naming_weight: 0.55,
            catchment_reference_population: 9000.0,
            rural_spacing_stretch: ModeValues {
                ubahn: 1.35,
                sbahn: 3.0,
                tram: 1.2,
                regional: 3.5,
            },
            rural_naming_radius_m: 4500.0,
            station_marginal_value: 0.42,
        }
    }
}

// -------------------------------------------------------------------- cost --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CostParams {
    /// Track construction cost per km of double track, € (2026 prices).
    pub per_km_eur: InfrastructureValues,
    /// Discount applied when only a single track is built.
    pub single_track_factor: f64,
    /// Station box cost by depth class, €.
    pub station_eur: DepthValues,
    /// Multiplier for a station that connects to existing infrastructure.
    pub interchange_station_factor: f64,
    /// Share of a new station charged when an existing station gains a service
    /// it did not have: a new platform level, passages, lifts.
    pub station_upgrade_share: f64,
    /// Share charged when a line is merely extended past its own terminus.
    /// The platforms exist; the turnback goes and the tunnel carries on.
    pub station_extension_share: f64,
    /// Junction cost by the infrastructure it sits in, €.
    pub junction_eur: InfrastructureValues,
    /// Extra cost per metre of water crossed, by infrastructure, €.
    pub water_crossing_per_m_eur: InfrastructureValues,
    /// Cost uplift at maximum urban density (linear in the density index).
    pub urban_density_uplift: f64,
    /// Uplift for difficult subsoil — Hamburg's soft marsh and sand below the
    /// water table. Set per city; a city on firmer ground carries less.
    pub ground_conditions_factor: f64,
    /// Planning and design as a share of construction cost.
    pub planning_share: f64,
    /// Client-side project management as a share of construction cost.
    pub project_management_share: f64,
    /// Land acquisition and utility diversions, share of construction cost.
    pub land_and_utilities_share: InfrastructureShares,
    /// Risk provision, share of construction cost.
    pub contingency_share: InfrastructureShares,
    /// Rolling stock cost per car, €.
    pub vehicle_per_car_eur: ModeValues,
    /// Spare ratio on top of the peak vehicle requirement.
    pub vehicle_reserve_share: f64,
    /// Depot and workshop cost per vehicle, €.
    pub depot_per_car_eur: ModeValues,
    /// Annual construction-price escalation applied to the construction midpoint.
    pub price_escalation_per_year: f64,
    /// Half-width of the reported uncertainty band, relative to the point estimate.
    pub uncertainty_share: InfrastructureShares,
}

impl Default for CostParams {
    fn default() -> Self {
        Self {
            per_km_eur: InfrastructureValues {
                deep_tunnel: 105.0e6,
                cut_and_cover: 82.0e6,
                elevated: 45.0e6,
                surface: 26.0e6,
                existing_rail: 6.5e6,
                tram_reserved: 14.0e6,
                tram_mixed: 10.5e6,
                bridge: 120.0e6,
            },
            single_track_factor: 0.68,
            station_eur: DepthValues {
                stop: 0.85e6,
                surface: 16.0e6,
                elevated: 34.0e6,
                shallow: 125.0e6,
                deep: 215.0e6,
            },
            interchange_station_factor: 1.45,
            station_upgrade_share: 0.35,
            station_extension_share: 0.10,
            junction_eur: InfrastructureValues {
                deep_tunnel: 92.0e6,
                cut_and_cover: 58.0e6,
                elevated: 22.0e6,
                surface: 12.0e6,
                existing_rail: 15.0e6,
                tram_reserved: 2.6e6,
                tram_mixed: 2.2e6,
                bridge: 30.0e6,
            },
            water_crossing_per_m_eur: InfrastructureValues {
                deep_tunnel: 145_000.0,
                cut_and_cover: 210_000.0,
                elevated: 95_000.0,
                surface: 85_000.0,
                existing_rail: 40_000.0,
                tram_reserved: 70_000.0,
                tram_mixed: 70_000.0,
                bridge: 85_000.0,
            },
            urban_density_uplift: 0.30,
            ground_conditions_factor: 1.08,
            planning_share: 0.12,
            project_management_share: 0.04,
            land_and_utilities_share: InfrastructureShares {
                tunnel: 0.03,
                surface: 0.075,
                tram: 0.06,
            },
            contingency_share: InfrastructureShares {
                tunnel: 0.25,
                surface: 0.17,
                tram: 0.15,
            },
            vehicle_per_car_eur: ModeValues {
                ubahn: 2.9e6,
                sbahn: 2.1e6,
                tram: 3.6e6,
                regional: 2.6e6,
            },
            vehicle_reserve_share: 0.18,
            depot_per_car_eur: ModeValues {
                ubahn: 0.9e6,
                sbahn: 0.8e6,
                tram: 0.7e6,
                regional: 0.8e6,
            },
            price_escalation_per_year: 0.020,
            uncertainty_share: InfrastructureShares {
                tunnel: 0.32,
                surface: 0.24,
                tram: 0.20,
            },
        }
    }
}

// ---------------------------------------------------------------- timeline --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TimelineParams {
    /// Year in which planning is assumed to start.
    pub planning_start_year: i32,
    /// Preliminary design, years, scaled by project complexity.
    pub preliminary_design_years: f64,
    /// Planning approval (Planfeststellung), years.
    pub approval_years: ModeValues,
    /// Detailed design, years.
    pub detailed_design_years: f64,
    /// Procurement, years.
    pub procurement_years: f64,
    /// Share of the approval phase that runs in parallel with detailed design.
    pub design_overlap: f64,
    /// Fixed site setup before real construction output starts, years.
    pub construction_setup_years: InfrastructureShares,
    /// Construction time per km, years.
    pub years_per_km: InfrastructureValues,
    /// Construction time per station, years.
    pub years_per_station: DepthValues,
    /// Maximum number of construction fronts worked in parallel.
    pub max_parallel_fronts: f64,
    /// How much of that parallelism survives inside an operating railway.
    ///
    /// Five simultaneous work sites is reasonable on a new alignment. On a line
    /// that keeps carrying trains it is not: work happens in possessions,
    /// sequenced around traffic, and only a couple of sites can be open at once.
    /// The S4 to Bad Oldesloe is 47 km almost entirely inside the existing
    /// Lübecker Bahn and is being built from 2023 to 2032 — about nine years,
    /// where the context-free model said three.
    pub fronts_in_corridor: f64,
    /// Kilometres of route per additional parallel front.
    pub km_per_front: f64,
    /// Testing and commissioning, years.
    pub commissioning_years: ModeValues,
    /// Relative schedule uncertainty.
    pub schedule_uncertainty: f64,
}

impl Default for TimelineParams {
    fn default() -> Self {
        Self {
            planning_start_year: 2026,
            preliminary_design_years: 2.2,
            approval_years: ModeValues {
                ubahn: 3.4,
                sbahn: 3.2,
                tram: 2.4,
                regional: 3.0,
            },
            detailed_design_years: 2.0,
            procurement_years: 1.1,
            design_overlap: 0.55,
            construction_setup_years: InfrastructureShares {
                tunnel: 1.5,
                surface: 0.8,
                tram: 0.7,
            },
            years_per_km: InfrastructureValues {
                deep_tunnel: 0.45,
                cut_and_cover: 0.60,
                elevated: 0.32,
                surface: 0.22,
                existing_rail: 0.14,
                tram_reserved: 0.18,
                tram_mixed: 0.14,
                bridge: 0.75,
            },
            years_per_station: DepthValues {
                stop: 0.12,
                surface: 0.7,
                elevated: 1.0,
                shallow: 1.6,
                deep: 2.0,
            },
            max_parallel_fronts: 5.0,
            fronts_in_corridor: 0.35,
            km_per_front: 4.0,
            commissioning_years: ModeValues {
                ubahn: 1.0,
                sbahn: 1.0,
                tram: 0.6,
                regional: 0.8,
            },
            schedule_uncertainty: 0.16,
        }
    }
}

// ------------------------------------------------------------- feasibility --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FeasibilityParams {
    /// Minimum horizontal curve radius, metres.
    pub min_curve_radius_m: ModeValues,
    /// Maximum longitudinal gradient, per mille (informational).
    pub max_gradient_permille: ModeValues,
    /// A tram segment longer than this without a street corridor is flagged.
    pub tram_offstreet_tolerance_m: f64,
    /// Above this density index, a surface or elevated alignment needs land
    /// that a built-up city does not have.
    pub surface_density_limit: f64,
    /// Above this, the honest answer is that it would be built in tunnel.
    pub surface_density_blocking: f64,
    /// How close an alignment has to run to existing track to count as using
    /// that corridor, metres.
    pub rail_corridor_radius_m: f64,
    /// Chord length over which curvature is measured, metres. Long enough that
    /// vertex noise cancels, short enough to catch a real dog-leg.
    pub curve_chord_m: f64,
    /// Water crossing longer than this is a major structure.
    pub major_water_crossing_m: f64,
    /// Segment length below which a segment is considered degenerate.
    pub min_segment_length_m: f64,
}

impl Default for FeasibilityParams {
    fn default() -> Self {
        Self {
            min_curve_radius_m: ModeValues {
                ubahn: 190.0,
                sbahn: 300.0,
                tram: 25.0,
                regional: 400.0,
            },
            max_gradient_permille: ModeValues {
                ubahn: 40.0,
                sbahn: 25.0,
                tram: 70.0,
                regional: 12.5,
            },
            tram_offstreet_tolerance_m: 350.0,
            surface_density_limit: 0.55,
            surface_density_blocking: 0.72,
            rail_corridor_radius_m: 70.0,
            curve_chord_m: 55.0,
            major_water_crossing_m: 250.0,
            min_segment_length_m: 40.0,
        }
    }
}

// ------------------------------------------------------------------ demand --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DemandParams {
    /// Walking catchment radius, metres.
    pub catchment_radius_m: ModeValues,
    /// Distance decay: weight = exp(-decay * d / radius).
    pub catchment_decay: f64,
    /// Weight of a workplace relative to a resident in the catchment.
    pub job_weight: f64,
    /// Boardings per weekday per weighted catchment person.
    /// Calibrated so the present-day network reproduces observed ridership.
    pub boardings_per_catchment: ModeValues,
    /// Bonus factor for an interchange station.
    pub interchange_factor: f64,
    /// Bonus for direct access to the central business district.
    pub centrality_factor: f64,
    /// Weekday boardings to annual rides.
    pub annual_factor: f64,
    /// Share of new rides that replace a car trip.
    ///
    /// Not the share of riders who own a car: the share of *newly generated*
    /// public transport trips that would otherwise have been driven. Post-
    /// opening surveys of new German urban rail put this between a fifth and a
    /// third — the rest shifts from bus, from walking and cycling, or is
    /// induced. An earlier 0.42 implied the Hamburg programme would take
    /// 96 000 car trips off the road every weekday, roughly twice what the
    /// project promoters themselves claim.
    pub car_substitution_share: f64,
    /// Average car trip length replaced, km.
    pub avg_replaced_car_trip_km: f64,
    /// Trips per resident and day, all modes. Hamburg: 3.0 (Mobilität in
    /// Deutschland 2023, Kurzbericht Hamburg, BVM 2024: all days of the week);
    /// Berlin overrides it with 3.3 (SrV 2023, Steckbrief Berlin, TU Dresden
    /// 2024: all residents, mean working day). The Hamburg figure averages in
    /// weekends and is therefore slightly low for a working day; the
    /// calibration to today's boardings absorbs the difference in the
    /// constant of the other modes. The connectivity model distributes these
    /// trips over destinations and modes.
    pub trips_per_person_day: f64,
    /// Magnitude of the elasticity of public transport demand to in-vehicle
    /// time that the connectivity model reproduces on today's network; the
    /// elasticity itself is negative. Balcombe et al. (2004), The demand for
    /// public transport, TRL593, report about −0.4 to −0.6 for urban rail and
    /// bus; 0.5 is the midpoint. Stored unsigned because every parameter is
    /// checked to be non-negative.
    pub ivt_elasticity: f64,
}

impl Default for DemandParams {
    fn default() -> Self {
        Self {
            catchment_radius_m: ModeValues {
                ubahn: 800.0,
                sbahn: 1000.0,
                tram: 500.0,
                regional: 1500.0,
            },
            catchment_decay: 1.6,
            job_weight: 1.35,
            // Calibrated on published ridership, so that the present-day
            // network of Hamburg carries what its operators report: 291 M
            // rides on the U-Bahn (HOCHBAHN 2025) and about 280 M on the S-Bahn.
            // The tram rate comes from Berlin, the only one of the two cities
            // that has a tram to observe. Berlin overrides the U- and S-Bahn
            // rates in `data/cities/berlin.json`, calibrated the same way.
            boardings_per_catchment: ModeValues {
                ubahn: 0.55,
                sbahn: 0.80,
                tram: 0.40,
                regional: 0.20,
            },
            interchange_factor: 1.55,
            centrality_factor: 1.35,
            annual_factor: 305.0,
            car_substitution_share: 0.28,
            avg_replaced_car_trip_km: 8.4,
            trips_per_person_day: 3.0,
            ivt_elasticity: 0.5,
        }
    }
}

// --------------------------------------------------------------- economics --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EconomicsParams {
    /// Value of travel time, €/hour. The Standardisierte Bewertung 2016+
    /// values a saved hour at 6.60 € in 2016 prices; the model works in 2026
    /// prices, so the figure is scaled with the consumer price index
    /// (2016 = 95.0, 2025 = 121.9, 2026 projected at +2 %): × 1.309.
    pub value_of_time_eur_h: f64,
    /// Agglomeration elasticity of productivity to effective density.
    pub agglomeration_elasticity: f64,
    /// Share of residents in work, for the agglomeration base.
    pub employment_rate: f64,
    /// Gross value added per employed person in Hamburg, €/year.
    pub gva_per_worker_eur: f64,
    /// External congestion cost avoided, €/car-km.
    pub congestion_eur_per_car_km: f64,
    /// Accident cost avoided, €/car-km (Standardisierte Bewertung 2016+:
    /// 8.5 ct in 2016 prices, scaled like the value of time).
    pub accident_eur_per_car_km: f64,
    /// Air pollution and noise avoided, €/car-km.
    pub air_noise_eur_per_car_km: f64,
    /// CO2 emitted per car-km, kg: 127 g direct plus 41 g upstream, as in the
    /// Standardisierte Bewertung 2016+.
    pub co2_kg_per_car_km: f64,
    /// CO2 emitted per passenger-km of rail (German electricity mix), kg.
    pub co2_kg_per_rail_pkm: f64,
    /// Climate damage cost, €/kg CO2 (Standardisierte Bewertung 2016+: 670 €/t
    /// in 2016 prices, scaled like the value of time).
    pub co2_eur_per_kg: f64,
    /// Health benefit of the walking stage, €/boarding.
    pub health_eur_per_boarding: f64,
    /// Land value uplift within the catchment, share of property value.
    pub land_value_uplift_share: f64,
    /// Residential property value per resident in the catchment, €.
    pub property_value_per_resident_eur: f64,
    /// Real social discount rate.
    pub discount_rate: f64,
    /// Appraisal period after opening, years.
    pub appraisal_period_years: i32,
    /// Ramp-up years until full demand is reached.
    pub demand_ramp_up_years: f64,
    /// Residual asset value at the end of the appraisal period.
    pub residual_value_share: f64,
    /// Relative uncertainty of the benefit estimate.
    pub uncertainty_share: f64,
}

impl Default for EconomicsParams {
    fn default() -> Self {
        Self {
            value_of_time_eur_h: 8.64,
            agglomeration_elasticity: 0.04,
            employment_rate: 0.52,
            gva_per_worker_eur: 92_000.0,
            congestion_eur_per_car_km: 0.108,
            accident_eur_per_car_km: 0.111,
            air_noise_eur_per_car_km: 0.019,
            co2_kg_per_car_km: 0.168,
            co2_kg_per_rail_pkm: 0.028,
            co2_eur_per_kg: 0.877,
            health_eur_per_boarding: 0.015,
            land_value_uplift_share: 0.045,
            property_value_per_resident_eur: 145_000.0,
            discount_rate: 0.017,
            appraisal_period_years: 30,
            demand_ramp_up_years: 4.0,
            residual_value_share: 0.25,
            uncertainty_share: 0.35,
        }
    }
}

// ------------------------------------------------------------------ fiscal --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FiscalParams {
    /// Effective wage-tax rate on additional gross value added.
    pub income_tax_rate: f64,
    /// Hamburg's share of income tax. As a city state it receives both the
    /// Land share (42.5 %) and the municipal share (15 %).
    pub income_tax_city_share: f64,
    /// Effective trade tax rate on additional corporate value added.
    pub trade_tax_rate: f64,
    /// Hamburg keeps the trade tax in full (no Kreisumlage).
    pub trade_tax_city_share: f64,
    /// Effective VAT rate on additional consumption.
    pub vat_rate: f64,
    /// Share of additional value added that becomes taxed consumption.
    pub consumption_share: f64,
    /// Länder share of VAT.
    pub vat_laender_share: f64,
    /// The city's share of the Länder VAT pot (population key). Hamburg 2.24 %,
    /// Berlin 4.43 % — the figure follows the city, so it is set per city in
    /// `data/cities/<id>.json` rather than being a constant of the model.
    #[serde(alias = "vatHamburgShare", alias = "vat_hamburg_share")]
    pub vat_city_share: f64,
    /// Annual property tax on the uplifted land value.
    pub property_tax_rate: f64,
    /// Real-estate transfer tax rate, applied to the churned share per year.
    pub transfer_tax_rate: f64,
    pub annual_property_turnover: f64,
    /// Share of the investment that flows back as tax during construction.
    pub construction_tax_return_share: f64,
    /// Share of federal co-funding for eligible projects (GVFG-Bundesprogramm).
    pub federal_funding_share: f64,
    /// Minimum benefit-cost ratio required for federal co-funding.
    pub federal_funding_min_bcr: f64,
}

impl Default for FiscalParams {
    fn default() -> Self {
        Self {
            income_tax_rate: 0.185,
            income_tax_city_share: 0.575,
            trade_tax_rate: 0.048,
            trade_tax_city_share: 1.0,
            vat_rate: 0.19,
            consumption_share: 0.48,
            vat_laender_share: 0.459,
            vat_city_share: 0.0224,
            property_tax_rate: 0.0035,
            transfer_tax_rate: 0.055,
            annual_property_turnover: 0.035,
            construction_tax_return_share: 0.24,
            federal_funding_share: 0.75,
            federal_funding_min_bcr: 1.0,
        }
    }
}

// -------------------------------------------------------------- operations --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OperationsParams {
    /// Operating cost per train-km, €.
    pub cost_per_train_km_eur: ModeValues,
    /// Commercial speed, km/h.
    pub commercial_speed_kmh: ModeValues,
    /// Annual infrastructure maintenance per km, €.
    pub maintenance_per_km_eur: InfrastructureValues,
    /// Annual station operating cost, €.
    pub station_opex_eur: DepthValues,
    /// Average fare revenue per boarding, €.
    pub revenue_per_boarding_eur: f64,
    /// Capacity per car, passengers.
    pub capacity_per_car: ModeValues,
    /// Dwell time per station, seconds.
    pub dwell_seconds: ModeValues,
}

impl Default for OperationsParams {
    fn default() -> Self {
        Self {
            // The three cost rates below are scaled together so that the
            // present-day Hamburg network, at its observed ridership, recovers
            // 75 % of its cost from fares — the figure HOCHBAHN reports for
            // 2025 (Kostendeckungsgrad 75.3 %).
            cost_per_train_km_eur: ModeValues {
                ubahn: 15.2,
                sbahn: 19.6,
                tram: 11.4,
                regional: 22.1,
            },
            commercial_speed_kmh: ModeValues {
                ubahn: 32.0,
                sbahn: 42.0,
                tram: 20.0,
                regional: 60.0,
            },
            maintenance_per_km_eur: InfrastructureValues {
                deep_tunnel: 660_000.0,
                cut_and_cover: 600_000.0,
                elevated: 410_000.0,
                surface: 275_000.0,
                existing_rail: 190_000.0,
                tram_reserved: 180_000.0,
                tram_mixed: 150_000.0,
                bridge: 505_000.0,
            },
            station_opex_eur: DepthValues {
                stop: 35_000.0,
                surface: 135_000.0,
                elevated: 205_000.0,
                shallow: 380_000.0,
                deep: 490_000.0,
            },
            revenue_per_boarding_eur: 1.05,
            capacity_per_car: ModeValues {
                ubahn: 180.0,
                sbahn: 190.0,
                tram: 220.0,
                regional: 160.0,
            },
            dwell_seconds: ModeValues {
                ubahn: 25.0,
                sbahn: 30.0,
                tram: 20.0,
                regional: 45.0,
            },
        }
    }
}

// ------------------------------------------------------------ value tables --

/// A value per transport mode.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeValues {
    pub ubahn: f64,
    pub sbahn: f64,
    pub tram: f64,
    pub regional: f64,
}

impl ModeValues {
    pub fn get(&self, m: Mode) -> f64 {
        match m {
            Mode::Ubahn => self.ubahn,
            Mode::Sbahn => self.sbahn,
            Mode::Tram => self.tram,
            Mode::Regional => self.regional,
        }
    }
}

/// A value per infrastructure type.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfrastructureValues {
    pub deep_tunnel: f64,
    pub cut_and_cover: f64,
    pub elevated: f64,
    pub surface: f64,
    pub existing_rail: f64,
    pub tram_reserved: f64,
    pub tram_mixed: f64,
    pub bridge: f64,
}

impl InfrastructureValues {
    pub fn get(&self, i: Infrastructure) -> f64 {
        match i {
            Infrastructure::DeepTunnel => self.deep_tunnel,
            Infrastructure::CutAndCover => self.cut_and_cover,
            Infrastructure::Elevated => self.elevated,
            Infrastructure::Surface => self.surface,
            Infrastructure::ExistingRail => self.existing_rail,
            Infrastructure::TramReserved => self.tram_reserved,
            Infrastructure::TramMixed => self.tram_mixed,
            Infrastructure::Bridge => self.bridge,
        }
    }
}

/// A value per station depth class.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthValues {
    pub stop: f64,
    pub surface: f64,
    pub elevated: f64,
    pub shallow: f64,
    pub deep: f64,
}

impl DepthValues {
    pub fn get(&self, d: StationDepth) -> f64 {
        match d {
            StationDepth::Stop => self.stop,
            StationDepth::Surface => self.surface,
            StationDepth::Elevated => self.elevated,
            StationDepth::Shallow => self.shallow,
            StationDepth::Deep => self.deep,
        }
    }
}

/// A share that differs between tunnelling, surface rail and tram work.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfrastructureShares {
    pub tunnel: f64,
    pub surface: f64,
    pub tram: f64,
}

impl InfrastructureShares {
    pub fn get(&self, i: Infrastructure) -> f64 {
        match i {
            Infrastructure::DeepTunnel | Infrastructure::CutAndCover => self.tunnel,
            Infrastructure::TramReserved | Infrastructure::TramMixed => self.tram,
            _ => self.surface,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_defaults_are_valid_and_nonsense_is_not() {
        assert!(Params::default().validate().is_empty(), "{:?}", Params::default().validate());
        let mut p = Params::default();
        p.demand.annual_factor = -305.0;
        assert_eq!(p.validate().len(), 1);
        p.demand.annual_factor = f64::NAN;
        assert_eq!(p.validate().len(), 1);
    }

    #[test]
    fn params_round_trip_through_json() {
        let p = Params::default();
        let s = serde_json::to_string(&p).unwrap();
        let back: Params = serde_json::from_str(&s).unwrap();
        assert_eq!(p, back);
        // camelCase is what the TypeScript side expects.
        assert!(s.contains("\"gridSizeM\""), "expected camelCase keys");
    }

    #[test]
    fn lookup_tables_are_total() {
        let p = Params::default();
        for m in Mode::ALL {
            assert!(p.demand.catchment_radius_m.get(m) > 0.0);
            assert!(p.operations.commercial_speed_kmh.get(m) > 0.0);
        }
        for i in [
            Infrastructure::DeepTunnel,
            Infrastructure::CutAndCover,
            Infrastructure::Elevated,
            Infrastructure::Surface,
            Infrastructure::ExistingRail,
            Infrastructure::TramReserved,
            Infrastructure::TramMixed,
            Infrastructure::Bridge,
        ] {
            assert!(p.cost.per_km_eur.get(i) > 0.0);
            assert!(p.timeline.years_per_km.get(i) > 0.0);
        }
    }

    #[test]
    fn a_parameter_set_from_an_older_model_still_loads() {
        // Scenarios carry the parameters they were computed with. When a new
        // model adds a parameter, every document written before it is missing
        // that key — and used to fail to deserialise, which broke forking and
        // reopening. Anything absent falls back to today's default; the stored
        // calculation version still says which model produced the numbers.
        let mut v = serde_json::to_value(Params::default()).unwrap();
        let station = v["stations"].as_object_mut().unwrap();
        station.remove("ruralSpacingStretch");
        station.remove("stationMarginalValue");
        v.as_object_mut().unwrap().remove("geometry");
        let p: Params = serde_json::from_value(v).expect("altes Parameterdokument muss laden");
        assert_eq!(
            p.stations.rural_spacing_stretch,
            StationParams::default().rural_spacing_stretch
        );
        assert_eq!(p.geometry, GeometryParams::default());
        // Values that *are* present keep their stored figure.
        assert_eq!(
            p.stations.target_spacing_m.sbahn,
            StationParams::default().target_spacing_m.sbahn
        );
    }

    #[test]
    fn tunnels_cost_more_than_surface_work() {
        let c = CostParams::default();
        assert!(c.per_km_eur.deep_tunnel > c.per_km_eur.elevated);
        assert!(c.per_km_eur.elevated > c.per_km_eur.surface);
        assert!(c.per_km_eur.surface > c.per_km_eur.tram_reserved);
        assert!(c.station_eur.deep > c.station_eur.shallow);
        assert!(c.station_eur.shallow > c.station_eur.surface);
    }
}
