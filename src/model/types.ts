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
  /** For a sub-debate, the top-level debate whose teams it shares. */
  root?: string | null
  /** Sub-debates forked from boxes in this debate, by id. */
  subDebates?: Record<string, { claimId: string; title: string }>
  status: 'open' | 'resolved'
  outcome: Outcome | null
  outcomeVotes: Partial<Record<SideId, Outcome>>
  unresolvedDepth: number
  settings?: DebateSettings
  /** Optional timed round. Informational: nothing stops the other side posting. */
  round?: Round | null
  /** Where an imported debate came from. */
  source?: DebateSource
  /** A summary drafted by AI and shown to readers by the admin. */
  aiSummary?: { overall: string; for: string; against: string } | null
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
  /** Reuses a claim the same two people already agreed in another debate (or elsewhere in this one). */
  groundRef?: ClaimRef & { version: number }
  source?: ClaimSource
  aiSuggested?: boolean
  /** Goes up by one each time the author changes the wording. Missing means 1. */
  version?: number
  createdAt?: Time
}

/** An earlier wording of a claim, kept when its author changes it. */
export interface ClaimVersion {
  claimId: string
  version: number
  text: string
  type: ClaimType
  by: string
  at?: Time
}

/**
 * The other side's answer to a claim: accepted or disputed, for one version of
 * its wording. One per claim per side; only that side's leader sets it.
 */
export interface Acceptance {
  claimId: string
  side: SideId
  version: number
  value: 'accepted' | 'disputed'
  by: string
  at?: Time
}

/** A phrase in a claim that one side wants pinned down. Its definitions are proposed and answered in turn. */
export interface Term {
  id: string
  claimId: string
  phrase: string
  openedBy: string
  side: SideId
  createdAt?: Time
}

/**
 * A proposed meaning for a term. The other side accepts it, or rejects it with
 * a counter-definition or an addendum (a definition whose parentId is the rejected one).
 */
export interface Definition {
  id: string
  termId: string
  claimId: string
  text: string
  kind: 'definition' | 'counter' | 'addendum'
  parentId: string | null
  by: string
  side: SideId
  status: 'pending' | 'accepted' | 'rejected'
  respondedBy: string | null
  /** For a rejection: the counter-definition or addendum that answered it. */
  answeredWith?: string | null
  createdAt?: Time
}

/** A challenge to a claim's wording: replace `phrase` with `suggestion`. The claim's author takes it or declines. */
export interface Rewording {
  id: string
  claimId: string
  claimVersion: number
  phrase: string
  suggestion: string
  reason: string
  by: string
  side: SideId
  status: 'open' | 'accepted' | 'declined'
  reply: string | null
  respondedBy: string | null
  createdAt?: Time
}

/** A claim both people have agreed, listed for reuse in any of their debates. */
export interface GroundEntry {
  id: string
  debateId: string
  claimId: string
  /** The side that accepted it (the other side posted it). */
  side: SideId
  text: string
  version: number
  by: string
  at?: Time
}

/** An agreed term meaning, or an agreed change of wording, between the same two people. */
export interface GlossaryEntry {
  id: string
  debateId: string
  kind: 'term' | 'wording'
  claimId: string
  termId: string | null
  defId: string | null
  rewordingId: string | null
  phrase: string
  /** kind 'term': what the phrase means. */
  meaning: string | null
  /** kind 'wording': the wording to use instead of `phrase`. */
  replacement: string | null
  by: string
  at?: Time
}

/** Live status of a claim that another box reuses through groundRef. */
export interface GroundedStatus {
  status: 'proposed' | 'agreed' | 'changed' | 'unsettled' | 'disputed'
  accepted: boolean
  title?: string
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
  /** Agreement on claims: answers, terms, definitions, wording challenges and earlier wordings. */
  acceptances?: Acceptance[]
  terms?: Term[]
  definitions?: Definition[]
  rewordings?: Rewording[]
  versions?: ClaimVersion[]
  /** For boxes that reuse an agreed claim: that claim's live status, by box id. */
  grounded?: Record<string, GroundedStatus>
}
