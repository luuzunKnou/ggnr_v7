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
  isRelayTimeoutError,
  isRestartDisconnectError,
  isUserAbortError,
  relayLatestSourceFromGnms,
  type RestartMode,
  type VersionRelayProgress,
  type VersionRelayResult,
} from '@/lib/sourceVersionClientRelay';
import { prefetchClientMachineIp } from '@/lib/clientMachineIp';
import {
  closeDevVersionHistory,
  notifyDevVersionHistoryRefresh,
  notifyDevVersionHistoryRefreshRetry,
  clearDevVersionHistoryRefreshRetry,
} from './devVersionHistoryBridge';
import {
  hardReloadKeepSessionAfterDelay,
  waitServerThenHardReload,
} from '@/lib/hardReloadKeepSession';

type SideProgress = {
  message: string;
  pct: number | null;
  logs: string[];
  error: string | null;
};

function emptySideProgress(): SideProgress {
  return { message: '대기 중', pct: null, logs: [], error: null };
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
  const logRef = useRef<string[]>([]);
  const versionDetailRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const historyRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const restart = restartMode !== 'none';
  const stageOpts = {
    restart,
    restartMode,
    packageProfile: profile,
  };

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

  const runUpdate = async () => {
    if (busyRef.current) return;
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
    setProgress({ ...emptySideProgress(), message: 'GNMS 최신 버전 조회 중...', pct: 2 });
    setStages(buildRelayBaseStages(opts));
    /** 사전 빌드·앱 종료 진행 중 이후 끊김은 재시작으로 간주 */
    let reachedRestartCommit = false;

    try {
      const json = await relayLatestSourceFromGnms({
        restart,
        restartMode,
        packageProfile: profile,
        signal,
        onProgress: (p: VersionRelayProgress) => {
          if (p.phase === 'npm-install' || p.phase === 'build' || p.phase === 'app-stop') {
            reachedRestartCommit = true;
          }
          const mergePct =
            p.phase === 'merge-apply' && p.totalFiles != null && p.totalFiles > 0 && p.appliedFiles != null
              ? 88 + Math.min(5, Math.round((p.appliedFiles / p.totalFiles) * 5))
              : null;
          const pct =
            mergePct != null
              ? mergePct
              : p.totalBytes && p.bytesDone != null
                ? Math.min(100, Math.round((p.bytesDone / p.totalBytes) * 100))
                : p.phase === 'latest'
                  ? 5
                  : p.phase === 'relay-init'
                    ? 15
                    : p.phase === 'geoserver-stop' || p.phase === 'relay-complete'
                      ? 88
                      : p.phase === 'merge-apply'
                        ? 93
                        : p.phase === 'geoserver-start'
                          ? 97
                          : p.phase === 'npm-install'
                            ? 97
                            : p.phase === 'build'
                              ? 98
                              : p.phase === 'app-stop'
                                ? 99
                                : null;
          if (p.phase === 'latest' && p.message.includes('version=')) {
            versionDetailRef.current = p.message.replace('latest: ', '');
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
          if (line.startsWith('latest:')) {
            versionDetailRef.current = line.replace('latest: ', '');
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
      const restartHint =
        doneMode === 'exit'
          ? '적용 완료. 서버 재기동 대기 후 화면을 새로고침합니다…'
          : doneMode === 'launcher'
            ? '적용 완료. Next 재기동 대기 후 화면을 새로고침합니다…'
            : '최신 소스 적용 완료. 화면을 새로고침합니다…';
      setProgress({
        message: json.restart?.scheduled ? restartHint : '최신 소스 적용 완료. 화면을 새로고침합니다…',
        pct: 100,
        logs: logRef.current,
        error: null,
      });
      if (json.restart?.scheduled) {
        pushLog(
          doneMode === 'exit'
            ? '재시작 예약: 사전 빌드·앱 종료 완료 → process.exit → nssm/런처 재기동'
            : '재시작 예약: 사전 빌드·앱 종료 완료 → 런처가 Next 재기동'
        );
        pushLog('서버 재기동 대기 후 화면 새로고침…');
        clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
        historyRetryTimersRef.current = notifyDevVersionHistoryRefreshRetry([
          0, 5_000, 15_000, 30_000, 60_000,
        ]);
        void waitServerThenHardReload();
      } else {
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
          message: '적용·사전 빌드까지 완료했습니다. 서버 재기동 대기 후 화면을 새로고침합니다…',
          pct: 100,
          logs: logRef.current,
          error: null,
        });
        pushLog('재시작으로 연결이 끊김 (정상). 서버 대기 후 화면 새로고침…');
        clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
        historyRetryTimersRef.current = notifyDevVersionHistoryRefreshRetry([
          0, 5_000, 15_000, 30_000, 60_000,
        ]);
        void waitServerThenHardReload();
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
          <span className="text-muted-foreground">{progress.pct}%</span>
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
      <div className="flex min-h-0 flex-1 flex-col rounded border p-3">
        <div className="shrink-0 space-y-2">
          <div className="text-sm font-medium">최신 소스 적용</div>
          <p className="text-xs text-muted-foreground">
            GNMS 최신 소스 ZIP을 브라우저가 중계해 운영 서버에 반영합니다.
          </p>
          <ProfileRadios />
          <div className="space-y-2 text-sm">
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
                프로세스 종료(nssm)
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => void runUpdate()} className="gap-1">
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
        <LiveLogsPanel logs={progress.logs} />
      </div>
    </div>
  );
}
