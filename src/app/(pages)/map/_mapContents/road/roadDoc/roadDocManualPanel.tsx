"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  DraftingCompass,
  File,
  FileText,
  Folder,
  Image as ImageFileIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoadDocListItem } from "@/lib/roadDocTypes";
import { roadDocPreviewPngFileName } from "@/lib/roadDocPreviewPngName";
import { ServiceFileImagePreview } from "@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview";
import { ServiceFileDxfPreview } from "@/app/(pages)/map/_mapComponents/standard/ServiceFileDxfPreview";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { RoadWorkHandbookListPanel } from "../roadWorkHandbook/RoadWorkHandbookListPanel";
import { useHandbookMapPick } from "../roadWorkHandbook/roadWorkHandbookMapContext";
import type {
  HandbookDetailSelection,
  HandbookViewMode,
} from "../roadWorkHandbook/roadWorkHandbookData";

type FileKind = "hwp" | "pdf" | "image" | "zip" | "dwg" | "dxf" | "other";

function fileKind(fileName: string): FileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".hwp")) return "hwp";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) return "image";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".dwg")) return "dwg";
  if (lower.endsWith(".dxf")) return "dxf";
  return "other";
}

function FileKindIcon({ name }: { name: string }) {
  const kind = fileKind(name);
  const wrap = "flex shrink-0 items-center justify-center";
  if (kind === "hwp") {
    return (
      <span className={cn(wrap, "text-chart-3")} title="HWP">
        <File className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (kind === "pdf") {
    return (
      <span className={cn(wrap, "text-destructive")} title="PDF">
        <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (kind === "image") {
    return (
      <span className={cn(wrap, "text-chart-1")} title="이미지">
        <ImageFileIcon className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (kind === "zip") {
    return (
      <span className={cn(wrap, "text-primary")} title="ZIP">
        <Archive className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (kind === "dwg") {
    return (
      <span className={cn(wrap, "text-chart-2")} title="DWG">
        <DraftingCompass className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (kind === "dxf") {
    return (
      <span className={cn(wrap, "text-chart-4")} title="DXF">
        <DraftingCompass className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span className={cn(wrap, "text-muted-foreground")} title="파일">
      <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
    </span>
  );
}

function isDrawingKind(kind: FileKind): boolean {
  return kind === "dwg" || kind === "dxf";
}

/** cad 목록(상대 경로)에서 `prefix` 폴더의 바로 아래 항목만 분리 */
function listCadFolderChildren(
  allFiles: RoadDocListItem[],
  prefix: string
): { folders: string[]; files: RoadDocListItem[] } {
  const p = prefix.trim();
  const folderSet = new Set<string>();
  const files: RoadDocListItem[] = [];

  for (const f of allFiles) {
    if (p) {
      if (f.name === p || !f.name.startsWith(`${p}/`)) continue;
      const rest = f.name.slice(p.length + 1);
      if (rest.includes("/")) {
        folderSet.add(rest.split("/")[0]!);
      } else {
        files.push(f);
      }
    } else {
      if (f.name.includes("/")) {
        folderSet.add(f.name.split("/")[0]!);
      } else {
        files.push(f);
      }
    }
  }

  const folders = [...folderSet].sort((a, b) => a.localeCompare(b, "ko"));
  files.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { folders, files };
}

type ManualTab = "doc" | "drawing" | "target" | "ref";
type ApiScope = "doc" | "cad";

/** 업무편람 탭(대상여부 검토·설계실무요령 자료) — 일단 비표시 */
const ROAD_DOC_HANDBOOK_TABS_VISIBLE = false;

const TAB_BTN =
  "relative -mb-px shrink-0 border-b-2 px-3 py-2 text-[12px] font-medium whitespace-nowrap transition-colors";

function tabBtnClass(active: boolean) {
  return cn(
    TAB_BTN,
    active
      ? "border-foreground text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground"
  );
}

export function RoadDocManualPanel({
  onClose,
  handbookMode,
  onHandbookModeChange,
  handbookSelected,
  onHandbookSelect,
  startOnHandbook = false,
}: {
  onClose: () => void;
  handbookMode: HandbookViewMode;
  onHandbookModeChange: (mode: HandbookViewMode) => void;
  handbookSelected: HandbookDetailSelection | null;
  onHandbookSelect: (next: HandbookDetailSelection | null) => void;
  startOnHandbook?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ManualTab>(() =>
    ROAD_DOC_HANDBOOK_TABS_VISIBLE && startOnHandbook ? "target" : "doc"
  );
  const [docFiles, setDocFiles] = useState<RoadDocListItem[]>([]);
  const [cadFiles, setCadFiles] = useState<RoadDocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cadPreparing, setCadPreparing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 도면 탭: `roadDoc/cad` 기준 상대 경로 (빈 문자열 = 루트) */
  const [cadPath, setCadPath] = useState("");
  const isHandbookTab =
    ROAD_DOC_HANDBOOK_TABS_VISIBLE && (activeTab === "target" || activeTab === "ref");
  const mapPick = useHandbookMapPick();

  useEffect(() => {
    if (ROAD_DOC_HANDBOOK_TABS_VISIBLE) return;
    if (activeTab !== "target" && activeTab !== "ref") return;
    setActiveTab("doc");
    onHandbookSelect(null);
    mapPick?.cancelPick();
  }, [activeTab, mapPick, onHandbookSelect]);

  const selectTab = useCallback(
    (tab: ManualTab) => {
      if (!ROAD_DOC_HANDBOOK_TABS_VISIBLE && (tab === "target" || tab === "ref")) return;
      setActiveTab(tab);
      if (tab === "target" || tab === "ref") {
        if (handbookMode !== tab) onHandbookSelect(null);
        onHandbookModeChange(tab);
        return;
      }
      onHandbookSelect(null);
      mapPick?.cancelPick();
    },
    [handbookMode, mapPick, onHandbookModeChange, onHandbookSelect]
  );

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const [docRes, cadRes] = await Promise.all([
        fetch("/api/roadDoc/list", { cache: "no-store" }),
        fetch("/api/roadCad/list", { cache: "no-store" }),
      ]);
      const docData = (await docRes.json()) as { files?: RoadDocListItem[]; error?: string };
      const cadData = (await cadRes.json()) as { files?: RoadDocListItem[]; error?: string };

      setDocFiles(docRes.ok && Array.isArray(docData.files) ? docData.files : []);
      setCadFiles(cadRes.ok && Array.isArray(cadData.files) ? cadData.files : []);

      if (!docRes.ok || !cadRes.ok) {
        const parts: string[] = [];
        if (!docRes.ok) parts.push(docData?.error ?? "문서 목록을 불러오지 못했습니다.");
        if (!cadRes.ok) parts.push(cadData?.error ?? "도면 목록을 불러오지 못했습니다.");
        setListError(parts.join(" "));
      }
    } catch {
      setListError("목록을 불러오지 못했습니다.");
      setDocFiles([]);
      setCadFiles([]);
    } finally {
      setLoading(false);
    }

    setCadPreparing(true);
    try {
      await fetch("/api/roadCad/ensure-cad-previews", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* 무시 */
    } finally {
      setCadPreparing(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const [mediaPreview, setMediaPreview] = useState<{
    name: string;
    kind: "pdf" | "image";
    scope: ApiScope;
  } | null>(null);
  const [dxfFullscreenFile, setDxfFullscreenFile] = useState<{
    name: string;
    scope: ApiScope;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadHref = useCallback((name: string, scope: ApiScope) => {
    const base = scope === "doc" ? "/api/roadDoc" : "/api/roadCad";
    return `${base}/download?${new URLSearchParams({ name }).toString()}`;
  }, []);

  const triggerFileDownload = useCallback((name: string, scope: ApiScope) => {
    const a = document.createElement("a");
    a.href = downloadHref(name, scope);
    a.download = name.includes("/") ? (name.split("/").pop() ?? name) : name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadHref]);

  const handleRowActivate = useCallback(
    async (name: string, scope: ApiScope) => {
      setNotice(null);
      const kind = fileKind(name);
      if (kind === "pdf") {
        setMediaPreview({ name, kind: "pdf", scope });
        return;
      }
      if (kind === "image") {
        setMediaPreview({ name, kind: "image", scope });
        return;
      }
      if (kind === "dxf") {
        const pngName = roadDocPreviewPngFileName(name);
        try {
          const head = await fetch(downloadHref(pngName, scope), {
            method: "HEAD",
            credentials: "include",
          });
          if (head.ok) {
            setMediaPreview({ name: pngName, kind: "image", scope });
            return;
          }
        } catch {
          /* fall through */
        }
        setDxfFullscreenFile({ name, scope });
        return;
      }
      if (kind === "dwg") {
        const pngName = roadDocPreviewPngFileName(name);
        try {
          const head = await fetch(downloadHref(pngName, scope), {
            method: "HEAD",
            credentials: "include",
          });
          if (head.ok) {
            setMediaPreview({ name: pngName, kind: "image", scope });
            return;
          }
        } catch {
          /* */
        }
        setNotice("미리보기 PNG가 없습니다. QCAD(dwg2bmp) 환경을 확인하세요.");
        return;
      }
      triggerFileDownload(name, scope);
    },
    [downloadHref, triggerFileDownload]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;

      setUploading(true);
      setUploadError(null);
      setNotice(null);
      const uploadUrl = activeTab === "doc" ? "/api/roadDoc/upload" : "/api/roadCad/upload";
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch(uploadUrl, {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const data = (await res.json()) as {
          error?: string;
          previewOk?: boolean;
          previewReason?: string;
        };
        if (!res.ok) {
          setUploadError(data?.error ?? "업로드에 실패했습니다.");
          return;
        }
        if (data.previewOk === false) {
          const detail =
            data.previewReason?.trim() ||
            "QCAD_modules에 dwg2bmp.bat 등이 있는지, 변환 로그(서버 콘솔)를 확인하세요.";
          setNotice(`파일은 서버에 저장되었습니다. 다만 CAD 미리보기 PNG는 만들지 못했습니다. ${detail}`);
        }
        await fetchList();
      } catch {
        setUploadError("업로드에 실패했습니다. 네트워크 또는 서버 응답을 확인하세요.");
      } finally {
        setUploading(false);
      }
    },
    [fetchList, activeTab]
  );

  const docDisplayFiles = useMemo(
    () => docFiles.filter((f) => !isDrawingKind(fileKind(f.name))),
    [docFiles]
  );

  const cadExplorer = useMemo(() => listCadFolderChildren(cadFiles, cadPath), [cadFiles, cadPath]);

  const emptyMessage = useMemo(() => {
    if (activeTab === "target" || activeTab === "ref") return null;
    if (activeTab === "doc") {
      if (docFiles.length === 0) return "표시할 파일이 없습니다.";
      if (docDisplayFiles.length === 0) return "문서 파일이 없습니다.";
      return null;
    }
    if (cadFiles.length === 0) return "roadDoc\\cad 폴더에 도면 파일이 없습니다.";
    return null;
  }, [activeTab, docFiles.length, docDisplayFiles.length, cadFiles.length]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">업무자료</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {isHandbookTab ? "대상여부 검토 및 설계실무요령" : "도로점용 서식 및 매뉴얼 파일"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              tabIndex={-1}
              onChange={(e) => void handleFileSelected(e)}
            />
            <button
              type="button"
              title="파일 업로드"
              aria-label="파일 업로드"
              disabled={uploading}
              className="hidden rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void handleUploadClick()}
            >
              <Upload className={cn("h-4 w-4", uploading && "animate-pulse")} aria-hidden />
            </button>
            {!isHandbookTab ? (
              <button
                type="button"
                title="새로고침"
                aria-label="새로고침"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => void fetchList()}
              >
                <RefreshCw className={cn("h-4 w-4", (loading || cadPreparing) && "animate-spin")} aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              title="닫기"
              aria-label="닫기"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="flex shrink-0 gap-0 overflow-x-auto overflow-y-hidden border-b border-border px-3 scrollbar-hide"
          role="tablist"
          aria-label="업무자료 구분"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "doc"}
            className={tabBtnClass(activeTab === "doc")}
            onClick={() => selectTab("doc")}
          >
            문서
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "drawing"}
            className={tabBtnClass(activeTab === "drawing")}
            onClick={() => selectTab("drawing")}
          >
            도면
          </button>
          {ROAD_DOC_HANDBOOK_TABS_VISIBLE ? (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "target"}
                className={tabBtnClass(activeTab === "target")}
                onClick={() => selectTab("target")}
              >
                대상여부 검토
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "ref"}
                className={tabBtnClass(activeTab === "ref")}
                onClick={() => selectTab("ref")}
              >
                설계실무요령 자료
              </button>
            </>
          ) : null}
        </div>

        {isHandbookTab ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <RoadWorkHandbookListPanel
              key={handbookMode}
              embedded
              onClose={onClose}
              mode={handbookMode}
              onModeChange={(next) => selectTab(next)}
              selected={handbookSelected}
              onSelect={onHandbookSelect}
            />
          </div>
        ) : (
        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
          {loading ? (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">불러오는 중…</p>
          ) : listError || uploadError ? (
            <p className="px-1 py-2 text-[12px] text-destructive">{listError ?? uploadError}</p>
          ) : (
            <>
              {cadPreparing ? (
                <p className="flex items-center gap-1.5 px-1 py-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  CAD 미리보기 PNG 준비 중…
                </p>
              ) : null}
              {notice ? (
                <p className="px-1 py-2 text-[12px] text-chart-4">{notice}</p>
              ) : null}
              {emptyMessage ? (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">{emptyMessage}</p>
              ) : activeTab === "doc" ? (
                <ul className="flex flex-col gap-1">
                  {docDisplayFiles.map((f) => (
                    <li key={`doc-${f.name}`}>
                      <button
                        type="button"
                        className="flex w-full min-h-[40px] items-center gap-2 rounded border border-border bg-muted/50 px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted"
                        onClick={() => void handleRowActivate(f.name, "doc")}
                      >
                        <FileKindIcon name={f.name} />
                        <span
                          className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                          title={f.name}
                        >
                          {f.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex min-h-0 flex-col gap-2">
                  <nav
                    className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2 text-[11px] text-muted-foreground"
                    aria-label="도면 폴더 경로"
                  >
                    <button
                      type="button"
                      className={cn(
                        "rounded px-1 py-0.5 font-medium transition-colors hover:bg-muted",
                        cadPath === "" ? "text-foreground" : "text-muted-foreground"
                      )}
                      onClick={() => setCadPath("")}
                    >
                      cad
                    </button>
                    {cadPath
                      ? cadPath.split("/").map((seg, i, arr) => {
                          const upTo = arr.slice(0, i + 1).join("/");
                          const isLast = i === arr.length - 1;
                          return (
                            <Fragment key={upTo}>
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                              {isLast ? (
                                <span className="px-1 py-0.5 font-medium text-foreground">{seg}</span>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted"
                                  onClick={() => setCadPath(upTo)}
                                >
                                  {seg}
                                </button>
                              )}
                            </Fragment>
                          );
                        })
                      : null}
                  </nav>
                  {cadExplorer.folders.length === 0 && cadExplorer.files.length === 0 ? (
                    <p className="px-1 py-2 text-[12px] text-muted-foreground">
                      이 폴더에 표시할 항목이 없습니다. 상위 경로를 눌러 이동하세요.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {cadExplorer.folders.map((folderName) => {
                        const nextPath = cadPath ? `${cadPath}/${folderName}` : folderName;
                        return (
                          <li key={`cad-folder-${nextPath}`}>
                            <button
                              type="button"
                              className="flex w-full min-h-[40px] items-center gap-2 rounded border border-border bg-muted/50 px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted"
                              onClick={() => setCadPath(nextPath)}
                            >
                              <span className="flex shrink-0 items-center justify-center text-chart-4">
                                <Folder className="h-4 w-4" strokeWidth={2} aria-hidden />
                              </span>
                              <span
                                className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                                title={nextPath}
                              >
                                {folderName}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {cadExplorer.files.map((f) => (
                        <li key={`cad-${f.name}`}>
                          <button
                            type="button"
                            className="flex w-full min-h-[40px] items-center gap-2 rounded border border-border bg-muted/50 px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted"
                            onClick={() => void handleRowActivate(f.name, "cad")}
                          >
                            <FileKindIcon name={f.name} />
                            <span
                              className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                              title={f.name}
                            >
                              {f.name.includes("/") ? (f.name.split("/").pop() ?? f.name) : f.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </MapSideDetailScroll>
        )}
      </div>

      {mediaPreview ? (
        <ServiceFileImagePreview
          items={[
            {
              url: downloadHref(mediaPreview.name, mediaPreview.scope),
              fileName: mediaPreview.name,
              kind: mediaPreview.kind,
            },
          ]}
          initialIndex={0}
          onClose={() => setMediaPreview(null)}
        />
      ) : null}
      {dxfFullscreenFile ? (
        <ServiceFileDxfPreview
          url={downloadHref(dxfFullscreenFile.name, dxfFullscreenFile.scope)}
          fileName={dxfFullscreenFile.name}
          onClose={() => setDxfFullscreenFile(null)}
        />
      ) : null}
    </>
  );
}
