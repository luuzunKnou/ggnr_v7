'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, ChevronUp, Copy, Download, Loader2, X } from 'lucide-react';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { isSuperUser } from '@/lib/auth/superUser';
import { cn, copyTextToClipboard } from '@/lib/utils';
import { useMapContext } from '../MapContext';
import { MapFloatingPanel } from '../MapFloatingPanel';
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_Z_INDEX,
} from '../complaint/complaintPanelLayout';
import {
  LAND_INFO_LIST_TD,
  LAND_INFO_LIST_TH,
  LAND_INFO_LIST_THEAD,
  LAND_INFO_TABLE_BTN,
  LAND_INFO_TABLE_TEXT,
  LAND_INFO_TABLE_WRAP,
} from './landInfoTableStyles';
import {
  downloadWimsExcel,
  loadWimsList,
  loadWimsParcel,
  loadWimsStat,
  WimsClientError,
} from './wimsClient';
import {
  WIMS_GOJIKIND,
  WIMS_JOCODE,
  WIMS_PAGE_SIZE,
  WIMS_SEARCH_KEYS,
  type WimsHistoryRow,
  type WimsListQuery,
  type WimsMeter,
  type WimsPair,
  type WimsStatRow,
} from '@/lib/wimsTypes';

const HIGHLIGHT_STYLE = new Style({
  stroke: new Stroke({ color: '#ff0000', width: 3 }),
  fill: new Fill({ color: 'rgba(255,0,0,0)' }),
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(255,0,0,0)' }),
    stroke: new Stroke({ color: '#ff0000', width: 3 }),
  }),
});

const LIST_COLUMNS: { key: keyof WimsHistoryRow; label: string; kind: 'code' | 'date' | 'number' | 'text' }[] = [
  { key: 'gojikind', label: '종류', kind: 'code' },
  { key: 'meterDay', label: '검침일', kind: 'date' },
  { key: 'nabgiDate', label: '납기마감일', kind: 'date' },
  { key: 'meterNo', label: '계량기번호', kind: 'text' },
  { key: 'useQty', label: '사용량', kind: 'number' },
  { key: 'freeQty', label: '사용료', kind: 'number' },
  { key: 'induty', label: '업종', kind: 'text' },
  { key: 'delYn', label: '상태', kind: 'text' },
];

const DETAIL_COLUMNS: {
  key: keyof WimsHistoryRow;
  label: string;
  kind: 'code' | 'date' | 'number' | 'text';
  title?: boolean;
}[] = [
  { key: 'gojikind', label: '종류', kind: 'code' },
  { key: 'meterDay', label: '검침일', kind: 'date', title: true },
  { key: 'nabgiDate', label: '납기마감일', kind: 'date' },
  { key: 'customerNo', label: '수용가번호', kind: 'text' },
  { key: 'meterNo', label: '계량기번호', kind: 'text', title: true },
  { key: 'suname', label: '성명', kind: 'text' },
  { key: 'areaCd', label: '구역', kind: 'text' },
  { key: 'admDong', label: '행정동', kind: 'text' },
  { key: 'lostnoAddr', label: '지번주소', kind: 'text' },
  { key: 'roadAddr', label: '도로명주소', kind: 'text' },
  { key: 'useQty', label: '사용량', kind: 'number' },
  { key: 'freeQty', label: '사용료', kind: 'number' },
  { key: 'induty', label: '업종', kind: 'text' },
  { key: 'diam', label: '구경', kind: 'number' },
  { key: 'delYn', label: '상태', kind: 'text' },
];

/** AddressInfoDetail 패널 max-w-[520px]과 동일 — 플로팅 상세를 그 왼쪽에 붙임 */
const LAND_INFO_PANEL_MAX_WIDTH_PX = 520;
const WIMS_DETAIL_FLOAT_GAP_PX = 8;
const WIMS_DETAIL_FLOAT_WIDTH = '420px';
const WIMS_DETAIL_FLOAT_MAX_HEIGHT = '70vh';

/** 마운트 시 하단 근처 — MapFloatingPanel이 실측 높이로 clamp */
function wimsDetailMountTop(): number {
  if (typeof window === 'undefined') return COMPLAINT_DETAIL_PANEL_DEFAULT_TOP;
  return window.innerHeight;
}

const fieldClass =
  'h-7 min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground';

function trimId(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function dash(value: string): string {
  return value.trim() ? value : '-';
}

function formatYmd(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return raw.trim();
}

function formatNumber(raw: string): string {
  if (!raw.trim()) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : raw;
}

function formatAvg(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return (Math.round(value * 100) / 100).toLocaleString('ko-KR');
}

function formatCell(kind: 'code' | 'date' | 'number' | 'text', raw: string): string {
  if (kind === 'code') return WIMS_GOJIKIND[raw] ?? raw;
  if (kind === 'date') return formatYmd(raw);
  if (kind === 'number') return formatNumber(raw);
  return raw;
}

function normalizeKeyword(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  for (const map of [WIMS_GOJIKIND, WIMS_JOCODE]) {
    for (const [code, label] of Object.entries(map)) {
      if (text === label) return code;
    }
  }
  if (/^\d{4}-\d{0,2}-?\d{0,2}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text.replace(/-/g, '');
  }
  return text;
}

function toYmd(dateValue: string): string {
  return dateValue.replace(/\D/g, '').slice(0, 8);
}

function pairsOf(meters: WimsMeter[]): WimsPair[] {
  const seen = new Set<string>();
  const pairs: WimsPair[] = [];
  for (const meter of meters) {
    const customerNo = trimId(meter.homNum);
    const meterNo = trimId(meter.metNum);
    if (!customerNo || !meterNo) continue;
    const key = `${customerNo}\0${meterNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ customerNo, meterNo });
  }
  return pairs;
}

function canCopyValue(value: string): boolean {
  const text = value.trim();
  return Boolean(text) && text !== '-';
}

function ValueCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!canCopyValue(text)) return;
    const ok = await copyTextToClipboard(text.trim());
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  const disabled = !canCopyValue(text);
  const label = copied ? '복사됨' : '복사';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleCopy();
      }}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? <Check className="h-3 w-3 text-primary" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  );
}

export function WimsInfoPanel({
  pnu,
  connected = true,
}: {
  pnu: string;
  /** status 조회 결과. false 이면 Oracle 접속 불가 */
  connected?: boolean | null;
}) {
  const { data: session } = useSession();
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const listReq = useRef(0);
  const showDbHint = isSuperUser(session?.user?.id);

  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [statLoading, setStatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(connected === false);
  const [meters, setMeters] = useState<WimsMeter[]>([]);
  const [statList, setStatList] = useState<WimsStatRow[]>([]);
  const [rows, setRows] = useState<WimsHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statStart, setStatStart] = useState('');
  const [statEnd, setStatEnd] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [customerNo, setCustomerNo] = useState('');
  const [meterNo, setMeterNo] = useState('');
  const [gojikind, setGojikind] = useState('');
  const [jocode, setJocode] = useState('');
  const [selectedStat, setSelectedStat] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<WimsHistoryRow | null>(null);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [highlightGeom, setHighlightGeom] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    meters.forEach((meter) => {
      const hom = trimId(meter.homNum);
      if (hom) set.add(hom);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [meters]);

  const meterOptions = useMemo(() => {
    const cust = trimId(customerNo);
    const list = meters
      .filter((meter) => !cust || trimId(meter.homNum) === cust)
      .map((meter) => trimId(meter.metNum))
      .filter(Boolean);
    return [...new Set(list)].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [meters, customerNo]);

  const totalPages = Math.max(1, Math.ceil(total / WIMS_PAGE_SIZE));

  useEffect(() => {
    const map = mapContext?.mapInstanceRef.current;
    if (!map) return;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: HIGHLIGHT_STYLE, zIndex: 940 });
    layer.set('wimsMeterHighlight', true);
    map.addLayer(layer);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef.current;
    const source = layerRef.current?.getSource();
    if (!map || !source) return;
    source.clear();
    if (!highlightGeom) return;
    try {
      const geometry = new GeoJSON().readGeometry(highlightGeom, {
        dataProjection: 'EPSG:3857',
        featureProjection: 'EPSG:3857',
      });
      source.addFeature(new Feature({ geometry }));
      const extent = source.getExtent();
      if (extent.every((n) => Number.isFinite(n))) {
        map.getView().fit(extent, { maxZoom: 19, duration: 250, padding: [48, 48, 48, 48] });
      }
    } catch {
      source.clear();
    }
  }, [highlightGeom, mapContext?.mapInstanceRef]);

  useEffect(() => {
    setUnreachable(connected === false);
  }, [connected]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSelectedStat(null);
    setSelectedRow(null);
    setDetailCollapsed(false);
    setHighlightGeom(null);
    setSearchInput('');
    setKeyword('');
    setCustomerNo('');
    setMeterNo('');
    setGojikind('');
    setJocode('');
    setStatStart('');
    setStatEnd('');

    if (connected === false) {
      setUnreachable(true);
      setMeters([]);
      setStatList([]);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    loadWimsParcel(pnu)
      .then((data) => {
        if (!alive) return;
        setUnreachable(false);
        setMeters(data.meters);
        setStatList(data.statList);
        setRows(data.dataList);
        setTotal(data.totalCount);
        setPage(1);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setMeters([]);
        setStatList([]);
        setRows([]);
        setTotal(0);
        if (err instanceof WimsClientError && err.code === 'db_unreachable') {
          setUnreachable(true);
          setError(null);
        } else {
          setUnreachable(false);
          setError(err instanceof Error ? err.message : '수용가 정보를 조회하지 못했습니다.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu, connected]);

  const applyList = async (nextPage: number, query: WimsListQuery) => {
    const id = ++listReq.current;
    setListLoading(true);
    setError(null);
    try {
      const data = await loadWimsList({ ...query, page: nextPage, pageSize: WIMS_PAGE_SIZE, searchKeys: [...WIMS_SEARCH_KEYS] });
      if (id !== listReq.current) return;
      setRows(data.dataList);
      setTotal(data.totalCount);
      setPage(nextPage);
      setSelectedRow(null);
    } catch (err: unknown) {
      if (id !== listReq.current) return;
      if (err instanceof WimsClientError && err.code === 'db_unreachable') {
        setUnreachable(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : '수용가 정보를 조회하지 못했습니다.');
      }
    } finally {
      if (id === listReq.current) setListLoading(false);
    }
  };

  const idQuery = (nextCustomer: string, nextMeter: string, source: WimsMeter[]): WimsListQuery => {
    if (nextCustomer && nextMeter) return { customerNo: nextCustomer, meterNo: nextMeter };
    if (nextMeter) return { meterNo: nextMeter };
    if (nextCustomer) return { customerNo: nextCustomer };
    return { pairs: pairsOf(source) };
  };

  const listQuery = (next: {
    customerNo?: string;
    meterNo?: string;
    gojikind?: string;
    jocode?: string;
    keyword?: string;
    meters?: WimsMeter[];
  }): WimsListQuery => {
    const cust = next.customerNo ?? customerNo;
    const met = next.meterNo ?? meterNo;
    const kind = next.gojikind ?? gojikind;
    const code = next.jocode ?? jocode;
    const word = next.keyword ?? keyword;
    return {
      ...idQuery(cust, met, next.meters ?? meters),
      ...(kind ? { gojikind: kind } : {}),
      ...(code ? { jocode: code } : {}),
      ...(word ? { searchKeyword: word } : {}),
    };
  };

  const showMeter = (cust: string, met: string) => {
    const found = meters.find(
      (meter) => trimId(meter.homNum) === trimId(cust) && trimId(meter.metNum) === trimId(met)
    );
    setHighlightGeom(found?.geom ?? null);
  };

  const onStatRow = (row: WimsStatRow, index: number) => {
    if (selectedStat === index) {
      setSelectedStat(null);
      setCustomerNo('');
      setMeterNo('');
      setGojikind('');
      setJocode('');
      setHighlightGeom(null);
      void applyList(1, listQuery({ customerNo: '', meterNo: '', gojikind: '', jocode: '', meters }));
      return;
    }
    const cust = trimId(row.customerNo);
    const met = trimId(row.meterNo);
    setSelectedStat(index);
    setCustomerNo(cust);
    setMeterNo(met);
    setGojikind('');
    setJocode('');
    showMeter(cust, met);
    void applyList(1, listQuery({ customerNo: cust, meterNo: met, gojikind: '', jocode: '' }));
  };

  const onCustomer = (value: string) => {
    setSelectedStat(null);
    setHighlightGeom(null);
    if (!value) {
      setCustomerNo('');
      setMeterNo('');
      void applyList(1, listQuery({ customerNo: '', meterNo: '' }));
      return;
    }
    const metersFor = meters
      .filter((meter) => trimId(meter.homNum) === value)
      .map((meter) => trimId(meter.metNum))
      .filter(Boolean);
    const unique = [...new Set(metersFor)];
    const nextMeter = unique.length === 1 ? unique[0] : unique.includes(meterNo) ? meterNo : '';
    setCustomerNo(value);
    setMeterNo(nextMeter);
    void applyList(1, listQuery({ customerNo: value, meterNo: nextMeter }));
  };

  const onMeter = (value: string) => {
    setSelectedStat(null);
    setHighlightGeom(null);
    setMeterNo(value);
    void applyList(1, listQuery({ meterNo: value }));
  };

  const onSearchStat = async () => {
    const base = idQuery(customerNo, meterNo, meters);
    if (!('pairs' in base) && !base.customerNo && !base.meterNo) {
      setStatList([]);
      return;
    }
    if ('pairs' in base && !base.pairs?.length) {
      setStatList([]);
      return;
    }
    setStatLoading(true);
    setError(null);
    try {
      const list = await loadWimsStat({
        ...base,
        startYmd: toYmd(statStart),
        endYmd: toYmd(statEnd),
      });
      setStatList(list);
      setSelectedStat(null);
    } catch (err: unknown) {
      if (err instanceof WimsClientError && err.code === 'db_unreachable') {
        setUnreachable(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : '수용가 정보를 조회하지 못했습니다.');
      }
    } finally {
      setStatLoading(false);
    }
  };

  const onExcel = async () => {
    setExcelBusy(true);
    try {
      await downloadWimsExcel(listQuery({}));
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : '엑셀을 받지 못했습니다.');
    } finally {
      setExcelBusy(false);
    }
  };

  const resolveStatName = (row: WimsStatRow) => {
    if (trimId(row.suname)) return row.suname;
    const meter = meters.find(
      (item) => trimId(item.metNum) === trimId(row.meterNo) && (!trimId(row.customerNo) || trimId(item.homNum) === trimId(row.customerNo))
    );
    return trimId(meter?.homNam);
  };

  const resolveStatAddress = (row: WimsStatRow) => {
    if (trimId(row.roadAddr)) return row.roadAddr;
    const meter = meters.find(
      (item) => trimId(item.metNum) === trimId(row.meterNo) && (!trimId(row.customerNo) || trimId(item.homNum) === trimId(row.customerNo))
    );
    return trimId(meter?.homAdr);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        조회 중...
      </div>
    );
  }

  if (unreachable) {
    return (
      <div
        className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-background p-4 text-center ${LAND_INFO_TABLE_TEXT}`}
      >
        <p className="text-[12px] font-medium text-destructive">서비스 제공에 문제가 있습니다.</p>
        {showDbHint ? (
          <p className="text-[11px] text-muted-foreground">DB 접속이 되지 않습니다.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col bg-background ${LAND_INFO_TABLE_TEXT}`}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-2">
        {error ? <p className="shrink-0 text-[11px] text-destructive">{error}</p> : null}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-1">
            <p className="font-medium text-foreground">필지 내 기간별 통계</p>
            <div className="flex flex-wrap items-center gap-1">
              <label className="flex items-center gap-1 text-muted-foreground">
                기간
                <input
                  type="date"
                  value={statStart}
                  onChange={(e) => setStatStart(e.target.value)}
                  title="시작일"
                  className={fieldClass}
                />
                <span>~</span>
                <input
                  type="date"
                  value={statEnd}
                  onChange={(e) => setStatEnd(e.target.value)}
                  title="종료일"
                  className={fieldClass}
                />
              </label>
              <button type="button" title="조회" className={`${LAND_INFO_TABLE_BTN} cursor-pointer`} onClick={() => void onSearchStat()}>
                조회
              </button>
            </div>
          </div>
          <div className={cn(LAND_INFO_TABLE_WRAP, 'min-h-0 flex-1 overflow-auto')}>
            <table className="min-w-[640px] w-full border-collapse">
              <thead className={LAND_INFO_LIST_THEAD}>
                <tr>
                  {['수용가 번호', '계량기 번호', '성명', '주소', '평균 사용량', '평균 사용료', '상태'].map((label) => (
                    <th key={label} className={LAND_INFO_LIST_TH} title={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statLoading ? (
                  <tr>
                    <td colSpan={7} className={`${LAND_INFO_LIST_TD} text-center text-muted-foreground`}>
                      조회 중...
                    </td>
                  </tr>
                ) : statList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`${LAND_INFO_LIST_TD} text-center text-muted-foreground`}>
                      조회된 통계가 없습니다.
                    </td>
                  </tr>
                ) : (
                  statList.map((row, index) => {
                    const name = dash(resolveStatName(row));
                    const address = dash(resolveStatAddress(row));
                    const customer = dash(row.customerNo);
                    const meter = dash(row.meterNo);
                    const use = formatAvg(row.avgUseQty);
                    const fee = formatAvg(row.avgFreeQty);
                    const state = dash(row.delYn);
                    return (
                      <tr
                        key={`${row.customerNo}_${row.meterNo}_${index}`}
                        className={`cursor-pointer ${selectedStat === index ? 'bg-primary/10' : ''}`}
                        onClick={() => onStatRow(row, index)}
                      >
                        {[customer, meter, name, address, use, fee, state].map((cell, cellIndex) => (
                          <td key={cellIndex} className={LAND_INFO_LIST_TD} title={cell}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex min-h-0 flex-[2] flex-col overflow-hidden">
          <p className="mb-1 shrink-0 font-medium text-foreground">WIMS 검침이력</p>
          <div className="mb-1 flex w-full shrink-0 items-center gap-1">
            <label className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="shrink-0">수용가 번호</span>
              <select
                value={customerNo}
                onChange={(e) => onCustomer(e.target.value)}
                title="수용가 번호"
                className={`${fieldClass} w-[4.5rem]`}
              >
                <option value="">선택</option>
                {customerOptions.map((hom) => (
                  <option key={hom} value={hom}>
                    {hom}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="shrink-0">계량기 번호</span>
              <select
                value={meterNo}
                onChange={(e) => onMeter(e.target.value)}
                title="계량기 번호"
                className={`${fieldClass} w-[4.5rem]`}
              >
                <option value="">선택</option>
                {meterOptions.map((met) => (
                  <option key={met} value={met}>
                    {met}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="shrink-0">종류</span>
              <select
                value={gojikind}
                title="종류"
                className={`${fieldClass} w-[4rem]`}
                onChange={(e) => {
                  const value = e.target.value;
                  setGojikind(value);
                  void applyList(1, listQuery({ gojikind: value }));
                }}
              >
                <option value="">선택</option>
                {Object.entries(WIMS_GOJIKIND).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="shrink-0">상태</span>
              <select
                value={jocode}
                title="상태"
                className={`${fieldClass} w-[4rem]`}
                onChange={(e) => {
                  const value = e.target.value;
                  setJocode(value);
                  void applyList(1, listQuery({ jocode: value }));
                }}
              >
                <option value="">선택</option>
                {Object.entries(WIMS_JOCODE).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-1 flex w-full shrink-0 items-center gap-1">
            <label className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
              <span className="shrink-0">통합검색</span>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const next = normalizeKeyword(searchInput);
                  setKeyword(next);
                  void applyList(1, listQuery({ keyword: next }));
                }}
                title="통합검색"
                className={`${fieldClass} min-w-0 flex-1`}
              />
            </label>
            <button
              type="button"
              title="검색"
              className={`${LAND_INFO_TABLE_BTN} shrink-0 cursor-pointer`}
              onClick={() => {
                const next = normalizeKeyword(searchInput);
                setKeyword(next);
                void applyList(1, listQuery({ keyword: next }));
              }}
            >
              검색
            </button>
            <button
              type="button"
              title="초기화"
              className={`${LAND_INFO_TABLE_BTN} shrink-0 cursor-pointer`}
              onClick={() => {
                setSearchInput('');
                setKeyword('');
                setGojikind('');
                setJocode('');
                setCustomerNo('');
                setMeterNo('');
                setSelectedStat(null);
                setHighlightGeom(null);
                void applyList(1, listQuery({ keyword: '', gojikind: '', jocode: '', customerNo: '', meterNo: '' }));
              }}
            >
              초기화
            </button>
            <button
              type="button"
              title="엑셀 다운로드"
              className={`${LAND_INFO_TABLE_BTN} inline-flex shrink-0 cursor-pointer items-center gap-1 disabled:opacity-50`}
              disabled={excelBusy}
              onClick={() => void onExcel()}
            >
              <Download className="h-3 w-3 shrink-0" aria-hidden />
              엑셀 다운로드
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="standard-list-table min-w-[720px]">
                <thead className="standard-table-thead">
                  <tr>
                    {LIST_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="standard-table-th standard-table-th-left"
                        title={col.label}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={LIST_COLUMNS.length} className="standard-table-loading-cell">
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                          조회 중...
                        </span>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={LIST_COLUMNS.length} className="standard-table-empty">
                        데이터가 없습니다
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, index) => {
                      const selected =
                        selectedRow != null &&
                        selectedRow.meterNo === row.meterNo &&
                        selectedRow.meterDay === row.meterDay &&
                        selectedRow.customerNo === row.customerNo &&
                        selectedRow.gojikind === row.gojikind &&
                        selectedRow.useQty === row.useQty &&
                        selectedRow.freeQty === row.freeQty;
                      return (
                        <tr
                          key={`${row.meterNo}_${row.meterDay}_${index}`}
                          className={cn(
                            'standard-list-row',
                            selected && 'standard-list-row-selected'
                          )}
                          onClick={() => setSelectedRow(row)}
                        >
                          {LIST_COLUMNS.map((col) => {
                            const text = dash(formatCell(col.kind, row[col.key]));
                            return (
                              <td key={col.key} className="standard-table-td-compact" title={text}>
                                {text}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
              <span className="text-[11px] text-muted-foreground">
                {total === 0
                  ? '0건'
                  : `${(page - 1) * WIMS_PAGE_SIZE + 1}–${Math.min(page * WIMS_PAGE_SIZE, total)} / ${total.toLocaleString()}건`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="이전"
                  disabled={page <= 1 || listLoading}
                  className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void applyList(page - 1, listQuery({}))}
                >
                  이전
                </button>
                <span className="px-1.5 text-[11px] text-muted-foreground">{page}페이지</span>
                <button
                  type="button"
                  title="다음"
                  disabled={page >= totalPages || listLoading}
                  className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void applyList(page + 1, listQuery({}))}
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedRow ? (
        <MapFloatingPanel
          viewport
          width={WIMS_DETAIL_FLOAT_WIDTH}
          maxHeight={WIMS_DETAIL_FLOAT_MAX_HEIGHT}
          className="bg-background backdrop-blur-none"
          style={{ zIndex: COMPLAINT_DETAIL_PANEL_Z_INDEX + 2 }}
          defaultPosition={{
            top: wimsDetailMountTop(),
            right: LAND_INFO_PANEL_MAX_WIDTH_PX + WIMS_DETAIL_FLOAT_GAP_PX,
          }}
          header={
            <>
              <button
                type="button"
                title={detailCollapsed ? '펼치기' : '접기'}
                aria-label={detailCollapsed ? '펼치기' : '접기'}
                aria-expanded={!detailCollapsed}
                onClick={() => setDetailCollapsed((v) => !v)}
                className="standard-panel-close mr-2 cursor-pointer"
              >
                <ChevronUp
                  className={cn('h-4 w-4', detailCollapsed && 'rotate-180')}
                  aria-hidden
                />
              </button>
              <div className="min-w-0 flex-1 pr-2">
                <span
                  className="block truncate text-xs font-medium text-foreground"
                  title="WIMS 검침이력 상세"
                >
                  WIMS 검침이력 상세
                </span>
                {trimId(selectedRow.meterDay) || trimId(selectedRow.meterNo) ? (
                  <span
                    className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                    title={`${dash(formatYmd(selectedRow.meterDay))} / ${dash(selectedRow.meterNo)}`}
                  >
                    {dash(formatYmd(selectedRow.meterDay))} / {dash(selectedRow.meterNo)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                title="닫기"
                onClick={() => setSelectedRow(null)}
                className="standard-panel-close cursor-pointer"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          }
        >
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden bg-background',
              detailCollapsed && 'hidden'
            )}
          >
            <div className="standard-detail-scroll">
              <div className="standard-detail-attr-table">
                {DETAIL_COLUMNS.map((col) => {
                  const text = dash(formatCell(col.kind, selectedRow[col.key]));
                  return (
                    <div key={col.key} className="contents">
                      <div className="standard-detail-attr-label standard-detail-attr-cell-border">
                        {col.label}
                      </div>
                      <div
                        className={cn(
                          'standard-detail-attr-value standard-detail-attr-cell-border',
                          col.title
                            ? 'standard-detail-attr-value-title flex items-center justify-between gap-2'
                            : 'text-foreground'
                        )}
                        title={text}
                      >
                        <span className="min-w-0 break-all">{text}</span>
                        {col.title ? <ValueCopyButton text={text} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="standard-detail-edit-footer">
              <button
                type="button"
                title="닫기"
                onClick={() => setSelectedRow(null)}
                className="standard-detail-hdr-btn"
              >
                닫기
              </button>
            </div>
          </div>
        </MapFloatingPanel>
      ) : null}
    </div>
  );
}
