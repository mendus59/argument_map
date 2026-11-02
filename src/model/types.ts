// Core data model. See docs/SPEC.md for the meaning of each concept.

export type SideId = 'for' | 'against'
export const SIDES: SideId[] = ['for', 'against']

export type ClaimType = 'fact' | 'prediction' | 'value' | 'definition' | 'unspecified'
export type StanceValue = 'agree' | 'unsure' | 'disagree'
export type Outcome = 'accepted' | 'rejected' | 'disputed'

export interface ClaimRef {
  debateId: string
  claimId: string
}

export interface Side {
  label: string
  /** null until the other side's leader accepts their invite */
  leaderUid: string | null
  memberUids: string[]
}

export interface Person {
  name: string
  photoURL?: string | null
}

export interface Debate {
  id: string
  title: string
  subjects: string[]
  participantNames: string[]
  origin: 'native' | 'imported'
  visibility: 'private' | 'public'
  sides: Record<SideId, Side>
  readerUids: string[]
  /** Everyone who can open the debate: both sides' members plus readers. Used for queries and rules. */
  participantUids: string[]
  /** Display names for everyone in participantUids. */
  people: Record<string, Person>
  createdBy: string
  creatorSide: SideId
  /** The debate's conclusion. For a sub-debate this points at the forked claim in the parent. */
  conclusion: ClaimRef
  parent: ClaimRef | null
  status: 'open' | 'resolved'
  outcome: Outcome | null
  outcomeVotes: Partial<Record<SideId, Outcome>>
  unresolvedDepth: number
}

export interface Claim {
  id: string
  text: string
  type: ClaimType
  authorUid: string
  side: SideId
  /** false while the claim is an unplaced note */
  placed: boolean
  position?: { x: number; y: number }
  subDebateId?: string
  settledRef?: ClaimRef
  transcriptSpan?: { startLine: number; endLine: number }
  aiSuggested?: boolean
}

export interface Link {
  id: string
  kind: 'reason' | 'objection'
  targetClaimId: string
  /** Co-premises: all must hold for the link to work. */
  premiseClaimIds: string[]
  authorUid: string
  side: SideId
}

export interface Stance {
  /** A claim id or a link id (a link stance is the inference check). */
  targetId: string
  side: SideId
  value: StanceValue
  /** 0 to 100 */
  confidence: number
}

/** Everything needed to render one debate's map. */
export interface DebateMap {
  debate: Debate
  claims: Claim[]
  links: Link[]
  stances: Stance[]
}
