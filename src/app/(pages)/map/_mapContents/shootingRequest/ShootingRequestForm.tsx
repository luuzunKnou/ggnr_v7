'use client';

import { useEffect, useState } from 'react';
import { MapPinned, X } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  emptyDraft,
  SHOOT_TYPE_LABEL,
  type ShootType,
  type ShootingRequestDraft,
} from './shootingRequestMockData';
import { ScopeDrawMapDialog, type ScopeDrawResult } from './ScopeDrawMapDialog';
import { ScopePreviewMap } from './ScopePreviewMap';
import { downloadShootingRequestDocument } from './shootingRequestDocument';
import { scopeMapToDataUrl } from './scopeMapToDataUrl';

function draftToFormState(initial: ShootingRequestDraft) {
  return {
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
  };
}

/** 그린 범위(WKT 5181)와 겹치는 읍·면·동 이름 */
async function fetchEmdNamesByWkt(wkt: string): Promise<string[]> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdNamesByWkt',
      params: { wkt },
    });
    const data = res?.data ?? res;
    if (!Array.isArray(data?.names)) return [];
    return data.names.map((n: unknown) => String(n).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

type Props = {
  initial?: ShootingRequestDraft | null;
  readOnly?: boolean;
  onSubmit?: (
    draft: Omit<ShootingRequestDraft, 'id' | 'submittedAt' | 'status' | 'rejectReason' | 'decidedAt'>
  ) => void | Promise<void>;
  /** 목록으로 돌아가기·패널 닫기 */
  onClose: () => void;
  closeLabel?: string;
  /** true면 하단 내려받기·제출·닫기 숨김 (승인관리 하단 버튼과 중복 방지) */
  hideFooterActions?: boolean;
  /** true면 헤더 X 숨김 (신청 상세 패널에 이미 닫기가 있을 때) */
  hideHeaderClose?: boolean;
};

const cellBorder = 'border border-border';
const labelCell =
  'bg-muted/30 px-2 py-1 text-[10px] font-medium text-foreground align-middle whitespace-nowrap';
const valueCell = 'bg-background px-1.5 py-0.5 align-middle';
const field =
  'h-7 border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-0';
const sectionTitle = 'mb-1 text-[11px] font-semibold text-foreground';

export function ShootingRequestForm({
  initial,
  readOnly = false,
  onSubmit,
  onClose,
  closeLabel = '목록으로',
  hideFooterActions = false,
  hideHeaderClose = false,
}: Props) {
  const [form, setForm] = useState(() => (initial ? draftToFormState(initial) : emptyDraft()));
  const [scopeMapOpen, setScopeMapOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 목록에는 범위 좌표가 없고 상세 조회 후에만 옴 → 도착 시 위치도·상세 필드 반영
  useEffect(() => {
    if (!initial) return;
    setForm((prev) => {
      const next = draftToFormState(initial);
      const detailArrived =
        (!!next.scopeWkt && next.scopeWkt !== prev.scopeWkt) ||
        (!!next.phone && next.phone !== prev.phone) ||
        (!!next.manager && next.manager !== prev.manager) ||
        (!!next.detailRequest && next.detailRequest !== prev.detailRequest) ||
        (!!next.address && next.address !== prev.address);
      if (!detailArrived && next.hasScope === prev.hasScope && next.scopeLabel === prev.scopeLabel) {
        return prev;
      }
      return { ...prev, ...next };
    });
  }, [
    initial,
    initial?.scopeWkt,
    initial?.phone,
    initial?.manager,
    initial?.detailRequest,
    initial?.address,
    initial?.hasScope,
    initial?.scopeLabel,
  ]);

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
    setNotice('촬영지역 범위가 반영되었습니다. 지번(동)을 조회 중…');

    void (async () => {
      const names = await fetchEmdNamesByWkt(result.wkt5181);
      if (names.length === 0) {
        setNotice('촬영지역 범위가 반영되었습니다. 해당하는 동을 찾지 못해 지번은 직접 입력해 주세요.');
        return;
      }
      const address = names.join(', ');
      setForm((prev) => ({ ...prev, address }));
      setNotice(`촬영지역 범위가 반영되었습니다. 지번: ${address}`);
    })();
  };

  const clearScope = () => {
    if (readOnly) return;
    setForm((prev) => ({
      ...prev,
      hasScope: false,
      scopeLabel: '',
      scopeWkt: '',
      address: '',
    }));
    setNotice(null);
  };

  const handleSubmit = async () => {
    if (readOnly || submitting) return;
    if (!form.hasScope || !form.scopeWkt?.trim()) {
      setNotice('촬영지역 범위를 먼저 지정하세요.');
      return;
    }
    if (!form.department.trim() || !form.applicantRankName.trim() || !form.purpose.trim()) {
      setNotice('부서명·신청자·신청목적을 입력하세요.');
      return;
    }
    if (!onSubmit) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await onSubmit(form);
      setNotice('신청이 접수되었습니다.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '신청 접수에 실패했습니다.';
      setNotice(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      let scopeMapDataUrl: string | null = null;
      if (form.hasScope && form.scopeWkt?.trim()) {
        scopeMapDataUrl = await scopeMapToDataUrl(form.scopeWkt);
      }
      await downloadShootingRequestDocument({
        department: form.department,
        applicantRankName: form.applicantRankName,
        phone: form.phone,
        manager: form.manager,
        purpose: form.purpose,
        address: form.address,
        hasScope: form.hasScope,
        scopeLabel: form.scopeLabel,
        scopeMapDataUrl,
        shootDate: form.shootDate,
        useDate: form.useDate,
        shootType: form.shootType,
        detailRequest: form.detailRequest,
      });
      if (form.hasScope && form.scopeWkt?.trim() && !scopeMapDataUrl) {
        setNotice('PDF는 저장됐지만 위치도 지도를 넣지 못했습니다. 다시 시도해 주세요.');
      }
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">[별지 제3호서식]</p>
          <h2 className="text-[13px] font-semibold leading-snug text-foreground">
            무인비행장치 촬영신청서
          </h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">(제14조 제1항 관련)</p>
        </div>
        {hideHeaderClose ? null : (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={closeLabel}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
        <section>
          <h3 className={sectionTitle}>신청 정보</h3>
          <table className={cn('w-full border-collapse text-[11px]', cellBorder)}>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'w-[5.5rem]')}>부서명</th>
                <td className={cn(valueCell, cellBorder)} colSpan={3}>
                  <Input
                    value={form.department}
                    onChange={(e) => setField('department', e.target.value)}
                    disabled={readOnly}
                    className={field}
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
                    className={field}
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
                    className={field}
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
                    className={field}
                    placeholder="관리자"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className={sectionTitle}>항공영상 촬영 요청내용</h3>
          <table className={cn('w-full border-collapse text-[11px]', cellBorder)}>
            <tbody>
              <tr>
                <th className={cn(labelCell, cellBorder, 'w-[5.5rem]')}>신청목적</th>
                <td className={cn(valueCell, cellBorder)}>
                  <Input
                    value={form.purpose}
                    onChange={(e) => setField('purpose', e.target.value)}
                    disabled={readOnly}
                    className={field}
                    placeholder="신청 목적"
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>
                  촬영지역
                  <br />
                  <span className="font-normal text-muted-foreground">(위치도)</span>
                </th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className="space-y-1.5 py-0.5">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[10px] text-muted-foreground">- 지번</span>
                      <Input
                        value={form.address}
                        onChange={(e) => setField('address', e.target.value)}
                        disabled={readOnly}
                        className="h-7 flex-1 border-border text-[11px]"
                        placeholder="예: 방어동"
                      />
                    </div>

                    <div
                      className={cn(
                        'relative overflow-hidden rounded-md border border-dashed',
                        form.hasScope && form.scopeWkt
                          ? 'border-sky-400 bg-muted/40'
                          : 'border-border bg-muted/30'
                      )}
                    >
                      {form.hasScope && form.scopeWkt ? (
                        <div className="relative aspect-[16/9] w-full">
                          <ScopePreviewMap
                            key={form.scopeWkt}
                            wkt5181={form.scopeWkt}
                            className="absolute inset-0"
                          />
                          <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 shadow-sm ring-1 ring-sky-200/80">
                            {form.scopeLabel || '범위 지정됨'}
                          </div>
                        </div>
                      ) : (
                        <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 p-3 text-center">
                          <MapPinned className="h-7 w-7 text-muted-foreground/40" />
                          <p className="text-[11px] text-muted-foreground">촬영 범위를 지도에 그려 주세요</p>
                          <p className="text-[10px] text-muted-foreground">위치도 · 범위 미지정</p>
                        </div>
                      )}
                    </div>

                    {!readOnly ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
                          onClick={startDraw}
                        >
                          {form.hasScope ? '범위 다시 그리기' : '범위 그리기'}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                          onClick={clearScope}
                          disabled={!form.hasScope}
                        >
                          초기화
                        </button>
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
                    className={field}
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
                    className={field}
                  />
                </td>
              </tr>
              <tr>
                <th className={cn(labelCell, cellBorder)}>촬영형태</th>
                <td className={cn(valueCell, cellBorder)}>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 py-0.5">
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
                    rows={2}
                    className="w-full resize-none border-0 bg-transparent px-1 py-1 text-[11px] outline-none placeholder:text-muted-foreground disabled:opacity-70"
                    placeholder="추가 요청 사항"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
          <h3 className={sectionTitle}>촬영영상 안내</h3>
          <ol className="list-decimal space-y-0.5 pl-4 text-[10px] leading-snug text-muted-foreground">
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
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border bg-muted/30 px-3 py-1.5">
          <button
            type="button"
            className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            disabled={downloading}
            onClick={() => void handleDownload()}
          >
            {downloading ? 'PDF 생성 중…' : 'PDF 내려받기'}
          </button>
          {!readOnly ? (
            <button
              type="button"
              className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? '제출 중…' : '제출'}
            </button>
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
