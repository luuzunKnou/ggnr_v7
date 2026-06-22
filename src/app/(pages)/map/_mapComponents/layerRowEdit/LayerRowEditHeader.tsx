"use client";

import { X } from "lucide-react";
import { LayerRowPanelButton } from "./LayerRowPanelButton";

type Props = {
  title: string;
  isEditing: boolean;
  isCreateMode?: boolean;
  saving: boolean;
  deleting?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onClose: () => void;
  editable?: boolean;
};

export function LayerRowEditHeader({
  title,
  isEditing,
  isCreateMode = false,
  saving,
  deleting = false,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onClose,
  editable = true,
}: Props) {
  const busy = saving || deleting;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
      <span className="text-sm font-semibold text-slate-800">
        {isCreateMode ? `${title.replace(/ 상세$/, "")} 등록` : title}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {editable && !isEditing && !isCreateMode && (
          <>
            <LayerRowPanelButton onClick={onEdit}>수정</LayerRowPanelButton>
            {onDelete && (
              <LayerRowPanelButton variant="danger" onClick={onDelete} loading={deleting} disabled={busy}>
                {deleting ? "삭제 중…" : "삭제"}
              </LayerRowPanelButton>
            )}
          </>
        )}
        {editable && isEditing && (
          <>
            <LayerRowPanelButton onClick={onSave} loading={saving} disabled={busy}>
              {isCreateMode ? "등록" : "저장"}
            </LayerRowPanelButton>
            <LayerRowPanelButton onClick={onCancel} disabled={busy}>
              취소
            </LayerRowPanelButton>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
          title="상세 닫기"
          aria-label="상세 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
