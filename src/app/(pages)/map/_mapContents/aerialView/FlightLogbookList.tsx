'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { FlightLogbookForm } from './FlightLogbookForm';

type LogbookRow = {
  flKey: number;
  dateFlightTime: string;
  pilotName: string;
  flightArea: string;
  createdAt: string | null;
};

type Props = {
  workUnitLabel?: string;
  srKey?: number | null;
  onClose?: () => void;
  /** 대화상자처럼 높이를 채울 때 */
  fill?: boolean;
  title?: string;
  infoSectionLabel?: string;
  /** 목록 건수가 바뀌면 부모 버튼 숫자 갱신 */
  onCountChange?: (count: number) => void;
};

function rowFromApi(raw: Record<string, unknown>): LogbookRow | null {
  const flKey = Number(raw.flKey);
  if (!Number.isFinite(flKey)) return null;
  return {
    flKey,
    dateFlightTime: String(raw.dateFlightTime ?? '').trim(),
    pilotName: String(raw.pilotName ?? '').trim(),
    flightArea: String(raw.flightArea ?? '').trim(),
    createdAt: raw.createdAt != null ? String(raw.createdAt) : null,
  };
}

export function FlightLogbookList({
  workUnitLabel,
  srKey,
  onClose,
  fill = false,
  title = '무인비행장치 비행기록부',
  infoSectionLabel = '비행 정보',
  onCountChange,
}: Props) {
  const [rows, setRows] = useState<LogbookRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const key = srKey != null && Number.isFinite(srKey) ? Number(srKey) : null;
  const label = workUnitLabel?.trim() || '';
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const load = useCallback(async () => {
    if (key == null && !label) {
      setRows([]);
      onCountChangeRef.current?.(0);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await call('', 'POST', {
        service: 'flightLogbookService',
        action: 'list',
        params: key != null ? { srKey: key, limit: 50 } : { workUnitLabel: label, limit: 50 },
      });
      const data = res?.data ?? res;
      const items = Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) : [];
      const next = items
        .map(rowFromApi)
        .filter((row): row is LogbookRow => row != null)
        .sort((a, b) => {
          const at = a.createdAt ?? '';
          const bt = b.createdAt ?? '';
          if (at !== bt) return at < bt ? -1 : 1;
          return a.flKey - b.flKey;
        });
      setRows(next);
      onCountChangeRef.current?.(next.length);
    } catch {
      setRows([]);
      onCountChangeRef.current?.(0);
      setNotice('비행기록부 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [key, label]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRow = async (flKey: number) => {
    if (deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      await call('', 'POST', {
        service: 'flightLogbookService',
        action: 'remove',
        params: { flKey },
      });
      setPendingDelete(null);
      await load();
    } catch {
      setNotice('삭제하지 못했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  if (editing != null) {
    return (
      <FlightLogbookForm
        workUnitLabel={label || undefined}
        srKey={key}
        recordKey={editing === 'new' ? null : editing}
        title={editing === 'new' ? `${title} 추가` : title}
        infoSectionLabel={infoSectionLabel}
        embedded={!fill}
        onClose={onClose}
        headerAction={
          <button
            type="button"
            className="rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
            onClick={() => setEditing(null)}
          >
            목록
          </button>
        }
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col bg-background', fill ? 'h-full' : 'h-auto')}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 truncate text-[12px] font-semibold text-foreground">
          {title}
          {rows.length > 0 ? ` ${rows.length}건` : ''}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
            onClick={() => {
              setPendingDelete(null);
              setEditing('new');
            }}
          >
            추가
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn('space-y-1.5 px-3 py-2', fill ? 'min-h-0 flex-1 overflow-y-auto' : '')}>
        {loading ? <p className="text-[11px] text-muted-foreground">불러오는 중…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            작성된 장이 없습니다. 추가로 첫 장을 만듭니다.
          </p>
        ) : null}
        {rows.map((row, index) => {
          const when = row.dateFlightTime || '비행일시 없음';
          const who = [row.pilotName, row.flightArea].filter(Boolean).join(' · ');
          const confirming = pendingDelete === row.flKey;
          return (
            <div key={row.flKey} className="rounded border border-border">
              <button
                type="button"
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-muted/40"
                onClick={() => {
                  setPendingDelete(null);
                  setEditing(row.flKey);
                }}
              >
                <span className="mt-0.5 w-4 shrink-0 text-[10px] text-muted-foreground">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-foreground">{when}</span>
                  {who ? (
                    <span className="block truncate text-[10px] text-muted-foreground">{who}</span>
                  ) : (
                    <span className="block text-[10px] text-muted-foreground">조종자 · 비행지역 없음</span>
                  )}
                </span>
              </button>
              <div className="flex items-center justify-end gap-1.5 border-t border-border px-2 py-1">
                {confirming ? (
                  <>
                    <span className="mr-auto text-[10px] text-muted-foreground">이 장만 삭제합니다.</span>
                    <button
                      type="button"
                      className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
                      disabled={deleting}
                      onClick={() => void removeRow(row.flKey)}
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
                      disabled={deleting}
                      onClick={() => setPendingDelete(null)}
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
                    onClick={() => setPendingDelete(row.flKey)}
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {notice ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-900">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
