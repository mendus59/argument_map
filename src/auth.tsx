import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth'
import { auth, db, googleProvider } from './firebase'
import { saveProfile } from './data/debates'
import { checkAdmin } from './data/imports'
import { isSuperAdminUser, saveEmailLookup } from './data/admins'

interface AuthState {
  user: User | null
  loading: boolean
  /** True for an Admin or Super Admin, who can import debates and run AI. */
  isAdmin: boolean
  /** True for a Super Admin, who can add and remove Admins. */
  isSuperAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u)
        setLoading(false)
        setIsAdmin(false)
        if (u) {
          saveProfile(db, u).catch((e) => console.error('Could not save profile', e))
          saveEmailLookup(db, u).catch((e) => console.error('Could not save email lookup', e))
          checkAdmin(db, u).then(setIsAdmin)
        }
      }),
    [],
  )

  const value: AuthState = {
    user,
    loading,
    isAdmin,
    isSuperAdmin: isSuperAdminUser(user),
    signIn: async () => {
      await signInWithPopup(auth, googleProvider)
    },
    signOut: () => fbSignOut(auth),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
