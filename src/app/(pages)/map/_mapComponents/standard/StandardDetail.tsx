'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Pentagon,
  FileText,
  History,
  Paperclip,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Download,
  Upload,
} from 'lucide-react';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import { formatDetailScalarValue } from '@/lib/formatDetailScalar';
import { cn, formatFileSize } from '@/lib/utils';
import { useMapContext } from '../MapContext';
import { getRowKey, getRowValueByField } from './defineLayerRowUtils';
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from './useServiceFileData';
import { MapFloatingPanel } from '../MapFloatingPanel';
import { InfoSection } from './DetailInfoSection';
import { ServiceFileAttachmentThumb } from './ServiceFileAttachmentThumb';
import { ServiceFilePdfThumb } from './ServiceFilePdfThumb';
import { ServiceFileImagePreview, type ServiceFilePreviewItem } from './ServiceFileImagePreview';

type DetailTab = 'basic' | 'history' | 'attach';

type HistoryEventType = '점검' | '보수' | '이상발생' | '준공';

interface TimelineEvent {
  id: number;
  date: string;
  type: HistoryEventType;
  title: string;
  description: string;
  author: string;
}

const HISTORY_TYPE_CONFIG: Record<
  HistoryEventType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  점검: { icon: FileText, color: 'text-sky-600', bg: 'bg-sky-100' },
  보수: { icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-100' },
  이상발생: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bg: 'bg-red-100',
  },
  준공: {
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bg: 'bg-emerald-100',
  },
};

const SAMPLE_HISTORY: TimelineEvent[] = [
  {
    id: 1,
    date: '2025-12-15',
    type: '점검',
    title: '정기 점검 완료',
    description: '외관 상태 양호, 누수 징후 없음',
    author: '김상수',
  },
  {
    id: 2,
    date: '2025-09-03',
    type: '보수',
    title: '밸브 교체 작업',
    description: '노후 밸브 2개소 교체 완료',
    author: '박정비',
  },
  {
    id: 3,
    date: '2025-06-20',
    type: '이상발생',
    title: '미세 누수 발견',
    description: '연결부 미세 누수 확인, 긴급 보수 필요',
    author: '이점검',
  },
  {
    id: 4,
    date: '2024-03-10',
    type: '준공',
    title: '시설물 설치 준공',
    description: '안동 광역상수도 1구간 관로 설치 완료',
    author: '최공사',
  },
];

export default function StandardDetail() {
  const mapContext = useMapContext();
  const selectedDetail = mapContext?.selectedDetail ?? null;
  const setSelectedDetail = mapContext?.setSelectedDetail;

  const [activeTab, setActiveTab] = useState<DetailTab>('basic');
  const attachUploadInputRef = useRef<HTMLInputElement>(null);
  const [attachListRefreshNonce, setAttachListRefreshNonce] = useState(0);
  const [attachmentImagePreview, setAttachmentImagePreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);

  if (selectedDetail === null || !setSelectedDetail) return null;

  const { layerName, tableName, row, fields } = selectedDetail;
  const handleClose = () => setSelectedDetail(null);

  const keyFieldName = useMemo(() => {
    const keyField = fields.find((f) => String(f.define_field_is_key ?? '').toLowerCase() === 'true');
    return keyField ? String(keyField.define_field_name ?? '').trim() || null : null;
  }, [fields]);

  const rowKeyForAttachments = getRowKey(row, keyFieldName);
  const layerSegmentForFiles = String(tableName ?? '').trim().toLowerCase() || null;
  const attachmentQuery = useServiceFileData({
    serEng: SER_FILE_ENG.dataQuery,
    enabled: activeTab === 'attach',
    layerSegment: layerSegmentForFiles,
    keyValue: rowKeyForAttachments,
    refreshNonce: attachListRefreshNonce,
  });
  const attachmentPreviewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (layerSegmentForFiles == null || rowKeyForAttachments == null) return [];
    return attachmentQuery.files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(
          SER_FILE_ENG.dataQuery,
          layerSegmentForFiles,
          rowKeyForAttachments,
          f.name
        ),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ('pdf' as const) : ('image' as const),
      }));
  }, [attachmentQuery.files, layerSegmentForFiles, rowKeyForAttachments]);
  const attachChunkUpload = useServiceFileChunkedUpload();

  const tabs: { id: DetailTab; label: string; icon: typeof FileText }[] = [
    { id: 'basic', label: '기본정보', icon: FileText },
    { id: 'history', label: '이력관리', icon: History },
    { id: 'attach', label: '첨부파일', icon: Paperclip },
  ];

  return (
    <>
    <MapFloatingPanel
      width="380px"
      maxHeight="80vh"
      header={
        <>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[13px] font-medium text-primary shrink-0">
              <Pentagon className="h-4 w-4" aria-hidden />
              {layerName}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-slate-200 shrink-0">
        {tabs.map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors',
              activeTab === id
                ? 'border-b-2 border-primary text-primary bg-primary/5'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            )}
          >
            <TabIcon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'basic' && (
          <div>
            {fields.length === 0 ? (
              <InfoSection
                title="기본정보"
                fields={Object.entries((row ?? {}) as Record<string, unknown>)
                  .filter(([k]) => { const n = k.toLowerCase(); return n !== 'gid' && n !== 'geom'; })
                  .map(([k, v], i) => ({
                    label: k,
                    value: v != null ? String(v) : '-',
                    highlight: i === 0,
                  }))}
                defaultOpen={true}
              />
            ) : (
              <>
                <InfoSection
                  title="기본정보"
                  fields={(() => {
                    const mid = Math.ceil(fields.length / 2);
                    const slice = fields.slice(0, mid);
                    return slice.map((f, i) => {
                      const key = String(f.define_field_name ?? '');
                      const label = String(f.define_field_kor_name ?? f.define_field_name ?? '');
                      const raw = getRowValueByField(row, key);
                      const value = formatDetailScalarValue(raw);
                      return { label, value, highlight: i === 0 };
                    });
                  })()}
                  defaultOpen={true}
                />
                {fields.length > 1 && (
                  <InfoSection
                    title="상세정보"
                    fields={(() => {
                      const mid = Math.ceil(fields.length / 2);
                      return fields.slice(mid).map((f) => {
                        const key = String(f.define_field_name ?? '');
                        const label = String(f.define_field_kor_name ?? f.define_field_name ?? '');
                        const raw = getRowValueByField(row, key);
                        const value = formatDetailScalarValue(raw);
                        return { label, value };
                      });
                    })()}
                    defaultOpen={true}
                  />
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="px-4 py-3">
            {SAMPLE_HISTORY.length === 0 ? (
              <div className="py-4 text-xs text-slate-500 text-center">이력 없음</div>
            ) : (
              <div className="relative space-y-0">
                {SAMPLE_HISTORY.map((event, index) => {
                  const config = HISTORY_TYPE_CONFIG[event.type];
                  const EventIcon = config.icon;
                  return (
                    <div key={event.id} className="relative flex gap-3 pb-5">
                      {index < SAMPLE_HISTORY.length - 1 && (
                        <div
                          className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-slate-200"
                          aria-hidden
                        />
                      )}
                      <div
                        className={cn(
                          'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          config.bg
                        )}
                      >
                        <EventIcon className={cn('h-4 w-4', config.color)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-[11px] font-medium rounded px-1.5 py-0.5',
                              config.color,
                              config.bg
                            )}
                          >
                            {event.type}
                          </span>
                          <span className="text-[11px] text-slate-500">{event.date}</span>
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-900">{event.title}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                          {event.description}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">담당: {event.author}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'attach' && (
          <div className="px-4 py-3">
            <input
              ref={attachUploadInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || !layerSegmentForFiles || rowKeyForAttachments == null) return;
                void attachChunkUpload
                  .upload({
                    file,
                    serEng: SER_FILE_ENG.dataQuery,
                    layerSegment: layerSegmentForFiles,
                    keyValue: rowKeyForAttachments,
                  })
                  .then((res) => {
                    if (res && 'error' in res && res.error) return;
                    setAttachListRefreshNonce((n) => n + 1);
                    attachChunkUpload.reset();
                  });
              }}
            />
            {keyFieldName == null || rowKeyForAttachments == null || layerSegmentForFiles == null ? (
              <div className="py-8 text-xs text-slate-500 text-center leading-relaxed px-1">
                레이어 데이터 설정에서 키 필드(define_field_is_key)가 지정되어 있어야 첨부폴더를 조회할 수 있습니다.
              </div>
            ) : (
              <>
                {attachChunkUpload.state.status === 'uploading' && (
                  <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="mb-1 flex justify-between text-[11px] text-slate-600">
                      <span className="flex items-center gap-1">
                        <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        업로드 중…
                      </span>
                      <span>{attachChunkUpload.state.progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-primary transition-[width] duration-150"
                        style={{ width: `${attachChunkUpload.state.progress}%` }}
                      />
                    </div>
                  </div>
                )}
                {attachChunkUpload.state.status === 'error' && attachChunkUpload.state.error && (
                  <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    {attachChunkUpload.state.error}
                  </div>
                )}
                {attachmentQuery.loading ? (
                  <div className="py-8 text-xs text-slate-500 text-center">불러오는 중…</div>
                ) : attachmentQuery.error ? (
                  <div className="py-8 text-xs text-red-600 text-center">{attachmentQuery.error}</div>
                ) : attachmentQuery.files.length === 0 ? (
                  <div className="py-8 text-xs text-slate-500 text-center">첨부파일 없음</div>
                ) : (
              <div className="space-y-2">
                {attachmentQuery.files.map((file) => {
                  const isImg = isImageServiceFileName(file.name);
                  const isPdf = isPdfServiceFileName(file.name);
                  const dateStr =
                    file.modified != null
                      ? (() => {
                          const d = new Date(file.modified);
                          return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ko-KR');
                        })()
                      : '—';
                  const downloadUrl = serviceFileDataDownloadUrl(
                    SER_FILE_ENG.dataQuery,
                    layerSegmentForFiles!,
                    rowKeyForAttachments,
                    file.name
                  );
                  const activateRow = () => {
                    if (isImg || isPdf) {
                      const idx = attachmentPreviewGalleryItems.findIndex((i) => i.fileName === file.name);
                      setAttachmentImagePreview({
                        items: attachmentPreviewGalleryItems,
                        initialIndex: idx >= 0 ? idx : 0,
                      });
                    } else {
                      triggerServiceFileDownload(downloadUrl, file.name);
                    }
                  };
                  return (
                    <div
                      key={file.name}
                      tabIndex={0}
                      role="group"
                      aria-label={
                        isImg || isPdf ? `${file.name} 크게 보기` : `${file.name} 다운로드`
                      }
                      className="flex cursor-pointer items-center gap-3 rounded border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      onClick={activateRow}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          activateRow();
                        }
                      }}
                    >
                      {isImg ? (
                        <ServiceFileAttachmentThumb
                          serEng={SER_FILE_ENG.dataQuery}
                          layerSegment={layerSegmentForFiles!}
                          keyValue={rowKeyForAttachments}
                          fileName={file.name}
                          size="md"
                        />
                      ) : isPdf ? (
                        <ServiceFilePdfThumb
                          serEng={SER_FILE_ENG.dataQuery}
                          layerSegment={layerSegmentForFiles!}
                          keyValue={rowKeyForAttachments}
                          fileName={file.name}
                          size="md"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-amber-100">
                          <FileText className="h-4 w-4 text-amber-600" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-900">{file.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {formatFileSize(file.size)} | {dateStr}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerServiceFileDownload(downloadUrl, file.name);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                          title="다운로드"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span className="sr-only">다운로드</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              !window.confirm(
                                `「${file.name}」을(를) 삭제할까요?\n삭제 후 목록에는 표시되지 않으며, 서버에는 .tmp 확장자가 붙은 이름으로 남습니다.`
                              )
                            ) {
                              return;
                            }
                            void requestServiceFileDataDelete({
                              serEng: SER_FILE_ENG.dataQuery,
                              layerSegment: layerSegmentForFiles!,
                              keyValue: rowKeyForAttachments,
                              fileName: file.name,
                            }).then((r) => {
                              if (r.ok) setAttachListRefreshNonce((n) => n + 1);
                              else window.alert(r.error);
                            });
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-100 hover:text-red-700"
                          title="삭제"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span className="sr-only">삭제</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 탭별 푸터 */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
        {activeTab === 'basic' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">기본정보</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
              >
                수정
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
              >
                지도보기
              </button>
            </div>
          </div>
        )}
        {activeTab === 'history' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              이력 {SAMPLE_HISTORY.length}건
            </span>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            >
              이력 추가
            </button>
          </div>
        )}
        {activeTab === 'attach' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              첨부파일{' '}
              {keyFieldName != null && rowKeyForAttachments != null
                ? `${attachmentQuery.files.length}건`
                : '—'}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={
                  keyFieldName == null ||
                  rowKeyForAttachments == null ||
                  layerSegmentForFiles == null ||
                  attachChunkUpload.state.status === 'uploading'
                }
                onClick={() => {
                  attachChunkUpload.reset();
                  attachUploadInputRef.current?.click();
                }}
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                파일 추가
              </button>
              {keyFieldName != null &&
              rowKeyForAttachments != null &&
              layerSegmentForFiles != null &&
              attachmentQuery.files.length > 0 ? (
                <a
                  href={serviceFileDataZipDownloadUrl(
                    SER_FILE_ENG.dataQuery,
                    layerSegmentForFiles,
                    rowKeyForAttachments,
                    { layerDisplayName: layerName }
                  )}
                  download
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
                >
                  전체 다운로드
                </a>
              ) : (
                <span className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed">
                  전체 다운로드
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </MapFloatingPanel>
    {attachmentImagePreview != null && (
      <ServiceFileImagePreview
        items={attachmentImagePreview.items}
        initialIndex={attachmentImagePreview.initialIndex}
        onClose={() => setAttachmentImagePreview(null)}
      />
    )}
    </>
  );
}
