import {
  normalizeHistoryMemo,
  uploadHistoryOptions,
} from '@/lib/versionHistoryMessage';

export type UploadHistoryStageId =
  | 'preflight'
  | 'scan'
  | 'dbCompare'
  | 'zip'
  | 'init'
  | 'chunk'
  | 'complete'
  | 'npmInstall'
  | 'finalize';

export type UploadHistoryStageReport = {
  id: UploadHistoryStageId | string;
  /** false = 실패. 경고만 있는 단계는 ok:true + warn:true */
  ok: boolean;
  /** 성공/실패와 별도 — 이력 status가 아니라 본문 `[경고]` 줄용 */
  warn?: boolean;
  detail?: string;
  error?: string;
};

const STAGE_LABEL: Record<string, string> = {
  preflight: '대상 서버 상태 확인',
  scan: '소스 스캔/필터링',
  dbCompare: '스키마 SQL ↔ DB 비교',
  zip: 'ZIP 압축',
  init: '원격 업로드 세션 생성',
  chunk: '청크 전송',
  complete: '원격 병합/압축 해제',
  npmInstall: 'npm install',
  finalize: '결과 집계',
};

const STAGE_ORDER: UploadHistoryStageId[] = [
  'preflight',
  'scan',
  'dbCompare',
  'zip',
  'init',
  'chunk',
  'complete',
  'npmInstall',
  'finalize',
];

function stageLine(
  id: string,
  ok: boolean,
  detail?: string,
  error?: string,
  warn?: boolean
): string {
  const label = STAGE_LABEL[id] ?? id;
  if (warn) {
    return `[경고] ${label}: ${error ?? detail ?? '확인 필요'}`;
  }
  const body = ok ? detail ?? '완료' : error ?? detail ?? '실패';
  return `[${ok ? '성공' : '실패'}] ${label}: ${body}`;
}

export function buildStageHistoryMessage(
  id: string,
  ok: boolean,
  detail?: string,
  error?: string,
  warn?: boolean
): string {
  return stageLine(id, ok, detail, error, warn);
}

function mergeStageMap(
  localStages: UploadHistoryStageReport[],
  remoteStages: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): Map<string, UploadHistoryStageReport> {
  const merged = new Map<string, UploadHistoryStageReport>();
  for (const s of [...remoteStages, ...localStages, ...(extra ?? [])]) {
    merged.set(s.id, s);
  }
  return merged;
}

export function listUploadHistoryStageReports(
  localStages: UploadHistoryStageReport[],
  remoteStages: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): UploadHistoryStageReport[] {
  const merged = mergeStageMap(localStages, remoteStages, extra);
  const out: UploadHistoryStageReport[] = [];
  for (const id of STAGE_ORDER) {
    const s = merged.get(id);
    if (s) out.push({ ...s, id });
  }
  return out;
}

export function listUploadHistoryStageReportsFromUi(
  stages: Array<{ id: string; state: string; detail?: string }>,
  stopError?: string
): UploadHistoryStageReport[] {
  const out: UploadHistoryStageReport[] = [];
  for (const id of STAGE_ORDER) {
    const s = stages.find((x) => x.id === id);
    if (!s) continue;
    if (s.state === 'done') {
      out.push({ id, ok: true, detail: s.detail });
    } else if (s.state === 'warn') {
      out.push({ id, ok: true, warn: true, detail: s.detail, error: s.detail });
    } else if (s.state === 'error') {
      out.push({ id, ok: false, error: s.detail ?? stopError, detail: s.detail });
      break;
    } else if (s.state === 'active') {
      out.push({ id, ok: false, error: stopError ?? s.detail ?? '중단', detail: s.detail });
      break;
    } else {
      break;
    }
  }
  return out;
}

export function mergeUploadHistoryStageReports(
  localStages: UploadHistoryStageReport[],
  remoteStages: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[],
  uiStages?: Array<{ id: string; state: string; detail?: string }>
): UploadHistoryStageReport[] {
  const server = listUploadHistoryStageReports(localStages, remoteStages, extra);
  if (!uiStages) return server;
  const ui = listUploadHistoryStageReportsFromUi(uiStages);
  const preflight = ui.find((s) => s.id === 'preflight');
  if (preflight && !server.some((s) => s.id === 'preflight')) {
    return [preflight, ...server];
  }
  return server.length > 0 ? server : ui;
}

export function formatUploadStagesHistoryMessage(
  stages: UploadHistoryStageReport[]
): string;
export function formatUploadStagesHistoryMessage(
  localStages: UploadHistoryStageReport[],
  remoteStages: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): string;
export function formatUploadStagesHistoryMessage(
  localStagesOrStages: UploadHistoryStageReport[],
  remoteStages?: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): string {
  const stages =
    remoteStages === undefined
      ? localStagesOrStages
      : listUploadHistoryStageReports(localStagesOrStages, remoteStages, extra);
  const lines: string[] = [];
  for (const s of stages) {
    lines.push(stageLine(s.id, s.ok, s.detail, s.error, s.warn));
  }
  return lines.join('\n');
}

export function resolveUploadOverallStatus(stages: UploadHistoryStageReport[]): 'success' | 'fail';
export function resolveUploadOverallStatus(
  localStages: UploadHistoryStageReport[],
  remoteStages: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): 'success' | 'fail';
export function resolveUploadOverallStatus(
  localStagesOrStages: UploadHistoryStageReport[],
  remoteStages?: UploadHistoryStageReport[],
  extra?: UploadHistoryStageReport[]
): 'success' | 'fail' {
  const stages =
    remoteStages === undefined
      ? localStagesOrStages
      : listUploadHistoryStageReports(localStagesOrStages, remoteStages, extra);
  for (const s of stages) {
    /** 경고(warn)는 실패로 보지 않음 */
    if (!s.ok && !s.warn) return 'fail';
  }
  return 'success';
}

/** 성공/실패 이력 본문에 경고 줄 추가 (별도 status 없음) */
export function appendHistoryWarnings(body: string, warnings: string[]): string {
  const base = body.trim();
  const lines = warnings.map((w) => w.trim()).filter(Boolean).map((w) => (w.startsWith('[경고]') ? w : `[경고] ${w}`));
  if (lines.length === 0) return base;
  return base ? `${base}\n${lines.join('\n')}` : lines.join('\n');
}

export function formatDbSchemaMismatchWarning(diffCount: number): string {
  return `스키마 SQL ↔ DB 비교: 불일치 ${diffCount}건 — 사용자 확인 후 진행`;
}

export function formatBuildCheckSkippedWarning(): string {
  return '빌드 검사 미실시 — 사용자 확인 후 업로드';
}

export function buildUploadHistoryPrefix(includeNodeModules?: boolean): string {
  if (includeNodeModules == null) return '';
  return `node_modules ${includeNodeModules ? '포함' : '미포함'} — `;
}

function stripStatusPrefix(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('성공 - ')) return trimmed.slice('성공 - '.length).trim();
  if (trimmed.startsWith('실패 - ')) return trimmed.slice('실패 - '.length).trim();
  return trimmed;
}

/** 업로드 이력 본문·옵션·메모 (성공/실패는 status 컬럼) */
export function buildSourceUploadHistoryFields(
  includeNodeModules: boolean,
  body: string,
  changeNote?: string
): { option: string[]; memo: string | null; message: string } {
  return {
    option: uploadHistoryOptions(includeNodeModules),
    memo: normalizeHistoryMemo(changeNote),
    message: stripStatusPrefix(body),
  };
}

/** 본문만 (옵션·메모는 buildSourceUploadHistoryFields 사용) */
export function formatSourceUploadHistoryMessage(
  includeNodeModules: boolean,
  _status: 'success' | 'fail',
  body: string,
  changeNote?: string
): string {
  return buildSourceUploadHistoryFields(includeNodeModules, body, changeNote).message;
}

export function buildSourceUploadSuccessBody(
  ok: number,
  skipped: number,
  fail: number,
  extra?: string,
  warnings?: string[]
): string {
  const summary = `최종 집계 (성공 ${ok} / 제외 ${skipped} / 실패 ${fail})`;
  const body = extra ? `${summary}, ${extra}` : summary;
  return appendHistoryWarnings(body, warnings ?? []);
}

export function buildSourceUploadFailBody(reason: string): string {
  return stripStatusPrefix(reason.trim());
}
