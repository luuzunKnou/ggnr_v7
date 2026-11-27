'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pencil, Save, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createEmptyPublicPropertyPermit,
  isNewPublicPropertyPermitId,
  type PublicPropertyFee,
  type PublicPropertyOwnership,
  type PublicPropertyParcel,
  type PublicPropertyPermit,
  type PublicPropertyDurationKind,
} from './publicPropertyPermitMock';
import {
  getPublicPropertyPermit,
  removePublicPropertyPermit,
  upsertPublicPropertyPermit,
  usePublicPropertyPermits,
} from './publicPropertyPermitStore';

const fieldClass =
  'w-full rounded border border-border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring';
const actionBtn =
  'inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50';

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="w-[88px] border border-border bg-muted/60 px-1.5 py-1 text-left text-[10px] font-semibold text-muted-foreground">
      {children}
    </th>
  );
}

function Td({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className="border border-border px-1.5 py-1 align-middle text-[11px]">
      {children}
    </td>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-2 rounded border border-border bg-background p-2 shadow-sm">
      <h3 className="mb-1.5 text-[11px] font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

type Props = {
  permitId: string;
  onSelectId: (id: string | null) => void;
  onClose: () => void;
};

export function PublicPropertyPermitDetailPanel({
  permitId,
  onSelectId,
  onClose,
}: Props) {
  const all = usePublicPropertyPermits();
  const stored = useMemo(
    () => getPublicPropertyPermit(permitId),
    [permitId, all]
  );
  const isCreate = isNewPublicPropertyPermitId(permitId);
  const [isEditing, setIsEditing] = useState(isCreate);
  const [draft, setDraft] = useState<PublicPropertyPermit>(
    () => stored ?? createEmptyPublicPropertyPermit()
  );

  useEffect(() => {
    const next = getPublicPropertyPermit(permitId) ?? createEmptyPublicPropertyPermit();
    setDraft(structuredClone(next));
    setIsEditing(isNewPublicPropertyPermitId(permitId));
  }, [permitId]);

  const display = isEditing ? draft : (stored ?? draft);

  const setField = <K extends keyof PublicPropertyPermit>(
    key: K,
    value: PublicPropertyPermit[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const setParcel = <K extends keyof PublicPropertyParcel>(
    key: K,
    value: PublicPropertyParcel[K]
  ) => {
    setDraft((prev) => ({ ...prev, parcel: { ...prev.parcel, [key]: value } }));
  };

  const setFee = <K extends keyof PublicPropertyFee>(key: K, value: PublicPropertyFee[K]) => {
    setDraft((prev) => ({ ...prev, fee: { ...prev.fee, [key]: value } }));
  };

  const beginEdit = () => {
    setDraft(structuredClone(stored ?? createEmptyPublicPropertyPermit()));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isCreate) {
      onSelectId(null);
      return;
    }
    setDraft(structuredClone(stored!));
    setIsEditing(false);
  };

  const save = () => {
    const saved = upsertPublicPropertyPermit(draft);
    setIsEditing(false);
    onSelectId(saved.id);
  };

  const remove = () => {
    if (isCreate) {
      onSelectId(null);
      return;
    }
    if (!window.confirm('이 허가 건을 삭제할까요? (프로토타입)')) return;
    removePublicPropertyPermit(permitId);
    onSelectId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="truncate text-sm font-semibold">
          {isCreate ? '사용허가 등록' : '사용허가 상세'}
        </span>
        <div className="flex items-center gap-1">
          {!isEditing ? (
            <>
              <button type="button" className={actionBtn} onClick={beginEdit}>
                <Pencil className="h-3 w-3" />
                수정
              </button>
              <button type="button" className={actionBtn} onClick={remove}>
                <Trash2 className="h-3 w-3" />
                삭제
              </button>
            </>
          ) : (
            <>
              <button type="button" className={actionBtn} onClick={save}>
                <Save className="h-3 w-3" />
                저장
              </button>
              <button type="button" className={actionBtn} onClick={cancelEdit}>
                취소
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <Section title="허가정보">
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <Th>허가번호</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.permitNo}
                      onChange={(e) => setField('permitNo', e.target.value)}
                    />
                  ) : (
                    display.permitNo || '—'
                  )}
                </Td>
                <Th>국유/공유</Th>
                <Td>
                  {isEditing ? (
                    <select
                      className={fieldClass}
                      value={draft.ownership}
                      onChange={(e) =>
                        setField('ownership', e.target.value as PublicPropertyOwnership)
                      }
                    >
                      <option value="국유">국유</option>
                      <option value="공유">공유</option>
                    </select>
                  ) : (
                    display.ownership
                  )}
                </Td>
              </tr>
              <tr>
                <Th>구분</Th>
                <Td>
                  {isEditing ? (
                    <select
                      className={fieldClass}
                      value={draft.durationKind}
                      onChange={(e) =>
                        setField('durationKind', e.target.value as PublicPropertyDurationKind)
                      }
                    >
                      <option value="일시">일시</option>
                      <option value="영구">영구</option>
                    </select>
                  ) : (
                    display.durationKind
                  )}
                </Td>
                <Th>용도</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.purpose}
                      onChange={(e) => setField('purpose', e.target.value)}
                    />
                  ) : (
                    display.purpose || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>사용면적</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.useArea}
                      onChange={(e) => setField('useArea', e.target.value)}
                    />
                  ) : (
                    display.useArea ? `${display.useArea} ㎡` : '—'
                  )}
                </Td>
                <Th>사용요율</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.rate}
                      onChange={(e) => setField('rate', e.target.value)}
                    />
                  ) : (
                    display.rate || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>최초허가</Th>
                <Td>
                  {isEditing ? (
                    <input
                      type="date"
                      className={cn(fieldClass, 'input-date-compact')}
                      value={draft.firstPermitYmd}
                      onChange={(e) => setField('firstPermitYmd', e.target.value)}
                    />
                  ) : (
                    display.firstPermitYmd || '—'
                  )}
                </Td>
                <Th>당초기간</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex flex-wrap gap-1">
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.periodStart}
                        onChange={(e) => setField('periodStart', e.target.value)}
                      />
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.periodEnd}
                        onChange={(e) => setField('periodEnd', e.target.value)}
                      />
                    </div>
                  ) : (
                    `${display.periodStart || '—'} ~ ${display.periodEnd || '—'}`
                  )}
                </Td>
              </tr>
              <tr>
                <Th>갱신기간</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <div className="flex flex-wrap gap-1">
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.renewStart}
                        onChange={(e) => setField('renewStart', e.target.value)}
                      />
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.renewEnd}
                        onChange={(e) => setField('renewEnd', e.target.value)}
                      />
                    </div>
                  ) : (
                    `${display.renewStart || '—'} ~ ${display.renewEnd || '—'}`
                  )}
                </Td>
              </tr>
              <tr>
                <Th>사용자</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.userName}
                      onChange={(e) => setField('userName', e.target.value)}
                    />
                  ) : (
                    display.userName || '—'
                  )}
                </Td>
                <Th>연락처</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.userPhone}
                      onChange={(e) => setField('userPhone', e.target.value)}
                    />
                  ) : (
                    display.userPhone || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>주소</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.userAddr}
                      onChange={(e) => setField('userAddr', e.target.value)}
                    />
                  ) : (
                    display.userAddr || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>비고</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <textarea
                      className={cn(fieldClass, 'min-h-[48px]')}
                      value={draft.remark}
                      onChange={(e) => setField('remark', e.target.value)}
                    />
                  ) : (
                    display.remark || '—'
                  )}
                </Td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="소재지(필지)">
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <Th>읍면동</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.parcel.emd}
                      onChange={(e) => setParcel('emd', e.target.value)}
                    />
                  ) : (
                    display.parcel.emd || '—'
                  )}
                </Td>
                <Th>리</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.parcel.ri}
                      onChange={(e) => setParcel('ri', e.target.value)}
                    />
                  ) : (
                    display.parcel.ri || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>본번</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.parcel.bun}
                      onChange={(e) => setParcel('bun', e.target.value)}
                    />
                  ) : (
                    display.parcel.bun || '—'
                  )}
                </Td>
                <Th>부번</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.parcel.ji}
                      onChange={(e) => setParcel('ji', e.target.value)}
                    />
                  ) : (
                    display.parcel.ji || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>지적면적</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.parcel.cadastralArea}
                      onChange={(e) => setParcel('cadastralArea', e.target.value)}
                    />
                  ) : (
                    display.parcel.cadastralArea
                      ? `${display.parcel.cadastralArea} ㎡`
                      : '—'
                  )}
                </Td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-muted-foreground">
            프로토타입 — 필지 도형·지적 연동은 후속
          </p>
        </Section>

        <Section title="사용료(당해)">
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <Th>부과기간</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <div className="flex flex-wrap gap-1">
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.fee.chargeStart}
                        onChange={(e) => setFee('chargeStart', e.target.value)}
                      />
                      <input
                        type="date"
                        className={cn(fieldClass, 'input-date-compact')}
                        value={draft.fee.chargeEnd}
                        onChange={(e) => setFee('chargeEnd', e.target.value)}
                      />
                      <input
                        className={cn(fieldClass, 'w-16')}
                        placeholder="일수"
                        value={draft.fee.days}
                        onChange={(e) => setFee('days', e.target.value)}
                      />
                    </div>
                  ) : (
                    `${display.fee.chargeStart || '—'} ~ ${display.fee.chargeEnd || '—'} (${display.fee.days || '—'}일)`
                  )}
                </Td>
              </tr>
              <tr>
                <Th>인접지</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex gap-1">
                      <input
                        className={fieldClass}
                        placeholder="리/동"
                        value={draft.fee.adjLand}
                        onChange={(e) => setFee('adjLand', e.target.value)}
                      />
                      <input
                        className={fieldClass}
                        placeholder="지번"
                        value={draft.fee.adjJibun}
                        onChange={(e) => setFee('adjJibun', e.target.value)}
                      />
                    </div>
                  ) : (
                    [display.fee.adjLand, display.fee.adjJibun].filter(Boolean).join(' ') ||
                    '—'
                  )}
                </Td>
                <Th>공시지가</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.fee.officialPrice}
                      onChange={(e) => setFee('officialPrice', e.target.value)}
                    />
                  ) : (
                    display.fee.officialPrice || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>전년도</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.fee.prevYearFee}
                      onChange={(e) => setFee('prevYearFee', e.target.value)}
                    />
                  ) : (
                    display.fee.prevYearFee || '—'
                  )}
                </Td>
                <Th>산정금액</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.fee.assessedAmount}
                      onChange={(e) => setFee('assessedAmount', e.target.value)}
                    />
                  ) : (
                    display.fee.assessedAmount || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>증감·조정</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex gap-1">
                      <input
                        className={fieldClass}
                        placeholder="증감률"
                        value={draft.fee.changeRate}
                        onChange={(e) => setFee('changeRate', e.target.value)}
                      />
                      <input
                        className={fieldClass}
                        placeholder="조정"
                        value={draft.fee.adjustFactor}
                        onChange={(e) => setFee('adjustFactor', e.target.value)}
                      />
                    </div>
                  ) : (
                    `증감 ${display.fee.changeRate || '—'} / 조정 ${display.fee.adjustFactor || '—'}`
                  )}
                </Td>
                <Th>부과(계)</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.fee.totalCharge}
                      onChange={(e) => setFee('totalCharge', e.target.value)}
                    />
                  ) : (
                    display.fee.totalCharge || '—'
                  )}
                </Td>
              </tr>
              <tr>
                <Th>사용료·부가세</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex gap-1">
                      <input
                        className={fieldClass}
                        placeholder="사용료"
                        value={draft.fee.useFee}
                        onChange={(e) => setFee('useFee', e.target.value)}
                      />
                      <input
                        className={fieldClass}
                        placeholder="부가세"
                        value={draft.fee.vat}
                        onChange={(e) => setFee('vat', e.target.value)}
                      />
                    </div>
                  ) : (
                    `${display.fee.useFee || '—'} / ${display.fee.vat || '—'}`
                  )}
                </Td>
                <Th>국고·시</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex gap-1">
                      <input
                        className={fieldClass}
                        placeholder="국고"
                        value={draft.fee.nationalShare}
                        onChange={(e) => setFee('nationalShare', e.target.value)}
                      />
                      <input
                        className={fieldClass}
                        placeholder="시"
                        value={draft.fee.cityShare}
                        onChange={(e) => setFee('cityShare', e.target.value)}
                      />
                    </div>
                  ) : (
                    `${display.fee.nationalShare || '—'} / ${display.fee.cityShare || '—'}`
                  )}
                </Td>
              </tr>
              <tr>
                <Th>고지서</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.fee.noticeIssued}
                      onChange={(e) => setFee('noticeIssued', e.target.value)}
                    />
                  ) : (
                    display.fee.noticeIssued || '—'
                  )}
                </Td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-muted-foreground">
            프로토타입 — 연도별 부과 이력·점사용료 연계는 후속
          </p>
        </Section>
      </div>
    </div>
  );
}
