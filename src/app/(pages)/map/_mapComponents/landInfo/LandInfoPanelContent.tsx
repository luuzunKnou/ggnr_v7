'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { COORDINATE_SYSTEM_OPTIONS, type AddressInfoPanelProps } from './shared';
import { transformCoordinate } from '../services/coordinateService';
import {
  fetchBuildingRegisterDetail,
  fetchLandInfoConfig,
  fetchParcelIdentityAtPoint,
  fetchParcelLandModalList,
  fetchParcelTabData,
  fetchPermitRows,
  type BuildingLedgerRow,
  type BuildingPermitSource,
  type BuildingRegisterMode,
  type BuildingRegisterRow,
  type ParcelLandModalKind,
  type ParcelTabData,
} from './api';
import { BuildingPermitPanel, BuildingRegisterPanel } from './LandInfoBuildingPanels';
import {
  BuildingDataSourceLine,
  LandLinkageLegendText,
  ParcelLandLinkageSourceText,
  ParcelLinkageValueText,
} from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
// 2026-07-21 이수빈: 빌드 오류로 임시 처리
import type { ParcelLandRowSource } from '@/lib/parcelLandNormalize';
import { withBasePath } from '@/lib/basePath';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { cn } from '@/lib/utils';
import { findRoadAddressByJibun, getAddressFromCoord } from '../addressSearch/vworldAddressSearch';

/** 주소 문자열로 외부 지도 검색 */
function openExternalMapByAddress(
  provider: 'naver' | 'kakao' | 'google',
  address: string
) {
  const q = String(address ?? '').trim();
  if (!q || q === '-') {
    window.alert('검색할 주소가 없습니다.');
    return;
  }
  const enc = encodeURIComponent(q);
  const urls = {
    naver: `https://map.naver.com/p/search/${enc}`,
    kakao: `https://map.kakao.com/?q=${enc}`,
    google: `https://www.google.com/maps/search/?api=1&query=${enc}`,
  } as const;
  window.open(urls[provider], '_blank', 'noopener,noreferrer');
}

type TabId = 'parcel' | 'buildingLedger' | 'buildingPermit';
type ModalKind = ParcelLandModalKind | null;

const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: 'parcel', label: '필지정보' },
  { id: 'buildingLedger', label: '건축물대장' },
  { id: 'buildingPermit', label: '건축인허가' },
];

const PRICE_MODAL_HEADERS = ['공시지가', '공시일자', '기준년도', '기준월', '지번', '비고'] as const;

const MODAL_TITLES: Record<Exclude<ModalKind, null>, string> = {
  price: '공시지가 조회',
  move: '이동일자 연혁조회',
  share: '공유인 조회',
  change: '변동일자 연혁조회',
};

/** V6 통합제어 personInfo=true 와 동일 — 소유자 개인정보 길이만큼 * 마스킹 */
function maskPersonField(value: unknown): string {
  if (value == null) return '***';
  const str = String(value).trim();
  if (!str || str === '-') return str || '-';
  return '*'.repeat(Math.max(str.length, 3));
}

function maskModalRows(kind: ParcelLandModalKind, rows: string[][]): string[][] {
  if (kind === 'share') {
    return rows.map((row) =>
      row.map((cell, i) => (i === 0 || i === 1 || i === 2 ? maskPersonField(cell) : cell))
    );
  }
  if (kind === 'change') {
    return rows.map((row) =>
      row.map((cell, i) => (i === 1 || i === 3 ? maskPersonField(cell) : cell))
    );
  }
  return rows;
}

function toNumText(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('ko-KR');
}

function toText(value: unknown): string {
  if (value == null) return '-';
  const t = String(value).trim();
  return t || '-';
}

function getField(row: Record<string, unknown> | undefined, keys: string[], fallback = '-'): string {
  if (!row) return fallback;
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return fallback;
}

/** 법정동 전체 주소 여부 (시·도 + 읍·면·동·리) */
function isLikelyFullParcelAddress(value: string): boolean {
  const t = value.trim();
  if (t.length < 8) return false;
  return /(도|특별|광역|자치)/u.test(t) && /(읍|면|동|리)/u.test(t);
}

/** 브이월드·탭 행 → 「법정동명 + 본번-부번」 전체 지번 */
function composeFullJibunFromRow(row: Record<string, unknown> | undefined): string {
  if (!row) return '';
  const ld = String(row.ldCodeNm ?? '').trim();
  const lot = String(row.mnnmSlno ?? '').trim();
  if (ld && lot) return `${ld} ${lot}`;
  if (ld) return ld;
  const jibun = String(row.jibun ?? '').trim();
  return isLikelyFullParcelAddress(jibun) ? jibun : '';
}

function pickDisplayJibunAddress(args: {
  parcelData: ParcelTabData;
  propJibun: string | null | undefined;
  resolvedJibun: string | null;
}): string {
  const fromTab =
    composeFullJibunFromRow(args.parcelData.characteristics[0]) ||
    composeFullJibunFromRow(args.parcelData.possessions[0]) ||
    composeFullJibunFromRow(args.parcelData.prices[0]) ||
    composeFullJibunFromRow(args.parcelData.landUses[0]);
  const raw = (() => {
    if (fromTab) return fromTab;
    const prop = String(args.propJibun ?? '').trim();
    const resolved = String(args.resolvedJibun ?? '').trim();
    if (isLikelyFullParcelAddress(prop)) return prop;
    if (isLikelyFullParcelAddress(resolved)) return resolved;
    if (prop.length >= resolved.length && prop) return prop;
    return resolved || prop || '';
  })();
  if (!raw) return '-';
  // 시·도·시·군·구 제거 → 읍·면·동·리·번지
  return formatAddressStripSidoSigungu(raw) || raw;
}

const EUM_LAND_DET_URL = 'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp';
const EUM_FORM_ID = 'ggnr-eum-land-det-form';
const EUM_WINDOW_NAME = 'Eum';

/** v6 RightClickTooltip.openEumm — 숨김 폼 POST로 pnu·sggcd 전달 */
function openLandEum(pnu: string) {
  const trimmed = String(pnu ?? '').trim();
  if (!/^\d{19}$/.test(trimmed)) return;

  const sggcd = trimmed.slice(0, 5);
  const popup = window.open('', EUM_WINDOW_NAME, 'width=1400,height=970');
  if (popup) {
    popup.document.write(
      '<html><head><title>토지이음</title></head><body><p>페이지 이동 중입니다…</p></body></html>'
    );
  }

  let form = document.getElementById(EUM_FORM_ID) as HTMLFormElement | null;
  if (!form) {
    form = document.createElement('form');
    form.id = EUM_FORM_ID;
    form.method = 'post';
    form.action = EUM_LAND_DET_URL;
    form.style.display = 'none';

    const fixed: Record<string, string> = {
      selGbn: 'umd',
      isNoScr: 'script',
      s_type: '1',
      mode: 'search',
      viewType: '',
      p_location: '',
      p_type: '',
      p_type1: '',
      p_type2: '',
      p_type3: '',
      p_type4: '',
      p_type5: '',
      p_type6: '',
      p_type7: '',
      ucodes: '',
      markUcodes: '',
      adzoom: '',
      scale: '',
      scaleFlag: '',
      hash: '',
      mobile_yn: '',
      sggcd: '',
      pnu: '',
    };
    for (const [name, value] of Object.entries(fixed)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.id = `${EUM_FORM_ID}-${name}`;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
  }

  const pnuEl = form.querySelector(`#${EUM_FORM_ID}-pnu`) as HTMLInputElement | null;
  const sggcdEl = form.querySelector(`#${EUM_FORM_ID}-sggcd`) as HTMLInputElement | null;
  if (pnuEl) pnuEl.value = trimmed;
  if (sggcdEl) sggcdEl.value = sggcd;

  form.target = EUM_WINDOW_NAME;
  form.submit();
}

function DataTable({
  headers,
  rows,
  linkageSource,
  linkageSources,
  linkageCol,
  plainColumnIndexes,
  nowrap = false,
}: {
  headers: string[];
  rows: string[][];
  linkageSource?: ParcelLandRowSource;
  linkageSources?: Array<ParcelLandRowSource | undefined>;
  /** true면 마지막 열을 «연계» 출처 텍스트로 렌더 */
  linkageCol?: boolean;
  /** 연계 색 미적용 열(0부터, 예: 대지위치·지번·도로명) */
  plainColumnIndexes?: number[];
  /** true면 헤더·셀 줄바꿈 없음 (공시지가 모달 등) */
  nowrap?: boolean;
}) {
  const plainSet = new Set(plainColumnIndexes ?? []);
  const dataColCount = linkageCol ? headers.length - 1 : headers.length;
  const wrapClass = nowrap ? 'whitespace-nowrap' : 'whitespace-normal break-words';
  return (
    <div className="overflow-auto rounded border border-border">
      <table className="w-full table-auto text-[12px]">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className={cn(
                  'border-b border-r border-border px-2.5 py-1.5 text-left align-middle font-medium text-foreground last:border-r-0',
                  wrapClass
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const rowSource = linkageSources?.[idx] ?? linkageSource;
            const dataCells = linkageCol ? row.slice(0, dataColCount) : row;
            return (
              <tr key={`${idx}-${row.join('|')}`} className="odd:bg-background even:bg-muted/40">
                {dataCells.map((cell, cidx) => (
                  <td
                    key={`${idx}-${cidx}`}
                    className={cn(
                      'border-b border-r border-border px-2.5 py-1.5 align-middle text-foreground last:border-r-0',
                      wrapClass
                    )}
                  >
                    <ParcelLinkageValueText
                      value={cell}
                      source={plainSet.has(cidx) ? undefined : rowSource}
                    />
                  </td>
                ))}
                {linkageCol ? (
                  <td
                    className={cn(
                      'border-b border-border px-2.5 py-1.5 align-middle text-foreground',
                      wrapClass
                    )}
                  >
                    <ParcelLandLinkageSourceText source={rowSource} prefix={false} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LandInfoPanelContent({
  coordinate,
  viewProjection,
  jibun,
  road,
  buildingName,
  loading,
  pnu: pnuFromContext,
}: AddressInfoPanelProps & { pnu?: string | null }) {
  const [selectedCrs, setSelectedCrs] = useState('EPSG:5181');
  const [activeTab, setActiveTab] = useState<TabId>('parcel');
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [modalFetching, setModalFetching] = useState(false);
  const [modalHeaders, setModalHeaders] = useState<string[]>([]);
  const [modalRows, setModalRows] = useState<string[][]>([]);
  const [modalMessage, setModalMessage] = useState<string | null>(null);

  const [resolvedPnu, setResolvedPnu] = useState<string | null>(pnuFromContext ?? null);
  const [resolvedParcelJibun, setResolvedParcelJibun] = useState<string | null>(null);
  /** 건축물대장 재조회 트리거에서 제외 — 표시용 힌트만 (PNU로 조회) */
  const resolvedParcelJibunRef = useRef<string | null>(null);
  const jibunPropRef = useRef(jibun);
  resolvedParcelJibunRef.current = resolvedParcelJibun;
  jibunPropRef.current = jibun;
  /** 우클릭 prop 도로명이 비었을 때 패널이 키로 재조회한 값 */
  const [resolvedRoad, setResolvedRoad] = useState<string | null>(null);
  const [vworldKey, setVworldKey] = useState('');
  const [dataPortalKey, setDataPortalKey] = useState('');

  const [parcelError, setParcelError] = useState<string | null>(null);
  const [parcelFetching, setParcelFetching] = useState(false);
  const [parcelData, setParcelData] = useState<ParcelTabData>({
    characteristics: [],
    landUses: [],
    prices: [],
    possessions: [],
  });

  const [buildingRegisterSource, setBuildingRegisterSource] = useState<'seum' | 'portal' | null>(
    null
  );
  const [buildingRegisterMode, setBuildingRegisterMode] = useState<BuildingRegisterMode>(null);
  const [buildingRegisterBuildings, setBuildingRegisterBuildings] = useState<BuildingRegisterRow[]>(
    []
  );
  const [buildingRegisterChildren, setBuildingRegisterChildren] = useState<BuildingRegisterRow[]>(
    []
  );
  const [buildingLedgerNotice, setBuildingLedgerNotice] = useState<string | null>(null);
  /** true only while 요청 진행 중 — 빈 결과([])와 구분 */
  const [buildingLedgerFetching, setBuildingLedgerFetching] = useState(false);
  const [buildingRegisterReloadKey, setBuildingRegisterReloadKey] = useState(0);

  const [permitRows, setPermitRows] = useState<BuildingLedgerRow[]>([]);
  const [permitSource, setPermitSource] = useState<BuildingPermitSource>(null);
  const [permitNotice, setPermitNotice] = useState<string | null>(null);
  const [permitFetching, setPermitFetching] = useState(false);
  const effectivePnu = pnuFromContext ?? resolvedPnu;

  const xy = useMemo(() => {
    const transformed = transformCoordinate(coordinate, viewProjection, selectedCrs);
    if (!transformed) return null;
    return { x: transformed[0], y: transformed[1] };
  }, [coordinate, viewProjection, selectedCrs]);
  const wgs84 = useMemo(
    () => transformCoordinate(coordinate, viewProjection, 'EPSG:4326'),
    [coordinate, viewProjection]
  );

  useEffect(() => {
    let alive = true;
    fetchLandInfoConfig().then((cfg) => {
      if (!alive) return;
      setVworldKey(cfg.vworldKey);
      setDataPortalKey(cfg.dataPortalKey);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    /** 새 우클릭 시 부모 pnu가 null로 리셋되므로, 이전 필지 resolved 잔존 방지 */
    if (!pnuFromContext) setResolvedPnu(null);
    setResolvedParcelJibun(null);
    fetchParcelIdentityAtPoint(coordinate, viewProjection).then((id) => {
      if (!alive) return;
      if (!pnuFromContext) setResolvedPnu(id.pnu);
      setResolvedParcelJibun(id.jibunFromParcel);
    });
    return () => {
      alive = false;
    };
  }, [coordinate, viewProjection, pnuFromContext]);

  /** 다른 필지 우클릭 시 — 이전 필지 캐시로 지번·표가 남는 것 방지 (탭이 필지정보가 아니어도) */
  useEffect(() => {
    setParcelData({
      characteristics: [],
      landUses: [],
      prices: [],
      possessions: [],
    });
    setParcelError(null);
    setBuildingRegisterSource(null);
    setBuildingRegisterMode(null);
    setBuildingRegisterBuildings([]);
    setBuildingRegisterChildren([]);
    setBuildingLedgerNotice(null);
    setPermitRows([]);
    setPermitSource(null);
    setPermitNotice(null);
    setResolvedRoad(null);
  }, [effectivePnu]);

  useEffect(() => {
    if (activeTab !== 'parcel') return;
    if (!effectivePnu) return;
    let alive = true;
    setParcelFetching(true);
    setParcelError(null);
    fetchParcelTabData({ pnu: effectivePnu, vworldKey })
      .then((data) => {
        if (!alive) return;
        setParcelData(data);
        setParcelError(null);
      })
      .catch(() => {
        if (!alive) return;
        setParcelError('필지정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (alive) setParcelFetching(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTab, effectivePnu, vworldKey]);

  useLayoutEffect(() => {
    if (activeTab !== 'buildingLedger') {
      setBuildingLedgerFetching(false);
      return;
    }
    if (!effectivePnu) return;
    setBuildingLedgerFetching(true);
  }, [activeTab, effectivePnu]);

  useEffect(() => {
    if (activeTab !== 'buildingLedger') return;
    if (!effectivePnu) return;
    let alive = true;
    const jibunHint =
      String(resolvedParcelJibunRef.current ?? '').trim() ||
      String(jibunPropRef.current ?? '').trim() ||
      undefined;
    fetchBuildingRegisterDetail({
      pnu: effectivePnu,
      jibun: jibunHint,
    })
      .then((res) => {
        if (!alive) return;
        setBuildingRegisterSource(res.source);
        setBuildingRegisterMode(res.mode);
        setBuildingRegisterBuildings(res.buildings);
        setBuildingRegisterChildren(res.children);
        setBuildingLedgerNotice(res.notice ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setBuildingRegisterSource(null);
        setBuildingRegisterMode(null);
        setBuildingRegisterBuildings([]);
        setBuildingRegisterChildren([]);
        setBuildingLedgerNotice(null);
      })
      .finally(() => {
        if (alive) setBuildingLedgerFetching(false);
      });
    return () => {
      alive = false;
      setBuildingLedgerFetching(false);
    };
  }, [activeTab, effectivePnu, buildingRegisterReloadKey]);

  useLayoutEffect(() => {
    if (activeTab !== 'buildingPermit') {
      setPermitFetching(false);
      return;
    }
    if (!effectivePnu) return;
    setPermitFetching(true);
  }, [activeTab, effectivePnu]);

  useEffect(() => {
    if (activeTab !== 'buildingPermit') return;
    if (!effectivePnu) return;
    let alive = true;
    fetchPermitRows({ pnu: effectivePnu, dataPortalKey })
      .then((res) => {
        if (!alive) return;
        setPermitRows(res.rows);
        setPermitSource(res.source);
        setPermitNotice(res.notice ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setPermitRows([]);
        setPermitSource(null);
        setPermitNotice(null);
      })
      .finally(() => {
        if (alive) setPermitFetching(false);
      });
    return () => {
      alive = false;
      setPermitFetching(false);
    };
  }, [activeTab, effectivePnu, dataPortalKey]);

  const latestChar = parcelData.characteristics[0];
  const latestPrice = parcelData.prices[0];
  const latestPossession = parcelData.possessions[0];

  const displayJibunAddress = useMemo(
    () =>
      pickDisplayJibunAddress({
        parcelData,
        propJibun: jibun,
        resolvedJibun: resolvedParcelJibun,
      }),
    [parcelData, jibun, resolvedParcelJibun]
  );

  // 우클릭 context에 도로명이 없으면 — 역지오코딩 재시도 후, 지번 검색으로 road 보강
  useEffect(() => {
    const fromProp = String(road ?? '').trim();
    if (fromProp) {
      setResolvedRoad(null);
      return;
    }
    if (!vworldKey || !wgs84) return;
    setResolvedRoad(null);
    let alive = true;
    const [lon, lat] = wgs84;
    (async () => {
      try {
        const result = await getAddressFromCoord(lon, lat, { apiKey: vworldKey });
        let roadText = result?.road?.trim() || '';
        if (!roadText) {
          const roadOnly = await getAddressFromCoord(lon, lat, { apiKey: vworldKey, type: 'ROAD' });
          roadText = roadOnly?.road?.trim() || '';
        }
        if (!roadText) {
          const jibunHint =
            result?.jibun?.trim() ||
            String(jibun ?? '').trim() ||
            String(resolvedParcelJibun ?? '').trim() ||
            displayJibunAddress;
          if (jibunHint && jibunHint !== '-') {
            roadText =
              (await findRoadAddressByJibun(jibunHint, { apiKey: vworldKey, lon, lat }))?.trim() ||
              '';
          }
        }
        if (alive) setResolvedRoad(roadText || null);
      } catch {
        if (alive) setResolvedRoad(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [road, vworldKey, wgs84, jibun, resolvedParcelJibun, displayJibunAddress]);

  const displayRoadAddress = useMemo(() => {
    const raw = String(road ?? resolvedRoad ?? '').trim();
    if (!raw) return '-';
    return formatAddressStripSidoSigungu(raw) || raw;
  }, [road, resolvedRoad]);

  /** 외부 지도 검색용 — 지번만 (도로명은 검색 결과가 여러 개 뜸) */
  const externalMapSearchQuery = useMemo(() => {
    const fromTab =
      composeFullJibunFromRow(parcelData.characteristics[0]) ||
      composeFullJibunFromRow(parcelData.possessions[0]) ||
      composeFullJibunFromRow(parcelData.prices[0]) ||
      composeFullJibunFromRow(parcelData.landUses[0]);
    return (
      fromTab ||
      String(jibun ?? '').trim() ||
      String(resolvedParcelJibun ?? '').trim()
    );
  }, [parcelData, jibun, resolvedParcelJibun]);

  const openLandModal = async (kind: Exclude<ModalKind, null>) => {
    const pnu = effectivePnu;
    if (!pnu) return;
    setModalKind(kind);
    setModalMessage(null);
    setModalHeaders([]);
    setModalRows([]);

    if (kind === 'price' && parcelData.source === 'vworld') {
      setModalHeaders([...PRICE_MODAL_HEADERS]);
      setModalRows(
        parcelData.prices.map((row) => [
          toText(row.pblntfPclnd ? `${toNumText(row.pblntfPclnd)}원/㎡` : '-'),
          toText(row.pblntfDe),
          toText(row.stdrYear),
          toText(row.stdrMt),
          toText(composeFullJibunFromRow(row) || row.jibun || row.mnnmSlno),
          toText(row.registDt),
        ])
      );
      if (!parcelData.prices.length) setModalMessage('요청된 공시지가 데이터가 없습니다.');
      return;
    }

    setModalFetching(true);
    try {
      const res = await fetchParcelLandModalList({ pnu, kind });
      setModalHeaders(res.headers);
      setModalRows(maskModalRows(kind, res.rows));
      setModalMessage(res.error || res.message || (res.rows.length ? null : '조회 결과가 없습니다.'));
    } catch {
      setModalMessage('조회에 실패했습니다.');
    } finally {
      setModalFetching(false);
    }
  };

  const shareCntRaw = getField(latestPossession, ['cnrsPsnCo', 'shareCnt'], '');
  const shareCntNum = Number(String(shareCntRaw).replace(/,/g, ''));
  const canOpenShare = Number.isFinite(shareCntNum) && shareCntNum > 0;
  const moveDate = getField(latestChar, ['lndMoveDe', 'landMoveDate'], '');
  const changeDate = getField(latestPossession, ['ownshipChgDe'], '');
  const canOpenMove = Boolean(moveDate && moveDate !== '-');
  const canOpenChange = Boolean(changeDate && changeDate !== '-');

  const tabBody = useMemo(() => {
    if (!effectivePnu) return <p className="text-xs text-rose-600">필지 PNU를 찾지 못했습니다.</p>;
    if (activeTab === 'parcel') {
      const parcelLoading = loading || parcelFetching;
      if (parcelLoading) {
        return (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
          </div>
        );
      }
      if (parcelError) return <p className="text-xs text-rose-600">{parcelError}</p>;
      const hasNoLinkageRows =
        parcelData.characteristics.length === 0 &&
        parcelData.possessions.length === 0 &&
        parcelData.prices.length === 0;
      return (
        <div className="min-h-full flex flex-col">
          <div className="space-y-3 flex-1">
          {!parcelData.source && hasNoLinkageRows ? (
            <p className="text-[11px] text-muted-foreground">연계 데이터 없음</p>
          ) : null}
          {parcelData.source ? <ParcelLandLinkageSourceText source={parcelData.source} /> : null}
          {parcelData.krasSkipReason ? (
            <p className="text-[11px] leading-relaxed text-amber-800">행망 미사용: {parcelData.krasSkipReason}</p>
          ) : null}
          <LandLinkageLegendText source={parcelData.source} />
          <section className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">토지기본정보</p>
            <div className="grid grid-cols-[85px_1fr_85px_1fr] overflow-hidden rounded border border-border text-[12px]">
              <LinkageCell k="지목" v={getField(latestChar, ['lndcgrCodeNm', 'jimok'])} source={parcelData.source} />
              <LinkageCell k="면적" v={`${toNumText(getField(latestChar, ['lndpclAr', 'area'], '0'))}㎡`} source={parcelData.source} />
              <LinkageCell k="용도지역" v={getField(latestChar, ['prposArea1Nm', 'prposAreaDstrcCodeNm'])} source={parcelData.source} />
              <LinkageCell k="이동사유" v={getField(latestChar, ['lndMoveResnNm', 'landMoveReason'])} source={parcelData.source} />
              {canOpenMove ? (
                <LinkageCellButton
                  k="이동일자"
                  v={moveDate}
                  button="연혁 조회"
                  source={parcelData.source}
                  onClick={() => void openLandModal('move')}
                />
              ) : (
                <LinkageCell k="이동일자" v={moveDate} source={parcelData.source} />
              )}
              <LinkageCellButton
                k="공시지가"
                v={`${toNumText(getField(latestPrice, ['pblntfPclnd'], '0'))}원/㎡`}
                button="조회"
                source={parcelData.source}
                onClick={() => void openLandModal('price')}
              />
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">토지소유내역</p>
            <div className="grid grid-cols-[85px_1fr_85px_1fr] overflow-hidden rounded border border-border text-[12px]">
              <LinkageCell k="소유구분" v={getField(latestPossession, ['posesnSeCodeNm'])} source={parcelData.source} />
              {canOpenShare ? (
                <LinkageCellButton
                  k="공유인수"
                  v={shareCntRaw || '-'}
                  button="공유인 조회"
                  source={parcelData.source}
                  onClick={() => void openLandModal('share')}
                />
              ) : (
                <LinkageCell k="공유인수" v={shareCntRaw || '-'} source={parcelData.source} />
              )}
              <LinkageCell
                k="소유자명"
                v={maskPersonField(getField(latestPossession, ['ownerNm', 'ownerName']))}
                source={parcelData.source}
              />
              <LinkageCell
                k="주소"
                v={maskPersonField(getField(latestPossession, ['ownerAddr', 'address']))}
                source={parcelData.source}
              />
              <LinkageCell k="변동원인" v={getField(latestPossession, ['ownshipChgCauseCodeNm'])} source={parcelData.source} />
              {canOpenChange ? (
                <LinkageCellButton
                  k="변동일자"
                  v={changeDate}
                  button="연혁조회"
                  source={parcelData.source}
                  onClick={() => void openLandModal('change')}
                />
              ) : (
                <LinkageCell k="변동일자" v={changeDate} source={parcelData.source} />
              )}
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">토지이용계획</p>
            <DataTable
              headers={['용도지역지구', '저촉여부', '비고']}
              linkageSource={parcelData.source}
              rows={(parcelData.landUses.length ? parcelData.landUses : [{}]).map((row) => [
                toText(row.prposAreaDstrcCodeNm),
                toText(row.cnflcAtNm),
                toText(row.registDt),
              ])}
            />
          </section>
          </div>
          <div className="mt-auto pt-4">
            <BuildingDataSourceLine className="text-right" sources={[parcelData.source]} />
            {parcelData.hangmangCalls?.length ? (
              <div className="mt-1 space-y-0.5">
                {parcelData.hangmangCalls.map((line) => (
                  <p key={line.svcId} className="select-text text-[10px] leading-snug text-background">
                    {line.svcId} {line.called ? '호출' : '미호출'} {line.detail}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    if (activeTab === 'buildingLedger') {
      return (
        <BuildingRegisterPanel
          pnu={effectivePnu || ''}
          fetching={buildingLedgerFetching}
          notice={buildingLedgerNotice}
          source={buildingRegisterSource}
          mode={buildingRegisterMode}
          buildings={buildingRegisterBuildings}
          childRows={buildingRegisterChildren}
          onResetRoot={() => setBuildingRegisterReloadKey((k) => k + 1)}
        />
      );
    }
    return (
      <BuildingPermitPanel
        fetching={permitFetching}
        notice={permitNotice}
        source={permitSource}
        rows={permitRows}
      />
    );
  }, [
    activeTab,
    buildingLedgerFetching,
    buildingLedgerNotice,
    buildingRegisterBuildings,
    buildingRegisterChildren,
    buildingRegisterMode,
    buildingRegisterSource,
    effectivePnu,
    latestChar,
    latestPossession,
    latestPrice,
    loading,
    canOpenChange,
    canOpenMove,
    canOpenShare,
    changeDate,
    moveDate,
    shareCntRaw,
    parcelData,
    parcelData.source,
    parcelError,
    permitFetching,
    permitNotice,
    permitRows,
    permitSource,
  ]);

  return (
    <div className="flex flex-col min-h-0 text-sm text-foreground">
      <section className="px-3 py-2 border-b border-border">
        <div className="space-y-2 text-[12px] text-foreground">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] font-semibold py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              지번
            </span>
            <span>{loading ? '조회 중...' : displayJibunAddress}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] font-semibold py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              도로명
            </span>
            <span>{loading ? '조회 중...' : displayRoadAddress}</span>
          </div>
          {buildingName ? <div>건물명: {buildingName}</div> : null}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedCrs}
            onChange={(e) => setSelectedCrs(e.target.value)}
            className="text-[11px] border border-border bg-background text-foreground rounded px-1 py-0.5 max-w-[130px]"
            title="좌표계"
          >
            {COORDINATE_SYSTEM_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.shortLabel}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {xy ? `${xy.x.toFixed(4)}, ${xy.y.toFixed(4)}` : '-'}
          </span>
        </div>
      </section>

      <section className="px-3 py-2 border-b border-border">
        <div className="flex w-full gap-1">
          <button
            type="button"
            onClick={() => openExternalMapByAddress('naver', externalMapSearchQuery)}
            disabled={!externalMapSearchQuery}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-muted disabled:opacity-50"
            aria-label="네이버 지도"
            title="네이버 지도"
          >
            <img src={withBasePath('/image/addressInfoIcon/naverMap_icon.svg')} alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() => openExternalMapByAddress('kakao', externalMapSearchQuery)}
            disabled={!externalMapSearchQuery}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-muted disabled:opacity-50"
            aria-label="카카오 지도"
            title="카카오 지도"
          >
            <img src={withBasePath('/image/addressInfoIcon/kakaoMap_icon.svg')} alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() => openExternalMapByAddress('google', externalMapSearchQuery)}
            disabled={!externalMapSearchQuery}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-muted disabled:opacity-50"
            aria-label="구글 지도"
            title="구글 지도"
          >
            <img src={withBasePath('/image/addressInfoIcon/googleMap_icon.svg')} alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() => effectivePnu && openLandEum(effectivePnu)}
            disabled={!effectivePnu || !/^\d{19}$/.test(effectivePnu)}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-muted disabled:opacity-50"
            aria-label="토지이음"
            title="토지이음"
          >
            <img src={withBasePath('/image/addressInfoIcon/toji-e-um.png')} alt="" className="w-5 h-5 object-contain" />
          </button>
        </div>
      </section>

      <section className="flex-1 min-h-0 flex flex-col">
        <div className="flex border-b border-border shrink-0">
          {TAB_LABELS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              className={`flex-1 min-w-0 px-1.5 py-2 text-xs border-b-2 -mb-px ${
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2">{tabBody}</div>
      </section>

      <Dialog
        open={modalKind != null}
        onOpenChange={(open) => {
          if (!open) {
            setModalKind(null);
            setModalMessage(null);
            setModalHeaders([]);
            setModalRows([]);
            setModalFetching(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[86vh] w-[960px] max-w-[94vw] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-card-foreground sm:max-w-[960px]">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
            <DialogTitle className="text-sm">
              {modalKind ? MODAL_TITLES[modalKind] : '조회'}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {modalFetching ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
              </div>
            ) : modalRows.length > 0 ? (
              <>
                <p className="mb-2 shrink-0 text-xs text-muted-foreground">
                  총 {modalRows.length}
                  {modalKind === 'share' ? '명' : '건'}
                </p>
                <DataTable
                  headers={modalHeaders.length ? modalHeaders : [...PRICE_MODAL_HEADERS]}
                  rows={modalRows}
                  linkageSource={parcelData.source}
                  nowrap
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{modalMessage || '조회 결과가 없습니다.'}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function LinkageCell({ k, v, source }: { k: string; v: string; source?: ParcelLandRowSource }) {
  return (
    <>
      <div className="px-2 py-1 bg-muted border-b border-r border-border font-medium">{k}</div>
      <div className="px-2 py-1 border-b border-border">
        <ParcelLinkageValueText value={v} source={source} />
      </div>
    </>
  );
}

function LinkageCellButton({
  k,
  v,
  button,
  source,
  onClick,
}: {
  k: string;
  v: string;
  button: string;
  source?: ParcelLandRowSource;
  onClick: () => void;
}) {
  return (
    <>
      <div className="px-2 py-1 bg-muted border-b border-r border-border font-medium">{k}</div>
      <div className="px-2 py-1 border-b border-border flex items-start justify-between gap-2">
        <ParcelLinkageValueText value={v} source={source} className="whitespace-normal break-words" />
        <button type="button" className="shrink-0 text-[11px] px-2 py-0.5 border rounded border-border hover:bg-muted" onClick={onClick} title={button}>
          {button}
        </button>
      </div>
    </>
  );
}
