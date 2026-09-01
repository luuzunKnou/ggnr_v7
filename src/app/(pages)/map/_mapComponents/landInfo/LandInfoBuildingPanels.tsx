'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  fetchBuildingFloorList,
  fetchBuildingRegisterByDong,
  type BuildingLedgerRow,
  type BuildingPermitSource,
  type BuildingRegisterMode,
  type BuildingRegisterRow,
} from './api';
import { BuildingDataSourceLine } from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
import {
  LAND_INFO_LABEL_CELL,
  LAND_INFO_LIST_ROW_ODD,
  LAND_INFO_LIST_TD,
  LAND_INFO_LIST_TH,
  LAND_INFO_LIST_THEAD,
  LAND_INFO_TABLE_BTN,
  LAND_INFO_TABLE_TEXT,
  LAND_INFO_TABLE_WRAP,
  LAND_INFO_VALUE_CELL,
} from './landInfoTableStyles';

function isNumericZero(text: string): boolean {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return false;
  return Number(text) === 0;
}

function fmt(value: unknown, unit = ''): string {
  if (value == null) return '-';
  let t = String(value).trim();
  if (!t) return '-';
  const unitAlts: Record<string, string[]> = {
    '㎡': ['㎡', 'm²', 'm2', 'M2'],
    '%': ['%'],
    층: ['층'],
    동: ['동'],
    m: ['m', 'M'],
  };
  const alts = unitAlts[unit] ?? (unit ? [unit] : []);
  for (const alt of alts) {
    if (t.endsWith(alt)) {
      t = t.slice(0, -alt.length).trim();
      break;
    }
  }
  if (!t || isNumericZero(t)) return '-';
  return unit ? `${t}${unit}` : t;
}

function field(row: BuildingRegisterRow | BuildingLedgerRow | undefined, ...keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const t = String(v).trim();
    if (t) return t;
  }
  return '';
}

function jibunText(row: BuildingRegisterRow | BuildingLedgerRow | undefined): string {
  if (!row) return '-';
  const m = Number(row.mnnm);
  const s = Number(row.slno);
  if (Number.isFinite(m) && m !== 0) {
    return Number.isFinite(s) && s !== 0 ? `${m}-${s}` : String(m);
  }
  const bun = field(row, 'bun');
  const ji = field(row, 'ji');
  if (bun) {
    const bunN = Number(bun);
    const jiN = Number(ji);
    if (Number.isFinite(bunN) && bunN !== 0) {
      return Number.isFinite(jiN) && jiN !== 0 ? `${bunN}-${jiN}` : String(bunN);
    }
  }
  return fmt(row.jibun);
}

function roadText(row: BuildingRegisterRow | undefined): string {
  if (!row) return '-';
  const portalRoad = field(row, 'newPlatPlc', 'new_plat_plc');
  if (portalRoad) return portalRoad;
  const road = field(row, 'na_road_cd_nm');
  if (!road) return fmt(field(row, 'road_addr', 'platPlc', 'plat_plc'));
  const m = Number(row.na_mnnm);
  const s = Number(row.na_slno);
  const lot = Number.isFinite(m) ? (s ? `${m}-${s}` : String(m)) : '';
  return [field(row, 'sigungu_cd_nm'), road, lot].filter(Boolean).join(' ') || '-';
}

function platLocText(row: BuildingRegisterRow | BuildingLedgerRow | undefined): string {
  return (
    [field(row, 'sigungu_cd_nm', 'sigunguCdNm'), field(row, 'bjdong_cd_nm', 'bjdongCdNm')]
      .filter(Boolean)
      .join(' ') ||
    field(row, 'platPlc', 'plat_plc', 'plat_loc') ||
    '-'
  );
}

function jijiguList(row: BuildingRegisterRow | undefined): string[] {
  const raw = row?.jijigu_list;
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  const one = field(row, 'jijigu_nm', 'jijiguNm');
  return one ? [one] : [];
}

/** 동 목록 구분 — DB 짧은값(표제·일반)을 대장 종류명과 맞춤 */
function ledgerTypeLabel(type: string): string {
  if (type === '표제') return '표제부';
  if (type === '일반') return '일반건축물';
  return type;
}

function selectOptionText(bracket: string, rest: string): string {
  const body = rest.replace(/\s+/g, ' ').trim();
  const gb = bracket.trim();
  if (gb) return `[${gb}] ${body}`.trim();
  return body;
}

function ThTd({
  label,
  value,
  colSpan,
}: {
  label: string;
  value: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <>
      <th className={LAND_INFO_LABEL_CELL}>{label}</th>
      <td colSpan={colSpan} className={LAND_INFO_VALUE_CELL}>
        {value}
      </td>
    </>
  );
}

function DetailTable({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(LAND_INFO_TABLE_WRAP, 'overflow-hidden')}>
      <table className={cn('w-full table-fixed border-collapse', LAND_INFO_TABLE_TEXT)}>
        <colgroup>
          <col className="w-[20%]" />
          <col className="w-[30%]" />
          <col className="w-[20%]" />
          <col className="w-[30%]" />
        </colgroup>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function RecapDetail({ data }: { data: BuildingRegisterRow }) {
  const jijigus = jijiguList(data);
  const viol = field(data, 'violbld_yn', 'violBldYn') === '1' || field(data, 'violbld_yn', 'violBldYn') === 'Y';
  return (
    <DetailTable>
      <tr>
        <ThTd
          label="고유번호"
          value={fmt(field(data, 'comm_bld_esnc_no', 'mgmBldrgstPk', 'mgm_bldrgst_pk'))}
          colSpan={viol ? 1 : 3}
        />
        {viol ? (
          <td className={cn(LAND_INFO_VALUE_CELL, 'font-semibold text-red-600 dark:text-red-400')}>
            위반건축물
          </td>
        ) : null}
      </tr>
      <tr>
        <ThTd label="명칭" value={fmt(field(data, 'bld_nm', 'bldNm'))} />
        <ThTd label="특이사항" value={fmt(field(data, 'spcmt_cntt', 'spcmtCntt'))} />
      </tr>
      <tr>
        <ThTd label="지번" value={jibunText(data)} />
        <ThTd label="대지위치" value={platLocText(data)} />
      </tr>
      <tr>
        <ThTd label="도로명주소" value={roadText(data)} colSpan={3} />
      </tr>
      <tr>
        <ThTd label="대지면적(㎡)" value={fmt(field(data, 'plat_area', 'platArea'), '㎡')} />
        <ThTd label="연면적(㎡)" value={fmt(field(data, 'totarea', 'totArea'), '㎡')} />
      </tr>
      {jijigus.length
        ? jijigus.map((v, i) => (
            <tr key={`j-${i}`}>
              {i === 0 ? (
                <th rowSpan={jijigus.length} className={cn(LAND_INFO_LABEL_CELL, 'w-[28%] align-top')}>
                  지역지구구역
                </th>
              ) : null}
              <td colSpan={3} className={LAND_INFO_VALUE_CELL}>
                {v}
              </td>
            </tr>
          ))
        : null}
      <tr>
        <ThTd label="주용도" value={fmt(field(data, 'main_prpos_cd_nm', 'mainPurpsCdNm'))} />
        <ThTd label="건축면적(㎡)" value={fmt(field(data, 'arch_area', 'archArea'), '㎡')} />
      </tr>
      <tr>
        <ThTd
          label="용적률 산정용 연면적"
          value={fmt(field(data, 'vlrat_calc_totarea', 'vlRatEstmTotArea', 'vlRatCalcTotArea'), '㎡')}
        />
        <ThTd label="주 건축물 수" value={fmt(field(data, 'main_bild_cnt', 'mainBldCnt', 'mainBildCnt'))} />
      </tr>
      <tr>
        <ThTd label="건폐율" value={fmt(field(data, 'bcrat', 'bcRat'), '%')} />
        <ThTd label="용적률" value={fmt(field(data, 'vlrat', 'vlRat'), '%')} />
      </tr>
      <tr>
        <ThTd label="총주차대수" value={fmt(field(data, 'tot_pkng_cnt', 'totPkngCnt'))} />
        <ThTd label="호수" value={fmt(field(data, 'ho_cnt', 'hoCnt'))} />
      </tr>
      <tr>
        <ThTd label="가구수" value={fmt(field(data, 'fmly_cnt', 'fmlyCnt'))} />
        <ThTd label="세대수" value={fmt(field(data, 'hhldcnt', 'hhldCnt'))} />
      </tr>
      <tr>
        <ThTd label="부속건축물 수" value={fmt(field(data, 'atch_bild_cnt', 'atchBldCnt'), '동')} />
        <ThTd label="부속건축물 면적" value={fmt(field(data, 'atch_bild_area', 'atchBldArea'), '㎡')} />
      </tr>
    </DetailTable>
  );
}

function TitleDetail({ data }: { data: BuildingRegisterRow }) {
  const jijigus = jijiguList(data);
  const viol = field(data, 'violbld_yn', 'violBldYn') === '1' || field(data, 'violbld_yn', 'violBldYn') === 'Y';
  return (
    <DetailTable>
      <tr>
        <ThTd
          label="고유번호"
          value={fmt(field(data, 'comm_bld_esnc_no', 'mgmBldrgstPk', 'mgm_bldrgst_pk'))}
          colSpan={viol ? 1 : 3}
        />
        {viol ? (
          <td className={cn(LAND_INFO_VALUE_CELL, 'font-semibold text-red-600 dark:text-red-400')}>
            위반건축물
          </td>
        ) : null}
      </tr>
      <tr>
        <ThTd
          label="명칭"
          value={[field(data, 'bld_nm', 'bldNm'), field(data, 'dong_nm', 'dongNm')].filter(Boolean).join(' ') || '-'}
        />
        <ThTd label="주용도" value={fmt(field(data, 'main_prpos_cd_nm', 'mainPurpsCdNm'))} />
      </tr>
      <tr>
        <ThTd label="지번" value={jibunText(data)} />
        <ThTd label="대지위치" value={platLocText(data)} />
      </tr>
      <tr>
        <ThTd label="도로명주소" value={roadText(data)} colSpan={3} />
      </tr>
      <tr>
        <ThTd label="대지면적(㎡)" value={fmt(field(data, 'plat_area', 'platArea'), '㎡')} />
        <ThTd label="연면적(㎡)" value={fmt(field(data, 'totarea', 'totArea'), '㎡')} />
      </tr>
      <tr>
        <ThTd label="건축면적(㎡)" value={fmt(field(data, 'arch_area', 'archArea'), '㎡')} colSpan={3} />
      </tr>
      {jijigus.length
        ? jijigus.map((v, i) => (
            <tr key={`j-${i}`}>
              {i === 0 ? (
                <th rowSpan={jijigus.length} className={cn(LAND_INFO_LABEL_CELL, 'w-[28%] align-top')}>
                  지역지구구역
                </th>
              ) : null}
              <td colSpan={3} className={LAND_INFO_VALUE_CELL}>
                {v}
              </td>
            </tr>
          ))
        : null}
          <tr>
            <ThTd label="주구조" value={fmt(field(data, 'strct_cd_nm', 'strctCdNm', 'mainStrctCdNm'))} />
            <ThTd
              label="층수"
              value={`지하: ${fmt(field(data, 'ugrnd_flrcnt', 'ugrndFlrCnt'), '층')}, 지상: ${fmt(field(data, 'grnd_flrcnt', 'grndFlrCnt'), '층')}`}
            />
          </tr>
          <tr>
            <ThTd label="높이" value={fmt(field(data, 'heit', 'heit'), 'm')} />
            <ThTd label="지붕" value={fmt(field(data, 'roof_cd_nm', 'roofCdNm'))} />
          </tr>
          <tr>
            <ThTd
              label="용적률 산정용 연면적"
              value={fmt(field(data, 'vlrat_calc_totarea', 'vlRatEstmTotArea', 'vlRatCalcTotArea'), '㎡')}
            />
            <ThTd label="용적률" value={fmt(field(data, 'vlrat', 'vlRat'), '%')} />
          </tr>
          <tr>
            <ThTd label="건폐율" value={fmt(field(data, 'bcrat', 'bcRat'), '%')} />
            <ThTd label="호수" value={fmt(field(data, 'ho_cnt', 'hoCnt'))} />
          </tr>
          <tr>
            <ThTd label="가구수" value={fmt(field(data, 'fmly_cnt', 'fmlyCnt'))} />
            <ThTd label="세대수" value={fmt(field(data, 'hhldcnt', 'hhldCnt'))} />
          </tr>
          <tr>
            <ThTd label="부속건축물 수" value={fmt(field(data, 'atch_bild_cnt', 'atchBldCnt'), '동')} />
            <ThTd label="부속건축물 면적" value={fmt(field(data, 'atch_bild_area', 'atchBldArea'), '㎡')} />
          </tr>
    </DetailTable>
  );
}

function isRecapRegisterView(
  row: BuildingRegisterRow | undefined,
  mode: BuildingRegisterMode
): boolean {
  if (mode === 'recap') return true;
  const type = field(row, 'type');
  return type === '총괄표제부' || type === '총괄';
}

function ChildListTable({
  mode,
  childRows,
  onDongLookup,
}: {
  mode: BuildingRegisterMode;
  childRows: BuildingRegisterRow[];
  onDongLookup?: (bldNm: string) => void;
}) {
  const isRecap = mode === 'recap';
  return (
    <div className={LAND_INFO_TABLE_WRAP}>
      <table className={cn('w-full table-auto border-collapse', LAND_INFO_TABLE_TEXT)}>
        <thead className={LAND_INFO_LIST_THEAD}>
          <tr>
            {isRecap ? (
              <>
                <th className={cn(LAND_INFO_LIST_TH, 'whitespace-nowrap')}>구분</th>
                <th className={LAND_INFO_LIST_TH}>건물명</th>
                <th className={LAND_INFO_LIST_TH}>용도</th>
                <th className={LAND_INFO_LIST_TH}>주구조</th>
                <th className={cn(LAND_INFO_LIST_TH, 'whitespace-nowrap text-right')}>면적(㎡)</th>
                <th className={cn(LAND_INFO_LIST_TH, 'whitespace-nowrap w-[1%]')}>조회</th>
              </>
            ) : (
              <>
                <th className={cn(LAND_INFO_LIST_TH, 'whitespace-nowrap')}>층별</th>
                <th className={LAND_INFO_LIST_TH}>구조</th>
                <th className={LAND_INFO_LIST_TH}>용도</th>
                <th className={cn(LAND_INFO_LIST_TH, 'whitespace-nowrap text-right')}>면적(㎡)</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {childRows.length === 0 ? (
            <tr>
              <td
                colSpan={isRecap ? 6 : 4}
                className={cn(LAND_INFO_LIST_TD, 'py-3 text-center text-muted-foreground')}
              >
                하위 정보가 없습니다.
              </td>
            </tr>
          ) : (
            childRows.map((row, i) =>
              isRecap ? (
                <tr key={i} className={LAND_INFO_LIST_ROW_ODD}>
                  <td className={cn(LAND_INFO_LIST_TD, 'whitespace-nowrap text-center')}>
                    {fmt(ledgerTypeLabel(field(row, 'type')))}
                  </td>
                  <td className={LAND_INFO_LIST_TD}>{fmt(field(row, 'bld_nm', 'bldNm'))}</td>
                  <td className={LAND_INFO_LIST_TD}>{fmt(field(row, 'main_prpos_cd_nm', 'mainPurpsCdNm'))}</td>
                  <td className={LAND_INFO_LIST_TD}>
                    {fmt(field(row, 'main_strct_cd_nm', 'mainStrctCdNm', 'strct_cd_nm', 'strctCdNm'))}
                  </td>
                  <td className={cn(LAND_INFO_LIST_TD, 'whitespace-nowrap text-right')}>
                    {fmt(field(row, 'totarea', 'totArea'))}
                  </td>
                  <td className={cn(LAND_INFO_LIST_TD, 'whitespace-nowrap text-center')}>
                    {field(row, 'type') !== '동' && onDongLookup ? (
                      <button
                        type="button"
                        className={cn(LAND_INFO_TABLE_BTN, 'inline-flex whitespace-nowrap px-1.5')}
                        onClick={() => onDongLookup(field(row, 'bld_nm', 'bldNm'))}
                        title="조회"
                      >
                        조회
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={i} className={LAND_INFO_LIST_ROW_ODD}>
                  <td className={cn(LAND_INFO_LIST_TD, 'whitespace-nowrap text-center')}>
                    {fmt(field(row, 'flrno_nm', 'flrNoNm'))}
                  </td>
                  <td className={LAND_INFO_LIST_TD}>{fmt(field(row, 'strct_cd_nm', 'strctCdNm'))}</td>
                  <td className={LAND_INFO_LIST_TD}>{fmt(field(row, 'main_prpos_cd_nm', 'mainPurpsCdNm'))}</td>
                  <td className={cn(LAND_INFO_LIST_TD, 'whitespace-nowrap text-right')}>
                    {fmt(field(row, 'area', 'area'))}
                  </td>
                </tr>
              )
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

export function BuildingRegisterPanel({
  pnu,
  fetching,
  notice,
  source,
  mode,
  buildings,
  childRows,
  onResetRoot,
}: {
  pnu: string;
  fetching: boolean;
  notice?: string | null;
  source: 'seum' | 'portal' | null;
  mode: BuildingRegisterMode;
  buildings: BuildingRegisterRow[];
  childRows: BuildingRegisterRow[];
  /** 총괄로 되돌리기 */
  onResetRoot?: () => void;
}) {
  const [selectedSeq, setSelectedSeq] = useState('');
  const [localBuildings, setLocalBuildings] = useState(buildings);
  const [localChildren, setLocalChildren] = useState(childRows);
  const [localMode, setLocalMode] = useState(mode);
  const [showBack, setShowBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const recapSnapshotRef = useRef<{
    buildings: BuildingRegisterRow[];
    children: BuildingRegisterRow[];
    mode: BuildingRegisterMode;
    selectedSeq: string;
  } | null>(null);

  useEffect(() => {
    setLocalBuildings(buildings);
    setLocalChildren(childRows);
    setLocalMode(mode);
    setShowBack(false);
    recapSnapshotRef.current = null;
    setSelectedSeq(field(buildings[0], 'bldrgst_seqno'));
  }, [buildings, childRows, mode, pnu]);

  const selected = useMemo(() => {
    if (!localBuildings.length) return undefined;
    return (
      localBuildings.find((b) => field(b, 'bldrgst_seqno') === selectedSeq) || localBuildings[0]
    );
  }, [localBuildings, selectedSeq]);

  const handleSelectChange = async (seq: string) => {
    setSelectedSeq(seq);
    const next = localBuildings.find((b) => field(b, 'bldrgst_seqno') === seq);
    if (!next || localMode === 'recap') return;
    setBusy(true);
    try {
      const floors = await fetchBuildingFloorList({
        type: field(next, 'type'),
        seqNo: seq,
        pnu,
        source,
      });
      setLocalChildren(floors);
    } finally {
      setBusy(false);
    }
  };

  const handleDongLookup = async (bldNm: string) => {
    if (!pnu) return;
    if (!showBack && isRecapRegisterView(selected, localMode)) {
      recapSnapshotRef.current = {
        buildings: localBuildings,
        children: localChildren,
        mode: localMode,
        selectedSeq: selectedSeq || field(localBuildings[0], 'bldrgst_seqno'),
      };
    }
    setBusy(true);
    try {
      const res = await fetchBuildingRegisterByDong({ pnu, bldNm, source });
      if (!res.buildings.length) return;
      setLocalBuildings(res.buildings);
      setLocalChildren(res.children);
      setLocalMode('title');
      setSelectedSeq(field(res.buildings[0], 'bldrgst_seqno'));
      setShowBack(true);
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    const snap = recapSnapshotRef.current;
    if (snap) {
      setLocalBuildings(snap.buildings);
      setLocalChildren(snap.children);
      setLocalMode(snap.mode);
      setSelectedSeq(snap.selectedSeq || field(snap.buildings[0], 'bldrgst_seqno'));
      recapSnapshotRef.current = null;
    }
    setShowBack(false);
    onResetRoot?.();
  };

  if (fetching) return <p className="text-xs text-muted-foreground">건축물대장 조회 중...</p>;
  if (!localBuildings.length) {
    return (
      <div className="space-y-2">
        {notice ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            {notice}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">조회 결과가 없습니다.</p>
        )}
      </div>
    );
  }

  const typeLabel = field(selected, 'type') || (localMode === 'recap' ? '총괄표제부' : '표제부');
  const recapView = isRecapRegisterView(selected, localMode);

  return (
    <div className="min-h-full flex flex-col space-y-3">
      {notice ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          {notice}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-foreground">
          건축물대장 {ledgerTypeLabel(typeLabel)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
        {showBack ? (
          <button
            type="button"
            className="whitespace-nowrap rounded border border-primary bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
            onClick={handleBack}
            title="총괄"
          >
            ← 총괄
          </button>
        ) : localBuildings.length > 0 ? (
          <select
            className="max-w-[14rem] rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground"
            value={selectedSeq}
            onChange={(e) => void handleSelectChange(e.target.value)}
          >
            {localBuildings.map((item, i) => {
              const seq = field(item, 'bldrgst_seqno', 'mgmBldrgstPk') || String(i);
              const label = selectOptionText(
                ledgerTypeLabel(field(item, 'type')),
                `${field(item, 'bld_nm', 'bldNm')} ${field(item, 'dong_nm', 'dongNm')}`.trim() ||
                  fmt(item.totarea || item.totArea, '㎡')
              );
              return (
                <option key={seq} value={seq}>
                  {label}
                </option>
              );
            })}
          </select>
        ) : null}
        {busy ? <span className="text-[10px] text-muted-foreground">불러오는 중…</span> : null}
        </div>
      </div>

      {selected ? (
        recapView ? <RecapDetail data={selected} /> : <TitleDetail data={selected} />
      ) : null}

      {selected ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground">
            {recapView ? '개별 건축물현황' : '층별 건축물현황'}
          </p>
          <ChildListTable
            mode={recapView ? 'recap' : 'title'}
            childRows={localChildren}
            onDongLookup={recapView ? handleDongLookup : undefined}
          />
        </div>
      ) : null}
      <BuildingDataSourceLine className="text-right" sources={[source]} />
    </div>
  );
}

export function BuildingPermitPanel({
  fetching,
  notice,
  source,
  rows,
}: {
  fetching: boolean;
  notice?: string | null;
  source: BuildingPermitSource;
  rows: BuildingLedgerRow[];
}) {
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    const first = rows[0];
    setSelectedKey(field(first, 'pmsrgst_seqno', 'hsrgst_seqno', 'mgmPmsrgstPk', 'mgmHsrgstPk'));
  }, [rows]);

  const selected = useMemo(() => {
    if (!rows.length) return undefined;
    return (
      rows.find(
        (r) =>
          field(r, 'pmsrgst_seqno') === selectedKey ||
          field(r, 'hsrgst_seqno') === selectedKey ||
          field(r, 'mgmPmsrgstPk') === selectedKey ||
          field(r, 'mgmHsrgstPk') === selectedKey
      ) || rows[0]
    );
  }, [rows, selectedKey]);

  if (fetching) return <p className="text-xs text-muted-foreground">건축인허가 조회 중...</p>;
  if (!rows.length) {
    return (
      <div className="space-y-2">
        {notice ? (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {notice}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">건축/주택 인허가 데이터가 없습니다.</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col space-y-3">
      {notice ? (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {notice}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-foreground">건축허가대장</p>
        {rows.length > 0 ? (
          <select
            className="max-w-[14rem] shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {rows.map((item, i) => {
              const key =
                field(item, 'pmsrgst_seqno', 'hsrgst_seqno', 'mgmPmsrgstPk', 'mgmHsrgstPk') ||
                String(i);
              const label = selectOptionText(
                field(item, 'pmsrgst_gb_cd_nm', 'pmsno_gb_cd_nm', 'pmsGbCdNm', 'archPmsGbCdNm'),
                field(item, 'bld_nm', 'bldNm') ||
                  fmt(item.totarea || item.totArea, '㎡') ||
                  field(item, 'bjdong_cd_nm', 'bjdongCdNm')
              );
              return (
                <option
                  key={key}
                  value={field(item, 'pmsrgst_seqno', 'hsrgst_seqno', 'mgmPmsrgstPk', 'mgmHsrgstPk')}
                >
                  {label}
                </option>
              );
            })}
          </select>
        ) : null}
      </div>

      {selected ? (
        <DetailTable>
          <tr>
            <ThTd
              label="일련번호"
              value={fmt(
                field(
                  selected,
                  'pmsrgst_seqno',
                  'hsrgst_seqno',
                  'mgmPmsrgstPk',
                  'mgmHsrgstPk',
                  'mgm_pmsrgst_pk'
                )
              )}
              colSpan={3}
            />
          </tr>
          <tr>
            <ThTd label="건물명" value={fmt(field(selected, 'bld_nm', 'bldNm'))} />
            <ThTd
              label="건축허가일"
              value={fmt(field(selected, 'arch_pms_date', 'archPmsDay', 'apprv_date', 'apprvDay'))}
            />
          </tr>
          <tr>
            <ThTd label="지번" value={jibunText(selected)} />
            <ThTd
              label="대지위치"
              value={platLocText(selected)}
            />
          </tr>
          <tr>
            <ThTd
              label="건축구분명"
              value={fmt(field(selected, 'arch_gb_cd_nm', 'archGbCdNm', 'hs_biz_gb_cd_nm', 'hsBizGbCdNm'))}
            />
            <ThTd
              label="주용도"
              value={fmt(
                field(selected, 'main_prpos_cd_nm', 'mainPurpsCdNm', 'prpos_cd_nm', 'purpsCdNm')
              )}
            />
          </tr>
          <tr>
            <ThTd label="대지면적(㎡)" value={fmt(field(selected, 'plat_area', 'platArea'), '㎡')} />
            <ThTd label="전용면적(㎡)" value={fmt(field(selected, 'exuse_area', 'exuseArea'), '㎡')} />
          </tr>
          <tr>
            <ThTd label="연면적(㎡)" value={fmt(field(selected, 'totarea', 'totArea'), '㎡')} />
            <ThTd label="건축면적(㎡)" value={fmt(field(selected, 'arch_area', 'archArea'), '㎡')} />
          </tr>
          <tr>
            <ThTd label="건폐율" value={fmt(field(selected, 'bcrat', 'bcRat'), '%')} />
            <ThTd label="용적률" value={fmt(field(selected, 'vlrat', 'vlRat'), '%')} />
          </tr>
          <tr>
            <ThTd
              label="용적률 산정용 연면적"
              value={fmt(field(selected, 'vlrat_calc_totarea', 'vlRatEstmTotArea', 'vlRatCalcTotArea'), '㎡')}
            />
            <ThTd label="호수" value={fmt(field(selected, 'ho_cnt', 'hoCnt', 'tot_ho_cnt', 'totHoCnt'))} />
          </tr>
          <tr>
            <ThTd label="가구수" value={fmt(field(selected, 'fmly_cnt', 'fmlyCnt', 'tot_fmly_cnt', 'totFmlyCnt'))} />
            <ThTd
              label="세대수"
              value={fmt(field(selected, 'hhldcnt', 'hhldCnt', 'tot_hhldcnt', 'totHhldCnt'))}
            />
          </tr>
          <tr>
            <ThTd label="주건축물수" value={fmt(field(selected, 'main_bild_cnt', 'mainBldCnt', 'mainBildCnt'))} />
            <ThTd label="허가취소여부" value={fmt(field(selected, 'pms_cancl_yn', 'pmsCanclYn'))} />
          </tr>
          <tr>
            <ThTd
              label="허가취소일자"
              value={fmt(field(selected, 'pms_cancl_date', 'pmsCanclDate', 'apprv_cancl_date'))}
            />
            <ThTd
              label="취소사유"
              value={fmt(field(selected, 'cancl_resn', 'canclResn', 'apprv_cancl_resn'))}
            />
          </tr>
          <tr>
            <ThTd
              label="착공예정일"
              value={fmt(field(selected, 'stcns_prrng_date', 'stcnsPrrngDay', 'stcnsSchedDay'))}
            />
            <ThTd
              label="착공연기일"
              value={fmt(field(selected, 'stcns_delay_date', 'stcnsDelayDate'))}
            />
          </tr>
          <tr>
            <ThTd
              label="실제착공일"
              value={fmt(
                field(selected, 'real_stcns_date', 'realStcnsDay', 'stcns_date', 'stcnsDay')
              )}
            />
            <ThTd
              label="사용승인일"
              value={fmt(field(selected, 'useapr_date', 'useAprDay', 'use_inspt_date', 'useInsptDay'))}
            />
          </tr>
          <tr>
            <ThTd label="블록번호" value={fmt(field(selected, 'block_no', 'blockNo'))} />
            <ThTd label="로트번호" value={fmt(field(selected, 'lot_no', 'lotNo'))} />
          </tr>
        </DetailTable>
      ) : null}
      <BuildingDataSourceLine
        className="text-right"
        sources={[source === 'arch' || source === 'housing' ? 'portal' : source]}
      />
    </div>
  );
}
