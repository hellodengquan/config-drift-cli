import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import { RiskLevel } from './types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateChecksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function getCurrentTimestamp(): string {
  return dayjs().toISOString();
}

export function formatTimestamp(isoString: string): string {
  return dayjs(isoString).format('YYYY-MM-DD HH:mm:ss');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readJsonFile<T = any>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function writeJsonFile(filePath: string, data: any, pretty = true): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, pretty ? 2 : 0), 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function getRiskLevelColor(level: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    critical: 'red',
    high: 'redBright',
    medium: 'yellow',
    low: 'blue',
    info: 'gray'
  };
  return colors[level];
}

export function getRiskLevelOrder(level: RiskLevel): number {
  const order: Record<RiskLevel, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4
  };
  return order[level];
}

export function sortByRiskLevel<T extends { riskLevel: RiskLevel }>(items: T[]): T[] {
  return [...items].sort((a, b) => getRiskLevelOrder(a.riskLevel) - getRiskLevelOrder(b.riskLevel));
}

export function pathMatchesPattern(pathStr: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^.]*');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(pathStr);
}

export function formatValue(value: any, maxLength = 60): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
}

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

export function getEnvVars(prefix?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!prefix || key.startsWith(prefix)) {
      result[key] = value || '';
    }
  }
  return result;
}
