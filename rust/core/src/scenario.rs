//! Scenarios: the saved, shareable, forkable unit (plan §13, §38, §42).
//!
//! A scenario stores its network *and* the versions it was computed with, so a
//! published result stays reproducible after the model improves.

use crate::model::Network;
use crate::params::Params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    Private,
    Unlisted,
    Public,
}

/// A predefined, immutable template (plan §13).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioTemplate {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub description: String,
    /// Line external ids that start switched on.
    pub included_lines: Vec<String>,
    pub tags: Vec<String>,
    pub sources: Vec<String>,
}

/// The portable scenario document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDocument {
    /// Serialisation format of this document.
    pub format: u32,
    pub calculation_version: String,
    pub data_version: String,
    /// Which city this scenario is for. Absent in documents written before
    /// there was a second one — those are all Hamburg.
    #[serde(default = "default_city")]
    pub city: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub network: Network,
    /// Parameters the scenario was computed with; absent means "current".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Params>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
}

pub const FORMAT_VERSION: u32 = 1;

fn default_city() -> String {
    "hamburg".to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum ScenarioError {
    #[error("Unbekanntes Dateiformat: {0}")]
    UnknownFormat(u32),
    #[error("Ungültiges Szenario: {0}")]
    Invalid(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl ScenarioDocument {
    pub fn new(
        title: impl Into<String>,
        network: Network,
        data_version: impl Into<String>,
    ) -> Self {
        Self::for_city(title, network, data_version, default_city())
    }

    pub fn for_city(
        title: impl Into<String>,
        network: Network,
        data_version: impl Into<String>,
        city: impl Into<String>,
    ) -> Self {
        let mut network = network;
        network.round_coordinates();
        Self {
            format: FORMAT_VERSION,
            calculation_version: crate::params::CALCULATION_VERSION.to_string(),
            data_version: data_version.into(),
            city: city.into(),
            title: title.into(),
            description: String::new(),
            network,
            params: None,
            template_id: None,
        }
    }

    pub fn to_json(&self) -> Result<String, ScenarioError> {
        Ok(serde_json::to_string(self)?)
    }

    /// Parse and validate. Rejects anything structurally broken — the server
    /// must never trust a client-supplied network (plan §70).
    pub fn from_json(s: &str) -> Result<Self, ScenarioError> {
        let doc: ScenarioDocument = serde_json::from_str(s)?;
        if doc.format > FORMAT_VERSION {
            return Err(ScenarioError::UnknownFormat(doc.format));
        }
        let problems = doc.network.validate();
        if !problems.is_empty() {
            return Err(ScenarioError::Invalid(problems.join("; ")));
        }
        if doc.title.trim().is_empty() {
            return Err(ScenarioError::Invalid("Titel fehlt".into()));
        }
        doc.network
            .check_size()
            .map_err(|e| ScenarioError::Invalid(e.0))?;
        Ok(doc)
    }

    /// Whether the document was computed with the current model.
    pub fn is_current(&self) -> bool {
        self.calculation_version == crate::params::CALCULATION_VERSION
    }

    /// Copy for forking: same network, new title, no template link.
    pub fn fork(&self, title: impl Into<String>) -> Self {
        let mut network = self.network.clone();
        network.round_coordinates();
        Self {
            format: FORMAT_VERSION,
            calculation_version: crate::params::CALCULATION_VERSION.to_string(),
            data_version: self.data_version.clone(),
            city: self.city.clone(),
            title: title.into(),
            description: String::new(),
            network,
            params: None,
            template_id: self.template_id.clone(),
        }
    }

    /// The parameters to reproduce this document with: its own set when it
    /// carries a usable one, otherwise the city's. Falling back to
    /// `Params::default()` would compute a Berlin plan with Hamburg's figures.
    pub fn params_or(&self, city: &Params) -> Params {
        match &self.params {
            Some(p) if p.validate().is_empty() => p.clone(),
            _ => city.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::demo_network;

    #[test]
    fn documents_round_trip() {
        let doc = ScenarioDocument::new("Testnetz", demo_network(), "2026-09");
        let s = doc.to_json().unwrap();
        let back = ScenarioDocument::from_json(&s).unwrap();
        assert_eq!(doc.network, back.network);
        assert_eq!(back.title, "Testnetz");
        assert!(back.is_current());
    }

    #[test]
    fn a_newer_format_is_refused() {
        let mut doc = ScenarioDocument::new("X", demo_network(), "2026-09");
        doc.format = FORMAT_VERSION + 1;
        let s = serde_json::to_string(&doc).unwrap();
        assert!(matches!(
            ScenarioDocument::from_json(&s),
            Err(ScenarioError::UnknownFormat(_))
        ));
    }

    #[test]
    fn a_broken_network_is_refused() {
        let mut doc = ScenarioDocument::new("X", demo_network(), "2026-09");
        let eid = *doc.network.edges.keys().next().unwrap();
        doc.network.edges.get_mut(&eid).unwrap().from = crate::model::NodeId(4242);
        let s = serde_json::to_string(&doc).unwrap();
        assert!(matches!(
            ScenarioDocument::from_json(&s),
            Err(ScenarioError::Invalid(_))
        ));
    }

    #[test]
    fn an_untitled_scenario_is_refused() {
        let doc = ScenarioDocument::new("   ", demo_network(), "2026-09");
        let s = serde_json::to_string(&doc).unwrap();
        assert!(ScenarioDocument::from_json(&s).is_err());
    }

    #[test]
    fn forking_keeps_the_network_and_takes_a_new_title() {
        let doc = ScenarioDocument::new("Original", demo_network(), "2026-09");
        let f = doc.fork("Abgeleitet");
        assert_eq!(f.network, doc.network);
        assert_eq!(f.title, "Abgeleitet");
        assert_eq!(f.data_version, doc.data_version);
    }

    #[test]
    fn a_stale_calculation_version_is_detected() {
        let mut doc = ScenarioDocument::new("Alt", demo_network(), "2026-09");
        doc.calculation_version = "0.0.1".into();
        assert!(!doc.is_current());
    }
}
