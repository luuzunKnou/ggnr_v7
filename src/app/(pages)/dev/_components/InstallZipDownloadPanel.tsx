'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { LiveLogsPanel } from './LiveLogsPanel';
import { ProgressStagesList } from './ProgressStagesList';
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
import { streamDownloadFile } from '@/lib/streamFileDownload';
import { notifyDevVersionHistoryRefresh } from './devVersionHistoryBridge';
import type { InstallZipProgress } from '@/service/sourceInstallZipProgress';

const INSTALL_MANUAL_URL =
  process.env.NEXT_PUBLIC_GGNR_INSTALL_MANUAL_URL?.trim() ||
  'https://app.notion.com/p/daeguk/v7-2f2f538d1f598020a2a1dca9fb051e7b?source=copy_link';

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

function estimateRemainingSeconds(totalSec: number, pct: number | null, startedAtMs: number): number {
  if (totalSec <= 0) return 0;
  if (pct != null && pct > 2 && pct < 100) {
    const elapsed = (Date.now() - startedAtMs) / 1000;
    const projected = elapsed / (pct / 100);
    return Math.max(1, projected - elapsed);
  }
  if (pct != null && pct >= 0) {
    return Math.max(1, totalSec * (1 - pct / 100));
  }
  return totalSec;
}

function formatEtaSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '1분 미만';
  const s = Math.ceil(sec);
  if (s < 60) return `약 ${s}초`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `약 ${m}분`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `약 ${h}시간 ${rm}분` : `약 ${h}시간`;
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
  const [profile, setProfile] = useState<SourcePackageProfile>('closed');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SideProgress>(emptySideProgress());
  const [stages, setStages] = useState(() => buildInstallBaseStages());
  const logRef = useRef<string[]>([]);
  const infoDetailRef = useRef('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPhaseRef = useRef('');
  const lastLogMessageRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
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

  const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pushLog = (line: string) => {
    const next = [...logRef.current, `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${line}`].slice(-60);
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

  const downloadInstallZip = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setBusy(true);
    logRef.current = [];
    infoDetailRef.current = '';
    startedAtRef.current = Date.now();
    setInstallMeta({});
    lastPhaseRef.current = '';
    lastLogMessageRef.current = '';
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

      pushLog(`ZIP 생성 완료: ${buildJson.zipName ?? ''} (${buildJson.fileCount ?? '?'}건)`);
      setInstallMeta({
        fileCount: buildJson.fileCount,
        zipSize: buildJson.zipSize,
      });
      setStages((prev) =>
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

      setProgress((p) => ({ ...p, message: 'ZIP 다운로드 중...', pct: 90 }));
      pushLog('스트림 다운로드 시작');

      await streamDownloadFile(downloadUrl, fileName, (received, total) => {
        const pct = total && total > 0 ? Math.min(99, 90 + Math.round((received / total) * 10)) : 92;
        const msg = total ? `다운로드 ${formatBytes(received)} / ${formatBytes(total)}` : 'ZIP 다운로드 중...';
        setProgress((p) => ({
          ...p,
          message: msg,
          pct,
        }));
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
      }, signal);

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
      setProgress({ message: isAbort ? msg : '실패', pct: null, logs: logRef.current, error: isAbort ? null : msg });
      setStages((prev) => {
        const active = (prev.find((s) => s.state === 'active')?.id ?? 'scan') as InstallStageId;
        return patchStages(prev, { [active]: { state: 'error', detail: msg } });
      });
      pushLog(isAbort ? msg : `ERROR: ${msg}`);
    } finally {
      stopPoll();
      abortRef.current = null;
      setBusy(false);
    }
  };

  const etaLabel = (() => {
    void etaTick;
    if (!busy) return null;
    const fc = installMeta.fileCount;
    if (fc == null || fc <= 0) return '산출 중...';
    const total = estimateInstallZipTotalSeconds(fc, installMeta.zipSize, profile);
    const remain = estimateRemainingSeconds(total, progress.pct, startedAtRef.current);
    return formatEtaSeconds(remain);
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border p-3">
      <div className="shrink-0 space-y-2">
        <p className="text-xs text-muted-foreground">현재 서버를 설치용 ZIP으로 받습니다.</p>
        <a
          href={INSTALL_MANUAL_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-blue-600 underline"
        >
          설치 매뉴얼
        </a>
        <ProfileRadios profile={profile} setProfile={setProfile} disabled={busy} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void downloadInstallZip()}
            className="gap-1"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            설치파일 다운로드
          </Button>
          <Button type="button" variant="outline" disabled={!busy} onClick={() => abortRef.current?.abort()}>
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
