'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { ProgressStagesList } from './ProgressStagesList';
import {
  buildInstallBaseStages,
  buildInstallStagesFromProgress,
  buildRelayBaseStages,
  buildRelayStagesFromProgress,
  createInstallZipProgressId,
  patchStages,
  setStageActive,
  type InstallStageId,
} from './versionManagerStages';
import type { StageItem } from './ProgressStagesList';
import type { SourcePackageProfile } from './sourceUpload/sourceUploadProfiles';
import {
  relayLatestSourceFromGnms,
  type RestartMode,
  type VersionRelayProgress,
  type VersionRelayResult,
} from '@/lib/sourceVersionClientRelay';
import { streamDownloadFile } from '@/lib/streamFileDownload';
import type { InstallZipProgress } from '@/service/sourceInstallZipProgress';

const INSTALL_MANUAL_URL =
  process.env.NEXT_PUBLIC_GGNR_INSTALL_MANUAL_URL?.trim() ||
  'https://www.notion.so/';

type SideProgress = {
  message: string;
  pct: number | null;
  logs: string[];
  error: string | null;
};

function emptySideProgress(): SideProgress {
  return { message: '대기 중', pct: null, logs: [], error: null };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function VersionManagerContent() {
  const [leftProfile, setLeftProfile] = useState<SourcePackageProfile>('closed');
  const [rightProfile, setRightProfile] = useState<SourcePackageProfile>('closed');
  const [restart, setRestart] = useState(true);
  const [restartMode, setRestartMode] = useState<RestartMode>('exit');
  const [leftBusy, setLeftBusy] = useState(false);
  const [rightBusy, setRightBusy] = useState(false);
  const [left, setLeft] = useState<SideProgress>(emptySideProgress());
  const [right, setRight] = useState<SideProgress>(emptySideProgress());
  const [leftStages, setLeftStages] = useState<StageItem[]>(() => buildInstallBaseStages());
  const [rightStages, setRightStages] = useState<StageItem[]>(() => buildRelayBaseStages());
  const [relayResult, setRelayResult] = useState<VersionRelayResult | null>(null);
  const leftLogRef = useRef<string[]>([]);
  const rightLogRef = useRef<string[]>([]);
  const leftInfoDetailRef = useRef('');
  const rightVersionDetailRef = useRef('');
  const leftPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLeftPhaseRef = useRef('');
  const leftAbortRef = useRef<AbortController | null>(null);
  const rightAbortRef = useRef<AbortController | null>(null);

  const anyBusy = leftBusy || rightBusy;

  const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

  const cancelLeft = () => {
    leftAbortRef.current?.abort();
  };

  const cancelRight = () => {
    rightAbortRef.current?.abort();
  };

  const stopLeftPoll = () => {
    if (leftPollRef.current) {
      clearInterval(leftPollRef.current);
      leftPollRef.current = null;
    }
  };

  const pushLeftLog = (line: string) => {
    const next = [...leftLogRef.current, `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`].slice(-60);
    leftLogRef.current = next;
    setLeft((p) => ({ ...p, logs: next }));
  };

  const pushRightLog = (line: string) => {
    const next = [...rightLogRef.current, `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`].slice(-60);
    rightLogRef.current = next;
    setRight((p) => ({ ...p, logs: next }));
  };

  const applyInstallProgress = (p: InstallZipProgress) => {
    setLeft((prev) => ({ ...prev, message: p.message, pct: p.progressPct }));
    setLeftStages(buildInstallStagesFromProgress(p, leftInfoDetailRef.current));
    if (p.phase !== lastLeftPhaseRef.current && p.phase !== 'idle') {
      lastLeftPhaseRef.current = p.phase;
      if (p.phase !== 'scan' || (p.fileCount != null && p.fileCount % 500 < 200)) {
        pushLeftLog(p.message);
      }
    }
  };

  const startInstallProgressPoll = (progressId: string) => {
    stopLeftPoll();
    lastLeftPhaseRef.current = '';
    const tick = () => {
      void fetch(`/api/source/version/install-zip/progress?id=${encodeURIComponent(progressId)}`, {
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((p: InstallZipProgress | null) => {
          if (!p) return;
          applyInstallProgress(p);
        });
    };
    tick();
    leftPollRef.current = setInterval(tick, 300);
  };

  const downloadInstallZip = async () => {
    leftAbortRef.current?.abort();
    leftAbortRef.current = new AbortController();
    const signal = leftAbortRef.current.signal;

    setLeftBusy(true);
    leftLogRef.current = [];
    leftInfoDetailRef.current = '';
    lastLeftPhaseRef.current = '';
    setLeft({ ...emptySideProgress(), message: '서버 정보 확인 중...', pct: 2 });
    setLeftStages(buildInstallBaseStages());
    setLeftStages((prev) => setStageActive(prev, 'info'));

    const progressId = createInstallZipProgressId();

    try {
      pushLeftLog('서버 정보 확인 시작');
      const infoRes = await fetch(
        `/api/source/version/install-zip/info?profile=${encodeURIComponent(leftProfile)}`,
        { cache: 'no-store', signal }
      );
      const infoJson = (await infoRes.json()) as {
        error?: string;
        hostname?: string;
        nodeVersion?: string;
        workspaceRoot?: string;
        packageProfile?: string;
      };
      if (!infoRes.ok) throw new Error(infoJson.error ?? '서버 정보 조회 실패');

      const profileLabel = leftProfile === 'closed' ? '폐쇄망' : '개방망';
      leftInfoDetailRef.current = `${infoJson.hostname ?? '-'} · ${profileLabel} · Node ${infoJson.nodeVersion ?? '-'}`;
      setLeftStages((prev) =>
        patchStages(prev, {
          info: { state: 'done', detail: leftInfoDetailRef.current },
        })
      );
      pushLeftLog(`서버: ${leftInfoDetailRef.current}`);
      setLeft((p) => ({ ...p, message: 'ZIP 생성 준비...', pct: 5 }));

      startInstallProgressPoll(progressId);
      setLeftStages((prev) => setStageActive(prev, 'scan'));

      const buildRes = await fetch('/api/source/version/install-zip/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: leftProfile, progressId }),
        signal,
      });
      const buildJson = (await buildRes.json()) as {
        error?: string;
        zipName?: string;
        downloadUrl?: string;
        progressId?: string;
        zipSize?: number;
        fileCount?: number;
      };

      stopLeftPoll();

      if (!buildRes.ok) {
        const errSnap: InstallZipProgress = {
          progressId,
          phase: 'error',
          progressPct: 0,
          message: buildJson.error ?? 'ZIP 생성 실패',
          error: buildJson.error ?? 'ZIP 생성 실패',
          updatedAt: Date.now(),
          done: true,
        };
        applyInstallProgress(errSnap);
        throw new Error(buildJson.error ?? 'ZIP 생성 실패');
      }

      pushLeftLog(`ZIP 생성 완료: ${buildJson.zipName ?? ''} (${buildJson.fileCount ?? '?'}건)`);
      setLeftStages((prev) =>
        patchStages(setStageActive(prev, 'download'), {
          scan: { state: 'done', detail: `${buildJson.fileCount ?? '?'}건` },
          zip: {
            state: 'done',
            detail:
              buildJson.zipSize != null
                ? `${buildJson.zipName ?? ''} (${formatBytes(buildJson.zipSize)})`
                : buildJson.zipName,
          },
        })
      );

      const downloadUrl =
        buildJson.downloadUrl ??
        `/api/source/version/install-zip/download?progressId=${encodeURIComponent(buildJson.progressId ?? progressId)}`;
      const fileName = buildJson.zipName ?? `source_install_${Date.now()}.zip`;

      setLeft((p) => ({ ...p, message: 'ZIP 다운로드 중...', pct: 90 }));
      pushLeftLog('스트림 다운로드 시작');

      await streamDownloadFile(downloadUrl, fileName, (received, total) => {
        const pct = total && total > 0 ? Math.min(99, 90 + Math.round((received / total) * 10)) : 92;
        setLeft((p) => ({
          ...p,
          message: total ? `다운로드 ${formatBytes(received)} / ${formatBytes(total)}` : 'ZIP 다운로드 중...',
          pct,
        }));
        setLeftStages((prev) =>
          patchStages(prev, {
            download: {
              state: 'active',
              detail: total ? `${formatBytes(received)} / ${formatBytes(total)}` : undefined,
            },
          })
        );
      }, signal);

      setLeftStages((prev) =>
        patchStages(prev, {
          download: { state: 'done', detail: fileName },
        })
      );
      setLeft({
        message: `다운로드 완료: ${fileName}`,
        pct: 100,
        logs: leftLogRef.current,
        error: null,
      });
      pushLeftLog(`다운로드 완료: ${fileName}`);
    } catch (e: unknown) {
      const isAbort = isAbortError(e);
      const msg = isAbort ? '사용자가 취소했습니다.' : e instanceof Error ? e.message : String(e);
      setLeft({ message: isAbort ? msg : '실패', pct: null, logs: leftLogRef.current, error: isAbort ? null : msg });
      setLeftStages((prev) => {
        const active = (prev.find((s) => s.state === 'active')?.id ?? 'scan') as InstallStageId;
        return patchStages(prev, { [active]: { state: 'error', detail: msg } });
      });
      pushLeftLog(isAbort ? msg : `ERROR: ${msg}`);
    } finally {
      stopLeftPoll();
      leftAbortRef.current = null;
      setLeftBusy(false);
    }
  };

  const runUpdate = async () => {
    rightAbortRef.current?.abort();
    rightAbortRef.current = new AbortController();
    const signal = rightAbortRef.current.signal;

    setRightBusy(true);
    setRelayResult(null);
    rightLogRef.current = [];
    rightVersionDetailRef.current = '';
    setRight({ ...emptySideProgress(), message: 'GNMS 최신 버전 조회 중...', pct: 2 });
    setRightStages(buildRelayBaseStages());

    try {
      const json = await relayLatestSourceFromGnms({
        restart,
        restartMode,
        packageProfile: rightProfile,
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
            rightVersionDetailRef.current = p.message.replace('latest: ', '');
          }
          setRight((prev) => ({ ...prev, message: p.message, pct }));
          setRightStages(
            buildRelayStagesFromProgress({
              phase: p.phase,
              message: p.message,
              chunkIndex: p.chunkIndex,
              totalChunks: p.totalChunks,
              bytesDone: p.bytesDone,
              totalBytes: p.totalBytes,
              versionDetail: rightVersionDetailRef.current || undefined,
            })
          );
        },
        onLog: (line) => {
          pushRightLog(line);
          if (line.startsWith('latest:')) {
            rightVersionDetailRef.current = line.replace('latest: ', '');
            setRightStages((prev) =>
              patchStages(prev, {
                latest: { state: 'done', detail: rightVersionDetailRef.current },
              })
            );
          }
        },
      });
      setRelayResult(json);
      rightVersionDetailRef.current = `version=${json.version}, file=${json.fileName}`;
      setRightStages(
        buildRelayStagesFromProgress({
          phase: 'done',
          message: json.restart?.scheduled ? '적용 완료 · 재시작 예약' : '적용 완료',
          versionDetail: rightVersionDetailRef.current,
        })
      );
      setRight({
        message: json.restart?.scheduled ? '최신 소스 적용 완료. 서버 재시작 예약됨' : '최신 소스 적용 완료',
        pct: 100,
        logs: rightLogRef.current,
        error: null,
      });
    } catch (e: unknown) {
      const isAbort = isAbortError(e);
      const msg = isAbort ? '사용자가 취소했습니다.' : e instanceof Error ? e.message : String(e);
      setRight({ message: isAbort ? msg : '실패', pct: null, logs: rightLogRef.current, error: isAbort ? null : msg });
      setRightStages(
        buildRelayStagesFromProgress({
          phase: 'error',
          message: msg,
          error: msg,
        })
      );
      pushRightLog(isAbort ? msg : `ERROR: ${msg}`);
    } finally {
      rightAbortRef.current = null;
      setRightBusy(false);
    }
  };

  const ProfileRadios = ({
    profile,
    setProfile,
    disabled,
  }: {
    profile: SourcePackageProfile;
    setProfile: (p: SourcePackageProfile) => void;
    disabled: boolean;
  }) => (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <label className="flex items-center gap-1">
        <input
          type="radio"
          checked={profile === 'closed'}
          disabled={disabled}
          onChange={() => setProfile('closed')}
        />
        폐쇄망 (node_modules 포함)
      </label>
      <label className="flex items-center gap-1">
        <input
          type="radio"
          checked={profile === 'open'}
          disabled={disabled}
          onChange={() => setProfile('open')}
        />
        개방망 (node_modules 미포함)
      </label>
    </div>
  );

  const ProgressBar = ({ pct, busy }: { pct: number | null; busy: boolean }) => {
    if (!busy || pct == null) return null;
    return (
      <div className="mt-2 rounded border bg-muted/20 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            진행 중
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const LiveLogs = ({ logs, busy }: { logs: string[]; busy: boolean }) => {
    if (!busy && logs.length === 0) return null;
    return (
      <div className="mt-2 max-h-28 overflow-auto rounded border bg-muted/10 px-3 py-2 font-mono text-[11px]">
        <div className="mb-1 font-sans font-medium text-muted-foreground">실시간 로그</div>
        {logs.length === 0 ? (
          <div className="text-muted-foreground">로그 대기 중...</div>
        ) : (
          logs.map((line, i) => (
            <div key={`${i}-${line}`} className="whitespace-pre-wrap break-all leading-relaxed">
              {line}
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={`flex min-h-0 flex-col gap-2 rounded border p-3 ${rightBusy ? 'opacity-60' : ''}`}>
          <div className="mb-2 text-sm font-medium">설치파일 다운로드</div>
          <p className="mb-2 text-xs text-muted-foreground">현재 서버를 설치용 ZIP으로 받습니다.</p>
          <a
            href={INSTALL_MANUAL_URL}
            target="_blank"
            rel="noreferrer"
            className="mb-2 inline-block text-xs text-blue-600 underline"
          >
            설치 매뉴얼
          </a>
          <ProfileRadios profile={leftProfile} setProfile={setLeftProfile} disabled={anyBusy} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={anyBusy}
              onClick={() => void downloadInstallZip()}
              className="gap-1"
            >
              {leftBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              설치파일 다운로드
            </Button>
            <Button type="button" variant="outline" disabled={!leftBusy} onClick={cancelLeft}>
              취소
            </Button>
          </div>
          {rightBusy && <p className="text-xs text-muted-foreground">대기 — 오른쪽 작업 중</p>}
          <ProgressBar pct={left.pct} busy={leftBusy} />
          <p className="text-xs text-muted-foreground">{left.message}</p>
          {left.error && <p className="text-xs text-red-600">{left.error}</p>}
          <ProgressStagesList stages={leftStages} />
          <LiveLogs logs={left.logs} busy={leftBusy} />
        </div>

        <div className={`flex min-h-0 flex-col gap-2 rounded border p-3 ${leftBusy ? 'opacity-60' : ''}`}>
          <div className="mb-2 text-sm font-medium">최신 소스 적용</div>
          <p className="mb-2 text-xs text-muted-foreground">
            GNMS 최신 소스 ZIP을 브라우저가 중계해 운영 서버에 반영합니다.
          </p>
          <ProfileRadios profile={rightProfile} setProfile={setRightProfile} disabled={anyBusy} />
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restart}
                disabled={anyBusy}
                onChange={(e) => setRestart(e.target.checked)}
              />
              적용 후 서버 재시작
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'exit'}
                  disabled={anyBusy || !restart}
                  onChange={() => setRestartMode('exit')}
                />
                프로세스 종료
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'command'}
                  disabled={anyBusy || !restart}
                  onChange={() => setRestartMode('command')}
                />
                명령 실행
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="restartMode"
                  checked={restartMode === 'none'}
                  disabled={anyBusy || !restart}
                  onChange={() => setRestartMode('none')}
                />
                재시작 안 함
              </label>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" disabled={anyBusy} onClick={() => void runUpdate()} className="gap-1">
              {rightBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              최신 소스 전체 적용
            </Button>
            <Button type="button" variant="outline" disabled={!rightBusy} onClick={cancelRight}>
              취소
            </Button>
            <Button type="button" variant="outline" disabled title="준비 중">
              최신소스 일부 적용(준비중)
            </Button>
          </div>
          {leftBusy && <p className="text-xs text-muted-foreground">대기 — 왼쪽 작업 중</p>}
          <ProgressBar pct={right.pct} busy={rightBusy} />
          <p className="text-xs text-muted-foreground">{right.message}</p>
          {right.error && <p className="text-xs text-red-600">{right.error}</p>}
          <ProgressStagesList stages={rightStages} />
          <LiveLogs logs={right.logs} busy={rightBusy} />
          {relayResult && (
            <div className="rounded border bg-muted/10 p-2 text-xs">
              <div className="mb-1 font-medium text-muted-foreground">적용 결과</div>
              <div>적용: {relayResult.appliedFiles}건</div>
              <div>제외: {relayResult.skippedFiles}건</div>
              <div>재시작: {relayResult.restart?.message}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
