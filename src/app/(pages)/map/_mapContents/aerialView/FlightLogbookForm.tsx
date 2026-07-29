'use client';

import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { Input } from '@/app/shadcnComponents/ui/input';
import { downloadFlightLogbookDocument } from './flightLogbookDocument';

export type FlightLogbookValues = {
  dateFlightTime: string;
  shootTargetPurpose: string;
  aircraftModel: string;
  pilotOrg: string;
  pilotName: string;
  gimbalOrg: string;
  gimbalName: string;
  flightArea: string;
  permissionControl: string;
  aircraftCondition: 'good' | 'inspect' | '';
  cameraCondition: 'good' | 'inspect' | '';
  safetyDone: boolean;
  flightSummary: string;
  securityDone: boolean;
  securityDetail: string;
  etc: string;
};

const EMPTY: FlightLogbookValues = {
  dateFlightTime: '',
  shootTargetPurpose: '',
  aircraftModel: '',
  pilotOrg: '',
  pilotName: '',
  gimbalOrg: '',
  gimbalName: '',
  flightArea: '',
  permissionControl: '',
  aircraftCondition: '',
  cameraCondition: '',
  safetyDone: false,
  flightSummary: '',
  securityDone: false,
  securityDetail: '',
  etc: '',
};

function valuesFromApi(item: Record<string, unknown> | null | undefined): FlightLogbookValues {
  if (!item) return EMPTY;
  const cond = (x: unknown): 'good' | 'inspect' | '' =>
    x === 'good' || x === 'inspect' ? x : '';
  return {
    dateFlightTime: String(item.dateFlightTime ?? ''),
    shootTargetPurpose: String(item.shootTargetPurpose ?? ''),
    aircraftModel: String(item.aircraftModel ?? ''),
    pilotOrg: String(item.pilotOrg ?? ''),
    pilotName: String(item.pilotName ?? ''),
    gimbalOrg: String(item.gimbalOrg ?? ''),
    gimbalName: String(item.gimbalName ?? ''),
    flightArea: String(item.flightArea ?? ''),
    permissionControl: String(item.permissionControl ?? ''),
    aircraftCondition: cond(item.aircraftCondition),
    cameraCondition: cond(item.cameraCondition),
    safetyDone: item.safetyDone === true,
    flightSummary: String(item.flightSummary ?? ''),
    securityDone: item.securityDone === true,
    securityDetail: String(item.securityDetail ?? ''),
    etc: String(item.etc ?? ''),
  };
}

export type FlightLogbookFormHandle = {
  reset: () => void;
  submit: () => Promise<void>;
  /** @deprecated use submit */
  submitMock: () => Promise<void>;
  downloadDocument: () => Promise<void>;
};

type Props = {
  workUnitLabel?: string;
  /** 촬영요청 키 — 있으면 저장·조회에 사용 */
  srKey?: number | null;
  onClose?: () => void;
  /** true면 헤더·하단 액션 최소화 (승인 디테일 임베드용) */
  embedded?: boolean;
  /** true면 폼 안 버튼 숨김 — 부모 푸터에서 제어 */
  hideActions?: boolean;
  /** 임베드 제목 옆 보조 액션 */
  headerAction?: ReactNode;
  /** 저장 성공 시 */
  onSaved?: () => void;
};

/** 촬영신청서와 동일 톤·여백 (패널 폭 ~520px 기준) */
const cellBorder = 'border border-slate-300';
const labelCell =
  'bg-slate-50 px-2 py-0.5 text-center text-[10px] font-medium leading-snug text-slate-700 align-middle';
const valueCell = 'bg-white px-1.5 py-0 align-middle';
const subLabel =
  'bg-slate-50/80 px-1.5 py-0.5 text-center text-[10px] font-medium leading-snug text-slate-600 align-middle';
const field =
  '!h-6 !min-h-0 border-0 bg-transparent px-1 py-0 text-[11px] shadow-none focus-visible:ring-0';
const checkRow = 'flex h-6 items-center gap-x-3 text-[11px] text-slate-700';
const sectionTitle = 'mb-1 text-[11px] font-semibold text-slate-800';

export const FlightLogbookForm = forwardRef<FlightLogbookFormHandle, Props>(function FlightLogbookForm(
  { workUnitLabel, srKey, onClose, embedded = false, hideActions = false, headerAction, onSaved },
  ref
) {
  const [v, setV] = useState<FlightLogbookValues>(EMPTY);
  const [flKey, setFlKey] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof FlightLogbookValues>(key: K, value: FlightLogbookValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  useEffect(() => {
    const key = srKey != null && Number.isFinite(srKey) ? Number(srKey) : null;
    if (key == null) {
      setV(EMPTY);
      setFlKey(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void call('', 'POST', {
      service: 'flightLogbookService',
      action: 'getBySrKey',
      params: { srKey: key },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const item = data?.item as Record<string, unknown> | null | undefined;
        setV(valuesFromApi(item));
        setFlKey(item?.flKey != null ? Number(item.flKey) : null);
      })
      .catch(() => {
        if (cancelled) return;
        setV(EMPTY);
        setFlKey(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [srKey]);

  const handleReset = () => {
    setV(EMPTY);
    setNotice(null);
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFlightLogbookDocument(v, { workUnitLabel: workUnitLabel || undefined });
    } catch {
      setNotice('PDF 내려받기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const key = srKey != null && Number.isFinite(srKey) ? Number(srKey) : null;
    if (key == null && !workUnitLabel?.trim()) {
      setNotice('연결할 신청 또는 작업단위가 없습니다.');
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const data = await call('', 'POST', {
        service: 'flightLogbookService',
        action: 'save',
        params: {
          ...(flKey != null ? { flKey } : {}),
          ...(key != null ? { srKey: key } : {}),
          ...(workUnitLabel?.trim() ? { workUnitLabel: workUnitLabel.trim() } : {}),
          ...v,
        },
      });
      const item = (data?.data ?? data)?.item as Record<string, unknown> | undefined;
      if (item?.flKey != null) setFlKey(Number(item.flKey));
      setNotice('비행기록부가 저장되었습니다.');
      onSaved?.();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '비행기록부 저장에 실패했습니다.';
      setNotice(msg || '비행기록부 저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  useImperativeHandle(ref, () => ({
    reset: handleReset,
    submit: handleSubmit,
    submitMock: handleSubmit,
    downloadDocument: handleDownload,
  }));

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col bg-white',
        /* 임베드: 부모 패널 스크롤만 사용 (이중 스크롤 방지) */
        embedded ? 'h-auto' : 'h-full'
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold leading-snug text-slate-900">
            무인비행장치 비행기록부
          </h2>
          {loading ? (
            <p className="mt-0.5 text-[10px] text-slate-400">불러오는 중…</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerAction}
          {!embedded && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'space-y-2 px-2.5 py-2',
          embedded ? '' : 'min-h-0 flex-1 overflow-y-auto'
        )}
      >
        {/* 기본 */}
        <section>
          <h3 className={sectionTitle}>비행 정보</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[6.5rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  일자 · 비행시간
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.dateFlightTime}
                    onChange={(e) => set('dateFlightTime', e.target.value)}
                    placeholder="일자 · 비행시간"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  촬영대상 · 목적
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.shootTargetPurpose}
                    onChange={(e) => set('shootTargetPurpose', e.target.value)}
                    placeholder="촬영대상 · 목적"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  기종
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.aircraftModel}
                    onChange={(e) => set('aircraftModel', e.target.value)}
                    placeholder="기종"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  비행지역
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.flightArea}
                    onChange={(e) => set('flightArea', e.target.value)}
                    placeholder="비행지역"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  허가 · 통제사항
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.permissionControl}
                    onChange={(e) => set('permissionControl', e.target.value)}
                    placeholder="허가 통제사항"
                    className={field}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 조종자 — 촬영신청서 신청자 행과 동일 2열 패턴 */}
        <section>
          <h3 className={sectionTitle}>조종자</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[5rem]" />
              <col className="w-[5.5rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'align-middle')} rowSpan={2} scope="row">
                  파일럿
                </th>
                <th className={cn(subLabel, cellBorder)}>소속</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.pilotOrg}
                    onChange={(e) => set('pilotOrg', e.target.value)}
                    placeholder="소속"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(subLabel, cellBorder)}>성명</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.pilotName}
                    onChange={(e) => set('pilotName', e.target.value)}
                    placeholder="성명"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder, 'align-middle')} rowSpan={2} scope="row">
                  짐벌
                </th>
                <th className={cn(subLabel, cellBorder)}>소속</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.gimbalOrg}
                    onChange={(e) => set('gimbalOrg', e.target.value)}
                    placeholder="소속"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(subLabel, cellBorder)}>성명</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.gimbalName}
                    onChange={(e) => set('gimbalName', e.target.value)}
                    placeholder="성명"
                    className={field}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 점검 */}
        <section>
          <h3 className={sectionTitle}>점검</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[5.5rem]" />
              <col className="w-[7rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'align-middle')} rowSpan={3} scope="row">
                  비행전
                  <br />
                  점검
                </th>
                <th className={cn(subLabel, cellBorder)}>비행체 상태</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className={checkRow}>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.aircraftCondition === 'good'}
                        onChange={() =>
                          set('aircraftCondition', v.aircraftCondition === 'good' ? '' : 'good')
                        }
                      />
                      상태 양호
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.aircraftCondition === 'inspect'}
                        onChange={() =>
                          set(
                            'aircraftCondition',
                            v.aircraftCondition === 'inspect' ? '' : 'inspect'
                          )
                        }
                      />
                      점검 요망
                    </label>
                  </div>
                </td>
              </tr>
              <tr>
                <th className={cn(subLabel, cellBorder)}>촬영장비 상태</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className={checkRow}>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.cameraCondition === 'good'}
                        onChange={() =>
                          set('cameraCondition', v.cameraCondition === 'good' ? '' : 'good')
                        }
                      />
                      상태 양호
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.cameraCondition === 'inspect'}
                        onChange={() =>
                          set(
                            'cameraCondition',
                            v.cameraCondition === 'inspect' ? '' : 'inspect'
                          )
                        }
                      />
                      점검 요망
                    </label>
                  </div>
                </td>
              </tr>
              <tr>
                <th className={cn(subLabel, cellBorder)}>안전조치</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className={checkRow}>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.safetyDone}
                        onChange={(e) => set('safetyDone', e.target.checked)}
                      />
                      완료
                    </label>
                  </div>
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder, 'align-middle')} scope="row">
                  비행후
                  <br />
                  점검
                </th>
                <th className={cn(subLabel, cellBorder)}>
                  촬영자료
                  <br />
                  보안조치
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.securityDetail}
                    onChange={(e) => {
                      const next = e.target.value;
                      setV((prev) => ({
                        ...prev,
                        securityDetail: next,
                        securityDone: next.trim().length > 0,
                      }));
                    }}
                    placeholder="보안조치 내용"
                    className={field}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 요약 */}
        <section>
          <h3 className={sectionTitle}>요약 · 기타</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[6.5rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  비행 · 촬영요약
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.flightSummary}
                    onChange={(e) => set('flightSummary', e.target.value)}
                    placeholder="비행 촬영요약"
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
                  기타
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={v.etc}
                    onChange={(e) => set('etc', e.target.value)}
                    placeholder="기타"
                    className={field}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {!hideActions ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-slate-200 bg-slate-50/80 px-3 py-1.5">
          {notice ? (
            <p
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[10px]',
                notice.includes('저장')
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              )}
            >
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50 disabled:opacity-50"
              disabled={downloading || submitting}
              onClick={() => void handleDownload()}
            >
              {downloading ? 'PDF 생성 중…' : 'PDF 내려받기'}
            </button>
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50 disabled:opacity-50"
              disabled={submitting || loading}
              onClick={() => void handleSubmit()}
            >
              {submitting ? '저장 중…' : '기록부 제출'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
