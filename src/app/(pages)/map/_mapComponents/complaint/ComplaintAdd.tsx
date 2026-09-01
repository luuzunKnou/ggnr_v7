'use client';

import React, { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { call } from '@/lib/api';
import { useMapContext } from '../MapContext';
import { MapFloatingPanel } from '../MapFloatingPanel';
import { ComplaintDetailPanel } from './complaint-detail-panel';
import type { CompUI } from './types';
import type { ComplaintFormValues } from './complaint-info';
import {
  animateComplaintToCenter3857,
  center3857FromExtent,
} from './useComplaintMapClick';
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_MAX_HEIGHT,
  COMPLAINT_DETAIL_PANEL_WIDTH,
  COMPLAINT_DETAIL_PANEL_Z_INDEX,
} from './complaintPanelLayout';

const EMPTY_COMP: CompUI = {
  compKey: 0,
  compDate: null,
  compCu: null,
  compCt: null,
  compCg: null,
  compAdr: null,
  compName: null,
  compTel: null,
  compContent: null,
  compExtra: null,
};

type Props = {
  onClose: () => void;
  onCreated?: () => void;
};

export default function ComplaintAdd({ onClose, onCreated }: Props) {
  const mapContext = useMapContext();
  const setComplaintDetail = mapContext?.setComplaintDetail;
  /** 화면 기준 기본 위치 — 목록 패널 오른쪽(지도 왼쪽 끝)에서 조금 떨어뜨림 */
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20;
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(
    async (values: ComplaintFormValues) => {
      if (!setComplaintDetail) return;
      setSaving(true);
      try {
        const createRes = await call('', 'POST', {
          service: 'complaintService',
          action: 'create',
          params: {
            compDate: values.compDate || null,
            compCu: values.compCu || null,
            compCt: values.compCt || null,
            compCg: values.compCg || null,
            compAdr: values.compAdr || null,
            compName: values.compName || null,
            compTel: values.compTel || null,
            compContent: values.compContent || null,
            lon: values.lon ?? null,
            lat: values.lat ?? null,
          },
        });
        const created = createRes?.data as
          | (CompUI & { extent3857?: [number, number, number, number] | null; compKey?: number })
          | undefined;
        const compKey = created?.compKey;
        if (!compKey) {
          window.alert('민원 등록에 실패했습니다.');
          return;
        }
        let detail = created;
        if (!created?.extent3857) {
          const getRes = await call('', 'POST', {
            service: 'complaintService',
            action: 'get',
            params: { compKey },
          });
          if (getRes?.success && getRes?.data) {
            detail = getRes.data as typeof created;
          }
        }
        if (detail) {
          setComplaintDetail(detail as Parameters<typeof setComplaintDetail>[0]);
          onCreated?.();
          onClose();
          const map = mapContext?.mapInstanceRef?.current;
          const center = center3857FromExtent(detail.extent3857);
          if (map && center) {
            animateComplaintToCenter3857(map, center, () =>
              mapContext?.applyMapViewPaddingRef?.current?.()
            );
          }
        }
      } catch (e) {
        console.error('민원 생성 실패:', e);
        window.alert('민원 등록에 실패했습니다.');
      } finally {
        setSaving(false);
      }
    },
    [setComplaintDetail, mapContext, onClose, onCreated]
  );

  return (
    <MapFloatingPanel
      viewport
      width={COMPLAINT_DETAIL_PANEL_WIDTH}
      maxHeight={COMPLAINT_DETAIL_PANEL_MAX_HEIGHT}
      style={{ zIndex: COMPLAINT_DETAIL_PANEL_Z_INDEX }}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">민원 추가</span>
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
        <ComplaintDetailPanel
          mode="add"
          complaint={EMPTY_COMP}
          histories={[]}
          onSave={handleCreate}
          onClose={onClose}
          saving={saving}
        />
      </div>
    </MapFloatingPanel>
  );
}
