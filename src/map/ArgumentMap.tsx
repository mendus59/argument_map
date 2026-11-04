import { useEffect, useMemo } from 'react'
import { Background, Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DebateMap } from '../model/types'
import { findCruxes, stanceOf } from '../model/crux'
import { layoutMap, CLAIM_W } from './layout'
import { ClaimNode, GroupNode, type ClaimNodeType, type GroupNodeType, type SubStatus } from './nodes'

const nodeTypes = { claim: ClaimNode, premiseGroup: GroupNode }

export type Selection = { kind: 'claim' | 'link'; id: string } | null

/** The argument map. Clicking a box or a group selects it; the panel beside it does the editing. */
type Props = {
  map: DebateMap
  selection?: Selection
  onSelect?: (s: Selection) => void
  /** Boxes changed since the viewer's last visit. */
  highlight?: Set<string>
  /** Names of people writing under each box right now. */
  writers?: Map<string, string[]>
  /** Sub-debates forked from boxes on this map, by claim id. */
  subs?: Map<string, SubStatus>
}

export function ArgumentMap(props: Props) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  )
}

/** Re-fits the view whenever boxes are added or removed, without fighting the user's panning otherwise. */
function FitOnGrowth({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => fitView({ maxZoom: 1, padding: 0.15, duration: 250 }), 50)
    return () => clearTimeout(t)
  }, [count, fitView])
  return null
}

function MapCanvas({ map, selection, onSelect, highlight, writers, subs }: Props) {
  const { nodes, edges, sides } = useMemo(() => {
    const layout = layoutMap(map)
    const cruxes = findCruxes(map)
    // An objection aimed at a premise of another objection reads as a rebuttal.
    const sides = { for: map.debate.sides.for.label || 'For', against: map.debate.sides.against.label || 'Against' }
    // On an imported debate the poster is the admin who mapped it, not a debater, so only the speaker counts.
    const imported = map.debate.origin === 'imported'
    const byOf = (c: (typeof map.claims)[number]) => c.source?.speaker ?? (imported ? null : (map.debate.people[c.authorUid]?.name ?? null))
    const objectionPremises = new Set(map.links.filter((l) => l.kind === 'objection').flatMap((l) => l.premiseClaimIds))
    const groups: GroupNodeType[] = layout.groups.map((g) => ({
      id: 'group-' + g.link.id,
      type: 'premiseGroup',
      position: { x: g.x, y: g.y },
      data: {
        link: g.link,
        isRebuttal: objectionPremises.has(g.link.targetClaimId),
        stances: { for: stanceOf(map, g.link.id, 'for'), against: stanceOf(map, g.link.id, 'against') },
        selected: selection?.kind === 'link' && selection.id === g.link.id,
        sides,
      },
      style: { width: g.width, height: g.height },
      draggable: false,
      selectable: false,
      zIndex: 0,
    }))
    const claims: ClaimNodeType[] = layout.claims.map((p) => ({
      id: p.claim.id,
      type: 'claim',
      position: { x: p.x, y: p.y },
      data: {
        claim: p.claim,
        role: p.link ? p.link.kind : 'conclusion',
        stances: { for: stanceOf(map, p.claim.id, 'for'), against: stanceOf(map, p.claim.id, 'against') },
        isCrux: cruxes.has(p.claim.id),
        evidenceCount: map.evidence.filter((e) => e.claimId === p.claim.id).length,
        commentCount: map.comments.filter((c) => c.targetId === p.claim.id).length,
        selected: selection?.kind === 'claim' && selection.id === p.claim.id,
        isNew: !!highlight?.has(p.claim.id),
        writers: writers?.get(p.claim.id) ?? [],
        sub: subs?.get(p.claim.id),
        sides,
        by: byOf(p.claim),
      },
      style: { width: CLAIM_W },
      draggable: false,
      selectable: false,
      zIndex: 1,
    }))
    const edges: Edge[] = layout.groups.map((g) => {
      const color = g.link.kind === 'reason' ? 'var(--agree)' : 'var(--dis)'
      return {
        id: 'edge-' + g.link.id,
        source: 'group-' + g.link.id,
        target: g.link.targetClaimId,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      }
    })
    return { nodes: [...groups, ...claims], edges, sides }
  }, [map, selection, highlight, writers, subs])

  return (
    <div className="map-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
        nodesConnectable={false}
        onNodeClick={(_, node) =>
          onSelect?.(node.type === 'premiseGroup' ? { kind: 'link', id: node.id.replace(/^group-/, '') } : { kind: 'claim', id: node.id })
        }
        onPaneClick={() => onSelect?.(null)}
      >
        <FitOnGrowth count={nodes.length} />
        <Background gap={24} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <MapLegend sides={sides} />
        </Panel>
      </ReactFlow>
    </div>
  )
}

/** Says which colour is which side, and what the arrows mean. */
function MapLegend({ sides }: { sides: { for: string; against: string } }) {
  return (
    <div className="map-legend" aria-label="Map key">
      <span className="legend-item">
        <span className="side-dot for" aria-hidden="true" />
        {sides.for}
      </span>
      <span className="legend-item">
        <span className="side-dot against" aria-hidden="true" />
        {sides.against}
      </span>
      <span className="legend-item muted">
        <span className="legend-line reason" aria-hidden="true" />
        supports
      </span>
      <span className="legend-item muted">
        <span className="legend-line objection" aria-hidden="true" />
        objects
      </span>
    </div>
  )
}
