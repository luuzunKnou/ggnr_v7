'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_MAX_HEIGHT,
  COMPLAINT_DETAIL_PANEL_WIDTH,
  COMPLAINT_DETAIL_PANEL_Z_INDEX,
} from '../../../_mapComponents/complaint/complaintPanelLayout';
import {
  getRowValueByDefineField,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils';
import { useSafetyLayerDetailColumns } from '../useSafetyLayerDetailColumns';
import { WATER_PLAY_MGMT_ZONE_GEO_TABLE } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';

type Props = {
  row: Record<string, unknown> | null;
  onClose: () => void;
};

function formatCell(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '-';
    }
  }
  const s = String(v).trim();
  return s || '-';
}

function fieldLabel(f: DefineFieldLike): string {
  const kor = String(f.define_field_kor_name ?? '').trim();
  const name = String(f.define_field_name ?? '').trim();
  return kor || name || '-';
}

function fieldName(f: DefineFieldLike): string {
  return String(f.define_field_name ?? '').trim();
}

export function WaterPlayMgmtZoneDetailFloating({ row, onClose }: Props) {
  const mapContext = useMapContext();
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20;
  const { columns, columnsLoading } = useSafetyLayerDetailColumns(WATER_PLAY_MGMT_ZONE_GEO_TABLE);

  const title = useMemo(() => {
    if (!row) return '물놀이 관리지역';
    const plc = formatCell(getRowValueByDefineField(row, 'plc_nm'));
    return plc !== '-' ? plc : '물놀이 관리지역';
  }, [row]);

  const pairs = useMemo(() => {
    const list = columns.filter((f) => fieldName(f));
    const out: [DefineFieldLike, DefineFieldLike | null][] = [];
    for (let i = 0; i < list.length; i += 2) {
      out.push([list[i]!, list[i + 1] ?? null]);
    }
    return out;
  }, [columns]);

  if (!row) return null;

  return (
    <MapFloatingPanel
      viewport
      width={COMPLAINT_DETAIL_PANEL_WIDTH}
      maxHeight={COMPLAINT_DETAIL_PANEL_MAX_HEIGHT}
      style={{ zIndex: COMPLAINT_DETAIL_PANEL_Z_INDEX }}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={title}>
            {title}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="standard-detail-scroll">
          {columnsLoading ? (
            <p className="standard-detail-loading">불러오는 중…</p>
          ) : pairs.length === 0 ? (
            <p className="standard-detail-attr-empty">표시할 필드가 없습니다.</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-[25%]" />
                  <col className="w-[25%]" />
                  <col className="w-[25%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <tbody>
                  {pairs.map(([left, right], rowIdx) => {
                    const leftName = fieldName(left);
                    const rightName = right ? fieldName(right) : '';
                    return (
                      <tr key={`${leftName}-${rightName || rowIdx}`}>
                        <th
                          scope="row"
                          className="standard-detail-attr-label border border-border text-left align-top font-normal"
                        >
                          {fieldLabel(left)}
                        </th>
                        <td className="standard-detail-attr-value border border-border text-foreground align-top">
                          {formatCell(getRowValueByDefineField(row, leftName))}
                        </td>
                        <th
                          scope="row"
                          className="standard-detail-attr-label border border-border text-left align-top font-normal"
                        >
                          {right ? fieldLabel(right) : '\u00a0'}
                        </th>
                        <td className="standard-detail-attr-value border border-border text-foreground align-top">
                          {right
                            ? formatCell(getRowValueByDefineField(row, rightName))
                            : '\u00a0'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mt-3 flex shrink-0 items-center justify-between gap-2 px-3 pb-2">
          <p className="standard-detail-hint min-w-0 text-muted-foreground/70">
            출처: 생활안전정보 (제공기관: 행정안전부)
          </p>
          <Button
            size="sm"
            variant="outline"
            title="닫기"
            onClick={onClose}
            className="h-[26px] min-h-[26px] shrink-0 cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            닫기
          </Button>
        </div>
      </div>
    </MapFloatingPanel>
  );
}
