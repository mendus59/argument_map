import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { Claim, Link, Stance } from '../model/types'

export type ClaimNodeData = {
  claim: Claim
  role: 'conclusion' | 'reason' | 'objection'
  stances: { for?: Stance; against?: Stance }
  isCrux: boolean
}
export type GroupNodeData = { link: Link; isRebuttal: boolean }

export type ClaimNodeType = Node<ClaimNodeData, 'claim'>
export type GroupNodeType = Node<GroupNodeData, 'premiseGroup'>

const TYPE_LABEL: Record<Claim['type'], string> = {
  fact: 'Fact',
  prediction: 'Prediction',
  value: 'Value',
  definition: 'Definition',
  unspecified: 'Claim',
}

function StanceChip({ side, stance }: { side: 'F' | 'A'; stance?: Stance }) {
  if (!stance) return <span className="chip none">{side} –</span>
  const text = stance.value === 'agree' ? '✓' : stance.value === 'disagree' ? '✗' : '?'
  return (
    <span className={`chip ${stance.value}`} title={`${stance.value}, ${stance.confidence}% confident`}>
      {side} {text} {stance.confidence}%
    </span>
  )
}

export function ClaimNode({ data }: NodeProps<ClaimNodeType>) {
  const { claim, role, stances, isCrux } = data
  return (
    <div className={`claim-node ${role}`}>
      <Handle type="target" position={Position.Bottom} isConnectable={false} />
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <span className={`kind kind-${claim.type}`}>{TYPE_LABEL[claim.type]}</span>
      <p className="claim-text">{claim.text}</p>
      <div className="chips">
        <StanceChip side="F" stance={stances.for} />
        <StanceChip side="A" stance={stances.against} />
        {isCrux && <span className="badge crux">Crux</span>}
        {claim.subDebateId && <span className="badge fork">⑂ Sub-debate</span>}
      </div>
    </div>
  )
}

export function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { link, isRebuttal } = data
  const n = link.premiseClaimIds.length
  const name = link.kind === 'reason' ? 'Reason' : isRebuttal ? 'Rebuttal' : 'Objection'
  const label = n > 1 ? `${name} · all ${n} must hold` : name
  return (
    <div className={`group-node ${link.kind}`}>
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <span className="group-label">{label}</span>
    </div>
  )
}
