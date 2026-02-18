'use client';

import React, { useState } from 'react';
import {
  X,
  Pentagon,
  FileText,
  FileImage,
  History,
  Paperclip,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from './MapContext';
import { getRowValueByField } from './defineLayerRowUtils';
import { MapFloatingPanel } from './MapFloatingPanel';

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

interface AttachmentItem {
  id: number;
  name: string;
  type: 'image' | 'document';
  size: string;
  date: string;
}

const SAMPLE_ATTACHMENTS: AttachmentItem[] = [
  { id: 1, name: '관로_현황사진_001.jpg', type: 'image', size: '2.4 MB', date: '2025-12-15' },
  { id: 2, name: '관로_현황사진_002.jpg', type: 'image', size: '1.8 MB', date: '2025-12-15' },
  { id: 3, name: '점검보고서_202512.pdf', type: 'document', size: '540 KB', date: '2025-12-15' },
  { id: 4, name: '준공도면_1구간.pdf', type: 'document', size: '12.3 MB', date: '2024-03-10' },
];

// 기본정보/상세정보용 접이식 섹션 (참고: StandardDetail_01 info-section)
interface InfoField {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
}

function InfoSection({
  title,
  fields,
  defaultOpen = true,
}: {
  title: string;
  fields: InfoField[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-primary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500" />
        )}
        <span className="text-[13px] font-semibold text-slate-900">{title}</span>
      </button>
      {isOpen && (
        <div className="px-4 pb-3">
          <div className="overflow-hidden rounded border border-slate-200">
            {fields.map((field, index) => (
              <div
                key={field.label}
                className={cn(
                  'flex',
                  index !== fields.length - 1 && 'border-b border-slate-200'
                )}
              >
                <div className="flex w-[120px] shrink-0 items-center bg-slate-100 px-3 py-2">
                  <span className="text-xs text-slate-500">{field.label}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center px-3 py-2">
                  <span
                    className={cn(
                      'text-xs',
                      field.highlight ? 'font-medium text-primary' : 'text-slate-900'
                    )}
                  >
                    {field.value}
                    {field.unit != null && field.unit !== '' && (
                      <span className="ml-0.5 text-slate-500">{field.unit}</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StandardDetail() {
  const mapContext = useMapContext();
  const selectedDetail = mapContext?.selectedDetail ?? null;
  const setSelectedDetail = mapContext?.setSelectedDetail;

  const [activeTab, setActiveTab] = useState<DetailTab>('basic');

  if (selectedDetail === null || !setSelectedDetail) return null;

  const { layerName, row, fields } = selectedDetail;
  const handleClose = () => setSelectedDetail(null);

  const tabs: { id: DetailTab; label: string; icon: typeof FileText }[] = [
    { id: 'basic', label: '기본정보', icon: FileText },
    { id: 'history', label: '이력관리', icon: History },
    { id: 'attach', label: '첨부파일', icon: Paperclip },
  ];

  return (
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
        {tabs.map(({ id, label, icon: Icon }) => (
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
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'basic' && (
          <div>
            {fields.length === 0 ? (
              <div className="px-4 py-8 text-xs text-slate-500 text-center">표시할 항목 없음</div>
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
                      const value = raw != null ? String(raw) : '-';
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
                        const value = raw != null ? String(raw) : '-';
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
                  const Icon = config.icon;
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
                        <Icon className={cn('h-4 w-4', config.color)} />
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
            {SAMPLE_ATTACHMENTS.length === 0 ? (
              <div className="py-8 text-xs text-slate-500 text-center">첨부파일 없음</div>
            ) : (
              <div className="space-y-2">
                {SAMPLE_ATTACHMENTS.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 rounded border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50"
                  >
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded',
                        file.type === 'image' ? 'bg-sky-100' : 'bg-amber-100'
                      )}
                    >
                      {file.type === 'image' ? (
                        <FileImage className="h-4 w-4 text-sky-600" />
                      ) : (
                        <FileText className="h-4 w-4 text-amber-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-900">{file.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {file.size} | {file.date}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="h-7 w-7 shrink-0 rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      title="다운로드"
                    >
                      <Download className="h-3.5 w-3.5 mx-auto" />
                      <span className="sr-only">다운로드</span>
                    </button>
                  </div>
                ))}
              </div>
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
              첨부파일 {SAMPLE_ATTACHMENTS.length}건
            </span>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            >
              파일 추가
            </button>
          </div>
        )}
      </div>
    </MapFloatingPanel>
  );
}
