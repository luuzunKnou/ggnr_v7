/**
 * 재기동 후 보류된 최신 소스 적용 성공 이력을 DB에 반영한다.
 * 냉기동(historyPending 없음)에서는 INSERT 하지 않는다.
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { ggnrRestartSignalPath } from '@/lib/ggnrBootCommand';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

type HistoryPayload = {
  mode?: string;
  command?: string;
  appliedFiles?: number;
  skippedFiles?: number;
  netLabel?: string;
  geoserverMsg?: string;
  message?: string;
};

export async function flushPendingVersionHistory(): Promise<void> {
  const signalPath = ggnrRestartSignalPath();
  if (!fs.existsSync(signalPath)) return;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(signalPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }

  if (raw.historyPending !== true) return;

  const clientIp =
    typeof raw.clientIp === 'string' && raw.clientIp.trim() ? raw.clientIp.trim() : undefined;
  const payload =
    raw.historyPayload && typeof raw.historyPayload === 'object' && !Array.isArray(raw.historyPayload)
      ? (raw.historyPayload as HistoryPayload)
      : {};

  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : buildFallbackMessage(clientIp, payload);

  const result = await recordVersionHistory({
    historyType: 'apply_latest',
    status: 'success',
    message,
    ip: clientIp,
  });

  if (!result.ok) {
    console.warn(
      '## [버전관리] ## 재기동 후 성공 이력 INSERT 실패:',
      result.error ?? 'unknown'
    );
    return;
  }

  const next = { ...raw };
  delete next.historyPending;
  delete next.historyPayload;
  next.historyFlushedAt = new Date().toISOString();
  try {
    await fsPromises.writeFile(signalPath, JSON.stringify(next, null, 2), 'utf8');
    console.log('## [버전관리] ## 재기동 후 성공 이력 INSERT 완료');
  } catch (e) {
    console.warn(
      '## [버전관리] ## 이력 flush 플래그 해제 실패:',
      e instanceof Error ? e.message : e
    );
  }
}

function buildFallbackMessage(ip: string | undefined, payload: HistoryPayload): string {
  const ipPart = ip?.trim() || '-';
  const mode = payload.mode?.trim() || '-';
  const command = payload.command?.trim() || '-';
  const applied = payload.appliedFiles ?? 0;
  const skipped = payload.skippedFiles ?? 0;
  const net = payload.netLabel?.trim() || '-';
  const geo = payload.geoserverMsg?.trim() || '-';
  return `성공 / ${ipPart} / mode=${mode} / command=${command} / 적용 ${applied}건 / 제외 ${skipped}건 / ${net} / GeoServer: ${geo}`;
}
