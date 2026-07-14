/**
 * 프로젝트 기동 명령 기록·조회.
 * restart-request.json 의 boot 필드에 남기고, 버전관리 재시작이 동일 명령을 재사용한다.
 */
import fs from 'node:fs';
import path from 'node:path';

export type GgnrNpmScript = 'dev' | 'start';

export type GgnrBootCommand = {
  npmScript: GgnrNpmScript;
  project: string;
  type: string;
  /** 예: npm run start -- build_yy prod */
  command: string;
  at: string;
};

export function ggnrRestartSignalPath(cwd = process.cwd()): string {
  return path.join(cwd, '.cursor-runtime', 'restart-request.json');
}

export function buildGgnrBootCommand(
  npmScript: GgnrNpmScript,
  project: string,
  type: string
): GgnrBootCommand {
  return {
    npmScript,
    project,
    type,
    command: `npm run ${npmScript} -- ${project} ${type}`,
    at: new Date().toISOString(),
  };
}

function parseBootFromSignal(raw: Record<string, unknown>): GgnrBootCommand | null {
  const nested =
    raw.boot && typeof raw.boot === 'object' && !Array.isArray(raw.boot)
      ? (raw.boot as Record<string, unknown>)
      : null;
  const src = nested ?? raw;
  const npmScript =
    src.npmScript === 'start' || src.npmScript === 'dev'
      ? src.npmScript
      : src.bootNpmScript === 'start' || src.bootNpmScript === 'dev'
        ? src.bootNpmScript
        : null;
  const project =
    typeof src.project === 'string'
      ? src.project.trim()
      : typeof src.bootProject === 'string'
        ? src.bootProject.trim()
        : '';
  const type =
    typeof src.type === 'string'
      ? src.type.trim()
      : typeof src.bootType === 'string'
        ? src.bootType.trim()
        : '';
  if (!npmScript || !project || !type) return null;
  const commandRaw =
    typeof src.command === 'string'
      ? src.command
      : typeof src.bootCommand === 'string'
        ? src.bootCommand
        : '';
  return {
    npmScript,
    project,
    type,
    command: commandRaw.trim() || `npm run ${npmScript} -- ${project} ${type}`,
    at: typeof src.at === 'string' ? src.at : '',
  };
}

/** 기존 신호는 유지하고 boot만 갱신 (재시작 요청 플래그를 건드리지 않음) */
export function writeGgnrBootCommand(
  npmScript: GgnrNpmScript,
  project: string,
  type: string,
  cwd = process.cwd()
): GgnrBootCommand {
  const payload = buildGgnrBootCommand(npmScript, project, type);
  const filePath = ggnrRestartSignalPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  const next = { ...existing, boot: payload };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  return payload;
}

export function readGgnrBootCommand(cwd = process.cwd()): GgnrBootCommand | null {
  try {
    const filePath = ggnrRestartSignalPath(cwd);
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    return parseBootFromSignal(raw);
  } catch {
    return null;
  }
}

/** 재시작 신호 write 시 기존 boot 필드 보존용 */
export function pickBootForSignalMerge(
  existing: Record<string, unknown> | null | undefined
): { boot: GgnrBootCommand } | Record<string, never> {
  if (!existing) return {};
  const boot = parseBootFromSignal(existing);
  return boot ? { boot } : {};
}

/** env(GGNR_RUN_SCRIPT) → restart-request.json boot → dev */
export function resolveGgnrNpmScript(): GgnrNpmScript {
  const fromEnv = process.env.GGNR_RUN_SCRIPT?.trim();
  if (fromEnv === 'start' || fromEnv === 'dev') return fromEnv;
  const boot = readGgnrBootCommand();
  if (boot?.npmScript) return boot.npmScript;
  return 'dev';
}

/** 재시작용 앱 기동 한 줄 (프로젝트/타입 없으면 빈 문자열) */
export function resolveAppStartCommand(project?: string, type?: string): string {
  const boot = readGgnrBootCommand();
  const p = (project ?? process.env.GGNR_PROJECT ?? boot?.project ?? '').trim();
  const t = (type ?? process.env.GGNR_ENV ?? boot?.type ?? '').trim();
  if (!p || !t) return '';
  const script = resolveGgnrNpmScript();
  if (boot?.command && boot.project === p && boot.type === t && boot.npmScript === script) {
    return boot.command;
  }
  return `npm run ${script} -- ${p} ${t}`;
}
