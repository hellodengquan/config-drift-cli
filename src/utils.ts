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

export function deepSortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepSortObjectKeys(item));
  }

  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: Record<string, any> = {};

  for (const key of sortedKeys) {
    sortedObj[key] = deepSortObjectKeys(obj[key]);
  }

  return sortedObj;
}

export function normalizeLiteral(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true' || value === 'True' || value === 'TRUE' || value === 'yes' || value === 'Yes' || value === 'YES' || value === 'on' || value === 'On' || value === 'ON') {
      return true;
    }
    if (value === 'false' || value === 'False' || value === 'FALSE' || value === 'no' || value === 'No' || value === 'NO' || value === 'off' || value === 'Off' || value === 'OFF') {
      return false;
    }
    if (value === 'null' || value === 'Null' || value === 'NULL' || value === '~' || value === '') {
      return null;
    }

    if (/^-?\d+$/.test(value)) {
      const num = parseInt(value, 10);
      if (Number.isSafeInteger(num) && String(num) === value) {
        return num;
      }
    }

    if (/^-?\d+\.\d+$/.test(value)) {
      const num = parseFloat(value);
      if (Number.isFinite(num)) {
        return num;
      }
    }

    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
    }

    return value;
  }

  return value;
}

export function deepNormalizeLiterals(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepNormalizeLiterals(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = deepNormalizeLiterals(obj[key]);
    }
    return result;
  }

  return normalizeLiteral(obj);
}

export function getContentSignature(value: any): string {
  const normalized = deepNormalizeLiterals(value);
  const sorted = deepSortObjectKeys(normalized);
  const jsonStr = JSON.stringify(sorted);
  return generateChecksum(jsonStr);
}

export function normalizeArray(arr: any[]): any[] {
  return [...arr].sort((a, b) => {
    const sigA = getContentSignature(a);
    const sigB = getContentSignature(b);
    return sigA.localeCompare(sigB);
  });
}

export interface NormalizeOptions {
  sortKeys?: boolean;
  arrayOrderSensitive?: boolean;
  arrayOrderSensitivePaths?: string[];
  normalizeTypes?: boolean;
  currentPath?: string;
}

export function normalizeData(data: any, options: NormalizeOptions = {}): any {
  const {
    sortKeys = true,
    arrayOrderSensitive = false,
    arrayOrderSensitivePaths = [],
    normalizeTypes = true,
    currentPath = ''
  } = options;

  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data !== 'object') {
    if (normalizeTypes) {
      return normalizeLiteral(data);
    }
    return data;
  }

  if (Array.isArray(data)) {
    const isPathSensitive = arrayOrderSensitivePaths.some(pattern =>
      pathMatchesPattern(currentPath, pattern)
    );

    const shouldNormalizeArray = !arrayOrderSensitive && !isPathSensitive;

    const normalizedItems = data.map((item, index) =>
      normalizeData(item, {
        sortKeys,
        arrayOrderSensitive,
        arrayOrderSensitivePaths,
        normalizeTypes,
        currentPath: `${currentPath}.${index}`
      })
    );

    if (shouldNormalizeArray) {
      return normalizeArray(normalizedItems);
    }

    return normalizedItems;
  }

  const result: Record<string, any> = {};
  const keys = sortKeys ? Object.keys(data).sort() : Object.keys(data);

  for (const key of keys) {
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    result[key] = normalizeData(data[key], {
      sortKeys,
      arrayOrderSensitive,
      arrayOrderSensitivePaths,
      normalizeTypes,
      currentPath: newPath
    });
  }

  return result;
}

export function canonicalJson(obj: any): string {
  const normalized = deepNormalizeLiterals(obj);
  const sorted = deepSortObjectKeys(normalized);
  return JSON.stringify(sorted);
}

export function stripEnvComments(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const key = line.slice(0, eqIndex);
      let value = line.slice(eqIndex + 1);
      
      const commentMatch = value.match(/\s+#.*$/);
      if (commentMatch && commentMatch.index !== undefined) {
        const inQuotes = (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        );
        if (!inQuotes) {
          value = value.slice(0, commentMatch.index).trimEnd();
        }
      }
      result.push(`${key}=${value}`);
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

export function stripYamlComments(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    let processed = line;
    let inString = false;
    let stringChar = '';
    let commentIndex = -1;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && line[i - 1] !== '\\') {
        inString = false;
      }
      
      if (!inString && char === '#') {
        if (i === 0 || /\s/.test(line[i - 1])) {
          commentIndex = i;
          break;
        }
      }
    }
    
    if (commentIndex >= 0) {
      processed = line.slice(0, commentIndex).trimEnd();
    }
    
    if (processed.trim() !== '') {
      result.push(processed);
    }
  }
  return result.join('\n');
}

export function stripComments(content: string, format: 'env' | 'yaml' | 'json' | 'text'): string {
  switch (format) {
    case 'env':
      return stripEnvComments(content);
    case 'yaml':
      return stripYamlComments(content);
    case 'json':
      return content;
    case 'text':
      return content;
    default:
      return content;
  }
}

export function isVaultReference(value: any, patterns?: string[]): boolean {
  if (typeof value !== 'string') return false;
  if (patterns && patterns.length > 0) {
    return patterns.some(pattern => {
      if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length >= 2) {
        const regexPattern = pattern.slice(1, -1);
        try {
          const regex = new RegExp(regexPattern);
          return regex.test(value);
        } catch {
          return false;
        }
      }
      
      if (pattern.includes('*') || pattern.includes('{{') || pattern.includes('}}')) {
        const regex = new RegExp(
          pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\{\{/g, '\\{\\{')
            .replace(/\}\}/g, '\\}\\}')
        );
        return regex.test(value);
      }
      
      if (value.includes(pattern)) {
        return true;
      }
      
      const globRegex = new RegExp(
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
      );
      return globRegex.test(value);
    });
  }
  return /^\s*\{\{[\s\S]*\}\}\s*$/.test(value);
}

export function getVaultReferencePath(value: string, patterns?: string[]): string | null {
  const trimmed = value.trim();
  
  const vaultMatch = trimmed.match(/^\s*\{\{\s*(?:vault\s*:\s*)?([^}\s]+)\s*\}\}\s*$/i);
  if (vaultMatch) {
    return vaultMatch[1];
  }
  
  if (patterns && patterns.length > 0) {
    for (const pattern of patterns) {
      if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length >= 2) {
        const regexPattern = pattern.slice(1, -1);
        try {
          const regex = new RegExp(regexPattern);
          const match = trimmed.match(regex);
          if (match) {
            return match[1] || match[0];
          }
        } catch {
          continue;
        }
      }
    }
  }
  
  const genericMatch = trimmed.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (genericMatch) {
    const content = genericMatch[1].trim();
    const colonIndex = content.indexOf(':');
    return colonIndex > 0 ? content.slice(colonIndex + 1).trim() : content;
  }
  
  return null;
}

export function normalizeVaultReferences(obj: any, patterns?: string[]): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    if (isVaultReference(obj, patterns)) {
      const refPath = getVaultReferencePath(obj, patterns);
      if (refPath) {
        return `{{vault:${refPath}}}`;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => normalizeVaultReferences(item, patterns));
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = normalizeVaultReferences(obj[key], patterns);
    }
    return result;
  }

  return obj;
}

export function isExpectedPerEnvPath(
  path: string,
  expectedPaths?: { pathPattern: string; description?: string; allowedEnvironments?: string[] }[]
): boolean {
  if (!expectedPaths || expectedPaths.length === 0) return false;
  return expectedPaths.some(ep => pathMatchesPattern(path, ep.pathPattern));
}
