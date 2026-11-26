'use client'

import { smallPublicBtnGhost } from '../smallPublicConfig'
import {
  smallPublicInspectionFiles,
  type SmallPublicFacility,
  type SmallPublicInspection,
} from '../smallPublicMock'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicFileRow,
  SmallPublicGradeBadge,
  smallPublicDateLabel,
  useSmallPublicFilePreview,
} from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

/**
 * 후보지 상세 «안전점검» 탭 — 점검 결과 보기(조회 전용).
 * 수정·삭제·첨부 변경은 부서업무 «안전점검»에서 한다.
 */
export function SmallPublicInspectionPeekModal({
  facility,
  inspection: i,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  inspection: SmallPublicInspection
  onClose: () => void
}) {
  const preview = useSmallPublicFilePreview()
  const files = smallPublicInspectionFiles(i)
  return (
    <>
      <SmallPublicModalShell
        {...overlay}
        size="md"
        title={`안전점검 ${i.date}`}
        subtitle={facility.name}
        onClose={onClose}
        footer={
          <button type="button" className={`${smallPublicBtnGhost} ml-auto`} onClick={onClose}>
            닫기
          </button>
        }
      >
        <div className="space-y-3 p-3">
          <SmallPublicAttrTable
            entries={[
              { key: 'date', label: '조사일', value: smallPublicDateLabel(i.date) },
              { key: 'inspector', label: '조사자', value: i.inspector || '—' },
              { key: 'score', label: '평가점수', value: i.score ? `${i.score}점` : '—' },
              { key: 'grade', label: '평가등급', value: <SmallPublicGradeBadge grade={i.grade} /> },
              { key: 'class', label: '평가구분', value: <SmallPublicClassBadge candidate={i.classResult} /> },
              { key: 'remark', label: '기타의견', value: i.remark || '—', full: true },
            ]}
          />
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-foreground/90">첨부</p>
            {files.length === 0 ? (
              <div className="rounded border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
                첨부 파일이 없습니다.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {files.map((file) => (
                  <SmallPublicFileRow
                    key={file.id}
                    file={file}
                    facilityName={facility.name}
                    onPreview={() => preview.open(file, files)}
                    onDownload={() => preview.download(file)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SmallPublicModalShell>
      {preview.element}
    </>
  )
}
