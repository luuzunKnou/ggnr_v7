'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { VersionHistoryDialog } from './VersionHistoryDialog';
import type { SourcePackageProfile } from './sourceUpload/sourceUploadProfiles';
import {
  relayLatestSourceFromGnms,
  type RestartMode,
  type VersionRelayProgress,
  type VersionRelayResult,
} from '@/lib/sourceVersionClientRelay';

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

export function VersionManagerContent() {
  const [leftProfile, setLeftProfile] = useState<SourcePackageProfile>('closed');
  const [rightProfile, setRightProfile] = useState<SourcePackageProfile>('closed');
  const [restart, setRestart] = useState(true);
  const [restartMode, setRestartMode] = useState<RestartMode>('exit');
  const [leftBusy, setLeftBusy] = useState(false);
  const [rightBusy, setRightBusy] = useState(false);
  const [left, setLeft] = useState<SideProgress>(emptySideProgress());
  const [right, setRight] = useState<SideProgress>(emptySideProgress());
  const [relayResult, setRelayResult] = useState<VersionRelayResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const leftLogRef = useRef<string[]>([]);
  const rightLogRef = useRef<string[]>([]);

  const anyBusy = leftBusy || rightBusy;

  const pushLeftLog = (line: string) => {
    const next = [...leftLogRef.current, `[${new Date().toLocaleTimeString()}] ${line}`].slice(-60);
    leftLogRef.current = next;
    setLeft((p) => ({ ...p, logs: next }));
  };

  const pushRightLog = (line: string) => {
    const next = [...rightLogRef.current, `[${new Date().toLocaleTimeString()}] ${line}`].slice(-60);
    rightLogRef.current = next;
    setRight((p) => ({ ...p, logs: next }));
  };

  const downloadInstallZip = async () => {
    setLeftBusy(true);
    setLeft({ ...emptySideProgress(), message: '설치 ZIP 생성 준비...' });
    leftLogRef.current = [];
    try {
      const buildRes = await fetch('/api/source/version/install-zip/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: leftProfile }),
      });
      const buildJson = (await buildRes.json()) as {
        error?: string;
        zipName?: string;
        downloadUrl?: string;
        progressId?: string;
      };
      if (!buildRes.ok) throw new Error(buildJson.error ?? 'ZIP 생성 실패');
      setLeft((p) => ({ ...p, message: 'ZIP 다운로드 중...', pct: 85 }));
      pushLeftLog(`ZIP 생성 완료: ${buildJson.zipName ?? ''}`);

      const downloadUrl =
        buildJson.downloadUrl ??
        `/api/source/version/install-zip/download?progressId=${encodeURIComponent(buildJson.progressId ?? '')}`;
      const res = await fetch(downloadUrl, { method: 'GET' });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '다운로드 실패');
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = decodeURIComponent(match?.[1] ?? buildJson.zipName ?? `source_install_${Date.now()}.zip`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setLeft({ message: `다운로드 완료: ${fileName}`, pct: 100, logs: leftLogRef.current, error: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLeft({ message: '실패', pct: null, logs: leftLogRef.current, error: msg });
      pushLeftLog(`ERROR: ${msg}`);
    } finally {
      setLeftBusy(false);
    }
  };

  const runUpdate = async () => {
    setRightBusy(true);
    setRelayResult(null);
    rightLogRef.current = [];
    setRight({ ...emptySideProgress(), message: 'GNMS 최신 버전 조회 중...' });
    try {
      const json = await relayLatestSourceFromGnms({
        restart,
        restartMode,
        packageProfile: rightProfile,
        onProgress: (p: VersionRelayProgress) => {
          const pct =
            p.totalBytes && p.bytesDone != null
              ? Math.min(100, Math.round((p.bytesDone / p.totalBytes) * 100))
              : null;
          setRight((prev) => ({ ...prev, message: p.message, pct }));
        },
        onLog: pushRightLog,
      });
      setRelayResult(json);
      setRight({
        message: json.restart?.scheduled ? '최신 소스 적용 완료. 서버 재시작 예약됨' : '최신 소스 적용 완료',
        pct: 100,
        logs: rightLogRef.current,
        error: null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRight({ message: '실패', pct: null, logs: rightLogRef.current, error: msg });
      pushRightLog(`ERROR: ${msg}`);
    } finally {
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">버전관리</div>
          <p className="text-xs text-muted-foreground">
            개발자 기본 배포용 설치파일 다운로드 및 사용자 업데이트용 최신소스 적용
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          이력
        </Button>
      </div>

      <VersionHistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        defaultFilter="version_all"
        showFeatureFilter
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {/* 왼쪽: 설치파일 다운로드 */}
        <div className={`rounded border p-3 ${rightBusy ? 'opacity-60' : ''}`}>
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
          <div className="mt-3">
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
          </div>
          {rightBusy && <p className="mt-2 text-xs text-muted-foreground">대기 — 오른쪽 작업 중</p>}
          {leftBusy && left.pct != null && (
            <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${left.pct}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{left.message}</p>
          {left.error && <p className="text-xs text-red-600">{left.error}</p>}
          {left.logs.length > 0 && (
            <div className="mt-2 max-h-28 overflow-auto rounded border bg-muted/20 p-2 font-mono text-[11px]">
              {left.logs.map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* 오른쪽: 최신 소스 적용 */}
        <div className={`rounded border p-3 ${leftBusy ? 'opacity-60' : ''}`}>
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
            <Button type="button" variant="outline" disabled title="준비 중">
              최신소스 일부 적용(준비중)
            </Button>
          </div>
          {leftBusy && <p className="mt-2 text-xs text-muted-foreground">대기 — 왼쪽 작업 중</p>}
          {rightBusy && right.pct != null && (
            <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${right.pct}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{right.message}</p>
          {right.error && <p className="text-xs text-red-600">{right.error}</p>}
          {right.logs.length > 0 && (
            <div className="mt-2 max-h-28 overflow-auto rounded border bg-muted/20 p-2 font-mono text-[11px]">
              {right.logs.map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))}
            </div>
          )}
          {relayResult && (
            <div className="mt-2 rounded border bg-muted/10 p-2 text-xs">
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
