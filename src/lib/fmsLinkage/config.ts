import { readProjectRuntimeEnvVars } from '@/lib/runtimeEnvFile';

export type FmsLinkageConfig = {
  orgCode: string;
  userId: string;
  password: string;
  certiKey: string;
  baseUrl: string;
  filePath: string | null;
  downloadCharset: string;
  kistecJarPath: string | null;
};

function pick(...values: Array<string | undefined | null>): string {
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

/** runtime.env FMS_* + 선택 FMS_KISTEC_JAR */
export function getFmsLinkageConfig(): FmsLinkageConfig | null {
  const env = readProjectRuntimeEnvVars();
  const orgCode = pick(env.FMS_ORG_CODE);
  const userId = pick(env.FMS_USER_ID);
  const password = pick(env.FMS_PASSWORD);
  const certiKey = pick(env.FMS_CERTI_KEY);
  const baseUrl = pick(env.FMS_BASE_URL);
  if (!orgCode || !userId || !password || !certiKey || !baseUrl) return null;

  const filePath = pick(env.FMS_FILE_PATH) || null;
  const downloadCharset = pick(env.FMS_DOWNLOAD_CHARSET, 'MS949');
  const kistecJarPath = pick(env.FMS_KISTEC_JAR) || null;

  return {
    orgCode,
    userId,
    password,
    certiKey,
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    filePath,
    downloadCharset,
    kistecJarPath,
  };
}
