/**
 * 프로젝트 env 파일에서 [section] 블록을 파싱해 process.env에 병합
 */
import fs from 'node:fs';
import path from 'node:path';

/** 파일에서 해당 섹션의 key=value 맵만 반환 (process.env 변경 없음) */
export function getProjectEnvVars(projectName: string, section: string): Record<string, string> {
  const root = process.cwd();
  const filePath = path.join(root, 'src', 'config', 'projects', `${projectName}.env`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Project env not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  let currentSection: string | null = null;
  const vars: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    if (currentSection !== section.toLowerCase()) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) vars[key] = value;
  }
  return vars;
}

export function loadProjectEnv(projectName: string, section: string): void {
  const vars = getProjectEnvVars(projectName, section);
  for (const [key, value] of Object.entries(vars)) {
    (process.env as Record<string, string>)[key] = value;
  }
}
