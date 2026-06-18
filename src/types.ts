export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ConfigSourceType = 'file' | 'http' | 'env' | 'command';

export type ConfigFormat = 'json' | 'yaml' | 'env' | 'text';

export type ConfigPlane = 'control-plane' | 'data-plane' | 'default';

export interface ConfigSource {
  id: string;
  name: string;
  type: ConfigSourceType;
  format: ConfigFormat;
  path: string;
  environment: string;
  description?: string;
  riskRules?: RiskRule[];
  ignorePaths?: string[];
  arrayOrderSensitive?: boolean;
  arrayOrderSensitivePaths?: string[];
  stripComments?: boolean;
  vaultRefPatterns?: string[];
  expectedPerEnvPaths?: ExpectedPerEnvPath[];
  matrixGroup?: string;
  plane?: ConfigPlane;
  tags?: string[];
}

export interface ExpectedPerEnvPath {
  pathPattern: string;
  description?: string;
  allowedEnvironments?: string[];
}

export interface RiskRule {
  pathPattern: string;
  level: RiskLevel;
  description?: string;
}

export interface ConfigSnapshot {
  id: string;
  sourceId: string;
  sourceName: string;
  environment: string;
  timestamp: string;
  format: ConfigFormat;
  data: Record<string, any>;
  rawContent: string;
  metadata: {
    path: string;
    checksum: string;
    size: number;
  };
}

export interface Baseline {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  environment: string;
  snapshots: Record<string, ConfigSnapshot>;
  riskRules: RiskRule[];
}

export interface DiffItem {
  kind: 'N' | 'D' | 'E' | 'A';
  path: string[];
  lhs?: any;
  rhs?: any;
  index?: number;
  item?: any;
}

export interface DriftItem {
  path: string;
  kind: 'added' | 'deleted' | 'modified' | 'array-changed';
  baselineValue: any;
  currentValue: any;
  riskLevel: RiskLevel;
  riskDescription?: string;
  sourceId: string;
  sourceName: string;
}

export interface EnvironmentReport {
  environment: string;
  totalSources: number;
  driftedSources: number;
  driftCountByLevel: Record<RiskLevel, number>;
  drifts: DriftItem[];
  timestamp: string;
  baselineId: string;
}

export interface SummaryReport {
  generatedAt: string;
  environments: string[];
  totalSources: number;
  driftedSources: number;
  totalDrifts: number;
  driftCountByLevel: Record<RiskLevel, number>;
  environmentReports: EnvironmentReport[];
}

export interface MatrixDriftCell {
  environmentA: string;
  environmentB: string;
  totalDrifts: number;
  driftCountByLevel: Record<RiskLevel, number>;
  drifts: DriftItem[];
}

export interface MatrixSourceSummary {
  sourceId: string;
  sourceName: string;
  environmentValues: Record<string, any>;
  hasDrift: boolean;
}

export interface EnvironmentPlaneSummary {
  environment: string;
  totalDrifts: number;
  driftPercentage: number;
  driftCountByLevel: Record<RiskLevel, number>;
  controlPlaneDrifts: number;
  dataPlaneDrifts: number;
  defaultPlaneDrifts: number;
  topDrifts: DriftItem[];
}

export interface MatrixReport {
  generatedAt: string;
  environments: string[];
  totalSources: number;
  sourcesWithDrift: number;
  totalDriftPairs: number;
  driftCountByLevel: Record<RiskLevel, number>;
  cells: MatrixDriftCell[];
  sourceSummaries: MatrixSourceSummary[];
  compareMode: 'all' | 'baseline';
  baselineEnvironment?: string;
  environmentSummaries: EnvironmentPlaneSummary[];
}

export interface AppConfig {
  storagePath: string;
  sources: ConfigSource[];
  defaultRiskRules: RiskRule[];
  environments: string[];
  arrayOrderSensitive?: boolean;
}
