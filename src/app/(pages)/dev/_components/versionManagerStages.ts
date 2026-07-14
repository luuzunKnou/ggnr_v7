import type { InstallZipPhase } from '@/service/sourceInstallZipProgress';
import type { VersionRelayPhase } from '@/lib/sourceVersionClientRelay';
import type { StageItem, StageState } from './ProgressStagesList';

export type InstallStageId = 'info' | 'scan' | 'zip' | 'download';
export type RelayStageId =
  | 'latest'
  | 'download'
  | 'relay-init'
  | 'relay-chunk'
  | 'geoserver-stop'
  | 'merge-apply'
  | 'app-stop'
  | 'build'
  | 'app-start'
  | 'geoserver-start';

const INSTALL_STAGE_ORDER: InstallStageId[] = ['info', 'scan', 'zip', 'download'];

const INSTALL_PHASE_TO_STAGE: Partial<Record<InstallZipPhase, InstallStageId>> = {
  idle: 'info',
  info: 'info',
  scan: 'scan',
  zip: 'zip',
  download: 'download',
  done: 'download',
};

const RELAY_STAGE_ORDER: RelayStageId[] = [
  'latest',
  'download',
  'relay-init',
  'relay-chunk',
  'geoserver-stop',
  'merge-apply',
  'app-stop',
  'build',
  'app-start',
  'geoserver-start',
];

const RELAY_STAGE_LABEL: Record<RelayStageId, string> = {
  latest: 'GNMS 최신 버전 조회',
  download: 'GNMS ZIP 다운로드',
  'relay-init': '운영 서버 relay 세션 생성',
  'relay-chunk': '청크 전송',
  'geoserver-stop': 'GeoServer 중지',
  'merge-apply': '병합·적용',
  'app-stop': '앱 종료',
  build: 'npm run build',
  'app-start': '앱 재기동',
  'geoserver-start': 'GeoServer 기동',
};

/** 서버 complete 요청 중(단일 HTTP): GeoServer 중지·병합·적용까지 활성 */
const PHASE_TO_RELAY_STAGE: Partial<Record<VersionRelayPhase | 'done', RelayStageId>> = {
  latest: 'latest',
  download: 'download',
  'relay-init': 'relay-init',
  'relay-chunk': 'relay-chunk',
  'relay-complete': 'geoserver-stop',
  'merge-apply': 'merge-apply',
  'geoserver-stop': 'geoserver-stop',
  'app-stop': 'app-stop',
  build: 'build',
  'app-start': 'app-start',
  'geoserver-start': 'geoserver-start',
  geoserver: 'geoserver-stop',
  restart: 'app-stop',
  done: 'geoserver-start',
};

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

  return base.map((s) => {
    const id = s.id as InstallStageId;
    const idx = INSTALL_STAGE_ORDER.indexOf(id);

    if (p.phase === 'done') {
      let detail: string | undefined;
      if (id === 'info') detail = infoDetail;
      if (id === 'scan' && p.fileCount != null) detail = `${p.fileCount}건`;
      if (id === 'zip' && p.zipName) {
        detail = p.zipSize != null ? `${p.zipName} (${formatBytes(p.zipSize)})` : p.zipName;
      }
      if (id === 'download') detail = p.message;
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail };
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
      if (id === 'scan' && p.fileCount != null) detail = `${p.fileCount}건`;
      if (id === 'zip' && p.zipName) detail = p.zipName;
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail };
    }
    if (idx === activeIdx) {
      let detail = p.message;
      if (id === 'scan' && p.fileCount != null) detail = `${p.fileCount}건 · ${p.message}`;
      if (id === 'zip' && p.zipName) detail = p.zipName;
      return { ...s, state: 'active' as StageState, detail };
    }
    return s;
  });
}

export function buildRelayBaseStages(): StageItem[] {
  return RELAY_STAGE_ORDER.map((id) => ({
    id,
    label: RELAY_STAGE_LABEL[id],
    state: 'pending' as StageState,
  }));
}

export function buildRelayStagesFromProgress(p: {
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
  appStopDetail?: string;
  buildDetail?: string;
  appStartDetail?: string;
  /** 재시작 예약 시 후속 단계는 콘솔 파이프라인 */
  restartScheduled?: boolean;
}): StageItem[] {
  const base = buildRelayBaseStages();
  if (p.phase === 'error') {
    const text = `${p.error ?? ''} ${p.message}`;
    const failedId: RelayStageId = text.includes('바이트 불일치') || text.includes('청크')
      ? 'relay-chunk'
      : text.includes('relay init') || text.includes('relay 세션')
        ? 'relay-init'
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
              : text.includes('재시작') || text.includes('앱 종료') || text.includes('GGNR_RESTART')
                ? 'app-stop'
                : text.includes('다운로드') || text.includes('download')
                  ? 'download'
                  : text.includes('CORS') || text.includes('시간 초과')
                    ? 'latest'
                    : 'latest';
    const activeIdx = RELAY_STAGE_ORDER.indexOf(failedId);
    return base.map((s, idx) => {
      if (s.id === failedId) {
        return { ...s, state: 'error' as StageState, detail: p.error ?? p.message };
      }
      if (idx < activeIdx) return { ...s, state: 'done' as StageState };
      return s;
    });
  }

  const activeStage: RelayStageId =
    p.phase === 'done'
      ? p.restartScheduled
        ? 'app-stop'
        : 'geoserver-start'
      : (PHASE_TO_RELAY_STAGE[p.phase] ?? 'latest');
  const activeIdx = RELAY_STAGE_ORDER.indexOf(activeStage);

  return base.map((s) => {
    const id = s.id as RelayStageId;
    const idx = RELAY_STAGE_ORDER.indexOf(id);

    if (p.phase === 'done') {
      const skipPipeline = !p.restartScheduled;
      let detail: string | undefined;
      let state: StageState = 'done';

      if (id === 'latest') detail = p.versionDetail;
      if (id === 'relay-chunk' && p.totalChunks != null) {
        detail = `${p.totalChunks}/${p.totalChunks}`;
      }
      if (id === 'geoserver-stop') detail = p.geoserverStopDetail ?? '중지 완료';
      if (id === 'merge-apply') detail = p.applyDetail ?? p.message;

      if (id === 'app-stop' || id === 'build' || id === 'app-start') {
        if (skipPipeline) {
          detail = '생략 (재시작 안 함)';
          state = 'done';
        } else {
          detail =
            id === 'app-stop'
              ? (p.appStopDetail ?? '콘솔에서 진행 예약')
              : id === 'build'
                ? (p.buildDetail ?? '콘솔에서 npm run build 예약')
                : (p.appStartDetail ?? '콘솔에서 앱 기동 예약');
          state = 'active';
        }
      }
      if (id === 'geoserver-start') {
        if (skipPipeline) {
          detail = p.geoserverStartDetail ?? '기동 완료';
          state = 'done';
        } else {
          detail = p.geoserverStartDetail ?? '빌드·앱 기동 후 콘솔에서 기동 예약';
          state = 'pending';
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
      if (id === 'geoserver-stop') detail = '중지·병합·적용 처리 중...';
      return { ...s, state: 'active' as StageState, detail };
    }
    return s;
  });
}

export function patchStages(
  stages: StageItem[],
  patch: Partial<Record<string, Pick<StageItem, 'state' | 'detail'>>>
): StageItem[] {
  return stages.map((s) => {
    const p = patch[s.id];
    return p ? { ...s, state: p.state, detail: p.detail ?? s.detail } : s;
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
