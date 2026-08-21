"use client"

import { useState, useEffect, useMemo } from "react"
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
import { Trash2, Plus, Search } from "lucide-react"

export type ServiceItem = {
  ser_menu: string | null
  ser_cat: string | null
  ser_kor: string | null
  ser_eng: string | null
  ser_type: string | null
  ser_work_type: string | null
  ser_is_private: boolean | null
  ser_has_contents: boolean | null
  ser_has_file: boolean | null
  ser_data_table: string | null
  ser_data_query: string | null
  ser_idx: number | null
  ser_url: string | null
  ser_is_del: boolean | null
}

export type ServiceSource = "common" | "custom"

export type ServiceItemWithSource = ServiceItem & { source: ServiceSource }

function emptyService(): ServiceItem {
  return {
    ser_menu: null,
    ser_cat: null,
    ser_kor: null,
    ser_eng: null,
    ser_type: null,
    ser_work_type: null,
    ser_is_private: null,
    ser_has_contents: true,
    ser_has_file: true,
    ser_data_table: null,
    ser_data_query: null,
    ser_idx: null,
    ser_url: null,
    ser_is_del: null,
  }
}

function formatBoolFlag(v: boolean | null | undefined, whenTrue: string, whenFalse = "-"): string {
  if (v === true) return whenTrue
  if (v === false) return whenFalse
  return "-"
}

export function ServiceListManager() {
  const [items, setItems] = useState<ServiceItemWithSource[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingSerEng, setEditingSerEng] = useState<string | null>(null)
  const [addSource, setAddSource] = useState<ServiceSource | null>(null)
  const [form, setForm] = useState<ServiceItem>(emptyService())
  const [listSearch, setListSearch] = useState("")

  const filteredRows = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!q) return true
        const sourceLabel = item.source === "common" ? "공통" : "커스텀"
        const searchable = [
          sourceLabel,
          item.ser_eng,
          item.ser_kor,
          item.ser_type,
          item.ser_menu,
          item.ser_cat,
          item.ser_work_type,
          item.ser_data_table,
          item.ser_data_query,
          item.ser_idx != null ? String(item.ser_idx) : "",
          item.ser_is_private === true ? "비공개" : item.ser_is_private === false ? "공개" : "",
          item.ser_has_file === true ? "첨부 y" : item.ser_has_file === false ? "첨부 n" : "",
        ]
        return searchable.some((v) => (v ?? "").toLowerCase().includes(q))
      })
  }, [items, listSearch])

  const loadItems = async () => {
    setLoading(true)
    setError(null)
    try {
      const [configRes, customRes] = await Promise.all([
        call("", "POST", { service: "configService", action: "getServiceList", params: {} }),
        call("", "POST", { service: "serService", action: "getCustomSerList", params: {} }),
      ])
      const commonList = Array.isArray(configRes.data?.ser) ? configRes.data.ser : []
      const common: ServiceItemWithSource[] = commonList.map((s: ServiceItem) => ({
        ...s,
        source: "common" as const,
      }))
      const customRaw = customRes.data?.data ?? customRes.data
      const custom: ServiceItemWithSource[] = (Array.isArray(customRaw) ? customRaw : []).map((s: ServiceItem) => ({
        ...s,
        source: "custom" as const,
      }))
      setItems([...custom, ...common])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "목록 조회 실패")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  const openAddCommon = () => {
    setSuccessMsg(null)
    setEditingIndex(null)
    setAddSource("common")
    setForm(emptyService())
    setDialogOpen(true)
  }

  const deleteCommonAt = (index: number) => {
    setDialogOpen(false)
    const newList = items.filter((_, i) => i !== index)
    setItems(newList)
    ;(async () => {
      try {
        setSaving(true)
        const commonOnly = newList.filter((s) => s.source === "common").map(({ source: _, ...s }) => s)
        const res = await call("", "POST", {
          service: "configService",
          action: "saveServiceList",
          params: { ser: commonOnly },
        })
        if (!res.success) throw new Error(res.error)
        setSuccessMsg("공통 목록이 파일에 저장되었습니다.")
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "파일 저장 실패")
      } finally {
        setSaving(false)
      }
    })()
  }

  const openAddCustom = () => {
    setSuccessMsg(null)
    setEditingIndex(null)
    setAddSource("custom")
    setForm(emptyService())
    setDialogOpen(true)
  }

  const openEdit = (index: number) => {
    const row = items[index]
    setSuccessMsg(null)
    setEditingIndex(index)
    setEditingSerEng(row?.ser_eng ?? null)
    setAddSource(null)
    setForm({ ...items[index] })
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingIndex(null)
    setEditingSerEng(null)
    setAddSource(null)
  }

  const currentSource = (): ServiceSource => {
    if (addSource) return addSource
    if (editingIndex !== null && items[editingIndex]) return items[editingIndex].source
    return "common"
  }

  const saveForm = async () => {
    const source = currentSource()
    if (!form.ser_kor?.trim()) {
      setError("서비스 한글명은 필수입니다.")
      return
    }
    const next: ServiceItem = {
      ...form,
      ser_idx: form.ser_idx != null ? Number(form.ser_idx) : null,
    }

    if (source === "common") {
      setError(null)
      let nextList: ServiceItemWithSource[]
      if (editingIndex !== null) {
        nextList = [...items]
        nextList[editingIndex] = { ...next, source: "common" }
      } else {
        nextList = [...items, { ...next, source: "common" }]
      }
      setItems(nextList)
      closeDialog()
      try {
        setSaving(true)
        const commonOnly = nextList.filter((s) => s.source === "common").map(({ source: _, ...s }) => s)
        const res = await call("", "POST", {
          service: "configService",
          action: "saveServiceList",
          params: { ser: commonOnly },
        })
        if (!res.success) throw new Error(res.error)
        setSuccessMsg("공통 목록이 파일에 저장되었습니다.")
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "파일 저장 실패")
      } finally {
        setSaving(false)
      }
      return
    }

    if (source === "custom") {
      setError(null)
      try {
        if (editingIndex !== null) {
          const currentSerEng = editingSerEng ?? ""
          if (!currentSerEng.trim()) {
            setError("수정 대상을 식별할 수 없습니다.")
            return
          }
          const res = await call("", "POST", {
            service: "serService",
            action: "updateSer",
            params: {
              ser_eng: currentSerEng,
              ser_menu: next.ser_menu,
              ser_cat: next.ser_cat,
              ser_kor: next.ser_kor,
              ser_type: next.ser_type,
              ser_work_type: next.ser_work_type,
              ser_is_private: next.ser_is_private,
              ser_has_contents: next.ser_has_contents,
              ser_has_file: next.ser_has_file,
              ser_data_table: next.ser_data_table,
              ser_data_query: next.ser_data_query,
              ser_idx: next.ser_idx,
              ser_url: next.ser_url,
              ser_is_del: next.ser_is_del,
            },
          })
          const payload = res?.data ?? res
          if (res?.success === false) throw new Error(res?.error ?? "수정 실패")
          if (payload?.success === false) throw new Error(payload?.error ?? "수정 실패")
          setSuccessMsg("커스텀 기능이 수정되었습니다.")
        } else {
          const res = await call("", "POST", {
            service: "serService",
            action: "createSer",
            params: {
              ser_menu: next.ser_menu,
              ser_cat: next.ser_cat,
              ser_kor: next.ser_kor,
              ser_eng: next.ser_eng,
              ser_type: next.ser_type,
              ser_work_type: next.ser_work_type,
              ser_is_private: next.ser_is_private,
              ser_has_contents: next.ser_has_contents,
              ser_has_file: next.ser_has_file,
              ser_data_table: next.ser_data_table,
              ser_data_query: next.ser_data_query,
              ser_idx: next.ser_idx,
              ser_url: next.ser_url,
              ser_is_del: next.ser_is_del,
            },
          })
          const payload = res?.data ?? res
          if (res?.success === false) throw new Error(res?.error ?? "추가 실패")
          if (payload?.success === false) throw new Error(payload?.error ?? "추가 실패")
          setSuccessMsg("커스텀 기능이 추가되었습니다.")
        }
        await loadItems()
        closeDialog()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "저장 실패")
      }
    }
  }

  const removeAt = async (index: number) => {
    const row = items[index]
    if (!row) return
    if (!confirm("이 기능을 삭제할까요?")) return

    if (row.source === "common") {
      closeDialog()
      deleteCommonAt(index)
      return
    }

    const serEng = row.ser_eng ?? ""
    if (!serEng.trim()) {
      setError("서비스 영문명이 없습니다.")
      return
    }
    try {
      const res = await call("", "POST", {
        service: "serService",
        action: "deleteSer",
        params: { ser_eng: serEng },
      })
      const payload = res?.data ?? res
      if (res?.success === false) throw new Error(res?.error ?? "삭제 실패")
      if (payload?.success === false) throw new Error(payload?.error ?? "삭제 실패")
      setSuccessMsg("커스텀 기능이 삭제되었습니다.")
      await loadItems()
      closeDialog()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "삭제 실패")
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">로딩 중...</p>
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1 h-full overflow-hidden">
      {error && (
        <div className="shrink-0 text-sm text-red-600 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 rounded">{error}</div>
      )}
      {successMsg && (
        <div className="shrink-0 text-sm text-green-700 bg-green-50 dark:bg-green-950/50 px-3 py-1.5 rounded">
          {successMsg}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 flex-wrap">
        <Button size="sm" className="rounded-none gap-1" onClick={openAddCommon}>
          <Plus className="w-4 h-4" />
          공통 추가
        </Button>
        <Button size="sm" className="rounded-none gap-1" onClick={openAddCustom}>
          <Plus className="w-4 h-4" />
          커스텀 추가
        </Button>
        <div className="relative min-w-[200px] flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="기능 검색 (구분·영문명·한글명·유형·메뉴·카테고리)"
            className="h-8 pl-8 rounded-none text-xs"
          />
        </div>
        {saving && <span className="text-xs text-muted-foreground self-center">저장 중...</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border">
        <Table className="[&_th]:py-[4.5px] [&_td]:py-[4.5px] text-xs leading-tight">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-11 min-w-[2.75rem] max-w-[2.75rem] px-1 font-medium sticky top-0 z-10 bg-muted/95">
                구분
              </TableHead>
              <TableHead className="w-28 font-medium sticky top-0 z-10 bg-muted/95">서비스 영문명</TableHead>
              <TableHead className="w-28 font-medium sticky top-0 z-10 bg-muted/95">서비스 한글명</TableHead>
              <TableHead className="w-20 font-medium sticky top-0 z-10 bg-muted/95">서비스 유형</TableHead>
              <TableHead className="w-24 font-medium sticky top-0 z-10 bg-muted/95">메뉴</TableHead>
              <TableHead className="w-24 font-medium sticky top-0 z-10 bg-muted/95">카테고리</TableHead>
              <TableHead className="w-16 font-medium sticky top-0 z-10 bg-muted/95">순서</TableHead>
              <TableHead className="w-14 min-w-[3.25rem] px-1 text-center font-medium sticky top-0 z-10 bg-muted/95">
                비공개
              </TableHead>
              <TableHead className="w-14 min-w-[3.25rem] px-1 text-center font-medium sticky top-0 z-10 bg-muted/95">
                첨부
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-2">
                  등록된 기능이 없습니다. 공통 추가 또는 커스텀 추가로 등록하세요.
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-2">
                  검색 결과가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map(({ item: s, index: i }) => (
                <TableRow
                  key={s.source === "common" ? `common-${i}-${s.ser_eng ?? ""}` : `custom-${s.ser_eng ?? ""}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openEdit(i)}
                >
                  <TableCell className="text-xs px-1">
                    <span
                      className={
                        s.source === "common"
                          ? "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-tight bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                          : "inline-flex items-center rounded px-1 py-px text-[10px] font-medium leading-tight bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200"
                      }
                    >
                      {s.source === "common" ? "공통" : "커스텀"}
                    </span>
                  </TableCell>
                  <TableCell>{s.ser_eng ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.ser_kor ?? "-"}</TableCell>
                  <TableCell className="text-xs">{s.ser_type ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.ser_menu ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.ser_cat ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{s.ser_idx ?? "-"}</TableCell>
                  <TableCell className="text-center text-xs px-1">
                    {formatBoolFlag(s.ser_is_private, "Y", "N")}
                  </TableCell>
                  <TableCell className="text-center text-xs px-1">
                    {formatBoolFlag(s.ser_has_file, "Y", "N")}
                  </TableCell>
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
                ? "기능 상세정보"
                : addSource === "common"
                  ? "공통 기능 추가"
                  : "커스텀 기능 추가"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">서비스 영문명</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_eng ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_eng: e.target.value || null }))}
                placeholder="영문명"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">서비스 한글명</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_kor ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_kor: e.target.value || null }))}
                placeholder="한글명"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">서비스 유형</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_type ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_type: e.target.value || null }))}
                placeholder="service / layer"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">메뉴</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_menu ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_menu: e.target.value || null }))}
                placeholder="메뉴"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">카테고리</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_cat ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_cat: e.target.value || null }))}
                placeholder="카테고리"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">순서</label>
              <Input
                type="number"
                className="col-span-2 rounded-none"
                value={form.ser_idx ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ser_idx: e.target.value === "" ? null : Number(e.target.value) || null,
                  }))
                }
                placeholder="정렬 순서"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">동작방식</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_work_type ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_work_type: e.target.value || null }))}
                placeholder="동작방식"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">비공개여부</label>
              <div className="col-span-2 h-9 flex items-center gap-2 px-0 py-[10px] box-border">
                <input
                  type="checkbox"
                  id="form-ser_is_private"
                  checked={form.ser_is_private === true}
                  onChange={(e) => setForm((f) => ({ ...f, ser_is_private: e.target.checked }))}
                  className="h-4 w-4 rounded border border-input accent-primary shrink-0"
                />
                <label htmlFor="form-ser_is_private" className="text-sm text-muted-foreground cursor-pointer">비공개</label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">속성보기 여부</label>
              <div className="col-span-2 h-9 flex items-center gap-2 px-0 py-[10px] box-border">
                <input
                  type="checkbox"
                  id="form-ser_has_contents"
                  checked={form.ser_has_contents === true}
                  onChange={(e) => setForm((f) => ({ ...f, ser_has_contents: e.target.checked }))}
                  className="h-4 w-4 rounded border border-input accent-primary shrink-0"
                />
                <label htmlFor="form-ser_has_contents" className="text-sm text-muted-foreground cursor-pointer">속성보기</label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">첨부파일 여부</label>
              <div className="col-span-2 h-9 flex items-center gap-2 px-0 py-[10px] box-border">
                <input
                  type="checkbox"
                  id="form-ser_has_file"
                  checked={form.ser_has_file === true}
                  onChange={(e) => setForm((f) => ({ ...f, ser_has_file: e.target.checked }))}
                  className="h-4 w-4 rounded border border-input accent-primary shrink-0"
                />
                <label htmlFor="form-ser_has_file" className="text-sm text-muted-foreground cursor-pointer">첨부파일</label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">데이터 테이블</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_data_table ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_data_table: e.target.value || null }))}
                placeholder="데이터 테이블"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">데이터 쿼리</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_data_query ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_data_query: e.target.value || null }))}
                placeholder="데이터 쿼리"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-sm font-medium">URL</label>
              <Input
                className="col-span-2 rounded-none"
                value={form.ser_url ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ser_url: e.target.value || null }))}
                placeholder="URL"
              />
            </div>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <div>
              {editingIndex !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  onClick={() => removeAt(editingIndex)}
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
