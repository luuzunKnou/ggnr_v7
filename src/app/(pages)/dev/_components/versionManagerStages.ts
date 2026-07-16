import type { InstallZipPhase } from '@/service/sourceInstallZipProgress';
import type { RestartMode, VersionRelayPhase } from '@/lib/sourceVersionClientRelay';
import type { SourcePackageProfile } from './sourceUpload/sourceUploadProfiles';
import type { StageItem, StageState } from './ProgressStagesList';

export type InstallStageId = 'info' | 'scan' | 'zip' | 'download';
export type RelayStageId =
  | 'latest'
  | 'download'
  | 'relay-init'
  | 'relay-chunk'
  | 'geoserver-stop'
  | 'merge-apply'
  | 'geoserver-start'
  | 'app-stop'
  | 'npm-install'
  | 'build'
  | 'app-start';

export type RelayStageOptions = {
  /** 적용 후 서버 재시작 on/off — mode=none 이면 off */
  restart?: boolean;
  restartMode?: RestartMode;
  /** 개방망이면 런처 재시작 파이프라인에 npm install 단계 표시 */
  packageProfile?: SourcePackageProfile;
};

const INSTALL_STAGE_ORDER: InstallStageId[] = ['info', 'scan', 'zip', 'download'];

const INSTALL_PHASE_TO_STAGE: Partial<Record<InstallZipPhase, InstallStageId>> = {
  idle: 'info',
  info: 'info',
  scan: 'scan',
  zip: 'zip',
  download: 'download',
  done: 'download',
};

const RELAY_COMMON_STAGES: RelayStageId[] = [
  'latest',
  'download',
  'relay-init',
  'relay-chunk',
  'geoserver-stop',
  'merge-apply',
];

const RELAY_STAGE_LABEL_BASE: Record<RelayStageId, string> = {
  latest: 'GNMS 최신 버전 조회',
  download: 'GNMS ZIP 다운로드',
  'relay-init': '운영 서버 relay 세션 생성',
  'relay-chunk': '청크 전송',
  'geoserver-stop': 'GeoServer 중지',
  'merge-apply': '병합·적용',
  'geoserver-start': 'GeoServer 기동',
  'app-stop': '앱 종료',
  'npm-install': 'npm install',
  build: 'npm run build',
  'app-start': '앱 재기동',
};

/** 서버 complete NDJSON progress */
const PHASE_TO_RELAY_STAGE: Partial<Record<VersionRelayPhase | 'done', RelayStageId>> = {
  latest: 'latest',
  download: 'download',
  'relay-init': 'relay-init',
  'relay-chunk': 'relay-chunk',
  'relay-complete': 'geoserver-stop',
  'merge-apply': 'merge-apply',
  'geoserver-stop': 'geoserver-stop',
  'geoserver-start': 'geoserver-start',
  'npm-install': 'npm-install',
  'app-stop': 'app-stop',
  build: 'build',
  'app-start': 'app-start',
  geoserver: 'geoserver-start',
  restart: 'app-stop',
  done: 'geoserver-start',
};

function effectiveRestartMode(opts?: RelayStageOptions): RestartMode | 'off' {
  if (!opts?.restart) return 'off';
  const mode = opts.restartMode ?? 'exit';
  if (mode === 'none') return 'off';
  return mode;
}

/** 재시작 방법·패키지 프로필에 따른 단계 목록 */
export function relayStageOrder(opts?: RelayStageOptions): RelayStageId[] {
  const mode = effectiveRestartMode(opts);
  /** 재시작 있음: GeoServer 기동은 run.ts — UI 단계 제외 */
  const withGeoStart: RelayStageId[] = mode === 'off' ? ['geoserver-start'] : [];
  if (mode === 'off') return [...RELAY_COMMON_STAGES, ...withGeoStart];

  const withNpm =
    opts?.packageProfile === 'open' ? (['npm-install'] as RelayStageId[]) : [];
  /** exit·launcher 공통: 사전 install(개방망)·사전 빌드 → 앱 종료. 런처만 재기동 안내 단계 */
  const restartTail: RelayStageId[] =
    mode === 'launcher' ? ['app-stop', 'app-start'] : ['app-stop'];
  return [...RELAY_COMMON_STAGES, ...withNpm, 'build', ...restartTail];
}

export function relayStageLabel(id: RelayStageId, opts?: RelayStageOptions): string {
  const mode = effectiveRestartMode(opts);
  if (id === 'app-stop') {
    if (mode === 'exit') return '앱 종료(nssm 재기동)';
    if (mode === 'launcher') return 'Next 종료 (런처)';
  }
  if (id === 'npm-install') return 'npm install (개방망·사전)';
  if (id === 'build') return '사전 빌드';
  if (id === 'app-start') {
    if (mode === 'launcher') return 'Next 재기동';
  }
  return RELAY_STAGE_LABEL_BASE[id];
}

function firstRestartPipelineStage(order: RelayStageId[]): RelayStageId | null {
  for (const id of order) {
    if (id === 'app-stop' || id === 'npm-install' || id === 'build' || id === 'app-start') {
      return id;
    }
  }
  return null;
}

export function buildInstallBaseStages(): StageItem[] {
  return [
    { id: 'info', label: '서버 정보 확인', state: 'pending' },
    { id: 'scan', label: '소스 스캔/필터링', state: 'pending' },
    { id: 'zip', label: 'ZIP 압축', state: 'pending' },
    { id: 'download', label: '파일 다운로드', state: 'pending' },
  ];
}

export function buildInstallStagesFromProgress(
  p: {
    phase: InstallZipPhase;
    message: string;
    error?: string;
    fileCount?: number;
    scanSkipped?: number;
    scanSkippedPaths?: string[];
    scanSkippedTruncated?: boolean;
    zipName?: string;
    zipSize?: number;
  },
  infoDetail?: string
): StageItem[] {
  const base = buildInstallBaseStages();
  if (p.phase === 'error') {
    const failedId: InstallStageId = p.message.includes('다운로드')
      ? 'download'
      : p.message.includes('ZIP') || p.message.includes('압축')
        ? 'zip'
        : 'scan';
    const activeIdx = INSTALL_STAGE_ORDER.indexOf(failedId);
    return base.map((s, idx) => {
      if (s.id === failedId) {
        return { ...s, state: 'error' as StageState, detail: p.error ?? p.message };
      }
      if (idx < activeIdx) return { ...s, state: 'done' as StageState, detail: s.detail };
      return s;
    });
  }

  const activeStage = INSTALL_PHASE_TO_STAGE[p.phase] ?? 'scan';
  const activeIdx = INSTALL_STAGE_ORDER.indexOf(activeStage);
  const scanExclude = installScanExcludeFields(p);

  return base.map((s) => {
    const id = s.id as InstallStageId;
    const idx = INSTALL_STAGE_ORDER.indexOf(id);
    const exclude = id === 'scan' ? scanExclude : {};

    if (p.phase === 'done') {
      let detail: string | undefined;
      if (id === 'info') detail = infoDetail;
      if (id === 'scan' && p.fileCount != null) detail = `포함 ${p.fileCount}`;
      if (id === 'zip' && p.zipName) {
        detail = p.zipSize != null ? `${p.zipName} (${formatBytes(p.zipSize)})` : p.zipName;
      }
      if (id === 'download') detail = p.message;
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail, ...exclude };
    }

    if (id === 'info' && infoDetail && idx <= activeIdx) {
      return {
        ...s,
        state: (idx < activeIdx ? 'done' : 'active') as StageState,
        detail: infoDetail,
      };
    }
    if (idx < activeIdx) {
      let detail: string | undefined;
      if (id === 'scan' && p.fileCount != null) detail = `포함 ${p.fileCount}`;
      if (id === 'zip' && p.zipName) detail = p.zipName;
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail, ...exclude };
    }
    if (idx === activeIdx) {
      let detail = p.message;
      if (id === 'scan' && p.fileCount != null) detail = `포함 ${p.fileCount}`;
      if (id === 'zip' && p.zipName) detail = p.zipName;
      return { ...s, state: 'active' as StageState, detail, ...exclude };
    }
    return s;
  });
}

function installScanExcludeFields(p: {
  fileCount?: number;
  scanSkipped?: number;
  scanSkippedPaths?: string[];
  scanSkippedTruncated?: boolean;
}): Pick<StageItem, 'detailExclude' | 'title'> {
  if (p.fileCount == null) return {};
  const skipped = p.scanSkipped ?? 0;
  return {
    detailExclude: `제외 ${skipped}`,
    title: skipped > 0 ? installScanSkippedTitle(p) : undefined,
  };
}

function installScanSkippedTitle(p: {
  scanSkipped?: number;
  scanSkippedPaths?: string[];
  scanSkippedTruncated?: boolean;
}): string | undefined {
  const paths = p.scanSkippedPaths;
  if (!paths?.length) {
    const n = p.scanSkipped ?? 0;
    return n > 0 ? `제외 ${n}건 (경로 수집 중…)` : undefined;
  }
  const maxLines = 40;
  const head = paths.slice(0, maxLines);
  const lines = [...head];
  const remain = Math.max(0, (p.scanSkipped ?? paths.length) - head.length);
  if (remain > 0 || p.scanSkippedTruncated) {
    lines.push(`…외 ${remain > 0 ? remain : '다수'}건`);
  }
  return lines.join('\n');
}

export function buildRelayBaseStages(opts?: RelayStageOptions): StageItem[] {
  return relayStageOrder(opts).map((id) => ({
    id,
    label: relayStageLabel(id, opts),
    state: 'pending' as StageState,
  }));
}

export function buildRelayStagesFromProgress(
  p: {
    phase: VersionRelayPhase | 'done' | 'error';
    message: string;
    error?: string;
    chunkIndex?: number;
    totalChunks?: number;
    bytesDone?: number;
    totalBytes?: number;
    versionDetail?: string;
    applyDetail?: string;
    geoserverStopDetail?: string;
    geoserverStartDetail?: string;
    /** GeoServer ensure 성공 여부 (실패 시 단계 error) */
    geoserverStartOk?: boolean;
    appStopDetail?: string;
    npmInstallDetail?: string;
    buildDetail?: string;
    appStartDetail?: string;
    /** 재시작 예약 시 후속 단계는 콘솔/서비스 파이프라인(실시간 추적 없음) */
    restartScheduled?: boolean;
  },
  opts?: RelayStageOptions
): StageItem[] {
  const order = relayStageOrder(opts);
  const base = buildRelayBaseStages(opts);
  const mode = effectiveRestartMode(opts);

  if (p.phase === 'error') {
    const text = `${p.error ?? ''} ${p.message}`;
    const failedId: RelayStageId = text.includes('바이트 불일치') || text.includes('청크')
      ? 'relay-chunk'
      : text.includes('relay init') || text.includes('relay 세션')
        ? 'relay-init'
        : text.includes('사전 빌드') || text.includes('npm install')
          ? text.includes('사전 빌드') || text.includes('build') || text.includes('빌드')
            ? 'build'
            : 'npm-install'
          : text.includes('build') || text.includes('빌드')
            ? 'build'
            : text.includes('GeoServer') || text.includes('geoserver')
              ? text.includes('기동') || text.includes('시작')
                ? 'geoserver-start'
                : 'geoserver-stop'
              : text.includes('complete') ||
                  text.includes('병합') ||
                  text.includes('적용') ||
                  text.includes('크기 불일치') ||
                  text.includes('EBUSY') ||
                  text.includes('copyfile')
                ? 'merge-apply'
                : text.includes('재시작') ||
                    text.includes('앱 종료') ||
                    text.includes('Next 종료') ||
                    text.includes('GGNR_RESTART')
                  ? 'app-stop'
                  : text.includes('다운로드') || text.includes('download')
                    ? 'download'
                    : text.includes('CORS') || text.includes('시간 초과')
                      ? 'latest'
                      : 'latest';
    const activeIdx = order.indexOf(failedId);
    const safeIdx = activeIdx >= 0 ? activeIdx : 0;
    return base.map((s, idx) => {
      if (activeIdx >= 0 ? s.id === failedId : idx === 0) {
        return {
          ...s,
          state: 'error' as StageState,
          detail: p.error ?? p.message,
        };
      }
      if (idx < safeIdx) return { ...s, state: 'done' as StageState };
      return s;
    });
  }

  const firstRestart = firstRestartPipelineStage(order);
  const activeStage: RelayStageId =
    p.phase === 'done'
      ? p.restartScheduled && firstRestart
        ? firstRestart
        : order.includes('geoserver-start')
          ? 'geoserver-start'
          : (order[order.length - 1] ?? 'merge-apply')
      : (PHASE_TO_RELAY_STAGE[p.phase] ?? 'latest');
  const activeIdx = order.indexOf(activeStage);

  return base.map((s) => {
    const id = s.id as RelayStageId;
    const idx = order.indexOf(id);

    if (p.phase === 'done') {
      let detail: string | undefined;
      let state: StageState = 'done';

      if (id === 'latest') detail = p.versionDetail;
      if (id === 'relay-chunk' && p.totalChunks != null) {
        detail = `${p.totalChunks}/${p.totalChunks}`;
      }
      if (id === 'geoserver-stop') detail = p.geoserverStopDetail ?? '중지 완료';
      if (id === 'merge-apply') detail = p.applyDetail ?? p.message;
      if (id === 'geoserver-start') {
        detail = p.geoserverStartDetail ?? '기동 완료';
        state = p.geoserverStartOk === false ? 'error' : 'done';
      }

      const isRestartStage =
        id === 'app-stop' || id === 'npm-install' || id === 'build' || id === 'app-start';

      if (isRestartStage) {
        if (!p.restartScheduled) {
          detail = '생략';
          state = 'done';
        } else {
          /** 사전 install·빌드·앱 종료는 응답 전에 완료. 재기동만 콘솔(추적 불가) */
          if (id === 'npm-install') {
            detail = p.npmInstallDetail ?? '사전 npm install 완료';
            state = 'done';
          } else if (id === 'build') {
            detail = p.buildDetail ?? '사전 빌드 완료';
            state = 'done';
          } else if (id === 'app-stop') {
            detail =
              p.appStopDetail ??
              (mode === 'exit'
                ? '앱 종료 단계 완료 · process.exit 예약'
                : '앱 종료 단계 완료 · 런처가 Next 종료');
            state = 'done';
          } else if (id === 'app-start') {
            detail = p.appStartDetail ?? '콘솔(런처)에서 Next 재기동';
            state = 'pending';
          }
        }
      }

      return { ...s, state, detail: detail ?? s.detail };
    }

    if (idx < activeIdx) {
      let detail: string | undefined;
      if (id === 'latest') detail = p.versionDetail;
      if (id === 'relay-chunk' && p.totalChunks != null) {
        detail = `${p.totalChunks}/${p.totalChunks}`;
      }
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail };
    }
    if (idx === activeIdx) {
      let detail = p.message;
      if (id === 'relay-chunk' && p.chunkIndex != null && p.totalChunks != null) {
        detail = `${p.chunkIndex}/${p.totalChunks}`;
      }
      if (id === 'latest' && p.versionDetail) detail = p.versionDetail;
      if (id === 'geoserver-stop' && !detail) detail = '중지 중...';
      if (id === 'merge-apply') {
        detail = p.applyDetail ?? detail ?? '병합·적용 중...';
      }
      if (id === 'geoserver-start' && !detail) detail = '기동 중...';
      if (id === 'build' && !detail) detail = '사전 빌드 중...';
      return { ...s, state: 'active' as StageState, detail };
    }
    return s;
  });
}

export function patchStages(
  stages: StageItem[],
  patch: Partial<
    Record<string, Pick<StageItem, 'state' | 'detail' | 'detailExclude' | 'title'>>
  >
): StageItem[] {
  return stages.map((s) => {
    const p = patch[s.id];
    if (!p) return s;
    return {
      ...s,
      state: p.state ?? s.state,
      detail: p.detail ?? s.detail,
      detailExclude: p.detailExclude ?? s.detailExclude,
      title: p.title ?? s.title,
    };
  });
}

export function setStageActive(stages: StageItem[], activeId: string, detail?: string): StageItem[] {
  const order = stages.map((s) => s.id);
  const activeIdx = order.indexOf(activeId);
  return stages.map((s, idx) => {
    if (s.id === activeId) return { ...s, state: 'active', detail: detail ?? s.detail };
    if (idx < activeIdx && s.state !== 'error') return { ...s, state: 'done' };
    return s;
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function createInstallZipProgressId(): string {
  return `siz_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
