'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Pentagon,
  RefreshCw,
  MapPin,
  GripVertical,
  Database,
  Landmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SIDEBAR_WIDTH = 65;

/* ------------------------------------------------------------------ */
/*  Attribute-query (default) types & data                             */
/* ------------------------------------------------------------------ */

interface DataRow {
  id: string;
  no: number;
  관리번호: string;
  시설명: string;
  관종: string;
  관경: number;
}

interface LayerItem {
  id: string;
  name: string;
  count: number;
  rows: DataRow[];
}

interface LayerGroup {
  id: string;
  name: string;
  layers: LayerItem[];
}

const LAYER_GROUPS: LayerGroup[] = [
  {
    id: 'water',
    name: '광역상수',
    layers: [
      {
        id: 'pipe',
        name: '상수관로',
        count: 120,
        rows: [
          { id: 'p1', no: 1, 관리번호: '47130-2024-0001', 시설명: '안동 광역상수도 1구간', 관종: '강관', 관경: 500 },
          { id: 'p2', no: 2, 관리번호: '47130-2024-0002', 시설명: '영주 광역상수도', 관종: '주철관', 관경: 350 },
          { id: 'p3', no: 3, 관리번호: '47130-2024-0003', 시설명: '예천 광역상수도', 관종: '주철관', 관경: 350 },
          { id: 'p4', no: 4, 관리번호: '47130-2024-0004', 시설명: '영양 광역상수도', 관종: 'PE관', 관경: 250 },
          { id: 'p5', no: 5, 관리번호: '47130-2024-0005', 시설명: '봉화 광역상수도', 관종: '강관', 관경: 500 },
          { id: 'p6', no: 6, 관리번호: '47130-2024-0006', 시설명: '청송 광역상수도', 관종: 'PE관', 관경: 250 },
        ],
      },
      {
        id: 'valve1',
        name: '제수변',
        count: 124,
        rows: [
          { id: 'v1', no: 1, 관리번호: '47130-V-0001', 시설명: '안동시 제수변 1', 관종: '버터플라이', 관경: 300 },
          { id: 'v2', no: 2, 관리번호: '47130-V-0002', 시설명: '안동시 제수변 2', 관종: '게이트', 관경: 200 },
          { id: 'v3', no: 3, 관리번호: '47130-V-0003', 시설명: '영주시 제수변 1', 관종: '버터플라이', 관경: 300 },
        ],
      },
      {
        id: 'valve2',
        name: '급수전',
        count: 98,
        rows: [
          { id: 's1', no: 1, 관리번호: '47130-S-0001', 시설명: '안동시 급수전 1', 관종: '볼밸브', 관경: 25 },
          { id: 's2', no: 2, 관리번호: '47130-S-0002', 시설명: '안동시 급수전 2', 관종: '볼밸브', 관경: 32 },
        ],
      },
      {
        id: 'hydrant',
        name: '소화전',
        count: 87,
        rows: [
          { id: 'h1', no: 1, 관리번호: '47130-H-0001', 시설명: '안동시 소화전 1', 관종: '지상식', 관경: 100 },
          { id: 'h2', no: 2, 관리번호: '47130-H-0002', 시설명: '안동시 소화전 2', 관종: '지하식', 관경: 100 },
        ],
      },
    ],
  },
  {
    id: 'gas',
    name: '가스',
    layers: [
      {
        id: 'gas-pipe',
        name: '가스관로',
        count: 234,
        rows: [
          { id: 'gp1', no: 1, 관리번호: '47130-G-0001', 시설명: '안동시 가스관 1', 관종: 'PE관', 관경: 100 },
        ],
      },
      {
        id: 'gas-valve',
        name: '가스밸브',
        count: 89,
        rows: [
          { id: 'gv1', no: 1, 관리번호: '47130-GV-0001', 시설명: '안동시 가스밸브 1', 관종: '볼밸브', 관경: 50 },
        ],
      },
    ],
  },
  {
    id: 'donation',
    name: '기부금 등',
    layers: [
      {
        id: 'don-facility',
        name: '기부시설',
        count: 56,
        rows: [
          { id: 'd1', no: 1, 관리번호: '47130-D-0001', 시설명: '안동시 기부시설 1', 관종: '-', 관경: 0 },
        ],
      },
    ],
  },
  {
    id: 'agriculture',
    name: '농업',
    layers: [
      {
        id: 'agri-irrigation',
        name: '농업용수관로',
        count: 312,
        rows: [
          { id: 'ag1', no: 1, 관리번호: '47130-AG-0001', 시설명: '안동시 농업용수관 1', 관종: 'PE관', 관경: 200 },
        ],
      },
    ],
  },
  {
    id: 'farmland',
    name: '개간농지대장',
    layers: [
      {
        id: 'farm-land',
        name: '개간농지',
        count: 178,
        rows: [
          { id: 'f1', no: 1, 관리번호: '47130-F-0001', 시설명: '안동시 개간농지 1', 관종: '-', 관경: 0 },
        ],
      },
    ],
  },
];

type SpatialSearchTool = 'rectangle' | 'circle' | 'polygon' | 'emdRi' | 'dataSelect';

const SPATIAL_TOOLS: { id: SpatialSearchTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원형' },
  { id: 'emdRi', icon: Landmark, label: '행정경계' },
  { id: 'dataSelect', icon: Database, label: '데이터 선택' },
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type DataQueryProps = {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
};

export default function DataQuery({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: DataQueryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLDivElement>(null);
  const openedKey = 'dataQuery';

  const handleResize = useCallback(
    (e: MouseEvent) => {
      const next = Math.min(maxWidth, Math.max(minWidth, e.clientX - SIDEBAR_WIDTH));
      onWidthChange(next);
    },
    [minWidth, maxWidth, onWidthChange]
  );

  const handleResizeEnd = useCallback(() => {
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', handleResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResize]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
    },
    [handleResize, handleResizeEnd]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [handleResize, handleResizeEnd]);

  const handleClose = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
    const filtered = opened.filter((w) => w !== openedKey);
    if (filtered.length > 0) {
      current.set('opened', filtered.join(','));
    } else {
      current.delete('opened');
    }
    router.push(`/map?${current.toString()}`);
  };

  const panelClassName =
    'h-full shrink-0 flex flex-col bg-white border-r border-slate-200 shadow-lg overflow-hidden relative';
  const resizeHandle = (
    <div
      role="separator"
      aria-label="패널 너비 조절"
      onMouseDown={handleResizeStart}
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize flex items-center justify-center z-10 group hover:bg-slate-100/80"
    >
      <span className="opacity-0 group-hover:opacity-100 text-slate-400 transition-opacity">
        <GripVertical className="w-4 h-4" />
      </span>
    </div>
  );

  return (
    <AttributeQueryUI
      panelRef={panelRef}
      width={width}
      panelClassName={panelClassName}
      resizeHandle={resizeHandle}
      handleClose={handleClose}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Attribute Query UI (default)                                      */
/* ------------------------------------------------------------------ */

function AttributeQueryUI({
  panelRef,
  width,
  panelClassName,
  resizeHandle,
  handleClose,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  panelClassName: string;
  resizeHandle: React.ReactNode;
  handleClose: () => void;
}) {
  const [activeTool, setActiveTool] = useState<SpatialSearchTool>('rectangle');
  const [emdSelected, setEmdSelected] = useState('');
  const [riSelected, setRiSelected] = useState('');
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [dataSelectTable, setDataSelectTable] = useState('');
  const [dataSelectField, setDataSelectField] = useState('');
  const [dataSelectValue, setDataSelectValue] = useState('');
  const [dataSelectTableOptions, setDataSelectTableOptions] = useState<string[]>([]);
  const [dataSelectFieldOptions, setDataSelectFieldOptions] = useState<string[]>([]);
  const [dataSelectValueOptions, setDataSelectValueOptions] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['water']);
  const [expandedLayers, setExpandedLayers] = useState<string[]>([]);
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null);

  useEffect(() => {
    if (activeTool !== 'emdRi') return;
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getEmdRiOptions', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
        setRiOptions([]);
        setRiSelected('');
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'emdRi' || !emdSelected) {
      setRiOptions([]);
      setRiSelected('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRiOptions(Array.isArray(data?.ri) ? data.ri : []);
        setRiSelected('');
      })
      .catch(() => {
        if (!cancelled) setRiOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTool, emdSelected]);

  useEffect(() => {
    if (activeTool !== 'dataSelect') return;
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getDataSelectTableList', params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectTableOptions(Array.isArray(data?.tables) ? data.tables : []);
        setDataSelectTable('');
        setDataSelectField('');
        setDataSelectValue('');
        setDataSelectFieldOptions([]);
        setDataSelectValueOptions([]);
      })
      .catch(() => {
        if (!cancelled) setDataSelectTableOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable) {
      setDataSelectFieldOptions([]);
      setDataSelectField('');
      setDataSelectValueOptions([]);
      setDataSelectValue('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getDataSelectFieldList',
      params: { table: dataSelectTable },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectFieldOptions(Array.isArray(data?.fields) ? data.fields : []);
        setDataSelectField('');
        setDataSelectValueOptions([]);
        setDataSelectValue('');
      })
      .catch(() => {
        if (!cancelled) setDataSelectFieldOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable]);

  useEffect(() => {
    if (activeTool !== 'dataSelect' || !dataSelectTable || !dataSelectField) {
      setDataSelectValueOptions([]);
      setDataSelectValue('');
      return;
    }
    let cancelled = false;
    call('', 'POST', {
      service: 'devTestService',
      action: 'getDataSelectValueList',
      params: { table: dataSelectTable, field: dataSelectField },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectValueOptions(Array.isArray(data?.values) ? data.values : []);
        setDataSelectValue('');
      })
      .catch(() => {
        if (!cancelled) setDataSelectValueOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeTool, dataSelectTable, dataSelectField]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleLayer = (layerId: string) => {
    setExpandedLayers((prev) =>
      prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]
    );
  };

  const getGroupCount = (group: LayerGroup) => group.layers.reduce((sum, l) => sum + l.count, 0);

  return (
    <div ref={panelRef} className={cn(panelClassName, 'opacity-[0.95]')} style={{ width: `${width}px` }}>
      {resizeHandle}

      {/* 공간검색 */}
      <div className="border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-bold text-primary">공간검색</h4>
          <span className="text-xs text-slate-500 text-right shrink-0">
            도형·행정경계·다른 테이블 속성으로 영역을 지정합니다.
          </span>
        </div>
        <div className="flex items-stretch w-full gap-2">
          {SPATIAL_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                className={cn(
                  'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border transition-colors bg-white',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                )}
                title={tool.label}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setActiveTool('rectangle')}
            className="flex flex-1 min-w-0 flex-col items-center justify-center gap-1 py-2 rounded border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-primary"
            title="초기화"
          >
            <RefreshCw className="h-5 w-5 shrink-0" strokeWidth={2} />
          </button>
        </div>
        {activeTool === 'emdRi' && (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">읍면동</label>
              <select
                value={emdSelected}
                onChange={(e) => setEmdSelected(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary"
              >
                <option value="">읍면동 선택</option>
                {emdOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">리</label>
              <select
                value={riSelected}
                onChange={(e) => setRiSelected(e.target.value)}
                disabled={!emdSelected}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">리 선택</option>
                {riOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {activeTool === 'dataSelect' && (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">테이블</label>
              <select
                value={dataSelectTable}
                onChange={(e) => setDataSelectTable(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary"
              >
                <option value="">테이블 선택</option>
                {dataSelectTableOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">필드</label>
              <select
                value={dataSelectField}
                onChange={(e) => setDataSelectField(e.target.value)}
                disabled={!dataSelectTable}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">필드 선택</option>
                {dataSelectFieldOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">값</label>
              <select
                value={dataSelectValue}
                onChange={(e) => setDataSelectValue(e.target.value)}
                disabled={!dataSelectField}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">값 선택</option>
                {dataSelectValueOptions.map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Layer groups (scrollable) */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {LAYER_GROUPS.map((group) => {
          const isGroupOpen = expandedGroups.includes(group.id);
          const groupCount = getGroupCount(group);

          return (
            <div key={group.id} className="border-b border-slate-200">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-slate-100',
                  isGroupOpen && 'bg-slate-100/80'
                )}
              >
                {isGroupOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span className="text-[14px] font-semibold text-slate-800">{group.name}</span>
                <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[12px] font-medium text-slate-600">
                  {groupCount.toLocaleString()}건
                </span>
              </button>

              {isGroupOpen && (
                <div className="bg-slate-50/80">
                  {group.layers.map((layer) => {
                    const isLayerOpen = expandedLayers.includes(layer.id);

                    return (
                      <div key={layer.id}>
                        <button
                          type="button"
                          onClick={() => toggleLayer(layer.id)}
                          className={cn(
                            'flex w-full items-center gap-1 py-1 pl-7 pr-2 text-left transition-colors hover:bg-slate-100',
                            isLayerOpen && 'bg-slate-100'
                          )}
                        >
                          {isLayerOpen ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-primary" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                          )}
                          <span
                            className={cn(
                              'text-[13px]',
                              isLayerOpen ? 'font-semibold text-primary' : 'font-medium text-slate-700'
                            )}
                          >
                            {layer.name}
                          </span>
                          <span
                            className={cn(
                              'ml-auto rounded-full px-1.5 py-px text-[12px] font-medium',
                              isLayerOpen ? 'bg-primary/10 text-primary' : 'text-slate-500'
                            )}
                          >
                            {layer.count.toLocaleString()}건
                          </span>
                        </button>

                        {isLayerOpen && layer.rows.length > 0 && (
                          <div className="bg-white">
                            <div className="flex items-center border-y border-slate-200 bg-slate-100/60 px-4 py-1.5 text-[12px] font-semibold text-slate-600">
                              <span className="w-8 shrink-0 text-center">No</span>
                              <span className="w-[130px] shrink-0 pl-2">관리번호</span>
                              <span className="flex-1 pl-2 min-w-0">시설명</span>
                              <span className="w-16 shrink-0 text-center">관종</span>
                              <span className="w-12 shrink-0 text-right">관경</span>
                            </div>

                            {layer.rows.map((row) => (
                              <button
                                key={row.id}
                                type="button"
                                onClick={() =>
                                  setHighlightedRow(highlightedRow === row.id ? null : row.id)
                                }
                                className={cn(
                                  'flex w-full items-center border-b border-slate-100 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-primary/5',
                                  highlightedRow === row.id && 'bg-primary/10'
                                )}
                              >
                                <span className="w-8 shrink-0 text-center text-slate-500">
                                  {row.no}
                                </span>
                                <span className="w-[130px] shrink-0 pl-2 text-[12px] text-slate-800">
                                  {row.관리번호}
                                </span>
                                <span className="flex-1 truncate pl-2 text-slate-800">{row.시설명}</span>
                                <span className="w-16 shrink-0 text-center text-[12px] text-slate-600">
                                  {row.관종}
                                </span>
                                <span className="w-12 shrink-0 text-right text-[12px]text-slate-600">
                                  {row.관경 || '-'}
                                </span>
                              </button>
                            ))}

                            {highlightedRow && layer.rows.some((r) => r.id === highlightedRow) && (
                              <div className="flex items-center justify-end border-b border-slate-100 px-4 py-1.5">
                                <button
                                  type="button"
                                  className="flex items-center gap-1 rounded bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                                >
                                  <MapPin className="h-3 w-3" />
                                  지도에서 보기
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
