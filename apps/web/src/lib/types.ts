// TypeScript mirrors of the engine's serde output. The Rust side is the
// source of truth; these types exist so the UI is checked against it.

export type Mode = 'ubahn' | 'sbahn' | 'tram' | 'regional';
export type BuildStatus = 'in_service' | 'under_construction' | 'to_build';
export type SourceKind = 'existing' | 'planned' | 'proposal' | 'user';
export type Depth = 'stop' | 'surface' | 'elevated' | 'shallow' | 'deep';

export interface SegmentGeometry {
  id: number;
  status: BuildStatus;
  infrastructure: string;
  geo: [number, number][];
  lengthKm: number;
}

export interface LineGeometry {
  id: number;
  label: string;
  name: string;
  mode: Mode;
  color: string;
  source: SourceKind;
  included: boolean;
  geo: [number, number][];
  schematic: [number, number][];
  lengthKm: number;
  stations: number[];
  note: string;
  officialOpeningYear: number | null;
  officialCostEur: number | null;
  externalId: string | null;
  segments: SegmentGeometry[];
}

export interface StationGeometry {
  id: number;
  name: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  kind: 'station' | 'junction' | 'waypoint';
  status: BuildStatus;
  source: SourceKind;
  interchange: boolean;
  depth: Depth;
  lines: string[];
  colors: string[];
  modes: Mode[];
}

export interface RenderState {
  lines: LineGeometry[];
  stations: StationGeometry[];
}

export type SnapTarget =
  | { kind: 'node'; id: number; name: string; interchange: boolean }
  | { kind: 'edge'; id: number; alongM: number; mode: Mode }
  | { kind: 'landmark'; name: string; weight: number }
  | { kind: 'street'; name: string }
  | { kind: 'grid' }
  | { kind: 'free' };

export interface SnapResult {
  geo: { lat: number; lon: number };
  point: { x: number; y: number };
  target: SnapTarget;
  offsetM: number;
  angleDeg: number | null;
  angleConstrained: boolean;
  label: string;
  connects: boolean;
  connectsTo: string[];
  connectColors: string[];
}

export interface StationPreview {
  lon: number;
  lat: number;
  name: string;
  origin: string;
  interchange: boolean;
  catchmentPopulation: number;
}

export interface QuickEstimate {
  newKm: number;
  newStations: number;
  investmentEur: number;
  investmentLowEur: number;
  investmentHighEur: number;
  openingYear: number | null;
  feasibility: string;
  feasibilityFindings: number;
}

export interface CostItem {
  label: string;
  detail: string;
  amountEur: number;
  quantity?: number;
  unit?: string;
  basis: 'benchmark' | 'modelled' | 'assumption';
  line?: string;
}

export interface CostCategory {
  key: string;
  label: string;
  amountEur: number;
  items: CostItem[];
}

export interface SegmentCost {
  edge: number;
  line: string;
  from: string;
  to: string;
  mode: Mode;
  infrastructure: string;
  lengthKm: number;
  amountEur: number;
  waterCrossingM: number;
  densityIndex: number;
}

export interface CostResult {
  totalEur: number;
  lowEur: number;
  highEur: number;
  constructionEur: number;
  escalationEur: number;
  categories: CostCategory[];
  segments: SegmentCost[];
  newKm: number;
  newStations: number;
  upgradedStations: number;
  junctions: number;
  tunnelKm: number;
  surfaceKm: number;
  elevatedKm: number;
  notes: string[];
}

export interface Phase {
  key: string;
  label: string;
  start: number;
  end: number;
  description: string;
}

export interface TimelineResult {
  phases: Phase[];
  planningStartYear: number;
  constructionStartYear: number;
  openingYear: number;
  openingYearLow: number;
  openingYearHigh: number;
  constructionYears: number;
  totalYears: number;
  nothingToBuild: boolean;
  notes: string[];
}

export type Severity = 'info' | 'caution' | 'warning' | 'blocking';

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  edge?: number;
  node?: number;
}

export interface FeasibilityResult {
  class: 'straightforward' | 'demanding' | 'difficult' | 'critical';
  score: number;
  findings: Finding[];
  summary: string;
}

export interface StationDemand {
  node: number;
  name: string;
  boardingsPerDay: number;
  catchmentPopulation: number;
  catchmentJobs: number;
  interchange: boolean;
  isNew: boolean;
}

export interface DemandResult {
  boardingsPerDay: number;
  newBoardingsPerDay: number;
  annualRides: number;
  passengerKmPerYear: number;
  stations: StationDemand[];
  populationServedBefore: number;
  populationServedAfter: number;
  accessTimeBeforeMin: number;
  accessTimeAfterMin: number;
  hoursSavedPerDay: number;
  carTripsReplacedPerDay: number;
  carKmReplacedPerYear: number;
  notes: string[];
}

export interface BenefitItem {
  key: string;
  label: string;
  amountEurPerYear: number;
  basis: string;
}

export interface EconomicsResult {
  annualBenefitEur: number;
  annualBenefitLowEur: number;
  annualBenefitHighEur: number;
  /** Without the wider economic effects — comparable in kind to an official appraisal. */
  annualBenefitCoreEur: number;
  items: BenefitItem[];
  co2SavedTPerYear: number;
  notes: string[];
}

export interface FiscalItem {
  key: string;
  label: string;
  amountEurPerYear: number;
  level: string;
  basis: string;
}

export interface FiscalResult {
  annualTotalEur: number;
  annualCityEur: number;
  items: FiscalItem[];
  constructionReturnEur: number;
  federalFundingEur: number;
  federalFundingEligible: boolean;
  notes: string[];
}

export interface OperationsResult {
  annualRevenueEur: number;
  annualCostEur: number;
  annualResultEur: number;
  costRecoveryRatio: number;
  trainKmPerYear: number;
  items: BenefitItem[];
  notes: string[];
}

export interface AppraisalYear {
  year: number;
  investmentEur: number;
  operatingEur: number;
  benefitEur: number;
  netEur: number;
  cumulativeNetEur: number;
  discountedNetEur: number;
}

export interface AppraisalResult {
  npvEur: number;
  benefitCostRatio: number;
  paybackYear: number | null;
  series: AppraisalYear[];
  notes: string[];
}

export interface Headline {
  networkKm: number;
  newKm: number;
  stations: number;
  newStations: number;
  interchanges: number;
  investmentEur: number;
  investmentLowEur: number;
  investmentHighEur: number;
  openingYear: number | null;
  annualBenefitEur: number;
  annualFiscalEur: number;
  annualOperatingEur: number;
  benefitCostRatio: number;
  boardingsPerDay: number;
  populationServed: number;
  /** People newly within walking distance — the plan's own contribution. */
  populationGain: number;
  co2SavedTPerYear: number;
  feasibility: string;
  kmByMode: [string, number][];
}

export interface SimulationResult {
  calculationVersion: string;
  dataVersion: string;
  headline: Headline;
  cost: CostResult;
  timeline: TimelineResult;
  feasibility: FeasibilityResult;
  demand: DemandResult;
  economics: EconomicsResult;
  fiscal: FiscalResult;
  operations: OperationsResult;
  appraisal: AppraisalResult;
  disclaimer: string;
}

export interface ScenarioTemplate {
  id: string;
  title: string;
  summary: string;
  description: string;
  includedLines: string[];
  tags: string[];
  sources: string[];
}

export interface Diff {
  nodesChanged: number[];
  nodesRemoved: number[];
  edgesChanged: number[];
  edgesRemoved: number[];
  linesChanged: number[];
  linesRemoved: number[];
}

export interface StationDetail {
  id: number;
  name: string;
  lon: number;
  lat: number;
  depth: Depth;
  depthLabel: string;
  status: BuildStatus;
  source: SourceKind;
  interchange: boolean;
  accessible: boolean;
  lines: [string, string, Mode][];
  district: string | null;
  catchmentPopulation: number;
  catchmentJobs: number;
  nearby: [string, number][];
}

export interface LineDetail {
  id: number;
  label: string;
  name: string;
  mode: Mode;
  color: string;
  source: SourceKind;
  included: boolean;
  note: string;
  lengthKm: number;
  stations: [number, string, boolean][];
  /** Kilometres per construction type, most first. */
  construction: [string, number][];
  headwayPeakMin: number;
  officialOpeningYear: number | null;
  officialCostEur: number | null;
  openingYear: number | null;
}

export interface DataSource {
  name: string;
  url: string;
  licence: string;
  retrieved: string;
  note: string;
}

export interface DataVersion {
  id: string;
  city: string;
  sources: DataSource[];
}

export interface ComparisonRow {
  key: string;
  label: string;
  a: number;
  b: number;
  unit: string;
  higherIsBetter: boolean;
}

// ------------------------------------------------------------ base map ----

export interface BaseMap {
  version: string;
  water: { name: string; major: boolean; rings: [number, number][][] }[];
  waterways: { name: string; major: boolean; geo: [number, number][] }[];
  green: { name: string; kind: string; rings: [number, number][][] }[];
  roads: { name: string; class: number; geo: [number, number][] }[];
  districts: {
    id: string;
    name: string;
    borough: string;
    population: number;
    areaKm2: number;
    rings: [number, number][][];
    label: [number, number];
  }[];
  places: { name: string; geo: [number, number]; weight: number }[];
  rail: [number, number][][];
  // Coarse layers for the wider region: Lüneburg, Lauenburg, Kiel, Rostock.
  regionWater: { name: string; major: boolean; rings: [number, number][][] }[];
  coastline: [number, number][][];
  regionRoads: [number, number][][];
  regionRail: [number, number][][];
  /** Rivers and canals in the wider region. */
  regionWaterways?: [number, number][][];
  /** Forests and woods in the wider region, above about 300 ha. */
  regionGreen?: { rings: [number, number][][] }[];
  /** Detail inside the region's towns — see the town tier in the importer. */
  townWater?: { name: string; rings: [number, number][][] }[];
  townGreen?: { rings: [number, number][][] }[];
  townWaterways?: [number, number][][];
  townRoads?: { major: boolean; geo: [number, number][] }[];
  regionPlaces: { name: string; geo: [number, number]; population: number }[];
}
