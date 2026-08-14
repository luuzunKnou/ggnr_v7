import { setupGeoServerDb } from '@/service/devTestService';
import {
  ensureGeoServerRunning,
  type EnsureGeoServerResult,
} from '@/service/geoserverProcessService';

function defaultGeoUrl(): string {
  return process.env.GEOSERVER_URL?.trim() || 'http://localhost:8080/geoserver';
}

/** GeoServer REST — 워크스페이스·PostGIS 저장소 확인·갱신 (응답 없으면 false) */
export async function trySetupGeoServerDb(options?: {
  workspace?: string;
  url?: string;
  onLog?: (message: string) => void;
}): Promise<boolean> {
  const log = options?.onLog ?? (() => {});
  const url = options?.url?.trim() || defaultGeoUrl();
  const workspace = options?.workspace?.trim() || 'ggnr';
  try {
    const gs = await setupGeoServerDb({ workspace, url });
    if (gs.success) {
      const created = gs.datastores?.filter((d) => d.status === 'created').length ?? 0;
      const updated = gs.datastores?.filter((d) => d.status === 'updated').length ?? 0;
      if (created > 0) log(`저장소 생성 ${created}건`);
      if (updated > 0) log(`저장소 DB 연결 갱신 ${updated}건`);
      return true;
    }
    log(`저장소 설정 실패: ${gs.error ?? 'unknown'}`);
    return false;
  } catch (e) {
    log(`GeoServer REST 연결 실패: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export type GeoServerBootstrapResult = {
  success: boolean;
  setupOk: boolean;
  ensure: EnsureGeoServerResult;
};

/**
 * GeoServer 기동(data_dir 디스크 반영 후 start) → REST 저장소 갱신.
 * geoAlreadyStopped: 적용 직후처럼 이미 중지된 경우 초기 REST·stop 생략.
 */
export async function ensureGeoServerWithDbSetup(options?: {
  onLog?: (message: string) => void;
  geoAlreadyStopped?: boolean;
  readyTimeoutMs?: number;
  retryOnceOnFail?: boolean;
}): Promise<GeoServerBootstrapResult> {
  const log = options?.onLog ?? (() => {});
  const readyTimeoutMs = options?.readyTimeoutMs ?? 120_000;
  const geoAlreadyStopped = options?.geoAlreadyStopped === true;

  if (!geoAlreadyStopped) {
    const initialSetup = await trySetupGeoServerDb({ onLog: log });
    if (initialSetup) {
      return {
        success: true,
        setupOk: true,
        ensure: { success: true, action: 'already-ready' },
      };
    }
  } else {
    log('GeoServer 중지 상태 — 기동 후 저장소 설정 예정');
  }

  let ensure = await ensureGeoServerRunning({
    forceRestart: false,
    skipStopIfDown: geoAlreadyStopped,
    readyTimeoutMs,
    onLog: log,
  });

  if (!ensure.success && options?.retryOnceOnFail === true) {
    log('1차 기동 실패 — 강제 재기동 1회 재시도');
    ensure = await ensureGeoServerRunning({
      forceRestart: true,
      readyTimeoutMs,
      onLog: log,
    });
  }

  let setupOk = false;
  if (ensure.success) {
    setupOk = await trySetupGeoServerDb({ onLog: log });
  }

  return {
    success: ensure.success && setupOk,
    setupOk,
    ensure,
  };
}
