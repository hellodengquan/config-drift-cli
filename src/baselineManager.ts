import * as path from 'path';
import { Baseline, ConfigSnapshot, RiskRule, AppConfig } from './types';
import {
  generateId,
  getCurrentTimestamp,
  ensureDir,
  readJsonFile,
  writeJsonFile,
  fileExists,
  formatTimestamp
} from './utils';

function getBaselinesDir(storagePath: string): string {
  return path.join(storagePath, 'baselines');
}

function getBaselinePath(storagePath: string, baselineId: string): string {
  return path.join(getBaselinesDir(storagePath), `${baselineId}.json`);
}

function getIndexPath(storagePath: string): string {
  return path.join(getBaselinesDir(storagePath), 'index.json');
}

interface BaselineIndexEntry {
  id: string;
  name: string;
  environment: string;
  createdAt: string;
  snapshotCount: number;
}

interface BaselineIndex {
  baselines: BaselineIndexEntry[];
}

function loadIndex(storagePath: string): BaselineIndex {
  const indexPath = getIndexPath(storagePath);
  if (!fileExists(indexPath)) {
    return { baselines: [] };
  }
  return readJsonFile<BaselineIndex>(indexPath);
}

function saveIndex(storagePath: string, index: BaselineIndex): void {
  writeJsonFile(getIndexPath(storagePath), index);
}

function addToIndex(storagePath: string, baseline: Baseline): void {
  const index = loadIndex(storagePath);
  const entry: BaselineIndexEntry = {
    id: baseline.id,
    name: baseline.name,
    environment: baseline.environment,
    createdAt: baseline.createdAt,
    snapshotCount: Object.keys(baseline.snapshots).length
  };
  
  const existingIndex = index.baselines.findIndex(b => b.id === baseline.id);
  if (existingIndex >= 0) {
    index.baselines[existingIndex] = entry;
  } else {
    index.baselines.unshift(entry);
  }
  
  saveIndex(storagePath, index);
}

function removeFromIndex(storagePath: string, baselineId: string): void {
  const index = loadIndex(storagePath);
  index.baselines = index.baselines.filter(b => b.id !== baselineId);
  saveIndex(storagePath, index);
}

export function createBaseline(
  name: string,
  environment: string,
  snapshots: ConfigSnapshot[],
  riskRules: RiskRule[],
  description?: string
): Baseline {
  const snapshotMap: Record<string, ConfigSnapshot> = {};
  for (const snapshot of snapshots) {
    snapshotMap[snapshot.sourceId] = snapshot;
  }

  return {
    id: generateId(),
    name,
    description,
    createdAt: getCurrentTimestamp(),
    environment,
    snapshots: snapshotMap,
    riskRules
  };
}

export function saveBaseline(storagePath: string, baseline: Baseline): void {
  ensureDir(getBaselinesDir(storagePath));
  
  const baselinePath = getBaselinePath(storagePath, baseline.id);
  writeJsonFile(baselinePath, baseline);
  
  addToIndex(storagePath, baseline);
  
  console.log(`基线已保存: ${baseline.name} (${baseline.id})`);
  console.log(`  环境: ${baseline.environment}`);
  console.log(`  快照数量: ${Object.keys(baseline.snapshots).length}`);
}

export function loadBaseline(storagePath: string, baselineId: string): Baseline {
  const baselinePath = getBaselinePath(storagePath, baselineId);
  
  if (!fileExists(baselinePath)) {
    throw new Error(`基线不存在: ${baselineId}`);
  }
  
  return readJsonFile<Baseline>(baselinePath);
}

export function listBaselines(storagePath: string, environment?: string): BaselineIndexEntry[] {
  const index = loadIndex(storagePath);
  
  if (environment) {
    return index.baselines.filter(b => b.environment === environment);
  }
  
  return index.baselines;
}

export function getLatestBaseline(storagePath: string, environment: string): Baseline | null {
  const index = loadIndex(storagePath);
  const environmentBaselines = index.baselines.filter(b => b.environment === environment);
  
  if (environmentBaselines.length === 0) {
    return null;
  }
  
  const latest = environmentBaselines.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  
  return loadBaseline(storagePath, latest.id);
}

export function deleteBaseline(storagePath: string, baselineId: string): boolean {
  const baselinePath = getBaselinePath(storagePath, baselineId);
  
  if (!fileExists(baselinePath)) {
    console.warn(`基线不存在: ${baselineId}`);
    return false;
  }
  
  const fs = require('fs');
  fs.unlinkSync(baselinePath);
  removeFromIndex(storagePath, baselineId);
  
  console.log(`基线已删除: ${baselineId}`);
  return true;
}

export function printBaselineList(baselines: BaselineIndexEntry[]): void {
  if (baselines.length === 0) {
    console.log('暂无基线数据');
    return;
  }

  console.log(`\n共找到 ${baselines.length} 条基线:\n`);
  console.log('ID                                    名称          环境        创建时间              快照数');
  console.log('------------------------------------  ------------  ----------  -------------------  --------');

  for (const b of baselines) {
    const id = b.id.slice(0, 36);
    const name = b.name.padEnd(12).slice(0, 12);
    const env = b.environment.padEnd(10).slice(0, 10);
    const time = formatTimestamp(b.createdAt);
    const count = String(b.snapshotCount).padStart(8);
    
    console.log(`${id}  ${name}  ${env}  ${time}  ${count}`);
  }
  console.log('');
}

export async function createBaselineFromConfig(
  config: AppConfig,
  environment: string,
  name: string,
  description?: string
): Promise<Baseline> {
  const { captureSnapshots } = require('./configLoader');
  
  console.log(`正在抓取 [${environment}] 环境的配置快照...`);
  const snapshots = await captureSnapshots(config.sources, environment);
  
  if (snapshots.length === 0) {
    throw new Error(`没有获取到任何配置快照，请检查配置源`);
  }
  
  console.log(`成功抓取 ${snapshots.length} 个配置快照`);
  
  const baseline = createBaseline(
    name,
    environment,
    snapshots,
    config.defaultRiskRules,
    description
  );
  
  return baseline;
}
