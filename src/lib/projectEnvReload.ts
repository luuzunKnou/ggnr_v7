import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from '../../scripts/load-project-env';

function applyRuntimeEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) (process.env as Record<string, string>)[key] = value;
  }
}

/** 디스크의 프로젝트·runtime env를 process.env에 다시 병합 (소스 적용 후) */
export function reloadProjectRuntimeEnv(projectName: string, section: string): void {
  loadProjectEnv(projectName, section);
  const dir = path.join(process.cwd(), 'src', 'config', 'projects');
  applyRuntimeEnvFile(path.join(dir, 'common.runtime.env'));
  applyRuntimeEnvFile(path.join(dir, `${projectName}.runtime.env`));
}
