'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Play, Plus, FileImage, FileVideo, MapPin, Download, Trash2, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';
import { recordDataViewLog } from '@/lib/recordDataViewLog';
import type { AttrRow, WorkFileItem, WorkUnitItem } from './aerialMediaTypes';
import { fileMissingGeom } from './aerialLocationParse';
import { AttributeSection, MissingGeomMark, SectionTitle, StatusBadge } from './AerialMediaUi';
import { updateWorkUnitAttrs } from './aerialMediaMockData';
import { FlightLogbookForm } from './FlightLogbookForm';
import { SHOOT_TYPE_LABEL, type ShootingRequestDraft } from '../shootingRequest/shootingRequestMockData';
import { ServiceFileImagePreview } from '../../_mapComponents/standard/ServiceFileImagePreview';
import type { MapHitOverlapOption } from '../../_mapComponents/MapHitOverlapSelect';
import { IdentifyHitListBlock } from '../../_mapComponents/standard/IdentifyHitListBlock';
import type { IdentifyLayerResult } from '../../_mapComponents/hooks/useFeatureIdentify';

/** 데이터 이력관리에 조회 저장을 위해 추가 */
function useWorkUnitViewLog(kind: string, id: string | null | undefined) {
  useEffect(() => {
    const key = String(id ?? '').trim();
    if (!key) return;
    recordDataViewLog({
      tableName: 'work_unit',
      keyField: 'id',
      keyValue: key,
      serviceName: `항공영상(${kind})`,
    });
  }, [kind, id]);
}

/** 속성정보 인라인 수정 상태 */
function useAttrEdit(unit: WorkUnitItem, onSave?: (attrs: AttrRow[]) => Promise<void>) {
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
  const save = async () => {
    if (onSave) {
      try {
        await onSave(attrs);
      } catch {
        return;
      }
    }
    updateWorkUnitAttrs(unit.kind, unit.id, { attrs });
    setEditing(false);
  };

  return { editing, attrs, changeAttr, start, cancel, save };
}

export type DetailTab = 'info' | 'flight';

const footerBtnClass =
  'rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60';

type DetailHeaderProps = {
  title: string;
  tab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  /** 수정 중에는 탭 전환 숨김 */
  editing?: boolean;
  /** 우측 상단 X 닫기 (촬영요청·도로대장 상세와 동일) */
  onClose?: () => void;
  /** 두 번째 탭 라벨 — 기본 비행기록부, 항공영상은 촬영정보 */
  secondaryTabLabel?: string;
};

export function DetailHeader({
  title,
  tab = 'info',
  onTabChange,
  editing = false,
  onClose,
  secondaryTabLabel = '비행기록부',
}: DetailHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="flex h-11 items-center gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{title}</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {onTabChange && !editing ? (
        <div className="flex gap-1 bg-muted/50 px-2.5 pb-2">
          {(
            [
              { id: 'info' as const, label: '상세정보' },
              { id: 'flight' as const, label: secondaryTabLabel },
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
                    ? 'bg-background font-semibold text-sky-800 dark:text-sky-200 shadow-sm ring-1 ring-sky-200 dark:ring-sky-800'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
  onGeomEdit?: () => void;
};

/** 시설관리 상세와 동일: 하단 수정·삭제·닫기 */
function DetailFooter({
  onClose,
  onDelete,
  editing = false,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onGeomEdit,
}: DetailFooterProps) {
  return (
    <div className="shrink-0 border-t border-border bg-muted/50 px-3 py-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex shrink-0">
          {onGeomEdit && !editing ? (
            <button type="button" onClick={onGeomEdit} className={footerBtnClass}>
              도형수정
            </button>
          ) : null}
        </div>
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
  editableLabels,
  hiddenLabels,
  onChangeAttr,
  linkedRequest,
  onFolderUpload,
  onClearLink,
}: {
  unit: WorkUnitItem;
  fileSection: ReactNode;
  editing?: boolean;
  attrRows?: AttrRow[];
  editableLabels?: string[];
  hiddenLabels?: string[];
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
        <div className="space-y-1.5 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-semibold text-sky-900 dark:text-sky-100">승인 건으로 자료 등록</p>
            {onClearLink ? (
              <button
                type="button"
                className="shrink-0 text-[10px] text-sky-700 dark:text-sky-300 underline"
                onClick={onClearLink}
              >
                연결 해제
              </button>
            ) : null}
          </div>
          <p className="text-[11px] font-medium text-foreground">
            {linkedRequest.purpose || '목적 없음'}
          </p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
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
        editableLabels={editableLabels}
        hiddenLabels={hiddenLabels}
        onChangeValue={onChangeAttr}
      />
      {fileSection}
    </div>
  );
}

function orthoOverlapResults(options: MapHitOverlapOption[]): IdentifyLayerResult[] {
  return [
    {
      tableName: 'ortho_extent',
      korName: '드론영상',
      titleField: 'title',
      features: options.map((opt) => ({
        titleValue: opt.label,
        data: { id: opt.value },
      })),
    },
  ];
}

function orthoOverlapSelectedIndex(options: MapHitOverlapOption[], value: string | undefined): number | null {
  if (!value) return 0;
  const idx = options.findIndex((opt) => opt.value === value);
  return idx >= 0 ? idx : 0;
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
  onAddFiles?: () => void;
  onClearLink?: () => void;
  onDelete?: () => void;
  onSaveAttrs?: (attrs: AttrRow[]) => Promise<void>;
  onDeleteFile?: (file: WorkFileItem) => void;
  /** 겹친 범위 — 상세 안에서 어느 영상인지 고른다 */
  overlapOptions?: MapHitOverlapOption[];
  overlapValue?: string;
  onOverlapChange?: (id: string) => void;
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
  onAddFiles,
  onClearLink,
  onDelete,
  onSaveAttrs,
  onDeleteFile,
  overlapOptions,
  overlapValue,
  onOverlapChange,
}: OrthoDetailProps) {
  useWorkUnitViewLog('ortho', unit.id);
  const edit = useAttrEdit(unit, onSaveAttrs);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
      />
      {overlapOptions && overlapOptions.length > 1 && onOverlapChange ? (
        <div className="flex max-h-[42%] min-h-[140px] shrink-0 flex-col overflow-hidden border-b border-border">
          <IdentifyHitListBlock
            results={orthoOverlapResults(overlapOptions)}
            headerLabel="지도에서 선택된 항목"
            selectedIndex={orthoOverlapSelectedIndex(overlapOptions, overlapValue)}
            onItemClick={(item) => {
              const id = String(item.feature.data.id ?? '');
              if (id) onOverlapChange(id);
            }}
            onClose={onClose}
            showFooterClose={false}
          />
        </div>
      ) : null}
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
          editableLabels={['작업일', '임무/작업 목적', '작성자', '메모']}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle
                action={
                  viewOnly || !onAddFiles ? undefined : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={onAddFiles}
                    >
                      <Plus className="h-3 w-3" />
                      추가
                    </Button>
                  )
                }
              >
                파일 목록
              </SectionTitle>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                변환완료 파일을 클릭하거나 체크하면 지도 타일을 켤 수 있습니다. (자체항공영상이 아닌
                드론영상 오버레이)
              </p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                checkedIds={checkedFileIds}
                onToggleCheck={onToggleFile}
                checkableDoneOnly
                onSelect={onSelectFile}
                onDeleteFile={viewOnly ? undefined : onDeleteFile}
                showLocation
                statusMode="convert"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={showInfoActions && !edit.editing ? onDelete : undefined}
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
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
  onAddFiles?: () => void;
  onClearLink?: () => void;
  onDelete?: () => void;
  onSaveAttrs?: (attrs: AttrRow[]) => Promise<void>;
  onEditFileGeom?: (file: WorkFileItem) => void;
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
  onAddFiles,
  onClearLink,
  onDelete,
  onSaveAttrs,
  onEditFileGeom,
}: DroneDetailProps) {
  useWorkUnitViewLog('drone', unit.id);
  const edit = useAttrEdit(unit, onSaveAttrs);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          editableLabels={['작업단위 명', '작업단위', '임무/작업 목적', '작성자', '촬영자', '메모']}
          hiddenLabels={['연결 신청']}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle
                action={
                  viewOnly || !onAddFiles ? undefined : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={onAddFiles}
                    >
                      <Plus className="h-3 w-3" />
                      추가
                    </Button>
                  )
                }
              >
                파일 목록
              </SectionTitle>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                파일을 클릭하면 지도가 촬영 위치로 이동하고 사진,동영상으로 켜집니다. 위치가 없으면 오른쪽에 위치 추가가 표시됩니다.
              </p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                onSelect={onSelectFile}
                showLocation
                markMissingGeom
                onEditGeom={onEditFileGeom}
                statusMode="upload"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={showInfoActions && !edit.editing ? onDelete : undefined}
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
      />
    </div>
  );
}

type DroneFileProps = {
  file: WorkFileItem;
  /** 같은 작업단위 이미지 — 뷰어 이전/다음 */
  files?: WorkFileItem[];
  onClose: () => void;
  onDelete?: () => void;
  onEditGeom?: (file: WorkFileItem) => void;
};

function aerialMediaUrl(relativePath: string, download = false): string {
  const q = new URLSearchParams({ path: relativePath.replace(/\\/g, '/') });
  if (download) q.set('download', '1');
  return `/api/aerial/media?${q.toString()}`;
}

export function DroneFileDetailPanel({ file, files = [], onClose, onDelete, onEditGeom }: DroneFileProps) {
  useWorkUnitViewLog('drone-file', file.id);
  const isVideo = file.previewKind === 'video';
  const mediaSrc = file.relativePath ? aerialMediaUrl(file.relativePath) : null;
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    setViewerOpen(false);
  }, [file.id]);

  const galleryItems = (files.length > 0 ? files : [file])
    .filter((f) => f.previewKind === 'image' && f.relativePath)
    .map((f) => ({
      url: aerialMediaUrl(f.relativePath!),
      fileName: f.name,
      kind: 'image' as const,
    }));

  const viewerInitialIndex = Math.max(
    0,
    galleryItems.findIndex((i) => i.fileName === file.name)
  );

  const handleDownload = () => {
    if (!file.relativePath) {
      window.alert('다운로드 경로가 없습니다.');
      return;
    }
    const a = document.createElement('a');
    a.href = aerialMediaUrl(file.relativePath, true);
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openViewer = () => {
    if (!isVideo && galleryItems.length > 0) setViewerOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <DetailHeader title="파일 상세" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <p className="truncate text-[12px] font-semibold text-foreground">{file.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
              {file.format.toUpperCase()}
            </span>
            <span className="rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
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
            { label: '촬영 위치', value: fileMissingGeom(file) ? '위치 없음' : (file.locationLabel ?? '—') },
          ]}
        />
        {fileMissingGeom(file) ? (
          <p className="text-[11px] font-medium text-rose-600">위치가 없습니다. 아래 도형수정으로 추가하세요.</p>
        ) : null}

        <section>
          <SectionTitle
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={!file.relativePath}
                onClick={handleDownload}
              >
                <Download className="h-3 w-3" />
                다운로드
              </Button>
            }
          >
            미리보기
          </SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-slate-900 shadow-sm">
            {mediaSrc && !isVideo ? (
              <button
                type="button"
                className="group relative block w-full cursor-zoom-in bg-slate-950 text-left"
                onClick={openViewer}
                title="클릭하여 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키 포함 미디어 미리보기 */}
                <img
                  src={mediaSrc}
                  alt={file.name}
                  className="mx-auto max-h-[min(56vh,420px)] w-full object-contain"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-2 text-center text-[10px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                  클릭하여 크게 보기
                </span>
              </button>
            ) : mediaSrc && isVideo ? (
              <video
                key={mediaSrc}
                src={mediaSrc}
                controls
                playsInline
                preload="metadata"
                className="mx-auto max-h-[min(56vh,420px)] w-full bg-black"
              >
                이 브라우저는 동영상 재생을 지원하지 않습니다.
              </video>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-950 px-4 text-center text-slate-300">
                {isVideo ? (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                    <Play className="h-5 w-5 fill-current" />
                  </div>
                ) : (
                  <div className="h-24 w-36 rounded border border-dashed border-slate-500/60 bg-slate-800/80" />
                )}
                <span className="max-w-[90%] truncate text-[11px]">{file.name}</span>
                <span className="text-[10px] text-slate-400">미리보기 경로가 없습니다</span>
              </div>
            )}
          </div>
        </section>
      </div>
      <DetailFooter
        onClose={onClose}
        onDelete={onDelete}
        onGeomEdit={onEditGeom ? () => onEditGeom(file) : undefined}
      />

      {viewerOpen && galleryItems.length > 0 ? (
        <ServiceFileImagePreview
          items={galleryItems}
          initialIndex={viewerInitialIndex}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
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
  onAddFiles?: () => void;
  onClearLink?: () => void;
  onDelete?: () => void;
  onSaveAttrs?: (attrs: AttrRow[]) => Promise<void>;
  onDeleteFile?: (file: WorkFileItem) => void;
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
  onAddFiles,
  onClearLink,
  onDelete,
  onSaveAttrs,
  onDeleteFile,
}: PanoDetailProps) {
  useWorkUnitViewLog('panorama', unit.id);
  const edit = useAttrEdit(unit, onSaveAttrs);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          editableLabels={['작업단위 명', '작업단위', '임무/작업 목적', '작성자', '촬영자', '메모']}
          hiddenLabels={['연결 신청']}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <section>
              <SectionTitle
                action={
                  viewOnly || !onAddFiles ? undefined : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={onAddFiles}
                    >
                      <Plus className="h-3 w-3" />
                      추가
                    </Button>
                  )
                }
              >
                파일 목록
              </SectionTitle>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                파일을 선택하면 360 미리보기가 열립니다. GPS가 있으면 지도가 이동합니다.
              </p>
              <FileRows
                files={unit.files}
                selectedId={selectedFileId}
                onSelect={onSelectFile}
                onDeleteFile={viewOnly ? undefined : onDeleteFile}
                showLocation
                statusMode="upload"
              />
            </section>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={showInfoActions && !edit.editing ? onDelete : undefined}
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
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
  onDelete?: () => void;
  onSaveAttrs?: (attrs: AttrRow[]) => Promise<void>;
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
  onDelete,
  onSaveAttrs,
}: SatDetailProps) {
  useWorkUnitViewLog('satellite', unit.id);
  const edit = useAttrEdit(unit, onSaveAttrs);
  const workLabel =
    unit.attrs.find(
      (r) =>
        r.label === '작업단위' || r.label === '작업단위 명' || r.label === '작업단위 파일명'
    )?.value ?? unit.workName;
  const showInfoActions = !viewOnly && detailTab === 'info';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DetailHeader
        title="작업단위 상세"
        tab={detailTab}
        onTabChange={viewOnly ? undefined : onDetailTabChange}
        editing={edit.editing}
        onClose={onClose}
        secondaryTabLabel="촬영정보"
      />
      {!viewOnly && detailTab === 'flight' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlightLogbookForm
            workUnitLabel={workLabel}
            title="촬영정보"
            infoSectionLabel="촬영 정보"
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
          editableLabels={['작업일', '임무/작업 목적', '작성자', '메모']}
          hiddenLabels={['연결 신청']}
          onChangeAttr={edit.changeAttr}
          linkedRequest={viewOnly ? null : linkedRequest}
          onFolderUpload={viewOnly ? undefined : onFolderUpload}
          onClearLink={viewOnly ? undefined : onClearLink}
          fileSection={
            <p className="rounded-md border border-border bg-muted/50 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              영상 표시·on/off는 배경지도 «자체항공영상»에서 합니다.
            </p>
          }
        />
      )}
      <DetailFooter
        onClose={onClose}
        onDelete={showInfoActions && !edit.editing ? onDelete : undefined}
        editing={showInfoActions ? edit.editing : false}
        onStartEdit={showInfoActions ? edit.start : undefined}
        onSaveEdit={edit.save}
        onCancelEdit={edit.cancel}
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
  markMissingGeom,
  onEditGeom,
  statusMode = 'upload',
  onDeleteFile,
}: {
  files: WorkFileItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  checkedIds?: Set<string>;
  onToggleCheck?: (id: string) => void;
  checkableDoneOnly?: boolean;
  showLocation?: boolean;
  markMissingGeom?: boolean;
  onEditGeom?: (file: WorkFileItem) => void;
  onDeleteFile?: (file: WorkFileItem) => void;
  /** ortho=변환중·변환완료, drone/pano=업로드완료 */
  statusMode?: 'convert' | 'upload';
}) {
  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-[11px] text-muted-foreground">
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
                'flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                selected
                  ? 'border-sky-300 bg-sky-50 shadow-sm ring-1 ring-sky-200 dark:border-sky-800 dark:bg-sky-950/40 dark:ring-sky-800/70'
                  : checked
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/30'
                    : 'border-border bg-background hover:border-border hover:bg-muted/60'
              )}
            >
              {onToggleCheck ? (
                <label className="flex h-7 w-4 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 rounded border-border accent-sky-600"
                    checked={checked}
                    disabled={!canCheck}
                    onChange={() => onToggleCheck(f.id)}
                    onClick={(e) => e.stopPropagation()}
                    title={canCheck ? '지도 타일 표시' : '변환 완료 후 선택 가능'}
                  />
                </label>
              ) : null}

              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  selected ? 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300' : 'bg-muted text-muted-foreground'
                )}
                aria-hidden
              >
                <FileIcon className="h-3.5 w-3.5" />
              </span>

              <button
                type="button"
                className="min-w-0 flex-1 py-0.5 text-left"
                onClick={() => {
                  onSelect(f.id);
                  // 드론영상 등: 행 클릭만으로도 체크(지도 타일)가 켜지도록
                  if (onToggleCheck && canCheck) onToggleCheck(f.id);
                }}
              >
                <p
                  className={cn(
                    'truncate text-[11px] font-medium leading-4',
                    selected ? 'text-sky-950 dark:text-sky-100' : 'text-foreground'
                  )}
                  title={f.name}
                >
                  {f.name}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-3 text-muted-foreground">
                  <span>{f.format.toUpperCase()}</span>
                  <span>{f.sizeLabel}</span>
                  {showLocation && f.locationLabel ? (
                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      {f.locationLabel}
                    </span>
                  ) : null}
                </div>
              </button>

              <div className="flex shrink-0 items-center gap-1">
                {markMissingGeom && fileMissingGeom(f) ? (
                  <MissingGeomMark onClick={onEditGeom ? () => onEditGeom(f) : undefined} />
                ) : null}
                <StatusBadge status={f.status} mode={statusMode} />
                {onDeleteFile ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-300"
                    onClick={() => onDeleteFile(f)}
                    title="파일 삭제"
                    aria-label={`${f.name} 삭제`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
