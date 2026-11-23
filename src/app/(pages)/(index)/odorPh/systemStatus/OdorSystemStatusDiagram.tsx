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

function formatCollectRate(node: OdorCommNodeView): string {
  if (node.detail?.collectRateText) return node.detail.collectRateText
  if (node.collectRate == null) return '—'
  return Number.isInteger(node.collectRate)
    ? `${node.collectRate}%`
    : `${node.collectRate.toFixed(1)}%`
}

/** 계층별 detail을 한 줄 비고로 정규화 */
function formatRemark(node: OdorCommNodeView): string {
  const d = node.detail
  if (node.kind === 'agency') return '기기 목록'
  if (!d) return '—'
  const parts: string[] = []
  if (d.peerLine) parts.push(d.peerLine)
  if (d.runStatus && node.kind === 'ipsec') parts.push(d.runStatus)
  if (d.redundancy) parts.push(d.redundancy)
  if (d.tunnel) parts.push(d.tunnel)
  if (d.linkSystem) parts.push(d.linkSystem)
  if (d.collectTag && !d.redundancy) parts.push(d.collectTag)
  if (parts.length === 0 && d.runStatus) parts.push(d.runStatus)
  return parts.length > 0 ? parts.join(' · ') : '—'
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

  /** 루트→Master 직전 단일 체인 + Master */
  const { spine, master, agencies } = useMemo(() => {
    const root = listNodes.find((n) => n.parentId == null)
    if (!root) {
      return {
        spine: [] as OdorCommNodeView[],
        master: null as OdorCommNodeView | null,
        agencies: [] as OdorCommNodeView[],
      }
    }
    const chain: OdorCommNodeView[] = [root]
    let cur = root
    while (true) {
      const kids = (byParent.get(cur.id) ?? []).filter(
        (k) => k.kind !== 'agency' && k.kind !== 'master'
      )
      if (kids.length !== 1) break
      chain.push(kids[0])
      cur = kids[0]
    }
    const masterNode =
      (byParent.get(cur.id) ?? []).find((k) => k.kind === 'master') ??
      listNodes.find((n) => n.kind === 'master') ??
      null
    const agencyList = masterNode
      ? (byParent.get(masterNode.id) ?? []).filter((n) => n.kind === 'agency')
      : []
    return { spine: chain, master: masterNode, agencies: agencyList }
  }, [listNodes, byParent])

  const [masterOpen, setMasterOpen] = useState(true)

  if (listNodes.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        표시할 계통 노드가 없습니다.
      </p>
    )
  }

  const renderRow = (
    node: OdorCommNodeView,
    opts?: { indent?: boolean; accordion?: boolean }
  ) => {
    const selected = selectedId === node.id
    const indent = opts?.indent ?? false
    const accordion = opts?.accordion ?? false

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
          selected && 'standard-list-row-selected'
        )}
      >
        <td className="standard-table-td-compact">
          <span className="truncate">{KIND_LABEL[node.kind]}</span>
        </td>
        <td className="standard-table-td-text" title={node.label}>
          <span
            className={cn(
              'flex min-w-0 items-center gap-0.5',
              indent && 'pl-3'
            )}
          >
            {accordion ? (
              <button
                type="button"
                title={masterOpen ? '업체 접기' : '업체 펼치기'}
                aria-expanded={masterOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  setMasterOpen((v) => !v)
                }}
                className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {masterOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            ) : indent ? (
              <span className="inline-block w-5 shrink-0" aria-hidden />
            ) : null}
            <span className="truncate font-medium">{node.label}</span>
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
        <td className="standard-table-td-text" title={formatRemark(node)}>
          <span className="block truncate text-muted-foreground">
            {formatRemark(node)}
          </span>
        </td>
      </tr>
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
        <thead className="standard-table-thead">
          <tr>
            <th className="standard-table-th standard-table-th-left w-[12%]">구분</th>
            <th className="standard-table-th standard-table-th-left w-[22%]">명칭</th>
            <th className="standard-table-th standard-table-th-left w-[10%]">상태</th>
            <th className="standard-table-th standard-table-th-left w-[22%]">최종수신</th>
            <th className="standard-table-th standard-table-th-left w-[10%]">수집율</th>
            <th className="standard-table-th standard-table-th-left">비고</th>
          </tr>
        </thead>
        <tbody>
          {spine.map((node) => renderRow(node))}
          {master ? renderRow(master, { accordion: agencies.length > 0 }) : null}
          {master && masterOpen
            ? agencies.map((ag) => renderRow(ag, { indent: true }))
            : null}
        </tbody>
      </table>
    </div>
  )
}
