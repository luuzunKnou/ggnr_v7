'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Hammer, Upload } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { resolveClientMachineIp, prefetchClientMachineIp } from '@/lib/clientMachineIp';
import { recordVersionHistoryClient } from '@/lib/recordVersionHistoryClient';
import {
  buildSourceUploadFailBody,
  buildSourceUploadHistoryFields,
  buildSourceUploadSuccessBody,
} from '@/lib/sourceUploadHistoryMessage';
import { closeDevVersionHistory, notifyDevVersionHistoryRefresh } from './devVersionHistoryBridge';
import { InstallZipDownloadPanel } from './InstallZipDownloadPanel';
import { ProgressStagesList } from './ProgressStagesList';
import { type SourceUploadCategory, type SourceUploadMode } from './sourceUpload/sourceUploadProfiles';
import {
  estimateBuildCheckRemainingSeconds,
  estimateRemainingSeconds,
  estimateUploadCompleteRemainingSeconds,
  estimateUploadTotalSeconds,
  formatEtaMinutes,
  uploadCompletePhasePct,
  type BuildCheckEtaPhase,
} from '@/lib/sourceProgressEta';

type MainTab = 'install_download' | 'source_upload';

type UploadRow = {
  file: string;
  category: SourceUploadCategory;
  status: 'ok' | 'fail' | 'skipped';
  error?: string;
};

type StageId = 'preflight' | 'scan' | 'dbCompare' | 'zip' | 'init' | 'chunk' | 'complete' | 'npmInstall' | 'finalize';
type StageState = 'pending' | 'active' | 'done' | 'error';
type StageItem = {
  id: StageId;
  label: string;
  state: StageState;
  detail?: string;
  detailExclude?: string;
  title?: string;
};

type StageReport = {
  id: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

type UploadProgressPayload = {
  progressId: string;
  phase: string;
  progressPct: number;
  message: string;
  error?: string;
  failedStage?: string;
  sentChunks?: number;
  expectedChunks?: number;
  chunkIndex?: number;
  zipName?: string;
  zipSize?: number;
  scanIncluded?: number;
  scanSkipped?: number;
  scanPath?: string;
  scanSkippedPaths?: string[];
  scanSkippedTruncated?: boolean;
  zipProcessed?: number;
  zipTotal?: number;
  scanDbDiffCount?: number;
  remoteUploadId?: string;
  done: boolean;
};

function buildBaseStages(includeNodeModules: boolean): StageItem[] {
  const stages: StageItem[] = [
    { id: 'preflight', label: '대상 서버 상태 확인', state: 'pending' },
    { id: 'scan', label: '소스 스캔/필터링', state: 'pending' },
    { id: 'dbCompare', label: '스키마 SQL ↔ DB 비교', state: 'pending' },
    { id: 'zip', label: 'ZIP 압축', state: 'pending' },
    { id: 'init', label: '원격 업로드 세션 생성', state: 'pending' },
    { id: 'chunk', label: '청크 전송', state: 'pending' },
    { id: 'complete', label: '원격 병합/압축 해제', state: 'pending' },
  ];
  if (!includeNodeModules) {
    stages.push({ id: 'npmInstall', label: 'npm install', state: 'pending' });
  }
  stages.push({ id: 'finalize', label: '결과 집계', state: 'pending' });
  return stages;
}

const PHASE_TO_STAGE: Record<string, StageId> = {
  preflight: 'preflight',
  scan: 'scan',
  dbCompare: 'dbCompare',
  zip: 'zip',
  init: 'init',
  chunk: 'chunk',
  complete: 'complete',
  npmInstall: 'npmInstall',
  finalize: 'finalize',
  done: 'finalize',
};

const STAGE_LABEL: Record<StageId, string> = {
  preflight: '대상 서버 상태 확인 중...',
  scan: '소스 스캔/필터링 중...',
  dbCompare: '스키마 SQL ↔ DB 비교 중...',
  zip: 'ZIP 압축 중...',
  init: '원격 업로드 세션 생성 중...',
  chunk: 'ZIP 청크 전송 중...',
  complete: '원격 병합/압축 해제 중...',
  npmInstall: 'npm install 진행 중...',
  finalize: '결과 집계 중...',
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isStageId(id: string): id is StageId {
  return id in STAGE_LABEL;
}

function applyStageReports(reports: StageReport[]): Partial<Record<StageId, Pick<StageItem, 'state' | 'detail'>>> {
  const out: Partial<Record<StageId, Pick<StageItem, 'state' | 'detail'>>> = {};
  for (const r of reports) {
    if (!isStageId(r.id)) continue;
    out[r.id] = {
      state: r.ok ? 'done' : 'error',
      detail: r.ok ? r.detail : (r.error ?? r.detail),
    };
  }
  return out;
}

function createProgressId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function stageDetailForProgress(id: StageId, p: UploadProgressPayload): string | undefined {
  if (id === 'chunk' && p.sentChunks != null && p.expectedChunks != null) {
    return `${p.sentChunks}/${p.expectedChunks} (${p.progressPct}%)`;
  }
  if (id === 'zip' && p.zipProcessed != null && p.zipTotal != null) {
    return `ZIP ${p.zipProcessed}/${p.zipTotal} (${p.progressPct}%)`;
  }
  if (id === 'scan' && p.scanIncluded != null) {
    return `포함 ${p.scanIncluded}`;
  }
  if (id === 'complete' && (p.phase === 'complete' || p.phase === 'npmInstall' || p.phase === 'done')) {
    if (p.phase === 'complete') return p.message;
    return '병합/압축 해제 완료';
  }
  if (id === 'npmInstall' && p.phase === 'npmInstall') {
    return p.message;
  }
  if (p.phase === 'done' && id === 'finalize') return p.message;
  return undefined;
}

function scanSkippedTitle(p: UploadProgressPayload): string | undefined {
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

function scanExcludeFields(p: UploadProgressPayload): Pick<StageItem, 'detailExclude' | 'title'> {
  if (p.scanIncluded == null) return {};
  const skipped = p.scanSkipped ?? 0;
  return {
    detailExclude: `제외 ${skipped}`,
    title: skipped > 0 ? scanSkippedTitle(p) : undefined,
  };
}

function buildStagesFromProgress(
  p: UploadProgressPayload,
  preflightDetail?: string,
  includeNodeModules = false
): StageItem[] {
  const baseStages = buildBaseStages(includeNodeModules);
  const stageOrder = baseStages.map((s) => s.id);
  const activeStage: StageId =
    p.phase === 'error' && p.failedStage && isStageId(p.failedStage)
      ? p.failedStage
      : (PHASE_TO_STAGE[p.phase] ?? 'scan');
  const activeIdx = stageOrder.indexOf(activeStage);

  return baseStages.map((base) => {
    const idx = stageOrder.indexOf(base.id);
    const exclude =
      base.id === 'scan' && p.scanIncluded != null ? scanExcludeFields(p) : {};

    if (p.phase === 'error' && base.id === activeStage) {
      return { ...base, state: 'error' as StageState, detail: p.error ?? p.message };
    }
    if (p.phase === 'done') {
      const detail = base.id === 'finalize' ? p.message : stageDetailForProgress(base.id, p);
      return {
        ...base,
        state: 'done' as StageState,
        detail: detail ?? base.detail,
        ...exclude,
      };
    }
    if (base.id === 'preflight' && idx < activeIdx) {
      return { ...base, state: 'done' as StageState, detail: preflightDetail ?? base.detail };
    }
    if (idx < activeIdx) {
      return {
        ...base,
        state: 'done' as StageState,
        detail: stageDetailForProgress(base.id, p) ?? base.detail,
        ...exclude,
      };
    }
    if (idx === activeIdx) {
      /** 스캔 중에도 포함/제외 숫자가 있으면 메시지 대신 분리 표시 */
      if (base.id === 'scan' && p.scanIncluded != null) {
        return {
          ...base,
          state: 'active' as StageState,
          detail: `포함 ${p.scanIncluded}`,
          ...exclude,
        };
      }
      const detail =
        base.id === activeStage
          ? p.message || stageDetailForProgress(base.id, p)
          : stageDetailForProgress(base.id, p);
      return { ...base, state: 'active' as StageState, detail: detail ?? p.message };
    }
    return { ...base, state: 'pending' as StageState };
  });
}

export function SourceCodeUploaderContent() {
  const [mainTab, setMainTab] = useState<MainTab>('source_upload');
  const [mode, setMode] = useState<SourceUploadMode>('install');
  const [includeNodeModules, setIncludeNodeModules] = useState(false);
  const [dbConfirm, setDbConfirm] = useState<{
    open: boolean;
    diffCount: number;
    summary: string;
    progressId: string;
  } | null>(null);
  const [buildCheckSkipConfirmOpen, setBuildCheckSkipConfirmOpen] = useState(false);
  const [date, setDate] = useState(todayYmd());
  const [changeNote, setChangeNote] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [buildChecking, setBuildChecking] = useState(false);
  const [progressPhase, setProgressPhase] = useState<string>('idle');
  const [lastSavedRoot, setLastSavedRoot] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState('대기 중');
  const [stages, setStages] = useState<StageItem[]>(() => buildBaseStages(false));
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [chunkProgress, setChunkProgress] = useState<{ sent: number; expected: number } | null>(null);
  const [uploadMeta, setUploadMeta] = useState<{ fileCount?: number; zipSize?: number }>({});
  const [etaTick, setEtaTick] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  /** 이 페이지에서 취소 없이 빌드 검사가 1회라도 완료되면 true */
  const buildCheckCompletedOnceRef = useRef(false);
  const buildCheckStartedAtRef = useRef(0);
  const buildCheckPhaseRef = useRef<BuildCheckEtaPhase>('copy');
  const buildCheckPhaseStartedAtRef = useRef(0);
  const remoteUploadIdRef = useRef<string | null>(null);
  const progressIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preflightDetailRef = useRef('');
  const lastChunkLoggedRef = useRef(0);
  const lastScanLoggedRef = useRef(0);
  const lastScanPathsLoggedRef = useRef(-1);
  const lastPhaseLoggedRef = useRef('');
  const liveLogScrollRef = useRef<HTMLDivElement>(null);
  const uploadHistoryRecordedRef = useRef(false);
  const startedAtRef = useRef(0);
  const completeStartedAtRef = useRef(0);
  const progressPhaseRef = useRef('idle');
  const stagesRef = useRef(stages);
  const includeNodeModulesRef = useRef(includeNodeModules);
  const changeNoteRef = useRef(changeNote);

  useEffect(() => {
    stagesRef.current = stages;
  }, [stages]);

  useEffect(() => {
    includeNodeModulesRef.current = includeNodeModules;
  }, [includeNodeModules]);

  useEffect(() => {
    changeNoteRef.current = changeNote;
  }, [changeNote]);

  useEffect(() => {
    if (!uploading && !buildChecking) return;
    const id = setInterval(() => {
      setEtaTick((t) => t + 1);
      if (progressPhaseRef.current === 'complete' && completeStartedAtRef.current > 0) {
        setProgressPct(
          uploadCompletePhasePct(
            completeStartedAtRef.current,
            uploadMeta.zipSize,
            includeNodeModulesRef.current
          )
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, [uploading, buildChecking, uploadMeta.zipSize]);

  const etaLabel = (() => {
    void etaTick;
    if (!uploading || startedAtRef.current <= 0) return null;
    if (progressPhase === 'complete' && completeStartedAtRef.current > 0) {
      const remain = estimateUploadCompleteRemainingSeconds(
        uploadMeta.zipSize,
        includeNodeModules,
        completeStartedAtRef.current,
        !includeNodeModules
      );
      return formatEtaMinutes(remain);
    }
    const total = estimateUploadTotalSeconds(
      uploadMeta.fileCount,
      uploadMeta.zipSize,
      includeNodeModules
    );
    if (total <= 0 && progressPct < 3) return '산출 중...';
    const remain = estimateRemainingSeconds(
      total > 0 ? total : Math.max(30, (Date.now() - startedAtRef.current) / 1000 / Math.max(progressPct / 100, 0.03)),
      progressPct,
      startedAtRef.current
    );
    return formatEtaMinutes(remain);
  })();

  const buildCheckEtaLabel = (() => {
    void etaTick;
    if (!buildChecking || buildCheckStartedAtRef.current <= 0) return null;
    const remain = estimateBuildCheckRemainingSeconds(
      buildCheckPhaseRef.current,
      buildCheckStartedAtRef.current,
      buildCheckPhaseStartedAtRef.current || buildCheckStartedAtRef.current
    );
    return formatEtaMinutes(remain);
  })();

  const cancelBlockedByPhase =
    progressPhase === 'complete' || progressPhase === 'npmInstall';
  const cancelBlockedByStage = stages.some(
    (s) => (s.id === 'complete' || s.id === 'npmInstall') && s.state === 'active'
  );
  const cancelBlocked = uploading && (cancelBlockedByPhase || cancelBlockedByStage);
  const cancelBlockedTitle = cancelBlockedByPhase
    ? progressPhase === 'npmInstall'
      ? 'npm install 중에는 취소할 수 없습니다. 완료될 때까지 기다려 주세요.'
      : '원격 병합/압축 해제 중에는 취소할 수 없습니다. 완료될 때까지 기다려 주세요.'
    : '원격 병합/압축 해제(또는 npm install) 중에는 취소할 수 없습니다. 완료될 때까지 기다려 주세요.';

  useLayoutEffect(() => {
    const el = liveLogScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLogs]);

  useEffect(() => {
    prefetchClientMachineIp();
    return () => {
      closeDevVersionHistory();
      setDbConfirm(null);
    };
  }, []);

  const formatLogLine = (line: string) => {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    return `[${ts}] ${line}`;
  };

  /** 새 빌드 확인·업로드 시작 시 로그 패널 초기화 (React 배치로 clear+append가 섞이지 않게) */
  const beginLiveLogSession = (firstLine: string) => {
    setLiveLogs([formatLogLine(firstLine)]);
  };

  const appendLog = (line: string) => {
    setLiveLogs((prev) => [...prev.slice(-49), formatLogLine(line)]);
  };

  const recordFinalUploadHistoryClient = async (params: {
    status: 'success' | 'fail';
    body: string;
    version?: string;
  }) => {
    if (uploadHistoryRecordedRef.current) return;
    uploadHistoryRecordedRef.current = true;

    const fields = buildSourceUploadHistoryFields(
      includeNodeModulesRef.current,
      params.body,
      changeNoteRef.current
    );

    await recordVersionHistoryClient({
      historyType: 'source_upload',
      status: params.status,
      message: fields.message,
      option: fields.option,
      memo: fields.memo ?? undefined,
      version: params.version,
    });
    notifyDevVersionHistoryRefresh();
  };

  const stopPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const applyProgressSnapshot = (p: UploadProgressPayload) => {
    if (p.remoteUploadId?.trim()) {
      remoteUploadIdRef.current = p.remoteUploadId.trim();
    }
    setProgressPhase(p.phase || 'idle');
    progressPhaseRef.current = p.phase || 'idle';
    if (p.phase === 'complete') {
      if (completeStartedAtRef.current <= 0) {
        completeStartedAtRef.current = Date.now();
      }
      const zipSize = p.zipSize ?? uploadMeta.zipSize;
      setProgressPct(
        uploadCompletePhasePct(
          completeStartedAtRef.current,
          zipSize,
          includeNodeModulesRef.current
        )
      );
    } else {
      setProgressPct(p.progressPct);
    }
    setProgressText(p.message);
    if (p.scanIncluded != null || p.zipSize != null) {
      setUploadMeta((prev) => ({
        fileCount: p.scanIncluded ?? prev.fileCount,
        zipSize: p.zipSize ?? prev.zipSize,
      }));
    }
    const nextStages = buildStagesFromProgress(p, preflightDetailRef.current, includeNodeModules);
    setStages(nextStages);

    if (p.sentChunks != null && p.expectedChunks != null && p.expectedChunks > 0) {
      setChunkProgress({ sent: p.sentChunks, expected: p.expectedChunks });
    }

    if (p.phase === 'chunk' && p.sentChunks != null) {
      if (p.sentChunks === 0 || p.sentChunks - lastChunkLoggedRef.current >= 10) {
        lastChunkLoggedRef.current = p.sentChunks;
        appendLog(`청크 ${p.sentChunks}/${p.expectedChunks ?? '?'} (${p.progressPct}%)`);
      }
    } else if (p.phase === 'error') {
      appendLog(`오류 [${p.failedStage ?? '?'}] ${p.error ?? p.message}`);
    } else if (p.phase === 'scan' && p.scanIncluded != null) {
      const total = p.scanIncluded + (p.scanSkipped ?? 0);
      if (total >= lastScanLoggedRef.current + 500 || (total > 0 && lastScanLoggedRef.current === 0)) {
        lastScanLoggedRef.current = total;
        appendLog(`스캔 포함 ${p.scanIncluded} / 제외 ${p.scanSkipped ?? 0}`);
      }
      if (p.scanPath === '(스캔 완료)' && p.scanSkippedPaths?.length && lastScanPathsLoggedRef.current !== p.scanSkipped) {
        lastScanPathsLoggedRef.current = p.scanSkipped ?? 0;
        const sample = p.scanSkippedPaths.slice(0, 20);
        appendLog(`제외 경로 예시 (${sample.length}/${p.scanSkipped ?? sample.length}건):`);
        for (const rel of sample) {
          appendLog(`  - ${rel}`);
        }
        if ((p.scanSkipped ?? 0) > sample.length || p.scanSkippedTruncated) {
          appendLog(`  …외 ${(p.scanSkipped ?? 0) - sample.length}건 (단계 «제외»에 마우스 올리면 더 보기)`);
        }
      }
    } else if (p.phase !== lastPhaseLoggedRef.current && p.phase !== 'idle') {
      lastPhaseLoggedRef.current = p.phase;
      appendLog(p.message);
    }
  };

  const fetchProgressOnce = async (progressId: string) => {
    try {
      const res = await fetch(`/api/source/upload/progress?id=${encodeURIComponent(progressId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return (await res.json()) as UploadProgressPayload;
    } catch {
      return null;
    }
  };

  const startProgressPoll = (progressId: string) => {
    stopPoll();
    lastChunkLoggedRef.current = 0;
    lastScanLoggedRef.current = 0;
    lastScanPathsLoggedRef.current = -1;
    lastPhaseLoggedRef.current = '';

    const tick = () => {
      void fetchProgressOnce(progressId).then((p) => {
        if (!p) return;
        applyProgressSnapshot(p);
        if (p.done && p.phase === 'error') {
          setRows([{ file: '(전체)', category: 'core', status: 'fail', error: p.error ?? p.message }]);
        }
      });
    };

    tick();
    pollTimerRef.current = setInterval(tick, 300);
  };

  const stats = useMemo(() => {
    const by = {
      core: 0,
      runtime: 0,
      data: 0,
      ok: 0,
      fail: 0,
      skipped: 0,
    };
    for (const r of rows) {
      by[r.category] += 1;
      if (r.status === 'ok') by.ok += 1;
      if (r.status === 'fail') by.fail += 1;
      if (r.status === 'skipped') by.skipped += 1;
    }
    return by;
  }, [rows]);

  const patchStages = (
    patch: Partial<Record<StageId, Partial<Pick<StageItem, 'state' | 'detail' | 'detailExclude' | 'title'>>>>
  ) => {
    setStages((prev) =>
      prev.map((s) => {
        const p = patch[s.id as StageId];
        if (!p) return s;
        return {
          ...s,
          state: p.state ?? s.state,
          detail: p.detail ?? s.detail,
          detailExclude: p.detailExclude ?? s.detailExclude,
          title: p.title !== undefined ? p.title : s.title,
        };
      })
    );
  };

  const setStageActive = (id: StageId, detail?: string) => {
    const stageOrder = buildBaseStages(includeNodeModules).map((s) => s.id);
    const idx = stageOrder.indexOf(id);
    setStages((prev) =>
      prev.map((s) => {
        const sidx = stageOrder.indexOf(s.id);
        if (s.id === id) return { ...s, state: 'active', detail: detail ?? s.detail };
        if (sidx < idx && s.state !== 'error') return { ...s, state: 'done' };
        return s;
      })
    );
    setProgressText(STAGE_LABEL[id]);
  };

  const mergeServerStages = (localStages?: StageReport[], remoteStages?: StageReport[]) => {
    const merged = applyStageReports([...(localStages ?? []), ...(remoteStages ?? [])]);
    patchStages(merged);
    return merged;
  };

  const runBuildCheck = async () => {
    buildAbortRef.current?.abort();
    buildAbortRef.current = new AbortController();
    const signal = buildAbortRef.current.signal;
    buildCheckStartedAtRef.current = Date.now();
    buildCheckPhaseRef.current = 'copy';
    buildCheckPhaseStartedAtRef.current = Date.now();
    setBuildChecking(true);
    beginLiveLogSession('빌드 확인 시작 (demo env · NODE_ENV=production · 임시 복사본)...');
    const notePhase = (next: BuildCheckEtaPhase) => {
      if (buildCheckPhaseRef.current === next) return;
      buildCheckPhaseRef.current = next;
      buildCheckPhaseStartedAtRef.current = Date.now();
    };
    try {
      const res = await fetch('/api/source/upload/build-check', {
        method: 'POST',
        signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `빌드 확인 실패 (${res.status})`);
      }
      if (!res.body) {
        throw new Error('응답 본문이 없습니다.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handleNdjsonLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: {
          type?: string;
          line?: string;
          ok?: boolean;
          message?: string;
          error?: string;
          cancelled?: boolean;
        };
        try {
          parsed = JSON.parse(trimmed) as typeof parsed;
        } catch {
          return;
        }
        if (parsed.type === 'log' && parsed.line) {
          const logLine = parsed.line;
          appendLog(logLine);
          if (/npm run build/i.test(logLine)) notePhase('build');
          else if (/npm install/i.test(logLine)) notePhase('install');
          else if (/임시 복사|임시 워크스페이스/i.test(logLine)) notePhase('copy');
        } else if (parsed.type === 'done') {
          if (parsed.cancelled) {
            appendLog('빌드 확인이 취소되었습니다.');
          } else {
            buildCheckCompletedOnceRef.current = true;
            appendLog(parsed.ok ? '빌드 성공' : `빌드 실패: ${parsed.message ?? ''}`);
          }
        } else if (parsed.type === 'error') {
          appendLog(`오류: ${parsed.error ?? 'unknown'}`);
        }
      };
      while (true) {
        if (signal.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          handleNdjsonLine(line);
        }
      }
      if (buffer.trim()) {
        handleNdjsonLine(buffer);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        appendLog('빌드 확인이 취소되었습니다.');
      } else {
        appendLog(`오류: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setBuildChecking(false);
      buildAbortRef.current = null;
      buildCheckStartedAtRef.current = 0;
    }
  };

  const runUploadCurrentWorkspace = async (confirmDbMismatch = false) => {
    if (!confirmDbMismatch) {
      setRows([]);
      setChunkProgress(null);
      setUploadMeta({});
      beginLiveLogSession('preflight 시작');
    } else {
      appendLog('DB 불일치 확인 후 업로드 계속');
    }
    startedAtRef.current = Date.now();
    completeStartedAtRef.current = 0;
    setUploading(true);
    setProgressPhase('idle');
    setProgressPct(2);
    setStages(buildBaseStages(includeNodeModules));
    setDbConfirm(null);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const progressId = createProgressId();
    progressIdRef.current = progressId;
    remoteUploadIdRef.current = null;
    uploadHistoryRecordedRef.current = false;

    try {
      setStageActive('preflight');
      const preRes = await fetch('/api/source/upload/preflight', { signal, cache: 'no-store' });
      const preJson = (await preRes.json()) as {
        ok?: boolean;
        remoteBase?: string;
        targetHost?: string;
        targetIp?: string;
        targetLabel?: string;
        errorSummary?: string;
        error?: string;
        checks?: { id: string; ok: boolean; message: string }[];
      };
      if (!preRes.ok || !preJson.ok) {
        const msg =
          preJson.errorSummary ??
          preJson.error ??
          preJson.checks?.find((c) => !c.ok)?.message ??
          '대상 서버 preflight 실패';
        patchStages({
          preflight: { state: 'error', detail: msg },
        });
        await recordFinalUploadHistoryClient({
          status: 'fail',
          body: buildSourceUploadFailBody(msg),
        });
        throw new Error(msg);
      }
      patchStages({
        preflight: {
          state: 'done',
          detail:
            preJson.targetLabel ??
            ([preJson.targetIp ? `IP=${preJson.targetIp}` : null, preJson.remoteBase ? `URL=${preJson.remoteBase}` : null]
              .filter(Boolean)
              .join(', ') ||
              preJson.checks?.filter((c) => c.id !== 'target').map((c) => c.message).join(' | ')),
        },
      });
      preflightDetailRef.current =
        preJson.targetLabel ??
        preJson.checks?.filter((c) => c.id !== 'target').map((c) => c.message).join(' | ') ??
        preJson.remoteBase ??
        '';
      setProgressPct(8);
      if (preJson.remoteBase) setLastSavedRoot(preJson.remoteBase);
      appendLog('preflight 완료');

      const regRes = await fetch('/api/source/upload/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressId }),
        signal,
      });
      if (!regRes.ok) {
        throw new Error('업로드 progress 등록 실패');
      }

      patchStages({ preflight: { state: 'done', detail: preflightDetailRef.current } });
      startProgressPoll(progressId);
      appendLog(`업로드 job=${progressId}`);

      const res = await fetch('/api/source/upload/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          date,
          changeNote,
          skipPreflight: true,
          progressId,
          includeNodeModules,
          confirmDbMismatch,
          clientIp: await resolveClientMachineIp(),
        }),
        signal,
      });

      stopPoll();

      let json: Record<string, unknown>;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new Error('서버 응답을 읽을 수 없습니다 (연결 끊김 또는 타임아웃)');
      }

      if (res.status === 401) {
        await recordFinalUploadHistoryClient({
          status: 'fail',
          body: buildSourceUploadFailBody('인증 필요'),
        });
      }

      if (res.status === 409 && json.dbCompareRequired) {
        const dbCompare = json.dbCompare as { diffCount?: number; dialogSummary?: string } | undefined;
        setUploading(false);
        setDbConfirm({
          open: true,
          diffCount: dbCompare?.diffCount ?? 0,
          summary: dbCompare?.dialogSummary ?? String(json.error ?? ''),
          progressId,
        });
        patchStages({
          dbCompare: {
            state: 'error',
            detail: `스키마 SQL ↔ DB 차이 ${dbCompare?.diffCount ?? '?'}건`,
          },
        });
        if (json.historyRecorded === true) {
          uploadHistoryRecordedRef.current = true;
          notifyDevVersionHistoryRefresh();
        } else {
          await recordFinalUploadHistoryClient({
            status: 'fail',
            body: buildSourceUploadFailBody(String(json.error ?? 'DB 스키마 불일치')),
          });
        }
        setProgressText('DB 스키마 불일치 — 확인 필요');
        appendLog('DB 불일치 — 사용자 확인 대기');
        return;
      }

      mergeServerStages(
        json.localStages as StageReport[] | undefined,
        json.remoteStages as StageReport[] | undefined
      );

      if (!res.ok) {
        const failedStage = typeof json.failedStage === 'string' ? json.failedStage : '';
        const stageMsg = failedStage ? `[${failedStage}] ` : '';
        const sentChunks = typeof json.sentChunks === 'number' ? json.sentChunks : null;
        const expectedChunks = typeof json.expectedChunks === 'number' ? json.expectedChunks : null;
        const chunkIndex = typeof json.chunkIndex === 'number' ? json.chunkIndex : null;
        const chunkMsg =
          sentChunks != null && expectedChunks != null ? ` (청크 ${sentChunks}/${expectedChunks}` : '';
        const chunkIdx = chunkIndex != null ? `, 중단 index=${chunkIndex})` : chunkMsg ? ')' : '';
        const errText = String(json.error ?? 'source upload failed');
        if (json.historyRecorded === true) {
          uploadHistoryRecordedRef.current = true;
          notifyDevVersionHistoryRefresh();
        } else {
          await recordFinalUploadHistoryClient({
            status: 'fail',
            body: buildSourceUploadFailBody(errText),
            version: typeof json.bundleRoot === 'string' ? json.bundleRoot : undefined,
          });
        }
        throw new Error(`${stageMsg}${errText}${chunkMsg}${chunkIdx}`);
      }

      setLastSavedRoot(
        [json.remoteBase, json.zipName].filter(Boolean).join(' / ') || preJson.remoteBase || null
      );
      const skippedItems = Array.isArray(json.items)
        ? (json.items as UploadRow[]).filter((x) => x.status === 'skipped')
        : [];
      setRows(Array.isArray(json.items) ? (json.items as UploadRow[]) : []);

      const remoteResult = json.remoteResult as
        | { sentChunks?: number; expectedChunks?: number; chunkSize?: number }
        | undefined;
      const chunkDetail =
        remoteResult?.sentChunks != null
          ? `${remoteResult.sentChunks}/${remoteResult.expectedChunks ?? '?'} (${Math.round(
              Number(remoteResult.chunkSize ?? 0) / 1024
            )}KB)`
          : undefined;

      const scanSkippedTitle =
        skippedItems.length > 0
          ? skippedItems
              .slice(0, 40)
              .map((x) => x.file)
              .concat(skippedItems.length > 40 ? [`…외 ${skippedItems.length - 40}건`] : [])
              .join('\n')
          : undefined;

      const scanSummary = json.scanSummary as { included?: number; skipped?: number } | undefined;
      const skipCount = scanSummary?.skipped ?? skippedItems.length;
      patchStages({
        scan: {
          state: 'done',
          detail: `포함 ${scanSummary?.included ?? '?'}`,
          detailExclude: `제외 ${skipCount}`,
          title: skipCount > 0 ? scanSkippedTitle : undefined,
        },
        dbCompare: { state: 'done' },
        zip: { state: 'done', detail: typeof json.zipName === 'string' ? json.zipName : undefined },
        init: { state: 'done' },
        chunk: { state: 'done', detail: chunkDetail },
        complete: { state: 'done' },
        npmInstall: includeNodeModules
          ? { state: 'done', detail: '생략 (node_modules 포함)' }
          : { state: 'done', detail: '완료' },
        finalize: {
          state: 'done',
          detail: `성공 ${json.ok ?? 0}, 제외 ${json.skipped ?? 0}, 실패 ${json.fail ?? 0}`,
        },
      });

      if (json.historyRecorded === true) {
        uploadHistoryRecordedRef.current = true;
        notifyDevVersionHistoryRefresh();
      } else {
        await recordFinalUploadHistoryClient({
          status: 'success',
          body: buildSourceUploadSuccessBody(
            Number(json.ok ?? 0),
            Number(json.skipped ?? 0),
            Number(json.fail ?? 0),
            includeNodeModules ? 'npm install 생략' : 'npm install 완료'
          ),
          version: typeof json.bundleRoot === 'string' ? json.bundleRoot : undefined,
        });
      }

      setProgressPct(100);
      appendLog('업로드 전체 완료');
      setProgressText(
        `업로드 완료 (성공 ${json.ok ?? 0} / 제외 ${json.skipped ?? 0} / 실패 ${json.fail ?? 0})`
      );
    } catch (e: unknown) {
      stopPoll();
      const msg = e instanceof Error ? e.message : String(e);
      const isAbort = e instanceof Error && e.name === 'AbortError';
      const display = isAbort ? '사용자가 취소했습니다.' : msg;

      if (!isAbort && progressId) {
        try {
          const pr = await fetch(`/api/source/upload/progress?id=${encodeURIComponent(progressId)}`, {
            cache: 'no-store',
          });
          if (pr.ok) {
            const snap = (await pr.json()) as UploadProgressPayload;
            applyProgressSnapshot(snap);
            if (snap.error && !display.includes(snap.error)) {
              appendLog(`최종 상태: ${snap.error}`);
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!isAbort && !uploadHistoryRecordedRef.current) {
        await recordFinalUploadHistoryClient({
          status: 'fail',
          body: buildSourceUploadFailBody(display),
        });
      }

      setRows([{ file: '(전체)', category: 'core', status: 'fail', error: display }]);
      appendLog(`실패: ${display}`);
      setStages((prev) => {
        const failedStage = prev.find((s) => s.state === 'error')?.id;
        const active = failedStage ?? prev.find((s) => s.state === 'active')?.id ?? 'scan';
        return prev.map((s) =>
          s.id === active || (s.state === 'active' && !failedStage)
            ? { ...s, state: 'error', detail: display }
            : s
        );
      });
      setProgressText(`실패: ${display}`);
    } finally {
      stopPoll();
      setUploading(false);
      setProgressPhase('idle');
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      {dbConfirm?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded border bg-background p-4 shadow-lg">
            <div className="mb-2 text-sm font-medium">접속 DB와 스키마 SQL이 다릅니다.</div>
            <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">
              차이 {dbConfirm.diffCount}건
              {'\n'}
              {dbConfirm.summary}
            </p>
            <p className="mb-3 text-xs">이 상태로 업로드를 계속하시겠습니까?</p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                title="중단"
                onClick={() => {
                  setDbConfirm(null);
                  appendLog('업로드 중단 — DB 스키마 불일치');
                  setProgressText('업로드 중단 — DB 스키마 불일치');
                }}
              >
                중단
              </Button>
              <Button
                type="button"
                title="계속 진행"
                onClick={() => {
                  setDbConfirm(null);
                  void runUploadCurrentWorkspace(true);
                }}
              >
                계속 진행
              </Button>
            </div>
          </div>
        </div>
      )}

      {buildCheckSkipConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded border bg-background p-4 shadow-lg">
            <div className="mb-2 text-sm font-medium">빌드 검사를 하지 않았습니다.</div>
            <p className="mb-3 text-xs text-muted-foreground">
              빌드 검사 없이 현재 코드를 바로 업로드하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                title="중단"
                onClick={() => setBuildCheckSkipConfirmOpen(false)}
              >
                중단
              </Button>
              <Button
                type="button"
                title="계속 진행"
                onClick={() => {
                  setBuildCheckSkipConfirmOpen(false);
                  void runUploadCurrentWorkspace(false);
                }}
              >
                계속 진행
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b text-sm">
        <button
          type="button"
          className={`border-b-2 px-3 py-2 ${
            mainTab === 'install_download'
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground'
          }`}
          disabled={uploading || buildChecking}
          onClick={() => setMainTab('install_download')}
        >
          설치파일 다운로드
        </button>
        <button
          type="button"
          className={`border-b-2 px-3 py-2 ${
            mainTab === 'source_upload'
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground'
          }`}
          onClick={() => setMainTab('source_upload')}
        >
          소스코드 업로드
        </button>
      </div>

      {mainTab === 'install_download' ? (
        <InstallZipDownloadPanel />
      ) : (
        <>
      <div className="rounded border p-3">
        <p className="mb-2 text-xs text-muted-foreground">
            - 빌드 검사: 현재 소스 임시 복사본에서 npm run build해 빌드 가능한 상태인지 검사
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
            - 현재 코드 자동 업로드: GNMS로 현재 소스 업로드
        </p>
        <div className="mb-2 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'install'} onChange={() => setMode('install')} disabled={uploading || buildChecking} />
            설치
          </label>
          <label className="flex items-center gap-1 opacity-50">
            <input
              type="radio"
              checked={mode === 'update'}
              onChange={() => setMode('update')}
              disabled
              title="현재는 설치용 업로드만 지원합니다."
            />
            <span title="현재는 설치용 업로드만 지원합니다.">업데이트 (준비 중)</span>
          </label>
        </div>
        <div className="mb-2 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={includeNodeModules}
              onChange={() => setIncludeNodeModules(true)}
              disabled={uploading || buildChecking}
            />
            node_modules 포함
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={!includeNodeModules}
              onChange={() => setIncludeNodeModules(false)}
              disabled={uploading || buildChecking}
            />
            node_modules 미포함
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            className="h-9 rounded border px-2 text-sm"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={uploading || buildChecking}
          />
          <input
            className="h-9 rounded border px-2 text-sm md:col-span-2"
            placeholder="변경 사항 메모 (선택)"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            disabled={uploading || buildChecking}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
              type="button"
              variant="outline"
              disabled={uploading || buildChecking}
              title="빌드 확인 (demo env · NODE_ENV=production · 임시 복사본 · 원본 무영향)"
              onClick={() => void runBuildCheck()}
              className="gap-1"
            >
              {buildChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
              빌드 검사
          </Button>
          <Button
            type="button"
            disabled={uploading || buildChecking}
            title="현재 코드 자동 업로드"
            onClick={() => {
              if (!buildCheckCompletedOnceRef.current) {
                setBuildCheckSkipConfirmOpen(true);
                return;
              }
              void runUploadCurrentWorkspace(false);
            }}
            className="gap-1"
          >
            <Upload className="h-4 w-4" />
            현재 코드 자동 업로드
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              buildChecking
                ? false
                : !uploading || cancelBlocked
            }
            title={
              buildChecking
                ? '빌드 검사 취소'
                : cancelBlocked
                  ? cancelBlockedTitle
                  : uploading
                    ? '업로드 취소'
                    : '취소'
            }
            onClick={() => {
              if (buildChecking) {
                buildAbortRef.current?.abort();
                return;
              }
              if (cancelBlocked) return;
              const uploadId = remoteUploadIdRef.current;
              const progressId = progressIdRef.current;
              if (uploadId || progressId) {
                void fetch('/api/source/upload/cancel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    uploadId: uploadId || undefined,
                    progressId: progressId || undefined,
                    reason: 'user_abort',
                  }),
                  keepalive: true,
                }).catch(() => {});
              }
              abortControllerRef.current?.abort();
            }}
            className="cursor-pointer"
          >
            취소
          </Button>
          {lastSavedRoot && <span className="truncate text-xs text-muted-foreground">전송 대상: {lastSavedRoot}</span>}
        </div>
        {buildChecking && buildCheckEtaLabel ? (
          <p className="mt-2 text-xs text-muted-foreground">
            빌드 검사 중 (예상 소요 시간: {buildCheckEtaLabel})
          </p>
        ) : null}
      </div>

      {uploading && (
        <div className="rounded border bg-muted/20 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex shrink-0 items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progressText}
            </span>
            {etaLabel ? (
              <span className="truncate text-muted-foreground">(예상 소요 시간: {etaLabel})</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="shrink-0 text-muted-foreground">{progressPct}%</span>
          </div>
          {chunkProgress && chunkProgress.expected > 0 && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>청크 전송</span>
                <span>
                  {chunkProgress.sent}/{chunkProgress.expected} (
                  {Math.round((chunkProgress.sent / chunkProgress.expected) * 100)}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{
                    width: `${Math.round((chunkProgress.sent / chunkProgress.expected) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <ProgressStagesList stages={stages} />

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-h-0 min-w-0 flex-[1] flex-col overflow-hidden rounded border bg-muted/10">
          <div className="shrink-0 border-b px-3 py-1.5 font-sans text-xs font-medium text-muted-foreground">
            실시간 로그
          </div>
          <div ref={liveLogScrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px]">
            {liveLogs.length === 0 ? (
              <div className="text-muted-foreground">로그 대기 중...</div>
            ) : (
              liveLogs.map((line, i) => (
                <div key={`${i}-${line}`} className="whitespace-pre-wrap break-all leading-relaxed">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-2">
          <div className="rounded border p-2 text-xs">
            <span className="mr-3">core {stats.core}</span>
            <span className="mr-3">runtime {stats.runtime}</span>
            <span className="mr-3">data {stats.data}</span>
            <span className="mr-3 text-green-700 dark:text-green-400">성공 {stats.ok}</span>
            <span className="mr-3 text-red-700 dark:text-red-400">실패 {stats.fail}</span>
            <span
              className={`text-muted-foreground ${stats.skipped > 0 ? 'cursor-help' : ''}`}
              title={
                stats.skipped > 0
                  ? rows
                      .filter((r) => r.status === 'skipped')
                      .slice(0, 40)
                      .map((r) => r.file)
                      .concat(
                        stats.skipped > 40 ? [`…외 ${stats.skipped - 40}건`] : []
                      )
                      .join('\n') || `제외 ${stats.skipped}건`
                  : undefined
              }
            >
              스킵 {stats.skipped}
            </span>
          </div>

          {!uploading && progressText !== '대기 중' && (
            <div className="rounded border bg-muted/10 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span>{progressText}</span>
                <span className="text-muted-foreground">{progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <section className="min-h-0 flex-1 overflow-auto rounded border">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left text-muted-foreground">
                  <th className="w-16 px-2 py-1">분류</th>
                  <th className="w-[50%] max-w-[12rem] px-2 py-1">파일</th>
                  <th className="w-14 px-2 py-1 text-center">상태</th>
                  <th className="px-2 py-1">비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">
                      업로드 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.file}-${i}`} className="border-t">
                      <td className="px-2 py-1">{r.category}</td>
                      <td className="truncate px-2 py-1" title={r.file}>
                        {r.file}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {r.status === 'ok'
                          ? '완료'
                          : r.status === 'skipped'
                            ? (
                                <span className="cursor-help" title={r.file}>
                                  제외
                                </span>
                              )
                            : r.status === 'fail'
                              ? '실패'
                              : '대기'}
                      </td>
                      <td className="truncate px-2 py-1 text-red-600 dark:text-red-400">{r.error ?? ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </div>

        
      </div>
        </>
      )}
    </div>
  );
}
