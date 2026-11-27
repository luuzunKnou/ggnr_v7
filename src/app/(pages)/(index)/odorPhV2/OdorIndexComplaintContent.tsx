'use client'

import { useCallback, useState } from 'react'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  MOCK_ODOR_COMPLAINT_LINKS,
  type OdorComplaintLinkMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { getOdorIndexMenuDescription } from '@/app/(pages)/(index)/odorPhV2/odorIndexMenus'
import { OdorComplaintFormModal, type OdorComplaintEditor } from '@/app/(pages)/map/_mapContents/odorComplaintV2/OdorComplaintFormModal'
import { OdorComplaintListPanel } from '@/app/(pages)/map/_mapContents/odorComplaintV2/OdorComplaintListPanel'

type Props = {
  sensors?: OdorSensorListItem[]
  onGoActionHistory?: () => void
}

/**
 * 콘솔 «민원 관리» — 목록 + 등록/수정 모달 (지도 메뉴와 동일 UX).
 */
export function OdorIndexComplaintContent({
  sensors = [],
  onGoActionHistory,
}: Props) {
  const [items, setItems] = useState<OdorComplaintLinkMock[]>(() => [...MOCK_ODOR_COMPLAINT_LINKS])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<OdorComplaintEditor | null>(null)

  const handleSave = useCallback((row: OdorComplaintLinkMock) => {
    setItems((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = row
        return next
      }
      return [row, ...prev]
    })
    setSelectedId(row.id)
    setEditor({ mode: 'edit', id: row.id })
  }, [])

  const handleDelete = useCallback((id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id))
    setSelectedId(null)
    setEditor(null)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <p className="shrink-0 text-[12px] text-muted-foreground">
        {getOdorIndexMenuDescription('complaintManage')}
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <OdorComplaintListPanel
          items={items}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            setEditor({ mode: 'edit', id })
          }}
          onAdd={() => {
            setSelectedId(null)
            setEditor({ mode: 'create' })
          }}
        />
      </div>

      <OdorComplaintFormModal
        editor={editor}
        items={items}
        sensors={sensors}
        onClose={() => setEditor(null)}
        onSave={handleSave}
        onDelete={handleDelete}
        onGoActionHistory={onGoActionHistory}
      />
    </div>
  )
}
