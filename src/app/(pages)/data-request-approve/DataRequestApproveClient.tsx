'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Search, RotateCcw } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { call } from '@/lib/api'
import { withBasePathNav } from '@/lib/basePath'
import { isSuperUser } from '@/lib/auth/superUser'
import { cn } from '@/lib/utils'
import { Input } from '@/app/shadcnComponents/ui/input'
import { Button } from '@/app/shadcnComponents/ui/button'
import { VillagePatrolSuggestInput } from '@/app/(pages)/map/_mapContents/safty/villagePatrol/VillagePatrolSuggestInput'

type FileDetail = {
  drfKey: number
  fileLayer: string | null
  fileLayerKor: string | null
  fileLayerKey?: string | null
  fileSuccess: string | null
  fileAccept: string | null
  fileAcceptAuthor: string | null
  fileAcceptDate?: string | null
  acceptLabel: string
  authorLabel: string
  fileAcceptUser: string | null
}

type GroupRow = {
  fileGroupKey: number
  fileUserName: string | null
  fileUserId: string
  userIp: string | null
  fileDate: string
  fileLayer: string | null
  fileLayerKor: string
  fileLayerKey: string | null
  fileType: string
  fileAccept: string
  fileAcceptAuthor: string
  fileAcceptDate?: string | null
  acceptLabel: string
  authorLabel: string
  canAct?: boolean
  fileList: FileDetail[]
}

function safeFromPath(raw: string | null): string | null {
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const trimmed = decoded.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  if (trimmed.includes('://')) return null
  return trimmed
}

const fieldRowClass = 'flex items-center gap-1.5 text-[11px] text-muted-foreground'

function formatLayerDisplayName(
  kor: string | null | undefined,
  eng: string | null | undefined
): string {
  const k = String(kor ?? '').trim()
  const e = String(eng ?? '').trim()
  if (k && e && k !== e) return `${k}(${e})`
  return k || e || '-'
}

/** 승인일시 표시 — ISO면 읽기 쉽게, 없으면 - */
function formatAcceptDate(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) return '-'
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(s)
  if (m) return `${m[1]} ${m[2]}`
  return s
}

type ListMode = 'request' | 'approve'

type Props = {
  /** 콘솔 임베드 — 뒤로·페이지 제목 숨김 */
  embedded?: boolean
  /** request=데이터 요청, approve=데이터 승인(기본) */
  listMode?: ListMode
}

export function DataRequestApproveClient({
  embedded = false,
  listMode = 'approve',
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const isApproveMode = listMode === 'approve'
  const defaultFileAccept = isApproveMode ? 'P' : ''
  const pageTitle = isApproveMode ? '데이터 승인' : '데이터 요청'
  const fromPath = useMemo(
    () => (embedded ? null : safeFromPath(searchParams.get('from'))),
    [embedded, searchParams]
  )
  const includeSuperAdminName = isSuperUser(session?.user?.id)

  const [keyword, setKeyword] = useState('')
  const [fileType, setFileType] = useState('')
  const [userName, setUserName] = useState('')
  const [fileAccept, setFileAccept] = useState(defaultFileAccept)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<GroupRow[]>([])
  const [totalCnt, setTotalCnt] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [userNames, setUserNames] = useState<string[]>([])
  const [canApprove, setCanApprove] = useState(isApproveMode)
  const [canFilterByUser, setCanFilterByUser] = useState(isApproveMode)
  const [loading, setLoading] = useState(false)
  const [actingKey, setActingKey] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedGroupKey, setSelectedGroupKey] = useState<number | null>(null)
  const showUserFilter = isApproveMode || canFilterByUser

  const selected = useMemo(
    () => list.find((g) => g.fileGroupKey === selectedGroupKey) ?? null,
    [list, selectedGroupKey]
  )

  const load = useCallback(
    async (
      nextPage = 1,
      overrides?: {
        keyword?: string
        fileType?: string
        userName?: string
        fileAccept?: string
        startDate?: string
        endDate?: string
      }
    ) => {
      setLoading(true)
      setError(null)
      const kw = overrides?.keyword ?? keyword
      const ft = overrides?.fileType ?? fileType
      const un = overrides?.userName ?? userName
      const fa = overrides?.fileAccept ?? fileAccept
      const sd = overrides?.startDate ?? startDate
      const ed = overrides?.endDate ?? endDate
      try {
        const res = await call('', 'POST', {
          service: 'dataRequestService',
          action: 'listDataRequests',
          params: {
            listMode,
            keyword: kw,
            fileType: ft,
            fileUserName: un,
            fileAccept: fa,
            startDate: sd,
            endDate: ed,
            page: nextPage,
            pageSize: 20,
          },
        })
        const d = res?.data ?? res
        if (!d?.success) {
          setError(d?.error ?? '목록을 불러오지 못했습니다.')
          if (isApproveMode) setCanApprove(false)
          setList([])
          setSelectedGroupKey(null)
          return
        }
        const nextList: GroupRow[] = Array.isArray(d.data?.list) ? d.data.list : []
        setCanApprove(Boolean(d.data?.canApprove ?? isApproveMode))
        setCanFilterByUser(Boolean(d.data?.canFilterByUser))
        setList(nextList)
        setTotalCnt(Number(d.data?.totalCnt) || 0)
        setTotalPages(Number(d.data?.totalPages) || 1)
        setPage(Number(d.data?.page) || nextPage)
        if (Array.isArray(d.data?.fileTypes)) setFileTypes(d.data.fileTypes)
        setSelectedGroupKey((prev) => {
          if (prev != null && nextList.some((g) => g.fileGroupKey === prev)) return prev
          return nextList[0]?.fileGroupKey ?? null
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : '목록 조회 실패')
        setList([])
        setSelectedGroupKey(null)
      } finally {
        setLoading(false)
      }
    },
    [listMode, isApproveMode, keyword, fileType, userName, fileAccept, startDate, endDate]
  )

  useEffect(() => {
    void load(1)
  }, [])

  useEffect(() => {
    if (!isApproveMode && !canFilterByUser) {
      setUserNames([])
      return
    }
    void call('', 'POST', {
      service: 'usrService',
      action: 'listUsers',
      params: {},
    })
      .then((res) => {
        const users = (res?.data?.data ?? res?.data ?? []) as {
          usrName?: string | null
        }[]
        const nameSet = new Set<string>()
        if (includeSuperAdminName) nameSet.add('슈퍼관리자')
        if (Array.isArray(users)) {
          for (const u of users) {
            const n = String(u.usrName ?? '').trim()
            if (n) nameSet.add(n)
          }
        }
        setUserNames([...nameSet].sort((a, b) => a.localeCompare(b, 'ko')))
      })
      .catch(() => {
        setUserNames(includeSuperAdminName ? ['슈퍼관리자'] : [])
      })
  }, [isApproveMode, canFilterByUser, includeSuperAdminName])

  const handleBack = () => {
    if (fromPath) {
      router.push(withBasePathNav(fromPath))
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push(withBasePathNav('/'))
  }

  const handleSearch = () => {
    void load(1)
  }

  const handleReset = () => {
    setKeyword('')
    setFileType('')
    setUserName('')
    setFileAccept(defaultFileAccept)
    setStartDate('')
    setEndDate('')
    void load(1, {
      keyword: '',
      fileType: '',
      userName: '',
      fileAccept: defaultFileAccept,
      startDate: '',
      endDate: '',
    })
  }

  const handleDecide = async (fileGroupKey: number, decision: 'Y' | 'N') => {
    if (actingKey != null) return
    const label = decision === 'Y' ? '승인' : '반려'
    if (!window.confirm(`${label}하시겠습니까?`)) return
    setActingKey(fileGroupKey)
    try {
      const res = await call('', 'POST', {
        service: 'dataRequestService',
        action: 'approveDataRequest',
        params: { fileGroupKey, decision },
      })
      const d = res?.data ?? res
      if (!d?.success) {
        window.alert(d?.error ?? `${label} 실패`)
        return
      }
      await load(page)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : `${label} 실패`)
    } finally {
      setActingKey(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-border bg-card">
      {!embedded ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              title="뒤로"
              onClick={handleBack}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
            <h1 className="truncate text-lg font-bold text-foreground">{pageTitle}</h1>
          </div>
        </div>
      ) : null}

      {isApproveMode && !canApprove && error ? (
        <p className="shrink-0 px-5 py-2 text-[12px] text-destructive">{error}</p>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <label className={fieldRowClass}>
                <span className="shrink-0">검색어</span>
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch()
                  }}
                  placeholder="통합검색"
                  className="h-8 w-44 text-[12px]"
                  title="검색어"
                />
              </label>
              <label className={fieldRowClass}>
                <span className="shrink-0">시작일</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 w-36 text-[12px]"
                  title="시작일"
                />
              </label>
              <label className={fieldRowClass}>
                <span className="shrink-0">종료일</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 w-36 text-[12px]"
                  title="종료일"
                />
              </label>
              <label className={fieldRowClass}>
                <span className="shrink-0">분류</span>
                <select
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  className="h-8 w-36 rounded border border-input bg-background px-2 text-[12px]"
                  title="분류"
                >
                  <option value="">전체</option>
                  {fileTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {showUserFilter ? (
                <label className={fieldRowClass}>
                  <span className="shrink-0">사용자</span>
                  <VillagePatrolSuggestInput
                    value={userName}
                    onChange={setUserName}
                    options={userNames}
                    placeholder="이름 검색"
                    aria-label="사용자"
                    className="h-8 w-36 rounded border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
              ) : null}
              <label className={fieldRowClass}>
                <span className="shrink-0">승인상태</span>
                <select
                  value={fileAccept}
                  onChange={(e) => setFileAccept(e.target.value)}
                  className="h-8 w-28 rounded border border-input bg-background px-2 text-[12px]"
                  title="승인상태"
                >
                  <option value="">전체</option>
                  <option value="P">대기중</option>
                  <option value="Y">승인</option>
                  <option value="N">반려</option>
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                className="h-8 cursor-pointer"
                title="검색"
                onClick={handleSearch}
                disabled={loading}
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                검색
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 cursor-pointer"
                title="초기화"
                onClick={handleReset}
                disabled={loading}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                초기화
              </Button>
            </div>
            <span className="shrink-0 text-[12px] text-muted-foreground">총 {totalCnt}건</span>
          </div>

          {error ? (
            <p className="shrink-0 border-b border-red-100 bg-red-50/50 px-5 py-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-[3] flex-col border-r border-border">
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 border-b bg-muted">
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="w-14 px-2 py-2.5 text-center font-semibold">순번</th>
                      <th className="px-2 py-2.5 text-center font-semibold">사용자명</th>
                      <th className="px-2 py-2.5 text-center font-semibold">요청일시</th>
                      <th className="px-2 py-2.5 text-center font-semibold">레이어명</th>
                      <th className="px-2 py-2.5 text-center font-semibold">파일분류</th>
                      <th className="px-2 py-2.5 text-center font-semibold">승인 상태</th>
                      <th className="px-2 py-2.5 text-center font-semibold">승인주체</th>
                      <th className="px-2 py-2.5 text-center font-semibold">승인일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && list.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                          불러오는 중…
                        </td>
                      </tr>
                    ) : list.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                          목록이 없습니다
                        </td>
                      </tr>
                    ) : (
                      list.map((g, idx) => {
                        const seq = (page - 1) * 20 + idx + 1
                        const active = selectedGroupKey === g.fileGroupKey
                        return (
                          <tr
                            key={g.fileGroupKey}
                            className={cn(
                              'cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/40',
                              active && 'bg-primary/5'
                            )}
                            onClick={() => setSelectedGroupKey(g.fileGroupKey)}
                          >
                            <td className="px-2 py-2.5 text-center text-muted-foreground">{seq}</td>
                            <td className="px-2 py-2.5 text-center">
                              {g.fileUserName || g.fileUserId}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-center">
                              {g.fileDate}
                            </td>
                            <td className="px-2 py-2.5 text-center text-[11px]">
                              {formatLayerDisplayName(
                                g.fileList[0]?.fileLayerKor ?? null,
                                g.fileLayer
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center">{g.fileType}</td>
                            <td className="px-2 py-2.5 text-center">{g.acceptLabel}</td>
                            <td className="px-2 py-2.5 text-center">{g.authorLabel || '-'}</td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-center">
                              {formatAcceptDate(g.fileAcceptDate)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-5 py-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="이전"
                  disabled={page <= 1 || loading}
                  onClick={() => void load(page - 1)}
                >
                  이전
                </Button>
                <span className="text-[12px] text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="다음"
                  disabled={page >= totalPages || loading}
                  onClick={() => void load(page + 1)}
                >
                  다음
                </Button>
              </div>
            </div>

            <aside className="flex min-h-0 min-w-0 flex-[1] flex-col bg-background">
              <div className="box-content flex h-[37px] shrink-0 items-center justify-between gap-2 border-b border-border bg-muted px-2">
                <h2 className="text-[11px] font-semibold text-muted-foreground">상세보기</h2>
                {isApproveMode &&
                selected &&
                selected.fileAccept === 'P' &&
                selected.canAct ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      title="승인"
                      className="inline-flex h-7 cursor-pointer items-center rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                      disabled={actingKey === selected.fileGroupKey}
                      onClick={() => void handleDecide(selected.fileGroupKey, 'Y')}
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      title="반려"
                      className="inline-flex h-7 cursor-pointer items-center rounded border border-destructive/30 bg-background px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      disabled={actingKey === selected.fileGroupKey}
                      onClick={() => void handleDecide(selected.fileGroupKey, 'N')}
                    >
                      반려
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="standard-detail-scroll px-4! py-3!">
                {!selected ? (
                  <p className="standard-detail-attr-empty">선택된 요청이 없습니다</p>
                ) : (
                  <div className="space-y-3">
                    <table className="standard-detail-attr-table">
                      <tbody>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            사용자
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {selected.fileUserName || selected.fileUserId}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            요청 IP
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {selected.userIp || '-'}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            요청일시
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {selected.fileDate}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            파일 분류
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {selected.fileType}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            승인 상태
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-value-title standard-detail-attr-cell-border">
                            {selected.acceptLabel}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            승인주체
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {selected.authorLabel || '-'}
                          </td>
                        </tr>
                        <tr>
                          <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                            승인일시
                          </th>
                          <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                            {formatAcceptDate(selected.fileAcceptDate)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {selected.fileList.length === 0 ? (
                      <p className="standard-detail-attr-empty">세부 파일이 없습니다</p>
                    ) : (
                      <table className="standard-detail-attr-table">
                        <tbody>
                          {selected.fileList.flatMap((f) => [
                            <tr key={`${f.drfKey}-layer`}>
                              <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                                레이어명
                              </th>
                              <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                                {formatLayerDisplayName(f.fileLayerKor, f.fileLayer)}
                              </td>
                            </tr>,
                            <tr key={`${f.drfKey}-folder`}>
                              <th className="standard-detail-attr-label standard-detail-attr-cell-border">
                                폴더
                              </th>
                              <td className="standard-detail-attr-value standard-detail-attr-cell-border">
                                {f.fileLayerKey || '-'}
                              </td>
                            </tr>,
                          ])}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
