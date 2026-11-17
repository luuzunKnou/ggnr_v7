'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorkBook } from 'xlsx';
import { AlertTriangle, Check, CheckCircle2, FileSpreadsheet, FileUp, Layers, Upload, X, XCircle } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import {
  EXCEL_LOCATION_OPTIONS,
  PREVIEW_MAP_FEATURE_LIMIT,
  PREVIEW_ROW_LIMIT,
  SHP_PART_EXTS,
  SHP_PART_LABELS,
  SHP_REQUIRED_EXTS,
  UPLOAD_CRS_OPTIONS,
  UPLOAD_ENCODING_OPTIONS,
  UPLOAD_VISIBILITY_OPTIONS,
  USER_DATA_UPLOAD_MAX_BYTES,
  getUploadCrsLabel,
  type ExcelLocationMode,
  type UploadCrsCode,
  type UploadEncoding,
  type UploadVisibility,
} from './userDataUploadConfig';
import {
  analyzeExcelLocation,
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
  type ExcelColumnPick,
  type RawPreviewGeometry,
  type ShpMeta,
  type TablePreview,
  type UploadDetectResult,
} from './userDataUploadParse';
import { UserDataUploadPreview, type PreviewSummaryItem } from './UserDataUploadPreview';
import { useUserDataUploadPreviewLayer, type UploadPreviewLayerStatus } from './useUserDataUploadPreviewLayer';
import { useUploadCrsCandidates, type UploadCrsCandidateState } from './useUploadCrsCandidates';

type Step = 1 | 2 | 3;
type CrsSource = 'prj' | 'boundary' | 'extent' | 'manual' | null;

const STEPS: Array<{ step: Step; label: string }> = [
  { step: 1, label: '파일 선택' },
  { step: 2, label: '설정' },
  { step: 3, label: '미리보기' },
];

const ACCEPT = '.zip,.shp,.shx,.dbf,.prj,.cpg,.xlsx,.xls,.csv';
const EMPTY_PICK: ExcelColumnPick = { x: -1, y: -1, address: -1, wkt: -1 };
const NO_GEOMETRIES: RawPreviewGeometry[] = [];

const selectClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 [color-scheme:light] dark:[color-scheme:dark]';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground/80">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cn(
            'h-7 flex-1 rounded px-2 text-[12px] transition-colors',
            value === o.value
              ? 'bg-background font-medium text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CrsBadge({ source, checking }: { source: CrsSource; checking: boolean }) {
  if (checking) {
    return <span className="text-[10px] text-muted-foreground">지역 경계 확인 중…</span>;
  }
  if (source === 'prj') {
    return <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">자동 감지</span>;
  }
  if (source === 'boundary') {
    return <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">지역 경계 기준</span>;
  }
  if (source === 'extent') {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        추정
      </span>
    );
  }
  return null;
}

function MapPreviewStatus({ status, hasCrs }: { status: UploadPreviewLayerStatus; hasCrs: boolean }) {
  if (!hasCrs) return null;
  if (status.drawn === 0) {
    return <p className="text-[11px] text-muted-foreground">지도에 표시할 도형이 없습니다.</p>;
  }
  if (status.outOfKorea) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        이 좌표계로 변환하면 국내 범위를 벗어납니다. 다른 좌표계를 선택하세요.
      </p>
    );
  }
  return (
    <p className="rounded-md bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-800 dark:bg-orange-500/10 dark:text-orange-300">
      지도에 앞 {status.drawn.toLocaleString()}건을 주황색으로 표시했습니다. 지적선·영상과 위치가 맞는지 확인하세요.
      {status.failed > 0 ? ` (변환 실패 ${status.failed}건)` : ''}
    </p>
  );
}

/** 지역 경계 판정이 있으면 겹치는 좌표계를 일치율 순으로 위에, 나머지는 «지역 밖»으로 아래에 둔다 */
function CrsSelect({
  value,
  check,
  onChange,
}: {
  value: UploadCrsCode | '';
  check: UploadCrsCandidateState;
  onChange: (code: UploadCrsCode | null) => void;
}) {
  const handle = (v: string) => onChange(v ? (v as UploadCrsCode) : null);
  const label = (code: UploadCrsCode) => UPLOAD_CRS_OPTIONS.find((o) => o.code === code)?.label ?? code;

  if (!check.candidates) {
    return (
      <select className={selectClass} value={value} onChange={(e) => handle(e.target.value)}>
        <option value="">선택하세요</option>
        {UPLOAD_CRS_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label} · EPSG:{o.code}
          </option>
        ))}
      </select>
    );
  }

  const matched = new Set(check.candidates.map((c) => c.code));
  return (
    <select className={selectClass} value={value} onChange={(e) => handle(e.target.value)}>
      <option value="">선택하세요</option>
      {check.candidates.length > 0 ? (
        <optgroup label="우리 지역과 겹침">
          {check.candidates.map((c) => (
            <option key={c.code} value={c.code}>
              {label(c.code)} · EPSG:{c.code} · 일치 {Math.round(c.overlapRatio * 100)}%
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="지역 밖·기타">
        {UPLOAD_CRS_OPTIONS.filter((o) => !matched.has(o.code)).map((o) => (
          <option key={o.code} value={o.code}>
            {o.label} · EPSG:{o.code}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function ColumnSelect({
  value,
  columns,
  onChange,
  label,
}: {
  value: number;
  columns: string[];
  onChange: (i: number) => void;
  label: string;
}) {
  return (
    <select className={selectClass} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>선택하세요</option>
      {columns.map((c, i) => (
        <option key={`${c}-${i}`} value={i}>
          {c}
        </option>
      ))}
    </select>
  );
}

type Props = {
  onClose: () => void;
};

/** 왼쪽 메뉴 데이터 업로드 — 파일 선택 · 설정 · 미리보기 */
export function UserDataUploadPanel({ onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [detect, setDetect] = useState<UploadDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detectSeq = useRef(0);

  const [layerName, setLayerName] = useState('');
  const [visibility, setVisibility] = useState<UploadVisibility>('private');
  const [manualCrs, setManualCrs] = useState<UploadCrsCode | null>(null);

  const [datasetKey, setDatasetKey] = useState('');
  const [shpMeta, setShpMeta] = useState<ShpMeta | null>(null);
  const [encoding, setEncoding] = useState<UploadEncoding>('euc-kr');
  const [shpTable, setShpTable] = useState<TablePreview | null>(null);
  const [shpTableLoading, setShpTableLoading] = useState(false);
  const [shpGeometries, setShpGeometries] = useState<RawPreviewGeometry[]>(NO_GEOMETRIES);

  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [locMode, setLocMode] = useState<ExcelLocationMode>('coords');
  const [pick, setPick] = useState<ExcelColumnPick>(EMPTY_PICK);

  const kind = detect?.kind ?? null;
  const dataset = detect?.kind === 'shp' ? (detect.datasets.find((d) => d.key === datasetKey) ?? null) : null;
  const missingRequired = dataset ? SHP_REQUIRED_EXTS.filter((ext) => !dataset.parts[ext]) : [];

  const resetAll = () => {
    detectSeq.current += 1;
    setStep(1);
    setFiles([]);
    setDetect(null);
    setDetecting(false);
    setError(null);
    setLayerName('');
    setVisibility('private');
    setManualCrs(null);
    setDatasetKey('');
    setShpMeta(null);
    setEncoding('euc-kr');
    setShpTable(null);
    setShpGeometries(NO_GEOMETRIES);
    setWorkbook(null);
    setSheetName('');
    setHeaderRow(1);
    setLocMode('coords');
    setPick(EMPTY_PICK);
  };

  const handleFiles = async (picked: File[]) => {
    if (!picked.length) return;
    resetAll();
    const seq = detectSeq.current;
    const total = picked.reduce((s, f) => s + f.size, 0);
    setFiles(picked);
    if (total > USER_DATA_UPLOAD_MAX_BYTES) {
      setError(`파일이 너무 큽니다 (${formatBytes(total)}). ${formatBytes(USER_DATA_UPLOAD_MAX_BYTES)} 이하로 올려 주세요.`);
      return;
    }
    setDetecting(true);
    try {
      const result = detectUploadKind(await collectUploadSources(picked));
      if (seq !== detectSeq.current) return;
      setDetect(result);
      if (result.kind === 'shp') {
        setDatasetKey(result.datasets[0]!.key);
      } else if (result.kind === 'excel') {
        const wb = await readExcelWorkbook(result.file);
        if (seq !== detectSeq.current) return;
        setWorkbook(wb);
        setSheetName(wb.SheetNames[0] ?? '');
        setLayerName(stripExt(result.file.name));
      }
    } catch (e) {
      if (seq === detectSeq.current) setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      if (seq === detectSeq.current) setDetecting(false);
    }
  };

  useEffect(() => {
    if (!dataset) return;
    let cancelled = false;
    setShpMeta(null);
    setShpGeometries(NO_GEOMETRIES);
    setManualCrs(null);
    setLayerName(dataset.name);
    readShpPreviewGeometries(dataset, PREVIEW_MAP_FEATURE_LIMIT)
      .then((geoms) => {
        if (!cancelled) setShpGeometries(geoms);
      })
      .catch(() => {
        if (!cancelled) setShpGeometries(NO_GEOMETRIES);
      });
    readShpMeta(dataset)
      .then((meta) => {
        if (cancelled) return;
        setShpMeta(meta);
        setEncoding(meta.encoding ?? 'euc-kr');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '도형 파일을 읽지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  const dbfSource = dataset?.parts.dbf ?? null;
  useEffect(() => {
    if (!dbfSource) {
      setShpTable(null);
      return;
    }
    let cancelled = false;
    setShpTableLoading(true);
    readDbfPreview(dbfSource, encoding, PREVIEW_ROW_LIMIT)
      .then((t) => {
        if (!cancelled) setShpTable(t);
      })
      .catch((e) => {
        if (!cancelled) {
          setShpTable(null);
          setError(e instanceof Error ? e.message : '속성 파일을 읽지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setShpTableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dbfSource, encoding]);

  const matrix = useMemo(
    () => (workbook && sheetName ? readSheetMatrix(workbook, sheetName) : []),
    [workbook, sheetName]
  );
  const excelTable = useMemo(() => (workbook ? buildExcelTable(matrix, headerRow) : null), [workbook, matrix, headerRow]);
  const excelColumnsKey = excelTable?.columns.join('\u0001') ?? '';

  useEffect(() => {
    if (!excelTable) return;
    const auto = autoPickExcelColumns(excelTable.columns);
    setPick(auto);
    setLocMode(auto.x >= 0 && auto.y >= 0 ? 'coords' : auto.address >= 0 ? 'address' : auto.wkt >= 0 ? 'wkt' : 'coords');
    setManualCrs(null);
    // 컬럼 구성이 바뀔 때만 자동 선택을 다시 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelColumnsKey]);

  const locStats = useMemo(
    () => (excelTable ? analyzeExcelLocation(excelTable.rows, locMode, pick) : null),
    [excelTable, locMode, pick]
  );

  const excelNeedsCrs = locMode !== 'address';
  const rawExtent =
    kind === 'shp' ? (shpMeta?.extent ?? null) : kind === 'excel' && excelNeedsCrs ? (locStats?.extent ?? null) : null;
  const crsCheck = useUploadCrsCandidates(rawExtent);
  const topCandidate = crsCheck.candidates?.[0]?.code ?? null;

  /** 직접 고르지 않았으면 좌표계 파일 → 지역 경계 일치 1순위 → 좌표 범위 추정 순 */
  const autoCrs: { code: UploadCrsCode | null; source: CrsSource } =
    kind === 'shp' && shpMeta?.crsSource === 'prj'
      ? { code: shpMeta.crs, source: 'prj' }
      : topCandidate
        ? { code: topCandidate, source: 'boundary' }
        : kind === 'shp' && shpMeta?.crs
          ? { code: shpMeta.crs, source: 'extent' }
          : kind === 'excel' && locStats?.crsGuess
            ? { code: locStats.crsGuess, source: 'extent' }
            : { code: null, source: null };
  const crs: UploadCrsCode | '' = manualCrs ?? autoCrs.code ?? '';
  const crsSource: CrsSource = manualCrs ? 'manual' : autoCrs.source;

  const prjOutsideRegion =
    kind === 'shp' &&
    shpMeta?.crsSource === 'prj' &&
    shpMeta.crs != null &&
    crsCheck.candidates != null &&
    !crsCheck.candidates.some((c) => c.code === shpMeta.crs);
  const noRegionCandidate = crsCheck.candidates != null && crsCheck.candidates.length === 0;

  const excelGeometries = useMemo(
    () =>
      excelTable ? buildExcelPreviewGeometries(excelTable.rows, locMode, pick, PREVIEW_MAP_FEATURE_LIMIT) : NO_GEOMETRIES,
    [excelTable, locMode, pick]
  );

  const mapPreview = useUserDataUploadPreviewLayer(
    step >= 2,
    kind === 'shp' ? shpGeometries : kind === 'excel' ? excelGeometries : NO_GEOMETRIES,
    crs
  );

  const excelLocationReady =
    locMode === 'coords'
      ? pick.x >= 0 && pick.y >= 0 && pick.x !== pick.y
      : locMode === 'address'
        ? pick.address >= 0
        : pick.wkt >= 0;

  const canNextFromFile =
    !detecting &&
    !error &&
    ((kind === 'shp' && dataset != null && missingRequired.length === 0) ||
      (kind === 'excel' && (excelTable?.rows.length ?? 0) > 0));

  const canNextFromSettings =
    layerName.trim() !== '' &&
    (kind === 'shp' ? crs !== '' : excelLocationReady && (!excelNeedsCrs || crs !== ''));

  const visibilityLabel = UPLOAD_VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.label ?? '';

  const previewSummary: PreviewSummaryItem[] =
    kind === 'shp'
      ? [
          { label: '레이어', value: layerName },
          { label: '형식', value: 'SHP' },
          { label: '건수', value: (shpTable?.totalCount ?? 0).toLocaleString() },
          { label: '도형', value: shpMeta?.shapeTypeLabel ?? '—' },
          { label: '좌표계', value: getUploadCrsLabel(crs), warn: crsSource === 'extent' },
          { label: '공개 범위', value: visibilityLabel },
        ]
      : [
          { label: '레이어', value: layerName },
          { label: '형식', value: `엑셀 · ${sheetName}` },
          { label: '건수', value: (excelTable?.totalCount ?? 0).toLocaleString() },
          { label: '도형', value: locStats?.geomLabel ?? '—' },
          {
            label: '좌표계',
            value: excelNeedsCrs ? getUploadCrsLabel(crs) : '지적 필지 기준',
            warn: excelNeedsCrs && crsSource === 'extent',
          },
          { label: '위치 없음', value: `${(locStats?.invalid ?? 0).toLocaleString()}건`, warn: (locStats?.invalid ?? 0) > 0 },
        ];

  const previewWarnings: string[] = [];
  if (mapPreview.outOfKorea) {
    previewWarnings.push('선택한 좌표계로 변환하면 국내 범위를 벗어납니다. 설정에서 좌표계를 다시 확인하세요.');
  }
  if (crsSource === 'extent' && (kind === 'shp' || excelNeedsCrs)) {
    previewWarnings.push('좌표계를 좌표 범위로 추정했습니다. 원본 자료의 좌표계와 같은지 확인하세요.');
  }
  if (prjOutsideRegion && crsSource === 'prj') {
    previewWarnings.push('좌표계 파일에 적힌 좌표계로는 우리 지역 경계와 겹치지 않습니다. 좌표계 파일이 잘못되었을 수 있습니다.');
  }
  if (noRegionCandidate) {
    previewWarnings.push('어떤 평면좌표계로 해석해도 우리 지역 경계와 겹치지 않습니다. 다른 지역 자료인지 확인하세요.');
  }
  if (kind === 'excel' && locStats?.swapped) {
    previewWarnings.push('경도·위도 컬럼이 서로 바뀐 것 같습니다. 설정에서 컬럼을 확인하세요.');
  }
  if (kind === 'excel' && locMode === 'address') {
    previewWarnings.push('주소는 등록할 때 지번으로 필지를 찾아 위치를 만듭니다. 찾지 못한 행은 위치 없이 저장됩니다.');
  }

  const renderFileStep = () => (
    <div className="space-y-3">
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:border-primary/50 hover:bg-muted/60'
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <Upload className={cn('h-5 w-5', dragOver ? 'text-primary' : 'text-muted-foreground')} />
        <span className="text-[12px] font-medium text-foreground">파일을 놓거나 눌러 선택</span>
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          SHP는 zip 또는 구성 파일(shp·shx·dbf·prj·cpg)을 함께,
          <br />
          엑셀은 xlsx·xls·csv 파일 하나를 올리세요.
        </span>
        <input
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>

      {files.length > 0 ? (
        <p className="truncate rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] text-foreground">
          {files.length}개 선택
          <span className="text-muted-foreground">
            {' '}
            · {files[0]!.name}
            {files.length > 1 ? ` 외 ${files.length - 1}개` : ''} · {formatBytes(files.reduce((s, f) => s + f.size, 0))}
          </span>
        </p>
      ) : null}

      {detecting ? <p className="py-4 text-center text-xs text-muted-foreground">파일을 확인하는 중…</p> : null}

      {error ? (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {detect?.kind === 'none' ? (
        <p className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">{detect.message}</p>
      ) : null}

      {detect?.kind === 'shp' ? (
        <div className="space-y-2.5 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 text-primary/80" />
            SHP
          </div>
          {detect.datasets.length > 1 ? (
            <Field label={`자료 선택 (${detect.datasets.length}개)`}>
              <select className={selectClass} value={datasetKey} onChange={(e) => setDatasetKey(e.target.value)}>
                {detect.datasets.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-[12px] text-foreground/90">{dataset?.name}</p>
          )}
          {dataset ? (
            <ul className="grid grid-cols-5 gap-1">
              {SHP_PART_EXTS.map((ext) => {
                const has = Boolean(dataset.parts[ext]);
                const required = SHP_REQUIRED_EXTS.includes(ext);
                return (
                  <li
                    key={ext}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10.5px]',
                      has
                        ? 'border-primary/30 bg-primary/5 text-foreground'
                        : required
                          ? 'border-destructive/40 bg-destructive/5 text-destructive'
                          : 'border-border bg-muted/30 text-muted-foreground'
                    )}
                    title={`.${ext}${required ? ' (필수)' : ' (권장)'}`}
                  >
                    {has ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    ) : required ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : (
                      <span className="h-3.5 text-center leading-[14px]">–</span>
                    )}
                    <span>{SHP_PART_LABELS[ext]}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {missingRequired.length > 0 ? (
            <p className="text-[11px] text-destructive">
              필수 파일이 없습니다: {missingRequired.map((ext) => `.${ext}`).join(', ')}
            </p>
          ) : dataset && (!dataset.parts.prj || !dataset.parts.cpg) ? (
            <p className="text-[11px] text-muted-foreground">
              {!dataset.parts.prj ? '좌표계 파일이 없어 다음 단계에서 좌표계를 확인해야 합니다. ' : ''}
              {!dataset.parts.cpg ? '인코딩 파일이 없으면 국내 표준(한글)으로 읽습니다.' : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {detect?.kind === 'excel' ? (
        <div className="space-y-1 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary/80" />
            엑셀
          </div>
          <p className="truncate text-[12px] text-foreground/90">{detect.file.name}</p>
          <p className="text-[11px] text-muted-foreground">
            시트 {workbook?.SheetNames.length ?? 0}개 · 첫 시트 {excelTable?.totalCount.toLocaleString() ?? 0}행
          </p>
        </div>
      ) : null}

      {detect && detect.ignored.length > 0 ? (
        <p className="text-[11px] text-muted-foreground" title={detect.ignored.join('\n')}>
          제외된 파일 {detect.ignored.length}개: {detect.ignored.slice(0, 3).join(', ')}
          {detect.ignored.length > 3 ? ' …' : ''}
        </p>
      ) : null}
    </div>
  );

  const renderCommonSettings = () => (
    <>
      <Field label="레이어 이름">
        <Input
          value={layerName}
          onChange={(e) => setLayerName(e.target.value)}
          placeholder="지도에 표시할 이름"
          className="h-8 text-[12px]"
        />
      </Field>
      <Field label="공개 범위">
        <Segmented value={visibility} options={UPLOAD_VISIBILITY_OPTIONS} onChange={setVisibility} />
      </Field>
    </>
  );

  const renderCrsSelect = () => (
    <Field label="좌표계" aside={<CrsBadge source={crsSource} checking={crsCheck.loading} />}>
      <CrsSelect value={crs} check={crsCheck} onChange={(code) => setManualCrs(code)} />
    </Field>
  );

  const renderCrsNotice = () =>
    prjOutsideRegion && crsSource === 'prj' ? (
      <p className="text-[11px] text-destructive">
        좌표계 파일의 좌표계로는 우리 지역과 겹치지 않습니다.
        {topCandidate ? ` 지역 경계 기준으로는 «${getUploadCrsLabel(topCandidate)}»이(가) 가장 잘 맞습니다.` : ''}
      </p>
    ) : noRegionCandidate ? (
      <p className="text-[11px] text-destructive">
        어떤 평면좌표계로 해석해도 우리 지역 경계와 겹치지 않습니다. 다른 지역 자료인지 확인하세요.
      </p>
    ) : crsSource === 'boundary' ? (
      <p className="text-[11px] text-muted-foreground">
        좌표 범위가 우리 지역 경계와 가장 많이 겹치는 좌표계를 골랐습니다. 비슷한 후보는 지도에서 위치를 비교하세요.
      </p>
    ) : crsSource === 'extent' ? (
      <p className="text-[11px] text-amber-700 dark:text-amber-300">
        좌표 범위로만 추정했습니다. 원본 좌표계를 확인하세요.
        {crsCheck.error ? ` (지역 경계 확인 실패: ${crsCheck.error})` : ''}
      </p>
    ) : !crs && (kind === 'excel' || shpMeta) && !crsCheck.loading ? (
      <p className="text-[11px] text-destructive">좌표계를 알 수 없습니다. 직접 선택하세요.</p>
    ) : null;

  const renderShpSettings = () => (
    <div className="space-y-3">
      {renderCommonSettings()}
      {renderCrsSelect()}
      {renderCrsNotice()}
      <MapPreviewStatus status={mapPreview} hasCrs={crs !== ''} />
      <Field
        label="속성 인코딩"
        aside={shpMeta?.encoding ? <span className="text-[10px] text-primary">인코딩 파일 기준</span> : null}
      >
        <select
          className={selectClass}
          value={encoding}
          onChange={(e) => setEncoding(e.target.value as UploadEncoding)}
        >
          {UPLOAD_ENCODING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {shpTable && shpTable.rows.length > 0 ? (
        <p className="truncate rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          첫 행: <span className="text-foreground/90">{shpTable.rows[0]!.filter(Boolean).slice(0, 4).join(' · ')}</span>
        </p>
      ) : null}
    </div>
  );

  const renderExcelSettings = () => {
    const columns = excelTable?.columns ?? [];
    return (
      <div className="space-y-3">
        {renderCommonSettings()}
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="시트">
            <select className={selectClass} value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
              {(workbook?.SheetNames ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="머리글 행">
            <select className={selectClass} value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
              {Array.from({ length: Math.min(10, Math.max(1, matrix.length)) }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}행
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="위치 지정">
          <Segmented value={locMode} options={EXCEL_LOCATION_OPTIONS} onChange={setLocMode} />
        </Field>
        {locMode === 'coords' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="경도 · X">
              <ColumnSelect label="경도 컬럼" value={pick.x} columns={columns} onChange={(x) => setPick((p) => ({ ...p, x }))} />
            </Field>
            <Field label="위도 · Y">
              <ColumnSelect label="위도 컬럼" value={pick.y} columns={columns} onChange={(y) => setPick((p) => ({ ...p, y }))} />
            </Field>
          </div>
        ) : locMode === 'address' ? (
          <Field label="주소 컬럼">
            <ColumnSelect
              label="주소 컬럼"
              value={pick.address}
              columns={columns}
              onChange={(address) => setPick((p) => ({ ...p, address }))}
            />
          </Field>
        ) : (
          <Field label="도형문자 컬럼">
            <ColumnSelect label="도형문자 컬럼" value={pick.wkt} columns={columns} onChange={(wkt) => setPick((p) => ({ ...p, wkt }))} />
          </Field>
        )}
        {excelNeedsCrs ? renderCrsSelect() : null}
        {excelNeedsCrs && excelLocationReady ? renderCrsNotice() : null}
        {excelNeedsCrs ? (
          excelLocationReady ? <MapPreviewStatus status={mapPreview} hasCrs={crs !== ''} /> : null
        ) : (
          <p className="text-[11px] text-muted-foreground">주소 방식은 등록할 때 필지를 찾으므로 지도 미리보기가 없습니다.</p>
        )}
        {locMode === 'coords' && pick.x >= 0 && pick.x === pick.y ? (
          <p className="text-[11px] text-destructive">경도와 위도에 서로 다른 컬럼을 고르세요.</p>
        ) : null}
        {locStats?.swapped ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">경도·위도 컬럼이 서로 바뀐 것 같습니다.</p>
        ) : null}
        {excelLocationReady && locStats ? (
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            위치 가능 <span className="font-medium text-foreground">{locStats.valid.toLocaleString()}</span>건
            {locStats.invalid > 0 ? (
              <>
                {' · '}위치 없음{' '}
                <span className="font-medium text-amber-600 dark:text-amber-400">{locStats.invalid.toLocaleString()}</span>건
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
            <FileUp className="h-4 w-4 text-primary/80" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground/90">데이터 업로드</h1>
            <p className="text-[11px] text-muted-foreground">SHP · 엑셀 자료를 레이어로 등록</p>
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

      <ol className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        {STEPS.map((s, i) => {
          const done = step > s.step;
          const active = step === s.step;
          return (
            <li key={s.step} className="flex min-w-0 flex-1 items-center gap-1">
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                      ? 'border border-primary bg-primary/10 text-primary'
                      : 'border border-border text-muted-foreground'
                )}
              >
                {done ? <Check className="h-3 w-3" /> : s.step}
              </span>
              <span
                className={cn(
                  'truncate text-[11.5px]',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 ? <span className="mx-1 h-px min-w-3 flex-1 bg-border" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {step === 1
          ? renderFileStep()
          : step === 2
            ? kind === 'shp'
              ? renderShpSettings()
              : renderExcelSettings()
            : (
                <UserDataUploadPreview
                  summary={previewSummary}
                  table={kind === 'shp' ? shpTable : excelTable}
                  rowLimit={PREVIEW_ROW_LIMIT}
                  loading={kind === 'shp' && shpTableLoading}
                  warnings={previewWarnings}
                />
              )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2.5">
        <div className="min-w-0 text-[10.5px] text-muted-foreground">
          {step === 3 ? '서버 등록은 다음 단계에서 연결됩니다.' : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {step === 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-[12px]"
              disabled={files.length === 0}
              onClick={resetAll}
            >
              지우기
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-[12px]"
              onClick={() => setStep((s) => (s - 1) as Step)}
            >
              이전
            </Button>
          )}
          {step < 3 ? (
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-[12px]"
              disabled={step === 1 ? !canNextFromFile : !canNextFromSettings}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              다음
            </Button>
          ) : (
            <Button type="button" size="sm" className="h-8 gap-1 px-3 text-[12px]" disabled title="서버 저장 준비 중">
              <Upload className="h-3.5 w-3.5" />
              등록
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
