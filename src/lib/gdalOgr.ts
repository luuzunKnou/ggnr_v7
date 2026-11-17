/**
 * GDAL ogr2ogr 위치 찾기·실행 (서버·스크립트 전용).
 * 우선순위: GGNR_GDAL_OGR2OGR → 프로젝트 python 환경 → 설치된 QGIS/OSGeo4W → PATH.
 * 필요한 드라이버(예: PMTiles)를 지원하는 첫 번째 ogr2ogr 를 고른다.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

export type OgrRun = { cmd: string; env: NodeJS.ProcessEnv };

/** bin 옆 share/gdal·share/proj 를 찾아 환경변수를 채운다 (QGIS·conda Library 공통 구조) */
function gdalEnvFor(cmdAbs: string): NodeJS.ProcessEnv {
  const root = path.resolve(path.dirname(cmdAbs), '..');
  const env: NodeJS.ProcessEnv = { ...process.env };
  const gdalData = path.join(root, 'share', 'gdal');
  const projData = path.join(root, 'share', 'proj');
  if (fs.existsSync(gdalData)) env.GDAL_DATA = gdalData;
  if (fs.existsSync(projData)) {
    env.PROJ_LIB = projData;
    env.PROJ_DATA = projData;
  }
  return env;
}

function decodeStd(buf: Buffer): string {
  return process.platform === 'win32' ? iconv.decode(buf, 'cp949') : buf.toString('utf8');
}

export function runOgr(
  ogr: OgrRun,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(ogr.cmd, args, { windowsHide: true, shell: false, env: ogr.env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => out.push(d));
    child.stderr?.on('data', (d: Buffer) => err.push(d));
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout: decodeStd(Buffer.concat(out)),
        stderr: decodeStd(Buffer.concat(err)),
      })
    );
    child.on('error', (e) => resolve({ code: -1, stdout: '', stderr: e.message }));
  });
}

function candidates(): OgrRun[] {
  const isWin = process.platform === 'win32';
  const list: OgrRun[] = [];

  const custom = (process.env.GGNR_GDAL_OGR2OGR ?? '').trim();
  if (custom) {
    const abs = path.resolve(process.cwd(), custom);
    list.push(fs.existsSync(abs) ? { cmd: abs, env: gdalEnvFor(abs) } : { cmd: custom, env: { ...process.env } });
  }

  const py = (process.env.GGNR_PIPELINE_PYTHON ?? '').trim();
  if (py && py !== 'python') {
    const envDir = path.dirname(path.resolve(process.cwd(), py));
    const cand = isWin
      ? path.join(envDir, 'Library', 'bin', 'ogr2ogr.exe')
      : path.join(envDir, 'bin', 'ogr2ogr');
    if (fs.existsSync(cand)) list.push({ cmd: cand, env: gdalEnvFor(cand) });
  }

  if (isWin) {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
      .filter((p): p is string => Boolean(p))
      .filter((p, i, a) => a.indexOf(p) === i);
    for (const root of roots) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(root).filter((n) => /^QGIS/i.test(n));
      } catch {
        /* 폴더 없음 */
      }
      // 최신 버전 우선
      names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const n of names) {
        const cand = path.join(root, n, 'bin', 'ogr2ogr.exe');
        if (fs.existsSync(cand)) list.push({ cmd: cand, env: gdalEnvFor(cand) });
      }
    }
    const osgeo = 'C:\\OSGeo4W\\bin\\ogr2ogr.exe';
    if (fs.existsSync(osgeo)) list.push({ cmd: osgeo, env: gdalEnvFor(osgeo) });
  }

  list.push({ cmd: 'ogr2ogr', env: { ...process.env } });
  return list;
}

/** 지정 드라이버(쓰기 가능 벡터)를 지원하는 ogr2ogr 선택 — 없으면 안내 메시지와 함께 예외 */
export async function findOgr2ogrWithDriver(driver: string): Promise<OgrRun> {
  const tried: string[] = [];
  const re = new RegExp(`^\\s*${driver}\\s+-[^(]*vector[^(]*\\(rw`, 'mi');
  for (const c of candidates()) {
    const res = await runOgr(c, ['--formats']);
    if (res.code === 0 && re.test(res.stdout)) return c;
    tried.push(c.cmd);
  }
  throw new Error(
    `${driver} 쓰기를 지원하는 ogr2ogr(GDAL 3.8 이상)를 찾지 못했습니다. ` +
      'QGIS 설치 후 다시 실행하거나 GGNR_GDAL_OGR2OGR 에 ogr2ogr 경로를 지정하세요. ' +
      `(확인한 경로: ${tried.join(', ')})`
  );
}
