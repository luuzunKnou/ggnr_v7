'use client';

import { useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';

type RestartMode = 'none' | 'exit' | 'command';

type UpdateResult = {
  version: string;
  fileName: string;
  downloadedBytes: number;
  appliedFiles: number;
  skippedFiles: number;
  gnmsBaseUrl: string;
  latestUrl: string;
  downloadUrl: string;
  restart: {
    requested: boolean;
    mode: RestartMode;
    scheduled: boolean;
    message: string;
    signalFile: string;
  };
  skippedSamples?: string[];
};

export function VersionManagerContent() {
  const [restart, setRestart] = useState(true);
  const [restartMode, setRestartMode] = useState<RestartMode>('exit');
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('대기 중');
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runUpdate = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setMessage('GNMS 최신 버전 조회 중...');
    try {
      const res = await fetch('/api/source/version/update-latest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restart, restartMode }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & UpdateResult;
      if (!res.ok) throw new Error(json.error ?? '최신 소스 업데이트 실패');
      setResult(json);
      if (json.restart?.scheduled) {
        setMessage('최신 소스 적용 완료. 서버 재시작 예약됨');
      } else {
        setMessage('최신 소스 적용 완료');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setMessage('실패');
    } finally {
      setRunning(false);
    }
  };

  const downloadInstallZip = async () => {
    setDownloading(true);
    setError(null);
    setMessage('설치 ZIP 생성/다운로드 준비 중...');
    try {
      const res = await fetch('/api/source/version/install-zip', {
        method: 'GET',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? '설치 ZIP 다운로드 실패');
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = decodeURIComponent(match?.[1] ?? `source_install_${Date.now()}.zip`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setMessage(`설치 ZIP 다운로드 완료: ${fileName}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessage('실패');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2">
      <div className="rounded border p-3">
        <div className="text-sm font-medium">GNMS 최신 소스 코드 업데이트</div>
        <p className="mt-1 text-xs text-muted-foreground">
          GNMS에서 최신 ZIP을 내려받아 현재 워크스페이스에 덮어쓴 뒤 재시작할 수 있습니다.
        </p>

        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={restart}
              disabled={running}
              onChange={(e) => setRestart(e.target.checked)}
            />
            적용 후 서버 재시작
          </label>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="restartMode"
                checked={restartMode === 'exit'}
                disabled={running || !restart}
                onChange={() => setRestartMode('exit')}
              />
              process.exit 재시작(프로세스 매니저 필요)
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="restartMode"
                checked={restartMode === 'command'}
                disabled={running || !restart}
                onChange={() => setRestartMode('command')}
              />
              명령 실행 재시작(`GGNR_RESTART_COMMAND`)
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="restartMode"
                checked={restartMode === 'none'}
                disabled={running || !restart}
                onChange={() => setRestartMode('none')}
              />
              재시작 안 함
            </label>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button type="button" disabled={running || downloading} onClick={() => void runUpdate()} className="gap-1">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            최신 소스 적용
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={running || downloading}
            onClick={() => void downloadInstallZip()}
            className="gap-1"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            설치파일 다운로드
          </Button>
          <span className="text-xs text-muted-foreground">{message}</span>
        </div>

        {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
      </div>

      {result && (
        <div className="rounded border p-3 text-xs">
          <div className="mb-1">버전: {result.version}</div>
          <div className="mb-1">파일: {result.fileName}</div>
          <div className="mb-1">다운로드: {Math.round(result.downloadedBytes / 1024 / 1024)} MB</div>
          <div className="mb-1">적용: {result.appliedFiles}건</div>
          <div className="mb-1">제외: {result.skippedFiles}건</div>
          <div className="mb-1">GNMS: {result.gnmsBaseUrl}</div>
          <div className="mb-1">latest API: {result.latestUrl}</div>
          <div className="mb-1">download URL: {result.downloadUrl}</div>
          <div className="mb-1">재시작: {result.restart?.message}</div>
          <div className="mb-1">신호파일: {result.restart?.signalFile}</div>
          {(result.skippedSamples?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-medium">제외 샘플</div>
              <ul className="mt-1 list-disc pl-4">
                {result.skippedSamples!.slice(0, 10).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
