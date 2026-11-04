import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { Time } from '../model/types'

/**
 * Super Admins are fixed here and in firestore.rules (keep the two lists the same).
 * They can add and remove Admins from the Admin page; Admins import debates and run AI.
 */
export const SUPER_ADMIN_EMAILS = ['mendus59@gmail.com']

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export function isSuperAdminUser(user: User | null) {
  return !!user?.email && user.emailVerified && SUPER_ADMIN_EMAILS.includes(normalizeEmail(user.email))
}

export interface AdminEntry {
  uid: string
  email: string
  name: string
  addedBy: string
  addedAt?: Time
}

/**
 * Records which account an email belongs to, so a Super Admin can add an Admin by email.
 * Only Super Admins can read these records.
 */
export async function saveEmailLookup(db: Firestore, user: User) {
  if (!user.email || !user.emailVerified) return
  await setDoc(doc(db, 'emails', normalizeEmail(user.email)), { uid: user.uid, name: user.displayName ?? '', updatedAt: serverTimestamp() })
}

export async function listAdmins(db: Firestore): Promise<AdminEntry[]> {
  const snap = await getDocs(collection(db, 'admins'))
  return snap.docs.map((d) => {
    const x = d.data()
    return { uid: d.id, email: x.email ?? '', name: x.name ?? '', addedBy: x.addedBy ?? '', addedAt: x.addedAt }
  })
}

export type AddAdminResult = { ok: true; entry: AdminEntry } | { ok: false; reason: 'not-signed-up' | 'already' }

/** Makes the account with this email an Admin. It must have signed in to the app at least once. */
export async function addAdmin(db: Firestore, by: User, email: string): Promise<AddAdminResult> {
  const e = normalizeEmail(email)
  const lookup = await getDoc(doc(db, 'emails', e))
  if (!lookup.exists()) return { ok: false, reason: 'not-signed-up' }
  const { uid, name } = lookup.data() as { uid: string; name: string }
  const ref = doc(db, 'admins', uid)
  if ((await getDoc(ref)).exists()) return { ok: false, reason: 'already' }
  await setDoc(ref, { email: e, name, addedBy: by.uid, addedAt: serverTimestamp() })
  return { ok: true, entry: { uid, email: e, name, addedBy: by.uid } }
}

export async function removeAdmin(db: Firestore, uid: string) {
  await deleteDoc(doc(db, 'admins', uid))
}
