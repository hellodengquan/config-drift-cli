export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ConfigSourceType = 'file' | 'http' | 'env' | 'command';

export type ConfigFormat = 'json' | 'yaml' | 'env' | 'text';

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

export interface AppConfig {
  storagePath: string;
  sources: ConfigSource[];
  defaultRiskRules: RiskRule[];
  environments: string[];
}
