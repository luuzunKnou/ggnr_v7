'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { OdorCommLink, OdorCommNodeView, OdorCommStatus } from './odorSystemStatusTypes'
import { ODOR_COMM_DIAGRAM_KINDS, ODOR_COMM_STATUS_LABEL } from './odorSystemStatusTypes'

type Props = {
  nodes: OdorCommNodeView[]
  links: OdorCommLink[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const STATUS_NODE: Record<OdorCommStatus, string> = {
  ok: 'border-emerald-500/70 bg-emerald-500/10 text-foreground',
  delayed: 'border-amber-500 bg-amber-500/15 text-foreground',
  disconnect:
    'border-destructive bg-destructive/10 text-destructive animate-[odor-comm-blink_1.2s_ease-in-out_infinite]',
}

const STATUS_EDGE: Record<OdorCommStatus, string> = {
  ok: 'bg-emerald-500/50',
  delayed: 'bg-amber-500/70',
  disconnect: 'odor-comm-edge-dash bg-destructive animate-[odor-comm-blink_1.2s_ease-in-out_infinite]',
}

function statusDot(status: OdorCommStatus): string {
  if (status === 'ok') return 'bg-emerald-500'
  if (status === 'delayed') return 'bg-amber-500'
  return 'bg-destructive'
}

export function OdorSystemStatusDiagram({ nodes, links, selectedId, onSelect }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  const diagramNodes = useMemo(
    () => nodes.filter((n) => ODOR_COMM_DIAGRAM_KINDS.has(n.kind)),
    [nodes]
  )
  const byId = useMemo(() => new Map(diagramNodes.map((n) => [n.id, n])), [diagramNodes])
  const byParent = useMemo(() => {
    const m = new Map<string, OdorCommNodeView[]>()
    for (const n of diagramNodes) {
      if (!n.parentId) continue
      const list = m.get(n.parentId) ?? []
      list.push(n)
      m.set(n.parentId, list)
    }
    return m
  }, [diagramNodes])

  const diagramLinks = useMemo(() => {
    const ids = new Set(diagramNodes.map((n) => n.id))
    return links.filter((l) => ids.has(l.fromId) && ids.has(l.toId))
  }, [links, diagramNodes])

  const highlightIds = useMemo(() => {
    if (!hoverId) return new Set<string>()
    const set = new Set<string>([hoverId])
    for (const l of diagramLinks) {
      if (l.fromId === hoverId || l.toId === hoverId) {
        set.add(l.fromId)
        set.add(l.toId)
      }
    }
    return set
  }, [hoverId, diagramLinks])

  const highlightLinkIds = useMemo(() => {
    if (!hoverId) return new Set<string>()
    const set = new Set<string>()
    for (const l of diagramLinks) {
      if (l.fromId === hoverId || l.toId === hoverId) set.add(l.id)
    }
    return set
  }, [hoverId, diagramLinks])

  const root = diagramNodes.find((n) => n.parentId == null)
  if (!root) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">표시할 계통 노드가 없습니다.</p>
    )
  }

  /** 루트에서 agency 직전까지 단일 체인 */
  const spine: OdorCommNodeView[] = [root]
  let cur = root
  while (true) {
    const kids = (byParent.get(cur.id) ?? []).filter((k) => k.kind !== 'agency')
    if (kids.length !== 1) break
    spine.push(kids[0])
    cur = kids[0]
  }
  const branchParent = spine[spine.length - 1]
  const agencies = (byParent.get(branchParent.id) ?? []).filter((n) => n.kind === 'agency')

  function Edge({ linkId, status }: { linkId: string; status: OdorCommStatus }) {
    return (
      <div className="flex justify-center py-1" aria-hidden>
        <div
          className={cn(
            'h-5 w-0.5 rounded-full transition-all',
            STATUS_EDGE[status],
            highlightLinkIds.has(linkId) || (!hoverId && status !== 'ok')
              ? 'opacity-100 scale-x-150 w-1'
              : 'opacity-40',
            hoverId && highlightLinkIds.has(linkId) && 'opacity-100 brightness-125 w-1.5',
            hoverId && !highlightLinkIds.has(linkId) && 'opacity-15'
          )}
        />
      </div>
    )
  }

  function NodeCard({ node, compact }: { node: OdorCommNodeView; compact?: boolean }) {
    const selected = selectedId === node.id
    const dim = hoverId != null && !highlightIds.has(node.id)
    return (
      <button
        type="button"
        title={node.label}
        onMouseEnter={() => setHoverId(node.id)}
        onMouseLeave={() => setHoverId(null)}
        onFocus={() => setHoverId(node.id)}
        onBlur={() => setHoverId(null)}
        onClick={() => onSelect(node.id)}
        className={cn(
          'cursor-pointer rounded border px-2 py-1.5 text-left transition-all',
          compact ? 'min-w-[7.5rem] max-w-[10rem]' : 'min-w-[11rem] max-w-[16rem]',
          STATUS_NODE[node.status],
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
          dim && 'opacity-30',
          hoverId === node.id && 'brightness-110 shadow-sm'
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(node.status))} />
          <span className={cn('truncate font-medium', compact ? 'text-[10px]' : 'text-[11px]')}>
            {node.label}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {ODOR_COMM_STATUS_LABEL[node.status]}
          {node.kind === 'agency' ? ' · 센서 목록' : ''}
        </span>
      </button>
    )
  }

  function linkStatus(fromId: string, toId: string): OdorCommStatus {
    return byId.get(toId)?.status ?? 'ok'
  }

  function linkId(fromId: string, toId: string): string {
    return (
      diagramLinks.find((l) => l.fromId === fromId && l.toId === toId)?.id ?? `${fromId}->${toId}`
    )
  }

  return (
    <div className="odor-system-status-diagram flex flex-col items-stretch gap-0 px-2 py-2">
      <style>{`
        @keyframes odor-comm-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .odor-comm-edge-dash {
          background-image: repeating-linear-gradient(
            to bottom,
            currentColor 0 3px,
            transparent 3px 6px
          );
          background-color: transparent !important;
          color: hsl(var(--destructive));
          width: 2px !important;
        }
      `}</style>

      <div className="flex flex-col items-center">
        {spine.map((node, idx) => (
          <div key={node.id} className="flex flex-col items-center">
            {idx > 0 ? (
              <Edge
                linkId={linkId(spine[idx - 1].id, node.id)}
                status={linkStatus(spine[idx - 1].id, node.id)}
              />
            ) : null}
            <NodeCard node={node} />
          </div>
        ))}
      </div>

      {agencies.length > 0 ? (
        <div className="mt-1 flex w-full justify-center gap-6">
          {agencies.map((ag) => {
            const gateways = (byParent.get(ag.id) ?? []).filter((n) => n.kind === 'gateway')
            return (
              <div key={ag.id} className="flex min-w-0 flex-1 flex-col items-center">
                <Edge
                  linkId={linkId(branchParent.id, ag.id)}
                  status={linkStatus(branchParent.id, ag.id)}
                />
                <NodeCard node={ag} />
                {gateways.map((gw) => (
                  <div key={gw.id} className="flex flex-col items-center">
                    <Edge linkId={linkId(ag.id, gw.id)} status={linkStatus(ag.id, gw.id)} />
                    <NodeCard node={gw} compact />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
