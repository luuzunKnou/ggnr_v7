'use client';

import { forwardRef, useImperativeHandle, useState, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
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

export type FlightLogbookFormHandle = {
  reset: () => void;
  submitMock: () => void;
  downloadDocument: () => Promise<void>;
};

type Props = {
  workUnitLabel?: string;
  onClose?: () => void;
  /** true면 헤더·하단 액션 최소화 (승인 디테일 임베드용) */
  embedded?: boolean;
  /** true면 폼 안 버튼 숨김 — 부모 푸터에서 제어 */
  hideActions?: boolean;
  /** 임베드 제목 옆 보조 액션 (예: 초기화 링크) */
  headerAction?: ReactNode;
};

/** 촬영신청서와 동일 톤·여백 (패널 폭 ~520px 기준) */
const cellBorder = 'border border-slate-300';
const labelCell =
  'bg-slate-50 px-3 py-2.5 text-center text-[11px] font-medium leading-snug text-slate-700 align-middle';
const valueCell = 'bg-white px-2.5 py-2 align-middle';
const subLabel =
  'bg-slate-50/80 px-2.5 py-2.5 text-center text-[11px] font-medium leading-snug text-slate-600 align-middle';
const field =
  'h-9 border-0 bg-transparent px-1.5 text-[12px] shadow-none focus-visible:ring-0';

export const FlightLogbookForm = forwardRef<FlightLogbookFormHandle, Props>(function FlightLogbookForm(
  { workUnitLabel, onClose, embedded = false, hideActions = false, headerAction },
  ref
) {
  const [v, setV] = useState<FlightLogbookValues>(EMPTY);
  const [downloading, setDownloading] = useState(false);

  const set = <K extends keyof FlightLogbookValues>(key: K, value: FlightLogbookValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => setV(EMPTY);
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFlightLogbookDocument(v, { workUnitLabel: workUnitLabel || undefined });
    } catch {
      window.alert('PDF 내려받기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setDownloading(false);
    }
  };
  const handleSubmit = () => window.alert('목업: 기록부 제출 (저장·API 없음)');

  useImperativeHandle(ref, () => ({
    reset: handleReset,
    submitMock: handleSubmit,
    downloadDocument: handleDownload,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] text-slate-400">[별지 제5호서식]</p>
          <h2 className="text-[13px] font-semibold leading-snug text-slate-900">
            무인비행장치 비행기록부
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-400">(제19조제4항 관련)</p>
          {workUnitLabel ? (
            <p className="mt-0.5 truncate text-[10px] text-slate-400">작업단위 · {workUnitLabel}</p>
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {/* 기본 */}
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">비행 정보</h3>
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
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">조종자</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[5rem]" />
              <col className="w-[5.5rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th
                  className={cn(labelCell, cellBorder, 'align-middle')}
                  rowSpan={2}
                  scope="row"
                >
                  <span className="inline-flex min-h-[4.5rem] w-full items-center justify-center">
                    파일럿
                  </span>
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
                <th
                  className={cn(labelCell, cellBorder, 'align-middle')}
                  rowSpan={2}
                  scope="row"
                >
                  <span className="inline-flex min-h-[4.5rem] w-full items-center justify-center">
                    짐벌
                  </span>
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
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">점검</h3>
          <table className={cn('w-full table-fixed border-collapse text-[11px]', cellBorder)}>
            <colgroup>
              <col className="w-[5.5rem]" />
              <col className="w-[7rem]" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder)} rowSpan={3} scope="row">
                  비행전
                  <br />
                  점검
                </th>
                <th className={cn(subLabel, cellBorder)}>비행체 상태</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-0.5 text-[12px] text-slate-700">
                    <label className="inline-flex items-center gap-1.5">
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
                    <label className="inline-flex items-center gap-1.5">
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
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-0.5 text-[12px] text-slate-700">
                    <label className="inline-flex items-center gap-1.5">
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
                    <label className="inline-flex items-center gap-1.5">
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
                  <label className="inline-flex items-center gap-1.5 py-0.5 text-[12px] text-slate-700">
                    <input
                      type="checkbox"
                      className="accent-sky-700"
                      checked={v.safetyDone}
                      onChange={(e) => set('safetyDone', e.target.checked)}
                    />
                    완료
                  </label>
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} scope="row">
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
                  <div className="flex flex-col gap-2 py-0.5">
                    <label className="inline-flex items-center gap-1.5 text-[12px] text-slate-700">
                      <input
                        type="checkbox"
                        className="accent-sky-700"
                        checked={v.securityDone}
                        onChange={(e) => set('securityDone', e.target.checked)}
                      />
                      완료
                    </label>
                    <Input
                      value={v.securityDetail}
                      onChange={(e) => set('securityDetail', e.target.value)}
                      placeholder="보안조치 내용"
                      className="h-9 border-slate-200 text-[12px]"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 요약 */}
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">요약 · 기타</h3>
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
                  <textarea
                    value={v.flightSummary}
                    onChange={(e) => set('flightSummary', e.target.value)}
                    rows={3}
                    className="w-full resize-none border-0 bg-transparent px-1.5 py-1.5 text-[12px] outline-none placeholder:text-slate-400"
                    placeholder="비행 촬영요약"
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5 text-[11px]"
            disabled={downloading}
            onClick={() => void handleDownload()}
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? 'PDF 생성 중…' : 'PDF 내려받기'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-[11px]"
            onClick={handleReset}
          >
            초기화
          </Button>
          <Button type="button" size="sm" className="h-8 px-3 text-[11px]" onClick={handleSubmit}>
            기록부 제출
          </Button>
        </div>
      ) : null}
    </div>
  );
});
