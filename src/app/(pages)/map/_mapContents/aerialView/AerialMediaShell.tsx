'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  mockUnitsForKind,
  subscribeMockWorkUnits,
  applyWorkUnitMediaFiles,
  replaceDroneUnitsFromServer,
  replacePanoUnitsFromServer,
  replaceOrthoUnitsFromServer,
  replaceSatelliteUnitsFromServer,
  removeDroneUnitFromStore,
  removeDroneFileFromStore,
  removeMediaUnitFromStore,
  removeMediaFileFromStore,
  removeOrthoUnitFromStore,
  removeOrthoFileFromStore,
  removeSatelliteUnitFromStore,
} from './aerialMediaMockData';
import { type AerialKind, type AttrRow, type WorkFileItem, type WorkUnitItem } from './aerialMediaTypes';
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
import { FolderBatchUploadDialog, type FolderCreatedInfo } from './FolderBatchUploadDialog';
import { WorkUnitMediaUploadDialog } from './WorkUnitMediaUploadDialog';
import { AerialMediaPointPopup } from './AerialMediaPointPopup';
import { openAerialDroneFileOnMap } from './useAerialViewCheckedMarkers';
import { PanoViewerInsetMap } from './PanoViewerInsetMap';
import { DroneFileGeomEdit } from './DroneFileGeomEdit';
import { useAerialMediaMapFocus, type MediaPointPick } from './useAerialMediaMapFocus';
import { useAerialOrthoCheckedTiles } from './useAerialOrthoCheckedTiles';
import { useAerialOrthoPanelBbox, type OrthoBboxPick } from './useAerialOrthoPanelBbox';
import {
  subscribeAerialMediaUploadComplete,
  type AerialMediaUploadCompleteEvent,
} from './aerialMediaUploadRunner';
import {
  clearActiveRegistrationRequest,
  completeMediaRegistration,
  findShootingRequest,
  getShootingRequests,
  subscribeShootingRequests,
} from '../shootingRequest/shootingRequestMockStore';
import {
  getUploadCompleteNotice,
  getUploadProgressUiVersion,
  getVisibleUploadJobs,
  setUploadCompleteNotice,
  subscribeUploadProgress,
} from './aerialUploadProgressStore';
import { UploadCompleteDialog } from './UploadCompleteDialog';
import { UploadProgressBanner } from './UploadProgressBanner';
import { PanoViewerNav } from './PanoViewerNav';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { refreshBizNotifs } from '../bizNotif/bizNotifClient';
import { showSatelliteOnBackgroundMap } from './showSatelliteBackground';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { useAerialOrthoZoomLimit } from './useAerialOrthoZoomLimit';
import type { MapHitOverlapOption } from '../../_mapComponents/MapHitOverlapSelect';

const PannellumViewer = dynamic(() => import('./PannellumViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black text-[11px] text-slate-400">
      뷰어 로딩…
    </div>
  ),
});

function aerialMediaUrl(relativePath: string): string {
  return `/api/aerial/media?${new URLSearchParams({
    path: relativePath.replace(/\\/g, '/'),
  }).toString()}`;
}

function attrValue(attrs: AttrRow[], label: string, fallback = ''): string {
  const value = attrs.find((row) => row.label === label)?.value.trim() ?? '';
  return value === '—' ? '' : value || fallback;
}

const KIND_ORDER_ALL: AerialKind[] = ['ortho', 'drone', 'panorama', 'satellite'];
/** 조회전용: 드론영상·항공뷰·사진동영상·항공 (관리 버튼·비행기록부 숨김) */
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
  /** 알림에서 지정한 사진·동영상 파일 */
  geomFocus?: { unitId: string; fileId: string; token: number } | null;
};

export function AerialMediaShell({
  initialKind = 'ortho',
  hideKindNav = false,
  useRealMap = false,
  viewOnly = false,
  onClose,
  onContentWidthChange,
  geomFocus = null,
}: Props) {
  const mapContext = useMapContext();
  const kindOrder = viewOnly ? KIND_ORDER_VIEW : KIND_ORDER_ALL;
  const [kind, setKind] = useState<AerialKind>(initialKind);
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  /** 알림에서 연 경우만 파일 상세. 목록 클릭은 지도 사진,동영상 카드만 연다. */
  const [droneFileDetailId, setDroneFileDetailId] = useState<string | null>(null);
  const [geomEditFile, setGeomEditFile] = useState<WorkFileItem | null>(null);
  /** 지도 점 클릭 — 넓은 파일 상세 대신 좌표 위 작은 미리보기 */
  const [pointPopup, setPointPopup] = useState<MediaPointPick | null>(null);
  const [checkedOrthoIds, setCheckedOrthoIds] = useState<Set<string>>(new Set());
  const [orthoOverlapOptions, setOrthoOverlapOptions] = useState<MapHitOverlapOption[]>([]);
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [uploadOpen, setUploadOpen] = useState(false);
  /** 상세 «이 건으로 폴더 업로드»로 연 경우에만 설정 — 목록 일반 업로드는 null */
  const [uploadLinkRequestId, setUploadLinkRequestId] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);
  const [mediaUploadTarget, setMediaUploadTarget] = useState<{
    kind: AerialKind;
    folderName: string;
    workName: string;
    wuKey?: number;
    linkedRequestId?: string;
  } | null>(null);
  const [zoomLimitBusy, setZoomLimitBusy] = useState(false);
  const {
    enabled: zoomLimitOn,
    canManage: canManageZoomLimit,
    setEnabled: setZoomLimitEnabled,
  } = useAerialOrthoZoomLimit();

  /** 업로드·변환 목업이 목록 배열을 바꿀 때 리렌더 */
  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  const refreshDroneMediaFiles = async (folderName: string, wuKey?: number) => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnitMedia',
      params: {
        kind: 'drone',
        folderName,
        ...(wuKey != null ? { wuKey } : {}),
      },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      items?: Array<{
        fuKey: number;
        wuKey: number;
        fileName: string;
        sizeLabel: string;
        format: string;
        previewKind: 'image' | 'video';
        locationLabel: string | null;
        relativePath?: string;
        x5181?: number | null;
        y5181?: number | null;
      }>;
    };
    applyWorkUnitMediaFiles('drone', folderName, data.items ?? []);
    setListTick((t) => t + 1);
  };

  /** work_unit 목록 (+ file_unit) — 사진·동영상 */
  const refreshDroneWorkUnitList = async () => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnits',
      params: { kind: 'drone' },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      units?: Array<{
        wuKey: number;
        folderName: string;
        workName: string;
        workDate: string | null;
        srKey: number | null;
        workPurpose?: string | null;
        author?: string | null;
        photographer?: string | null;
        memo?: string | null;
        items: Array<{
          fuKey: number;
          fileName: string;
          sizeLabel: string;
          format: string;
          previewKind: 'image' | 'video';
          locationLabel: string | null;
          relativePath?: string;
          x5181?: number | null;
          y5181?: number | null;
        }>;
      }>;
    };
    replaceDroneUnitsFromServer(data.units ?? []);
    setListTick((t) => t + 1);
  };

  const refreshPanoMediaFiles = async (folderName: string, wuKey?: number) => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnitMedia',
      params: {
        kind: 'panorama',
        folderName,
        ...(wuKey != null ? { wuKey } : {}),
      },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      items?: Array<{
        fuKey: number;
        wuKey: number;
        fileName: string;
        sizeLabel: string;
        format: string;
        previewKind: 'image' | 'video' | 'panorama';
        locationLabel: string | null;
        relativePath?: string;
        x5181?: number | null;
        y5181?: number | null;
      }>;
    };
    applyWorkUnitMediaFiles('panorama', folderName, data.items ?? []);
    setListTick((t) => t + 1);
  };

  const refreshPanoWorkUnitList = async () => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnits',
      params: { kind: 'panorama' },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      units?: Array<{
        wuKey: number;
        folderName: string;
        workName: string;
        workDate: string | null;
        srKey: number | null;
        workPurpose?: string | null;
        author?: string | null;
        memo?: string | null;
        items: Array<{
          fuKey: number;
          fileName: string;
          sizeLabel: string;
          format: string;
          previewKind: 'image' | 'video' | 'panorama';
          locationLabel: string | null;
          relativePath?: string;
          x5181?: number | null;
          y5181?: number | null;
        }>;
      }>;
    };
    replacePanoUnitsFromServer(data.units ?? []);
    setListTick((t) => t + 1);
  };

  const refreshOrthoWorkUnitList = async () => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnits',
      params: { kind: 'ortho' },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      units?: Array<{
        wuKey: number;
        folderName: string;
        workName: string;
        workDate: string | null;
        srKey: number | null;
        workPurpose?: string | null;
        author?: string | null;
        memo?: string | null;
        items: Array<{
          tuKey?: number;
          fileName: string;
          sizeLabel: string;
          format: string;
          convertStatus?: string;
          tilesRelativePath?: string | null;
          relativePath?: string;
        }>;
      }>;
    };
    replaceOrthoUnitsFromServer(data.units ?? []);
    setListTick((t) => t + 1);
  };

  const refreshSatelliteWorkUnitList = async () => {
    const res = await call('', 'POST', {
      service: 'aerialUploadService',
      action: 'listWorkUnits',
      params: { kind: 'satellite' },
    });
    if (!res?.success) return;
    const data = (res.data ?? res) as {
      units?: Array<{
        wuKey: number;
        folderName: string;
        workName: string;
        workDate: string | null;
        srKey: number | null;
        workPurpose?: string | null;
        author?: string | null;
        memo?: string | null;
        items: Array<{
          tuKey?: number;
          fileName: string;
          sizeLabel: string;
          format: string;
          convertStatus?: string;
          tilesRelativePath?: string | null;
          relativePath?: string;
        }>;
      }>;
    };
    replaceSatelliteUnitsFromServer(data.units ?? []);
    setListTick((t) => t + 1);
  };
  /** 사이드바 종류 메뉴 전환 시 패널을 다시 만들지 않고 종류만 맞춤 (업로드 진행 유지) */
  useEffect(() => {
    setKind(initialKind);
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setDroneFileDetailId(null);
    setPointPopup(null);
    setCheckedOrthoIds(new Set());
    setOrthoOverlapOptions([]);
    setDetailTab('info');
    setKeyword('');
    setDateFrom('');
    setDateTo('');
    setUploadOpen(false);
    setUploadLinkRequestId(null);
    setMediaUploadTarget(null);
  }, [initialKind]);

  useEffect(() => {
    if (!geomFocus?.unitId || !geomFocus.fileId) return;
    setKind('drone');
    setSelectedUnitId(geomFocus.unitId);
    setSelectedFileId(geomFocus.fileId);
    setDroneFileDetailId(geomFocus.fileId);
    setDetailTab('info');
  }, [geomFocus?.token, geomFocus?.unitId, geomFocus?.fileId]);

  useSyncExternalStore(subscribeShootingRequests, getShootingRequests, getShootingRequests);
  useSyncExternalStore(subscribeUploadProgress, getUploadProgressUiVersion, getUploadProgressUiVersion);
  const uploadCompleteNotice = !viewOnly ? getUploadCompleteNotice() : null;
  const uploadingJobs = !viewOnly ? getVisibleUploadJobs() : [];
  /** 일반 폴더 업로드가 아니라 «이 건으로»로 연 승인 건만 다이얼로그에 표시 */
  const dialogLinkedRequest =
    !viewOnly && uploadLinkRequestId != null ? findShootingRequest(uploadLinkRequestId) : null;

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

  /** 사진·동영상·항공뷰·드론영상·항공영상: DB → 작업단위 목록 */
  useEffect(() => {
    if (kind === 'drone') {
      void refreshDroneWorkUnitList().catch(() => undefined);
    } else if (kind === 'panorama') {
      void refreshPanoWorkUnitList().catch(() => undefined);
    } else if (kind === 'ortho') {
      void refreshOrthoWorkUnitList().catch(() => undefined);
    } else if (kind === 'satellite') {
      void refreshSatelliteWorkUnitList().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  /**
   * 상세 열 때 파일 목록 동기화.
   * listWorkUnits 로 이미 files 가 있으면 재조회 생략.
   */
  useEffect(() => {
    if (!selectedUnit?.folderName) return;
    if (selectedUnit.files.length > 0) return;
    if (kind === 'drone') {
      void refreshDroneMediaFiles(selectedUnit.folderName).catch(() => undefined);
    } else if (kind === 'panorama') {
      void refreshPanoMediaFiles(selectedUnit.folderName).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- folderName·캐시된 files 기준
  }, [kind, selectedUnit?.folderName, selectedUnit?.files.length]);

  const popupUnit = pointPopup ? units.find((u) => u.id === pointPopup.unitId) ?? null : null;
  const popupFile = popupUnit?.files.find((f) => f.id === pointPopup?.fileId) ?? null;

  const handleMediaPointPick = useCallback((hit: MediaPointPick) => {
    if (kind === 'drone') {
      setPointPopup(hit);
      setSelectedFileId(null);
      return;
    }
    setSelectedUnitId(hit.unitId);
    setSelectedFileId(hit.fileId);
    setDetailTab('info');
  }, [kind]);

  useAerialMediaMapFocus({
    /** 항공영상은 geom 없음 · 단순 목록 조회만 — 지도 이동·마커 없음 */
    enabled: useRealMap && kind !== 'satellite',
    unit: popupUnit ?? selectedUnit,
    selectedFileId: pointPopup?.fileId ?? selectedFileId,
    listUnits: kind === 'drone' ? units : null,
    listRevision: listTick,
    onPick: kind === 'drone' || kind === 'panorama' ? handleMediaPointPick : undefined,
  });

  useAerialOrthoCheckedTiles({
    enabled: useRealMap && kind === 'ortho',
    unit: selectedUnit,
    checkedFileIds: checkedOrthoIds,
    fitView: false,
  });

  const orthoPanelTuKeys = useMemo(() => {
    if (kind !== 'ortho' || !selectedUnit) return undefined;
    const keys: number[] = [];
    for (const file of selectedUnit.files) {
      if (file.tuKey != null && Number.isFinite(file.tuKey)) keys.push(file.tuKey);
    }
    return keys;
  }, [kind, selectedUnit]);

  const showOrthoPick = useCallback((wuKey: number, tuKey: number) => {
    setSelectedUnitId(`wu-${wuKey}`);
    setSelectedFileId(`tu-${tuKey}`);
    setCheckedOrthoIds(new Set([`tu-${tuKey}`]));
    setDetailTab('info');
  }, []);

  const handleOrthoBboxPick = useCallback(
    (hit: OrthoBboxPick) => {
      showOrthoPick(hit.wuKey, hit.tuKey);
      setOrthoOverlapOptions(hit.overlaps && hit.overlaps.length > 1 ? hit.overlaps : []);
    },
    [showOrthoPick]
  );

  const handleOrthoOverlapChange = useCallback(
    (id: string) => {
      const [wuRaw, tuRaw] = id.split(':');
      const wuKey = Number(wuRaw);
      const tuKey = Number(tuRaw);
      if (!Number.isFinite(wuKey) || !Number.isFinite(tuKey)) return;
      showOrthoPick(wuKey, tuKey);
    },
    [showOrthoPick]
  );

  useAerialOrthoPanelBbox({
    enabled: useRealMap && kind === 'ortho',
    tuKeys: orthoPanelTuKeys,
    onPick: handleOrthoBboxPick,
  });

  const switchKind = (next: AerialKind) => {
    setKind(next);
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setGeomEditFile(null);
    setPointPopup(null);
    setCheckedOrthoIds(new Set());
    setOrthoOverlapOptions([]);
    setDetailTab('info');
    setKeyword('');
    setDateFrom('');
    setDateTo('');
  };

  const handleSelectUnit = (id: string) => {
    setPointPopup(null);
    setSelectedUnitId(id);
    setSelectedFileId(null);
    setDetailTab('info');
    setOrthoOverlapOptions([]);
    const unit = units.find((u) => u.id === id);
    if (!unit) return;
    if (kind === 'ortho') {
      const doneIds = unit.files
        .filter((file) => file.status === 'done' && file.tuKey != null)
        .map((file) => file.id);
      setCheckedOrthoIds(new Set(doneIds));
      return;
    }
    if (kind === 'satellite') {
      showSatelliteOnBackgroundMap(mapContext, unit);
    }
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

  const openMediaUploadForUnit = (unit: {
    kind: AerialKind;
    folderName: string;
    workName: string;
    linkedRequestId?: string;
    id?: string;
  }) => {
    if (unit.kind !== 'drone' && unit.kind !== 'ortho' && unit.kind !== 'panorama' && unit.kind !== 'satellite')
      return;
    const wuKey =
      unit.id?.startsWith('wu-') && Number.isFinite(Number(unit.id.slice(3)))
        ? Number(unit.id.slice(3))
        : undefined;
    setMediaUploadTarget({
      kind: unit.kind,
      folderName: unit.folderName,
      workName: unit.workName,
      wuKey,
      linkedRequestId: unit.linkedRequestId,
    });
  };

  const handleFolderCreated = (info: FolderCreatedInfo) => {
    setListTick((t) => t + 1);
    if (
      info.kind === 'drone' ||
      info.kind === 'ortho' ||
      info.kind === 'panorama' ||
      info.kind === 'satellite'
    ) {
      if (info.kind === 'drone') void refreshDroneWorkUnitList().catch(() => undefined);
      else if (info.kind === 'panorama') void refreshPanoWorkUnitList().catch(() => undefined);
      else if (info.kind === 'satellite') void refreshSatelliteWorkUnitList().catch(() => undefined);
      else void refreshOrthoWorkUnitList().catch(() => undefined);
      setMediaUploadTarget({
        kind: info.kind,
        folderName: info.folderName,
        workName: info.workName,
        wuKey: info.wuKey,
        linkedRequestId: info.linkedRequestId,
      });
    }
  };

  const handleMediaUploaded = async (event: AerialMediaUploadCompleteEvent) => {
    if (event.aborted) return;
    if (event.error && event.fileCount === 0) return;
    if (event.kind === 'drone') {
      await refreshDroneWorkUnitList().catch(() => undefined);
      await refreshDroneMediaFiles(event.folderName, event.wuKey).catch(() => undefined);
    } else if (event.kind === 'panorama') {
      await refreshPanoWorkUnitList().catch(() => undefined);
      await refreshPanoMediaFiles(event.folderName, event.wuKey).catch(() => undefined);
    } else if (event.kind === 'ortho') {
      await refreshOrthoWorkUnitList().catch(() => undefined);
    } else if (event.kind === 'satellite') {
      await refreshSatelliteWorkUnitList().catch(() => undefined);
    }
    if (event.linkedRequestId) {
      completeMediaRegistration(event.linkedRequestId, event.workName);
    }
    if (event.fileCount > 0) {
      setUploadCompleteNotice({
        kind: event.kind,
        workName: event.workName,
        folderName: event.folderName,
        progressFilePath: '',
        fileTotal: event.fileCount,
        linkedPurpose: event.linkedRequestId
          ? findShootingRequest(event.linkedRequestId)?.purpose || undefined
          : undefined,
      });
    }
  };

  const handleMediaUploadedRef = useRef(handleMediaUploaded);
  handleMediaUploadedRef.current = handleMediaUploaded;

  useEffect(() => {
    return subscribeAerialMediaUploadComplete((event) => {
      void handleMediaUploadedRef.current(event);
    });
  }, []);
  const closeUnitDetail = () => {
    setSelectedUnitId(null);
    setSelectedFileId(null);
    setPointPopup(null);
    setDetailTab('info');
    setOrthoOverlapOptions([]);
    if (kind === 'ortho') setCheckedOrthoIds(new Set());
  };

  const handleSaveOrthoAttrs = async (attrs: AttrRow[]) => {
    if (!selectedUnit || selectedUnit.kind !== 'ortho') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : null;
    if (wuKey == null) {
      window.alert('수정할 작업단위 키가 없습니다.');
      throw new Error('작업단위 키가 필요합니다.');
    }

    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'updateOrthoWorkUnitAttrs',
        params: {
          wuKey,
          workDate: attrValue(attrs, '작업일', selectedUnit.workDate),
          workPurpose: attrValue(attrs, '임무/작업 목적'),
          author: attrValue(attrs, '작성자'),
          memo: attrValue(attrs, '메모'),
        },
      });
      if (res?.success === false) {
        throw new Error(String(res?.error ?? '드론영상 속성 수정에 실패했습니다.'));
      }
      await refreshOrthoWorkUnitList();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'error' in error
          ? String((error as { error?: unknown }).error ?? '')
          : error instanceof Error
            ? error.message
            : '';
      window.alert(message || '드론영상 속성 수정에 실패했습니다.');
      throw error;
    }
  };

  const handleSaveDroneAttrs = async (attrs: AttrRow[]) => {
    if (!selectedUnit || selectedUnit.kind !== 'drone') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : null;
    if (wuKey == null) {
      window.alert('수정할 작업단위 키가 없습니다.');
      throw new Error('작업단위 키가 필요합니다.');
    }
    const workName =
      attrValue(attrs, '작업단위 명', selectedUnit.workName) ||
      attrValue(attrs, '작업단위', selectedUnit.workName);
    if (!workName) {
      window.alert('작업단위명을 입력해 주세요.');
      throw new Error('작업단위명이 필요합니다.');
    }

    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'updateDroneWorkUnit',
        params: {
          wuKey,
          workName,
          workPurpose: attrValue(attrs, '임무/작업 목적'),
          author: attrValue(attrs, '작성자'),
          photographer: attrValue(attrs, '촬영자'),
          memo: attrValue(attrs, '메모'),
        },
      });
      if (res?.success === false) {
        throw new Error(String(res?.error ?? '작업단위 수정에 실패했습니다.'));
      }
      await refreshDroneWorkUnitList();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'error' in error
          ? String((error as { error?: unknown }).error ?? '')
          : error instanceof Error
            ? error.message
            : '';
      window.alert(message || '작업단위 수정에 실패했습니다.');
      throw error;
    }
  };

  const handleSavePanoAttrs = async (attrs: AttrRow[]) => {
    if (!selectedUnit || selectedUnit.kind !== 'panorama') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : null;
    if (wuKey == null) {
      window.alert('수정할 작업단위 키가 없습니다.');
      throw new Error('작업단위 키가 필요합니다.');
    }
    const workName =
      attrValue(attrs, '작업단위 명', selectedUnit.workName) ||
      attrValue(attrs, '작업단위', selectedUnit.workName);
    if (!workName) {
      window.alert('작업단위명을 입력해 주세요.');
      throw new Error('작업단위명이 필요합니다.');
    }

    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'updatePanoramaWorkUnit',
        params: {
          wuKey,
          workName,
          workPurpose: attrValue(attrs, '임무/작업 목적'),
          author: attrValue(attrs, '작성자'),
          photographer: attrValue(attrs, '촬영자'),
          memo: attrValue(attrs, '메모'),
        },
      });
      if (res?.success === false) {
        throw new Error(String(res?.error ?? '항공뷰 작업단위 수정에 실패했습니다.'));
      }
      await refreshPanoWorkUnitList();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'error' in error
          ? String((error as { error?: unknown }).error ?? '')
          : error instanceof Error
            ? error.message
            : '';
      window.alert(message || '항공뷰 작업단위 수정에 실패했습니다.');
      throw error;
    }
  };

  const handleDeleteDroneFile = async () => {
    if (!selectedUnit || selectedUnit.kind !== 'drone' || !selectedFile) return;
    const fuKey =
      selectedFile.id.startsWith('fu-') && Number.isFinite(Number(selectedFile.id.slice(3)))
        ? Number(selectedFile.id.slice(3))
        : undefined;
    if (fuKey == null) {
      window.alert('삭제할 파일 키가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `파일 «${selectedFile.name}»을(를) 삭제할까요?\n디스크에 저장된 파일도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteFileUnit',
        params: { fuKey },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '파일 삭제에 실패했습니다.');
        return;
      }
      removeDroneFileFromStore(selectedUnit.id, selectedFile.id);
      setSelectedFileId(null);
      setListTick((t) => t + 1);
      const wuKey = Number(selectedUnit.id.slice(3));
      void refreshDroneMediaFiles(
        selectedUnit.folderName,
        Number.isFinite(wuKey) ? wuKey : undefined
      ).catch(() => undefined);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '파일 삭제에 실패했습니다.');
    }
  };

  const handleDeleteDroneUnit = async () => {
    if (!selectedUnit || selectedUnit.kind !== 'drone') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : undefined;
    const ok = window.confirm(
      `작업단위 «${selectedUnit.workName}»을(를) 삭제할까요?\n소속 파일·디스크 저장 파일도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteWorkUnit',
        params: {
          kind: 'drone',
          folderName: selectedUnit.folderName,
          ...(wuKey != null ? { wuKey } : {}),
        },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '작업단위 삭제에 실패했습니다.');
        return;
      }
      removeDroneUnitFromStore(selectedUnit.id);
      setListTick((t) => t + 1);
      closeUnitDetail();
      void refreshDroneWorkUnitList().catch(() => undefined);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '작업단위 삭제에 실패했습니다.');
    }
  };

  const handleDeletePanoUnit = async () => {
    if (!selectedUnit || selectedUnit.kind !== 'panorama') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : undefined;
    const ok = window.confirm(
      `작업단위 «${selectedUnit.workName}»을(를) 삭제할까요?\n소속 파일·디스크 저장 파일도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteWorkUnit',
        params: {
          kind: 'panorama',
          folderName: selectedUnit.folderName,
          ...(wuKey != null ? { wuKey } : {}),
        },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '작업단위 삭제에 실패했습니다.');
        return;
      }
      removeMediaUnitFromStore('panorama', selectedUnit.id);
      setListTick((t) => t + 1);
      closeUnitDetail();
      void refreshPanoWorkUnitList().catch(() => undefined);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '작업단위 삭제에 실패했습니다.');
    }
  };

  const handleDeletePanoFile = async (file: WorkUnitItem['files'][number]) => {
    if (!selectedUnit || selectedUnit.kind !== 'panorama') return;
    const fuKey =
      file.id.startsWith('fu-') && Number.isFinite(Number(file.id.slice(3)))
        ? Number(file.id.slice(3))
        : null;
    if (fuKey == null) {
      window.alert('삭제할 파일 키가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `파일 «${file.name}»을(를) 삭제할까요?\n디스크에 저장된 파일도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteFileUnit',
        params: { fuKey },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '파일 삭제에 실패했습니다.');
        return;
      }
      removeMediaFileFromStore('panorama', selectedUnit.id, file.id);
      if (selectedFileId === file.id) setSelectedFileId(null);
      setListTick((t) => t + 1);
      await refreshPanoWorkUnitList();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '파일 삭제에 실패했습니다.');
    }
  };

  const handleSaveSatelliteAttrs = async (attrs: AttrRow[]) => {
    if (!selectedUnit || selectedUnit.kind !== 'satellite') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : null;
    if (wuKey == null) {
      window.alert('수정할 작업단위 키가 없습니다.');
      throw new Error('작업단위 키가 필요합니다.');
    }

    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'updateOrthoWorkUnitAttrs',
        params: {
          wuKey,
          workDate: attrValue(attrs, '작업일', selectedUnit.workDate),
          workPurpose: attrValue(attrs, '임무/작업 목적'),
          author: attrValue(attrs, '작성자'),
          memo: attrValue(attrs, '메모'),
        },
      });
      if (res?.success === false) {
        throw new Error(String(res?.error ?? '항공영상 속성 수정에 실패했습니다.'));
      }
      await refreshSatelliteWorkUnitList();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'error' in error
          ? String((error as { error?: unknown }).error ?? '')
          : error instanceof Error
            ? error.message
            : '';
      window.alert(message || '항공영상 속성 수정에 실패했습니다.');
      throw error;
    }
  };

  const handleDeleteSatelliteUnit = async () => {
    if (!selectedUnit || selectedUnit.kind !== 'satellite') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : undefined;
    const ok = window.confirm(
      `작업단위 «${selectedUnit.workName}»을(를) 삭제할까요?\n소속 TIF·자체항공영상 타일·디스크 폴더도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteWorkUnit',
        params: {
          kind: 'satellite',
          folderName: selectedUnit.folderName,
          ...(wuKey != null ? { wuKey } : {}),
        },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '작업단위 삭제에 실패했습니다.');
        return;
      }
      removeSatelliteUnitFromStore(selectedUnit.id);
      setListTick((t) => t + 1);
      closeUnitDetail();
      void refreshSatelliteWorkUnitList().catch(() => undefined);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '작업단위 삭제에 실패했습니다.');
    }
  };

  const handleDeleteOrthoUnit = async () => {
    if (!selectedUnit || selectedUnit.kind !== 'ortho') return;
    const wuKey =
      selectedUnit.id.startsWith('wu-') && Number.isFinite(Number(selectedUnit.id.slice(3)))
        ? Number(selectedUnit.id.slice(3))
        : undefined;
    const ok = window.confirm(
      `작업단위 «${selectedUnit.workName}»을(를) 삭제할까요?
소속 TIF·변환 타일·디스크 폴더도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialUploadService',
        action: 'deleteWorkUnit',
        params: {
          kind: 'ortho',
          folderName: selectedUnit.folderName,
          ...(wuKey != null ? { wuKey } : {}),
        },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '작업단위 삭제에 실패했습니다.');
        return;
      }
      const removedFileIds = new Set(selectedUnit.files.map((f) => f.id));
      removeOrthoUnitFromStore(selectedUnit.id);
      setCheckedOrthoIds((prev) => {
        const next = new Set(prev);
        for (const id of removedFileIds) next.delete(id);
        return next;
      });
      setListTick((t) => t + 1);
      closeUnitDetail();
      void refreshOrthoWorkUnitList().catch(() => undefined);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '작업단위 삭제에 실패했습니다.');
    }
  };

  const handleDeleteOrthoFile = async (file: WorkUnitItem['files'][number]) => {
    if (!selectedUnit || selectedUnit.kind !== 'ortho') return;
    const tuKey =
      file.id.startsWith('tu-') && Number.isFinite(Number(file.id.slice(3)))
        ? Number(file.id.slice(3))
        : null;
    if (tuKey == null) {
      window.alert('삭제할 파일 키가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `파일 «${file.name}»을(를) 삭제할까요?
원본 TIF와 변환 타일도 함께 삭제됩니다.`
    );
    if (!ok) return;
    try {
      const res = await call('', 'POST', {
        service: 'aerialOrthoService',
        action: 'deleteTifUnit',
        params: { tuKey },
      });
      const payload = (res?.data ?? res) as { success?: boolean; error?: string };
      if (res?.success === false || payload?.success === false) {
        window.alert(payload?.error || '파일 삭제에 실패했습니다.');
        return;
      }
      removeOrthoFileFromStore(selectedUnit.id, file.id);
      setCheckedOrthoIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
      if (selectedFileId === file.id) setSelectedFileId(null);
      setListTick((t) => t + 1);
      await refreshOrthoWorkUnitList();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'error' in e
          ? String((e as { error?: unknown }).error ?? '')
          : e instanceof Error
            ? e.message
            : '';
      window.alert(msg || '파일 삭제에 실패했습니다.');
    }
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
  /** 지도 임베드 시 항공뷰 뷰어는 지도 영역 전체를 덮는 오버레이로 표시 */
  const showPanoOverlay = useRealMap && showPanoViewer && selectedFile != null;

  const panoFiles = kind === 'panorama' && selectedUnit ? selectedUnit.files : [];
  const panoFileIndex = selectedFile
    ? panoFiles.findIndex((f) => f.id === selectedFile.id)
    : -1;
  const panoCanPrev = panoFileIndex > 0;
  const panoCanNext = panoFileIndex >= 0 && panoFileIndex < panoFiles.length - 1;
  const goPanoPrev = useCallback(() => {
    if (panoFileIndex <= 0) return;
    const prev = panoFiles[panoFileIndex - 1];
    if (prev) setSelectedFileId(prev.id);
  }, [panoFileIndex, panoFiles]);
  const goPanoNext = useCallback(() => {
    if (panoFileIndex < 0 || panoFileIndex >= panoFiles.length - 1) return;
    const next = panoFiles[panoFileIndex + 1];
    if (next) setSelectedFileId(next.id);
  }, [panoFileIndex, panoFiles]);

  /** 목록 380 · 작업단위상세 420 · 파일상세 480 — 파일 열어도 상세 폭 유지, 오른쪽으로만 확장 */
  const listWidth = 'w-[380px] shrink-0';
  const detailWidth = 'w-[420px] shrink-0';
  const fileWidth = 'w-[480px] shrink-0';
  const showFileDetail =
    showDroneFile && selectedFile != null && detailTab === 'info' && droneFileDetailId === selectedFile.id;

  useEffect(() => {
    if (!onContentWidthChange) return;
    let w = hideKindNav ? 0 : rem(7.5);
    w += 380;
    if (showUnitDetail) w += 420;
    if (showFileDetail) w += 480;
    onContentWidthChange(w + 4);
  }, [onContentWidthChange, hideKindNav, showUnitDetail, showFileDetail]);

  /** 항공뷰 오버레이: 셸(패널 묶음) 오른쪽 끝부터 화면 우측 끝까지 지도 위를 덮음 */
  const shellRef = useRef<HTMLDivElement>(null);
  const [panoRect, setPanoRect] = useState<{ top: number; left: number; height: number } | null>(
    null
  );
  const [panoControls, setPanoControls] = useState<
    import('./PannellumViewer').PannellumViewerHandle | null
  >(null);
  const [panoSceneReady, setPanoSceneReady] = useState(false);

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

  const panoOverlayBox = useMemo(() => {
    if (!panoRect) return null;
    return {
      top: panoRect.top,
      left: panoRect.left,
      width: `calc(100vw - ${Math.round(panoRect.left)}px)`,
      height: panoRect.height,
    };
  }, [panoRect]);

  const kindShort: Record<AerialKind, string> = viewOnly
    ? {
        ortho: '드론영상',
        drone: '사진,동영상',
        panorama: '항공뷰',
        satellite: '항공영상',
      }
    : {
        ortho: '드론영상',
        drone: '사진,동영상',
        panorama: '항공뷰',
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
        'flex h-full w-full min-h-0 min-w-0 overflow-hidden bg-background',
        !useRealMap && 'rounded-md border border-border shadow-sm'
      )}
    >
      {!hideKindNav ? (
        <nav className="flex w-[7.5rem] shrink-0 flex-col border-r border-border bg-muted">
          <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-b border-border px-2.5">
            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground">
              {viewOnly ? '영상조회' : '영상관리'}
            </span>
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
                        ? 'bg-background font-semibold text-sky-800 dark:text-sky-200 shadow-sm ring-1 ring-sky-200 dark:ring-sky-800'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {kindShort[k]}
                  </button>
                </li>
              );
            })}
          </ul>
          {viewOnly ? (
            <div className="border-t border-border px-2.5 py-2 text-[9px] leading-relaxed text-muted-foreground">
              조회 전용
            </div>
          ) : null}
        </nav>
      ) : null}

      <div className={cn('flex flex-col border-r border-border', listWidth)}>
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
          showConvertStatus={kind === 'ortho' || kind === 'satellite'}
          showMissingGeom={kind === 'drone'}
          showDropFolderHint={!viewOnly && (kind === 'drone' || kind === 'panorama' || kind === 'ortho')}
          dropFolderKind={kind === 'panorama' ? 'panorama' : kind === 'ortho' ? 'ortho' : 'drone'}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          emptyHint={viewOnly ? '검색어를 바꿔 보세요.' : undefined}
          toolsExtra={
            !viewOnly && kind === 'ortho' && canManageZoomLimit ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2">
                <span className="text-[11px] font-medium text-foreground">고화질 제한</span>
                <Switch
                  checked={zoomLimitOn}
                  disabled={zoomLimitBusy}
                  onCheckedChange={(on) => {
                    setZoomLimitBusy(true);
                    void setZoomLimitEnabled(on)
                      .catch((e) => {
                        window.alert(e instanceof Error ? e.message : '저장에 실패했습니다.');
                      })
                      .finally(() => setZoomLimitBusy(false));
                  }}
                  aria-label="고화질 제한"
                />
              </div>
            ) : null
          }
          banner={
            <div className="space-y-2">
              <UploadProgressBanner jobs={uploadingJobs} />
              {kind === 'satellite' ? (
                <p className="rounded-md border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 dark:text-amber-100">
                  {viewOnly
                    ? '지도 표시는 배경지도 «자체항공영상»에서 on/off 합니다.'
                    : '변환 완료 시 배경지도 «자체항공영상»에 등록됩니다. on/off는 배경지도에서 합니다.'}
                </p>
              ) : null}
              {useRealMap && kind === 'ortho' && checkedOrthoIds.size > 0 ? (
                <p className="rounded-md border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-2 text-[10px] text-emerald-800 dark:text-emerald-200">
                  지도에 드론영상 타일 {checkedOrthoIds.size}개 표시 중
                </p>
              ) : null}
            </div>
          }
        />
      </div>

      {showUnitDetail && selectedUnit && kind === 'ortho' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-border', detailWidth)}>
          <OrthoWorkUnitDetailPanel
            unit={selectedUnit}
            checkedFileIds={checkedOrthoIds}
            onToggleFile={toggleOrthoFile}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            overlapOptions={orthoOverlapOptions}
            overlapValue={
              selectedFileId
                ? `${selectedUnit.id.replace(/^wu-/, '')}:${selectedFileId.replace(/^tu-/, '')}`
                : (orthoOverlapOptions[0]?.value ?? '')
            }
            onOverlapChange={handleOrthoOverlapChange}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onAddFiles={() => openMediaUploadForUnit(selectedUnit)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
            onSaveAttrs={handleSaveOrthoAttrs}
            onDeleteFile={(file) => {
              void handleDeleteOrthoFile(file);
            }}
            onDelete={() => {
              void handleDeleteOrthoUnit();
            }}
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'drone' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-border', detailWidth)}>
          <DroneWorkUnitDetailPanel
            unit={selectedUnit}
            selectedFileId={selectedFileId}
            onSelectFile={(fileId) => {
              setSelectedFileId(fileId);
              setDroneFileDetailId(null);
              setPointPopup(null);
              openAerialDroneFileOnMap(selectedUnit.id, fileId);
            }}
            onClose={closeUnitDetail}
            detailTab={detailTab}
            onDetailTabChange={setDetailTab}
            viewOnly={viewOnly}
            linkedRequest={detailLinkedRequest}
            onFolderUpload={() => openLinkedFolderUpload(selectedUnit.linkedRequestId)}
            onAddFiles={() => openMediaUploadForUnit(selectedUnit)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
            onSaveAttrs={handleSaveDroneAttrs}
            onEditFileGeom={
              viewOnly
                ? undefined
                : (file) => {
                    setSelectedFileId(file.id);
                    setGeomEditFile(file);
                  }
            }
            onDelete={() => {
              void handleDeleteDroneUnit();
            }}
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'panorama' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-border', detailWidth)}>
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
            onAddFiles={() => openMediaUploadForUnit(selectedUnit)}
            onClearLink={() => {
              setUploadLinkRequestId(null);
              clearActiveRegistrationRequest();
            }}
            onSaveAttrs={handleSavePanoAttrs}
            onDeleteFile={(file) => {
              void handleDeletePanoFile(file);
            }}
            onDelete={
              viewOnly
                ? undefined
                : () => {
                    void handleDeletePanoUnit();
                  }
            }
          />
        </div>
      ) : null}

      {showUnitDetail && selectedUnit && kind === 'satellite' ? (
        <div className={cn('flex shrink-0 flex-col border-r border-border', detailWidth)}>
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
            onSaveAttrs={handleSaveSatelliteAttrs}
            onDelete={
              viewOnly
                ? undefined
                : () => {
                    void handleDeleteSatelliteUnit();
                  }
            }
          />
        </div>
      ) : null}

      {kind === 'drone' && popupUnit && popupFile ? (
        <AerialMediaPointPopup
          file={popupFile}
          files={popupUnit.files}
          workName={popupUnit.workName}
          workDate={popupUnit.workDate}
          onClose={() => setPointPopup(null)}
        />
      ) : null}

      {showFileDetail && selectedFile ? (
        <div className={cn('flex shrink-0 flex-col', fileWidth)}>
          <DroneFileDetailPanel
            file={selectedFile}
            files={selectedUnit?.files}
            onClose={() => {
              setSelectedFileId(null);
              setDroneFileDetailId(null);
              setGeomEditFile(null);
            }}
            onEditGeom={viewOnly ? undefined : (file) => setGeomEditFile(file)}
            onDelete={
              viewOnly
                ? undefined
                : () => {
                    void handleDeleteDroneFile();
                  }
            }
          />
        </div>
      ) : null}

      {showPanoOverlay && selectedFile && panoOverlayBox
        ? createPortal(
            <div
              className="fixed z-[5] flex flex-col overflow-hidden border-l border-border bg-slate-900 shadow-sm"
              style={panoOverlayBox}
            >
              <div className="relative min-h-0 flex-1 bg-slate-900">
                {selectedFile.relativePath ? (
                  <PannellumViewer
                    key={selectedFile.id}
                    imageUrl={aerialMediaUrl(selectedFile.relativePath)}
                    onControlsReady={(api) => {
                      setPanoControls(api);
                      if (!api) setPanoSceneReady(false);
                    }}
                    onSceneLoad={() => setPanoSceneReady(true)}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-300">
                    <p className="text-xs font-medium">{selectedFile.name}</p>
                    <p className="text-[11px] text-slate-400">미리보기 경로가 없습니다</p>
                  </div>
                )}
                <PanoViewerNav
                  fileName={selectedFile.name}
                  index={panoFileIndex}
                  total={panoFiles.length}
                  canPrev={panoCanPrev}
                  canNext={panoCanNext}
                  onPrev={goPanoPrev}
                  onNext={goPanoNext}
                  onZoomIn={panoControls ? () => panoControls.zoomIn() : undefined}
                  onZoomOut={panoControls ? () => panoControls.zoomOut() : undefined}
                  onClose={() => setSelectedFileId(null)}
                />
                {panoSceneReady ? (
                  <PanoViewerInsetMap
                    file={selectedFile}
                    onPick={(unitId, fileId) => {
                      setSelectedUnitId(unitId);
                      setSelectedFileId(fileId);
                      setDetailTab('info');
                    }}
                  />
                ) : null}
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
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-background/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">지도용 타일 레이어 on (목업)</p>
                  <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
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
              title={showPanoViewer ? '항공뷰 미리보기' : '지도'}
              hint={showPanoViewer ? selectedFile?.name : undefined}
            >
              {showPanoViewer && selectedFile?.relativePath ? (
                <div className="relative h-[min(56vh,420px)] w-full max-w-3xl overflow-hidden rounded-md border border-border bg-slate-900 shadow-sm">
                  <PannellumViewer
                    key={selectedFile.id}
                    imageUrl={aerialMediaUrl(selectedFile.relativePath)}
                    onControlsReady={setPanoControls}
                  />
                  <PanoViewerNav
                    fileName={selectedFile.name}
                    index={panoFileIndex}
                    total={panoFiles.length}
                    canPrev={panoCanPrev}
                    canNext={panoCanNext}
                    onPrev={goPanoPrev}
                    onNext={goPanoNext}
                    onZoomIn={panoControls ? () => panoControls.zoomIn() : undefined}
                    onZoomOut={panoControls ? () => panoControls.zoomOut() : undefined}
                    onClose={() => setSelectedFileId(null)}
                  />
                </div>
              ) : (
                <div className="rounded-md border border-border bg-background px-4 py-3 shadow-sm">
                  <p className="text-xs text-muted-foreground">파일 목록에서 항공뷰를 선택하세요</p>
                </div>
              )}
            </MapPlaceholder>
          ) : null}

          {kind === 'satellite' ? (
            <MapPlaceholder title="지도" hint="배경지도 «자체항공영상»에서 on/off">
              <div className="rounded-lg border border-border bg-background/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">항공영상 · 배경지도에서 표시</p>
                <p className="mt-1 text-[10px] text-muted-foreground">목록만 제공 · 지도 on/off는 배경지도</p>
                {selectedUnitId ? (
                  <p className="mt-2 text-[10px] text-sky-700 dark:text-sky-300">
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
        onFolderCreated={handleFolderCreated}
      />
      {mediaUploadTarget ? (
        <WorkUnitMediaUploadDialog
          open={!viewOnly}
          onOpenChange={(open) => {
            if (!open) setMediaUploadTarget(null);
          }}
          kind={mediaUploadTarget.kind}
          folderName={mediaUploadTarget.folderName}
          workName={mediaUploadTarget.workName}
          wuKey={mediaUploadTarget.wuKey}
          linkedRequestId={mediaUploadTarget.linkedRequestId}
          srKey={
            mediaUploadTarget.linkedRequestId != null &&
            Number.isFinite(Number(mediaUploadTarget.linkedRequestId))
              ? Number(mediaUploadTarget.linkedRequestId)
              : undefined
          }
        />
      ) : null}
      {!viewOnly ? <UploadCompleteDialog notice={uploadCompleteNotice} /> : null}
      {kind === 'drone' && geomEditFile && !viewOnly ? (
        <DroneFileGeomEdit
          file={geomEditFile}
          onClose={() => setGeomEditFile(null)}
          onSaved={() => {
            setGeomEditFile(null);
            void refreshDroneWorkUnitList();
            void refreshBizNotifs();
          }}
        />
      ) : null}
    </div>
  );
}
