import type { InstallZipPhase } from '@/service/sourceInstallZipProgress';
import type { VersionRelayPhase } from '@/lib/sourceVersionClientRelay';
import type { StageItem, StageState } from './ProgressStagesList';

export type InstallStageId = 'info' | 'scan' | 'zip' | 'download';
export type RelayStageId = 'latest' | 'download' | 'relay-init' | 'relay-chunk' | 'relay-complete';

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
  'relay-complete',
];

const RELAY_STAGE_LABEL: Record<RelayStageId, string> = {
  latest: 'GNMS 최신 버전 조회',
  download: 'GNMS ZIP 다운로드',
  'relay-init': '운영 서버 relay 세션 생성',
  'relay-chunk': '청크 전송',
  'relay-complete': '병합·적용·재시작',
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
}): StageItem[] {
  const base = buildRelayBaseStages();
  if (p.phase === 'error') {
    const failedId: RelayStageId = p.error?.includes('청크') || p.message.includes('청크')
      ? 'relay-chunk'
      : p.message.includes('relay init') || p.message.includes('relay 세션')
        ? 'relay-init'
        : p.message.includes('complete') || p.message.includes('병합')
          ? 'relay-complete'
          : p.message.includes('다운로드')
            ? 'download'
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
    p.phase === 'done' ? 'relay-complete' : (p.phase as RelayStageId);
  const activeIdx = RELAY_STAGE_ORDER.indexOf(activeStage);

  return base.map((s) => {
    const id = s.id as RelayStageId;
    const idx = RELAY_STAGE_ORDER.indexOf(id);

    if (p.phase === 'done') {
      let detail: string | undefined;
      if (id === 'latest') detail = p.versionDetail;
      if (id === 'relay-chunk' && p.totalChunks != null) {
        detail = `${p.totalChunks}/${p.totalChunks}`;
      }
      if (id === 'relay-complete') detail = p.message;
      return { ...s, state: 'done' as StageState, detail: detail ?? s.detail };
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
