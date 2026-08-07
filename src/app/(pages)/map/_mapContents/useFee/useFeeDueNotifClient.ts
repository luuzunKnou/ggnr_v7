'use client';

/**
 * @deprecated 통합 `bizNotif/bizNotifClient` 사용.
 * 호환 export만 유지.
 */
export {
  BIZ_NOTIF_WITHIN_DAYS as USE_FEE_DUE_NOTIF_WITHIN_DAYS,
  PROTO_NOTIF_CHANGED_EVENT,
  refreshBizNotifs as refreshUseFeeDueNotifs,
} from '../bizNotif/bizNotifClient';

export function setUseFeeDueNotifUsrId(_usrId: string | null | undefined) {
  /* no-op: 서버 세션 기준 */
}

export function markUseFeeDueNotifRead(_feeId: string) {
  /* no-op */
}

export function dismissUseFeeDueNotif(_feeId: string) {
  /* no-op */
}

export function dismissAllUseFeeDueNotifs() {
  /* no-op */
}
