'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  ROAD_FRONTAGE_BUILDING_BAD_MARKS,
  ROAD_FRONTAGE_BUILDING_LOCATION_KINDS,
  type RoadFrontageBuildingConfirmItem,
  type RoadFrontageBuildingDetailItem,
} from './roadFrontageBuildingMock';

const fieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25';
const labelClass = 'mb-0.5 block text-[11px] text-muted-foreground';
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';

type DetailKindProps = {
  kind: 'detail';
  draft: RoadFrontageBuildingDetailItem;
  onChange: (next: RoadFrontageBuildingDetailItem) => void;
};

type ConfirmKindProps = {
  kind: 'confirm';
  draft: RoadFrontageBuildingConfirmItem;
  onChange: (next: RoadFrontageBuildingConfirmItem) => void;
};

type Props = (DetailKindProps | ConfirmKindProps) & {
  isNew: boolean;
  onSubmit: () => void;
  onClose: () => void;
  /** 목록+상세 패널 폭만 덮는 오버레이 — 지도는 계속 보이게 */
  overlayLeftPx: number;
  overlayWidthPx: number;
};

export function RoadFrontageBuildingItemModal(props: Props) {
  const { isNew, onSubmit, onClose, overlayLeftPx, overlayWidthPx } = props;
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const title =
    props.kind === 'detail'
      ? isNew
        ? '건축물(공작물)내용 추가'
        : '건축물(공작물)내용 수정'
      : isNew
        ? '확인결과 추가'
        : '확인결과 수정';

  const handleSubmit = () => {
    if (props.kind === 'detail') {
      if (props.draft.areaSqm == null || !Number.isFinite(props.draft.areaSqm)) {
        setError('면적을 입력해 주세요.');
        return;
      }
    } else if (!props.draft.confirmDate.trim()) {
      setError('확인연월일을 입력해 주세요.');
      return;
    }
    setError(null);
    onSubmit();
  };

  if (overlayWidthPx <= 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-md flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          <button type="button" className={btnGhost} onClick={close}>
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 scrollbar-thin">
          {props.kind === 'detail' ? (
            <DetailForm draft={props.draft} onChange={props.onChange} />
          ) : (
            <ConfirmForm draft={props.draft} onChange={props.onChange} />
          )}
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-2">
          <button type="button" className={btnGhost} onClick={close}>
            취소
          </button>
          <button type="button" className={btnPrimary} onClick={handleSubmit}>
            담기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DetailForm({
  draft,
  onChange,
}: {
  draft: RoadFrontageBuildingDetailItem;
  onChange: (next: RoadFrontageBuildingDetailItem) => void;
}) {
  const toggleMark = (mark: string) => {
    const has = draft.badMarks.includes(mark);
    onChange({
      ...draft,
      badMarks: has ? draft.badMarks.filter((m) => m !== mark) : [...draft.badMarks, mark],
    });
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={labelClass}>동 구분</span>
          <input
            type="number"
            className={fieldClass}
            value={draft.dongNo ?? ''}
            onChange={(e) =>
              onChange({
                ...draft,
                dongNo: e.target.value.trim() === '' ? null : Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <span className={labelClass}>설치연월일</span>
          <input
            type="date"
            className={fieldClass}
            value={draft.installedDate}
            onChange={(e) => onChange({ ...draft, installedDate: e.target.value })}
          />
        </div>
        <div>
          <span className={labelClass}>구조</span>
          <input
            className={fieldClass}
            value={draft.structure}
            onChange={(e) => onChange({ ...draft, structure: e.target.value })}
          />
        </div>
        <div>
          <span className={labelClass}>용도</span>
          <input
            className={fieldClass}
            value={draft.usageType}
            onChange={(e) => onChange({ ...draft, usageType: e.target.value })}
          />
        </div>
        <div>
          <span className={labelClass}>면적(㎡)</span>
          <input
            type="number"
            step="0.01"
            className={fieldClass}
            value={draft.areaSqm ?? ''}
            onChange={(e) =>
              onChange({
                ...draft,
                areaSqm: e.target.value.trim() === '' ? null : Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <span className={labelClass}>위치</span>
          <select
            className={fieldClass}
            value={draft.locationKind}
            onChange={(e) =>
              onChange({
                ...draft,
                locationKind: e.target.value as RoadFrontageBuildingDetailItem['locationKind'],
              })
            }
          >
            <option value="">선택</option>
            {ROAD_FRONTAGE_BUILDING_LOCATION_KINDS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className={labelClass}>불량 건축물 표시</span>
        <div className="flex flex-wrap gap-1">
          {ROAD_FRONTAGE_BUILDING_BAD_MARKS.map((mark) => {
            const active = draft.badMarks.includes(mark);
            return (
              <button
                key={mark}
                type="button"
                onClick={() => toggleMark(mark)}
                aria-pressed={active}
                className={cn(
                  'h-8 min-w-[2.25rem] rounded border px-2 text-[13px] font-semibold transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground dark:bg-primary/25'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                )}
              >
                {mark}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ConfirmForm({
  draft,
  onChange,
}: {
  draft: RoadFrontageBuildingConfirmItem;
  onChange: (next: RoadFrontageBuildingConfirmItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <span className={labelClass}>확인연월일</span>
        <input
          type="date"
          className={fieldClass}
          value={draft.confirmDate}
          onChange={(e) => onChange({ ...draft, confirmDate: e.target.value })}
        />
      </div>
      <div>
        <span className={labelClass}>확인자 성명</span>
        <input
          className={fieldClass}
          value={draft.confirmerName}
          onChange={(e) => onChange({ ...draft, confirmerName: e.target.value })}
        />
      </div>
      <div>
        <span className={labelClass}>결재자 성명</span>
        <input
          className={fieldClass}
          value={draft.approverName}
          onChange={(e) => onChange({ ...draft, approverName: e.target.value })}
        />
      </div>
    </div>
  );
}
