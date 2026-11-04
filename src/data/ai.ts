import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { AnalysisResult, Suggestion } from '../ai/analysis'
import { premiseCount, type PlannedArgument } from '../ai/automap'
import type { Segment } from '../import/transcript'
import type { Time } from '../model/types'

/** The default monthly cap until the admin sets one, in US dollars. */
export const DEFAULT_CAP_USD = 10

export type SuggestionStatus = 'accepted' | 'dismissed'

export interface Analysis extends AnalysisResult {
  id: string
  /** Missing on analyses saved before auto-mapping existed. */
  kind?: 'analysis' | 'automap'
  by: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Review state by suggestion index. Missing means not reviewed yet. */
  review: Record<string, SuggestionStatus>
  createdAt?: Time
}

const aiDoc = (db: Firestore, uid: string, id: string) => doc(db, 'users', uid, 'ai', id)

export async function getBudget(db: Firestore, uid: string, month: string) {
  const [settings, usage] = await Promise.all([getDoc(aiDoc(db, uid, 'settings')), getDoc(aiDoc(db, uid, month))])
  return {
    capUsd: (settings.data()?.monthlyCapUsd as number | undefined) ?? DEFAULT_CAP_USD,
    spentUsd: (usage.data()?.spentUsd as number | undefined) ?? 0,
    runs: (usage.data()?.runs as number | undefined) ?? 0,
  }
}

export async function setCap(db: Firestore, uid: string, capUsd: number) {
  await setDoc(aiDoc(db, uid, 'settings'), { monthlyCapUsd: capUsd, updatedAt: serverTimestamp() }, { merge: true })
}

/** Adds a finished run's cost to the month's total. */
export async function recordSpend(db: Firestore, uid: string, month: string, usd: number) {
  await setDoc(aiDoc(db, uid, month), { spentUsd: increment(usd), runs: increment(1), updatedAt: serverTimestamp() }, { merge: true })
}

export async function saveAnalysis(
  db: Firestore,
  user: User,
  debateId: string,
  run: { model: string; inputTokens: number; outputTokens: number; costUsd: number },
  result: AnalysisResult,
) {
  const ref = await addDoc(collection(db, 'debates', debateId, 'analyses'), {
    by: user.uid,
    ...run,
    ...result,
    kind: 'analysis',
    review: {},
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/** The debate's analyses, newest first. Admin only. */
export function watchAnalyses(db: Firestore, debateId: string, onChange: (list: Analysis[]) => void, onError: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, 'debates', debateId, 'analyses'), orderBy('createdAt', 'desc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Analysis, 'id'>) }))),
    onError,
  )
}

export async function dismissSuggestion(db: Firestore, debateId: string, analysisId: string, index: number) {
  await updateDoc(doc(db, 'debates', debateId, 'analyses', analysisId), { [`review.${index}`]: 'dismissed' })
}

/**
 * Puts a suggestion on the map: a hidden premise joins its argument as a co-premise,
 * a missed argument becomes a new reason or objection, and a fallacy becomes a comment on the box.
 */
export async function acceptSuggestion(
  db: Firestore,
  user: User,
  debateId: string,
  analysisId: string,
  index: number,
  s: Suggestion,
  segments: Segment[],
) {
  const debateRef = doc(db, 'debates', debateId)
  const batch = writeBatch(db)
  const claim = (extra: object) => {
    const ref = doc(collection(debateRef, 'claims'))
    batch.set(ref, { text: s.text, type: 'unspecified', authorUid: user.uid, side: s.side, placed: true, aiSuggested: true, ...extra, createdAt: serverTimestamp() })
    return ref.id
  }
  if (s.kind === 'hidden_premise' && s.linkId) {
    const id = claim({})
    batch.update(doc(debateRef, 'links', s.linkId), { premiseClaimIds: arrayUnion(id) })
  } else if (s.kind === 'missed_argument') {
    const seg = s.segment !== null ? segments[s.segment] : undefined
    const source = seg ? { source: { segment: s.segment, start: seg.start, speaker: seg.speaker, quote: seg.text } } : {}
    const id = claim(source)
    batch.set(doc(collection(debateRef, 'links')), {
      kind: s.relation,
      targetClaimId: s.targetClaimId,
      premiseClaimIds: [id],
      authorUid: user.uid,
      side: s.side,
      createdAt: serverTimestamp(),
    })
  } else if (s.kind === 'fallacy') {
    batch.set(doc(collection(debateRef, 'comments')), {
      targetId: s.targetClaimId,
      authorUid: user.uid,
      side: s.side === 'for' ? 'against' : 'for',
      kind: 'comment',
      text: `Possible ${s.text.toLowerCase()} (AI check): ${s.explanation}`.slice(0, 2000),
      createdAt: serverTimestamp(),
    })
  }
  batch.update(doc(debateRef, 'analyses', analysisId), { [`review.${index}`]: 'accepted' })
  await batch.commit()
}

/** Shows the summary to everyone who can open the debate. Null takes it down. */
export async function publishSummary(db: Firestore, debateId: string, summary: AnalysisResult['summary'] | null) {
  await updateDoc(doc(db, 'debates', debateId), { aiSummary: summary, updatedAt: serverTimestamp() })
}

export interface AutoMapRun {
  id: string
  kind: 'automap'
  by: string
  model: string
  costUsd: number
  boxes: number
  arguments: number
  undone: boolean
  createdAt?: Time
}

type RunInfo = { model: string; inputTokens: number; outputTokens: number; costUsd: number }

/**
 * Writes an auto-map onto the debate in one batch. Every box and link it adds carries the
 * run's id (aiRun), so the whole run can be taken off again with undoAutoMap.
 */
export async function applyAutoMap(db: Firestore, user: User, debateId: string, run: RunInfo, plan: PlannedArgument[], segments: Segment[]) {
  const debateRef = doc(db, 'debates', debateId)
  const runRef = doc(collection(debateRef, 'analyses'))
  const batch = writeBatch(db)
  const ids = new Map<string, string>()
  for (const a of plan) {
    const target = 'existing' in a.target ? a.target.existing : ids.get(a.target.planned)!
    const premiseIds = a.premises.map((p) => {
      const ref = doc(collection(debateRef, 'claims'))
      ids.set(p.key, ref.id)
      const seg = p.segment !== null ? segments[p.segment] : undefined
      batch.set(ref, {
        text: p.text,
        type: p.type,
        authorUid: user.uid,
        side: a.side,
        placed: true,
        aiSuggested: true,
        aiRun: runRef.id,
        ...(seg ? { source: { segment: p.segment, start: seg.start, speaker: seg.speaker, quote: seg.text.slice(0, 2000) } } : {}),
        createdAt: serverTimestamp(),
      })
      return ref.id
    })
    batch.set(doc(collection(debateRef, 'links')), {
      kind: a.kind,
      targetClaimId: target,
      premiseClaimIds: premiseIds,
      authorUid: user.uid,
      side: a.side,
      aiRun: runRef.id,
      createdAt: serverTimestamp(),
    })
  }
  batch.set(runRef, { kind: 'automap', by: user.uid, ...run, boxes: premiseCount(plan), arguments: plan.length, undone: false, createdAt: serverTimestamp() })
  await batch.commit()
  return runRef.id
}

/** Takes an auto-map run's boxes and links off the map, with any links that pointed at those boxes. */
export async function undoAutoMap(db: Firestore, debateId: string, runId: string) {
  const debateRef = doc(db, 'debates', debateId)
  const [claims, links] = await Promise.all([
    getDocs(query(collection(debateRef, 'claims'), where('aiRun', '==', runId))),
    getDocs(collection(debateRef, 'links')),
  ])
  const removed = new Set(claims.docs.map((d) => d.id))
  const refs = [
    ...claims.docs.map((d) => d.ref),
    ...links.docs.filter((d) => d.data().aiRun === runId || removed.has(d.data().targetClaimId)).map((d) => d.ref),
  ]
  // Firestore batches hold 500 writes; leave room for the run's own update.
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db)
    refs.slice(i, i + 450).forEach((r) => batch.delete(r))
    if (i + 450 >= refs.length) batch.update(doc(debateRef, 'analyses', runId), { undone: true })
    await batch.commit()
  }
  if (!refs.length) await updateDoc(doc(debateRef, 'analyses', runId), { undone: true })
}
