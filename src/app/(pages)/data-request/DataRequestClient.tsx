'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, ChevronRight, Download, Search, RotateCcw } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { call } from '@/lib/api'
import { withBasePath, withBasePathNav } from '@/lib/basePath'
import { isSuperUser } from '@/lib/auth/superUser'
import { Input } from '@/app/shadcnComponents/ui/input'
import { Button } from '@/app/shadcnComponents/ui/button'
import { VillagePatrolSuggestInput } from '@/app/(pages)/map/_mapContents/safty/villagePatrol/VillagePatrolSuggestInput'

type FileDetail = {
  drfKey: number
  fileLayer: string | null
  fileLayerKor: string | null
  fileSuccess: string | null
  fileAccept: string | null
  fileAcceptAuthor: string | null
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
  fileLayerKor: string
  fileType: string
  fileGroupCount: number
  fileAccept: string
  fileAcceptAuthor: string
  acceptLabel: string
  fileSuccess: string
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

export function DataRequestClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const fromPath = useMemo(
    () => safeFromPath(searchParams.get('from')),
    [searchParams]
  )
  const includeSuperAdminName = isSuperUser(session?.user?.id)

  const [keyword, setKeyword] = useState('')
  const [fileType, setFileType] = useState('')
  const [userName, setUserName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<GroupRow[]>([])
  const [totalCnt, setTotalCnt] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [userNames, setUserNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingKey, setDownloadingKey] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openGroup, setOpenGroup] = useState<number | null>(null)

  const load = useCallback(
    async (
      nextPage = 1,
      overrides?: {
        keyword?: string
        fileType?: string
        userName?: string
        startDate?: string
        endDate?: string
      }
    ) => {
      setLoading(true)
      setError(null)
      const kw = overrides?.keyword ?? keyword
      const ft = overrides?.fileType ?? fileType
      const un = overrides?.userName ?? userName
      const sd = overrides?.startDate ?? startDate
      const ed = overrides?.endDate ?? endDate
      try {
        const res = await call('', 'POST', {
          service: 'dataRequestService',
          action: 'listDataRequests',
          params: {
            keyword: kw,
            fileType: ft,
            fileUserName: un,
            startDate: sd,
            endDate: ed,
            page: nextPage,
            pageSize: 20,
          },
        })
        const d = res?.data ?? res
        if (!d?.success) {
          setError(d?.error ?? '목록을 불러오지 못했습니다.')
          setList([])
          return
        }
        setList(Array.isArray(d.data?.list) ? d.data.list : [])
        setTotalCnt(Number(d.data?.totalCnt) || 0)
        setTotalPages(Number(d.data?.totalPages) || 1)
        setPage(Number(d.data?.page) || nextPage)
        if (Array.isArray(d.data?.fileTypes)) setFileTypes(d.data.fileTypes)
      } catch (e) {
        setError(e instanceof Error ? e.message : '목록 조회 실패')
        setList([])
      } finally {
        setLoading(false)
      }
    },
    [keyword, fileType, userName, startDate, endDate]
  )

  useEffect(() => {
    void load(1)
  }, [])

  useEffect(() => {
    void call('', 'POST', {
      service: 'usrService',
      action: 'listUsers',
      params: {},
    })
      .then((res) => {
        // UserManager와 동일: { success, data: { success, data: UserRow[] } }
        const users = (res?.data?.data ?? res?.data ?? []) as {
          usrName?: string | null
        }[]
        // su는 usr 테이블에 없음 — 현재 계정이 슈퍼유저일 때만 «슈퍼관리자» 포함
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
      .catch((e) => {
        console.warn('[DataRequestClient] usr.usr_name suggestions', e)
        setUserNames(includeSuperAdminName ? ['슈퍼관리자'] : [])
      })
  }, [includeSuperAdminName])

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
    setStartDate('')
    setEndDate('')
    void load(1, {
      keyword: '',
      fileType: '',
      userName: '',
      startDate: '',
      endDate: '',
    })
  }

  const handleDownload = async (fileGroupKey: number) => {
    if (downloadingKey != null) return
    setDownloadingKey(fileGroupKey)
    try {
      const url = withBasePath(
        `/api/data-request/download?fileGroupKey=${encodeURIComponent(String(fileGroupKey))}`
      )
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        window.alert(typeof data.error === 'string' ? data.error : '다운로드 실패')
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
      const rawName = m?.[1] ? decodeURIComponent(m[1]) : m?.[2]
      const fileName = rawName?.trim() || `data_request_${fileGroupKey}.zip`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fileName
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '다운로드 실패')
    } finally {
      setDownloadingKey(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          title="뒤로"
          onClick={handleBack}
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded border border-border px-2 text-[12px] hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          뒤로
        </button>
        <h1 className="text-base font-semibold text-foreground">데이터 요청</h1>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-border bg-card p-3">
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

      <div className="text-[12px] text-muted-foreground">총 {totalCnt}건</div>

      {error ? (
        <p className="text-[12px] text-destructive">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              <th className="border-b border-border px-2 py-2 text-center font-medium">순번</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">사용자명</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">요청 IP</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">요청일시</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">요청 파일명</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">파일분류</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">승인 상태</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">상세보기</th>
              <th className="border-b border-border px-2 py-2 text-center font-medium">다운로드</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  목록이 없습니다
                </td>
              </tr>
            ) : (
              list.map((g, idx) => {
                const seq = (page - 1) * 20 + idx + 1
                const opened = openGroup === g.fileGroupKey
                return (
                  <Fragment key={g.fileGroupKey}>
                    <tr className="hover:bg-muted/30">
                      <td className="border-b border-border px-2 py-1.5 text-center">{seq}</td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        {g.fileUserName || g.fileUserId}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        {g.userIp || '-'}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center whitespace-nowrap">
                        {g.fileDate}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        {g.fileLayerKor}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        {g.fileType}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        {g.acceptLabel}
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        <button
                          type="button"
                          title="상세보기"
                          className="inline-flex cursor-pointer items-center justify-center rounded p-1 hover:bg-muted"
                          onClick={() =>
                            setOpenGroup(opened ? null : g.fileGroupKey)
                          }
                        >
                          {opened ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td className="border-b border-border px-2 py-1.5 text-center">
                        <button
                          type="button"
                          title="다운로드"
                          className="inline-flex cursor-pointer items-center justify-center rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-40"
                          disabled={
                            g.fileSuccess !== 'Y' ||
                            g.fileAccept !== 'Y' ||
                            downloadingKey === g.fileGroupKey
                          }
                          onClick={() => void handleDownload(g.fileGroupKey)}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {opened ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="border-b border-border bg-muted/20 px-4 py-2"
                        >
                          <table className="w-full border-collapse text-[11px]">
                            <thead>
                              <tr>
                                <th className="px-2 py-1 text-left font-medium">영문명</th>
                                <th className="px-2 py-1 text-left font-medium">한글명</th>
                                <th className="px-2 py-1 text-left font-medium">파일 준비</th>
                                <th className="px-2 py-1 text-left font-medium">승인 상태</th>
                                <th className="px-2 py-1 text-left font-medium">승인자</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.fileList.map((f) => (
                                <tr key={f.drfKey}>
                                  <td className="px-2 py-1">{f.fileLayer || '-'}</td>
                                  <td className="px-2 py-1">{f.fileLayerKor || '-'}</td>
                                  <td className="px-2 py-1">
                                    {f.fileSuccess === 'Y' ? '완료' : '실패'}
                                  </td>
                                  <td className="px-2 py-1">{f.acceptLabel}</td>
                                  <td className="px-2 py-1">
                                    {f.authorLabel || f.fileAcceptUser || '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 py-2">
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
  )
}
