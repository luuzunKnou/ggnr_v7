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
  isUserAbortError,
  relayLatestSourceFromGnms,
  type RestartMode,
  type VersionRelayProgress,
  type VersionRelayResult,
} from '@/lib/sourceVersionClientRelay';
import { prefetchClientMachineIp } from '@/lib/clientMachineIp';
import { closeDevVersionHistory, notifyDevVersionHistoryRefresh, notifyDevVersionHistoryRefreshRetry, clearDevVersionHistoryRefreshRetry } from './devVersionHistoryBridge';

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
  const [restart, setRestart] = useState(true);
  const [restartMode, setRestartMode] = useState<RestartMode>('command');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SideProgress>(emptySideProgress());
  const [stages, setStages] = useState(() => buildRelayBaseStages());
  const [relayResult, setRelayResult] = useState<VersionRelayResult | null>(null);
  const logRef = useRef<string[]>([]);
  const versionDetailRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const historyRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  const pushLog = (line: string) => {
    const next = [...logRef.current, `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`].slice(-60);
    logRef.current = next;
    setProgress((p) => ({ ...p, logs: next }));
  };

  const runUpdate = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setBusy(true);
    setRelayResult(null);
    logRef.current = [];
    versionDetailRef.current = '';
    setProgress({ ...emptySideProgress(), message: 'GNMS 최신 버전 조회 중...', pct: 2 });
    setStages(buildRelayBaseStages());

    try {
      const json = await relayLatestSourceFromGnms({
        restart,
        restartMode,
        packageProfile: profile,
        signal,
        onProgress: (p: VersionRelayProgress) => {
          const pct =
            p.totalBytes && p.bytesDone != null
              ? Math.min(100, Math.round((p.bytesDone / p.totalBytes) * 100))
              : p.phase === 'latest'
                ? 5
                : p.phase === 'relay-init'
                  ? 15
                  : p.phase === 'relay-complete'
                    ? 95
                    : null;
          if (p.phase === 'latest' && p.message.includes('version=')) {
            versionDetailRef.current = p.message.replace('latest: ', '');
          }
          setProgress((prev) => ({ ...prev, message: p.message, pct }));
          setStages(
            buildRelayStagesFromProgress({
              phase: p.phase,
              message: p.message,
              chunkIndex: p.chunkIndex,
              totalChunks: p.totalChunks,
              bytesDone: p.bytesDone,
              totalBytes: p.totalBytes,
              versionDetail: versionDetailRef.current || undefined,
            })
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
      setStages(
        buildRelayStagesFromProgress({
          phase: 'done',
          message: json.restart?.scheduled ? '적용 완료 · 재시작 예약' : '적용 완료',
          versionDetail: versionDetailRef.current,
          applyDetail: `적용 ${json.appliedFiles}건 · 제외 ${json.skippedFiles}건`,
          geoserverDetail: json.geoserver?.message,
          restartDetail: json.restart?.message,
        })
      );
      setProgress({
        message: json.restart?.scheduled
          ? '최신 소스 적용 완료. 서버 재시작 예약됨 — 재기동 후 이력에서 성공 기록을 확인하세요.'
          : '최신 소스 적용 완료',
        pct: 100,
        logs: logRef.current,
        error: null,
      });
      if (json.restart?.scheduled) {
        pushLog('서버 재시작 예약됨. 재기동 후 이력에서 성공 기록을 확인하세요.');
        clearDevVersionHistoryRefreshRetry(historyRetryTimersRef.current);
        historyRetryTimersRef.current = notifyDevVersionHistoryRefreshRetry([
          0, 5_000, 15_000, 30_000, 60_000,
        ]);
      } else {
        notifyDevVersionHistoryRefresh();
      }
    } catch (e: unknown) {
      const isAbort = isUserAbortError(e);
      const isTimeout = isRelayTimeoutError(e);
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
        buildRelayStagesFromProgress({
          phase: 'error',
          message: msg,
          error: msg,
        })
      );
      pushLog(isAbort ? msg : `ERROR: ${msg}`);
      if (!isAbort) {
        notifyDevVersionHistoryRefresh();
      }
    } finally {
      abortRef.current = null;
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
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress.pct}%` }} />
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
          <p className="text-xs text-muted-foreground">
            «적용 후 서버 재시작»은 앱(운영) 재시작만 제어합니다. GeoServer는 적용 시 항상 중지 후 다시 기동합니다.
          </p>
          <ProfileRadios />
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restart}
                disabled={busy}
                onChange={(e) => setRestart(e.target.checked)}
              />
              적용 후 서버 재시작
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'command'}
                  disabled={busy || !restart}
                  onChange={() => setRestartMode('command')}
                />
                명령 실행 재시작(새 창)
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'exit'}
                  disabled={busy || !restart}
                  onChange={() => setRestartMode('exit')}
                />
                process.exit 재시작(프로세스 매니저 필요)
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'startB'}
                  disabled={busy || !restart}
                  onChange={() => setRestartMode('startB')}
                />
                start/b
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'launcher'}
                  disabled={busy || !restart}
                  onChange={() => setRestartMode('launcher')}
                />
                Node 런처(앱만 재실행)
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'none'}
                  disabled={busy || !restart}
                  onChange={() => setRestartMode('none')}
                />
                재시작 안 함
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => void runUpdate()} className="gap-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              최신 소스 전체 적용
            </Button>
            <Button type="button" variant="outline" disabled title="준비 중">
              최신소스 일부 적용(준비중)
            </Button>
            <Button type="button" variant="outline" disabled={!busy} onClick={() => abortRef.current?.abort()}>
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
              <div>GeoServer: {relayResult.geoserver?.message ?? '-'}</div>
              <div>재시작: {relayResult.restart?.message}</div>
            </div>
          )}
        </div>
        <LiveLogsPanel logs={progress.logs} />
      </div>
    </div>
  );
}
