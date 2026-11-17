// How far two sides have got towards agreeing a claim: its answer from the other
// side, the terms in it being defined, and challenges to its wording.
import type { Acceptance, Claim, DebateMap, Definition, Rewording, SideId, Term } from './types'

export const otherSide = (s: SideId): SideId => (s === 'for' ? 'against' : 'for')
export const versionOf = (c: Pick<Claim, 'version'>) => c.version ?? 1

const millis = (t: Definition['createdAt']) => t?.toMillis() ?? Number.MAX_SAFE_INTEGER

export interface TermState {
  term: Term
  /** undefined: no definition yet. pending: one waits for an answer. agreed: the latest was accepted. */
  state: 'undefined' | 'pending' | 'agreed'
  /** The definition being considered, or the one agreed. */
  current: Definition | null
  /** The agreed meaning in full (an accepted addendum includes what it adds to). */
  meaning: string | null
  /** Every definition proposed for the term, oldest first. */
  history: Definition[]
  /** Both sides have rejected a definition: a real point of contention. */
  contested: boolean
}

/** The full meaning of a definition: an addendum adds to the definition it answered. */
export function meaningOf(def: Definition, all: Definition[], depth = 0): string {
  if (def.kind !== 'addendum' || !def.parentId || depth > 20) return def.text
  const parent = all.find((d) => d.id === def.parentId)
  return parent ? `${meaningOf(parent, all, depth + 1).replace(/[\s.;,]+$/, '')}, ${def.text}` : def.text
}

export function termState(term: Term, definitions: Definition[]): TermState {
  const history = definitions.filter((d) => d.termId === term.id).sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
  const live = history.filter((d) => d.status !== 'rejected')
  const current = live[live.length - 1] ?? null
  const rejectedBy = new Set(history.filter((d) => d.status === 'rejected').map((d) => otherSide(d.side)))
  return {
    term,
    state: !current ? 'undefined' : current.status === 'accepted' ? 'agreed' : 'pending',
    current,
    meaning: current?.status === 'accepted' ? meaningOf(current, history) : null,
    history,
    contested: rejectedBy.size === 2,
  }
}

export type ClaimStatus = 'proposed' | 'agreed' | 'changed' | 'unsettled' | 'disputed'

export interface ClaimAgreement {
  status: ClaimStatus
  /** The side whose answer the claim needs. */
  opponent: SideId
  acceptance: Acceptance | undefined
  version: number
  terms: TermState[]
  openTerms: TermState[]
  openRewordings: Rewording[]
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  proposed: 'Waiting for an answer',
  agreed: 'Agreed',
  changed: 'Changed since it was accepted',
  unsettled: 'Open questions',
  disputed: 'Disputed',
}

export function claimAgreement(map: DebateMap, claim: Claim): ClaimAgreement {
  const opponent = otherSide(claim.side)
  const acceptance = (map.acceptances ?? []).find((a) => a.claimId === claim.id && a.side === opponent)
  const version = versionOf(claim)
  const terms = (map.terms ?? []).filter((t) => t.claimId === claim.id).map((t) => termState(t, map.definitions ?? []))
  const openTerms = terms.filter((t) => t.state !== 'agreed')
  const openRewordings = (map.rewordings ?? []).filter((r) => r.claimId === claim.id && r.status === 'open')
  let status: ClaimStatus
  if (acceptance?.value === 'disputed') status = 'disputed'
  else if (acceptance && acceptance.version < version) status = 'changed'
  else if (openTerms.length || openRewordings.length) status = 'unsettled'
  else if (acceptance) status = 'agreed'
  else status = 'proposed'
  return { status, opponent, acceptance, version, terms, openTerms, openRewordings }
}

/** Every term in the debate whose meaning both sides have agreed. */
export function agreedTerms(map: DebateMap): { phrase: string; meaning: string; claimId: string }[] {
  return (map.terms ?? [])
    .map((t) => termState(t, map.definitions ?? []))
    .filter((t) => t.state === 'agreed')
    .map((t) => ({ phrase: t.term.phrase, meaning: t.meaning!, claimId: t.term.claimId }))
}

/** Whether `phrase` appears in `text`, ignoring case and extra spaces. */
export function containsPhrase(text: string, phrase: string) {
  const p = normalise(phrase)
  return p.length > 0 && normalise(text).includes(p)
}

/** Replaces the first occurrence of `phrase` in `text` (ignoring case) with `replacement`. */
export function replacePhrase(text: string, phrase: string, replacement: string) {
  const p = phrase.trim()
  if (!p) return text
  const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i')
  return text.replace(re, replacement.trim())
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
