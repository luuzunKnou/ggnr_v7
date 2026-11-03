/**
 * 서버 전용: DWG → DXF (QCAD Professional `dwg2dwg.bat`)
 * 도로대장 CAD 미리보기와 같이 `QCAD_modules` / `GGNR_QCAD_HOME` 을 찾는다.
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getQcadModulesDirs } from '@/lib/roadDocServerPaths';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';

const SPAWN_MS = 240_000;
const POST_EXIT_WAIT_MS = 60_000;
const POST_EXIT_POLL_MS = 250;

function workDir(): string {
  return path.join(process.cwd(), '.cad-preview-work');
}

function resolveDwg2DwgBat(): string | null {
  for (const root of getQcadModulesDirs()) {
    for (const rel of [
      'dwg2dwg.bat',
      path.join('bin', 'dwg2dwg.bat'),
      'dwg2dxf.bat',
      path.join('bin', 'dwg2dxf.bat'),
    ]) {
      const batPath = path.join(root, rel);
      try {
        if (existsSync(batPath)) {
          console.log(`[dwgToDxf] converter: ${batPath}`);
          return batPath;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

async function waitForFile(filePath: string, maxMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return existsSync(filePath);
}

export type DwgToDxfResult = { ok: true; dxfText: string } | { ok: false; reason: string };

/**
 * DWG 바이트 → ASCII DXF 문자열. QCAD 없거나 실패 시 ok:false.
 */
export async function convertDwgBufferToDxf(buf: Buffer, originalName = 'input.dwg'): Promise<DwgToDxfResult> {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'DWG 변환은 Windows 서버에서만 지원됩니다. DXF로 저장해 올려 주세요.' };
  }

  const bat = resolveDwg2DwgBat();
  if (!bat) {
    const tried = getQcadModulesDirs().join(' | ');
    return {
      ok: false,
      reason: `QCAD(dwg2dwg)를 찾지 못했습니다. DXF로 올려 주세요. (시도: ${tried}. GGNR_QCAD_HOME 으로 지정 가능)`,
    };
  }

  const qcadWorkDir = path.dirname(bat);
  const batLeaf = path.basename(bat);
  const id = randomUUID();
  const dir = workDir();
  const ext = path.extname(originalName).toLowerCase() === '.dxf' ? '.dxf' : '.dwg';
  const tmpIn = path.join(dir, `in-${id}${ext}`);
  const tmpOut = path.join(dir, `out-${id}.dxf`);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmpIn, buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `작업 폴더에 쓰지 못했습니다: ${msg}` };
  }

  const toCmdPath = (abs: string) => abs.replace(/\\/g, '/');
  const quoteIfNeeded = (abs: string) => {
    const p = toCmdPath(abs);
    return /[\s]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
  };
  const outArg = quoteIfNeeded(tmpOut);
  const inArg = quoteIfNeeded(tmpIn);
  /** R27 = AutoCAD 2013 DXF — dxf-parser 호환이 비교적 안정적 */
  const inner = `${batLeaf} -f -r R27 -o ${outArg} ${inArg}`;

  const { code, stderr, stdout } = await new Promise<{ code: number; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const p = spawn(process.env.ComSpec || 'cmd.exe', ['/c', inner], {
        cwd: qcadWorkDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const errChunks: Buffer[] = [];
      const outChunks: Buffer[] = [];
      p.stderr?.on('data', (d: Buffer) => errChunks.push(d));
      p.stdout?.on('data', (d: Buffer) => outChunks.push(d));
      const timer = setTimeout(() => {
        try {
          p.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, SPAWN_MS);
      p.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      p.on('close', (c) => {
        clearTimeout(timer);
        resolve({
          code: c ?? 1,
          stderr: Buffer.concat(errChunks).toString('utf8').trim(),
          stdout: Buffer.concat(outChunks).toString('utf8').trim(),
        });
      });
    }
  ).catch((e: unknown) => ({
    code: -1,
    stderr: e instanceof Error ? e.message : String(e),
    stdout: '',
  }));

  const cleanup = async () => {
    await Promise.all(
      [tmpIn, tmpOut].map(async (p) => {
        try {
          if (existsSync(p)) await unlink(p);
        } catch {
          /* ignore */
        }
      })
    );
  };

  if (code !== 0) {
    console.error(`[dwgToDxf] exit ${code}\nstderr:\n${stderr.slice(-2000)}\nstdout:\n${stdout.slice(-2000)}`);
    await cleanup();
    return {
      ok: false,
      reason: `DWG 변환 실패 (exit ${code}). DXF로 저장해 올려 주세요.${stderr ? ` ${stderr.slice(0, 200)}` : ''}`,
    };
  }

  const appeared = await waitForFile(tmpOut, POST_EXIT_WAIT_MS, POST_EXIT_POLL_MS);
  if (!appeared) {
    await cleanup();
    return {
      ok: false,
      reason: 'DXF가 생성되지 않았습니다. QCAD Professional(체험판 제한) 또는 DWG 형식을 확인하세요.',
    };
  }

  try {
    const buf = await readFile(tmpOut);
    const dxfText = decodeDxfBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    await cleanup();
    if (!dxfText.trim()) {
      return { ok: false, reason: '변환된 DXF가 비어 있습니다.' };
    }
    return { ok: true, dxfText };
  } catch (e) {
    await cleanup();
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `DXF 읽기 실패: ${msg}` };
  }
}
