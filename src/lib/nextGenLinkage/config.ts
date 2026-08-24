import { USE_FEE_SYNC_CONNECTION } from '@/integrations/useFeeSync.config';
import { readProjectRuntimeEnvVars } from '@/lib/runtimeEnvFile';

/** 차세대 세외수입 연계 — URL·시스템코드는 useFeeSync.config, 기관코드는 runtime.env */

export type NextGenLinkageConfig = {
  baseUrl: string;
  srcOrgCd: string;
  srcSysCd: string;
  filePath: string | null;
};

export function getNextGenLinkageConfig(): NextGenLinkageConfig | null {
  const env = readProjectRuntimeEnvVars();
  const baseUrl = String(USE_FEE_SYNC_CONNECTION.baseUrl ?? '').trim();
  const srcOrgCd = String(env.USE_FEE_SYNC_SRC_ORG_CD ?? '').trim();
  const srcSysCd = String(USE_FEE_SYNC_CONNECTION.srcSysCd ?? '').trim();
  if (!baseUrl || !srcOrgCd || !srcSysCd) return null;
  const filePath = String(USE_FEE_SYNC_CONNECTION.filePath ?? '').trim() || null;
  return { baseUrl, srcOrgCd, srcSysCd, filePath };
}
