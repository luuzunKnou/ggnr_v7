'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess';
import {
  occupationParcelModalFieldFullWidth,
  occupationParcelModalMaxWidthClass,
} from './occupationLedgerListWidth';

/** 보상편입용지 필지 모달과 같은 표·버튼 */
const modalTableClass = 'w-full table-fixed border-collapse text-[11px]';
const modalThClass =
  'border border-border bg-muted px-2 py-1.5 text-left align-middle font-medium text-muted-foreground break-keep';
const modalTdClass = 'border border-border bg-background px-1.5 py-0.5 align-middle';
const fieldViewClass = 'flex min-h-7 w-full min-w-0 items-center break-all text-[11px] text-foreground';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';

type ChildAttr = { field: string; label: string; value: string };

type Props = {
  serEng: string;
  role: 'jijuk' | 'mgj';
  ogcFid: string;
  /** 목록 행 주소 (상세 머리 표시) */
  address?: string;
  onClose: () => void;
  /** 있으면 쓰기 권한일 때 «수정» 단추 — 수정 모드 전환 후 이 건 편집 */
  onEdit?: () => void;
  /** 목록+상세 패널 전체 폭만 덮는 오버레이 위치 — 지도는 계속 보이고 조작 가능 */
  overlayLeftPx: number;
  overlayWidthPx: number;
};

/** 값이 길거나 비고류만 한 줄 전체, 나머지는 속성 두 개씩 한 행 */
function buildRows(attrs: ChildAttr[]) {
  const rows: { full: boolean; items: ChildAttr[] }[] = [];
  let i = 0;
  const isFull = (a: ChildAttr) =>
    occupationParcelModalFieldFullWidth(a.field, a.label, a.value);
  while (i < attrs.length) {
    const cur = attrs[i]!;
    const next = attrs[i + 1];
    if (isFull(cur) || !next || isFull(next)) {
      rows.push({ full: true, items: [cur] });
      i += 1;
      continue;
    }
    rows.push({ full: false, items: [cur, next] });
    i += 2;
  }
  return rows;
}

/** 필지·물건지 상세 — 필드 정의 «상세보기» 칸만 (정의가 없으면 받은 칸 전부) */
export function OccupationLedgerChildModal({
  serEng,
  role,
  ogcFid,
  address,
  onClose,
  onEdit,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const canWrite = useSerWriteAccess(serEng);
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  const reqKey = `${serEng}|${role}|${ogcFid}`;
  const [result, setResult] = useState<{
    key: string;
    error: string | null;
    attributes: ChildAttr[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'occupationLedgerService',
      action: 'getOccupationLedgerChildDetail',
      params: { serEng, role, ogcFid },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setResult({
          key: reqKey,
          error: data?.error ? String(data.error) : null,
          attributes: Array.isArray(data?.attributes) ? data.attributes : [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ key: reqKey, error: '상세 정보를 불러오지 못했습니다.', attributes: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ogcFid, reqKey, role, serEng]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (typeof document === 'undefined') return null;

  const loading = result?.key !== reqKey;
  const attrs = loading ? [] : (result?.attributes ?? []);
  const title = role === 'mgj' ? '물건지 상세' : '필지 상세';
  const fullScreen = overlayWidthPx <= 0;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: fullScreen ? 0 : overlayLeftPx,
        top: 0,
        width: fullScreen ? '100vw' : overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className={cn(
          'relative flex max-h-[calc(100dvh-5rem)] w-full flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
          occupationParcelModalMaxWidthClass(overlayWidthPx)
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {address ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={address}>
              {address}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          {loading ? (
            <div className="flex items-center gap-1.5 py-4 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              불러오는 중…
            </div>
          ) : result?.error ? (
            <p className="py-4 text-[11px] text-destructive">{result.error}</p>
          ) : attrs.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">표시할 속성이 없습니다.</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className={modalTableClass}>
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[24%]" />
                  <col className="w-[26%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <tbody>
                  {buildRows(attrs).map((row) =>
                    row.full ? (
                      <tr key={row.items[0]!.field}>
                        <th className={modalThClass}>{row.items[0]!.label}</th>
                        <td colSpan={3} className={modalTdClass}>
                          <div className={fieldViewClass}>{String(row.items[0]!.value ?? '').trim() || '—'}</div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={`${row.items[0]!.field}-${row.items[1]!.field}`}>
                        {row.items.map((a) => (
                          <ChildCells key={a.field} attr={a} />
                        ))}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">
          {onEdit && canWrite && !loading && !result?.error ? (
            <button type="button" className={btnPrimary} onClick={onEdit}>
              수정
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ChildCells({ attr }: { attr: ChildAttr }) {
  return (
    <>
      <th className={modalThClass}>{attr.label}</th>
      <td className={modalTdClass}>
        <div className={fieldViewClass}>{String(attr.value ?? '').trim() || '—'}</div>
      </td>
    </>
  );
}
