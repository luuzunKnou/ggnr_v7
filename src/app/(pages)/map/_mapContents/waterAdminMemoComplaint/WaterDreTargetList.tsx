'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { call } from '@/lib/api'
import { Button } from '@/app/shadcnComponents/ui/button'
import { Input } from '@/app/shadcnComponents/ui/input'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import { DRE_DETAIL_FIELDS } from '@/service/waterAdminComplaintProfile'
import type { WaterDreDetail } from '@/service/waterAdminComplaintService'

const EMPTY: Omit<WaterDreDetail, 'detailKey'> = {
  jibun: '',
  address: '',
  name: '',
  tel: '',
  length: '',
  count: '',
  company: '',
  remark: '',
  extent3857: null,
  geomGeoJson4326: null,
}

type Props = {
  compKey: number
  details: WaterDreDetail[]
  selectedKey: number | null
  onFocus: (detail: WaterDreDetail) => void
  onChange: (details: WaterDreDetail[]) => void
}

export function WaterDreTargetList({ compKey, details, selectedKey, onFocus, onChange }: Props) {
  const canWrite = useSerWriteAccess()
  const [draft, setDraft] = useState<Omit<WaterDreDetail, 'detailKey'> | null>(null)
  const [editingKey, setEditingKey] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (detailKey: number | null, fields: Omit<WaterDreDetail, 'detailKey'>) => {
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'saveDetail',
        params: { compKey, detailKey, ...fields },
      })
      const next = (res?.data ?? res) as WaterDreDetail[] | undefined
      if (Array.isArray(next)) onChange(next)
      setDraft(null)
      setEditingKey(null)
    } catch {
      window.alert('준설대상지 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (detailKey: number) => {
    if (!window.confirm('이 준설대상지를 삭제할까요?')) return
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'removeDetail',
        params: { compKey, detailKey },
      })
      const next = (res?.data ?? res) as WaterDreDetail[] | undefined
      if (Array.isArray(next)) onChange(next)
      setEditingKey(null)
    } catch {
      window.alert('준설대상지 삭제에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">이 민원에 연결된 대상지 {details.length}건</p>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={saving}
            onClick={() => {
              setEditingKey(null)
              setDraft({ ...EMPTY })
            }}
          >
            <Plus className="h-3 w-3" />
            대상지 추가
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {draft ? (
          <DetailForm
            value={draft}
            saving={saving}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => void save(null, draft)}
          />
        ) : null}
        {details.length === 0 && !draft ? (
          <p className="py-8 text-center text-xs text-muted-foreground">등록된 준설대상지가 없습니다.</p>
        ) : null}
        {details.map((detail) =>
          editingKey === detail.detailKey ? (
            <DetailForm
              key={detail.detailKey}
              value={detail}
              saving={saving}
              onChange={(next) =>
                onChange(details.map((row) => (row.detailKey === detail.detailKey ? { ...row, ...next } : row)))
              }
              onCancel={() => setEditingKey(null)}
              onSave={() => void save(detail.detailKey, detail)}
              onDelete={() => void remove(detail.detailKey)}
            />
          ) : (
            <div
              key={detail.detailKey}
              className={
                selectedKey === detail.detailKey
                  ? 'flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/[0.03] px-3 py-2'
                  : 'flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2'
              }
            >
              <button
                type="button"
                onClick={() => onFocus(detail)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-xs font-medium text-foreground">
                  {detail.address || detail.jibun || `대상지 #${detail.detailKey}`}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[detail.name, detail.tel, detail.length ? `연장 ${detail.length}m` : '', detail.count ? `수량 ${detail.count}` : '']
                    .filter(Boolean)
                    .join(' · ') || '-'}
                </p>
              </button>
              {canWrite ? (
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDraft(null)
                    setEditingKey(detail.detailKey)
                  }}
                >
                  수정
                </button>
              ) : null}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function DetailForm({
  value,
  saving,
  onChange,
  onCancel,
  onSave,
  onDelete,
}: {
  value: Omit<WaterDreDetail, 'detailKey'>
  saving: boolean
  onChange: (next: Omit<WaterDreDetail, 'detailKey'>) => void
  onCancel: () => void
  onSave: () => void
  onDelete?: () => void
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-background p-3">
      <div className="grid grid-cols-2 gap-2">
        {DRE_DETAIL_FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {field.label}
            <Input
              value={value[field.key] ?? ''}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
              className="h-8 text-xs"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        {onDelete ? (
          <Button type="button" size="sm" variant="ghost" className="mr-auto h-7 px-2 text-xs text-destructive" disabled={saving} onClick={onDelete}>
            <Trash2 className="mr-1 h-3 w-3" />
            삭제
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={onCancel}>
          취소
        </Button>
        <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={onSave}>
          저장
        </Button>
      </div>
    </div>
  )
}
