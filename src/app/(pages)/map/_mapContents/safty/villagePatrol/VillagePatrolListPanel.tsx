'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Download, Pencil, RefreshCw, Search, Trash2, Upload, X, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { LayerRowAddButton, LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import {
  TEAMS,
  appendVillagePatrolRows,
  clearVillagePatrolRows,
  filterVillagePatrolRows,
  formatPhone,
  getVillagePatrolRows,
  initialVillagePatrolAssignmentSortDir,
  initialVillagePatrolPersonSortDir,
  loadVillagePatrolRows,
  listAffiliations,
  listEups,
  listVillages,
  normalizePhone,
  personKey,
  replaceVillagePatrolRows,
  saveVillagePatrolBatch,
  sortVillagePatrolAssignmentRows,
  sortVillagePatrolPersonRows,
  subscribeVillagePatrol,
  toUniqueRows,
  truncateNote,
  villagePatrolGroupSpans,
  type VillagePatrolAssignmentSortKey,
  type VillagePatrolAssignmentSortSpec,
  type VillagePatrolFilter,
  type VillagePatrolPersonSortKey,
  type VillagePatrolPersonSortSpec,
  type VillagePatrolRow,
  type VillagePatrolTeam,
} from './villagePatrolData'
import { exportVillagePatrolExcel, parseVillagePatrolExcel, downloadVillagePatrolImportTemplate } from './villagePatrolExcel'
import { VillagePatrolSuggestInput } from './VillagePatrolSuggestInput'

type Props = {
  onClose: () => void
}

type FormState = {
  eup: string
  village: string
  team: VillagePatrolTeam
  name: string
  affiliation: string
  phone: string
  note: string
}

const EMPTY_FORM: FormState = {
  eup: '',
  village: '',
  team: 'A조',
  name: '',
  affiliation: '이장',
  phone: '',
  note: '',
}

/** 박스 없이 밑줄만 — 보기 글자와 자리 맞춤 */
const inputClass =
  'box-border w-full min-w-0 appearance-none border-0 border-b border-border bg-transparent px-0 py-0.5 text-xs leading-5 text-muted-foreground outline-none ring-0 placeholder:text-muted-foreground/50 focus:border-primary focus:text-foreground'
const cellClass = 'px-2 py-1.5 align-middle'
const viewTextClass = 'block truncate text-xs leading-5 text-slate-800'
const theadThClass =
  'whitespace-nowrap border-b border-slate-200 px-1.5 py-1.5 text-left font-semibold text-slate-700'
const sortHeadButtonClass = (active: boolean, align: 'left' | 'center' = 'left') =>
  cn(
    'inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50',
    align === 'left' ? 'justify-start' : 'justify-center',
    active ? 'text-primary' : 'text-slate-700'
  )
const filterSelectClass =
  'rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground'
const chipClass =
  'inline-flex max-w-full truncate rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-tight text-muted-foreground'

const ASSIGNMENT_SORT_COLUMNS: { key: VillagePatrolAssignmentSortKey; label: string }[] = [
  { key: 'eup', label: '읍면' },
  { key: 'village', label: '마을' },
  { key: 'team', label: '조' },
  { key: 'name', label: '성명' },
  { key: 'affiliation', label: '소속' },
  { key: 'phone', label: '연락처' },
  { key: 'note', label: '비고' },
]

const PERSON_SORT_COLUMNS: { key: VillagePatrolPersonSortKey; label: string }[] = [
  { key: 'name', label: '성명' },
  { key: 'affiliation', label: '소속' },
  { key: 'phone', label: '연락처' },
  { key: 'placements', label: '편성' },
  { key: 'note', label: '비고' },
]

function rowToForm(row: VillagePatrolRow): FormState {
  return {
    eup: row.eup,
    village: row.village,
    team: row.team,
    name: row.name,
    affiliation: row.affiliation,
    phone: normalizePhone(row.phone),
    note: row.note ?? '',
  }
}

function formsEqual(a: FormState, b: FormState) {
  return (
    a.eup === b.eup &&
    a.village === b.village &&
    a.team === b.team &&
    a.name === b.name &&
    a.affiliation === b.affiliation &&
    a.phone === b.phone &&
    a.note === b.note
  )
}

export function VillagePatrolListPanel({ onClose }: Props) {
  const allRows = useSyncExternalStore(subscribeVillagePatrol, getVillagePatrolRows, getVillagePatrolRows)
  const [keyword, setKeyword] = useState('')
  const [eup, setEup] = useState('')
  const [village, setVillage] = useState('')
  const [team, setTeam] = useState('')
  const [affiliation, setAffiliation] = useState('')
  const [uniqueOnly, setUniqueOnly] = useState(false)
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)

  /** 상단 «수정» — 진입 시 모든 행 입력 가능 (Tab 이동) */
  const [editMode, setEditMode] = useState(false)
  /** 상단 «삭제» — 행 휴지통으로 삭제 예정, 저장 시 반영 */
  const [deleteMode, setDeleteMode] = useState(false)
  /** 수정 초안 (저장 전) */
  const [drafts, setDrafts] = useState<Record<string, FormState>>({})
  const [personDrafts, setPersonDrafts] = useState<Record<string, FormState>>({})
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, true>>({})
  const [pendingDeletePersonKeys, setPendingDeletePersonKeys] = useState<Record<string, true>>({})
  /** 추가 모드 — 버튼 누를 때마다 행 증가 */
  const [createRows, setCreateRows] = useState<{ key: string; form: FormState }[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<string | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [assignmentSorts, setAssignmentSorts] = useState<VillagePatrolAssignmentSortSpec[]>([])
  const [personSorts, setPersonSorts] = useState<VillagePatrolPersonSortSpec[]>([])
  const pendingImportModeRef = useRef<'append' | 'drop'>('append')
  const fileRef = useRef<HTMLInputElement>(null)
  const draftsRef = useRef(drafts)
  const personDraftsRef = useRef(personDrafts)
  const createRowsRef = useRef(createRows)
  const pendingDeleteIdsRef = useRef(pendingDeleteIds)
  const pendingDeletePersonKeysRef = useRef(pendingDeletePersonKeys)
  draftsRef.current = drafts
  personDraftsRef.current = personDrafts
  createRowsRef.current = createRows
  pendingDeleteIdsRef.current = pendingDeleteIds
  pendingDeletePersonKeysRef.current = pendingDeletePersonKeys

  useEffect(() => {
    if (!importInfo) return
    const t = window.setTimeout(() => setImportInfo(null), 10_000)
    return () => window.clearTimeout(t)
  }, [importInfo])

  const hasCreateRows = createRows.length > 0
  const pendingDeleteCount =
    Object.keys(pendingDeleteIds).length + Object.keys(pendingDeletePersonKeys).length
  const sessionOpen = editMode || hasCreateRows || deleteMode

  const filter: VillagePatrolFilter = useMemo(
    () => ({ keyword, eup, village, team, affiliation, uniqueOnly, duplicatesOnly }),
    [keyword, eup, village, team, affiliation, uniqueOnly, duplicatesOnly]
  )
  const filteredBase = useMemo(() => filterVillagePatrolRows(allRows, filter), [allRows, filter])
  const showPersonTable = !hasCreateRows && (uniqueOnly || duplicatesOnly)
  const displayRows = useMemo(
    () =>
      sortVillagePatrolAssignmentRows(
        filteredBase,
        sessionOpen || showPersonTable ? [] : assignmentSorts
      ),
    [filteredBase, sessionOpen, showPersonTable, assignmentSorts]
  )
  const uniqueRows = useMemo(() => {
    if (duplicatesOnly) {
      const keysInView = new Set(filteredBase.map((r) => personKey(r.name, r.phone)))
      return toUniqueRows(allRows).filter((u) => keysInView.has(u.key) && u.sourceIds.length >= 2)
    }
    return toUniqueRows(filteredBase)
  }, [allRows, filteredBase, duplicatesOnly])
  const displayUniqueRows = useMemo(
    () => sortVillagePatrolPersonRows(uniqueRows, sessionOpen ? [] : personSorts),
    [uniqueRows, sessionOpen, personSorts]
  )
  /** 편성 행 수(건) — 검색·필터 반영 */
  const assignmentCount = filteredBase.length + createRows.length
  /** 인원 수(명) — 검색·필터 반영, 연락처 기준 고유 */
  const personCount = useMemo(() => toUniqueRows(filteredBase).length, [filteredBase])
  const displayCount = showPersonTable ? displayUniqueRows.length : assignmentCount
  const listSummary = showPersonTable
    ? duplicatesOnly
      ? `중복 확인 · 인원 ${displayUniqueRows.length.toLocaleString()}명`
      : `중복 제거 · 인원 ${displayUniqueRows.length.toLocaleString()}명`
    : `편성 ${assignmentCount.toLocaleString()}건 · 인원 ${personCount.toLocaleString()}명`
  const eups = useMemo(() => listEups(allRows), [allRows])
  const villages = useMemo(() => listVillages(allRows, eup), [allRows, eup])
  const affiliations = useMemo(() => listAffiliations(allRows), [allRows])
  /** 수정·추가·삭제 모드 중에는 병합 해제 */
  const mergePlaceCols = !editMode && !hasCreateRows && !deleteMode
  const placeSpans = useMemo(
    () => (mergePlaceCols ? villagePatrolGroupSpans(displayRows) : null),
    [mergePlaceCols, displayRows]
  )

  const toggleAssignmentSort = (key: VillagePatrolAssignmentSortKey) => {
    const initial = initialVillagePatrolAssignmentSortDir(key)
    setAssignmentSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: initial }]
      const cur = prev[idx]
      if (cur.dir === initial) {
        const next = [...prev]
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  const togglePersonSort = (key: VillagePatrolPersonSortKey) => {
    const initial = initialVillagePatrolPersonSortDir(key)
    setPersonSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: initial }]
      const cur = prev[idx]
      if (cur.dir === initial) {
        const next = [...prev]
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  useEffect(() => {
    if (eup && !eups.includes(eup)) {
      setEup('')
      setVillage('')
    }
  }, [eup, eups])
  useEffect(() => {
    if (village && !villages.includes(village)) setVillage('')
  }, [village, villages])
  useEffect(() => {
    if (affiliation && !affiliations.includes(affiliation)) setAffiliation('')
  }, [affiliation, affiliations])

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    void loadVillagePatrolRows()
      .catch((e) => {
        if (!cancelled) {
          clearVillagePatrolRows()
          setImportError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
      clearVillagePatrolRows()
    }
  }, [])

  const resetSession = () => {
    setEditMode(false)
    setDeleteMode(false)
    setDrafts({})
    setPersonDrafts({})
    setPendingDeleteIds({})
    setPendingDeletePersonKeys({})
    setCreateRows([])
    createRowsRef.current = []
    draftsRef.current = {}
    personDraftsRef.current = {}
    pendingDeleteIdsRef.current = {}
    pendingDeletePersonKeysRef.current = {}
  }

  const emptyCreateForm = (): FormState => ({
    ...EMPTY_FORM,
    eup: eup || eups[0] || '',
    village: village || '',
  })

  const personBaseline = (key: string): FormState | null => {
    const src =
      allRows.find((r) => personKey(r.name, r.phone) === key) ??
      filteredBase.find((r) => personKey(r.name, r.phone) === key)
    if (!src) return null
    const fromUnique = uniqueRows.find((u) => u.key === key)
    return {
      eup: src.eup,
      village: src.village,
      team: src.team,
      name: src.name,
      affiliation: src.affiliation,
      phone: normalizePhone(src.phone),
      note: fromUnique?.note || src.note || '',
    }
  }

  const clearEditState = () => {
    setEditMode(false)
    setDrafts({})
    setPersonDrafts({})
    draftsRef.current = {}
    personDraftsRef.current = {}
  }

  const clearDeleteState = () => {
    setDeleteMode(false)
    setPendingDeleteIds({})
    setPendingDeletePersonKeys({})
    pendingDeleteIdsRef.current = {}
    pendingDeletePersonKeysRef.current = {}
  }

  const hasEditUnsaved = (): boolean => {
    for (const [id, f] of Object.entries(draftsRef.current)) {
      const orig = allRows.find((r) => r.id === id)
      if (!orig || !formsEqual(f, rowToForm(orig))) return true
    }
    for (const [key, f] of Object.entries(personDraftsRef.current)) {
      const baseline = personBaseline(key)
      if (!baseline || !formsEqual(f, baseline)) return true
    }
    return false
  }

  const hasCreateUnsaved = (): boolean => {
    const blank = emptyCreateForm()
    return createRowsRef.current.some((r) => !formsEqual(r.form, blank))
  }

  const hasDeleteUnsaved = (): boolean =>
    Object.keys(pendingDeleteIdsRef.current).length > 0 ||
    Object.keys(pendingDeletePersonKeysRef.current).length > 0

  const hasUnsavedChanges = (): boolean =>
    hasEditUnsaved() || hasCreateUnsaved() || hasDeleteUnsaved()

  /** 저장 안 하고 다른 행위 시 경고 */
  const confirmLeaveEdit = (): boolean => {
    if (!sessionOpen && !hasUnsavedChanges()) return true
    if (!hasUnsavedChanges() && !editMode && !hasCreateRows && !deleteMode) {
      resetSession()
      return true
    }
    if (hasUnsavedChanges() || editMode || hasCreateRows || deleteMode) {
      if (hasUnsavedChanges()) {
        if (!window.confirm('저장하지 않은 내용이 있습니다. 계속하면 사라집니다. 계속할까요?')) {
          return false
        }
      }
      resetSession()
    }
    return true
  }

  const enterEditMode = () => {
    if (editMode) return
    if (deleteMode) {
      if (hasDeleteUnsaved()) {
        if (!window.confirm('삭제 예정이 있습니다. 수정 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      clearDeleteState()
    }
    if (hasCreateRows) {
      if (hasCreateUnsaved()) {
        if (!window.confirm('작성 중인 추가 행이 있습니다. 수정 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      setCreateRows([])
      createRowsRef.current = []
    }
    if (!(uniqueOnly || duplicatesOnly)) {
      setUniqueOnly(false)
      setDuplicatesOnly(false)
    }
    if (uniqueOnly || duplicatesOnly) {
      const next: Record<string, FormState> = {}
      for (const u of uniqueRows) {
        const base = personBaseline(u.key)
        if (base) next[u.key] = base
      }
      setPersonDrafts(next)
      personDraftsRef.current = next
      setDrafts({})
      draftsRef.current = {}
    } else {
      const next: Record<string, FormState> = {}
      for (const r of filteredBase) next[r.id] = rowToForm(r)
      setDrafts(next)
      draftsRef.current = next
      setPersonDrafts({})
      personDraftsRef.current = {}
    }
    setEditMode(true)
  }

  const enterDeleteMode = () => {
    if (deleteMode) return
    if (editMode || Object.keys(drafts).length > 0 || Object.keys(personDrafts).length > 0) {
      if (hasEditUnsaved()) {
        if (!window.confirm('저장하지 않은 수정 내용이 있습니다. 삭제 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      clearEditState()
    }
    if (hasCreateRows) {
      if (hasCreateUnsaved()) {
        if (!window.confirm('작성 중인 추가 행이 있습니다. 삭제 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      setCreateRows([])
      createRowsRef.current = []
    }
    setDeleteMode(true)
  }

  /** 추가 — 수정·삭제 모드 해제 후 빈 행을 하나 더 붙임 */
  const startCreate = () => {
    setUniqueOnly(false)
    setDuplicatesOnly(false)
    if (deleteMode) {
      if (hasDeleteUnsaved()) {
        if (!window.confirm('삭제 예정이 있습니다. 추가 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      clearDeleteState()
    }
    if (editMode || Object.keys(drafts).length > 0 || Object.keys(personDrafts).length > 0) {
      if (hasEditUnsaved()) {
        if (!window.confirm('저장하지 않은 수정 내용이 있습니다. 추가 모드로 바꾸면 사라집니다. 계속할까요?')) {
          return
        }
      }
      clearEditState()
    }
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setCreateRows((rows) => {
      const next = [...rows, { key, form: emptyCreateForm() }]
      createRowsRef.current = next
      return next
    })
  }

  const togglePendingDeleteId = (id: string) => {
    setPendingDeleteIds((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      pendingDeleteIdsRef.current = next
      return next
    })
  }

  const togglePendingDeletePersonKey = (key: string) => {
    setPendingDeletePersonKeys((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      pendingDeletePersonKeysRef.current = next
      return next
    })
  }

  /** 필터·목록에 나온 행 전체(스크롤 아래 포함) 삭제 예정 토글 */
  const allListedMarkedForDelete = useMemo(() => {
    if (showPersonTable) {
      if (uniqueRows.length === 0) return false
      return uniqueRows.every((u) => pendingDeletePersonKeys[u.key])
    }
    if (filteredBase.length === 0) return false
    return filteredBase.every((r) => pendingDeleteIds[r.id])
  }, [showPersonTable, uniqueRows, filteredBase, pendingDeletePersonKeys, pendingDeleteIds])

  const toggleAllPendingDeletes = () => {
    if (showPersonTable) {
      const keys = uniqueRows.map((u) => u.key)
      if (keys.length === 0) return
      const clear = keys.every((k) => pendingDeletePersonKeysRef.current[k])
      setPendingDeletePersonKeys((prev) => {
        const next = { ...prev }
        if (clear) {
          for (const k of keys) delete next[k]
        } else {
          for (const k of keys) next[k] = true
        }
        pendingDeletePersonKeysRef.current = next
        return next
      })
      return
    }
    const ids = filteredBase.map((r) => r.id)
    if (ids.length === 0) return
    const clear = ids.every((id) => pendingDeleteIdsRef.current[id])
    setPendingDeleteIds((prev) => {
      const next = { ...prev }
      if (clear) {
        for (const id of ids) delete next[id]
      } else {
        for (const id of ids) next[id] = true
      }
      pendingDeleteIdsRef.current = next
      return next
    })
  }

  const updateCreateRow = (key: string, patch: Partial<FormState> | ((prev: FormState) => FormState)) => {
    setCreateRows((rows) => {
      const next = rows.map((r) => {
        if (r.key !== key) return r
        const form = typeof patch === 'function' ? patch(r.form) : { ...r.form, ...patch }
        return { ...r, form }
      })
      createRowsRef.current = next
      return next
    })
  }

  const updateAssignmentDraft = (id: string, patch: Partial<FormState> | ((prev: FormState) => FormState)) => {
    setDrafts((prev) => {
      const orig = allRows.find((r) => r.id === id)
      const base = prev[id] ?? (orig ? rowToForm(orig) : EMPTY_FORM)
      const form = typeof patch === 'function' ? patch(base) : { ...base, ...patch }
      const next = { ...prev, [id]: form }
      draftsRef.current = next
      return next
    })
  }

  const updatePersonDraft = (key: string, patch: Partial<FormState> | ((prev: FormState) => FormState)) => {
    setPersonDrafts((prev) => {
      const base = prev[key] ?? personBaseline(key) ?? EMPTY_FORM
      const form = typeof patch === 'function' ? patch(base) : { ...base, ...patch }
      const next = { ...prev, [key]: form }
      personDraftsRef.current = next
      return next
    })
  }

  /** 성명·연락처(10~11자리) 없으면 저장 대상 아님 — 경고 없이 스킵 */
  const toSavablePayload = (
    f: FormState,
    personOnly: boolean
  ): Omit<VillagePatrolRow, 'id'> | null => {
    if (!f.name.trim()) return null
    const phone = normalizePhone(f.phone)
    if (phone.length < 10 || phone.length > 11) return null
    if (!personOnly) {
      if (!f.eup.trim() || !f.village.trim() || !f.team.trim()) return null
    }
    return {
      eup: f.eup.trim(),
      village: f.village.trim(),
      team: f.team,
      name: f.name.trim(),
      affiliation: f.affiliation.trim() || '이장',
      phone,
      note: f.note.trim(),
    }
  }

  const saveAll = async () => {
    if (isSaving) return
    const d = draftsRef.current
    const pd = personDraftsRef.current
    const creates = createRowsRef.current
    const delIds = pendingDeleteIdsRef.current
    const delKeys = pendingDeletePersonKeysRef.current

    const adds: Omit<VillagePatrolRow, 'id'>[] = []
    for (const row of creates) {
      const payload = toSavablePayload(row.form, false)
      if (payload) adds.push(payload)
    }

    const updates: { id: string; patch: Omit<VillagePatrolRow, 'id'> }[] = []
    for (const [id, f] of Object.entries(d)) {
      if (delIds[id]) continue
      const orig = allRows.find((r) => r.id === id)
      if (orig && formsEqual(f, rowToForm(orig))) continue
      const payload = toSavablePayload(f, false)
      if (payload) updates.push({ id, patch: payload })
    }

    const personUpdates: {
      key: string
      patch: Pick<VillagePatrolRow, 'name' | 'affiliation' | 'phone' | 'note'>
    }[] = []
    for (const [key, f] of Object.entries(pd)) {
      if (delKeys[key]) continue
      const baseline = personBaseline(key)
      if (baseline && formsEqual(f, baseline)) continue
      const payload = toSavablePayload(f, true)
      if (payload) {
        personUpdates.push({
          key,
          patch: {
            name: payload.name,
            affiliation: payload.affiliation,
            phone: payload.phone,
            note: payload.note,
          },
        })
      }
    }

    setIsSaving(true)
    setImportError(null)
    try {
      await saveVillagePatrolBatch({
        adds,
        updates,
        personUpdates,
        removeIds: Object.keys(delIds),
        removePersonKeys: Object.keys(delKeys),
      })
      resetSession()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSaving(false)
    }
  }

  const exportExcel = async () => {
    if (!confirmLeaveEdit()) return
    try {
      const res = await call('', 'POST', {
        service: 'configService',
        action: 'getParcelAnalysisRegionFromFooter',
        params: {},
      })
      const data = (res as { data?: { sigungu?: string } })?.data ?? res
      const sigun = String((data as { sigungu?: string })?.sigungu ?? '').trim()
      exportVillagePatrolExcel(allRows, { sigun })
    } catch {
      exportVillagePatrolExcel(allRows)
    }
  }

  const openImportModal = () => {
    if (!confirmLeaveEdit()) return
    setImportModalOpen(true)
  }

  const chooseImportMode = (mode: 'append' | 'drop') => {
    pendingImportModeRef.current = mode
    setImportModalOpen(false)
    window.setTimeout(() => fileRef.current?.click(), 0)
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    const importMode = pendingImportModeRef.current
    setImportError(null)
    setImportInfo(null)
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseVillagePatrolExcel(buf)
      if (!parsed.length) {
        setImportError(
          '명단을 읽지 못했습니다. 편성표(성명·연락처 또는 성명·소속·연락처) 또는 읍면·마을·조·성명 열이 있는 엑셀인지 확인해 주세요.'
        )
        return
      }
      if (importMode === 'drop') {
        await replaceVillagePatrolRows(parsed)
        setImportInfo(`전체 교체했습니다. ${parsed.length.toLocaleString()}건으로 반영했습니다.`)
      } else {
        const { added, updated } = await appendVillagePatrolRows(parsed)
        const parts: string[] = []
        if (added > 0) parts.push(`${added.toLocaleString()}건 추가`)
        if (updated > 0) parts.push(`동일 편성 ${updated.toLocaleString()}건 소속·비고 반영`)
        setImportInfo(
          parts.length > 0
            ? `${parts.join(', ')}했습니다.`
            : '반영할 변경이 없습니다.'
        )
      }
      resetSession()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const resetFilters = () => {
    if (!confirmLeaveEdit()) return
    setKeyword('')
    setEup('')
    setVillage('')
    setTeam('')
    setAffiliation('')
    setUniqueOnly(false)
    setDuplicatesOnly(false)
    setAssignmentSorts([])
    setPersonSorts([])
    setImportError(null)
    setImportInfo(null)
  }

  const viewAssignment = (row: VillagePatrolRow): FormState => drafts[row.id] ?? rowToForm(row)
  const viewPerson = (key: string, fallback: FormState): FormState => personDrafts[key] ?? fallback

  const renderCreateRow = (item: { key: string; form: FormState }, index: number) => {
    const f = item.form
    const rowVillages = listVillages(allRows, f.eup)
    return (
      <tr key={item.key} className="border-b border-border bg-sky-500/10 dark:bg-sky-500/15">
        <td className={cn(cellClass, 'text-left text-muted-foreground')}>+</td>
        <td className={cellClass}>
          <VillagePatrolSuggestInput
            value={f.eup}
            onChange={(v) => {
              updateCreateRow(item.key, (prev) => ({
                ...prev,
                eup: v,
                village: v === prev.eup ? prev.village : '',
              }))
            }}
            options={eups}
            className={inputClass}
            placeholder="읍면"
            aria-label="읍면"
            dataField="eup"
            autoFocus={index === createRows.length - 1}
          />
        </td>
        <td className={cellClass}>
          <VillagePatrolSuggestInput
            value={f.village}
            onChange={(v) => updateCreateRow(item.key, { village: v })}
            options={rowVillages}
            className={inputClass}
            placeholder="마을"
            aria-label="마을"
            dataField="village"
          />
        </td>
        <td className={cellClass}>
          <select
            value={f.team}
            onChange={(e) => updateCreateRow(item.key, { team: e.target.value as VillagePatrolTeam })}
            className={inputClass}
            aria-label="조"
            data-vp-field="team"
          >
            {TEAMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </td>
        <td className={cellClass}>
          <input
            value={f.name}
            onChange={(e) => updateCreateRow(item.key, { name: e.target.value })}
            className={inputClass}
            placeholder="성명"
            aria-label="성명"
            data-vp-field="name"
          />
        </td>
        <td className={cellClass}>
          <VillagePatrolSuggestInput
            value={f.affiliation}
            onChange={(v) => updateCreateRow(item.key, { affiliation: v })}
            options={affiliations}
            className={inputClass}
            placeholder="소속"
            aria-label="소속"
            dataField="affiliation"
          />
        </td>
        <td className={cellClass}>
          <input
            value={formatPhone(f.phone)}
            onChange={(e) =>
              updateCreateRow(item.key, { phone: normalizePhone(e.target.value).slice(0, 11) })
            }
            inputMode="tel"
            className={inputClass}
            placeholder="연락처"
            aria-label="연락처"
            data-vp-field="phone"
          />
        </td>
        <td className={cellClass}>
          <input
            value={f.note}
            onChange={(e) => updateCreateRow(item.key, { note: e.target.value })}
            className={inputClass}
            placeholder="비고"
            aria-label="비고"
          />
        </td>
        <td className={cellClass} />
      </tr>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white pr-2.5">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">마을순찰대</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            onClick={openImportModal}
            title="엑셀 가져오기"
            disabled={sessionOpen}
          >
            <Upload className="h-3 w-3 shrink-0" aria-hidden />
            가져오기
          </LayerRowPanelButton>
          <LayerRowPanelButton
            type="button"
            onClick={() => void exportExcel()}
            title="엑셀 내보내기 (전체 편성)"
            disabled={sessionOpen}
          >
            <Download className="h-3 w-3 shrink-0" aria-hidden />
            엑셀
          </LayerRowPanelButton>
          <LayerRowAddButton
            onClick={startCreate}
            disabled={editMode || deleteMode}
          />
          <LayerRowPanelButton
            type="button"
            onClick={enterEditMode}
            title="수정 모드"
            disabled={hasCreateRows || deleteMode}
            className={
              editMode
                ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200'
                : undefined
            }
          >
            <Pencil className="h-3 w-3 shrink-0" aria-hidden />
            수정
          </LayerRowPanelButton>
          <LayerRowPanelButton
            type="button"
            onClick={enterDeleteMode}
            title="삭제 모드"
            disabled={hasCreateRows || editMode}
            className={
              deleteMode
                ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                : undefined
            }
          >
            <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
            삭제
          </LayerRowPanelButton>
          {sessionOpen ? (
            <>
              <LayerRowPanelButton
                type="button"
                onClick={() => void saveAll()}
                title="저장"
                disabled={isSaving}
                className="border-primary bg-primary text-white hover:border-primary hover:bg-primary/90 hover:text-white"
              >
                <Check className="h-3 w-3 shrink-0" aria-hidden />
                {isSaving ? '저장 중…' : '저장'}
              </LayerRowPanelButton>
              <LayerRowPanelButton
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges()) {
                    if (!window.confirm('저장하지 않은 내용이 있습니다. 취소할까요?')) return
                  }
                  resetSession()
                }}
                title="편집 취소"
              >
                취소
              </LayerRowPanelButton>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (!confirmLeaveEdit()) return
              onClose()
            }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => void onImportFile(e.target.files?.[0])}
      />

      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogTitle>엑셀 가져오기</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            가져오기 방식을 선택한 뒤 엑셀 파일을 고릅니다. 양식이 없으면 아래 버튼을 이용하세요.
          </DialogDescription>
          <button
            type="button"
            onClick={() => downloadVillagePatrolImportTemplate()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground transition-colors hover:border-border hover:bg-muted/80"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
            가져오기 양식 내려받기
          </button>
          <p className="-mt-3 pl-[5px] text-[11px] leading-relaxed text-muted-foreground">
            ※ 열: 읍면 · 마을 · 조(A조/B조/C조 또는 1·2·3일차) · 성명 · 소속 · 연락처 · 비고
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => chooseImportMode('append')}
              className="rounded-md border border-border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:border-border hover:bg-muted/50"
            >
              <div className="font-medium text-foreground">추가 (append)</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                기존 명단은 유지하고 신규만 추가합니다. 같은 편성(읍면·마을·조·성명·연락처)이면 소속·비고만 덮어씁니다.
              </p>
            </button>
            <button
              type="button"
              onClick={() => chooseImportMode('drop')}
              className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-left text-sm transition-colors hover:border-amber-300 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:border-amber-700 dark:hover:bg-amber-950/50"
            >
              <div className="font-medium text-amber-900 dark:text-amber-200">전체교체 (drop)</div>
              <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
                기존 명단을 모두 지우고 엑셀 내용으로 바꿉니다. 되돌릴 수 없습니다.
              </p>
            </button>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setImportModalOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50"
            >
              취소
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => {
                const next = e.target.value
                if (!confirmLeaveEdit()) return
                setKeyword(next)
              }}
              placeholder="검색 (이름, 마을, 연락처…)"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground outline-none ring-offset-2 focus:border-ring focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button
            type="button"
            title="필터 초기화"
            onClick={resetFilters}
            className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted/50"
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            초기화
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <select
            value={eup}
            onChange={(e) => {
              const next = e.target.value
              if (!confirmLeaveEdit()) return
              setEup(next)
              setVillage('')
            }}
            className={filterSelectClass}
            aria-label="읍면"
          >
            <option value="">읍면 전체</option>
            {eups.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={village}
            onChange={(e) => {
              const next = e.target.value
              if (!confirmLeaveEdit()) return
              setVillage(next)
            }}
            className={filterSelectClass}
            aria-label="마을"
          >
            <option value="">마을 전체</option>
            {villages.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={team}
            onChange={(e) => {
              const next = e.target.value
              if (!confirmLeaveEdit()) return
              setTeam(next)
            }}
            className={filterSelectClass}
            aria-label="조"
          >
            <option value="">조 전체</option>
            {TEAMS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={affiliation}
            onChange={(e) => {
              const next = e.target.value
              if (!confirmLeaveEdit()) return
              setAffiliation(next)
            }}
            className={filterSelectClass}
            aria-label="소속"
          >
            <option value="">소속 전체</option>
            {affiliations.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={uniqueOnly}
              onChange={(e) => {
                const on = e.target.checked
                if (!confirmLeaveEdit()) return
                setUniqueOnly(on)
                if (on) setDuplicatesOnly(false)
              }}
              className="h-3.5 w-3.5 rounded border-border"
            />
            중복 제거 (같은 연락처는 1명)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={duplicatesOnly}
              onChange={(e) => {
                const on = e.target.checked
                if (!confirmLeaveEdit()) return
                setDuplicatesOnly(on)
                if (on) setUniqueOnly(false)
              }}
              className="h-3.5 w-3.5 rounded border-border"
            />
            중복 확인 (2곳 이상 편성)
          </label>
        </div>
        {importError ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {importError}
          </div>
        ) : null}
        {importInfo ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {importInfo}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table
            className={cn(
              'w-full table-fixed border-collapse text-left text-xs',
            )}
          >
            {showPersonTable ? (
              <colgroup>
                <col className="w-12" />
                <col className="w-[5.5rem]" />
                <col className="w-[5.5rem]" />
                <col className="w-[8.5rem]" />
                <col style={{ minWidth: '8rem' }} />
                <col className="w-[5rem]" />
                <col className="w-12" />
              </colgroup>
            ) : (
              <colgroup>
                <col className="w-12" />
                <col className="w-[4rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[5.5rem]" />
                <col className="w-[8.5rem]" />
                <col className="w-[5rem]" />
                <col className="w-12" /> 
              </colgroup>
            )}
            <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className={theadThClass}>순번</th>
                {showPersonTable ? (
                  PERSON_SORT_COLUMNS.map((col) => {
                    const sortIdx = personSorts.findIndex((s) => s.key === col.key)
                    const active = sortIdx >= 0
                    const sortDir = active ? personSorts[sortIdx].dir : null
                    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
                    const initial = initialVillagePatrolPersonSortDir(col.key)
                    return (
                      <th key={col.key} className={theadThClass}>
                        <button
                          type="button"
                          onClick={() => togglePersonSort(col.key)}
                          disabled={sessionOpen}
                          className={sortHeadButtonClass(active)}
                          title={
                            sessionOpen
                              ? '편집 중에는 정렬할 수 없습니다'
                              : !active
                                ? `${col.label} 정렬 추가`
                                : sortDir === initial
                                  ? `${col.label} 방향 바꾸기`
                                  : `${col.label} 정렬 해제`
                          }
                        >
                          <span className="truncate">{col.label}</span>
                          <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                        </button>
                      </th>
                    )
                  })
                ) : (
                  ASSIGNMENT_SORT_COLUMNS.map((col) => {
                    const sortIdx = assignmentSorts.findIndex((s) => s.key === col.key)
                    const active = sortIdx >= 0
                    const sortDir = active ? assignmentSorts[sortIdx].dir : null
                    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
                    const initial = initialVillagePatrolAssignmentSortDir(col.key)
                    return (
                      <th key={col.key} className={theadThClass}>
                        <button
                          type="button"
                          onClick={() => toggleAssignmentSort(col.key)}
                          disabled={sessionOpen}
                          className={sortHeadButtonClass(active)}
                          title={
                            sessionOpen
                              ? '편집 중에는 정렬할 수 없습니다'
                              : !active
                                ? `${col.label} 정렬 추가`
                                : sortDir === initial
                                  ? `${col.label} 방향 바꾸기`
                                  : `${col.label} 정렬 해제`
                          }
                        >
                          <span className="truncate">{col.label}</span>
                          <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                        </button>
                      </th>
                    )
                  })
                )}
                <th className={cn(theadThClass, 'text-right')}>
                  {deleteMode ? (
                    <button
                      type="button"
                      onClick={toggleAllPendingDeletes}
                      className={cn(
                        'rounded px-1 py-0.5 text-[10px] font-semibold transition-colors',
                        allListedMarkedForDelete
                          ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900/60'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                      title={
                        allListedMarkedForDelete
                          ? '목록 전체 삭제 예정 해제'
                          : '목록 전체(스크롤 아래 포함) 삭제 예정'
                      }
                    >
                      전체
                    </button>
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {createRows.map((row, i) => renderCreateRow(row, i))}

              {displayCount === 0 && !hasCreateRows ? (
                <tr>
                  <td colSpan={showPersonTable ? 7 : 9} className="px-3 py-8 text-center text-slate-500">
                    조회된 항목이 없습니다.
                  </td>
                </tr>
              ) : showPersonTable ? (
                displayUniqueRows.map((r, index) => {
                  const placeList = r.placements
                    .split(' · ')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  const shown = viewPerson(r.key, {
                    eup: '',
                    village: '',
                    team: 'A조',
                    name: r.name,
                    affiliation: r.affiliation,
                    phone: normalizePhone(r.phone),
                    note: r.note || '',
                  })
                  const markedDelete = !!pendingDeletePersonKeys[r.key]
                  return (
                    <tr
                      key={r.key}
                      className={cn(
                        'border-b border-slate-100',
                        markedDelete
                          ? 'bg-red-50/60 opacity-70'
                          : editMode
                            ? 'bg-sky-500/10'
                            : deleteMode
                              ? 'hover:bg-red-50/40'
                              : 'transition-colors hover:bg-slate-50/80'
                      )}
                    >
                      <td className={cn(cellClass, 'text-left tabular-nums text-slate-500')}>{index + 1}</td>
                      {editMode ? (
                        <>
                          <td className={cellClass}>
                            <input
                              value={shown.name}
                              onChange={(e) => updatePersonDraft(r.key, { name: e.target.value })}
                              className={inputClass}
                              aria-label="성명"
                            />
                          </td>
                          <td className={cellClass}>
                            <VillagePatrolSuggestInput
                              value={shown.affiliation}
                              onChange={(v) => updatePersonDraft(r.key, { affiliation: v })}
                              options={affiliations}
                              className={inputClass}
                              aria-label="소속"
                              dataField="affiliation"
                            />
                          </td>
                          <td className={cellClass}>
                            <input
                              value={formatPhone(shown.phone)}
                              onChange={(e) =>
                                updatePersonDraft(r.key, {
                                  phone: normalizePhone(e.target.value).slice(0, 11),
                                })
                              }
                              inputMode="tel"
                              className={inputClass}
                              aria-label="연락처"
                            />
                          </td>
                          <td className={cellClass} title={r.placements}>
                            <div className="flex flex-wrap gap-1">
                              {placeList.map((p) => (
                                <span
                                  key={`${r.key}-${p}`}
                                  className={chipClass}
                                  title={p}
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className={cellClass}>
                            <input
                              value={shown.note}
                              onChange={(e) => updatePersonDraft(r.key, { note: e.target.value })}
                              className={inputClass}
                              aria-label="비고"
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={cellClass}>
                            <span
                              className={cn(
                                viewTextClass,
                                'font-medium text-foreground',
                                markedDelete && 'line-through'
                              )}
                            >
                              {shown.name}
                            </span>
                          </td>
                          <td className={cellClass} title={shown.affiliation}>
                            <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                              {shown.affiliation}
                            </span>
                          </td>
                          <td className={cellClass}>
                            <span
                              className={cn(
                                viewTextClass,
                                'tabular-nums',
                                markedDelete && 'line-through'
                              )}
                            >
                              {formatPhone(shown.phone)}
                            </span>
                          </td>
                          <td className={cellClass} title={r.placements}>
                            <div className="flex flex-wrap gap-1">
                              {placeList.map((p) => (
                                <span
                                  key={`${r.key}-${p}`}
                                  className={chipClass}
                                  title={p}
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className={cellClass} title={shown.note || undefined}>
                            <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                              {truncateNote(shown.note)}
                            </span>
                          </td>
                        </>
                      )}
                      <td className={cn(cellClass, 'text-right')}>
                        {deleteMode ? (
                          <DeleteButton
                            marked={markedDelete}
                            onDelete={() => togglePendingDeletePersonKey(r.key)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              ) : (
                displayRows.map((r, index) => {
                  const shown = viewAssignment(r)
                  const markedDelete = !!pendingDeleteIds[r.id]
                  const rowVillages = listVillages(allRows, shown.eup)
                  const eupSpan = placeSpans?.eup[index] ?? 1
                  const villageSpan = placeSpans?.village[index] ?? 1
                  const teamSpan = placeSpans?.team[index] ?? 1
                  const showEup = !placeSpans || eupSpan > 0
                  const showVillage = !placeSpans || villageSpan > 0
                  const showTeam = !placeSpans || teamSpan > 0
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        'border-b border-slate-100',
                        markedDelete
                          ? 'bg-red-50/60 opacity-70'
                          : editMode
                            ? 'bg-sky-500/10'
                            : deleteMode
                              ? 'hover:bg-red-50/40'
                              : 'transition-colors hover:bg-slate-50/80'
                      )}
                    >
                      <td className={cn(cellClass, 'text-left tabular-nums text-slate-500')}>
                        {hasCreateRows ? index + 1 + createRows.length : index + 1}
                      </td>
                      {editMode ? (
                        <>
                          <td className={cellClass}>
                            <VillagePatrolSuggestInput
                              value={shown.eup}
                              onChange={(v) => {
                                updateAssignmentDraft(r.id, (prev) => ({
                                  ...prev,
                                  eup: v,
                                  village: v === prev.eup ? prev.village : '',
                                }))
                              }}
                              options={eups}
                              className={inputClass}
                              aria-label="읍면"
                              dataField="eup"
                            />
                          </td>
                          <td className={cellClass}>
                            <VillagePatrolSuggestInput
                              value={shown.village}
                              onChange={(v) => updateAssignmentDraft(r.id, { village: v })}
                              options={rowVillages}
                              className={inputClass}
                              aria-label="마을"
                              dataField="village"
                            />
                          </td>
                          <td className={cellClass}>
                            <select
                              value={shown.team}
                              onChange={(e) =>
                                updateAssignmentDraft(r.id, { team: e.target.value as VillagePatrolTeam })
                              }
                              className={inputClass}
                              aria-label="조"
                            >
                              {TEAMS.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td className={cellClass}>
                            <input
                              value={shown.name}
                              onChange={(e) => updateAssignmentDraft(r.id, { name: e.target.value })}
                              className={inputClass}
                              aria-label="성명"
                            />
                          </td>
                          <td className={cellClass}>
                            <VillagePatrolSuggestInput
                              value={shown.affiliation}
                              onChange={(v) => updateAssignmentDraft(r.id, { affiliation: v })}
                              options={affiliations}
                              className={inputClass}
                              aria-label="소속"
                              dataField="affiliation"
                            />
                          </td>
                          <td className={cellClass}>
                            <input
                              value={formatPhone(shown.phone)}
                              onChange={(e) =>
                                updateAssignmentDraft(r.id, {
                                  phone: normalizePhone(e.target.value).slice(0, 11),
                                })
                              }
                              inputMode="tel"
                              className={inputClass}
                              aria-label="연락처"
                            />
                          </td>
                          <td className={cellClass}>
                            <input
                              value={shown.note}
                              onChange={(e) => updateAssignmentDraft(r.id, { note: e.target.value })}
                              className={inputClass}
                              aria-label="비고"
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          {showEup ? (
                            <td
                              rowSpan={placeSpans ? eupSpan : undefined}
                              className={cn(cellClass, 'align-middle')}
                            >
                              <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                                {shown.eup}
                              </span>
                            </td>
                          ) : null}
                          {showVillage ? (
                            <td
                              rowSpan={placeSpans ? villageSpan : undefined}
                              className={cn(cellClass, 'align-middle')}
                            >
                              <span
                                className={cn(
                                  viewTextClass,
                                  'font-medium text-foreground',
                                  markedDelete && 'line-through'
                                )}
                              >
                                {shown.village}
                              </span>
                            </td>
                          ) : null}
                          {showTeam ? (
                            <td
                              rowSpan={placeSpans ? teamSpan : undefined}
                              className={cn(cellClass, 'align-middle')}
                            >
                              <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                                {shown.team}
                              </span>
                            </td>
                          ) : null}
                          <td className={cellClass}>
                            <span
                              className={cn(
                                viewTextClass,
                                'font-medium text-foreground',
                                markedDelete && 'line-through'
                              )}
                            >
                              {shown.name}
                            </span>
                          </td>
                          <td className={cellClass}>
                            <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                              {shown.affiliation}
                            </span>
                          </td>
                          <td className={cellClass}>
                            <span
                              className={cn(
                                viewTextClass,
                                'tabular-nums',
                                markedDelete && 'line-through'
                              )}
                            >
                              {formatPhone(shown.phone)}
                            </span>
                          </td>
                          <td className={cellClass} title={shown.note || undefined}>
                            <span className={cn(viewTextClass, markedDelete && 'line-through')}>
                              {truncateNote(shown.note)}
                            </span>
                          </td>
                        </>
                      )}
                      <td className={cn(cellClass, 'text-right')}>
                        {deleteMode ? (
                          <DeleteButton
                            marked={markedDelete}
                            onDelete={() => togglePendingDeleteId(r.id)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {listLoading
            ? '불러오는 중…'
            : `${listSummary}${hasUnsavedChanges()
                ? ' · 미저장 변경 있음'
                : editMode
                  ? ' · 수정 중'
                  : deleteMode
                    ? pendingDeleteCount > 0
                      ? ` · 삭제 예정 ${pendingDeleteCount}건`
                      : ' · 삭제 모드'
                    : hasCreateRows
                      ? ` · 추가 ${createRows.length}행`
                      : ''}`}
        </div>
      </div>
    </div>
  )
}

function DeleteButton({ onDelete, marked }: { onDelete: () => void; marked?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
      className={cn(
        'rounded p-1',
        marked
          ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900/60'
          : 'text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300'
      )}
      title={marked ? '삭제 예정 해제' : '삭제 예정'}
      aria-label={marked ? '삭제 예정 해제' : '삭제 예정'}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
