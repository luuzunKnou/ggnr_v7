"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { call } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react"
import { DevFloatingPanel } from "./DevFloatingPanel"
import { ORG_MANAGER_UI_STYLE } from "./userManagerUiVariants"

type UgRow = { ugName: string }
type UtRow = { ugName: string; utName: string }
type PermRow = { permKey: number; permName: string | null; permEtc: string | null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

async function usrCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call("", "POST", { service: "usrService", action, params })
  if (res.success === false || res.data?.success === false) {
    throw new Error(res.data?.error || res.error || "요청 실패")
  }
  return res.data?.data ?? res.data
}

const INLINE_EDIT_INPUT =
  "h-8 border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0"

const ORG_PERM_GRANT_OPTIONS = [
  { granted: false as const, label: "없음" },
  { granted: true as const, label: "적용" },
] as const

function OrgPermGrantSegments(props: { granted: boolean; onChange: (granted: boolean) => void }) {
  const { granted, onChange } = props
  return (
    <div
      role="group"
      aria-label="권한 부여"
      className="inline-flex max-w-full shrink-0 flex-wrap gap-px border border-border/70 bg-muted/40 p-px rounded-[3px]"
    >
      {ORG_PERM_GRANT_OPTIONS.map((o) => {
        const selected = granted === o.granted
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.granted)}
            className={cn(
              "rounded-[3px] px-1.5 py-0.5 text-[11px] font-normal transition-colors leading-tight",
              selected
                ? o.granted
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-gray-400 text-white shadow-sm dark:bg-slate-600 dark:text-slate-50"
                : "text-muted-foreground hover:bg-background/90 hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** 한글 초성 ※음절 맨 앞 자음. 부서 필터 검색용 */
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

function matchesSuggestQuery(label: string, query: string): boolean {
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

/** 셀렉트 모양 + 열었을 때만 필터(목록 좁히기) */
function UgFilterSelect({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  disabled?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")

  const filtered = useMemo(() => {
    return options.filter((name) => matchesSuggestQuery(name, filter))
  }, [options, filter])

  useEffect(() => {
    if (!open) return
    setFilter("")
    const t = window.setTimeout(() => filterRef.current?.focus(), 0)
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("mousedown", onDoc)
    }
  }, [open])

  return (
    <div className="relative w-[160px] shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        title="소속 부서"
        aria-label="소속 부서"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1 rounded-none border border-border bg-background px-2 text-left text-xs",
          "hover:bg-muted/40 disabled:opacity-50"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>
          {value || "부서 선택"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 rounded-none border border-border bg-popover text-popover-foreground shadow-md">
          <div className="border-b border-border p-1.5">
            <Input
              ref={filterRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="부서 필터"
              className="h-7 rounded-none text-xs"
              title="부서 필터"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false)
              }}
            />
          </div>
          <ul className="max-h-44 overflow-auto" role="listbox">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className="flex w-full px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                title="전체"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                전체
              </button>
            </li>
            {filtered.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={name === value}
                  className={cn(
                    "flex w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted",
                    name === value && "bg-muted/60 font-medium"
                  )}
                  title={name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
            {!filtered.length ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">일치하는 부서가 없습니다.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function UgUtManageModal({ open, onOpenChange, onChanged }: Props) {
  const [tab, setTab] = useState<"ug" | "ut">("ug")
  const [ugList, setUgList] = useState<UgRow[]>([])
  const [utList, setUtList] = useState<UtRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newUgName, setNewUgName] = useState("")
  const [newUtUgName, setNewUtUgName] = useState("")
  const [newUtName, setNewUtName] = useState("")

  const [editUgOld, setEditUgOld] = useState<string | null>(null)
  const [editUgName, setEditUgName] = useState("")
  const [editUtOld, setEditUtOld] = useState<string | null>(null)
  const [editUtName, setEditUtName] = useState("")

  const [selectedUgName, setSelectedUgName] = useState<string | null>(null)
  const [selectedUtName, setSelectedUtName] = useState<string | null>(null)
  const [permList, setPermList] = useState<PermRow[]>([])
  const [selectedPermKeys, setSelectedPermKeys] = useState<Set<number>>(new Set())
  const [savedPermKeys, setSavedPermKeys] = useState<Set<number>>(new Set())
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)

  const ui = ORG_MANAGER_UI_STYLE
  const rowBtn = "h-7 gap-1 rounded-none px-2 text-[11px]"

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const meta = (await usrCall("getUserMeta")) as { ug?: UgRow[]; ut?: UtRow[] }
      setUgList(Array.isArray(meta?.ug) ? meta.ug : [])
      setUtList(Array.isArray(meta?.ut) ? meta.ut : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPermCatalog = useCallback(async () => {
    try {
      const rows = (await usrCall("listPermCatalog")) as PermRow[]
      setPermList(Array.isArray(rows) ? rows : [])
    } catch {
      setPermList([])
    }
  }, [])

  const clearPermSelection = useCallback(() => {
    setSelectedPermKeys(new Set())
    setSavedPermKeys(new Set())
  }, [])

  const loadOrgPerms = useCallback(
    async (kind: "ug" | "ut", name: string) => {
      setPermLoading(true)
      try {
        const action = kind === "ug" ? "listUgPermKeys" : "listUtPermKeys"
        const params = kind === "ug" ? { ug_name: name } : { ut_name: name }
        const keys = (await usrCall(action, params)) as number[]
        const next = new Set(
          (Array.isArray(keys) ? keys : [])
            .filter((k) => Number.isInteger(Number(k)))
            .map((k) => Number(k))
        )
        setSelectedPermKeys(next)
        setSavedPermKeys(new Set(next))
      } catch {
        clearPermSelection()
      } finally {
        setPermLoading(false)
      }
    },
    [clearPermSelection]
  )

  useEffect(() => {
    if (!open) return
    setTab("ug")
    setNewUgName("")
    setNewUtUgName("")
    setNewUtName("")
    setEditUgOld(null)
    setEditUtOld(null)
    setSelectedUgName(null)
    setSelectedUtName(null)
    clearPermSelection()
    setError(null)
    setMessage(null)
    void load()
    void loadPermCatalog()
  }, [open, load, loadPermCatalog, clearPermSelection])

  const ugNames = useMemo(() => ugList.map((x) => x.ugName).filter(Boolean), [ugList])

  /** 부서를 고르면 팀 목록을 해당 부서로 좁힘 */
  const filteredUtList = useMemo(() => {
    const q = newUtUgName.trim()
    if (!q) return utList
    return utList.filter((row) => row.ugName === q)
  }, [utList, newUtUgName])

  const permDirty = useMemo(() => {
    if (selectedPermKeys.size !== savedPermKeys.size) return true
    for (const k of selectedPermKeys) {
      if (!savedPermKeys.has(k)) return true
    }
    return false
  }, [selectedPermKeys, savedPermKeys])

  const activeOrgLabel =
    tab === "ug"
      ? selectedUgName
        ? `부서 「${selectedUgName}」`
        : null
      : selectedUtName
        ? `팀 「${selectedUtName}」`
        : null

  async function run(fn: () => Promise<void>, okMsg: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      setMessage(okMsg)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패")
    } finally {
      setBusy(false)
    }
  }

  async function addUg() {
    const name = newUgName.trim()
    if (!name) {
      setError("부서명을 입력하세요.")
      return
    }
    await run(async () => {
      await usrCall("createUg", { ug_name: name })
      setNewUgName("")
      setSelectedUgName(name)
      setSelectedUtName(null)
      await loadOrgPerms("ug", name)
    }, "부서를 추가했습니다.")
  }

  async function saveUgRename(oldName: string) {
    const name = editUgName.trim()
    if (!name) {
      setError("부서명을 입력하세요.")
      return
    }
    await run(async () => {
      await usrCall("renameUg", { old_ug_name: oldName, new_ug_name: name })
      setEditUgOld(null)
      if (selectedUgName === oldName) {
        setSelectedUgName(name)
        await loadOrgPerms("ug", name)
      }
    }, "부서명을 변경했습니다.")
  }

  async function removeUg(row: UgRow) {
    if (!window.confirm(`부서 「${row.ugName}」을(를) 삭제할까요?\n소속 사용자가 없어야 삭제됩니다.`)) return
    await run(async () => {
      await usrCall("deleteUg", { ug_name: row.ugName })
      if (selectedUgName === row.ugName) {
        setSelectedUgName(null)
        clearPermSelection()
      }
    }, "부서를 삭제했습니다.")
  }

  async function addUt() {
    const ugName = newUtUgName.trim()
    const utName = newUtName.trim()
    if (!ugName || !utName) {
      setError("부서와 팀명을 입력하세요.")
      return
    }
    await run(async () => {
      await usrCall("createUt", { ug_name: ugName, ut_name: utName })
      setNewUtName("")
      setSelectedUtName(utName)
      setSelectedUgName(null)
      await loadOrgPerms("ut", utName)
    }, "팀을 추가했습니다.")
  }

  async function saveUtRename(oldName: string) {
    const name = editUtName.trim()
    if (!name) {
      setError("팀명을 입력하세요.")
      return
    }
    await run(async () => {
      await usrCall("renameUt", { old_ut_name: oldName, new_ut_name: name })
      setEditUtOld(null)
      if (selectedUtName === oldName) {
        setSelectedUtName(name)
        await loadOrgPerms("ut", name)
      }
    }, "팀명을 변경했습니다.")
  }

  async function removeUt(row: UtRow) {
    if (!window.confirm(`팀 「${row.ugName} / ${row.utName}」을(를) 삭제할까요?\n소속 사용자가 없어야 삭제됩니다.`)) return
    await run(async () => {
      await usrCall("deleteUt", { ut_name: row.utName })
      if (selectedUtName === row.utName) {
        setSelectedUtName(null)
        clearPermSelection()
      }
    }, "팀을 삭제했습니다.")
  }

  async function selectUg(name: string) {
    if (editUgOld) return
    setSelectedUgName(name)
    setSelectedUtName(null)
    setMessage(null)
    await loadOrgPerms("ug", name)
  }

  async function selectUt(name: string) {
    if (editUtOld) return
    setSelectedUtName(name)
    setSelectedUgName(null)
    setMessage(null)
    await loadOrgPerms("ut", name)
  }

  async function saveOrgPerms() {
    const kind = tab === "ug" ? "ug" : "ut"
    const name = kind === "ug" ? selectedUgName : selectedUtName
    if (!name) {
      setError(kind === "ug" ? "부서를 선택하세요." : "팀을 선택하세요.")
      return
    }
    setPermSaving(true)
    setError(null)
    setMessage(null)
    try {
      const action = kind === "ug" ? "setUgPerms" : "setUtPerms"
      const params =
        kind === "ug"
          ? { ug_name: name, perm_keys: Array.from(selectedPermKeys) }
          : { ut_name: name, perm_keys: Array.from(selectedPermKeys) }
      await usrCall(action, params)
      setSavedPermKeys(new Set(selectedPermKeys))
      setMessage("권한을 적용했습니다.")
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "권한 저장 실패")
    } finally {
      setPermSaving(false)
    }
  }

  function switchTab(next: "ug" | "ut") {
    if (next === tab) return
    setTab(next)
    setEditUgOld(null)
    setEditUtOld(null)
    setSelectedUgName(null)
    setSelectedUtName(null)
    clearPermSelection()
    setMessage(null)
    setError(null)
  }

  return (
    <DevFloatingPanel
      open={open}
      onClose={() => onOpenChange(false)}
      title="부서 / 팀 관리"
      width="56rem"
      minHeight="560px"
      maxHeight="560px"
      defaultPosition={{ top: 72, right: 48 }}
      dimBackdrop
      className="rounded-none border-border shadow-none dark:ring-border"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={cn("flex shrink-0", ui.orgTabs)}>
          <button
            type="button"
            className={tab === "ug" ? ui.orgTabActive : ui.orgTabIdle}
            onClick={() => switchTab("ug")}
            title="부서 관리"
          >
            부서
          </button>
          <button
            type="button"
            className={tab === "ut" ? ui.orgTabActive : ui.orgTabIdle}
            onClick={() => switchTab("ut")}
            title="팀 관리"
          >
            팀
          </button>
          {loading ? <span className="ml-auto self-center text-[11px] text-muted-foreground">조회 중…</span> : null}
        </div>

        <div className={cn(ui.orgBody, "flex-row gap-3")}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
            {error ? <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            {message ? <p className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}

            {tab === "ug" ? (
              <>
                <div className={ui.orgAddBar}>
                  <Input
                    value={newUgName}
                    onChange={(e) => setNewUgName(e.target.value)}
                    placeholder="새 부서명"
                    className="h-8 flex-1 rounded-none text-xs"
                    disabled={busy}
                    title="새 부서명"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addUg()
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void addUg()}
                    title="부서 추가"
                    className="h-8 gap-1 rounded-none"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    추가
                  </Button>
                </div>
                <div className={ui.orgTableWrap}>
                  <div className={ui.orgTableScroll}>
                    <table className={ui.orgTable}>
                      <thead className={ui.orgTableHead}>
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">부서명</th>
                          <th className="w-[168px] px-3 py-2 text-right font-medium">관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ugList.map((row) => {
                          const editing = editUgOld === row.ugName
                          const selected = selectedUgName === row.ugName
                          return (
                            <tr
                              key={row.ugName}
                              className={cn(
                                ui.orgTableRow,
                                "cursor-pointer",
                                selected && "bg-primary/10 hover:bg-primary/15"
                              )}
                              onClick={() => {
                                if (!editing) void selectUg(row.ugName)
                              }}
                            >
                              <td className="px-3 align-middle">
                                {editing ? (
                                  <Input
                                    value={editUgName}
                                    onChange={(e) => setEditUgName(e.target.value)}
                                    className={cn(INLINE_EDIT_INPUT, "w-full rounded-none text-xs")}
                                    disabled={busy}
                                    title="부서명 수정"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void saveUgRename(row.ugName)
                                      if (e.key === "Escape") setEditUgOld(null)
                                    }}
                                  />
                                ) : (
                                  <span className="text-xs">{row.ugName}</span>
                                )}
                              </td>
                              <td className="px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1">
                                  {editing ? (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => void saveUgRename(row.ugName)}
                                        title="저장"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                        저장
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => setEditUgOld(null)}
                                        title="취소"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                        취소
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => {
                                          setEditUgOld(row.ugName)
                                          setEditUgName(row.ugName)
                                          setEditUtOld(null)
                                        }}
                                        title="이름 수정"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        수정
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={cn(rowBtn, "text-destructive hover:text-destructive")}
                                        disabled={busy}
                                        onClick={() => void removeUg(row)}
                                        title="삭제"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        삭제
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {!ugList.length && (
                          <tr>
                            <td colSpan={2} className="px-3 py-6 text-center text-xs text-muted-foreground">
                              등록된 부서가 없습니다.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className={ui.orgHint}>
                  행을 선택하면 오른쪽에 부서 권한을 설정할 수 있습니다. 이름 변경 시 소속 팀·사용자·권한도
                  함께 바뀝니다.
                </p>
              </>
            ) : (
              <>
                <div className={ui.orgAddBar}>
                  <UgFilterSelect
                    value={newUtUgName}
                    onChange={setNewUtUgName}
                    options={ugNames}
                    disabled={busy}
                  />
                  <Input
                    value={newUtName}
                    onChange={(e) => setNewUtName(e.target.value)}
                    placeholder="새 팀명"
                    className="h-8 flex-1 rounded-none text-xs"
                    disabled={busy}
                    title="새 팀명"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addUt()
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void addUt()}
                    title="팀 추가"
                    className="h-8 gap-1 rounded-none"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    추가
                  </Button>
                </div>
                <div className={ui.orgTableWrap}>
                  <div className={ui.orgTableScroll}>
                    <table className={ui.orgTable}>
                      <thead className={ui.orgTableHead}>
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">부서</th>
                          <th className="px-3 py-2 text-left font-medium">팀명</th>
                          <th className="w-[168px] px-3 py-2 text-right font-medium">관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUtList.map((row) => {
                          const editing = editUtOld === row.utName
                          const selected = selectedUtName === row.utName
                          return (
                            <tr
                              key={row.utName}
                              className={cn(
                                ui.orgTableRow,
                                "cursor-pointer",
                                selected && "bg-primary/10 hover:bg-primary/15"
                              )}
                              onClick={() => {
                                if (!editing) void selectUt(row.utName)
                              }}
                            >
                              <td className="px-3 align-middle text-xs text-muted-foreground">{row.ugName}</td>
                              <td className="px-3 align-middle">
                                {editing ? (
                                  <Input
                                    value={editUtName}
                                    onChange={(e) => setEditUtName(e.target.value)}
                                    className={cn(INLINE_EDIT_INPUT, "w-full rounded-none text-xs")}
                                    disabled={busy}
                                    title="팀명 수정"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void saveUtRename(row.utName)
                                      if (e.key === "Escape") setEditUtOld(null)
                                    }}
                                  />
                                ) : (
                                  <span className="text-xs">{row.utName}</span>
                                )}
                              </td>
                              <td className="px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1">
                                  {editing ? (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => void saveUtRename(row.utName)}
                                        title="저장"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                        저장
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => setEditUtOld(null)}
                                        title="취소"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                        취소
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={rowBtn}
                                        disabled={busy}
                                        onClick={() => {
                                          setEditUtOld(row.utName)
                                          setEditUtName(row.utName)
                                          setEditUgOld(null)
                                        }}
                                        title="이름 수정"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        수정
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={cn(rowBtn, "text-destructive hover:text-destructive")}
                                        disabled={busy}
                                        onClick={() => void removeUt(row)}
                                        title="삭제"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        삭제
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {!filteredUtList.length && (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">
                              {newUtUgName.trim() ? "해당 부서의 팀이 없습니다." : "등록된 팀이 없습니다."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className={ui.orgHint}>
                  행을 선택하면 오른쪽에 팀 권한을 설정할 수 있습니다. 이름 변경 시 소속 사용자·권한도 함께
                  바뀝니다.
                </p>
              </>
            )}
          </div>

          <div className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-none border border-border/70 bg-background/40 dark:bg-background/25">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              권한 목록
              {activeOrgLabel ? (
                <span className="mt-0.5 block truncate font-normal text-[11px] text-foreground/80">
                  {activeOrgLabel}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {!activeOrgLabel ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {tab === "ug" ? "부서를 선택하세요." : "팀을 선택하세요."}
                </p>
              ) : permLoading ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">권한 조회 중…</p>
              ) : permList.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">표시할 권한이 없습니다.</p>
              ) : (
                permList.map((p) => {
                  const granted = selectedPermKeys.has(p.permKey)
                  const name = (p.permName ?? "").trim() || "—"
                  return (
                    <div
                      key={p.permKey}
                      className="flex items-center border-b border-border/50 px-2 py-1 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs leading-snug text-foreground" title={name}>
                        {name}
                      </span>
                      <OrgPermGrantSegments
                        granted={granted}
                        onChange={(on) => {
                          setSelectedPermKeys((prev) => {
                            const next = new Set(prev)
                            if (on) next.add(p.permKey)
                            else next.delete(p.permKey)
                            return next
                          })
                        }}
                      />
                    </div>
                  )
                })
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-2 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 rounded-none px-2.5 text-[11px]"
                disabled={!activeOrgLabel || !permDirty || permSaving || permLoading}
                onClick={() => void saveOrgPerms()}
                title="권한 적용"
              >
                <Check className="h-3.5 w-3.5" />
                {permSaving ? "저장 중…" : "권한 적용"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DevFloatingPanel>
  )
}
