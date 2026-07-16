import {
  buildSourceUploadFailBody,
  buildSourceUploadSuccessBody,
  formatSourceUploadHistoryMessage,
} from '@/lib/sourceUploadHistoryMessage';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';
import { SOURCE_UPLOAD_REMOTE_BASE } from '@/service/sourceUploadRemote';

export { buildSourceUploadFailBody, buildSourceUploadSuccessBody };

export async function recordUploadFlowHistory(params: {
  includeNodeModules?: boolean;
  changeNote?: string;
  status: 'success' | 'fail';
  body: string;
  ip?: string;
  clientHost?: string;
}): Promise<boolean> {
  const message = formatSourceUploadHistoryMessage(
    params.includeNodeModules === true,
    params.status,
    params.body,
    params.changeNote
  );
  const result = await recordVersionHistory({
    historyType: 'source_upload',
    status: params.status,
    message,
    ip: params.ip,
    clientHost: params.clientHost ?? SOURCE_UPLOAD_REMOTE_BASE,
  });
  return result.ok;
}
