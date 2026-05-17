'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { type SourceUploadCategory, type SourceUploadMode } from './sourceUpload/sourceUploadProfiles';

type UploadRow = {
  file: string;
  category: SourceUploadCategory;
  status: 'ok' | 'fail' | 'skipped';
  error?: string;
};

type StageId = 'scan' | 'zip' | 'init' | 'chunk' | 'complete' | 'finalize';
type StageState = 'pending' | 'active' | 'done' | 'error';
type StageItem = { id: StageId; label: string; state: StageState; detail?: string };

const BASE_STAGES: StageItem[] = [
  { id: 'scan', label: '소스 스캔/필터링', state: 'pending' },
  { id: 'zip', label: 'ZIP 압축', state: 'pending' },
  { id: 'init', label: '원격 업로드 세션 생성', state: 'pending' },
  { id: 'chunk', label: '청크 전송', state: 'pending' },
  { id: 'complete', label: '원격 병합/압축 해제', state: 'pending' },
  { id: 'finalize', label: '결과 집계', state: 'pending' },
];

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function SourceCodeUploaderContent() {
  const [mode, setMode] = useState<SourceUploadMode>('update');
  const [date, setDate] = useState(todayYmd());
  const [changeNote, setChangeNote] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastSavedRoot, setLastSavedRoot] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState('대기 중');
  const [stages, setStages] = useState<StageItem[]>(BASE_STAGES);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stats = useMemo(() => {
    const by = {
      core: 0,
      runtime: 0,
      data: 0,
      ok: 0,
      fail: 0,
      skipped: 0,
    };
    for (const r of rows) {
      by[r.category] += 1;
      if (r.status === 'ok') by.ok += 1;
      if (r.status === 'fail') by.fail += 1;
      if (r.status === 'skipped') by.skipped += 1;
    }
    return by;
  }, [rows]);

  const setStage = (id: StageId, state: StageState, detail?: string) => {
    setStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s))
    );
  };

  const runUploadCurrentWorkspace = async () => {
    setRows([]);
    setUploading(true);
    setProgressPct(3);
    setProgressText('요청 준비 중...');
    setStages(BASE_STAGES);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const stageOrder: StageId[] = ['scan', 'zip', 'init', 'chunk', 'complete'];
    const stageTextMap: Record<StageId, string> = {
      scan: '소스 스캔/필터링 중...',
      zip: 'ZIP 압축 중...',
      init: '원격 업로드 세션 생성 중...',
      chunk: 'ZIP 청크 전송 중...',
      complete: '원격 병합/압축 해제 대기 중...',
      finalize: '결과 집계 중...',
    };
    let stageIdx = 0;
    setStage('scan', 'active');
    setProgressText(stageTextMap.scan);
    const timer = setInterval(() => {
      const current = stageOrder[Math.min(stageIdx, stageOrder.length - 1)]!;
      const next = stageOrder[Math.min(stageIdx + 1, stageOrder.length - 1)]!;
      if (current !== next) {
        setStage(current, 'done');
        setStage(next, 'active');
      }
      stageIdx = Math.min(stageIdx + 1, stageOrder.length - 1);
      setProgressText(stageTextMap[next]);
      setProgressPct((prev) => Math.min(prev + 4, 90));
    }, 1200);
    try {
      const res = await fetch('/api/source/upload/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, date, changeNote }),
        signal,
      });
      const json = (await res.json()) as {
        error?: string;
        remoteBase?: string;
        zipName?: string;
        zipSize?: number;
        total?: number;
        ok?: number;
        skipped?: number;
        fail?: number;
        remoteResult?: {
          expectedChunks?: number;
          chunkSize?: number;
          complete?: Record<string, unknown>;
        };
        items?: UploadRow[];
      };
      if (!res.ok) {
        throw new Error(json?.error ?? 'source upload failed');
      }
      setLastSavedRoot(
        [json.remoteBase, json.zipName].filter(Boolean).join(' / ') || null
      );
      setRows(Array.isArray(json.items) ? json.items : []);
      setStage('scan', 'done', `총 ${json.total ?? 0}건 스캔`);
      setStage(
        'zip',
        'done',
        `ZIP ${json.zipName ?? '-'} (${Math.round(Number(json.zipSize ?? 0) / 1024 / 1024)}MB)`
      );
      setStage('init', 'done', '세션 생성 완료');
      setStage(
        'chunk',
        'done',
        `청크 ${Number(json.remoteResult?.expectedChunks ?? 0)}개 (${Math.round(
          Number(json.remoteResult?.chunkSize ?? 0) / 1024
        )}KB)`
      );
      setStage('complete', 'done', '원격 complete 호출 완료');
      setStage(
        'finalize',
        'done',
        `성공 ${json.ok ?? 0}, 제외 ${json.skipped ?? 0}, 실패 ${json.fail ?? 0}`
      );
      setProgressPct(100);
      setProgressText(
        `업로드 완료 (성공 ${json.ok ?? 0} / 제외 ${json.skipped ?? 0} / 실패 ${json.fail ?? 0})`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRows([{ file: '(전체)', category: 'core', status: 'fail', error: msg }]);
      setStages((prev) => {
        const active = prev.find((s) => s.state === 'active')?.id ?? 'scan';
        return prev.map((s) =>
          s.id === active ? { ...s, state: 'error', detail: msg } : s
        );
      });
      setProgressText(`실패: ${msg}`);
    } finally {
      clearInterval(timer);
      setUploading(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="rounded border p-3">
        <div className="mb-2 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'install'} onChange={() => setMode('install')} disabled={uploading} />
            설치
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'update'} onChange={() => setMode('update')} disabled={uploading} />
            업데이트
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            className="h-9 rounded border px-2 text-sm"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={uploading}
          />
          <input
            className="h-9 rounded border px-2 text-sm md:col-span-2"
            placeholder="변경 사항 메모 (선택)"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            disabled={uploading}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          설치: core/runtime/data 업로드. 업데이트: runtime 제외 + data는 <code>geoserver_modules/data_dir</code>만 포함.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            disabled={uploading}
            onClick={() => void runUploadCurrentWorkspace()}
            className="gap-1"
          >
            <Upload className="h-4 w-4" />
            현재 코드 자동 업로드
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!uploading}
            onClick={() => {
              abortControllerRef.current?.abort();
            }}
          >
            취소
          </Button>
          {lastSavedRoot && <span className="truncate text-xs text-muted-foreground">전송 대상 API: {lastSavedRoot}</span>}
        </div>
      </div>

      {uploading && (
        <div className="rounded border bg-muted/20 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progressText}
            </span>
            <span className="text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="rounded border px-3 py-2 text-xs">
        {stages.map((s) => (
          <div key={s.id} className="mb-1 flex items-center justify-between last:mb-0">
            <span
              className={
                s.state === 'done'
                  ? 'text-green-700 dark:text-green-400'
                  : s.state === 'error'
                    ? 'text-red-700 dark:text-red-400'
                    : s.state === 'active'
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-muted-foreground'
              }
            >
              {s.state === 'done'
                ? '완료'
                : s.state === 'error'
                  ? '실패'
                  : s.state === 'active'
                    ? '진행'
                    : '대기'}{' '}
              · {s.label}
            </span>
            <span className="ml-3 truncate text-muted-foreground">{s.detail ?? ''}</span>
          </div>
        ))}
      </div>

      <div className="rounded border p-2 text-xs">
        <span className="mr-3">core {stats.core}</span>
        <span className="mr-3">runtime {stats.runtime}</span>
        <span className="mr-3">data {stats.data}</span>
        <span className="mr-3 text-green-700 dark:text-green-400">성공 {stats.ok}</span>
        <span className="mr-3 text-red-700 dark:text-red-400">실패 {stats.fail}</span>
        <span className="text-muted-foreground">스킵 {stats.skipped}</span>
      </div>

      {!uploading && progressText !== '대기 중' && (
        <div className="rounded border bg-muted/10 px-3 py-2 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span>{progressText}</span>
            <span className="text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <section className="flex-1 min-h-0 overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1 w-20">분류</th>
              <th className="px-2 py-1">파일</th>
              <th className="px-2 py-1 w-20 text-center">상태</th>
              <th className="px-2 py-1">비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">
                  업로드 결과가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.file}-${i}`} className="border-t">
                  <td className="px-2 py-1">{r.category}</td>
                  <td className="px-2 py-1 truncate max-w-[30rem]" title={r.file}>
                    {r.file}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {r.status === 'ok' ? '완료' : r.status === 'skipped' ? '제외' : r.status === 'fail' ? '실패' : '대기'}
                  </td>
                  <td className="px-2 py-1 text-red-600 dark:text-red-400 truncate">{r.error ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

