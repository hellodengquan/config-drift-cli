import * as deepDiff from 'deep-diff';
import {
  Baseline,
  ConfigSnapshot,
  DriftItem,
  RiskRule,
  RiskLevel,
  DiffItem,
  EnvironmentReport,
  SummaryReport,
  ConfigSource
} from './types';
import {
  getCurrentTimestamp,
  pathMatchesPattern,
  sortByRiskLevel,
  formatValue
} from './utils';

function getPathString(path: string[]): string {
  return path.join('.');
}

function mapDiffKind(kind: string): DriftItem['kind'] {
  switch (kind) {
    case 'N': return 'added';
    case 'D': return 'deleted';
    case 'E': return 'modified';
    case 'A': return 'array-changed';
    default: return 'modified';
  }
}

function evaluateRisk(
  path: string,
  riskRules: RiskRule[]
): { level: RiskLevel; description?: string } {
  for (const rule of riskRules) {
    if (pathMatchesPattern(path, rule.pathPattern)) {
      return { level: rule.level, description: rule.description };
    }
  }
  return { level: 'medium', description: '未匹配到风险规则，使用默认等级' };
}

function shouldIgnorePath(
  path: string,
  ignorePaths?: string[]
): boolean {
  if (!ignorePaths || ignorePaths.length === 0) return false;
  return ignorePaths.some(pattern => pathMatchesPattern(path, pattern));
}

function filterIgnoredPaths(
  data: Record<string, any>,
  ignorePaths?: string[]
): Record<string, any> {
  if (!ignorePaths || ignorePaths.length === 0) return data;
  
  const result = JSON.parse(JSON.stringify(data));
  
  function removePaths(obj: any, currentPath: string[]): void {
    if (typeof obj !== 'object' || obj === null) return;
    
    for (const key of Object.keys(obj)) {
      const path = [...currentPath, key];
      const pathStr = getPathString(path);
      
      if (shouldIgnorePath(pathStr, ignorePaths)) {
        delete obj[key];
      } else {
        removePaths(obj[key], path);
      }
    }
  }
  
  removePaths(result, []);
  return result;
}

export function compareSnapshots(
  baselineSnapshot: ConfigSnapshot,
  currentSnapshot: ConfigSnapshot,
  riskRules: RiskRule[],
  ignorePaths?: string[]
): DriftItem[] {
  const drifts: DriftItem[] = [];
  
  if (baselineSnapshot.sourceId !== currentSnapshot.sourceId) {
    throw new Error('快照源 ID 不匹配，无法比较');
  }

  const baselineData = filterIgnoredPaths(baselineSnapshot.data, ignorePaths);
  const currentData = filterIgnoredPaths(currentSnapshot.data, ignorePaths);

  const differences = deepDiff.diff(baselineData, currentData) as DiffItem[] | undefined;
  
  if (!differences || differences.length === 0) {
    return drifts;
  }

  for (const diff of differences) {
    const path = diff.path || [];
    const pathStr = getPathString(path);
    
    if (shouldIgnorePath(pathStr, ignorePaths)) {
      continue;
    }

    const { level, description } = evaluateRisk(pathStr, riskRules);
    
    const drift: DriftItem = {
      path: pathStr,
      kind: mapDiffKind(diff.kind),
      baselineValue: diff.lhs,
      currentValue: diff.rhs,
      riskLevel: level,
      riskDescription: description,
      sourceId: baselineSnapshot.sourceId,
      sourceName: baselineSnapshot.sourceName
    };

    if (diff.kind === 'A' && diff.item) {
      const arrayPath = [...path, String(diff.index)];
      drift.path = getPathString(arrayPath);
      drift.baselineValue = diff.item.lhs;
      drift.currentValue = diff.item.rhs;
      
      const arrayRisk = evaluateRisk(drift.path, riskRules);
      drift.riskLevel = arrayRisk.level;
      drift.riskDescription = arrayRisk.description;
    }

    drifts.push(drift);
  }

  return sortByRiskLevel(drifts);
}

export function compareSnapshotsById(
  baseline: Baseline,
  currentSnapshots: ConfigSnapshot[],
  sources: ConfigSource[]
): DriftItem[] {
  const allDrifts: DriftItem[] = [];

  for (const currentSnapshot of currentSnapshots) {
    const baselineSnapshot = baseline.snapshots[currentSnapshot.sourceId];
    
    if (!baselineSnapshot) {
      console.warn(`基线中未找到源 [${currentSnapshot.sourceName}] 的快照，跳过比较`);
      continue;
    }

    const source = sources.find(s => s.id === currentSnapshot.sourceId);
    const ignorePaths = source?.ignorePaths;

    const riskRules = [
      ...(source?.riskRules || []),
      ...baseline.riskRules
    ];

    const drifts = compareSnapshots(
      baselineSnapshot,
      currentSnapshot,
      riskRules,
      ignorePaths
    );

    allDrifts.push(...drifts);
  }

  const missingSources = Object.keys(baseline.snapshots).filter(
    sourceId => !currentSnapshots.some(s => s.sourceId === sourceId)
  );

  for (const sourceId of missingSources) {
    const baselineSnapshot = baseline.snapshots[sourceId];
    console.warn(`当前快照中缺少源 [${baselineSnapshot.sourceName}]，无法检测漂移`);
  }

  return sortByRiskLevel(allDrifts);
}

export function generateEnvironmentReport(
  environment: string,
  baseline: Baseline,
  currentSnapshots: ConfigSnapshot[],
  sources: ConfigSource[]
): EnvironmentReport {
  const drifts = compareSnapshotsById(baseline, currentSnapshots, sources);
  
  const driftCountByLevel: Record<RiskLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  for (const drift of drifts) {
    driftCountByLevel[drift.riskLevel]++;
  }

  const driftedSourceIds = new Set(drifts.map(d => d.sourceId));

  return {
    environment,
    totalSources: Object.keys(baseline.snapshots).length,
    driftedSources: driftedSourceIds.size,
    driftCountByLevel,
    drifts,
    timestamp: getCurrentTimestamp(),
    baselineId: baseline.id
  };
}

export function generateSummaryReport(
  environmentReports: EnvironmentReport[]
): SummaryReport {
  const driftCountByLevel: Record<RiskLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  let totalSources = 0;
  let driftedSources = 0;
  let totalDrifts = 0;

  for (const report of environmentReports) {
    totalSources += report.totalSources;
    driftedSources += report.driftedSources;
    totalDrifts += report.drifts.length;
    
    for (const level of Object.keys(driftCountByLevel) as RiskLevel[]) {
      driftCountByLevel[level] += report.driftCountByLevel[level];
    }
  }

  return {
    generatedAt: getCurrentTimestamp(),
    environments: environmentReports.map(r => r.environment),
    totalSources,
    driftedSources,
    totalDrifts,
    driftCountByLevel,
    environmentReports
  };
}

export function getDriftEmoji(kind: DriftItem['kind']): string {
  switch (kind) {
    case 'added': return '+';
    case 'deleted': return '-';
    case 'modified': return '~';
    case 'array-changed': return '≠';
    default: return '?';
  }
}

export function formatDriftValue(drift: DriftItem): string {
  if (drift.kind === 'added') {
    return `新增: ${formatValue(drift.currentValue)}`;
  }
  if (drift.kind === 'deleted') {
    return `删除: ${formatValue(drift.baselineValue)}`;
  }
  return `${formatValue(drift.baselineValue)} → ${formatValue(drift.currentValue)}`;
}
