'use client'

import { useCallback, useEffect, useState } from 'react'
import { call } from '@/lib/api'
import { INDIVIDUAL_LAND_PRICE_SERVICE, type LandPriceMemo } from './individualLandPriceConfig'

const MEMO_MAX_LENGTH = 2000

async function callService<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const res = await call('', 'POST', { service: INDIVIDUAL_LAND_PRICE_SERVICE, action, params })
  if (!res?.success) throw new Error(String((res as { error?: string })?.error ?? '처리하지 못했습니다.'))
  return (res.data ?? res) as T
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '처리하지 못했습니다.'
}

/** 필지별 메모 — 누구나 보고 쓰며, 수정·삭제는 작성자 본인만 */
export function IndividualLandPriceMemoSection({ pnu }: { pnu: string }) {
  const [rows, setRows] = useState<LandPriceMemo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editKey, setEditKey] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await callService<{ rows: LandPriceMemo[] }>('memos', { pnu })
      setRows(d.rows ?? [])
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [pnu])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: string, params: Record<string, unknown>, after?: () => void) => {
    setSaving(true)
    try {
      await callService(action, params)
      after?.()
      await load()
    } catch (e) {
      window.alert(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = () => {
    const contents = draft.trim()
    if (!contents) return
    void run('addMemo', { pnu, contents }, () => setDraft(''))
  }

  const handleUpdate = () => {
    const contents = editText.trim()
    if (editKey == null || !contents) return
    void run('updateMemo', { memoKey: editKey, contents }, () => setEditKey(null))
  }

  const handleDelete = (memoKey: number) => {
    if (!window.confirm('메모를 삭제할까요?')) return
    void run('deleteMemo', { memoKey })
  }

  return (
    <div className="pb-2">
      <div className="flex flex-col gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MEMO_MAX_LENGTH}
          rows={3}
          placeholder="이 필지에 대한 메모를 입력하세요."
          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="standard-detail-action-btn"
            onClick={handleAdd}
            disabled={saving || !draft.trim()}
          >
            메모 등록
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {error ? (
          <div className="standard-detail-empty-dashed-compact">{error}</div>
        ) : !loading && rows.length === 0 ? (
          <div className="standard-detail-empty-dashed-compact">등록된 메모가 없습니다.</div>
        ) : rows.length === 0 ? null : (
          rows.map((m) => (
            <div key={m.memoKey} className="rounded border border-border px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{m.createUser || '—'}</span>
                <span className="tabular-nums">{m.createDate}</span>
                {m.mine && editKey !== m.memoKey ? (
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className="standard-detail-action-btn-compact"
                      onClick={() => {
                        setEditKey(m.memoKey)
                        setEditText(m.contents)
                      }}
                      disabled={saving}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="standard-detail-action-btn-compact"
                      onClick={() => handleDelete(m.memoKey)}
                      disabled={saving}
                    >
                      삭제
                    </button>
                  </span>
                ) : null}
              </div>
              {editKey === m.memoKey ? (
                <div className="mt-1 flex flex-col gap-1">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    maxLength={MEMO_MAX_LENGTH}
                    rows={3}
                    className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      className="standard-detail-action-btn-compact"
                      onClick={() => setEditKey(null)}
                      disabled={saving}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      className="standard-detail-action-btn-compact"
                      onClick={handleUpdate}
                      disabled={saving || !editText.trim()}
                    >
                      저장
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs">{m.contents}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
