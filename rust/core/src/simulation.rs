//! Orchestration: one network in, one complete analysis out (plan §26, §36).

use crate::city::CityData;
use crate::construction::{self, TimelineResult};
use crate::costs::{self, CostResult};
use crate::demand::{self, DemandResult};
use crate::economics::{self, AppraisalResult, EconomicsResult, FiscalResult, OperationsResult};
use crate::feasibility::{self, FeasibilityResult};
use crate::model::{BuildStatus, Mode, Network};
use crate::params::Params;
use serde::{Deserialize, Serialize};

/// The headline figures the default UI shows (plan §80).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Headline {
    pub network_km: f64,
    pub new_km: f64,
    pub stations: usize,
    pub new_stations: usize,
    pub interchanges: usize,
    pub investment_eur: f64,
    pub investment_low_eur: f64,
    pub investment_high_eur: f64,
    pub opening_year: Option<i32>,
    pub annual_benefit_eur: f64,
    pub annual_fiscal_eur: f64,
    pub annual_operating_eur: f64,
    pub benefit_cost_ratio: f64,
    pub boardings_per_day: f64,
    pub population_served: f64,
    /// How many people the plan *newly* brings within walking distance.
    ///
    /// `population_served` counts the finished network, so the existing lines
    /// dominate it and every plan scores about the same. Comparing plans — on
    /// the leaderboards, or per euro invested — needs the difference the plan
    /// actually makes, not the city it was drawn in.
    ///
    /// `default` because results are stored: every scenario published before
    /// this field existed has a result JSON without it, and without a default
    /// reading one back fails outright — which is how the comparison page came
    /// to answer "Ungültige Daten: missing field `populationGain`" for plans
    /// that were perfectly fine. A stored artefact has to survive the addition
    /// of a field.
    #[serde(default)]
    pub population_gain: f64,
    pub co2_saved_t_per_year: f64,
    pub feasibility: String,
    pub km_by_mode: Vec<(Mode, f64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationResult {
    pub calculation_version: String,
    /// Digest of the parameter values this result was produced with. Two
    /// results are comparable only when both of these match.
    pub parameter_fingerprint: String,
    pub data_version: String,
    pub headline: Headline,
    pub cost: CostResult,
    pub timeline: TimelineResult,
    pub feasibility: FeasibilityResult,
    pub demand: DemandResult,
    pub economics: EconomicsResult,
    pub fiscal: FiscalResult,
    pub operations: OperationsResult,
    pub appraisal: AppraisalResult,
    pub disclaimer: String,
}

pub const DISCLAIMER: &str =
    "Alle Werte sind eine Modellschätzung, die auf öffentlich verfügbaren Daten und dokumentierten Annahmen beruht, und keine offizielle Kosten-Nutzen-Untersuchung.";

/// Run the whole chain. Cheap enough to call after every edit in the browser.
pub fn run(net: &Network, city: &CityData, params: &Params) -> SimulationResult {
    let timeline = construction::calculate(net, city, params);
    let opening = if timeline.nothing_to_build {
        None
    } else {
        Some(timeline.opening_year)
    };
    let cost = costs::calculate(net, city, params, opening);
    let feas = feasibility::calculate(net, city, params);
    let dem = demand::calculate(net, city, params);
    let eco = economics::benefits(&dem, city, params);
    let mut ops = economics::operations(net, &dem, params);
    // What the scenario changes in the operating result. The network that runs
    // today has a deficit of its own, and charging it to whatever is built next
    // made every project look worse by a sum it has nothing to do with — in
    // Berlin, by several times the investment.
    let today = net.today();
    let ops_today = economics::operations_for_rides(
        &today,
        demand::annual_rides(&today, city, params),
        params,
    );
    ops.annual_change_eur = ops.annual_result_eur - ops_today.annual_result_eur;
    // A scenario that builds nothing has no project to appraise. Running the
    // existing network still costs money, but presenting that as the project's
    // net present value would be actively misleading.
    let appraisal = if timeline.nothing_to_build {
        AppraisalResult {
            npv_eur: 0.0,
            benefit_cost_ratio: 0.0,
            payback_year: None,
            series: Vec::new(),
            notes: vec!["Kein Vorhaben im Szenario, es gibt nichts zu bewerten.".into()],
        }
    } else {
        economics::appraise(
            cost.total_eur,
            timeline.construction_start_year,
            timeline
                .opening_year
                .max(timeline.construction_start_year + 1),
            eco.annual_benefit_eur,
            ops.annual_change_eur,
            params,
        )
    };
    let fis = economics::fiscal(
        &eco,
        &dem,
        cost.total_eur,
        appraisal.benefit_cost_ratio,
        city,
        params,
    );

    let (stations, interchanges) = costs::station_summary(net);
    let mut km_by_mode: Vec<(Mode, f64)> = Vec::new();
    let mut network_km = 0.0;
    for eid in net.active_edges() {
        let Some(e) = net.edges.get(&eid) else {
            continue;
        };
        network_km += e.length_km();
        match km_by_mode.iter_mut().find(|(m, _)| *m == e.mode) {
            Some((_, v)) => *v += e.length_km(),
            None => km_by_mode.push((e.mode, e.length_km())),
        }
    }
    km_by_mode.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let headline = Headline {
        network_km,
        new_km: cost.new_km,
        stations,
        new_stations: cost.new_stations,
        interchanges,
        investment_eur: cost.total_eur,
        investment_low_eur: cost.low_eur,
        investment_high_eur: cost.high_eur,
        opening_year: opening,
        annual_benefit_eur: eco.annual_benefit_eur,
        annual_fiscal_eur: fis.annual_city_eur,
        annual_operating_eur: ops.annual_result_eur,
        benefit_cost_ratio: appraisal.benefit_cost_ratio,
        boardings_per_day: dem.boardings_per_day,
        population_served: dem.population_served_after,
        population_gain: (dem.population_served_after - dem.population_served_before).max(0.0),
        co2_saved_t_per_year: eco.co2_saved_t_per_year,
        feasibility: feas.class.label_de().to_string(),
        km_by_mode,
    };

    SimulationResult {
        calculation_version: params.version.clone(),
        parameter_fingerprint: params.fingerprint(),
        data_version: city.version.id.clone(),
        headline,
        cost,
        timeline,
        feasibility: feas,
        demand: dem,
        economics: eco,
        fiscal: fis,
        operations: ops,
        appraisal,
        disclaimer: DISCLAIMER.to_string(),
    }
}

/// A cheap subset for the live readout while drawing (plan §62).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickEstimate {
    pub new_km: f64,
    pub new_stations: usize,
    pub investment_eur: f64,
    pub investment_low_eur: f64,
    pub investment_high_eur: f64,
    pub opening_year: Option<i32>,
    pub feasibility: String,
    pub feasibility_findings: usize,
}

pub fn quick(net: &Network, city: &CityData, params: &Params) -> QuickEstimate {
    let timeline = construction::calculate(net, city, params);
    let opening = if timeline.nothing_to_build {
        None
    } else {
        Some(timeline.opening_year)
    };
    let cost = costs::calculate(net, city, params, opening);
    let feas = feasibility::calculate(net, city, params);
    QuickEstimate {
        new_km: cost.new_km,
        new_stations: cost.new_stations,
        investment_eur: cost.total_eur,
        investment_low_eur: cost.low_eur,
        investment_high_eur: cost.high_eur,
        opening_year: opening,
        feasibility: feas.class.label_de().to_string(),
        feasibility_findings: feas.findings.len(),
    }
}

/// Compare two results field by field for the comparison view (plan §44).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonRow {
    pub key: String,
    pub label: String,
    pub a: f64,
    pub b: f64,
    pub unit: String,
    /// True when a higher value is the better one.
    pub higher_is_better: bool,
}

pub fn compare(a: &SimulationResult, b: &SimulationResult) -> Vec<ComparisonRow> {
    let row = |key: &str, label: &str, x: f64, y: f64, unit: &str, hib: bool| ComparisonRow {
        key: key.into(),
        label: label.into(),
        a: x,
        b: y,
        unit: unit.into(),
        higher_is_better: hib,
    };
    vec![
        row(
            "network_km",
            "Netzlänge",
            a.headline.network_km,
            b.headline.network_km,
            "km",
            true,
        ),
        row(
            "new_km",
            "Neubau",
            a.headline.new_km,
            b.headline.new_km,
            "km",
            true,
        ),
        row(
            "stations",
            "Stationen",
            a.headline.stations as f64,
            b.headline.stations as f64,
            "",
            true,
        ),
        row(
            "investment",
            "Investition",
            a.headline.investment_eur,
            b.headline.investment_eur,
            "€",
            false,
        ),
        row(
            "opening",
            "Eröffnung",
            a.headline.opening_year.unwrap_or(0) as f64,
            b.headline.opening_year.unwrap_or(0) as f64,
            "",
            false,
        ),
        row(
            "benefit",
            "Jährlicher Nutzen",
            a.headline.annual_benefit_eur,
            b.headline.annual_benefit_eur,
            "€/a",
            true,
        ),
        row(
            "fiscal",
            // No city in the label: the two plans being compared belong to the
            // same city, and this row said "Hamburg" over a pair of Berlin
            // plans. Which budget it is gets named in the fiscal breakdown.
            "Fiskaleffekt",
            a.headline.annual_fiscal_eur,
            b.headline.annual_fiscal_eur,
            "€/a",
            true,
        ),
        row(
            "operating",
            "Betriebsergebnis",
            a.headline.annual_operating_eur,
            b.headline.annual_operating_eur,
            "€/a",
            true,
        ),
        row(
            "bcr",
            "Nutzen-Kosten-Verhältnis",
            a.headline.benefit_cost_ratio,
            b.headline.benefit_cost_ratio,
            "",
            true,
        ),
        row(
            "boardings",
            "Einsteiger je Werktag",
            a.headline.boardings_per_day,
            b.headline.boardings_per_day,
            "",
            true,
        ),
        row(
            "population",
            "Erschlossene Einwohner",
            a.headline.population_served,
            b.headline.population_served,
            "",
            true,
        ),
        row(
            "co2",
            "CO₂-Einsparung",
            a.headline.co2_saved_t_per_year,
            b.headline.co2_saved_t_per_year,
            "t/a",
            true,
        ),
    ]
}

/// Ranking metrics for the leaderboards (plan §43).
pub fn leaderboard_metrics(r: &SimulationResult) -> Vec<(String, f64)> {
    vec![
        ("new_km".into(), r.headline.new_km),
        ("stations".into(), r.headline.new_stations as f64),
        ("investment".into(), r.headline.investment_eur),
        ("benefit".into(), r.headline.annual_benefit_eur),
        ("fiscal".into(), r.headline.annual_fiscal_eur),
        ("bcr".into(), r.headline.benefit_cost_ratio),
        ("npv".into(), r.appraisal.npv_eur),
        ("population".into(), r.headline.population_served),
        ("co2".into(), r.headline.co2_saved_t_per_year),
        (
            "speed".into(),
            r.headline.opening_year.map(|y| -(y as f64)).unwrap_or(0.0),
        ),
    ]
}

/// Total network length by build status, for the summary strip.
pub fn km_to_build(net: &Network) -> f64 {
    net.active_edges()
        .iter()
        .filter_map(|e| net.edges.get(e))
        .filter(|e| e.status != BuildStatus::InService)
        .map(|e| e.length_km())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Infrastructure;
    use crate::testing::{demo_city, demo_network, demo_new_line};

    /// The lines that run today lose money whether or not anything is built.
    /// An appraisal that charges that loss to the next project makes every
    /// project worse by a sum it does not cause.
    #[test]
    fn a_project_is_charged_only_with_the_change_in_the_operating_result() {
        let city = demo_city();
        let params = Params::default();
        let net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
        let scenario = run(&net, &city, &params);
        let today = run(&net.today(), &city, &params);
        let change =
            scenario.operations.annual_result_eur - today.operations.annual_result_eur;
        assert!((scenario.operations.annual_change_eur - change).abs() < 1.0);
        assert_eq!(today.operations.annual_change_eur, 0.0);
    }

    #[test]
    fn the_baseline_produces_a_complete_result_with_no_investment() {
        let r = run(&demo_network(), &demo_city(), &Params::default());
        assert_eq!(r.headline.investment_eur, 0.0);
        assert!(r.headline.network_km > 0.0);
        assert!(r.headline.stations > 0);
        assert!(r.timeline.nothing_to_build);
        assert!(!r.disclaimer.is_empty());
        // Nothing to build means nothing to appraise.
        assert_eq!(r.appraisal.npv_eur, 0.0);
        assert_eq!(r.appraisal.benefit_cost_ratio, 0.0);
        assert!(r.appraisal.series.is_empty());
        // The existing network still costs money to run, and that is shown.
        assert!(r.operations.annual_cost_eur > 0.0);
    }

    #[test]
    fn a_new_line_produces_investment_and_a_date() {
        let net = demo_new_line(crate::model::Mode::Ubahn, Infrastructure::DeepTunnel, 9.0);
        let r = run(&net, &demo_city(), &Params::default());
        assert!(r.headline.investment_eur > 0.0);
        assert!(r.headline.opening_year.unwrap() > 2026);
        assert!(r.headline.new_stations > 0);
        assert!(r.appraisal.series.len() > 20);
    }

    #[test]
    fn quick_matches_the_full_run_on_the_shared_fields() {
        let net = demo_new_line(crate::model::Mode::Tram, Infrastructure::TramReserved, 7.0);
        let city = demo_city();
        let p = Params::default();
        let q = quick(&net, &city, &p);
        let full = run(&net, &city, &p);
        assert!((q.investment_eur - full.headline.investment_eur).abs() < 1.0);
        assert_eq!(q.opening_year, full.headline.opening_year);
        assert_eq!(q.new_stations, full.headline.new_stations);
    }

    #[test]
    fn comparison_covers_every_headline_metric() {
        let a = run(
            &demo_new_line(crate::model::Mode::Ubahn, Infrastructure::DeepTunnel, 6.0),
            &demo_city(),
            &Params::default(),
        );
        let b = run(
            &demo_new_line(crate::model::Mode::Tram, Infrastructure::TramReserved, 6.0),
            &demo_city(),
            &Params::default(),
        );
        let rows = compare(&a, &b);
        assert!(rows.len() >= 10);
        assert!(rows.iter().any(|r| r.key == "investment"));
        // The tram must be the cheaper of the two.
        let inv = rows.iter().find(|r| r.key == "investment").unwrap();
        assert!(inv.a > inv.b);
    }

    #[test]
    fn results_round_trip_through_json() {
        let r = run(
            &demo_new_line(crate::model::Mode::Ubahn, Infrastructure::DeepTunnel, 5.0),
            &demo_city(),
            &Params::default(),
        );
        let s = serde_json::to_string(&r).unwrap();
        let back: SimulationResult = serde_json::from_str(&s).unwrap();
        assert_eq!(r.headline.investment_eur, back.headline.investment_eur);
        assert!(s.contains("\"calculationVersion\""));
    }
    /// A stored result from before a field existed must still load.
    ///
    /// Results are written to the database when a plan is published and read
    /// back whenever anyone compares two plans. Adding `populationGain` to the
    /// headline without a default made every one of those reads fail with
    /// "missing field `populationGain`" — the comparison page refused plans
    /// that were perfectly fine, because the *code* had moved on and the rows
    /// had not. Any field added here from now on needs the same treatment.
    #[test]
    fn a_headline_stored_before_a_field_existed_still_loads() {
        let complete = serde_json::to_value(demo_headline()).unwrap();
        let mut older = complete.as_object().unwrap().clone();
        let dropped = older.remove("populationGain");
        assert!(dropped.is_some(), "Feld heißt nicht mehr populationGain");
        let back: Headline = serde_json::from_value(serde_json::Value::Object(older))
            .expect("ein älteres gespeichertes Ergebnis muss lesbar bleiben");
        assert_eq!(back.population_gain, 0.0);
        assert_eq!(back.investment_eur, demo_headline().investment_eur);
    }

    /// The headline used above, built from the real engine rather than by hand
    /// so a renamed field shows up here instead of quietly passing.
    fn demo_headline() -> Headline {
        run(&demo_network(), &demo_city(), &Params::default()).headline
    }
}
