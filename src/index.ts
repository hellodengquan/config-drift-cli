#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import {
  loadAppConfig,
  initConfig,
  captureSnapshots
} from './configLoader';
import {
  saveBaseline,
  loadBaseline,
  listBaselines,
  deleteBaseline,
  getLatestBaseline,
  printBaselineList,
  createBaselineFromConfig
} from './baselineManager';
import {
  generateEnvironmentReport,
  generateSummaryReport
} from './diffEngine';
import {
  printConsoleReport,
  exportJsonReport,
  exportMarkdownReport
} from './reportGenerator';
import { RiskLevel, EnvironmentReport, SummaryReport } from './types';

const program = new Command();

program
  .name('cdrift')
  .description('配置漂移侦测命令行工具')
  .version('1.0.0')
  .option('-c, --config <path>', '指定配置文件路径', 'cdrift.config.json');

program
  .command('init')
  .description('初始化配置文件')
  .action(async () => {
    try {
      const options = program.opts();
      initConfig(options.config);
    } catch (error) {
      console.error(chalk.red(`初始化失败: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command('snapshot')
  .description('抓取配置快照')
  .option('-e, --environment <env>', '指定环境，不指定则抓取所有环境')
  .option('-o, --output <path>', '输出快照到指定文件')
  .action(async (cmdOpts) => {
    try {
      const options = program.opts();
      const config = loadAppConfig(options.config);
      
      console.log(chalk.cyan(`正在抓取${cmdOpts.environment ? ` [${cmdOpts.environment}] 环境的` : '所有环境的'}配置快照...`));
      console.log('');
      
      const snapshots = await captureSnapshots(config.sources, cmdOpts.environment);
      
      if (snapshots.length === 0) {
        console.log(chalk.yellow('未抓取到任何快照'));
        return;
      }
      
      console.log(chalk.green(`✓ 成功抓取 ${snapshots.length} 个配置快照`));
      console.log('');
      
      for (const snapshot of snapshots) {
        console.log(`  [${snapshot.environment}] ${snapshot.sourceName}`);
        console.log(`    路径: ${snapshot.metadata.path}`);
        console.log(`    校验和: ${snapshot.metadata.checksum.slice(0, 16)}...`);
        console.log(`    大小: ${snapshot.metadata.size} bytes`);
        console.log('');
      }
      
      if (cmdOpts.output) {
        const { writeJsonFile } = require('./utils');
        writeJsonFile(cmdOpts.output, snapshots);
        console.log(chalk.green(`✓ 快照已保存到: ${cmdOpts.output}`));
      }
    } catch (error) {
      console.error(chalk.red(`快照抓取失败: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command('baseline')
  .description('基线管理')
  .addCommand(
    new Command('create')
      .description('创建新基线')
      .requiredOption('-e, --environment <env>', '环境名称')
      .requiredOption('-n, --name <name>', '基线名称')
      .option('-d, --description <desc>', '基线描述')
      .action(async (cmdOpts) => {
        try {
          const options = program.opts();
          const config = loadAppConfig(options.config);
          
          const baseline = await createBaselineFromConfig(
            config,
            cmdOpts.environment,
            cmdOpts.name,
            cmdOpts.description
          );
          
          saveBaseline(config.storagePath, baseline);
        } catch (error) {
          console.error(chalk.red(`创建基线失败: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('列出所有基线')
      .option('-e, --environment <env>', '按环境筛选')
      .action(async (cmdOpts) => {
        try {
          const options = program.opts();
          const config = loadAppConfig(options.config);
          
          const baselines = listBaselines(config.storagePath, cmdOpts.environment);
          printBaselineList(baselines);
        } catch (error) {
          console.error(chalk.red(`获取基线列表失败: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('show')
      .description('查看基线详情')
      .requiredOption('-i, --id <id>', '基线 ID')
      .action(async (cmdOpts) => {
        try {
          const options = program.opts();
          const config = loadAppConfig(options.config);
          
          const baseline = loadBaseline(config.storagePath, cmdOpts.id);
          
          console.log('');
          console.log(chalk.bold(`基线名称: ${baseline.name}`));
          console.log(`基线 ID: ${baseline.id}`);
          console.log(`环境: ${baseline.environment}`);
          console.log(`创建时间: ${dayjs(baseline.createdAt).format('YYYY-MM-DD HH:mm:ss')}`);
          if (baseline.description) {
            console.log(`描述: ${baseline.description}`);
          }
          console.log('');
          console.log(chalk.bold(`包含 ${Object.keys(baseline.snapshots).length} 个配置快照:`));
          console.log('');
          
          for (const [sourceId, snapshot] of Object.entries(baseline.snapshots)) {
            console.log(`  - ${snapshot.sourceName} (${sourceId.slice(0, 8)}...)`);
            console.log(`    路径: ${snapshot.metadata.path}`);
            console.log(`    校验和: ${snapshot.metadata.checksum.slice(0, 16)}...`);
            console.log('');
          }
          
          if (baseline.riskRules.length > 0) {
            console.log(chalk.bold(`风险规则 (${baseline.riskRules.length} 条):`));
            console.log('');
            for (const rule of baseline.riskRules) {
              console.log(`  - ${rule.pathPattern} -> ${rule.level}${rule.description ? ` (${rule.description})` : ''}`);
            }
            console.log('');
          }
        } catch (error) {
          console.error(chalk.red(`获取基线详情失败: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('delete')
      .description('删除基线')
      .requiredOption('-i, --id <id>', '基线 ID')
      .action(async (cmdOpts) => {
        try {
          const options = program.opts();
          const config = loadAppConfig(options.config);
          
          deleteBaseline(config.storagePath, cmdOpts.id);
        } catch (error) {
          console.error(chalk.red(`删除基线失败: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      })
  );

program
  .command('scan')
  .description('扫描配置漂移')
  .option('-e, --environment <env>', '指定环境，不指定则扫描所有环境')
  .option('-b, --baseline <id>', '指定基线 ID，不指定则使用最新基线')
  .option('-l, --level <level>', '最低显示风险等级: critical|high|medium|low|info', 'info')
  .option('-o, --output <path>', '输出报告到指定文件 (支持 .json 和 .md 格式)')
  .option('-f, --format <format>', '输出格式: json|md|console', 'console')
  .option('--fail-on <level>', '存在该等级及以上漂移时退出码为 1 (用于 CI)')
  .action(async (cmdOpts) => {
    try {
      const options = program.opts();
      const config = loadAppConfig(options.config);
      
      const environments = cmdOpts.environment
        ? [cmdOpts.environment]
        : config.environments;
      
      const environmentReports: EnvironmentReport[] = [];
      
      for (const environment of environments) {
        console.log(chalk.cyan(`\n正在扫描环境 [${environment}]...`));
        
        let baseline;
        if (cmdOpts.baseline) {
          baseline = loadBaseline(config.storagePath, cmdOpts.baseline);
        } else {
          baseline = getLatestBaseline(config.storagePath, environment);
        }
        
        if (!baseline) {
          console.log(chalk.yellow(`  未找到 [${environment}] 环境的基线，请先创建基线`));
          continue;
        }
        
        console.log(`  使用基线: ${baseline.name} (${baseline.id.slice(0, 8)}...)`);
        
        const snapshots = await captureSnapshots(config.sources, environment);
        
        if (snapshots.length === 0) {
          console.log(chalk.yellow(`  未抓取到任何快照，跳过该环境`));
          continue;
        }
        
        const report = generateEnvironmentReport(
          environment,
          baseline,
          snapshots,
          config.sources
        );
        
        environmentReports.push(report);
        
        const driftCount = report.drifts.length;
        if (driftCount === 0) {
          console.log(chalk.green(`  ✓ 无配置漂移`));
        } else {
          console.log(chalk.yellow(`  发现 ${driftCount} 个漂移项`));
        }
      }
      
      if (environmentReports.length === 0) {
        console.log(chalk.red('未生成任何环境报告'));
        process.exit(1);
      }
      
      const summaryReport = generateSummaryReport(environmentReports);
      
      const minLevel = (cmdOpts.level as RiskLevel) || 'info';
      
      if (cmdOpts.format === 'console' || !cmdOpts.output) {
        printConsoleReport(summaryReport, minLevel);
      }
      
      if (cmdOpts.output) {
        const outputLower = cmdOpts.output.toLowerCase();
        if (outputLower.endsWith('.json') || cmdOpts.format === 'json') {
          exportJsonReport(summaryReport, cmdOpts.output);
        } else if (outputLower.endsWith('.md') || cmdOpts.format === 'md') {
          exportMarkdownReport(summaryReport, cmdOpts.output);
        }
      }
      
      if (cmdOpts.failOn) {
        const failLevel = cmdOpts.failOn as RiskLevel;
        const levelOrder: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info'];
        const failIndex = levelOrder.indexOf(failLevel);
        
        const shouldFail = summaryReport.environmentReports.some(r =>
          r.drifts.some(d => levelOrder.indexOf(d.riskLevel) <= failIndex)
        );
        
        if (shouldFail) {
          console.log(chalk.red(`\n检测到 ${failLevel} 及以上风险的漂移，退出码: 1`));
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(chalk.red(`扫描失败: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command('sources')
  .description('列出配置源')
  .option('-e, --environment <env>', '按环境筛选')
  .action(async (cmdOpts) => {
    try {
      const options = program.opts();
      const config = loadAppConfig(options.config);
      
      let sources = config.sources;
      if (cmdOpts.environment) {
        sources = sources.filter(s => s.environment === cmdOpts.environment);
      }
      
      if (sources.length === 0) {
        console.log('暂无配置源');
        return;
      }
      
      console.log(`\n共 ${sources.length} 个配置源:\n`);
      console.log('ID          名称          类型    格式    环境        路径');
      console.log('----------  ------------  ------  ------  ----------  -----------------------');
      
      for (const s of sources) {
        const id = s.id.slice(0, 10).padEnd(10);
        const name = s.name.padEnd(12).slice(0, 12);
        const type = s.type.padEnd(6);
        const format = s.format.padEnd(6);
        const env = s.environment.padEnd(10).slice(0, 10);
        const path = s.path.length > 40 ? s.path.slice(0, 37) + '...' : s.path;
        
        console.log(`${id}  ${name}  ${type}  ${format}  ${env}  ${path}`);
      }
      console.log('');
    } catch (error) {
      console.error(chalk.red(`获取配置源失败: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red(`命令执行失败: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
