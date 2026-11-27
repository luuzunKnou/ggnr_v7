'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Loader2, Upload, X } from 'lucide-react';
import { call } from '@/lib/api';
import { withBasePath } from '@/lib/basePath';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  PREVIEW_MAP_FEATURE_LIMIT,
  UPLOAD_CRS_OPTIONS,
  type UploadCrsCode,
} from '../userDataUpload/userDataUploadConfig';
import {
  autoPickExcelColumns,
  buildExcelPreviewGeometries,
  buildExcelTable,
  collectUploadSources,
  detectUploadKind,
  readDbfPreview,
  readExcelWorkbook,
  readSheetMatrix,
  readShpMeta,
  readShpPreviewGeometries,
  type RawPreviewGeometry,
  type ShpDataset,
  type TablePreview,
} from '../userDataUpload/userDataUploadParse';
import {
  useUserDataUploadPreviewLayer,
  type UploadPreviewLayerStatus,
} from '../userDataUpload/useUserDataUploadPreviewLayer';

type Step = 'file' | 'attr' | 'column';
type CoorStand = 'XY' | 'ADDR' | 'geometry';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** 지도 드롭·외부에서 넘긴 파일 — 마운트 시 바로 해석 */
  initialFiles?: File[] | null;
};

const ACCEPT = '.zip,.shp,.shx,.dbf,.prj,.cpg,.xlsx,.xls';
/** 나의지도 생성 미리보기 벡터 레이어 id */
const PREVIEW_LAYER_ID = 'my-map-create-preview';
const DEFAULT_POS = { top: 72, left: 88 };
const PANEL_WIDTH = 440;

function safeKey(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 40);
}

function MapPreviewStatus({ status, hasCrs }: { status: UploadPreviewLayerStatus; hasCrs: boolean }) {
  if (!hasCrs) {
    return <p className="text-[11px] text-muted-foreground">좌표계를 고르면 지도에 미리보기가 표시됩니다.</p>;
  }
  if (status.drawn === 0 && status.failed === 0) {
    return <p className="text-[11px] text-muted-foreground">미리보기할 도형이 없습니다.</p>;
  }
  return (
    <p className={cn('text-[11px]', status.outOfKorea ? 'text-amber-600' : 'text-muted-foreground')}>
      지도 미리보기 {status.drawn}건
      {status.failed > 0 ? ` · 실패 ${status.failed}` : ''}
      {status.outOfKorea ? ' · 국내 범위 밖 — 좌표계를 확인해 주세요' : ''}
    </p>
  );
}

export function MyMapCreatePanel({ open, onClose, onCreated, initialFiles = null }: Props) {
  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'shp' | 'excel' | null>(null);
  const [shpDataset, setShpDataset] = useState<ShpDataset | null>(null);
  const [excelSrc, setExcelSrc] = useState<Awaited<ReturnType<typeof collectUploadSources>>[number] | null>(
    null
  );
  const [table, setTable] = useState<TablePreview | null>(null);
  const [shpGeoms, setShpGeoms] = useState<RawPreviewGeometry[]>([]);

  const [coorStand, setCoorStand] = useState<CoorStand>('geometry');
  const [coorX, setCoorX] = useState('');
  const [coorY, setCoorY] = useState('');
  const [coorAddr, setCoorAddr] = useState('');
  const [sourceEpsg, setSourceEpsg] = useState<UploadCrsCode>('5181');

  const [layerGroup, setLayerGroup] = useState('나의지도');
  const [layerKey, setLayerKey] = useState('');
  const [layerName, setLayerName] = useState('');
  const [stroke, setStroke] = useState('#2563eb');
  const [fill, setFill] = useState('#93c5fd');

  const [keyField, setKeyField] = useState('');
  const [listFields, setListFields] = useState<string[]>([]);
  const [korNames, setKorNames] = useState<Record<string, string>>({});
  const initialConsumedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(DEFAULT_POS);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
  });

  const columns = useMemo(() => table?.columns ?? [], [table]);

  useEffect(() => {
    if (!open) return;
    setPosition(DEFAULT_POS);
  }, [open]);

  const clampPosition = useCallback((top: number, left: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? PANEL_WIDTH;
    const h = el?.offsetHeight ?? 480;
    const maxLeft = Math.max(8, window.innerWidth - w - 8);
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    return {
      top: Math.min(Math.max(8, top), maxTop),
      left: Math.min(Math.max(8, left), maxLeft),
    };
  }, []);

  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        startTop: position.top,
        startLeft: position.left,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [position]
  );

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition(
        clampPosition(dragRef.current.startTop + dy, dragRef.current.startLeft + dx)
      );
    };
    const onUp = () => {
      dragRef.current.isDragging = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [open, clampPosition]);

  const excelPick = useMemo(
    () => ({
      x: Math.max(0, columns.indexOf(coorX)),
      y: Math.max(0, columns.indexOf(coorY)),
      address: Math.max(0, columns.indexOf(coorAddr)),
      wkt: -1,
    }),
    [columns, coorX, coorY, coorAddr]
  );

  const previewGeometries = useMemo((): RawPreviewGeometry[] => {
    if (kind === 'shp') return shpGeoms;
    if (kind === 'excel' && coorStand === 'XY' && coorX && coorY && table) {
      return buildExcelPreviewGeometries(table.rows, 'coords', excelPick, PREVIEW_MAP_FEATURE_LIMIT);
    }
    return [];
  }, [kind, shpGeoms, coorStand, coorX, coorY, table, excelPick]);

  const previewEnabled =
    open && (step === 'attr' || step === 'column') && previewGeometries.length > 0 && coorStand !== 'ADDR';

  const mapPreview = useUserDataUploadPreviewLayer(
    previewEnabled,
    previewGeometries,
    sourceEpsg,
    PREVIEW_LAYER_ID
  );

  const onPickFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || (Array.isArray(fileList) ? fileList.length === 0 : fileList.length === 0)) return;
    setError(null);
    setBusy(true);
    try {
      const files = Array.from(fileList);
      const sources = await collectUploadSources(files);
      const detected = detectUploadKind(sources);
      if (detected.kind === 'none') {
        setError(detected.message || '지원하지 않는 파일입니다.');
        return;
      }
      if (detected.kind === 'shp') {
        const ds = detected.datasets[0];
        if (!ds?.parts.shp || !ds.parts.shx || !ds.parts.dbf) {
          setError('shp·shx·dbf가 모두 필요합니다.');
          return;
        }
        setKind('shp');
        setShpDataset(ds);
        setExcelSrc(null);
        setCoorStand('geometry');
        setLayerKey(safeKey(ds.name));
        setLayerName(ds.name);
        const preview = await readDbfPreview(ds.parts.dbf, 'euc-kr', 50);
        setTable(preview);
        const cols = preview.columns;
        setKeyField(cols[0] ?? '');
        setListFields(cols.slice(0, Math.min(3, cols.length)));
        const kors: Record<string, string> = {};
        cols.forEach((c) => {
          kors[c] = c;
        });
        setKorNames(kors);
        const geoms = await readShpPreviewGeometries(ds, PREVIEW_MAP_FEATURE_LIMIT);
        setShpGeoms(geoms);
        try {
          const meta = await readShpMeta(ds);
          if (meta.crs) setSourceEpsg(meta.crs);
        } catch {
          /* keep default */
        }
        setStep('attr');
        return;
      }
      setKind('excel');
      setExcelSrc(detected.file);
      setShpDataset(null);
      setShpGeoms([]);
      const wb = await readExcelWorkbook(detected.file);
      const sheet = wb.SheetNames[0];
      if (!sheet) {
        setError('시트가 없습니다.');
        return;
      }
      const matrix = readSheetMatrix(wb, sheet);
      const preview = buildExcelTable(matrix, 0);
      setTable(preview);
      const pick = autoPickExcelColumns(preview.columns);
      setCoorStand(pick.address >= 0 ? 'ADDR' : 'XY');
      setCoorX(pick.x >= 0 ? preview.columns[pick.x]! : '');
      setCoorY(pick.y >= 0 ? preview.columns[pick.y]! : '');
      setCoorAddr(pick.address >= 0 ? preview.columns[pick.address]! : '');
      setLayerKey(safeKey(detected.file.name.replace(/\.[^.]+$/, '')));
      setLayerName(detected.file.name.replace(/\.[^.]+$/, ''));
      setKeyField(preview.columns[0] ?? '');
      setListFields(preview.columns.slice(0, Math.min(3, preview.columns.length)));
      const kors: Record<string, string> = {};
      preview.columns.forEach((c) => {
        kors[c] = c;
      });
      setKorNames(kors);
      setStep('attr');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      initialConsumedRef.current = false;
      return;
    }
    if (initialConsumedRef.current) return;
    if (!initialFiles?.length) return;
    initialConsumedRef.current = true;
    void onPickFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 드롭 직후 1회만
  }, [open, initialFiles]);

  const goColumn = () => {
    setError(null);
    if (!layerGroup.trim() || !layerKey.trim() || !layerName.trim()) {
      setError('그룹명·영문명·한글명을 입력하세요.');
      return;
    }
    if (kind === 'excel') {
      if (coorStand === 'XY' && (!coorX || !coorY)) {
        setError('X·Y 컬럼을 선택하세요.');
        return;
      }
      if (coorStand === 'ADDR' && !coorAddr) {
        setError('주소 컬럼을 선택하세요.');
        return;
      }
    }
    setStep('column');
  };

  const toggleList = (col: string) => {
    setListFields((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const handleSave = async () => {
    setError(null);
    if (!keyField) {
      setError('고유값 필드를 선택하세요.');
      return;
    }
    if (listFields.length === 0) {
      setError('목록보기 필드를 하나 이상 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      const style = { stroke, fill, strokeWidth: 1.5, fillOpacity: 0.35 };
      if (kind === 'excel' && table) {
        const colDefs = columns.map((c) => ({
          define_field_name: c,
          define_field_kor_name: korNames[c] || c,
          define_field_is_key: c === keyField,
          define_field_show_list: listFields.includes(c),
          define_field_show_search: listFields.includes(c),
        }));
        let allRows = table.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((c, i) => {
            obj[c] = row[i] ?? '';
          });
          return obj;
        });
        if (excelSrc) {
          const wb = await readExcelWorkbook(excelSrc);
          const sheet = wb.SheetNames[0]!;
          const matrix = readSheetMatrix(wb, sheet);
          const full = buildExcelTable(matrix, 0);
          allRows = full.rows.map((row) => {
            const obj: Record<string, unknown> = {};
            full.columns.forEach((c, i) => {
              obj[c] = row[i] ?? '';
            });
            return obj;
          });
        }
        await call('', 'POST', {
          service: 'myMapService',
          action: 'createFromExcel',
          params: {
            layerKey,
            layerName,
            layerGroup,
            keyField,
            columns: colDefs,
            rows: allRows,
            coorStand: coorStand === 'ADDR' ? 'ADDR' : 'XY',
            coorX,
            coorY,
            coorAddr,
            sourceEpsg: Number(sourceEpsg),
            geomType: 'POINT',
            style,
          },
        });
      } else if (kind === 'shp' && shpDataset) {
        const form = new FormData();
        form.set('layerKey', layerKey);
        form.set('layerName', layerName);
        form.set('layerGroup', layerGroup);
        form.set('sourceSrsOverride', `EPSG:${sourceEpsg}`);
        form.set('keyField', keyField);
        form.set(
          'columnsJson',
          JSON.stringify(
            columns.map((c) => ({
              name: c,
              korName: korNames[c] || c,
              isKey: c === keyField,
              showList: listFields.includes(c),
            }))
          )
        );
        form.set('styleJson', JSON.stringify(style));
        for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg'] as const) {
          const part = shpDataset.parts[ext];
          if (!part) continue;
          const bytes = await part.read();
          form.append('file', new File([new Uint8Array(bytes)], part.name), part.name);
        }
        const res = await fetch(withBasePath('/api/myMap/upload'), {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `업로드 실패 (${res.status})`);
      } else {
        throw new Error('파일이 없습니다.');
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="나의지도 레이어 추가"
        className="pointer-events-auto flex max-h-[min(90vh,720px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg dark:shadow-none dark:ring-1 dark:ring-border"
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          width: PANEL_WIDTH,
          maxWidth: '95vw',
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onPointerDown={handleDragPointerDown}
          className="flex shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-border px-4 py-3 active:cursor-grabbing hover:bg-muted/30"
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            {step !== 'file' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setStep(step === 'column' ? 'attr' : 'file')}
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <span className="truncate text-sm font-semibold">나의지도 · 레이어 추가</span>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-1 border-b border-border px-4 py-2 text-[11px]">
          {(['file', 'attr', 'column'] as Step[]).map((s, i) => (
            <span
              key={s}
              className={cn(
                'rounded-full px-2 py-0.5',
                step === s ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
              )}
            >
              {i + 1}. {s === 'file' ? '파일' : s === 'attr' ? '정보' : '컬럼'}
            </span>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3 text-[12px]">
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">
              {error}
            </p>
          )}

          {step === 'file' && (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 hover:bg-muted/50">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-medium">SHP 세트 또는 Excel 선택</span>
              <span className="text-[11px] text-muted-foreground">shp+shx+dbf · xlsx/xls · zip</span>
              <input
                type="file"
                className="hidden"
                accept={ACCEPT}
                multiple
                onChange={(e) => void onPickFiles(e.target.files)}
              />
              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </label>
          )}

          {step === 'attr' && (
            <>
              <Field label="그룹명">
                <Input className="h-8 text-[12px]" value={layerGroup} onChange={(e) => setLayerGroup(e.target.value)} />
              </Field>
              <Field label="영문명">
                <Input
                  className="h-8 text-[12px]"
                  value={layerKey}
                  onChange={(e) => setLayerKey(safeKey(e.target.value))}
                />
              </Field>
              <Field label="한글명">
                <Input className="h-8 text-[12px]" value={layerName} onChange={(e) => setLayerName(e.target.value)} />
              </Field>
              {kind === 'excel' && (
                <>
                  <Field label="좌표 분류">
                    <div className="flex gap-1">
                      {(['XY', 'ADDR'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={cn(
                            'h-8 flex-1 rounded border text-[12px]',
                            coorStand === m ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                          )}
                          onClick={() => setCoorStand(m)}
                        >
                          {m === 'XY' ? '가로·세로' : '주소'}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {coorStand === 'XY' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="X 컬럼">
                        <select className={selectClass} value={coorX} onChange={(e) => setCoorX(e.target.value)}>
                          <option value="">선택</option>
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Y 컬럼">
                        <select className={selectClass} value={coorY} onChange={(e) => setCoorY(e.target.value)}>
                          <option value="">선택</option>
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  ) : (
                    <Field label="주소 컬럼">
                      <select className={selectClass} value={coorAddr} onChange={(e) => setCoorAddr(e.target.value)}>
                        <option value="">선택</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </>
              )}
              <Field label="좌표계">
                <select
                  className={selectClass}
                  value={sourceEpsg}
                  onChange={(e) => setSourceEpsg(e.target.value as UploadCrsCode)}
                >
                  {UPLOAD_CRS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label} · EPSG:{o.code}
                    </option>
                  ))}
                </select>
              </Field>
              {coorStand === 'ADDR' ? (
                <p className="text-[11px] text-muted-foreground">
                  주소 방식은 등록 시 필지를 찾습니다. 지도 미리보기는 지원하지 않습니다.
                </p>
              ) : (
                <MapPreviewStatus status={mapPreview} hasCrs={!!sourceEpsg} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="선 색">
                  <Input type="color" className="h-8 p-1" value={stroke} onChange={(e) => setStroke(e.target.value)} />
                </Field>
                <Field label="면 색">
                  <Input type="color" className="h-8 p-1" value={fill} onChange={(e) => setFill(e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {step === 'column' && (
            <div className="space-y-2">
              <MapPreviewStatus
                status={mapPreview}
                hasCrs={coorStand !== 'ADDR' && !!sourceEpsg}
              />
              <p className="text-[11px] text-muted-foreground">고유값 1개 · 목록보기 1개 이상 · 한글명</p>
              <div className="overflow-hidden rounded border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">영문</th>
                      <th className="px-2 py-1.5 text-center">고유</th>
                      <th className="px-2 py-1.5 text-center">목록</th>
                      <th className="px-2 py-1.5 text-left">한글</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono">{c}</td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="radio"
                            name="keyField"
                            checked={keyField === c}
                            onChange={() => setKeyField(c)}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={listFields.includes(c)}
                            onChange={() => toggleList(c)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className="h-7 text-[11px]"
                            value={korNames[c] ?? ''}
                            onChange={(e) => setKorNames((p) => ({ ...p, [c]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          {step === 'attr' && (
            <Button type="button" size="sm" className="h-8" onClick={goColumn} disabled={busy}>
              다음
            </Button>
          )}
          {step === 'column' && (
            <Button type="button" size="sm" className="h-8 gap-1" onClick={() => void handleSave()} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              저장
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-foreground/80">{label}</div>
      {children}
    </div>
  );
}

const selectClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground focus:border-primary focus:outline-none';
