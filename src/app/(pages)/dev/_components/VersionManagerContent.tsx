'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { LiveLogsPanel } from './LiveLogsPanel';
import { ProgressStagesList } from './ProgressStagesList';
import {
  buildRelayBaseStages,
  buildRelayStagesFromProgress,
  patchStages,
} from './versionManagerStages';
import type { SourcePackageProfile } from './sourceUpload/sourceUploadProfiles';
import {
  fetchGnmsVersionList,
  isRelayTimeoutError,
  isRestartDisconnectError,
  isUserAbortError,
  relayLatestSourceFromGnms,
  type GnmsVersionListEntry,
  type RestartMode,
  type VersionRelayProgress,
  type VersionRelayResult,
} from '@/lib/sourceVersionClientRelay';
import { prefetchClientMachineIp } from '@/lib/clientMachineIp';
import {
  estimateRemainingByBytes,
  estimateRemainingSeconds,
  estimateMergeApplyRemainingSeconds,
  estimateVersionApplyTotalSeconds,
  formatEtaMinutes,
  mergeApplyStepPct,
  type MergeApplyEtaStep,
} from '@/lib/sourceProgressEta';
import {
  closeDevVersionHistory,
  notifyDevVersionHistoryRefresh,
  notifyDevVersionHistoryRefreshRetry,
  clearDevVersionHistoryRefreshRetry,
} from './devVersionHistoryBridge';
import {
  hardReloadKeepSessionAfterDelay,
  waitApplyRestartThenHardReload,
} from '@/lib/hardReloadKeepSession';
import {
  resolveAppliedDisplay,
  versionOptionBase,
  versionOptionLabel,
} from '@/lib/gnmsVersionLabel';
import { SchemaSyncPreviewModal } from './SchemaSyncPreviewModal';
import type { SchemaSyncPreviewResult } from '@/lib/schemaSyncPreviewTypes';

type SideProgress = {
  message: string;
  pct: number | null;
  logs: string[];
  error: string | null;
};

function emptySideProgress(): SideProgress {
  return { message: '대기 중', pct: null, logs: [], error: null };
}

function pickDefaultFolder(entries: GnmsVersionListEntry[]): string {
  const latest = entries.find((e) => e.isLatest);
  return (latest ?? entries[0])?.folder ?? '';
}

export function VersionManagerContent() {
  const [profile, setProfile] = useState<SourcePackageProfile>('closed');
  const [restartMode, setRestartMode] = useState<RestartMode>('exit');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SideProgress>(emptySideProgress());
  const [stages, setStages] = useState(() =>
    buildRelayBaseStages({ restart: true, restartMode: 'exit', packageProfile: 'closed' })
  );
  const [relayResult, setRelayResult] = useState<VersionRelayResult | null>(null);
  const [versionEntries, setVersionEntries] = useState<GnmsVersionListEntry[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [appliedVersion, setAppliedVersion] = useState<string | null>(null);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [schemaPreview, setSchemaPreview] = useState<SchemaSyncPreviewResult | null>(null);
  const [schemaPreviewLoading, setSchemaPreviewLoading] = useState(false);
  const schemaConfirmRef = useRef<(() => void) | null>(null);
  const logRef = useRef<string[]>([]);
  const versionDetailRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const historyRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedAtRef = useRef(0);
  const mergeCountRef = useRef<{ applied: number; total: number } | null>(null);
  const mergeStepRef = useRef<MergeApplyEtaStep | null>(null);
  const mergeStepStartedAtRef = useRef(0);
  const mergeCopyStartedAtRef = useRef(0);
  const byteProgressRef = useRef<{ done: number; total: number } | null>(null);
  const byteStartedAtRef = useRef(0);
  const [etaTick, setEtaTick] = useState(0);

  const restart = restartMode !== 'none';
  const stageOpts = {
    restart,
    restartMode,
    packageProfile: profile,
  };
  const selectedEntry = versionEntries.find((e) => e.folder === selectedFolder) ?? null;
  const canApply = !listLoading && !listError && Boolean(selectedFolder) && versionEntries.length > 0;
  const appliedDisplay = resolveAppliedDisplay(appliedVersion, versionEntries) || '기록 없음';

  useEffect(() => {
    return () => {
      closeDevVersionHistory();
      clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
      historyRetryTimersRef.current = [];
    };
  }, []);
  useEffect(() => {
    prefetchClientMachineIp();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const refreshAppliedVersion = async () => {
    try {
      const res = await fetch('/api/dev/version-history/applied', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { version?: string | null };
      const v = typeof json.version === 'string' ? json.version.trim() : '';
      setAppliedVersion(v || null);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshAppliedVersion();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    void (async () => {
      try {
        /** Strict Mode remount 시 abort 하지 않음 — 진행 중 목록 조회는 공유 */
        const { entries } = await fetchGnmsVersionList();
        if (cancelled) return;
        setVersionEntries(entries);
        setSelectedFolder(pickDefaultFolder(entries));
        if (entries.length === 0) {
          setListError('적용 가능한 버전이 없습니다.');
        }
        await refreshAppliedVersion();
      } catch (e: unknown) {
        if (cancelled || isUserAbortError(e)) return;
        setVersionEntries([]);
        setSelectedFolder('');
        setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 대기 중일 때 재시작 방법·프로필 변경 → 단계 목록 즉시 반영 */
  useEffect(() => {
    if (busy) return;
    setStages(buildRelayBaseStages(stageOpts));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stageOpts fields listed
  }, [busy, restartMode, profile]);

  const pushLog = (line: string) => {
    const next = [
      ...logRef.current,
      `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`,
    ].slice(-60);
    logRef.current = next;
    setProgress((p) => ({ ...p, logs: next }));
  };

  /** 병합 반영 후 스키마 집계 모달 → 확인 시 재기동 대기 진행 */
  const waitSchemaPreviewAck = async (): Promise<void> => {
    setSchemaPreviewLoading(true);
    setSchemaPreview(null);
    setSchemaModalOpen(true);
    pushLog('스키마 변경 미리보기 조회 중…');
    try {
      const res = await fetch('/api/dev/schema-sync/preview', { cache: 'no-store' });
      const json = (await res.json()) as SchemaSyncPreviewResult & { error?: string };
      if (!res.ok && !json.counts) {
        setSchemaPreview({
          ok: false,
          error: json.error ?? `HTTP ${res.status}`,
          counts: { create: 0, drop: 0, delete: 0, alter: 0 },
          items: [],
          warnings: [],
          hasDataLoss: false,
        });
      } else {
        setSchemaPreview(json);
      }
    } catch (e: unknown) {
      setSchemaPreview({
        ok: false,
        error: e instanceof Error ? e.message : '미리보기 실패',
        counts: { create: 0, drop: 0, delete: 0, alter: 0 },
        items: [],
        warnings: [],
        hasDataLoss: false,
      });
    } finally {
      setSchemaPreviewLoading(false);
    }

    await new Promise<void>((resolve) => {
      schemaConfirmRef.current = () => {
        schemaConfirmRef.current = null;
        setSchemaModalOpen(false);
        resolve();
      };
    });
    pushLog('스키마 안내 확인 — 재기동 단계 진행');
  };

  const runUpdate = async () => {
    if (busyRef.current) return;
    if (!selectedEntry) {
      setProgress((p) => ({ ...p, error: '버전을 선택하세요.' }));
      return;
    }
    busyRef.current = true;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const opts = {
      restart,
      restartMode,
      packageProfile: profile,
    };

    setBusy(true);
    setRelayResult(null);
    logRef.current = [];
    versionDetailRef.current = '';
    startedAtRef.current = Date.now();
    mergeCountRef.current = null;
    mergeStepRef.current = null;
    mergeStepStartedAtRef.current = 0;
    mergeCopyStartedAtRef.current = 0;
    byteProgressRef.current = null;
    byteStartedAtRef.current = 0;
    setProgress({
      ...emptySideProgress(),
      message: selectedEntry.isLatest ? 'GNMS 최신 버전 조회 중...' : 'GNMS 선택 버전 준비 중...',
      pct: 2,
    });
    setStages(buildRelayBaseStages(opts));
    /** 사전 빌드·앱 종료 진행 중 이후 끊김은 재시작으로 간주 */
    let reachedRestartCommit = false;

    try {
      const versionLabel = versionOptionBase(selectedEntry);
      const json = await relayLatestSourceFromGnms({
        restart,
        restartMode,
        packageProfile: profile,
        folder: selectedEntry.folder,
        versionLabel,
        isLatest: selectedEntry.isLatest,
        signal,
        onProgress: (p: VersionRelayProgress) => {
          if (p.phase === 'npm-install' || p.phase === 'build' || p.phase === 'app-stop') {
            reachedRestartCommit = true;
          }
          if (p.phase === 'merge-apply') {
            const step: MergeApplyEtaStep =
              p.mergeStep ??
              (p.appliedFiles != null && p.appliedFiles > 0
                ? 'copy'
                : mergeStepRef.current ?? 'extract');
            if (mergeStepRef.current !== step) {
              mergeStepRef.current = step;
              mergeStepStartedAtRef.current = Date.now();
              if (step === 'copy' && mergeCopyStartedAtRef.current <= 0) {
                mergeCopyStartedAtRef.current = Date.now();
              }
            }
            if (p.totalFiles != null && p.totalFiles > 0 && p.appliedFiles != null) {
              mergeCountRef.current = { applied: p.appliedFiles, total: p.totalFiles };
              if (p.appliedFiles > 0 && mergeCopyStartedAtRef.current <= 0) {
                mergeCopyStartedAtRef.current = Date.now();
              }
            }
          } else {
            mergeCountRef.current = null;
            mergeStepRef.current = null;
            mergeStepStartedAtRef.current = 0;
            mergeCopyStartedAtRef.current = 0;
          }
          if (p.phase === 'merge-apply' || p.phase === 'geoserver-stop' || p.phase === 'relay-complete') {
            byteProgressRef.current = null;
            byteStartedAtRef.current = 0;
          } else if (p.totalBytes != null && p.totalBytes > 0 && p.bytesDone != null) {
            if (byteStartedAtRef.current <= 0 && p.bytesDone > 0) {
              byteStartedAtRef.current = Date.now();
            }
            byteProgressRef.current = { done: p.bytesDone, total: p.totalBytes };
          }
          const merge = mergeCountRef.current;
          const mergePct =
            p.phase === 'merge-apply'
              ? mergeApplyStepPct(
                  mergeStepRef.current,
                  merge?.applied ?? 0,
                  merge?.total ?? 0
                )
              : null;
          const pct =
            mergePct != null
              ? mergePct
              : p.totalBytes && p.bytesDone != null
                ? Math.min(54, Math.round((p.bytesDone / p.totalBytes) * 54))
                : p.phase === 'latest'
                  ? 5
                  : p.phase === 'relay-init'
                    ? 8
                    : p.phase === 'geoserver-stop' || p.phase === 'relay-complete'
                      ? 55
                      : p.phase === 'geoserver-start'
                        ? 92
                        : p.phase === 'npm-install'
                          ? 94
                          : p.phase === 'build'
                            ? 97
                            : p.phase === 'app-stop'
                              ? 99
                              : null;
          if (p.phase === 'latest' && p.message.includes('version=')) {
            versionDetailRef.current = p.message.replace(/^latest:\s*/i, '');
          }
          setProgress((prev) => ({ ...prev, message: p.message, pct }));
          setStages(
            buildRelayStagesFromProgress(
              {
                phase: p.phase,
                message: p.message,
                chunkIndex: p.chunkIndex,
                totalChunks: p.totalChunks,
                bytesDone: p.bytesDone,
                totalBytes: p.totalBytes,
                versionDetail: versionDetailRef.current || undefined,
                applyDetail:
                  p.phase === 'merge-apply' && p.appliedFiles != null
                    ? p.totalFiles != null && p.totalFiles > 0
                      ? `병합 ${p.appliedFiles}/${p.totalFiles}`
                      : `병합 ${p.appliedFiles}건`
                    : undefined,
              },
              opts
            )
          );
        },
        onLog: (line) => {
          pushLog(line);
          if (line.startsWith('latest:') || line.startsWith('ready:')) {
            versionDetailRef.current = line.replace(/^(latest|ready):\s*/i, '');
            setStages((prev) =>
              patchStages(prev, {
                latest: { state: 'done', detail: versionDetailRef.current },
              })
            );
          }
        },
      });
      setRelayResult(json);
      versionDetailRef.current = `version=${json.version}, file=${json.fileName}`;
      const doneMode = (json.restart?.mode ?? opts.restartMode) as RestartMode;
      const doneOpts = {
        restart: Boolean(json.restart?.scheduled) || doneMode !== 'none',
        restartMode: doneMode,
        packageProfile: profile,
      };
      setStages(
        buildRelayStagesFromProgress(
          {
            phase: 'done',
            message: json.restart?.scheduled
              ? '적용 완료 · 재시작 파이프라인 예약'
              : '적용 완료',
            versionDetail: versionDetailRef.current,
            applyDetail: `적용 ${json.appliedFiles}건 · 제외 ${json.skippedFiles}건`,
            geoserverStopDetail: json.geoserver?.stopMessage ?? json.geoserver?.message,
            geoserverStartDetail: json.geoserver?.startMessage,
            appStopDetail: json.restart?.scheduled
              ? doneMode === 'exit'
                ? '앱 종료 단계 완료 · process.exit 예약'
                : '앱 종료 단계 완료 · 런처가 Next 종료'
              : undefined,
            npmInstallDetail:
              json.restart?.scheduled && profile === 'open'
                ? '사전 npm install 완료'
                : undefined,
            buildDetail: json.restart?.scheduled ? '사전 빌드 완료' : undefined,
            appStartDetail:
              json.restart?.scheduled && doneMode === 'launcher'
                ? '콘솔(런처)에서 Next 재기동'
                : json.restart?.message,
            restartScheduled: Boolean(json.restart?.scheduled),
            geoserverStartOk: !(
              json.geoserver?.started === false && !json.geoserver?.deferredStart
            ),
          },
          doneOpts
        )
      );
      setProgress({
        message: json.restart?.scheduled
          ? '적용 완료. 스키마 변경 안내 확인 후 재기동합니다…'
          : '최신 소스 적용 완료. 스키마 변경 안내…',
        pct: 100,
        logs: logRef.current,
        error: null,
      });

      await waitSchemaPreviewAck();

      if (json.restart?.scheduled) {
        pushLog(
          doneMode === 'exit'
            ? '재시작 예약: 사전 빌드·앱 종료 완료 → process.exit → nssm/런처 재기동'
            : '재시작 예약: 사전 빌드·앱 종료 완료 → 런처가 Next 재기동'
        );
        clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
        historyRetryTimersRef.current = notifyDevVersionHistoryRefreshRetry([
          0, 5_000, 15_000, 30_000, 60_000,
        ]);
        void waitApplyRestartThenHardReload({
          onPhase: (phase) => {
            if (phase === 'server') {
              const msg = '서버 재기동 대기 중… (새로고침하지 마세요)';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            } else if (phase === 'history') {
              const msg = '적용 이력 반영 대기 중…';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            } else {
              const msg = '이력 반영 완료. 화면 새로고침…';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            }
          },
        });
      } else {
        await refreshAppliedVersion();
        notifyDevVersionHistoryRefresh();
        pushLog('화면 새로고침(세션 유지)…');
        void hardReloadKeepSessionAfterDelay(1000);
      }
    } catch (e: unknown) {
      const isAbort = isUserAbortError(e);
      const isTimeout = isRelayTimeoutError(e);
      const isDisconnect = isRestartDisconnectError(e);
      /** 재시작 예약 후 서버 종료로 끊긴 경우 — 실패 UI 대신 안내 */
      if (!isAbort && isDisconnect && restart && reachedRestartCommit) {
        const softOpts = {
          restart: true,
          restartMode,
          packageProfile: profile,
        };
        setStages(
          buildRelayStagesFromProgress(
            {
              phase: 'done',
              message: '적용 완료 · 재시작으로 연결이 끊김',
              versionDetail: versionDetailRef.current || undefined,
              buildDetail: '사전 빌드 완료',
              npmInstallDetail: profile === 'open' ? '사전 npm install 완료' : undefined,
              appStopDetail: '앱 종료 단계 완료',
              appStartDetail:
                restartMode === 'launcher' ? '콘솔(런처)에서 Next 재기동' : undefined,
              restartScheduled: true,
              geoserverStartOk: true,
            },
            softOpts
          )
        );
        setProgress({
          message: '적용·사전 빌드까지 완료했습니다. 서버 재기동 대기 중… (새로고침하지 마세요)',
          pct: 100,
          logs: logRef.current,
          error: null,
        });
        pushLog('재시작으로 연결이 끊김 (정상). 서버 재기동 대기 중… (새로고침하지 마세요)');
        clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
        historyRetryTimersRef.current = notifyDevVersionHistoryRefreshRetry([
          0, 5_000, 15_000, 30_000, 60_000,
        ]);
        void waitApplyRestartThenHardReload({
          onPhase: (phase) => {
            if (phase === 'server') {
              const msg = '서버 재기동 대기 중… (새로고침하지 마세요)';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            } else if (phase === 'history') {
              const msg = '적용 이력 반영 대기 중…';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            } else {
              const msg = '이력 반영 완료. 화면 새로고침…';
              setProgress((p) => ({ ...p, message: msg, pct: 100 }));
              pushLog(msg);
            }
          },
        });
        return;
      }
      const msg = isAbort
        ? '사용자가 취소했습니다.'
        : e instanceof Error
          ? e.message
          : String(e);
      setProgress({
        message: isAbort ? msg : isTimeout ? '시간 초과' : '실패',
        pct: null,
        logs: logRef.current,
        error: isAbort ? null : msg,
      });
      setStages(
        buildRelayStagesFromProgress(
          {
            phase: 'error',
            message: msg,
            error: msg,
          },
          opts
        )
      );
      pushLog(isAbort ? msg : `ERROR: ${msg}`);
      if (!isAbort) {
        notifyDevVersionHistoryRefresh();
      }
    } finally {
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  const sectionClass = 'space-y-1';

  const ProfileRadios = () => (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <label className="flex items-center gap-1">
        <input
          type="radio"
          checked={profile === 'closed'}
          disabled={busy}
          onChange={() => setProfile('closed')}
        />
        폐쇄망 (node_modules 포함)
      </label>
      <label className="flex items-center gap-1">
        <input
          type="radio"
          checked={profile === 'open'}
          disabled={busy}
          onChange={() => setProfile('open')}
        />
        개방망 (node_modules 미포함)
      </label>
    </div>
  );

  const etaLabel = (() => {
    void etaTick;
    if (!busy || startedAtRef.current <= 0) return null;
    if (mergeStepRef.current) {
      const merge = mergeCountRef.current;
      const remain = estimateMergeApplyRemainingSeconds({
        packageProfile: profile,
        mergeStep: mergeStepRef.current,
        applied: merge?.applied ?? 0,
        total: merge?.total ?? 0,
        stepStartedAtMs: mergeStepStartedAtRef.current,
        copyStartedAtMs: mergeCopyStartedAtRef.current,
      });
      return formatEtaMinutes(remain);
    }
    const bytes = byteProgressRef.current;
    if (bytes && bytes.total > 0 && bytes.done > 0 && byteStartedAtRef.current > 0) {
      const remain = estimateRemainingByBytes(bytes.done, bytes.total, byteStartedAtRef.current);
      if (remain != null) return formatEtaMinutes(remain);
    }
    const total = estimateVersionApplyTotalSeconds(profile, restart);
    const remain = estimateRemainingSeconds(total, progress.pct, startedAtRef.current);
    if (remain <= 0) return '산출 중...';
    return formatEtaMinutes(remain);
  })();

  const ProgressBar = () => {
    if (!busy || progress.pct == null) return null;
    return (
      <div className="mt-2 rounded border bg-muted/20 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span>진행 중</span>
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {etaLabel ? (
              <span className="truncate">(예상 소요 시간: {etaLabel})</span>
            ) : null}
            <span className="shrink-0">{progress.pct}%</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded border p-3">
        {/* select·옵션·버튼은 고정 / 단계 목록만 ProgressStagesList 내부 스크롤 */}
        <div className="shrink-0 space-y-2">
          <div className="text-sm font-medium">최신 소스 적용</div>
          <p className="text-xs text-muted-foreground">
            GNMS 소스 ZIP을 브라우저가 중계해 운영 서버에 반영합니다. 버전을 고른 뒤 서버 상태를
            선택하세요.
          </p>
          <div className="space-y-2">
            <div className={sectionClass}>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className="text-xs text-muted-foreground">적용 버전</div>
                <div className="text-xs text-foreground">
                  현재: {appliedDisplay}
                </div>
              </div>
              <select
                className="h-8 w-full max-w-xl rounded border border-input bg-background px-2 text-xs text-foreground disabled:opacity-60"
                value={selectedFolder}
                disabled={busy || listLoading || versionEntries.length === 0}
                onChange={(e) => setSelectedFolder(e.target.value)}
              >
                {listLoading && <option value="">목록 불러오는 중...</option>}
                {!listLoading && versionEntries.length === 0 && (
                  <option value="">버전 없음</option>
                )}
                {versionEntries.map((entry) => (
                  <option key={entry.folder} value={entry.folder}>
                    {versionOptionLabel(entry, appliedVersion)}
                  </option>
                ))}
              </select>
              {listError && <p className="text-xs text-red-600">{listError}</p>}
            </div>
            <div className={sectionClass}>
              <div className="text-xs text-muted-foreground">서버 상태</div>
              <ProfileRadios />
            </div>
            <div className={sectionClass}>
              <div className="text-xs text-muted-foreground">재시작 방식</div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="restartMode"
                    checked={restartMode === 'exit'}
                    disabled={busy}
                    onChange={() => setRestartMode('exit')}
                  />
                  서비스 재실행(프로세스 종료)
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="restartMode"
                    checked={restartMode === 'launcher'}
                    disabled={busy}
                    onChange={() => setRestartMode('launcher')}
                  />
                  Node 런처(Node 내 앱 재실행)
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="restartMode"
                    checked={restartMode === 'none'}
                    disabled={busy}
                    onChange={() => setRestartMode('none')}
                  />
                  재시작 안 함
                </label>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              disabled={busy || !canApply}
              onClick={() => void runUpdate()}
              className="gap-1"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              최신 소스 전체 적용
            </Button>
            <Button type="button" variant="outline" disabled title="준비 중">
              최신소스 일부 적용(준비중)
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!busy}
              onClick={() => abortRef.current?.abort()}
            >
              취소
            </Button>
          </div>
          <ProgressBar />
          <p className="text-xs text-muted-foreground">{progress.message}</p>
          {progress.error && <p className="text-xs text-red-600">{progress.error}</p>}
        </div>
        <div className="min-h-0 shrink space-y-2">
          <ProgressStagesList stages={stages} />
          {relayResult && (
            <div className="rounded border bg-muted/10 p-2 text-xs">
              <div className="mb-1 font-medium text-muted-foreground">적용 결과</div>
              <div>적용: {relayResult.appliedFiles}건</div>
              <div>제외: {relayResult.skippedFiles}건</div>
              <div>GeoServer 중지: {relayResult.geoserver?.stopMessage ?? relayResult.geoserver?.message ?? '-'}</div>
              {relayResult.geoserver?.startMessage ? (
                <div>GeoServer 기동: {relayResult.geoserver.startMessage}</div>
              ) : null}
              <div>재시작: {relayResult.restart?.message}</div>
            </div>
          )}
        </div>
        <div className="flex min-h-[10rem] flex-1 flex-col overflow-hidden">
          <LiveLogsPanel logs={progress.logs} />
        </div>
      </div>
      <SchemaSyncPreviewModal
        open={schemaModalOpen}
        preview={schemaPreview}
        loading={schemaPreviewLoading}
        onConfirm={() => {
          schemaConfirmRef.current?.();
        }}
      />
    </div>
  );
}
