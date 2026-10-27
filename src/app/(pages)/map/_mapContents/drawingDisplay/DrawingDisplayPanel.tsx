'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import { AlertTriangle, FileUp, Layers, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { DXF_LAYER, dxfStringToOlFeatures } from '@/lib/dxfToOpenLayers';
import { readDxfFileAsText } from '@/lib/dxfTextEncoding';
import {
  DRAWING_ACCEPT,
  DRAWING_CRS_OPTIONS,
  DRAWING_DEFAULT_CRS,
  DRAWING_DISPLAY_MAX_BYTES,
  getDrawingCrsLabel,
  type DrawingCrsCode,
} from './drawingDisplayConfig';
import { useDrawingDisplayLayer } from './useDrawingDisplayLayer';
import { useUploadCrsCandidates } from '../userDataUpload/useUploadCrsCandidates';
import type { UploadCrsCode } from '../userDataUpload/userDataUploadConfig';

type Props = {
  onClose: () => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function collectLayerNames(features: Feature<Geometry>[]): string[] {
  const set = new Set<string>();
  for (const f of features) {
    set.add(String(f.get(DXF_LAYER) ?? '0'));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

function rawExtentFromFeatures(features: Feature<Geometry>[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    const e = f.getGeometry()?.getExtent();
    if (!e || !e.every(Number.isFinite)) continue;
    minX = Math.min(minX, e[0]);
    minY = Math.min(minY, e[1]);
    maxX = Math.max(maxX, e[2]);
    maxY = Math.max(maxY, e[3]);
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function isGeographicExtent([minX, minY, maxX, maxY]: [number, number, number, number]): boolean {
  return Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90;
}

const selectClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

/** 왼쪽 메뉴 «도면 표시» — DXF/DWG 임시 지도 표시 */
export function DrawingDisplayPanel({ onClose }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature<Geometry>[] | null>(null);
  const [layerNames, setLayerNames] = useState<string[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(() => new Set());
  const [crs, setCrs] = useState<DrawingCrsCode>(DRAWING_DEFAULT_CRS);
  const [manualCrs, setManualCrs] = useState(false);
  const [loading, setLoading] = useState(false);
  /** 좌표계 확정 전에는 지도에 올리지 않음 (잘못된 위치로 fit 되는 것 방지) */
  const [mapCrsReady, setMapCrsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);

  const extent = useMemo(() => (features ? rawExtentFromFeatures(features) : null), [features]);
  const crsCheck = useUploadCrsCandidates(extent);
  const topCandidate = crsCheck.candidates?.[0]?.code as UploadCrsCode | undefined;

  /** 새 파일이면 지도 표시 게이트를 닫고, 좌표계가 정해진 뒤에만 연다 */
  useEffect(() => {
    if (!features?.length) {
      setMapCrsReady(false);
      return;
    }
    setMapCrsReady(false);
  }, [features]);

  useEffect(() => {
    if (!features?.length || !extent) return;

    if (manualCrs) {
      setMapCrsReady(true);
      return;
    }

    if (isGeographicExtent(extent)) {
      setCrs((prev) => (prev === '4326' ? prev : '4326'));
      setMapCrsReady(true);
      return;
    }

    // 평면좌표 — 서버 후보 조회가 끝날 때까지 대기
    if (crsCheck.loading) return;

    const top = topCandidate;
    if (top && DRAWING_CRS_OPTIONS.some((o) => o.code === top)) {
      setCrs(top as DrawingCrsCode);
    }
    setMapCrsReady(true);
  }, [features, extent, manualCrs, crsCheck.loading, topCandidate]);

  const status = useDrawingDisplayLayer(
    mapCrsReady && Boolean(features?.length),
    mapCrsReady ? features : null,
    crs,
    hiddenLayers
  );

  const resolvingCrs = Boolean(features?.length) && !mapCrsReady;
  /** 파일 읽기·좌표계·지도 올리기까지 끝나야 로딩 종료 */
  const waitingForMap =
    Boolean(features?.length) &&
    !error &&
    (resolvingCrs || status.mode === 'preparing' || (mapCrsReady && status.mode === 'idle'));
  const busy = loading || waitingForMap;

  const reset = useCallback(() => {
    loadSeq.current += 1;
    setFileName(null);
    setFeatures(null);
    setLayerNames([]);
    setHiddenLayers(new Set());
    setCrs(DRAWING_DEFAULT_CRS);
    setManualCrs(false);
    setMapCrsReady(false);
    setError(null);
    setParseNote(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const applyDxfText = useCallback((text: string, name: string) => {
    const { features: parsed, parseError } = dxfStringToOlFeatures(text);
    if (!parsed.length) {
      setError(parseError ?? 'DXF에서 도형을 읽지 못했습니다. ASCII DXF를 권장합니다.');
      setFeatures(null);
      setLayerNames([]);
      return;
    }
    setFeatures(parsed);
    setLayerNames(collectLayerNames(parsed));
    setHiddenLayers(new Set());
    setFileName(name);
    setParseNote(parseError);
    setError(null);
    setManualCrs(false);
    setMapCrsReady(false);
  }, []);

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      setParseNote(null);

      try {
        if (file.size > DRAWING_DISPLAY_MAX_BYTES) {
          throw new Error(
            `파일이 너무 큽니다 (${formatBytes(file.size)}). ${formatBytes(DRAWING_DISPLAY_MAX_BYTES)} 이하로 올려 주세요.`
          );
        }

        const lower = file.name.toLowerCase();
        if (lower.endsWith('.dxf')) {
          const text = await readDxfFileAsText(file);
          if (seq !== loadSeq.current) return;
          applyDxfText(text, file.name);
        } else if (lower.endsWith('.dwg')) {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/drawingDisplay/dwg-to-dxf', {
            method: 'POST',
            body: form,
            credentials: 'include',
          });
          const data = (await res.json().catch(() => ({}))) as { dxfText?: string; error?: string };
          if (seq !== loadSeq.current) return;
          if (!res.ok || !data.dxfText) {
            throw new Error(data.error ?? `DWG 변환에 실패했습니다. (${res.status})`);
          }
          applyDxfText(data.dxfText, file.name);
        } else {
          throw new Error('DXF 또는 DWG 파일만 올릴 수 있습니다.');
        }
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setFeatures(null);
        setLayerNames([]);
        setFileName(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [applyDxfText]
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    void handleFile(f ?? null);
  };

  const toggleLayer = (name: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allLayersOn = hiddenLayers.size === 0;
  const setAllLayers = (on: boolean) => {
    setHiddenLayers(on ? new Set() : new Set(layerNames));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
            <Layers className="h-4 w-4 text-primary/80" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground/90">도면 표시</h1>
            <p className="text-[11px] text-muted-foreground">수치지형도 임시 표시 · 저장 없음</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="닫기"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-8 transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/40'
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
        >
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary/70" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="text-center text-[12px] font-medium text-foreground">
            {loading
              ? '읽는 중…'
              : resolvingCrs
                ? '좌표계 확인 중…'
                : waitingForMap
                  ? '지도에 표시 중…'
                  : '파일을 놓거나 눌러 선택'}
          </p>
          <p className="text-center text-[11px] text-muted-foreground">
            {busy ? '지도에 올라간 뒤에 완료됩니다' : 'DXF · DWG (수치지형도)'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={DRAWING_ACCEPT}
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}

        {fileName ? (
          <div className="space-y-3 rounded-lg border border-border bg-background p-3">
            <div className="flex items-start gap-2">
              <FileUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground">{fileName}</p>
                <p className="text-[11px] text-muted-foreground">
                  도형 {(status.drawn || features?.length || 0).toLocaleString()}개
                  {status.failed > 0 ? ` · 실패 ${status.failed}` : ''}
                  {layerNames.length > 0 ? ` · 레이어 ${layerNames.length}` : ''}
                </p>
                {resolvingCrs ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    좌표계 확인 중 — 지도에는 아직 올리지 않습니다
                  </p>
                ) : status.mode === 'preparing' ? (
                  <p className="mt-0.5 text-[10.5px] text-primary">지도용으로 준비 중…</p>
                ) : status.mode === 'lod' ? (
                  <p className="mt-0.5 text-[10.5px] text-primary">
                    단계 {status.lodIndex + 1}/{status.lodTotal} · {status.lodLabel}
                    {status.lodIndex === 0
                      ? ' · 개요 이미지'
                      : ` · ${status.visible.toLocaleString()}개`}
                    {status.painting ? ' 그리는 중…' : ''}
                    {!status.painting && status.lodIndex < status.lodTotal - 1
                      ? ' · 확대하면 다음 단계'
                      : ''}
                    {status.lodIndex >= 3 ? ' · 글자 표시' : ''}
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground/80">좌표계</span>
                {crsCheck.loading ? (
                  <span className="text-[10px] text-muted-foreground">후보 확인 중…</span>
                ) : topCandidate && !manualCrs ? (
                  <span className="text-[10px] text-primary">자동</span>
                ) : null}
              </div>
              <select
                className={selectClass}
                value={crs}
                aria-label="좌표계"
                disabled={resolvingCrs}
                onChange={(e) => {
                  setManualCrs(true);
                  setCrs(e.target.value as DrawingCrsCode);
                  setMapCrsReady(true);
                }}
              >
                {DRAWING_CRS_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label} · EPSG:{o.code}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] text-muted-foreground">{getDrawingCrsLabel(crs)}</p>
            </div>

            {status.outOfKorea ? (
              <p className="flex gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                선택한 좌표계로 변환하면 국내 범위를 벗어납니다. 좌표계를 다시 확인하세요.
              </p>
            ) : null}

            {parseNote ? (
              <p className="text-[11px] text-muted-foreground">{parseNote}</p>
            ) : null}

            {layerNames.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-foreground/80">도면 레이어</span>
                  <button
                    type="button"
                    className="text-[10.5px] text-primary hover:underline"
                    onClick={() => setAllLayers(!allLayersOn)}
                  >
                    {allLayersOn ? '모두 끄기' : '모두 켜기'}
                  </button>
                </div>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {layerNames.map((name) => {
                    const on = !hiddenLayers.has(name);
                    return (
                      <li key={name}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-muted/50">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={on}
                            onChange={() => toggleLayer(name)}
                          />
                          <span className="truncate">{name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <Button type="button" variant="outline" size="sm" className="w-full" onClick={reset}>
              지우기
            </Button>
          </div>
        ) : null}

        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          지도에만 임시로 표시되며 서버에 저장되지 않습니다. 패널을 닫으면 도면도 사라집니다. DWG는 QCAD
          환경이 있을 때만 변환됩니다.
        </p>
      </div>
    </div>
  );
}
