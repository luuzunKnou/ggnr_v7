'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Play, Plus, FileImage, FileVideo, MapPin, Download, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import type { AttrRow, WorkFileItem, WorkUnitItem } from './aerialMediaTypes';
import { AttributeSection, SectionTitle, StatusBadge } from './AerialMediaUi';
import { updateWorkUnitAttrs } from './aerialMediaMockData';
import { FlightLogbookForm } from './FlightLogbookForm';
import { SHOOT_TYPE_LABEL, type ShootingRequestDraft } from '../shootingRequest/shootingRequestMockData';

/** 속성정보 인라인 수정 상태 (목업 저장) */
function useAttrEdit(unit: WorkUnitItem) {
  const [editing, setEditing] = useState(false);
  const [attrs, setAttrs] = useState<AttrRow[]>(unit.attrs);

  useEffect(() => {
    setAttrs(unit.attrs);
    setEditing(false);
  }, [unit.id, unit.attrs]);

  const changeAttr = (i: number, v: string) =>
    setAttrs((rows) => rows.map((r, idx) => (idx === i ? { ...r, value: v } : r)));

  const start = () => setEditing(true);
  const cancel = () => {
    setAttrs(unit.attrs);
    setEditing(false);
  };
  const save = () => {
    updateWorkUnitAttrs(unit.kind, unit.id, { attrs });
    setEditing(false);
  };

  return { editing, attrs, changeAttr, start, cancel, save };
}

export type DetailTab = 'info' | 'flight';

const footerBtnClass =
  'rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#666] transition-colors hover:bg-slate-50';

type DetailHeaderProps = {
  title: string;
  tab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  /** 수정 중에는 탭 전환 숨김 */
  editing?: boolean;
  /** 우측 상단 X 닫기 (촬영요청·도로대장 상세와 동일) */
  onClose?: () => void;
};

export function DetailHeader({
  title,
  tab = 'info',
  onTabChange,
  editing = false,
  onClose,
}: DetailHeaderProps) {
  return (
    <div className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex h-11 items-center gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{title}</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {onTabChange && !editing ? (
        <div className="flex gap-1 bg-slate-50/80 px-2.5 pb-2">
          {(
            [
              { id: 'info' as const, label: '상세정보' },
              { id: 'flight' as const, label: '비행기록부' },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                  active
                    ? 'bg-white font-semibold text-sky-800 shadow-sm ring-1 ring-sky-200'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type DetailFooterProps = {
  onClose: () => void;
  onDelete?: () => void;
  editing?: boolean;
  onStartEdit?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  hint?: string;
};

/** 시설관리 상세와 동일: 하단 수정·삭제·닫기 */
function DetailFooter({
  onClose,
  onDelete,
  editing = false,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  hint = '상세정보',
}: DetailFooterProps) {
  return (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[#666]">{editing ? '수정 중' : hint}</span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={onSaveEdit}
                className="rounded border border-sky-600 bg-sky-600 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-sky-700"
              >
                저장
              </button>
              <button type="button" onClick={onCancelEdit} className={footerBtnClass}>
                취소
              </button>
            </>
          ) : (
            <>
              {onStartEdit ? (
                <button type="button" onClick={onStartEdit} className={footerBtnClass}>
                  수정
                </button>
              ) : null}
              {onDelete ? (
                <button type="button" onClick={onDelete} className={footerBtnClass}>
                  삭제
                </button>
              ) : null}
            </>
          )}
          <button type="button" onClick={onClose} className={footerBtnClass}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkUnitInfoBody({
  unit,
  fileSection,
  editing = false,
  attrRows,
  onChangeAttr,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: {
  unit: WorkUnitItem;
  fileSection: ReactNode;
  editing?: boolean;
  attrRows?: AttrRow[];
  onChangeAttr?: (index: number, value: string) => void;
  linkedRequest?: ShootingRequestDraft | null;
  onFolderUpload?: () => void;
  onClearLink?: () => void;
}) {
  const showLinkedUpload =
    Boolean(linkedRequest) &&
    Boolean(onFolderUpload) &&
    (linkedRequest?.status === 'approved' || linkedRequest?.status === 'registering');

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
      {showLinkedUpload && linkedRequest ? (
        <div className="space-y-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-semibold text-sky-900">승인 건으로 자료 등록</p>
            {onClearLink ? (
              <button
                type="button"
                className="shrink-0 text-[10px] text-sky-700 underline"
                onClick={onClearLink}
              >
                연결 해제
              </button>
            ) : null}
          </div>
          <p className="text-[11px] font-medium text-slate-800">
            {linkedRequest.purpose || '목적 없음'}
          </p>
          <p className="text-[10px] leading-relaxed text-slate-600">
            {SHOOT_TYPE_LABEL[linkedRequest.shootType]} · 촬영 {linkedRequest.shootDate || '—'} ·{' '}
            {linkedRequest.address || '지번 미입력'}
          </p>
          <Button type="button" size="sm" className="h-7 w-full text-[10px]" onClick={onFolderUpload}>
            이 건으로 폴더 업로드
          </Button>
        </div>
      ) : null}

      <AttributeSection
        title="속성정보"
        rows={editing ? (attrRows ?? unit.attrs) : unit.attrs}
        dense
        editable={editing}
        onChangeValue={onChangeAttr}
      />
      {fileSection}
    </div>
  );
}

type OrthoDetailProps = {
  unit: WorkUnitItem;
  checkedFileIds: Set<string>;
  onToggleFile: (fileId: string) => void;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onClose: () => void;
  detailTab: DetailTab;
  onDetailTabChange: (tab: DetailTab) => void;
  /** 조회전용: 비행기록부·삭제·추가 숨김 */
  viewOnly?: boolean;
  linkedRequest?: ShootingRequestDraft | null;
  onFolderUpload?: () => void;
  onClearLink?: () => void;
};

export function OrthoWorkUnitDetailPanel({
  unit,
  checkedFileIds,
  onToggleFile,
  selectedFileId,
  onSelectFile,
  onClose,
  detailTab,
  onDetailTabChange,
  viewOnly = false,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: OrthoDetailProps) {
  const edit = useAttrEdit(unit);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
      />
      {!viewOnly && detailTab === 'flight' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlightLogbookForm
            workUnitLabel={workLabel}
            srKey={
              linkedRequest?.id != null && Number.isFinite(Number(linkedRequest.id))
                ? Number(linkedRequest.id)
                : null
            }
            embedded
          />
        </div>
      ) : (
        <WorkUnitInfoBody
          unit={unit}
          editing={edit.editing}
          attrRows={edit.attrs}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle
                action={
                  viewOnly ? undefined : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => window.alert('목업: 파일 추가 API 없음')}
                    >
                      <Plus className="h-3 w-3" />
                      추가
                    </Button>
                  )
                }
              >
                파일 목록
              </SectionTitle>
              <p className="mb-2 text-[10px] leading-relaxed text-slate-400">
                변환완료 파일만 체크하면 지도 타일을 켤 수 있습니다. 파일을 클릭하면 지도가 촬영 위치로
                이동합니다.
              </p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                checkedIds={checkedFileIds}
                onToggleCheck={onToggleFile}
                checkableDoneOnly
                onSelect={onSelectFile}
                showLocation
                statusMode="convert"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={
          showInfoActions && !edit.editing ? () => window.alert('목업: 삭제 API 없음') : undefined
        }
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
        hint={detailTab === 'flight' ? '비행기록부' : '상세정보'}
      />
    </div>
  );
}

type DroneDetailProps = {
  unit: WorkUnitItem;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onClose: () => void;
  detailTab: DetailTab;
  onDetailTabChange: (tab: DetailTab) => void;
  viewOnly?: boolean;
  linkedRequest?: ShootingRequestDraft | null;
  onFolderUpload?: () => void;
  onClearLink?: () => void;
};

export function DroneWorkUnitDetailPanel({
  unit,
  selectedFileId,
  onSelectFile,
  onClose,
  detailTab,
  onDetailTabChange,
  viewOnly = false,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: DroneDetailProps) {
  const edit = useAttrEdit(unit);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
      />
      {!viewOnly && detailTab === 'flight' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlightLogbookForm
            workUnitLabel={workLabel}
            srKey={
              linkedRequest?.id != null && Number.isFinite(Number(linkedRequest.id))
                ? Number(linkedRequest.id)
                : null
            }
            embedded
          />
        </div>
      ) : (
        <WorkUnitInfoBody
          unit={unit}
          editing={edit.editing}
          attrRows={edit.attrs}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle>파일 목록</SectionTitle>
              <p className="mb-2 text-[10px] text-slate-400">파일을 선택하면 옆에 미리보기가 열립니다.</p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                onSelect={onSelectFile}
                showLocation
                statusMode="upload"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={
          showInfoActions && !edit.editing ? () => window.alert('목업: 삭제 API 없음') : undefined
        }
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
        hint={detailTab === 'flight' ? '비행기록부' : '상세정보'}
      />
    </div>
  );
}

type DroneFileProps = {
  file: WorkFileItem;
  onClose: () => void;
};

export function DroneFileDetailPanel({ file, onClose }: DroneFileProps) {
  const isVideo = file.previewKind === 'video';
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-white">
      <DetailHeader title="파일 상세" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <p className="truncate text-[12px] font-semibold text-slate-800">{file.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-white px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
              {file.format.toUpperCase()}
            </span>
            <span className="rounded-md bg-white px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
              {file.sizeLabel}
            </span>
            <StatusBadge status={file.status} mode="upload" />
          </div>
        </div>

        <AttributeSection
          title="파일 정보"
          dense
          rows={[
            { label: '파일명', value: file.name },
            { label: '형식', value: file.format.toUpperCase() },
            { label: '크기', value: file.sizeLabel },
            { label: '촬영 위치', value: file.locationLabel ?? '—' },
          ]}
        />

        <section>
          <SectionTitle
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => window.alert('목업: 다운로드 API 없음')}
              >
                <Download className="h-3 w-3" />
                다운로드
              </Button>
            }
          >
            미리보기
          </SectionTitle>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900 shadow-sm">
            <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
              {isVideo ? (
                <div className="flex flex-col items-center gap-2 text-slate-300">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                    <Play className="h-5 w-5 fill-current" />
                  </div>
                  <span className="max-w-[90%] truncate px-2 text-[11px]">{file.name}</span>
                  <span className="text-[10px] text-slate-500">동영상 미리보기 (목업)</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 text-center text-slate-300">
                  <div className="h-24 w-36 rounded border border-dashed border-slate-500/60 bg-slate-800/80" />
                  <span className="max-w-[90%] truncate text-[11px]">{file.name}</span>
                  <span className="text-[10px] text-slate-500">사진 미리보기 (목업)</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      <DetailFooter onClose={onClose} hint="파일 상세" />
    </div>
  );
}

type PanoDetailProps = {
  unit: WorkUnitItem;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onClose: () => void;
  detailTab: DetailTab;
  onDetailTabChange: (tab: DetailTab) => void;
  viewOnly?: boolean;
  linkedRequest?: ShootingRequestDraft | null;
  onFolderUpload?: () => void;
  onClearLink?: () => void;
};

export function PanoramaWorkUnitDetailPanel({
  unit,
  selectedFileId,
  onSelectFile,
  onClose,
  detailTab,
  onDetailTabChange,
  viewOnly = false,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: PanoDetailProps) {
  const edit = useAttrEdit(unit);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
      />
      {!viewOnly && detailTab === 'flight' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlightLogbookForm
            workUnitLabel={workLabel}
            srKey={
              linkedRequest?.id != null && Number.isFinite(Number(linkedRequest.id))
                ? Number(linkedRequest.id)
                : null
            }
            embedded
          />
        </div>
      ) : (
        <WorkUnitInfoBody
          unit={unit}
          editing={edit.editing}
          attrRows={edit.attrs}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle>파일 목록</SectionTitle>
              <p className="mb-2 text-[10px] text-slate-400">파일을 선택하면 옆에 미리보기가 열립니다.</p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                onSelect={onSelectFile}
                showLocation
                statusMode="upload"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={
          showInfoActions && !edit.editing ? () => window.alert('목업: 삭제 API 없음') : undefined
        }
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
        hint={detailTab === 'flight' ? '비행기록부' : '상세정보'}
      />
    </div>
  );
}

type SatDetailProps = {
  unit: WorkUnitItem;
  onClose: () => void;
  detailTab: DetailTab;
  onDetailTabChange: (tab: DetailTab) => void;
  viewOnly?: boolean;
  linkedRequest?: ShootingRequestDraft | null;
  onFolderUpload?: () => void;
  onClearLink?: () => void;
};

export function SatelliteWorkUnitDetailPanel({
  unit,
  onClose,
  detailTab,
  onDetailTabChange,
  viewOnly = false,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: SatDetailProps) {
  const edit = useAttrEdit(unit);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
      />
      {!viewOnly && detailTab === 'flight' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlightLogbookForm
            workUnitLabel={workLabel}
            srKey={
              linkedRequest?.id != null && Number.isFinite(Number(linkedRequest.id))
                ? Number(linkedRequest.id)
                : null
            }
            embedded
          />
        </div>
      ) : (
        <WorkUnitInfoBody
          unit={unit}
          editing={edit.editing}
          attrRows={edit.attrs}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle>파일 목록</SectionTitle>
              <p className="mb-2 text-[10px] text-slate-400">
                지도 표시는 배경지도 «자체항공영상»에서 on/off 합니다.
              </p>
              <FileRows files={unit.files} selectedId={null} onSelect={() => {}} statusMode="convert" />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={
          showInfoActions && !edit.editing ? () => window.alert('목업: 삭제 API 없음') : undefined
        }
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
        hint={detailTab === 'flight' ? '비행기록부' : '상세정보'}
      />
    </div>
  );
}

function FileRows({
  files,
  selectedId,
  onSelect,
  checkedIds,
  onToggleCheck,
  checkableDoneOnly,
  showLocation,
  statusMode = 'upload',
}: {
  files: WorkFileItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  checkedIds?: Set<string>;
  onToggleCheck?: (id: string) => void;
  checkableDoneOnly?: boolean;
  showLocation?: boolean;
  /** ortho=변환중·변환완료, drone/pano=업로드완료 */
  statusMode?: 'convert' | 'upload';
}) {
  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[11px] text-slate-400">
        파일이 없습니다.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {files.map((f) => {
        const selected = f.id === selectedId;
        const canCheck = !checkableDoneOnly || f.status === 'done';
        const checked = checkedIds?.has(f.id) ?? false;
        const isVideo = f.previewKind === 'video' || f.format === 'mp4' || f.format === 'mov';
        const FileIcon = isVideo ? FileVideo : FileImage;

        return (
          <li key={f.id}>
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border px-2.5 py-2.5 transition-colors',
                selected
                  ? 'border-sky-300 bg-sky-50 shadow-sm ring-1 ring-sky-200/70'
                  : checked
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              {onToggleCheck ? (
                <label className="mt-0.5 flex shrink-0 items-center">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300"
                    checked={checked}
                    disabled={!canCheck}
                    onChange={() => onToggleCheck(f.id)}
                    title={canCheck ? '지도 타일 표시' : '변환 완료 후 선택 가능'}
                  />
                </label>
              ) : null}

              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(f.id)}>
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      selected ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    <FileIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-[11px] font-medium',
                          selected ? 'text-sky-950' : 'text-slate-800'
                        )}
                        title={f.name}
                      >
                        {f.name}
                      </span>
                      <StatusBadge status={f.status} mode={statusMode} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                      <span>{f.format.toUpperCase()}</span>
                      <span>{f.sizeLabel}</span>
                      {showLocation && f.locationLabel ? (
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          <MapPin className="h-2.5 w-2.5" />
                          {f.locationLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
