import type { AerialKind, AttrRow, WorkFileItem, WorkUnitItem } from './aerialMediaTypes';
import { KIND_TO_FOLDER_TOKEN } from './aerialMediaRoots';

/**
 * 화면 표시용 목업 — 실 API·DB 호출 없음.
 * locationLabel = EPSG:5181 (x, y). 기본 지도 중심(안동) 인근으로 배치해
 * 작업단위 선택 시 fit / 파일 선택 시 fly 확인용.
 */
/** 드론영상 — DB 목록으로 교체. 초기값은 빈 배열(목업 시드 없음). */
export const MOCK_ORTHO_UNITS: WorkUnitItem[] = [];

export const MOCK_DRONE_UNITS: WorkUnitItem[] = [
  {
    id: 'drone-1',
    workDate: '2026-07-05',
    workName: '안동 시내 현장 점검',
    folderName: '20260705_사진동영상_5181_안동 시내 현장 점검',
    kind: 'drone',
    crsHint: '5181',
    attrs: [
      { label: '작업단위 명', value: '안동 시내 현장 점검' },
      { label: '작업일', value: '2026-07-05' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '임무/작업 목적', value: '공사 현장 진행 점검' },
      { label: '작성자', value: '최드론' },
      { label: '촬영자', value: '최드론' },
      { label: '촬영일시', value: '2026-07-05 11:30' },
      { label: '촬영기기', value: 'DJI Mini 4 Pro' },
      { label: '파일 포맷', value: 'JPEG / MP4' },
      { label: '메모', value: '오전 맑음, 풍속 2m/s' },
    ],
    files: [
      {
        id: 'df-1',
        name: 'photo_001.jpg',
        sizeLabel: '8.2 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '354416.2, 342457.5',
      },
      {
        id: 'df-2',
        name: 'photo_002.jpg',
        sizeLabel: '7.9 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '354859.9, 342687.5',
      },
      {
        id: 'df-3',
        name: 'clip_001.mp4',
        sizeLabel: '124 MB',
        format: 'mp4',
        status: 'registered',
        previewKind: 'video',
        locationLabel: '353974.6, 342116.5',
      },
      {
        id: 'df-4',
        name: 'photo_003.jpg',
        sizeLabel: '8.0 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '354605.3, 341905.8',
      },
    ],
  },
  {
    id: 'drone-2',
    workDate: '2026-07-04',
    workName: '안동 남동 도로 점검',
    folderName: '20260704_사진동영상_5181_안동 남동 도로 점검',
    kind: 'drone',
    crsHint: '5181',
    attrs: [
      { label: '작업단위 명', value: '안동 남동 도로 점검' },
      { label: '작업일', value: '2026-07-04' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '임무/작업 목적', value: '도로 포장 상태 촬영' },
      { label: '작성자', value: '정도로' },
      { label: '촬영자', value: '정도로' },
      { label: '촬영일시', value: '2026-07-04 15:00' },
      { label: '촬영기기', value: 'DJI Air 3' },
      { label: '파일 포맷', value: 'JPEG' },
      { label: '메모', value: '—' },
    ],
    files: [
      {
        id: 'df-5',
        name: 'road_01.jpg',
        sizeLabel: '6.1 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '356232.9, 341047.0',
      },
      {
        id: 'df-6',
        name: 'road_02.jpg',
        sizeLabel: '6.4 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '356674.6, 341388.1',
      },
      {
        id: 'df-7',
        name: 'road_03.jpg',
        sizeLabel: '6.2 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'image',
        locationLabel: '355970.3, 340709.2',
      },
    ],
  },
];

/** 서버 listWorkUnits(panorama) 로 채움 */
export const MOCK_PANO_UNITS: WorkUnitItem[] = [];

/** 서버 listWorkUnits(satellite) 로 채움 */
export const MOCK_SAT_UNITS: WorkUnitItem[] = [];

export function mockUnitsForKind(kind: WorkUnitItem['kind']): WorkUnitItem[] {
  switch (kind) {
    case 'ortho':
      return MOCK_ORTHO_UNITS;
    case 'drone':
      return MOCK_DRONE_UNITS;
    case 'panorama':
      return MOCK_PANO_UNITS;
    case 'satellite':
      return MOCK_SAT_UNITS;
  }
}

/** 속성정보 수정(목업) — 같은 세션 동안 메모리 배열에 반영해 재선택 시 유지 */
export function updateWorkUnitAttrs(
  kind: WorkUnitItem['kind'],
  unitId: string,
  next: { attrs?: AttrRow[] }
): void {
  const unit = mockUnitsForKind(kind).find((u) => u.id === unitId);
  if (!unit) return;
  if (next.attrs) unit.attrs = next.attrs;
}

type MockUnitsListener = () => void;
const mockUnitsListeners = new Set<MockUnitsListener>();
/** 목록 리렌더용 — 업로드·변환 목업이 배열을 바꿀 때 */
export function subscribeMockWorkUnits(listener: MockUnitsListener): () => void {
  mockUnitsListeners.add(listener);
  return () => mockUnitsListeners.delete(listener);
}

function emitMockWorkUnits(): void {
  for (const l of mockUnitsListeners) l();
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 작업단위 폴더 생성 후 목록에 추가 (파일은 비움 — 상세에서 추가).
 */
export function addWorkUnitFromFolderCreate(params: {
  kind: AerialKind;
  workName: string;
  folderName: string;
  linkedRequestId?: string;
  wuKey?: number;
}): WorkUnitItem {
  const { kind, workName, folderName, linkedRequestId, wuKey } = params;
  const workDate = todayYmd();
  const id = wuKey != null ? `wu-${wuKey}` : `up-${kind}-${Date.now()}`;
  const kindToken = KIND_TO_FOLDER_TOKEN[kind];

  // 이미 같은 폴더/키가 있으면 재사용
  const existing = mockUnitsForKind(kind).find(
    (u) => u.folderName === folderName || (wuKey != null && u.id === `wu-${wuKey}`)
  );
  if (existing) {
    if (linkedRequestId) existing.linkedRequestId = linkedRequestId;
    emitMockWorkUnits();
    return existing;
  }

  const attrs: AttrRow[] =
    kind === 'panorama'
      ? [
          { label: '작업단위 명', value: workName },
          { label: '작업일', value: workDate },
          { label: '작성자', value: '—' },
          { label: '촬영자', value: '—' },
          { label: '작업목적', value: workName },
          { label: '메모', value: '—' },
        ]
      : kind === 'drone'
        ? [
            { label: '작업단위 명', value: workName },
            { label: '작업일', value: workDate },
            { label: '좌표계', value: 'EPSG:5181' },
            { label: '임무/작업 목적', value: workName },
            { label: '작성자', value: '—' },
            { label: '촬영자', value: '—' },
            { label: '상태', value: '폴더생성' },
            { label: '메모', value: '—' },
          ]
        : kind === 'ortho'
          ? [
              { label: '작업단위', value: workName },
              { label: '작업일', value: workDate },
              { label: '좌표계', value: 'EPSG:5181' },
              { label: '임무/작업 목적', value: workName },
              { label: '작성자', value: '—' },
              { label: '상태', value: '폴더생성' },
              { label: '메모', value: '—' },
            ]
          : [
              { label: '작업단위 파일명', value: folderName },
              { label: '작업일', value: workDate },
              { label: '업로드일', value: workDate },
              { label: '구분', value: kindToken },
              { label: '좌표계', value: 'EPSG:5181' },
              { label: '임무/작업 목적', value: workName },
              { label: '작성자', value: '—' },
              { label: '상태', value: '폴더생성' },
            ];

  if (linkedRequestId && kind !== 'ortho') {
    attrs.push({ label: '연결 신청', value: linkedRequestId });
  }

  const unit: WorkUnitItem = {
    id,
    workDate,
    workName,
    folderName,
    kind,
    crsHint: '5181',
    status: 'pending',
    uploadedAt: workDate,
    linkedRequestId,
    attrs,
    files: [],
  };

  mockUnitsForKind(kind).unshift(unit);
  emitMockWorkUnits();
  return unit;
}

/** DB 목록으로 작업단위 파일 배열 교체 (사진·동영상) */
export function applyWorkUnitMediaFiles(
  kind: AerialKind,
  folderName: string,
  mediaItems: Array<{
    fuKey?: number;
    wuKey?: number;
    fileName: string;
    sizeLabel: string;
    format: string;
    previewKind: 'image' | 'video' | 'panorama';
    locationLabel: string | null;
    relativePath?: string;
    x5181?: number | null;
    y5181?: number | null;
  }>
): void {
  const unit = mockUnitsForKind(kind).find((u) => u.folderName === folderName);
  if (!unit) return;
  unit.files = mediaItems.map((m) => ({
    id: m.fuKey != null ? `fu-${m.fuKey}` : `wu-${m.wuKey ?? m.fileName}`,
    name: m.fileName,
    sizeLabel: m.sizeLabel,
    format: m.format,
    status: 'registered' as const,
    previewKind: kind === 'panorama' ? ('panorama' as const) : m.previewKind,
    locationLabel: m.locationLabel ?? undefined,
    x5181: m.x5181 ?? undefined,
    y5181: m.y5181 ?? undefined,
    relativePath: m.relativePath,
  }));
  const st = unit.attrs.find((a) => a.label === '상태');
  if (st) st.value = mediaItems.length > 0 ? '업로드완료' : '폴더생성';
  unit.status = mediaItems.length > 0 ? 'registered' : 'pending';
  emitMockWorkUnits();
}

/**
 * DB 작업단위 목록으로 사진·동영상 목록 교체.
 */
export function replaceDroneUnitsFromServer(
  units: Parameters<typeof replaceMediaUnitsFromServer>[1]
): void {
  replaceMediaUnitsFromServer('drone', units);
}

export function replacePanoUnitsFromServer(
  units: Parameters<typeof replaceMediaUnitsFromServer>[1]
): void {
  replaceMediaUnitsFromServer('panorama', units);
}

function mapConvertStatus(raw: string | undefined): WorkFileItem['status'] {
  if (raw === 'done' || raw === 'converting' || raw === 'pending' || raw === 'failed' || raw === 'registered') {
    return raw;
  }
  return 'pending';
}

/** DB 작업단위 목록으로 드론영상(ortho) 목록 교체 */
export function replaceOrthoUnitsFromServer(
  units: Array<{
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
      fuKey?: number;
      fileName: string;
      sizeLabel: string;
      format: string;
      convertStatus?: string;
      tilesRelativePath?: string | null;
      relativePath?: string;
    }>;
  }>
): void {
  MOCK_ORTHO_UNITS.length = 0;
  for (const u of units) {
    const workDate = u.workDate || todayYmd();
    const workName = u.workName || u.folderName;
    const files: WorkFileItem[] = u.items.map((m) => {
      const status = mapConvertStatus(m.convertStatus);
      const id =
        m.tuKey != null
          ? `tu-${m.tuKey}`
          : m.fuKey != null
            ? `fu-${m.fuKey}`
            : `tif-${m.fileName}`;
      return {
        id,
        name: m.fileName,
        sizeLabel: m.sizeLabel,
        format: m.format,
        status,
        tuKey: m.tuKey,
        tilesRelativePath: m.tilesRelativePath,
        relativePath: m.relativePath,
      };
    });
    const unitStatus =
      files.some((f) => f.status === 'converting')
        ? 'converting'
        : files.some((f) => f.status === 'failed')
          ? 'failed'
          : files.some((f) => f.status === 'pending')
            ? 'pending'
            : files.length > 0
              ? 'done'
              : 'pending';
    MOCK_ORTHO_UNITS.push({
      id: `wu-${u.wuKey}`,
      workDate,
      workName,
      folderName: u.folderName,
      kind: 'ortho',
      crsHint: '5181',
      status: unitStatus,
      uploadedAt: workDate,
      linkedRequestId: u.srKey != null ? String(u.srKey) : undefined,
      attrs: [
        { label: '작업단위', value: workName },
        { label: '작업일', value: workDate },
        { label: '좌표계', value: 'EPSG:5181' },
        { label: '임무/작업 목적', value: u.workPurpose || workName },
        { label: '작성자', value: u.author || '—' },
        {
          label: '상태',
          value:
            unitStatus === 'done'
              ? '변환완료'
              : unitStatus === 'converting'
                ? '변환중'
                : unitStatus === 'failed'
                  ? '변환실패'
                  : files.length > 0
                    ? '대기'
                    : '폴더생성',
        },
        { label: '메모', value: u.memo || '—' },
      ],
      files,
    });
  }
  emitMockWorkUnits();
}

/** DB 작업단위 목록으로 항공영상(satellite) 목록 교체 */
export function replaceSatelliteUnitsFromServer(
  units: Parameters<typeof replaceOrthoUnitsFromServer>[0]
): void {
  MOCK_SAT_UNITS.length = 0;
  for (const u of units) {
    const workDate = u.workDate || todayYmd();
    const workName = u.workName || u.folderName;
    const files: WorkFileItem[] = u.items.map((m) => {
      const status = mapConvertStatus(m.convertStatus);
      const id =
        m.tuKey != null
          ? `tu-${m.tuKey}`
          : m.fuKey != null
            ? `fu-${m.fuKey}`
            : `tif-${m.fileName}`;
      return {
        id,
        name: m.fileName,
        sizeLabel: m.sizeLabel,
        format: m.format,
        status,
        tuKey: m.tuKey,
        tilesRelativePath: m.tilesRelativePath,
        relativePath: m.relativePath,
      };
    });
    const unitStatus =
      files.some((f) => f.status === 'converting')
        ? 'converting'
        : files.some((f) => f.status === 'failed')
          ? 'failed'
          : files.some((f) => f.status === 'pending')
            ? 'pending'
            : files.length > 0
              ? 'done'
              : 'pending';
    MOCK_SAT_UNITS.push({
      id: `wu-${u.wuKey}`,
      workDate,
      workName,
      folderName: u.folderName,
      kind: 'satellite',
      crsHint: '5181',
      status: unitStatus === 'done' ? 'registered' : unitStatus,
      uploadedAt: workDate,
      linkedRequestId: u.srKey != null ? String(u.srKey) : undefined,
      attrs: [
        { label: '작업단위', value: workName },
        { label: '작업일', value: workDate },
        { label: '좌표계', value: 'EPSG:5181' },
        { label: '임무/작업 목적', value: u.workPurpose || workName },
        { label: '작성자', value: u.author || '—' },
        {
          label: '상태',
          value:
            unitStatus === 'done'
              ? '배경지도 자체항공영상 등록'
              : unitStatus === 'converting'
                ? '자체항공영상 등록 중'
                : unitStatus === 'failed'
                  ? '등록 실패'
                  : files.length > 0
                    ? '대기'
                    : '폴더생성',
        },
        { label: '메모', value: u.memo || '—' },
      ],
      files,
    });
  }
  emitMockWorkUnits();
}

export function removeSatelliteUnitFromStore(unitId: string): void {
  const idx = MOCK_SAT_UNITS.findIndex((u) => u.id === unitId);
  if (idx < 0) return;
  MOCK_SAT_UNITS.splice(idx, 1);
  emitMockWorkUnits();
}

export function removeSatelliteFileFromStore(unitId: string, fileId: string): void {
  const unit = MOCK_SAT_UNITS.find((u) => u.id === unitId);
  if (!unit) return;
  unit.files = unit.files.filter((f) => f.id !== fileId);
  emitMockWorkUnits();
}

export function removeOrthoUnitFromStore(unitId: string): void {
  const idx = MOCK_ORTHO_UNITS.findIndex((u) => u.id === unitId);
  if (idx < 0) return;
  MOCK_ORTHO_UNITS.splice(idx, 1);
  emitMockWorkUnits();
}

export function removeOrthoFileFromStore(unitId: string, fileId: string): void {
  const unit = MOCK_ORTHO_UNITS.find((u) => u.id === unitId);
  if (!unit) return;
  unit.files = unit.files.filter((f) => f.id !== fileId);
  emitMockWorkUnits();
}

/** 작업단위 삭제 후 목록에서 제거 */
export function removeDroneUnitFromStore(unitId: string): void {
  removeMediaUnitFromStore('drone', unitId);
}

/** 파일 1건 삭제 후 작업단위 파일 목록에서 제거 */
export function removeDroneFileFromStore(unitId: string, fileId: string): void {
  removeMediaFileFromStore('drone', unitId, fileId);
}

function mediaUnitsArray(kind: 'drone' | 'panorama'): WorkUnitItem[] {
  return kind === 'drone' ? MOCK_DRONE_UNITS : MOCK_PANO_UNITS;
}

export function removeMediaUnitFromStore(kind: 'drone' | 'panorama', unitId: string): void {
  const arr = mediaUnitsArray(kind);
  const idx = arr.findIndex((u) => u.id === unitId);
  if (idx < 0) return;
  arr.splice(idx, 1);
  emitMockWorkUnits();
}

export function removeMediaFileFromStore(
  kind: 'drone' | 'panorama',
  unitId: string,
  fileId: string
): void {
  const unit = mediaUnitsArray(kind).find((u) => u.id === unitId);
  if (!unit) return;
  const next = unit.files.filter((f) => f.id !== fileId);
  if (next.length === unit.files.length) return;
  unit.files = next;
  unit.status = next.length > 0 ? 'registered' : 'pending';
  const st = unit.attrs.find((a) => a.label === '상태');
  if (st) st.value = next.length > 0 ? '업로드완료' : '폴더생성';
  emitMockWorkUnits();
}

/**
 * DB 작업단위 목록으로 사진·동영상 또는 파노라마 목록 교체.
 */
export function replaceMediaUnitsFromServer(
  kind: 'drone' | 'panorama',
  units: Array<{
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
      previewKind: 'image' | 'video' | 'panorama';
      locationLabel: string | null;
      relativePath?: string;
      x5181?: number | null;
      y5181?: number | null;
    }>;
  }>
): void {
  const arr = mediaUnitsArray(kind);
  arr.length = 0;
  for (const u of units) {
    const workDate = u.workDate || todayYmd();
    const workName = u.workName || u.folderName;
    const files = u.items.map((m) => ({
      id: `fu-${m.fuKey}`,
      name: m.fileName,
      sizeLabel: m.sizeLabel,
      format: m.format,
      status: 'registered' as const,
      previewKind: m.previewKind,
      locationLabel: m.locationLabel ?? undefined,
      x5181: m.x5181 ?? undefined,
      y5181: m.y5181 ?? undefined,
      relativePath: m.relativePath,
    }));
    arr.push({
      id: `wu-${u.wuKey}`,
      workDate,
      workName,
      folderName: u.folderName,
      kind,
      crsHint: '5181',
      status: files.length > 0 ? 'registered' : 'pending',
      uploadedAt: workDate,
      linkedRequestId: u.srKey != null ? String(u.srKey) : undefined,
      attrs: [
        { label: '작업단위 명', value: workName },
        { label: '작업일', value: workDate },
        { label: '좌표계', value: 'EPSG:5181' },
        { label: '임무/작업 목적', value: u.workPurpose || workName },
        { label: '작성자', value: u.author || '—' },
        { label: '촬영자', value: u.photographer || '—' },
        { label: '상태', value: files.length > 0 ? '업로드완료' : '폴더생성' },
        { label: '메모', value: u.memo || '—' },
        ...(u.srKey != null ? [{ label: '연결 신청', value: String(u.srKey) }] : []),
      ],
      files,
    });
  }
  emitMockWorkUnits();
}

