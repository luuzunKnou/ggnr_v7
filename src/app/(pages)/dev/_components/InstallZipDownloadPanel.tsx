'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { LiveLogsPanel } from './LiveLogsPanel';
import { ProgressStagesList, type StageItem } from './ProgressStagesList';
import {
  buildInstallBaseStages,
  buildInstallStagesFromProgress,
  createInstallZipProgressId,
  patchStages,
  setStageActive,
  type InstallStageId,
} from './versionManagerStages';
import type { SourcePackageProfile } from './sourceUpload/sourceUploadProfiles';
import { resolveClientMachineIp, prefetchClientMachineIp } from '@/lib/clientMachineIp';
import { streamDownloadFile, streamDownloadResponse } from '@/lib/streamFileDownload';
import { recordVersionHistoryClient } from '@/lib/recordVersionHistoryClient';
import {
  fetchGnmsInstallZipViaLocal,
  notifyGnmsLatestDownloadCancel,
} from '@/lib/sourceVersionClientRelay';
import { notifyDevVersionHistoryRefresh } from './devVersionHistoryBridge';
import type { InstallZipProgress } from '@/service/sourceInstallZipProgress';

const HISTORY_OPTION_GNMS_LATEST = 'GNMS 최신';

function openInstallManualPopup() {
  window.open(
    '/dev/install-manual',
    'ggnrInstallManual',
    'width=1200,height=800,scrollbars=yes,resizable=yes'
  );
}

type DownloadSourceMode = 'gnms' | 'local';

type SideProgress = {
  message: string;
  pct: number | null;
  logs: string[];
  error: string | null;
};

type GnmsInstallStageId = 'latest' | 'download';

function emptySideProgress(): SideProgress {
  return { message: '대기 중', pct: null, logs: [], error: null };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function buildGnmsInstallBaseStages(): StageItem[] {
  return [
    { id: 'latest', label: 'GNMS 최신 조회', state: 'pending' },
    { id: 'download', label: '파일 다운로드', state: 'pending' },
  ];
}

function patchGnmsStages(
  stages: StageItem[],
  patch: Partial<Record<GnmsInstallStageId, Partial<StageItem>>>
): StageItem[] {
  return stages.map((s) => {
    const p = patch[s.id as GnmsInstallStageId];
    return p ? { ...s, ...p } : s;
  });
}

function SourceModeRadios({
  mode,
  setMode,
  disabled,
}: {
  mode: DownloadSourceMode;
  setMode: (m: DownloadSourceMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="install-download-source"
          checked={mode === 'gnms'}
          disabled={disabled}
          onChange={() => setMode('gnms')}
        />
        GNMS 최신
      </label>
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="install-download-source"
          checked={mode === 'local'}
          disabled={disabled}
          onChange={() => setMode('local')}
        />
        현재 서버
      </label>
    </div>
  );
}

function ProfileRadios({
  profile,
  setProfile,
  disabled,
}: {
  profile: SourcePackageProfile;
  setProfile: (p: SourcePackageProfile) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="install-package-profile"
          checked={profile === 'closed'}
          disabled={disabled}
          onChange={() => setProfile('closed')}
        />
        폐쇄망 (node_modules 포함)
      </label>
      <label className="flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="install-package-profile"
          checked={profile === 'open'}
          disabled={disabled}
          onChange={() => setProfile('open')}
        />
        개방망 (node_modules 미포함)
      </label>
    </div>
  );
}

function ModeDescription({ mode }: { mode: DownloadSourceMode }) {
  if (mode === 'gnms') {
    return (
      <p className="text-xs text-muted-foreground">
        이 서버가 GNMS에 설치 ZIP을 요청한 뒤 브라우저로 전달합니다.<br />
        GNMS에서 python/env의 분할 압축본을 ZIP에 포함시켜 제공하며, 설치 서버에서 시작 스크립트가 분할 압축을 복원합니다.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      이 서버 워크스페이스를 지금 로컬 기준으로 설치용 ZIP으로 만듭니다.<br />
      python/env 원본은 빼고 분할압축본을 생성합니다. 설치 서버에서 시작 스크립트가 분할 압축을 복원합니다.
    </p>
  );
}

function ProgressBar({
  pct,
  busy,
}: {
  pct: number | null;
  busy: boolean;
}) {
  if (!busy || pct == null) return null;
  return (
    <div className="mt-2 rounded border bg-muted/20 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex shrink-0 items-center gap-1">진행 중</span>
        <span className="shrink-0 text-muted-foreground">{pct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-muted-foreground">{pct}%</span>
      </div>
    </div>
  );
}

export function InstallZipDownloadPanel() {
  const [sourceMode, setSourceMode] = useState<DownloadSourceMode>('gnms');
  const [profile, setProfile] = useState<SourcePackageProfile>('closed');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SideProgress>(emptySideProgress());
  const [stages, setStages] = useState(() => buildGnmsInstallBaseStages());
  const logRef = useRef<string[]>([]);
  const infoDetailRef = useRef('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPhaseRef = useRef('');
  const lastLogMessageRef = useRef('');
  const lastSkipLoggedRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    prefetchClientMachineIp();
  }, []);

  // 소스 모드 전환 시에만 단계·로그 초기화 (다운로드 완료로 busy가 꺼질 때는 유지)
  useEffect(() => {
    setStages(sourceMode === 'gnms' ? buildGnmsInstallBaseStages() : buildInstallBaseStages());
    setProgress(emptySideProgress());
    logRef.current = [];
    lastLogMessageRef.current = '';
  }, [sourceMode]);

  const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pushLog = (line: string) => {
    const next = [
      ...logRef.current,
      `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`,
    ].slice(-60);
    logRef.current = next;
    setProgress((p) => ({ ...p, logs: next }));
  };

  const applyInstallProgress = (p: InstallZipProgress) => {
    setProgress((prev) => ({ ...prev, message: p.message, pct: p.progressPct }));
    setStages(buildInstallStagesFromProgress(p, infoDetailRef.current));
    if (p.phase !== lastPhaseRef.current && p.phase !== 'idle') {
      lastPhaseRef.current = p.phase;
    }
    if (
      p.scanSkippedPaths?.length &&
      p.message.includes('스캔 완료') &&
      lastSkipLoggedRef.current !== (p.scanSkipped ?? 0)
    ) {
      lastSkipLoggedRef.current = p.scanSkipped ?? 0;
      const sample = p.scanSkippedPaths.slice(0, 20);
      pushLog(`제외 경로 예시 (${sample.length}/${p.scanSkipped ?? sample.length}건):`);
      for (const path of sample) pushLog(`  ${path}`);
      if ((p.scanSkipped ?? 0) > sample.length || p.scanSkippedTruncated) {
        pushLog(`  …외 ${(p.scanSkipped ?? 0) - sample.length}건 (단계 «제외»에 마우스 올리면 더 보기)`);
      }
    }
    const msg = p.message?.trim();
    if (!msg || msg === lastLogMessageRef.current) return;
    lastLogMessageRef.current = msg;
    pushLog(msg);
  };

  const startInstallProgressPoll = (progressId: string) => {
    stopPoll();
    lastPhaseRef.current = '';
    lastLogMessageRef.current = '';
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
    pollRef.current = setInterval(tick, 300);
  };

  const downloadFromGnms = async (signal: AbortSignal) => {
    setProgress({ ...emptySideProgress(), message: 'GNMS 설정 조회 중...', pct: 2 });
    setStages(buildGnmsInstallBaseStages());
    setStages((prev) => patchGnmsStages(prev, { latest: { state: 'active' } }));

    let gnmsJobId: string | null = null;
    let gnmsVersion: string | undefined;
    let gnmsFileName: string | undefined;

    try {
      pushLog('GNMS 최신 설치파일 조회 시작 (로컬 서버 경유)');
      const { downloadRes, fileName, version, jobId } = await fetchGnmsInstallZipViaLocal({
        signal,
        log: pushLog,
      });
      gnmsVersion = version;
      gnmsFileName = fileName;
      gnmsJobId = jobId || null;

      setStages((prev) =>
        patchGnmsStages(prev, {
          latest: { state: 'done', detail: version },
          download: { state: 'active' },
        })
      );
      setProgress((p) => ({ ...p, message: 'ZIP 다운로드 중...', pct: 10 }));
      pushLog(`다운로드 시작: ${fileName}`);

      await streamDownloadResponse(
        downloadRes,
        fileName,
        (received, total) => {
          const pct =
            total && total > 0 ? Math.min(99, 10 + Math.round((received / total) * 89)) : 50;
          const msg = total
            ? `다운로드 ${formatBytes(received)} / ${formatBytes(total)}`
            : 'ZIP 다운로드 중...';
          setProgress((p) => ({ ...p, message: msg, pct }));
          if (msg !== lastLogMessageRef.current) {
            lastLogMessageRef.current = msg;
            pushLog(msg);
          }
          setStages((prev) =>
            patchGnmsStages(prev, {
              download: {
                state: 'active',
                detail: total ? `${formatBytes(received)} / ${formatBytes(total)}` : undefined,
              },
            })
          );
        },
        signal
      );

      setStages((prev) =>
        patchGnmsStages(prev, {
          download: { state: 'done', detail: fileName },
        })
      );
      setProgress({
        message: `다운로드 완료: ${fileName}`,
        pct: 100,
        logs: logRef.current,
        error: null,
      });
      pushLog(`다운로드 완료: ${fileName}`);

      await recordVersionHistoryClient({
        historyType: 'install_zip',
        status: 'success',
        message: `version=${version} / file=${fileName}`,
        option: [HISTORY_OPTION_GNMS_LATEST],
      });
      notifyDevVersionHistoryRefresh();
    } catch (e: unknown) {
      const isAbort = isAbortError(e);
      const msg = isAbort ? '사용자가 취소했습니다.' : e instanceof Error ? e.message : String(e);

      if (isAbort && gnmsJobId) {
        await notifyGnmsLatestDownloadCancel({
          jobId: gnmsJobId,
          version: gnmsVersion,
          fileName: gnmsFileName,
          log: pushLog,
        }).catch(() => {});
      }

      if (!isAbort) {
        const versionPrefix = gnmsVersion?.trim() ? `version=${gnmsVersion.trim()} / ` : '';
        await recordVersionHistoryClient({
          historyType: 'install_zip',
          status: 'fail',
          message: `${versionPrefix}${msg}`,
          option: [HISTORY_OPTION_GNMS_LATEST],
        });
        notifyDevVersionHistoryRefresh();
      }

      setProgress({
        message: isAbort ? msg : '실패',
        pct: null,
        logs: logRef.current,
        error: isAbort ? null : msg,
      });
      setStages((prev) => {
        const active = (prev.find((s) => s.state === 'active')?.id ?? 'latest') as GnmsInstallStageId;
        return patchGnmsStages(prev, { [active]: { state: 'error', detail: msg } });
      });
      pushLog(isAbort ? msg : `ERROR: ${msg}`);
      throw e;
    }
  };

  const downloadFromLocal = async (signal: AbortSignal) => {
    infoDetailRef.current = '';
    lastPhaseRef.current = '';
    lastLogMessageRef.current = '';
    lastSkipLoggedRef.current = null;
    setProgress({ ...emptySideProgress(), message: '서버 정보 확인 중...', pct: 2 });
    setStages(buildInstallBaseStages());
    setStages((prev) => setStageActive(prev, 'info'));

    const progressId = createInstallZipProgressId();

    try {
      pushLog('서버 정보 확인 시작');
      const infoRes = await fetch(
        `/api/source/version/install-zip/info?profile=${encodeURIComponent(profile)}`,
        { cache: 'no-store', signal }
      );
      const infoJson = (await infoRes.json()) as {
        error?: string;
        hostname?: string;
        nodeVersion?: string;
        packageProfile?: string;
      };
      if (!infoRes.ok) throw new Error(infoJson.error ?? '서버 정보 조회 실패');

      const profileLabel = profile === 'closed' ? '폐쇄망' : '개방망';
      infoDetailRef.current = `${infoJson.hostname ?? '-'} · ${profileLabel} · Node ${infoJson.nodeVersion ?? '-'}`;
      setStages((prev) =>
        patchStages(prev, {
          info: { state: 'done', detail: infoDetailRef.current },
        })
      );
      pushLog(`서버: ${infoDetailRef.current}`);
      setProgress((p) => ({ ...p, message: 'ZIP 생성 준비...', pct: 5 }));

      const regRes = await fetch('/api/source/version/install-zip/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressId }),
        signal,
      });
      if (!regRes.ok) {
        const regJson = (await regRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(regJson.error ?? '진행 상태 등록 실패');
      }

      startInstallProgressPoll(progressId);
      setStages((prev) => setStageActive(prev, 'scan'));

      const buildRes = await fetch('/api/source/version/install-zip/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          progressId,
          clientIp: await resolveClientMachineIp(),
        }),
        signal,
      });
      const buildJson = (await buildRes.json()) as {
        error?: string;
        zipName?: string;
        downloadUrl?: string;
        progressId?: string;
        zipSize?: number;
        fileCount?: number;
        skippedCount?: number;
      };

      stopPoll();

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

      const skipCount = buildJson.skippedCount ?? 0;
      pushLog(
        `ZIP 생성 완료: ${buildJson.zipName ?? ''} (포함 ${buildJson.fileCount ?? '?'} / 제외 ${skipCount})`
      );
      setStages((prev) =>
        patchStages(setStageActive(prev, 'download'), {
          scan: {
            state: 'done',
            detail: buildJson.fileCount != null ? `포함 ${buildJson.fileCount}` : undefined,
            detailExclude: `제외 ${skipCount}`,
          },
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

      setProgress((p) => ({ ...p, message: 'ZIP 다운로드 중...', pct: 90 }));
      pushLog('스트림 다운로드 시작');

      await streamDownloadFile(
        downloadUrl,
        fileName,
        (received, total) => {
          const pct =
            total && total > 0 ? Math.min(99, 90 + Math.round((received / total) * 10)) : 92;
          const msg = total
            ? `다운로드 ${formatBytes(received)} / ${formatBytes(total)}`
            : 'ZIP 다운로드 중...';
          setProgress((p) => ({ ...p, message: msg, pct }));
          if (msg !== lastLogMessageRef.current) {
            lastLogMessageRef.current = msg;
            pushLog(msg);
          }
          setStages((prev) =>
            patchStages(prev, {
              download: {
                state: 'active',
                detail: total ? `${formatBytes(received)} / ${formatBytes(total)}` : undefined,
              },
            })
          );
        },
        signal
      );

      setStages((prev) =>
        patchStages(prev, {
          download: { state: 'done', detail: fileName },
        })
      );
      setProgress({
        message: `다운로드 완료: ${fileName}`,
        pct: 100,
        logs: logRef.current,
        error: null,
      });
      pushLog(`다운로드 완료: ${fileName}`);
      notifyDevVersionHistoryRefresh();
    } catch (e: unknown) {
      const isAbort = isAbortError(e);
      const msg = isAbort ? '사용자가 취소했습니다.' : e instanceof Error ? e.message : String(e);
      setProgress({
        message: isAbort ? msg : '실패',
        pct: null,
        logs: logRef.current,
        error: isAbort ? null : msg,
      });
      setStages((prev) => {
        const active = (prev.find((s) => s.state === 'active')?.id ?? 'scan') as InstallStageId;
        return patchStages(prev, { [active]: { state: 'error', detail: msg } });
      });
      pushLog(isAbort ? msg : `ERROR: ${msg}`);
      throw e;
    } finally {
      stopPoll();
    }
  };

  const downloadInstallZip = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setBusy(true);
    logRef.current = [];
    lastLogMessageRef.current = '';
    lastSkipLoggedRef.current = null;
    lastPhaseRef.current = '';
    setProgress(emptySideProgress());
    setStages(sourceMode === 'gnms' ? buildGnmsInstallBaseStages() : buildInstallBaseStages());

    try {
      if (sourceMode === 'gnms') {
        await downloadFromGnms(signal);
      } else {
        await downloadFromLocal(signal);
      }
    } catch {
      /* 오류 UI는 각 핸들러에서 처리 */
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border p-3 gap-2">
      <div className="shrink-0 space-y-2">
        <button
          type="button"
          onClick={openInstallManualPopup}
          className="inline-block cursor-pointer text-xs text-blue-600 underline"
          title="설치 매뉴얼"
        >
          설치 매뉴얼
        </button>
        <SourceModeRadios mode={sourceMode} setMode={setSourceMode} disabled={busy} />
        <ModeDescription mode={sourceMode} />
        {sourceMode === 'local' ? (
          <ProfileRadios profile={profile} setProfile={setProfile} disabled={busy} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void downloadInstallZip()}
            className="gap-1 cursor-pointer"
            title="설치파일 다운로드"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            설치파일 다운로드
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!busy}
            onClick={() => abortRef.current?.abort()}
            className="cursor-pointer"
            title="취소"
          >
            취소
          </Button>
        </div>
        <ProgressBar pct={progress.pct} busy={busy} />
        <p className="text-xs text-muted-foreground">{progress.message}</p>
        {progress.error && <p className="text-xs text-red-600">{progress.error}</p>}
        <ProgressStagesList stages={stages} />
      </div>
      <LiveLogsPanel logs={progress.logs} />
    </div>
  );
}
