import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { pool } from '@/database/db';

export type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function yyyymmdd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `ggnr_integration:${key}`;
  const { rows } = await pool.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [lockKey]);
  if (!rows?.[0]?.ok) throw new Error(`Integration lock busy: ${key}`);
  try {
    return await fn();
  } finally {
    await pool.query('select pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retry: RetryOptions = { retries: 3, baseDelayMs: 500, maxDelayMs: 10_000 }
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry.retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      // retry on 5xx
      if (res.status >= 500 && res.status <= 599) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res; // 4xx etc: don't retry
      }
    } catch (e) {
      lastErr = e;
    }
    const delay = clamp(retry.baseDelayMs * 2 ** attempt, retry.baseDelayMs, retry.maxDelayMs);
    await sleep(delay);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class BinaryStreamReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = new Uint8Array(0);
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async readMaybe(n: number): Promise<Uint8Array | null> {
    if (n <= 0) return new Uint8Array(0);
    while (this.buf.length < n && !this.done) {
      const { value, done } = await this.reader.read();
      if (done || !value) {
        this.done = true;
        break;
      }
      const next = new Uint8Array(this.buf.length + value.length);
      next.set(this.buf, 0);
      next.set(value, this.buf.length);
      this.buf = next;
    }
    if (this.buf.length === 0 && this.done) return null;
    if (this.buf.length < n) return null;
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  async readExactly(n: number): Promise<Uint8Array> {
    const v = await this.readMaybe(n);
    if (!v || v.length !== n) throw new Error(`Unexpected EOF while reading ${n} bytes`);
    return v;
  }

  async readAscii(n: number): Promise<string> {
    const b = await this.readExactly(n);
    return Buffer.from(b).toString('ascii');
  }
}

export async function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; logPrefix?: string } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
    });
    let stderr = '';
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      process.stderr.write(s);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${opts.logPrefix ? `[${opts.logPrefix}] ` : ''}${command} exited with ${code}\n${stderr}`));
    });
  });
}

/**
 * ogr2ogr/ogrinfo를 conda env에서 직접 호출할 때 필요한 환경변수.
 * shpUploadService와 동일 — `conda run`은 hang·지연이 있어 실행 파일 직접 호출.
 */
export function buildGdalEnv(envDir: string): NodeJS.ProcessEnv {
  const isWin = process.platform === 'win32';
  const shareDir = isWin ? path.join(envDir, 'Library', 'share') : path.join(envDir, 'share');
  const binDir = isWin ? path.join(envDir, 'Library', 'bin') : path.join(envDir, 'bin');
  const pluginDir = isWin ? path.join(envDir, 'Library', 'lib', 'gdalplugins') : path.join(envDir, 'lib', 'gdalplugins');
  const pathKey = isWin ? 'Path' : 'PATH';
  const existingPath = process.env[pathKey] ?? process.env.PATH ?? '';
  return {
    ...process.env,
    GDAL_DATA: path.join(shareDir, 'gdal'),
    GDAL_DRIVER_PATH: pluginDir,
    PROJ_DATA: path.join(shareDir, 'proj'),
    PROJ_LIB: path.join(shareDir, 'proj'),
    [pathKey]: `${binDir}${path.delimiter}${existingPath}`,
  };
}

/**
 * ogr2ogr 실행 방식(기존 SHP 업로드 로직과 동일):
 * - GGNR_GDAL_OGR2OGR: ogr2ogr(.exe) 직접 경로
 * - GGNR_PIPELINE_PYTHON: 프로젝트 python/env 내 ogr2ogr 직접 호출 + buildGdalEnv
 * - 그 외: PATH의 ogr2ogr
 */
export function resolveOgr2ogrRun(): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const fsSync = require('node:fs') as typeof import('node:fs');
  const root = process.cwd();
  if (process.env.GGNR_GDAL_OGR2OGR) {
    const custom = path.resolve(root, process.env.GGNR_GDAL_OGR2OGR);
    const bin = fsSync.existsSync(custom) ? custom : process.env.GGNR_GDAL_OGR2OGR;
    return { cmd: bin, args: [] };
  }
  const pyEnv = process.env.GGNR_PIPELINE_PYTHON;
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    const isWin = process.platform === 'win32';
    const candidate = isWin ? path.join(envDir, 'Library', 'bin', 'ogr2ogr.exe') : path.join(envDir, 'bin', 'ogr2ogr');
    if (fsSync.existsSync(candidate)) {
      return { cmd: candidate, args: [], env: buildGdalEnv(envDir) };
    }
  }
  return { cmd: 'ogr2ogr', args: [] };
}

export async function extractZip(zipPath: string, outDir: string): Promise<void> {
  await ensureDir(outDir);
  // Prefer tar (bsdtar) if available; fallback to PowerShell Expand-Archive.
  try {
    await runCommand('tar', ['-xf', zipPath, '-C', outDir], { logPrefix: 'extractZip:tar' });
    return;
  } catch {
    // ignore
  }
  await runCommand(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${outDir}"`],
    { logPrefix: 'extractZip:powershell' }
  );
}

export function findTokenInFilename(filename: string, prefix: string): string | null {
  const lower = filename.toLowerCase();
  const idx = lower.indexOf(prefix.toLowerCase());
  if (idx < 0) return null;
  const tail = lower.slice(idx);
  const m = tail.match(/^[a-z0-9_]+/);
  return m?.[0] ?? null;
}

export async function geoserverFetch(
  pathSeg: string,
  options: { method?: string; body?: string; contentType?: string; accept?: string } = {}
): Promise<Response> {
  const baseUrl = (process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver').replace(/\/$/, '');
  const user = process.env.GEOSERVER_USER ?? 'admin';
  const pass = process.env.GEOSERVER_PASSWORD ?? 'geoserver';
  const auth = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');

  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
    Authorization: `Basic ${auth}`,
  };
  if (options.body !== undefined) headers['Content-Type'] = options.contentType ?? 'application/json';

  return fetch(`${baseUrl}${pathSeg}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });
}

