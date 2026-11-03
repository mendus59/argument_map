import { doc, onSnapshot, serverTimestamp, updateDoc, writeBatch, collection, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Claim, Debate, DebateMap, Outcome, SideId } from '../model/types'

/**
 * Forks a box into a sub-debate. The box itself becomes the sub-debate's
 * conclusion, so both sides' stances on it stay shared with the parent.
 */
export async function forkClaim(db: Firestore, user: User, map: DebateMap, claim: Claim, side: SideId): Promise<string> {
  const parent = map.debate
  const subRef = doc(collection(db, 'debates'))
  const ref = { debateId: parent.id, claimId: claim.id }
  const batch = writeBatch(db)
  batch.update(doc(db, 'debates', parent.id, 'claims', claim.id), { subDebateId: subRef.id })
  batch.set(subRef, {
    title: claim.text,
    subjects: parent.subjects,
    origin: 'native',
    visibility: 'private',
    root: parent.root ?? parent.id,
    parent: ref,
    conclusion: ref,
    createdBy: user.uid,
    creatorSide: side,
    status: 'open',
    outcome: null,
    outcomeVotes: {},
    unresolvedDepth: 0,
    subDebates: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'debates', parent.id), {
    [`subDebates.${subRef.id}`]: { claimId: claim.id, title: claim.text.slice(0, 300) },
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return subRef.id
}

/** A leader records their side's outcome. The sub-debate resolves when both sides match. */
export async function voteOutcome(db: Firestore, debate: Debate, side: SideId, outcome: Outcome) {
  const other: SideId = side === 'for' ? 'against' : 'for'
  const agreed = debate.outcomeVotes[other] === outcome
  await updateDoc(doc(db, 'debates', debate.id), {
    [`outcomeVotes.${side}`]: outcome,
    status: agreed ? 'resolved' : 'open',
    outcome: agreed ? outcome : null,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Live view of a whole debate tree: the root and every sub-debate below it,
 * found by following each debate's list of sub-debates.
 */
export function watchTree(db: Firestore, rootId: string, onChange: (debates: Map<string, Debate>) => void) {
  const debates = new Map<string, Debate>()
  const watching = new Map<string, () => void>()
  const watch = (id: string) => {
    if (watching.has(id)) return
    watching.set(
      id,
      onSnapshot(
        doc(db, 'debates', id),
        (snap) => {
          if (!snap.exists()) return
          const d = { ...(snap.data() as Omit<Debate, 'id'>), id }
          debates.set(id, d)
          for (const child of Object.keys(d.subDebates ?? {})) watch(child)
          onChange(new Map(debates))
        },
        () => {},
      ),
    )
  }
  watch(rootId)
  return () => watching.forEach((stop) => stop())
}

/** Where a box's stances are stored: a sub-debate's conclusion keeps them in the parent. */
export function stanceHome(map: DebateMap, targetId: string) {
  return targetId === map.debate.conclusion.claimId ? map.debate.conclusion.debateId : map.debate.id
}
