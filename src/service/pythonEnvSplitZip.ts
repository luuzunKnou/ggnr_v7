import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';

const PART_BYTES = 5 * 1024 * 1024;
const ZIP_LEVEL = 1;
/** 분할 크기·압축 단계 바꾸면 올려서 캐시 무효 */
const CACHE_FORMAT = '1';

function splitTempRoot(): string {
  const leaf = ['ggnr', 'python', 'env', 'split'].join('_');
  return [process.cwd(), '.tmp', leaf].join(path.sep);
}

function cacheRoot(workspaceRoot: string): string {
  const leaf = ['ggnr', 'python', 'env', 'parts', 'cache'].join('_');
  return [workspaceRoot, '.tmp', leaf].join(path.sep);
}

function fingerprintFile(cacheDir: string): string {
  return [cacheDir, 'fingerprint'].join(path.sep);
}

function cachePartsDir(cacheDir: string): string {
  return [cacheDir, 'parts'].join(path.sep);
}

export type PythonEnvPartFile = {
  absPath: string;
  relPath: string;
};

export type PythonEnvSplitStatus = 'cache-hit' | 'rebuild';

function partFileName(index: number): string {
  if (index === 0) return 'env.zip';
  const n = index;
  return n < 100 ? `env.z${String(n).padStart(2, '0')}` : `env.z${n}`;
}

function partIndexFromName(name: string): number {
  if (name === 'env.zip') return 0;
  const m = /^env\.z(\d+)$/i.exec(name);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function skipFingerprintRel(relPosix: string): boolean {
  const segs = relPosix.split('/');
  if (segs.includes('__pycache__')) return true;
  const base = segs[segs.length - 1] ?? '';
  return base.endsWith('.pyc') || base.endsWith('.pyo');
}

async function collectFingerprintLines(envDir: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(absDir: string, relPosix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRel = relPosix ? `${relPosix}/${entry.name}` : entry.name;
      if (skipFingerprintRel(childRel)) continue;
      const childAbs = [absDir, entry.name].join(path.sep);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(childAbs);
      lines.push(`${childRel}\t${st.size}\t${Math.floor(st.mtimeMs / 1000)}`);
    }
  }
  await walk(envDir, '');
  return lines;
}

async function envFingerprint(envDir: string): Promise<string> {
  const lines = await collectFingerprintLines(envDir);
  const h = crypto.createHash('sha256');
  h.update(`format=${CACHE_FORMAT}\n`);
  h.update(`partBytes=${PART_BYTES}\n`);
  h.update(`zipLevel=${ZIP_LEVEL}\n`);
  h.update(lines.join('\n'));
  return h.digest('hex');
}

async function listCachedParts(partsDir: string): Promise<PythonEnvPartFile[] | null> {
  let names: string[];
  try {
    names = await fs.readdir(partsDir);
  } catch {
    return null;
  }
  const partNames = names.filter((n) => n === 'env.zip' || /^env\.z\d+$/i.test(n));
  if (!partNames.includes('env.zip')) return null;
  partNames.sort((a, b) => partIndexFromName(a) - partIndexFromName(b));
  const parts: PythonEnvPartFile[] = [];
  for (const name of partNames) {
    const absPath = [partsDir, name].join(path.sep);
    const st = await fs.stat(absPath).catch(() => null);
    if (!st || !st.isFile() || st.size <= 0) return null;
    parts.push({ absPath, relPath: `python/env_parts/${name}` });
  }
  return parts.length > 0 ? parts : null;
}

async function readValidCache(cacheDir: string, fingerprint: string): Promise<PythonEnvPartFile[] | null> {
  const saved = await fs.readFile(fingerprintFile(cacheDir), 'utf8').catch(() => '');
  if (saved.trim() !== fingerprint) return null;
  return listCachedParts(cachePartsDir(cacheDir));
}

async function zipPythonEnvDir(envDir: string, zipPath: string): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: ZIP_LEVEL } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(envDir, false);
    archive.finalize().catch(reject);
  });
}

async function splitZipFile(zipPath: string, partsDir: string): Promise<PythonEnvPartFile[]> {
  await fs.mkdir(partsDir, { recursive: true });
  const fh = await fs.open(zipPath, 'r');
  const parts: PythonEnvPartFile[] = [];
  try {
    const stat = await fh.stat();
    let offset = 0;
    let index = 0;
    const buf = Buffer.alloc(PART_BYTES);
    while (offset < stat.size) {
      const toRead = Math.min(PART_BYTES, stat.size - offset);
      const { bytesRead } = await fh.read(buf, 0, toRead, offset);
      if (bytesRead <= 0) break;
      const name = partFileName(index);
      const absPath = path.join(partsDir, name);
      await fs.writeFile(absPath, buf.subarray(0, bytesRead));
      parts.push({ absPath, relPath: `python/env_parts/${name}` });
      offset += bytesRead;
      index += 1;
    }
  } finally {
    await fh.close();
  }
  if (parts.length === 0) throw new Error('python/env 분할 결과가 비어 있습니다');
  return parts;
}

/** cwd/python/env — 정적 경로 추적 회피 (python/env.zip 로 오인되지 않게) */
function pythonEnvDir(workspaceRoot: string): string {
  return [workspaceRoot, 'python', 'env'].join(path.sep);
}

/** python/env 폴더를 zip·5MiB 분할. 지문이 같으면 .tmp 캐시 재사용. 캐시 적중 시 tmpDir 없음 */
export async function createPythonEnvSplitParts(
  workspaceRoot: string,
  options?: { onStatus?: (status: PythonEnvSplitStatus) => void }
): Promise<{
  parts: PythonEnvPartFile[];
  tmpDir: string | null;
  fromCache: boolean;
} | null> {
  const envDir = pythonEnvDir(workspaceRoot);
  const exe = [envDir, 'python.exe'].join(path.sep);
  if (!fsSync.existsSync(exe)) return null;

  const fingerprint = await envFingerprint(envDir);
  const cacheDir = cacheRoot(workspaceRoot);
  const cached = await readValidCache(cacheDir, fingerprint);
  if (cached) {
    options?.onStatus?.('cache-hit');
    return { parts: cached, tmpDir: null, fromCache: true };
  }

  options?.onStatus?.('rebuild');
  const staging = `${cacheDir}_staging`;
  await fs.rm(staging, { recursive: true, force: true });
  try {
    await fs.mkdir(staging, { recursive: true });
    const fullZip = [staging, 'env_full.zip'].join(path.sep);
    const partsDir = [staging, 'parts'].join(path.sep);
    await zipPythonEnvDir(envDir, fullZip);
    const stagedParts = await splitZipFile(fullZip, partsDir);
    await fs.rm(fullZip, { force: true }).catch(() => {});
    await fs.writeFile(fingerprintFile(staging), fingerprint, 'utf8');
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
      await fs.rename(staging, cacheDir);
    } catch {
      return { parts: stagedParts, tmpDir: staging, fromCache: false };
    }
    const promoted = await listCachedParts(cachePartsDir(cacheDir));
    if (!promoted) throw new Error('python/env 분할 캐시 저장 후 분할본이 없습니다');
    return { parts: promoted, tmpDir: null, fromCache: false };
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** 설치 ZIP 임시 분할 폴더(캐시 아님). 이전 잔여 정리용 */
export function pythonEnvSplitTempRoot(): string {
  return splitTempRoot();
}
