import { intervalSlotKey } from '@/integrations/integrationSchedule';
import { isAerialWorkBusy } from '@/lib/aerialWorkGate';
import { importDroppedDroneFolders, importDroppedPanoramaFolders } from '@/service/aerialUploadService';
import { isOrthoConvertBusy } from '@/service/orthophotoService';

const LOG = '[aerial-drone-folder]';

/** 1분 격자. 같은 크기·수정시각이 다음 주기에 한 번 더 맞아야 등록된다. */
const SCHEDULE = { mode: 'interval' as const, minutes: 1 };

/**
 * 사진·동영상(aerial/drone)과 항공뷰(aerial/panorama) 자료 폴더를 읽어 작업·파일을 등록한다.
 * 기동 직후 실행 없음. DISABLE_AERIAL_DRONE_FOLDER_SCHEDULER=1
 * 또는 DISABLED_SCHEDULERS=aerialDroneFolder 로 끈다.
 */
export function startAerialDroneFolderScheduler(): void {
  console.info(`${LOG} registered: every ${SCHEDULE.minutes} min, no run on startup`);

  let lastSlot: string | null = null;
  let running = false;
  let lastPauseSlot: string | null = null;

  setInterval(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const slot = intervalSlotKey(SCHEDULE, now);
    if (!slot || lastSlot === slot || running) return;
    if (isAerialWorkBusy() || isOrthoConvertBusy()) {
      if (lastPauseSlot !== slot) {
        lastPauseSlot = slot;
        console.info(`${LOG} paused: upload or convert in progress`);
      }
      return;
    }
    lastSlot = slot;
    running = true;

    void (async () => {
      const drone = await importDroppedDroneFolders();
      if (drone.unitsCreated > 0 || drone.filesRegistered > 0) {
        console.info(
          `${LOG} drone units=${drone.unitsCreated} files=${drone.filesRegistered} waiting=${drone.filesWaiting}`
        );
      }
      if (drone.paused || isAerialWorkBusy() || isOrthoConvertBusy()) {
        lastSlot = null;
        console.info(`${LOG} paused before panorama`);
        return;
      }
      const pano = await importDroppedPanoramaFolders();
      if (pano.paused) lastSlot = null;
      if (pano.unitsCreated > 0 || pano.filesRegistered > 0) {
        console.info(
          `${LOG} panorama units=${pano.unitsCreated} files=${pano.filesRegistered} waiting=${pano.filesWaiting}`
        );
      }
    })()
      .catch((e) => {
        console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
      })
      .finally(() => {
        running = false;
      });
  }, 15_000);
}
