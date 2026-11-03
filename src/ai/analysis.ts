// Builds the AI analysis request for an imported debate and checks what comes back.
// Pure: no network or Firestore, so it is unit tested.
import type { Segment } from '../import/transcript'
import type { DebateMap, SideId } from '../model/types'

export const MODEL = 'claude-opus-5-5'
/** Output cap per run. Thinking counts toward it. */
export const MAX_OUTPUT_TOKENS = 32000
/** A typical run's output, for the "likely" figure in the estimate. */
export const TYPICAL_OUTPUT_TOKENS = 8000

/** US dollars per million tokens. Fallback models are listed so a rescued run is costed right. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
}

export function priceOf(model: string) {
  return PRICES[model] ?? PRICES[MODEL]
}

export function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const p = priceOf(model)
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

export interface Estimate {
  inputTokens: number
  likelyUsd: number
  maxUsd: number
}

export function estimate(inputTokens: number): Estimate {
  return {
    inputTokens,
    likelyUsd: costUsd(MODEL, inputTokens, TYPICAL_OUTPUT_TOKENS),
    maxUsd: costUsd(MODEL, inputTokens, MAX_OUTPUT_TOKENS),
  }
}

export type SuggestionKind = 'hidden_premise' | 'fallacy' | 'missed_argument'

export interface Suggestion {
  kind: SuggestionKind
  side: SideId
  /** The box it is about. For a missed argument, the box it supports or objects to. */
  targetClaimId: string
  /** Hidden premise only: the argument (link) it completes. */
  linkId: string | null
  /** The premise or argument wording, or the fallacy's name. */
  text: string
  explanation: string
  /** Transcript segment index, when one passage shows it. */
  segment: number | null
  relation: 'reason' | 'objection'
}

export interface AnalysisResult {
  summary: { overall: string; for: string; against: string }
  suggestions: Suggestion[]
}

/** JSON schema for structured output. Sentinels ("" and -1) stand in for "none". */
export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'suggestions'],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'for', 'against'],
      properties: {
        overall: { type: 'string', description: 'Two to four neutral sentences on what the debate turned on.' },
        for: { type: 'string', description: "The first side's case at its strongest, in two to four sentences." },
        against: { type: 'string', description: "The second side's case at its strongest, in two to four sentences." },
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'side', 'targetClaimId', 'linkId', 'text', 'explanation', 'segment', 'relation'],
        properties: {
          kind: { type: 'string', enum: ['hidden_premise', 'fallacy', 'missed_argument'] },
          side: { type: 'string', enum: ['for', 'against'] },
          targetClaimId: { type: 'string' },
          linkId: { type: 'string' },
          text: { type: 'string' },
          explanation: { type: 'string' },
          segment: { type: 'integer' },
          relation: { type: 'string', enum: ['reason', 'objection'] },
        },
      },
    },
  },
} as const

export const SYSTEM_PROMPT = `You analyse a debate that has been mapped as an argument map, to help the person mapping it.

The map is made of boxes (claims). Each argument is a link: one or more co-premise boxes that together give a reason for, or an objection to, a target box. The top box is the debate's conclusion. Each box belongs to the side that put it forward.

Return four things:
1. A neutral summary: what the debate turned on, and each side's case at its strongest. Be fair to both sides.
2. Hidden premises: for an argument (link) whose premises do not reach its target on their own, the unstated assumption the speaker relies on. Give the link id in linkId, its target in targetClaimId, and the speaker's side. State the premise as a plain claim the speaker would accept.
3. Fallacies: a box or argument that commits a recognised fallacy. Put the fallacy's name in text, the box in targetClaimId, and the side that committed it. Explain briefly and charitably why it is a problem. Only flag clear cases; a strong argument you disagree with is not a fallacy.
4. Missed arguments: a reason or objection made in the transcript that is not on the map yet. Put the claim in text, the box it bears on in targetClaimId, reason or objection in relation, the speaker's side, and the transcript segment number in segment.

Rules:
- Use only ids that appear in the map. Use "" for linkId when it does not apply, and -1 for segment when no single passage shows it.
- relation is "reason" for anything that is not a missed objection.
- Quote and paraphrase faithfully; never invent what a speaker said.
- Prefer a few well-founded suggestions to many weak ones. At most 25 in total.
- Write in plain English, each text under 300 characters and each explanation under 400.`

const SIDE_NAME = (map: DebateMap, s: SideId) => `${map.debate.sides[s].label} (${s})`

/** The map and transcript as compact text for the user turn. */
export function buildUserPrompt(map: DebateMap, segments: Segment[]): string {
  const { debate, claims, links } = map
  const placed = claims.filter((c) => c.placed)
  const lines: string[] = []
  lines.push(`Debate: ${debate.title}`)
  lines.push(`Sides: "for" is ${SIDE_NAME(map, 'for')}; "against" is ${SIDE_NAME(map, 'against')}.`)
  const speakers = debate.source?.speakers ?? []
  if (speakers.length) {
    lines.push(`Speakers: ${speakers.map((s) => `${s.label} = ${s.side ?? 'moderator'}`).join('; ')}`)
  }
  lines.push('', '<map>')
  lines.push(`Conclusion box: ${debate.conclusion.claimId}`)
  for (const c of placed) lines.push(`box ${c.id} [${c.side}]: ${c.text}`)
  for (const l of links) {
    lines.push(`link ${l.id} [${l.side}] ${l.kind} for box ${l.targetClaimId}: premises ${l.premiseClaimIds.join(' + ')}`)
  }
  lines.push('</map>', '', '<transcript>')
  segments.forEach((s, i) => lines.push(`${i}${s.speaker ? ` ${s.speaker}` : ''}: ${s.text}`))
  lines.push('</transcript>')
  return lines.join('\n')
}

/** Keeps only suggestions that point at real boxes and links, and turns sentinels into nulls. */
export function cleanResult(raw: unknown, map: DebateMap, segmentCount: number): AnalysisResult {
  const r = raw as { summary?: Partial<AnalysisResult['summary']>; suggestions?: unknown[] }
  const claimIds = new Set(map.claims.map((c) => c.id))
  const links = new Map(map.links.map((l) => [l.id, l]))
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const suggestions: Suggestion[] = []
  for (const item of r.suggestions ?? []) {
    const s = item as Record<string, unknown>
    const kind = s.kind as SuggestionKind
    if (!['hidden_premise', 'fallacy', 'missed_argument'].includes(kind)) continue
    const side = s.side === 'against' ? 'against' : s.side === 'for' ? 'for' : null
    const target = str(s.targetClaimId, 100)
    const text = str(s.text, 1000)
    if (!side || !text || !claimIds.has(target)) continue
    let linkId: string | null = str(s.linkId, 100) || null
    if (kind === 'hidden_premise') {
      const link = linkId ? links.get(linkId) : undefined
      if (!link || link.targetClaimId !== target) continue
    } else {
      linkId = null
    }
    const seg = typeof s.segment === 'number' && Number.isInteger(s.segment) && s.segment >= 0 && s.segment < segmentCount ? s.segment : null
    suggestions.push({
      kind,
      side,
      targetClaimId: target,
      linkId,
      text,
      explanation: str(s.explanation, 2000),
      segment: seg,
      relation: kind === 'missed_argument' && s.relation === 'objection' ? 'objection' : 'reason',
    })
  }
  return {
    summary: { overall: str(r.summary?.overall, 3000), for: str(r.summary?.for, 3000), against: str(r.summary?.against, 3000) },
    suggestions,
  }
}

/** "2026-11" for the month a run is counted against. */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatUsd(n: number) {
  return n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`
}
