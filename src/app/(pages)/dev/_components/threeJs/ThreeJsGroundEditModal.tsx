'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { DevFloatingPanel } from '../DevFloatingPanel';
import { call } from '@/lib/api';
import { shapePropsEqual } from './shapeCatalog';
import { GroundPickMap } from './GroundPickMap';
import { ShapeColorOpacityFields } from './ShapeColorOpacityFields';
import {
  GROUND_DEFAULT_RADIUS_M,
  GROUND_DEFAULT_STEP_M,
  type GroundHeightField,
  type ShapeProps,
} from './shapeTypes';

const GROUND_THICKNESS_MIN = 0;
const GROUND_THICKNESS_MAX = 200;

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

type GridApi = {
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

export function ThreeJsGroundEditModal({
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
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (open && props) {
      const snap = { ...props, groundHeightField: props.groundHeightField ?? null };
      snapshotRef.current = JSON.parse(JSON.stringify(snap)) as ShapeProps;
      setDraft(snap);
      setStatus(
        props.groundHeightField
          ? `지형 준비됨 (샘플 ${props.groundHeightField.size}×${props.groundHeightField.size})`
          : '지도에서 사각형을 그린 뒤 «지형 생성»을 누르세요'
      );
    }
    if (!open) {
      snapshotRef.current = null;
      setDraft(null);
      setBusy(false);
      setStatus('');
    }
  }, [open, props]);

  const requestClose = () => {
    const snap = snapshotRef.current;
    const current = draft;
    if (snap && current && !shapePropsEqual(snap, current)) {
      window.alert('변경 사항이 저장되지 않았습니다. 이전 값으로 되돌립니다.');
      onRollback(snap);
    }
    onOpenChange(false);
  };

  if (!open || !props || !draft) return null;

  const title = titleName ? `${titleName} 편집` : '지형(GROUND) 편집';
  const center: [number, number] | null =
    draft.groundCenterX != null && draft.groundCenterY != null
      ? [draft.groundCenterX, draft.groundCenterY]
      : null;
  const radiusM = draft.groundRadiusM ?? GROUND_DEFAULT_RADIUS_M;

  const applyDraft = (next: ShapeProps) => {
    setDraft(next);
    onPreview(next);
  };

  const buildTerrain = async () => {
    if (center == null) {
      setStatus('지도에서 사각형 범위를 먼저 그리세요');
      return;
    }
    setBusy(true);
    setStatus('등고 격자 조회 중…');
    try {
      const res = await call('', 'POST', {
        service: 'elevationService',
        action: 'getElevationGrid',
        params: {
          x: center[0],
          y: center[1],
          srid: 3857,
          radiusM,
          stepM: GROUND_DEFAULT_STEP_M,
        },
      });
      const data = (res?.data ?? res) as GridApi;
      if (!data?.success || !data.heights?.length || !data.size) {
        setStatus(data?.error ?? '지형 생성 실패');
        return;
      }
      const field: GroundHeightField = {
        size: data.size,
        stepM: data.stepM ?? GROUND_DEFAULT_STEP_M,
        radiusM: data.radiusM ?? radiusM,
        centerX: data.centerX ?? center[0],
        centerY: data.centerY ?? center[1],
        baseElevM: data.baseElevM ?? 0,
        heights: data.heights,
        levels: data.levels ?? [],
        contours: data.contours ?? [],
        rivers: data.rivers ?? [],
      };

      const next: ShapeProps = {
        ...draft,
        kind: 'ground',
        groundCenterX: field.centerX,
        groundCenterY: field.centerY,
        groundRadiusM: field.radiusM,
        groundHeightField: field,
        floorHeight: 0,
        posX: 0,
        posZ: 0,
      };
      applyDraft(next);
      const nCont = field.contours?.length ?? 0;
      const nRiver = field.rivers?.length ?? 0;
      setStatus(
        `생성 완료 · 최저표고 ${field.baseElevM.toFixed(1)} m(해발) · ${field.size}×${field.size}` +
          (nCont ? ` · 등고 ${nCont}선` : '') +
          (nRiver ? ` · 하천 ${nRiver}` : '')
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '지형 생성 오류');
    } finally {
      setBusy(false);
    }
  };

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
          {Math.round(radiusM * 2)} m)으로 기울기 보간 지형을 만들고, 등고선·지방하천·소하천을
          표면 위에 그립니다. (관로는 «관로» 도형에서 별도 생성)
        </p>
        <ShapeColorOpacityFields
          colorId="ground-terrain-color"
          opacityId="ground-terrain-opacity"
          label="땅"
          color={draft.color || '#84cc16'}
          opacity={draft.opacity ?? 0.35}
          onColor={(hex) => applyDraft({ ...draft, color: hex })}
          onOpacity={(n) => applyDraft({ ...draft, opacity: n })}
        />
        <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2 rounded border border-border/60 bg-muted/20 p-2">
          <label htmlFor="ground-thickness" className="text-[12px] text-foreground">
            높이
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="ground-thickness"
              type="number"
              className="h-9 w-[6rem]"
              min={GROUND_THICKNESS_MIN}
              max={GROUND_THICKNESS_MAX}
              step={0.5}
              value={draft.height ?? 5}
              title="지형 높이(두께, m). 0이면 표면만"
              onChange={(e) => {
                const n = Number(e.target.value);
                const height = Number.isFinite(n)
                  ? Math.max(GROUND_THICKNESS_MIN, Math.min(GROUND_THICKNESS_MAX, n))
                  : 0;
                applyDraft({ ...draft, height });
              }}
            />
            <span className="text-[12px] text-muted-foreground">m (표면 아래 두께)</span>
          </div>
        </div>
        <ShapeColorOpacityFields
          colorId="ground-river-color"
          opacityId="ground-river-opacity"
          label="하천"
          color={draft.riverColor || '#2563eb'}
          opacity={draft.riverOpacity ?? 0.4}
          onColor={(hex) => applyDraft({ ...draft, riverColor: hex })}
          onOpacity={(n) => applyDraft({ ...draft, riverOpacity: n })}
        />
        <GroundPickMap
          center={center}
          radiusM={radiusM}
          onPick={(r) => {
            applyDraft({
              ...draft,
              groundCenterX: r.center[0],
              groundCenterY: r.center[1],
              groundRadiusM: r.radiusM,
            });
            setStatus(
              `범위 한 변 ${Math.round(r.radiusM * 2)} m — «지형 생성»을 누르세요`
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
          title="지형 생성"
          disabled={busy || center == null}
          onClick={() => void buildTerrain()}
        >
          {busy ? '생성 중…' : '지형 생성'}
        </button>
        <p className="text-[11px] text-muted-foreground">{status}</p>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border pt-2">
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
          <div className="flex gap-2">
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
              disabled={!draft.groundHeightField}
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
      </div>
    </DevFloatingPanel>
  );
}
