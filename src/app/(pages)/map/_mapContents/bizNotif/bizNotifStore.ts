/** 업무 알림 인메모리 저장 — OpenLayers/더미지도 코드와 분리 (인덱스 페이지에서도 안전) */

export type ProtoNotifItem = {
  id: string
  category: '만료임박' | '미납임박'
  title: string
  name: string
  listKey?: string
  read: boolean
  important: boolean
  target: 'ledger' | 'fee'
  targetId: string
  notifKey?: string
  systemScope?: string
}

export const PROTO_NOTIFS: ProtoNotifItem[] = []

export const PROTO_NOTIF_CHANGED_EVENT = 'ggnr-proto-notifs-changed'

let protoNotifItems: ProtoNotifItem[] = [...PROTO_NOTIFS]

export function getProtoNotifs(): ProtoNotifItem[] {
  return protoNotifItems
}

export function setProtoNotifs(items: ProtoNotifItem[]) {
  if (items === protoNotifItems) return
  protoNotifItems = items
  if (typeof window !== 'undefined') {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent(PROTO_NOTIF_CHANGED_EVENT))
    })
  }
}

export function hasProtoUnreadNotifications(): boolean {
  return protoNotifItems.some((n) => !n.read)
}
