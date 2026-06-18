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
  ConfigSource,
  AppConfig,
  MatrixReport,
  MatrixDriftCell,
  MatrixSourceSummary,
  ExpectedPerEnvPath
} from './types';
import {
  getCurrentTimestamp,
  pathMatchesPattern,
  sortByRiskLevel,
  formatValue,
  normalizeData,
  getContentSignature,
  isExpectedPerEnvPath,
  getRiskLevelColor
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

interface CompareOptions {
  riskRules: RiskRule[];
  ignorePaths?: string[];
  arrayOrderSensitive?: boolean;
  arrayOrderSensitivePaths?: string[];
  normalizeTypes?: boolean;
  expectedPerEnvPaths?: ExpectedPerEnvPath[];
  markExpectedDrifts?: boolean;
  skipSourceIdCheck?: boolean;
}

export function compareSnapshots(
  baselineSnapshot: ConfigSnapshot,
  currentSnapshot: ConfigSnapshot,
  options: CompareOptions
): DriftItem[] {
  const {
    riskRules,
    ignorePaths,
    arrayOrderSensitive = false,
    arrayOrderSensitivePaths = [],
    normalizeTypes = true,
    expectedPerEnvPaths = [],
    markExpectedDrifts = false,
    skipSourceIdCheck = false
  } = options;
  const drifts: DriftItem[] = [];
  
  if (!skipSourceIdCheck && baselineSnapshot.sourceId !== currentSnapshot.sourceId) {
    throw new Error('快照源 ID 不匹配，无法比较');
  }

  const baselineFiltered = filterIgnoredPaths(baselineSnapshot.data, ignorePaths);
  const currentFiltered = filterIgnoredPaths(currentSnapshot.data, ignorePaths);

  const normalizeOptions = {
    sortKeys: true,
    arrayOrderSensitive,
    arrayOrderSensitivePaths,
    normalizeTypes
  };

  const baselineNormalized = normalizeData(baselineFiltered, normalizeOptions);
  const currentNormalized = normalizeData(currentFiltered, normalizeOptions);

  const differences = deepDiff.diff(baselineNormalized, currentNormalized) as DiffItem[] | undefined;
  
  if (!differences || differences.length === 0) {
    return drifts;
  }

  for (const diff of differences) {
    const path = diff.path || [];
    const pathStr = getPathString(path);
    
    if (shouldIgnorePath(pathStr, ignorePaths)) {
      continue;
    }

    if (diff.kind === 'A' && !arrayOrderSensitive) {
      const parentPath = pathStr;
      const isPathSensitive = arrayOrderSensitivePaths.some(pattern =>
        pathMatchesPattern(parentPath, pattern)
      );
      if (!isPathSensitive) {
        continue;
      }
    }

    const isExpected = isExpectedPerEnvPath(pathStr, expectedPerEnvPaths);
    if (isExpected && !markExpectedDrifts) {
      continue;
    }

    const { level, description } = evaluateRisk(pathStr, riskRules);
    
    const drift: any = {
      path: pathStr,
      kind: mapDiffKind(diff.kind),
      baselineValue: diff.lhs,
      currentValue: diff.rhs,
      riskLevel: isExpected ? 'info' : level,
      riskDescription: isExpected ? `预期环境差异: ${description || pathStr}` : description,
      sourceId: baselineSnapshot.sourceId,
      sourceName: baselineSnapshot.sourceName,
      isExpectedPerEnv: isExpected
    };

    if (diff.kind === 'A' && diff.item) {
      const arrayPath = [...path, String(diff.index)];
      drift.path = getPathString(arrayPath);
      drift.baselineValue = diff.item.lhs;
      drift.currentValue = diff.item.rhs;
      
      const isArrayExpected = isExpectedPerEnvPath(drift.path, expectedPerEnvPaths);
      if (isArrayExpected && !markExpectedDrifts) {
        continue;
      }
      
      const arrayRisk = evaluateRisk(drift.path, riskRules);
      drift.riskLevel = isArrayExpected ? 'info' : arrayRisk.level;
      drift.riskDescription = isArrayExpected
        ? `预期环境差异: ${arrayRisk.description || drift.path}`
        : arrayRisk.description;
      drift.isExpectedPerEnv = isArrayExpected;
    }

    drifts.push(drift);
  }

  return sortByRiskLevel(drifts);
}

export function compareSnapshotsById(
  baseline: Baseline,
  currentSnapshots: ConfigSnapshot[],
  sources: ConfigSource[],
  globalArrayOrderSensitive: boolean = false,
  options?: { markExpectedDrifts?: boolean }
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

    const arrayOrderSensitive = source?.arrayOrderSensitive ?? globalArrayOrderSensitive;
    const arrayOrderSensitivePaths = source?.arrayOrderSensitivePaths || [];
    const expectedPerEnvPaths = source?.expectedPerEnvPaths || [];

    const drifts = compareSnapshots(
      baselineSnapshot,
      currentSnapshot,
      {
        riskRules,
        ignorePaths,
        arrayOrderSensitive,
        arrayOrderSensitivePaths,
        expectedPerEnvPaths,
        markExpectedDrifts: options?.markExpectedDrifts
      }
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
  sources: ConfigSource[],
  globalArrayOrderSensitive: boolean = false,
  options?: { markExpectedDrifts?: boolean }
): EnvironmentReport {
  const drifts = compareSnapshotsById(
    baseline,
    currentSnapshots,
    sources,
    globalArrayOrderSensitive,
    options
  );
  
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

export function getArrayOrderInfo(
  source: ConfigSource | undefined,
  globalSensitive: boolean
): { sensitive: boolean; sourceLevel: boolean; globalLevel: boolean } {
  const sourceLevel = source?.arrayOrderSensitive;
  const sensitive = sourceLevel ?? globalSensitive;
  return {
    sensitive,
    sourceLevel: sourceLevel === true,
    globalLevel: globalSensitive && sourceLevel === undefined
  };
}

interface MatrixCompareOptions {
  sources: ConfigSource[];
  globalArrayOrderSensitive?: boolean;
  compareMode?: 'all' | 'baseline';
  baselineEnvironment?: string;
  markExpectedDrifts?: boolean;
}

function getSnapshotsByEnvironment(
  allSnapshots: ConfigSnapshot[]
): Record<string, ConfigSnapshot[]> {
  const result: Record<string, ConfigSnapshot[]> = {};
  for (const snap of allSnapshots) {
    if (!result[snap.environment]) {
      result[snap.environment] = [];
    }
    result[snap.environment].push(snap);
  }
  return result;
}

function compareEnvironmentSnapshots(
  snapshotsA: ConfigSnapshot[],
  snapshotsB: ConfigSnapshot[],
  sources: ConfigSource[],
  globalArrayOrderSensitive: boolean,
  markExpectedDrifts?: boolean
): DriftItem[] {
  const allDrifts: DriftItem[] = [];

  const snapMapA: Record<string, ConfigSnapshot> = {};
  const snapMapB: Record<string, ConfigSnapshot> = {};

  const groupToSource: Record<string, ConfigSource> = {};
  for (const source of sources) {
    const key = source.matrixGroup || source.id;
    groupToSource[key] = source;
  }

  for (const s of snapshotsA) {
    const source = sources.find(src => src.id === s.sourceId);
    const key = source?.matrixGroup || s.sourceId;
    snapMapA[key] = s;
  }
  for (const s of snapshotsB) {
    const source = sources.find(src => src.id === s.sourceId);
    const key = source?.matrixGroup || s.sourceId;
    snapMapB[key] = s;
  }

  const allKeys = new Set([...Object.keys(snapMapA), ...Object.keys(snapMapB)]);

  for (const key of allKeys) {
    const snapA = snapMapA[key];
    const snapB = snapMapB[key];

    if (!snapA || !snapB) {
      continue;
    }

    const source = groupToSource[key] || sources.find(s => s.id === snapA.sourceId);
    if (!source) continue;

    const riskRules = source.riskRules || [];
    const ignorePaths = source.ignorePaths;
    const arrayOrderSensitive = source.arrayOrderSensitive ?? globalArrayOrderSensitive;
    const arrayOrderSensitivePaths = source.arrayOrderSensitivePaths || [];
    const expectedPerEnvPaths = source.expectedPerEnvPaths || [];

    const drifts = compareSnapshots(snapA, snapB, {
      riskRules,
      ignorePaths,
      arrayOrderSensitive,
      arrayOrderSensitivePaths,
      expectedPerEnvPaths,
      markExpectedDrifts,
      skipSourceIdCheck: true
    });

    const normalizedDrifts = drifts.map(d => ({
      ...d,
      sourceId: key,
      sourceName: source.name
    }));

    allDrifts.push(...normalizedDrifts);
  }

  return sortByRiskLevel(allDrifts);
}

function generateSourceSummaries(
  allSnapshots: ConfigSnapshot[],
  sources: ConfigSource[],
  environments: string[],
  globalArrayOrderSensitive: boolean
): MatrixSourceSummary[] {
  const summaries: MatrixSourceSummary[] = [];
  
  const snapByEnvAndGroup: Record<string, Record<string, ConfigSnapshot>> = {};
  for (const env of environments) {
    snapByEnvAndGroup[env] = {};
  }
  
  for (const snap of allSnapshots) {
    if (!snapByEnvAndGroup[snap.environment]) continue;
    const source = sources.find(s => s.id === snap.sourceId);
    const key = source?.matrixGroup || snap.sourceId;
    snapByEnvAndGroup[snap.environment][key] = snap;
  }

  const groupToSource: Record<string, ConfigSource> = {};
  const groupToName: Record<string, string> = {};
  for (const source of sources) {
    const key = source.matrixGroup || source.id;
    if (!groupToSource[key]) {
      groupToSource[key] = source;
      groupToName[key] = source.matrixGroup ? source.name.replace(/\(.+\)/, '').trim() + ` (${source.matrixGroup})` : source.name;
    }
  }

  for (const key of Object.keys(groupToSource)) {
    const environmentValues: Record<string, any> = {};
    let hasDrift = false;
    let firstSignature: string | null = null;

    for (const env of environments) {
      const snap = snapByEnvAndGroup[env]?.[key];
      if (snap) {
        environmentValues[env] = snap.data;
        const sig = getContentSignature(snap.data);
        if (firstSignature === null) {
          firstSignature = sig;
        } else if (sig !== firstSignature) {
          hasDrift = true;
        }
      } else {
        environmentValues[env] = null;
        hasDrift = true;
      }
    }

    summaries.push({
      sourceId: key,
      sourceName: groupToName[key],
      environmentValues,
      hasDrift
    });
  }

  return summaries;
}

export function generateMatrixReport(
  allSnapshots: ConfigSnapshot[],
  options: MatrixCompareOptions
): MatrixReport {
  const {
    sources,
    globalArrayOrderSensitive = false,
    compareMode = 'all',
    baselineEnvironment,
    markExpectedDrifts = false
  } = options;

  const envSnapshotsMap = getSnapshotsByEnvironment(allSnapshots);
  const environments = Object.keys(envSnapshotsMap).sort();

  if (environments.length < 2) {
    throw new Error('矩阵比对需要至少 2 个环境的快照');
  }

  const cells: MatrixDriftCell[] = [];
  const driftCountByLevel: Record<RiskLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  const sourceSummaries = generateSourceSummaries(
    allSnapshots,
    sources,
    environments,
    globalArrayOrderSensitive
  );

  if (compareMode === 'baseline' && baselineEnvironment) {
    if (!environments.includes(baselineEnvironment)) {
      throw new Error(`基线环境 [${baselineEnvironment}] 不在快照中`);
    }

    const baselineSnaps = envSnapshotsMap[baselineEnvironment];

    for (const env of environments) {
      if (env === baselineEnvironment) continue;

      const envSnaps = envSnapshotsMap[env];
      const drifts = compareEnvironmentSnapshots(
        baselineSnaps,
        envSnaps,
        sources,
        globalArrayOrderSensitive,
        markExpectedDrifts
      );

      const cell: MatrixDriftCell = {
        environmentA: baselineEnvironment,
        environmentB: env,
        totalDrifts: drifts.length,
        driftCountByLevel: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0
        },
        drifts
      };

      for (const drift of drifts) {
        cell.driftCountByLevel[drift.riskLevel]++;
        driftCountByLevel[drift.riskLevel]++;
      }

      cells.push(cell);
    }
  } else {
    for (let i = 0; i < environments.length; i++) {
      for (let j = i + 1; j < environments.length; j++) {
        const envA = environments[i];
        const envB = environments[j];

        const drifts = compareEnvironmentSnapshots(
          envSnapshotsMap[envA],
          envSnapshotsMap[envB],
          sources,
          globalArrayOrderSensitive,
          markExpectedDrifts
        );

        const cell: MatrixDriftCell = {
          environmentA: envA,
          environmentB: envB,
          totalDrifts: drifts.length,
          driftCountByLevel: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          },
          drifts
        };

        for (const drift of drifts) {
          cell.driftCountByLevel[drift.riskLevel]++;
          driftCountByLevel[drift.riskLevel]++;
        }

        cells.push(cell);
      }
    }
  }

  const sourcesWithDrift = sourceSummaries.filter(s => s.hasDrift).length;

  return {
    generatedAt: getCurrentTimestamp(),
    environments,
    totalSources: sources.length,
    sourcesWithDrift,
    totalDriftPairs: cells.length,
    driftCountByLevel,
    cells,
    sourceSummaries,
    compareMode,
    baselineEnvironment: compareMode === 'baseline' ? baselineEnvironment : undefined
  };
}

export function printMatrixConsoleReport(report: MatrixReport, minLevel: RiskLevel = 'info'): void {
  const chalk = require('chalk');
  const levelOrder: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info'];
  const minIndex = levelOrder.indexOf(minLevel);

  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║           配置漂移矩阵报告                      ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════╝'));

  console.log(`\n生成时间: ${report.generatedAt}`);
  console.log(`环境列表: ${report.environments.join(', ')}`);
  console.log(`比对模式: ${report.compareMode === 'baseline' ? `基线模式 (基准: ${report.baselineEnvironment})` : '全量两两比对'}`);
  console.log(`总配置源: ${report.totalSources}`);
  console.log(`有漂移源: ${report.sourcesWithDrift}`);
  console.log(`比对对: ${report.totalDriftPairs}`);

  console.log(chalk.yellow('\n── 风险等级统计 ──'));
  for (const level of levelOrder) {
    const count = report.driftCountByLevel[level];
    const color = getRiskLevelColor(level);
    if (count > 0) {
      console.log(`  ${chalk[color](level)}: ${count}`);
    }
  }

  console.log(chalk.yellow('\n── 配置源漂移概览 ──'));
  for (const summary of report.sourceSummaries) {
    const status = summary.hasDrift ? chalk.red('✗ 有漂移') : chalk.green('✓ 一致');
    console.log(`  ${status} ${summary.sourceName} (${summary.sourceId})`);
  }

  console.log(chalk.yellow('\n── 环境对漂移详情 ──'));
  for (const cell of report.cells) {
    const hasDrift = cell.totalDrifts > 0;
    const status = hasDrift ? chalk.red(`${cell.totalDrifts} 项漂移`) : chalk.green('无漂移');
    console.log(`\n  ${chalk.bold(cell.environmentA)} ↔ ${chalk.bold(cell.environmentB)}: ${status}`);

    const filteredDrifts = cell.drifts.filter(
      d => levelOrder.indexOf(d.riskLevel) <= minIndex
    );

    if (filteredDrifts.length > 0) {
      for (const drift of filteredDrifts) {
        const color = getRiskLevelColor(drift.riskLevel);
        const emoji = getDriftEmoji(drift.kind);
        const expectedTag = (drift as any).isExpectedPerEnv ? chalk.gray(' [预期]') : '';
        console.log(
          `    [${chalk[color](drift.riskLevel)}] ${emoji} ${drift.path}${expectedTag} — ${formatDriftValue(drift)}`
        );
      }
    }
  }

  console.log(chalk.cyan('\n══════════════════════════════════════════════════'));
}

export function exportMatrixJsonReport(report: MatrixReport, outputPath: string): void {
  const { writeJsonFile } = require('./utils');
  writeJsonFile(outputPath, report);
  console.log(`矩阵报告已导出到: ${outputPath}`);
}

export function exportMatrixMarkdownReport(report: MatrixReport, outputPath: string): void {
  const fs = require('fs');
  const { ensureDir } = require('./utils');
  const path = require('path');

  let md = '# 配置漂移矩阵报告\n\n';
  md += `> 生成时间: ${report.generatedAt}\n\n`;
  md += `## 概览\n\n`;
  md += `- **环境列表**: ${report.environments.join(', ')}\n`;
  md += `- **比对模式**: ${report.compareMode === 'baseline' ? `基线模式 (基准: ${report.baselineEnvironment})` : '全量两两比对'}\n`;
  md += `- **总配置源**: ${report.totalSources}\n`;
  md += `- **有漂移源**: ${report.sourcesWithDrift}\n`;
  md += `- **比对对**: ${report.totalDriftPairs}\n\n`;

  md += '## 风险等级统计\n\n';
  md += '| 风险等级 | 数量 |\n';
  md += '|---------|------|\n';
  for (const level of ['critical', 'high', 'medium', 'low', 'info'] as RiskLevel[]) {
    md += `| ${level} | ${report.driftCountByLevel[level]} |\n`;
  }
  md += '\n';

  md += '## 配置源漂移概览\n\n';
  md += '| 配置源 | 状态 |\n';
  md += '|--------|------|\n';
  for (const summary of report.sourceSummaries) {
    const status = summary.hasDrift ? '❌ 有漂移' : '✅ 一致';
    md += `| ${summary.sourceName} | ${status} |\n`;
  }
  md += '\n';

  md += '## 环境对漂移详情\n\n';
  for (const cell of report.cells) {
    md += `### ${cell.environmentA} ↔ ${cell.environmentB}\n\n`;
    md += `**漂移数**: ${cell.totalDrifts}\n\n`;

    if (cell.totalDrifts > 0) {
      md += '| 路径 | 类型 | 风险等级 | 变化 |\n';
      md += '|------|------|----------|------|\n';
      for (const drift of cell.drifts) {
        const expectedTag = (drift as any).isExpectedPerEnv ? ' [预期]' : '';
        md += `| ${drift.path}${expectedTag} | ${drift.kind} | ${drift.riskLevel} | ${formatDriftValue(drift)} |\n`;
      }
      md += '\n';
    }
  }

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(`矩阵报告已导出到: ${outputPath}`);
}
