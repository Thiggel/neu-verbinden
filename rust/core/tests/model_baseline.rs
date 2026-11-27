//! The model's own numbers, pinned.
//!
//! Every other test asks whether a rule holds. This one asks a different
//! question: *did the answers move?* It runs a fixed synthetic scenario and
//! compares the headline against values written down here.
//!
//! It exists because of a mistake. In one sitting the appraisal was changed
//! three times over — travel time counted across both population rasters, the
//! placeholder for "no service" raised from 75 to 180 minutes, stations no
//! longer allowed to stack — and `CALCULATION_VERSION` was left alone. Every
//! stored result then counted as current while having been computed under the
//! old model, and the comparison page would have put a fresh result against a
//! stale one and called them the same calculation. The staleness machinery was
//! all there; nothing forced anyone to use it.
//!
//! The fixture is synthetic on purpose. Pinning figures from the real city data
//! would fail on every data rebuild, which is a legitimate reason for numbers to
//! move and would train everyone to update the file without reading it.
//!
//! **When this test fails**, that is not a bug in the test. Decide which it is:
//!
//! * The change was meant to move the numbers → bump `CALCULATION_VERSION`,
//!   write a line in its changelog saying what moved and why, and update the
//!   values below. The server recomputes stored results on the next start.
//! * The change was not meant to move the numbers → you have found a real one.

use hh_core::model::{Infrastructure, Mode};
use hh_core::params::{Params, CALCULATION_VERSION};
use hh_core::simulation;
use hh_core::testing::{demo_city, demo_new_line};

/// What the pinned figures below were produced with.
const PINNED_FOR: &str = "0.18.0";

#[test]
fn the_models_answers_have_not_moved_unnoticed() {
    let city = demo_city();
    let params = Params::default();
    let net = demo_new_line(Mode::Ubahn, Infrastructure::DeepTunnel, 8.0);
    let r = simulation::run(&net, &city, &params);
    let h = &r.headline;

    // Relative, so the check is about the model rather than about floating point
    // arithmetic being bit-identical across platforms.
    let same = |name: &str, got: f64, want: f64| {
        let tol = want.abs().max(1.0) * 1e-6;
        assert!(
            (got - want).abs() <= tol,
            "{name}: {got} statt {want}. Das Modell rechnet anders als beim Festschreiben.\n\
             Wenn das beabsichtigt war: CALCULATION_VERSION erhöhen (steht auf \
             {CALCULATION_VERSION}, festgeschrieben für {PINNED_FOR}), einen Änderungseintrag \
             schreiben und die Werte hier nachziehen.\n\
             Wenn nicht: hier ist ein echter Fund."
        );
    };

    same("newKm", h.new_km, 7.994_048_473_733);
    same("newStations", h.new_stations as f64, 9.0);
    same("investmentEur", h.investment_eur, 6_329_568_708.446_442);
    same("annualBenefitEur", h.annual_benefit_eur, 79_939_093.923_232);
    same("populationServed", h.population_served, 525_000.0);
    same("populationGain", h.population_gain, 159_000.0);
    same("benefitCostRatio", h.benefit_cost_ratio, 0.368_008_010_802);
}
