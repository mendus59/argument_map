import { useMemo } from 'react'
import { Background, Controls, MarkerType, ReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DebateMap } from '../model/types'
import { findCruxes, stanceOf } from '../model/crux'
import { layoutMap, CLAIM_W } from './layout'
import { ClaimNode, GroupNode, type ClaimNodeType, type GroupNodeType } from './nodes'

const nodeTypes = { claim: ClaimNode, premiseGroup: GroupNode }

/** Read-only argument map. Editing arrives in milestone 2. */
export function ArgumentMap({ map }: { map: DebateMap }) {
  const { nodes, edges } = useMemo(() => {
    const layout = layoutMap(map)
    const cruxes = findCruxes(map)
    // An objection aimed at a premise of another objection reads as a rebuttal.
    const objectionPremises = new Set(map.links.filter((l) => l.kind === 'objection').flatMap((l) => l.premiseClaimIds))
    const groups: GroupNodeType[] = layout.groups.map((g) => ({
      id: 'group-' + g.link.id,
      type: 'premiseGroup',
      position: { x: g.x, y: g.y },
      data: { link: g.link, isRebuttal: objectionPremises.has(g.link.targetClaimId) },
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
      },
      style: { width: CLAIM_W },
      draggable: false,
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
    return { nodes: [...groups, ...claims], edges }
  }, [map])

  return (
    <div className="map-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesConnectable={false}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
