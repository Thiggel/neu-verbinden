//! Monetised benefits, fiscal effects and operating economics
//! (plan §32–§36).
//!
//! The four blocks are deliberately kept apart, because they are different
//! things and conflating them is the classic way to make a transport project
//! look better than it is:
//!
//! * annual **economic benefit** — welfare, not cash;
//! * annual **fiscal effect** — money that actually reaches a public budget;
//! * annual **operating result** — fare revenue minus running cost;
//! * the one-off **investment**.

use crate::city::CityData;
use crate::demand::DemandResult;
use crate::model::{BuildStatus, Infrastructure, Network};
use crate::params::Params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenefitItem {
    pub key: String,
    pub label: String,
    pub amount_eur_per_year: f64,
    pub basis: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EconomicsResult {
    pub annual_benefit_eur: f64,
    pub annual_benefit_low_eur: f64,
    pub annual_benefit_high_eur: f64,
    /// The benefit without the wider economic effects — the parts a German
    /// Standardisierte Bewertung would recognise. Reported separately because
    /// those two items are both the least certain and, in some scenarios, the
    /// largest.
    pub annual_benefit_core_eur: f64,
    pub items: Vec<BenefitItem>,
    pub co2_saved_t_per_year: f64,
    pub notes: Vec<String>,
}

pub fn benefits(
    demand: &DemandResult,
    city: &CityData,
    params: &Params,
) -> EconomicsResult {
    let e = &params.economics;
    let mut items = Vec::new();

    // 1. Travel time. The dominant term in every serious appraisal.
    let annual_hours = demand.hours_saved_per_day * params.demand.annual_factor;
    let time = annual_hours * e.value_of_time_eur_h;
    items.push(BenefitItem {
        key: "time".into(),
        label: "Reisezeitgewinne".into(),
        amount_eur_per_year: time,
        basis: format!(
            "{:.0} Personenstunden pro Werktag × {:.2} €/h",
            demand.hours_saved_per_day, e.value_of_time_eur_h
        ),
    });

    // 2. Agglomeration: better access enlarges the effective labour market.
    //
    // An agglomeration elasticity applies to a *change* in effective density,
    // never to a level. An earlier version added `newly served residents ×
    // GVA × elasticity`, which credited every person brought within walking
    // distance of a station with four per cent of their entire annual output,
    // for ever — about 1 900 € a head, and 45 % of the whole benefit of the
    // Hamburg programme. That is an order of magnitude too much and the wrong
    // shape besides: what counts is how much shorter the journeys get.
    let served_gain = (demand.population_served_after - demand.population_served_before).max(0.0);
    let density_gain = if demand.access_time_before_min > 0.0 {
        ((demand.access_time_before_min - demand.access_time_after_min)
            / demand.access_time_before_min)
            .max(0.0)
    } else {
        0.0
    };
    let workforce = demand.population_served_after * e.employment_rate;
    let agglomeration =
        workforce * e.gva_per_worker_eur * e.agglomeration_elasticity * density_gain;
    items.push(BenefitItem {
        key: "agglomeration".into(),
        label: "Produktivität und Arbeitsmarkt".into(),
        amount_eur_per_year: agglomeration,
        basis: format!(
            "Elastizität {:.2} auf {:.1} % kürzere Wege für {:.0} Erwerbstätige im Einzugsbereich",
            e.agglomeration_elasticity,
            density_gain * 100.0,
            workforce
        ),
    });
    let _ = served_gain;

    // 3. Road effects from the car trips that no longer happen.
    let car_km = demand.car_km_replaced_per_year;
    let congestion = car_km * e.congestion_eur_per_car_km;
    let accidents = car_km * e.accident_eur_per_car_km;
    let air = car_km * e.air_noise_eur_per_car_km;
    items.push(BenefitItem {
        key: "congestion".into(),
        label: "Entlastung des Straßenverkehrs".into(),
        amount_eur_per_year: congestion,
        basis: format!(
            "{:.0} Mio. vermiedene Pkw-km × {:.3} €/km",
            car_km / 1e6,
            e.congestion_eur_per_car_km
        ),
    });
    items.push(BenefitItem {
        key: "accidents".into(),
        label: "Vermiedene Unfälle".into(),
        amount_eur_per_year: accidents,
        basis: format!("{:.3} €/Pkw-km", e.accident_eur_per_car_km),
    });
    items.push(BenefitItem {
        key: "air".into(),
        label: "Luftschadstoffe und Lärm".into(),
        amount_eur_per_year: air,
        basis: format!("{:.3} €/Pkw-km", e.air_noise_eur_per_car_km),
    });

    // 4. Climate: car emissions avoided minus the traction emissions caused.
    let co2_saved_kg = car_km * e.co2_kg_per_car_km
        - demand.passenger_km_per_year
            * (demand.new_boardings_per_day / demand.boardings_per_day.max(1.0))
            * e.co2_kg_per_rail_pkm;
    let climate = co2_saved_kg * e.co2_eur_per_kg;
    items.push(BenefitItem {
        key: "climate".into(),
        label: "Klimawirkung".into(),
        amount_eur_per_year: climate,
        basis: format!(
            "{:.0} t CO₂ netto × {:.0} €/t",
            co2_saved_kg / 1000.0,
            e.co2_eur_per_kg * 1000.0
        ),
    });

    // 5. Health from the walking stage of every rail trip.
    let health =
        demand.new_boardings_per_day * params.demand.annual_factor * e.health_eur_per_boarding;
    items.push(BenefitItem {
        key: "health".into(),
        label: "Gesundheitseffekte des Zu- und Abgangs".into(),
        amount_eur_per_year: health,
        basis: format!("{:.3} € je Einsteiger", e.health_eur_per_boarding),
    });

    // 6. Location quality, expressed as an annualised land value uplift.
    let uplift = served_gain * e.property_value_per_resident_eur * e.land_value_uplift_share;
    let location = uplift * e.discount_rate; // annualised, not the stock
    items.push(BenefitItem {
        key: "location".into(),
        label: "Standort- und Bodenwerteffekte".into(),
        amount_eur_per_year: location,
        basis: format!(
            "{:.1} % Wertzuwachs auf {:.0} neu erschlossene Einwohner, annuisiert",
            e.land_value_uplift_share * 100.0,
            served_gain
        ),
    });
    let _ = city;

    let total: f64 = items.iter().map(|i| i.amount_eur_per_year).sum();
    EconomicsResult {
        annual_benefit_eur: total,
        annual_benefit_core_eur: items
            .iter()
            .filter(|i| !matches!(i.key.as_str(), "agglomeration" | "location"))
            .map(|i| i.amount_eur_per_year)
            .sum(),
        annual_benefit_low_eur: total * (1.0 - e.uncertainty_share),
        annual_benefit_high_eur: total * (1.0 + e.uncertainty_share),
        items,
        co2_saved_t_per_year: co2_saved_kg / 1000.0,
        notes: vec![
            "Modellschätzung, keine standardisierte Bewertung und keine Nutzen-Kosten-Untersuchung nach BVWP oder Stand. Bew."
                .to_string(),
            "Nutzen und Fiskaleffekt sind unterschiedliche Größen und dürfen nicht addiert werden.".to_string(),
        ],
    }
}

// ------------------------------------------------------------------ fiscal --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalItem {
    pub key: String,
    pub label: String,
    pub amount_eur_per_year: f64,
    pub level: String,
    pub basis: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalResult {
    pub annual_total_eur: f64,
    /// Of which reaches the city's budget.
    pub annual_city_eur: f64,
    pub items: Vec<FiscalItem>,
    /// One-off tax return during the construction phase.
    pub construction_return_eur: f64,
    /// Federal co-funding the project would be eligible for, €.
    pub federal_funding_eur: f64,
    pub federal_funding_eligible: bool,
    pub notes: Vec<String>,
}

pub fn fiscal(
    economics: &EconomicsResult,
    demand: &DemandResult,
    investment_eur: f64,
    benefit_cost_ratio: f64,
    city: &CityData,
    params: &Params,
) -> FiscalResult {
    // Which budget the money lands in is the city's, not the model's — the
    // breakdown named Hamburg even when the network was Berlin's.
    let city_name = city.version.city.as_str();
    let f = &params.fiscal;
    let e = &params.economics;
    let mut items = Vec::new();

    // The productive part of the benefit is what generates taxable income;
    // welfare gains such as time saved on a leisure trip do not.
    let productive = economics
        .items
        .iter()
        .filter(|i| i.key == "agglomeration")
        .map(|i| i.amount_eur_per_year)
        .sum::<f64>()
        + economics
            .items
            .iter()
            .filter(|i| i.key == "time")
            .map(|i| i.amount_eur_per_year * 0.35) // the business/commuting share
            .sum::<f64>();

    let income = productive * f.income_tax_rate;
    items.push(FiscalItem {
        key: "income_tax".into(),
        label: "Lohn- und Einkommensteuer".into(),
        amount_eur_per_year: income * f.income_tax_city_share,
        level: format!("{city_name} (Land + Gemeinde)"),
        basis: format!(
            "{:.1} % auf {:.0} Mio. € zusätzliche Wertschöpfung, davon {:.1} % Anteil des Landes",
            f.income_tax_rate * 100.0,
            productive / 1e6,
            f.income_tax_city_share * 100.0
        ),
    });

    let trade = productive * f.trade_tax_rate * f.trade_tax_city_share;
    items.push(FiscalItem {
        key: "trade_tax".into(),
        label: "Gewerbesteuer".into(),
        amount_eur_per_year: trade,
        level: city_name.to_string(),
        basis: format!(
            "{:.1} % auf die zusätzliche Wertschöpfung",
            f.trade_tax_rate * 100.0
        ),
    });

    let vat_total = productive * f.consumption_share * f.vat_rate;
    let vat_city = vat_total * f.vat_laender_share * f.vat_city_share;
    items.push(FiscalItem {
        key: "vat".into(),
        label: "Umsatzsteuer".into(),
        amount_eur_per_year: vat_city,
        level: format!("{city_name} (Länderanteil)"),
        basis: format!(
            "{:.0} % Konsumquote, {:.0} % USt, Länderanteil {:.1} %, Schlüssel des Landes {:.2} %",
            f.consumption_share * 100.0,
            f.vat_rate * 100.0,
            f.vat_laender_share * 100.0,
            f.vat_city_share * 100.0
        ),
    });

    // Property: the land value uplift feeds Grundsteuer every year and
    // Grunderwerbsteuer on the share of stock that changes hands.
    let uplift_stock = (demand.population_served_after - demand.population_served_before).max(0.0)
        * e.property_value_per_resident_eur
        * e.land_value_uplift_share;
    let property = uplift_stock * f.property_tax_rate;
    let transfer = uplift_stock * f.annual_property_turnover * f.transfer_tax_rate;
    items.push(FiscalItem {
        key: "property_tax".into(),
        label: "Grundsteuer".into(),
        amount_eur_per_year: property,
        level: city_name.to_string(),
        basis: format!(
            "{:.2} % auf {:.0} Mio. € Bodenwertzuwachs",
            f.property_tax_rate * 100.0,
            uplift_stock / 1e6
        ),
    });
    items.push(FiscalItem {
        key: "transfer_tax".into(),
        label: "Grunderwerbsteuer".into(),
        amount_eur_per_year: transfer,
        level: city_name.to_string(),
        basis: format!(
            "{:.1} % auf {:.1} % jährlichen Eigentümerwechsel",
            f.transfer_tax_rate * 100.0,
            f.annual_property_turnover * 100.0
        ),
    });

    let city_total: f64 = items.iter().map(|i| i.amount_eur_per_year).sum();
    let all_levels = income + productive * f.trade_tax_rate + vat_total + property + transfer;

    let eligible = benefit_cost_ratio >= f.federal_funding_min_bcr;
    FiscalResult {
        annual_total_eur: all_levels,
        annual_city_eur: city_total,
        items,
        construction_return_eur: investment_eur * f.construction_tax_return_share,
        federal_funding_eur: if eligible { investment_eur * f.federal_funding_share } else { 0.0 },
        federal_funding_eligible: eligible,
        notes: vec![
            format!(
                "Bundesförderung nach GVFG setzt unter anderem ein Nutzen-Kosten-Verhältnis über {:.1} voraus; hier liegt es bei {:.2}.",
                f.federal_funding_min_bcr, benefit_cost_ratio
            ),
            "Fiskaleffekte sind Rückflüsse an öffentliche Haushalte, nicht der volkswirtschaftliche Nutzen.".to_string(),
        ],
    }
}

// -------------------------------------------------------------- operations --

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationsResult {
    pub annual_revenue_eur: f64,
    pub annual_cost_eur: f64,
    pub annual_result_eur: f64,
    pub cost_recovery_ratio: f64,
    pub train_km_per_year: f64,
    pub items: Vec<BenefitItem>,
    pub notes: Vec<String>,
}

pub fn operations(net: &Network, demand: &DemandResult, params: &Params) -> OperationsResult {
    let o = &params.operations;
    let mut train_km = 0.0;
    let mut vehicle_cost = 0.0;

    for l in net.lines.values().filter(|l| l.included) {
        let route_km = net.line_length_m(l.id) / 1000.0;
        if route_km <= 0.0 {
            continue;
        }
        // Peak for 4 h, off-peak for the rest, both directions.
        let peak_trips = 4.0 * 60.0 / l.service.headway_peak_min;
        let off_trips =
            (l.service.service_hours - 4.0).max(0.0) * 60.0 / l.service.headway_offpeak_min;
        let daily = (peak_trips + off_trips) * 2.0 * route_km;
        let annual = daily * params.demand.annual_factor;
        train_km += annual;
        vehicle_cost += annual * o.cost_per_train_km_eur.get(l.mode);
    }

    let mut infra_cost = 0.0;
    for eid in net.active_edges() {
        let Some(e) = net.edges.get(&eid) else {
            continue;
        };
        infra_cost += o.maintenance_per_km_eur.get(e.infrastructure) * e.length_km();
    }
    let mut station_cost = 0.0;
    let active_set: std::collections::BTreeSet<crate::model::EdgeId> =
        net.active_edges().into_iter().collect();
    for nid in net.active_stations() {
        station_cost += o
            .station_opex_eur
            .get(net.effective_depth_with(nid, &active_set));
    }

    let revenue = demand.annual_rides * o.revenue_per_boarding_eur;
    let cost = vehicle_cost + infra_cost + station_cost;

    let items = vec![
        BenefitItem {
            key: "revenue".into(),
            label: "Fahrgeldeinnahmen".into(),
            amount_eur_per_year: revenue,
            basis: format!(
                "{:.0} Mio. Fahrten × {:.2} € Durchschnittserlös",
                demand.annual_rides / 1e6,
                o.revenue_per_boarding_eur
            ),
        },
        BenefitItem {
            key: "vehicle_cost".into(),
            label: "Fahrbetrieb".into(),
            amount_eur_per_year: -vehicle_cost,
            basis: format!("{:.1} Mio. Zug-km pro Jahr", train_km / 1e6),
        },
        BenefitItem {
            key: "infra_cost".into(),
            label: "Instandhaltung Infrastruktur".into(),
            amount_eur_per_year: -infra_cost,
            basis: "Jahreskosten je km nach Bauweise".into(),
        },
        BenefitItem {
            key: "station_cost".into(),
            label: "Stationsbetrieb".into(),
            amount_eur_per_year: -station_cost,
            basis: "Jahreskosten je Station nach Lage".into(),
        },
    ];

    OperationsResult {
        annual_revenue_eur: revenue,
        annual_cost_eur: cost,
        annual_result_eur: revenue - cost,
        cost_recovery_ratio: if cost > 0.0 { revenue / cost } else { 0.0 },
        train_km_per_year: train_km,
        items,
        notes: vec![
            "Betriebsergebnis des gesamten Szenarionetzes, nicht nur der neuen Abschnitte.".to_string(),
            "Ein negatives Betriebsergebnis ist im deutschen ÖPNV der Normalfall und wird über Ausgleichszahlungen finanziert."
                .to_string(),
        ],
    }
}

// ------------------------------------------------------------- appraisal ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppraisalYear {
    pub year: i32,
    pub investment_eur: f64,
    pub operating_eur: f64,
    pub benefit_eur: f64,
    pub net_eur: f64,
    pub cumulative_net_eur: f64,
    pub discounted_net_eur: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppraisalResult {
    pub npv_eur: f64,
    pub benefit_cost_ratio: f64,
    /// First year in which the undiscounted cumulative net turns positive.
    pub payback_year: Option<i32>,
    pub series: Vec<AppraisalYear>,
    pub notes: Vec<String>,
}

/// Discounted appraisal over the standard horizon (plan §36).
pub fn appraise(
    investment_eur: f64,
    construction_start: i32,
    opening_year: i32,
    annual_benefit: f64,
    annual_operating_result: f64,
    params: &Params,
) -> AppraisalResult {
    let e = &params.economics;
    let base = params.timeline.planning_start_year;
    let end = opening_year + e.appraisal_period_years;
    let build_years = (opening_year - construction_start).max(1);
    let mut series = Vec::new();
    let mut cumulative = 0.0;
    let mut pv_benefit = 0.0;
    let mut pv_cost = 0.0;
    let mut payback = None;

    for year in base..=end {
        let discount = 1.0 / (1.0 + e.discount_rate).powi(year - base);
        let investment = if year >= construction_start && year < opening_year {
            investment_eur / build_years as f64
        } else {
            0.0
        };
        let (benefit, operating) = if year >= opening_year {
            let ramp = (((year - opening_year) as f64 + 1.0) / e.demand_ramp_up_years).min(1.0);
            (annual_benefit * ramp, annual_operating_result * ramp)
        } else {
            (0.0, 0.0)
        };
        // Residual value of the asset in the final year.
        let residual = if year == end {
            investment_eur * e.residual_value_share
        } else {
            0.0
        };
        let net = benefit + operating + residual - investment;
        cumulative += net;
        if payback.is_none() && cumulative > 0.0 && year > opening_year {
            payback = Some(year);
        }
        pv_benefit += (benefit + operating.max(0.0) + residual) * discount;
        pv_cost += (investment + (-operating).max(0.0)) * discount;
        series.push(AppraisalYear {
            year,
            investment_eur: investment,
            operating_eur: operating,
            benefit_eur: benefit,
            net_eur: net,
            cumulative_net_eur: cumulative,
            discounted_net_eur: net * discount,
        });
    }

    let npv: f64 = series.iter().map(|y| y.discounted_net_eur).sum();
    AppraisalResult {
        npv_eur: npv,
        benefit_cost_ratio: if pv_cost > 0.0 { pv_benefit / pv_cost } else { 0.0 },
        payback_year: payback,
        series,
        notes: vec![
            format!(
                "Barwerte mit {:.1} % realem Diskontsatz über {} Jahre nach Eröffnung.",
                e.discount_rate * 100.0,
                e.appraisal_period_years
            ),
            "Kein Ersatz für eine Standardisierte Bewertung; die Kennzahlen dienen dem Vergleich von Entwürfen untereinander."
                .to_string(),
        ],
    }
}

/// How much of the network is tunnel, by length — used in summaries.
pub fn infrastructure_mix(net: &Network) -> Vec<(Infrastructure, f64)> {
    let mut out: Vec<(Infrastructure, f64)> = Vec::new();
    for eid in net.active_edges() {
        let Some(e) = net.edges.get(&eid) else {
            continue;
        };
        if e.status == BuildStatus::InService {
            continue;
        }
        match out.iter_mut().find(|(i, _)| *i == e.infrastructure) {
            Some((_, v)) => *v += e.length_km(),
            None => out.push((e.infrastructure, e.length_km())),
        }
    }
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Mode;
    use crate::testing::{demo_city, demo_new_line};

    fn demand_for(net: &Network) -> DemandResult {
        crate::demand::calculate(net, &demo_city(), &Params::default())
    }

    #[test]
    fn benefits_are_positive_for_a_useful_line() {
        let net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
        let d = demand_for(&net);
        let r = benefits(&d, &demo_city(), &Params::default());
        assert!(r.annual_benefit_eur > 0.0);
        assert!(r.annual_benefit_low_eur < r.annual_benefit_eur);
        assert!(r.annual_benefit_high_eur > r.annual_benefit_eur);
        assert!(r.items.iter().any(|i| i.key == "time"));
    }

    #[test]
    fn a_network_that_changes_nothing_produces_no_time_benefit() {
        let net = crate::testing::demo_network();
        let d = demand_for(&net);
        let r = benefits(&d, &demo_city(), &Params::default());
        let time = r.items.iter().find(|i| i.key == "time").unwrap();
        assert_eq!(time.amount_eur_per_year, 0.0);
    }

    #[test]
    fn operating_cost_grows_with_the_network() {
        let p = Params::default();
        let small = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 4.0);
        let big = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 16.0);
        let a = operations(&small, &demand_for(&small), &p);
        let b = operations(&big, &demand_for(&big), &p);
        assert!(b.annual_cost_eur > a.annual_cost_eur);
        assert!(b.train_km_per_year > a.train_km_per_year);
    }

    #[test]
    fn appraisal_discounts_the_future() {
        let p = Params::default();
        let early = appraise(1.0e9, 2030, 2035, 2.0e8, -2.0e7, &p);
        let late = appraise(1.0e9, 2040, 2050, 2.0e8, -2.0e7, &p);
        assert!(
            early.npv_eur > late.npv_eur,
            "an earlier opening must be worth more"
        );
        assert!(early.series.first().unwrap().year == p.timeline.planning_start_year);
        assert!(early.series.last().unwrap().year == 2035 + p.economics.appraisal_period_years);
    }

    #[test]
    fn a_hopeless_project_has_a_ratio_below_one() {
        let p = Params::default();
        let r = appraise(20.0e9, 2030, 2045, 1.0e7, -1.0e8, &p);
        assert!(r.benefit_cost_ratio < 1.0);
        assert!(r.npv_eur < 0.0);
        assert!(r.payback_year.is_none());
    }

    #[test]
    fn federal_funding_requires_a_viable_ratio() {
        let p = Params::default();
        let net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
        let d = demand_for(&net);
        let ec = benefits(&d, &demo_city(), &p);
        let poor = fiscal(&ec, &d, 5.0e9, 0.4, &demo_city(), &p);
        let good = fiscal(&ec, &d, 5.0e9, 1.6, &demo_city(), &p);
        assert!(!poor.federal_funding_eligible);
        assert_eq!(poor.federal_funding_eur, 0.0);
        assert!(good.federal_funding_eligible);
        assert!(good.federal_funding_eur > 0.0);
    }

    #[test]
    fn the_city_keeps_less_than_all_levels_collect() {
        let p = Params::default();
        let net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
        let d = demand_for(&net);
        let ec = benefits(&d, &demo_city(), &p);
        let f = fiscal(&ec, &d, 5.0e9, 1.2, &demo_city(), &p);
        assert!(f.annual_city_eur <= f.annual_total_eur + 1.0);
        assert!(f.annual_city_eur > 0.0);
    }
}
