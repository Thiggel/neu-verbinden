# Hamburg Transit Network Designer

## Comprehensive Product & Technical Implementation Plan

**Document status:** Product/architecture blueprint
**Target:** Web application, desktop + tablet + mobile
**Primary geography:** Hamburg, Germany
**Transit modes:** U-Bahn, S-Bahn, tram
**Core technologies:** Next.js/React/TypeScript, MapLibre/WebGL, Rust/WASM, Rust/Axum, PostgreSQL/PostGIS, Redis, background workers

---

# 1. Product Vision

Build an interactive web application in which users can redesign Hamburg's public-transport network.

The user should be able to:

* view the existing Hamburg U-Bahn, S-Bahn and tram infrastructure;
* independently toggle existing lines;
* independently toggle planned projects;
* modify existing projects and lines;
* shorten or extend existing lines;
* create entirely new U-Bahn, S-Bahn and tram infrastructure;
* reuse existing infrastructure;
* create shared tracks and junctions;
* automatically generate stations;
* receive immediate estimates for construction feasibility, construction method, cost and completion date;
* see economic benefits and fiscal effects;
* inspect a detailed itemized cost "invoice";
* save proposals;
* publish them publicly;
* share and fork other people's proposals;
* vote, comment and compare proposals;
* compete through leaderboards and rankings;
* explore predefined scenarios, including real-world political/project alternatives.

The product should feel less like a GIS application and more like:

> **Figma + Cities: Skylines + a Hamburg transit-planning sandbox**

The fundamental UX principle is:

> **The user designs a transit network, not GIS geometry.**

The application should work equally well on desktop, tablet and smartphone. Mobile is not a later adaptation; responsive/touch-first behavior must be part of the initial architecture.

---

# 2. Product Scope

The application has five major systems.

## 2.1 Network editor

Users construct and modify transit networks.

## 2.2 Simulation engine

The application estimates:

* infrastructure type;
* construction feasibility;
* construction cost;
* construction duration;
* opening/completion date;
* transport benefits;
* economic benefits;
* fiscal effects;
* operating economics;
* potentially environmental and social effects.

## 2.3 Geographic/schematic visualization

The application uses Hamburg as the geographic basis but presents the transit network in a clean, stylized, schematic form.

## 2.4 Social platform

Users can:

* save;
* publish;
* share;
* fork;
* vote;
* comment;
* compare;
* rank proposals.

## 2.5 Scenario system

The application includes predefined scenarios based on existing and proposed Hamburg transport plans and political proposals.

---

# 3. Real-World Baseline

The initial data model must distinguish between:

1. existing infrastructure;
2. officially planned infrastructure;
3. political/proposed alternatives;
4. user-created infrastructure.

The application should not imply that user-generated estimates are official transport planning studies.

All model outputs should be explicitly labelled as estimates.

As of the project's September 2026 baseline:

* Hamburg's U5 is under construction/planning in multiple sections.
* HOCHBAHN describes the first approximately 6 km construction section, with TBM construction expected from 2027 east of Sengelmannstraße.
* Passenger operation between Sengelmannstraße and City Nord is planned for 2029.
* The City Nord–Jarrestraße section is approximately 2.6 km and has been presented at roughly €1.5 billion, with Borgweg targeted around 2033 and Jarrestraße around 2035.
* The U5 project uses different construction methods, including open-cut and tunnel-boring-machine construction.
* Further U5 planning includes Jarrestraße–St. Georg and Gärtnerstraße–Hagenbecks Tierpark.
* Hamburg selected the preferred U5 extension variant toward Lurup/Osdorf in May 2026, with an approximate target around 2040.
* The S4 Hamburg–Bad Oldesloe project must be represented as official planned infrastructure.
* In August 2026, Die Linke proposed an alternative concept involving approximately four tram lines, around 44 km and 91 stops, as an alternative to further U5 expansion. Their proposal claimed a tram network cost of approximately €1.5 billion versus approximately €16.5 billion for the U5 concept.

These should be represented as **scenario inputs**, not hard-coded truths in the simulation engine.

Real-world baseline data must therefore be versioned.

---

# 4. Core UX Concept

The map is the central workspace.

The map should be stylized rather than a detailed GIS representation.

Show only enough geographic information to orient the user:

* water;
* major roads;
* parks;
* important landmarks;
* major neighborhoods;
* existing stations;
* transit infrastructure.

Do not make the application visually resemble a conventional detailed mapping application.

The transit network should visually resemble a modern Hamburg-style U-Bahn network map.

The underlying calculations nevertheless use real geographic coordinates.

---

# 5. Two Geometries

Each network object should conceptually have two representations.

## 5.1 Geographic geometry

Used for:

* distance calculations;
* spatial queries;
* cost estimates;
* station placement;
* feasibility;
* population catchments;
* economic calculations;
* intersection detection;
* geographic analysis.

## 5.2 Schematic geometry

Used for:

* visual rendering;
* clean transit-map presentation;
* grid snapping;
* standardized angles;
* visual clarity.

The user should interact primarily with the schematic representation while the engine maintains the geographic representation underneath.

Later, a UI toggle can expose:

> **Schematic / Geographic**

but the initial product can remain schematic-first.

---

# 6. Drawing Model

The user must **not freehand draw lines**.

Drawing should behave like a network-design editor.

Use:

* invisible grid;
* snapping;
* constrained angles;
* intelligent snapping;
* automatic junction creation;
* automatic station generation.

Preferred default angles:

* 0°
* 45°
* 90°
* 135°

Additional angles can be introduced later if required.

The interaction should resemble Figma's smart guides more than a paintbrush.

---

# 7. Drawing Interaction

When the user begins drawing:

1. User selects a transport mode.
2. User starts from an existing station, junction or arbitrary permitted point.
3. The engine displays a ghost/preview segment.
4. The endpoint snaps to:

   * grid;
   * existing stations;
   * existing network;
   * relevant landmarks;
   * streets;
   * other suitable infrastructure.
5. The system constrains geometry to valid schematic angles.
6. The user releases/taps to confirm.
7. Rust calculates the resulting network modification.
8. Stations are automatically generated.
9. Cost/timeline/feasibility are recalculated.
10. The visual network animates into its finalized state.

The user should feel that they are drawing a transit line rather than manipulating GIS polylines.

---

# 8. Editing Existing Infrastructure

Existing and planned lines must be editable.

Do not expose raw geometry editing as the primary mechanism.

Instead expose semantic operations:

* select;
* move;
* extend;
* shorten;
* split;
* merge;
* delete;
* connect;
* branch;
* create shared track;
* change infrastructure type where permitted.

Example:

User selects the U5.

They can drag its endpoint further east or west.

The engine then:

* updates the network graph;
* recalculates stations;
* checks infrastructure feasibility;
* estimates additional cost;
* recalculates completion time;
* updates economic benefits.

---

# 9. Network Graph

The network must be graph-based.

Do **not** model the application as merely a collection of independent polylines.

Conceptually:

```text
Network
├── Nodes
│   ├── Station
│   └── Junction
│
└── Edges
    ├── geometry
    ├── mode
    ├── infrastructure
    └── construction
```

A transit line is a path over graph edges.

This is necessary for:

* shared infrastructure;
* branches;
* transfers;
* intersections;
* line extensions;
* multiple lines using the same segment;
* automatic topology;
* cost aggregation;
* future routing/ridership analysis.

---

# 10. Core Domain Objects

The core domain should contain at least:

### Node

A graph node.

Types:

* Station
* Junction

### Station

Properties may include:

* ID;
* geographic position;
* schematic position;
* name;
* station type;
* served modes;
* served lines;
* interchange status;
* accessibility;
* construction status.

### Edge

A network segment between nodes.

Properties:

* geometry;
* mode;
* infrastructure type;
* construction status;
* length;
* ownership/source;
* cost model;
* timeline model;
* capacity attributes.

### Junction

Represents a physical network connection.

### Line

A named service/path over one or more edges.

Properties:

* line number/name;
* mode;
* color;
* route;
* service pattern;
* status.

### Scenario

A complete network configuration and its calculated outputs.

---

# 11. Transport Modes

All three modes must be supported from the beginning.

## U-Bahn

Potential infrastructure:

* deep tunnel;
* shallow tunnel;
* cut-and-cover;
* elevated;
* surface where appropriate.

## S-Bahn

Potential infrastructure:

* existing rail;
* new surface rail;
* tunnel;
* elevated;
* shared rail infrastructure.

## Tram

Potential infrastructure:

* dedicated surface track;
* road-running;
* separated median;
* mixed traffic where applicable.

Infrastructure selection should be part of the simulation model.

---

# 12. Existing Infrastructure

The application must provide independent visibility controls.

Example:

```text
Existing
☑ U1
☑ U2
☑ U3
☑ U4
☑ U5
☑ S1
☑ S2
☑ S3
...
☑ Tram / historical or scenario infrastructure where applicable
```

Each line should be independently toggleable.

Planned projects should have a separate section:

```text
Planned
☐ U5 future sections
☐ S4
☐ Other official projects
```

Political/proposed scenarios should also be separately selectable.

---

# 13. Scenario System

Provide predefined scenarios.

Examples:

### Current / baseline

Current network plus officially planned projects.

### U5 full build-out

Use the official U5 planning baseline.

### Tram alternative

Represent the August 2026 Die Linke proposal with its proposed tram network.

### User scenario

Blank or editable network.

Scenarios should be immutable templates.

Users can:

> **Fork scenario**

to create an editable copy.

---

# 14. Automatic Station Placement

Users primarily draw infrastructure.

They should not need to manually place every station.

The engine should automatically identify station candidates.

Candidate sources:

1. existing transit stations;
2. landmarks;
3. street names;
4. important intersections;
5. POIs;
6. population/employment centers;
7. transfer opportunities;
8. mode-specific spacing;
9. user-defined endpoints.

The algorithm should consider nearby relevant landmarks up to approximately **500 m**.

The station naming logic can use:

* nearest important landmark;
* nearest street name;
* existing station name;
* neighborhood;
* significant POI.

Example:

```text
User draws:

●──────────────●

Engine detects:

●────●────●────●

Station names:
Borgweg
Winterhude
...
```

---

# 15. Station Spacing

Station placement should be mode-specific.

The exact values must be configurable rather than hard-coded.

For example:

* U-Bahn: wider spacing;
* S-Bahn: wider spacing still;
* tram: shorter spacing.

The algorithm should balance:

* target spacing;
* nearby landmarks;
* population;
* employment;
* transfers;
* network topology;
* route geometry.

A station should not be generated simply because a fixed distance was reached if there is no meaningful catchment.

Conversely, a major destination should be able to override normal spacing.

---

# 16. Transfer Stations

If a new line comes within a configurable distance of an existing station or network edge, the engine should propose a connection.

Example:

> **Potential interchange detected**
>
> New line is 87 m from U3 Borgweg.
>
> [Connect] [Continue separately]

The system should distinguish:

* physical interchange;
* nearby but unconnected stations;
* shared station;
* crossing without interchange.

---

# 17. Automatic Branch/Junction Detection

When a new segment intersects an existing edge, the engine should automatically determine whether the result is:

* crossing;
* junction;
* shared track;
* transfer;
* grade-separated crossing.

This depends on transport mode and infrastructure.

Do not infer a physical connection from a visual intersection alone.

---

# 18. Microanimations

The product should feel slightly game-like without becoming a game.

Examples:

* ghost segment while drawing;
* line animates into place;
* station appears with a small scale/fade animation;
* newly connected network pulses briefly;
* cost counter smoothly changes;
* completion year updates with a subtle transition;
* feasibility warnings appear contextually.

Animations should communicate state changes rather than merely decorate the interface.

They must respect reduced-motion accessibility preferences.

---

# 19. Desktop UI

Desktop can use a multi-panel editor.

Conceptually:

```text
┌────────┬───────────────────────────┬──────────────┐
│ Tools  │                           │ Analysis     │
│        │                           │              │
│ Lines  │           MAP             │ Costs        │
│ Modes  │                           │ Timeline     │
│ Layers │                           │ Economics    │
│        │                           │ Feasibility  │
└────────┴───────────────────────────┴──────────────┘
```

Panels should be resizable where useful.

---

# 20. Tablet UI

Tablet uses a hybrid layout.

Example:

```text
┌──────────┬──────────────────────────┐
│ Controls │                          │
│          │          MAP             │
│          │                          │
└──────────┴──────────────────────────┘
```

Panels can collapse into drawers.

---

# 21. Mobile UI

Mobile must be map-first.

Target:

* approximately 80–90% of the viewport for the map;
* controls as floating elements;
* contextual bottom sheets;
* no permanent desktop-style sidebars.

Example:

```text
┌──────────────────────────────┐
│ ☰   Hamburg Transit    ↶  ↷  │
│                              │
│            MAP               │
│                              │
│                              │
│                         ＋    │
│                              │
├──────────────────────────────┤
│ 🚇 U-Bahn 🚆 S-Bahn 🚋 Tram  │
├──────────────────────────────┤
│ ✏ Draw        ▶ Simulate     │
└──────────────────────────────┘
```

---

# 22. Mobile Interaction Modes

Use explicit modes:

```text
SELECT
DRAW
EXTEND
SPLIT
DELETE
```

Avoid ambiguous gestures.

Suggested interactions:

| Gesture            | Action                      |
| ------------------ | --------------------------- |
| One-finger drag    | draw/move depending on mode |
| Tap                | select                      |
| Two-finger pinch   | zoom                        |
| Two-finger drag    | pan                         |
| Long press         | context menu                |
| Bottom-sheet swipe | expand/collapse             |

Avoid excessive gesture complexity.

---

# 23. Touch Drawing

The user should never need to place a tiny finger precisely over the desired endpoint.

Use a touch offset / floating cursor:

* actual interaction point can appear above the finger;
* snapping is visible;
* ghost geometry shows exactly where the line will land.

This is particularly important for mobile.

---

# 24. Bottom Sheets

On mobile, details should use bottom sheets with three states:

```text
collapsed
↓
half
↓
full
```

Example:

```text
Borgweg
U3 · U5

4 connections

€xxx Mio.

↑ Details
```

Expanded view can show:

* construction method;
* cost breakdown;
* timeline;
* economic impact;
* fiscal effect;
* affected population;
* feasibility warnings.

---

# 25. Social / Discovery UX

Mobile should be especially good for consuming and sharing scenarios.

Opening a shared proposal should immediately show:

```text
128 km network
94 stations

€14.2B
+€1.1B/year economic benefit
2039 completion

♥ 2,481
💬 184

[Open]
[Fork]
[Share]
```

The user should be able to fork without going through a complicated setup flow.

---

# 26. Simulation Engine

The simulation engine is the core differentiator.

It should produce:

### Infrastructure

* length;
* construction type;
* stations;
* junctions;
* transfers;
* shared infrastructure.

### Cost

* construction;
* stations;
* tunnels;
* bridges;
* track;
* utilities;
* land;
* vehicles where applicable;
* contingency;
* planning/design;
* project management;
* other configurable cost categories.

### Timeline

* planning;
* approvals;
* land acquisition;
* design;
* tendering;
* construction;
* commissioning;
* opening.

### Feasibility

Potential factors:

* soil;
* water;
* existing infrastructure;
* road/rail crossings;
* underground utilities;
* construction method;
* urban density;
* engineering constraints;
* environmental constraints;
* station complexity.

The engine should return a feasibility classification and explanation, not simply a binary yes/no.

---

# 27. Cost Model

Cost must be segment-based.

Every network segment should have a cost estimate.

Example:

```text
Project
├── Segment A
│   ├── 2.4 km tunnel
│   ├── 2 stations
│   └── €1.2B
│
├── Segment B
│   ├── 1.8 km surface
│   ├── 3 stations
│   └── €220M
│
└── Junction
    └── €90M
```

Total:

```text
€1.51B
```

---

# 28. "Invoice" View

The total cost overview should be expandable.

Collapsed:

> **Estimated investment: €8.4B**

Expanded:

```text
INVESTMENT ESTIMATE

Tunnel construction       €4.20B
Stations                  €1.70B
Surface infrastructure    €0.80B
Junctions                 €0.30B
Planning                  €0.55B
Land/utilities            €0.25B
Vehicles                  €0.20B
Contingency               €0.40B
───────────────────────────────
TOTAL                     €8.40B
```

Each item can expand down to project/segment level.

The UI should make clear which values are:

* modelled;
* assumed;
* derived from real-world benchmark data.

---

# 29. Cost Uncertainty

Never present estimates with unjustified precision.

Prefer:

> €8.4B ± €1.5B

or:

> Estimated range: €7.2–9.8B

The UI should expose assumptions.

Every calculation should carry:

* calculation version;
* source data version;
* assumptions;
* uncertainty/range.

---

# 30. Construction Timeline

If planning begins today, the application should estimate the completion date.

Timeline components:

```text
Planning
    ↓
Approval
    ↓
Detailed design
    ↓
Procurement
    ↓
Construction
    ↓
Testing
    ↓
Opening
```

Different infrastructure types receive different duration models.

For example:

* tram surface construction;
* cut-and-cover metro;
* TBM metro;
* surface rail;
* complex central-city station.

The timeline model must remain configurable.

---

# 31. Completion Date Output

Example:

> **Estimated opening: 2039**
>
> Planning start: 2026
> Construction start: 2030
> Main construction: 2031–2038
> Testing/commissioning: 2038–2039

Include uncertainty where possible.

---

# 32. Economic Model

The application must go beyond construction cost.

Calculate estimated economic value in euros.

Potential categories:

## Travel-time savings

Value of passenger time saved.

## Accessibility

Improved access to:

* jobs;
* education;
* healthcare;
* services;
* city centers.

## Labor-market effects

Potential improvement in:

* effective labor-market size;
* job accessibility;
* worker mobility.

## Productivity

Potential agglomeration/productivity effects.

## Congestion/logistics

Potential effects on:

* road congestion;
* freight;
* travel reliability.

## Location attractiveness

Potential effects on:

* residential attractiveness;
* commercial attractiveness;
* development potential.

---

# 33. Fiscal Model

Separately estimate government/public-sector fiscal effects.

Potential categories:

* income-tax revenue share;
* Gewerbesteuer;
* VAT-related effects;
* property tax;
* additional employment-related tax effects;
* land-value effects where sufficiently modelled.

The fiscal model should not simply equal "economic benefit".

Keep the following separate:

```text
Investment cost

Annual operating economics

Annual economic benefit

Annual fiscal effect

Monetized social/environmental effects
```

---

# 34. Transit Operating Economics

Where possible, estimate:

### Revenue

* fares;
* ridership;
* other operating revenue.

### Operating cost

* staffing;
* energy;
* maintenance;
* vehicles;
* infrastructure maintenance.

The model should eventually distinguish:

> capital expenditure vs operating expenditure.

---

# 35. Social/Environmental Effects

Potential future categories:

* CO₂;
* local air pollution;
* noise;
* accidents;
* health;
* public-space effects.

These should be monetized only when there is a defensible methodology.

---

# 36. Economic Dashboard

Example:

```text
PROJECT ECONOMICS

Investment
€8.4B

Annual operating cost
−€95M

Annual economic benefit
+€680M

Annual fiscal effect
+€120M

Estimated opening
2039

Estimated benefit horizon
2040–2070
```

Then show a time series:

```text
Year       Costs       Benefits       Net
2026       -€...
2030       -€...
2035       -€...
2040       +€...
2050       +€...
2060       +€...
```

Potentially calculate:

* cumulative net benefit;
* benefit/cost ratio;
* payback period;
* NPV.

These should be optional advanced outputs, not the only score.

---

# 37. Avoid False Precision

This is critical.

The application is a sandbox and planning model, not an official German transport appraisal.

Every result should clearly say:

> **Model estimate — not an official cost-benefit analysis.**

Show:

* model version;
* input-data version;
* assumptions;
* uncertainty;
* methodology.

Historical proposals must not silently change because the model gets updated.

---

# 38. Versioned Calculations

Every published scenario should store:

```text
calculation_version
data_version
```

Example:

```text
Calculation model: v0.8.2
Hamburg data: 2026-09
Cost benchmark: 2026-08
```

If the model improves, users can be offered:

> **Recalculate using current model**

but old published results remain reproducible.

---

# 39. Social Platform

Users need accounts.

Core features:

* authentication;
* profile;
* saved scenarios;
* published scenarios;
* drafts;
* likes/votes;
* comments;
* sharing;
* forks;
* version history.

---

# 40. Scenario Sharing

Every published scenario gets a public URL.

Example conceptual route:

```text
/scenario/hamburg-u5-alternative-2045
```

A visitor can:

* view;
* inspect;
* vote;
* comment;
* share;
* fork.

The original author remains associated with the original scenario.

---

# 41. Forking

Forking creates a new scenario based on another scenario.

Example:

```text
Original
  ↓
Fork
  ↓
User modifies U5
  ↓
New scenario
```

The application should retain ancestry:

```text
Scenario B
forked from Scenario A
```

This makes network evolution and comparison possible.

---

# 42. Scenario Data Model

Conceptually:

```text
Scenario
├── id
├── author_id
├── title
├── description
├── created_at
├── network_definition
├── calculation_version
├── data_version
├── total_cost
├── annual_benefit
├── fiscal_effect
├── completion_year
├── votes
├── views
├── shares
└── parent_scenario_id
```

The implementation can normalize frequently queried values into database columns while storing the full network definition in a structured representation.

---

# 43. Leaderboards

Potential rankings:

* most popular;
* most votes;
* most viewed;
* most shared;
* best cost/benefit;
* greatest economic benefit;
* greatest fiscal effect;
* most new transit kilometers;
* most residents served;
* fastest implementation;
* greatest CO₂ impact;
* best overall.

Do not use a single simplistic score as the only ranking.

---

# 44. Comparison

Users should eventually be able to compare scenarios.

Example:

| Metric         | Scenario A | Scenario B |
| -------------- | ---------: | ---------: |
| Network length |     142 km |     128 km |
| Stations       |        104 |         94 |
| Investment     |     €16.2B |      €9.1B |
| Opening        |       2044 |       2039 |
| Annual benefit |      €1.2B |      €1.0B |
| Fiscal effect  |     +€210M |     +€150M |

Map differences should also be visually highlighted.

---

# 45. Architecture

Preferred architecture:

```text
                         Browser
┌─────────────────────────────────────────────────┐
│                                                 │
│ Next.js + React + TypeScript                    │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ MapLibre / WebGL                            │ │
│ │                                             │ │
│ │ Hamburg base map                            │ │
│ │ Transit visualization                       │ │
│ └─────────────────────────────────────────────┘ │
│                      │                          │
│                 Rust / WASM                    │
│                      │                          │
│              Network / Geometry                │
│              Simulation Engine                 │
└──────────────────────┬──────────────────────────┘
                       │
                       │ API
                       ▼
              Rust / Axum Backend
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
     PostgreSQL     Redis       Workers
      + PostGIS
```

---

# 46. Why Next.js + Rust

Next.js can provide:

* application routing;
* server rendering;
* API endpoints through Route Handlers;
* server functions/actions;
* authentication integration;
* application backend-for-frontend behavior.

However, this project benefits from a separate Rust backend because the core simulation engine is computationally significant and should be reusable.

The key design is:

```text
Rust Core
├── WASM target
└── native target
```

The same domain engine can run:

* in the browser;
* on the server;
* in command-line tools;
* in background workers.

---

# 47. Rust Core

The Rust core should own:

* network topology;
* geometry;
* snapping;
* grid;
* schematic geometry;
* geographic geometry;
* station generation;
* line editing;
* intersections;
* junctions;
* shared tracks;
* transport-mode logic;
* cost calculation;
* construction timeline;
* feasibility;
* economic model;
* fiscal model;
* eventually ridership/simulation.

The browser should not have to reimplement any of these algorithms in TypeScript.

---

# 48. Suggested Rust Repository Structure

```text
transport-sim/
│
├── core/
│   ├── geometry/
│   ├── network/
│   ├── stations/
│   ├── snapping/
│   ├── costs/
│   ├── construction/
│   ├── feasibility/
│   ├── economics/
│   ├── fiscal/
│   └── simulation/
│
├── wasm/
│
├── server/
│
└── cli/
```

The exact crate structure can change, but domain logic should remain independent of web/UI concerns.

---

# 49. Rust Core API

Initial conceptual API:

```text
add_line()
extend_edge()
shorten_edge()
split_edge()
merge_edges()
remove_edge()
connect_to_network()
auto_place_stations()
calculate_cost()
calculate_timeline()
calculate_feasibility()
calculate_benefit()
calculate_fiscal_effect()
```

The API should operate on domain commands rather than arbitrary UI state.

---

# 50. Command-Based Editor

Use a command/state architecture.

Conceptually:

```text
User Action
    ↓
Editor Command
    ↓
Rust Core
    ↓
New State
    ↓
Diff
    ↓
Renderer/UI
```

Examples:

```text
DrawSegment
ExtendLine
MoveNode
SplitEdge
DeleteSegment
ConnectNetworks
ChangeInfrastructure
```

This makes:

* undo;
* redo;
* collaboration;
* replay;
* debugging;
* server validation

much easier.

---

# 51. Undo/Redo

Undo and redo should operate on semantic commands.

Example:

```text
DrawSegment
ExtendLine
AddStation
ConnectToU3
```

rather than recording thousands of low-level mouse positions.

This keeps the history compact and meaningful.

---

# 52. Browser Performance

Do not send huge JSON payloads between JavaScript and WASM on every mouse movement.

During drawing:

```text
Pointer event
   ↓
Rust/WASM
   ↓
preview geometry
   ↓
WebGL/MapLibre
```

Only finalized operations should produce larger state changes.

Potential future optimizations:

* TypedArrays;
* binary buffers;
* SharedArrayBuffer where appropriate;
* worker threads.

Do not implement these prematurely. Benchmark first.

---

# 53. MapLibre/WebGL Responsibilities

MapLibre should remain responsible for:

* map projection;
* camera;
* pan;
* zoom;
* geographic rendering;
* base map;
* WebGL rendering infrastructure.

Rust should provide:

* network state;
* geometry;
* simulation results;
* rendering-ready geometry.

Do **not** reimplement MapLibre in Rust.

The goal is tight integration, not replacement.

---

# 54. Map Layer Strategy

Keep the number of dynamic layers low.

Do not create one MapLibre layer per user line.

Prefer a small number of consolidated layers:

```text
Transit tracks
Stations
Labels
Highlights
Selection/preview
```

The renderer should consume efficiently generated geometry.

This is particularly important on mobile GPUs.

---

# 55. React Performance

React should handle:

* application UI;
* menus;
* panels;
* forms;
* social features;
* settings;
* scenarios;
* analysis dashboards.

React should **not** be the high-frequency rendering loop for line drawing.

Avoid:

```text
mousemove
→ setState()
→ React rerender
→ map update
```

for every pointer event.

Use a lower-level editor/controller path instead.

---

# 56. Mobile Performance

Mobile performance is a first-class requirement.

Optimize for:

* low-end Android;
* iPhone;
* tablet;
* mobile Safari;
* touch latency;
* battery;
* GPU memory;
* network interruptions.

The editor should remain responsive even while calculations are being performed.

Heavy calculations can be:

* WASM/local for immediate interaction;
* server/background worker for expensive analysis.

---

# 57. Offline/PWA Direction

The application should be architected so it can become a PWA.

Potential offline capabilities:

* load cached Hamburg base data;
* edit scenarios;
* run Rust/WASM calculations;
* save locally;
* synchronize later.

Online is required for:

* publishing;
* social interactions;
* current data;
* server calculations;
* account operations.

This is particularly attractive because the Rust/WASM engine can run locally.

---

# 58. PostgreSQL/PostGIS

Use PostgreSQL with PostGIS for authoritative geographic data.

Potential datasets:

* transit infrastructure;
* stations;
* roads;
* waterways;
* parks;
* landmarks;
* buildings;
* population;
* employment;
* existing/planned projects;
* geographic constraints;
* soil;
* utilities where available.

PostGIS is important for:

* spatial indexing;
* intersection queries;
* nearest-neighbor queries;
* distance calculations;
* catchment analysis;
* geographic filtering.

Use spatial indexes such as GiST where appropriate.

---

# 59. Redis

Redis can be used for:

* caching;
* session-related data where appropriate;
* frequently requested scenario results;
* leaderboard caches;
* job coordination;
* rate limiting.

It should not become the authoritative network database.

PostgreSQL remains authoritative.

---

# 60. Background Workers

Heavy operations should be handled asynchronously.

Potential jobs:

* complete economic simulation;
* large scenario comparison;
* ridership estimation;
* recalculation of historical scenarios;
* leaderboard aggregation;
* data import;
* expensive spatial analysis.

Architecture:

```text
API
 ↓
Job queue
 ↓
Rust worker
 ↓
PostgreSQL
 ↓
result/status
```

---

# 61. API Responsibilities

The Rust backend should provide APIs for:

* authentication integration;
* scenarios;
* save/load;
* publish;
* fork;
* votes;
* comments;
* rankings;
* data retrieval;
* server-side simulation;
* recalculation;
* validation.

The frontend should never be trusted as the sole source of truth for published scenario results.

---

# 62. Client/Server Simulation Strategy

Immediate interaction:

```text
Browser Rust/WASM
```

Examples:

* snapping;
* topology;
* station candidates;
* approximate cost;
* immediate feasibility;
* timeline preview.

Authoritative/heavy calculation:

```text
Server Rust
```

Examples:

* detailed economic model;
* large-scale population analysis;
* ridership;
* fiscal analysis;
* official-data-based recalculation.

This gives the UI low latency while maintaining authoritative server results.

---

# 63. Data Versioning

All external datasets must be versioned.

For example:

```text
Hamburg transport data: 2026-09
Population data: YYYY
Cost benchmark: 2026
Road network: YYYY-MM
```

A scenario should reference exact data versions.

---

# 64. Rendering Data Flow

Preferred architecture:

```text
User
 ↓
React interaction layer
 ↓
Editor controller
 ↓
Rust/WASM
 ↓
Network state + geometry diff
 ↓
MapLibre/WebGL
```

For server persistence:

```text
Rust/WASM
 ↓
Scenario command/state
 ↓
API
 ↓
Rust/Axum
 ↓
PostgreSQL/PostGIS
```

---

# 65. UI State vs Domain State

Keep these separate.

### UI state

Examples:

* selected tool;
* open panel;
* selected station;
* current zoom;
* mobile bottom-sheet position.

### Domain state

Examples:

* network graph;
* stations;
* lines;
* edges;
* costs;
* infrastructure;
* simulation outputs.

The domain state belongs to the Rust engine.

---

# 66. Accessibility

The application should support:

* keyboard operation on desktop;
* screen-reader-compatible controls where practical;
* visible focus;
* sufficient contrast;
* reduced motion;
* non-color-only network identification;
* accessible station/line labels.

Because transit maps traditionally rely heavily on color, line identity should also be represented through labels and interaction.

---

# 67. Responsive Design Principle

Do not create separate products.

Create one domain model and one editor.

Then adapt presentation:

```text
Smartphone
Map-first
Bottom sheets
Floating controls

Tablet
Map + drawers

Desktop
Multi-panel editor
```

All three use the same Rust engine and core network model.

---

# 68. Authentication and Accounts

Initial account system should support:

* user registration/login;
* profile;
* scenario ownership;
* drafts;
* published scenarios;
* fork history;
* votes/comments.

Anonymous exploration should ideally remain possible.

Do not require an account merely to inspect the map.

---

# 69. Moderation

Because the application has public publishing/comments/voting, plan for:

* reporting;
* content moderation;
* rate limiting;
* spam prevention;
* account abuse controls;
* deletion;
* scenario visibility settings.

This can remain simple initially but should exist in the domain model.

---

# 70. Security

Important principles:

* server validates published network definitions;
* never trust client-side cost results;
* authorization for scenario ownership;
* rate limits on expensive simulation;
* protect comment/voting endpoints;
* sanitize user-generated text;
* prevent arbitrary geometry/data injection;
* validate all spatial input.

---

# 71. Initial MVP

The first implementation should focus on the editor rather than attempting every economic model immediately.

### MVP should include:

* Hamburg stylized map;
* existing U-Bahn;
* existing S-Bahn;
* tram capability;
* independent line toggles;
* planned infrastructure;
* scenario selection;
* Rust/WASM network engine;
* grid/snap drawing;
* semantic line editing;
* automatic stations;
* transfers;
* junctions;
* cost estimate;
* basic feasibility;
* basic timeline;
* save scenario;
* share scenario;
* mobile/touch support.

---

# 72. Phase 2

Add:

* economic benefit model;
* fiscal model;
* operating economics;
* improved cost model;
* detailed invoice;
* scenario comparison;
* fork;
* voting;
* comments;
* profiles;
* leaderboards.

---

# 73. Phase 3

Add advanced modelling:

* ridership;
* origin/destination modelling;
* population accessibility;
* employment accessibility;
* mode shift;
* CO₂;
* congestion;
* accident effects;
* land-use effects;
* dynamic simulations.

---

# 74. Phase 4

Advanced platform features:

* collaborative editing;
* real-time multiplayer;
* scenario branches;
* advanced policy experiments;
* more German cities;
* potentially international cities.

The architecture should not require these features now, but should not make them impossible.

---

# 75. Development Order

Recommended implementation order:

## Step 1 — Domain model

Define:

* Network;
* Node;
* Station;
* Junction;
* Edge;
* Line;
* Scenario;
* infrastructure types;
* transport modes.

## Step 2 — Rust geometry engine

Implement:

* coordinates;
* grid;
* snapping;
* angle constraints;
* intersections;
* schematic geometry.

## Step 3 — Editor commands

Implement:

* draw;
* move;
* extend;
* shorten;
* split;
* merge;
* delete;
* connect;
* undo;
* redo.

## Step 4 — Automatic stations

Implement:

* candidate generation;
* spacing;
* landmark/street naming;
* transfer detection.

## Step 5 — WASM integration

Expose Rust core to TypeScript.

## Step 6 — MapLibre renderer

Implement:

* base map;
* existing network;
* user network;
* stations;
* preview;
* selection.

## Step 7 — Mobile interaction

Implement:

* touch gestures;
* interaction modes;
* touch offset;
* bottom sheets;
* responsive controls.

This must happen before the architecture becomes desktop-specific.

## Step 8 — Cost engine

Implement segment-based costs.

## Step 9 — Timeline engine

Implement construction phases and dates.

## Step 10 — Feasibility

Implement constraints and explanations.

## Step 11 — Persistence

Implement PostgreSQL/PostGIS and scenario saving.

## Step 12 — Sharing/forking

Implement public scenarios and ancestry.

## Step 13 — Social system

Votes, comments, profiles, leaderboards.

## Step 14 — Economics/fiscal

Implement monetary benefit and fiscal models.

## Step 15 — Advanced simulation

Ridership, accessibility, environmental and broader economic modelling.

---

# 76. Core Editor API — Initial Detailed Shape

Conceptually:

```text
Editor
├── select(object)
├── begin_draw(mode)
├── update_preview(cursor)
├── commit_segment()
├── extend(line, endpoint)
├── shorten(line, endpoint)
├── split(edge, position)
├── merge(edges)
├── connect(nodes)
├── delete(object)
├── undo()
├── redo()
└── get_diff()
```

Rust should own the actual topology changes.

---

# 77. Example User Flow

A user wants to modify the U5.

### 1.

Open Hamburg Transit Designer.

### 2.

Select:

> Existing → U5

### 3.

Select:

> Extend

### 4.

Drag the U5 endpoint.

The application shows:

```text
Ghost extension
↓
Grid snapping
↓
Potential stations
↓
Potential transfer
```

### 5.

User confirms.

Rust generates:

* new edges;
* stations;
* topology;
* infrastructure assumptions.

### 6.

UI animates the new segment.

### 7.

Analysis panel updates:

```text
+7.4 km
+6 stations

Construction:
€2.3B–€3.1B

Opening:
2041–2043

Annual economic benefit:
+€180–240M

Fiscal effect:
+€35–55M/year
```

### 8.

User expands:

> **Cost details**

and receives the invoice.

### 9.

User saves the scenario.

### 10.

User publishes it.

### 11.

Other users can:

* vote;
* comment;
* fork.

---

# 78. Example Tram Flow

User switches to:

> 🚋 Tram

Draws a new surface corridor.

The engine recognizes:

* surface construction;
* road corridor;
* possible dedicated lane;
* intersections;
* candidate stops.

It automatically creates stations.

The cost model is radically different from a U-Bahn tunnel.

The economic model then evaluates:

* population served;
* travel-time improvement;
* accessibility;
* operating cost;
* potential ridership;
* fiscal effects.

The same editor is therefore usable for all three modes.

---

# 79. Visual Language

The application should look polished and modern.

Characteristics:

* clean schematic transit map;
* restrained UI;
* strong hierarchy;
* subtle animation;
* clear numbers;
* minimal GIS clutter;
* high-quality typography;
* transit-map aesthetics.

Avoid turning it into:

* engineering CAD;
* conventional GIS;
* spreadsheet-heavy planning software.

The complexity should be available on demand.

---

# 80. Complexity Management

The default interface should show only:

```text
Network
Cost
Time
Benefit
Feasibility
```

Advanced users can open:

```text
Infrastructure
Construction method
Assumptions
Population
Economic model
Fiscal model
Operating economics
Data sources
```

This keeps the product approachable while preserving serious analytical depth.

---

# 81. Important Architectural Principle

The most important technical separation is:

```text
Application UI
        ≠
Transit Engine
        ≠
Rendering Engine
        ≠
Persistence
```

Specifically:

```text
React/Next.js
    → application/UI

MapLibre/WebGL
    → map rendering

Rust/WASM
    → interactive transit/network engine

Rust/Axum
    → server/API

PostgreSQL/PostGIS
    → authoritative spatial data

Redis
    → cache/coordination

Rust workers
    → expensive calculations
```

This prevents the project from becoming an unmaintainable monolith.

---

# 82. Rust/WASM Philosophy

Use Rust where it provides real value.

Good candidates:

* geometry;
* topology;
* snapping;
* spatial calculations;
* network editing;
* cost calculations;
* simulation;
* computationally intensive operations.

Do **not** automatically rewrite the entire UI in Rust/WASM.

React/Next.js remains the better choice for:

* forms;
* navigation;
* menus;
* social platform;
* account pages;
* dashboards;
* settings;
* content-heavy UI.

The goal is not:

> "Everything must be Rust."

The goal is:

> **All computationally critical transit logic should have one high-performance Rust implementation usable both in the browser and on the server.**

---

# 83. Figma-Like Performance Goal

The target interaction quality should be:

> drawing feels instantaneous even on a normal smartphone.

That requires:

* local WASM calculations;
* low-overhead pointer processing;
* GPU rendering;
* no React render loop for pointer movement;
* compact state diffs;
* limited map layers;
* spatial indexes;
* efficient geometry buffers.

Do not optimize prematurely with complicated shared-memory architectures. Benchmark first.

---

# 84. Testing Strategy

Rust core should be heavily unit-tested independently of the UI.

Test categories:

### Geometry

* snapping;
* angles;
* intersections;
* distance;
* coordinate transformations.

### Topology

* junction creation;
* edge splitting;
* shared infrastructure;
* transfers;
* branches.

### Stations

* spacing;
* landmark selection;
* naming;
* transfer detection.

### Costs

* segment costs;
* station costs;
* aggregation;
* uncertainty.

### Timeline

* construction phases;
* dependencies;
* date calculations.

### Feasibility

* constraint detection;
* warnings;
* impossible configurations.

### Serialization

* save/load;
* version compatibility.

The same tests should support WASM and native execution.

---

# 85. Performance Testing

Create benchmark scenarios:

### Small

* 10 km network;
* 10–20 stations.

### Medium

* 100 km;
* 100+ stations.

### Large

* entire Hamburg network;
* many user-created lines;
* hundreds of nodes/edges.

Measure:

* pointer-to-preview latency;
* WASM execution time;
* rendering time;
* memory usage;
* network transfer;
* initial load;
* mobile GPU performance.

Performance targets should be defined after profiling real prototypes.

---

# 86. Observability

Production should measure:

* editor errors;
* WASM crashes;
* API latency;
* simulation duration;
* map rendering issues;
* mobile-specific failures;
* scenario save failures.

Do not log sensitive user information unnecessarily.

---

# 87. Implementation Principle for Data Sources

All real-world data should enter through a versioned data-import pipeline.

Do not hard-code individual stations or project assumptions throughout the application.

Instead:

```text
External data
    ↓
Importer
    ↓
Normalized domain dataset
    ↓
Version
    ↓
PostGIS
    ↓
Rust engine
```

This makes it possible to update Hamburg data without rewriting the simulation engine.

---

# 88. Long-Term Vision

The application can eventually become a general urban transit planning sandbox.

The initial focus remains Hamburg.

The architecture should eventually permit:

```text
City
├── Geography
├── Existing transit
├── Planned transit
├── Population
├── Employment
├── Cost data
├── Construction constraints
└── Economic data
```

Then the same engine could theoretically support another city without changing the core editor.

---

# 89. Final Product Definition

The finished product should let someone open Hamburg, choose U-Bahn/S-Bahn/tram, and simply start designing.

They should not need to understand:

* GIS;
* topology;
* geographic coordinates;
* infrastructure engineering;
* spatial databases.

They draw a clean transit network.

The application handles:

* geometry;
* snapping;
* stations;
* topology;
* infrastructure;
* construction;
* costs;
* timeline;
* feasibility;
* economic effects;
* fiscal effects.

The user can then publish the result and let other people debate and modify it.

---

# 90. Final Technical Target

The target architecture is:

```text
                         ┌───────────────────────────┐
                         │        USERS              │
                         │ Desktop / Tablet / Mobile │
                         └─────────────┬─────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ Next.js / React / TypeScript     │
                    │                                  │
                    │ UI / Auth / Social / Scenarios  │
                    │ Dashboards / Responsive UX       │
                    └───────────────┬──────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                         ▼                     ▼
                  MapLibre/WebGL          Rust/WASM
                  Rendering               Transit Engine
                         │                     │
                         │              ┌──────┴──────┐
                         │              │             │
                         │          Geometry      Simulation
                         │          Topology      Costs
                         │          Stations      Timeline
                         │          Snapping      Feasibility
                         │          Editing       Economics
                         │                       Fiscal
                         │
                         └──────────┬──────────────┘
                                    │
                                    ▼
                              Rust / Axum
                               Backend
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
               PostgreSQL        Redis          Workers
                + PostGIS                       Rust
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                              Versioned Data
```

---

# 91. The Key Product Principle

The application should ultimately make a very complicated task feel extremely simple:

> **"Draw the transit network you want. We'll tell you what it would probably take to build it."**

Everything else — Rust, WASM, PostGIS, MapLibre, economic modelling, fiscal modelling, social features and mobile optimization — exists to make that interaction fast, credible, understandable and shareable.

important: the default language of the application is GERMAN
