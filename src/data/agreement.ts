// Writes for agreeing claims: answers, term definitions, wording challenges and
// versioned edits. firestore.rules checks each one.
import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Claim, ClaimType, Definition, Rewording, SideId, Term } from '../model/types'
import { replacePhrase, versionOf } from '../model/agreement'

const claimRef = (db: Firestore, debateId: string, claimId: string) => doc(db, 'debates', debateId, 'claims', claimId)

/** Keeps the claim's current wording as a version, and moves the claim on to the next one. */
function writeNewVersion(db: Firestore, batch: WriteBatch, user: User, debateId: string, claim: Pick<Claim, 'id' | 'text' | 'type' | 'version'>, text: string, type: ClaimType) {
  const v = versionOf(claim)
  batch.set(doc(db, 'debates', debateId, 'claimVersions', `${claim.id}__${v}`), {
    claimId: claim.id,
    version: v,
    text: claim.text,
    type: claim.type,
    by: user.uid,
    at: serverTimestamp(),
  })
  batch.update(claimRef(db, debateId, claim.id), { text: text.trim(), type, version: v + 1, updatedAt: serverTimestamp() })
}

/**
 * Changes a claim's wording or type. Only its author may do this. The old
 * wording is kept, and an earlier acceptance no longer covers the new one.
 */
export async function editClaim(db: Firestore, user: User, debateId: string, claimId: string, text: string, type: ClaimType) {
  const snap = await getDoc(claimRef(db, debateId, claimId))
  if (!snap.exists()) throw new Error('No such claim')
  const claim = { ...(snap.data() as Omit<Claim, 'id'>), id: claimId }
  const batch = writeBatch(db)
  writeNewVersion(db, batch, user, debateId, claim, text, type)
  await batch.commit()
}

/** The other side's leader accepts or disputes the claim as it is worded now. */
export async function answerClaim(db: Firestore, user: User, debateId: string, claim: Claim, side: SideId, value: 'accepted' | 'disputed') {
  await setDoc(doc(db, 'debates', debateId, 'acceptances', `${claim.id}__${side}`), {
    claimId: claim.id,
    side,
    version: versionOf(claim),
    value,
    by: user.uid,
    at: serverTimestamp(),
  })
}

export async function withdrawAnswer(db: Firestore, debateId: string, claimId: string, side: SideId) {
  await deleteDoc(doc(db, 'debates', debateId, 'acceptances', `${claimId}__${side}`))
}

/** Asks for a phrase in a claim to be defined, optionally proposing a definition straight away. */
export async function openTerm(db: Firestore, user: User, debateId: string, side: SideId, claimId: string, phrase: string, definition?: string) {
  const batch = writeBatch(db)
  const termRef = doc(collection(db, 'debates', debateId, 'terms'))
  batch.set(termRef, { claimId, phrase: phrase.trim(), openedBy: user.uid, side, createdAt: serverTimestamp() })
  if (definition?.trim()) {
    batch.set(doc(collection(db, 'debates', debateId, 'definitions')), newDefinition(user, side, { id: termRef.id, claimId }, definition, 'definition', null))
  }
  await batch.commit()
  return termRef.id
}

function newDefinition(user: User, side: SideId, term: Pick<Term, 'id' | 'claimId'>, text: string, kind: Definition['kind'], parentId: string | null) {
  return {
    termId: term.id,
    claimId: term.claimId,
    text: text.trim(),
    kind,
    parentId,
    by: user.uid,
    side,
    status: 'pending',
    respondedBy: null,
    answeredWith: null,
    createdAt: serverTimestamp(),
  }
}

/** Proposes a (new) definition for a term. The other side then accepts or rejects it. */
export async function proposeDefinition(db: Firestore, user: User, debateId: string, side: SideId, term: Term, text: string) {
  const ref = doc(collection(db, 'debates', debateId, 'definitions'))
  await setDoc(ref, newDefinition(user, side, term, text, 'definition', null))
  return ref.id
}

export async function acceptDefinition(db: Firestore, user: User, debateId: string, def: Definition) {
  await updateDoc(doc(db, 'debates', debateId, 'definitions', def.id), { status: 'accepted', respondedBy: user.uid, respondedAt: serverTimestamp() })
}

/** Rejects a definition. A rejection always comes with a counter-definition or an addendum. */
export async function rejectDefinition(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  def: Definition,
  answer: { kind: 'counter' | 'addendum'; text: string },
) {
  const batch = writeBatch(db)
  const ref = doc(collection(db, 'debates', debateId, 'definitions'))
  batch.update(doc(db, 'debates', debateId, 'definitions', def.id), { status: 'rejected', respondedBy: user.uid, respondedAt: serverTimestamp(), answeredWith: ref.id })
  batch.set(ref, newDefinition(user, side, { id: def.termId, claimId: def.claimId }, answer.text, answer.kind, def.id))
  await batch.commit()
  return ref.id
}

/** Challenges the wording of the other side's claim: suggest `suggestion` in place of `phrase`, and say why. */
export async function challengeWording(
  db: Firestore,
  user: User,
  debateId: string,
  side: SideId,
  claim: Claim,
  input: { phrase: string; suggestion: string; reason: string },
) {
  const ref = doc(collection(db, 'debates', debateId, 'rewordings'))
  await setDoc(ref, {
    claimId: claim.id,
    claimVersion: versionOf(claim),
    phrase: input.phrase.trim(),
    suggestion: input.suggestion.trim(),
    reason: input.reason.trim(),
    by: user.uid,
    side,
    status: 'open',
    reply: null,
    respondedBy: null,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/** The claim's author takes the suggested wording: the claim moves to a new version with it. */
export async function acceptRewording(db: Firestore, user: User, debateId: string, claim: Claim, r: Rewording) {
  const batch = writeBatch(db)
  writeNewVersion(db, batch, user, debateId, claim, replacePhrase(claim.text, r.phrase, r.suggestion), claim.type)
  batch.update(doc(db, 'debates', debateId, 'rewordings', r.id), { status: 'accepted', reply: null, respondedBy: user.uid, respondedAt: serverTimestamp() })
  await batch.commit()
}

/** The claim's author keeps their wording, and says why. */
export async function declineRewording(db: Firestore, user: User, debateId: string, r: Rewording, reply: string) {
  await updateDoc(doc(db, 'debates', debateId, 'rewordings', r.id), {
    status: 'declined',
    reply: reply.trim() || null,
    respondedBy: user.uid,
    respondedAt: serverTimestamp(),
  })
}
