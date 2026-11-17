// Writes for agreeing claims: answers, term definitions, wording challenges and
// versioned edits. firestore.rules checks each one.
import { collection, doc, getDoc, onSnapshot, query, where, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Claim, ClaimType, Definition, GlossaryEntry, GroundEntry, Rewording, SideId, Term } from '../model/types'
import { replacePhrase, versionOf } from '../model/agreement'

const claimRef = (db: Firestore, debateId: string, claimId: string) => doc(db, 'debates', debateId, 'claims', claimId)

/**
 * `pair` is the key of the two people the debate is between (see model/pair.ts), passed
 * only when the signed-in user is one of them: they keep the shared common ground and
 * glossary up to date as they answer. Other team members' writes skip it.
 */
type Pair = string | null | undefined
const groundRef = (db: Firestore, pair: string, debateId: string, claimId: string) => doc(db, 'pairs', pair, 'ground', `${debateId}__${claimId}`)
const glossaryRef = (db: Firestore, pair: string, debateId: string, sourceId: string) => doc(db, 'pairs', pair, 'glossary', `${debateId}__${sourceId}`)

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
export async function editClaim(db: Firestore, user: User, debateId: string, claimId: string, text: string, type: ClaimType, pair?: Pair) {
  const snap = await getDoc(claimRef(db, debateId, claimId))
  if (!snap.exists()) throw new Error('No such claim')
  const claim = { ...(snap.data() as Omit<Claim, 'id'>), id: claimId }
  const batch = writeBatch(db)
  writeNewVersion(db, batch, user, debateId, claim, text, type)
  // It's no longer the claim that was agreed.
  if (pair) batch.delete(groundRef(db, pair, debateId, claimId))
  await batch.commit()
}

/**
 * The other side's leader accepts or disputes the claim as it is worded now. An
 * accepted claim joins the pair's common ground, so it can be reused in their other debates.
 */
export async function answerClaim(db: Firestore, user: User, debateId: string, claim: Claim, side: SideId, value: 'accepted' | 'disputed', pair?: Pair) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'debates', debateId, 'acceptances', `${claim.id}__${side}`), {
    claimId: claim.id,
    side,
    version: versionOf(claim),
    value,
    by: user.uid,
    at: serverTimestamp(),
  })
  if (pair && value === 'accepted' && !claim.groundRef) {
    const entry: Omit<GroundEntry, 'id' | 'at'> = { debateId, claimId: claim.id, side, text: claim.text, version: versionOf(claim), by: user.uid }
    batch.set(groundRef(db, pair, debateId, claim.id), { ...entry, at: serverTimestamp() })
  } else if (pair) batch.delete(groundRef(db, pair, debateId, claim.id))
  await batch.commit()
}

export async function withdrawAnswer(db: Firestore, debateId: string, claimId: string, side: SideId, pair?: Pair) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'debates', debateId, 'acceptances', `${claimId}__${side}`))
  if (pair) batch.delete(groundRef(db, pair, debateId, claimId))
  await batch.commit()
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
export async function proposeDefinition(db: Firestore, user: User, debateId: string, side: SideId, term: Term, text: string, pair?: Pair) {
  const batch = writeBatch(db)
  const ref = doc(collection(db, 'debates', debateId, 'definitions'))
  batch.set(ref, newDefinition(user, side, term, text, 'definition', null))
  // The agreed meaning is back under discussion.
  if (pair) batch.delete(glossaryRef(db, pair, debateId, term.id))
  await batch.commit()
  return ref.id
}

/** Accepts a definition. `glossary` adds the agreed meaning to the pair's glossary. */
export async function acceptDefinition(db: Firestore, user: User, debateId: string, def: Definition, glossary?: { pair: Pair; phrase: string; meaning: string }) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'debates', debateId, 'definitions', def.id), { status: 'accepted', respondedBy: user.uid, respondedAt: serverTimestamp() })
  if (glossary?.pair) {
    const entry: Omit<GlossaryEntry, 'id' | 'at'> = {
      debateId,
      kind: 'term',
      claimId: def.claimId,
      termId: def.termId,
      defId: def.id,
      rewordingId: null,
      phrase: glossary.phrase,
      meaning: glossary.meaning,
      replacement: null,
      by: user.uid,
    }
    batch.set(glossaryRef(db, glossary.pair, debateId, def.termId), { ...entry, at: serverTimestamp() })
  }
  await batch.commit()
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
export async function acceptRewording(db: Firestore, user: User, debateId: string, claim: Claim, r: Rewording, pair?: Pair) {
  const batch = writeBatch(db)
  writeNewVersion(db, batch, user, debateId, claim, replacePhrase(claim.text, r.phrase, r.suggestion), claim.type)
  batch.update(doc(db, 'debates', debateId, 'rewordings', r.id), { status: 'accepted', reply: null, respondedBy: user.uid, respondedAt: serverTimestamp() })
  if (pair) {
    batch.delete(groundRef(db, pair, debateId, claim.id))
    // Both now use the new wording, here and in their other debates.
    const entry: Omit<GlossaryEntry, 'id' | 'at'> = {
      debateId,
      kind: 'wording',
      claimId: claim.id,
      termId: null,
      defId: null,
      rewordingId: r.id,
      phrase: r.phrase,
      meaning: null,
      replacement: r.suggestion,
      by: user.uid,
    }
    batch.set(glossaryRef(db, pair, debateId, r.id), { ...entry, at: serverTimestamp() })
  }
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

/** Live view of what two people have agreed across all their debates. */
export function watchCommonGround(
  db: Firestore,
  pair: string,
  onChange: (v: { ground: GroundEntry[]; glossary: GlossaryEntry[] }) => void,
  onError: (e: Error) => void,
) {
  let ground: GroundEntry[] = []
  let glossary: GlossaryEntry[] = []
  const emit = () => onChange({ ground, glossary })
  const stops = [
    onSnapshot(
      collection(db, 'pairs', pair, 'ground'),
      (snap) => {
        ground = snap.docs.map((d) => ({ ...(d.data() as Omit<GroundEntry, 'id'>), id: d.id }))
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'pairs', pair, 'glossary'),
      (snap) => {
        glossary = snap.docs.map((d) => ({ ...(d.data() as Omit<GlossaryEntry, 'id'>), id: d.id }))
        emit()
      },
      onError,
    ),
  ]
  return () => stops.forEach((s) => s())
}

/**
 * Live status of a claim reused from elsewhere: the original claim, the other side's
 * answer to it, and its terms, definitions and wording challenges.
 */
export function watchGroundSource(db: Firestore, ref: { debateId: string; claimId: string }, onChange: (src: GroundSource) => void, onError: (e: Error) => void) {
  const src: GroundSource = { claim: null, acceptances: [], terms: [], definitions: [], rewordings: [], title: null }
  const emit = () => onChange({ ...src })
  const base = doc(db, 'debates', ref.debateId)
  const byClaim = (name: string) => query(collection(base, name), where('claimId', '==', ref.claimId))
  const rows = <T,>(snap: { docs: { id: string; data: () => unknown }[] }) => snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T)
  const stops = [
    onSnapshot(doc(base, 'claims', ref.claimId), (s) => ((src.claim = s.exists() ? ({ ...(s.data() as Omit<Claim, 'id'>), id: s.id }) : null), emit()), onError),
    onSnapshot(base, (s) => ((src.title = (s.data()?.title as string | undefined) ?? null), emit()), onError),
    onSnapshot(byClaim('acceptances'), (s) => ((src.acceptances = rows(s)), emit()), onError),
    onSnapshot(byClaim('terms'), (s) => ((src.terms = rows(s)), emit()), onError),
    onSnapshot(byClaim('definitions'), (s) => ((src.definitions = rows(s)), emit()), onError),
    onSnapshot(byClaim('rewordings'), (s) => ((src.rewordings = rows(s)), emit()), onError),
  ]
  return () => stops.forEach((s) => s())
}

export interface GroundSource {
  claim: Claim | null
  title: string | null
  acceptances: import('../model/types').Acceptance[]
  terms: Term[]
  definitions: Definition[]
  rewordings: Rewording[]
}
