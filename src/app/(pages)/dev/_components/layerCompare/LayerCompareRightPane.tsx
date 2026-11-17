'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import type {
  ColumnMatchRow,
  StructureCompareResult,
  ValueCompareResult,
  ValueDiffRow,
} from '@/lib/layerCompareTypes';
import { cn } from '@/lib/utils';
import {
  ComparePane,
  SectionBox,
  SheetTable,
  StatTile,
  formatCompareId,
} from './layerCompareUi';

type RightTab = 'structure' | 'values';
type DiffSubTab = 'value' | 'column' | 'id';

type Props = {
  structure: StructureCompareResult | null;
  columns: ColumnMatchRow[];
  values: ValueCompareResult | null;
  tab: RightTab;
  busy?: boolean;
  onColumnsChange: (columns: ColumnMatchRow[]) => void;
  onTabChange: (t: RightTab) => void;
  onExport: () => void;
  onRestart: () => void;
};

function kindLabel(k: ColumnMatchRow['kind']) {
  switch (k) {
    case 'same':
      return '같음';
    case 'candidate':
      return '후보';
    case 'typeMismatch':
      return '타입';
    case 'baseOnly':
      return '기준만';
    case 'fileOnly':
      return '파일만';
  }
}

function groupById(rows: ValueDiffRow[]) {
  const map = new Map<string, ValueDiffRow[]>();
  for (const d of rows) {
    const id = formatCompareId(d.displayId);
    const list = map.get(id) ?? [];
    list.push(d);
    map.set(id, list);
  }
  return [...map.entries()];
}

function DiffSubTabs(props: {
  active: DiffSubTab;
  onChange: (t: DiffSubTab) => void;
  valueCount: number;
  columnCount: number;
  idCount: number;
}) {
  const items: { id: DiffSubTab; label: string; count: number }[] = [
    { id: 'value', label: '값다름', count: props.valueCount },
    { id: 'column', label: '컬럼', count: props.columnCount },
    { id: 'id', label: '식별', count: props.idCount },
  ];
  return (
    <div className="flex shrink-0 flex-wrap gap-1 rounded-md border border-border p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => props.onChange(it.id)}
          className={cn(
            'rounded px-2.5 py-1 text-sm transition-colors',
            props.active === it.id ? 'bg-muted text-foreground' : 'text-foreground/70 hover:bg-muted/50'
          )}
        >
          {it.label}
          <span className="ml-1 tabular-nums">({it.count.toLocaleString()})</span>
        </button>
      ))}
    </div>
  );
}

export function LayerCompareRightPane({
  structure,
  columns,
  values,
  tab,
  busy,
  onColumnsChange,
  onTabChange,
  onExport,
  onRestart,
}: Props) {
  const [diffSub, setDiffSub] = useState<DiffSubTab>('value');

  useEffect(() => {
    if (values?.success) setDiffSub('value');
  }, [values?.success, values?.matched, values?.valueDiffCount]);

  const sorted = useMemo(() => {
    const order: Record<string, number> = {
      same: 0,
      typeMismatch: 1,
      candidate: 2,
      baseOnly: 3,
      fileOnly: 4,
    };
    return [...columns].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  }, [columns]);

  const toggleInclude = (id: string, included: boolean) => {
    onColumnsChange(columns.map((c) => (c.id === id ? { ...c, included } : c)));
  };

  const geomBase = structure
    ? structure.base.geomKind === 'NONE'
      ? '없음'
      : structure.base.geomKind
    : '—';
  const geomFile = structure
    ? structure.file.geomKind === 'NONE'
      ? '없음'
      : structure.file.geomKind
    : '—';
  const sridBase =
    structure?.base.srid != null ? `EPSG:${structure.base.srid}` : structure ? '없음' : '—';
  const sridFile =
    structure?.file.srid != null ? `EPSG:${structure.file.srid}` : structure ? '없음' : '—';

  const counts = useMemo(
    () => ({
      same: columns.filter((c) => c.kind === 'same').length,
      candidate: columns.filter((c) => c.kind === 'candidate').length,
      typeMismatch: columns.filter((c) => c.kind === 'typeMismatch').length,
      baseOnly: columns.filter((c) => c.kind === 'baseOnly').length,
      fileOnly: columns.filter((c) => c.kind === 'fileOnly').length,
    }),
    [columns]
  );

  const valueDiffs = useMemo(() => {
    if (values?.valueDiffs?.length) return values.valueDiffs;
    return (values?.diffs ?? []).filter((d) => d.kind === 'value' || !d.kind);
  }, [values]);
  const idDiffs = useMemo(() => {
    if (values?.idDiffs?.length) return values.idDiffs;
    return (values?.diffs ?? []).filter((d) => d.kind === 'baseOnly' || d.kind === 'fileOnly');
  }, [values]);
  const columnGapRows = useMemo(() => {
    if (values?.columnDiffs?.length) {
      return values.columnDiffs.map((d) => ({
        kind: d.kind === 'colBaseOnly' ? ('baseOnly' as const) : ('fileOnly' as const),
        baseName: d.kind === 'colBaseOnly' ? d.column : null,
        fileName: d.kind === 'colFileOnly' ? d.column : null,
        baseKor: d.kind === 'colBaseOnly' ? d.columnLabel : '',
        fileKor: d.kind === 'colFileOnly' ? d.columnLabel : '',
      }));
    }
    return columns.filter((c) => c.kind === 'baseOnly' || c.kind === 'fileOnly');
  }, [values, columns]);

  const valueGrouped = useMemo(() => groupById(valueDiffs), [valueDiffs]);
  const idGrouped = useMemo(() => groupById(idDiffs), [idDiffs]);

  const valuePairCount = values?.valueDiffCount ?? 0;
  const valueItemTotal = values?.valueDiffItemTotal ?? valueDiffs.length;
  const columnGapCount = values?.columnDiffTotal ?? counts.baseOnly + counts.fileOnly;
  const idGapCount = values?.idDiffTotal ?? (values?.baseOnly ?? 0) + (values?.fileOnly ?? 0);
  const perLimit = values?.diffLimit ?? 0;

  const showStructure = tab === 'structure' || !values;

  const goDiff = (sub: DiffSubTab) => {
    if (!values) return;
    onTabChange('values');
    setDiffSub(sub);
  };

  return (
    <ComparePane
      toolbar={
        <>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => onTabChange('structure')}
                className={cn(
                  'rounded px-2.5 py-1 text-sm transition-colors',
                  showStructure ? 'bg-muted text-foreground' : 'text-foreground/70'
                )}
              >
                구조
              </button>
              <button
                type="button"
                disabled={!values}
                onClick={() => onTabChange('values')}
                className={cn(
                  'rounded px-2.5 py-1 text-sm transition-colors',
                  !showStructure ? 'bg-muted text-foreground' : 'text-foreground/70',
                  !values && 'cursor-not-allowed opacity-40'
                )}
              >
                값
              </button>
            </div>
            <p className="truncate text-sm text-foreground">
              {structure
                ? `${structure.base.label} · ${structure.file.label}`
                : '파일을 올리면 표가 채워집니다.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-sm"
              onClick={onExport}
              disabled={busy || !structure}
            >
              엑셀
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-sm"
              onClick={onRestart}
              disabled={busy || !structure}
            >
              처음으로
            </Button>
          </div>
        </>
      }
    >
      {showStructure ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
          <div className="grid shrink-0 grid-cols-3 gap-2">
            <StatTile
              label="건수 (기준 / 파일)"
              value={
                structure
                  ? `${structure.base.rowCount.toLocaleString()} / ${structure.file.rowCount.toLocaleString()}`
                  : '— / —'
              }
              detail={
                structure
                  ? structure.countSame
                    ? '같음'
                    : `다름 ${Math.abs(structure.base.rowCount - structure.file.rowCount).toLocaleString()}건`
                  : '대기'
              }
              diff={!!structure && !structure.countSame}
            />
            <StatTile
              label="도형 타입"
              value={`${geomBase} / ${geomFile}`}
              detail={structure ? (structure.geomSame ? '같음' : '다름') : '대기'}
              diff={!!structure && !structure.geomSame}
            />
            <StatTile
              label="좌표계"
              value={`${sridBase} / ${sridFile}`}
              detail={structure ? (structure.sridSame ? '같음' : '다름') : '대기'}
              diff={!!structure && !structure.sridSame}
            />
          </div>

          <SectionBox
            fill
            scrollBody
            title={
              structure
                ? `비교할 항목 · 같음 ${counts.same} · 후보 ${counts.candidate} · 타입 ${counts.typeMismatch} · 기준만 ${counts.baseOnly} · 파일만 ${counts.fileOnly}`
                : '비교할 항목'
            }
            bodyClassName="p-2.5"
          >
            <SheetTable
              className="h-full"
              columns={[
                { key: 'kind', label: '구분' },
                { key: 'base', label: '기준' },
                { key: 'file', label: '파일' },
                { key: 'kor', label: '한글' },
                { key: 'include', label: '포함' },
              ]}
              rows={
                structure && sorted.length > 0
                  ? sorted.map((c) => ({
                      kind: kindLabel(c.kind),
                      base: c.baseName ?? '—',
                      file: c.fileName ?? '—',
                      kor: c.baseKor || c.fileKor || '—',
                      include:
                        c.kind === 'candidate' || c.kind === 'typeMismatch' ? (
                          <input
                            type="checkbox"
                            className="size-4 accent-foreground"
                            checked={c.included === true}
                            onChange={(e) => toggleInclude(c.id, e.target.checked)}
                          />
                        ) : c.kind === 'same' ? (
                          '자동'
                        ) : (
                          '—'
                        ),
                    }))
                  : []
              }
              empty="비교 대기 — 왼쪽에서 기준 레이어와 파일을 선택하세요."
            />
          </SectionBox>
        </div>
      ) : values ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
          <div className="grid shrink-0 grid-cols-4 gap-2">
            <button type="button" className="text-left" onClick={() => goDiff('value')}>
              <StatTile
                label="맞춰진 건"
                value={`${values.matched.toLocaleString()}건`}
                detail={values.pairNote || '키·위치로 짝 지음'}
              />
            </button>
            <button type="button" className="text-left" onClick={() => goDiff('id')}>
              <StatTile
                label="기준에만 (식별)"
                value={`${values.baseOnly.toLocaleString()}건`}
                detail="파일에 대응 식별 없음"
                diff={values.baseOnly > 0}
              />
            </button>
            <button type="button" className="text-left" onClick={() => goDiff('id')}>
              <StatTile
                label="파일에만 (식별)"
                value={`${values.fileOnly.toLocaleString()}건`}
                detail="기준에 대응 식별 없음"
                diff={values.fileOnly > 0}
              />
            </button>
            <button type="button" className="text-left" onClick={() => goDiff('value')}>
              <StatTile
                label="값 다른 짝"
                value={`${valuePairCount.toLocaleString()}건`}
                detail={`차이 항목 ${valueItemTotal.toLocaleString()}건`}
                diff={valuePairCount > 0}
              />
            </button>
          </div>

          <DiffSubTabs
            active={diffSub}
            onChange={setDiffSub}
            valueCount={valuePairCount}
            columnCount={columnGapCount}
            idCount={idGapCount}
          />

          {diffSub === 'value' ? (
            <SectionBox
              fill
              scrollBody
              title={
                valueDiffs.length < valueItemTotal && perLimit > 0
                  ? `값다름 · 식별별 묶음 · ${valueDiffs.length.toLocaleString()} / ${valueItemTotal.toLocaleString()}건`
                  : `값다름 · 식별별 묶음 · ${valueDiffs.length.toLocaleString()}건`
              }
              bodyClassName="p-2.5"
            >
              <SheetTable
                className="h-full"
                columns={[
                  { key: 'id', label: '식별' },
                  { key: 'col', label: '항목' },
                  { key: 'base', label: '기준값' },
                  { key: 'file', label: '파일값', diffCol: true },
                ]}
                rows={valueGrouped.flatMap(([id, rows]) =>
                  rows.map((d, i) => ({
                    id: i === 0 ? id : '',
                    col: d.columnLabel,
                    base: d.baseValue || '∅',
                    file: d.fileValue || '∅',
                  }))
                )}
                empty={
                  values.matched === 0
                    ? '맞춰진 데이터가 없습니다.'
                    : '값이 다른 항목이 없습니다.'
                }
              />
            </SectionBox>
          ) : null}

          {diffSub === 'column' ? (
            <SectionBox
              fill
              scrollBody
              title={`컬럼 · 기준만 ${counts.baseOnly} · 파일만 ${counts.fileOnly} · ${columnGapRows.length.toLocaleString()}건`}
              bodyClassName="p-2.5"
            >
              <SheetTable
                className="h-full"
                columns={[
                  { key: 'kind', label: '구분' },
                  { key: 'base', label: '기준 컬럼' },
                  { key: 'file', label: '파일 컬럼' },
                  { key: 'kor', label: '한글' },
                ]}
                rows={columnGapRows.map((c) => ({
                  kind: c.kind === 'baseOnly' ? '기준에만' : '파일에만',
                  base: c.baseName ?? '—',
                  file: c.fileName ?? '—',
                  kor: c.baseKor || c.fileKor || '—',
                }))}
                empty="한쪽만 있는 컬럼이 없습니다."
              />
            </SectionBox>
          ) : null}

          {diffSub === 'id' ? (
            <SectionBox
              fill
              scrollBody
              title={`식별 · 기준만 ${values.baseOnly.toLocaleString()} · 파일만 ${values.fileOnly.toLocaleString()} · ${idDiffs.length.toLocaleString()}건`}
              bodyClassName="p-2.5"
            >
              <SheetTable
                className="h-full"
                columns={[
                  { key: 'kind', label: '구분' },
                  { key: 'id', label: '식별값' },
                  { key: 'base', label: '기준' },
                  { key: 'file', label: '파일', diffCol: true },
                ]}
                rows={idGrouped.flatMap(([id, rows]) =>
                  rows.map((d, i) => ({
                    kind: d.kind === 'baseOnly' ? '기준에만' : '파일에만',
                    id: i === 0 ? id : '',
                    base: d.baseValue || '∅',
                    file: d.fileValue || '∅',
                  }))
                )}
                empty="기준·파일 한쪽에만 있는 식별이 없습니다."
              />
            </SectionBox>
          ) : null}
        </div>
      ) : null}
    </ComparePane>
  );
}
