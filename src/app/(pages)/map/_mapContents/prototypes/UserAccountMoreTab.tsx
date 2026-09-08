'use client'

import { FolderOpen, Megaphone } from 'lucide-react'
import { withBasePathNav } from '@/lib/basePath'

type Props = {
  onClosePanel: () => void
}

const MORE_LINKS = [
  { href: '/notice', label: '공지사항', Icon: Megaphone },
  { href: '/library', label: '자료실', Icon: FolderOpen },
] as const

/** 내 정보 패널 — 더보기(공지사항·자료실) */
export function UserAccountMoreTab({ onClosePanel }: Props) {
  return (
    <div className="px-3 py-2">
      <ul className="space-y-1">
        {MORE_LINKS.map(({ href, label, Icon }) => (
          <li key={href}>
            <button
              type="button"
              onClick={() => {
                onClosePanel()
                window.location.assign(withBasePathNav(href))
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[11px] text-foreground hover:bg-muted/50"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
