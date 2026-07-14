'use client';

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { COORDINATE_SYSTEM_OPTIONS, type AddressInfoPanelProps } from './shared';
import { transformCoordinate } from '../services/coordinateService';
import {
  fetchBuildingLedgerRows,
  fetchLandInfoConfig,
  fetchParcelIdentityAtPoint,
  fetchParcelTabData,
  fetchPermitRows,
  type BuildingLedgerLandInfoRow,
  type BuildingLedgerRow,
  type BuildingPermitSource,
  type ParcelTabData,
} from './api';
import {
  BuildingLinkageLegend,
  BuildingPermitLinkageLegend,
  LandLinkageLegendText,
  ParcelLandLinkageSourceText,
  ParcelLinkageValueText,
  buildingPermitLinkageSource,
} from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
import type { ParcelLandRowSource } from '@/lib/parcelLandDisplay';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

type TabId = 'parcel' | 'buildingLedger' | 'buildingPermit';
type ModalKind = 'price' | null;

const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: 'parcel', label: '필지정보' },
  { id: 'buildingLedger', label: '건축물대장' },
  { id: 'buildingPermit', label: '건축인허가' },
];

const PRICE_MODAL_HEADERS = ['공시지가', '공시일자', '기준년도', '기준월', '지번', '비고'] as const;

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
}: {
  headers: string[];
  rows: string[][];
  linkageSource?: ParcelLandRowSource;
  linkageSources?: Array<ParcelLandRowSource | undefined>;
  /** true면 마지막 열을 «연계» 출처 텍스트로 렌더 */
  linkageCol?: boolean;
  /** 연계 색 미적용 열(0부터, 예: 대지위치·지번·도로명) */
  plainColumnIndexes?: number[];
}) {
  const plainSet = new Set(plainColumnIndexes ?? []);
  const dataColCount = linkageCol ? headers.length - 1 : headers.length;
  return (
    <div className="overflow-auto border border-slate-200 rounded">
      <table className="w-full table-auto text-[12px]">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-2 py-1 text-left border-b border-r last:border-r-0 border-slate-200 text-slate-700 whitespace-normal break-words align-top"
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
              <tr key={`${idx}-${row.join('|')}`} className="odd:bg-white even:bg-slate-50/50">
                {dataCells.map((cell, cidx) => (
                  <td
                    key={`${idx}-${cidx}`}
                    className="px-2 py-1 border-b border-r last:border-r-0 border-slate-100 text-slate-700 whitespace-normal break-words align-top"
                  >
                    <ParcelLinkageValueText
                      value={cell}
                      source={plainSet.has(cidx) ? undefined : rowSource}
                    />
                  </td>
                ))}
                {linkageCol ? (
                  <td className="px-2 py-1 border-b border-slate-100 text-slate-700 whitespace-normal break-words align-top">
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

  const [resolvedPnu, setResolvedPnu] = useState<string | null>(pnuFromContext ?? null);
  const [resolvedParcelJibun, setResolvedParcelJibun] = useState<string | null>(null);
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

  const [buildingRows, setBuildingRows] = useState<BuildingLedgerLandInfoRow[]>([]);
  const [buildingLedgerNotice, setBuildingLedgerNotice] = useState<string | null>(null);
  /** true only while 요청 진행 중 — 빈 결과([])와 구분 */
  const [buildingLedgerFetching, setBuildingLedgerFetching] = useState(false);

  const [permitRows, setPermitRows] = useState<BuildingLedgerRow[]>([]);
  const [permitSource, setPermitSource] = useState<BuildingPermitSource>(null);
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
    fetchParcelIdentityAtPoint(coordinate, viewProjection).then((id) => {
      if (!alive) return;
      if (!pnuFromContext) setResolvedPnu(id.pnu);
      setResolvedParcelJibun(id.jibunFromParcel);
    });
    return () => {
      alive = false;
    };
  }, [coordinate, viewProjection, pnuFromContext]);

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
    fetchBuildingLedgerRows({
      pnu: effectivePnu,
      jibun: resolvedParcelJibun ?? undefined,
    })
      .then((res) => {
        if (!alive) return;
        setBuildingRows(res.rows);
        setBuildingLedgerNotice(res.notice ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setBuildingRows([]);
        setBuildingLedgerNotice(null);
      })
      .finally(() => {
        if (alive) setBuildingLedgerFetching(false);
      });
    return () => {
      alive = false;
      setBuildingLedgerFetching(false);
    };
  }, [activeTab, effectivePnu, resolvedParcelJibun]);

  useLayoutEffect(() => {
    if (activeTab !== 'buildingPermit') {
      setPermitFetching(false);
      return;
    }
    if (!effectivePnu || !dataPortalKey) return;
    setPermitFetching(true);
  }, [activeTab, effectivePnu, dataPortalKey]);

  useEffect(() => {
    if (activeTab !== 'buildingPermit') return;
    if (!effectivePnu || !dataPortalKey) return;
    let alive = true;
    fetchPermitRows({ pnu: effectivePnu, dataPortalKey })
      .then((res) => {
        if (!alive) return;
        setPermitRows(res.rows);
        setPermitSource(res.source);
      })
      .catch(() => {
        if (!alive) return;
        setPermitRows([]);
        setPermitSource(null);
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

  const displayRoadAddress = useMemo(() => {
    const raw = String(road ?? '').trim();
    if (!raw) return '-';
    return formatAddressStripSidoSigungu(raw) || raw;
  }, [road]);

  const modalRows = useMemo(() => {
    if (modalKind !== 'price') return [];
    return parcelData.prices.map((row) => [
      toText(row.pblntfPclnd ? `${toNumText(row.pblntfPclnd)}원/㎡` : '-'),
      toText(row.pblntfDe),
      toText(row.stdrYear),
      toText(row.stdrMt),
      toText(composeFullJibunFromRow(row) || row.jibun || row.mnnmSlno),
      toText(row.registDt),
    ]);
  }, [modalKind, parcelData]);

  const tabBody = useMemo(() => {
    if (!effectivePnu) return <p className="text-xs text-rose-600">필지 PNU를 찾지 못했습니다.</p>;
    if (activeTab === 'parcel') {
      const parcelLoading = loading || parcelFetching;
      if (parcelLoading) {
        return (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
          </div>
        );
      }
      if (parcelError) return <p className="text-xs text-rose-600">{parcelError}</p>;
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-600">
            {parcelData.source ? (
              <ParcelLandLinkageSourceText source={parcelData.source} />
            ) : parcelData.characteristics.length === 0 &&
              parcelData.possessions.length === 0 &&
              parcelData.prices.length === 0 ? (
              <span className="text-slate-500">연계 데이터 없음</span>
            ) : null}
          </p>
          <LandLinkageLegendText source={parcelData.source} />
          <section className="border border-slate-200 rounded">
            <h4 className="bg-sky-50 text-sky-700 text-[12px] font-semibold px-2 py-1 border-b border-slate-200">토지기본정보</h4>
            <div className="grid grid-cols-[85px_1fr_85px_1fr] text-[12px]">
              <LinkageCell k="지목" v={getField(latestChar, ['lndcgrCodeNm', 'jimok'])} source={parcelData.source} />
              <LinkageCell k="면적" v={`${toNumText(getField(latestChar, ['lndpclAr', 'area'], '0'))}㎡`} source={parcelData.source} />
              <LinkageCell k="용도지역" v={getField(latestChar, ['prposArea1Nm', 'prposAreaDstrcCodeNm'])} source={parcelData.source} />
              <LinkageCell k="이동사유" v={getField(latestChar, ['lndMoveResnNm', 'landMoveReason'])} source={parcelData.source} />
              <LinkageCell k="이동일자" v={getField(latestChar, ['lndMoveDe', 'landMoveDate'])} source={parcelData.source} />
              <LinkageCellButton
                k="공시지가"
                v={`${toNumText(getField(latestPrice, ['pblntfPclnd'], '0'))}원/㎡`}
                button="조회"
                source={parcelData.source}
                onClick={() => setModalKind('price')}
              />
            </div>
          </section>

          <section className="border border-slate-200 rounded">
            <h4 className="bg-sky-50 text-sky-700 text-[12px] font-semibold px-2 py-1 border-b border-slate-200">토지소유내역</h4>
            <div className="grid grid-cols-[85px_1fr_85px_1fr] text-[12px]">
              <LinkageCell k="소유구분" v={getField(latestPossession, ['posesnSeCodeNm'])} source={parcelData.source} />
              <LinkageCell k="공유인수" v={getField(latestPossession, ['cnrsPsnCo', 'shareCnt'])} source={parcelData.source} />
              <LinkageCell k="소유자명" v={getField(latestPossession, ['ownerNm', 'ownerName'])} source={parcelData.source} />
              <LinkageCell k="주소" v={getField(latestPossession, ['ownerAddr', 'address'])} source={parcelData.source} />
              <LinkageCell k="변동원인" v={getField(latestPossession, ['ownshipChgCauseCodeNm'])} source={parcelData.source} />
              <LinkageCell k="변동일자" v={getField(latestPossession, ['ownshipChgDe'])} source={parcelData.source} />
            </div>
          </section>

          <section className="border border-slate-200 rounded">
            <h4 className="bg-sky-50 text-sky-700 text-[12px] font-semibold px-2 py-1 border-b border-slate-200">토지이용계획</h4>
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
      );
    }
    if (activeTab === 'buildingLedger') {
      if (buildingLedgerFetching) return <p className="text-xs text-slate-500">건축물대장 조회 중...</p>;
      if (!buildingRows.length) {
        return (
          <div className="space-y-2">
            {buildingLedgerNotice ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {buildingLedgerNotice}
              </p>
            ) : (
              <p className="text-xs text-slate-500">조회 결과가 없습니다.</p>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {buildingLedgerNotice ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {buildingLedgerNotice}
            </p>
          ) : null}
          <BuildingLinkageLegend sources={buildingRows.map((r) => r.source)} />
          <DataTable
            headers={['명칭', '대지위치', '지번', '도로명', '건폐율', '용적률', '대지면적', '연면적']}
            plainColumnIndexes={[1, 2, 3]}
            linkageSources={buildingRows.map((r) => r.source)}
            rows={buildingRows.map((row) => [
              toText(row.bldNm),
              toText(
                (() => {
                  const t = String(row.platLoc ?? '').trim();
                  if (!t || t === '-') return t || '-';
                  return formatAddressStripSidoSigungu(t) || t;
                })()
              ),
              toText(row.jibun),
              toText(
                (() => {
                  const t = String(row.roadAddr ?? '').trim();
                  if (!t || t === '-') return t || '-';
                  return formatAddressStripSidoSigungu(t) || t;
                })()
              ),
              toText(row.bcRat),
              toText(row.vlRat),
              toText(row.platArea),
              toText(row.totArea),
            ])}
          />
        </div>
      );
    }
    if (permitFetching) return <p className="text-xs text-slate-500">건축인허가 조회 중...</p>;
    if (!permitRows.length) return <p className="text-xs text-slate-500">건축/주택 인허가 데이터가 없습니다.</p>;
    const permitLinkage = buildingPermitLinkageSource(permitSource);
    return (
      <div className="space-y-2">
        <BuildingPermitLinkageLegend source={permitSource} />
        <DataTable
          headers={['용도명', '허가일', '착공일', '사용승인(검사)일', '연면적(㎡)', '세대수']}
          linkageSource={permitLinkage}
          rows={permitRows.map((row) => [
            toText(row.mainPurpsCdNm || row.purpsCdNm),
            toText(row.archPmsDay || row.apprvDay),
            toText(row.realStcnsDay || row.stcnsDay),
            toText(row.useAprDay || row.useInsptDay),
            toText(row.totArea),
            toText(row.hhldCnt || row.totHhldCnt),
          ])}
        />
      </div>
    );
  }, [
    activeTab,
    buildingLedgerFetching,
    buildingLedgerNotice,
    buildingRows,
    dataPortalKey,
    effectivePnu,
    latestChar,
    latestPossession,
    latestPrice,
    loading,
    parcelData,
    parcelData.source,
    parcelError,
    permitFetching,
    permitRows,
    permitSource,
  ]);

  return (
    <div className="flex flex-col min-h-0 text-sm">
      <section className="px-3 py-2 border-b border-slate-100">
        <div className="space-y-2 text-[12px] text-slate-700">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] font-semibold py-0.5 rounded bg-amber-100 text-amber-800">
              지번
            </span>
            <span>{loading ? '조회 중...' : displayJibunAddress}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-12 text-center text-[10px] font-semibold py-0.5 rounded bg-blue-100 text-blue-700">
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
            className="text-[11px] border border-slate-200 rounded px-1 py-0.5 max-w-[130px]"
          >
            {COORDINATE_SYSTEM_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.shortLabel}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-600 font-mono truncate">
            {xy ? `${xy.x.toFixed(4)}, ${xy.y.toFixed(4)}` : '-'}
          </span>
        </div>
      </section>

      <section className="px-3 py-2 border-b border-slate-100">
        <div className="flex w-full gap-1">
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(
                `https://map.naver.com/v5/search/?c=${wgs84[1]},${wgs84[0]},15,0,0,0,dh`,
                '_blank',
                'noopener,noreferrer'
              )
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="네이버 지도"
          >
            <img src="/image/addressInfoIcon/naverMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(`https://map.kakao.com/link/map/${wgs84[1]},${wgs84[0]}`, '_blank', 'noopener,noreferrer')
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="카카오 지도"
          >
            <img src="/image/addressInfoIcon/kakaoMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() =>
              wgs84 &&
              window.open(`https://www.google.com/maps?q=${wgs84[1]},${wgs84[0]}`, '_blank', 'noopener,noreferrer')
            }
            disabled={!wgs84}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="구글 지도"
          >
            <img src="/image/addressInfoIcon/googleMap_icon.svg" alt="" className="w-5 h-5 object-contain" />
          </button>
          <button
            type="button"
            onClick={() => effectivePnu && openLandEum(effectivePnu)}
            disabled={!effectivePnu || !/^\d{19}$/.test(effectivePnu)}
            className="flex-1 min-w-0 flex items-center justify-center h-9 rounded overflow-hidden hover:bg-slate-200 disabled:opacity-50"
            aria-label="토지이음"
          >
            <img src="/image/addressInfoIcon/toji-e-um.png" alt="" className="w-5 h-5 object-contain" />
          </button>
        </div>
      </section>

      <section className="flex-1 min-h-0 flex flex-col">
        <div className="flex border-b border-slate-200 shrink-0">
          {TAB_LABELS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-0 px-1.5 py-2 text-xs border-b-2 -mb-px ${
                activeTab === tab.id ? 'border-sky-600 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2">{tabBody}</div>
      </section>

      <Dialog open={modalKind === 'price'} onOpenChange={(open) => !open && setModalKind(null)}>
        <DialogContent className="w-[860px] max-w-[92vw] max-h-[86vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-slate-200 shrink-0">
            <DialogTitle className="text-sm">공시지가 조회</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
            <p className="text-xs text-slate-500 mb-2 shrink-0">총 {modalRows.length}건</p>
            <DataTable headers={[...PRICE_MODAL_HEADERS]} rows={modalRows} linkageSource={parcelData.source} />
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function LinkageCell({ k, v, source }: { k: string; v: string; source?: ParcelLandRowSource }) {
  return (
    <>
      <div className="px-2 py-1 bg-slate-50 border-b border-r border-slate-200 font-medium">{k}</div>
      <div className="px-2 py-1 border-b border-slate-200">
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
      <div className="px-2 py-1 bg-slate-50 border-b border-r border-slate-200 font-medium">{k}</div>
      <div className="px-2 py-1 border-b border-slate-200 flex items-start justify-between gap-2">
        <ParcelLinkageValueText value={v} source={source} className="whitespace-normal break-words" />
        <button type="button" className="shrink-0 text-[11px] px-2 py-0.5 border rounded border-slate-300 hover:bg-slate-50" onClick={onClick}>
          {button}
        </button>
      </div>
    </>
  );
}
