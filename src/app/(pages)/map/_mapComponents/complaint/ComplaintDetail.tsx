'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useMapContext } from '../MapContext';
import { MapFloatingPanel } from '../MapFloatingPanel';
import { ComplaintDetailPanel } from './complaint-detail-panel';
import type { CompUI, CompdUI } from './types';
import type {
  ComplaintDefineFieldSave,
  ComplaintFormValues,
} from './complaint-info';
import { call } from '@/lib/api';
import {
  animateComplaintToCenter3857,
  center3857FromExtent,
} from './useComplaintMapClick';
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_MAX_HEIGHT,
  COMPLAINT_DETAIL_PANEL_WIDTH,
} from './complaintPanelLayout';
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess';
import { useSafetyLayerDetailColumns } from '../../_mapContents/safty/useSafetyLayerDetailColumns';

const COMP_TABLE = 'comp';

type Props = {
  /** 상하수도 통합 민원관리(구 통합UI) 메뉴에서 열었는지 */
  commonUi?: boolean;
  onListRefresh?: () => void;
};

export default function ComplaintDetail({ commonUi = false, onListRefresh }: Props) {
  const mapContext = useMapContext();
  const canWrite = useSerWriteAccess('complaint');
  const complaintDetail = mapContext?.complaintDetail ?? null;
  const setComplaintDetail = mapContext?.setComplaintDetail;
  /** 화면 기준 기본 위치 — 목록 패널 오른쪽(지도 왼쪽 끝)에서 조금 떨어뜨림 */
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [defineFieldValues, setDefineFieldValues] = useState<Record<string, string>>({});

  const useDefineFields = commonUi;
  const { columns: defineFields } = useSafetyLayerDetailColumns(
    useDefineFields ? COMP_TABLE : ''
  );

  useEffect(() => {
    if (!useDefineFields || !complaintDetail?.compKey) {
      setDefineFieldValues({});
      return;
    }
    let cancelled = false;
    void call('', 'POST', {
      service: 'complaintService',
      action: 'getFieldDetail',
      params: { compKey: complaintDetail.compKey },
    }).then((res) => {
      if (cancelled) return;
      const data = res?.data ?? res;
      const row = (data?.row ?? {}) as Record<string, string>;
      setDefineFieldValues(row);
    });
    return () => {
      cancelled = true;
    };
  }, [useDefineFields, complaintDetail?.compKey]);

  const bumpList = useCallback(() => {
    onListRefresh?.();
  }, [onListRefresh]);

  const reloadDetail = useCallback(
    async (compKey: number) => {
      if (!setComplaintDetail) return;
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'get',
        params: { compKey },
      });
      if (res?.success && res?.data) {
        setComplaintDetail(res.data as typeof complaintDetail);
      }
    },
    [complaintDetail, setComplaintDetail]
  );

  const handleAddHistory = useCallback(
    async (data: {
      compdDate: string;
      compdCu: string;
      compdCt: string;
      compdCg: string;
      compdState: string;
      compdContent: string;
    }) => {
      if (!complaintDetail || !setComplaintDetail) return;
      await call('', 'POST', {
        service: 'complaintService',
        action: 'compdCreate',
        params: {
          compKey: complaintDetail.compKey,
          compdDate: data.compdDate,
          compdCu: data.compdCu || null,
          compdCt: data.compdCt || null,
          compdCg: data.compdCg || null,
          compdState: data.compdState,
          compdContents: data.compdContent || null,
          compdExtra: {},
        },
      });
      await reloadDetail(complaintDetail.compKey);
      bumpList();
    },
    [complaintDetail, setComplaintDetail, bumpList, reloadDetail]
  );

  const handleEditHistory = useCallback(
    async (
      compdKey: number,
      data: {
        compdDate: string;
        compdCu: string;
        compdCt: string;
        compdCg: string;
        compdState: string;
        compdContent: string;
      }
    ) => {
      if (!complaintDetail || !setComplaintDetail) return;
      await call('', 'POST', {
        service: 'complaintService',
        action: 'compdUpdate',
        params: {
          compdKey,
          compdDate: data.compdDate,
          compdCu: data.compdCu || null,
          compdCt: data.compdCt || null,
          compdCg: data.compdCg || null,
          compdState: data.compdState,
          compdContents: data.compdContent || null,
          compdExtra: {},
        },
      });
      await reloadDetail(complaintDetail.compKey);
      bumpList();
    },
    [complaintDetail, setComplaintDetail, bumpList, reloadDetail]
  );

  const handleDeleteHistory = useCallback(
    async (compdKey: number) => {
      if (!complaintDetail || !setComplaintDetail) return;
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'compdRemove',
        params: { compdKey },
      });
      if (res?.success && res?.data?.deleted) {
        await reloadDetail(complaintDetail.compKey);
        bumpList();
      }
    },
    [complaintDetail, setComplaintDetail, bumpList, reloadDetail]
  );

  const handleSave = useCallback(
    async (values: ComplaintFormValues) => {
      if (!complaintDetail || !setComplaintDetail) return;
      setSaving(true);
      try {
        const res = await call('', 'POST', {
          service: 'complaintService',
          action: 'update',
          params: {
            compKey: complaintDetail.compKey,
            compName: values.compName || null,
            compTel: values.compTel || null,
            compDate: values.compDate || null,
            compCg: values.compCg || null,
            compCt: values.compCt || null,
            compCu: values.compCu || null,
            compAdr: values.compAdr || null,
            compContent: values.compContent || null,
            lon: values.lon ?? null,
            lat: values.lat ?? null,
          },
        });
        if (res?.success && res?.data) {
          const data = res.data as typeof complaintDetail & {
            extent3857?: [number, number, number, number] | null;
          };
          setComplaintDetail(data);
          bumpList();
          const map = mapContext?.mapInstanceRef?.current;
          const center = center3857FromExtent(data.extent3857);
          if (map && center) {
            animateComplaintToCenter3857(map, center, () =>
              mapContext?.applyMapViewPaddingRef?.current?.()
            );
          }
        }
      } finally {
        setSaving(false);
      }
    },
    [complaintDetail, setComplaintDetail, bumpList, mapContext]
  );

  const handleSaveDefineFields = useCallback(
    async (payload: ComplaintDefineFieldSave) => {
      if (!complaintDetail || !setComplaintDetail) return;
      setSaving(true);
      try {
        const res = await call('', 'POST', {
          service: 'complaintService',
          action: 'saveFieldDetail',
          params: {
            compKey: complaintDetail.compKey,
            values: payload.values,
            lon: payload.lon,
            lat: payload.lat,
          },
        });
        const data = res?.data ?? res;
        if (data?.error) throw new Error(String(data.error));
        const raw = (data?.row ?? {}) as Record<string, string>;
        setDefineFieldValues(raw);
        await reloadDetail(complaintDetail.compKey);
        bumpList();
        const map = mapContext?.mapInstanceRef?.current;
        const center = center3857FromExtent(
          Array.isArray(data?.extent3857)
            ? (data.extent3857 as [number, number, number, number])
            : null
        );
        if (map && center) {
          animateComplaintToCenter3857(map, center, () =>
            mapContext?.applyMapViewPaddingRef?.current?.()
          );
        }
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : '민원 저장에 실패했습니다.');
      } finally {
        setSaving(false);
      }
    },
    [bumpList, complaintDetail, mapContext, reloadDetail, setComplaintDetail]
  );

  const handleDelete = useCallback(async () => {
    if (!complaintDetail || !setComplaintDetail) return;
    if (!confirm('이 민원 접수를 삭제하시겠습니까?')) return;
    setDeleting(true);
    try {
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'remove',
        params: { compKey: complaintDetail.compKey },
      });
      if (res?.success && res?.data?.deleted) {
        setComplaintDetail(null);
        bumpList();
      }
    } finally {
      setDeleting(false);
    }
  }, [complaintDetail, setComplaintDetail, bumpList]);

  if (complaintDetail === null || !setComplaintDetail) return null;

  const handleClose = () => setComplaintDetail(null);

  const compAsUI: CompUI = {
    compKey: complaintDetail.compKey,
    compDate: complaintDetail.compDate,
    compCu: complaintDetail.compCu,
    compCt: complaintDetail.compCt,
    compCg: complaintDetail.compCg,
    compAdr: complaintDetail.compAdr,
    compName: complaintDetail.compName,
    compTel: complaintDetail.compTel,
    compContent: complaintDetail.compContent,
    compExtra: complaintDetail.compExtra,
    extent3857: complaintDetail.extent3857,
    geomGeoJson4326: complaintDetail.geomGeoJson4326,
  };

  const compdListAsUI: CompdUI[] = (complaintDetail.compdList ?? []).map((h) => ({
    ...h,
    compdTitle: (h.compdExtra as { title?: string })?.title,
    compdContent: h.compdContents ?? (h.compdExtra as { content?: string })?.content,
  }));

  return (
    <MapFloatingPanel
      viewport
      zLayer="detailFloating"
      width={COMPLAINT_DETAIL_PANEL_WIDTH}
      maxHeight={COMPLAINT_DETAIL_PANEL_MAX_HEIGHT}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">
            민원 #{complaintDetail.compKey}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={handleClose}
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
          complaint={compAsUI}
          histories={compdListAsUI}
          onAddHistory={canWrite ? handleAddHistory : undefined}
          onEditHistory={canWrite ? handleEditHistory : undefined}
          onDeleteHistory={canWrite ? handleDeleteHistory : undefined}
          onSave={canWrite && !useDefineFields ? handleSave : undefined}
          defineFields={useDefineFields ? defineFields : undefined}
          defineFieldValues={useDefineFields ? defineFieldValues : undefined}
          tableName={useDefineFields ? COMP_TABLE : undefined}
          onSaveDefineFields={
            canWrite && useDefineFields ? handleSaveDefineFields : undefined
          }
          onDelete={canWrite ? handleDelete : undefined}
          onClose={handleClose}
          saving={saving}
          deleting={deleting}
        />
      </div>
    </MapFloatingPanel>
  );
}
