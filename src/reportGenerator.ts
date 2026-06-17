import chalk from 'chalk';
import { table } from 'table';
import * as path from 'path';
import {
  SummaryReport,
  EnvironmentReport,
  DriftItem,
  RiskLevel
} from './types';
import {
  formatTimestamp,
  getRiskLevelColor,
  writeJsonFile,
  formatValue,
  ensureDir
} from './utils';
import { getDriftEmoji, formatDriftValue } from './diffEngine';

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息'
};

function colorizeRiskLevel(level: RiskLevel): string {
  const color = getRiskLevelColor(level);
  const label = RISK_LEVEL_LABELS[level];
  return (chalk as any)[color](label);
}

function colorizeRiskBg(level: RiskLevel, text: string): string {
  const bgColors: Record<RiskLevel, string> = {
    critical: 'bgRed',
    high: 'bgRedBright',
    medium: 'bgYellow',
    low: 'bgBlue',
    info: 'bgGray'
  };
  return (chalk as any)[bgColors[level]].black(text);
}

export function printConsoleReport(
  report: SummaryReport,
  minLevel: RiskLevel = 'info'
): void {
  const levelOrder: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info'];
  const minLevelIndex = levelOrder.indexOf(minLevel);

  console.log('');
  console.log(chalk.bold.cyan('='.repeat(80)));
  console.log(chalk.bold.cyan('配置漂移检测报告'));
  console.log(chalk.cyan(`生成时间: ${formatTimestamp(report.generatedAt)}`));
  console.log(chalk.cyan(`检测环境: ${report.environments.join(', ')}`));
  console.log(chalk.bold.cyan('='.repeat(80)));
  console.log('');

  printSummarySection(report, minLevelIndex, levelOrder);

  for (const envReport of report.environmentReports) {
    if (envReport.drifts.length === 0) {
      console.log(chalk.green(`✓ 环境 [${envReport.environment}] - 无配置漂移`));
      console.log('');
      continue;
    }

    const filteredDrifts = envReport.drifts.filter(
      d => levelOrder.indexOf(d.riskLevel) <= minLevelIndex
    );

    if (filteredDrifts.length === 0) {
      console.log(chalk.green(`✓ 环境 [${envReport.environment}] - 无 ${RISK_LEVEL_LABELS[minLevel]} 及以上风险的漂移`));
      console.log('');
      continue;
    }

    printEnvironmentSection(envReport, filteredDrifts);
  }

  printConclusion(report, minLevelIndex, levelOrder);
}

function printSummarySection(
  report: SummaryReport,
  minLevelIndex: number,
  levelOrder: RiskLevel[]
): void {
  console.log(chalk.bold('📊 总体汇总'));
  console.log('');

  const summaryData = [
    [chalk.bold('指标'), chalk.bold('数值')],
    ['配置源总数', String(report.totalSources)],
    ['存在漂移的源', String(report.driftedSources)],
    ['漂移项总数', String(report.totalDrifts)]
  ];

  for (const level of levelOrder) {
    if (levelOrder.indexOf(level) <= minLevelIndex && report.driftCountByLevel[level] > 0) {
      summaryData.push([
        `${colorizeRiskLevel(level)} 风险`,
        String(report.driftCountByLevel[level])
      ]);
    }
  }

  console.log(table(summaryData, {
    columns: [{ width: 30 }, { width: 50 }],
    drawHorizontalLine: (index) => index === 0 || index === 1 || index === summaryData.length
  }));

  if (report.driftedSources > 0) {
    const criticalCount = report.driftCountByLevel.critical;
    const highCount = report.driftCountByLevel.high;
    
    if (criticalCount > 0) {
      console.log(chalk.bold.red(`⚠️  存在 ${criticalCount} 个严重风险漂移，建议立即处理！`));
    } else if (highCount > 0) {
      console.log(chalk.bold.yellow(`⚠️  存在 ${highCount} 个高风险漂移，建议尽快处理！`));
    }
  }
  
  console.log('');
}

function printEnvironmentSection(
  envReport: EnvironmentReport,
  drifts: DriftItem[]
): void {
  console.log(chalk.bold(`🔍 环境: [${envReport.environment}]`));
  console.log(chalk.gray(`基线 ID: ${envReport.baselineId}`));
  console.log(chalk.gray(`检测时间: ${formatTimestamp(envReport.timestamp)}`));
  console.log('');

  const driftCountText = Object.entries(envReport.driftCountByLevel)
    .filter(([_, count]) => count > 0)
    .map(([level, count]) => `${colorizeRiskLevel(level as RiskLevel)}: ${count}`)
    .join(', ');

  console.log(`漂移统计: ${driftCountText}`);
  console.log('');

  const driftTableData = [
    [
      chalk.bold('风险'),
      chalk.bold('操作'),
      chalk.bold('配置路径'),
      chalk.bold('变更内容'),
      chalk.bold('配置源')
    ]
  ];

  for (const drift of drifts) {
    driftTableData.push([
      colorizeRiskBg(drift.riskLevel, RISK_LEVEL_LABELS[drift.riskLevel].padStart(2)),
      ` ${getDriftEmoji(drift.kind)} `,
      drift.path,
      formatDriftValue(drift),
      drift.sourceName
    ]);
  }

  console.log(table(driftTableData, {
    columns: [
      { width: 6, alignment: 'center' },
      { width: 4, alignment: 'center' },
      { width: 25 },
      { width: 35 },
      { width: 15 }
    ],
    drawHorizontalLine: (index) => index === 0 || index === 1 || index === driftTableData.length
  }));
}

function printConclusion(
  report: SummaryReport,
  minLevelIndex: number,
  levelOrder: RiskLevel[]
): void {
  console.log(chalk.bold('💡 处理建议'));
  console.log('');

  if (report.totalDrifts === 0) {
    console.log(chalk.green('所有环境配置与基线一致，无需处理！'));
  } else {
    const filteredDrifts = report.environmentReports.flatMap(r => 
      r.drifts.filter(d => levelOrder.indexOf(d.riskLevel) <= minLevelIndex)
    );

    if (filteredDrifts.length === 0) {
      console.log(chalk.green(`无 ${RISK_LEVEL_LABELS[levelOrder[minLevelIndex]]} 及以上风险的漂移，可根据实际情况决定是否处理低级别漂移。`));
    } else {
      const criticalDrifts = filteredDrifts.filter(d => d.riskLevel === 'critical');
      const highDrifts = filteredDrifts.filter(d => d.riskLevel === 'high');
      const mediumDrifts = filteredDrifts.filter(d => d.riskLevel === 'medium');

      if (criticalDrifts.length > 0) {
        console.log(chalk.red(`🔴 严重风险 (${criticalDrifts.length}项): 立即处理，可能影响系统稳定性或安全性`));
        for (const d of criticalDrifts.slice(0, 3)) {
          console.log(`   - [${d.sourceName}] ${d.path}: ${formatDriftValue(d)}`);
        }
      }

      if (highDrifts.length > 0) {
        console.log(chalk.yellow(`🟡 高风险 (${highDrifts.length}项): 建议近期处理，可能影响核心功能`));
        for (const d of highDrifts.slice(0, 3)) {
          console.log(`   - [${d.sourceName}] ${d.path}: ${formatDriftValue(d)}`);
        }
      }

      if (mediumDrifts.length > 0) {
        console.log(chalk.blue(`🔵 中风险 (${mediumDrifts.length}项): 可在排期内处理，影响有限`));
      }
    }
  }

  console.log('');
}

export function exportJsonReport(
  report: SummaryReport,
  outputPath: string
): void {
  writeJsonFile(outputPath, report);
  console.log(chalk.green(`✓ JSON 报告已导出: ${outputPath}`));
}

export function exportMarkdownReport(
  report: SummaryReport,
  outputPath: string
): void {
  const content = generateMarkdownReport(report);
  ensureDir(path.dirname(outputPath));
  const fs = require('fs');
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(chalk.green(`✓ Markdown 报告已导出: ${outputPath}`));
}

function generateMarkdownReport(report: SummaryReport): string {
  const lines: string[] = [];

  lines.push('# 配置漂移检测报告');
  lines.push('');
  lines.push(`- **生成时间**: ${formatTimestamp(report.generatedAt)}`);
  lines.push(`- **检测环境**: ${report.environments.join(', ')}`);
  lines.push('');

  lines.push('## 总体汇总');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 配置源总数 | ${report.totalSources} |`);
  lines.push(`| 存在漂移的源 | ${report.driftedSources} |`);
  lines.push(`| 漂移项总数 | ${report.totalDrifts} |`);
  lines.push(`| 🔴 严重风险 | ${report.driftCountByLevel.critical} |`);
  lines.push(`| 🟡 高风险 | ${report.driftCountByLevel.high} |`);
  lines.push(`| 🔵 中风险 | ${report.driftCountByLevel.medium} |`);
  lines.push(`| 🟢 低风险 | ${report.driftCountByLevel.low} |`);
  lines.push(`| ⚪ 信息 | ${report.driftCountByLevel.info} |`);
  lines.push('');

  for (const envReport of report.environmentReports) {
    lines.push(`## 环境: ${envReport.environment}`);
    lines.push('');
    lines.push(`- **基线 ID**: ${envReport.baselineId}`);
    lines.push(`- **检测时间**: ${formatTimestamp(envReport.timestamp)}`);
    lines.push(`- **配置源总数**: ${envReport.totalSources}`);
    lines.push(`- **存在漂移的源**: ${envReport.driftedSources}`);
    lines.push('');

    if (envReport.drifts.length === 0) {
      lines.push('> ✅ 无配置漂移');
      lines.push('');
      continue;
    }

    lines.push('### 漂移详情');
    lines.push('');
    lines.push('| 风险 | 操作 | 配置路径 | 变更内容 | 配置源 |');
    lines.push('|------|------|----------|----------|--------|');

    for (const drift of envReport.drifts) {
      const riskEmoji = drift.riskLevel === 'critical' ? '🔴' :
                       drift.riskLevel === 'high' ? '🟡' :
                       drift.riskLevel === 'medium' ? '🔵' :
                       drift.riskLevel === 'low' ? '🟢' : '⚪';
      const action = drift.kind === 'added' ? '➕' :
                     drift.kind === 'deleted' ? '➖' :
                     drift.kind === 'modified' ? '✏️' : '≠';
      
      lines.push(`| ${riskEmoji} ${RISK_LEVEL_LABELS[drift.riskLevel]} | ${action} | ${drift.path} | ${formatDriftValue(drift)} | ${drift.sourceName} |`);
    }

    lines.push('');
  }

  lines.push('## 处理建议');
  lines.push('');

  if (report.totalDrifts === 0) {
    lines.push('✅ 所有环境配置与基线一致，无需处理！');
  } else {
    if (report.driftCountByLevel.critical > 0) {
      lines.push(`- 🔴 **严重风险 (${report.driftCountByLevel.critical}项)**: 立即处理，可能影响系统稳定性或安全性`);
    }
    if (report.driftCountByLevel.high > 0) {
      lines.push(`- 🟡 **高风险 (${report.driftCountByLevel.high}项)**: 建议近期处理，可能影响核心功能`);
    }
    if (report.driftCountByLevel.medium > 0) {
      lines.push(`- 🔵 **中风险 (${report.driftCountByLevel.medium}项)**: 可在排期内处理，影响有限`);
    }
    if (report.driftCountByLevel.low > 0) {
      lines.push(`- 🟢 **低风险 (${report.driftCountByLevel.low}项)**: 可选择性处理，影响较小`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
