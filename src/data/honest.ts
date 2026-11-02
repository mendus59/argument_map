import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { EvidenceKind, SideId, StanceChange } from '../model/types'
import type { PremiseInput } from './map'

/** Attaches supporting material to a claim. Any debater may add it; only they may remove it. */
export async function addEvidence(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  claimId: string,
  input: { title: string; url: string; kind: EvidenceKind },
) {
  const url = input.url.trim()
  await addDoc(collection(db, 'debates', debateId, 'evidence'), {
    claimId,
    title: input.title.trim(),
    url: url || null,
    kind: input.kind,
    addedBy: user.uid,
    side,
    createdAt: serverTimestamp(),
  })
}

export async function removeEvidence(db: Firestore, debateId: string, id: string) {
  await deleteDoc(doc(db, 'debates', debateId, 'evidence', id))
}

export async function addComment(db: Firestore, user: User, debateId: string, side: SideId, targetId: string, text: string) {
  await addDoc(collection(db, 'debates', debateId, 'comments'), {
    targetId,
    authorUid: user.uid,
    side,
    kind: 'comment',
    text: text.trim(),
    createdAt: serverTimestamp(),
  })
}

/**
 * Objects to the other side's claim after restating it. The restatement waits
 * for that side to confirm it; the objection goes on the map straight away.
 */
export async function objectWithRestatement(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  targetClaimId: string,
  restatement: string,
  premises: PremiseInput[],
) {
  const debateRef = doc(db, 'debates', debateId)
  const batch = writeBatch(db)
  batch.set(doc(collection(debateRef, 'comments')), {
    targetId: targetClaimId,
    authorUid: user.uid,
    side,
    kind: 'restatement',
    text: restatement.trim(),
    status: 'pending',
    reply: null,
    respondedBy: null,
    createdAt: serverTimestamp(),
  })
  const ids: string[] = []
  for (const p of premises) {
    const ref = doc(collection(debateRef, 'claims'))
    ids.push(ref.id)
    batch.set(ref, { text: p.text.trim(), type: p.type, authorUid: user.uid, side, placed: true, ...(p.source ? { source: p.source } : {}), createdAt: serverTimestamp() })
  }
  batch.set(doc(collection(debateRef, 'links')), { kind: 'objection', targetClaimId, premiseClaimIds: ids, authorUid: user.uid, side, createdAt: serverTimestamp() })
  await batch.commit()
}

/** The claim's side confirms a restatement, or says what it missed. */
export async function respondToRestatement(db: Firestore, user: User, debateId: string, commentId: string, confirmed: boolean, reply: string) {
  await updateDoc(doc(db, 'debates', debateId, 'comments', commentId), {
    status: confirmed ? 'confirmed' : 'disputed',
    reply: reply.trim() || null,
    respondedBy: user.uid,
    respondedAt: serverTimestamp(),
  })
}

export async function setRestateFirst(db: Firestore, debateId: string, on: boolean) {
  await updateDoc(doc(db, 'debates', debateId), { 'settings.restateFirst': on, updatedAt: serverTimestamp() })
}

/** Live stance history for one claim or link, newest first. */
export function watchStanceHistory(db: Firestore, debateId: string, targetId: string, onChange: (h: StanceChange[]) => void) {
  const q = query(collection(db, 'debates', debateId, 'stanceHistory'), where('targetId', '==', targetId))
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs
          .map((d) => ({ ...(d.data() as Omit<StanceChange, 'id'>), id: d.id }))
          .sort((a, b) => (b.at?.toMillis() ?? Infinity) - (a.at?.toMillis() ?? Infinity)),
      ),
    (e) => console.error(e),
  )
}
