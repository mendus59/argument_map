// Asks Claude to map an imported debate from its transcript, and turns the answer into a
// plan of boxes and links that can be written in one batch. Pure, so it is unit tested.
import type { Segment } from '../import/transcript'
import type { ClaimType, DebateMap, SideId } from '../model/types'
import { buildUserPrompt } from './analysis'

/** Keeps one run inside a single Firestore batch (500 writes) with room to spare. */
export const MAX_PREMISES = 150

export const AUTOMAP_SYSTEM_PROMPT = `You map a recorded debate as an argument map, from its transcript.

An argument map is made of boxes (claims). Each argument is one or more co-premise boxes that together give a reason for, or an objection to, a target box. Co-premises belong in the same argument only when they work together (each needs the others); independent reasons are separate arguments. The top box is the debate's conclusion, given as the conclusion box id.

Map what the speakers actually argued:
- Start from the conclusion. Add the main reasons for it and objections to it, then reasons and objections to those premises, as deep as the speakers went.
- Each premise is one clear, self-contained claim in plain English, under 200 characters, faithful to what the speaker said. Do not invent arguments no one made, and do not add your own.
- side is the side of the speaker who made the argument ("for" or "against"). A moderator's questions are not arguments.
- type: "fact" for checkable claims about the world, "prediction" for claims about the future, "value" for claims about what is good or right, "definition" for what a term means, "unspecified" if unsure.
- segment is the transcript line number the premise comes from, or -1 if it is spread across several.
- Give every premise a short unique id such as "p1", "p2". targetId is the conclusion box id, the id of a box already on the map, or the id of a premise you defined in an earlier argument.
- If the map already has boxes, extend it: do not repeat arguments already there.
- Prefer the arguments that mattered most. At most ${MAX_PREMISES} premises in total.`

export const AUTOMAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['arguments'],
  properties: {
    arguments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['targetId', 'kind', 'side', 'premises'],
        properties: {
          targetId: { type: 'string' },
          kind: { type: 'string', enum: ['reason', 'objection'] },
          side: { type: 'string', enum: ['for', 'against'] },
          premises: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'text', 'type', 'segment'],
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                type: { type: 'string', enum: ['fact', 'prediction', 'value', 'definition', 'unspecified'] },
                segment: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
} as const

export function buildMapPrompt(map: DebateMap, segments: Segment[]) {
  return buildUserPrompt(map, segments)
}

export interface PlannedPremise {
  key: string
  text: string
  type: ClaimType
  segment: number | null
}

export interface PlannedArgument {
  /** An existing box id, or the key of a premise planned earlier in the list. */
  target: { existing: string } | { planned: string }
  kind: 'reason' | 'objection'
  side: SideId
  premises: PlannedPremise[]
}

const TYPES: ClaimType[] = ['fact', 'prediction', 'value', 'definition', 'unspecified']

/**
 * Checks Claude's map and orders it so every argument's target exists before it.
 * Drops arguments that point nowhere, duplicate premise ids, and anything past the cap.
 */
export function planAutoMap(raw: unknown, map: DebateMap, segmentCount: number): PlannedArgument[] {
  const existing = new Set(map.claims.filter((c) => c.placed).map((c) => c.id))
  existing.add(map.debate.conclusion.claimId)
  const list = ((raw as { arguments?: unknown[] })?.arguments ?? []) as Record<string, unknown>[]
  const pending = list
    .map((a) => {
      const side: SideId | null = a.side === 'for' || a.side === 'against' ? a.side : null
      const kind = a.kind === 'objection' ? 'objection' : a.kind === 'reason' ? 'reason' : null
      const premises = ((a.premises as Record<string, unknown>[] | undefined) ?? [])
        .map((p) => ({
          key: typeof p.id === 'string' ? p.id.trim() : '',
          text: typeof p.text === 'string' ? p.text.trim().slice(0, 1000) : '',
          type: TYPES.includes(p.type as ClaimType) ? (p.type as ClaimType) : 'unspecified',
          segment: typeof p.segment === 'number' && Number.isInteger(p.segment) && p.segment >= 0 && p.segment < segmentCount ? p.segment : null,
        }))
        .filter((p) => p.key && p.text)
        .slice(0, 8)
      const targetId = typeof a.targetId === 'string' ? a.targetId.trim() : ''
      return side && kind && premises.length && targetId ? { targetId, kind, side, premises } : null
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)

  const planned = new Set<string>()
  const out: PlannedArgument[] = []
  let total = 0
  // Repeated passes place arguments whose target appears later in Claude's list.
  for (let progress = true; progress && pending.length; ) {
    progress = false
    for (let i = 0; i < pending.length; i++) {
      const a = pending[i]
      const target = existing.has(a.targetId) ? { existing: a.targetId } : planned.has(a.targetId) ? { planned: a.targetId } : null
      if (!target) continue
      pending.splice(i--, 1)
      progress = true
      const premises = a.premises.filter((p) => !planned.has(p.key) && !existing.has(p.key))
      if (!premises.length || total + premises.length > MAX_PREMISES) continue
      premises.forEach((p) => planned.add(p.key))
      total += premises.length
      out.push({ target, kind: a.kind as PlannedArgument['kind'], side: a.side, premises })
    }
  }
  return out
}

export function premiseCount(plan: PlannedArgument[]) {
  return plan.reduce((n, a) => n + a.premises.length, 0)
}
