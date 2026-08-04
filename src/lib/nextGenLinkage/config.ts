import { USE_FEE_SYNC_CONNECTION } from '@/integrations/useFeeSync.config';

/** 차세대 세외수입 연계 — 접속값 (`useFeeSync.config` 의 USE_FEE_SYNC_CONNECTION) */

export type NextGenLinkageConfig = {
  baseUrl: string;
  srcOrgCd: string;
  srcSysCd: string;
  filePath: string | null;
};

export function getNextGenLinkageConfig(): NextGenLinkageConfig | null {
  const baseUrl = String(USE_FEE_SYNC_CONNECTION.baseUrl ?? '').trim();
  const srcOrgCd = String(USE_FEE_SYNC_CONNECTION.srcOrgCd ?? '').trim();
  const srcSysCd = String(USE_FEE_SYNC_CONNECTION.srcSysCd ?? '').trim();
  if (!baseUrl || !srcOrgCd || !srcSysCd) return null;
  const filePath = String(USE_FEE_SYNC_CONNECTION.filePath ?? '').trim() || null;
  return { baseUrl, srcOrgCd, srcSysCd, filePath };
}
