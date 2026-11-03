import { useEffect, useRef, useState } from 'react'
import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Debate, Round, SideId, Time } from '../model/types'

/** How often an open tab says it's still there, and how long until it counts as gone. */
export const HEARTBEAT_MS = 45_000
export const ONLINE_MS = 100_000

export interface Presence {
  uid: string
  name: string
  side: SideId | null
  at?: Time
  /** The box this person is writing under, if any. */
  editing: string | null
}

export function isOnline(p: Presence, now = Date.now()) {
  const at = p.at?.toMillis()
  // A just-written heartbeat has no server time yet; count it as online.
  return at === undefined || now - at < ONLINE_MS
}

/**
 * Marks the user as here while the tab is open, and lists who else is.
 * Uses Firestore heartbeats so no extra Firebase service is needed.
 */
export function usePresence(db: Firestore, debateId: string, user: User | null, side: SideId | null) {
  const [others, setOthers] = useState<Presence[]>([])
  const [, tick] = useState(0)
  const editing = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'debates', debateId, 'presence', user.uid)
    const beat = () => {
      if (document.visibilityState === 'hidden') return
      setDoc(ref, { name: user.displayName ?? 'Someone', side, at: serverTimestamp(), editing: editing.current }).catch(() => {})
    }
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    const leave = () => deleteDoc(ref).catch(() => {})
    document.addEventListener('visibilitychange', beat)
    window.addEventListener('pagehide', leave)
    const unsub = onSnapshot(
      collection(db, 'debates', debateId, 'presence'),
      (snap) => setOthers(snap.docs.map((d) => ({ ...(d.data() as Omit<Presence, 'uid'>), uid: d.id })).filter((p) => p.uid !== user.uid)),
      () => {},
    )
    const clock = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(clock)
      document.removeEventListener('visibilitychange', beat)
      window.removeEventListener('pagehide', leave)
      unsub()
      leave()
    }
  }, [db, debateId, user, side])

  /** Tell the others which box you're writing under (null when you stop). */
  function setEditing(targetId: string | null) {
    if (!user || editing.current === targetId) return
    editing.current = targetId
    updateDoc(doc(db, 'debates', debateId, 'presence', user.uid), { editing: targetId }).catch(() => {})
  }

  return { online: others.filter((p) => isOnline(p)), setEditing }
}

/**
 * When the user last opened this debate (milliseconds, or null on a first visit),
 * then records this visit. Read once per page load.
 */
export function useLastVisit(db: Firestore, debateId: string, user: User | null) {
  const [last, setLast] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'visits', debateId)
    let live = true
    getDoc(ref)
      .then((snap) => {
        if (!live) return
        const at = snap.exists() ? (snap.data().at as Time)?.toMillis() : undefined
        setLast(at ?? null)
      })
      .catch(() => live && setLast(null))
      .finally(() => setDoc(ref, { at: serverTimestamp() }).catch(() => {}))
    const save = () => setDoc(ref, { at: serverTimestamp() }).catch(() => {})
    window.addEventListener('pagehide', save)
    return () => {
      live = false
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [db, debateId, user])
  return last
}

export async function startRound(db: Firestore, debate: Debate, user: User, side: SideId, minutes: number) {
  const round: Round = {
    number: (debate.round?.number ?? 0) + 1,
    side,
    minutes,
    endsAt: Date.now() + minutes * 60_000,
    startedBy: user.uid,
  }
  await updateDoc(doc(db, 'debates', debate.id), { round, updatedAt: serverTimestamp() })
}

export async function endRound(db: Firestore, debate: Debate) {
  await updateDoc(doc(db, 'debates', debate.id), { round: null, updatedAt: serverTimestamp() })
}
