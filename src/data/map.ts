import { collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { ClaimSource, ClaimType, Link, SideId, Stance, StanceValue } from '../model/types'

export interface PremiseInput {
  text: string
  type: ClaimType
  /** The transcript passage this premise was mapped from (imported debates). */
  source?: ClaimSource
}

/** Adds a reason or objection: new co-premise claims plus the link joining them to the target. */
export async function addArgument(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  kind: Link['kind'],
  targetClaimId: string,
  premises: PremiseInput[],
) {
  const debateRef = doc(db, 'debates', debateId)
  const batch = writeBatch(db)
  const ids: string[] = []
  for (const p of premises) {
    const ref = doc(collection(debateRef, 'claims'))
    ids.push(ref.id)
    batch.set(ref, { text: p.text.trim(), type: p.type, authorUid: user.uid, side, placed: true, ...(p.source ? { source: p.source } : {}), createdAt: serverTimestamp() })
  }
  const linkRef = doc(collection(debateRef, 'links'))
  batch.set(linkRef, { kind, targetClaimId, premiseClaimIds: ids, authorUid: user.uid, side, createdAt: serverTimestamp() })
  await batch.commit()
  return linkRef.id
}

/** Adds a rough note that sits off the map until someone places it. */
export async function addNote(db: Firestore, user: User, debateId: string, side: SideId, text: string, source?: ClaimSource) {
  const ref = doc(collection(db, 'debates', debateId, 'claims'))
  await setDoc(ref, {
    text: text.trim(),
    type: 'unspecified',
    authorUid: user.uid,
    side,
    placed: false,
    ...(source ? { source } : {}),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Places a note on the map as a reason or objection to the target, on the placer's side. */
export async function placeNote(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  noteId: string,
  kind: Link['kind'],
  targetClaimId: string,
) {
  const debateRef = doc(db, 'debates', debateId)
  const batch = writeBatch(db)
  batch.update(doc(debateRef, 'claims', noteId), { placed: true })
  batch.set(doc(collection(debateRef, 'links')), {
    kind,
    targetClaimId,
    premiseClaimIds: [noteId],
    authorUid: user.uid,
    side,
    createdAt: serverTimestamp(),
  })
  await batch.commit()
}

/** Changes a claim's wording or type. Only its author may do this. */
export async function editClaim(db: Firestore, debateId: string, claimId: string, text: string, type: ClaimType) {
  await updateDoc(doc(db, 'debates', debateId, 'claims', claimId), { text: text.trim(), type, updatedAt: serverTimestamp() })
}

/**
 * Sets a team's stance on a claim, or on a link (the inference check).
 * Only that side's leader may do this. With `history`, the change is also
 * recorded in the stance history (a concession is marked as such).
 */
export async function setStance(
  db: Firestore,
  debateId: string,
  targetId: string,
  side: SideId,
  value: StanceValue,
  confidence: number,
  history?: { by: string; from: Stance | undefined; conceded?: boolean },
) {
  const conf = Math.round(Math.min(100, Math.max(0, confidence)))
  const batch = writeBatch(db)
  batch.set(doc(db, 'debates', debateId, 'stances', `${targetId}__${side}`), { targetId, side, value, confidence: conf, updatedAt: serverTimestamp() })
  if (history) {
    batch.set(doc(collection(db, 'debates', debateId, 'stanceHistory')), {
      targetId,
      side,
      from: history.from ? { value: history.from.value, confidence: history.from.confidence } : null,
      to: { value, confidence: conf },
      conceded: !!history.conceded,
      by: history.by,
      at: serverTimestamp(),
    })
  }
  await batch.commit()
}
