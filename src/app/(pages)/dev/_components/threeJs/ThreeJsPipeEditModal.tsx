'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { DevFloatingPanel } from '../DevFloatingPanel';
import { call } from '@/lib/api';
import { shapePropsEqual } from './shapeCatalog';
import { GroundPickMap } from './GroundPickMap';
import { ShapeColorOpacityFields } from './ShapeColorOpacityFields';
import {
  GROUND_DEFAULT_STEP_M,
  PIPE_DEFAULT_RADIUS_M,
  type GroundHeightField,
  type PipeSegment,
  type ShapeProps,
} from './shapeTypes';

type Props = {
  open: boolean;
  titleName?: string;
  props: ShapeProps | null;
  onOpenChange: (open: boolean) => void;
  onPreview: (next: ShapeProps) => void;
  onSave: (next: ShapeProps) => void;
  onRollback: (snapshot: ShapeProps) => void;
  onDelete: () => void;
};

export function ThreeJsPipeEditModal({
  open,
  titleName,
  props,
  onOpenChange,
  onPreview,
  onSave,
  onRollback,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<ShapeProps | null>(null);
  const snapshotRef = useRef<ShapeProps | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !props || props.kind !== 'pipe') return;
    const snap = {
      ...props,
      pipeSegments: props.pipeSegments ?? null,
    };
    snapshotRef.current = snap;
    setDraft(snap);
    setStatus(
      props.pipeSegments?.length
        ? `관로 ${props.pipeSegments.length}건 준비됨`
        : '지도에서 사각형을 그린 뒤 «관로 생성»을 누르세요'
    );
  }, [open, props]);

  if (!draft || draft.kind !== 'pipe') return null;

  const center: [number, number] | null =
    draft.pipeCenterX != null && draft.pipeCenterY != null
      ? [draft.pipeCenterX, draft.pipeCenterY]
      : null;
  const radiusM = draft.pipeRadiusM ?? PIPE_DEFAULT_RADIUS_M;

  const applyDraft = (next: ShapeProps) => {
    setDraft(next);
    onPreview(next);
  };

  const buildPipes = async () => {
    if (center == null) {
      setStatus('지도에서 사각형 범위를 먼저 그리세요');
      return;
    }
    setBusy(true);
    setStatus('상수관로·표고 조회 중…');
    try {
      const [pipeRes, elevRes] = await Promise.all([
        call('', 'POST', {
          service: 'elevationService',
          action: 'getWtlPipesInExtent',
          params: {
            x: center[0],
            y: center[1],
            srid: 3857,
            radiusM,
          },
        }),
        call('', 'POST', {
          service: 'elevationService',
          action: 'getElevationGrid',
          params: {
            x: center[0],
            y: center[1],
            srid: 3857,
            radiusM,
            stepM: GROUND_DEFAULT_STEP_M,
          },
        }),
      ]);
      const pipeData = (pipeRes?.data ?? pipeRes) as {
        success?: boolean;
        pipes?: PipeSegment[];
        error?: string;
      };
      if (!pipeData?.success) {
        setStatus(pipeData?.error ?? '관로 조회 실패');
        return;
      }
      const pipes = Array.isArray(pipeData.pipes) ? pipeData.pipes : [];

      const elevData = (elevRes?.data ?? elevRes) as {
        success?: boolean;
        size?: number;
        stepM?: number;
        radiusM?: number;
        centerX?: number;
        centerY?: number;
        baseElevM?: number;
        heights?: (number | null)[];
      };
      let pipeHeightField: GroundHeightField | null = null;
      if (elevData?.success && elevData.heights?.length && elevData.size) {
        pipeHeightField = {
          size: elevData.size,
          stepM: elevData.stepM ?? GROUND_DEFAULT_STEP_M,
          radiusM: elevData.radiusM ?? radiusM,
          centerX: elevData.centerX ?? center[0],
          centerY: elevData.centerY ?? center[1],
          baseElevM: elevData.baseElevM ?? 0,
          heights: elevData.heights,
        };
      }

      const next: ShapeProps = {
        ...draft,
        kind: 'pipe',
        pipeCenterX: center[0],
        pipeCenterY: center[1],
        pipeRadiusM: radiusM,
        pipeSegments: pipes,
        pipeHeightField,
        floorHeight: 0,
        posX: 0,
        posZ: 0,
      };
      applyDraft(next);
      if (!pipes.length) {
        setStatus(
          pipeHeightField
            ? '범위 내 상수관로 없음 · 표고는 반영됨'
            : '범위 내 상수관로가 없습니다'
        );
      } else {
        setStatus(
          `생성 완료 · 관로 ${pipes.length}건` +
            (pipeHeightField
              ? ` · 표고 반영(해발−심도)`
              : ' · 표고 없음(Y=0 기준)')
        );
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '관로 생성 오류');
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    const snap = snapshotRef.current;
    if (snap && draft && !shapePropsEqual(draft, snap)) {
      onRollback(snap);
    }
    onOpenChange(false);
  };

  const title = titleName ? `${titleName} 편집` : '관로 편집';

  return (
    <DevFloatingPanel
      open={open}
      onClose={requestClose}
      title={title}
      width="26rem"
      minHeight="0"
      maxHeight="90vh"
      defaultPosition={{ top: 80, right: 24 }}
      dimBackdrop={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <p className="text-[12px] text-muted-foreground">
          지도에서 드래그해 사각형 범위를 그립니다. 그린 범위를 덮는 정사각(한 변{' '}
          {Math.round(radiusM * 2)} m) 안의 상수관로를 중공 파이프로 만듭니다. (관경·심도·지표는
          횡단면도와 동일, 관두께 KS D 3565 간이)
        </p>
        <ShapeColorOpacityFields
          colorId="pipe-color"
          opacityId="pipe-opacity"
          label="관로"
          color={draft.color || '#38bdf8'}
          opacity={draft.opacity ?? 0.92}
          onColor={(hex) => applyDraft({ ...draft, color: hex })}
          onOpacity={(n) => applyDraft({ ...draft, opacity: n })}
        />
        <GroundPickMap
          center={center}
          radiusM={radiusM}
          onPick={(r) => {
            applyDraft({
              ...draft,
              pipeCenterX: r.center[0],
              pipeCenterY: r.center[1],
              pipeRadiusM: r.radiusM,
            });
            setStatus(
              `범위 한 변 ${Math.round(r.radiusM * 2)} m — «관로 생성»을 누르세요`
            );
          }}
        />
        {center ? (
          <p className="text-[11px] tabular-nums text-foreground">
            중심 X {center[0].toFixed(2)} / Y {center[1].toFixed(2)} · 한 변{' '}
            {Math.round(radiusM * 2)} m
          </p>
        ) : null}
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded border border-primary bg-primary px-2 text-[12px] font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          title="관로 생성"
          disabled={busy || center == null}
          onClick={() => void buildPipes()}
        >
          {busy ? '생성 중…' : '관로 생성'}
        </button>
        <p className="text-[11px] text-muted-foreground">{status}</p>
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            title="취소"
            onClick={requestClose}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="cursor-pointer"
            title="삭제"
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
          >
            삭제
          </Button>
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            title="저장"
            disabled={draft.pipeSegments == null}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </DevFloatingPanel>
  );
}
