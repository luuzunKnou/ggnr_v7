'use client'

import { useMemo } from 'react'
import type { SmallPublicFacility, SmallPublicFile, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicCrudBar,
  SmallPublicFileRow,
  SmallPublicGradeBadge,
  smallPublicDateLabel,
  useSmallPublicFilePreview,
} from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'

/**
 * 점검 완료 시설 보기 — 한 줄씩 속성 + 첨부 목록(클릭 시 크게 보기).
 */
export function SmallPublicFacilityInspectionModal({
  facility: f,
  inspection: i,
  year,
  onEdit,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  inspection: SmallPublicInspection
  year: number
  onEdit: (inspection: SmallPublicInspection) => void
  onClose: () => void
}) {
  const preview = useSmallPublicFilePreview()
  const files = useMemo(() => {
    return [i.file, i.classFile].filter((x): x is SmallPublicFile => !!x)
  }, [i])

  const spec = [f.length && `연장 ${f.length}m`, f.width && `폭 ${f.width}m`, f.height && `높이 ${f.height}m`]
    .filter(Boolean)
    .join(' · ')

  const remove = () => {
    if (!window.confirm(`${i.date} 점검을 삭제할까요?`)) return
    smallPublicActions.deleteInspection(i.id)
    onClose()
  }

  return (
    <>
      <SmallPublicModalShell
        {...overlay}
        size="md"
        title={`${f.name} · ${year}년 점검`}
        subtitle={`${f.type} · ${[f.emd, f.ri].filter(Boolean).join(' ')}${spec ? ` · ${spec}` : ''}`}
        showHeaderClose
        onClose={onClose}
        bodyClassName="max-h-[min(60dvh,28rem)] overflow-y-auto px-3 py-2.5 scrollbar-thin"
        footer={
          <SmallPublicCrudBar
            bordered={false}
            className="px-0 py-0"
            onEdit={() => onEdit(i)}
            onDelete={remove}
          />
        }
      >
        <div className="flex flex-col gap-3 text-[11px]">
          <SmallPublicAttrTable
            stacked
            entries={[
              { key: 'date', label: '점검일', value: smallPublicDateLabel(i.date) },
              { key: 'inspector', label: '점검자', value: i.inspector || '—' },
              { key: 'grade', label: '등급', value: <SmallPublicGradeBadge grade={i.grade} /> },
              { key: 'class', label: '평가구분', value: <SmallPublicClassBadge candidate={i.classResult} /> },
              { key: 'remark', label: '기타의견', value: i.remark || '—' },
              {
                key: 'files',
                label: '첨부',
                value:
                  files.length === 0 ? (
                    <span className="text-muted-foreground">첨부 파일이 없습니다.</span>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {files.map((file) => (
                        <SmallPublicFileRow
                          key={file.id}
                          file={file}
                          facilityName={f.name}
                          onPreview={() => preview.open(file, files)}
                          onDownload={() => preview.download(file)}
                        />
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        </div>
      </SmallPublicModalShell>
      {preview.element}
    </>
  )
}
