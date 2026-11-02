// Firestore security rules tests. Run with `npm run test:rules` (starts the emulator).
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { acceptInvite, createDebate, createInvite, getInvite, roleIn } from '../src/data/debates'
import type { Debate } from '../src/model/types'

let env: RulesTestEnvironment

// One Firestore instance per user, so refs and batches always come from the same instance.
const stores = new Map<string, Firestore>()
const db = (uid: string | null): Firestore => {
  const key = uid ?? '(signed out)'
  if (!stores.has(key)) {
    const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()
    stores.set(key, ctx.firestore() as unknown as Firestore)
  }
  return stores.get(key)!
}

function newDebate(uid: string, side: 'for' | 'against' = 'for') {
  const other = side === 'for' ? 'against' : 'for'
  return {
    title: 'Should buses be fare-free?',
    subjects: ['transit'],
    participantNames: ['Ana'],
    origin: 'native',
    visibility: 'private',
    sides: {
      [side]: { label: 'For', leaderUid: uid, memberUids: [uid] },
      [other]: { label: 'Against', leaderUid: null, memberUids: [] },
    },
    readerUids: [],
    participantUids: [uid],
    people: { [uid]: { name: 'Ana', photoURL: null } },
    createdBy: uid,
    creatorSide: side,
    conclusion: { debateId: 'd1', claimId: 'c' },
    parent: null,
    status: 'open',
    outcome: null,
    outcomeVotes: {},
    unresolvedDepth: 0,
    updatedAt: serverTimestamp(),
  }
}

/** Creates debate d1 led by ana on the For side, with conclusion claim c. */
async function seedDebate() {
  const store = db('ana')
  const batch = writeBatch(store)
  batch.set(doc(store, 'debates/d1'), newDebate('ana'))
  batch.set(doc(store, 'debates/d1/claims/c'), { text: 'Buses should be free.', authorUid: 'ana', side: 'for', placed: true, type: 'unspecified' })
  await batch.commit()
}

function invite(createdBy: string, role: string, side: string | null) {
  return { debateId: 'd1', debateTitle: 'Should buses be fare-free?', role, side, createdBy, createdAt: serverTimestamp(), usedBy: null }
}

async function join(uid: string, token: string, role: 'leader' | 'member' | 'reader', side: 'for' | 'against' | null) {
  const store = db(uid)
  const batch = writeBatch(store)
  batch.update(doc(store, `invites/${token}`), { usedBy: uid, usedAt: serverTimestamp() })
  const update: Record<string, unknown> = {
    participantUids: arrayUnion(uid),
    [`people.${uid}`]: { name: uid, photoURL: null },
    lastJoin: { token, uid },
    updatedAt: serverTimestamp(),
  }
  if (role === 'reader') update.readerUids = arrayUnion(uid)
  else {
    update[`sides.${side}.memberUids`] = arrayUnion(uid)
    if (role === 'leader') update[`sides.${side}.leaderUid`] = uid
  }
  batch.update(doc(store, 'debates/d1'), update)
  return batch.commit()
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-parrhesia',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
beforeEach(() => env.clearFirestore())
afterAll(() => env.cleanup())

describe('creating debates', () => {
  it('lets a signed-in user create a debate with its conclusion', async () => {
    await assertSucceeds(seedDebate())
  })

  it('refuses signed-out users', async () => {
    await assertFails(setDoc(doc(db(null), 'debates/d1'), newDebate('ana')))
  })

  it('refuses a debate that names someone else as the other leader', async () => {
    const d = newDebate('ana')
    d.sides.against = { label: 'Against', leaderUid: 'ben', memberUids: ['ben'] }
    await assertFails(setDoc(doc(db('ana'), 'debates/d1'), d))
  })

  it('refuses a debate created as public', async () => {
    await assertFails(setDoc(doc(db('ana'), 'debates/d1'), { ...newDebate('ana'), visibility: 'public' }))
  })
})

describe('reading', () => {
  beforeEach(seedDebate)

  it('lets participants read a private debate and its claims', async () => {
    await assertSucceeds(getDoc(doc(db('ana'), 'debates/d1')))
    await assertSucceeds(getDoc(doc(db('ana'), 'debates/d1/claims/c')))
  })

  it('hides a private debate from outsiders and signed-out visitors', async () => {
    await assertFails(getDoc(doc(db('eve'), 'debates/d1')))
    await assertFails(getDoc(doc(db('eve'), 'debates/d1/claims/c')))
    await assertFails(getDoc(doc(db(null), 'debates/d1')))
  })
})

describe('invites', () => {
  beforeEach(seedDebate)

  it('lets the leader invite the other side’s leader, teammates and readers', async () => {
    await assertSucceeds(setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against')))
    await assertSucceeds(setDoc(doc(db('ana'), 'invites/t-mem'), invite('ana', 'member', 'for')))
    await assertSucceeds(setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null)))
  })

  it('stops a leader inviting members to the other side or a second leader for their own', async () => {
    await assertFails(setDoc(doc(db('ana'), 'invites/x1'), invite('ana', 'member', 'against')))
    await assertFails(setDoc(doc(db('ana'), 'invites/x2'), invite('ana', 'leader', 'for')))
  })

  it('stops non-leaders creating invites', async () => {
    await assertFails(setDoc(doc(db('eve'), 'invites/x3'), invite('eve', 'reader', null)))
  })

  it('does not allow listing invites', async () => {
    const { collection, getDocs } = await import('firebase/firestore')
    await assertFails(getDocs(collection(db('eve'), 'invites')))
  })
})

describe('joining', () => {
  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against'))
    await setDoc(doc(db('ana'), 'invites/t-mem'), invite('ana', 'member', 'for'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
  })

  it('makes the invitee the other side’s leader, once', async () => {
    await assertSucceeds(join('ben', 't-lead', 'leader', 'against'))
    await assertSucceeds(getDoc(doc(db('ben'), 'debates/d1')))
    await assertFails(join('eve', 't-lead', 'leader', 'against'))
  })

  it('adds teammates and readers', async () => {
    await assertSucceeds(join('raj', 't-mem', 'member', 'for'))
    await assertSucceeds(join('rita', 't-read', 'reader', null))
    await assertSucceeds(getDoc(doc(db('rita'), 'debates/d1')))
  })

  it('refuses a join that goes beyond what the invite grants', async () => {
    // A member invite used to grab the empty leader seat.
    await assertFails(join('raj', 't-mem', 'leader', 'against'))
    // A reader invite used to join a side.
    await assertFails(join('rita', 't-read', 'member', 'for'))
  })

  it('refuses a debate update that points at an invite it does not claim', async () => {
    await assertFails(
      updateDoc(doc(db('eve'), 'debates/d1'), {
        participantUids: arrayUnion('eve'),
        readerUids: arrayUnion('eve'),
        'people.eve': { name: 'eve' },
        lastJoin: { token: 't-read', uid: 'eve' },
      }),
    )
  })
})

describe('maintenance and map writes', () => {
  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-mem'), invite('ana', 'member', 'for'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
    await join('raj', 't-mem', 'member', 'for')
    await join('rita', 't-read', 'reader', null)
  })

  it('lets leaders edit the title, but not members', async () => {
    await assertSucceeds(updateDoc(doc(db('ana'), 'debates/d1'), { title: 'Fare-free buses?' }))
    await assertFails(updateDoc(doc(db('raj'), 'debates/d1'), { title: 'Something else' }))
  })

  it('stops leaders changing membership or visibility directly', async () => {
    await assertFails(updateDoc(doc(db('ana'), 'debates/d1'), { visibility: 'public' }))
    await assertFails(updateDoc(doc(db('ana'), 'debates/d1'), { 'sides.against.leaderUid': 'ana' }))
  })

  it('lets members post claims for their own side only', async () => {
    const claim = { text: 'Fares cover 20%.', type: 'fact', authorUid: 'raj', side: 'for', placed: true }
    await assertSucceeds(setDoc(doc(db('raj'), 'debates/d1/claims/p1'), claim))
    await assertFails(setDoc(doc(db('raj'), 'debates/d1/claims/p2'), { ...claim, side: 'against' }))
    await assertFails(setDoc(doc(db('rita'), 'debates/d1/claims/p3'), { ...claim, authorUid: 'rita' }))
  })

  it('lets only the author change a claim’s wording', async () => {
    await setDoc(doc(db('raj'), 'debates/d1/claims/p1'), { text: 'Fares cover 20%.', type: 'fact', authorUid: 'raj', side: 'for', placed: true })
    await assertSucceeds(updateDoc(doc(db('raj'), 'debates/d1/claims/p1'), { text: 'Fares cover about 20%.' }))
    await assertFails(updateDoc(doc(db('ana'), 'debates/d1/claims/p1'), { text: 'Fares cover 50%.' }))
  })

  it('lets only a side’s leader set that side’s stance', async () => {
    const stance = { targetId: 'c', side: 'for', value: 'agree', confidence: 80 }
    await assertSucceeds(setDoc(doc(db('ana'), 'debates/d1/stances/c__for'), stance))
    await assertFails(setDoc(doc(db('raj'), 'debates/d1/stances/c__for'), stance))
    await assertFails(setDoc(doc(db('ana'), 'debates/d1/stances/c__against'), { ...stance, side: 'against' }))
  })
})

// The app's own data functions, run against the same rules.
describe('app data layer', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User

  it('creates a debate, invites the other leader and a reader, and both can join', async () => {
    const ana = user('ana', 'Ana')
    const id = await assertSucceeds(createDebate(db('ana'), ana, { title: 'Fare-free buses?', conclusion: 'Buses should be free.', subjects: ['transit'], side: 'against' }))
    const snap = await getDoc(doc(db('ana'), `debates/${id}`))
    const debate = { ...(snap.data() as Omit<Debate, 'id'>), id }

    const leadToken = await assertSucceeds(createInvite(db('ana'), ana, debate, 'leader', 'for'))
    const readToken = await assertSucceeds(createInvite(db('ana'), ana, debate, 'reader', null))

    const leadInvite = await getInvite(db('ben'), leadToken)
    await assertSucceeds(acceptInvite(db('ben'), user('ben', 'Ben'), leadInvite!))
    const readInvite = await getInvite(db('rita'), readToken)
    await assertSucceeds(acceptInvite(db('rita'), user('rita', 'Rita'), readInvite!))

    const after = (await getDoc(doc(db('ben'), `debates/${id}`))).data() as Debate
    expect(after.sides.for.leaderUid).toBe('ben')
    expect(after.readerUids).toEqual(['rita'])
    expect(after.participantUids).toEqual(['ana', 'ben', 'rita'])
    expect(roleIn({ ...after, id }, 'ben')).toEqual({ side: 'for', leader: true, reader: false })
  })
})
