'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COORDINATE_SYSTEM_OPTIONS, type AddressInfoPanelProps } from './shared';
import { transformCoordinate } from '../services/coordinateService';
import {
  fetchBuildingRegisterDetail,
  fetchLandInfoConfig,
  fetchParcelIdentityAtPoint,
  fetchParcelTabData,
  fetchPermitRows,
  type BuildingLedgerRow,
  type BuildingPermitSource,
  type BuildingRegisterMode,
  type BuildingRegisterRow,
  type ParcelTabData,
} from './api';
import { BuildingPermitPanel, BuildingRegisterPanel } from './LandInfoBuildingPanels';
import { LandInfoParcelPanel } from './LandInfoParcelPanel';
import { withBasePath } from '@/lib/basePath';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
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

const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: 'parcel', label: '필지정보' },
  { id: 'buildingLedger', label: '건축물대장' },
  { id: 'buildingPermit', label: '건축인허가' },
];

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
  }, [effectivePnu, vworldKey]);

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

  const tabBody = useMemo(() => {
    if (!effectivePnu) return <p className="text-xs text-rose-600">필지 PNU를 찾지 못했습니다.</p>;
    if (activeTab === 'parcel') {
      return (
        <LandInfoParcelPanel
          pnu={effectivePnu}
          vworldKey={vworldKey}
          resolveLoading={loading}
          parcelData={parcelData}
          parcelFetching={parcelFetching}
          parcelError={parcelError}
        />
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
    loading,
    parcelData,
    parcelError,
    parcelFetching,
    permitFetching,
    permitNotice,
    permitRows,
    permitSource,
    vworldKey,
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

    </div>
  );
}
