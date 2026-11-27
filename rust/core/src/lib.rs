//! Hamburg Transit Network Designer — domain engine.
//!
//! One implementation of every computationally meaningful piece of the product,
//! compiled both to WebAssembly for the browser and natively for the server and
//! the command-line tools (plan §46, §47, §82).
//!
//! The crate is deliberately free of any web, rendering or persistence concern.
//! It knows about networks, geometry, money and time — nothing else.

pub mod city;
pub mod connectivity;
pub mod construction;
pub mod costs;
pub mod demand;
pub mod economics;
pub mod editor;
pub mod feasibility;
pub mod fmt;
pub mod geo;
pub mod model;
pub mod params;
pub mod scenario;
pub mod simulation;
pub mod snap;
pub mod stations;
pub mod travel;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use city::CityData;
pub use editor::{Command, Diff, Editor, End};
pub use model::{
    BuildStatus, Edge, EdgeId, Infrastructure, Line, LineId, Mode, Network, Node, NodeId, NodeKind,
    Source,
};
pub use params::{Params, CALCULATION_VERSION};
pub use scenario::ScenarioDocument;
pub use simulation::{run, SimulationResult};
