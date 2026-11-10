import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { DrawingCrsCode } from './drawingDisplayConfig';

export type DrawingDisplayItem = {
  id: string;
  fileName: string;
  /** 업로드 시각 (ISO) */
  createdAt: string;
  /** 새로고침 복원용 ASCII DXF 본문 */
  dxfText: string;
  features: Feature<Geometry>[];
  crs: DrawingCrsCode;
  manualCrs: boolean;
  mapCrsReady: boolean;
  visible: boolean;
  parseNote: string | null;
  shouldFit: boolean;
};
