'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { getWtlLayerShapeDef } from '@/lib/wtlLayerShapeDefs';
import { call } from '@/lib/api';
import { DevFloatingPanel } from '../DevFloatingPanel';
import { shapePropsEqual } from './shapeCatalog';
import { GroundPickMap } from './GroundPickMap';
import { ShapeColorOpacityFields } from './ShapeColorOpacityFields';
import {
  MANH_DEFAULT_RADIUS_M,
  isPointLayerShape,
  type GroundHeightField,
  type ManholeFeature,
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

type ElevApi = {
  success?: boolean;
  error?: string;
  size?: number;
  stepM?: number;
  radiusM?: number;
  centerX?: number;
  centerY?: number;
  baseElevM?: number;
  heights?: (number | null)[];
  levels?: number[];
  contours?: GroundHeightField['contours'];
  rivers?: GroundHeightField['rivers'];
};

export function ThreeJsManholeEditModal({
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open || !props || !isPointLayerShape(props.kind)) return;
    const snap = JSON.parse(JSON.stringify(props)) as ShapeProps;
    snapshotRef.current = snap;
    setDraft(snap);
    const def = getWtlLayerShapeDef(props.kind);
    setStatus(
      props.manholeFeatures?.length
        ? `${def?.label ?? '점시설'} ${props.manholeFeatures.length}건 준비됨`
        : '지도에서 사각형을 그린 뒤 «생성»을 누르세요'
    );
  }, [open, props]);

  if (!draft || !isPointLayerShape(draft.kind)) return null;

  const def = getWtlLayerShapeDef(draft.kind);
  const layerLabel = def?.label ?? draft.kind;
  const title = titleName ? `${titleName} 편집` : `${layerLabel} 편집`;
  const center: [number, number] | null =
    draft.manhCenterX != null && draft.manhCenterY != null
      ? [draft.manhCenterX, draft.manhCenterY]
      : null;
  const radiusM = draft.manhRadiusM ?? MANH_DEFAULT_RADIUS_M;

  const applyDraft = (next: ShapeProps) => {
    setDraft(next);
    onPreview(next);
  };

  const requestClose = () => {
    const snap = snapshotRef.current;
    if (snap && draft && !shapePropsEqual(snap, draft)) {
      window.alert('변경 사항이 저장되지 않았습니다. 이전 값으로 되돌립니다.');
      onRollback(snap);
    }
    onOpenChange(false);
  };

  const buildPoints = async () => {
    if (center == null) {
      setStatus('지도에서 사각형 범위를 먼저 그리세요');
      return;
    }
    setBusy(true);
    setStatus(`${layerLabel}·표고 조회 중…`);
    try {
      const [manhRes, elevRes] = await Promise.all([
        call('', 'POST', {
          service: 'elevationService',
          action: 'getWtlPointLayerInExtent',
          params: {
            table: draft.kind,
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
            stepM: 5,
          },
        }),
      ]);
      const manhData = (manhRes?.data ?? manhRes) as {
        success?: boolean;
        manholes?: ManholeFeature[];
        error?: string;
      };
      if (!manhData?.success) {
        setStatus(manhData?.error ?? '조회 실패');
        return;
      }
      const elevData = (elevRes?.data ?? elevRes) as ElevApi;
      const field: GroundHeightField | null =
        elevData?.success && elevData.heights?.length && elevData.size
          ? {
              size: elevData.size,
              stepM: elevData.stepM ?? 5,
              radiusM: elevData.radiusM ?? radiusM,
              centerX: elevData.centerX ?? center[0],
              centerY: elevData.centerY ?? center[1],
              baseElevM: elevData.baseElevM ?? 0,
              heights: elevData.heights,
              levels: elevData.levels ?? [],
              contours: elevData.contours ?? [],
              rivers: elevData.rivers ?? [],
            }
          : null;

      const manholes = Array.isArray(manhData.manholes) ? manhData.manholes : [];
      const next: ShapeProps = {
        ...draft,
        kind: draft.kind,
        manhCenterX: center[0],
        manhCenterY: center[1],
        manhRadiusM: radiusM,
        manholeFeatures: manholes,
        manhHeightField: field,
        posX: 0,
        posZ: 0,
        floorHeight: 0,
      };
      applyDraft(next);
      setStatus(
        manholes.length
          ? `생성 완료 · ${layerLabel} ${manholes.length}건` +
              (field ? ` · 표고 ${field.size}×${field.size}` : '')
          : field
            ? `범위 내 ${layerLabel} 없음 · 표고는 반영됨`
            : `범위 내 ${layerLabel}가 없습니다`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '생성 오류');
    } finally {
      setBusy(false);
    }
  };

  const hint =
    draft.kind === 'wtl_manh_ps'
      ? `규격(MAN_STD) 기준 원통입니다. 라벨은 관리번호(FTR_IDN, SLD와 동일)입니다. (심도 필드 없음)`
      : `구경·규격 필드 기준 원통입니다. 라벨은 관리번호 등 SLD 기준입니다.`;

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
          지도에서 드래그해 사각형 범위를 그립니다. 정사각(한 변 {Math.round(radiusM * 2)} m) 안의
          {layerLabel}({draft.kind})을 만듭니다. {hint}
        </p>
        <ShapeColorOpacityFields
          colorId={`point-color-${draft.kind}`}
          opacityId={`point-opacity-${draft.kind}`}
          label={layerLabel}
          color={draft.color || def?.fallbackColor || '#888888'}
          opacity={draft.opacity ?? 0.9}
          onColor={(hex) => applyDraft({ ...draft, color: hex })}
          onOpacity={(n) => applyDraft({ ...draft, opacity: n })}
        />
        <GroundPickMap
          drawMode="extent"
          center={center}
          radiusM={radiusM}
          onPick={(r) => {
            applyDraft({
              ...draft,
              manhCenterX: r.center[0],
              manhCenterY: r.center[1],
              manhRadiusM: r.radiusM,
              manholeFeatures: null,
              manhHeightField: null,
            });
            setStatus(
              `범위 한 변 ${Math.round(r.radiusM * 2)} m — «생성»을 누르세요`
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
          title="생성"
          disabled={busy || center == null}
          onClick={() => void buildPoints()}
        >
          {busy ? '생성 중…' : '생성'}
        </button>
        <p className="text-[11px] text-muted-foreground">{status}</p>
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            title="삭제"
            className="cursor-pointer"
            onClick={() => {
              if (draft) snapshotRef.current = JSON.parse(JSON.stringify(draft)) as ShapeProps;
              onDelete();
            }}
          >
            삭제
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="취소"
            className="cursor-pointer"
            onClick={requestClose}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            title="저장"
            className="cursor-pointer"
            disabled={!draft.manholeFeatures}
            onClick={() => {
              onSave(draft);
              snapshotRef.current = JSON.parse(JSON.stringify(draft)) as ShapeProps;
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
