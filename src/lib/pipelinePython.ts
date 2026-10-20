import fs from 'node:fs';
import path from 'node:path';

/**
 * pdal/gdal·영상 분석 Python 실행 파일.
 * Turbopack이 spawn('python')·cwd=python/ 을 프로젝트 전체로 추적하지 않도록
 * env 인터프리터 절대경로를 우선하고, 작업 디렉터리는 프로젝트 루트를 쓴다.
 */
export function resolvePipelinePythonBin(): string {
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

/** -m pipeline.* 용: cwd=프로젝트 루트, PYTHONPATH=python/ */
export function pipelinePythonSpawnEnv(): NodeJS.ProcessEnv {
  const pythonPath = path.join(process.cwd(), 'python');
  const prev = process.env.PYTHONPATH ?? '';
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONPATH: prev ? `${pythonPath}${path.delimiter}${prev}` : pythonPath,
  };
}
