'use client';

/**
 * @deprecated 통합 `bizNotif/bizNotifClient` 사용.
 * 호환 export만 유지.
 */
export {
  BIZ_NOTIF_WITHIN_DAYS as USAGE_EXPIRY_NOTIF_WITHIN_DAYS,
  PROTO_NOTIF_CHANGED_EVENT,
  refreshBizNotifs as refreshUsageDataAsExpiryNotifs,
} from '../../bizNotif/bizNotifClient';

export function setUsageDataAsNotifUsrId(_usrId: string | null | undefined) {
  /* no-op: 서버 세션 기준 */
}

export function markUsageDataAsExpiryNotifRead(_rowKey: string) {
  /* no-op — UserAccountProtoPanel 은 bizNotifClient 사용 */
}

export function dismissUsageDataAsExpiryNotif(_rowKey: string) {
  /* no-op */
}

export function dismissAllUsageDataAsExpiryNotifs() {
  /* no-op */
}
