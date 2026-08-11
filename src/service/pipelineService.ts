/**
 * LAS 파이프라인: Python CLI 호출.
 * LAS 업로드 완료 시 ECEF 보정 후 PNTS 생성 (3dtiles_las, 3dtiles_pnts).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { appendUploadConvertHistory } from './fileManagerService';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { broadcastPipelineStep } from '@/lib/pipelineEvents';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

/**
 * pdal/gdal Python 실행 파일.
 * Turbopack이 spawn('python')·cwd=python/ 을 프로젝트 전체로 추적하지 않도록
 * env 인터프리터 절대경로를 우선하고, 작업 디렉터리는 프로젝트 루트를 쓴다.
 */
function getPythonBin(): string {
  const raw = process.env.GGNR_PIPELINE_PYTHON?.trim();
  if (raw && raw !== 'python') {
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  }
  const envPy =
    process.platform === 'win32'
      ? path.join(process.cwd(), 'python', 'env', 'python.exe')
      : path.join(process.cwd(), 'python', 'env', 'bin', 'python');
  if (fs.existsSync(envPy)) return envPy;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

/** -m pipeline.cli 용: cwd=프로젝트 루트, PYTHONPATH=python/ */
function pythonSpawnEnv(): NodeJS.ProcessEnv {
  const pythonPath = path.join(process.cwd(), 'python');
  const prev = process.env.PYTHONPATH ?? '';
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONPATH: prev ? `${pythonPath}${path.delimiter}${prev}` : pythonPath,
  };
}

function spawnPipelinePython(args: string[]) {
  return spawn(getPythonBin(), args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: pythonSpawnEnv(),
  });
}

const ENV_SETUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per step

/** Windows 흔한 설치 경로 + CONDA_EXE / PATH 에서 conda 실행 파일 탐색 */
function resolveCondaExe(): { exe: string } | { error: string } {
  const fromEnv = process.env.CONDA_EXE?.trim();
  if (fromEnv) {
    if (fromEnv === 'conda' || fs.existsSync(fromEnv)) return { exe: fromEnv };
    return {
      error: `CONDA_EXE 경로를 찾을 수 없습니다: ${fromEnv}. Miniconda/Anaconda 설치 후 PATH에 넣거나 CONDA_EXE에 conda.exe 전체 경로를 지정하세요.`,
    };
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(home, 'miniconda3', 'Scripts', 'conda.exe'),
    path.join(home, 'Miniconda3', 'Scripts', 'conda.exe'),
    path.join(home, 'anaconda3', 'Scripts', 'conda.exe'),
    path.join(home, 'Anaconda3', 'Scripts', 'conda.exe'),
    path.join(local, 'miniconda3', 'Scripts', 'conda.exe'),
    path.join(local, 'anaconda3', 'Scripts', 'conda.exe'),
    'C:\\ProgramData\\miniconda3\\Scripts\\conda.exe',
    'C:\\ProgramData\\Miniconda3\\Scripts\\conda.exe',
    'C:\\ProgramData\\anaconda3\\Scripts\\conda.exe',
    'C:\\tools\\miniconda3\\Scripts\\conda.exe',
    'C:\\miniconda3\\Scripts\\conda.exe',
    'D:\\miniconda3\\Scripts\\conda.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return { exe: c };
  }

  // PATH 상의 conda (where와 동일하게 이름만 — spawn이 PATH 검색)
  return {
    error:
      '이 PC에 conda가 설치되어 있지 않거나 PATH에 없습니다. ' +
      'Miniconda를 설치한 뒤 터미널을 다시 열고, 개발자 모드에서 «환경 생성 및 설치»를 다시 실행하세요. ' +
      '(https://docs.conda.io/en/latest/miniconda.html) ' +
      '이미 설치했다면 CONDA_EXE에 conda.exe 전체 경로를 넣으세요.',
  };
}

/** Windows에서 한글 등 유니코드 경로/메시지 처리 시 코드 페이지 오류 방지 (Python UTF-8 모드) — conda setup 등 */

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number = ENV_SETUP_TIMEOUT_MS
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('cmd.exe', ['/c', cmd, ...args], { cwd, windowsHide: true, shell: false })
      : spawn(cmd, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stdout, stderr: stderr + '\n[타임아웃]' });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

export type RunPipelineEnvSetupResult = { success: boolean; message: string; log: string };

/**
 * python/env Conda 환경 생성 및 pdal, gdal, libpq, py3dtiles[las] 설치.
 * libpq: GDAL PostgreSQL 드라이버(ogr2ogr SHP→PostGIS)용. File Manager에서 "환경 생성 및 설치" 실행 시 호출. conda가 PATH에 있어야 함.
 */
export async function runPipelineEnvSetup(): Promise<RunPipelineEnvSetupResult> {
  const projectRoot = path.resolve(process.cwd());
  const pythonDir = path.join(projectRoot, 'python');
  const envPath = path.join(pythonDir, 'env');
  const logLines: string[] = [];

  const condaResolved = resolveCondaExe();
  if ('error' in condaResolved) {
    return { success: false, message: condaResolved.error, log: condaResolved.error };
  }
  const CONDA_EXE = condaResolved.exe;

  const run = async (cmd: string, args: string[], stepName: string) => {
    const { code, stdout, stderr } = await runCommand(cmd, args, pythonDir);
    const out = (stdout + '\n' + stderr).trim();
    logLines.push(`[${stepName}]\n${out}`);
    if (code !== 0) throw new Error(`${stepName} 실패 (code ${code}). ${out.slice(-500)}`);
  };

  try {
    await run(CONDA_EXE, ['create', '--prefix', './env', 'python=3.11', '-y'], 'conda create');
    await run(CONDA_EXE, ['run', '--prefix', './env', 'conda', 'install', '-c', 'conda-forge', 'pdal', 'gdal', 'libpq', '-y'], 'conda install pdal gdal libpq');
    await run(CONDA_EXE, ['run', '--prefix', './env', 'pip', 'install', 'py3dtiles[las]'], 'pip install py3dtiles[las]');
    const log = logLines.join('\n\n');
    return { success: true, message: `환경이 생성되었습니다: ${envPath}`, log };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const log = logLines.join('\n\n');
    const notFound = /not recognized|내부\s*또는\s*외부\s*명령|실행할 수 있는 프로그램/i.test(msg);
    if (notFound) {
      return {
        success: false,
        message:
          'conda 명령을 찾을 수 없습니다. Miniconda를 설치하고 터미널을 다시 연 뒤 «환경 생성 및 설치»를 재실행하세요. ' +
          '또는 CONDA_EXE에 conda.exe 전체 경로를 지정하세요.',
        log,
      };
    }
    return { success: false, message: msg, log };
  }
}

function lasEcefOutputPath(baseDir: string, lasRelativePath: string): string {
  const stem = path.basename(lasRelativePath, path.extname(lasRelativePath));
  return path.join(baseDir, path.dirname(lasRelativePath), `${stem}_ecef.las`);
}

function pntsOutputDir(baseDir: string, lasRelativePath: string): string {
  const dataset = path.basename(path.dirname(lasRelativePath));
  return path.join(baseDir, GGNR_DATA_PATHS.dtilesPnts, dataset);
}

/**
 * LAS 파일 1개에 대해 ECEF + PNTS 생성. 비동기로 실행하고 완료/실패 시 이력 추가.
 * spawn 실패(ENOENT 등) 시 실패로 기록. RESULT 없을 때는 출력 파일 존재 여부로 보정.
 */
export function runLasPipeline(params: { lasRelativePath: string; only?: 'ecef' | 'pnts' }): void {
  const { lasRelativePath, only: onlyStep } = params;
  const baseDir = GGNR_DATA_DIR;
  const sourceFile = path.basename(lasRelativePath);
  let handled = false;

  const appendSteps = async (
    at: string,
    ecefOk: boolean,
    pntsOk: boolean,
    ecefNote?: string,
    pntsNote?: string
  ) => {
    const onAppendErr = (err: unknown) => console.error('[pipelineService] appendUploadConvertHistory failed:', err);
    const append = (kind: 'convert_ecef' | 'convert_b3dm', ok: boolean, pathOrResult: string, note?: string) =>
      appendUploadConvertHistory({
        at,
        kind,
        sourceFile,
        pathOrResult,
        status: ok ? '완료' : '실패',
        note: ok ? undefined : (note ?? '').slice(0, 200),
      }).catch(onAppendErr);
    if (!onlyStep || onlyStep === 'ecef') {
      await append('convert_ecef', ecefOk, ecefOk ? lasEcefOutputPath(baseDir, lasRelativePath) : lasRelativePath, ecefNote);
    }
    if (!onlyStep || onlyStep === 'pnts') {
      await append('convert_b3dm', pntsOk, pntsOk ? pntsOutputDir(baseDir, lasRelativePath) : lasRelativePath, pntsNote);
    }
  };

  const callbackUrl = (process.env.PIPELINE_CALLBACK_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const args = ['-m', 'pipeline.cli', '--base-dir', baseDir, '--input-file', lasRelativePath, '--callback-url', callbackUrl];
  if (onlyStep) args.push('--only', onlyStep);
  const child = spawnPipelinePython(args);

  let stdout = '';
  let stdoutLineBuf = '';
  let stderr = '';
  const stepFromTag = (tag: string): 'ecef' | 'pnts' => (tag === 'ECEF' ? 'ecef' : 'pnts');
  const pathKey = lasRelativePath.replace(/\\/g, '/');
  const pushStep = (step: 'ecef' | 'pnts', status: 'start' | 'ok' | 'fail') => {
    broadcastPipelineStep({ path: pathKey, step, status });
  };
  const processLine = (line: string) => {
    const stepStart = line.match(/STEP_START:(ECEF|PNTS)/);
    if (stepStart) {
      pushStep(stepFromTag(stepStart[1]), 'start');
      return;
    }
    const resultMatch = line.match(/RESULT:(ECEF|PNTS):(OK|FAIL)/);
    if (resultMatch) {
      pushStep(stepFromTag(resultMatch[1]), resultMatch[2] === 'OK' ? 'ok' : 'fail');
    }
  };

  if (child.stdout) {
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      stdoutLineBuf += chunk;
      const lines = stdoutLineBuf.split('\n');
      stdoutLineBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });
    child.stdout.on('end', () => {
      if (stdoutLineBuf.trim()) processLine(stdoutLineBuf.trim());
    });
  }
  if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.on('error', (err) => {
    if (handled) return;
    handled = true;
    console.error('[pipelineService] Python spawn error:', err);
    const at = new Date().toISOString();
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    void appendSteps(at, false, false, errMsg, errMsg);
  });

  child.on('close', (code) => {
    if (handled) return;
    handled = true;
    const at = new Date().toISOString();
    if (stdout.trim()) console.info('[pipelineService] Python stdout:', stdout.trim());
    const projWarn = stderr.includes('proj.db') && stderr.includes('DATABASE.LAYOUT.VERSION');
    if (stderr.trim()) {
      if (projWarn) {
        console.warn('[pipelineService] Python stderr: (PROJ 경고, 무시) ', stderr.trim().split('\n')[0]);
      } else {
        console.warn('[pipelineService] Python stderr:', stderr.trim());
      }
    }
    const ecefMatch = stdout.match(/\bRESULT:ECEF:(OK|FAIL)(?::(.*))?/);
    const pntsMatch = stdout.match(/\bRESULT:PNTS:(OK|FAIL)(?::(.*))?/);
    let ecefOk = ecefMatch?.[1] === 'OK' || false;
    let pntsOk = pntsMatch?.[1] === 'OK';
    let ecefNote = ecefMatch?.[2]?.trim() ?? (code !== 0 ? stderr.trim() : '');
    let pntsNote = pntsMatch?.[2]?.trim() ?? (code !== 0 ? stderr.trim() : '');
    if (ecefMatch == null) {
      const ecefPath = lasEcefOutputPath(baseDir, lasRelativePath);
      if (fs.existsSync(ecefPath)) ecefOk = true;
      else ecefNote = code !== 0 ? `exit ${code}` : 'Python 출력 없음';
    }
    if (pntsMatch == null) {
      const pntsTileset = path.join(pntsOutputDir(baseDir, lasRelativePath), 'tileset.json');
      if (fs.existsSync(pntsTileset)) pntsOk = true;
      else pntsNote = code !== 0 ? `exit ${code}` : 'Python 출력 없음';
    }
    void appendSteps(at, ecefOk, pntsOk, ecefNote, pntsNote);
  });
}

const FIX_LAS_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

export type FixLasTo4326Result = {
  success: boolean;
  outputRelativePath?: string;
  message?: string;
  error?: string;
};

/**
 * WKT/현재 좌표계 LAS를 EPSG:4326으로 변환해 같은 폴더에 {원본명}_4326.las 로 저장.
 * Python CLI --fix-las-to-4326 호출 후 완료까지 대기해 결과 반환.
 */
export async function fixLasTo4326(params: { lasRelativePath: string }): Promise<FixLasTo4326Result> {
  const { lasRelativePath } = params;
  const baseDir = GGNR_DATA_DIR;

  return new Promise((resolve) => {
    const child = spawnPipelinePython([
      '-m',
      'pipeline.cli',
      '--base-dir',
      baseDir,
      '--input-file',
      lasRelativePath,
      '--fix-las-to-4326',
    ]);

    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        error: '타임아웃 (10분). PROJ/PDAL 환경을 확인하세요.',
      });
    }, FIX_LAS_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const okMatch = stdout.match(/RESULT:FIX_LAS:OK:(.+)/);
      const failMatch = stdout.match(/RESULT:FIX_LAS:FAIL:(.*)/);
      const skipMatch = stdout.match(/RESULT:FIX_LAS:SKIP:(.*)/);
      if (okMatch) {
        resolve({ success: true, outputRelativePath: okMatch[1].trim(), message: '4326 변환 완료.' });
        return;
      }
      if (skipMatch) {
        resolve({ success: true, message: skipMatch[1].trim() || '이미 WGS84입니다.' });
        return;
      }
      if (failMatch) {
        resolve({ success: false, error: failMatch[1].trim() || stderr.trim().slice(0, 300) });
        return;
      }
      const errMsg = code !== 0 ? (stderr.trim() || `exit ${code}`).slice(0, 300) : 'Python 출력 없음';
      resolve({ success: false, error: errMsg });
    });
  });
}

/**
 * WKT/현재 좌표계 LAS를 EPSG:5181(Korea 2000 / Unified)으로 변환해 같은 폴더에 {원본명}_5181.las 로 저장.
 */
export async function fixLasTo5181(params: { lasRelativePath: string }): Promise<FixLasTo4326Result> {
  const { lasRelativePath } = params;
  const baseDir = GGNR_DATA_DIR;

  return new Promise((resolve) => {
    const child = spawnPipelinePython([
      '-m',
      'pipeline.cli',
      '--base-dir',
      baseDir,
      '--input-file',
      lasRelativePath,
      '--fix-las-to-5181',
    ]);

    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        error: '타임아웃 (10분). PROJ/PDAL 환경을 확인하세요.',
      });
    }, FIX_LAS_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const okMatch = stdout.match(/RESULT:FIX_LAS:OK:(.+)/);
      const failMatch = stdout.match(/RESULT:FIX_LAS:FAIL:(.*)/);
      const skipMatch = stdout.match(/RESULT:FIX_LAS:SKIP:(.*)/);
      if (okMatch) {
        resolve({ success: true, outputRelativePath: okMatch[1].trim(), message: '5181 변환 완료.' });
        return;
      }
      if (skipMatch) {
        resolve({ success: true, message: skipMatch[1].trim() || '이미 EPSG:5181입니다.' });
        return;
      }
      if (failMatch) {
        resolve({ success: false, error: failMatch[1].trim() || stderr.trim().slice(0, 300) });
        return;
      }
      const errMsg = code !== 0 ? (stderr.trim() || `exit ${code}`).slice(0, 300) : 'Python 출력 없음';
      resolve({ success: false, error: errMsg });
    });
  });
}

/**
 * LAS를 현재 좌표계에서 EPSG:4978(ECEF)으로 변환해 같은 폴더에 {원본명}_ecef.las 로 저장.
 */
export async function fixLasToEcef(params: { lasRelativePath: string }): Promise<FixLasTo4326Result> {
  const { lasRelativePath } = params;
  const baseDir = GGNR_DATA_DIR;

  return new Promise((resolve) => {
    const child = spawnPipelinePython([
      '-m',
      'pipeline.cli',
      '--base-dir',
      baseDir,
      '--input-file',
      lasRelativePath,
      '--fix-las-to-ecef',
    ]);

    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        error: '타임아웃 (10분). PROJ/PDAL 환경을 확인하세요.',
      });
    }, FIX_LAS_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const okMatch = stdout.match(/RESULT:FIX_LAS:OK:(.+)/);
      const failMatch = stdout.match(/RESULT:FIX_LAS:FAIL:(.*)/);
      const skipMatch = stdout.match(/RESULT:FIX_LAS:SKIP:(.*)/);
      if (okMatch) {
        resolve({ success: true, outputRelativePath: okMatch[1].trim(), message: 'ECEF 변환 완료.' });
        return;
      }
      if (skipMatch) {
        resolve({ success: true, message: skipMatch[1].trim() || '이미 EPSG:4978(ECEF)입니다.' });
        return;
      }
      if (failMatch) {
        resolve({ success: false, error: failMatch[1].trim() || stderr.trim().slice(0, 300) });
        return;
      }
      const errMsg = code !== 0 ? (stderr.trim() || `exit ${code}`).slice(0, 300) : 'Python 출력 없음';
      resolve({ success: false, error: errMsg });
    });
  });
}
