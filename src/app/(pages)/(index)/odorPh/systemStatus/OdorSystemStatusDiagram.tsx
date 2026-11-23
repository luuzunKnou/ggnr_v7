'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCommTime } from './odorSystemStatusJudge'
import type { OdorCommNodeKind, OdorCommNodeView, OdorCommStatus } from './odorSystemStatusTypes'
import { ODOR_COMM_DIAGRAM_KINDS, ODOR_COMM_STATUS_LABEL } from './odorSystemStatusTypes'

type Props = {
  nodes: OdorCommNodeView[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const KIND_LABEL: Record<OdorCommNodeKind, string> = {
  ipsec: 'IPsec',
  db: 'DB',
  utm: 'UTM',
  iot: 'IoT',
  master: 'Master',
  agency: '업체',
  gateway: 'GW',
  sensor: '센서',
}

const STATUS_BADGE: Record<OdorCommStatus, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  delayed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  disconnect:
    'bg-destructive/15 text-destructive animate-[odor-comm-blink_1.2s_ease-in-out_infinite]',
}

/** 깊이별 하위 행 배경 (선택 아닐 때) */
const DEPTH_BG: Record<number, string> = {
  1: 'bg-muted/15 hover:bg-muted/30',
  2: 'bg-muted/20 hover:bg-muted/35',
  3: 'bg-muted/25 hover:bg-muted/40',
  4: 'bg-muted/30 hover:bg-muted/45',
  5: 'bg-muted/35 hover:bg-muted/50',
}

const DEPTH_INDENT_PX = 12
const TOGGLE_COL_PX = 28

function formatCollectRate(node: OdorCommNodeView): string {
  if (node.detail?.collectRateText) return node.detail.collectRateText
  if (node.collectRate == null) return '—'
  return Number.isInteger(node.collectRate)
    ? `${node.collectRate}%`
    : `${node.collectRate.toFixed(1)}%`
}

function StatusBadge({ status }: { status: OdorCommStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded px-1 py-0.5 text-[10px] font-medium',
        STATUS_BADGE[status]
      )}
    >
      {ODOR_COMM_STATUS_LABEL[status]}
    </span>
  )
}

function depthBgClass(depth: number): string | undefined {
  if (depth <= 0) return undefined
  return DEPTH_BG[Math.min(depth, 5)]
}

export function OdorSystemStatusDiagram({ nodes, selectedId, onSelect }: Props) {
  const listNodes = useMemo(
    () => nodes.filter((n) => ODOR_COMM_DIAGRAM_KINDS.has(n.kind)),
    [nodes]
  )

  const byParent = useMemo(() => {
    const m = new Map<string, OdorCommNodeView[]>()
    for (const n of listNodes) {
      if (!n.parentId) continue
      const list = m.get(n.parentId) ?? []
      list.push(n)
      m.set(n.parentId, list)
    }
    return m
  }, [listNodes])

  const roots = useMemo(
    () => listNodes.filter((n) => n.parentId == null),
    [listNodes]
  )

  const parentIdsKey = useMemo(() => {
    const ids: string[] = []
    for (const n of listNodes) {
      if ((byParent.get(n.id) ?? []).length > 0) ids.push(n.id)
    }
    return ids.sort().join(',')
  }, [listNodes, byParent])

  /** 자식이 있는 노드는 기본 펼침 */
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const [syncedKey, setSyncedKey] = useState('')
  if (parentIdsKey !== syncedKey) {
    setSyncedKey(parentIdsKey)
    setOpenIds(new Set(parentIdsKey ? parentIdsKey.split(',') : []))
  }

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleRows = useMemo(() => {
    const rows: { node: OdorCommNodeView; depth: number; hasChildren: boolean }[] =
      []
    const walk = (node: OdorCommNodeView, depth: number) => {
      const children = byParent.get(node.id) ?? []
      const hasChildren = children.length > 0
      rows.push({ node, depth, hasChildren })
      if (hasChildren && openIds.has(node.id)) {
        for (const child of children) walk(child, depth + 1)
      }
    }
    for (const root of roots) walk(root, 0)
    return rows
  }, [roots, byParent, openIds])

  if (listNodes.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        표시할 계통 노드가 없습니다.
      </p>
    )
  }

  return (
    <div className="standard-list-scroll min-h-0 flex-1">
      <style>{`
        @keyframes odor-comm-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
      <table className="standard-list-table">
        <colgroup>
          <col style={{ width: TOGGLE_COL_PX }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead className="standard-table-thead">
          <tr>
            <th className="p-0" aria-label="펼침" />
            <th className="standard-table-th standard-table-th-left">구분</th>
            <th className="standard-table-th standard-table-th-left">명칭</th>
            <th className="standard-table-th standard-table-th-left">상태</th>
            <th className="standard-table-th standard-table-th-left">최종수신</th>
            <th className="standard-table-th standard-table-th-left">수집율</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ node, depth, hasChildren }) => {
            const selected = selectedId === node.id
            const open = openIds.has(node.id)
            return (
              <tr
                key={node.id}
                role="button"
                tabIndex={0}
                title={node.label}
                onClick={() => onSelect(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(node.id)
                  }
                }}
                className={cn(
                  'standard-list-row cursor-pointer',
                  !selected && depthBgClass(depth),
                  selected && 'standard-list-row-selected'
                )}
              >
                <td className="p-0 align-middle">
                  <div
                    className="flex items-center justify-start"
                    style={{
                      width: TOGGLE_COL_PX,
                      minWidth: TOGGLE_COL_PX,
                      paddingLeft: 2,
                    }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        title={open ? '접기' : '펼치기'}
                        aria-expanded={open}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleOpen(node.id)
                        }}
                        className="relative z-[1] inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground/80 hover:bg-muted hover:text-foreground"
                      >
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
                    )}
                  </div>
                </td>
                <td className="standard-table-td-compact">
                  <span className="truncate">{KIND_LABEL[node.kind]}</span>
                </td>
                <td className="px-1.5 py-1.5 align-middle text-foreground" style={{ maxWidth: 0 }}>
                  <span
                    className="block min-w-0 truncate font-medium"
                    style={{ paddingLeft: depth * DEPTH_INDENT_PX }}
                  >
                    {node.label}
                  </span>
                </td>
                <td className="standard-table-td-compact">
                  <StatusBadge status={node.status} />
                </td>
                <td
                  className="standard-table-td-date tabular-nums"
                  title={formatCommTime(node.lastRecvAt)}
                >
                  {formatCommTime(node.lastRecvAt)}
                </td>
                <td className="standard-table-td-compact tabular-nums">
                  {formatCollectRate(node)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
