/**
 * 네이티브 ZIP 해제(Expand-Archive/unzip)와 병행해
 * 비압축 총량 대비 목적지 용량으로 근사 진행률을 보고한다.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXTRACT_PULSE_MS = 5_000;
const DIR_SIZE_BUDGET_MS = 2_000;

export function formatExtractBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0MB';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

export type ExtractProgressPulse = {
  bytesDone: number;
  totalBytes: number | null;
  elapsedSec: number;
  pct: number | null;
  message: string;
};

/** ZIP EOCD에서 비압축 합(표준 ZIP). ZIP64·실패 시 null */
async function readZipUncompressedBytesFromCd(zipPath: string): Promise<number | null> {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(zipPath, 'r');
    const { size } = await fh.stat();
    if (size < 22) return null;
    const tailLen = Math.min(65_557, size);
    const buf = Buffer.alloc(tailLen);
    await fh.read(buf, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const totalEntries = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return null; // ZIP64
    }
    if (cdSize === 0 || cdOffset + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    let sum = 0;
    let off = 0;
    let counted = 0;
    while (off + 46 <= cd.length && counted < totalEntries) {
      if (cd.readUInt32LE(off) !== 0x02014b50) break;
      const uncompressed = cd.readUInt32LE(off + 20);
      const nameLen = cd.readUInt16LE(off + 28);
      const extraLen = cd.readUInt16LE(off + 30);
      const commentLen = cd.readUInt16LE(off + 32);
      sum += uncompressed;
      counted += 1;
      off += 46 + nameLen + extraLen + commentLen;
    }
    return counted > 0 ? sum : null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

function spawnCapture(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', () => undefined);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function readZipUncompressedBytesWin32(zipPath: string): Promise<number | null> {
  const literal = zipPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z = [System.IO.Compression.ZipFile]::OpenRead('${literal}')`,
    'try { [int64](($z.Entries | Measure-Object -Property Length -Sum).Sum) } finally { $z.Dispose() }',
  ].join('; ');
  try {
    const { code, stdout } = await spawnCapture('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    if (code !== 0) return null;
    const n = Number(stdout.trim().split(/\r?\n/).pop());
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

async function readZipUncompressedBytesUnzipL(zipPath: string): Promise<number | null> {
  try {
    const { code, stdout } = await spawnCapture('unzip', ['-l', zipPath]);
    if (code !== 0) return null;
    const lines = stdout.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i]!.match(/^\s*(\d+)\s+\d+\s+files?\s*$/i);
      if (m) {
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
      }
      const m2 = lines[i]!.match(/^\s*--------\s+(\d+)\s+/);
      if (m2) {
        const n = Number(m2[1]);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** ZIP 엔트리 비압축 크기 합. 실패 시 null(경과 초 폴백) */
export async function getZipUncompressedBytes(zipPath: string): Promise<number | null> {
  const fromCd = await readZipUncompressedBytesFromCd(zipPath);
  if (fromCd != null && fromCd > 0) return fromCd;
  if (process.platform === 'win32') {
    const fromPs = await readZipUncompressedBytesWin32(zipPath);
    if (fromPs != null) return fromPs;
  } else {
    const fromUnzip = await readZipUncompressedBytesUnzipL(zipPath);
    if (fromUnzip != null) return fromUnzip;
  }
  return null;
}

/** 디렉터리 용량 합. deadline 초과 시 지금까지 합(또는 null) */
export async function getDirTotalBytes(
  dir: string,
  opts?: { deadlineMs?: number }
): Promise<number | null> {
  const deadline = Date.now() + (opts?.deadlineMs ?? DIR_SIZE_BUDGET_MS);
  let sum = 0;
  let timedOut = false;

  async function walk(abs: string): Promise<void> {
    if (timedOut || Date.now() > deadline) {
      timedOut = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (timedOut || Date.now() > deadline) {
        timedOut = true;
        return;
      }
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = await fs.stat(child);
        sum += st.size;
      } catch {
        /* ignore racing extract */
      }
    }
  }

  try {
    await fs.access(dir);
  } catch {
    return 0;
  }
  await walk(dir);
  return sum;
}

function buildPulseMessage(
  bytesDone: number,
  totalBytes: number | null,
  elapsedSec: number
): { pct: number | null; message: string } {
  if (totalBytes != null && totalBytes > 0) {
    const pct = Math.min(99, Math.max(0, Math.round((bytesDone / totalBytes) * 100)));
    return {
      pct,
      message: `ZIP 압축 해제 중... ${formatExtractBytes(bytesDone)}/${formatExtractBytes(totalBytes)} (${pct}%)`,
    };
  }
  return {
    pct: null,
    message: `ZIP 압축 해제 중... (${elapsedSec}초 경과)`,
  };
}

/**
 * extract() 실행 동안 주기적으로 목적지 용량을 폴링해 onPulse 호출.
 * 유휴 프록시 끊김 방지 + 근사 진행률.
 */
export async function withNativeExtractProgress(params: {
  zipPath: string;
  extractDir: string;
  extract: () => Promise<void>;
  onPulse: (pulse: ExtractProgressPulse) => void | Promise<void>;
  intervalMs?: number;
}): Promise<void> {
  const intervalMs = params.intervalMs ?? EXTRACT_PULSE_MS;
  const totalBytes = await getZipUncompressedBytes(params.zipPath);
  let bytesDone = 0;
  let elapsedSec = 0;
  let pulseBusy = false;
  const startedAt = Date.now();

  const pulse = async () => {
    if (pulseBusy) return;
    pulseBusy = true;
    try {
      elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      const measured = await getDirTotalBytes(params.extractDir, {
        deadlineMs: DIR_SIZE_BUDGET_MS,
      });
      if (measured != null) {
        bytesDone = measured;
      }
      const { pct, message } = buildPulseMessage(bytesDone, totalBytes, elapsedSec);
      await params.onPulse({
        bytesDone,
        totalBytes,
        elapsedSec,
        pct,
        message,
      });
    } finally {
      pulseBusy = false;
    }
  };

  await pulse();
  const timer = setInterval(() => {
    void pulse();
  }, intervalMs);
  try {
    await params.extract();
  } finally {
    clearInterval(timer);
  }
}
