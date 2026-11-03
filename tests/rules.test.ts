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
  getDocs,
  collection,
  query,
  where,
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
import { addArgument, addNote, editClaim, placeNote, setStance } from '../src/data/map'
import { addComment, addEvidence, objectWithRestatement, removeEvidence, respondToRestatement, setRestateFirst } from '../src/data/honest'
import { endRound, startRound } from '../src/data/live'
import { forkClaim, voteOutcome } from '../src/data/subdebates'
import { watchDebateMap } from '../src/data/debates'
import { CHUNK, createImport, loadTranscript, searchPublic, searchTermsFor, setVisibility } from '../src/data/imports'
import type { Debate, DebateMap } from '../src/model/types'

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

describe('map editing (milestone 2)', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User

  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
    await join('ben', 't-lead', 'leader', 'against')
    await join('rita', 't-read', 'reader', null)
  })

  it('adds a reason with co-premises and an objection from the other side', async () => {
    await assertSucceeds(addArgument(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'reason', 'c', [
      { text: 'Fares cover 20% of cost.', type: 'fact' },
      { text: 'Ridership would rise.', type: 'prediction' },
    ]))
    await assertSucceeds(addArgument(db('ben'), user('ben', 'Ben'), 'd1', 'against', 'objection', 'c', [{ text: 'Service would be cut.', type: 'prediction' }]))
  })

  it('refuses arguments from readers, for the wrong side, or aimed at a missing box', async () => {
    await assertFails(addArgument(db('rita'), user('rita', 'Rita'), 'd1', 'for', 'reason', 'c', [{ text: 'x', type: 'fact' }]))
    await assertFails(addArgument(db('ben'), user('ben', 'Ben'), 'd1', 'for', 'reason', 'c', [{ text: 'x', type: 'fact' }]))
    await assertFails(addArgument(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'reason', 'nope', [{ text: 'x', type: 'fact' }]))
  })

  it('refuses empty or mistyped claims', async () => {
    await assertFails(addArgument(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'reason', 'c', [{ text: '   ', type: 'fact' }]))
    await assertFails(setDoc(doc(db('ana'), 'debates/d1/claims/bad'), { text: 'x', type: 'opinion', authorUid: 'ana', side: 'for', placed: true }))
  })

  it('lets anyone on either side place a note, but not change its wording', async () => {
    const noteId = await addNote(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'Did Tallinn try this?')
    await assertFails(updateDoc(doc(db('ben'), `debates/d1/claims/${noteId}`), { text: 'Changed' }))
    await assertSucceeds(placeNote(db('ben'), user('ben', 'Ben'), 'd1', 'against', noteId, 'objection', 'c'))
    const placed = (await getDoc(doc(db('ana'), `debates/d1/claims/${noteId}`))).data()
    expect(placed?.placed).toBe(true)
    expect(placed?.text).toBe('Did Tallinn try this?')
  })

  it('stops readers placing notes', async () => {
    const noteId = await addNote(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'A note')
    await assertFails(updateDoc(doc(db('rita'), `debates/d1/claims/${noteId}`), { placed: true }))
  })

  it('lets the author edit wording and type, but not move a claim to the other side', async () => {
    await assertSucceeds(editClaim(db('ana'), 'd1', 'c', 'The city should make buses fare-free.', 'value'))
    await assertFails(updateDoc(doc(db('ana'), 'debates/d1/claims/c'), { side: 'against' }))
  })

  it('lets leaders set stances and inference checks within range', async () => {
    const linkId = await addArgument(db('ana'), user('ana', 'Ana'), 'd1', 'for', 'reason', 'c', [{ text: 'Fares cover 20%.', type: 'fact' }])
    await assertSucceeds(setStance(db('ben'), 'd1', 'c', 'against', 'disagree', 70))
    await assertSucceeds(setStance(db('ben'), 'd1', linkId, 'against', 'agree', 80))
    await assertFails(setDoc(doc(db('ben'), 'debates/d1/stances/c__against'), { targetId: 'c', side: 'against', value: 'maybe', confidence: 50 }))
    await assertFails(setDoc(doc(db('ben'), 'debates/d1/stances/c__against'), { targetId: 'c', side: 'against', value: 'agree', confidence: 150 }))
  })
})

describe('admin import', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User
  const patrick = user('pat', 'Patrick')
  const segments = Array.from({ length: CHUNK + 20 }, (_, i) => ({ start: i * 3, speaker: i % 2 ? 'MAYOR' : 'COUNCILLOR', text: `Line ${i}` }))
  const input = {
    title: 'Council debate',
    conclusion: 'Buses should be free.',
    subjects: ['transit'],
    labels: { for: 'Mayor', against: 'Councillor' },
    source: {
      kind: 'youtube' as const,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      title: 'Council debate',
      channel: 'City TV',
      speakers: [
        { label: 'MAYOR', side: 'for' as const },
        { label: 'COUNCILLOR', side: 'against' as const },
      ],
    },
    segments,
  }

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'admins/pat'), { note: 'admin' })
    })
  })

  it('lets only the admin import, and imports start private', async () => {
    await assertFails(createImport(db('ana'), user('ana', 'Ana'), input))
    const id = await assertSucceeds(createImport(db('pat'), patrick, input))
    const d = (await getDoc(doc(db('pat'), `debates/${id}`))).data() as Debate
    expect(d.visibility).toBe('private')
    expect(d.participantNames).toEqual(['MAYOR', 'COUNCILLOR'])
    expect(d.searchTerms).toEqual(['mayor', 'councillor', 'transit'])
    expect(await loadTranscript(db('pat'), id)).toEqual(segments)
    await assertFails(getDoc(doc(db('ana'), `debates/${id}`)))
    await assertFails(loadTranscript(db(null), id))
  })

  it('lets users check only their own admin record', async () => {
    await assertSucceeds(getDoc(doc(db('pat'), 'admins/pat')))
    await assertFails(getDoc(doc(db('ana'), 'admins/pat')))
    await assertFails(setDoc(doc(db('ana'), 'admins/ana'), { note: 'me too' }))
  })

  it('lets the admin map passages for both sides and set both stances', async () => {
    const id = await createImport(db('pat'), patrick, input)
    const d = (await getDoc(doc(db('pat'), `debates/${id}`))).data() as Debate
    const target = d.conclusion.claimId
    const source = { segment: 3, start: 9, speaker: 'MAYOR', quote: 'Line 3' }
    await assertSucceeds(addArgument(db('pat'), patrick, id, 'for', 'reason', target, [{ text: 'Line 3', type: 'fact', source }]))
    await assertSucceeds(addArgument(db('pat'), patrick, id, 'against', 'objection', target, [{ text: 'Line 4', type: 'fact' }]))
    await assertSucceeds(setStance(db('pat'), id, target, 'for', 'agree', 90))
    await assertSucceeds(setStance(db('pat'), id, target, 'against', 'disagree', 80))
    const claims = await getDocs(query(collection(db('pat'), `debates/${id}/claims`), where('side', '==', 'for')))
    expect(claims.docs.some((c) => c.data().source?.start === 9)).toBe(true)
    await assertFails(addNote(db('ana'), user('ana', 'Ana'), id, 'for', 'Sneaky'))
  })

  it('opens the debate and transcript to everyone once made public, and readers by invite', async () => {
    const id = await createImport(db('pat'), patrick, input)
    const snap = await getDoc(doc(db('pat'), `debates/${id}`))
    const debate = { ...(snap.data() as Omit<Debate, 'id'>), id }
    const token = await assertSucceeds(createInvite(db('pat'), patrick, debate, 'reader', null))
    await assertSucceeds(acceptInvite(db('rita'), user('rita', 'Rita'), (await getInvite(db('rita'), token))!))
    await assertSucceeds(loadTranscript(db('rita'), id))

    await assertFails(setVisibility(db('rita'), id, 'public'))
    await assertSucceeds(setVisibility(db('pat'), id, 'public'))
    expect(await loadTranscript(db(null), id)).toHaveLength(segments.length)
    await assertSucceeds(getDocs(query(collection(db(null), 'debates'), where('visibility', '==', 'public'))))
    await assertFails(setDoc(doc(db('rita'), `debates/${id}/transcript/0000`), { index: 0, segments: [] }))
  })

  it('finds public debates by participant or subject, and never private ones', async () => {
    const shown = await createImport(db('pat'), patrick, { ...input, source: { ...input.source, speakers: [{ label: 'Jane Smith', side: 'for' }] } })
    await createImport(db('pat'), patrick, { ...input, title: 'Still private' })
    await setVisibility(db('pat'), shown, 'public')
    expect((await searchPublic(db(null), '')).map((d) => d.id)).toEqual([shown])
    expect((await searchPublic(db(null), 'SMITH')).map((d) => d.id)).toEqual([shown])
    expect((await searchPublic(db(null), 'Transit')).map((d) => d.id)).toEqual([shown])
    expect(await searchPublic(db(null), 'mayor')).toEqual([])
  })

  it('builds search terms from whole names and their words', () => {
    expect(searchTermsFor(['Jane Smith'], ['City budget'])).toEqual(['jane smith', 'city budget', 'jane', 'smith', 'city', 'budget'])
  })
})

describe('honest-debate tools (milestone 3)', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User
  const ana = user('ana', 'Ana')
  const ben = user('ben', 'Ben')
  const rita = user('rita', 'Rita')

  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
    await join('ben', 't-lead', 'leader', 'against')
    await join('rita', 't-read', 'reader', null)
  })

  it('lets debaters attach sources for their side, and only the adder remove them', async () => {
    await assertSucceeds(addEvidence(db('ben'), ben, 'd1', 'against', 'c', { title: 'Transit budget 2025', url: 'https://example.org/budget', kind: 'data' }))
    await assertSucceeds(addEvidence(db('ana'), ana, 'd1', 'for', 'c', { title: 'Interview with a driver', url: '', kind: 'anecdote' }))
    await assertFails(addEvidence(db('ana'), ana, 'd1', 'against', 'c', { title: 'Wrong side', url: '', kind: 'data' }))
    await assertFails(addEvidence(db('rita'), rita, 'd1', 'for', 'c', { title: 'Reader', url: '', kind: 'data' }))
    await assertFails(addEvidence(db('ana'), ana, 'd1', 'for', 'c', { title: 'Bad link', url: 'javascript:alert(1)', kind: 'data' }))
    await assertFails(addEvidence(db('ana'), ana, 'd1', 'for', 'missing', { title: 'No box', url: '', kind: 'data' }))
    const all = await getDocs(collection(db('rita'), 'debates/d1/evidence'))
    expect(all.size).toBe(2)
    const bens = all.docs.find((d) => d.data().addedBy === 'ben')!
    await assertFails(removeEvidence(db('ana'), 'd1', bens.id))
    await assertSucceeds(removeEvidence(db('ben'), 'd1', bens.id))
  })

  it('lets debaters comment, but not readers', async () => {
    await assertSucceeds(addComment(db('ben'), ben, 'd1', 'against', 'c', 'What counts as fare-free?'))
    await assertFails(addComment(db('rita'), rita, 'd1', 'for', 'c', 'Reader comment'))
    await assertFails(addComment(db('ben'), ben, 'd1', 'for', 'c', 'Posing as the other side'))
  })

  it('records a restatement with the objection, which only the restated side can confirm', async () => {
    await assertSucceeds(objectWithRestatement(db('ben'), ben, 'd1', 'against', 'c', 'You say buses should cost riders nothing.', [{ text: 'Someone still pays.', type: 'value' }]))
    const restatement = (await getDocs(collection(db('ana'), 'debates/d1/comments'))).docs.find((d) => d.data().kind === 'restatement')!
    expect(restatement.data().status).toBe('pending')
    await assertFails(respondToRestatement(db('ben'), ben, 'd1', restatement.id, true, ''))
    await assertFails(respondToRestatement(db('rita'), rita, 'd1', restatement.id, true, ''))
    await assertSucceeds(respondToRestatement(db('ana'), ana, 'd1', restatement.id, false, 'Free at the point of use, paid for by taxes.'))
    await assertFails(respondToRestatement(db('ana'), ana, 'd1', restatement.id, true, ''))
    await assertFails(setDoc(doc(db('ben'), 'debates/d1/comments/fake'), { targetId: 'c', authorUid: 'ben', side: 'against', kind: 'restatement', text: 'x', status: 'confirmed', reply: null, respondedBy: null }))
  })

  it('records stance changes and concessions for the leader only', async () => {
    await assertSucceeds(setStance(db('ben'), 'd1', 'c', 'against', 'disagree', 70, { by: 'ben', from: undefined }))
    await assertSucceeds(setStance(db('ben'), 'd1', 'c', 'against', 'agree', 60, { by: 'ben', from: { targetId: 'c', side: 'against', value: 'disagree', confidence: 70 }, conceded: true }))
    const history = await getDocs(collection(db('rita'), 'debates/d1/stanceHistory'))
    expect(history.docs.map((d) => d.data().conceded).sort()).toEqual([false, true])
    await assertFails(setStance(db('ana'), 'd1', 'c', 'against', 'agree', 60, { by: 'ana', from: undefined }))
    await assertFails(updateDoc(doc(db('ben'), `debates/d1/stanceHistory/${history.docs[0].id}`), { conceded: false }))
  })

  it('lets a leader turn restate-first off, but not a reader', async () => {
    await assertSucceeds(setRestateFirst(db('ben'), 'd1', false))
    await assertFails(setRestateFirst(db('rita'), 'd1', true))
  })
})

describe('live and async (milestone 4)', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User
  const presence = (name: string, side: string | null) => ({ name, side, at: serverTimestamp(), editing: null })

  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
    await join('ben', 't-lead', 'leader', 'against')
    await join('rita', 't-read', 'reader', null)
  })

  it('lets participants mark only themselves present', async () => {
    await assertSucceeds(setDoc(doc(db('ben'), 'debates/d1/presence/ben'), presence('Ben', 'against')))
    await assertSucceeds(setDoc(doc(db('rita'), 'debates/d1/presence/rita'), presence('Rita', null)))
    await assertFails(setDoc(doc(db('ben'), 'debates/d1/presence/ana'), presence('Ana', 'for')))
    await assertFails(setDoc(doc(db('zed'), 'debates/d1/presence/zed'), presence('Zed', null)))
    await assertFails(setDoc(doc(db('ben'), 'debates/d1/presence/ben'), { ...presence('Ben', 'against'), admin: true }))
    await assertSucceeds(updateDoc(doc(db('ben'), 'debates/d1/presence/ben'), { editing: 'c' }))
    expect((await getDocs(collection(db('ana'), 'debates/d1/presence'))).size).toBe(2)
    await assertFails(getDocs(collection(db('zed'), 'debates/d1/presence')))
  })

  it('keeps visit times private to each user', async () => {
    await assertSucceeds(setDoc(doc(db('ana'), 'users/ana/visits/d1'), { at: serverTimestamp() }))
    await assertSucceeds(getDoc(doc(db('ana'), 'users/ana/visits/d1')))
    await assertFails(getDoc(doc(db('ben'), 'users/ana/visits/d1')))
    await assertFails(setDoc(doc(db('ben'), 'users/ana/visits/d1'), { at: serverTimestamp() }))
  })

  it('lets leaders run timed rounds, but not readers', async () => {
    const debate = { ...((await getDoc(doc(db('ana'), 'debates/d1'))).data() as Debate), id: 'd1' }
    await assertSucceeds(startRound(db('ben'), debate, user('ben', 'Ben'), 'against', 5))
    const after = (await getDoc(doc(db('ana'), 'debates/d1'))).data() as Debate
    expect(after.round).toMatchObject({ number: 1, side: 'against', minutes: 5 })
    await assertFails(startRound(db('rita'), debate, user('rita', 'Rita'), 'for', 5))
    await assertSucceeds(endRound(db('ana'), debate))
  })
})

describe('sub-debates (milestone 5)', () => {
  const user = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null, email: null }) as unknown as User
  const ana = user('ana', 'Ana')
  const ben = user('ben', 'Ben')
  const rita = user('rita', 'Rita')

  // Waits until the live map has loaded the box under test (listeners arrive one by one).
  async function mapOf(uid: string, id: string, ready = (m: DebateMap) => m.claims.some((c) => c.id === premise)): Promise<DebateMap> {
    return new Promise((resolve, reject) => {
      const stop = watchDebateMap(db(uid), id, (m) => {
        if (m && ready(m)) {
          stop()
          resolve(m)
        }
      }, reject)
    })
  }
  const debateOf = async (uid: string, id: string) => ({ ...((await getDoc(doc(db(uid), `debates/${id}`))).data() as Debate), id })

  let premise = ''
  beforeEach(async () => {
    await seedDebate()
    await setDoc(doc(db('ana'), 'invites/t-lead'), invite('ana', 'leader', 'against'))
    await setDoc(doc(db('ana'), 'invites/t-read'), invite('ana', 'reader', null))
    await join('ben', 't-lead', 'leader', 'against')
    await join('rita', 't-read', 'reader', null)
    await addArgument(db('ana'), ana, 'd1', 'for', 'reason', 'c', [{ text: 'Fares cover 20%.', type: 'fact' }])
    const claims = await getDocs(collection(db('ana'), 'debates/d1/claims'))
    premise = claims.docs.find((d) => d.id !== 'c')!.id
  })

  it('lets either side fork a box; the sub-debate shares the root teams and the box', async () => {
    const parent = await mapOf('ben', 'd1')
    const claim = parent.claims.find((c) => c.id === premise)!
    const sub = await assertSucceeds(forkClaim(db('ben'), ben, parent, claim, 'against'))
    expect((await getDoc(doc(db('ana'), `debates/d1/claims/${premise}`))).data()?.subDebateId).toBe(sub)
    // Readers of the root can read it; outsiders can't.
    await assertSucceeds(getDoc(doc(db('rita'), `debates/${sub}`)))
    await assertFails(getDoc(doc(db('zed'), `debates/${sub}`)))
    // The sub-debate's map shows the parent's box as its conclusion, with the root's teams.
    const m = await mapOf('ana', sub, (x) => x.claims.some((c) => c.id === premise) && x.debate.sides.against.leaderUid !== null)
    expect(m.debate.sides.against.leaderUid).toBe('ben')
    expect(m.claims[0].id).toBe(premise)
    // Arguments go in the sub-debate, aimed at the shared box; stances on it stay in the parent.
    await assertSucceeds(addArgument(db('ben'), ben, sub, 'against', 'objection', premise, [{ text: 'That ignores the state subsidy.', type: 'fact' }]))
    await assertSucceeds(setStance(db('ben'), 'd1', premise, 'against', 'disagree', 70))
    await assertFails(addArgument(db('rita'), rita, sub, 'for', 'reason', premise, [{ text: 'Reader', type: 'fact' }]))
  })

  it('refuses forks by readers, of missing boxes, or twice', async () => {
    const parent = await mapOf('ana', 'd1')
    const claim = parent.claims.find((c) => c.id === premise)!
    await assertFails(forkClaim(db('rita'), rita, { ...parent }, claim, 'for'))
    await assertSucceeds(forkClaim(db('ana'), ana, parent, claim, 'for'))
    await assertFails(forkClaim(db('ben'), ben, parent, claim, 'against'))
  })

  it('resolves only when both leaders record the same outcome', async () => {
    const parent = await mapOf('ana', 'd1')
    const sub = await forkClaim(db('ana'), ana, parent, parent.claims.find((c) => c.id === premise)!, 'for')
    await assertSucceeds(voteOutcome(db('ana'), await debateOf('ana', sub), 'for', 'accepted'))
    await assertFails(voteOutcome(db('rita'), await debateOf('rita', sub), 'against', 'accepted'))
    await assertFails(voteOutcome(db('ana'), await debateOf('ana', sub), 'against', 'accepted'))
    // A forged resolution with mismatched votes is refused.
    await assertFails(updateDoc(doc(db('ben'), `debates/${sub}`), { 'outcomeVotes.against': 'rejected', status: 'resolved', outcome: 'rejected' }))
    await assertSucceeds(voteOutcome(db('ben'), await debateOf('ben', sub), 'against', 'accepted'))
    const done = await debateOf('ana', sub)
    expect(done.status).toBe('resolved')
    expect(done.outcome).toBe('accepted')
  })
})
