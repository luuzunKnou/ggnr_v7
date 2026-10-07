/**
 * 지도 «데이터 업로드» — 사용자 업로드 자료 처리
 */
import { getSessionUsrId } from '@/lib/auth/guard';
import { detectCrsCandidatesByExtent } from './shpUploadService';

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

export type UploadCrsCandidate = {
  epsg: number;
  overlapRatio: number;
};

/**
 * 원시 좌표 범위를 한국 평면좌표계 후보로 해석해 우리 지역(읍면동 경계)과 겹치는 좌표계만 일치율 순으로 돌려준다.
 * 점 하나처럼 면적이 없는 범위는 겹치면 일치율 1 로 본다.
 */
export async function detectCrsCandidates(params: {
  minX: unknown;
  minY: unknown;
  maxX: unknown;
  maxY: unknown;
}): Promise<{ candidates: UploadCrsCandidate[] }> {
  await requireUsr();
  const box = {
    minX: Number(params?.minX),
    minY: Number(params?.minY),
    maxX: Number(params?.maxX),
    maxY: Number(params?.maxY),
  };
  if (!Object.values(box).every(Number.isFinite) || box.minX > box.maxX || box.minY > box.maxY) {
    throwHttp(400, '좌표 범위가 올바르지 않습니다.');
  }

  const res = await detectCrsCandidatesByExtent(box);
  if (!res.success) throw new Error(res.error ?? '좌표계 후보를 계산하지 못했습니다.');

  const degenerate = box.minX === box.maxX || box.minY === box.maxY;
  const candidates = (res.candidates ?? [])
    .map((c) => ({ epsg: c.epsg, overlapRatio: degenerate && c.intersectsEmd ? 1 : c.overlapRatio }))
    .sort((a, b) => b.overlapRatio - a.overlapRatio);
  return { candidates };
}
