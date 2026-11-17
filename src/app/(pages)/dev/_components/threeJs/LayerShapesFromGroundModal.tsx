'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs';
import { DevFloatingPanel } from '../DevFloatingPanel';
import type { GroundLayerShapeKind } from './shapeTypes';

const LAYER_OPTIONS: {
  kind: GroundLayerShapeKind;
  label: string;
  desc: string;
}[] = WTL_LAYER_SHAPE_DEFS.filter((d) => d.fromGround).map((d) => ({
  kind: d.kind as GroundLayerShapeKind,
  label: d.label,
  desc:
    d.geom === 'line'
      ? `${d.kind} — 중공 파이프`
      : `${d.kind} — 원통(규격·구경)`,
}));

function defaultChecked(): Record<GroundLayerShapeKind, boolean> {
  const out = {} as Record<GroundLayerShapeKind, boolean>;
  for (const opt of LAYER_OPTIONS) {
    out[opt.kind] = opt.kind === 'wtl_pipe_lm' || opt.kind === 'wtl_manh_ps';
  }
  return out;
}

type Props = {
  open: boolean;
  groundName?: string;
  onOpenChange: (open: boolean) => void;
  /** 선택한 레이어 도형 생성 */
  onCreate: (kinds: GroundLayerShapeKind[]) => void | Promise<void>;
};

export function LayerShapesFromGroundModal({
  open,
  groundName,
  onOpenChange,
  onCreate,
}: Props) {
  const [checked, setChecked] = useState(defaultChecked);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setChecked(defaultChecked());
      setBusy(false);
    }
  }, [open]);

  const selected = LAYER_OPTIONS.filter((o) => checked[o.kind]).map((o) => o.kind);

  const handleCreate = async () => {
    if (!selected.length) {
      window.alert('생성할 레이어를 하나 이상 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      await onCreate(selected);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DevFloatingPanel
      open={open}
      onClose={() => onOpenChange(false)}
      title="레이어 도형 생성"
      width="22rem"
      minHeight="0"
      maxHeight="80vh"
      defaultPosition={{ top: 120, right: 40 }}
      dimBackdrop
    >
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[12px] text-muted-foreground">
          {groundName ? `«${groundName}»` : '지형'}과 같은 범위에서 생성할 레이어를
          선택하세요. (분할 레이어 제외)
        </p>
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {LAYER_OPTIONS.map((opt) => (
            <li key={opt.kind}>
              <label
                className="flex cursor-pointer items-start gap-2 rounded border border-border/70 bg-muted/20 px-2 py-2 hover:bg-muted/40"
                title={opt.label}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={!!checked[opt.kind]}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [opt.kind]: e.target.checked }))
                  }
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-foreground">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">{opt.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="취소"
            className="cursor-pointer"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            title="생성"
            className="cursor-pointer"
            disabled={busy || selected.length === 0}
            onClick={() => void handleCreate()}
          >
            {busy ? '생성 중…' : `생성 (${selected.length})`}
          </Button>
        </div>
      </div>
    </DevFloatingPanel>
  );
}
