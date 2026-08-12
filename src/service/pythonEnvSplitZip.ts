import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';

const PART_BYTES = 5 * 1024 * 1024;

function splitTempRoot(): string {
  const leaf = ['ggnr', 'python', 'env', 'split'].join('_');
  return `${os.tmpdir()}${path.sep}${leaf}`;
}

export type PythonEnvPartFile = {
  absPath: string;
  relPath: string;
};

function partFileName(index: number): string {
  if (index === 0) return 'env.zip';
  const n = index;
  return n < 100 ? `env.z${String(n).padStart(2, '0')}` : `env.z${n}`;
}

async function zipPythonEnvDir(envDir: string, zipPath: string): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
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

/** python/env 폴더를 tmp에서 zip·5MiB 분할. 엔트리는 python/env_parts/ 만. 호출측에서 tmpDir 삭제 */
export async function createPythonEnvSplitParts(workspaceRoot: string): Promise<{
  parts: PythonEnvPartFile[];
  tmpDir: string;
} | null> {
  const envDir = pythonEnvDir(workspaceRoot);
  const exe = [envDir, 'python.exe'].join(path.sep);
  if (!fsSync.existsSync(exe)) return null;
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = `${splitTempRoot()}${path.sep}${stamp}`;
  await fs.mkdir(tmpDir, { recursive: true });
  const fullZip = [tmpDir, 'env_full.zip'].join(path.sep);
  const partsDir = [tmpDir, 'parts'].join(path.sep);
  await zipPythonEnvDir(envDir, fullZip);
  const parts = await splitZipFile(fullZip, partsDir);
  await fs.rm(fullZip, { force: true }).catch(() => {});
  return { parts, tmpDir };
}
