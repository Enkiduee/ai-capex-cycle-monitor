import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const DATA_DIR = path.join(ROOT_DIR, 'data');

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function readJson(relativePath) {
  const filePath = path.resolve(ROOT_DIR, relativePath);
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonIfChanged(relativePath, value, options = {}) {
  const filePath = path.resolve(ROOT_DIR, relativePath);
  const next = serializeJson(value);
  let current = '';
  try {
    current = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (current === next) return false;
  if (options.dryRun) return true;

  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, next, 'utf8');
  await rename(temporaryPath, filePath);
  return true;
}

export function now() {
  const value = process.env.REFRESH_NOW;
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`REFRESH_NOW 不是有效时间：${value}`);
  }
  return parsed;
}

export function isoNow() {
  return now().toISOString();
}

export function dateOnly(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function mean(values) {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

export function standardDeviation(values) {
  const numeric = values.filter(Number.isFinite);
  if (numeric.length < 2) return null;
  const average = mean(numeric);
  const variance = numeric.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (numeric.length - 1);
  return Math.sqrt(variance);
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = response && response.headers ? response.headers.get('retry-after') : '';
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return Math.min(8000, 600 * (2 ** attempt));
}

export async function fetchJson(url, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 3;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
  const headers = {
    Accept: 'application/json',
    ...options.headers
  };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) return await response.json();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
      }
    } catch (error) {
      if (attempt >= retries) throw error;
      console.warn(`[refresh] 请求失败，准备重试 ${attempt + 1}/${retries}: ${url} (${error.message})`);
      await sleep(retryDelay(response, attempt));
      continue;
    }

    if (attempt >= retries) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
    }
    await sleep(retryDelay(response, attempt));
  }

  throw new Error(`请求失败：${url}`);
}

export async function setActionOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const normalized = String(value).replaceAll('\n', '%0A').replaceAll('\r', '%0D');
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${normalized}\n`, 'utf8');
}

export function rowsFromColumnar(columnar) {
  if (!columnar || !Array.isArray(columnar.accessionNumber)) return [];
  return columnar.accessionNumber.map((_, index) => Object.fromEntries(
    Object.entries(columnar).map(([key, values]) => [key, Array.isArray(values) ? values[index] : undefined])
  ));
}

export function normalizeForm(form) {
  return String(form || '').trim().toUpperCase().replace(/\/A$/, '');
}
