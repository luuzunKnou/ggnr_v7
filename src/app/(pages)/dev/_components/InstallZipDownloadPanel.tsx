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
  fetchGnmsLatestZipForBrowserSave,
  notifyGnmsLatestDownloadCancel,
  type GnmsClientConfigForDownload,
} from '@/lib/sourceVersionClientRelay';
import { notifyDevVersionHistoryRefresh } from './devVersionHistoryBridge';
import type { InstallZipProgress } from '@/service/sourceInstallZipProgress';
import {
  estimateRemainingByBytes,
  estimateRemainingSeconds,
  formatEtaMinutes,
} from '@/lib/sourceProgressEta';

const INSTALL_MANUAL_URL =
  process.env.NEXT_PUBLIC_GGNR_INSTALL_MANUAL_URL?.trim() ||
  'https://app.notion.com/p/daeguk/v7_-3a4f538d1f5980ceb743e8e410fb194d?source=copy_link';

const HISTORY_OPTION_GNMS_LATEST = 'GNMS 최신';

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

function estimateInstallZipTotalSeconds(
  fileCount: number,
  zipSizeBytes: number | undefined,
  profile: SourcePackageProfile
): number {
  if (fileCount <= 0) return 0;
  const closed = profile === 'closed';
  const scanSec = Math.max(2, fileCount * 0.004);
  const estZipBytes = zipSizeBytes ?? fileCount * (closed ? 100_000 : 6_000);
  const zipSec = Math.max(
    3,
    fileCount * (closed ? 0.018 : 0.01) + (estZipBytes / (1024 * 1024)) * (closed ? 1.8 : 0.9)
  );
  const dlBytes = zipSizeBytes ?? estZipBytes * (closed ? 0.28 : 0.4);
  const downloadSec = Math.max(2, (dlBytes / (1024 * 1024)) * 0.7);
  return scanSec + zipSec + downloadSec;
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
        GNMS에 올라간 최신 패키지를 받습니다. «소스코드 업로드»에서 제외된 파일·폴더는 포함되지
        않습니다(예: .next, .git, 대용량·데이터 폴더, 업로드 시 node_modules 미포함이면 패키지 없음,
        ggnr_start.bat 등). 설치 후 서버에서 별도 준비가 필요할 수 있습니다.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      이 서버 워크스페이스를 지금 기준으로 설치용 ZIP으로 만듭니다. 폐쇄망/개방망으로 node_modules
      포함 여부를 선택할 수 있습니다.
    </p>
  );
}

function ProgressBar({
  pct,
  busy,
  etaLabel,
}: {
  pct: number | null;
  busy: boolean;
  etaLabel?: string | null;
}) {
  if (!busy || pct == null) return null;
  return (
    <div className="mt-2 rounded border bg-muted/20 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex shrink-0 items-center gap-1">진행 중</span>
        {etaLabel ? (
          <span className="truncate text-muted-foreground">(예상 소요 시간: {etaLabel})</span>
        ) : null}
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
  const startedAtRef = useRef(0);
  const downloadBytesRef = useRef<{ done: number; total: number } | null>(null);
  const downloadStartedAtRef = useRef(0);
  const [installMeta, setInstallMeta] = useState<{ fileCount?: number; zipSize?: number }>({});
  const [etaTick, setEtaTick] = useState(0);

  useEffect(() => {
    prefetchClientMachineIp();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (busy) return;
    setStages(sourceMode === 'gnms' ? buildGnmsInstallBaseStages() : buildInstallBaseStages());
    setProgress(emptySideProgress());
    setInstallMeta({});
  }, [sourceMode, busy]);

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
    if (p.fileCount != null || p.zipSize != null) {
      setInstallMeta((prev) => ({
        fileCount: p.fileCount ?? prev.fileCount,
        zipSize: p.zipSize ?? prev.zipSize,
      }));
    }
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

    let cfg: GnmsClientConfigForDownload | null = null;
    let gnmsJobId: string | null = null;
    let gnmsVersion: string | undefined;
    let gnmsFileName: string | undefined;

    try {
      pushLog('GNMS 최신 설치파일 조회 시작');
      const { cfg: loadedCfg, bundle } = await fetchGnmsLatestZipForBrowserSave({
        signal,
        log: pushLog,
      });
      cfg = loadedCfg;
      const { version, fileName, jobId, downloadRes } = bundle;
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
          if (total && total > 0) {
            if (downloadStartedAtRef.current <= 0 && received > 0) {
              downloadStartedAtRef.current = Date.now();
            }
            downloadBytesRef.current = { done: received, total };
          }
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

      if (isAbort && cfg && gnmsJobId) {
        await notifyGnmsLatestDownloadCancel({
          cfg,
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
    startedAtRef.current = Date.now();
    setInstallMeta({});
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
      setInstallMeta({
        fileCount: buildJson.fileCount,
        zipSize: buildJson.zipSize,
      });
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
    startedAtRef.current = Date.now();
    downloadBytesRef.current = null;
    downloadStartedAtRef.current = 0;

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
      downloadBytesRef.current = null;
      downloadStartedAtRef.current = 0;
    }
  };

  const etaLabel = (() => {
    void etaTick;
    if (!busy || startedAtRef.current <= 0) return null;
    if (sourceMode === 'gnms') {
      const bytes = downloadBytesRef.current;
      if (bytes && bytes.total > 0 && bytes.done > 0 && downloadStartedAtRef.current > 0) {
        const remain = estimateRemainingByBytes(bytes.done, bytes.total, downloadStartedAtRef.current);
        if (remain != null) return formatEtaMinutes(remain);
      }
      if (progress.pct != null && progress.pct > 2) {
        return formatEtaMinutes(estimateRemainingSeconds(180, progress.pct, startedAtRef.current));
      }
      return '산출 중...';
    }
    const fc = installMeta.fileCount;
    if (fc == null || fc <= 0) return '산출 중...';
    const total = estimateInstallZipTotalSeconds(fc, installMeta.zipSize, profile);
    const remain = estimateRemainingSeconds(total, progress.pct, startedAtRef.current);
    return formatEtaMinutes(remain);
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border p-3">
      <div className="shrink-0 space-y-2">
        <a
          href={INSTALL_MANUAL_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-blue-600 underline"
          title="설치 매뉴얼"
        >
          설치 매뉴얼
        </a>
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
        <ProgressBar pct={progress.pct} busy={busy} etaLabel={etaLabel} />
        <p className="text-xs text-muted-foreground">{progress.message}</p>
        {progress.error && <p className="text-xs text-red-600">{progress.error}</p>}
        <ProgressStagesList stages={stages} />
      </div>
      <LiveLogsPanel logs={progress.logs} />
    </div>
  );
}
