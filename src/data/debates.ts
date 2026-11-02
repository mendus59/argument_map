import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  arrayUnion,
  type Firestore,
  type UpdateData,
  type DocumentData,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Claim, Comment, Debate, DebateMap, Evidence, Link, SideId, Stance } from '../model/types'

export type InviteRole = 'leader' | 'member' | 'reader'

export interface Invite {
  id: string
  debateId: string
  debateTitle: string
  role: InviteRole
  side: SideId | null
  createdBy: string
  usedBy: string | null
}

const other = (s: SideId): SideId => (s === 'for' ? 'against' : 'for')

function personOf(user: User) {
  return { name: user.displayName ?? user.email ?? 'Unnamed', photoURL: user.photoURL ?? null }
}

/** Creates or refreshes the signed-in user's profile document. */
export async function saveProfile(db: Firestore, user: User) {
  await setDoc(
    doc(db, 'users', user.uid),
    { displayName: user.displayName ?? '', photoURL: user.photoURL ?? null, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export interface NewDebateInput {
  title: string
  conclusion: string
  subjects: string[]
  side: SideId
}

/** Creates a private debate led by the user, with its conclusion as the first claim. */
export async function createDebate(db: Firestore, user: User, input: NewDebateInput): Promise<string> {
  const debateRef = doc(collection(db, 'debates'))
  const claimRef = doc(collection(debateRef, 'claims'))
  const mine = input.side
  const person = personOf(user)
  const batch = writeBatch(db)
  batch.set(debateRef, {
    title: input.title.trim(),
    subjects: input.subjects,
    participantNames: [person.name],
    origin: 'native',
    visibility: 'private',
    sides: {
      [mine]: { label: mine === 'for' ? 'For' : 'Against', leaderUid: user.uid, memberUids: [user.uid] },
      [other(mine)]: { label: mine === 'for' ? 'Against' : 'For', leaderUid: null, memberUids: [] },
    },
    readerUids: [],
    participantUids: [user.uid],
    people: { [user.uid]: person },
    createdBy: user.uid,
    creatorSide: mine,
    conclusion: { debateId: debateRef.id, claimId: claimRef.id },
    parent: null,
    status: 'open',
    outcome: null,
    outcomeVotes: {},
    unresolvedDepth: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.set(claimRef, {
    text: input.conclusion.trim(),
    type: 'unspecified',
    authorUid: user.uid,
    side: mine,
    placed: true,
    createdAt: serverTimestamp(),
  })
  await batch.commit()
  return debateRef.id
}

/** Live list of debates the user takes part in or can read. */
export function watchMyDebates(db: Firestore, uid: string, onChange: (debates: Debate[]) => void, onError: (e: Error) => void) {
  const q = query(collection(db, 'debates'), where('participantUids', 'array-contains', uid), orderBy('updatedAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as Omit<Debate, 'id'>), id: d.id }))),
    onError,
  )
}

/** Live view of one debate and its map contents. */
export function watchDebateMap(db: Firestore, debateId: string, onChange: (map: DebateMap | null) => void, onError: (e: Error) => void) {
  const ref = doc(db, 'debates', debateId)
  let debate: Debate | null = null
  let claims: Claim[] = []
  let links: Link[] = []
  let stances: Stance[] = []
  let evidence: Evidence[] = []
  let comments: Comment[] = []
  const emit = () => onChange(debate ? { debate, claims, links, stances, evidence, comments } : null)

  const unsubs = [
    onSnapshot(
      ref,
      (snap) => {
        debate = snap.exists() ? { ...(snap.data() as Omit<Debate, 'id'>), id: snap.id } : null
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(ref, 'claims'),
      (snap) => {
        claims = snap.docs.map((d) => ({ ...(d.data() as Omit<Claim, 'id'>), id: d.id }))
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(ref, 'links'),
      (snap) => {
        links = snap.docs.map((d) => ({ ...(d.data() as Omit<Link, 'id'>), id: d.id }))
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(ref, 'stances'),
      (snap) => {
        stances = snap.docs.map((d) => d.data() as Stance)
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(ref, 'evidence'),
      (snap) => {
        evidence = snap.docs.map((d) => ({ ...(d.data() as Omit<Evidence, 'id'>), id: d.id }))
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(ref, 'comments'),
      (snap) => {
        comments = snap.docs
          .map((d) => ({ ...(d.data() as Omit<Comment, 'id'>), id: d.id }))
          .sort((a, b) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity))
        emit()
      },
      onError,
    ),
  ]
  return () => unsubs.forEach((u) => u())
}

function newToken() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Creates a single-use invite link and returns its token. */
export async function createInvite(db: Firestore, user: User, debate: Debate, role: InviteRole, side: SideId | null) {
  const token = newToken()
  await setDoc(doc(db, 'invites', token), {
    debateId: debate.id,
    debateTitle: debate.title,
    role,
    side: role === 'reader' ? null : side,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    usedBy: null,
  })
  return token
}

export async function getInvite(db: Firestore, token: string): Promise<Invite | null> {
  const snap = await getDoc(doc(db, 'invites', token))
  return snap.exists() ? ({ ...(snap.data() as Omit<Invite, 'id'>), id: snap.id }) : null
}

/** Joins the debate an invite points to. Rules check that the invite is unused and matches. */
export async function acceptInvite(db: Firestore, user: User, invite: Invite) {
  const debateRef = doc(db, 'debates', invite.debateId)
  const batch = writeBatch(db)
  batch.update(doc(db, 'invites', invite.id), { usedBy: user.uid, usedAt: serverTimestamp() })
  const update: UpdateData<DocumentData> = {
    participantUids: arrayUnion(user.uid),
    [`people.${user.uid}`]: personOf(user),
    lastJoin: { token: invite.id, uid: user.uid },
    updatedAt: serverTimestamp(),
  }
  if (invite.role === 'reader') {
    update.readerUids = arrayUnion(user.uid)
  } else if (invite.side) {
    update[`sides.${invite.side}.memberUids`] = arrayUnion(user.uid)
    if (invite.role === 'leader') update[`sides.${invite.side}.leaderUid`] = user.uid
  }
  batch.update(debateRef, update)
  await batch.commit()
}

export function roleIn(debate: Debate, uid: string): { side: SideId | null; leader: boolean; reader: boolean } {
  for (const side of ['for', 'against'] as SideId[]) {
    if (debate.sides[side].memberUids.includes(uid)) return { side, leader: debate.sides[side].leaderUid === uid, reader: false }
  }
  return { side: null, leader: false, reader: debate.readerUids.includes(uid) }
}
