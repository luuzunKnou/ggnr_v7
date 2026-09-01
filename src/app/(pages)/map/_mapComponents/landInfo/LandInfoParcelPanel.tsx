'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import {
  fetchParcelLandModalList,
  fetchParcelTabData,
  type ParcelLandModalKind,
  type ParcelTabData,
} from './api';
import {
  BuildingDataSourceLine,
  LandLinkageLegendText,
  ParcelLandLinkageSourceText,
  ParcelLinkageValueText,
} from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
import type { ParcelLandRowSource } from '@/lib/parcelLandNormalize';
import { cn } from '@/lib/utils';
import { LAND_INFO_MODAL_Z } from './landInfoModalZ';

const PRICE_MODAL_HEADERS = ['공시지가', '공시일자', '기준년도', '기준월', '지번', '비고'] as const;

const MODAL_TITLES: Record<Exclude<ParcelLandModalKind, never>, string> = {
  price: '공시지가 조회',
  move: '이동일자 연혁조회',
  share: '공유인 조회',
  change: '변동일자 연혁조회',
};

function toText(value: unknown): string {
  if (value == null) return '-';
  const t = String(value).trim();
  return t || '-';
}

function toNumText(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('ko-KR');
}

function getField(row: Record<string, unknown> | undefined, keys: string[], fallback = '-'): string {
  if (!row) return fallback;
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return fallback;
}

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

function composeFullJibunFromRow(row: Record<string, unknown> | undefined): string {
  if (!row) return '';
  const ld = String(row.ldCodeNm ?? '').trim();
  const lot = String(row.mnnmSlno ?? '').trim();
  if (ld && lot) return `${ld} ${lot}`;
  return ld || String(row.jibun ?? '').trim();
}

function DataTable({
  headers,
  rows,
  linkageSource,
  nowrap = false,
}: {
  headers: string[];
  rows: string[][];
  linkageSource?: ParcelLandRowSource;
  nowrap?: boolean;
}) {
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
          {rows.map((row, idx) => (
            <tr key={`${idx}-${row.join('|')}`} className="odd:bg-background even:bg-muted/40">
              {row.map((cell, cidx) => (
                <td
                  key={`${idx}-${cidx}`}
                  className={cn(
                    'border-b border-r border-border px-2.5 py-1.5 align-middle text-foreground last:border-r-0',
                    wrapClass
                  )}
                >
                  <ParcelLinkageValueText value={cell} source={linkageSource} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
        <button
          type="button"
          className="shrink-0 text-[11px] px-2 py-0.5 border rounded border-border hover:bg-muted"
          onClick={onClick}
          title={button}
        >
          {button}
        </button>
      </div>
    </>
  );
}

export type LandInfoParcelPanelProps = {
  pnu: string;
  vworldKey: string;
  /** PNU·주소 resolve 중 */
  resolveLoading?: boolean;
  /** 부모가 조회한 데이터 — 우클릭 패널에서 중복 조회 방지 */
  parcelData?: ParcelTabData;
  parcelFetching?: boolean;
  parcelError?: string | null;
};

export function LandInfoParcelPanel({
  pnu,
  vworldKey,
  resolveLoading = false,
  parcelData: parcelDataProp,
  parcelFetching: parcelFetchingProp,
  parcelError: parcelErrorProp,
}: LandInfoParcelPanelProps) {
  const controlled = parcelDataProp !== undefined;
  const [internalData, setInternalData] = useState<ParcelTabData>({
    characteristics: [],
    landUses: [],
    prices: [],
    possessions: [],
  });
  const [internalFetching, setInternalFetching] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);

  const [modalKind, setModalKind] = useState<ParcelLandModalKind | null>(null);
  const [modalFetching, setModalFetching] = useState(false);
  const [modalHeaders, setModalHeaders] = useState<string[]>([]);
  const [modalRows, setModalRows] = useState<string[][]>([]);
  const [modalMessage, setModalMessage] = useState<string | null>(null);

  const parcelData = controlled ? parcelDataProp! : internalData;
  const parcelFetching = controlled ? (parcelFetchingProp ?? false) : internalFetching;
  const parcelError = controlled ? (parcelErrorProp ?? null) : internalError;

  useEffect(() => {
    if (controlled) return;
    const trimmed = String(pnu ?? '').trim();
    if (!trimmed || !vworldKey) return;
    let alive = true;
    setInternalFetching(true);
    setInternalError(null);
    fetchParcelTabData({ pnu: trimmed, vworldKey })
      .then((data) => {
        if (!alive) return;
        setInternalData(data);
        setInternalError(null);
      })
      .catch(() => {
        if (!alive) return;
        setInternalError('필지정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (alive) setInternalFetching(false);
      });
    return () => {
      alive = false;
    };
  }, [controlled, pnu, vworldKey]);

  const latestChar = parcelData.characteristics[0];
  const latestPrice = parcelData.prices[0];
  const latestPossession = parcelData.possessions[0];

  const shareCntRaw = getField(latestPossession, ['cnrsPsnCo', 'shareCnt'], '');
  const shareCntNum = Number(String(shareCntRaw).replace(/,/g, ''));
  const canOpenShare = Number.isFinite(shareCntNum) && shareCntNum > 0;
  const moveDate = getField(latestChar, ['lndMoveDe', 'landMoveDate'], '');
  const changeDate = getField(latestPossession, ['ownshipChgDe'], '');
  const canOpenMove = Boolean(moveDate && moveDate !== '-');
  const canOpenChange = Boolean(changeDate && changeDate !== '-');

  const openLandModal = async (kind: ParcelLandModalKind) => {
    const trimmed = String(pnu ?? '').trim();
    if (!trimmed) return;
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
      const res = await fetchParcelLandModalList({ pnu: trimmed, kind });
      setModalHeaders(res.headers);
      setModalRows(maskModalRows(kind, res.rows));
      setModalMessage(res.error || res.message || (res.rows.length ? null : '조회 결과가 없습니다.'));
    } catch {
      setModalMessage('조회에 실패했습니다.');
    } finally {
      setModalFetching(false);
    }
  };

  if (!String(pnu ?? '').trim()) {
    return <p className="text-xs text-rose-600">필지 PNU를 찾지 못했습니다.</p>;
  }

  if (resolveLoading || parcelFetching) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
      </div>
    );
  }

  if (parcelError) {
    return <p className="text-xs text-rose-600">{parcelError}</p>;
  }

  const hasNoLinkageRows =
    parcelData.characteristics.length === 0 &&
    parcelData.possessions.length === 0 &&
    parcelData.prices.length === 0;

  return (
    <>
      <div className="min-h-full flex flex-col">
        <div className="flex-1 space-y-3">
          {!parcelData.source && hasNoLinkageRows ? (
            <p className="text-[11px] text-muted-foreground">연계 데이터 없음</p>
          ) : null}
          {parcelData.source ? <ParcelLandLinkageSourceText source={parcelData.source} /> : null}
          {parcelData.krasSkipReason ? (
            <p className="text-[11px] leading-relaxed text-amber-800">
              행망 미사용: {parcelData.krasSkipReason}
            </p>
          ) : null}
          <LandLinkageLegendText source={parcelData.source} />
          <section className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">토지기본정보</p>
            <div className="grid grid-cols-[85px_1fr_85px_1fr] overflow-hidden rounded border border-border text-[12px]">
              <LinkageCell
                k="지목"
                v={getField(latestChar, ['lndcgrCodeNm', 'jimok'])}
                source={parcelData.source}
              />
              <LinkageCell
                k="면적"
                v={`${toNumText(getField(latestChar, ['lndpclAr', 'area'], '0'))}㎡`}
                source={parcelData.source}
              />
              <LinkageCell
                k="용도지역"
                v={getField(latestChar, ['prposArea1Nm', 'prposAreaDstrcCodeNm'])}
                source={parcelData.source}
              />
              <LinkageCell
                k="이동사유"
                v={getField(latestChar, ['lndMoveResnNm', 'landMoveReason'])}
                source={parcelData.source}
              />
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
              <LinkageCell
                k="소유구분"
                v={getField(latestPossession, ['posesnSeCodeNm'])}
                source={parcelData.source}
              />
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
              <LinkageCell
                k="변동원인"
                v={getField(latestPossession, ['ownshipChgCauseCodeNm'])}
                source={parcelData.source}
              />
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
        <DialogContent
          overlayClassName={LAND_INFO_MODAL_Z}
          className={cn(
            LAND_INFO_MODAL_Z,
            'flex max-h-[86vh] w-[960px] max-w-[94vw] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-card-foreground sm:max-w-[960px]'
          )}
        >
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
    </>
  );
}
