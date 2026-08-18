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
import { mergeApplyStepPct, type MergeApplyEtaStep } from '@/lib/sourceProgressEta';
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
  const schemaDecisionRef = useRef<((action: 'continue' | 'abort') => void) | null>(null);
  const logRef = useRef<string[]>([]);
  const versionDetailRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const historyRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mergeCountRef = useRef<{ applied: number; total: number } | null>(null);
  const mergeStepRef = useRef<MergeApplyEtaStep | null>(null);

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

  /** 병합 반영 후 스키마 집계 모달 → 진행=재기동 / 중단=백업 롤백 */
  const waitSchemaPreviewAck = async (
    pendingId: string | undefined
  ): Promise<'continue' | 'abort'> => {
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

    const action = await new Promise<'continue' | 'abort'>((resolve) => {
      schemaDecisionRef.current = (a) => {
        schemaDecisionRef.current = null;
        setSchemaModalOpen(false);
        resolve(a);
      };
    });

    if (!pendingId?.trim()) {
      throw new Error(
        '스키마 안내 대기 세션이 없습니다. 적용을 다시 시도하거나 서버 로그를 확인하세요.'
      );
    }

    if (action === 'abort') {
      pushLog('적용 중단 — 직전 소스로 롤백 중…');
      const res = await fetch('/api/dev/schema-sync/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        rollbackDetail?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `중단 실패 (HTTP ${res.status})`);
      }
      pushLog(`롤백 완료${json.rollbackDetail ? ` — ${json.rollbackDetail}` : ''}`);
    } else {
      pushLog('스키마 안내 확인 — 재기동 예약 중…');
      const res = await fetch('/api/dev/schema-sync/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        restart?: { message?: string; scheduled?: boolean };
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `진행 확정 실패 (HTTP ${res.status})`);
      }
      if (json.restart?.message) {
        pushLog(`재시작: ${json.restart.message}`);
      }
    }

    return action;
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
    mergeCountRef.current = null;
    mergeStepRef.current = null;
    setProgress({
      ...emptySideProgress(),
      message: selectedEntry.isLatest ? 'GNMS 최신 버전 조회 중...' : 'GNMS 선택 버전 준비 중...',
      pct: 2,
    });
    setStages(buildRelayBaseStages(opts));
    /** 스키마 확인 후 재시작이 예약된 뒤에만 soft-disconnect(정상 끊김) 허용 */
    let restartCommitAfterSchema = false;
    /** 재기동 대기·하드 리로드 중에는 busy 유지 */
    let keepBusyUntilReload = false;

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
          if (p.phase === 'merge-apply') {
            const step: MergeApplyEtaStep =
              p.mergeStep ??
              (p.appliedFiles != null && p.appliedFiles > 0
                ? 'copy'
                : mergeStepRef.current ?? 'extract');
            if (mergeStepRef.current !== step) {
              mergeStepRef.current = step;
            }
            if (p.totalFiles != null && p.totalFiles > 0 && p.appliedFiles != null) {
              mergeCountRef.current = { applied: p.appliedFiles, total: p.totalFiles };
            }
          } else {
            mergeCountRef.current = null;
            mergeStepRef.current = null;
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
                            : p.phase === 'schema-wait'
                              ? 98
                              : p.phase === 'app-stop'
                                ? 99
                                : p.phase === 'download'
                                  ? 20
                                  : null;
          if (p.phase === 'latest' && p.message.includes('version=')) {
            versionDetailRef.current = p.message.replace(/^latest:\s*/i, '');
          }
          setProgress((prev) => ({
            ...prev,
            message: p.message,
            pct: pct ?? prev.pct,
          }));
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
                npmInstallDetail:
                  p.phase === 'npm-install' || p.phase === 'schema-wait' || p.phase === 'build'
                    ? profile === 'open'
                      ? '사전 npm install 완료'
                      : undefined
                    : undefined,
                buildDetail:
                  p.phase === 'build' || p.phase === 'schema-wait'
                    ? '사전 빌드 완료'
                    : undefined,
                schemaWaiting: p.phase === 'schema-wait',
                preRestartCompleted:
                  p.phase === 'schema-wait' ||
                  p.phase === 'npm-install' ||
                  p.phase === 'build',
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
            message: json.pendingSchemaConfirm
              ? '적용 완료 · 스키마 안내 대기'
              : json.restart?.scheduled
                ? '적용 완료 · 재시작 파이프라인 예약'
                : '적용 완료',
            versionDetail: versionDetailRef.current,
            applyDetail: json.pendingSchemaConfirm
              ? `prepare 완료 · commit 대기 ${json.appliedFiles}건`
              : `적용 ${json.appliedFiles}건 · 제외 ${json.skippedFiles}건`,
            geoserverStopDetail: json.geoserver?.stopMessage ?? json.geoserver?.message,
            geoserverStartDetail: json.geoserver?.startMessage,
            appStopDetail: json.pendingSchemaConfirm
              ? '스키마 안내 대기 (commit 전)'
              : json.restart?.scheduled
                ? doneMode === 'exit'
                  ? '앱 종료 단계 완료 · process.exit 예약'
                  : '앱 종료 단계 완료 · 런처가 Next 종료'
                : undefined,
            npmInstallDetail:
              json.restart?.scheduled && !json.pendingSchemaConfirm && profile === 'open'
                ? '사전 npm install 완료'
                : undefined,
            buildDetail:
              json.restart?.scheduled && !json.pendingSchemaConfirm
                ? '사전 빌드 완료'
                : undefined,
            appStartDetail:
              json.restart?.scheduled && doneMode === 'launcher'
                ? '콘솔(런처)에서 Next 재기동'
                : json.restart?.message,
            restartScheduled: Boolean(json.restart?.scheduled),
            schemaWaiting: Boolean(json.pendingSchemaConfirm),
            preRestartCompleted: Boolean(json.restart?.scheduled) && !json.pendingSchemaConfirm,
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
          : json.pendingSchemaConfirm
            ? 'prepare 완료. 스키마 안내에서 [진행] 시 commit·재기동…'
            : '최신 소스 적용 완료. 스키마 변경 안내…',
        pct: 100,
        logs: logRef.current,
        error: null,
      });

      let schemaAction: 'continue' | 'abort' = 'continue';
      try {
        schemaAction = await waitSchemaPreviewAck(json.pendingId);
      } catch (schemaErr: unknown) {
        const msg = schemaErr instanceof Error ? schemaErr.message : String(schemaErr);
        pushLog(`스키마 안내 처리 실패: ${msg}`);
        setProgress((p) => ({
          ...p,
          message: '취소됨 — 스키마 안내 처리 실패',
          error: msg,
        }));
        busyRef.current = false;
        setBusy(false);
        return;
      }

      if (schemaAction === 'abort') {
        setProgress({
          message: '취소됨 — 적용 직전 소스로 되돌렸습니다.',
          pct: 100,
          logs: logRef.current,
          error: null,
        });
        setStages(
          buildRelayStagesFromProgress(
            {
              phase: 'done',
              message: '적용 취소',
              versionDetail: versionDetailRef.current,
              applyDetail: '사용자가 스키마 안내에서 중단 · 백업 롤백',
              restartScheduled: false,
            },
            { ...doneOpts, restart: false, restartMode: 'none' }
          )
        );
        await refreshAppliedVersion();
        notifyDevVersionHistoryRefresh();
        return;
      }

      if (json.restart?.requested || doneMode !== 'none') {
        restartCommitAfterSchema = true;
        setStages(
          buildRelayStagesFromProgress(
            {
              phase: 'done',
              message: '적용 확정 · 재시작 예약',
              versionDetail: versionDetailRef.current,
              applyDetail: `적용 ${json.appliedFiles}건 · 제외 ${json.skippedFiles}건`,
              geoserverStopDetail: json.geoserver?.stopMessage ?? json.geoserver?.message,
              geoserverStartDetail: json.geoserver?.startMessage,
              npmInstallDetail: profile === 'open' ? '사전 npm install 완료' : undefined,
              buildDetail: '사전 빌드 완료',
              appStopDetail:
                doneMode === 'exit'
                  ? '앱 종료 단계 완료 · process.exit 예약'
                  : '앱 종료 단계 완료 · 런처가 Next 종료',
              appStartDetail:
                doneMode === 'launcher' ? '콘솔(런처)에서 Next 재기동' : undefined,
              restartScheduled: true,
              preRestartCompleted: true,
              geoserverStartOk: !(
                json.geoserver?.started === false && !json.geoserver?.deferredStart
              ),
            },
            doneOpts
          )
        );
      }

      if (json.restart?.requested || json.pendingSchemaConfirm) {
        pushLog(
          doneMode === 'exit'
            ? '재시작 예약: 사전 빌드·앱 종료 완료 → process.exit → nssm/런처 재기동'
            : doneMode === 'launcher'
              ? '재시작 예약: 사전 빌드·앱 종료 완료 → 런처가 Next 재기동'
              : '적용 확정 완료'
        );
      }

      if (json.restart?.requested || doneMode !== 'none') {
        keepBusyUntilReload = true;
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

      await refreshAppliedVersion();
      notifyDevVersionHistoryRefresh();
      pushLog('화면 새로고침(세션 유지)…');
      keepBusyUntilReload = true;
      void hardReloadKeepSessionAfterDelay(1000);
      return;
    } catch (e: unknown) {
      const isAbort = isUserAbortError(e);
      const isTimeout = isRelayTimeoutError(e);
      const isDisconnect = isRestartDisconnectError(e);
      /** 스키마 확인·재시작 예약 후 서버 종료로 끊긴 경우 — 실패 UI 대신 안내 */
      if (!isAbort && isDisconnect && restart && restartCommitAfterSchema) {
        keepBusyUntilReload = true;
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
              preRestartCompleted: true,
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
      if (!keepBusyUntilReload) {
        busyRef.current = false;
        setBusy(false);
      }
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

  const ProgressBar = () => {
    if (!busy || progress.pct == null) return null;
    return (
      <div className="mt-2 rounded border bg-muted/20 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span>진행 중</span>
          <span className="shrink-0 text-muted-foreground">{progress.pct}%</span>
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
            이 서버가 GNMS에서 소스 ZIP을 받아 반영합니다. 버전을 고른 뒤 서버 상태를 선택하세요.
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
          {progress.error && (
            <p className="whitespace-pre-wrap break-words text-xs text-red-600">{progress.error}</p>
          )}
        </div>
        <ProgressStagesList
          stages={stages}
          className="shrink-0 rounded border px-3 py-2 text-xs"
        />
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-[1] flex-col overflow-hidden">
            <LiveLogsPanel logs={progress.logs} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-[2] flex-col overflow-hidden rounded border bg-muted/10">
            <div className="shrink-0 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
              적용 결과
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
              {relayResult ? (
                <div className="space-y-1">
                  <div>적용: {relayResult.appliedFiles}건</div>
                  <div>제외: {relayResult.skippedFiles}건</div>
                  <div>
                    GeoServer 중지:{' '}
                    {relayResult.geoserver?.stopMessage ?? relayResult.geoserver?.message ?? '-'}
                  </div>
                  {relayResult.geoserver?.startMessage ? (
                    <div>GeoServer 기동: {relayResult.geoserver.startMessage}</div>
                  ) : null}
                  <div>재시작: {relayResult.restart?.message}</div>
                </div>
              ) : (
                <div className="text-muted-foreground">적용 결과가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <SchemaSyncPreviewModal
        open={schemaModalOpen}
        preview={schemaPreview}
        loading={schemaPreviewLoading}
        onContinue={() => {
          schemaDecisionRef.current?.('continue');
        }}
        onAbort={() => {
          schemaDecisionRef.current?.('abort');
        }}
      />
    </div>
  );
}
