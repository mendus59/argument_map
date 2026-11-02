import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Debate, DebateSource, SideId } from '../model/types'
import type { Segment } from '../import/transcript'

/** Segments per transcript document. Keeps each document well under Firestore's 1 MB limit. */
export const CHUNK = 500

/** True when the user has an admins/{uid} document or the admin custom claim. */
export async function checkAdmin(db: Firestore, user: User): Promise<boolean> {
  try {
    const token = await user.getIdTokenResult()
    if (token.claims.admin === true) return true
    return (await getDoc(doc(db, 'admins', user.uid))).exists()
  } catch {
    return false
  }
}

/** Title and channel from YouTube's public oEmbed endpoint. Returns null if it can't be reached. */
export async function fetchVideoInfo(videoId: string): Promise<{ title: string; channel: string } | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { title?: string; author_name?: string }
    return { title: json.title ?? '', channel: json.author_name ?? '' }
  } catch {
    return null
  }
}

export interface ImportInput {
  title: string
  conclusion: string
  subjects: string[]
  labels: Record<SideId, string>
  source: Omit<DebateSource, 'segmentCount'>
  segments: Segment[]
}

/** Whole names and subjects, plus each word in them, lower-cased, so a search for "smith" finds "Jane Smith". */
export function searchTermsFor(names: string[], subjects: string[]) {
  const phrases = [...names, ...subjects].map(normalize).filter(Boolean)
  const words = phrases.flatMap((p) => p.split(' ')).filter((w) => w.length > 1)
  return [...new Set([...phrases, ...words])]
}

export function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export interface PublicDebate {
  id: string
  title: string
  subjects: string[]
  participantNames: string[]
  source?: Debate['source']
}

/**
 * Public imported debates, newest first, optionally matching a participant or subject.
 * Sorted here rather than in the query so it needs no composite index.
 */
export async function searchPublic(db: Firestore, term: string): Promise<PublicDebate[]> {
  const t = normalize(term)
  const base = collection(db, 'debates')
  const q = t
    ? query(base, where('visibility', '==', 'public'), where('searchTerms', 'array-contains', t), limit(200))
    : query(base, where('visibility', '==', 'public'), limit(200))
  const snap = await getDocs(q)
  const millis = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as Debate & { updatedAt?: unknown } }))
    .sort((a, b) => millis(b.data.updatedAt) - millis(a.data.updatedAt))
    .map(({ id, data: x }) => ({ id, title: x.title, subjects: x.subjects, participantNames: x.participantNames, source: x.source }))
}

/** Creates a private imported debate, its conclusion and its transcript in one batch. */
export async function createImport(db: Firestore, user: User, input: ImportInput): Promise<string> {
  const debateRef = doc(collection(db, 'debates'))
  const claimRef = doc(collection(debateRef, 'claims'))
  const names = input.source.speakers.filter((s) => s.side).map((s) => s.label)
  const batch = writeBatch(db)
  batch.set(debateRef, {
    title: input.title.trim(),
    subjects: input.subjects,
    participantNames: names,
    searchTerms: searchTermsFor(names, input.subjects),
    origin: 'imported',
    visibility: 'private',
    sides: {
      for: { label: input.labels.for.trim() || 'For', leaderUid: null, memberUids: [] },
      against: { label: input.labels.against.trim() || 'Against', leaderUid: null, memberUids: [] },
    },
    readerUids: [],
    participantUids: [user.uid],
    people: { [user.uid]: { name: user.displayName ?? user.email ?? 'Admin', photoURL: user.photoURL ?? null } },
    createdBy: user.uid,
    creatorSide: 'for',
    conclusion: { debateId: debateRef.id, claimId: claimRef.id },
    parent: null,
    status: 'open',
    outcome: null,
    outcomeVotes: {},
    unresolvedDepth: 0,
    source: { ...input.source, segmentCount: input.segments.length },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.set(claimRef, {
    text: input.conclusion.trim(),
    type: 'unspecified',
    authorUid: user.uid,
    side: 'for',
    placed: true,
    createdAt: serverTimestamp(),
  })
  for (let i = 0; i * CHUNK < input.segments.length; i++) {
    batch.set(doc(debateRef, 'transcript', String(i).padStart(4, '0')), {
      index: i,
      segments: input.segments.slice(i * CHUNK, (i + 1) * CHUNK),
    })
  }
  await batch.commit()
  return debateRef.id
}

export async function loadTranscript(db: Firestore, debateId: string): Promise<Segment[]> {
  const snap = await getDocs(collection(db, 'debates', debateId, 'transcript'))
  return snap.docs
    .map((d) => d.data() as { index: number; segments: Segment[] })
    .sort((a, b) => a.index - b.index)
    .flatMap((c) => c.segments)
}

export async function setVisibility(db: Firestore, debateId: string, visibility: 'private' | 'public') {
  await updateDoc(doc(db, 'debates', debateId), { visibility, updatedAt: serverTimestamp() })
}
