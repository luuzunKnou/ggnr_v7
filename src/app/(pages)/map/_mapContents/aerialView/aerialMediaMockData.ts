import type { AerialKind, AttrRow, WorkFileItem, WorkUnitItem } from './aerialMediaTypes';
import { KIND_TO_FOLDER_TOKEN } from './aerialMediaRoots';

/**
 * 화면 표시용 목업 — 실 API·DB 호출 없음.
 * locationLabel = EPSG:5181 (x, y). 기본 지도 중심(안동) 인근으로 배치해
 * 작업단위 선택 시 fit / 파일 선택 시 fly 확인용.
 */
export const MOCK_ORTHO_UNITS: WorkUnitItem[] = [
  {
    id: 'ortho-1',
    workDate: '2026-07-03',
    workName: '안동 시내 정사',
    folderName: '20260703_드론영상_5181_안동 시내 정사',
    kind: 'ortho',
    crsHint: '5181',
    attrs: [
      { label: '작업단위', value: '안동 시내 정사' },
      { label: '작업일', value: '2026-07-03' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '임무/작업 목적', value: '시내 시설 현황 파악 및 정사 제작' },
      { label: '작성자', value: '김영상' },
      { label: '제작일시', value: '2026-07-03 14:20' },
      { label: '촬영기기', value: 'DJI Mavic 3 Enterprise' },
      { label: '제작/배포 기관', value: '안동시' },
      { label: '해상도', value: '5 cm/pixel' },
      { label: '메타 작성일', value: '2026-07-03' },
      { label: '메모', value: '안동 시청 인근' },
    ],
    files: [
      {
        id: 'of-1',
        name: 'ortho_001.tif',
        sizeLabel: '1.2 GB',
        format: 'tif',
        status: 'done',
        locationLabel: '354231.4, 342276.5',
      },
      {
        id: 'of-2',
        name: 'ortho_002.tif',
        sizeLabel: '980 MB',
        format: 'tif',
        status: 'converting',
        locationLabel: '354682.8, 342573.3',
      },
      {
        id: 'of-3',
        name: 'ortho_003.tif',
        sizeLabel: '1.1 GB',
        format: 'tif',
        status: 'pending',
        locationLabel: '353801.5, 341780.4',
      },
    ],
  },
  {
    id: 'ortho-2',
    workDate: '2026-07-01',
    workName: '안동 동측 정사',
    folderName: '20260701_드론영상_5181_안동 동측 정사',
    kind: 'ortho',
    crsHint: '5181',
    attrs: [
      { label: '작업단위', value: '안동 동측 정사' },
      { label: '작업일', value: '2026-07-01' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '임무/작업 목적', value: '동측 일원 정사 갱신' },
      { label: '작성자', value: '이정사' },
      { label: '제작일시', value: '2026-07-01 09:10' },
      { label: '촬영기기', value: 'WingtraOne GEN II' },
      { label: '제작/배포 기관', value: '안동시' },
      { label: '해상도', value: '8 cm/pixel' },
      { label: '메타 작성일', value: '2026-07-01' },
      { label: '메모', value: '—' },
    ],
    files: [
      {
        id: 'of-4',
        name: 'east_mosaic_a.tif',
        sizeLabel: '2.1 GB',
        format: 'tif',
        status: 'done',
        locationLabel: '355303.5, 342917.5',
      },
      {
        id: 'of-5',
        name: 'east_mosaic_b.tif',
        sizeLabel: '1.8 GB',
        format: 'tif',
        status: 'done',
        locationLabel: '355745.0, 343258.6',
      },
    ],
  },
  {
    id: 'ortho-3',
    workDate: '2026-06-20',
    workName: '안동 남서 정사',
    folderName: '20260620_드론영상_5181_안동 남서 정사',
    kind: 'ortho',
    crsHint: '5181',
    attrs: [
      { label: '작업단위', value: '안동 남서 정사' },
      { label: '작업일', value: '2026-06-20' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '임무/작업 목적', value: '남서측 하천·제방 현황' },
      { label: '작성자', value: '박하천' },
      { label: '제작일시', value: '2026-06-20 16:45' },
      { label: '촬영기기', value: 'DJI Phantom 4 RTK' },
      { label: '제작/배포 기관', value: '안동시' },
      { label: '해상도', value: '3 cm/pixel' },
      { label: '메타 작성일', value: '2026-06-21' },
      { label: '메모', value: '낙동강 인근' },
    ],
    files: [
      {
        id: 'of-6',
        name: 'sw_a.tif',
        sizeLabel: '720 MB',
        format: 'tif',
        status: 'done',
        locationLabel: '353093.1, 341323.7',
      },
      {
        id: 'of-7',
        name: 'sw_b.tif',
        sizeLabel: '690 MB',
        format: 'tif',
        status: 'done',
        locationLabel: '353546.7, 340998.7',
      },
      {
        id: 'of-8',
        name: 'sw_c.tif',
        sizeLabel: '710 MB',
        format: 'tif',
        status: 'done',
        locationLabel: '352641.5, 341537.7',
      },
    ],
  },
];

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

export const MOCK_PANO_UNITS: WorkUnitItem[] = [
  {
    id: 'pano-1',
    workDate: '2026-07-06',
    workName: '안동 서측 파노라마',
    folderName: '20260706_파노라마_5181_안동 서측 파노라마',
    kind: 'panorama',
    crsHint: '5181',
    attrs: [
      { label: '작업단위 명', value: '안동 서측 파노라마' },
      { label: '작업일', value: '2026-07-06' },
      { label: '작성자', value: '한파노' },
      { label: '촬영자', value: '한파노' },
      { label: '작업목적', value: '교차로 시야 확보용 파노라마' },
      { label: '메모', value: '뷰어 연동 목업' },
    ],
    files: [
      {
        id: 'pf-1',
        name: 'pano_001.jpg',
        sizeLabel: '18 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'panorama',
        locationLabel: '351985.4, 343191.3',
      },
      {
        id: 'pf-2',
        name: 'pano_002.jpg',
        sizeLabel: '17 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'panorama',
        locationLabel: '352337.5, 343530.6',
      },
      {
        id: 'pf-3',
        name: 'pano_003.jpg',
        sizeLabel: '16 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'panorama',
        locationLabel: '351722.7, 342853.6',
      },
    ],
  },
  {
    id: 'pano-2',
    workDate: '2026-07-02',
    workName: '안동 남측 파노라마',
    folderName: '20260702_파노라마_5181_안동 남측 파노라마',
    kind: 'panorama',
    crsHint: '5181',
    attrs: [
      { label: '작업단위 명', value: '안동 남측 파노라마' },
      { label: '작업일', value: '2026-07-02' },
      { label: '작성자', value: '송공원' },
      { label: '촬영자', value: '송공원' },
      { label: '작업목적', value: '공원·광장 시야' },
      { label: '메모', value: '—' },
    ],
    files: [
      {
        id: 'pf-4',
        name: 'park_pano_a.jpg',
        sizeLabel: '15 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'panorama',
        locationLabel: '354919.8, 339358.0',
      },
      {
        id: 'pf-5',
        name: 'park_pano_b.jpg',
        sizeLabel: '14 MB',
        format: 'jpg',
        status: 'registered',
        previewKind: 'panorama',
        locationLabel: '355363.5, 339588.0',
      },
    ],
  },
];

export const MOCK_SAT_UNITS: WorkUnitItem[] = [
  {
    id: 'sat-1',
    workDate: '2024-01-01',
    workName: '2024 항공',
    folderName: '20240101_항공영상_5181_2024 항공',
    kind: 'satellite',
    crsHint: '5181',
    status: 'registered',
    uploadedAt: '2024-03-12',
    attrs: [
      { label: '작업단위 파일명', value: '20240101_항공영상_5181_2024 항공' },
      { label: '작업일', value: '2024-01-01' },
      { label: '업로드일', value: '2024-03-12' },
      { label: '작업명', value: '2024 항공' },
      { label: '임무/작업 목적', value: '연간 항공영상 갱신' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '상태', value: '배경지도 자체항공영상 등록' },
    ],
    files: [
      {
        id: 'sf-1',
        name: 'aerial_2024_n.tif',
        sizeLabel: '4.2 GB',
        format: 'tif',
        status: 'done',
      },
      {
        id: 'sf-2',
        name: 'aerial_2024_ne.tif',
        sizeLabel: '3.9 GB',
        format: 'tif',
        status: 'done',
      },
      {
        id: 'sf-3',
        name: 'aerial_2024_c.tif',
        sizeLabel: '4.0 GB',
        format: 'tif',
        status: 'done',
      },
    ],
  },
  {
    id: 'sat-2',
    workDate: '2023-01-01',
    workName: '2023 항공',
    folderName: '20230101_항공영상_5181_2023 항공',
    kind: 'satellite',
    crsHint: '5181',
    status: 'registered',
    uploadedAt: '2023-04-08',
    attrs: [
      { label: '작업단위 파일명', value: '20230101_항공영상_5181_2023 항공' },
      { label: '작업일', value: '2023-01-01' },
      { label: '업로드일', value: '2023-04-08' },
      { label: '작업명', value: '2023 항공' },
      { label: '임무/작업 목적', value: '연간 항공영상 갱신' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '상태', value: '배경지도 자체항공영상 등록' },
    ],
    files: [
      {
        id: 'sf-4',
        name: 'aerial_2023_nw.tif',
        sizeLabel: '3.5 GB',
        format: 'tif',
        status: 'done',
      },
      {
        id: 'sf-5',
        name: 'aerial_2023_n.tif',
        sizeLabel: '3.6 GB',
        format: 'tif',
        status: 'done',
      },
    ],
  },
  {
    id: 'sat-3',
    workDate: '2022-01-01',
    workName: '2022 항공',
    folderName: '20220101_항공영상_5181_2022 항공',
    kind: 'satellite',
    crsHint: '5181',
    status: 'converting',
    uploadedAt: '2022-05-20',
    attrs: [
      { label: '작업단위 파일명', value: '20220101_항공영상_5181_2022 항공' },
      { label: '작업일', value: '2022-01-01' },
      { label: '업로드일', value: '2022-05-20' },
      { label: '작업명', value: '2022 항공' },
      { label: '임무/작업 목적', value: '연간 항공영상 갱신' },
      { label: '좌표계', value: 'EPSG:5181' },
      { label: '상태', value: '타일 변환 중' },
    ],
    files: [
      {
        id: 'sf-6',
        name: 'aerial_2022_c.tif',
        sizeLabel: '3.1 GB',
        format: 'tif',
        status: 'converting',
      },
    ],
  },
];

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
const convertTimers = new Map<string, number>();

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
 * 폴더 업로드 완료 목업 → 목록에 작업단위 추가.
 * 드론영상(정사): 바로 «변환중» → 수 초 후 «변환완료».
 * 사진·동영상·파노라마: «업로드완료»로 끝.
 */
export function addWorkUnitFromUploadMock(params: {
  kind: AerialKind;
  workName: string;
  folderName: string;
  fileTotal: number;
  linkedRequestId?: string;
}): WorkUnitItem {
  const { kind, workName, folderName, fileTotal, linkedRequestId } = params;
  const workDate = todayYmd();
  const id = `up-${kind}-${Date.now()}`;
  const n = Math.max(1, Math.min(fileTotal, 4));
  const kindToken = KIND_TO_FOLDER_TOKEN[kind];
  const isOrtho = kind === 'ortho';

  const files: WorkFileItem[] = Array.from({ length: n }, (_, i) => {
    const idx = i + 1;
    if (isOrtho) {
      return {
        id: `${id}-f${idx}`,
        name: `ortho_${String(idx).padStart(3, '0')}.tif`,
        sizeLabel: `${(0.8 + i * 0.2).toFixed(1)} GB`,
        format: 'tif',
        status: 'converting' as const,
        locationLabel: `${(354200 + i * 120).toFixed(1)}, ${(342200 + i * 80).toFixed(1)}`,
      };
    }
    if (kind === 'panorama') {
      return {
        id: `${id}-f${idx}`,
        name: `pano_${String(idx).padStart(3, '0')}.jpg`,
        sizeLabel: `${(40 + i * 5).toFixed(0)} MB`,
        format: 'jpg',
        status: 'registered' as const,
        previewKind: 'panorama' as const,
        locationLabel: `${(354200 + i * 90).toFixed(1)}, ${(342200 + i * 60).toFixed(1)}`,
      };
    }
    if (kind === 'satellite') {
      return {
        id: `${id}-f${idx}`,
        name: `aerial_${workDate.replace(/-/g, '')}_${idx}.tif`,
        sizeLabel: `${(2.5 + i * 0.3).toFixed(1)} GB`,
        format: 'tif',
        status: 'done' as const,
      };
    }
    const video = i % 2 === 1;
    return {
      id: `${id}-f${idx}`,
      name: video ? `clip_${String(idx).padStart(3, '0')}.mp4` : `img_${String(idx).padStart(3, '0')}.jpg`,
      sizeLabel: video ? `${(120 + i * 20).toFixed(0)} MB` : `${(8 + i).toFixed(0)} MB`,
      format: video ? 'mp4' : 'jpg',
      status: 'registered' as const,
      previewKind: video ? ('video' as const) : ('image' as const),
      locationLabel: `${(354200 + i * 100).toFixed(1)}, ${(342200 + i * 70).toFixed(1)}`,
    };
  });

  const attrs: AttrRow[] =
    kind === 'panorama'
      ? [
          { label: '작업단위 명', value: workName },
          { label: '작업일', value: workDate },
          { label: '작성자', value: '업로드(목업)' },
          { label: '촬영자', value: '업로드(목업)' },
          { label: '작업목적', value: workName },
          { label: '메모', value: '—' },
        ]
      : kind === 'drone'
        ? [
            { label: '작업단위 명', value: workName },
            { label: '작업일', value: workDate },
            { label: '좌표계', value: 'EPSG:5181' },
            { label: '임무/작업 목적', value: workName },
            { label: '작성자', value: '업로드(목업)' },
            { label: '촬영자', value: '업로드(목업)' },
            { label: '상태', value: '업로드완료' },
            { label: '메모', value: '—' },
          ]
        : kind === 'ortho'
          ? [
              { label: '작업단위', value: workName },
              { label: '작업일', value: workDate },
              { label: '좌표계', value: 'EPSG:5181' },
              { label: '임무/작업 목적', value: workName },
              { label: '작성자', value: '업로드(목업)' },
              { label: '상태', value: '타일 변환 중' },
              { label: '메모', value: '—' },
            ]
          : [
              { label: '작업단위 파일명', value: folderName },
              { label: '작업일', value: workDate },
              { label: '업로드일', value: workDate },
              { label: '구분', value: kindToken },
              { label: '좌표계', value: 'EPSG:5181' },
              { label: '임무/작업 목적', value: workName },
              { label: '작성자', value: '업로드(목업)' },
              { label: '상태', value: '업로드완료' },
            ];

  if (linkedRequestId) {
    attrs.push({ label: '연결 신청', value: linkedRequestId });
  }

  const unit: WorkUnitItem = {
    id,
    workDate,
    workName,
    folderName,
    kind,
    crsHint: '5181',
    status: isOrtho ? 'converting' : kind === 'satellite' ? 'registered' : undefined,
    uploadedAt: workDate,
    linkedRequestId,
    attrs,
    files,
  };

  mockUnitsForKind(kind).unshift(unit);
  emitMockWorkUnits();

  if (isOrtho) {
    scheduleOrthoConvertMock(unit.id);
  }

  return unit;
}

/** 드론영상: 업로드 직후 변환중 → 약 8초 후 변환완료 (목업) */
function scheduleOrthoConvertMock(unitId: string): void {
  const prev = convertTimers.get(unitId);
  if (prev) window.clearTimeout(prev);

  const t = window.setTimeout(() => {
    convertTimers.delete(unitId);
    const unit = MOCK_ORTHO_UNITS.find((u) => u.id === unitId);
    if (!unit) return;
    unit.status = 'done';
    for (const f of unit.files) {
      if (f.status === 'converting' || f.status === 'pending') f.status = 'done';
    }
    const st = unit.attrs.find((a) => a.label === '상태');
    if (st) st.value = '변환완료';
    else unit.attrs.push({ label: '상태', value: '변환완료' });
    emitMockWorkUnits();
  }, 8000);

  convertTimers.set(unitId, t);
}
