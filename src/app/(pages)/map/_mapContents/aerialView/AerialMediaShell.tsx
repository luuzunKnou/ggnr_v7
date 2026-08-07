'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';
import type { AerialKind } from './aerialMediaTypes';
import { AERIAL_KIND_LABEL } from './aerialMediaTypes';
import { MapPlaceholder } from './AerialMediaUi';
import { WorkUnitListPanel } from './WorkUnitListPanel';
import {
  DroneFileDetailPanel,
  DroneWorkUnitDetailPanel,
  OrthoWorkUnitDetailPanel,
  PanoramaWorkUnitDetailPanel,
  SatelliteWorkUnitDetailPanel,
  type DetailTab,
} from './WorkUnitDetailPanels';
import { FolderBatchUploadDialog } from './FolderBatchUploadDialog';
import { useAerialMediaMapFocus } from './useAerialMediaMapFocus';
import {
  clearActiveRegistrationRequest,
  findShootingRequest,
  getShootingRequests,
  subscribeShootingRequests,
} from '../shootingRequest/shootingRequestMockStore';
import {
  getUploadCompleteNotice,
  getUploadProgressUiVersion,
  getUploadingJobsForKind,
  resumeUploadingTimersFromStorage,
  subscribeUploadProgress,
} from './aerialUploadProgressStore';
import { UploadProgressBanner } from './UploadProgressBanner';
import { UploadCompleteDialog } from './UploadCompleteDialog';

const KIND_ORDER_ALL: AerialKind[] = ['ortho', 'drone', 'panorama', 'satellite'];
/** 조회전용: 드론영상·파노라마·사진동영상·항공 (관리 버튼·비행기록부 숨김) */
const KIND_ORDER_VIEW: AerialKind[] = ['ortho', 'panorama', 'drone', 'satellite'];

const rem = (n: number) => Math.round(n * 16);

type Props = {
  initialKind?: AerialKind;
  hideKindNav?: boolean;
  /** true면 오른쪽 지도 자리표시 생략 — 실제 지도가 뒤에 보임 */
  useRealMap?: boolean;
  /** 조회전용: 업로드·변환·비행기록부 등 관리 기능 숨김 (항공 탭은 포함) */
  viewOnly?: boolean;
  onClose?: () => void;
  /** 목록만/상세 열림에 맞춰 바깥 패널 폭 동기화 */
  onContentWidthChange?: (widthPx: number) => void;
};

export function AerialMediaShell({
  initialKind = 'ortho',
  hideKindNav = false,
  useRealMap = false,
  viewOnly = false,
  onClose,
  onContentWidthChange,
}: Props) {
  const kindOrder = viewOnly ? KIND_ORDER_VIEW : KIND_ORDER_ALL;
  const [kind, setKind] = useState<AerialKind>(initialKind);
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [checkedOrthoIds, setCheckedOrthoIds] = useState<Set<string>>(new Set());
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [uploadOpen, setUploadOpen] = useState(false);
  /** 상세 «이 건으로 폴더 업로드»로 연 경우에만 설정 — 목록 일반 업로드는 null */
  const [uploadLinkRequestId, setUploadLinkRequestId] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);

  /** 업로드·변환 목업이 목록 배열을 바꿀 때 리렌더 */
  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  /** 사이드바 종류 메뉴 전환 시 패널을 다시 만들지 않고 종류만 맞춤 (업로드 진행 유지) */
  useEffect(() => {
    setKind(initialKind);
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setCheckedOrthoIds(new Set());
    setDetailTab('info');
    setKeyword('');
    setDateFrom('');
    setDateTo('');
    setUploadOpen(false);
    setUploadLinkRequestId(null);
  }, [initialKind]);

  useSyncExternalStore(subscribeShootingRequests, getShootingRequests, getShootingRequests);
  useSyncExternalStore(subscribeUploadProgress, getUploadProgressUiVersion, getUploadProgressUiVersion);
  const uploadCompleteNotice = !viewOnly ? getUploadCompleteNotice() : null;
  const uploadingJobs = !viewOnly ? getUploadingJobsForKind(kind) : [];
  /** 일반 폴더 업로드가 아니라 «이 건으로»로 연 승인 건만 다이얼로그에 표시 */
  const dialogLinkedRequest =
    !viewOnly && uploadLinkRequestId != null ? findShootingRequest(uploadLinkRequestId) : null;

  useEffect(() => {
    if (viewOnly) return;
    resumeUploadingTimersFromStorage();
  }, [viewOnly]);

  const units = useMemo(() => {
    void listTick;
    return mockUnitsForKind(kind);
  }, [kind, listTick]);

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const selectedFile = selectedUnit?.files.find((f) => f.id === selectedFileId) ?? null;
  /** 선택한 작업단위에 붙은 승인 건 — 상세에서 폴더 업로드 */
  const detailLinkedRequest =
    !viewOnly && selectedUnit?.linkedRequestId
      ? findShootingRequest(selectedUnit.linkedRequestId)
      : null;

  useAerialMediaMapFocus({
    /** 항공영상은 geom 없음 · 단순 목록 조회만 — 지도 이동·마커 없음 */
    enabled: useRealMap && kind !== 'satellite',
    unit: selectedUnit,
    selectedFileId,
  });

  const switchKind = (next: AerialKind) => {
    setKind(next);
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setCheckedOrthoIds(new Set());
    setDetailTab('info');
    setKeyword('');
    setDateFrom('');
    setDateTo('');
  };

  const handleSelectUnit = (id: string) => {
    setSelectedUnitId(id);
    setSelectedFileId(null);
    setDetailTab('info');
  };

  const openLinkedFolderUpload = (requestId: string | undefined) => {
    setUploadLinkRequestId(requestId ?? null);
    setUploadOpen(true);
  };

  const openFreeFolderUpload = () => {
    setUploadLinkRequestId(null);
    clearActiveRegistrationRequest();
    setUploadOpen(true);
  };

  const closeUnitDetail = () => {
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setDetailTab('info');
  };

  const toggleOrthoFile = (fileId: string) => {
    setCheckedOrthoIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const showUnitDetail = selectedUnit != null;
  const showDroneFile = kind === 'drone' && selectedUnit != null && selectedFile != null;
  const showPanoViewer = kind === 'panorama' && selectedFile != null;
  /** 지도 임베드 시 파노라마 뷰어는 지도 영역 전체를 덮는 오버레이로 표시 */
  const showPanoOverlay = useRealMap && showPanoViewer && selectedFile != null;

  const listWidth = 'w-[22rem]';
  /** 상세정보·비행기록부 공통 — 촬영신청서 상세(520)와 동일, 목록 폭은 유지 */
  const detailWidth = 'w-[32.5rem]';
  /** 드론 파일상세는 지도가 조금 줄더라도 넉넉히 */
  const fileWidth = showDroneFile ? 'w-[22rem]' : 'w-[17rem]';

  useEffect(() => {
    if (!onContentWidthChange) return;
    let w = hideKindNav ? 0 : rem(7.5);
    w += rem(22);
    if (showUnitDetail) {
      w += rem(32.5);
    }
    if (showDroneFile) {
      w += rem(22);
    }
    onContentWidthChange(w + 4);
  }, [onContentWidthChange, hideKindNav, showUnitDetail, showDroneFile]);

  /** 파노라마 오버레이: 셸(패널 묶음) 오른쪽 끝부터 화면 우측 끝까지 지도 위를 덮음 */
  const shellRef = useRef<HTMLDivElement>(null);
  const [panoRect, setPanoRect] = useState<{ top: number; left: number; height: number } | null>(
    null
  );

  useEffect(() => {
    if (!showPanoOverlay) {
      setPanoRect(null);
      return;
    }
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPanoRect({ top: r.top, left: r.right, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [showPanoOverlay, showUnitDetail, detailTab]);

  const kindShort: Record<AerialKind, string> = viewOnly
    ? {
        ortho: '드론영상',
        drone: '사진,동영상',
        panorama: '파노라마',
        satellite: '항공영상',
      }
    : {
        ortho: '드론영상',
        drone: '사진,동영상',
        panorama: '파노라마',
        satellite: '항공영상',
      };

  const listTitle = hideKindNav
    ? kindShort[kind]
    : viewOnly
      ? kindShort[kind]
      : AERIAL_KIND_LABEL[kind];

  return (
    <div
      ref={shellRef}
      className={cn(
        'flex h-full min-h-0 overflow-hidden bg-white',
        !useRealMap && 'rounded-md border border-slate-200 shadow-sm'
      )}
    >
      {!hideKindNav ? (
        <nav className="flex w-[7.5rem] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-b border-slate-200 px-2.5">
            <span className="text-[10px] font-semibold tracking-wide text-slate-500">
              {viewOnly ? '영상조회' : '영상관리'}
            </span>
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
          <ul className="flex-1 space-y-0.5 p-1.5">
            {kindOrder.map((k) => {
              const active = k === kind;
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => switchKind(k)}
                    className={cn(
                      'w-full rounded-md px-2.5 py-2.5 text-left text-[11px] leading-snug transition-colors',
                      active
                        ? 'bg-white font-semibold text-sky-800 shadow-sm ring-1 ring-sky-200'
                        : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                    )}
                  >
                    {kindShort[k]}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-200 px-2.5 py-2 text-[9px] leading-relaxed text-slate-400">
            {viewOnly ? '조회 전용' : '관리 · 목업'}
          </div>
        </nav>
      ) : null}

      <div className={cn('flex shrink-0 flex-col border-r border-slate-200', listWidth)}>
        <WorkUnitListPanel
          title={listTitle}
          items={units}
          selectedId={selectedUnitId}
          onSelect={handleSelectUnit}
          keyword={keyword}
          onKeywordChange={setKeyword}
          onRefresh={() => setListTick((t) => t + 1)}
          onUpload={viewOnly ? undefined : openFreeFolderUpload}
          onClose={hideKindNav ? onClose : undefined}
          showStatus={kind === 'satellite'}
          showConvertStatus={kind === 'ortho'}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          emptyHint={viewOnly ? '검색어를 바꿔 보세요.' : undefined}
          banner={
            <div className="space-y-2">
              {uploadingJobs.length > 0 ? <UploadProgressBanner jobs={uploadingJobs} /> : null}
              {kind === 'satellite' ? (
                <p className="rounded-md border border-amber-200/80 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900">
                  {viewOnly
                    ? '지도 표시는 배경지도 «자체항공영상»에서 on/off 합니다.'
                    : '변환 완료 시 배경지도 «자체항공영상»에 등록됩니다. on/off는 배경지도에서 합니다.'}
                </p>
              ) : null}
              {uploadingJobs.length === 0 &&
              useRealMap &&
              kind === 'ortho' &&
              checkedOrthoIds.size > 0 ? (
                <p className="rounded-md border border-emerald-200/80 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-800">
                  지도 타일 {checkedOrthoIds.size}개 선택 (목업)
                </p>
              ) : null}
            </div>
          }
        />
      </div>

      {showUnitDetail && selectedUnit && kind === 'ortho' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-slate-200', detailWidth)}>
          <OrthoWorkUnitDetailPanel
            unit={selectedUnit}
            checkedFileIds={checkedOrthoIds}
            onToggleFile={toggleOrthoFile}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'drone' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-slate-200', detailWidth)}>
          <DroneWorkUnitDetailPanel
            unit={selectedUnit}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'panorama' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-slate-200', detailWidth)}>
          <PanoramaWorkUnitDetailPanel
            unit={selectedUnit}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'satellite' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-slate-200', detailWidth)}>
          <SatelliteWorkUnitDetailPanel
            unit={selectedUnit}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
          />
        </div>
      ) : null}

      {showDroneFile && selectedFile && detailTab === 'info' ? (
        <div className={cn('flex shrink-0 flex-col', fileWidth)}>
          <DroneFileDetailPanel file={selectedFile} onClose={() => setSelectedFileId(null)} />
        </div>
      ) : null}

      {showPanoOverlay && selectedFile && panoRect
        ? createPortal(
            <div
              className="fixed z-30 flex flex-col bg-slate-900 shadow-2xl"
              style={{
                top: panoRect.top,
                left: panoRect.left,
                width: `calc(100vw - ${Math.round(panoRect.left)}px)`,
                height: panoRect.height,
              }}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-700 bg-slate-800 px-3">
                <span className="truncate text-xs font-semibold text-slate-100">
                  파노라마 뷰어 · {selectedFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFileId(null)}
                  className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
                  title="닫기"
                  aria-label="닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 p-4">
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-md border border-slate-700 bg-[conic-gradient(from_180deg_at_50%_50%,#1e293b,#334155,#0f172a,#1e293b)] text-slate-200">
                  <div className="h-20 w-40 rounded-full border border-dashed border-slate-400/50 bg-slate-800/40" />
                  <p className="px-2 text-center text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-[11px] text-slate-400">파노라마 뷰어 (목업) · 지도 영역 전체 표시</p>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {!useRealMap ? (
        <div className="min-w-0 flex-1">
          {kind === 'ortho' ? (
            <MapPlaceholder
              title="지도"
              hint={
                checkedOrthoIds.size > 0
                  ? `타일 ${checkedOrthoIds.size}개 선택 (목업)`
                  : '변환완료 파일 체크 시 타일 표시'
              }
            >
              {checkedOrthoIds.size > 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-emerald-800">지도용 타일 레이어 on (목업)</p>
                  <ul className="mt-1.5 space-y-0.5 text-[10px] text-slate-600">
                    {selectedUnit?.files
                      .filter((f) => checkedOrthoIds.has(f.id))
                      .map((f) => (
                        <li key={f.id}>· {f.name}</li>
                      ))}
                  </ul>
                </div>
              ) : undefined}
            </MapPlaceholder>
          ) : null}

          {kind === 'drone' ? (
            <MapPlaceholder
              title="지도"
              hint={selectedFile?.locationLabel ? `촬영 위치 ${selectedFile.locationLabel}` : '파일 선택 시 위치 이동'}
            />
          ) : null}

          {kind === 'panorama' ? (
            <MapPlaceholder
              title={showPanoViewer ? '파노라마 뷰어' : '지도'}
              hint={showPanoViewer ? selectedFile?.name : undefined}
            >
              {showPanoViewer && selectedFile ? (
                <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-300 bg-slate-900 shadow-md">
                  <div className="flex aspect-[2/1] flex-col items-center justify-center gap-2 bg-[conic-gradient(from_180deg_at_50%_50%,#1e293b,#334155,#0f172a,#1e293b)] text-slate-200">
                    <div className="h-16 w-28 rounded-full border border-dashed border-slate-400/50 bg-slate-800/40" />
                    <p className="text-[11px] font-medium">{selectedFile.name}</p>
                    <p className="text-[10px] text-slate-400">파노라마 뷰어 (목업)</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-300/80 bg-white/80 px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-600">파일 목록에서 파노라마를 선택하세요</p>
                </div>
              )}
            </MapPlaceholder>
          ) : null}

          {kind === 'satellite' ? (
            <MapPlaceholder title="지도" hint="배경지도 «자체항공영상»에서 on/off">
              <div className="rounded-lg border border-slate-300/80 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-medium text-slate-600">항공영상 · 배경지도에서 표시</p>
                <p className="mt-1 text-[10px] text-slate-500">목록만 제공 · 지도 on/off는 배경지도</p>
                {selectedUnitId ? (
                  <p className="mt-2 text-[10px] text-sky-700">
                    선택: {units.find((u) => u.id === selectedUnitId)?.workName}
                  </p>
                ) : null}
              </div>
            </MapPlaceholder>
          ) : null}
        </div>
      ) : null}

      <FolderBatchUploadDialog
        open={!viewOnly && uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) setUploadLinkRequestId(null);
        }}
        expectedKind={kind}
        linkedRequest={dialogLinkedRequest}
        onUploadMockComplete={() => setListTick((t) => t + 1)}
      />
      {!viewOnly ? <UploadCompleteDialog notice={uploadCompleteNotice} /> : null}
    </div>
  );
}
