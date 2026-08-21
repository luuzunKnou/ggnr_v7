'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo } from 'react';
import { FileText, Pentagon, X } from 'lucide-react';
import { recordDataViewLog } from '@/lib/recordDataViewLog';
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel';
import { InfoSection } from '@/app/(pages)/map/_mapComponents/standard/DetailInfoSection';
import {
  FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA,
  useSearchBarOffset,
} from '@/app/(pages)/map/searchBarOffsetContext';
import { buildSafetyFacDetailRows, SAFETY_FAC_TABLE_DETAIL_FIELDS } from './safetyFacDetailConfig';

type Props = {
  open: boolean;
  table: string;
  subtypeLabel: string;
  facilityName: string;
  detailAttrs: Record<string, unknown>;
  onClose: () => void;
};

export function SafetyFacilityDetailFloating({
  open,
  table,
  subtypeLabel,
  facilityName,
  detailAttrs,
  onClose,
}: Props) {
  const { leftPx, topPx } = useSearchBarOffset();
  const anchorPosition = useMemo(
    () => ({ top: topPx + FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA, left: leftPx }),
    [leftPx, topPx]
  );

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    if (!open) return;
    const tableName = String(table ?? '').trim();
    if (!tableName) return;
    const fields = SAFETY_FAC_TABLE_DETAIL_FIELDS[tableName] ?? [];
    const keyField = fields[0]?.field ?? 'ogc_fid';
    const lower = keyField.toLowerCase();
    let keyValue = '';
    for (const [k, v] of Object.entries(detailAttrs ?? {})) {
      if (k.toLowerCase() === lower) {
        keyValue = String(v ?? '').trim();
        break;
      }
    }
    if (!keyValue) {
      for (const [k, v] of Object.entries(detailAttrs ?? {})) {
        if (k.toLowerCase() === 'ogc_fid') {
          keyValue = String(v ?? '').trim();
          break;
        }
      }
    }
    if (!keyValue) return;
    recordDataViewLog({
      tableName,
      keyField,
      keyValue,
      serviceName: '안전시설',
    });
  }, [open, table, detailAttrs]);

  if (!open || typeof document === 'undefined') return null;

  const rows = buildSafetyFacDetailRows(table, detailAttrs);
  const infoFields = rows.map((r, i) => ({
    label: r.label,
    value: r.value !== '' ? r.value : '-',
    highlight: i === 0,
  }));

  return createPortal(
    <MapFloatingPanel
      className="rounded-[5px]"
      width="420px"
      maxHeight="80vh"
      defaultPosition={anchorPosition}
      style={{ position: 'fixed', zIndex: 200 }}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[13px] font-medium text-primary">
              <Pentagon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate" title={`${subtypeLabel} · ${facilityName}`}>
                {subtypeLabel}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 border-b border-slate-200">
          <div
            className="flex flex-1 items-center justify-center gap-1.5 border-b-2 border-primary bg-primary/5 py-2.5 text-xs font-medium text-primary"
            aria-current="page"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            기본정보
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InfoSection title="기본정보" fields={infoFields} defaultOpen={true} />
        </div>
      </div>
    </MapFloatingPanel>,
    document.body
  );
}
