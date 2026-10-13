"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import { Search } from "lucide-react"

type ComposeService = { ser_eng: string; ser_kor: string; ser_menu: string }
type ComposeSystem = {
  sys_key: string
  sys_kor: string
  sys_idx: number
  catalogLayerGroupList: string[]
  layerGroupList: string[]
  layerGroupOverridden: boolean
}

type ComposeData = {
  project: string
  runningProject: string
  projects: string[]
  path: string
  enabledSystems: string[]
  enabledSystemsUnset: boolean
  disabledServices: string[]
  systems: ComposeSystem[]
  services: ComposeService[]
  layerGroupOptions: string[]
}

function toggleInSet(prev: Set<string>, key: string, on: boolean): Set<string> {
  const next = new Set(prev)
  if (on) next.add(key)
  else next.delete(key)
  return next
}

export function ProjectComposeManager() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [meta, setMeta] = useState<{
    project: string
    path: string
    runningProject: string
    projects: string[]
  } | null>(null)
  const [selectedProject, setSelectedProject] = useState<string>("")
  const [systems, setSystems] = useState<ComposeSystem[]>([])
  const [services, setServices] = useState<ComposeService[]>([])
  const [layerGroupOptions, setLayerGroupOptions] = useState<string[]>([])
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set())
  const [disabledEngs, setDisabledEngs] = useState<Set<string>>(new Set())
  const [layerBySys, setLayerBySys] = useState<Record<string, string[]>>({})
  const [selectedSysKey, setSelectedSysKey] = useState<string>("")
  const [sysQuery, setSysQuery] = useState("")
  const [serQuery, setSerQuery] = useState("")
  const [grpQuery, setGrpQuery] = useState("")

  const load = useCallback(async (project?: string) => {
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const res = await call("", "POST", {
        service: "configService",
        action: "getProjectCompose",
        params: project ? { project } : {},
      })
      if (!res.success) throw new Error(res.error ?? "조회 실패")
      const data = res.data as ComposeData
      const projects = Array.isArray(data.projects) ? data.projects : []
      setMeta({
        project: data.project,
        path: data.path,
        runningProject: data.runningProject ?? "",
        projects,
      })
      setSelectedProject(data.project)
      const sysRows = Array.isArray(data.systems) ? data.systems : []
      setSystems(sysRows)
      setServices(Array.isArray(data.services) ? data.services : [])
      setLayerGroupOptions(Array.isArray(data.layerGroupOptions) ? data.layerGroupOptions : [])
      setEnabledKeys(new Set(data.enabledSystems ?? []))
      setDisabledEngs(new Set(data.disabledServices ?? []))
      const layerMap: Record<string, string[]> = {}
      for (const s of sysRows) {
        layerMap[s.sys_key] = [...(s.layerGroupList ?? [])]
      }
      setLayerBySys(layerMap)
      const firstEnabled =
        (data.enabledSystems ?? []).find((k) => sysRows.some((s) => s.sys_key === k)) ??
        sysRows[0]?.sys_key ??
        ""
      setSelectedSysKey(firstEnabled)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "조회 실패")
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredSystems = useMemo(() => {
    const q = sysQuery.trim().toLowerCase()
    const rows = [...systems].sort((a, b) => (a.sys_idx ?? 0) - (b.sys_idx ?? 0))
    if (!q) return rows
    return rows.filter(
      (s) =>
        s.sys_key.toLowerCase().includes(q) ||
        s.sys_kor.toLowerCase().includes(q)
    )
  }, [systems, sysQuery])

  const filteredServices = useMemo(() => {
    const q = serQuery.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (s) =>
        s.ser_eng.toLowerCase().includes(q) ||
        s.ser_kor.toLowerCase().includes(q) ||
        s.ser_menu.toLowerCase().includes(q)
    )
  }, [services, serQuery])

  const filteredGroups = useMemo(() => {
    const q = grpQuery.trim().toLowerCase()
    const opts = layerGroupOptions
    if (!q) return opts
    return opts.filter((g) => g.toLowerCase().includes(q))
  }, [layerGroupOptions, grpQuery])

  const selectedSys = systems.find((s) => s.sys_key === selectedSysKey) ?? null
  const selectedGroups = layerBySys[selectedSysKey] ?? []
  /** 체크 없음 = 공통 시스템 목록 사용 (저장·런타임과 동일) */
  const usingCatalogGroups = !!selectedSys && selectedGroups.length === 0
  const catalogHint =
    selectedSys && (selectedSys.catalogLayerGroupList?.length ?? 0) > 0
      ? selectedSys.catalogLayerGroupList.join(", ")
      : "없음"
  const isOtherProject =
    !!meta?.runningProject && !!selectedProject && meta.runningProject !== selectedProject

  const save = async () => {
    if (!selectedProject) {
      setError("프로젝트를 선택하세요.")
      return
    }
    if (enabledKeys.size === 0) {
      setError("시스템을 하나 이상 선택하세요.")
      return
    }
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const systemLayerGroups: Record<string, string[]> = {}
      for (const s of systems) {
        systemLayerGroups[s.sys_key] = layerBySys[s.sys_key] ?? []
      }
      const res = await call("", "POST", {
        service: "configService",
        action: "saveProjectCompose",
        params: {
          project: selectedProject,
          enabledSystems: [...enabledKeys],
          disabledServices: [...disabledEngs],
          systemLayerGroups,
        },
      })
      if (!res.success) throw new Error(res.error ?? "저장 실패")
      const note = isOtherProject
        ? ` (${selectedProject} runtime 저장 · 현재 서버는 ${meta?.runningProject})`
        : " (재시작 없이 적용)"
      setStatus(`프로젝트 runtime 설정에 반영되었습니다.${note}`)
      await load(selectedProject)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "저장 실패")
    } finally {
      setSaving(false)
    }
  }

  if (loading && !meta) {
    return <p className="text-sm text-muted-foreground p-2">불러오는 중…</p>
  }

  if (error && !meta) {
    return (
      <div className="space-y-2 p-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          다시 시도
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b pb-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-compose-select">
              프로젝트
            </label>
            <select
              id="project-compose-select"
              className="h-8 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
              value={selectedProject}
              disabled={loading || saving}
              onChange={(e) => {
                const next = e.target.value
                setSelectedProject(next)
                void load(next)
              }}
            >
              {(meta?.projects ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                  {p === meta?.runningProject ? " (현재 서버)" : ""}
                </option>
              ))}
            </select>
            {isOtherProject ? (
              <span className="text-xs text-amber-700">
                다른 프로젝트 편집 중 · 서버 기동: {meta?.runningProject}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground" title={meta?.path}>
            {meta?.path}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status ? <span className="text-xs text-emerald-700">{status}</span> : null}
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving || loading}
            onClick={() => void load(selectedProject || undefined)}
          >
            새로고침
          </Button>
          <Button type="button" size="sm" disabled={saving || loading} onClick={() => void save()}>
            {saving ? "저장 중…" : "저장"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        {/* 시스템 */}
        <section className="flex min-h-0 flex-col rounded-md border bg-background">
          <header className="shrink-0 border-b px-3 py-2">
            <p className="text-sm font-medium">시스템 노출</p>
            <p className="text-xs text-muted-foreground">체크한 시스템만 이 프로젝트에 표시</p>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="시스템 검색"
                value={sysQuery}
                onChange={(e) => setSysQuery(e.target.value)}
              />
            </div>
          </header>
          <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-0.5 overflow-auto p-2">
            {filteredSystems.map((s) => {
              const on = enabledKeys.has(s.sys_key)
              const selected = selectedSysKey === s.sys_key
              return (
                <li key={s.sys_key} className="min-w-0">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs",
                      selected ? "bg-primary/10" : "hover:bg-muted/60"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0"
                      checked={on}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setEnabledKeys((prev) => toggleInSet(prev, s.sys_key, checked))
                        if (checked) setSelectedSysKey(s.sys_key)
                      }}
                      aria-label={`${s.sys_kor} 노출`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedSysKey(s.sys_key)}
                    >
                      <span className="block truncate font-medium" title={s.sys_kor || s.sys_key}>
                        {s.sys_kor || s.sys_key}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground" title={s.sys_key}>
                        {s.sys_key}
                      </span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* 기능 숨김 */}
        <section className="flex min-h-0 flex-col rounded-md border bg-background">
          <header className="shrink-0 border-b px-3 py-2">
            <p className="text-sm font-medium">기능 숨김</p>
            <p className="text-xs text-muted-foreground">체크하면 이 프로젝트 메뉴에서 제외</p>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="기능 검색"
                value={serQuery}
                onChange={(e) => setSerQuery(e.target.value)}
              />
            </div>
          </header>
          <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-0.5 overflow-auto p-2">
            {filteredServices.map((s) => {
              const hidden = disabledEngs.has(s.ser_eng)
              return (
                <li key={s.ser_eng} className="min-w-0">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60",
                      hidden && "opacity-70"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0"
                      checked={hidden}
                      onChange={(e) =>
                        setDisabledEngs((prev) => toggleInSet(prev, s.ser_eng, e.target.checked))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={s.ser_kor || s.ser_eng}>
                        {s.ser_kor || s.ser_eng}
                      </span>
                      <span
                        className="block truncate text-[10px] text-muted-foreground"
                        title={`${s.ser_eng}${s.ser_menu ? ` · ${s.ser_menu}` : ""}`}
                      >
                        {s.ser_eng}
                        {s.ser_menu ? ` · ${s.ser_menu}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        {/* 레이어 그룹 */}
        <section className="flex min-h-0 flex-col rounded-md border bg-background">
          <header className="shrink-0 border-b px-3 py-2">
            <p className="text-sm font-medium">레이어 그룹</p>
            <p className="text-xs text-muted-foreground">
              {selectedSys
                ? `${selectedSys.sys_kor || selectedSys.sys_key} — 체크 없으면 공통 시스템 목록 기준`
                : "왼쪽에서 시스템을 선택하세요"}
            </p>
            {usingCatalogGroups ? (
              <p className="mt-1.5 rounded-md border border-amber-200/80 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                공통 시스템 목록 사용 중
                <span className="mt-0.5 block text-[11px] text-amber-800/90">
                  적용 그룹: {catalogHint}
                </span>
              </p>
            ) : null}
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                placeholder="그룹 검색"
                value={grpQuery}
                onChange={(e) => setGrpQuery(e.target.value)}
                disabled={!selectedSys}
              />
            </div>
            {selectedSys ? (
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setLayerBySys((prev) => ({
                      ...prev,
                      [selectedSys.sys_key]: [...(selectedSys.catalogLayerGroupList ?? [])],
                    }))
                  }
                >
                  공통 시스템 목록과 동일
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setLayerBySys((prev) => ({
                      ...prev,
                      [selectedSys.sys_key]: [],
                    }))
                  }
                >
                  모두 해제
                </Button>
              </div>
            ) : null}
          </header>
          <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-0.5 overflow-auto p-2">
            {!selectedSys ? (
              <li className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">
                시스템 선택 필요
              </li>
            ) : filteredGroups.length === 0 ? (
              <li className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">
                그룹 없음
              </li>
            ) : (
              filteredGroups.map((g) => {
                const on = selectedGroups.includes(g)
                return (
                  <li key={g} className="min-w-0">
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60">
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0"
                        checked={on}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setLayerBySys((prev) => {
                            const cur = new Set(prev[selectedSysKey] ?? [])
                            if (checked) cur.add(g)
                            else cur.delete(g)
                            return { ...prev, [selectedSysKey]: [...cur] }
                          })
                        }}
                      />
                      <span className="truncate" title={g}>
                        {g}
                      </span>
                    </label>
                  </li>
                )
              })
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
