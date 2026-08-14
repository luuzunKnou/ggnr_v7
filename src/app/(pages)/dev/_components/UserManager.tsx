"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/shadcnComponents/ui/dialog"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import { Building2, CalendarClock, Check, FileText, IdCard, Lock, Mail, Phone, Plus, User, Users, X } from "lucide-react"
import { PermRoleMappingPanel } from "./perm/PermRoleMappingPanel"
import { UgUtManageModal } from "./UgUtManageModal"
import { USER_MANAGER_UI_STYLE } from "./userManagerUiVariants"

type UserRow = {
  usrId: string
  ugName: string
  utName: string
  usrName: string | null
  usrTel: string | null
  usrMail: string | null
  usrIsManager: boolean | null
  usrIsSo: boolean | null
  usrIsDel: boolean | null
  usrIsHidden: boolean | null
  usrEtc: string | null
  usrReqTime: string | null
  usrOkTime: string | null
  usrCancleTime: string | null
  /** listUsers에서 조인된 권한 표시명 */
  permNames?: string[]
}

type UgRow = { ugName: string }
type UtRow = { utName: string; ugName: string }
type PermRow = { permKey: number; permName: string | null; permEtc: string | null }

/** 시스템별 접속권한 `SysAccessSegments` 와 동일 톤의 2단 토글 */
const USER_PERM_GRANT_OPTIONS = [
  { granted: false as const, label: "없음" },
  { granted: true as const, label: "적용" },
] as const

function UserPermGrantSegments(props: { granted: boolean; onChange: (granted: boolean) => void }) {
  const { granted, onChange } = props
  return (
    <div
      role="group"
      aria-label="권한 부여"
      className="inline-flex max-w-full shrink-0 flex-wrap gap-px border border-border/70 bg-muted/40 p-px rounded-[3px]"
    >
      {USER_PERM_GRANT_OPTIONS.map((o) => {
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

type FormState = {
  usr_id: string
  ug_name: string
  ut_name: string
  usr_name: string
  usr_pwd: string
  usr_pwd_confirm: string
  usr_tel: string
  usr_mail: string
  usr_etc: string
  usr_req_time: string
  usr_ok_time: string
  usr_cancle_time: string
}

const emptyForm = (): FormState => ({
  usr_id: "",
  ug_name: "",
  ut_name: "",
  usr_name: "",
  usr_pwd: "",
  usr_pwd_confirm: "",
  usr_tel: "",
  usr_mail: "",
  usr_etc: "",
  usr_req_time: "",
  usr_ok_time: "",
  usr_cancle_time: "",
})

/** 한글 초성 ※음절 맨 앞 자음 (ㄱ…ㅎ). 타입어헤드 초성 검색용 */
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

function isChoseongOnlyQuery(q: string): boolean {
  return q.length > 0 && [...q].every((ch) => HANGUL_CHOSEONG.includes(ch))
}

/** 부분 문자열·초성(예: ㅌ → 토지과) 매칭 */
function matchesSuggestQuery(label: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const lower = label.toLowerCase()
  const qLower = q.toLowerCase()
  if (lower.includes(qLower)) return true
  const labelCho = toChoseongKey(label)
  const queryCho = toChoseongKey(q)
  if (labelCho.includes(queryCho)) return true
  if (isChoseongOnlyQuery(q) && labelCho.startsWith(queryCho)) return true
  return false
}

function LabeledInput({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  required = false,
}: {
  label: string
  icon?: React.ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: "text" | "password" | "email"
  disabled?: boolean
  required?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
      <span className="w-20 shrink-0 text-[12px] text-muted-foreground/90">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "-"}
        disabled={disabled}
        style={{ fontSize: "12px" }}
        className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
      />
    </div>
  )
}

/** 직접 입력 + 목록 선택(타입어헤드 ※입력 중 연관 목록 자동 제안) */
function LabeledSuggestInput({
  label,
  icon,
  value,
  onChange,
  options,
  placeholder = "직접 입력 또는 선택",
  disabled = false,
  required = false,
}: {
  label: string
  icon?: React.ReactNode
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const raw of options) {
      const name = raw.trim()
      if (!name || seen.has(name)) continue
      if (!matchesSuggestQuery(name, value)) continue
      seen.add(name)
      list.push(name)
    }
    return list.slice(0, 40)
  }, [options, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div className="flex items-center gap-2" ref={rootRef}>
      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
      <span className="w-20 shrink-0 text-[12px] text-muted-foreground/90">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      <div className="relative flex-1 min-w-0">
        <Input
          type="text"
          value={value ?? ""}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          style={{ fontSize: "12px" }}
          className="h-8 w-full border-border/80 bg-muted/30 placeholder:text-[12px]"
          title={`${label}: ${placeholder}`}
        />
        {open && !disabled && suggestions.length > 0 ? (
          <ul
            className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 max-h-44 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
            role="listbox"
          >
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={name === value}
                  className="flex w-full px-2.5 py-1.5 text-left text-[12px] hover:bg-muted"
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
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export function UserManager() {
  const [items, setItems] = useState<UserRow[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [ugList, setUgList] = useState<UgRow[]>([])
  const [utList, setUtList] = useState<UtRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editingUsrId, setEditingUsrId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"add" | "detail">("add")
  const [form, setForm] = useState<FormState>(emptyForm())
  const [permList, setPermList] = useState<PermRow[]>([])
  const [selectedPermKeys, setSelectedPermKeys] = useState<Set<number>>(new Set())
  const [permLoading, setPermLoading] = useState(false)
  const [permMappingOpen, setPermMappingOpen] = useState(false)
  const [permMappingKey, setPermMappingKey] = useState<number | null>(null)
  const [permMappingName, setPermMappingName] = useState<string>("")
  const [permMappingError, setPermMappingError] = useState<string | null>(null)
  const [ugUtManageOpen, setUgUtManageOpen] = useState(false)
  /** 모달 닫힌 직후 표로 클릭이 새어 상세가 다시 열리는 것 방지 */
  const suppressRowClickUntilRef = useRef(0)
  const uiStyle = USER_MANAGER_UI_STYLE

  const filteredUtList = useMemo(() => {
    if (!form.ug_name) return utList
    return utList.filter((x) => x.ugName === form.ug_name)
  }, [utList, form.ug_name])

  const ugSuggestOptions = useMemo(
    () => ugList.map((x) => x.ugName).filter(Boolean),
    [ugList]
  )
  const utSuggestOptions = useMemo(
    () => filteredUtList.map((x) => x.utName).filter(Boolean),
    [filteredUtList]
  )

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return items

    return items.filter((row) => {
      const searchable = [
        row.usrId,
        row.ugName,
        row.utName,
        row.usrName ?? "",
        row.usrTel ?? "",
        row.usrMail ?? "",
        row.usrEtc ?? "",
        ...(row.permNames ?? []),
        row.usrIsManager ? "관리자 true yes 1" : "관리자 false no 0",
        row.usrIsSo ? "새올 true yes 1" : "새올 false no 0",
        row.usrIsHidden ? "숨김 true yes 1" : "숨김 false no 0",
        row.usrIsDel ? "삭제 true yes 1" : "삭제 false no 0",
      ]
        .join(" ")
        .toLowerCase()

      return searchable.includes(q)
    })
  }, [items, searchQuery])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, metaRes] = await Promise.all([
        call("", "POST", { service: "usrService", action: "listUsers", params: {} }),
        call("", "POST", { service: "usrService", action: "getUserMeta", params: {} }),
      ])
      const users = (usersRes.data?.data ?? usersRes.data ?? []) as UserRow[]
      const meta = (metaRes.data?.data ?? metaRes.data ?? {}) as { ug?: UgRow[]; ut?: UtRow[] }
      setItems(Array.isArray(users) ? users : [])
      setUgList(Array.isArray(meta.ug) ? meta.ug : [])
      setUtList(Array.isArray(meta.ut) ? meta.ut : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "사용자 목록 조회 실패")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadPerms = async () => {
      try {
        const res = await call("", "POST", {
          service: "usrService",
          action: "listPermCatalog",
          params: {},
        })
        const rows = (res.data?.data ?? res.data ?? []) as PermRow[]
        if (!cancelled) setPermList(Array.isArray(rows) ? rows : [])
      } catch {
        if (!cancelled) setPermList([])
      }
    }
    void loadPerms()
    return () => {
      cancelled = true
    }
  }, [])

  const openPermMapping = (permKey: number, permName: string) => {
    setPermMappingKey(permKey)
    setPermMappingName(permName)
    setPermMappingError(null)
    setPermMappingOpen(true)
  }

  const startAdd = () => {
    setEditingUsrId(null)
    setForm(emptyForm())
    setMessage(null)
    setError(null)
    setModalError(null)
    setModalMode("add")
    setSelectedPermKeys(new Set())
    setModalOpen(true)
  }

  const closeModalAfterSave = () => {
    suppressRowClickUntilRef.current = Date.now() + 400
    setModalOpen(false)
  }

  const startEdit = async (row: UserRow) => {
    if (Date.now() < suppressRowClickUntilRef.current) return
    setEditingUsrId(row.usrId)
    setForm({
      usr_id: row.usrId,
      ug_name: row.ugName ?? "",
      ut_name: row.utName ?? "",
      usr_name: row.usrName ?? "",
      usr_pwd: "",
      usr_pwd_confirm: "",
      usr_tel: row.usrTel ?? "",
      usr_mail: row.usrMail ?? "",
      usr_etc: row.usrEtc ?? "",
      usr_req_time: row.usrReqTime ?? "",
      usr_ok_time: row.usrOkTime ?? "",
      usr_cancle_time: row.usrCancleTime ?? "",
    })
    setError(null)
    setModalError(null)
    setModalMode("detail")
    setModalOpen(true)
    setPermLoading(true)
    try {
      const res = await call("", "POST", {
        service: "usrService",
        action: "listUserPermKeys",
        params: { usr_id: row.usrId },
      })
      const keys = (res.data?.data ?? res.data ?? []) as number[]
      const next = new Set(
        (Array.isArray(keys) ? keys : []).filter((k) => Number.isInteger(Number(k))).map((k) => Number(k))
      )
      setSelectedPermKeys(next)
    } catch {
      setSelectedPermKeys(new Set())
    } finally {
      setPermLoading(false)
    }
  }

  const onSubmit = async () => {
    setSaving(true)
    setError(null)
    setModalError(null)
    setMessage(null)
    try {
      if (!form.usr_id.trim()) throw new Error("아이디를 입력하세요.")
      if (!form.ug_name.trim()) throw new Error("부서를 선택하세요.")
      if (!form.ut_name.trim()) throw new Error("팀을 선택하세요.")
      const pwd = form.usr_pwd.trim()
      const pwdConfirm = form.usr_pwd_confirm.trim()

      if (!editingUsrId && !pwd) throw new Error("신규 등록 시 비밀번호는 필수입니다.")
      if (!editingUsrId && !pwdConfirm) throw new Error("신규 등록 시 비밀번호 확인은 필수입니다.")

      if (editingUsrId && (pwd || pwdConfirm) && (!pwd || !pwdConfirm)) {
        throw new Error("비밀번호 변경 시 비밀번호와 비밀번호 확인을 모두 입력하세요.")
      }

      if ((pwd || pwdConfirm) && pwd !== pwdConfirm) {
        throw new Error("비밀번호와 비밀번호 확인이 일치하지 않습니다.")
      }

      const params = {
        ...form,
        usr_id: form.usr_id.trim(),
        ug_name: form.ug_name.trim(),
        ut_name: form.ut_name.trim(),
        perm_keys: Array.from(selectedPermKeys),
      }

      const action = editingUsrId ? "updateUser" : "createUser"
      const res = await call("", "POST", { service: "usrService", action, params })
      if (res.success === false || res.data?.success === false) {
        const msg = res.data?.error || res.error || "저장 실패"
        throw new Error(msg)
      }
      setMessage(editingUsrId ? "사용자를 수정했습니다." : "사용자를 추가했습니다.")
      await loadAll()
      if (!editingUsrId) setForm(emptyForm())
      closeModalAfterSave()
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "저장 실패")
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (usrId: string) => {
    setSaving(true)
    setError(null)
    setModalError(null)
    setMessage(null)
    try {
      const res = await call("", "POST", {
        service: "usrService",
        action: "deleteUser",
        params: { usr_id: usrId },
      })
      if (res.success === false || res.data?.success === false) {
        const msg = res.data?.error || res.error || "삭제 실패"
        throw new Error(msg)
      }
      setMessage("삭제했습니다.")
      if (editingUsrId === usrId) {
        setEditingUsrId(null)
        setForm(emptyForm())
        closeModalAfterSave()
      }
      await loadAll()
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "삭제 실패")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={uiStyle.page}>
      <div className={uiStyle.toolbar}>
        <Button
          type="button"
          size="sm"
          onClick={startAdd}
          disabled={saving}
          className={cn("rounded-none gap-1", uiStyle.primaryButton)}
          title="사용자 추가"
        >
          <Plus className="h-4 w-4" />
          사용자 추가
        </Button>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="통합검색 (아이디, 이름, 부서/팀, 연락처, 이메일, 비고, 권한, 상태)"
          className={uiStyle.search}
          title="통합검색"
        />
        {error ? (
          <p className="min-w-0 max-w-[280px] shrink truncate text-sm text-red-600" title={error}>
            {error}
          </p>
        ) : message ? (
          <p className="min-w-0 max-w-[280px] shrink truncate text-sm text-emerald-600" title={message}>
            {message}
          </p>
        ) : null}
        {loading && <span className="text-sm text-muted-foreground">조회 중...</span>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("ml-auto shrink-0 rounded-none", uiStyle.secondaryButton)}
          onClick={() => setUgUtManageOpen(true)}
          disabled={saving}
          title="부서/팀 관리"
        >
          부서/팀 관리
        </Button>
      </div>

      <div className={uiStyle.tableWrap}>
        <table className={uiStyle.table}>
          <thead className={cn("sticky top-0", uiStyle.tableHead)}>
            <tr>
              <th className={cn("text-left", uiStyle.tableCell)}>아이디</th>
              <th className={cn("text-left", uiStyle.tableCell)}>이름</th>
              <th className={cn("text-left", uiStyle.tableCell)}>부서/팀</th>
              <th className={cn("text-left", uiStyle.tableCell)}>연락처</th>
              <th className={cn("text-left w-[28%]", uiStyle.tableCell)}>권한</th>
              <th className={cn("text-left w-[22%]", uiStyle.tableCell)}>비고</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((row) => (
              <tr
                key={row.usrId}
                className={uiStyle.tableRow}
                onClick={() => void startEdit(row)}
              >
                <td className={uiStyle.tableCell}>{row.usrId}</td>
                <td className={uiStyle.tableCell}>{row.usrName ?? "-"}</td>
                <td className={uiStyle.tableCell}>{row.ugName} / {row.utName}</td>
                <td className={uiStyle.tableCell}>{row.usrTel ?? "-"}</td>
                <td className={cn("w-[28%]", uiStyle.tableCell)}>
                  <span
                    className="block truncate"
                    title={(row.permNames?.length ? row.permNames.join(", ") : "") || "권한 없음"}
                  >
                    {row.permNames?.length ? row.permNames.join(", ") : "-"}
                  </span>
                </td>
                <td className={cn("w-[22%]", uiStyle.tableCell)}>
                  <span className="block truncate" title={row.usrEtc ?? ""}>
                    {row.usrEtc ?? "-"}
                  </span>
                </td>
              </tr>
            ))}
            {!filteredItems.length && (
              <tr>
                <td className={cn("text-muted-foreground", uiStyle.tableCell)} colSpan={6}>
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className={uiStyle.dialog} showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>{modalMode === "add" ? "사용자 추가" : "사용자 상세보기"}</DialogTitle>
          </DialogHeader>
          <div className={cn("flex shrink-0 items-center justify-between", uiStyle.dialogHeader)}>
            <span className="text-xs font-medium text-slate-600">{modalMode === "add" ? "사용자 추가" : "사용자 상세보기"}</span>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className={cn("flex min-h-0 overflow-hidden", uiStyle.dialogBody)}>
            <div className={cn("flex-1 min-w-0 overflow-auto", uiStyle.formPanel)}>
              <div className="flex flex-col gap-3.5">
                <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
                  <LabeledInput
                    label="아이디"
                    icon={<IdCard className="h-3.5 w-3.5" />}
                    value={form.usr_id}
                    onChange={(v) => setForm((p) => ({ ...p, usr_id: v }))}
                    disabled={modalMode === "detail"}
                    required={modalMode === "add"}
                  />
                  <LabeledInput
                    label="이름"
                    icon={<User className="h-3.5 w-3.5" />}
                    value={form.usr_name}
                    onChange={(v) => setForm((p) => ({ ...p, usr_name: v }))}
                  />
                  <LabeledSuggestInput
                    label="부서"
                    icon={<Building2 className="h-3.5 w-3.5" />}
                    value={form.ug_name}
                    onChange={(v) => setForm((p) => ({ ...p, ug_name: v, ut_name: "" }))}
                    options={ugSuggestOptions}
                    placeholder="직접 입력 또는 선택"
                    required={modalMode === "add"}
                  />
                  <LabeledSuggestInput
                    label="팀"
                    icon={<Users className="h-3.5 w-3.5" />}
                    value={form.ut_name}
                    onChange={(v) => setForm((p) => ({ ...p, ut_name: v }))}
                    options={utSuggestOptions}
                    placeholder="직접 입력 또는 선택"
                    required={modalMode === "add"}
                  />
                  <LabeledInput
                    label="연락처"
                    icon={<Phone className="h-3.5 w-3.5" />}
                    value={form.usr_tel}
                    onChange={(v) => setForm((p) => ({ ...p, usr_tel: v }))}
                  />
                  <LabeledInput
                    label="이메일"
                    icon={<Mail className="h-3.5 w-3.5" />}
                    type="email"
                    value={form.usr_mail}
                    onChange={(v) => setForm((p) => ({ ...p, usr_mail: v }))}
                  />
                  <LabeledInput
                    label="비밀번호"
                    icon={<Lock className="h-3.5 w-3.5" />}
                    type="password"
                    value={form.usr_pwd}
                    onChange={(v) => setForm((p) => ({ ...p, usr_pwd: v }))}
                    placeholder={modalMode === "add" ? "필수" : "변경 시 입력"}
                    required={modalMode === "add"}
                  />
                  <LabeledInput
                    label="비밀번호확인"
                    icon={<Lock className="h-3.5 w-3.5" />}
                    type="password"
                    value={form.usr_pwd_confirm}
                    onChange={(v) => setForm((p) => ({ ...p, usr_pwd_confirm: v }))}
                    placeholder={modalMode === "add" ? "필수" : "변경 시 함께 입력"}
                    required={modalMode === "add"}
                  />
                  <LabeledInput
                    label="신청시간"
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    value={form.usr_req_time}
                    onChange={() => {}}
                    disabled
                  />
                  <LabeledInput
                    label="승인시간"
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    value={form.usr_ok_time}
                    onChange={() => {}}
                    disabled
                  />
                  <LabeledInput
                    label="반려시간"
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    value={form.usr_cancle_time}
                    onChange={() => {}}
                    disabled
                  />
                </div>

                <div className="flex items-start gap-2">
                  <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex h-5 shrink-0 items-center w-20 text-[12px] text-muted-foreground/90">비고</span>
                  <textarea
                    value={form.usr_etc}
                    onChange={(e) => setForm((p) => ({ ...p, usr_etc: e.target.value }))}
                    placeholder="-"
                    rows={3}
                    style={{ fontSize: "12px" }}
                    className="min-h-[4.2rem] flex-1 min-w-0 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus:border-primary"
                  />
                </div>
              </div>
            </div>
            {modalMode === "detail" && (
              <div className={cn("w-[280px] shrink-0 flex flex-col min-h-0 overflow-hidden", uiStyle.sidePanel)}>
                <div className="px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">권한 목록</div>
                <div className="flex-1 min-h-0 overflow-auto p-0 space-y-0">
                  {permLoading ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">권한 조회 중...</p>
                  ) : permList.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">표시할 권한이 없습니다.</p>
                  ) : (
                    permList.map((p) => {
                      const granted = selectedPermKeys.has(p.permKey)
                      const name = (p.permName ?? "").trim() || "—"
                      return (
                        <div
                          key={p.permKey}
                          className="flex items-center border-b border-border/50 px-2 py-1 last:border-b-0"
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left text-xs text-foreground leading-snug truncate hover:text-primary hover:underline underline-offset-2"
                            title={`${name} — 권한 매핑 편집`}
                            onClick={() => openPermMapping(p.permKey, name)}
                          >
                            {name}
                          </button>
                          <div onClick={(e) => e.stopPropagation()}>
                            <UserPermGrantSegments
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
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <div className={uiStyle.footer}>
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="min-h-[20px] text-sm text-red-600 px-1 truncate">
                {modalError ?? ""}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  onClick={onSubmit}
                  disabled={saving}
                  size="sm"
                  className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
                >
                  <Check className="h-3 w-3" />
                  {saving ? "저장 중…" : modalMode === "add" ? "추가" : "저장"}
                </Button>
                {modalMode === "detail" && (
                  <Button
                    type="button"
                    onClick={() => {
                      if (!editingUsrId) return
                      if (!window.confirm("이 사용자를 정말 삭제하시겠습니까?")) return
                      void onDelete(editingUsrId)
                    }}
                    disabled={saving || !editingUsrId}
                    size="sm"
                    variant="outline"
                    className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                    삭제
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setModalOpen(false)}
                  className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3 w-3" />
                  닫기
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permMappingOpen}
        onOpenChange={(open) => {
          setPermMappingOpen(open)
          if (!open) {
            setPermMappingKey(null)
            setPermMappingName("")
            setPermMappingError(null)
          }
        }}
      >
        <DialogContent
          className="w-[920px] h-[830px] min-w-[920px] min-h-[830px] max-w-[920px] max-h-[830px] p-0 gap-0 overflow-hidden flex flex-col"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>권한 매핑</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 bg-slate-50/40">
            <span className="text-xs font-medium text-slate-600">
              권한 매핑 — {permMappingName || "—"}
            </span>
            <button
              type="button"
              onClick={() => setPermMappingOpen(false)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden p-3">
            {permMappingError ? (
              <p className="shrink-0 mb-2 text-sm text-red-600">{permMappingError}</p>
            ) : null}
            <PermRoleMappingPanel
              permKey={permMappingKey}
              permName={permMappingName}
              showHeader={false}
              className="flex-1 min-h-0"
              onError={(message) => setPermMappingError(message)}
            />
          </div>
          <div className="px-3 pb-3 shrink-0">
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPermMappingOpen(false)}
                className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
                닫기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <UgUtManageModal
        open={ugUtManageOpen}
        onOpenChange={setUgUtManageOpen}
        onChanged={() => void loadAll()}
      />
    </div>
  )
}
