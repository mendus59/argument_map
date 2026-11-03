import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { AnalysisResult, Suggestion } from '../ai/analysis'
import type { Segment } from '../import/transcript'
import type { Time } from '../model/types'

/** The default monthly cap until the admin sets one, in US dollars. */
export const DEFAULT_CAP_USD = 10

export type SuggestionStatus = 'accepted' | 'dismissed'

export interface Analysis extends AnalysisResult {
  id: string
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
