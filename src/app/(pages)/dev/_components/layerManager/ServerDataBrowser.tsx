"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { call } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Folder, File as FileIcon, ChevronUp, RefreshCw } from "lucide-react"

type DirEntry = { name: string; isDirectory: boolean; size: number; mtime: string }
type DirListResult = {
  directories: string[]
  files: { name: string; size: number; modified?: string }[]
}

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

type ServerDataBrowserProps = {
  rootPath: string
  /** folder: 폴더 선택(탐색), file: 파일 클릭 선택 */
  pickMode: "folder" | "file"
  fileFilter?: (name: string) => boolean
  onPickFolder?: (relativePath: string) => void
  onPickFile?: (relativePath: string, fileName: string) => void
}

export function ServerDataBrowser({
  rootPath,
  pickMode,
  fileFilter,
  onPickFolder,
  onPickFile,
}: ServerDataBrowserProps) {
  const [relativePath, setRelativePath] = useState(rootPath)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRelativePath(rootPath)
  }, [rootPath])

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "fileManagerService",
        action: "listDirectory",
        params: { relativePath },
      })
      const data: DirListResult = res?.data ?? res
      const merged: DirEntry[] = [
        ...(data?.directories ?? []).map((name: string) => ({
          name,
          isDirectory: true,
          size: 0,
          mtime: "",
        })),
        ...(data?.files ?? []).map((f: { name: string; size: number; modified?: string }) => ({
          name: f.name,
          isDirectory: false,
          size: f.size,
          mtime: f.modified ?? "",
        })),
      ]
      setEntries(
        pickMode === "file" && fileFilter
          ? merged.filter((e) => e.isDirectory || fileFilter(e.name))
          : merged
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [relativePath, pickMode, fileFilter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const normalized = relativePath.replace(/\\/g, "/").replace(/\/$/, "")
  const rootNorm = rootPath.replace(/\\/g, "/").replace(/\/$/, "")
  const canGoUp = normalized !== rootNorm && normalized.startsWith(rootNorm)

  const goUp = () => {
    const parts = normalized.split("/").filter(Boolean)
    parts.pop()
    setRelativePath(parts.join("/") || rootNorm)
  }

  const goInto = (name: string) => {
    setRelativePath(`${normalized}/${name}`)
  }

  const handleEntryClick = (entry: DirEntry) => {
    if (entry.isDirectory) {
      goInto(entry.name)
      return
    }
    if (pickMode === "file" && onPickFile) {
      onPickFile(`${normalized}/${entry.name}`, entry.name)
    }
  }

  const folderName = normalized.split("/").filter(Boolean).pop() ?? ""

  return (
    <div className="flex flex-col gap-2 min-h-0 h-full">
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={goUp} disabled={!canGoUp || loading}>
          <ChevronUp className="w-3.5 h-3.5" /> 상위로
        </Button>
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{relativePath}</span>
        <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          새로고침
        </Button>
        {pickMode === "folder" && onPickFolder && (
          <Button
            size="sm"
            disabled={loading || normalized === rootNorm}
            onClick={() => onPickFolder(normalized)}
          >
            이 폴더 업데이트
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive shrink-0">{error}</p>}

      <section className="flex-1 min-h-[240px] overflow-auto border rounded-md">
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[12rem] text-xs text-muted-foreground">
            로딩 중…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[12rem] text-xs text-muted-foreground">
            {pickMode === "file"
              ? "선택할 파일이 없습니다."
              : "폴더가 비어 있습니다. 하위 폴더로 이동하세요."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-left text-muted-foreground">
                <th className="py-1 px-2 w-6" />
                <th className="py-1 px-2">이름</th>
                <th className="py-1 px-2 w-20 text-right">크기</th>
                <th className="py-1 px-2 w-44">수정일</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.name}
                  className={cn(
                    "border-t hover:bg-muted/40",
                    (e.isDirectory || pickMode === "file") && "cursor-pointer"
                  )}
                  onClick={() => handleEntryClick(e)}
                  onDoubleClick={() => {
                    if (pickMode === "folder" && e.isDirectory) goInto(e.name)
                  }}
                >
                  <td className="py-1 px-2">
                    {e.isDirectory ? (
                      <Folder className="w-4 h-4 text-yellow-500" />
                    ) : (
                      <FileIcon className="w-4 h-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="py-1 px-2 truncate max-w-[20rem]" title={e.name}>
                    {e.name}
                  </td>
                  <td className="py-1 px-2 text-right whitespace-nowrap">
                    {e.isDirectory ? "—" : formatSize(e.size)}
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap">
                    {e.mtime ? new Date(e.mtime).toLocaleString("ko-KR") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pickMode === "folder" && folderName && normalized !== rootNorm && (
        <p className="text-xs text-muted-foreground shrink-0">
          선택 폴더: <span className="font-mono text-foreground">{folderName}</span> — &quot;이 폴더
          업데이트&quot;로 SHP 후처리를 시작합니다.
        </p>
      )}
      {pickMode === "file" && (
        <p className="text-xs text-muted-foreground shrink-0">
          Excel/CSV 파일(.xlsx, .xls, .csv)을 클릭하면 업데이트 마법사가 열립니다.
        </p>
      )}
    </div>
  )
}
