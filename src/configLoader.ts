import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import axios from 'axios';
import { execSync } from 'child_process';
import { AppConfig, ConfigSource, ConfigFormat, ConfigSnapshot } from './types';
import {
  generateId,
  generateChecksum,
  getCurrentTimestamp,
  ensureDir,
  readJsonFile,
  writeJsonFile,
  fileExists,
  parseEnvContent,
  getEnvVars,
  stripComments,
  normalizeVaultReferences
} from './utils';

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'cdrift.config.json');
const DEFAULT_STORAGE_PATH = path.join(process.cwd(), '.cdrift');

export function loadAppConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath || DEFAULT_CONFIG_PATH;
  
  if (!fileExists(resolvedPath)) {
    throw new Error(`配置文件不存在: ${resolvedPath}`);
  }

  const config = readJsonFile<AppConfig>(resolvedPath);
  config.storagePath = config.storagePath || DEFAULT_STORAGE_PATH;
  ensureDir(config.storagePath);
  
  return config;
}

export function getDefaultConfig(): AppConfig {
  return {
    storagePath: DEFAULT_STORAGE_PATH,
    sources: [],
    defaultRiskRules: [
      { pathPattern: 'database.**', level: 'critical', description: '数据库配置变更' },
      { pathPattern: 'redis.**', level: 'high', description: 'Redis 配置变更' },
      { pathPattern: 'security.**', level: 'critical', description: '安全配置变更' },
      { pathPattern: 'auth.**', level: 'high', description: '认证配置变更' },
      { pathPattern: 'feature.*', level: 'medium', description: '功能开关变更' },
      { pathPattern: 'logging.**', level: 'low', description: '日志配置变更' },
      { pathPattern: 'ui.**', level: 'info', description: 'UI 配置变更' }
    ],
    environments: ['production', 'staging', 'development']
  };
}

export function initConfig(configPath?: string): void {
  const resolvedPath = configPath || DEFAULT_CONFIG_PATH;
  
  if (fileExists(resolvedPath)) {
    console.log(`配置文件已存在: ${resolvedPath}`);
    return;
  }

  const defaultConfig = getDefaultConfig();
  writeJsonFile(resolvedPath, defaultConfig);
  console.log(`已创建默认配置文件: ${resolvedPath}`);
}

async function fetchFromHttp(source: ConfigSource): Promise<string> {
  try {
    const response = await axios.get(source.path, {
      timeout: 10000,
      headers: {
        'Accept': source.format === 'json' ? 'application/json' : 
                source.format === 'yaml' ? 'application/x-yaml' : '*/*'
      }
    });
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  } catch (error) {
    throw new Error(`HTTP 请求失败 (${source.path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fetchFromFile(source: ConfigSource): string {
  if (!fileExists(source.path)) {
    throw new Error(`文件不存在: ${source.path}`);
  }
  return fs.readFileSync(source.path, 'utf-8');
}

function fetchFromEnv(source: ConfigSource): string {
  const prefix = source.path && source.path !== 'ALL' ? source.path : undefined;
  const vars = getEnvVars(prefix);
  return JSON.stringify(vars, null, 2);
}

function fetchFromCommand(source: ConfigSource): string {
  try {
    const output = execSync(source.path, {
      encoding: 'utf-8',
      timeout: 10000,
      env: process.env
    });
    return output;
  } catch (error) {
    throw new Error(`命令执行失败 (${source.path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseConfigContent(content: string, format: ConfigFormat): Record<string, any> {
  switch (format) {
    case 'json':
      try {
        return JSON.parse(content);
      } catch (error) {
        throw new Error(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    case 'yaml':
      try {
        const data = yaml.load(content);
        return (data || {}) as Record<string, any>;
      } catch (error) {
        throw new Error(`YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    case 'env':
      return parseEnvContent(content);
    case 'text':
      return { content };
    default:
      return { content };
  }
}

export async function fetchSource(source: ConfigSource): Promise<string> {
  switch (source.type) {
    case 'file':
      return fetchFromFile(source);
    case 'http':
      return await fetchFromHttp(source);
    case 'env':
      return fetchFromEnv(source);
    case 'command':
      return fetchFromCommand(source);
    default:
      throw new Error(`不支持的源类型: ${source.type}`);
  }
}

export async function captureSnapshot(source: ConfigSource): Promise<ConfigSnapshot> {
  let rawContent = await fetchSource(source);
  
  const stripCommentsEnabled = source.stripComments !== false;
  if (stripCommentsEnabled) {
    rawContent = stripComments(rawContent, source.format);
  }
  
  const data = parseConfigContent(rawContent, source.format);
  
  const normalizedData = source.vaultRefPatterns && source.vaultRefPatterns.length > 0
    ? normalizeVaultReferences(data, source.vaultRefPatterns)
    : data;
  
  const snapshot: ConfigSnapshot = {
    id: generateId(),
    sourceId: source.id,
    sourceName: source.name,
    environment: source.environment,
    timestamp: getCurrentTimestamp(),
    format: source.format,
    data: normalizedData,
    rawContent,
    metadata: {
      path: source.path,
      checksum: generateChecksum(rawContent),
      size: Buffer.byteLength(rawContent, 'utf-8')
    }
  };

  return snapshot;
}

export async function captureSnapshots(
  sources: ConfigSource[],
  environment?: string
): Promise<ConfigSnapshot[]> {
  const filteredSources = environment
    ? sources.filter(s => s.environment === environment)
    : sources;

  const snapshots: ConfigSnapshot[] = [];
  const errors: Array<{ source: ConfigSource; error: string }> = [];

  for (const source of filteredSources) {
    try {
      const snapshot = await captureSnapshot(source);
      snapshots.push(snapshot);
    } catch (error) {
      errors.push({
        source,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (errors.length > 0) {
    console.warn(`\n以下配置源抓取失败:`);
    for (const err of errors) {
      console.warn(`  - [${err.source.environment}] ${err.source.name}: ${err.error}`);
    }
  }

  return snapshots;
}
