"use client"

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/app/shadcnComponents/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { Input } from "@/app/shadcnComponents/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/shadcnComponents/ui/table"
import { call } from "@/lib/api"
import { withBasePath } from "@/lib/basePath"
import { cn } from "@/lib/utils"
import { Trash2, Plus, X } from "lucide-react"
import { fetchDefineLayerTables } from "./layerManager/layerManagerListCache"

export type SystemItem = {
  sys_key: string
  sys_kor: string
  sys_eng?: string
  sys_detail?: string
  sys_img: string
  sys_idx: number
  sys_col: string
  sys_link: string
  /** 공통(config)·커스텀(DB) 공통 — 비공개면 권한·신청 필요 */
  sys_is_private?: boolean
  serviceList: string[]
  /** 레이어 그룹명(define_table_group) 목록 */
  layerList: string[]
}

/** 공통(config) / 커스텀(DB) 구분 */
export type SystemSource = "common" | "custom"

export type SystemItemWithSource = SystemItem & { source: SystemSource }

const emptySystem = (): SystemItem => ({
  sys_key: "",
  sys_kor: "",
  sys_eng: "",
  sys_detail: "",
  sys_img: "",
  sys_idx: 0,
  sys_col: "",
  sys_link: "",
  sys_is_private: false,
  serviceList: [],
  layerList: [],
})

/** 쉼표 구분. 그룹명에 공백이 있어 공백으로는 나누지 않음 */
function parseListStr(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

function formatList(arr: string[]): string {
  return Array.isArray(arr) ? arr.join(", ") : ""
}

const HANGUL_CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3

function toChoseongKey(text: string): string {
  let out = ""
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      out += HANGUL_CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)] ?? ""
      continue
    }
    if (HANGUL_CHOSEONG.includes(ch)) {
      out += ch
      continue
    }
    out += ch.toLowerCase()
  }
  return out
}

function matchesGroupQuery(label: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const lower = label.toLowerCase()
  const qLower = q.toLowerCase()
  if (lower.includes(qLower)) return true
  const labelCho = toChoseongKey(label)
  const queryCho = toChoseongKey(q)
  if (labelCho.includes(queryCho)) return true
  if ([...q].every((ch) => HANGUL_CHOSEONG.includes(ch)) && labelCho.startsWith(queryCho)) return true
  return false
}

/** 레이어 그룹 다중선택 — 목록은 body 포털로 모달 밖에 띄움 */
function LayerGroupMultiPick({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string[]
  onChange: (next: string[]) => void
  options: string[]
  disabled?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const selected = useMemo(
    () => [...new Set(value.map((x) => String(x).trim()).filter(Boolean))],
    [value]
  )
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    return options.filter((g) => matchesGroupQuery(g, filtering ? search : ""))
  }, [options, search, filtering])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSearch("")
    setFiltering(false)
  }, [])

  const updatePanelPosition = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 2
    const maxH = Math.min(256, Math.max(120, window.innerHeight - rect.bottom - gap - 12))
    setPanelStyle({
      position: "fixed",
      top: rect.bottom + gap,
      left: rect.left,
      width: Math.max(rect.width, 200),
      maxHeight: maxH,
      zIndex: 10000,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePanelPosition()
    const onWin = () => updatePanelPosition()
    window.addEventListener("resize", onWin)
    window.addEventListener("scroll", onWin, true)
    return () => {
      window.removeEventListener("resize", onWin)
      window.removeEventListener("scroll", onWin, true)
    }
  }, [open, updatePanelPosition, filtered.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      closePanel()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, closePanel])

  const toggle = (group: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(group)
    else next.delete(group)
    onChange([...next])
    setSearch("")
    setFiltering(false)
  }

  const displayValue = open && filtering ? search : formatList(selected)
  const showClear = open && filtering && search.trim() ? true : selected.length > 0

  const panel =
    open && !disabled && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="flex flex-col overflow-hidden rounded-none border border-border bg-popover text-popover-foreground shadow-md"
          >
            <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-multiselectable>
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  {options.length === 0
                    ? "등록된 레이어 그룹이 없습니다."
                    : "일치하는 그룹이 없습니다."}
                </li>
              ) : (
                filtered.map((g) => {
                  const id = `layer-group-${g}`
                  const checked = selectedSet.has(g)
                  return (
                    <li key={g}>
                      <label
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/70",
                          checked && "bg-muted/40"
                        )}
                      >
                        <input
                          id={id}
                          type="checkbox"
                          className="shrink-0"
                          checked={checked}
                          onChange={(e) => toggle(g, e.target.checked)}
                        />
                        <span className="min-w-0 truncate" title={g}>
                          {g}
                        </span>
                      </label>
                    </li>
                  )
                })
              )}
            </ul>
            <div className="flex shrink-0 justify-end border-t border-border px-2 py-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-none px-2.5 text-[11px]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={closePanel}
              >
                닫기
              </Button>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <div className="col-span-2 relative" ref={rootRef}>
      <div className="relative">
        <Input
          ref={inputRef}
          className={cn(
            "rounded-none font-mono text-xs pr-8",
            open && "ring-1 ring-primary border-primary"
          )}
          value={displayValue}
          disabled={disabled}
          placeholder={open ? "레이어 그룹 검색" : "클릭하여 레이어 그룹 선택"}
          title="레이어 그룹"
          autoComplete="off"
          onFocus={() => {
            setOpen(true)
            setSearch("")
            setFiltering(true)
          }}
          onClick={() => {
            setOpen(true)
          }}
          onChange={(e) => {
            setOpen(true)
            const v = e.target.value
            if (!filtering) {
              const prev = formatList(selected)
              setFiltering(true)
              setSearch(v.startsWith(prev) ? v.slice(prev.length) : v)
              return
            }
            setSearch(v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closePanel()
              inputRef.current?.blur()
            }
          }}
        />
        {showClear && !disabled ? (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={open && filtering && search.trim() ? "검색 지우기" : "선택 지우기"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open && filtering && search.trim()) {
                setSearch("")
                inputRef.current?.focus()
                return
              }
              onChange([])
              setSearch("")
              setFiltering(false)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {panel}
    </div>
  )
}

function isValidColor(str: string): boolean {
  if (!str || typeof str !== "string") return false
  const s = str.trim()
  if (!s) return false
  if (/^#[0-9A-Fa-f]{3,8}$/.test(s)) return true
  if (/^rgb\(|^rgba\(|^hsl\(|^hsla\(/.test(s)) return true
  if (/^[a-zA-Z]+$/.test(s) && s.length <= 20) return true
  return false
}

function ColorPreview({ value }: { value: string }) {
  const valid = isValidColor(value)
  return (
    <div
      className="w-6 h-5 rounded border border-border shrink-0"
      style={valid ? { backgroundColor: value.trim() } : undefined}
      title={value || "(없음)"}
    >
      {!valid && <span className="text-[10px] text-muted-foreground/50 leading-5 block text-center">-</span>}
    </div>
  )
}

function SvgPreview({ value, color }: { value: string; color?: string }) {
  const raw = (value ?? "").trim()
  if (!raw) {
    return (
      <div className="w-7 h-6 flex items-center justify-center rounded border border-dashed border-muted-foreground/30 bg-muted/30">
        <span className="text-[10px] text-muted-foreground/50">-</span>
      </div>
    )
  }
  const isInlineSvg = raw.startsWith("<")
  if (isInlineSvg) {
    return (
      <div
        className="w-7 h-6 flex items-center justify-center rounded border border-border bg-muted/20 overflow-hidden [&_svg]:w-5 [&_svg]:h-5 [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:fill-none [&_svg]:stroke-current"
        style={color ? { color } : undefined}
        dangerouslySetInnerHTML={{ __html: raw }}
        title="SVG 미리보기"
      />
    )
  }
  if (color) {
    const maskSrc = withBasePath(raw)
    return (
      <div
        className="w-7 h-6 shrink-0 rounded border border-border overflow-hidden"
        style={{
          backgroundColor: color,
          WebkitMaskImage: `url(${maskSrc})`,
          maskImage: `url(${maskSrc})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
        title="SVG 미리보기"
      />
    )
  }
  return (
    <div className="w-7 h-6 flex items-center justify-center rounded border border-border bg-muted/20 overflow-hidden">
      <img src={withBasePath(raw)} alt="" className="max-w-6 max-h-5 object-contain" title="SVG 미리보기" />
    </div>
  )
}

export function SystemListManager() {
  const [systems, setSystems] = useState<SystemItemWithSource[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [addSource, setAddSource] = useState<SystemSource | null>(null)
  const [form, setForm] = useState<SystemItem>(emptySystem())
  const [layerGroups, setLayerGroups] = useState<string[]>([])

  const loadLayerGroups = async () => {
    try {
      const body = await fetchDefineLayerTables()
      const tables = Array.isArray(body?.data) ? body.data : []
      const groupSet = new Set<string>()
      for (const row of tables) {
        const g = String((row as { define_table_group?: unknown }).define_table_group ?? "").trim()
        if (g) groupSet.add(g)
      }
      setLayerGroups([...groupSet].sort((a, b) => a.localeCompare(b, "ko")))
    } catch {
      setLayerGroups([])
    }
  }

  const loadSystems = async () => {
    setLoading(true)
    setError(null)
    try {
      const [configRes, customRes] = await Promise.all([
        call("", "POST", { service: "configService", action: "getSystemListAll", params: {} }),
        call("", "POST", { service: "sysService", action: "getCustomSystems", params: {} }),
      ])
      const common: SystemItemWithSource[] = (Array.isArray(configRes.data?.systems) ? configRes.data.systems : []).map(
        (s: SystemItem) => ({ ...s, source: "common" as const })
      )
      // API 응답이 { success, data: serviceResult } 이고, sysService는 { success, data: array } 반환 → 배열은 customRes.data.data
      const customRaw = customRes.data?.data ?? customRes.data
      const custom: SystemItemWithSource[] = (Array.isArray(customRaw) ? customRaw : []).map((s: SystemItem) => ({
        ...s,
        source: "custom" as const,
      }))
      setSystems([...custom, ...common])
    } catch (e: any) {
      setError(e?.message ?? "목록 조회 실패")
      setSystems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSystems()
    void loadLayerGroups()
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadSystems()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const openAddCommon = () => {
    setSuccessMsg(null)
    setEditingIndex(null)
    setAddSource("common")
    setForm(emptySystem())
    setDialogOpen(true)
  }

  const deleteCommonAt = (index: number) => {
    closeDialog()
    const newList = systems.filter((_, i) => i !== index)
    setSystems(newList)
    ;(async () => {
      try {
        setSaving(true)
        const commonOnly = newList.filter((s) => s.source === "common").map(({ source: _, ...s }) => s)
        const res = await call("", "POST", {
          service: "configService",
          action: "saveSystemList",
          params: { systems: commonOnly },
        })
        if (!res.success) throw new Error(res.error)
        setSuccessMsg("공통 목록이 파일에 저장되었습니다.")
      } catch (e: any) {
        setError(e?.message ?? "파일 저장 실패")
      } finally {
        setSaving(false)
      }
    })()
  }

  const openAddCustom = () => {
    setSuccessMsg(null)
    setEditingIndex(null)
    setAddSource("custom")
    setForm(emptySystem())
    setDialogOpen(true)
  }

  const openEdit = (index: number) => {
    setSuccessMsg(null)
    setEditingIndex(index)
    setAddSource(null)
    setForm({ ...systems[index] })
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingIndex(null)
    setAddSource(null)
  }

  const currentSource = (): SystemSource => {
    if (addSource) return addSource
    if (editingIndex !== null && systems[editingIndex]) return systems[editingIndex].source
    return "common"
  }

  const saveForm = async () => {
    const source = currentSource()
    if (!form.sys_kor?.trim()) {
      setError("시스템 한글명은 필수입니다.")
      return
    }
    if (source === "common" && !form.sys_key?.trim()) {
      setError("공통 시스템은 시스템 키가 필수입니다.")
      return
    }
    const next = {
      ...form,
      sys_idx: Number(form.sys_idx) || 0,
      serviceList: Array.isArray(form.serviceList) ? form.serviceList : [],
      layerList: Array.isArray(form.layerList) ? form.layerList : [],
    }

    if (source === "common") {
      setError(null)
      let nextList: SystemItemWithSource[]
      if (editingIndex !== null) {
        nextList = [...systems]
        nextList[editingIndex] = { ...next, source: "common" }
      } else {
        nextList = [...systems, { ...next, source: "common" }]
      }
      setSystems(nextList)
      closeDialog()
      try {
        setSaving(true)
        const commonOnly = nextList.filter((s) => s.source === "common").map(({ source: _, ...s }) => s)
        const res = await call("", "POST", {
          service: "configService",
          action: "saveSystemList",
          params: { systems: commonOnly },
        })
        if (!res.success) throw new Error(res.error)
        setSuccessMsg("공통 목록이 파일에 저장되었습니다.")
      } catch (e: any) {
        setError(e?.message ?? "파일 저장 실패")
      } finally {
        setSaving(false)
      }
      return
    }

    if (source === "custom") {
      setError(null)
      try {
        if (editingIndex !== null) {
          const res = await call("", "POST", {
            service: "sysService",
            action: "updateSystem",
            params: {
              sys_key: next.sys_key,
              sys_kor: next.sys_kor,
              sys_eng: next.sys_eng,
              sys_detail: next.sys_detail,
              sys_img: next.sys_img,
              sys_idx: next.sys_idx,
              sys_col: next.sys_col,
              sys_link: next.sys_link,
              sys_is_private: next.sys_is_private === true,
            },
          })
          if (!res?.success) throw new Error((res as any)?.error ?? "수정 실패")
          const payload = res?.data ?? res
          if (payload?.success === false) throw new Error(payload?.error ?? "수정 실패")
          setSuccessMsg("커스텀 시스템이 수정되었습니다.")
        } else {
          const res = await call("", "POST", {
            service: "sysService",
            action: "createSystem",
            params: {
              sys_kor: next.sys_kor,
              sys_eng: next.sys_eng,
              sys_detail: next.sys_detail,
              sys_img: next.sys_img,
              sys_idx: next.sys_idx,
              sys_col: next.sys_col,
              sys_link: next.sys_link,
              sys_is_private: next.sys_is_private === true,
            },
          })
          if (!res?.success) throw new Error((res as any)?.error ?? "추가 실패")
          const payload = res?.data ?? res
          if (payload?.success === false) throw new Error(payload?.error ?? "추가 실패")
          setSuccessMsg("커스텀 시스템이 추가되었습니다.")
        }
        await loadSystems()
        closeDialog()
      } catch (e: any) {
        setError(e?.message ?? "저장 실패")
      }
    }
  }

  const removeAt = async (index: number) => {
    const row = systems[index]
    if (!row) return
    if (!confirm("이 시스템을 삭제할까요?")) return

    if (row.source === "common") {
      deleteCommonAt(index)
      return
    }

    try {
      const res = await call("", "POST", {
        service: "sysService",
        action: "deleteSystem",
        params: { sys_key: row.sys_key },
      })
      if (!res?.success) throw new Error((res as any)?.error ?? "삭제 실패")
      const payload = res?.data ?? res
      if (payload?.success === false) throw new Error(payload?.error ?? "삭제 실패")
      setSuccessMsg("커스텀 시스템이 삭제되었습니다.")
      await loadSystems()
      closeDialog()
    } catch (e: any) {
      setError(e?.message ?? "삭제 실패")
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">로딩 중...</p>
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 rounded">{error}</div>
      )}
      {successMsg && (
        <div className="text-sm text-green-700 bg-green-50 dark:bg-green-950/50 px-3 py-1.5 rounded">{successMsg}</div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" className="rounded-none gap-1" onClick={openAddCommon}>
          <Plus className="w-4 h-4" />
          공통 추가
        </Button>
        <Button size="sm" className="rounded-none gap-1" onClick={openAddCustom}>
          <Plus className="w-4 h-4" />
          커스텀 추가
        </Button>
        {saving && (
          <span className="text-xs text-muted-foreground self-center">저장 중...</span>
        )}
      </div>

      <div className="border rounded overflow-hidden">
        <Table className="[&_th]:py-1.5 [&_td]:py-1.5">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-20">구분</TableHead>
              <TableHead className="w-24">시스템 키</TableHead>
              <TableHead className="w-36 max-w-[160px]">시스템 한글명</TableHead>
              <TableHead className="w-32">시스템 영문명</TableHead>
              <TableHead className="w-12 text-center">시스템 이미지</TableHead>
              <TableHead className="w-20">시스템 순서</TableHead>
              <TableHead className="w-12 text-center">시스템 색상</TableHead>
              <TableHead className="w-32">바로가기 주소</TableHead>
              <TableHead className="w-40 max-w-[200px] truncate">시스템 상세</TableHead>
              <TableHead className="w-20 text-center">서비스</TableHead>
              <TableHead className="w-20 text-center">레이어그룹</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {systems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-5">
                  등록된 시스템이 없습니다. 공통 추가 또는 커스텀 추가로 등록하세요.
                </TableCell>
              </TableRow>
            ) : (
              systems.map((s, i) => (
                <TableRow
                  key={s.source === "common" ? `common-${s.sys_key}` : `custom-${s.sys_key}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openEdit(i)}
                >
                  <TableCell className="text-xs font-medium">
                    {s.source === "common" ? "공통" : "커스텀"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.sys_key}</TableCell>
                  <TableCell className="text-sm max-w-[160px] truncate" title={s.sys_kor}>
                    {s.sys_kor}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.sys_eng ?? "-"}</TableCell>
                  <TableCell className="align-middle">
                    <div className="flex justify-center items-center">
                      <SvgPreview value={(s.sys_img ?? "").trim() || `/image/systemlistIcon/${s.sys_key}.svg`} color={s.sys_col || undefined} />
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.sys_idx}</TableCell>
                  <TableCell className="align-middle">
                    <div className="flex justify-center items-center">
                      <ColorPreview value={s.sys_col ?? ""} />
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]" title={s.sys_link ?? ""}>
                    {s.sys_link ?? "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={s.sys_detail}>
                    {s.sys_detail ?? "-"}
                  </TableCell>
                  <TableCell className="text-center text-xs">{s.serviceList?.length ?? 0}</TableCell>
                  <TableCell className="text-center text-xs">{s.layerList?.length ?? 0}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none">
          <DialogHeader>
            <DialogTitle>
              {editingIndex !== null
                ? "시스템 상세정보"
                : addSource === "common"
                  ? "공통 시스템 추가"
                  : "커스텀 시스템 추가"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 키</label>
              <Input
                className="col-span-2 rounded-none"
                value={currentSource() === "custom" && editingIndex === null ? "(자동)" : form.sys_key}
                onChange={(e) => setForm((f) => ({ ...f, sys_key: e.target.value }))}
                placeholder="예: wtl"
                disabled={currentSource() === "custom" || editingIndex !== null}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 한글명</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_kor}
                onChange={(e) => setForm((f) => ({ ...f, sys_kor: e.target.value }))}
                placeholder="한글명"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 영문명</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_eng ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_eng: e.target.value }))}
                placeholder="영문명"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 이미지</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_img ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_img: e.target.value }))}
                placeholder="SVG 등"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 순서</label>
              <Input
                type="number"
                className="col-span-2 rounded-none"
                value={form.sys_idx || ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_idx: Number(e.target.value) || 0 }))}
                placeholder="정렬 순서"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 색상</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_col ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_col: e.target.value }))}
                placeholder="색상 코드"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">바로가기 주소</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_link ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_link: e.target.value }))}
                placeholder="URL"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">시스템 상세</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.sys_detail ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, sys_detail: e.target.value }))}
                placeholder="#태그1 #태그2"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">비공개 시스템</label>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sys_is_private === true}
                  onChange={(e) => setForm((f) => ({ ...f, sys_is_private: e.target.checked }))}
                />
                로그인만으로는 접근 불가 (권한·신청 필요)
              </label>
            </div>
            {currentSource() === "common" && (
              <>
                <div className="grid grid-cols-3 gap-2 items-start">
                  <label className="text-sm font-medium pt-2">서비스 목록</label>
                  <Input
                    className="col-span-2 rounded-none font-mono text-xs"
                    value={formatList(form.serviceList)}
                    onChange={(e) => setForm((f) => ({ ...f, serviceList: parseListStr(e.target.value) }))}
                    placeholder="쉼표로 구분"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 items-start">
                  <label className="text-sm font-medium pt-2">레이어 그룹</label>
                  <LayerGroupMultiPick
                    value={form.layerList ?? []}
                    onChange={(layerList) => setForm((f) => ({ ...f, layerList }))}
                    options={layerGroups}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <div>
              {editingIndex !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    removeAt(editingIndex)
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  삭제
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-none" onClick={closeDialog}>
                취소
              </Button>
              <Button size="sm" className="rounded-none" onClick={saveForm}>
                {editingIndex !== null ? "적용" : "추가"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
