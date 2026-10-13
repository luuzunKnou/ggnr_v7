"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Download, FileText, Image as ImageIcon, Paperclip, Plus, Trash2 } from "lucide-react";
import { appFetch } from "@/lib/basePath";
import { cn } from "@/lib/utils";
import { streamDownloadFile } from "@/lib/streamFileDownload";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import {
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
  withServiceFileThumbQuery,
} from "../../../_mapComponents/standard/useServiceFileData";

const ATTACH_ROOT_FOLDER = "기타";
const FILE_LAYER = "usage_data_as";
const FILE_SER_ENG = SER_FILE_ENG.usageDataAs;

const ATTACH_GRID_GAP_PX = 8;
const ATTACH_GRID_LABEL_PX = 14;
const ATTACH_GRID_OVERSCAN_ROWS = 2;

const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const btnSecondary =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground/90 hover:bg-muted/50 disabled:opacity-50";

type PreviewKind = "image" | "pdf" | "other";

type AttachmentItem = {
  id: string;
  name: string;
  category: string;
  previewUrl?: string;
  previewKind?: PreviewKind;
};

function guessPreviewKind(name: string): PreviewKind {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(lower)) return "image";
  if (lower.endsWith(".pdf")) return "pdf";
  return "other";
}

function AttachmentThumb({
  att,
  onPreview,
  onDownload,
  onDelete,
}: {
  att: AttachmentItem;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const isImage = att.previewKind === "image";
  const isPdf = att.previewKind === "pdf";
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc =
    isImage && att.previewUrl && !thumbFailed
      ? withServiceFileThumbQuery(att.previewUrl, 160)
      : null;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPreview}
        className="block aspect-square w-full overflow-hidden rounded border border-border bg-muted/50"
        title={`${att.name} 미리보기`}
      >
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키 포함 동일출처 썸네일
          <img
            src={thumbSrc}
            alt=""
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            {isImage ? (
              <ImageIcon className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
            <span className="text-[10px] font-semibold">
              {isImage ? "이미지" : isPdf ? "PDF" : "파일"}
            </span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground/90 shadow-md ring-1 ring-border/80 hover:bg-muted/50 hover:text-primary"
          title="다운로드"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-destructive shadow-md ring-1 ring-border/80 hover:bg-destructive/10"
          title="삭제"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={att.name}>
        {att.name}
      </p>
    </div>
  );
}

type AttachGridWindow = {
  cols: number;
  rowH: number;
  totalH: number;
  offsetY: number;
  start: number;
  end: number;
};

function AttachmentThumbGrid({
  items,
  scrollRootRef,
  onPreview,
  onDownload,
  onDelete,
  emptyLabel,
}: {
  items: AttachmentItem[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onPreview: (att: AttachmentItem) => void;
  onDownload: (att: AttachmentItem) => void;
  onDelete: (att: AttachmentItem) => void;
  emptyLabel: string;
}) {
  const [win, setWin] = useState<AttachGridWindow>({
    cols: 3,
    rowH: 96,
    totalH: 0,
    offsetY: 0,
    start: 0,
    end: 0,
  });

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || items.length === 0) {
      setWin((prev) => ({ ...prev, totalH: 0, start: 0, end: 0, offsetY: 0 }));
      return;
    }

    const measure = () => {
      const el = scrollRootRef.current;
      if (!el) return;
      const w = el.clientWidth;
      if (w <= 0) return;
      const cols = window.matchMedia("(min-width: 640px)").matches ? 4 : 3;
      const cellW = (w - ATTACH_GRID_GAP_PX * (cols - 1)) / cols;
      const rowH = cellW + ATTACH_GRID_LABEL_PX;
      const stride = rowH + ATTACH_GRID_GAP_PX;
      const rows = Math.ceil(items.length / cols);
      const totalH = rows > 0 ? rows * rowH + Math.max(0, rows - 1) * ATTACH_GRID_GAP_PX : 0;
      const firstRow = Math.max(
        0,
        Math.floor(el.scrollTop / stride) - ATTACH_GRID_OVERSCAN_ROWS
      );
      const lastRow = Math.min(
        rows - 1,
        Math.ceil((el.scrollTop + el.clientHeight) / stride) + ATTACH_GRID_OVERSCAN_ROWS
      );
      setWin({
        cols,
        rowH,
        totalH,
        offsetY: firstRow * stride,
        start: firstRow * cols,
        end: Math.min(items.length, (lastRow + 1) * cols),
      });
    };

    measure();
    root.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const mq = window.matchMedia("(min-width: 640px)");
    mq.addEventListener("change", measure);
    return () => {
      root.removeEventListener("scroll", measure);
      ro.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [items.length, scrollRootRef]);

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-[6rem] items-center justify-center">
        <p className="text-center text-[11px] text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const visible = items.slice(win.start, win.end);

  return (
    <div className="relative w-full" style={{ height: win.totalH }}>
      <div
        className="absolute left-0 right-0 grid gap-2"
        style={{
          top: win.offsetY,
          gridTemplateColumns: `repeat(${win.cols}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((att) => (
          <AttachmentThumb
            key={att.id}
            att={att}
            onPreview={() => onPreview(att)}
            onDownload={() => onDownload(att)}
            onDelete={() => onDelete(att)}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  fileKey: string;
  zipLabel?: string;
  ready?: boolean;
};

export function UsageDataAsAttachmentSection({
  fileKey,
  zipLabel,
  ready = true,
}: Props) {
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachScrollRef = useRef<HTMLDivElement>(null);
  const { upload: uploadChunked } = useServiceFileChunkedUpload();

  const [attachmentFolders, setAttachmentFolders] = useState<string[]>([]);
  const [attachmentTab, setAttachmentTab] = useState(ATTACH_ROOT_FOLDER);
  const [attachRefreshNonce, setAttachRefreshNonce] = useState(0);
  const [foldersRefreshNonce, setFoldersRefreshNonce] = useState(0);
  const [preview, setPreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);

  const key = String(fileKey ?? "").trim();
  const attachmentsReady = Boolean(key) && ready;

  const { files: folderFiles, loading: filesLoading } = useServiceFileData({
    serEng: FILE_SER_ENG,
    enabled: attachmentsReady && Boolean(attachmentTab),
    layerSegment: FILE_LAYER,
    keyValue: key || null,
    subfolder: attachmentTab,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });

  const attachments = useMemo(() => {
    return folderFiles.map((f) => {
      const kind = guessPreviewKind(f.name);
      const url = serviceFileDataDownloadUrl(FILE_SER_ENG, FILE_LAYER, key, f.name, {
        subfolder: attachmentTab,
      });
      return {
        id: `${attachmentTab}:${f.name}`,
        name: f.name,
        category: attachmentTab,
        previewKind: kind,
        previewUrl: kind === "image" || kind === "pdf" ? url : undefined,
      } satisfies AttachmentItem;
    });
  }, [attachmentTab, folderFiles, key]);

  useEffect(() => {
    if (!attachmentsReady || !key) {
      if (!key) setAttachmentFolders([]);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({
      serEng: FILE_SER_ENG,
      layer: FILE_LAYER,
      key,
      folders: "1",
    });
    void appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return { folders: [] as string[] };
        return r.json() as Promise<{ folders?: string[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const folders = Array.isArray(data.folders) ? data.folders : [];
        setAttachmentFolders(folders);
        setAttachmentTab((prev) => {
          if (folders.includes(prev)) return prev;
          return folders[0] ?? ATTACH_ROOT_FOLDER;
        });
      })
      .catch(() => {
        if (!cancelled) setAttachmentFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentsReady, key, foldersRefreshNonce]);

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!key) {
      window.alert("저장한 뒤 첨부파일을 등록할 수 있습니다.");
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    const folder = attachmentTab || ATTACH_ROOT_FOLDER;
    for (const file of Array.from(files)) {
      const result = await uploadChunked({
        file,
        serEng: FILE_SER_ENG,
        layerSegment: FILE_LAYER,
        keyValue: key,
        subfolder: folder,
      });
      if (result?.error) {
        window.alert(result.error);
        break;
      }
    }
    if (attachInputRef.current) attachInputRef.current.value = "";
    setAttachRefreshNonce((n) => n + 1);
    setFoldersRefreshNonce((n) => n + 1);
  };

  const handleDeleteAttachment = async (att: AttachmentItem) => {
    if (!window.confirm(`«${att.name}»을(를) 삭제할까요?`)) return;
    if (!key) return;
    const result = await requestServiceFileDataDelete({
      serEng: FILE_SER_ENG,
      layerSegment: FILE_LAYER,
      keyValue: key,
      fileName: att.name,
      subfolder: att.category,
    });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setAttachRefreshNonce((n) => n + 1);
    setFoldersRefreshNonce((n) => n + 1);
  };

  const downloadAttachment = (att: AttachmentItem) => {
    if (!key) return;
    const url = serviceFileDataDownloadUrl(FILE_SER_ENG, FILE_LAYER, key, att.name, {
      subfolder: att.category,
    });
    triggerServiceFileDownload(url, att.name);
  };

  const handleDownloadAllAttachments = async () => {
    if (!key) return;
    if (attachments.length === 0 && attachmentFolders.length === 0) {
      window.alert("다운로드할 첨부파일이 없습니다.");
      return;
    }
    const label = String(zipLabel ?? "").trim() || "하천점용";
    const url = serviceFileDataZipDownloadUrl(FILE_SER_ENG, FILE_LAYER, key, {
      layerDisplayName: label,
    });
    try {
      await streamDownloadFile(url, `${label} 첨부파일.zip`);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "다운로드할 첨부파일이 없습니다.");
    }
  };

  const openPreview = (att: AttachmentItem) => {
    const scoped = attachments.filter((a) => a.category === att.category);
    const items: ServiceFilePreviewItem[] = scoped
      .filter((a) => a.previewUrl && (a.previewKind === "image" || a.previewKind === "pdf"))
      .map((a) => ({
        url: a.previewUrl!,
        fileName: a.name,
        kind: a.previewKind === "pdf" ? ("pdf" as const) : ("image" as const),
      }));
    const idx = items.findIndex((i) => i.fileName === att.name);
    if (idx < 0) {
      if (att.previewUrl) downloadAttachment(att);
      else window.alert("미리볼 수 있는 첨부파일이 없습니다.");
      return;
    }
    setPreview({ items, index: idx });
  };

  return (
    <>
      <div className="mt-4 flex min-h-[12rem] flex-col border-t border-border pt-2">
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <div className="standard-detail-section-toggle-label flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" />
            첨부파일
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={btnSecondary}
              disabled={!key}
              title={
                key
                  ? "폴더 포함 첨부파일 전체 ZIP 다운로드"
                  : "저장 후 다운로드할 수 있습니다"
              }
              onClick={() => void handleDownloadAllAttachments()}
            >
              <Download className="h-3 w-3" />
              전체
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!key}
              title={key ? "첨부 업로드" : "저장 후 첨부할 수 있습니다"}
              onClick={() => attachInputRef.current?.click()}
            >
              <Plus className="h-3 w-3" />
              첨부
            </button>
            <input
              ref={attachInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleUploadFiles(e.target.files)}
            />
          </div>
        </div>

        {key ? (
          <>
            <div className="mb-2 flex shrink-0 flex-wrap gap-0.5 rounded border border-border bg-muted/50 p-0.5">
              {(attachmentFolders.length > 0 ? attachmentFolders : [ATTACH_ROOT_FOLDER]).map(
                (folder) => (
                  <button
                    key={folder}
                    type="button"
                    className={cn(
                      "min-w-0 flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors",
                      attachmentTab === folder
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => {
                      setAttachmentTab(folder);
                      attachScrollRef.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {folder}
                    {attachmentTab === folder ? ` (${attachments.length})` : ""}
                  </button>
                )
              )}
            </div>

            <div
              ref={attachScrollRef}
              className="min-h-[8rem] max-h-[16rem] overflow-y-auto overscroll-contain scrollbar-thin"
            >
              {!attachmentsReady || filesLoading ? (
                <p className="py-3 text-center text-[11px] text-muted-foreground">
                  첨부 목록 불러오는 중…
                </p>
              ) : (
                <AttachmentThumbGrid
                  key={attachmentTab}
                  items={attachments}
                  scrollRootRef={attachScrollRef}
                  onPreview={openPreview}
                  onDownload={downloadAttachment}
                  onDelete={(att) => void handleDeleteAttachment(att)}
                  emptyLabel={`등록된 ${attachmentTab} 첨부파일이 없습니다.`}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-[8rem] items-center justify-center rounded border border-dashed border-border bg-muted/50 px-2 text-center text-[11px] text-muted-foreground">
            저장한 뒤 폴더별 첨부파일을 등록할 수 있습니다.
          </div>
        )}
      </div>

      {preview ? (
        <ServiceFileImagePreview
          items={preview.items}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
