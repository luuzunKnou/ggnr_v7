'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WtlTopoChangeAction } from './wtlTopologySample'
import { WTL_TOPO_ACTION_LABEL } from './wtlTopologySample'

type Props = {
  action: WtlTopoChangeAction
  issueTarget: string
  applyModeLabel: string
  onClose: () => void
  onSubmit: (payload: {
    memo: string
    files: { name: string; size: number; dataUrl?: string }[]
  }) => void
}

export function WtlTopoRequestModal({
  action,
  issueTarget,
  applyModeLabel,
  onClose,
  onSubmit,
}: Props) {
  const [memo, setMemo] = useState('')
  const [files, setFiles] = useState<{ name: string; size: number; dataUrl?: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const readFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const next = [...files]
    for (const file of Array.from(list)) {
      if (next.length >= 5) break
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('read fail'))
        reader.readAsDataURL(file)
      }).catch(() => undefined)
      next.push({ name: file.name, size: file.size, dataUrl })
    }
    setFiles(next)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">
              {WTL_TOPO_ACTION_LABEL[action]}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {applyModeLabel} · {issueTarget}
            </p>
          </div>
          <button type="button" className="rounded p-1 hover:bg-muted" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground">메모</span>
            <textarea
              className="h-28 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:border-primary"
              placeholder="수정 사유·현장 메모를 입력하세요."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground">첨부파일 (도면 등)</span>
              <button
                type="button"
                className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                onClick={() => inputRef.current?.click()}
              >
                파일 추가
              </button>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf,.dwg,.dxf,.zip"
                onChange={(e) => {
                  void readFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
            {files.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">첨부 없음 (최대 5개)</p>
            ) : (
              <ul className="space-y-1">
                {files.map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-foreground">{f.name}</span>
                    <button
                      type="button"
                      className={cn('shrink-0 text-[10px] text-muted-foreground hover:text-foreground')}
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            className="rounded border border-border px-2.5 py-1.5 text-[11px] hover:bg-muted"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            disabled={!memo.trim()}
            className="rounded bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
            onClick={() => onSubmit({ memo: memo.trim(), files })}
          >
            {applyModeLabel === '즉시수정' ? '저장' : '요청 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
