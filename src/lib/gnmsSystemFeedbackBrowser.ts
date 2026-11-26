/**
 * 브라우저 → GNMS 시스템 불편신고 직결 제출.
 * 운영 서버는 gnms-config(URL·Bearer)만 제공.
 */
import {
  classifyGnmsNetworkError,
  gnmsAuthHeaders,
  loadGnmsBrowserConfig,
} from '@/lib/gnmsBrowserClient';
import { buildGnmsSystemFeedbackUrl, DEFAULT_GNMS_URL } from '@/lib/gnmsSourceUrl';

export type GnmsSystemFeedbackPayload = {
  sfKey: number;
  usrId: string;
  usrName: string;
  systemKey: string | null;
  serviceEng: string | null;
  serviceKor: string | null;
  contentHtml: string;
  /** runtime.env SYSTEM_NAME */
  systemName?: string;
  /** runtime.env SYSTEM_KOR_NAME */
  systemKorName?: string;
  project?: string;
  createdAt?: string | null;
};

export type GnmsSystemFeedbackFile = {
  fieldName: 'attachments' | 'editorImages';
  file: File | Blob;
  fileName: string;
};

/** GNMS multipart 제출 */
export async function submitSystemFeedbackToGnms(options: {
  payload: GnmsSystemFeedbackPayload;
  files?: GnmsSystemFeedbackFile[];
  signal?: AbortSignal;
}): Promise<{ ok: true; url: string }> {
  const cfg = await loadGnmsBrowserConfig(options.signal);
  // gnms-config.gnmsBaseUrl = …/api/source/version → …/gnms/api/system-feedback 로 정규화
  const url =
    buildGnmsSystemFeedbackUrl(cfg.gnmsBaseUrl) ||
    buildGnmsSystemFeedbackUrl(DEFAULT_GNMS_URL);
  if (!url) throw new Error('GNMS 불편신고 URL을 만들 수 없습니다');
  const form = new FormData();
  form.append('sfKey', String(options.payload.sfKey));
  form.append('usrId', options.payload.usrId);
  form.append('usrName', options.payload.usrName);
  form.append('systemKey', options.payload.systemKey ?? '');
  form.append('serviceEng', options.payload.serviceEng ?? '');
  form.append('serviceKor', options.payload.serviceKor ?? '');
  form.append('contentHtml', options.payload.contentHtml ?? '');
  form.append('systemName', options.payload.systemName ?? '');
  form.append('systemKorName', options.payload.systemKorName ?? '');
  if (options.payload.project) form.append('project', options.payload.project);
  if (options.payload.createdAt) form.append('createdAt', options.payload.createdAt);

  for (const f of options.files ?? []) {
    form.append(f.fieldName, f.file, f.fileName);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: gnmsAuthHeaders(cfg.bearer),
      body: form,
      signal: options.signal,
    });
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS 불편신고 제출', url);
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  if (!res.ok) {
    throw new Error(json.error ?? `GNMS 불편신고 제출 실패 HTTP ${res.status}`);
  }
  return { ok: true, url };
}
