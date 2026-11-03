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
  settings?: DebateSettings
  /** Optional timed round. Informational: nothing stops the other side posting. */
  round?: Round | null
  /** Where an imported debate came from. */
  source?: DebateSource
  /** Lower-cased participant names and subjects, for searching public debates. */
  searchTerms?: string[]
}

export interface Round {
  number: number
  side: SideId
  minutes: number
  /** Milliseconds since the epoch. */
  endsAt: number
  startedBy: string
}

export interface DebateSettings {
  /** Objecting to the other side's box first asks you to restate it. On unless a leader turns it off. */
  restateFirst?: boolean
}

/** Firestore timestamps, kept loose so the model doesn't depend on the SDK. */
export type Time = { toMillis(): number } | null | undefined

export interface DebateSource {
  kind: 'youtube' | 'transcript'
  url: string | null
  videoId: string | null
  title: string
  channel: string | null
  /** Speakers found in the transcript and the side each argued for (null for moderators). */
  speakers: { label: string; side: SideId | null }[]
  segmentCount: number
}

/** The transcript passage a claim was mapped from. */
export interface ClaimSource {
  segment: number
  start: number | null
  speaker: string | null
  quote: string
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
  source?: ClaimSource
  aiSuggested?: boolean
  createdAt?: Time
}

export interface Link {
  id: string
  kind: 'reason' | 'objection'
  targetClaimId: string
  /** Co-premises: all must hold for the link to work. */
  premiseClaimIds: string[]
  authorUid: string
  side: SideId
  createdAt?: Time
}

export interface Stance {
  /** A claim id or a link id (a link stance is the inference check). */
  targetId: string
  side: SideId
  value: StanceValue
  /** 0 to 100 */
  confidence: number
}

export type EvidenceKind = 'study' | 'data' | 'news' | 'anecdote' | 'opinion'

/** Supporting material attached to a claim. */
export interface Evidence {
  id: string
  claimId: string
  url: string | null
  title: string
  kind: EvidenceKind
  addedBy: string
  side: SideId
  createdAt?: Time
}

/**
 * A comment on a claim or link. A restatement is a paraphrase of the other side's
 * claim, written before objecting to it, which that side confirms or corrects.
 */
export interface Comment {
  id: string
  targetId: string
  authorUid: string
  side: SideId
  kind: 'comment' | 'restatement'
  text: string
  status?: 'pending' | 'confirmed' | 'disputed'
  reply?: string | null
  respondedBy?: string | null
  respondedAt?: Time
  createdAt?: Time
}

/** One change to a side's stance, kept so concessions and shifts stay visible. */
export interface StanceChange {
  id: string
  targetId: string
  side: SideId
  from: { value: StanceValue; confidence: number } | null
  to: { value: StanceValue; confidence: number }
  conceded: boolean
  by: string
  at?: Time
}

/** Everything needed to render one debate's map. */
export interface DebateMap {
  debate: Debate
  claims: Claim[]
  links: Link[]
  stances: Stance[]
  evidence: Evidence[]
  comments: Comment[]
}
