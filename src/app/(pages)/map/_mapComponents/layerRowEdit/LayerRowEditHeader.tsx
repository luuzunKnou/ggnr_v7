"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LayerRowPanelButton } from "./LayerRowPanelButton";

export type LayerRowEditToolbarProps = {
  isEditing: boolean;
  isCreateMode?: boolean;
  saving: boolean;
  deleting?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  editable?: boolean;
};

type HeaderProps = LayerRowEditToolbarProps & {
  title: string;
  onClose: () => void;
  /** header: 상단 제목줄 · footer: 하단 고정 툴바(헤더는 제목·닫기만) */
  actionsPlacement?: "header" | "footer";
  className?: string;
};

export function LayerRowEditToolbar({
  isEditing,
  isCreateMode = false,
  saving,
  deleting = false,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  editable = true,
}: LayerRowEditToolbarProps) {
  const busy = saving || deleting;

  if (!editable) return null;

  return (
    <>
      {!isEditing && !isCreateMode && (
        <>
          <LayerRowPanelButton onClick={onEdit}>수정</LayerRowPanelButton>
          {onDelete && (
            <LayerRowPanelButton variant="danger" onClick={onDelete} loading={deleting} disabled={busy}>
              {deleting ? "삭제 중…" : "삭제"}
            </LayerRowPanelButton>
          )}
        </>
      )}
      {isEditing && (
        <>
          <LayerRowPanelButton onClick={onSave} loading={saving} disabled={busy}>
            {isCreateMode ? "등록" : "저장"}
          </LayerRowPanelButton>
          <LayerRowPanelButton onClick={onCancel} disabled={busy}>
            취소
          </LayerRowPanelButton>
        </>
      )}
    </>
  );
}

export function LayerRowEditFooter(props: LayerRowEditToolbarProps) {
  const toolbar = LayerRowEditToolbar(props);
  if (!toolbar) return null;

  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
      {toolbar}
    </div>
  );
}

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
  actionsPlacement = "header",
  className,
}: HeaderProps) {
  const busy = saving || deleting;
  const toolbarProps: LayerRowEditToolbarProps = {
    isEditing,
    isCreateMode,
    saving,
    deleting,
    onEdit,
    onSave,
    onCancel,
    onDelete,
    editable,
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5",
        className
      )}
    >
      <span className="text-sm font-semibold text-foreground">
        {isCreateMode ? `${title.replace(/ 상세$/, "")} 등록` : title}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {actionsPlacement === "header" && <LayerRowEditToolbar {...toolbarProps} />}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          title="상세 닫기"
          aria-label="상세 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
