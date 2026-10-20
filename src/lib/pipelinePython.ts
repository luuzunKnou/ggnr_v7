import fs from 'node:fs';
import path from 'node:path';
import { turbopackOpaquePath } from '@/lib/turbopackFsPath';

/**
 * pdal/gdal·영상 분석 Python 실행 파일.
 * 빌드 파일 추적이 python/env(수만 개 파일)를 통째로 훑지 않도록 경로는 런타임에 이어 붙이고
 * (path.join 에 리터럴을 넣지 않음), 작업 디렉터리는 프로젝트 루트를 쓴다.
 */
export function resolvePipelinePythonBin(): string {
  const raw = process.env.GGNR_PIPELINE_PYTHON?.trim();
  if (raw && raw !== 'python') {
    return path.isAbsolute(raw) ? raw : [process.cwd(), raw].join(path.sep);
  }
  const envPy =
    process.platform === 'win32'
      ? [process.cwd(), 'python', 'env', 'python.exe'].join(path.sep)
      : [process.cwd(), 'python', 'env', 'bin', 'python'].join(path.sep);
  if (fs.existsSync(turbopackOpaquePath(envPy))) return envPy;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

/** -m pipeline.* 용: cwd=프로젝트 루트, PYTHONPATH=python/ */
export function pipelinePythonSpawnEnv(): NodeJS.ProcessEnv {
  const pythonPath = [process.cwd(), 'python'].join(path.sep);
  const prev = process.env.PYTHONPATH ?? '';
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONPATH: prev ? `${pythonPath}${path.delimiter}${prev}` : pythonPath,
  };
}
