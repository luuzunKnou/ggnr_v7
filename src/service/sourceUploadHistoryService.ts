import {
  buildSourceUploadFailBody,
  buildSourceUploadHistoryFields,
  buildSourceUploadSuccessBody,
} from '@/lib/sourceUploadHistoryMessage';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';
import { SOURCE_UPLOAD_REMOTE_BASE } from '@/service/sourceUploadRemote';

export { buildSourceUploadFailBody, buildSourceUploadSuccessBody };

export async function recordUploadFlowHistory(params: {
  includeNodeModules?: boolean;
  changeNote?: string;
  status: 'success' | 'fail';
  body: string;
  /** GNMS folder (= bundleRoot) */
  version?: string;
  ip?: string;
  clientHost?: string;
}): Promise<boolean> {
  const fields = buildSourceUploadHistoryFields(
    params.includeNodeModules === true,
    params.body,
    params.changeNote
  );
  const result = await recordVersionHistory({
    historyType: 'source_upload',
    status: params.status,
    message: fields.message,
    option: fields.option,
    memo: fields.memo,
    version: params.version,
    ip: params.ip,
    clientHost: params.clientHost ?? SOURCE_UPLOAD_REMOTE_BASE,
  });
  return result.ok;
}
