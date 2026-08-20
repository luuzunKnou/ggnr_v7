'use client';

import React, { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useMapContext } from '../MapContext';
import { MapFloatingPanel } from '../MapFloatingPanel';
import { ComplaintDetailPanel } from './complaint-detail-panel';
import type { CompUI, CompdUI } from './types';
import type { ComplaintFormValues } from './complaint-info';
import { call } from '@/lib/api';
import { fitMapToComplaintExtent3857 } from './fitComplaintMap';

type Props = {
  onListRefresh?: () => void;
};

export default function ComplaintDetail({ onListRefresh }: Props) {
  const mapContext = useMapContext();
  const complaintDetail = mapContext?.complaintDetail ?? null;
  const setComplaintDetail = mapContext?.setComplaintDetail;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const bumpList = useCallback(() => {
    onListRefresh?.();
  }, [onListRefresh]);

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
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'get',
        params: { compKey: complaintDetail.compKey },
      });
      if (res?.success && res?.data) {
        setComplaintDetail(res.data as typeof complaintDetail);
        bumpList();
      }
    },
    [complaintDetail, setComplaintDetail, bumpList]
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
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'get',
        params: { compKey: complaintDetail.compKey },
      });
      if (res?.success && res?.data) {
        setComplaintDetail(res.data as typeof complaintDetail);
        bumpList();
      }
    },
    [complaintDetail, setComplaintDetail, bumpList]
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
        const getRes = await call('', 'POST', {
          service: 'complaintService',
          action: 'get',
          params: { compKey: complaintDetail.compKey },
        });
        if (getRes?.success && getRes?.data) {
          setComplaintDetail(getRes.data as typeof complaintDetail);
          bumpList();
        }
      }
    },
    [complaintDetail, setComplaintDetail, bumpList]
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
          fitMapToComplaintExtent3857(
            mapContext?.mapInstanceRef?.current,
            data.extent3857,
            () => mapContext?.applyMapViewPaddingRef?.current?.()
          );
        }
      } finally {
        setSaving(false);
      }
    },
    [complaintDetail, setComplaintDetail, bumpList, mapContext]
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
  };

  const compdListAsUI: CompdUI[] = (complaintDetail.compdList ?? []).map((h) => ({
    ...h,
    compdTitle: (h.compdExtra as { title?: string })?.title,
    compdContent: h.compdContents ?? (h.compdExtra as { content?: string })?.content,
  }));

  return (
    <MapFloatingPanel
      width="600px"
      maxHeight="85vh"
      defaultPosition={{ top: 80, left: 20 }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">민원 #{complaintDetail.compKey}</span>
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
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ComplaintDetailPanel
          complaint={compAsUI}
          histories={compdListAsUI}
          onAddHistory={handleAddHistory}
          onEditHistory={handleEditHistory}
          onDeleteHistory={handleDeleteHistory}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={handleClose}
          saving={saving}
          deleting={deleting}
        />
      </div>
    </MapFloatingPanel>
  );
}
