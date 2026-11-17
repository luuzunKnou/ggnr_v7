'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
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
import { useMapContext } from '../../../_mapComponents/MapContext'
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel'

/** 주소검색 아래·목록 오른쪽 — 너비는 주소검색(350)과 맞추고 세로는 길게 */
const FLOAT_TOP = 60
const FLOAT_WIDTH = '350px'
const FLOAT_MAX_HEIGHT = '92vh'
const FLOAT_PANEL_CLASS =
  'bg-white backdrop-blur-none [&>div:first-child]:bg-white [&>div:first-child]:hover:bg-muted/40'

/**
 * 점검 완료 시설 보기 — 목록을 가리지 않는 플로팅.
 */
export function SmallPublicFacilityInspectionModal({
  facility: f,
  inspection: i,
  onEdit,
  onClose,
}: {
  facility: SmallPublicFacility
  inspection: SmallPublicInspection
  year: number
  onEdit: (inspection: SmallPublicInspection) => void
  onClose: () => void
  /** @deprecated 목록 오버레이 방식 제거 — 호환용 */
  overlayLeftPx?: number
  overlayWidthPx?: number
}) {
  const mapContext = useMapContext()
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20
  const preview = useSmallPublicFilePreview()
  const files = useMemo(() => {
    return [i.file, i.classFile].filter((x): x is SmallPublicFile => !!x)
  }, [i])

  const remove = () => {
    if (!window.confirm(`${i.date} 점검을 삭제할까요?`)) return
    smallPublicActions.deleteInspection(i.id)
    onClose()
  }

  return (
    <>
      <MapFloatingPanel
        viewport
        zLayer="detailFloating"
        width={FLOAT_WIDTH}
        maxHeight={FLOAT_MAX_HEIGHT}
        className={FLOAT_PANEL_CLASS}
        defaultPosition={{ top: FLOAT_TOP, left: floatingLeftPx }}
        header={
          <>
            <div className="min-w-0 flex-1 text-[#000]">
              <span className="block truncate text-xs font-semibold">점검 상세</span>
              <span className="mt-0.5 block truncate text-[11px]">
                {[f.name, f.type].filter(Boolean).join(' / ')}
              </span>
            </div>
            <button
              type="button"
              title="닫기"
              onClick={onClose}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-[#000]/80 hover:bg-muted/50 hover:text-[#000]"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 scrollbar-thin">
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
          </div>
          <div className="flex w-full shrink-0 items-center gap-1 border-t border-border bg-white px-3 py-1.5">
            <SmallPublicCrudBar bordered={false} className="px-0 py-0" onEdit={() => onEdit(i)} onDelete={remove} />
          </div>
        </div>
      </MapFloatingPanel>
      {preview.element}
    </>
  )
}
