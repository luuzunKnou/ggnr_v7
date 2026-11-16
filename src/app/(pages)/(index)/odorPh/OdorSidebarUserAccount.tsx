'use client'

import { useEffect, useRef, useState } from 'react'
import { Ellipsis, User } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  hasProtoUnreadNotifications,
  PROTO_NOTIF_CHANGED_EVENT,
} from '@/app/(pages)/map/_mapContents/bizNotif/bizNotifStore'
import {
  ImportantNotifSidebarBubble,
  UserAccountProtoPanel,
} from '@/app/(pages)/map/_mapContents/prototypes/UserAccountProtoPanel'

type Props = {
  collapsed: boolean
}

/**
 * 지도 좌측 사이드바 하단 «내 정보»와 동일 — 로그인 상태·패널·알림 버블
 */
export function OdorSidebarUserAccount({ collapsed }: Props) {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const [protoNotifUnread, setProtoNotifUnread] = useState(false)
  const myInfoAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setProtoNotifUnread(hasProtoUnreadNotifications())
    sync()
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v)
    const onOpenNotif = () => setOpen(true)
    window.addEventListener('ggnr-proto-user-account-toggle', onToggle)
    window.addEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    return () => {
      window.removeEventListener('ggnr-proto-user-account-toggle', onToggle)
      window.removeEventListener('ggnr-proto-user-account-open-notif', onOpenNotif)
    }
  }, [])

  const displayName =
    status === 'loading'
      ? '…'
      : session?.user?.id === 'su'
        ? '슈퍼관리자'
        : String(session?.user?.name ?? session?.user?.id ?? '').trim() || '게스트'

  const panelClassName = collapsed ? 'left-14' : 'left-[16.5rem]'
  const sideModalClassName = cn(
    'fixed bottom-[7px] z-[130] flex w-[400px] flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl',
    collapsed ? 'left-[calc(3.5rem+340px+8px)]' : 'left-[calc(16.5rem+340px+8px)]'
  )

  return (
    <>
      <div className={cn('relative w-full', collapsed ? 'px-1 py-1.5' : 'px-2 py-2')}>
        <div ref={myInfoAnchorRef} className="w-full">
          <button
            type="button"
            title="내 정보"
            aria-label="내 정보"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ggnr-proto-user-account-toggle'))
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/70',
              collapsed ? 'justify-center px-0 py-1.5' : 'px-2 py-1.5'
            )}
          >
            <span
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
              aria-hidden
            >
              <User className="h-4 w-4" strokeWidth={2} />
              <span
                className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground"
                aria-hidden
              >
                <Ellipsis className="h-2 w-2" strokeWidth={2.5} />
              </span>
              {protoNotifUnread ? (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
              ) : null}
            </span>
            {!collapsed ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {displayName}
                </span>
                <span className="block text-[10px] text-muted-foreground">내 정보</span>
              </span>
            ) : null}
          </button>
        </div>
        <ImportantNotifSidebarBubble anchorRef={myInfoAnchorRef} />
      </div>

      <UserAccountProtoPanel
        open={open}
        onClose={() => setOpen(false)}
        onOpenLedger={() => undefined}
        onOpenFee={() => undefined}
        panelClassName={panelClassName}
        sideModalClassName={sideModalClassName}
      />
    </>
  )
}
