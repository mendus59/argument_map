import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { Claim, Link, Outcome, SideId, Stance } from '../model/types'
import { formatTime } from '../import/transcript'

export type SubStatus = { id: string; status: 'open' | 'resolved'; outcome: Outcome | null; depth: number }

export type ClaimNodeData = {
  claim: Claim
  role: 'conclusion' | 'reason' | 'objection'
  stances: { for?: Stance; against?: Stance }
  isCrux: boolean
  evidenceCount: number
  commentCount: number
  selected: boolean
  isNew: boolean
  writers: string[]
  sub?: SubStatus
  /** Each side's name, e.g. "For" or a speaker's name on an imported debate. */
  sides: Record<SideId, string>
  /** Who put the box up: the poster's name, or the speaker in the transcript. */
  by: string | null
}
export type GroupNodeData = {
  link: Link
  isRebuttal: boolean
  stances: { for?: Stance; against?: Stance }
  selected: boolean
  sides: Record<SideId, string>
}

export type ClaimNodeType = Node<ClaimNodeData, 'claim'>
export type GroupNodeType = Node<GroupNodeData, 'premiseGroup'>

const TYPE_LABEL: Record<Claim['type'], string> = {
  fact: 'Fact',
  prediction: 'Prediction',
  value: 'Value',
  definition: 'Definition',
  unspecified: 'Claim',
}

/** A short form of a side's name for the stance chips. */
function shortLabel(label: string) {
  const t = label.trim()
  return t.length <= 10 ? t : t.slice(0, 9).trimEnd() + '…'
}

function StanceChip({ side, label, stance }: { side: SideId; label: string; stance?: Stance }) {
  const dot = <span className={`side-dot ${side}`} aria-hidden="true" />
  if (!stance)
    return (
      <span className="chip none" title={`${label} hasn’t taken a stance`}>
        {dot}
        {shortLabel(label)} –
      </span>
    )
  const text = stance.value === 'agree' ? '✓' : stance.value === 'disagree' ? '✗' : '?'
  const verb = stance.value === 'agree' ? 'agrees' : stance.value === 'disagree' ? 'disagrees' : 'is unsure'
  return (
    <span className={`chip ${stance.value}`} title={`${label} ${verb}, ${stance.confidence}% confident`}>
      {dot}
      {shortLabel(label)} {text} {stance.confidence}%
    </span>
  )
}

/** The strip at the top of a box that says which side argued it, and who. */
function SideTag({ side, label, by }: { side: SideId; label: string; by: string | null }) {
  const showBy = by && by.trim().toLowerCase() !== label.trim().toLowerCase()
  return (
    <span className={`side-tag ${side}`} title={`Argued by ${label}${showBy ? ` (${by})` : ''}`}>
      <span className="side-dot" aria-hidden="true" />
      <span className="side-name">{label}</span>
      {showBy && <span className="side-by">{by}</span>}
    </span>
  )
}

export function ClaimNode({ data }: NodeProps<ClaimNodeType>) {
  const { claim, role, stances, isCrux, evidenceCount, commentCount, selected, isNew, writers, sub, sides, by } = data
  return (
    <div className={`claim-node ${role} side-${claim.side}${selected ? ' selected' : ''}${isNew ? ' new' : ''}`}>
      {isNew && <span className="badge new-badge">New</span>}
      {writers.length > 0 && <span className="writing">✎ {writers.join(', ')} writing…</span>}
      <Handle type="target" position={Position.Bottom} isConnectable={false} />
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <div className="node-head">
        <SideTag side={claim.side} label={sides[claim.side]} by={by} />
        <span className={`kind kind-${claim.type}`}>{TYPE_LABEL[claim.type]}</span>
      </div>
      <p className="claim-text">{claim.text}</p>
      <div className="chips">
        <StanceChip side="for" label={sides.for} stance={stances.for} />
        <StanceChip side="against" label={sides.against} stance={stances.against} />
        {isCrux && <span className="badge crux">Crux</span>}
        {claim.subDebateId && role !== 'conclusion' && <SubBadge sub={sub} />}
        {claim.settledRef && (
          <span className="badge settled" title="Settled in a sub-debate">
            ✓ Settled
          </span>
        )}
        {claim.aiSuggested && (
          <span className="badge ai" title="Suggested by AI and accepted by the admin">
            AI
          </span>
        )}
        {evidenceCount > 0 && (
          <span className="count" title={`${evidenceCount} ${evidenceCount === 1 ? 'source' : 'sources'}`}>
            ⧉ {evidenceCount}
          </span>
        )}
        {commentCount > 0 && (
          <span className="count" title={`${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}>
            ✎ {commentCount}
          </span>
        )}
        {claim.source && (
          <span className="badge time" title={`${claim.source.speaker ?? 'Transcript'}: “${claim.source.quote}”`}>
            {claim.source.start !== null ? `▶ ${formatTime(claim.source.start)}` : '“ ”'}
          </span>
        )}
      </div>
    </div>
  )
}

function SubBadge({ sub }: { sub?: SubStatus }) {
  if (!sub || sub.status === 'open') {
    return (
      <span className="badge fork" title="Being argued in a sub-debate">
        ⑂ Sub-debate{sub ? ` · depth ${sub.depth}` : ''}
      </span>
    )
  }
  const label = sub.outcome === 'accepted' ? '✓ Accepted' : sub.outcome === 'rejected' ? '✗ Rejected' : '⇄ Agree to disagree'
  return (
    <span className={`badge outcome-${sub.outcome}`} title="Settled in a sub-debate">
      {label}
    </span>
  )
}

export function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { link, isRebuttal, stances, selected, sides } = data
  const n = link.premiseClaimIds.length
  const name = link.kind === 'reason' ? 'Reason' : isRebuttal ? 'Rebuttal' : 'Objection'
  const label = n > 2 ? `${name} · all ${n} must hold` : n === 2 ? `${name} · both must hold` : name
  const who = sides[link.side]
  return (
    <div className={`group-node ${link.kind}${selected ? ' selected' : ''}`} title="Select to check whether these premises lead to the conclusion">
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <span className="group-label">
        <span className={`group-side ${link.side}`} title={`${who}’s argument`}>
          <span className="side-dot" aria-hidden="true" />
          {shortLabel(who)}
        </span>
        {label}
        {(stances.for || stances.against) && (
          <span className="group-chips">
            <StanceChip side="for" label={sides.for} stance={stances.for} />
            <StanceChip side="against" label={sides.against} stance={stances.against} />
          </span>
        )}
      </span>
    </div>
  )
}
