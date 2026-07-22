'use client';

import { useState } from 'react';
import { Download, MapPinned, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import {
  emptyDraft,
  SHOOT_TYPE_LABEL,
  type ShootType,
  type ShootingRequestDraft,
} from './shootingRequestMockData';
import { ScopeDrawMapDialog, type ScopeDrawResult } from './ScopeDrawMapDialog';
import { downloadShootingRequestDocument } from './shootingRequestDocument';

type Props = {
  initial?: ShootingRequestDraft | null;
  readOnly?: boolean;
  onSubmit?: (
    draft: Omit<ShootingRequestDraft, 'id' | 'submittedAt' | 'status' | 'rejectReason' | 'decidedAt'>
  ) => void;
  /** 목록으로 돌아가기·패널 닫기 */
  onClose: () => void;
  closeLabel?: string;
  /** true면 하단 내려받기·제출·닫기 숨김 (승인관리 하단 버튼과 중복 방지) */
  hideFooterActions?: boolean;
  /** true면 헤더 X 숨김 (신청 상세 패널에 이미 닫기가 있을 때) */
  hideHeaderClose?: boolean;
};

const cellBorder = 'border border-slate-300';
const labelCell =
  'bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-slate-700 align-middle whitespace-nowrap';
const valueCell = 'bg-white px-2 py-1.5 align-middle';

export function ShootingRequestForm({
  initial,
  readOnly = false,
  onSubmit,
  onClose,
  closeLabel = '목록으로',
  hideFooterActions = false,
  hideHeaderClose = false,
}: Props) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          department: initial.department,
          applicantRankName: initial.applicantRankName,
          phone: initial.phone,
          manager: initial.manager,
          purpose: initial.purpose,
          address: initial.address,
          hasScope: initial.hasScope,
          scopeLabel: initial.scopeLabel,
          scopeWkt: initial.scopeWkt ?? '',
          shootDate: initial.shootDate,
          useDate: initial.useDate,
          shootType: initial.shootType,
          detailRequest: initial.detailRequest,
        }
      : emptyDraft()
  );
  const [scopeMapOpen, setScopeMapOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  const startDraw = () => {
    if (readOnly) return;
    setScopeMapOpen(true);
  };

  const handleScopeConfirm = (result: ScopeDrawResult) => {
    setForm((prev) => ({
      ...prev,
      hasScope: true,
      scopeLabel: result.scopeLabel,
      scopeWkt: result.wkt5181,
    }));
    setNotice('촬영지역 범위가 반영되었습니다.');
  };

  const clearScope = () => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, hasScope: false, scopeLabel: '', scopeWkt: '' }));
    setNotice(null);
  };

  const handleSubmit = () => {
    if (readOnly) return;
    if (!form.hasScope) {
      setNotice('촬영지역 범위를 먼저 지정하세요.');
      return;
    }
    if (!form.department.trim() || !form.applicantRankName.trim() || !form.purpose.trim()) {
      setNotice('부서명·신청자·신청목적을 입력하세요.');
      return;
    }
    onSubmit?.(form);
    setNotice('신청이 접수되었습니다. (목업 · 서버 저장 없음)');
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadShootingRequestDocument({
        department: form.department,
        applicantRankName: form.applicantRankName,
        phone: form.phone,
        manager: form.manager,
        purpose: form.purpose,
        address: form.address,
        hasScope: form.hasScope,
        scopeLabel: form.scopeLabel,
        shootDate: form.shootDate,
        useDate: form.useDate,
        shootType: form.shootType,
        detailRequest: form.detailRequest,
      });
    } catch {
      setNotice('PDF 내려받기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setDownloading(false);
    }
  };

  const shootTypes = (Object.keys(SHOOT_TYPE_LABEL) as ShootType[]).map((id, i) => ({
    id,
    label: `${i + 1}. ${SHOOT_TYPE_LABEL[id]}`,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] text-slate-400">[별지 제3호서식]</p>
          <h2 className="text-[13px] font-semibold leading-snug text-slate-900">
            무인비행장치 촬영신청서
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-400">(제14조 제1항 관련)</p>
        </div>
        {hideHeaderClose ? null : (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title={closeLabel}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">신청 정보</h3>
          <table className={cn('w-full border-collapse text-[11px]', cellBorder)}>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'w-[5.5rem]')}>부서명</th>
                <td className={cn(valueCell, cellBorder)} colSpan={3}>
                  <Input
                    value={form.department}
                    onChange={(e) => setField('department', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                    placeholder="부서명"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)} rowSpan={2}>
                  신청자
                </th>
                <th className={cn(labelCell, cellBorder, 'w-[5.5rem]')}>직급/성명</th>
                <td className={cn(valueCell, cellBorder)} colSpan={2}>
                  <Input
                    value={form.applicantRankName}
                    onChange={(e) => setField('applicantRankName', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                    placeholder="직급 · 성명"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>전화번호</th>
                <td className={cn(valueCell, cellBorder)} colSpan={2}>
                  <Input
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                    placeholder="연락처"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>관리자</th>
                <td className={cn(valueCell, cellBorder)} colSpan={3}>
                  <Input
                    value={form.manager}
                    onChange={(e) => setField('manager', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                    placeholder="관리자"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">항공영상 촬영 요청내용</h3>
          <table className={cn('w-full border-collapse text-[11px]', cellBorder)}>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'w-[5.5rem]')}>신청목적</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={form.purpose}
                    onChange={(e) => setField('purpose', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                    placeholder="신청 목적"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>
                  촬영지역
                  <br />
                  <span className="font-normal text-slate-400">(위치도)</span>
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className="space-y-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[10px] text-slate-500">- 지번</span>
                      <Input
                        value={form.address}
                        onChange={(e) => setField('address', e.target.value)}
                        disabled={readOnly}
                        className="h-8 flex-1 border-slate-200 text-[11px]"
                        placeholder="예: 방어동"
                      />
                    </div>

                    <div
                      className={cn(
                        'relative overflow-hidden rounded-md border border-dashed',
                        form.hasScope
                          ? 'border-emerald-400 bg-emerald-50/80'
                          : 'border-slate-300 bg-slate-50'
                      )}
                    >
                      <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 p-3 text-center">
                        <MapPinned
                          className={cn(
                            'h-7 w-7',
                            form.hasScope ? 'text-emerald-600' : 'text-slate-300'
                          )}
                        />
                        {form.hasScope ? (
                          <>
                            <p className="text-[11px] font-medium text-emerald-800">{form.scopeLabel}</p>
                            <p className="text-[10px] text-emerald-700/80">
                              지도에 범위가 표시됩니다 (목업)
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-slate-500">촬영 범위를 지도에 그려 주세요</p>
                            <p className="text-[10px] text-slate-400">위치도 · 범위 미지정</p>
                          </>
                        )}
                      </div>
                    </div>

                    {!readOnly ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 px-2.5 text-[11px]"
                          onClick={startDraw}
                        >
                          <MapPinned className="h-3.5 w-3.5" />
                          {form.hasScope ? '범위 다시 그리기' : '범위 그리기'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2.5 text-[11px] text-slate-500"
                          onClick={clearScope}
                          disabled={!form.hasScope}
                        >
                          초기화
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>촬영요청 기간</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    type="date"
                    value={form.shootDate}
                    onChange={(e) => setField('shootDate', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>사용일</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    type="date"
                    value={form.useDate}
                    onChange={(e) => setField('useDate', e.target.value)}
                    disabled={readOnly}
                    className="h-8 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>촬영형태</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-1">
                    {shootTypes.map((t) => (
                      <label
                        key={t.id}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1.5 text-[11px]',
                          readOnly && 'cursor-default'
                        )}
                      >
                        <input
                          type="radio"
                          name="shootType"
                          checked={form.shootType === t.id}
                          disabled={readOnly}
                          onChange={() => setField('shootType', t.id)}
                          className="accent-sky-700"
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>상세요청사항</th>
                <td className={cn(valueCell, cellBorder)}>
                  <textarea
                    value={form.detailRequest}
                    onChange={(e) => setField('detailRequest', e.target.value)}
                    disabled={readOnly}
                    rows={3}
                    className="w-full resize-none border-0 bg-transparent px-1 py-1 text-[11px] outline-none placeholder:text-slate-400 disabled:opacity-70"
                    placeholder="추가 요청 사항"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <h3 className="mb-1.5 text-[11px] font-semibold text-slate-800">촬영영상 안내</h3>
          <ol className="list-decimal space-y-1 pl-4 text-[10px] leading-relaxed text-slate-600">
            <li>
              항공사진 보안 규정에 의거 별도의 승인이 없이는 행정내부용 자료로만 활용 가능
            </li>
            <li>촬영지역에 따라 일부 불가(비행금지구역 등 비승인 지역 존재)</li>
            <li>담당 부서(관리부서): 토지정보과</li>
          </ol>
        </section>

        {notice ? (
          <p
            className={cn(
              'rounded-md border px-2.5 py-2 text-[10px] leading-relaxed',
              notice.includes('접수') || notice.includes('반영')
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            )}
          >
            {notice}
          </p>
        ) : null}
      </div>

      {!hideFooterActions ? (
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50/80 px-3 py-2.5">
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
          {!readOnly ? (
            <Button type="button" size="sm" className="h-8 px-3 text-[11px]" onClick={handleSubmit}>
              제출
            </Button>
          ) : null}
        </div>
      ) : null}

      {!readOnly ? (
        <ScopeDrawMapDialog
          open={scopeMapOpen}
          onOpenChange={setScopeMapOpen}
          onConfirm={handleScopeConfirm}
        />
      ) : null}
    </div>
  );
}
