import type { RoadRewardCase, RoadRewardParcel } from "./roadRewardMock";
import { withRoadRewardCompensationTotal } from "./roadRewardMock";

/** roadRewardService DTO (client) */
export type RoadRewardParcelDtoClient = {
  id: string;
  ogcFid?: number;
  pnu?: string;
  eupmyeonDong?: string;
  jibunOriginal?: string;
  jibunIncluded?: string;
  areaOriginal?: number;
  areaIncluded?: number;
  jimok?: string;
  appraisal1Value?: number;
  appraisal2Value?: number;
  appliedUnitPrice?: number;
  compensationAmount?: number;
  farmingCompensationAmount?: number;
  obstacleCompensationAmount?: number;
  ownerAddress?: string;
  ownerName?: string;
  actualOwner?: string;
  actualCultivator?: string;
  note?: string;
  geometry3857?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  mockLonLat?: { lon: number; lat: number };
};

export type RoadRewardCaseDtoClient = {
  id: string;
  ogcFid?: number;
  name?: string;
  org?: string;
  policy?: string;
  unit?: string;
  detail?: string;
  budgetItem?: string;
  statItem?: string;
  appraisal1Name?: string;
  appraisal2Name?: string;
  geometry3857?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  parcels?: RoadRewardParcelDtoClient[];
  parcelCount?: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function mapRoadRewardParcelDto(dto: RoadRewardParcelDtoClient): RoadRewardParcel {
  return withRoadRewardCompensationTotal({
    id: String(dto.id),
    pnu: dto.pnu ? String(dto.pnu) : undefined,
    eupmyeonDong: String(dto.eupmyeonDong ?? ""),
    jibunOriginal: String(dto.jibunOriginal ?? ""),
    jibunIncluded: String(dto.jibunIncluded ?? ""),
    areaOriginal: num(dto.areaOriginal),
    areaIncluded: num(dto.areaIncluded),
    jimok: String(dto.jimok ?? ""),
    appraisal1Value: num(dto.appraisal1Value),
    appraisal2Value: num(dto.appraisal2Value),
    appliedUnitPrice: num(dto.appliedUnitPrice),
    compensationAmount: num(dto.compensationAmount),
    farmingCompensationAmount: num(dto.farmingCompensationAmount),
    obstacleCompensationAmount: num(dto.obstacleCompensationAmount),
    compensationTotal: 0,
    ownerAddress: String(dto.ownerAddress ?? ""),
    ownerName: String(dto.ownerName ?? ""),
    actualOwner: String(dto.actualOwner ?? ""),
    actualCultivator: String(dto.actualCultivator ?? ""),
    note: String(dto.note ?? ""),
    geometry3857: dto.geometry3857 ?? null,
    extent3857: dto.extent3857 ?? null,
    mockLonLat: dto.mockLonLat,
  });
}

export function mapRoadRewardDtoToCase(dto: RoadRewardCaseDtoClient): RoadRewardCase {
  const parcels = Array.isArray(dto.parcels) ? dto.parcels.map(mapRoadRewardParcelDto) : [];
  return {
    id: String(dto.id),
    name: String(dto.name ?? ""),
    org: String(dto.org ?? ""),
    policy: String(dto.policy ?? ""),
    unit: String(dto.unit ?? ""),
    detail: String(dto.detail ?? ""),
    budgetItem: String(dto.budgetItem ?? ""),
    statItem: String(dto.statItem ?? ""),
    appraisal1Name: String(dto.appraisal1Name ?? ""),
    appraisal2Name: String(dto.appraisal2Name ?? ""),
    geometry3857: dto.geometry3857 ?? null,
    extent3857: dto.extent3857 ?? null,
    parcels,
    parcelCount: dto.parcelCount ?? parcels.length,
  };
}

/** 목록에 행을 넣지 않는 신규 등록 선택 id — 저장 전까지 DB·목록 모두 없음 */
export const ROAD_REWARD_NEW_ID = "__new__";

export function isNewRoadRewardCaseId(id: string): boolean {
  return !/^\d+$/.test(String(id ?? "").trim());
}
